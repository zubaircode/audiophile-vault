import Cocoa

if CommandLine.arguments.contains("--self-test") {
    let lib = LibraryService.shared
    lib.initializeIfNeeded()
    lib.syncVaultOnDisk()
    let cfg = lib.getConfigDictionary()
    let tracks = lib.getTracks()
    let pls = PlaylistService.shared.listPlaylists()
    let vols = VolumeAndSyncService.shared.listMountedVolumes()
    let distDir = VaultSchemeHandler.resolveClientDistDirectory()
    let hasIndexHtml = FileManager.default.fileExists(atPath: (distDir as NSString).appendingPathComponent("index.html"))

    var artCheck = "NO_TRACKS"
    if let firstWithArt = tracks.first(where: { $0.hasArtwork }) {
        if let art = ArtworkAndTagService.shared.getEmbeddedArtworkForBaseName(firstWithArt.baseName, trackKey: firstWithArt.trackKey) {
            artCheck = "OK (\(art.data.count) bytes, \(art.mimeType)) for \(firstWithArt.baseName)"
        } else {
            artCheck = "FAILED for \(firstWithArt.baseName)"
        }
    }

    print("[SELF-TEST] Vault Index Path: \(lib.getVaultIndexPath())")
    print("[SELF-TEST] Loaded Tracks: \(tracks.count)")
    print("[SELF-TEST] Loaded Playlists: \(pls.playlists.count) (\(pls.playlists.map { $0.name }.joined(separator: ", ")))")
    print("[SELF-TEST] Mounted Volumes: \(vols.count)")
    print("[SELF-TEST] Client Dist Resolved: \(distDir) (index.html=\(hasIndexHtml))")
    print("[SELF-TEST] Embedded Artwork Extraction: \(artCheck)")
    print("[SELF-TEST] Stats: \(cfg["stats"] ?? [:])")

    guard tracks.count > 0, hasIndexHtml, artCheck.hasPrefix("OK") else {
        exit(1)
    }
    exit(0)
}

if CommandLine.arguments.contains("--test-artwork-search") {
    let lib = LibraryService.shared
    lib.initializeIfNeeded()
    lib.syncVaultOnDisk()
    let tracks = lib.getTracks()

    // Pick representative real library albums + edge cases
    var seenAlbums = Set<String>()
    var sampleCases: [(label: String, artist: String, albumArtist: String?, album: String, compilation: Bool?)] = []

    if let theBand = tracks.first(where: { $0.artist.lowercased().hasPrefix("the ") && !$0.album.isEmpty }) {
        let key = "\(theBand.artist)|\(theBand.album)"
        seenAlbums.insert(key)
        sampleCases.append(("Library 'The...' Band", theBand.artist, theBand.albumArtist, theBand.album, theBand.compilation))
    }
    if let comp = tracks.first(where: { $0.compilation == true || ($0.albumArtist ?? "").lowercased().contains("various") }) {
        let key = "\(comp.albumArtist ?? comp.artist)|\(comp.album)"
        seenAlbums.insert(key)
        sampleCases.append(("Library Compilation", comp.artist, comp.albumArtist, comp.album, comp.compilation))
    }
    for t in tracks where !t.artist.isEmpty && !t.album.isEmpty {
        let key = "\(t.artist)|\(t.album)"
        if !seenAlbums.contains(key) {
            seenAlbums.insert(key)
            sampleCases.append(("Library Album", t.artist, t.albumArtist, t.album, t.compilation))
        }
        if sampleCases.count >= 5 { break }
    }

    // Add targeted edge cases: homonym ("Greatest Hits"), soundtrack, and a deliberately non-existent album for a real artist
    sampleCases.append(("Homonym (Greatest Hits)", "Queen", "Queen", "Greatest Hits", false))
    sampleCases.append(("Soundtrack Compilation", "Daft Punk", "Various Artists", "TRON: Legacy (Original Motion Picture Soundtrack)", true))
    sampleCases.append(("Wrong-Artist Gate Check", "Nonexistent Artist XYZ999", "Nonexistent Artist XYZ999", "1989", false))

    let semaphore = DispatchSemaphore(value: 0)
    Task {
        for item in sampleCases {
            let diag = await ArtworkAndTagService.shared.diagnoseArtworkSearch(
                artist: item.artist,
                albumArtist: item.albumArtist,
                album: item.album,
                compilation: item.compilation
            )
            print("=== [\(item.label)] \(item.artist) — \(item.album) (comp=\(diag.isCompilation)) ===")
            print("  Query: \(diag.query)")
            if let sel = diag.selected {
                print(String(format: "  SELECTED: [%@] %@ — %@ (artist=%.2f, album=%.2f, total=%.2f)",
                             sel.provider, sel.artistName, sel.albumName, sel.artistScore, sel.albumScore, sel.combinedScore))
            } else {
                print("  SELECTED: NONE (NOT_FOUND — safely rejected false positives)")
            }
            let rejected = diag.candidates.filter { !$0.accepted }.prefix(4)
            for rej in rejected {
                print(String(format: "  REJECTED: [%@] %@ — %@ (artist=%.2f, album=%.2f, total=%.2f) -> %@",
                             rej.provider, rej.artistName, rej.albumName, rej.artistScore, rej.albumScore, rej.combinedScore, rej.rejectionReason ?? "rejected"))
            }
        }
        semaphore.signal()
    }
    semaphore.wait()
    exit(0)
}

