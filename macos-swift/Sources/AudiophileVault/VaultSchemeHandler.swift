import Foundation
import WebKit

public final class VaultSchemeHandler: NSObject, WKURLSchemeHandler, @unchecked Sendable {
    private let lock = NSLock()
    private var activeTasks = Set<ObjectIdentifier>()
    private let ioQueue = DispatchQueue(label: "com.audiophilevault.scheme.io", qos: .userInitiated, attributes: .concurrent)

    private static let audioMimeTypes: [String: String] = [
        "mp3": "audio/mpeg",
        "flac": "audio/flac",
        "m4a": "audio/mp4",
        "alac": "audio/mp4",
        "mp4": "audio/mp4",
        "wav": "audio/wav",
        "wave": "audio/wav",
        "aiff": "audio/aiff",
        "aif": "audio/aiff",
        "aac": "audio/aac",
        "ogg": "audio/ogg",
        "oga": "audio/ogg",
        "opus": "audio/ogg"
    ]

    private static let staticMimeTypes: [String: String] = [
        "html": "text/html; charset=utf-8",
        "js": "application/javascript; charset=utf-8",
        "mjs": "application/javascript; charset=utf-8",
        "css": "text/css; charset=utf-8",
        "json": "application/json; charset=utf-8",
        "svg": "image/svg+xml",
        "png": "image/png",
        "jpg": "image/jpeg",
        "jpeg": "image/jpeg",
        "webp": "image/webp",
        "ico": "image/x-icon",
        "woff": "font/woff",
        "woff2": "font/woff2",
        "ttf": "font/ttf"
    ]

    private func markTaskActive(_ task: WKURLSchemeTask) {
        lock.lock()
        activeTasks.insert(ObjectIdentifier(task))
        lock.unlock()
    }

