import Foundation
import AppKit

public final class VolumeAndSyncService: @unchecked Sendable {
    public static let shared = VolumeAndSyncService()

    private static let volumesRoot = "/Volumes"
    private static let forbiddenVolumeNames: Set<String> = [
        "Macintosh HD",
        "Macintosh HD - Data",
        "Recovery",
        "Preboot",
        "VM",
        "Update",
        "com.apple.TimeMachine.localsnapshots"
    ]
    private static let protectedRootFolders: Set<String> = [
        "music",
        "system volume information",
        "$recycle.bin",
        ".spotlight-v100",
        ".fseventsd",
        ".trashes",
        ".temporaryitems",
        ".ds_store"
    ]
    private static let manifestFilename = ".av_snowflake_manifest.json"

    private let lock = NSLock()
    private var isSyncing = false
    private var activeProcess: Process? = nil

    private init() {}

    public func getIsSyncing() -> Bool {
        lock.lock()
        defer { lock.unlock() }
        return isSyncing
    }

    public func killActiveRsync() {
        lock.lock()
        let proc = activeProcess
        activeProcess = nil
        lock.unlock()
        if let proc = proc, proc.isRunning {
            proc.terminate()
        }
    }

    private func emitSyncEvent(type: String, message: String, extra: [String: Any] = [:]) {
        var payload: [String: Any] = [
            "timestamp": ISO8601DateFormatter().string(from: Date()),
            "type": type,
            "message": message
        ]
        for (k, v) in extra { payload[k] = v }
        SSEEventBus.shared.emit(channel: "sync", payload: payload)
    }

    // MARK: - Volume Safety & Capacity (Replaces /bin/df)
    public func isSafeExternalVolume(_ volumePath: String?) -> (safe: Bool, reason: String?, volumeName: String, resolvedVolumePath: String) {
        guard let volumePath = volumePath, !volumePath.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            return (false, "Volume path is empty.", "", "")
        }
        let resolved = (LibraryService.expandTilde(volumePath) as NSString).standardizingPath
        if resolved == "/" || !resolved.hasPrefix("/Volumes/") {
            return (false, "Target \"\(resolved)\" must reside under /Volumes/.", "", "")
        }
        let rel = String(resolved.dropFirst("/Volumes/".count))
        let comps = rel.split(separator: "/")
        guard let first = comps.first else {
            return (false, "Invalid volume name.", "", "")
        }
        let volumeName = String(first)
        if volumeName.isEmpty || volumeName == "." || volumeName == ".." {
            return (false, "Invalid volume name.", "", "")
        }
        if Self.forbiddenVolumeNames.contains(volumeName) {
            return (false, "\"\(volumeName)\" is a protected macOS system volume.", "", "")
        }

        let canonicalMount = "/Volumes/\(volumeName)"
        let fm = FileManager.default
        if let attrs = try? fm.attributesOfItem(atPath: canonicalMount),
           let fType = attrs[.type] as? FileAttributeType,
           fType == .typeSymbolicLink {
            if let dest = try? fm.destinationOfSymbolicLink(atPath: canonicalMount),
               (dest as NSString).standardizingPath == "/" {
                return (false, "\"\(volumeName)\" points to the root filesystem (/).", "", "")
            }
        }

        var isDir: ObjCBool = false
        if !fm.fileExists(atPath: canonicalMount, isDirectory: &isDir) || !isDir.boolValue {
            return (false, "Volume \"\(canonicalMount)\" is not currently mounted.", "", "")
        }

