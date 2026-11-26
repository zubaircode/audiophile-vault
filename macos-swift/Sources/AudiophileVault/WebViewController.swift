import Foundation
import AppKit
import WebKit
import UniformTypeIdentifiers

public final class DraggableWebView: WKWebView {
    public private(set) var lastMouseDownEvent: NSEvent?
    public var headerHeight: CGFloat = 76.0
    public var noDragRects: [NSRect] = []
    public var isModalOpen: Bool = false

    public override var mouseDownCanMoveWindow: Bool {
        return false
    }

    private func topLeftPoint(for event: NSEvent) -> NSPoint {
        let pt = convert(event.locationInWindow, from: nil)
        let topY = isFlipped ? pt.y : (bounds.height - pt.y)
        return NSPoint(x: pt.x, y: topY)
    }

    public func isPointInHeaderDragRegion(_ topLeftPt: NSPoint) -> Bool {
        guard !isModalOpen else { return false }
        // Top 14px titlebar strip is always draggable (outside traffic lights)
        if topLeftPt.y >= 0 && topLeftPt.y <= headerHeight {
            for rect in noDragRects {
                if rect.insetBy(dx: -2, dy: -2).contains(topLeftPt) {
                    return false
                }
            }
            return true
        }
        return false
    }

    public override func mouseDown(with event: NSEvent) {
        self.lastMouseDownEvent = event
        let pt = topLeftPoint(for: event)
        if isPointInHeaderDragRegion(pt) {
            if event.clickCount == 2 {
                self.window?.performZoom(nil)
                return
            }
            if let win = self.window {
                win.performDrag(with: event)
                return
            }
        }
        super.mouseDown(with: event)
    }

    public func initiateWindowDrag() {
        guard let win = self.window else { return }
        if let event = self.lastMouseDownEvent {
            win.performDrag(with: event)
            return
        }
        if let current = NSApp.currentEvent, current.type == .leftMouseDown || current.type == .leftMouseDragged {
            win.performDrag(with: current)
            return
        }
        let loc = win.mouseLocationOutsideOfEventStream
        if let synth = NSEvent.mouseEvent(
            with: .leftMouseDown,
            location: loc,
            modifierFlags: [],
            timestamp: ProcessInfo.processInfo.systemUptime,
            windowNumber: win.windowNumber,
            context: nil,
            eventNumber: 0,
            clickCount: 1,
            pressure: 1.0
        ) {
            win.performDrag(with: synth)
        }
    }
}

public final class WebViewController: NSViewController, WKScriptMessageHandlerWithReply, WKUIDelegate, WKNavigationDelegate {
    public private(set) var webView: DraggableWebView!
    private let schemeHandler = VaultSchemeHandler()
    private let apiQueue = DispatchQueue(label: "com.audiophilevault.api", qos: .userInitiated, attributes: .concurrent)

    public override func loadView() {
        let config = WKWebViewConfiguration()
        config.setURLSchemeHandler(schemeHandler, forURLScheme: "av")

        let contentController = WKUserContentController()
        contentController.addScriptMessageHandler(self, contentWorld: .page, name: "avBridge")

        let bridgeScript = WKUserScript(
            source: Self.injectedBridgeJavaScript,
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        )
        contentController.addUserScript(bridgeScript)
        config.userContentController = contentController

        config.preferences.setValue(true, forKey: "developerExtrasEnabled")

        let wv = DraggableWebView(frame: NSRect(x: 0, y: 0, width: 1360, height: 860), configuration: config)
        wv.autoresizingMask = [.width, .height]
        wv.uiDelegate = self
        wv.navigationDelegate = self
        wv.setValue(false, forKey: "drawsBackground")
        self.webView = wv
        self.view = wv
    }

