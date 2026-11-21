import Foundation
import AVFoundation
import CryptoKit

// MARK: - SSE Event Broadcaster
public final class SSEEventBus: @unchecked Sendable {
    public static let shared = SSEEventBus()
    private let lock = NSLock()
    private var handler: ((_ channel: String, _ payload: [String: Any]) -> Void)?

    public func setHandler(_ handler: @escaping (_ channel: String, _ payload: [String: Any]) -> Void) {
        lock.lock()
        self.handler = handler
        lock.unlock()
    }

    public func emit(channel: String, payload: [String: Any]) {
        lock.lock()
        let h = self.handler
        lock.unlock()
        h?(channel, payload)
    }
}

// MARK: - Codable Data Models
public struct VaultConfig: Codable, Sendable {
    public var sourcePath: String
    public var vaultPath: String
    public var sdCardPath: String
    public var exportPlaylistFolders: Bool
    public var syncTargetMode: String
    public var ftpServiceName: String
    public var ftpManualHost: String
    public var ftpManualPort: Int
    public var ftpUsername: String
    public var ftpPassword: String
    public var ftpRemotePath: String

    public init(
        sourcePath: String,
        vaultPath: String,
        sdCardPath: String = "",
        exportPlaylistFolders: Bool = false,
        syncTargetMode: String = "sd",
        ftpServiceName: String = "WiFiFTP",
        ftpManualHost: String = "",
        ftpManualPort: Int = 2121,
        ftpUsername: String = "",
        ftpPassword: String = "",
        ftpRemotePath: String = "/"
    ) {
        self.sourcePath = sourcePath
        self.vaultPath = vaultPath
        self.sdCardPath = sdCardPath
        self.exportPlaylistFolders = exportPlaylistFolders
        self.syncTargetMode = syncTargetMode
        self.ftpServiceName = ftpServiceName
        self.ftpManualHost = ftpManualHost
        self.ftpManualPort = ftpManualPort
        self.ftpUsername = ftpUsername
        self.ftpPassword = ftpPassword
        self.ftpRemotePath = ftpRemotePath
    }

    enum CodingKeys: String, CodingKey {
        case sourcePath
        case vaultPath
        case sdCardPath
        case exportPlaylistFolders
        case syncTargetMode
        case ftpServiceName
        case ftpManualHost
        case ftpManualPort
        case ftpUsername
        case ftpPassword
        case ftpRemotePath
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        let defaultSource = (home as NSString).appendingPathComponent("Music/Music/Media.localized/Music")
        let defaultVault = (home as NSString).appendingPathComponent("Music/AudiophileVault")
        self.sourcePath = LibraryService.expandTilde((try? c.decode(String.self, forKey: .sourcePath)) ?? defaultSource)
        self.vaultPath = LibraryService.expandTilde((try? c.decode(String.self, forKey: .vaultPath)) ?? defaultVault)
        let sd = (try? c.decode(String.self, forKey: .sdCardPath)) ?? ""
        self.sdCardPath = sd
        if let exp = try? c.decode(Bool.self, forKey: .exportPlaylistFolders) {
            self.exportPlaylistFolders = exp
        } else {
            self.exportPlaylistFolders = LibraryService.isSnowskyVolumePath(sd)
        }
        let mode = (try? c.decode(String.self, forKey: .syncTargetMode)) ?? "sd"
        self.syncTargetMode = (mode == "ftp") ? "ftp" : "sd"
        self.ftpServiceName = (try? c.decode(String.self, forKey: .ftpServiceName)) ?? "WiFiFTP"
        self.ftpManualHost = (try? c.decode(String.self, forKey: .ftpManualHost)) ?? ""
        let port = (try? c.decode(Int.self, forKey: .ftpManualPort)) ?? 2121
        self.ftpManualPort = port > 0 ? port : 2121
        self.ftpUsername = (try? c.decode(String.self, forKey: .ftpUsername)) ?? ""
        self.ftpPassword = (try? c.decode(String.self, forKey: .ftpPassword)) ?? ""
        let rPath = (try? c.decode(String.self, forKey: .ftpRemotePath)) ?? "/"
        self.ftpRemotePath = rPath.isEmpty ? "/" : rPath
    }
}

public struct TrackRecord: Codable, Sendable {
    public var id: String
    public var sha256: String
    public var filename: String
    public var baseName: String
    public var artist: String
    public var albumArtist: String?
    public var trackArtist: String?
    public var compilation: Bool?
    public var album: String
    public var title: String
    public var discTrack: String
    public var discNo: Int
    public var discNumber: Int
    public var trackNo: String
    public var `extension`: String
    public var fileSize: Int64
    public var duration: Double
    public var normalizedKey: String
    public var trackKey: String
    public var addedDate: String
    public var artworkFilename: String
    public var hasArtwork: Bool
    public var artworkEmbedded: Bool?
    public var albumGroupKey: String
    public var artworkUpdatedAt: Int64?
    public var updatedAt: Int64?

    enum CodingKeys: String, CodingKey {
        case id, sha256, filename, baseName, artist, albumArtist, trackArtist, compilation
        case album, title, discTrack, discNo, discNumber, trackNo
        case `extension` = "extension"
        case fileSize, duration, normalizedKey, trackKey, addedDate
        case artworkFilename, hasArtwork, artworkEmbedded, albumGroupKey
        case artworkUpdatedAt, updatedAt
    }