        return (true, nil, volumeName, canonicalMount)
    }

    public func resolveTargetMusicDir(_ volumePath: String) -> String {
        let cleaned = LibraryService.expandTilde(volumePath)
        if (cleaned as NSString).lastPathComponent.lowercased() == "music" {
            return cleaned
        }
        return (cleaned as NSString).appendingPathComponent("Music")
    }

    public func getDiskSpaceBytes(mountPath: String) -> (freeSpace: Int64, totalSpace: Int64) {
        let url = URL(fileURLWithPath: mountPath)
        let keys: Set<URLResourceKey> = [
            .volumeTotalCapacityKey,
            .volumeAvailableCapacityKey,
            .volumeAvailableCapacityForImportantUsageKey
        ]
        if let vals = try? url.resourceValues(forKeys: keys) {
            let total = Int64(vals.volumeTotalCapacity ?? 0)
            let avail = Int64(vals.volumeAvailableCapacity ?? 0)
            let availImp = vals.volumeAvailableCapacityForImportantUsage ?? 0
            let free = avail > 0 ? avail : availImp
            if total > 0 {
                return (free, total)
            }
        }
        if let fsAttrs = try? FileManager.default.attributesOfFileSystem(forPath: mountPath) {
            let total = (fsAttrs[.systemSize] as? NSNumber)?.int64Value ?? 0
            let free = (fsAttrs[.systemFreeSize] as? NSNumber)?.int64Value ?? 0
            return (free, total)
        }
        return (0, 0)
    }

    public func listMountedVolumes() -> [[String: Any]] {
        let fm = FileManager.default
        guard let entries = try? fm.contentsOfDirectory(atPath: Self.volumesRoot) else {
            return []
        }
        var volumes: [[String: Any]] = []
        for name in entries {
            if name.hasPrefix(".") || Self.forbiddenVolumeNames.contains(name) {
                continue
            }
            let fullPath = (Self.volumesRoot as NSString).appendingPathComponent(name)
            let check = isSafeExternalVolume(fullPath)
            if !check.safe { continue }
            if !fm.isReadableFile(atPath: fullPath) || !fm.isWritableFile(atPath: fullPath) {
                continue
            }
            let space = getDiskSpaceBytes(mountPath: fullPath)
            volumes.append([
                "name": name,
                "path": fullPath,
                "musicTargetPath": (fullPath as NSString).appendingPathComponent("Music"),
                "freeSpace": space.freeSpace,
                "totalSpace": space.totalSpace
            ])
        }
        return volumes
    }

    // MARK: - Native Eject (Replaces /usr/sbin/diskutil)
    public func ejectVolume(_ volumePath: String) throws -> [String: Any] {
        let check = isSafeExternalVolume(volumePath)
        if !check.safe {
            throw NSError(domain: "VolumeAndSyncService", code: 400, userInfo: [NSLocalizedDescriptionKey: "Cannot eject volume: \(check.reason ?? "Invalid volume")"])
        }
        let url = URL(fileURLWithPath: check.resolvedVolumePath)
        try NSWorkspace.shared.unmountAndEjectDevice(at: url)
        return [
            "success": true,
            "volume": check.volumeName,
            "path": check.resolvedVolumePath,
            "output": "Unmounted and ejected \(check.resolvedVolumePath)"
        ]
    }

    // MARK: - Native NSOpenPanel Folder Chooser (Replaces /usr/bin/osascript)
    @MainActor
    public func pickFolder(prompt: String = "Select Folder") -> String? {
        let panel = NSOpenPanel()
        panel.title = prompt
        panel.message = prompt
        panel.prompt = "Select"
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.canCreateDirectories = true
        panel.allowsMultipleSelection = false
        let response = panel.runModal()
        if response == .OK, let url = panel.url {
            return url.path
        }
        return nil
    }

    // MARK: - SNOWSKY Mode Playlist Folder Export
    private func isProtectedFolder(_ name: String) -> Bool {
        let lower = name.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if lower.isEmpty || lower == "." || lower == ".." || lower.contains("/") || lower.contains("\\") {
            return true
        }
        return Self.protectedRootFolders.contains(lower)
    }

    private func sanitizeFolderName(_ name: String, fallback: String = "Playlist") -> String {
        let sanitized = name.replacingOccurrences(of: #"[/\\:*?"<>|\x00-\x1f]"#, with: "", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: #"\.+$"#, with: "", options: .regularExpression)
        if sanitized.isEmpty { return fallback }
        if sanitized.lowercased() == "music" { return "Music (Playlist)" }
        return sanitized
    }

    private func syncPlaylistFolders(sdRoot: String, vaultDir: String, exportPlaylistFolders: Bool) {
        let fm = FileManager.default
        if sdRoot.isEmpty || !fm.fileExists(atPath: sdRoot) { return }
        let manifestPath = (sdRoot as NSString).appendingPathComponent(Self.manifestFilename)

        var previousFolders: [String] = []
        if fm.fileExists(atPath: manifestPath),
           let data = try? Data(contentsOf: URL(fileURLWithPath: manifestPath)),
           let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let folders = json["folders"] as? [String] {
            previousFolders = folders
        }

        if !exportPlaylistFolders {
            if !previousFolders.isEmpty {
                for folder in previousFolders {
                    if isProtectedFolder(folder) { continue }
                    let folderPath = (sdRoot as NSString).appendingPathComponent(folder)
                    var isDir: ObjCBool = false
                    if fm.fileExists(atPath: folderPath, isDirectory: &isDir), isDir.boolValue {
                        try? fm.removeItem(atPath: folderPath)
                        emitSyncEvent(type: "PLAYLIST", message: "[PLAYLIST FOLDER] Removed playlist folder (SNOWSKY disabled): /\(folder)/")
                    }
                }
                try? fm.removeItem(atPath: manifestPath)
                emitSyncEvent(type: "PLAYLIST", message: "[PLAYLIST FOLDER] Cleaned up SNOWSKY playlist folders from SD card.")
            }
            return
        }

        let playlists = PlaylistService.shared.listPlaylists().playlists
        let lib = LibraryService.shared
        var currentFolders: [String] = []
        var usedLower = Set<String>()

        for playlist in playlists {
            let rawName = playlist.name.isEmpty ? "Playlist" : playlist.name
            let folderName = sanitizeFolderName(rawName)
            var uniqueName = folderName
            var counter = 2
            while usedLower.contains(uniqueName.lowercased()) {
                uniqueName = "\(folderName)_\(counter)"
                counter += 1
            }
            usedLower.insert(uniqueName.lowercased())
            currentFolders.append(uniqueName)

            let playlistDir = (sdRoot as NSString).appendingPathComponent(uniqueName)
            try? fm.createDirectory(atPath: playlistDir, withIntermediateDirectories: true)

            let trackKeys = playlist.trackKeys
            emitSyncEvent(type: "PLAYLIST", message: "[PLAYLIST FOLDER] Syncing \"\(rawName)\" (\(trackKeys.count) tracks) -> /\(uniqueName)/")

            var expectedFilenames = Set<String>()
            var tracksToCopy: [(filename: String, srcPath: String, destPath: String)] = []
            let padLen = trackKeys.count >= 100 ? 3 : 2

            for (idx, key) in trackKeys.enumerated() {
                guard let track = lib.getTrackByKey(key), !track.filename.isEmpty else { continue }
                let prefix = String(format: "%0*d", padLen, idx + 1)
                let destFilename = "\(prefix) - \(track.filename)"
                expectedFilenames.insert(destFilename)
                tracksToCopy.append((
                    track.filename,
                    (vaultDir as NSString).appendingPathComponent(track.filename),
                    (playlistDir as NSString).appendingPathComponent(destFilename)
                ))
            }

            if let existing = try? fm.contentsOfDirectory(atPath: playlistDir) {
                for entry in existing {
                    if entry == ".DS_Store" || !expectedFilenames.contains(entry) {
                        try? fm.removeItem(atPath: (playlistDir as NSString).appendingPathComponent(entry))
                    }
                }
            }

            for item in tracksToCopy {
                let srcSize = ((try? fm.attributesOfItem(atPath: item.srcPath))?[.size] as? NSNumber)?.int64Value ?? -1
                let destSize = ((try? fm.attributesOfItem(atPath: item.destPath))?[.size] as? NSNumber)?.int64Value ?? -2
                if srcSize > 0 && srcSize == destSize {
                    continue
                }
                try? fm.removeItem(atPath: item.destPath)
                do {
                    try fm.copyItem(atPath: item.srcPath, toPath: item.destPath)
                } catch {
                    emitSyncEvent(type: "ERROR", message: "[PLAYLIST FOLDER ERROR] Failed to copy \"\(item.filename)\": \(error.localizedDescription)")
                }
            }
        }

        let currentLower = Set(currentFolders.map { $0.lowercased() })
        for prev in previousFolders where !currentLower.contains(prev.lowercased()) {
            if isProtectedFolder(prev) { continue }
            let stale = (sdRoot as NSString).appendingPathComponent(prev)
            var isDir: ObjCBool = false
            if fm.fileExists(atPath: stale, isDirectory: &isDir), isDir.boolValue {
                try? fm.removeItem(atPath: stale)
                emitSyncEvent(type: "PLAYLIST", message: "[PLAYLIST FOLDER] Removed orphaned playlist folder: /\(prev)/")
            }
        }

        let manifest: [String: Any] = [
            "version": 1,
            "generatedBy": "Audiophile Vault SNOWSKY Mode",
            "generatedAt": ISO8601DateFormatter().string(from: Date()),
            "folders": currentFolders
        ]
        if let data = try? JSONSerialization.data(withJSONObject: manifest, options: [.prettyPrinted]) {
            try? data.write(to: URL(fileURLWithPath: manifestPath), options: .atomic)
        }
    }

    // MARK: - Incremental Sync via /usr/bin/rsync
    public func runRsyncToSdCard(requestedVolumePath: String? = nil) async throws {
        try lock.withLock {
            if isSyncing {
                throw NSError(domain: "VolumeAndSyncService", code: 409, userInfo: [NSLocalizedDescriptionKey: "An rsync operation is already in progress."])
            }
            isSyncing = true
        }

        defer {
            lock.withLock {
                activeProcess = nil
                isSyncing = false
            }
        }

        let lib = LibraryService.shared
        let vaultDir = lib.getVaultDir()
        let volumePath = (requestedVolumePath?.isEmpty == false) ? requestedVolumePath! : lib.config.sdCardPath
        if volumePath.isEmpty {
            throw NSError(domain: "VolumeAndSyncService", code: 400, userInfo: [NSLocalizedDescriptionKey: "No target SD card or external volume selected."])
        }

        let safety = isSafeExternalVolume(volumePath)
        if !safety.safe {
            throw NSError(domain: "VolumeAndSyncService", code: 400, userInfo: [NSLocalizedDescriptionKey: "Unsafe target volume blocked: \(safety.reason ?? "Unsafe path")"])
        }

        let resolvedTarget = resolveTargetMusicDir(volumePath)
        let targetMusicDir = resolvedTarget.hasSuffix("/") ? resolvedTarget : "\(resolvedTarget)/"
        let normalizedVaultDir = vaultDir.hasSuffix("/") ? vaultDir : "\(vaultDir)/"

        try? FileManager.default.createDirectory(atPath: normalizedVaultDir, withIntermediateDirectories: true)
        try? FileManager.default.createDirectory(atPath: targetMusicDir, withIntermediateDirectories: true)

        PlaylistService.shared.syncAllPlaylistsM3u()

        let rsyncArgs = [
            "-avu",
            "--delete",
            "--modify-window=1",
            "--exclude=.vault_index.json",
            "--exclude=.DS_Store",
            normalizedVaultDir,
            targetMusicDir
        ]

        emitSyncEvent(type: "RSYNC", message: "[SYNC] Syncing vault to SD Card: \(targetMusicDir)")
        emitSyncEvent(type: "RSYNC", message: "[RSYNC] Synchronizing audio tracks & .m3u playlists to \"\(targetMusicDir)\"")

        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            let proc = Process()
            proc.executableURL = URL(fileURLWithPath: "/usr/bin/rsync")
            proc.arguments = rsyncArgs
            var env = ProcessInfo.processInfo.environment
            env["PATH"] = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
            env["COPYFILE_DISABLE"] = "1"
            proc.environment = env

            let outPipe = Pipe()
            let errPipe = Pipe()
            proc.standardOutput = outPipe
            proc.standardError = errPipe

            outPipe.fileHandleForReading.readabilityHandler = { [weak self] handle in
                let data = handle.availableData
                guard !data.isEmpty, let str = String(data: data, encoding: .utf8) else { return }
                for line in str.components(separatedBy: .newlines) {
                    let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
                    if !trimmed.isEmpty {
                        self?.emitSyncEvent(type: "RSYNC", message: "[RSYNC] \(trimmed)")
                    }
                }
            }

            errPipe.fileHandleForReading.readabilityHandler = { [weak self] handle in
                let data = handle.availableData
                guard !data.isEmpty, let str = String(data: data, encoding: .utf8) else { return }
                for line in str.components(separatedBy: .newlines) {
                    let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
                    if !trimmed.isEmpty {
                        self?.emitSyncEvent(type: "ERROR", message: "[RSYNC STDERR] \(trimmed)")
                    }
                }
            }

            proc.terminationHandler = { [weak self] p in
                outPipe.fileHandleForReading.readabilityHandler = nil
                errPipe.fileHandleForReading.readabilityHandler = nil
                if p.terminationStatus == 0 {
                    continuation.resume()
                } else {
                    let msg = "[ERROR] rsync exited with code \(p.terminationStatus)"
                    self?.emitSyncEvent(type: "ERROR", message: msg)
                    continuation.resume(throwing: NSError(domain: "VolumeAndSyncService", code: Int(p.terminationStatus), userInfo: [NSLocalizedDescriptionKey: msg]))
                }
            }

            self.lock.lock()
            self.activeProcess = proc
            self.lock.unlock()

            do {
                try proc.run()
            } catch {
                self.emitSyncEvent(type: "ERROR", message: "[ERROR] Failed to spawn /usr/bin/rsync: \(error.localizedDescription)")
                continuation.resume(throwing: error)
            }
        }

        let trimmedMusic = targetMusicDir.replacingOccurrences(of: #"/+$"#, with: "", options: .regularExpression)
        let sdRoot = (trimmedMusic as NSString).deletingLastPathComponent
        syncPlaylistFolders(
            sdRoot: sdRoot,
            vaultDir: normalizedVaultDir,
            exportPlaylistFolders: lib.config.exportPlaylistFolders
        )

        emitSyncEvent(type: "DONE", message: "[DONE] Sync to \"\(targetMusicDir)\" finished cleanly (exit code 0).")
    }
}