if CommandLine.arguments.contains("--test-drm-check") {
    let lib = LibraryService.shared
    lib.initializeIfNeeded()
    lib.syncVaultOnDisk()
    let vaultDir = lib.getVaultDir()
    let tracks = lib.getTracks()

    let tmpDir = "/tmp/av-drm-test"
    let fm = FileManager.default
    try? fm.removeItem(atPath: tmpDir)
    try? fm.createDirectory(atPath: tmpDir, withIntermediateDirectories: true)

    let dummyM4p = "\(tmpDir)/protected-track.m4p"
    let dummyWma = "\(tmpDir)/protected-track.wma"
    let dummyFairPlayM4a = "\(tmpDir)/fairplay-wrapped.m4a"
    fm.createFile(atPath: dummyM4p, contents: Data("dummy m4p".utf8))
    fm.createFile(atPath: dummyWma, contents: Data("dummy wma".utf8))

    // Construct a minimal MP4 `moov` box containing a `sinf` FairPlay protection atom
    var sinfBox = Data([0x00, 0x00, 0x00, 0x08])
    sinfBox.append(Data("sinf".utf8))
    var moovBox = Data([0x00, 0x00, 0x00, 0x10])
    moovBox.append(Data("moov".utf8))
    moovBox.append(sinfBox)
    fm.createFile(atPath: dummyFairPlayM4a, contents: moovBox)

    var testFiles: [(label: String, path: String, expectDrm: Bool)] = [
        ("Dummy .m4p", dummyM4p, true),
        ("Dummy .wma", dummyWma, true),
        ("FairPlay sinf .m4a", dummyFairPlayM4a, true),
    ]

    for ext in ["m4a", "mp3", "flac"] {
        if let sample = tracks.first(where: { $0.extension.lowercased() == ext }) {
            let src = (vaultDir as NSString).appendingPathComponent(sample.filename)
            let dst = "\(tmpDir)/valid-sample.\(ext)"
            try? fm.copyItem(atPath: src, toPath: dst)
            if fm.fileExists(atPath: dst) {
                testFiles.append(("Valid .\(ext)", dst, false))
            }
        }
    }

    let sem = DispatchSemaphore(value: 0)
    var allPassed = true
    Task {
        for item in testFiles {
            let meta = await LibraryService.extractTrackMetadata(filePath: item.path)
            let fname = (item.path as NSString).lastPathComponent
            let ok = (meta.isDrmProtected == item.expectDrm)
            if !ok { allPassed = false }
            if meta.isDrmProtected {
                print("[DRM SKIP] \(fname) (\(meta.drmReason ?? "DRM")) -> pass=\(ok)")
            } else {
                print("[PASS] \(item.label): \(fname) (duration=\(String(format: "%.1fs", meta.duration)), artist=\(meta.artist)) -> pass=\(ok)")
            }
        }
        try? fm.removeItem(atPath: tmpDir)
        sem.signal()
    }
    sem.wait()
    exit(allPassed ? 0 : 1)
}

let app = NSApplication.shared
app.setActivationPolicy(.regular)
let delegate = AppDelegate()
app.delegate = delegate
app.run()