    private func isTaskActive(_ task: WKURLSchemeTask) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        return activeTasks.contains(ObjectIdentifier(task))
    }

    private func unmarkTask(_ task: WKURLSchemeTask) {
        lock.lock()
        activeTasks.remove(ObjectIdentifier(task))
        lock.unlock()
    }

    public func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        markTaskActive(urlSchemeTask)
        guard let url = urlSchemeTask.request.url else {
            finishWithError(urlSchemeTask, status: 400, message: "Invalid URL")
            return
        }

        let path = url.path.isEmpty ? "/index.html" : url.path
        let queryItems = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        let rangeHeader = urlSchemeTask.request.value(forHTTPHeaderField: "Range") ?? urlSchemeTask.request.value(forHTTPHeaderField: "range")

        ioQueue.async { [weak self] in
            guard let self = self, self.isTaskActive(urlSchemeTask) else { return }

            if path.hasPrefix("/api/stream/") {
                let rawName = String(path.dropFirst("/api/stream/".count)).removingPercentEncoding ?? ""
                self.handleAudioStream(task: urlSchemeTask, url: url, rawFilename: rawName, rangeHeader: rangeHeader)
                return
            }

            if path.hasPrefix("/covers/") {
                let rawName = String(path.dropFirst("/covers/".count)).removingPercentEncoding ?? ""
                self.handleArtworkFetch(task: urlSchemeTask, url: url, rawBaseName: rawName, trackKey: "", asDownload: false)
                return
            }

            if path.hasPrefix("/api/tracks/") && path.hasSuffix("/cover") {
                let middle = String(path.dropFirst("/api/tracks/".count).dropLast("/cover".count))
                let rawName = middle.removingPercentEncoding ?? middle
                self.handleArtworkFetch(task: urlSchemeTask, url: url, rawBaseName: rawName, trackKey: "", asDownload: false)
                return
            }

            if path.hasPrefix("/api/artwork/") && path != "/api/artwork/progress" && path != "/api/artwork/backfill" && path != "/api/artwork/stop" {
                var sub = String(path.dropFirst("/api/artwork/".count))
                var asDownload = false
                if sub.hasSuffix("/download") {
                    sub = String(sub.dropLast("/download".count))
                    asDownload = true
                }
                let rawName = sub.removingPercentEncoding ?? sub
                let trackKey = queryItems.first(where: { $0.name == "trackKey" })?.value ?? ""
                self.handleArtworkFetch(task: urlSchemeTask, url: url, rawBaseName: rawName, trackKey: trackKey, asDownload: asDownload)
                return
            }

            self.handleStaticFile(task: urlSchemeTask, url: url, requestPath: path)
        }
    }

    public func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {
        unmarkTask(urlSchemeTask)
    }

    // MARK: - Audio Byte-Range Streaming (HTTP 206 Partial Content)
    private func resolveAudioFileInVault(vaultDir: String, safeBasename: String) -> String? {
        let fm = FileManager.default
        let direct = (vaultDir as NSString).appendingPathComponent(safeBasename)
        if fm.fileExists(atPath: direct) {
            return direct
        }
        let targetNfc = safeBasename.precomposedStringWithCanonicalMapping.lowercased()
        if let entries = try? fm.contentsOfDirectory(atPath: vaultDir) {
            for entry in entries {
                if entry.precomposedStringWithCanonicalMapping.lowercased() == targetNfc {
                    return (vaultDir as NSString).appendingPathComponent(entry)
                }
            }
        }
        return nil
    }

    private func handleAudioStream(task: WKURLSchemeTask, url: URL, rawFilename: String, rangeHeader: String?) {
        let safeBasename = (rawFilename as NSString).lastPathComponent
        guard !safeBasename.isEmpty else {
            finishWithStatus(task, url: url, status: 400, headers: [:], body: Data())
            return
        }

        let vaultDir = LibraryService.shared.getVaultDir()
        guard let filePath = resolveAudioFileInVault(vaultDir: vaultDir, safeBasename: safeBasename),
              let attrs = try? FileManager.default.attributesOfItem(atPath: filePath),
              let fileSizeNum = attrs[.size] as? NSNumber else {
            finishWithStatus(task, url: url, status: 404, headers: [:], body: Data())
            return
        }

        let fileSize = fileSizeNum.int64Value
        let ext = (filePath as NSString).pathExtension.lowercased()
        let mimeType = Self.audioMimeTypes[ext] ?? "application/octet-stream"

        guard let handle = try? FileHandle(forReadingFrom: URL(fileURLWithPath: filePath)) else {
            finishWithStatus(task, url: url, status: 500, headers: [:], body: Data())
            return
        }
        defer { try? handle.close() }

        var startOffset: Int64 = 0
        var endOffset: Int64 = max(0, fileSize - 1)
        var statusCode = 200

        if let rangeStr = rangeHeader, rangeStr.lowercased().hasPrefix("bytes=") {
            let spec = String(rangeStr.dropFirst("bytes=".count))
            let parts = spec.split(separator: "-", omittingEmptySubsequences: false)
            if parts.count == 2 {
                let startStr = String(parts[0]).trimmingCharacters(in: .whitespaces)
                let endStr = String(parts[1]).trimmingCharacters(in: .whitespaces)
                if let s = Int64(startStr) { startOffset = s }
                if let e = Int64(endStr), e < fileSize { endOffset = e }
                statusCode = 206
            }
        }

        if startOffset > endOffset || startOffset >= fileSize {
            finishWithStatus(task, url: url, status: 416, headers: [
                "Content-Range": "bytes */\(fileSize)"
            ], body: Data())
            return
        }

        let chunkSize = endOffset - startOffset + 1
        var headers: [String: String] = [
            "Content-Type": mimeType,
            "Accept-Ranges": "bytes",
            "Content-Length": "\(chunkSize)",
            "Cache-Control": "no-cache",
            "Access-Control-Allow-Origin": "*"
        ]
        if statusCode == 206 {
            headers["Content-Range"] = "bytes \(startOffset)-\(endOffset)/\(fileSize)"
        }

        guard isTaskActive(task),
              let response = HTTPURLResponse(url: url, statusCode: statusCode, httpVersion: "HTTP/1.1", headerFields: headers) else {
            return
        }
        task.didReceive(response)

        try? handle.seek(toOffset: UInt64(startOffset))
        var remaining = Int(chunkSize)
        let bufferSize = 256 * 1024

        while remaining > 0 && isTaskActive(task) {
            let toRead = min(bufferSize, remaining)
            guard let data = try? handle.read(upToCount: toRead), !data.isEmpty else {
                break
            }
            if isTaskActive(task) {
                task.didReceive(data)
            }
            remaining -= data.count
        }

        if isTaskActive(task) {
            unmarkTask(task)
            task.didFinish()
        }
    }

    // MARK: - Artwork Serving
    private func handleArtworkFetch(task: WKURLSchemeTask, url: URL, rawBaseName: String, trackKey: String, asDownload: Bool) {
        guard let art = ArtworkAndTagService.shared.getEmbeddedArtworkForBaseName(rawBaseName, trackKey: trackKey) else {
            finishWithStatus(task, url: url, status: 404, headers: ["Access-Control-Allow-Origin": "*"], body: Data())
            return
        }
        var headers: [String: String] = [
            "Content-Type": art.mimeType,
            "Content-Length": "\(art.data.count)",
            "Cache-Control": "public, max-age=86400, immutable",
            "Access-Control-Allow-Origin": "*"
        ]
        if asDownload {
            let safeName = art.baseName.replacingOccurrences(of: "\"", with: "'")
            let ext = art.mimeType.contains("png") ? "png" : "jpg"
            headers["Content-Disposition"] = "attachment; filename=\"\(safeName).\(ext)\""
        }
        finishWithStatus(task, url: url, status: 200, headers: headers, body: art.data)
    }

    // MARK: - Static Asset Serving (client/dist)
    public static func resolveClientDistDirectory() -> String {
        let fm = FileManager.default
        if let resPath = Bundle.main.resourcePath {
            let bundledDist = (resPath as NSString).appendingPathComponent("client/dist")
            if fm.fileExists(atPath: (bundledDist as NSString).appendingPathComponent("index.html")) {
                return bundledDist
            }
            if fm.fileExists(atPath: (resPath as NSString).appendingPathComponent("index.html")) {
                return resPath
            }
        }
        let cwd = fm.currentDirectoryPath
        let candidates = [
            (cwd as NSString).appendingPathComponent("client/dist"),
            ((cwd as NSString).deletingLastPathComponent as NSString).appendingPathComponent("client/dist")
        ]
        for c in candidates {
            if fm.fileExists(atPath: (c as NSString).appendingPathComponent("index.html")) {
                return c
            }
        }
        return (cwd as NSString).appendingPathComponent("client/dist")
    }

    private func handleStaticFile(task: WKURLSchemeTask, url: URL, requestPath: String) {
        let distDir = Self.resolveClientDistDirectory()
        let cleanRel = requestPath.replacingOccurrences(of: #"^/+"#, with: "", options: .regularExpression)
        var targetPath = (distDir as NSString).appendingPathComponent(cleanRel.isEmpty ? "index.html" : cleanRel)

        let fm = FileManager.default
        var isDir: ObjCBool = false
        if !fm.fileExists(atPath: targetPath, isDirectory: &isDir) || isDir.boolValue {
            targetPath = (distDir as NSString).appendingPathComponent("index.html")
        }

        guard let data = try? Data(contentsOf: URL(fileURLWithPath: targetPath)) else {
            finishWithStatus(task, url: url, status: 404, headers: [:], body: Data("Not Found".utf8))
            return
        }

        let ext = (targetPath as NSString).pathExtension.lowercased()
        let mime = Self.staticMimeTypes[ext] ?? "application/octet-stream"
        finishWithStatus(task, url: url, status: 200, headers: [
            "Content-Type": mime,
            "Content-Length": "\(data.count)",
            "Access-Control-Allow-Origin": "*"
        ], body: data)
    }

    private func finishWithStatus(_ task: WKURLSchemeTask, url: URL, status: Int, headers: [String: String], body: Data) {
        guard isTaskActive(task) else { return }
        unmarkTask(task)
        if let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: headers) {
            task.didReceive(response)
        }
        if !body.isEmpty {
            task.didReceive(body)
        }
        task.didFinish()
    }

    private func finishWithError(_ task: WKURLSchemeTask, status: Int, message: String) {
        guard isTaskActive(task) else { return }
        unmarkTask(task)
        task.didFailWithError(NSError(domain: "VaultSchemeHandler", code: status, userInfo: [NSLocalizedDescriptionKey: message]))
    }
}