    public override func viewDidLoad() {
        super.viewDidLoad()

        SSEEventBus.shared.setHandler { [weak self] channel, payload in
            guard let data = try? JSONSerialization.data(withJSONObject: payload),
                  let jsonStr = String(data: data, encoding: .utf8) else {
                return
            }
            DispatchQueue.main.async {
                self?.webView?.evaluateJavaScript("window.__avDispatchSSE && window.__avDispatchSSE(\(Self.jsQuote(channel)), \(jsonStr));", completionHandler: nil)
            }
        }

        LibraryService.shared.initializeIfNeeded()
        PlaylistService.shared.syncAllPlaylistsM3u()

        BonjourFtpBrowser.shared.setOnServicesChanged { [weak self] services in
            guard let data = try? JSONSerialization.data(withJSONObject: services),
                  let jsonStr = String(data: data, encoding: .utf8) else {
                return
            }
            DispatchQueue.main.async {
                self?.webView?.evaluateJavaScript("window.__avNotifyFtpServices && window.__avNotifyFtpServices(\(jsonStr));", completionHandler: nil)
            }
        }
        BonjourFtpBrowser.shared.startBrowsing()

        VolumeAndSyncService.shared.setOnSyncStateChanged { [weak self] state in
            guard let data = try? JSONSerialization.data(withJSONObject: state),
                  let jsonStr = String(data: data, encoding: .utf8) else {
                return
            }
            DispatchQueue.main.async {
                self?.webView?.evaluateJavaScript("window.__avNotifySyncState && window.__avNotifySyncState(\(jsonStr));", completionHandler: nil)
            }
        }

        if let indexUrl = URL(string: "av://localhost/index.html") {
            webView.load(URLRequest(url: indexUrl))
        }
    }

    public func notifyFullScreenChanged(_ isFullScreen: Bool) {
        let boolStr = isFullScreen ? "true" : "false"
        webView?.evaluateJavaScript("window.__avNotifyFullScreen && window.__avNotifyFullScreen(\(boolStr));", completionHandler: nil)
    }

    public func reloadFrontend() {
        webView?.reload()
    }

    public func focusSearchField() {
        let js = """
        (function() {
          const input = document.querySelector('input[type="text"][placeholder*="Search"], input[placeholder*="Filter"], input[type="search"]');
          if (input) { input.focus(); input.select && input.select(); }
        })();
        """
        webView?.evaluateJavaScript(js, completionHandler: nil)
    }

    private static func jsQuote(_ str: String) -> String {
        if let d = try? JSONSerialization.data(withJSONObject: [str]),
           let s = String(data: d, encoding: .utf8),
           s.count >= 2 {
            return String(s.dropFirst().dropLast())
        }
        return "\"\(str)\""
    }

