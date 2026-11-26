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

    public struct SyncState: Sendable {
        public var isSyncing: Bool = false
        public var isCanceling: Bool = false
        public var mode: String = "sd"
        public var phase: String = "idle"
        public var currentFile: String? = nil
        public var processedCount: Int = 0
        public var totalCount: Int = 0
        public var startedAt: Date? = nil

        public func toDictionary() -> [String: Any] {
            var dict: [String: Any] = [
                "isSyncing": isSyncing,
                "isCanceling": isCanceling,
                "mode": mode,
                "phase": phase,
                "processedCount": processedCount,
                "totalCount": totalCount
            ]
            if let currentFile = currentFile {
                dict["currentFile"] = currentFile
            } else {
                dict["currentFile"] = NSNull()
            }
            if let startedAt = startedAt {
                dict["startedAt"] = ISO8601DateFormatter().string(from: startedAt)
            } else {
                dict["startedAt"] = NSNull()
            }
            return dict
        }
    }

    private let lock = NSLock()
    private var syncState = SyncState()
    private var isCancelRequested = false
    private var activeProcess: Process? = nil
    private var onSyncStateChanged: (([String: Any]) -> Void)? = nil

    private init() {}

    public func setOnSyncStateChanged(_ handler: @escaping ([String: Any]) -> Void) {
        lock.lock()
        onSyncStateChanged = handler
        lock.unlock()
    }

    public func getIsSyncing() -> Bool {
        lock.lock()
        defer { lock.unlock() }
        return syncState.isSyncing
    }

    public func getSyncStatus() -> [String: Any] {
        lock.lock()
        let dict = syncState.toDictionary()
        lock.unlock()
        return dict
    }

    private func getIsCancelRequested() -> Bool {
        lock.lock()
        defer { lock.unlock() }
        return isCancelRequested
    }

    private func broadcastSyncState() {
        lock.lock()
        let handler = onSyncStateChanged
        let dict = syncState.toDictionary()
        lock.unlock()
        handler?(dict)
    }

    private func updateSyncState(_ mutate: (inout SyncState) -> Void) {
        lock.lock()
        mutate(&syncState)
        let handler = onSyncStateChanged
        let dict = syncState.toDictionary()
        lock.unlock()
        handler?(dict)
    }

    @discardableResult
    public func cancelSync() -> [String: Any] {
        lock.lock()
        guard syncState.isSyncing else {
            let dict = syncState.toDictionary()
            lock.unlock()
            return ["stopped": false, "state": dict]
        }
        isCancelRequested = true
        syncState.isCanceling = true
        syncState.phase = "canceling"
        let proc = activeProcess
        let handler = onSyncStateChanged
        let dict = syncState.toDictionary()
        lock.unlock()

        emitSyncEvent(type: "SKIPPED", message: "[SYNC] Cancellation requested — stopping active transfer...")
        handler?(dict)

        if let proc = proc, proc.isRunning {
            proc.terminate()
        }
        return ["stopped": true, "state": dict]
    }

    public func killActiveRsync() {
        _ = cancelSync()
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

    // MARK: - SNOWSKY Mode Folder Export & Shared Plan
    private func isProtectedFolder(_ name: String) -> Bool {
        let lower = name.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if lower.isEmpty || lower == "." || lower == ".." || lower.contains("/") || lower.contains("\\") {
            return true
        }
        return Self.protectedRootFolders.contains(lower)
    }

    private func sanitizeSnowskyFolderName(_ name: String, fallback: String = "Playlist") -> String {
        let sanitized = name.replacingOccurrences(of: #"[/\\:*?"<>|\x00-\x1f]"#, with: "", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: #"\.+$"#, with: "", options: .regularExpression)
        if sanitized.isEmpty { return fallback }
        let lower = sanitized.lowercased()
        if lower == "music" || lower == "library" {
            return "\(sanitized) (Playlist)"
        }
        return sanitized
    }

    private struct SnowskyTrackItem {
        let filename: String
        let srcPath: String
        let size: Int64
        let mtime: TimeInterval
    }

    private struct SnowskyPlaylistPlan {
        let rawName: String
        let folderName: String
        let tracks: [SnowskyTrackItem]
    }

    private struct SnowskySyncPlan {
        let libraryTracks: [SnowskyTrackItem]
        let playlists: [SnowskyPlaylistPlan]
        var totalOperations: Int {
            libraryTracks.count + playlists.reduce(0) { $0 + $1.tracks.count }
        }
    }

    private func buildSnowskyPlan(vaultDir: String) -> SnowskySyncPlan {
        let fm = FileManager.default
        let names = (try? fm.contentsOfDirectory(atPath: vaultDir)) ?? []
        var libraryTracks: [SnowskyTrackItem] = []

        for name in names.sorted() {
            if name.hasPrefix(".") || name == ".vault_index.json" { continue }
            let fullPath = (vaultDir as NSString).appendingPathComponent(name)
            var isDir: ObjCBool = false
            guard fm.fileExists(atPath: fullPath, isDirectory: &isDir), !isDir.boolValue else { continue }
            let ext = "." + (name as NSString).pathExtension.lowercased()
            guard LibraryService.supportedExtensions.contains(ext) else { continue }
            let attrs = try? fm.attributesOfItem(atPath: fullPath)
            let size = (attrs?[.size] as? NSNumber)?.int64Value ?? 0
            let mtime = (attrs?[.modificationDate] as? Date)?.timeIntervalSince1970 ?? 0
            libraryTracks.append(SnowskyTrackItem(filename: name, srcPath: fullPath, size: size, mtime: mtime))
        }

        let playlists = PlaylistService.shared.listPlaylists().playlists
        let lib = LibraryService.shared
        var playlistPlans: [SnowskyPlaylistPlan] = []
        var usedLower = Set<String>(["library"])

        for playlist in playlists {
            let rawName = playlist.name.isEmpty ? "Playlist" : playlist.name
            let baseFolder = sanitizeSnowskyFolderName(rawName)
            var uniqueName = baseFolder
            var counter = 2
            while usedLower.contains(uniqueName.lowercased()) {
                uniqueName = "\(baseFolder)_\(counter)"
                counter += 1
            }
            usedLower.insert(uniqueName.lowercased())

            var items: [SnowskyTrackItem] = []
            var seenFilenames = Set<String>()
            for key in playlist.trackKeys {
                guard let track = lib.getTrackByKey(key), !track.filename.isEmpty else { continue }
                guard !seenFilenames.contains(track.filename) else { continue }
                seenFilenames.insert(track.filename)
                let srcPath = (vaultDir as NSString).appendingPathComponent(track.filename)
                guard fm.fileExists(atPath: srcPath) else { continue }
                let attrs = try? fm.attributesOfItem(atPath: srcPath)
                let size = (attrs?[.size] as? NSNumber)?.int64Value ?? 0
                let mtime = (attrs?[.modificationDate] as? Date)?.timeIntervalSince1970 ?? 0
                items.append(SnowskyTrackItem(filename: track.filename, srcPath: srcPath, size: size, mtime: mtime))
            }
            playlistPlans.append(SnowskyPlaylistPlan(rawName: rawName, folderName: uniqueName, tracks: items))
        }

        return SnowskySyncPlan(libraryTracks: libraryTracks, playlists: playlistPlans)
    }

    private func cleanupLegacyRootSnowskyFolders(sdRoot: String) {
        let fm = FileManager.default
        if sdRoot.isEmpty || !fm.fileExists(atPath: sdRoot) { return }
        let manifestPath = (sdRoot as NSString).appendingPathComponent(Self.manifestFilename)
        guard fm.fileExists(atPath: manifestPath),
              let data = try? Data(contentsOf: URL(fileURLWithPath: manifestPath)),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let folders = json["folders"] as? [String] else {
            return
        }
        for folder in folders {
            if isProtectedFolder(folder) { continue }
            let folderPath = (sdRoot as NSString).appendingPathComponent(folder)
            var isDir: ObjCBool = false
            if fm.fileExists(atPath: folderPath, isDirectory: &isDir), isDir.boolValue {
                try? fm.removeItem(atPath: folderPath)
                emitSyncEvent(type: "PLAYLIST", message: "[SNOWSKY SYNC] Removed legacy root playlist folder: /\(folder)/")
            }
        }
        try? fm.removeItem(atPath: manifestPath)
    }

    private func syncLocalSnowskySubfolder(
        destDir: String,
        tracks: [SnowskyTrackItem],
        processed: inout Int,
        copied: inout Int,
        unchanged: inout Int,
        deleted: inout Int
    ) {
        let fm = FileManager.default
        try? fm.createDirectory(atPath: destDir, withIntermediateDirectories: true)

        let expectedFilenames = Set(tracks.map { $0.filename })
        if let existing = try? fm.contentsOfDirectory(atPath: destDir) {
            for entry in existing {
                if getIsCancelRequested() { return }
                if entry == ".DS_Store" {
                    try? fm.removeItem(atPath: (destDir as NSString).appendingPathComponent(entry))
                    continue
                }
                if !expectedFilenames.contains(entry) {
                    let stalePath = (destDir as NSString).appendingPathComponent(entry)
                    try? fm.removeItem(atPath: stalePath)
                    deleted += 1
                    emitSyncEvent(type: "RSYNC", message: "[SNOWSKY SYNC] Deleted stale: \(entry)")
                }
            }
        }

        for item in tracks {
            if getIsCancelRequested() { return }
            processed += 1
            let destPath = (destDir as NSString).appendingPathComponent(item.filename)
            updateSyncState { st in
                st.currentFile = item.filename
                st.processedCount = processed
            }

            if let destAttrs = try? fm.attributesOfItem(atPath: destPath) {
                let destSize = (destAttrs[.size] as? NSNumber)?.int64Value ?? -2
                let destMtime = (destAttrs[.modificationDate] as? Date)?.timeIntervalSince1970 ?? 0
                if item.size > 0 && destSize == item.size && abs(item.mtime - destMtime) <= 2.0 {
                    unchanged += 1
                    continue
                }
                try? fm.removeItem(atPath: destPath)
            }

            emitSyncEvent(type: "RSYNC", message: "[SNOWSKY SYNC] Copying: \(item.filename)")
            do {
                try fm.copyItem(atPath: item.srcPath, toPath: destPath)
                copied += 1
            } catch {
                emitSyncEvent(type: "ERROR", message: "[SNOWSKY SYNC ERROR] Failed to copy \"\(item.filename)\": \(error.localizedDescription)")
            }
        }
    }

    private func runSnowskySdSync(targetMusicDir: String, vaultDir: String, startTime: Date) -> String {
        let fm = FileManager.default
        let plan = buildSnowskyPlan(vaultDir: vaultDir)
        let totalOps = plan.totalOperations

        updateSyncState { st in
            st.phase = "syncing"
            st.totalCount = totalOps
            st.processedCount = 0
        }

        emitSyncEvent(type: "RSYNC", message: "[SNOWSKY SYNC] Starting SD Card sync -> \(targetMusicDir) (Library/ + Playlist subfolders, no .m3u files)")

        var processed = 0
        var copied = 0
        var unchanged = 0
        var deleted = 0

        // 1. Sync Music/Library/ with all vault tracks
        let libraryDir = (targetMusicDir as NSString).appendingPathComponent("Library")
        emitSyncEvent(type: "RSYNC", message: "[SNOWSKY SYNC] Syncing Library (\(plan.libraryTracks.count) tracks) -> Music/Library/")
        syncLocalSnowskySubfolder(
            destDir: libraryDir,
            tracks: plan.libraryTracks,
            processed: &processed,
            copied: &copied,
            unchanged: &unchanged,
            deleted: &deleted
        )

        // 2. Sync Music/<SanitizedPlaylistName>/ for each playlist
        if !getIsCancelRequested() {
            updateSyncState { st in
                st.phase = "playlists"
                st.currentFile = nil
            }
            for pl in plan.playlists {
                if getIsCancelRequested() { break }
                let plDir = (targetMusicDir as NSString).appendingPathComponent(pl.folderName)
                emitSyncEvent(type: "PLAYLIST", message: "[SNOWSKY SYNC] Syncing Playlist \"\(pl.rawName)\" (\(pl.tracks.count) tracks) -> Music/\(pl.folderName)/")
                syncLocalSnowskySubfolder(
                    destDir: plDir,
                    tracks: pl.tracks,
                    processed: &processed,
                    copied: &copied,
                    unchanged: &unchanged,
                    deleted: &deleted
                )
            }
        }

        // 3. Prune stale files/folders directly inside Music/ (e.g. old flat tracks, .m3u files, deleted playlists)
        if !getIsCancelRequested() {
            updateSyncState { st in
                st.phase = "cleaning"
                st.currentFile = nil
            }
            var validFoldersLower = Set<String>(["library"])
            for pl in plan.playlists {
                validFoldersLower.insert(pl.folderName.lowercased())
            }
            if let topEntries = try? fm.contentsOfDirectory(atPath: targetMusicDir) {
                for entry in topEntries {
                    if getIsCancelRequested() { break }
                    if entry == ".DS_Store" {
                        try? fm.removeItem(atPath: (targetMusicDir as NSString).appendingPathComponent(entry))
                        continue
                    }
                    let fullPath = (targetMusicDir as NSString).appendingPathComponent(entry)
                    var isDir: ObjCBool = false
                    let exists = fm.fileExists(atPath: fullPath, isDirectory: &isDir)
                    guard exists else { continue }
                    if isDir.boolValue {
                        if !validFoldersLower.contains(entry.lowercased()) {
                            try? fm.removeItem(atPath: fullPath)
                            deleted += 1
                            emitSyncEvent(type: "PLAYLIST", message: "[SNOWSKY SYNC] Removed stale folder: Music/\(entry)/")
                        }
                    } else {
                        try? fm.removeItem(atPath: fullPath)
                        deleted += 1
                        emitSyncEvent(type: "RSYNC", message: "[SNOWSKY SYNC] Removed flat/playlist file: Music/\(entry)")
                    }
                }
            }
        }

        let trimmedMusic = targetMusicDir.replacingOccurrences(of: #"/+$"#, with: "", options: .regularExpression)
        let sdRoot = (trimmedMusic as NSString).deletingLastPathComponent
        cleanupLegacyRootSnowskyFolders(sdRoot: sdRoot)

        let elapsed = String(format: "%.1f", Date().timeIntervalSince(startTime))
        if getIsCancelRequested() {
            emitSyncEvent(
                type: "DONE",
                message: "[SNOWSKY SYNC] Canceled cleanly by user after \(elapsed)s (\(copied) copied, \(unchanged) unchanged, \(deleted) removed before stop)."
            )
            return "canceled"
        }

        emitSyncEvent(
            type: "DONE",
            message: "[SNOWSKY SYNC] Complete: \(copied) copied, \(unchanged) unchanged, \(deleted) removed across Library and \(plan.playlists.count) playlists in \(elapsed)s."
        )
        return "done"
    }

    // MARK: - Incremental Sync via /usr/bin/rsync
    public func runRsyncToSdCard(requestedVolumePath: String? = nil) async throws {
        let startTime = Date()
        try lock.withLock {
            if syncState.isSyncing {
                throw NSError(domain: "VolumeAndSyncService", code: 409, userInfo: [NSLocalizedDescriptionKey: "A sync operation is already in progress."])
            }
            isCancelRequested = false
            syncState = SyncState(
                isSyncing: true,
                isCanceling: false,
                mode: "sd",
                phase: "scanning",
                currentFile: nil,
                processedCount: 0,
                totalCount: 0,
                startedAt: startTime
            )
        }
        broadcastSyncState()

        var finalPhase = "done"
        defer {
            updateSyncState { st in
                st.isSyncing = false
                st.isCanceling = false
                st.phase = finalPhase
                st.currentFile = nil
            }
            lock.withLock {
                activeProcess = nil
                isCancelRequested = false
            }
        }

        let lib = LibraryService.shared
        let vaultDir = lib.getVaultDir()
        let volumePath = (requestedVolumePath?.isEmpty == false) ? requestedVolumePath! : lib.config.sdCardPath
        if volumePath.isEmpty {
            finalPhase = "error"
            let msg = "No target SD card or external volume selected."
            emitSyncEvent(type: "ERROR", message: "[ERROR] \(msg)")
            throw NSError(domain: "VolumeAndSyncService", code: 400, userInfo: [NSLocalizedDescriptionKey: msg])
        }

        let safety = isSafeExternalVolume(volumePath)
        if !safety.safe {
            finalPhase = "error"
            let msg = "Unsafe target volume blocked: \(safety.reason ?? "Unsafe path")"
            emitSyncEvent(type: "ERROR", message: "[ERROR] \(msg)")
            throw NSError(domain: "VolumeAndSyncService", code: 400, userInfo: [NSLocalizedDescriptionKey: msg])
        }

        let resolvedTarget = resolveTargetMusicDir(volumePath)
        let targetMusicDir = resolvedTarget.hasSuffix("/") ? resolvedTarget : "\(resolvedTarget)/"
        let normalizedVaultDir = vaultDir.hasSuffix("/") ? vaultDir : "\(vaultDir)/"

        try? FileManager.default.createDirectory(atPath: normalizedVaultDir, withIntermediateDirectories: true)
        try? FileManager.default.createDirectory(atPath: targetMusicDir, withIntermediateDirectories: true)

        if lib.config.exportPlaylistFolders {
            finalPhase = runSnowskySdSync(
                targetMusicDir: targetMusicDir,
                vaultDir: normalizedVaultDir,
                startTime: startTime
            )
            return
        }

        PlaylistService.shared.syncAllPlaylistsM3u()

        let localEntries = (try? FileManager.default.contentsOfDirectory(atPath: normalizedVaultDir)) ?? []
        let trackCount = localEntries.filter {
            let ext = "." + ($0 as NSString).pathExtension.lowercased()
            return LibraryService.supportedExtensions.contains(ext)
        }.count
        let playlistCount = localEntries.filter {
            let ext = "." + ($0 as NSString).pathExtension.lowercased()
            return ext == ".m3u" || ext == ".m3u8"
        }.count
        let totalLocal = trackCount + playlistCount

        updateSyncState { st in
            st.phase = "syncing"
            st.totalCount = totalLocal
        }

        let rsyncArgs = [
            "-avu",
            "--delete",
            "--itemize-changes",
            "--modify-window=1",
            "--exclude=.vault_index.json",
            "--exclude=.DS_Store",
            normalizedVaultDir,
            targetMusicDir
        ]

        emitSyncEvent(type: "RSYNC", message: "[SYNC] Starting SD Card sync -> \(targetMusicDir)")
        emitSyncEvent(type: "RSYNC", message: "[SYNC] Scanning local library (\(trackCount) tracks, \(playlistCount) playlists)...")

        final class RsyncTracker: @unchecked Sendable {
            private let l = NSLock()
            private var remainder = ""
            private var copied = 0
            private var deleted = 0

            func appendAndDrainLines(_ chunk: String) -> [String] {
                l.lock()
                remainder += chunk
                let parts = remainder.components(separatedBy: "\n")
                remainder = parts.last ?? ""
                l.unlock()
                return Array(parts.dropLast())
            }

            func recordCopy() {
                l.lock()
                copied += 1
                l.unlock()
            }

            func recordDelete() {
                l.lock()
                deleted += 1
                l.unlock()
            }

            func snapshot() -> (copied: Int, deleted: Int) {
                l.lock()
                defer { l.unlock() }
                return (copied, deleted)
            }
        }
        let tracker = RsyncTracker()

        do {
            let exitCode: Int32 = try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Int32, Error>) in
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
                    guard !data.isEmpty, let chunk = String(data: data, encoding: .utf8), let self = self else { return }

                    for rawLine in tracker.appendAndDrainLines(chunk) {
                        let trimmed = rawLine.trimmingCharacters(in: .whitespacesAndNewlines)
                        guard !trimmed.isEmpty else { continue }

                        if trimmed.hasPrefix("*deleting ") {
                            let file = String(trimmed.dropFirst("*deleting ".count)).trimmingCharacters(in: .whitespaces)
                            tracker.recordDelete()
                            self.updateSyncState { st in
                                st.currentFile = file
                                st.processedCount += 1
                            }
                            self.emitSyncEvent(type: "RSYNC", message: "[SYNC] Deleting: \(file)")
                        } else if trimmed.hasPrefix(">f") || trimmed.hasPrefix("<f") {
                            if let spaceIdx = trimmed.firstIndex(of: " ") {
                                let file = String(trimmed[trimmed.index(after: spaceIdx)...]).trimmingCharacters(in: .whitespaces)
                                tracker.recordCopy()
                                self.updateSyncState { st in
                                    st.currentFile = file
                                    st.processedCount += 1
                                }
                                self.emitSyncEvent(type: "RSYNC", message: "[SYNC] Copying: \(file)")
                            } else {
                                self.emitSyncEvent(type: "RSYNC", message: "[RSYNC] \(trimmed)")
                            }
                        } else if !trimmed.hasPrefix("building file list") &&
                                    !trimmed.hasPrefix("sending incremental") &&
                                    !trimmed.hasPrefix("sent ") &&
                                    !trimmed.hasPrefix("total size ") &&
                                    !trimmed.hasSuffix("/") {
                            self.emitSyncEvent(type: "RSYNC", message: "[RSYNC] \(trimmed)")
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

                proc.terminationHandler = { p in
                    outPipe.fileHandleForReading.readabilityHandler = nil
                    errPipe.fileHandleForReading.readabilityHandler = nil
                    continuation.resume(returning: p.terminationStatus)
                }

                self.lock.lock()
                self.activeProcess = proc
                let alreadyCanceled = self.isCancelRequested
                self.lock.unlock()

                if alreadyCanceled {
                    continuation.resume(returning: 15)
                    return
                }

                do {
                    try proc.run()
                } catch {
                    self.emitSyncEvent(type: "ERROR", message: "[ERROR] Failed to spawn /usr/bin/rsync: \(error.localizedDescription)")
                    continuation.resume(throwing: error)
                }
            }

            let counts = tracker.snapshot()
            let elapsed = String(format: "%.1f", Date().timeIntervalSince(startTime))
            if getIsCancelRequested() || exitCode == 15 || exitCode == 20 {
                finalPhase = "canceled"
                emitSyncEvent(
                    type: "DONE",
                    message: "[SYNC] Canceled cleanly by user after \(elapsed)s (\(counts.copied) copied, \(counts.deleted) removed before stop)."
                )
                return
            }

            if exitCode != 0 {
                finalPhase = "error"
                let msg = "[ERROR] rsync exited with code \(exitCode)"
                emitSyncEvent(type: "ERROR", message: msg)
                throw NSError(domain: "VolumeAndSyncService", code: Int(exitCode), userInfo: [NSLocalizedDescriptionKey: msg])
            }
        } catch {
            if finalPhase != "canceled" {
                finalPhase = "error"
            }
            throw error
        }

        if !getIsCancelRequested() {
            let trimmedMusic = targetMusicDir.replacingOccurrences(of: #"/+$"#, with: "", options: .regularExpression)
            let sdRoot = (trimmedMusic as NSString).deletingLastPathComponent
            cleanupLegacyRootSnowskyFolders(sdRoot: sdRoot)
        }

        let counts = tracker.snapshot()
        let elapsed = String(format: "%.1f", Date().timeIntervalSince(startTime))
        let unchangedCount = max(0, totalLocal - counts.copied)
        emitSyncEvent(
            type: "DONE",
            message: "[SYNC] Complete: \(counts.copied) copied, \(unchangedCount) unchanged, \(counts.deleted) removed in \(elapsed)s."
        )
    }

    // MARK: - Android-Safe Wi-Fi FTP Delta-Sync Engine
    public struct FtpRemoteEntry: Sendable {
        public let name: String
        public let size: Int64
        public let isDirectory: Bool
    }

    private static let ftpIgnoredSystemNames: Set<String> = [
        ".", "..", "lost.dir", ".android_secure", "system volume information",
        "$recycle.bin", ".ds_store", ".vault_index.json"
    ]

    public static func normalizeFtpRemoteDir(_ rawPath: String) -> String {
        var p = rawPath.trimmingCharacters(in: .whitespacesAndNewlines)
        if p.isEmpty || p == "/" { return "" }
        if !p.hasPrefix("/") { p = "/" + p }
        while p.hasSuffix("/") && p.count > 1 {
            p.removeLast()
        }
        return p == "/" ? "" : p
    }

    private static func buildFtpUrl(host: String, port: Int, remoteDir: String, filename: String? = nil, trailingSlash: Bool = false) -> String {
        let encodedDir = remoteDir
            .split(separator: "/")
            .map { seg -> String in
                let s = String(seg)
                return s.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? s
            }
            .joined(separator: "/")
        let dirPart = encodedDir.isEmpty ? "" : "/\(encodedDir)"
        if let file = filename, !file.isEmpty {
            let encodedFile = file.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? file
            return "ftp://\(host):\(port)\(dirPart)/\(encodedFile)"
        }
        return "ftp://\(host):\(port)\(dirPart)\(trailingSlash ? "/" : "")"
    }

    private static func formatByteCount(_ bytes: Int64) -> String {
        if bytes < 1024 { return "\(bytes) B" }
        let kb = Double(bytes) / 1024.0
        if kb < 1024.0 { return String(format: "%.1f KB", kb) }
        let mb = kb / 1024.0
        return String(format: "%.2f MB", mb)
    }

    public static func parseFtpListOutput(_ output: String) -> [FtpRemoteEntry] {
        var entries: [FtpRemoteEntry] = []
        for rawLine in output.components(separatedBy: .newlines) {
            let line = rawLine.trimmingCharacters(in: CharacterSet.whitespacesAndNewlines)
            guard !line.isEmpty else { continue }

            // 1. Standard Unix `LIST` format:
            // -rw-r--r-- 1 user group 12345678 Nov 20 22:00 Track Name.m4a
            if line.hasPrefix("-") || line.hasPrefix("d") || line.hasPrefix("l") {
                let isDir = line.hasPrefix("d")
                // Split into up to 8 tokens + remaining filename (preserving spaces)
                var idx = line.startIndex
                var tokenRanges: [Range<String.Index>] = []
                while idx < line.endIndex && tokenRanges.count < 8 {
                    while idx < line.endIndex && line[idx].isWhitespace {
                        idx = line.index(after: idx)
                    }
                    guard idx < line.endIndex else { break }
                    let start = idx
                    while idx < line.endIndex && !line[idx].isWhitespace {
                        idx = line.index(after: idx)
                    }
                    tokenRanges.append(start..<idx)
                }
                guard tokenRanges.count >= 8 else { continue }
                let sizeStr = String(line[tokenRanges[4]])
                let size = Int64(sizeStr) ?? 0
                while idx < line.endIndex && line[idx].isWhitespace {
                    idx = line.index(after: idx)
                }
                guard idx < line.endIndex else { continue }
                let name = String(line[idx...]).trimmingCharacters(in: .whitespacesAndNewlines)
                guard !name.isEmpty, !ftpIgnoredSystemNames.contains(name.lowercased()) else { continue }
                entries.append(FtpRemoteEntry(name: name, size: size, isDirectory: isDir))
                continue
            }

            // 2. DOS/Windows `LIST` fallback:
            // 11-20-26  10:00PM       12345678 Track Name.m4a
            let dosRegex = try? NSRegularExpression(pattern: #"^\d{2}-\d{2}-\d{2,4}\s+\d{2}:\d{2}(?:AM|PM)?\s+(<DIR>|\d+)\s+(.+)$"#, options: [.caseInsensitive])
            if let match = dosRegex?.firstMatch(in: line, range: NSRange(line.startIndex..., in: line)),
               let sizeRange = Range(match.range(at: 1), in: line),
               let nameRange = Range(match.range(at: 2), in: line) {
                let sizeToken = String(line[sizeRange])
                let isDir = sizeToken.uppercased() == "<DIR>"
                let size = isDir ? 0 : (Int64(sizeToken) ?? 0)
                let name = String(line[nameRange]).trimmingCharacters(in: .whitespacesAndNewlines)
                guard !name.isEmpty, !ftpIgnoredSystemNames.contains(name.lowercased()) else { continue }
                entries.append(FtpRemoteEntry(name: name, size: size, isDirectory: isDir))
            }
        }
        return entries
    }

    private func runCurlCommand(args: [String], trackActiveProcess: Bool = false) throws -> (exitCode: Int32, stdout: String, stderr: String) {
        let proc = Process()
        proc.executableURL = URL(fileURLWithPath: "/usr/bin/curl")
        proc.arguments = args

        let outPipe = Pipe()
        let errPipe = Pipe()
        proc.standardOutput = outPipe
        proc.standardError = errPipe

        if trackActiveProcess {
            lock.lock()
            activeProcess = proc
            lock.unlock()
        }

        defer {
            if trackActiveProcess {
                lock.lock()
                if activeProcess === proc { activeProcess = nil }
                lock.unlock()
            }
        }

        try proc.run()
        let outData = outPipe.fileHandleForReading.readDataToEndOfFile()
        let errData = errPipe.fileHandleForReading.readDataToEndOfFile()
        proc.waitUntilExit()

        let outStr = String(data: outData, encoding: .utf8) ?? ""
        let errStr = String(data: errData, encoding: .utf8) ?? ""
        return (proc.terminationStatus, outStr, errStr)
    }

    private func ftpAuthArgs(username: String, password: String) -> [String] {
        let user = username.trimmingCharacters(in: .whitespacesAndNewlines)
        if user.isEmpty { return [] }
        return ["--user", "\(user):\(password)"]
    }

    public func listFtpDirectory(
        host: String,
        port: Int,
        remoteDir: String,
        username: String,
        password: String
    ) throws -> [FtpRemoteEntry] {
        let url = Self.buildFtpUrl(host: host, port: port, remoteDir: remoteDir, trailingSlash: true)
        var args = ["-sS", "--ftp-pasv", "--connect-timeout", "8"]
        args.append(contentsOf: ftpAuthArgs(username: username, password: password))
        args.append(url)

        let res = try runCurlCommand(args: args)
        if res.exitCode != 0 {
            let msg = res.stderr.trimmingCharacters(in: .whitespacesAndNewlines)
            throw NSError(domain: "VolumeAndSyncService", code: Int(res.exitCode), userInfo: [
                NSLocalizedDescriptionKey: msg.isEmpty ? "FTP directory listing failed (curl exit \(res.exitCode))" : msg
            ])
        }
        return Self.parseFtpListOutput(res.stdout)
    }

    private func deleteFtpFile(
        host: String,
        port: Int,
        remoteDir: String,
        filename: String,
        username: String,
        password: String,
        ignoreMissing: Bool = false
    ) throws {
        let relPath = remoteDir.isEmpty ? filename : "\(remoteDir)/\(filename)"
        let rootUrl = "ftp://\(host):\(port)/"
        var args = ["-sS", "--ftp-pasv", "--connect-timeout", "8"]
        args.append(contentsOf: ftpAuthArgs(username: username, password: password))
        args.append(contentsOf: ["-Q", "DELE \(relPath)", rootUrl])

        let res = try runCurlCommand(args: args)
        if res.exitCode != 0 && !ignoreMissing {
            let msg = res.stderr.trimmingCharacters(in: .whitespacesAndNewlines)
            throw NSError(domain: "VolumeAndSyncService", code: Int(res.exitCode), userInfo: [
                NSLocalizedDescriptionKey: msg.isEmpty ? "FTP DELE failed for \(filename)" : msg
            ])
        }
    }

    private func uploadFtpFile(
        localPath: String,
        host: String,
        port: Int,
        remoteDir: String,
        filename: String,
        username: String,
        password: String
    ) throws {
        let fileUrl = Self.buildFtpUrl(host: host, port: port, remoteDir: remoteDir, filename: filename)
        var args = ["-sS", "--ftp-pasv", "--ftp-create-dirs", "--connect-timeout", "10"]
        args.append(contentsOf: ftpAuthArgs(username: username, password: password))
        args.append(contentsOf: ["-T", localPath, fileUrl])

        let res = try runCurlCommand(args: args, trackActiveProcess: true)
        if res.exitCode != 0 {
            let msg = res.stderr.trimmingCharacters(in: .whitespacesAndNewlines)
            throw NSError(domain: "VolumeAndSyncService", code: Int(res.exitCode), userInfo: [
                NSLocalizedDescriptionKey: msg.isEmpty ? "FTP upload failed for \(filename) (curl exit \(res.exitCode))" : msg
            ])
        }
    }

    public func testFtpConnection(
        serviceName: String? = nil,
        manualHost: String? = nil,
        manualPort: Int? = nil,
        username: String? = nil,
        password: String? = nil,
        remotePath: String? = nil
    ) throws -> [String: Any] {
        let cfg = LibraryService.shared.config
        let svcName = serviceName ?? cfg.ftpServiceName
        let mHost = manualHost ?? cfg.ftpManualHost
        let mPort = manualPort ?? cfg.ftpManualPort
        let user = username ?? cfg.ftpUsername
        let pass = password ?? cfg.ftpPassword
        let rDir = Self.normalizeFtpRemoteDir(remotePath ?? cfg.ftpRemotePath)

        guard let target = BonjourFtpBrowser.shared.resolveTarget(
            serviceName: svcName,
            manualHost: mHost,
            manualPort: mPort
        ) else {
            let label = svcName.isEmpty ? "WiFiFTP" : svcName
            throw NSError(domain: "VolumeAndSyncService", code: 404, userInfo: [
                NSLocalizedDescriptionKey: "Bonjour FTP service \"\(label)\" is offline or not yet resolved. Start the FTP server on your player or enter a manual host."
            ])
        }

        let entries = try listFtpDirectory(
            host: target.host,
            port: target.port,
            remoteDir: rDir,
            username: user,
            password: pass
        )

        return [
            "ok": true,
            "serviceName": target.label,
            "host": target.host,
            "port": target.port,
            "remotePath": rDir.isEmpty ? "/" : rDir,
            "fileCount": entries.count
        ]
    }

    public func ftpListDirectory(
        path: String,
        serviceName: String? = nil,
        manualHost: String? = nil,
        manualPort: Int? = nil,
        username: String? = nil,
        password: String? = nil
    ) throws -> [String: Any] {
        let cfg = LibraryService.shared.config
        let svcName = serviceName ?? cfg.ftpServiceName
        let mHost = manualHost ?? cfg.ftpManualHost
        let mPort = manualPort ?? cfg.ftpManualPort
        let user = username ?? cfg.ftpUsername
        let pass = password ?? cfg.ftpPassword

        let rDir = Self.normalizeFtpRemoteDir(path)
        let currentPath = rDir.isEmpty ? "/" : rDir
        let parentPath: String? = currentPath == "/" ? nil : {
            let p = (currentPath as NSString).deletingLastPathComponent
            return p.isEmpty ? "/" : p
        }()

        guard let target = BonjourFtpBrowser.shared.resolveTarget(
            serviceName: svcName,
            manualHost: mHost,
            manualPort: mPort
        ) else {
            let label = svcName.isEmpty ? "WiFiFTP" : svcName
            throw NSError(domain: "VolumeAndSyncService", code: 404, userInfo: [
                NSLocalizedDescriptionKey: "Bonjour FTP service \"\(label)\" is offline or not yet resolved."
            ])
        }

        let entries = try listFtpDirectory(
            host: target.host,
            port: target.port,
            remoteDir: rDir,
            username: user,
            password: pass
        )

        let directories = entries
            .filter { $0.isDirectory }
            .map { $0.name }
            .sorted { $0.localizedCaseInsensitiveCompare($1) == .orderedAscending }

        let files = entries.filter { !$0.isDirectory }
        let audioFiles = files.filter { entry in
            let ext = "." + (entry.name as NSString).pathExtension.lowercased()
            return LibraryService.supportedExtensions.contains(ext)
        }

        return [
            "currentPath": currentPath,
            "parentPath": parentPath as Any,
            "directories": directories,
            "audioFileCount": audioFiles.count,
            "totalFileCount": files.count,
            "sampleFiles": Array(audioFiles.prefix(5).map { $0.name })
        ]
    }

    public func ftpVerifyWritable(
        path: String,
        serviceName: String? = nil,
        manualHost: String? = nil,
        manualPort: Int? = nil,
        username: String? = nil,
        password: String? = nil
    ) -> [String: Any] {
        let cfg = LibraryService.shared.config
        let svcName = serviceName ?? cfg.ftpServiceName
        let mHost = manualHost ?? cfg.ftpManualHost
        let mPort = manualPort ?? cfg.ftpManualPort
        let user = username ?? cfg.ftpUsername
        let pass = password ?? cfg.ftpPassword

        let rDir = Self.normalizeFtpRemoteDir(path)
        let displayPath = rDir.isEmpty ? "/" : rDir

        guard let target = BonjourFtpBrowser.shared.resolveTarget(
            serviceName: svcName,
            manualHost: mHost,
            manualPort: mPort
        ) else {
            let label = svcName.isEmpty ? "WiFiFTP" : svcName
            return [
                "writable": false,
                "path": displayPath,
                "error": "Bonjour FTP service \"\(label)\" is offline or not yet resolved."
            ]
        }

        let localProbePath = (NSTemporaryDirectory() as NSString)
            .appendingPathComponent("av_write_probe_\(UUID().uuidString).tmp")
        let probeData = Data("audiophile-vault".utf8)
        FileManager.default.createFile(atPath: localProbePath, contents: probeData)
        defer { try? FileManager.default.removeItem(atPath: localProbePath) }

        let remoteProbeName = ".av_write_test.tmp"
        do {
            try uploadFtpFile(
                localPath: localProbePath,
                host: target.host,
                port: target.port,
                remoteDir: rDir,
                filename: remoteProbeName,
                username: user,
                password: pass
            )
            try deleteFtpFile(
                host: target.host,
                port: target.port,
                remoteDir: rDir,
                filename: remoteProbeName,
                username: user,
                password: pass,
                ignoreMissing: false
            )
            return [
                "writable": true,
                "path": displayPath
            ]
        } catch {
            // Best-effort cleanup if STOR succeeded but DELE failed
            try? deleteFtpFile(
                host: target.host,
                port: target.port,
                remoteDir: rDir,
                filename: remoteProbeName,
                username: user,
                password: pass,
                ignoreMissing: true
            )
            return [
                "writable": false,
                "path": displayPath,
                "error": error.localizedDescription
            ]
        }
    }

    public func runFtpSync() async throws {
        let startTime = Date()
        try lock.withLock {
            if syncState.isSyncing {
                throw NSError(domain: "VolumeAndSyncService", code: 409, userInfo: [NSLocalizedDescriptionKey: "A sync operation is already in progress."])
            }
            isCancelRequested = false
            syncState = SyncState(
                isSyncing: true,
                isCanceling: false,
                mode: "ftp",
                phase: "scanning",
                currentFile: nil,
                processedCount: 0,
                totalCount: 0,
                startedAt: startTime
            )
        }
        broadcastSyncState()

        var finalPhase = "done"
        defer {
            updateSyncState { st in
                st.isSyncing = false
                st.isCanceling = false
                st.phase = finalPhase
                st.currentFile = nil
            }
            lock.withLock {
                activeProcess = nil
                isCancelRequested = false
            }
        }

        let lib = LibraryService.shared
        let cfg = lib.config
        let vaultDir = lib.getVaultDir()
        let svcName = cfg.ftpServiceName.isEmpty ? "WiFiFTP" : cfg.ftpServiceName
        let rDir = Self.normalizeFtpRemoteDir(cfg.ftpRemotePath)
        let rDirDisplay = rDir.isEmpty ? "/" : rDir

        emitSyncEvent(type: "RSYNC", message: "[FTP SYNC] Resolving \(svcName)...")

        guard let target = BonjourFtpBrowser.shared.resolveTarget(
            serviceName: cfg.ftpServiceName,
            manualHost: cfg.ftpManualHost,
            manualPort: cfg.ftpManualPort
        ) else {
            finalPhase = "error"
            let msg = "[ERROR] [FTP SYNC] Could not resolve \"\(svcName)\". Ensure the player's Wi-Fi FTP server is running."
            emitSyncEvent(type: "ERROR", message: msg)
            throw NSError(domain: "VolumeAndSyncService", code: 404, userInfo: [NSLocalizedDescriptionKey: msg])
        }

        emitSyncEvent(type: "RSYNC", message: "[FTP SYNC] Connected to \(target.label) (\(target.host):\(target.port)\(rDirDisplay))")

        if cfg.exportPlaylistFolders {
            finalPhase = try runSnowskyFtpSync(
                host: target.host,
                port: target.port,
                rDir: rDir,
                vaultDir: vaultDir,
                cfg: cfg,
                startTime: startTime
            )
            return
        }

        PlaylistService.shared.syncAllPlaylistsM3u()

        let remoteEntries: [FtpRemoteEntry]
        do {
            remoteEntries = try listFtpDirectory(
                host: target.host,
                port: target.port,
                remoteDir: rDir,
                username: cfg.ftpUsername,
                password: cfg.ftpPassword
            )
        } catch {
            finalPhase = "error"
            emitSyncEvent(type: "ERROR", message: "[ERROR] [FTP SYNC] \(error.localizedDescription)")
            throw error
        }

        var remoteByName: [String: FtpRemoteEntry] = [:]
        for entry in remoteEntries where !entry.isDirectory {
            remoteByName[entry.name] = entry
        }

        let fm = FileManager.default
        let localNames = (try? fm.contentsOfDirectory(atPath: vaultDir)) ?? []

        var localAudioFiles: [(name: String, path: String, size: Int64)] = []
        var localPlaylistFiles: [(name: String, path: String)] = []
        var localAllSet = Set<String>()

        for name in localNames.sorted() {
            if name.hasPrefix(".") || name == ".vault_index.json" { continue }
            let fullPath = (vaultDir as NSString).appendingPathComponent(name)
            var isDir: ObjCBool = false
            guard fm.fileExists(atPath: fullPath, isDirectory: &isDir), !isDir.boolValue else { continue }
            let ext = "." + (name as NSString).pathExtension.lowercased()
            if LibraryService.supportedExtensions.contains(ext) {
                let attrs = try? fm.attributesOfItem(atPath: fullPath)
                let size = (attrs?[.size] as? NSNumber)?.int64Value ?? 0
                localAudioFiles.append((name, fullPath, size))
                localAllSet.insert(name)
            } else if ext == ".m3u" || ext == ".m3u8" {
                localPlaylistFiles.append((name, fullPath))
                localAllSet.insert(name)
            }
        }

        let totalLocal = localAudioFiles.count + localPlaylistFiles.count
        emitSyncEvent(type: "RSYNC", message: "[FTP SYNC] Scanning local library (\(localAudioFiles.count) tracks, \(localPlaylistFiles.count) playlists)...")
        updateSyncState { st in
            st.phase = "syncing"
            st.totalCount = totalLocal
            st.processedCount = 0
        }

        var uploaded = 0
        var skipped = 0
        var playlistsUpdated = 0
        var removed = 0
        var processed = 0

        // 1. Size-only delta sync for audio tracks (Android 13 SAF compatible)
        for item in localAudioFiles {
            if getIsCancelRequested() { break }
            processed += 1

            if let remote = remoteByName[item.name], remote.size == item.size {
                skipped += 1
                updateSyncState { st in
                    st.processedCount = processed
                }
                continue
            }

            updateSyncState { st in
                st.currentFile = item.name
                st.processedCount = processed
            }
            emitSyncEvent(
                type: "RSYNC",
                message: "[FTP SYNC] Uploading (\(processed)/\(totalLocal)): \(item.name) (\(Self.formatByteCount(item.size)))"
            )
            do {
                try uploadFtpFile(
                    localPath: item.path,
                    host: target.host,
                    port: target.port,
                    remoteDir: rDir,
                    filename: item.name,
                    username: cfg.ftpUsername,
                    password: cfg.ftpPassword
                )
                uploaded += 1
            } catch {
                if getIsCancelRequested() {
                    // Clean up partial file from remote storage on cancellation
                    try? deleteFtpFile(
                        host: target.host,
                        port: target.port,
                        remoteDir: rDir,
                        filename: item.name,
                        username: cfg.ftpUsername,
                        password: cfg.ftpPassword,
                        ignoreMissing: true
                    )
                    break
                }
                finalPhase = "error"
                emitSyncEvent(type: "ERROR", message: "[ERROR] [FTP SYNC] \(error.localizedDescription)")
                throw error
            }
        }

        // 2. Safe playlist overwrite: DELE before STOR for .m3u / .m3u8
        if !getIsCancelRequested() {
            updateSyncState { st in
                st.phase = "playlists"
            }
            for pl in localPlaylistFiles {
                if getIsCancelRequested() { break }
                processed += 1
                updateSyncState { st in
                    st.currentFile = pl.name
                    st.processedCount = processed
                }
                emitSyncEvent(type: "PLAYLIST", message: "[FTP SYNC] Updating playlist: \(pl.name)")
                if remoteByName[pl.name] != nil {
                    try? deleteFtpFile(
                        host: target.host,
                        port: target.port,
                        remoteDir: rDir,
                        filename: pl.name,
                        username: cfg.ftpUsername,
                        password: cfg.ftpPassword,
                        ignoreMissing: true
                    )
                }
                do {
                    try uploadFtpFile(
                        localPath: pl.path,
                        host: target.host,
                        port: target.port,
                        remoteDir: rDir,
                        filename: pl.name,
                        username: cfg.ftpUsername,
                        password: cfg.ftpPassword
                    )
                    playlistsUpdated += 1
                } catch {
                    if getIsCancelRequested() { break }
                    finalPhase = "error"
                    emitSyncEvent(type: "ERROR", message: "[ERROR] [FTP SYNC] \(error.localizedDescription)")
                    throw error
                }
            }
        }

        // 3. Mirror deletions for removed tracks/playlists (ignoring Android system folders)
        if !getIsCancelRequested() {
            updateSyncState { st in
                st.phase = "cleaning"
            }
            for remote in remoteEntries where !remote.isDirectory {
                if getIsCancelRequested() { break }
                let ext = "." + (remote.name as NSString).pathExtension.lowercased()
                let isManagedAudio = LibraryService.supportedExtensions.contains(ext)
                let isManagedPlaylist = (ext == ".m3u" || ext == ".m3u8")
                guard isManagedAudio || isManagedPlaylist else { continue }
                if !localAllSet.contains(remote.name) {
                    updateSyncState { st in
                        st.currentFile = remote.name
                    }
                    emitSyncEvent(type: "RSYNC", message: "[FTP SYNC] Deleting: \(remote.name)")
                    try? deleteFtpFile(
                        host: target.host,
                        port: target.port,
                        remoteDir: rDir,
                        filename: remote.name,
                        username: cfg.ftpUsername,
                        password: cfg.ftpPassword,
                        ignoreMissing: true
                    )
                    removed += 1
                }
            }
        }

        let elapsed = String(format: "%.1f", Date().timeIntervalSince(startTime))
        if getIsCancelRequested() {
            finalPhase = "canceled"
            emitSyncEvent(
                type: "DONE",
                message: "[FTP SYNC] Canceled cleanly by user after \(elapsed)s (\(uploaded) uploaded, \(skipped) unchanged, \(removed) removed before stop)."
            )
            return
        }

        emitSyncEvent(
            type: "DONE",
            message: "[DONE] [FTP SYNC] Complete: \(uploaded) uploaded, \(skipped) unchanged, \(playlistsUpdated) playlists updated, \(removed) removed in \(elapsed)s"
        )
    }

    private func syncFtpSnowskySubfolder(
        host: String,
        port: Int,
        remoteSubdir: String,
        tracks: [SnowskyTrackItem],
        cfg: VaultConfig,
        totalOps: Int,
        processed: inout Int,
        uploaded: inout Int,
        skipped: inout Int,
        removed: inout Int
    ) throws {
        let existingEntries = (try? listFtpDirectory(
            host: host,
            port: port,
            remoteDir: remoteSubdir,
            username: cfg.ftpUsername,
            password: cfg.ftpPassword
        )) ?? []

        var remoteByName: [String: FtpRemoteEntry] = [:]
        for entry in existingEntries where !entry.isDirectory {
            remoteByName[entry.name] = entry
        }

        let expectedFilenames = Set(tracks.map { $0.filename })

        // Prune stale files in this remote subfolder
        for entry in existingEntries where !entry.isDirectory {
            if getIsCancelRequested() { return }
            if !expectedFilenames.contains(entry.name) {
                emitSyncEvent(type: "RSYNC", message: "[SNOWSKY SYNC] Deleting stale: \(entry.name)")
                try? deleteFtpFile(
                    host: host,
                    port: port,
                    remoteDir: remoteSubdir,
                    filename: entry.name,
                    username: cfg.ftpUsername,
                    password: cfg.ftpPassword,
                    ignoreMissing: true
                )
                removed += 1
            }
        }

        for item in tracks {
            if getIsCancelRequested() { return }
            processed += 1

            if let remote = remoteByName[item.filename], remote.size == item.size {
                skipped += 1
                updateSyncState { st in
                    st.processedCount = processed
                }
                continue
            }

            updateSyncState { st in
                st.currentFile = item.filename
                st.processedCount = processed
            }
            emitSyncEvent(
                type: "RSYNC",
                message: "[SNOWSKY SYNC] Uploading (\(processed)/\(totalOps)): \(item.filename) (\(Self.formatByteCount(item.size)))"
            )
            do {
                try uploadFtpFile(
                    localPath: item.srcPath,
                    host: host,
                    port: port,
                    remoteDir: remoteSubdir,
                    filename: item.filename,
                    username: cfg.ftpUsername,
                    password: cfg.ftpPassword
                )
                uploaded += 1
            } catch {
                if getIsCancelRequested() {
                    try? deleteFtpFile(
                        host: host,
                        port: port,
                        remoteDir: remoteSubdir,
                        filename: item.filename,
                        username: cfg.ftpUsername,
                        password: cfg.ftpPassword,
                        ignoreMissing: true
                    )
                    return
                }
                throw error
            }
        }
    }

    private func runSnowskyFtpSync(
        host: String,
        port: Int,
        rDir: String,
        vaultDir: String,
        cfg: VaultConfig,
        startTime: Date
    ) throws -> String {
        let plan = buildSnowskyPlan(vaultDir: vaultDir)
        let totalOps = plan.totalOperations

        emitSyncEvent(type: "RSYNC", message: "[SNOWSKY SYNC] Starting Wi-Fi FTP sync (Library/ + Playlist subfolders, no .m3u files)")
        updateSyncState { st in
            st.phase = "syncing"
            st.totalCount = totalOps
            st.processedCount = 0
        }

        var processed = 0
        var uploaded = 0
        var skipped = 0
        var removed = 0

        let joinRemote: (String) -> String = { sub in
            rDir.isEmpty ? "/\(sub)" : "\(rDir)/\(sub)"
        }

        // 1. Sync Library/
        let libraryRemoteDir = joinRemote("Library")
        emitSyncEvent(type: "RSYNC", message: "[SNOWSKY SYNC] Syncing Library (\(plan.libraryTracks.count) tracks) -> \(libraryRemoteDir)/")
        try syncFtpSnowskySubfolder(
            host: host,
            port: port,
            remoteSubdir: libraryRemoteDir,
            tracks: plan.libraryTracks,
            cfg: cfg,
            totalOps: totalOps,
            processed: &processed,
            uploaded: &uploaded,
            skipped: &skipped,
            removed: &removed
        )

        // 2. Sync each <SanitizedPlaylistName>/
        if !getIsCancelRequested() {
            updateSyncState { st in
                st.phase = "playlists"
                st.currentFile = nil
            }
            for pl in plan.playlists {
                if getIsCancelRequested() { break }
                let plRemoteDir = joinRemote(pl.folderName)
                emitSyncEvent(type: "PLAYLIST", message: "[SNOWSKY SYNC] Syncing Playlist \"\(pl.rawName)\" (\(pl.tracks.count) tracks) -> \(plRemoteDir)/")
                try syncFtpSnowskySubfolder(
                    host: host,
                    port: port,
                    remoteSubdir: plRemoteDir,
                    tracks: pl.tracks,
                    cfg: cfg,
                    totalOps: totalOps,
                    processed: &processed,
                    uploaded: &uploaded,
                    skipped: &skipped,
                    removed: &removed
                )
            }
        }

        // 3. Remove any .m3u / .m3u8 files at rDir root
        if !getIsCancelRequested() {
            updateSyncState { st in
                st.phase = "cleaning"
                st.currentFile = nil
            }
            if let rootEntries = try? listFtpDirectory(
                host: host,
                port: port,
                remoteDir: rDir,
                username: cfg.ftpUsername,
                password: cfg.ftpPassword
            ) {
                for entry in rootEntries where !entry.isDirectory {
                    if getIsCancelRequested() { break }
                    let ext = "." + (entry.name as NSString).pathExtension.lowercased()
                    if ext == ".m3u" || ext == ".m3u8" {
                        emitSyncEvent(type: "RSYNC", message: "[SNOWSKY SYNC] Deleting playlist file: \(entry.name)")
                        try? deleteFtpFile(
                            host: host,
                            port: port,
                            remoteDir: rDir,
                            filename: entry.name,
                            username: cfg.ftpUsername,
                            password: cfg.ftpPassword,
                            ignoreMissing: true
                        )
                        removed += 1
                    }
                }
            }
        }

        let elapsed = String(format: "%.1f", Date().timeIntervalSince(startTime))
        if getIsCancelRequested() {
            emitSyncEvent(
                type: "DONE",
                message: "[SNOWSKY SYNC] Canceled cleanly by user after \(elapsed)s (\(uploaded) uploaded, \(skipped) unchanged, \(removed) removed before stop)."
            )
            return "canceled"
        }

        emitSyncEvent(
            type: "DONE",
            message: "[DONE] [SNOWSKY SYNC] Complete: \(uploaded) uploaded, \(skipped) unchanged, \(removed) removed across Library and \(plan.playlists.count) playlists in \(elapsed)s"
        )
        return "done"
    }
}
