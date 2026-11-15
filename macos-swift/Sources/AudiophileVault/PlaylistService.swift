import Foundation

public final class PlaylistService: @unchecked Sendable {
    public static let shared = PlaylistService()

    private init() {}

    public func getPlaylistFilename(_ playlistName: String) -> String {
        let safeStem = LibraryService.sanitizeSegment(playlistName, fallback: "Playlist")
        return "\(safeStem).m3u"
    }

    public func resolveRelativeTrackPath(targetPlaylistDir: String, trackFilename: String, audioDir: String) -> String {
        let cleanFilename = (trackFilename as NSString).lastPathComponent
        if targetPlaylistDir == audioDir {
            return cleanFilename
        }
        let absTrack = (audioDir as NSString).appendingPathComponent(cleanFilename)
        var rel = absTrack
        if absTrack.hasPrefix(targetPlaylistDir) {
            rel = String(absTrack.dropFirst(targetPlaylistDir.count))
        }
        rel = rel.replacingOccurrences(of: "\\", with: "/")
        rel = rel.replacingOccurrences(of: #"^[/\\]+"#, with: "", options: .regularExpression)
        if rel.hasPrefix("./") {
            rel = String(rel.dropFirst(2))
        }
        return rel.isEmpty ? cleanFilename : rel
    }

    public func buildM3uContent(for playlist: PlaylistRecord, targetPlaylistDir: String? = nil, audioDir: String? = nil) -> String {
        let lib = LibraryService.shared
        let vaultDir = lib.getVaultDir()
        let pDir = targetPlaylistDir ?? vaultDir
        let aDir = audioDir ?? vaultDir
        let crlf = "\r\n"

        var lines: [String] = ["#EXTM3U"]
        for key in playlist.trackKeys {
            guard let track = lib.getTrackByKey(key), !track.filename.isEmpty else { continue }
            let artist = (track.artist.isEmpty ? "Unknown Artist" : track.artist)
                .replacingOccurrences(of: "\r", with: " ")
                .replacingOccurrences(of: "\n", with: " ")
                .trimmingCharacters(in: .whitespacesAndNewlines)
            let title = (track.title.isEmpty ? track.filename : track.title)
                .replacingOccurrences(of: "\r", with: " ")
                .replacingOccurrences(of: "\n", with: " ")
                .trimmingCharacters(in: .whitespacesAndNewlines)
            let relPath = resolveRelativeTrackPath(targetPlaylistDir: pDir, trackFilename: track.filename, audioDir: aDir)
            lines.append("#EXTINF:-1,\(artist) - \(title)")
            lines.append(relPath)
        }
        return lines.joined(separator: crlf) + crlf
    }

    @discardableResult
    public func writePlaylistM3u(_ playlist: PlaylistRecord, targetPlaylistDir: String? = nil, audioDir: String? = nil) -> String {
        let lib = LibraryService.shared
        lib.initializeIfNeeded()
        let vaultDir = lib.getVaultDir()
        let pDir = targetPlaylistDir ?? vaultDir
        let aDir = audioDir ?? vaultDir

        try? FileManager.default.createDirectory(atPath: pDir, withIntermediateDirectories: true)
        let content = buildM3uContent(for: playlist, targetPlaylistDir: pDir, audioDir: aDir)
        let m3uFilename = getPlaylistFilename(playlist.name)
        let m3uFullPath = (pDir as NSString).appendingPathComponent(m3uFilename)
        if let data = content.data(using: .utf8) {
            try? data.write(to: URL(fileURLWithPath: m3uFullPath), options: .atomic)
        }

        let legacyM3u8 = (pDir as NSString).appendingPathComponent("\(LibraryService.sanitizeSegment(playlist.name, fallback: "Playlist")).m3u8")
        if FileManager.default.fileExists(atPath: legacyM3u8) {
            try? FileManager.default.removeItem(atPath: legacyM3u8)
        }
        return m3uFullPath
    }

    public func deletePlaylistM3u(_ playlistName: String, targetPlaylistDir: String? = nil) {
        let lib = LibraryService.shared
        let pDir = targetPlaylistDir ?? lib.getVaultDir()
        let safeStem = LibraryService.sanitizeSegment(playlistName, fallback: "Playlist")
        for ext in [".m3u", ".m3u8"] {
            let fullPath = (pDir as NSString).appendingPathComponent("\(safeStem)\(ext)")
            if FileManager.default.fileExists(atPath: fullPath) {
                try? FileManager.default.removeItem(atPath: fullPath)
            }
        }
    }

    public func syncAllPlaylistsM3u() {
        let lib = LibraryService.shared
        lib.initializeIfNeeded()
        let vaultDir = lib.getVaultDir()
        let fm = FileManager.default
        try? fm.createDirectory(atPath: vaultDir, withIntermediateDirectories: true)

        let legacySubdir = (vaultDir as NSString).appendingPathComponent("PLAYLISTS")
        if fm.fileExists(atPath: legacySubdir) {
            try? fm.removeItem(atPath: legacySubdir)
        }

        var validFilenames = Set<String>()
        for pl in lib.playlists.values {
            let m3uName = getPlaylistFilename(pl.name)
            validFilenames.insert(m3uName.lowercased())
            writePlaylistM3u(pl, targetPlaylistDir: vaultDir, audioDir: vaultDir)
        }

        if let entries = try? fm.contentsOfDirectory(atPath: vaultDir) {
            for entry in entries {
                let lower = entry.lowercased()
                let fullPath = (vaultDir as NSString).appendingPathComponent(entry)
                if lower.hasSuffix(".m3u") {
                    if !validFilenames.contains(lower) {
                        try? fm.removeItem(atPath: fullPath)
                    }
                } else if lower.hasSuffix(".m3u8") {
                    try? fm.removeItem(atPath: fullPath)
                }
            }
        }
    }

    public func listPlaylists() -> (playlists: [PlaylistRecord], mostRecentPlaylistId: String?) {
        let lib = LibraryService.shared
        lib.initializeIfNeeded()
        let sorted = lib.playlists.values.sorted { a, b in
            a.name.localizedStandardCompare(b.name) == .orderedAscending
        }
        var recent = lib.mostRecentPlaylistId
        if let r = recent, lib.playlists[r] == nil {
            recent = sorted.first?.id
            lib.mostRecentPlaylistId = recent
            lib.persist()
        } else if recent == nil && !sorted.isEmpty {
            recent = sorted.first?.id
        }
        return (sorted, recent)
    }

    public func listPlaylistsDictionary() -> [String: Any] {
        let res = listPlaylists()
        return [
            "playlists": res.playlists.map { $0.toDictionary() },
            "mostRecentPlaylistId": res.mostRecentPlaylistId as Any
        ]
    }

    private func generateDefaultPlaylistName() -> String {
        let lib = LibraryService.shared
        let existing = Set(lib.playlists.values.map { $0.name.lowercased() })
        var num = lib.playlists.count + 1
        var candidate = String(format: "Playlist %02d", num)
        while existing.contains(candidate.lowercased()) {
            num += 1
            candidate = String(format: "Playlist %02d", num)
        }
        return candidate
    }

    private func generatePlaylistId() -> String {
        let lib = LibraryService.shared
        var idx = lib.playlists.count + 1
        while lib.playlists["pl_\(idx)"] != nil {
            idx += 1
        }
        return "pl_\(idx)"
    }

    public func createPlaylist(rawName: String?) throws -> PlaylistRecord {
        let lib = LibraryService.shared
        lib.initializeIfNeeded()
        let trimmed = (rawName ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let finalName = !trimmed.isEmpty
            ? LibraryService.sanitizeSegment(trimmed, fallback: generateDefaultPlaylistName())
            : generateDefaultPlaylistName()

        if !trimmed.isEmpty && lib.playlists.values.contains(where: { $0.name.lowercased() == finalName.lowercased() }) {
            throw NSError(domain: "PlaylistService", code: 400, userInfo: [NSLocalizedDescriptionKey: "A playlist named \"\(finalName)\" already exists."])
        }

        let id = generatePlaylistId()
        let now = ISO8601DateFormatter().string(from: Date())
        let pl = PlaylistRecord(id: id, name: finalName, createdAt: now, updatedAt: now, trackKeys: [])
        lib.playlists[id] = pl
        lib.mostRecentPlaylistId = id
        lib.persist()
        writePlaylistM3u(pl)
        return pl
    }

    public func renamePlaylist(id: String, rawNewName: String?) throws -> PlaylistRecord {
        let lib = LibraryService.shared
        lib.initializeIfNeeded()
        guard var pl = lib.playlists[id] else {
            throw NSError(domain: "PlaylistService", code: 404, userInfo: [NSLocalizedDescriptionKey: "Playlist not found."])
        }
        let trimmed = (rawNewName ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty {
            throw NSError(domain: "PlaylistService", code: 400, userInfo: [NSLocalizedDescriptionKey: "Playlist name cannot be empty."])
        }
        let sanitized = LibraryService.sanitizeSegment(trimmed, fallback: pl.name)
        if lib.playlists.values.contains(where: { $0.id != id && $0.name.lowercased() == sanitized.lowercased() }) {
            throw NSError(domain: "PlaylistService", code: 400, userInfo: [NSLocalizedDescriptionKey: "A playlist named \"\(sanitized)\" already exists."])
        }

        let oldName = pl.name
        pl.name = sanitized
        pl.updatedAt = ISO8601DateFormatter().string(from: Date())
        lib.playlists[id] = pl
        lib.mostRecentPlaylistId = id

        if getPlaylistFilename(oldName) != getPlaylistFilename(sanitized) {
            deletePlaylistM3u(oldName)
        }
        writePlaylistM3u(pl)
        lib.persist()
        return pl
    }

    public func duplicatePlaylist(id: String) throws -> PlaylistRecord {
        let lib = LibraryService.shared
        lib.initializeIfNeeded()
        guard let source = lib.playlists[id] else {
            throw NSError(domain: "PlaylistService", code: 404, userInfo: [NSLocalizedDescriptionKey: "Source playlist not found."])
        }
        let existing = Set(lib.playlists.values.map { $0.name.lowercased() })
        let baseCopy = LibraryService.sanitizeSegment("\(source.name) Copy", fallback: "Playlist Copy")
        var finalName = baseCopy
        var suffix = 2
        while existing.contains(finalName.lowercased()) {
            finalName = "\(baseCopy) \(suffix)"
            suffix += 1
        }
        let newId = generatePlaylistId()
        let now = ISO8601DateFormatter().string(from: Date())
        let cloned = PlaylistRecord(id: newId, name: finalName, createdAt: now, updatedAt: now, trackKeys: source.trackKeys)
        lib.playlists[newId] = cloned
        lib.mostRecentPlaylistId = newId
        lib.persist()
        writePlaylistM3u(cloned)
        return cloned
    }

    public func deletePlaylist(id: String) throws -> [String: Any] {
        let lib = LibraryService.shared
        lib.initializeIfNeeded()
        guard let pl = lib.playlists[id] else {
            throw NSError(domain: "PlaylistService", code: 404, userInfo: [NSLocalizedDescriptionKey: "Playlist not found."])
        }
        deletePlaylistM3u(pl.name)
        lib.playlists.removeValue(forKey: id)
        if lib.mostRecentPlaylistId == id {
            let remaining = lib.playlists.values.sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
            lib.mostRecentPlaylistId = remaining.first?.id
        }
        lib.persist()
        let listed = listPlaylists()
        return [
            "deletedId": id,
            "name": pl.name,
            "playlists": listed.playlists.map { $0.toDictionary() },
            "mostRecentPlaylistId": listed.mostRecentPlaylistId as Any
        ]
    }

    public func addTrackToPlaylist(id: String, trackKey: String) throws -> [String: Any] {
        let lib = LibraryService.shared
        lib.initializeIfNeeded()
        guard var pl = lib.playlists[id] else {
            throw NSError(domain: "PlaylistService", code: 404, userInfo: [NSLocalizedDescriptionKey: "Playlist not found."])
        }
        if trackKey.isEmpty {
            throw NSError(domain: "PlaylistService", code: 400, userInfo: [NSLocalizedDescriptionKey: "Valid trackKey is required."])
        }
        let alreadyExists = pl.trackKeys.contains(trackKey)
        if !alreadyExists {
            pl.trackKeys.append(trackKey)
            pl.updatedAt = ISO8601DateFormatter().string(from: Date())
            lib.playlists[id] = pl
        }
        lib.mostRecentPlaylistId = id
        lib.persist()
        writePlaylistM3u(pl)
        let listed = listPlaylists()
        let track = lib.getTrackByKey(trackKey)
        return [
            "playlist": pl.toDictionary(),
            "alreadyExists": alreadyExists,
            "playlists": listed.playlists.map { $0.toDictionary() },
            "mostRecentPlaylistId": listed.mostRecentPlaylistId as Any,
            "track": track?.toDictionary() as Any
        ]
    }

    public func removeTrackFromPlaylist(id: String, trackKey: String) throws -> [String: Any] {
        let lib = LibraryService.shared
        lib.initializeIfNeeded()
        guard var pl = lib.playlists[id] else {
            throw NSError(domain: "PlaylistService", code: 404, userInfo: [NSLocalizedDescriptionKey: "Playlist not found."])
        }
        let beforeLen = pl.trackKeys.count
        pl.trackKeys.removeAll { $0 == trackKey }
        let removed = pl.trackKeys.count != beforeLen
        if removed {
            pl.updatedAt = ISO8601DateFormatter().string(from: Date())
            lib.playlists[id] = pl
        }
        lib.persist()
        writePlaylistM3u(pl)
        let listed = listPlaylists()
        let track = lib.getTrackByKey(trackKey)
        return [
            "playlist": pl.toDictionary(),
            "removed": removed,
            "playlists": listed.playlists.map { $0.toDictionary() },
            "mostRecentPlaylistId": listed.mostRecentPlaylistId as Any,
            "track": track?.toDictionary() as Any
        ]
    }

    public func reorderPlaylistTracks(id: String, trackKeys: [String]?, fromIndex: Int?, toIndex: Int?) throws -> PlaylistRecord {
        let lib = LibraryService.shared
        lib.initializeIfNeeded()
        guard var pl = lib.playlists[id] else {
            throw NSError(domain: "PlaylistService", code: 404, userInfo: [NSLocalizedDescriptionKey: "Playlist not found."])
        }
        var currentKeys = pl.trackKeys
        if let incoming = trackKeys {
            guard incoming.count == currentKeys.count, Set(incoming) == Set(currentKeys) else {
                throw NSError(domain: "PlaylistService", code: 400, userInfo: [NSLocalizedDescriptionKey: "Invalid reorder payload."])
            }
            pl.trackKeys = incoming
        } else if let fromIdx = fromIndex, let toIdx = toIndex {
            guard fromIdx >= 0 && fromIdx < currentKeys.count && toIdx >= 0 && toIdx < currentKeys.count else {
                throw NSError(domain: "PlaylistService", code: 400, userInfo: [NSLocalizedDescriptionKey: "Invalid fromIndex or toIndex bounds."])
            }
            if fromIdx != toIdx {
                let moved = currentKeys.remove(at: fromIdx)
                currentKeys.insert(moved, at: toIdx)
                pl.trackKeys = currentKeys
            }
        } else {
            throw NSError(domain: "PlaylistService", code: 400, userInfo: [NSLocalizedDescriptionKey: "Provide either trackKeys or fromIndex/toIndex."])
        }
        pl.updatedAt = ISO8601DateFormatter().string(from: Date())
        lib.playlists[id] = pl
        lib.persist()
        writePlaylistM3u(pl)
        return pl
    }

    public func movePlaylistTrack(id: String, trackKey: String, direction: String) throws -> PlaylistRecord {
        let lib = LibraryService.shared
        lib.initializeIfNeeded()
        guard var pl = lib.playlists[id] else {
            throw NSError(domain: "PlaylistService", code: 404, userInfo: [NSLocalizedDescriptionKey: "Playlist not found."])
        }
        guard direction == "up" || direction == "down" else {
            throw NSError(domain: "PlaylistService", code: 400, userInfo: [NSLocalizedDescriptionKey: "Direction must be up or down."])
        }
        guard let currentIndex = pl.trackKeys.firstIndex(of: trackKey) else {
            throw NSError(domain: "PlaylistService", code: 404, userInfo: [NSLocalizedDescriptionKey: "Track not found in playlist."])
        }
        var targetIndex = currentIndex
        if direction == "up" && currentIndex > 0 {
            targetIndex = currentIndex - 1
        } else if direction == "down" && currentIndex < pl.trackKeys.count - 1 {
            targetIndex = currentIndex + 1
        }
        if targetIndex != currentIndex {
            pl.trackKeys.swapAt(currentIndex, targetIndex)
            pl.updatedAt = ISO8601DateFormatter().string(from: Date())
            lib.playlists[id] = pl
            lib.persist()
            writePlaylistM3u(pl)
        }
        return pl
    }
}