    // MARK: - WKScriptMessageHandlerWithReply
    public func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage,
        replyHandler: @escaping (Any?, String?) -> Void
    ) {
        guard message.name == "avBridge",
              let dict = message.body as? [String: Any],
              let type = dict["type"] as? String else {
            replyHandler(nil, "Invalid bridge message")
            return
        }

        switch type {
        case "startWindowDrag", "windowDrag":
            self.webView?.initiateWindowDrag()
            replyHandler(["ok": true], nil)

        case "windowZoom":
            self.view.window?.performZoom(nil)
            replyHandler(["ok": true], nil)

        case "updateHeaderDragRegions":
            if let hh = dict["headerHeight"] as? Double, hh > 0 {
                self.webView?.headerHeight = CGFloat(hh)
            } else if let hh = dict["headerHeight"] as? Int, hh > 0 {
                self.webView?.headerHeight = CGFloat(hh)
            }
            if let modal = dict["isModalOpen"] as? Bool {
                self.webView?.isModalOpen = modal
            }
            if let rawRects = dict["noDragRects"] as? [[String: Any]] {
                var rects: [NSRect] = []
                for r in rawRects {
                    let x = (r["x"] as? Double) ?? Double((r["x"] as? Int) ?? 0)
                    let y = (r["y"] as? Double) ?? Double((r["y"] as? Int) ?? 0)
                    let w = (r["width"] as? Double) ?? Double((r["width"] as? Int) ?? 0)
                    let h = (r["height"] as? Double) ?? Double((r["height"] as? Int) ?? 0)
                    if w > 0 && h > 0 {
                        rects.append(NSRect(x: x, y: y, width: w, height: h))
                    }
                }
                self.webView?.noDragRects = rects
            }
            replyHandler(["ok": true], nil)

        case "isFullScreen":
            let isFs = self.view.window?.styleMask.contains(.fullScreen) ?? false
            replyHandler(isFs, nil)

        case "themeChanged":
            let isDark = (dict["isDark"] as? Bool) ?? true
            if let win = self.view.window {
                win.appearance = NSAppearance(named: isDark ? .darkAqua : .aqua)
                win.backgroundColor = isDark
                    ? NSColor(calibratedRed: 0.035, green: 0.035, blue: 0.043, alpha: 1.0)
                    : NSColor(calibratedRed: 0.98, green: 0.98, blue: 0.98, alpha: 1.0)
            }
            replyHandler(["ok": true], nil)

        case "selectDirectory":
            let prompt = (dict["prompt"] as? String) ?? "Select Folder"
            let selected = VolumeAndSyncService.shared.pickFolder(prompt: prompt)
            replyHandler(selected as Any, nil)

        case "downloadArtwork":
            let baseName = (dict["baseName"] as? String) ?? ""
            handleSaveArtworkDialog(rawBaseName: baseName)
            replyHandler(["ok": true], nil)

        case "sseSubscribe":
            let channel = (dict["channel"] as? String) ?? ""
            let replay = (dict["replay"] as? Bool) ?? false
            if channel == "import" && (replay || LibraryService.shared.getIngestState().isIngesting) {
                let recent = LibraryService.shared.getRecentIngestEvents()
                for evt in recent {
                    SSEEventBus.shared.emit(channel: "import", payload: evt)
                }
            }
            replyHandler(["ok": true], nil)

        case "apiRequest":
            let method = ((dict["method"] as? String) ?? "GET").uppercased()
            let path = (dict["path"] as? String) ?? "/"
            let query = (dict["query"] as? [String: String]) ?? [:]
            let body = dict["body"] as? [String: Any]

            if path == "/api/pick-folder" {
                let prompt = (body?["prompt"] as? String) ?? "Select Folder"
                if let selected = VolumeAndSyncService.shared.pickFolder(prompt: prompt) {
                    replyHandler(["status": 200, "body": ["path": selected]], nil)
                } else {
                    replyHandler(["status": 200, "body": ["cancelled": true]], nil)
                }
                return
            }

            apiQueue.async { [weak self] in
                guard let self = self else { return }
                let response = self.handleApiRequest(method: method, path: path, query: query, body: body)
                DispatchQueue.main.async {
                    replyHandler(response, nil)
                }
            }

        default:
            replyHandler(nil, "Unknown message type: \(type)")
        }
    }

    @MainActor
    private func handleSaveArtworkDialog(rawBaseName: String) {
        guard let art = ArtworkAndTagService.shared.getEmbeddedArtworkForBaseName(rawBaseName) else {
            return
        }
        let ext = art.mimeType.contains("png") ? "png" : "jpg"
        let panel = NSSavePanel()
        panel.title = "Save Cover Artwork"
        panel.nameFieldStringValue = "\(art.baseName).\(ext)"
        panel.canCreateDirectories = true
        if panel.runModal() == .OK, let url = panel.url {
            try? art.data.write(to: url, options: .atomic)
        }
    }

    // MARK: - Native Swift Router (Replacing server/index.js)
    private func handleApiRequest(
        method: String,
        path: String,
        query: [String: String],
        body: [String: Any]?
    ) -> [String: Any] {
        let lib = LibraryService.shared
        let plService = PlaylistService.shared
        let artService = ArtworkAndTagService.shared
        let volService = VolumeAndSyncService.shared

        do {
            // 1. /api/config
            if path == "/api/config" {
                if method == "GET" {
                    lib.syncVaultOnDisk()
                    return ["status": 200, "body": lib.getConfigDictionary()]
                } else if method == "POST" {
                    let updated = lib.updateConfig(body ?? [:])
                    lib.syncVaultOnDisk(force: true)
                    plService.syncAllPlaylistsM3u()
                    return ["status": 200, "body": updated]
                }
            }

            // 2. /api/settings/target
            if path == "/api/settings/target" && method == "POST" {
                let rawTarget = (body?["targetPath"] as? String) ?? (body?["sdCardPath"] as? String) ?? (body?["volumePath"] as? String) ?? ""
                if rawTarget.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    return ["status": 400, "body": ["error": "Target path is required."]]
                }
                let cleanTarget = LibraryService.expandTilde(rawTarget)
                let safety = volService.isSafeExternalVolume(cleanTarget)
                if !safety.safe {
                    return ["status": 400, "body": ["error": safety.reason ?? "Unsafe target volume"]]
                }
                let cfg = lib.updateConfig(["sdCardPath": cleanTarget])
                return ["status": 200, "body": ["success": true, "targetPath": cleanTarget, "config": cfg]]
            }

            // 3. /api/volumes
            if path == "/api/volumes" && method == "GET" {
                return ["status": 200, "body": ["volumes": volService.listMountedVolumes()]]
            }

            // 4. /api/tracks
            if path == "/api/tracks" && method == "GET" {
                lib.syncVaultOnDisk()
                let search = query["search"] ?? ""
                let tracks = lib.getTracks(search: search).map { $0.toDictionary() }
                return ["status": 200, "body": ["total": tracks.count, "tracks": tracks]]
            }

            // 5. /api/playlists
            if path == "/api/playlists" {
                if method == "GET" {
                    return ["status": 200, "body": plService.listPlaylistsDictionary()]
                } else if method == "POST" {
                    let pl = try plService.createPlaylist(rawName: body?["name"] as? String)
                    var res = plService.listPlaylistsDictionary()
                    res["playlist"] = pl.toDictionary()
                    return ["status": 201, "body": res]
                }
            }

            if path.hasPrefix("/api/playlists/") {
                let rest = String(path.dropFirst("/api/playlists/".count))
                let parts = rest.split(separator: "/", omittingEmptySubsequences: true).map { String($0).removingPercentEncoding ?? String($0) }

                if parts.count == 1 {
                    let plId = parts[0]
                    if method == "PUT" {
                        let pl = try plService.renamePlaylist(id: plId, rawNewName: body?["name"] as? String)
                        var res = plService.listPlaylistsDictionary()
                        res["playlist"] = pl.toDictionary()
                        return ["status": 200, "body": res]
                    } else if method == "DELETE" {
                        let res = try plService.deletePlaylist(id: plId)
                        return ["status": 200, "body": res]
                    }
                } else if parts.count == 2 {
                    let plId = parts[0]
                    let action = parts[1]
                    if action == "duplicate" && method == "POST" {
                        let pl = try plService.duplicatePlaylist(id: plId)
                        var res = plService.listPlaylistsDictionary()
                        res["playlist"] = pl.toDictionary()
                        return ["status": 201, "body": res]
                    } else if action == "tracks" && method == "POST" {
                        let trackKey = (body?["trackKey"] as? String) ?? ""
                        let res = try plService.addTrackToPlaylist(id: plId, trackKey: trackKey)
                        return ["status": 200, "body": res]
                    } else if action == "reorder" && method == "PUT" {
                        let trackKeys = body?["trackKeys"] as? [String]
                        let fromIndex = body?["fromIndex"] as? Int
                        let toIndex = body?["toIndex"] as? Int
                        let pl = try plService.reorderPlaylistTracks(id: plId, trackKeys: trackKeys, fromIndex: fromIndex, toIndex: toIndex)
                        var res = plService.listPlaylistsDictionary()
                        res["playlist"] = pl.toDictionary()
                        return ["status": 200, "body": res]
                    } else if action == "move" && method == "PATCH" {
                        let trackKey = (body?["trackKey"] as? String) ?? ""
                        let direction = (body?["direction"] as? String) ?? ""
                        let pl = try plService.movePlaylistTrack(id: plId, trackKey: trackKey, direction: direction)
                        var res = plService.listPlaylistsDictionary()
                        res["playlist"] = pl.toDictionary()
                        return ["status": 200, "body": res]
                    }
                } else if parts.count >= 3 && parts[1] == "tracks" && method == "DELETE" {
                    let plId = parts[0]
                    let trackKey = parts.dropFirst(2).joined(separator: "/")
                    let res = try plService.removeTrackFromPlaylist(id: plId, trackKey: trackKey)
                    return ["status": 200, "body": res]
                }
            }

            // 6. /api/artwork/*
            if path == "/api/artwork/backfill" {
                if artService.getIsFetchingArtwork() {
                    return ["status": 409, "body": ["error": "Artwork lookup is already in progress."]]
                }
                let playlistId = (body?["playlistId"] as? String) ?? query["playlistId"]
                let trackKeys = body?["trackKeys"] as? [String]
                Task.detached {
                    _ = try? await ArtworkAndTagService.shared.runArtworkBackfill(playlistId: playlistId, trackKeys: trackKeys)
                }
                return [
                    "status": 202,
                    "body": [
                        "started": true,
                        "playlistId": playlistId as Any,
                        "message": "Artwork lookup started. Streaming on /api/artwork/progress."
                    ]
                ]
            }

            if path == "/api/artwork/stop" && method == "POST" {
                return ["status": 200, "body": artService.stopArtworkBackfill()]
            }

            if path.hasPrefix("/api/artwork/") {
                var sub = String(path.dropFirst("/api/artwork/".count))
                var isDeleteRoute = (method == "DELETE")
                if sub.hasSuffix("/delete") && method == "POST" {
                    sub = String(sub.dropLast("/delete".count))
                    isDeleteRoute = true
                }
                let rawBaseName = sub.removingPercentEncoding ?? sub

                if isDeleteRoute {
                    let applyToAlbum = (body?["applyToAlbum"] as? Bool) == true || (body?["applyToAlbum"] as? String) == "true" || query["applyToAlbum"] == "true"
                    let includeDisc = (body?["includeDisc"] as? Bool) == true || (body?["includeDisc"] as? String) == "true" || query["includeDisc"] == "true"
                    let scope = (body?["scope"] as? String) ?? query["scope"] ?? ""
                    let trackKey = (body?["trackKey"] as? String) ?? query["trackKey"] ?? ""
                    let artist = (body?["artist"] as? String) ?? query["artist"] ?? ""
                    let album = (body?["album"] as? String) ?? query["album"] ?? ""

                    let res = try artService.deleteManualArtwork(
                        rawBaseName: rawBaseName,
                        trackKey: trackKey,
                        scope: scope,
                        applyToAlbum: applyToAlbum,
                        includeDisc: includeDisc,
                        artist: artist,
                        album: album
                    )
                    lib.syncVaultOnDisk(force: true)
                    return ["status": 200, "body": res]
                } else if method == "POST" {
                    let base64Str = (body?["imageBase64"] as? String) ?? ""
                    guard let imgData = Data(base64Encoded: base64Str), !imgData.isEmpty else {
                        return ["status": 400, "body": ["error": "No image payload provided."]]
                    }
                    let mimeType = (body?["mimeType"] as? String) ?? "image/jpeg"
                    let trackKey = (body?["trackKey"] as? String) ?? query["trackKey"] ?? ""
                    let scope = (body?["scope"] as? String) ?? "single"
                    let applyToAlbum = (body?["applyToAlbum"] as? Bool) == true || (body?["applyToAlbum"] as? String) == "true"
                    let includeDisc = (body?["includeDisc"] as? Bool) == true || (body?["includeDisc"] as? String) == "true"
                    let artist = (body?["artist"] as? String) ?? ""
                    let album = (body?["album"] as? String) ?? ""

                    let res = try artService.saveManualArtwork(
                        rawBaseName: rawBaseName,
                        rawImageData: imgData,
                        mimeType: mimeType,
                        trackKey: trackKey,
                        scope: scope,
                        applyToAlbum: applyToAlbum,
                        includeDisc: includeDisc,
                        artist: artist,
                        album: album
                    )
                    lib.syncVaultOnDisk(force: true)
                    return ["status": 200, "body": res]
                }
            }

            // 7. /api/import
            if path == "/api/import" && method == "POST" {
                if lib.getIngestState().isIngesting {
                    return ["status": 409, "body": ["error": "Ingestion is already in progress."]]
                }
                if let body = body, body["sourcePath"] != nil || body["vaultPath"] != nil {
                    lib.updateConfig(body)
                }
                Task.detached {
                    _ = try? await LibraryService.shared.runIngestionPipeline()
                }
                return [
                    "status": 202,
                    "body": [
                        "started": true,
                        "message": "Ingestion pipeline started. Listening on /api/import/progress."
                    ]
                ]
            }

            // 7b. /api/ftp/services & /api/ftp/test
            if path == "/api/ftp/services" && method == "GET" {
                return ["status": 200, "body": ["services": BonjourFtpBrowser.shared.listServicesDicts()]]
            }

            if path == "/api/ftp/test" && method == "POST" {
                let svcName = body?["ftpServiceName"] as? String
                let mHost = body?["ftpManualHost"] as? String
                let mPort: Int? = (body?["ftpManualPort"] as? Int) ?? (body?["ftpManualPort"] as? String).flatMap(Int.init)
                let user = body?["ftpUsername"] as? String
                let pass = body?["ftpPassword"] as? String
                let rPath = body?["ftpRemotePath"] as? String
                let res = try volService.testFtpConnection(
                    serviceName: svcName,
                    manualHost: mHost,
                    manualPort: mPort,
                    username: user,
                    password: pass,
                    remotePath: rPath
                )
                return ["status": 200, "body": res]
            }

            if path == "/api/ftp/list" && method == "POST" {
                let reqPath = (body?["path"] as? String) ?? "/"
                let svcName = body?["ftpServiceName"] as? String
                let mHost = body?["ftpManualHost"] as? String
                let mPort: Int? = (body?["ftpManualPort"] as? Int) ?? (body?["ftpManualPort"] as? String).flatMap(Int.init)
                let user = body?["ftpUsername"] as? String
                let pass = body?["ftpPassword"] as? String
                let res = try volService.ftpListDirectory(
                    path: reqPath,
                    serviceName: svcName,
                    manualHost: mHost,
                    manualPort: mPort,
                    username: user,
                    password: pass
                )
                return ["status": 200, "body": res]
            }

            if path == "/api/ftp/verify-writable" && method == "POST" {
                let reqPath = (body?["path"] as? String) ?? "/"
                let svcName = body?["ftpServiceName"] as? String
                let mHost = body?["ftpManualHost"] as? String
                let mPort: Int? = (body?["ftpManualPort"] as? Int) ?? (body?["ftpManualPort"] as? String).flatMap(Int.init)
                let user = body?["ftpUsername"] as? String
                let pass = body?["ftpPassword"] as? String
                let res = volService.ftpVerifyWritable(
                    path: reqPath,
                    serviceName: svcName,
                    manualHost: mHost,
                    manualPort: mPort,
                    username: user,
                    password: pass
                )
                return ["status": 200, "body": res]
            }

            // 8. /api/sync, /api/sync/status, /api/sync/cancel
            if path == "/api/sync/status" && method == "GET" {
                return ["status": 200, "body": volService.getSyncStatus()]
            }

            if (path == "/api/sync/cancel" || path == "/api/sync/stop") && method == "POST" {
                return ["status": 200, "body": volService.cancelSync()]
            }

            if path == "/api/sync" && method == "POST" {
                if volService.getIsSyncing() {
                    return ["status": 409, "body": ["error": "Sync is already running."]]
                }
                let mode = (body?["syncTargetMode"] as? String) ?? lib.config.syncTargetMode
                if mode == "ftp" {
                    Task.detached {
                        try? await VolumeAndSyncService.shared.runFtpSync()
                    }
                    return [
                        "status": 202,
                        "body": [
                            "started": true,
                            "mode": "ftp",
                            "message": "Wi-Fi FTP sync started."
                        ]
                    ]
                }

                let volumePath = (body?["volumePath"] as? String) ?? lib.config.sdCardPath
                if volumePath.isEmpty {
                    return ["status": 400, "body": ["error": "Please select a target SD card volume first."]]
                }
                lib.updateConfig(["sdCardPath": volumePath])
                let targetMusicDir = volService.resolveTargetMusicDir(volumePath)
                Task.detached {
                    try? await VolumeAndSyncService.shared.runRsyncToSdCard(requestedVolumePath: volumePath)
                }
                return [
                    "status": 202,
                    "body": [
                        "started": true,
                        "mode": "sd",
                        "volumePath": volumePath,
                        "targetPath": targetMusicDir,
                        "message": "Rsync started targeting \(targetMusicDir)."
                    ]
                ]
            }

            // 9. /api/eject
            if path == "/api/eject" && method == "POST" {
                if lib.config.syncTargetMode == "ftp" {
                    return ["status": 400, "body": ["error": "Not applicable for Wi-Fi FTP target."]]
                }
                let volumePath = (body?["volumePath"] as? String) ?? lib.config.sdCardPath
                if volumePath.isEmpty {
                    return ["status": 400, "body": ["error": "No volume specified to eject."]]
                }
                let res = try volService.ejectVolume(volumePath)
                return ["status": 200, "body": res]
            }

            return ["status": 404, "body": ["error": "Endpoint not found: \(method) \(path)"]]
        } catch {
            let nsErr = error as NSError
            let code = (400...599).contains(nsErr.code) ? nsErr.code : 400
            return ["status": code, "body": ["error": error.localizedDescription]]
        }
    }

    // MARK: - WKUIDelegate (Native File Open Panel for <input type="file">)
    public func webView(
        _ webView: WKWebView,
        runOpenPanelWith parameters: WKOpenPanelParameters,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping ([URL]?) -> Void
    ) {
        let panel = NSOpenPanel()
        panel.canChooseFiles = true
        panel.canChooseDirectories = parameters.allowsDirectories
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        if !parameters.allowsDirectories {
            panel.allowedContentTypes = [.jpeg, .png, .webP, .image]
        }

        let handleResponse: (NSApplication.ModalResponse) -> Void = { response in
            if response == .OK {
                completionHandler(panel.urls)
            } else {
                completionHandler(nil)
            }
        }

        if let window = webView.window ?? self.view.window {
            panel.beginSheetModal(for: window, completionHandler: handleResponse)
        } else {
            panel.begin(completionHandler: handleResponse)
        }
    }

    // MARK: - Injected JavaScript Bridge & Shims
    private static let injectedBridgeJavaScript = #"""
    (function() {
      const bridge = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.avBridge;
      if (!bridge) return;

      // 1. Fullscreen & electronAPI compatibility layer
      const fsListeners = new Set();
      window.__avNotifyFullScreen = function(isFs) {
        for (const cb of fsListeners) {
          try { cb(Boolean(isFs)); } catch (_) {}
        }
      };

      window.electronAPI = {
        isElectron: true,
        apiBaseUrl: 'av://localhost',
        selectDirectory: () => bridge.postMessage({ type: 'selectDirectory' }),
        isFullScreen: () => bridge.postMessage({ type: 'isFullScreen' }),
        onFullScreenChange: (cb) => {
          fsListeners.add(cb);
          return () => fsListeners.delete(cb);
        }
      };

      // 2. Window dragging support for WebkitAppRegion: 'drag' & native AppKit hit-testing sync
      function syncHeaderDragRegions() {
        const header = document.querySelector('header[data-window-drag], header');
        if (!header) return;
        const hRect = header.getBoundingClientRect();
        const headerHeight = Math.max(0, Math.round(hRect.bottom));
        const noDragEls = header.querySelectorAll('[data-no-drag], button, input, a, select, textarea, [role="switch"]');
        const noDragRects = [];
        for (const el of noDragEls) {
          const r = el.getBoundingClientRect();
          if (r.width > 0 && r.height > 0) {
            noDragRects.push({
              x: Math.round(r.left),
              y: Math.round(r.top),
              width: Math.round(r.width),
              height: Math.round(r.height)
            });
          }
        }
        const isModalOpen = Boolean(document.querySelector('.fixed.inset-0, [role="dialog"]'));
        bridge.postMessage({
          type: 'updateHeaderDragRegions',
          headerHeight,
          noDragRects,
          isModalOpen
        });
      }

      window.addEventListener('resize', syncHeaderDragRegions);
      document.addEventListener('DOMContentLoaded', () => {
        syncHeaderDragRegions();
        setTimeout(syncHeaderDragRegions, 150);
        setTimeout(syncHeaderDragRegions, 600);
        const dragObs = new MutationObserver(() => {
          syncHeaderDragRegions();
        });
        dragObs.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style'] });
      });

      window.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        if (e.target && e.target.closest && e.target.closest('button, input, a, select, textarea, [role="switch"], [data-no-drag]')) {
          return;
        }
        let el = e.target;
        let isDrag = false;
        while (el && el !== document.body) {
          const styleRegion = el.style && el.style.webkitAppRegion;
          if (styleRegion === 'no-drag' || (el.hasAttribute && el.hasAttribute('data-no-drag'))) return;
          const tag = (el.tagName || '').toLowerCase();
          if (tag === 'button' || tag === 'input' || tag === 'select' || tag === 'a' || tag === 'textarea') return;
          if (styleRegion === 'drag' || (el.hasAttribute && el.hasAttribute('data-window-drag'))) isDrag = true;
          el = el.parentElement;
        }
        if (isDrag) {
          bridge.postMessage({ type: 'windowDrag' });
        }
      }, true);

      // 3. Intercept <a download> for /api/artwork/:baseName/download
      window.addEventListener('click', (e) => {
        const a = e.target && e.target.closest ? e.target.closest('a[download]') : null;
        if (!a) return;
        const href = a.getAttribute('href') || '';
        const match = href.match(/\/api\/artwork\/([^/?#]+)\/download/);
        if (match) {
          e.preventDefault();
          e.stopPropagation();
          bridge.postMessage({ type: 'downloadArtwork', baseName: decodeURIComponent(match[1]) });
        }
      }, true);

      // 4. Synchronize macOS NSWindow appearance with Dark/Light mode class on <html>
      function syncTheme() {
        const isDark = document.documentElement.classList.contains('dark');
        bridge.postMessage({ type: 'themeChanged', isDark });
      }
      document.addEventListener('DOMContentLoaded', () => {
        syncTheme();
        const obs = new MutationObserver(syncTheme);
        obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
      });

      // 5. EventSource shim backed by Swift SSEEventBus
      const sseChannels = {
        import: new Set(),
        artwork: new Set(),
        sync: new Set()
      };

      window.__avDispatchSSE = function(channel, payload) {
        const set = sseChannels[channel];
        if (!set) return;
        const dataStr = JSON.stringify(payload);
        for (const es of set) {
          if (es.readyState === 1 && typeof es.onmessage === 'function') {
            try { es.onmessage({ data: dataStr }); } catch (_) {}
          }
        }
      };

      class NativeEventSource {
        constructor(url) {
          this.url = String(url || '');
          this.readyState = 1; // OPEN
          this.onmessage = null;
          this.onerror = null;
          this.onopen = null;

          let channel = 'import';
          if (this.url.includes('/api/artwork/')) channel = 'artwork';
          else if (this.url.includes('/api/sync/')) channel = 'sync';
          this._channel = channel;
          sseChannels[channel].add(this);

          const replay = this.url.includes('replay=1');
          setTimeout(() => {
            if (typeof this.onopen === 'function') this.onopen({});
            if (typeof this.onmessage === 'function') {
              this.onmessage({ data: JSON.stringify({ type: 'CONNECTED', message: 'Connected to native Swift stream' }) });
            }
            bridge.postMessage({ type: 'sseSubscribe', channel, replay });
          }, 10);
        }
        close() {
          this.readyState = 2;
          if (sseChannels[this._channel]) {
            sseChannels[this._channel].delete(this);
          }
        }
      }
      window.EventSource = NativeEventSource;

      // 6. Fetch shim routing /api/* JSON/FormData requests through Swift avBridge
      const origFetch = window.fetch.bind(window);

      function blobToBase64(blob) {
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => {
            const res = String(reader.result || '');
            const comma = res.indexOf(',');
            resolve(comma !== -1 ? res.slice(comma + 1) : res);
          };
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
      }

      window.fetch = async function(input, init = {}) {
        const rawUrl = typeof input === 'string' ? input : (input && input.url ? input.url : String(input));
        let parsed;
        try {
          parsed = new URL(rawUrl, 'av://localhost');
        } catch (_) {
          return origFetch(input, init);
        }

        const pathname = parsed.pathname || '/';
        const method = String(init.method || (input && input.method) || 'GET').toUpperCase();

        // Let GET binary media/image requests flow directly to VaultSchemeHandler
        if (method === 'GET' && (
          pathname.startsWith('/api/stream/') ||
          pathname.startsWith('/covers/') ||
          (pathname.startsWith('/api/artwork/') && pathname !== '/api/artwork/progress' && pathname !== '/api/artwork/backfill')
        )) {
          return origFetch(input, init);
        }

        if (!pathname.startsWith('/api/')) {
          return origFetch(input, init);
        }

        const query = {};
        parsed.searchParams.forEach((v, k) => { query[k] = v; });

        let bodyObj = null;
        const rawBody = init.body;
        if (rawBody instanceof FormData) {
          bodyObj = {};
          for (const [k, v] of rawBody.entries()) {
            if (v instanceof Blob) {
              bodyObj.imageBase64 = await blobToBase64(v);
              bodyObj.mimeType = v.type || 'image/jpeg';
            } else {
              bodyObj[k] = String(v);
            }
          }
        } else if (typeof rawBody === 'string' && rawBody.length > 0) {
          try { bodyObj = JSON.parse(rawBody); } catch (_) { bodyObj = { raw: rawBody }; }
        }

        const reply = await bridge.postMessage({
          type: 'apiRequest',
          method,
          path: pathname,
          query,
          body: bodyObj
        });

        const status = (reply && typeof reply.status === 'number') ? reply.status : 200;
        const respBody = (reply && reply.body !== undefined) ? reply.body : {};
        return new Response(JSON.stringify(respBody), {
          status,
          headers: { 'Content-Type': 'application/json' }
        });
      };
    })();
    """#
}