    public init(
        id: String,
        sha256: String,
        filename: String,
        baseName: String,
        artist: String,
        albumArtist: String? = nil,
        trackArtist: String? = nil,
        compilation: Bool? = false,
        album: String,
        title: String,
        discTrack: String,
        discNo: Int,
        discNumber: Int,
        trackNo: String,
        extension ext: String,
        fileSize: Int64,
        duration: Double,
        normalizedKey: String,
        trackKey: String,
        addedDate: String,
        artworkFilename: String,
        hasArtwork: Bool,
        artworkEmbedded: Bool? = nil,
        albumGroupKey: String,
        artworkUpdatedAt: Int64? = nil,
        updatedAt: Int64? = nil
    ) {
        self.id = id
        self.sha256 = sha256
        self.filename = filename
        self.baseName = baseName
        self.artist = artist
        self.albumArtist = albumArtist
        self.trackArtist = trackArtist
        self.compilation = compilation
        self.album = album
        self.title = title
        self.discTrack = discTrack
        self.discNo = discNo
        self.discNumber = discNumber
        self.trackNo = trackNo
        self.extension = ext
        self.fileSize = fileSize
        self.duration = duration
        self.normalizedKey = normalizedKey
        self.trackKey = trackKey
        self.addedDate = addedDate
        self.artworkFilename = artworkFilename
        self.hasArtwork = hasArtwork
        self.artworkEmbedded = artworkEmbedded
        self.albumGroupKey = albumGroupKey
        self.artworkUpdatedAt = artworkUpdatedAt
        self.updatedAt = updatedAt
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let fname = (try? c.decode(String.self, forKey: .filename)) ?? ""
        self.filename = fname
        self.id = (try? c.decode(String.self, forKey: .id)) ?? ""
        self.sha256 = (try? c.decode(String.self, forKey: .sha256)) ?? ""
        self.baseName = (try? c.decode(String.self, forKey: .baseName)) ?? LibraryService.getTrackBaseNameFromFilename(fname)
        self.artist = (try? c.decode(String.self, forKey: .artist)) ?? "Unknown Artist"
        self.albumArtist = try? c.decodeIfPresent(String.self, forKey: .albumArtist)
        self.trackArtist = try? c.decodeIfPresent(String.self, forKey: .trackArtist)
        self.compilation = try? c.decodeIfPresent(Bool.self, forKey: .compilation)
        self.album = (try? c.decode(String.self, forKey: .album)) ?? "Unknown Album"
        self.title = (try? c.decode(String.self, forKey: .title)) ?? self.baseName
        self.discTrack = (try? c.decode(String.self, forKey: .discTrack)) ?? "101"
        let dNo = (try? c.decode(Int.self, forKey: .discNo)) ?? 1
        let dNum = (try? c.decode(Int.self, forKey: .discNumber)) ?? dNo
        self.discNo = dNo
        self.discNumber = dNum > 0 ? dNum : 1
        self.trackNo = (try? c.decode(String.self, forKey: .trackNo)) ?? "01"
        self.extension = (try? c.decode(String.self, forKey: .extension)) ?? ((fname as NSString).pathExtension.lowercased())
        self.fileSize = (try? c.decode(Int64.self, forKey: .fileSize)) ?? 0
        self.duration = (try? c.decode(Double.self, forKey: .duration)) ?? 0
        let normKey = (try? c.decode(String.self, forKey: .normalizedKey)) ?? LibraryService.buildNormalizedKey(artist: self.artist, album: self.album, discTrack: self.discTrack, title: self.title)
        self.normalizedKey = normKey
        self.trackKey = (try? c.decode(String.self, forKey: .trackKey)) ?? normKey
        self.addedDate = (try? c.decode(String.self, forKey: .addedDate)) ?? ""
        self.artworkFilename = (try? c.decode(String.self, forKey: .artworkFilename)) ?? LibraryService.getCompanionJpgFilename(fname)
        let hasArt = (try? c.decode(Bool.self, forKey: .hasArtwork)) ?? false
        self.hasArtwork = hasArt
        self.artworkEmbedded = (try? c.decodeIfPresent(Bool.self, forKey: .artworkEmbedded)) ?? hasArt
        self.albumGroupKey = (try? c.decode(String.self, forKey: .albumGroupKey)) ?? ""
        self.artworkUpdatedAt = try? c.decodeIfPresent(Int64.self, forKey: .artworkUpdatedAt)
        self.updatedAt = try? c.decodeIfPresent(Int64.self, forKey: .updatedAt)
        if self.albumGroupKey.isEmpty {
            self.albumGroupKey = LibraryService.getAlbumGroupKey(for: self)
        }
    }

    public func toDictionary() -> [String: Any] {
        var dict: [String: Any] = [
            "id": id,
            "sha256": sha256,
            "filename": filename,
            "baseName": baseName,
            "artist": artist,
            "album": album,
            "title": title,
            "discTrack": discTrack,
            "discNo": discNo,
            "discNumber": discNumber,
            "trackNo": trackNo,
            "extension": `extension`,
            "fileSize": fileSize,
            "duration": duration,
            "normalizedKey": normalizedKey,
            "trackKey": trackKey,
            "addedDate": addedDate,
            "artworkFilename": artworkFilename,
            "hasArtwork": hasArtwork,
            "artworkEmbedded": artworkEmbedded ?? hasArtwork,
            "albumGroupKey": albumGroupKey
        ]
        if let albumArtist = albumArtist { dict["albumArtist"] = albumArtist }
        if let trackArtist = trackArtist { dict["trackArtist"] = trackArtist }
        if let compilation = compilation { dict["compilation"] = compilation }
        if let artworkUpdatedAt = artworkUpdatedAt { dict["artworkUpdatedAt"] = artworkUpdatedAt }
        if let updatedAt = updatedAt { dict["updatedAt"] = updatedAt }
        return dict
    }
}

public struct PlaylistRecord: Codable, Sendable {
    public var id: String
    public var name: String
    public var createdAt: String
    public var updatedAt: String
    public var trackKeys: [String]

    public init(id: String, name: String, createdAt: String, updatedAt: String, trackKeys: [String]) {
        self.id = id
        self.name = name
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.trackKeys = trackKeys
    }

    public func toDictionary() -> [String: Any] {
        return [
            "id": id,
            "name": name,
            "createdAt": createdAt,
            "updatedAt": updatedAt,
            "trackKeys": trackKeys
        ]
    }
}

public struct VaultIndexFile: Codable, Sendable {
    public var updatedAt: String?
    public var config: VaultConfig?
    public var tracks: [String: TrackRecord]?
    public var hashes: [String]?
    public var playlists: [String: PlaylistRecord]?
    public var mostRecentPlaylistId: String?
}

// MARK: - LibraryService
public final class LibraryService: @unchecked Sendable {
    public static let shared = LibraryService()

    public static let supportedExtensions: Set<String> = [
        ".mp3", ".m4a", ".flac", ".alac", ".wav", ".aiff", ".aac"
    ]
    public static let drmExtensions: Set<String> = [".m4p", ".wma", ".aa", ".aax"]

    private static let genericAlbumTitles: Set<String> = [
        "", "unknown album", "unknown", "greatest hits", "the greatest hits",
        "best of", "the best of", "the very best of", "live", "unplugged",
        "anthology", "collection", "platinum & gold collection", "20th century masters"
    ]

    private let lock = NSRecursiveLock()
    public var config: VaultConfig
    public var tracksMap: [String: TrackRecord] = [:]
    public var hashes: [String] = []
    public var playlists: [String: PlaylistRecord] = [:]
    public var mostRecentPlaylistId: String? = nil

    private var hashSet: Set<String> = []
    private var keySet: Set<String> = []
    private var filenameSet: Set<String> = []
    private var baseNameSet: Set<String> = []
    private var initialized = false
    private var lastSyncDiskTime: TimeInterval = 0

    // Ingest state
    private var isIngesting = false
    private var currentRunId = 0
    private var recentIngestEvents: [[String: Any]] = []
    private let maxRecentEvents = 400

    private let appDataDir: String
    private let configBootstrapFile: String

    private init() {
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        let defaultAppDir = (home as NSString).appendingPathComponent(".audiophile-vault")
        try? FileManager.default.createDirectory(atPath: defaultAppDir, withIntermediateDirectories: true)
        self.appDataDir = defaultAppDir
        self.configBootstrapFile = (defaultAppDir as NSString).appendingPathComponent("config.json")
        self.config = VaultConfig(
            sourcePath: (home as NSString).appendingPathComponent("Music/Music/Media.localized/Music"),
            vaultPath: (home as NSString).appendingPathComponent("Music/AudiophileVault"),
            sdCardPath: ProcessInfo.processInfo.environment["AV_TARGET_SD_PATH"] ?? "",
            exportPlaylistFolders: false
        )
    }

    // MARK: - Path & Grouping Utilities
    public static func expandTilde(_ rawPath: String?) -> String {
        guard let rawPath = rawPath else { return "" }
        var cleaned = rawPath.trimmingCharacters(in: .whitespacesAndNewlines)
        if cleaned.isEmpty { return "" }

        if let regex = try? NSRegularExpression(pattern: #"['"](\/(?:Users|Volumes|System|Library|private|tmp|var|opt)\/[^'"]+)['"]$"#),
           let match = regex.firstMatch(in: cleaned, range: NSRange(cleaned.startIndex..., in: cleaned)),
           let range = Range(match.range(at: 1), in: cleaned) {
            cleaned = String(cleaned[range]).trimmingCharacters(in: .whitespacesAndNewlines)
        }

        while (cleaned.hasPrefix("'") && cleaned.hasSuffix("'")) ||
              (cleaned.hasPrefix("\"") && cleaned.hasSuffix("\"")) {
            cleaned = String(cleaned.dropFirst().dropLast()).trimmingCharacters(in: .whitespacesAndNewlines)
        }

        cleaned = cleaned.replacingOccurrences(of: "\\ ", with: " ")
        if cleaned.isEmpty { return "" }

        let home = FileManager.default.homeDirectoryForCurrentUser.path
        if cleaned == "~" { return home }
        if cleaned.hasPrefix("~/") {
            return (home as NSString).appendingPathComponent(String(cleaned.dropFirst(2)))
        }
        if cleaned.hasPrefix("Users/") || cleaned.hasPrefix("Volumes/") {
            cleaned = "/" + cleaned
        }
        if !cleaned.hasPrefix("/") {
            return (home as NSString).appendingPathComponent(cleaned)
        }
        return (cleaned as NSString).standardizingPath
    }

    public static func sanitizeSegment(_ input: String?, fallback: String = "Unknown") -> String {
        guard let input = input, !input.isEmpty else { return fallback }
        var s = input.replacingOccurrences(of: #"[/\\:*?"<>|\x00-\x1F]"#, with: "-", options: .regularExpression)
        s = s.replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
        s = s.replacingOccurrences(of: #"-+"#, with: "-", options: .regularExpression)
        s = s.replacingOccurrences(of: #"^[\s.-]+|[\s.-]+$"#, with: "", options: .regularExpression)
        s = s.trimmingCharacters(in: .whitespacesAndNewlines)
        return s.isEmpty ? fallback : s
    }

    public static func buildNormalizedKey(artist: String, album: String, discTrack: String, title: String) -> String {
        func clean(_ str: String) -> String {
            return str
                .lowercased()
                .replacingOccurrences(of: "’", with: "'")
                .replacingOccurrences(of: "‘", with: "'")
                .replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
                .trimmingCharacters(in: .whitespacesAndNewlines)
        }
        let dt = discTrack.isEmpty ? "101" : discTrack
        let padded = dt.count < 3 ? String(repeating: "0", count: 3 - dt.count) + dt : dt
        return "\(clean(artist))|\(clean(album))|\(padded)|\(clean(title))"
    }

    public static func getVolumeNameFromPath(_ targetPath: String?) -> String {
        guard let targetPath = targetPath else { return "" }
        let cleaned = targetPath.trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: #"/+$"#, with: "", options: .regularExpression)
        if cleaned.isEmpty { return "" }
        let base = (cleaned as NSString).lastPathComponent
        if base.lowercased() == "music" {
            return ((cleaned as NSString).deletingLastPathComponent as NSString).lastPathComponent
        }
        return base
    }

    public static func isSnowskyVolumePath(_ targetPath: String?) -> Bool {
        let vol = getVolumeNameFromPath(targetPath)
        return !vol.isEmpty && vol.range(of: "snowsky", options: .caseInsensitive) != nil
    }

    public static func getTrackBaseNameFromFilename(_ filename: String) -> String {
        return (filename as NSString).deletingPathExtension
    }

    public static func getCompanionJpgFilename(_ filename: String) -> String {
        let base = getTrackBaseNameFromFilename(filename)
        return base.isEmpty ? "" : "\(base).jpg"
    }

    public static func cleanArtistForGrouping(_ rawArtist: String?) -> String {
        guard let rawArtist = rawArtist, !rawArtist.isEmpty else { return "unknown artist" }
        let s = rawArtist.precomposedStringWithCanonicalMapping
            .replacingOccurrences(of: "[’‘`]", with: "'", options: .regularExpression)
            .replacingOccurrences(of: "[“”]", with: "\"", options: .regularExpression)
            .replacingOccurrences(of: #"\s*[\(\[](?:feat\.?|ft\.?|featuring|with)\s+[^)\]]+[\)\]]"#, with: "", options: [.regularExpression, .caseInsensitive])
            .replacingOccurrences(of: #"\s+\b(?:feat\.?|ft\.?|featuring)\s+.*$"#, with: "", options: [.regularExpression, .caseInsensitive])
            .replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
        return s.isEmpty ? "unknown artist" : s
    }

    public static func cleanAlbumForGrouping(_ rawAlbum: String?) -> String {
        guard let rawAlbum = rawAlbum, !rawAlbum.isEmpty else { return "unknown album" }
        let s = rawAlbum.precomposedStringWithCanonicalMapping
            .replacingOccurrences(of: "[’‘`]", with: "'", options: .regularExpression)
            .replacingOccurrences(of: "[“”]", with: "\"", options: .regularExpression)
            .replacingOccurrences(of: #"\s*[\(\[](?:disc|cd|disk)\s*\d+[^)\]]*[\)\]]"#, with: "", options: [.regularExpression, .caseInsensitive])
            .replacingOccurrences(of: #"\s*[-–—:]\s*(?:disc|cd|disk)\s*\d+\b.*$"#, with: "", options: [.regularExpression, .caseInsensitive])
            .replacingOccurrences(of: #"\s*[\(\[][^)\]]*\b(?:remaster(?:ed)?|deluxe|expanded|anniversary|special\s+edition|bonus\s+track|reissue|explicit|mono|stereo)\b[^)\]]*[\)\]]"#, with: "", options: [.regularExpression, .caseInsensitive])
            .replacingOccurrences(of: #"\s*[:\-–—]+\s*"#, with: " - ", options: .regularExpression)
            .replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
            .replacingOccurrences(of: #"[\s\-–—:]+$"#, with: "", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
        return s.isEmpty ? "unknown album" : s
    }

    public static func getTrackDiscNumber(_ track: TrackRecord) -> Int {
        if track.discNumber > 0 { return track.discNumber }
        if track.discNo > 0 { return track.discNo }
        if let dt = Int(track.discTrack), dt >= 100 {
            let d = dt / 100
            if d > 0 { return d }
        }
        return 1
    }

    public static func getAlbumGroupKey(for track: TrackRecord, includeDisc: Bool = false) -> String {
        let rawAlbumArtist = (track.albumArtist ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let rawArtist = track.artist.trimmingCharacters(in: .whitespacesAndNewlines)
        let isComp = (track.compilation == true) ||
            rawAlbumArtist.range(of: #"^various(\s+artists)?$"#, options: [.regularExpression, .caseInsensitive]) != nil ||
            rawArtist.range(of: #"^various(\s+artists)?$"#, options: [.regularExpression, .caseInsensitive]) != nil

        let anchorArtist = isComp ? "various artists" : cleanArtistForGrouping(rawAlbumArtist.isEmpty ? rawArtist : rawAlbumArtist)
        let cleanAlbum = cleanAlbumForGrouping(track.album)
        let baseKey = "\(anchorArtist)|\(cleanAlbum)"
        if includeDisc {
            return "\(baseKey)|disc:\(getTrackDiscNumber(track))"
        }
        return baseKey
    }

    public static func findAlbumSiblingTracks(
        _ tracksList: [TrackRecord],
        referenceArtist: String,
        referenceAlbum: String,
        referenceAlbumArtist: String? = nil,
        referenceCompilation: Bool? = false,
        referenceDiscNumber: Int = 1,
        includeDisc: Bool = false
    ) -> [TrackRecord] {
        let dummyRef = TrackRecord(
            id: "", sha256: "", filename: "", baseName: "",
            artist: referenceArtist, albumArtist: referenceAlbumArtist,
            trackArtist: referenceArtist, compilation: referenceCompilation,
            album: referenceAlbum, title: "", discTrack: "\(referenceDiscNumber)01",
            discNo: referenceDiscNumber, discNumber: referenceDiscNumber,
            trackNo: "01", extension: "m4a", fileSize: 0, duration: 0,
            normalizedKey: "", trackKey: "", addedDate: "",
            artworkFilename: "", hasArtwork: false, albumGroupKey: ""
        )
        let targetGroupKey = getAlbumGroupKey(for: dummyRef, includeDisc: includeDisc)
        let targetCleanAlbum = cleanAlbumForGrouping(referenceAlbum)
        let isSpecificAlbumTitle = targetCleanAlbum.count >= 4 && !genericAlbumTitles.contains(targetCleanAlbum)

        return tracksList.filter { t in
            if getAlbumGroupKey(for: t, includeDisc: includeDisc) == targetGroupKey {
                return true
            }
            if isSpecificAlbumTitle {
                let candidateAlbum = cleanAlbumForGrouping(t.album)
                if candidateAlbum == targetCleanAlbum {
                    if includeDisc && getTrackDiscNumber(t) != referenceDiscNumber {
                        return false
                    }
                    return true
                }
            }
            return false
        }
    }

    // MARK: - Initialization & Persistence
    public func getVaultDir() -> String {
        lock.lock()
        defer { lock.unlock() }
        let raw = Self.expandTilde(config.vaultPath)
        if raw.range(of: #"/playlists?/?$"#, options: [.regularExpression, .caseInsensitive]) != nil {
            let trimmed = raw.replacingOccurrences(of: #"/+$"#, with: "", options: .regularExpression)
            return (trimmed as NSString).deletingLastPathComponent
        }
        return raw
    }

    public func getVaultIndexPath() -> String {
        let vaultDir = getVaultDir()
        do {
            try FileManager.default.createDirectory(atPath: vaultDir, withIntermediateDirectories: true)
            return (vaultDir as NSString).appendingPathComponent(".vault_index.json")
        } catch {
            return (appDataDir as NSString).appendingPathComponent(".vault_index.json")
        }
    }

    public func initializeIfNeeded() {
        lock.lock()
        defer { lock.unlock() }
        if initialized { return }

        // 1. Load bootstrap config.json if present
        if FileManager.default.fileExists(atPath: configBootstrapFile),
           let data = try? Data(contentsOf: URL(fileURLWithPath: configBootstrapFile)),
           let bootstrapCfg = try? JSONDecoder().decode(VaultConfig.self, from: data) {
            self.config = bootstrapCfg
        }

        // 2. Load .vault_index.json
        let indexPath = getVaultIndexPath()
        if FileManager.default.fileExists(atPath: indexPath),
           let data = try? Data(contentsOf: URL(fileURLWithPath: indexPath)),
           let parsed = try? JSONDecoder().decode(VaultIndexFile.self, from: data) {
            if let cfg = parsed.config {
                self.config = cfg
            }
            if let tracks = parsed.tracks {
                self.tracksMap = tracks
            }
            if let h = parsed.hashes {
                self.hashes = h
            }
            if let pls = parsed.playlists {
                self.playlists = pls
            }
            self.mostRecentPlaylistId = parsed.mostRecentPlaylistId
        } else {
            persist()
        }

        rebuildIndexes()
        initialized = true
    }

    public func rebuildIndexes() {
        lock.lock()
        defer { lock.unlock() }
        hashSet.removeAll()
        keySet.removeAll()
        filenameSet.removeAll()
        baseNameSet.removeAll()

        for h in hashes where !h.isEmpty {
            hashSet.insert(h)
        }
        for (key, track) in tracksMap {
            if !track.sha256.isEmpty { hashSet.insert(track.sha256) }
            keySet.insert(key)
            if !track.normalizedKey.isEmpty { keySet.insert(track.normalizedKey) }
            if !track.filename.isEmpty {
                filenameSet.insert(track.filename.lowercased())
                baseNameSet.insert(Self.getTrackBaseNameFromFilename(track.filename).lowercased())
            }
            if !track.baseName.isEmpty {
                baseNameSet.insert(track.baseName.lowercased())
            }
        }
        hashes = Array(hashSet)
    }

    public func persist() {
        lock.lock()
        defer { lock.unlock() }
        let vaultDir = getVaultDir()
        try? FileManager.default.createDirectory(atPath: vaultDir, withIntermediateDirectories: true)
        hashes = Array(hashSet)

        let isoNow = ISO8601DateFormatter().string(from: Date())
        let indexFile = VaultIndexFile(
            updatedAt: isoNow,
            config: config,
            tracks: tracksMap,
            hashes: hashes,
            playlists: playlists,
            mostRecentPlaylistId: mostRecentPlaylistId
        )

        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]

        if let payload = try? encoder.encode(indexFile) {
            let targetIndexPath = getVaultIndexPath()
            let tmpIndexPath = targetIndexPath + ".tmp"
            try? payload.write(to: URL(fileURLWithPath: tmpIndexPath), options: .atomic)
            _ = try? FileManager.default.replaceItemAt(
                URL(fileURLWithPath: targetIndexPath),
                withItemAt: URL(fileURLWithPath: tmpIndexPath)
            )
        }

        if let cfgPayload = try? encoder.encode(config) {
            let tmpCfgPath = configBootstrapFile + ".tmp"
            try? cfgPayload.write(to: URL(fileURLWithPath: tmpCfgPath), options: .atomic)
            _ = try? FileManager.default.replaceItemAt(
                URL(fileURLWithPath: configBootstrapFile),
                withItemAt: URL(fileURLWithPath: tmpCfgPath)
            )
        }
    }

    public func syncVaultOnDisk(force: Bool = false) {
        lock.lock()
        defer { lock.unlock() }
        initializeIfNeeded()

        let now = Date().timeIntervalSince1970
        if !force && (now - lastSyncDiskTime) < 2.0 {
            return
        }
        lastSyncDiskTime = now

        let vaultDir = getVaultDir()
        guard let entries = try? FileManager.default.contentsOfDirectory(atPath: vaultDir) else {
            return
        }

        var removedTmp = false
        for name in entries {
            if !name.hasPrefix(".") && name.range(of: #"\.tmp(\.[a-z0-9]+)?$"#, options: [.regularExpression, .caseInsensitive]) != nil {
                let fullTmp = (vaultDir as NSString).appendingPathComponent(name)
                try? FileManager.default.removeItem(atPath: fullTmp)
                removedTmp = true
            }
        }

        let refreshed = removedTmp ? ((try? FileManager.default.contentsOfDirectory(atPath: vaultDir)) ?? entries) : entries
        var onDiskSet = Set<String>()
        for entry in refreshed {
            onDiskSet.insert(entry.lowercased())
            onDiskSet.insert(entry.precomposedStringWithCanonicalMapping.lowercased())
        }

        var changed = false
        for (key, var track) in tracksMap {
            let fname = track.filename
            let normFname = fname.precomposedStringWithCanonicalMapping.lowercased()
            if !onDiskSet.contains(fname.lowercased()) && !onDiskSet.contains(normFname) {
                tracksMap.removeValue(forKey: key)
                changed = true
                continue
            }
            let base = Self.getTrackBaseNameFromFilename(fname)
            if track.baseName != base {
                track.baseName = base
                tracksMap[key] = track
                changed = true
            }
        }

        if changed {
            rebuildIndexes()
            persist()
        }
    }

    // MARK: - Queries & Config Updates
    public func getAllTracksArray() -> [TrackRecord] {
        lock.lock()
        defer { lock.unlock() }
        initializeIfNeeded()
        return tracksMap.values.sorted { a, b in
            return b.addedDate.localizedStandardCompare(a.addedDate) == .orderedAscending
        }
    }

    public func getTrackByKey(_ key: String) -> TrackRecord? {
        lock.lock()
        defer { lock.unlock() }
        initializeIfNeeded()
        return tracksMap[key]
    }

    public func getTracks(search: String = "") -> [TrackRecord] {
        let all = getAllTracksArray()
        let q = search.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if q.isEmpty { return all }
        return all.filter { t in
            t.title.lowercased().contains(q) ||
            t.artist.lowercased().contains(q) ||
            t.album.lowercased().contains(q) ||
            t.filename.lowercased().contains(q) ||
            t.discTrack.lowercased().contains(q)
        }
    }

    public func getConfigDictionary() -> [String: Any] {
        lock.lock()
        defer { lock.unlock() }
        initializeIfNeeded()
        let tracksArr = getAllTracksArray()
        let totalTracks = tracksArr.count
        let totalBytes = tracksArr.reduce(Int64(0)) { $0 + $1.fileSize }
        let totalSizeGB = ((Double(totalBytes) / pow(1024.0, 3.0)) * 1000.0).rounded() / 1000.0
        let tracksWithArtwork = tracksArr.filter { $0.hasArtwork }.count

        return [
            "sourcePath": config.sourcePath,
            "vaultPath": config.vaultPath,
            "sdCardPath": config.sdCardPath,
            "targetPath": config.sdCardPath,
            "exportPlaylistFolders": config.exportPlaylistFolders,
            "syncTargetMode": config.syncTargetMode,
            "ftpServiceName": config.ftpServiceName,
            "ftpManualHost": config.ftpManualHost,
            "ftpManualPort": config.ftpManualPort,
            "ftpUsername": config.ftpUsername,
            "ftpPassword": config.ftpPassword,
            "ftpRemotePath": config.ftpRemotePath,
            "registryPath": getVaultIndexPath(),
            "stats": [
                "totalTracks": totalTracks,
                "totalBytes": totalBytes,
                "totalSizeGB": totalSizeGB,
                "tracksWithArtwork": tracksWithArtwork
            ],
            "status": [
                "isIngesting": isIngesting,
                "runId": currentRunId,
                "isSyncing": VolumeAndSyncService.shared.getIsSyncing(),
                "isFetchingArtwork": ArtworkAndTagService.shared.getIsFetchingArtwork()
            ]
        ]
    }

    @discardableResult
    public func updateConfig(_ partial: [String: Any]) -> [String: Any] {
        lock.lock()
        defer { lock.unlock() }
        initializeIfNeeded()

        if let sourcePath = partial["sourcePath"] as? String, !sourcePath.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            config.sourcePath = Self.expandTilde(sourcePath)
        }
        if let vaultPath = partial["vaultPath"] as? String, !vaultPath.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            config.vaultPath = Self.expandTilde(vaultPath)
            try? FileManager.default.createDirectory(atPath: getVaultDir(), withIntermediateDirectories: true)
        }

        let targetInput = (partial["targetPath"] as? String) ?? (partial["sdCardPath"] as? String)
        if let targetInput = targetInput {
            let prevVol = Self.getVolumeNameFromPath(config.sdCardPath)
            let nextTarget = targetInput.trimmingCharacters(in: .whitespacesAndNewlines)
            let nextVol = Self.getVolumeNameFromPath(nextTarget)
            config.sdCardPath = nextTarget

            if partial["exportPlaylistFolders"] == nil && nextVol != prevVol {
                config.exportPlaylistFolders = Self.isSnowskyVolumePath(nextTarget)
            }
        }

        if let exp = partial["exportPlaylistFolders"] as? Bool {
            config.exportPlaylistFolders = exp
        }

        if let mode = partial["syncTargetMode"] as? String {
            config.syncTargetMode = (mode == "ftp") ? "ftp" : "sd"
        }
        if let svc = partial["ftpServiceName"] as? String {
            config.ftpServiceName = svc.trimmingCharacters(in: .whitespacesAndNewlines)
        }
        if let host = partial["ftpManualHost"] as? String {
            config.ftpManualHost = host.trimmingCharacters(in: .whitespacesAndNewlines)
        }
        if let port = partial["ftpManualPort"] as? Int, port > 0 {
            config.ftpManualPort = port
        } else if let portStr = partial["ftpManualPort"] as? String, let port = Int(portStr.trimmingCharacters(in: .whitespacesAndNewlines)), port > 0 {
            config.ftpManualPort = port
        }
        if let user = partial["ftpUsername"] as? String {
            config.ftpUsername = user.trimmingCharacters(in: .whitespacesAndNewlines)
        }
        if let pass = partial["ftpPassword"] as? String {
            config.ftpPassword = pass
        }
        if let rPath = partial["ftpRemotePath"] as? String {
            let trimmed = rPath.trimmingCharacters(in: .whitespacesAndNewlines)
            config.ftpRemotePath = trimmed.isEmpty ? "/" : trimmed
        }

        persist()
        return getConfigDictionary()
    }

    public func hasDuplicate(sha256: String, normalizedKey: String, filename: String) -> (duplicate: Bool, reason: String?) {
        lock.lock()
        defer { lock.unlock() }
        initializeIfNeeded()
        if !sha256.isEmpty && hashSet.contains(sha256) {
            return (true, "SHA-256 hash match")
        }
        if !normalizedKey.isEmpty && keySet.contains(normalizedKey) {
            return (true, "Normalized Artist|Album|Title match")
        }
        if !filename.isEmpty {
            if filenameSet.contains(filename.lowercased()) {
                return (true, "Filename already indexed")
            }
            let base = Self.getTrackBaseNameFromFilename(filename).lowercased()
            if !base.isEmpty && baseNameSet.contains(base) {
                return (true, "Track baseName already in vault")
            }
        }
        return (false, nil)
    }

    @discardableResult
    public func addTrack(_ record: TrackRecord) -> TrackRecord {
        lock.lock()
        defer { lock.unlock() }
        initializeIfNeeded()
        let key = !record.trackKey.isEmpty ? record.trackKey : (!record.normalizedKey.isEmpty ? record.normalizedKey : record.filename)
        var enriched = record
        enriched.normalizedKey = key
        enriched.trackKey = key
        if enriched.baseName.isEmpty {
            enriched.baseName = Self.getTrackBaseNameFromFilename(record.filename)
        }
        enriched.discNumber = Self.getTrackDiscNumber(enriched)
        enriched.albumGroupKey = Self.getAlbumGroupKey(for: enriched)
        if enriched.artworkFilename.isEmpty {
            enriched.artworkFilename = Self.getCompanionJpgFilename(record.filename)
        }
        tracksMap[key] = enriched
        if !enriched.sha256.isEmpty { hashSet.insert(enriched.sha256) }
        keySet.insert(key)
        filenameSet.insert(enriched.filename.lowercased())
        baseNameSet.insert(enriched.baseName.lowercased())
        persist()
        return enriched
    }

    public func markTrackArtwork(trackKey: String, hasArtwork: Bool, updatedAt: Int64? = nil, fileSize: Int64? = nil) {
        lock.lock()
        defer { lock.unlock() }
        guard var track = tracksMap[trackKey] else { return }
        let ts = updatedAt ?? Int64(Date().timeIntervalSince1970 * 1000)
        track.hasArtwork = hasArtwork
        track.artworkEmbedded = hasArtwork
        track.artworkUpdatedAt = ts
        track.updatedAt = ts
        if let fs = fileSize, fs > 0 {
            track.fileSize = fs
        }
        tracksMap[trackKey] = track
    }

    // MARK: - Metadata Extraction & SHA-256
    public static func computeFileSha256(filePath: String) throws -> String {
        let handle = try FileHandle(forReadingFrom: URL(fileURLWithPath: filePath))
        defer { try? handle.close() }
        var hasher = SHA256()
        while autoreleasepool(invoking: {
            guard let data = try? handle.read(upToCount: 256 * 1024), !data.isEmpty else {
                return false
            }
            hasher.update(data: data)
            return true
        }) {}
        let digest = hasher.finalize()
        return digest.map { String(format: "%02x", $0) }.joined()
    }

    public struct ExtractedMetadata: Sendable {
        public var isDrmProtected: Bool
        public var drmReason: String?
        public var artist: String = "Unknown Artist"
        public var albumArtist: String? = nil
        public var trackArtist: String = "Unknown Artist"
        public var compilation: Bool = false
        public var album: String = "Unknown Album"
        public var title: String = "Unknown Title"
        public var trackNo: String = "01"
        public var discNo: Int = 1
        public var discNumber: Int = 1
        public var discTrack: String = "101"
        public var `extension`: String = ""
        public var filename: String = ""
        public var normalizedKey: String = ""
        public var duration: Double = 0
    }

    /// Scans MP4/M4A container atoms (`moov` subtree) for FairPlay/DRM protection (`drms` or `sinf`).
    public static func hasMp4ProtectionAtoms(filePath: String) -> Bool {
        guard let fh = FileHandle(forReadingAtPath: filePath) else { return false }
        defer { try? fh.close() }

        let fileSize = (try? fh.seekToEnd()) ?? 0
        guard fileSize >= 8 else { return false }
        try? fh.seek(toOffset: 0)

        func readUInt32BE(at offset: UInt64) -> UInt32? {
            try? fh.seek(toOffset: offset)
            let d = fh.readData(ofLength: 4)
            guard d.count == 4 else { return nil }
            return (UInt32(d[0]) << 24) | (UInt32(d[1]) << 16) | (UInt32(d[2]) << 8) | UInt32(d[3])
        }

        func readType(at offset: UInt64) -> String? {
            try? fh.seek(toOffset: offset)
            let d = fh.readData(ofLength: 4)
            guard d.count == 4 else { return nil }
            return String(data: d, encoding: .ascii)
        }

        // Locate top-level `moov` box without reading `mdat`
        var offset: UInt64 = 0
        while offset + 8 <= fileSize {
            guard let size32 = readUInt32BE(at: offset),
                  let atomType = readType(at: offset + 4) else { break }
            var boxSize = UInt64(size32)
            if boxSize == 1, offset + 16 <= fileSize {
                try? fh.seek(toOffset: offset + 8)
                let extD = fh.readData(ofLength: 8)
                if extD.count == 8 {
                    boxSize = extD.reduce(0) { ($0 << 8) | UInt64($1) }
                }
            } else if boxSize == 0 {
                boxSize = fileSize - offset
            }
            guard boxSize >= 8 else { break }

            if atomType == "moov" {
                let readLen = Int(min(boxSize, 4 * 1024 * 1024))
                try? fh.seek(toOffset: offset)
                let moovData = fh.readData(ofLength: readLen)
                if moovData.range(of: Data("drms".utf8)) != nil || moovData.range(of: Data("sinf".utf8)) != nil {
                    return true
                }
                return false
            }
            offset += boxSize
        }
        return false
    }

    public static func extractTrackMetadata(filePath: String) async -> ExtractedMetadata {
        let url = URL(fileURLWithPath: filePath)
        let ext = "." + url.pathExtension.lowercased()
        let rawBasename = url.deletingPathExtension().lastPathComponent

        if drmExtensions.contains(ext) {
            return ExtractedMetadata(isDrmProtected: true, drmReason: "DRM-restricted container (\(ext))")
        }
        if !supportedExtensions.contains(ext) {
            return ExtractedMetadata(isDrmProtected: true, drmReason: "Unsupported audio extension (\(ext))")
        }
        if (ext == ".m4a" || ext == ".alac" || ext == ".aac"), hasMp4ProtectionAtoms(filePath: filePath) {
            return ExtractedMetadata(isDrmProtected: true, drmReason: "FairPlay/DRM protection atom (drms/sinf)")
        }

        var rawAlbumArtist: String? = nil
        var rawTrackArtist: String? = nil
        var rawAlbum: String? = nil
        var rawTitle: String? = nil
        var trackNum: Int = 1
        var discNum: Int = 1
        var isComp: Bool = false
        var durationSec: Double = 0

        let asset = AVURLAsset(url: url)
        if let hasProtected = try? await asset.load(.hasProtectedContent), hasProtected {
            return ExtractedMetadata(isDrmProtected: true, drmReason: "AVAsset hasProtectedContent=true")
        }
        if let isPlayable = try? await asset.load(.isPlayable), !isPlayable {
            return ExtractedMetadata(isDrmProtected: true, drmReason: "Unplayable or encrypted audio stream")
        }
        if let audioTracks = try? await asset.loadTracks(withMediaType: .audio), audioTracks.isEmpty {
            return ExtractedMetadata(isDrmProtected: true, drmReason: "No playable audio track found")
        }
        if let dur = try? await asset.load(.duration) {
            let secs = CMTimeGetSeconds(dur)
            if secs.isFinite && secs > 0 {
                durationSec = secs
            }
        }

        if let metaItems = try? await asset.load(.metadata) {
            for item in metaItems {
                if let commonKey = item.commonKey {
                    let strVal = (try? await item.load(.stringValue))?.trimmingCharacters(in: .whitespacesAndNewlines)
                    switch commonKey {
                    case .commonKeyTitle:
                        if let v = strVal, !v.isEmpty { rawTitle = v }
                    case .commonKeyArtist:
                        if let v = strVal, !v.isEmpty { rawTrackArtist = v }
                    case .commonKeyAlbumName:
                        if let v = strVal, !v.isEmpty { rawAlbum = v }
                    default:
                        break
                    }
                }
                if let idStr = item.identifier?.rawValue.lowercased() {
                    let strVal = (try? await item.load(.stringValue))?.trimmingCharacters(in: .whitespacesAndNewlines)
                    let numVal = try? await item.load(.numberValue)
                    let dataVal = try? await item.load(.dataValue)

                    if idStr.contains("aart") || idStr.contains("tpe2") || idStr.contains("album_artist") {
                        if let v = strVal, !v.isEmpty { rawAlbumArtist = v }
                    } else if idStr.contains("cpil") || idStr.contains("tcmp") {
                        if let n = numVal, n.intValue != 0 { isComp = true }
                        else if let s = strVal, s == "1" || s.lowercased() == "true" { isComp = true }
                    } else if idStr.contains("trkn") || idStr.contains("trck") {
                        if let d = dataVal, d.count >= 4 {
                            let t = Int(d[2]) << 8 | Int(d[3])
                            if t > 0 { trackNum = t }
                        } else if let s = strVal {
                            let firstPart = s.split(separator: "/").first.map(String.init) ?? s
                            if let t = Int(firstPart.trimmingCharacters(in: .whitespaces)), t > 0 { trackNum = t }
                        } else if let n = numVal, n.intValue > 0 {
                            trackNum = n.intValue
                        }
                    } else if idStr.contains("disk") || idStr.contains("tpos") {
                        if let d = dataVal, d.count >= 4 {
                            let dn = Int(d[2]) << 8 | Int(d[3])
                            if dn > 0 { discNum = dn }
                        } else if let s = strVal {
                            let firstPart = s.split(separator: "/").first.map(String.init) ?? s
                            if let dn = Int(firstPart.trimmingCharacters(in: .whitespaces)), dn > 0 { discNum = dn }
                        } else if let n = numVal, n.intValue > 0 {
                            discNum = n.intValue
                        }
                    }
                }
            }
        }

        // For FLAC files, parse VORBIS_COMMENT and STREAMINFO directly if AVAsset missed tags
        if ext == ".flac", let flacMeta = ArtworkAndTagService.parseFlacVorbisAndStreamInfo(filePath: filePath) {
            if rawTitle == nil, let t = flacMeta.title { rawTitle = t }
            if rawTrackArtist == nil, let a = flacMeta.artist { rawTrackArtist = a }
            if rawAlbumArtist == nil, let aa = flacMeta.albumArtist { rawAlbumArtist = aa }
            if rawAlbum == nil, let al = flacMeta.album { rawAlbum = al }
            if let tn = flacMeta.trackNumber, tn > 0 { trackNum = tn }
            if let dn = flacMeta.discNumber, dn > 0 { discNum = dn }
            if flacMeta.duration > 0 && durationSec == 0 { durationSec = flacMeta.duration }
        }

        let resolvedArtist = rawAlbumArtist ?? rawTrackArtist ?? "Unknown Artist"
        let resolvedAlbum = rawAlbum ?? "Unknown Album"
        let resolvedTitle = rawTitle ?? (rawBasename.isEmpty ? "Unknown Title" : rawBasename)
        let paddedTrack = String(format: "%02d", max(1, trackNum))
        let resolvedDisc = max(1, discNum)
        let discTrack = "\(resolvedDisc)\(paddedTrack)"

        let safeArtist = sanitizeSegment(resolvedArtist, fallback: "Unknown Artist")
        let safeAlbum = sanitizeSegment(resolvedAlbum, fallback: "Unknown Album")
        let safeTitle = sanitizeSegment(resolvedTitle, fallback: sanitizeSegment(rawBasename, fallback: "Unknown Title"))
        let cleanExt = ext.replacingOccurrences(of: ".", with: "")
        let archiveFilename = "\(safeArtist) - \(safeAlbum) - \(discTrack) - \(safeTitle).\(cleanExt)"
        let normalizedKey = buildNormalizedKey(artist: resolvedArtist, album: resolvedAlbum, discTrack: discTrack, title: resolvedTitle)

        return ExtractedMetadata(
            isDrmProtected: false,
            drmReason: nil,
            artist: resolvedArtist,
            albumArtist: rawAlbumArtist,
            trackArtist: rawTrackArtist ?? resolvedArtist,
            compilation: isComp,
            album: resolvedAlbum,
            title: resolvedTitle,
            trackNo: paddedTrack,
            discNo: resolvedDisc,
            discNumber: resolvedDisc,
            discTrack: discTrack,
            extension: cleanExt,
            filename: archiveFilename,
            normalizedKey: normalizedKey,
            duration: durationSec
        )
    }

    // MARK: - Ingestion Pipeline
    public func getIngestState() -> (isIngesting: Bool, runId: Int) {
        lock.lock()
        defer { lock.unlock() }
        return (isIngesting, currentRunId)
    }

    public func getRecentIngestEvents() -> [[String: Any]] {
        lock.lock()
        defer { lock.unlock() }
        return recentIngestEvents
    }

    private func emitIngestEvent(type: String, message: String, extra: [String: Any] = [:]) {
        lock.lock()
        let eventId = "\(currentRunId):\(recentIngestEvents.count + 1)"
        let rId = currentRunId
        var payload: [String: Any] = [
            "id": eventId,
            "runId": rId,
            "timestamp": ISO8601DateFormatter().string(from: Date()),
            "type": type,
            "message": message
        ]
        for (k, v) in extra { payload[k] = v }
        recentIngestEvents.append(payload)
        if recentIngestEvents.count > maxRecentEvents {
            recentIngestEvents.removeFirst(recentIngestEvents.count - maxRecentEvents)
        }
        lock.unlock()
        SSEEventBus.shared.emit(channel: "import", payload: payload)
    }

    private func collectAudioFiles(in dirPath: String) -> [String] {
        var results: [String] = []
        let fm = FileManager.default
        guard let enumerator = fm.enumerator(atPath: dirPath) else {
            emitIngestEvent(type: "ERROR", message: "[ERROR] Cannot read directory \(dirPath)")
            return results
        }
        while let relPath = enumerator.nextObject() as? String {
            let lastComp = (relPath as NSString).lastPathComponent
            if lastComp.hasPrefix(".") {
                continue
            }
            let fullPath = (dirPath as NSString).appendingPathComponent(relPath)
            var isDir: ObjCBool = false
            if fm.fileExists(atPath: fullPath, isDirectory: &isDir), !isDir.boolValue {
                let ext = "." + (lastComp as NSString).pathExtension.lowercased()
                if Self.supportedExtensions.contains(ext) || Self.drmExtensions.contains(ext) {
                    results.append(fullPath)
                }
            }
        }
        return results
    }

    public func runIngestionPipeline() async throws -> [String: Any] {
        let (sourceDir, vaultDir): (String, String) = try lock.withLock {
            if isIngesting {
                throw NSError(domain: "LibraryService", code: 409, userInfo: [NSLocalizedDescriptionKey: "Ingestion is already running."])
            }
            isIngesting = true
            currentRunId += 1
            recentIngestEvents.removeAll()
            return (Self.expandTilde(config.sourcePath), getVaultDir())
        }

        defer {
            lock.withLock {
                isIngesting = false
            }
        }

        try? await Task.sleep(nanoseconds: 80_000_000)

        var scanned = 0
        var imported = 0
        var skippedDuplicate = 0
        var skippedDrm = 0
        var errors = 0

        let fm = FileManager.default
        try? fm.createDirectory(atPath: vaultDir, withIntermediateDirectories: true)

        var isDir: ObjCBool = false
        if !fm.fileExists(atPath: sourceDir, isDirectory: &isDir) || !fm.isReadableFile(atPath: sourceDir) {
            emitIngestEvent(type: "ERROR", message: "[ERROR] Source directory not found or unreadable: \(sourceDir)")
            let summary: [String: Any] = [
                "scanned": scanned, "imported": imported,
                "skippedDuplicate": skippedDuplicate, "skippedDrm": skippedDrm, "errors": errors
            ]
            emitIngestEvent(type: "DONE", message: "[DONE] Ingestion aborted — verify your Master Music Source path.", extra: ["summary": summary])
            return summary
        }

        emitIngestEvent(type: "INGEST", message: "[INGEST] Starting recursive scan of \"\(sourceDir)\" -> \"\(vaultDir)\"")

        let files = collectAudioFiles(in: sourceDir)
        for filePath in files {
            scanned += 1
            do {
                let meta = await Self.extractTrackMetadata(filePath: filePath)
                if meta.isDrmProtected {
                    skippedDrm += 1
                    let filename = (filePath as NSString).lastPathComponent
                    emitIngestEvent(
                        type: "SKIPPED",
                        message: "[DRM SKIP] \(filename) (\(meta.drmReason ?? "DRM"))"
                    )
                    continue
                }

                let targetPath = (vaultDir as NSString).appendingPathComponent(meta.filename)
                if fm.fileExists(atPath: targetPath) {
                    skippedDuplicate += 1
                    emitIngestEvent(type: "SKIPPED", message: "[SKIPPED] Track already exists: \(meta.filename)")
                    continue
                }

                let sha256 = try Self.computeFileSha256(filePath: filePath)
                let dupCheck = hasDuplicate(sha256: sha256, normalizedKey: meta.normalizedKey, filename: meta.filename)
                if dupCheck.duplicate {
                    skippedDuplicate += 1
                    emitIngestEvent(type: "SKIPPED", message: "[SKIPPED] Track already exists (\(dupCheck.reason ?? "Duplicate")): \(meta.filename)")
                    continue
                }

                try fm.copyItem(atPath: filePath, toPath: targetPath)

                var hasArt = false
                do {
                    let artResult = try await ArtworkAndTagService.shared.fetchAndEmbedAlbumArt(
                        artist: meta.artist,
                        albumArtist: meta.albumArtist,
                        album: meta.album,
                        compilation: meta.compilation,
                        targetAudioPath: targetPath,
                        rateLimitDelayMs: 150
                    )
                    if artResult.status == "DOWNLOADED" || artResult.status == "CACHED" || artResult.status == "MIGRATED" {
                        hasArt = true
                        emitIngestEvent(
                            type: "ARTWORK",
                            message: "[EMBEDDED ART] \(meta.filename) (\(artResult.provider ?? "iTunes"))",
                            extra: ["provider": artResult.provider ?? "iTunes"]
                        )
                    } else if artResult.status == "ALREADY_EMBEDDED" || artResult.status == "SKIPPED" {
                        hasArt = true
                        emitIngestEvent(type: "ARTWORK", message: "[EMBEDDED ART] \(meta.filename) (Already Embedded)")
                    } else {
                        emitIngestEvent(type: "SKIPPED", message: "[ARTWORK: NOT FOUND] Could not resolve: \(meta.artist) - \(meta.album)")
                    }
                } catch {
                    // Non-fatal during ingest
                }

                let attrs = try? fm.attributesOfItem(atPath: targetPath)
                let fSize = (attrs?[.size] as? NSNumber)?.int64Value ?? 0
                let nowTs = Int64(Date().timeIntervalSince1970 * 1000)

                var record = TrackRecord(
                    id: String(sha256.prefix(16)),
                    sha256: sha256,
                    filename: meta.filename,
                    baseName: Self.getTrackBaseNameFromFilename(meta.filename),
                    artist: meta.artist,
                    albumArtist: meta.albumArtist,
                    trackArtist: meta.trackArtist,
                    compilation: meta.compilation,
                    album: meta.album,
                    title: meta.title,
                    discTrack: meta.discTrack,
                    discNo: meta.discNo,
                    discNumber: meta.discNumber,
                    trackNo: meta.trackNo,
                    extension: meta.extension,
                    fileSize: fSize,
                    duration: meta.duration,
                    normalizedKey: meta.normalizedKey,
                    trackKey: meta.normalizedKey,
                    addedDate: ISO8601DateFormatter().string(from: Date()),
                    artworkFilename: Self.getCompanionJpgFilename(meta.filename),
                    hasArtwork: hasArt,
                    artworkEmbedded: hasArt,
                    albumGroupKey: "",
                    artworkUpdatedAt: nowTs,
                    updatedAt: nowTs
                )
                record.albumGroupKey = Self.getAlbumGroupKey(for: record)
                let savedRecord = addTrack(record)
                imported += 1

                emitIngestEvent(
                    type: "INGEST",
                    message: "[INGEST] Copied: \(meta.filename)",
                    extra: ["track": savedRecord.toDictionary()]
                )
            } catch {
                errors += 1
                emitIngestEvent(
                    type: "ERROR",
                    message: "[ERROR] Failed processing \((filePath as NSString).lastPathComponent): \(error.localizedDescription)"
                )
            }
        }

        let summary: [String: Any] = [
            "scanned": scanned,
            "imported": imported,
            "skippedDuplicate": skippedDuplicate,
            "skippedDrm": skippedDrm,
            "errors": errors
        ]
        emitIngestEvent(
            type: "DONE",
            message: "[DONE] Ingestion complete — Scanned: \(scanned) | Imported: \(imported) | Skipped: \(skippedDuplicate) | DRM Excluded: \(skippedDrm)",
            extra: ["summary": summary]
        )
        return summary
    }
}
