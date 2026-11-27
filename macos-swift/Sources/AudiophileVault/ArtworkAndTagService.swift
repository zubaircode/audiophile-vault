import Foundation
import AVFoundation
import ImageIO
import CoreGraphics
import UniformTypeIdentifiers

public final class ArtworkAndTagService: @unchecked Sendable {
    public static let shared = ArtworkAndTagService()

    private static let userAgent = "AudiophileVault/2.1.4 ( contact@audiophilevault.local )"
    private let lock = NSRecursiveLock()

    private struct MemoArtEntry {
        let modTime: TimeInterval
        let size: Int64
        let hasArt: Bool
        let data: Data?
        let mimeType: String?
    }

    private struct AlbumCacheEntry {
        let data: Data?
        let provider: String?
        let notFound: Bool
    }

    private var embeddedArtMemoCache: [String: MemoArtEntry] = [:]
    private var albumArtCache: [String: AlbumCacheEntry] = [:]
    private var isFetchingArtwork = false
    private var cancelRequested = false
    private var lastMusicBrainzRequestTime: TimeInterval = 0

    private init() {}

    public func getIsFetchingArtwork() -> Bool {
        lock.lock()
        defer { lock.unlock() }
        return isFetchingArtwork
    }

    public func stopArtworkBackfill() -> [String: Any] {
        lock.lock()
        defer { lock.unlock() }
        if !isFetchingArtwork {
            return ["stopped": false, "message": "No artwork backfill is currently running."]
        }
        cancelRequested = true
        return ["stopped": true, "message": "Stopping artwork lookup…"]
    }

    private func isCancelled() -> Bool {
        lock.lock()
        defer { lock.unlock() }
        return cancelRequested
    }

    private func emitArtworkEvent(type: String, message: String, extra: [String: Any] = [:]) {
        var payload: [String: Any] = [
            "timestamp": ISO8601DateFormatter().string(from: Date()),
            "type": type,
            "message": message
        ]
        for (k, v) in extra { payload[k] = v }
        SSEEventBus.shared.emit(channel: "artwork", payload: payload)
    }

    public func invalidateEmbeddedArtCache(filePath: String? = nil) {
        lock.lock()
        defer { lock.unlock() }
        if let fp = filePath {
            embeddedArtMemoCache.removeValue(forKey: fp)
        } else {
            embeddedArtMemoCache.removeAll()
        }
    }

    // MARK: - Native ImageIO JPEG Normalization (Replaces /usr/bin/sips)
    public static func normalizeToJpegData(_ rawData: Data, maxDimension: Int = 1200) throws -> Data {
        guard rawData.count >= 4 else {
            throw NSError(domain: "ArtworkAndTagService", code: 400, userInfo: [NSLocalizedDescriptionKey: "Image buffer is empty or corrupted."])
        }

        // Fast path: check if already baseline JPEG <= maxDimension
        if rawData[0] == 0xFF && rawData[1] == 0xD8 && rawData[2] == 0xFF {
            let dims = parseJpegDimensions(rawData)
            if dims.width > 0 && dims.width <= maxDimension && dims.height > 0 && dims.height <= maxDimension && !dims.isProgressive {
                return rawData
            }
        }

        guard let source = CGImageSourceCreateWithData(rawData as CFData, nil) else {
            throw NSError(domain: "ArtworkAndTagService", code: 400, userInfo: [NSLocalizedDescriptionKey: "Could not decode image data via ImageIO."])
        }

        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceShouldCacheImmediately: true,
            kCGImageSourceThumbnailMaxPixelSize: maxDimension
        ]

        guard let cgImage = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) ?? CGImageSourceCreateImageAtIndex(source, 0, nil) else {
            throw NSError(domain: "ArtworkAndTagService", code: 400, userInfo: [NSLocalizedDescriptionKey: "Failed to rasterize cover image."])
        }

        let outData = NSMutableData()
        guard let dest = CGImageDestinationCreateWithData(outData, UTType.jpeg.identifier as CFString, 1, nil) else {
            throw NSError(domain: "ArtworkAndTagService", code: 500, userInfo: [NSLocalizedDescriptionKey: "Failed to create JPEG destination."])
        }

        let destProps: [CFString: Any] = [
            kCGImageDestinationLossyCompressionQuality: 0.88
        ]
        CGImageDestinationAddImage(dest, cgImage, destProps as CFDictionary)
        guard CGImageDestinationFinalize(dest), outData.length > 0 else {
            throw NSError(domain: "ArtworkAndTagService", code: 500, userInfo: [NSLocalizedDescriptionKey: "Failed to encode baseline JPEG."])
        }
        return outData as Data
    }

    public static func parseJpegDimensions(_ data: Data) -> (width: Int, height: Int, isProgressive: Bool) {
        guard data.count >= 4, data[0] == 0xFF, data[1] == 0xD8 else {
            return (0, 0, false)
        }
        var offset = 2
        while offset + 9 < data.count {
            if data[offset] != 0xFF {
                offset += 1
                continue
            }
            let marker = data[offset + 1]
            if marker == 0xFF {
                offset += 1
                continue
            }
            if marker == 0xD8 || marker == 0xD9 || (marker >= 0xD0 && marker <= 0xD7) {
                offset += 2
                continue
            }
            let segLen = (Int(data[offset + 2]) << 8) | Int(data[offset + 3])
            if segLen < 2 || offset + 2 + segLen > data.count { break }
            if marker == 0xC0 || marker == 0xC1 || marker == 0xC2 {
                let h = (Int(data[offset + 5]) << 8) | Int(data[offset + 6])
                let w = (Int(data[offset + 7]) << 8) | Int(data[offset + 8])
                return (w, h, marker == 0xC2)
            }
            offset += 2 + segLen
        }
        return (0, 0, false)
    }

    // MARK: - Binary Helpers
    private static func readUInt32BE(_ data: Data, _ offset: Int) -> UInt32 {
        guard offset + 4 <= data.count else { return 0 }
        return (UInt32(data[offset]) << 24) |
               (UInt32(data[offset + 1]) << 16) |
               (UInt32(data[offset + 2]) << 8) |
               UInt32(data[offset + 3])
    }

    private static func readUInt64BE(_ data: Data, _ offset: Int) -> UInt64 {
        guard offset + 8 <= data.count else { return 0 }
        let hi = UInt64(readUInt32BE(data, offset))
        let lo = UInt64(readUInt32BE(data, offset + 4))
        return (hi << 32) | lo
    }

    private static func writeUInt32BE(_ val: UInt32, into data: inout Data, at offset: Int) {
        data[offset] = UInt8((val >> 24) & 0xFF)
        data[offset + 1] = UInt8((val >> 16) & 0xFF)
        data[offset + 2] = UInt8((val >> 8) & 0xFF)
        data[offset + 3] = UInt8(val & 0xFF)
    }

    private static func writeUInt64BE(_ val: UInt64, into data: inout Data, at offset: Int) {
        writeUInt32BE(UInt32((val >> 32) & 0xFFFFFFFF), into: &data, at: offset)
        writeUInt32BE(UInt32(val & 0xFFFFFFFF), into: &data, at: offset + 4)
    }

    private static func appendUInt32BE(_ val: UInt32, to data: inout Data) {
        data.append(UInt8((val >> 24) & 0xFF))
        data.append(UInt8((val >> 16) & 0xFF))
        data.append(UInt8((val >> 8) & 0xFF))
        data.append(UInt8(val & 0xFF))
    }

    private static func readSynchsafe32(_ data: Data, _ offset: Int) -> Int {
        guard offset + 4 <= data.count else { return 0 }
        return ((Int(data[offset]) & 0x7F) << 21) |
               ((Int(data[offset + 1]) & 0x7F) << 14) |
               ((Int(data[offset + 2]) & 0x7F) << 7) |
               (Int(data[offset + 3]) & 0x7F)
    }

    private static func makeSynchsafe32(_ val: Int) -> Data {
        var out = Data(count: 4)
        out[0] = UInt8((val >> 21) & 0x7F)
        out[1] = UInt8((val >> 14) & 0x7F)
        out[2] = UInt8((val >> 7) & 0x7F)
        out[3] = UInt8(val & 0x7F)
        return out
    }

    // MARK: - 1. MP3 (ID3v2 APIC) Parser & Writer
    public static func extractMp3Apic(_ fileBuf: Data) -> (data: Data, mimeType: String)? {
        guard fileBuf.count >= 10,
              fileBuf[0] == 0x49, fileBuf[1] == 0x44, fileBuf[2] == 0x33,
              fileBuf[3] < 0xFF, fileBuf[4] < 0xFF else {
            return nil
        }
        let ver = Int(fileBuf[3])
        let flags = fileBuf[5]
        let tagSize = readSynchsafe32(fileBuf, 6)
        let tagEnd = min(fileBuf.count, 10 + tagSize)
        var pos = 10
        if (flags & 0x40) != 0, pos + 4 <= tagEnd {
            let extSize = ver == 4 ? readSynchsafe32(fileBuf, pos) : Int(readUInt32BE(fileBuf, pos))
            pos += ver == 4 ? extSize : 4 + extSize
        }
        while pos + 10 <= tagEnd {
            let idData = fileBuf.subdata(in: pos..<(pos + 4))
            guard let frameId = String(data: idData, encoding: .ascii),
                  frameId.range(of: #"^[A-Z0-9]{4}$"#, options: .regularExpression) != nil else {
                break
            }
            var frameSize = ver == 4 ? readSynchsafe32(fileBuf, pos + 4) : Int(readUInt32BE(fileBuf, pos + 4))
            if ver == 4 && (frameSize <= 0 || pos + 10 + frameSize > tagEnd) {
                let rawBe = Int(readUInt32BE(fileBuf, pos + 4))
                if rawBe > 0 && pos + 10 + rawBe <= tagEnd { frameSize = rawBe }
            }
            if frameSize <= 0 || pos + 10 + frameSize > tagEnd { break }

            if frameId == "APIC" {
                let body = fileBuf.subdata(in: (pos + 10)..<(pos + 10 + frameSize))
                if body.count > 4 {
                    let encoding = body[0]
                    var idx = 1
                    while idx < body.count && body[idx] != 0 { idx += 1 }
                    let mime = String(data: body.subdata(in: 1..<idx), encoding: .ascii) ?? "image/jpeg"
                    idx += 1 // skip null
                    if idx < body.count { idx += 1 } // skip picture type
                    // skip description
                    if encoding == 0x01 || encoding == 0x02 {
                        while idx + 1 < body.count && !(body[idx] == 0 && body[idx + 1] == 0) { idx += 2 }
                        idx += 2
                    } else {
                        while idx < body.count && body[idx] != 0 { idx += 1 }
                        idx += 1
                    }
                    if idx < body.count {
                        let img = body.subdata(in: idx..<body.count)
                        if !img.isEmpty {
                            return (img, mime.isEmpty ? "image/jpeg" : mime)
                        }
                    }
                }
            }
            pos += 10 + frameSize
        }
        return nil
    }

    public static func transformMp3Id3v2(_ fileBuf: Data, imageBuffer: Data?) -> Data {
        var audioOffset = 0
        var versionMajor = 3
        var keptFrames: [Data] = []

        if fileBuf.count >= 10 &&
           fileBuf[0] == 0x49 && fileBuf[1] == 0x44 && fileBuf[2] == 0x33 &&
           fileBuf[3] < 0xFF && fileBuf[4] < 0xFF {
            let existingVer = Int(fileBuf[3])
            let flags = fileBuf[5]
            let tagSize = readSynchsafe32(fileBuf, 6)
            let hasFooter = existingVer == 4 && (flags & 0x10) != 0
            let totalTagBytes = 10 + tagSize + (hasFooter ? 10 : 0)
            if totalTagBytes <= fileBuf.count {
                audioOffset = totalTagBytes
                if existingVer == 3 || existingVer == 4 {
                    versionMajor = existingVer
                    var frameStart = 10
                    let tagEnd = 10 + tagSize
                    if (flags & 0x40) != 0 && frameStart + 4 <= tagEnd {
                        let extSize = existingVer == 4 ? readSynchsafe32(fileBuf, frameStart) : Int(readUInt32BE(fileBuf, frameStart))
                        frameStart += existingVer == 4 ? extSize : 4 + extSize
                    }
                    while frameStart + 10 <= tagEnd {
                        let idData = fileBuf.subdata(in: frameStart..<(frameStart + 4))
                        guard let frameId = String(data: idData, encoding: .ascii),
                              frameId.range(of: #"^[A-Z0-9]{4}$"#, options: .regularExpression) != nil else {
                            break
                        }
                        var frameSize = existingVer == 4 ? readSynchsafe32(fileBuf, frameStart + 4) : Int(readUInt32BE(fileBuf, frameStart + 4))
                        if existingVer == 4 && (frameSize <= 0 || frameStart + 10 + frameSize > tagEnd) {
                            let rawBe = Int(readUInt32BE(fileBuf, frameStart + 4))
                            if rawBe > 0 && frameStart + 10 + rawBe <= tagEnd { frameSize = rawBe }
                        }
                        if frameSize <= 0 || frameStart + 10 + frameSize > tagEnd { break }
                        let fullFrame = fileBuf.subdata(in: frameStart..<(frameStart + 10 + frameSize))
                        if frameId != "APIC" && frameId != "PIC " {
                            keptFrames.append(fullFrame)
                        }
                        frameStart += 10 + frameSize
                    }
                }
            }
        }

        if let img = imageBuffer, !img.isEmpty {
            let mimeBytes = "image/jpeg".data(using: .ascii)!
            var payload = Data([0x00])
            payload.append(mimeBytes)
            payload.append(contentsOf: [0x00, 0x03, 0x00])
            payload.append(img)

            var header = Data()
            header.append("APIC".data(using: .ascii)!)
            if versionMajor == 4 {
                header.append(makeSynchsafe32(payload.count))
            } else {
                appendUInt32BE(UInt32(payload.count), to: &header)
            }
            header.append(contentsOf: [0x00, 0x00])
            header.append(payload)
            keptFrames.append(header)
        }

        let audioStream = fileBuf.subdata(in: audioOffset..<fileBuf.count)
        if keptFrames.isEmpty { return audioStream }

        var framesConcat = Data()
        for f in keptFrames { framesConcat.append(f) }

        var id3Header = Data()
        id3Header.append("ID3".data(using: .ascii)!)
        id3Header.append(UInt8(versionMajor))
        id3Header.append(contentsOf: [0x00, 0x00])
        id3Header.append(makeSynchsafe32(framesConcat.count))

        var out = Data(capacity: id3Header.count + framesConcat.count + audioStream.count)
        out.append(id3Header)
        out.append(framesConcat)
        out.append(audioStream)
        return out
    }

    // MARK: - 2. FLAC (METADATA_BLOCK_PICTURE & VORBIS_COMMENT) Parser & Writer
    public struct FlacParsedMeta {
        public var title: String?
        public var artist: String?
        public var albumArtist: String?
        public var album: String?
        public var trackNumber: Int?
        public var discNumber: Int?
        public var duration: Double = 0
    }

    public static func parseFlacVorbisAndStreamInfo(filePath: String) -> FlacParsedMeta? {
        guard let handle = try? FileHandle(forReadingFrom: URL(fileURLWithPath: filePath)),
              let headerData = try? handle.read(upToCount: 256 * 1024) else {
            return nil
        }
        try? handle.close()
        var flacStart = 0
        if headerData.count >= 14 && headerData[0] == 0x49 && headerData[1] == 0x44 && headerData[2] == 0x33 {
            let id3Size = 10 + readSynchsafe32(headerData, 6)
            if id3Size + 4 <= headerData.count { flacStart = id3Size }
        }
        guard headerData.count >= flacStart + 8,
              String(data: headerData.subdata(in: flacStart..<(flacStart + 4)), encoding: .ascii) == "fLaC" else {
            return nil
        }
        var meta = FlacParsedMeta()
        var offset = flacStart + 4
        var foundLast = false
        while offset + 4 <= headerData.count && !foundLast {
            let b0 = headerData[offset]
            let isLast = (b0 & 0x80) != 0
            let bType = b0 & 0x7F
            let bLen = (Int(headerData[offset + 1]) << 16) | (Int(headerData[offset + 2]) << 8) | Int(headerData[offset + 3])
            offset += 4
            if offset + bLen > headerData.count { break }
            let payload = headerData.subdata(in: offset..<(offset + bLen))
            offset += bLen
            if bType == 0 && payload.count >= 18 {
                // STREAMINFO: sample rate (20 bits at byte 10..12) and total samples (36 bits at byte 13..17)
                let sr = (Int(payload[10]) << 12) | (Int(payload[11]) << 4) | (Int(payload[12]) >> 4)
                let hiSamples = UInt64(payload[13] & 0x0F) << 32
                let loSamples = UInt64(readUInt32BE(payload, 14))
                let totalSamples = hiSamples | loSamples
                if sr > 0 && totalSamples > 0 {
                    meta.duration = Double(totalSamples) / Double(sr)
                }
            } else if bType == 4 && payload.count >= 8 {
                // VORBIS_COMMENT (little-endian lengths)
                func readLE32(_ d: Data, _ o: Int) -> Int {
                    guard o + 4 <= d.count else { return 0 }
                    return Int(d[o]) | (Int(d[o + 1]) << 8) | (Int(d[o + 2]) << 16) | (Int(d[o + 3]) << 24)
                }
                let vendorLen = readLE32(payload, 0)
                var pos = 4 + vendorLen
                if pos + 4 <= payload.count {
                    let count = readLE32(payload, pos)
                    pos += 4
                    for _ in 0..<count {
                        if pos + 4 > payload.count { break }
                        let cLen = readLE32(payload, pos)
                        pos += 4
                        if cLen < 0 || pos + cLen > payload.count { break }
                        if let str = String(data: payload.subdata(in: pos..<(pos + cLen)), encoding: .utf8),
                           let eqIdx = str.firstIndex(of: "=") {
                            let k = str[..<eqIdx].uppercased()
                            let v = String(str[str.index(after: eqIdx)...]).trimmingCharacters(in: .whitespacesAndNewlines)
                            switch k {
                            case "TITLE": meta.title = v
                            case "ARTIST": meta.artist = v
                            case "ALBUMARTIST", "ALBUM ARTIST": meta.albumArtist = v
                            case "ALBUM": meta.album = v
                            case "TRACKNUMBER":
                                let first = v.split(separator: "/").first.map(String.init) ?? v
                                meta.trackNumber = Int(first)
                            case "DISCNUMBER":
                                let first = v.split(separator: "/").first.map(String.init) ?? v
                                meta.discNumber = Int(first)
                            default: break
                            }
                        }
                        pos += cLen
                    }
                }
            }
            if isLast { foundLast = true }
        }
        return meta
    }

    public static func extractFlacPicture(_ fileBuf: Data) -> (data: Data, mimeType: String)? {
        var flacStart = 0
        if fileBuf.count >= 14 && fileBuf[0] == 0x49 && fileBuf[1] == 0x44 && fileBuf[2] == 0x33 {
            let id3Size = 10 + readSynchsafe32(fileBuf, 6)
            if id3Size + 4 <= fileBuf.count { flacStart = id3Size }
        }
        guard fileBuf.count >= flacStart + 8,
              String(data: fileBuf.subdata(in: flacStart..<(flacStart + 4)), encoding: .ascii) == "fLaC" else {
            return nil
        }
        var offset = flacStart + 4
        var foundLast = false
        while offset + 4 <= fileBuf.count && !foundLast {
            let b0 = fileBuf[offset]
            let isLast = (b0 & 0x80) != 0
            let bType = b0 & 0x7F
            let bLen = (Int(fileBuf[offset + 1]) << 16) | (Int(fileBuf[offset + 2]) << 8) | Int(fileBuf[offset + 3])
            offset += 4
            if offset + bLen > fileBuf.count { break }
            if bType == 6 {
                let p = fileBuf.subdata(in: offset..<(offset + bLen))
                if p.count >= 32 {
                    let mimeLen = Int(readUInt32BE(p, 4))
                    if 8 + mimeLen + 4 <= p.count {
                        let mime = String(data: p.subdata(in: 8..<(8 + mimeLen)), encoding: .ascii) ?? "image/jpeg"
                        let descLen = Int(readUInt32BE(p, 8 + mimeLen))
                        let picDataLenOffset = 8 + mimeLen + 4 + descLen + 16
                        if picDataLenOffset + 4 <= p.count {
                            let picLen = Int(readUInt32BE(p, picDataLenOffset))
                            let picStart = picDataLenOffset + 4
                            if picLen > 0 && picStart + picLen <= p.count {
                                return (p.subdata(in: picStart..<(picStart + picLen)), mime.isEmpty ? "image/jpeg" : mime)
                            }
                        }
                    }
                }
            }
            offset += bLen
            if isLast { foundLast = true }
        }
        return nil
    }

    public static func transformFlacPictureBlocks(_ fileBuf: Data, imageBuffer: Data?) throws -> Data {
        var flacStart = 0
        if fileBuf.count >= 14 && fileBuf[0] == 0x49 && fileBuf[1] == 0x44 && fileBuf[2] == 0x33 {
            let id3Size = 10 + readSynchsafe32(fileBuf, 6)
            if id3Size + 4 <= fileBuf.count { flacStart = id3Size }
        }
        guard fileBuf.count >= flacStart + 8,
              String(data: fileBuf.subdata(in: flacStart..<(flacStart + 4)), encoding: .ascii) == "fLaC" else {
            throw NSError(domain: "ArtworkAndTagService", code: 400, userInfo: [NSLocalizedDescriptionKey: "Invalid FLAC container (missing fLaC magic header)."])
        }

        var offset = flacStart + 4
        var keptBlocks: [(type: UInt8, payload: Data)] = []
        var foundLast = false

        while offset + 4 <= fileBuf.count && !foundLast {
            let b0 = fileBuf[offset]
            let isLast = (b0 & 0x80) != 0
            let bType = b0 & 0x7F
            let bLen = (Int(fileBuf[offset + 1]) << 16) | (Int(fileBuf[offset + 2]) << 8) | Int(fileBuf[offset + 3])
            offset += 4
            if offset + bLen > fileBuf.count {
                throw NSError(domain: "ArtworkAndTagService", code: 400, userInfo: [NSLocalizedDescriptionKey: "Corrupted FLAC metadata block length."])
            }
            let payload = fileBuf.subdata(in: offset..<(offset + bLen))
            offset += bLen
            if bType != 6 && bType != 1 {
                keptBlocks.append((bType, payload))
            }
            if isLast { foundLast = true }
        }

        if keptBlocks.isEmpty {
            throw NSError(domain: "ArtworkAndTagService", code: 400, userInfo: [NSLocalizedDescriptionKey: "FLAC file is missing required STREAMINFO block."])
        }

        if let img = imageBuffer, !img.isEmpty {
            let mimeData = "image/jpeg".data(using: .ascii)!
            let dims = parseJpegDimensions(img)
            var picPayload = Data()
            appendUInt32BE(3, to: &picPayload)
            appendUInt32BE(UInt32(mimeData.count), to: &picPayload)
            picPayload.append(mimeData)
            appendUInt32BE(0, to: &picPayload) // desc length
            appendUInt32BE(UInt32(dims.width), to: &picPayload)
            appendUInt32BE(UInt32(dims.height), to: &picPayload)
            appendUInt32BE(24, to: &picPayload)
            appendUInt32BE(0, to: &picPayload)
            appendUInt32BE(UInt32(img.count), to: &picPayload)
            picPayload.append(img)
            keptBlocks.append((6, picPayload))
        }

        keptBlocks.append((1, Data(count: 1024)))

        var out = Data()
        out.append("fLaC".data(using: .ascii)!)
        for (idx, blk) in keptBlocks.enumerated() {
            let isLast = idx == keptBlocks.count - 1
            let len = blk.payload.count
            out.append((isLast ? 0x80 : 0x00) | (blk.type & 0x7F))
            out.append(UInt8((len >> 16) & 0xFF))
            out.append(UInt8((len >> 8) & 0xFF))
            out.append(UInt8(len & 0xFF))
            out.append(blk.payload)
        }
        out.append(fileBuf.subdata(in: offset..<fileBuf.count))
        return out
    }

    // MARK: - 3. MP4 / M4A / ALAC (`covr` Atom) Parser & Writer
    private struct Mp4Box {
        let type: String
        let start: Int
        let end: Int
        let size: Int
        let headerLen: Int
        let bodyStart: Int
    }

    private static func parseMp4Boxes(_ buf: Data, startOffset: Int = 0, endOffset: Int? = nil) -> [Mp4Box] {
        let limit = endOffset ?? buf.count
        var boxes: [Mp4Box] = []
        var offset = startOffset
        while offset + 8 <= limit {
            let rawSize = Int(readUInt32BE(buf, offset))
            let typeData = buf.subdata(in: (offset + 4)..<(offset + 8))
            let type = String(data: typeData, encoding: .isoLatin1) ?? "    "
            var headerLen = 8
            var boxSize = rawSize
            if rawSize == 1 {
                if offset + 16 > limit { break }
                boxSize = Int(readUInt64BE(buf, offset + 8))
                headerLen = 16
            } else if rawSize == 0 {
                boxSize = limit - offset
            }
            if boxSize < headerLen || offset + boxSize > limit { break }
            boxes.append(Mp4Box(
                type: type,
                start: offset,
                end: offset + boxSize,
                size: boxSize,
                headerLen: headerLen,
                bodyStart: offset + headerLen
            ))
            offset += boxSize
        }
        return boxes
    }

    private static func makeMp4Box(_ typeStr: String, payloads: [Data]) -> Data {
        let totalPayload = payloads.reduce(0) { $0 + $1.count }
        var out = Data(capacity: 8 + totalPayload)
        appendUInt32BE(UInt32(8 + totalPayload), to: &out)
        if let typeBytes = typeStr.data(using: .isoLatin1), typeBytes.count == 4 {
            out.append(typeBytes)
        } else {
            out.append("free".data(using: .isoLatin1)!)
        }
        for p in payloads { out.append(p) }
        return out
    }

    private static func buildMp4HdlrMdirBox() -> Data {
        var payload = Data(count: 25)
        let mdir = "mdir".data(using: .ascii)!
        let appl = "appl".data(using: .ascii)!
        payload.replaceSubrange(4..<8, with: mdir)
        payload.replaceSubrange(8..<12, with: appl)
        return makeMp4Box("hdlr", payloads: [payload])
    }

    private static func buildMp4CovrBox(_ imageBuffer: Data) -> Data {
        let isPng = imageBuffer.count >= 4 && imageBuffer[0] == 0x89 && imageBuffer[1] == 0x50
        let typeIndicator: UInt32 = isPng ? 14 : 13
        var dataHeader = Data()
        appendUInt32BE(UInt32(16 + imageBuffer.count), to: &dataHeader)
        dataHeader.append("data".data(using: .ascii)!)
        appendUInt32BE(typeIndicator, to: &dataHeader)
        appendUInt32BE(0, to: &dataHeader)
        return makeMp4Box("covr", payloads: [dataHeader, imageBuffer])
    }

    public static func extractMp4Covr(_ fileBuf: Data) -> (data: Data, mimeType: String)? {
        let topBoxes = parseMp4Boxes(fileBuf, startOffset: 0, endOffset: fileBuf.count)
        guard let moov = topBoxes.first(where: { $0.type == "moov" }) else { return nil }
        let moovChildren = parseMp4Boxes(fileBuf, startOffset: moov.bodyStart, endOffset: moov.end)
        guard let udta = moovChildren.first(where: { $0.type == "udta" }) else { return nil }
        let udtaChildren = parseMp4Boxes(fileBuf, startOffset: udta.bodyStart, endOffset: udta.end)
        guard let meta = udtaChildren.first(where: { $0.type == "meta" }), meta.bodyStart + 4 <= meta.end else { return nil }
        let metaChildren = parseMp4Boxes(fileBuf, startOffset: meta.bodyStart + 4, endOffset: meta.end)
        guard let ilst = metaChildren.first(where: { $0.type == "ilst" }) else { return nil }
        let ilstChildren = parseMp4Boxes(fileBuf, startOffset: ilst.bodyStart, endOffset: ilst.end)
        guard let covr = ilstChildren.first(where: { $0.type == "covr" }) else { return nil }
        let covrChildren = parseMp4Boxes(fileBuf, startOffset: covr.bodyStart, endOffset: covr.end)
        if let dataBox = covrChildren.first(where: { $0.type == "data" }), dataBox.bodyStart + 8 < dataBox.end {
            let typeInd = readUInt32BE(fileBuf, dataBox.bodyStart)
            let img = fileBuf.subdata(in: (dataBox.bodyStart + 8)..<dataBox.end)
            if !img.isEmpty {
                return (img, typeInd == 14 ? "image/png" : "image/jpeg")
            }
        }
        return nil
    }

    private static func shiftMp4ChunkOffsets(
        in buf: inout Data,
        startOffset: Int,
        endOffset: Int,
        delta: Int,
        minOffsetToShift: Int
    ) throws {
        if delta == 0 { return }
        let containerTypes: Set<String> = ["moov", "trak", "mdia", "minf", "stbl", "edts", "dinf", "udta"]
        let boxes = parseMp4Boxes(buf, startOffset: startOffset, endOffset: endOffset)
        for box in boxes {
            if box.type == "stco" {
                if box.bodyStart + 8 <= box.end {
                    let count = Int(readUInt32BE(buf, box.bodyStart + 4))
                    var pos = box.bodyStart + 8
                    for _ in 0..<count {
                        if pos + 4 > box.end { break }
                        let oldOff = Int(readUInt32BE(buf, pos))
                        if oldOff >= minOffsetToShift {
                            let updated = oldOff + delta
                            if updated < 0 || updated > 0xFFFFFFFF {
                                throw NSError(domain: "ArtworkAndTagService", code: 500, userInfo: [NSLocalizedDescriptionKey: "stco 32-bit chunk offset overflow."])
                            }
                            writeUInt32BE(UInt32(updated), into: &buf, at: pos)
                        }
                        pos += 4
                    }
                }
            } else if box.type == "co64" {
                if box.bodyStart + 8 <= box.end {
                    let count = Int(readUInt32BE(buf, box.bodyStart + 4))
                    var pos = box.bodyStart + 8
                    for _ in 0..<count {
                        if pos + 8 > box.end { break }
                        let oldOff = Int64(readUInt64BE(buf, pos))
                        if oldOff >= Int64(minOffsetToShift) {
                            let updated = UInt64(oldOff + Int64(delta))
                            writeUInt64BE(updated, into: &buf, at: pos)
                        }
                        pos += 8
                    }
                }
            } else if containerTypes.contains(box.type) {
                try shiftMp4ChunkOffsets(in: &buf, startOffset: box.bodyStart, endOffset: box.end, delta: delta, minOffsetToShift: minOffsetToShift)
            }
        }
    }

    public static func transformMp4CovrAtom(_ fileBuf: Data, imageBuffer: Data?) throws -> Data {
        let topBoxes = parseMp4Boxes(fileBuf, startOffset: 0, endOffset: fileBuf.count)
        guard let moovBox = topBoxes.first(where: { $0.type == "moov" }) else {
            throw NSError(domain: "ArtworkAndTagService", code: 400, userInfo: [NSLocalizedDescriptionKey: "Invalid M4A/MP4 container: missing moov atom."])
        }

        let moovChildren = parseMp4Boxes(fileBuf, startOffset: moovBox.bodyStart, endOffset: moovBox.end)
        let existingUdta = moovChildren.first(where: { $0.type == "udta" })

        let newUdtaBuf: Data
        if let existingUdta = existingUdta {
            let udtaChildren = parseMp4Boxes(fileBuf, startOffset: existingUdta.bodyStart, endOffset: existingUdta.end)
            let existingMeta = udtaChildren.first(where: { $0.type == "meta" })
            let newMetaBuf: Data

            if let existingMeta = existingMeta {
                let metaVersionFlags = existingMeta.bodyStart + 4 <= existingMeta.end
                    ? fileBuf.subdata(in: existingMeta.bodyStart..<(existingMeta.bodyStart + 4))
                    : Data(count: 4)
                let metaChildrenStart = existingMeta.bodyStart + 4
                let metaChildren = parseMp4Boxes(fileBuf, startOffset: metaChildrenStart, endOffset: existingMeta.end)
                let existingIlst = metaChildren.first(where: { $0.type == "ilst" })

                let newIlstBuf: Data
                if let existingIlst = existingIlst {
                    let ilstChildren = parseMp4Boxes(fileBuf, startOffset: existingIlst.bodyStart, endOffset: existingIlst.end)
                    var keptIlstItems = ilstChildren
                        .filter { $0.type != "covr" && $0.type != "free" }
                        .map { fileBuf.subdata(in: $0.start..<$0.end) }
                    if let img = imageBuffer, !img.isEmpty {
                        keptIlstItems.append(buildMp4CovrBox(img))
                    }
                    newIlstBuf = makeMp4Box("ilst", payloads: keptIlstItems)
                } else {
                    let items = (imageBuffer != nil && !imageBuffer!.isEmpty) ? [buildMp4CovrBox(imageBuffer!)] : []
                    newIlstBuf = makeMp4Box("ilst", payloads: items)
                }

                var rebuiltMetaChildren: [Data] = []
                var hasHdlr = false
                var insertedIlst = false
                for child in metaChildren {
                    if child.type == "free" { continue }
                    if child.type == "hdlr" { hasHdlr = true }
                    if child.type == "ilst" {
                        rebuiltMetaChildren.append(newIlstBuf)
                        insertedIlst = true
                    } else {
                        rebuiltMetaChildren.append(fileBuf.subdata(in: child.start..<child.end))
                    }
                }
                if !hasHdlr { rebuiltMetaChildren.insert(buildMp4HdlrMdirBox(), at: 0) }
                if !insertedIlst { rebuiltMetaChildren.append(newIlstBuf) }
                newMetaBuf = makeMp4Box("meta", payloads: [metaVersionFlags] + rebuiltMetaChildren)
            } else {
                let ilstItems = (imageBuffer != nil && !imageBuffer!.isEmpty) ? [buildMp4CovrBox(imageBuffer!)] : []
                let newIlstBuf = makeMp4Box("ilst", payloads: ilstItems)
                newMetaBuf = makeMp4Box("meta", payloads: [Data(count: 4), buildMp4HdlrMdirBox(), newIlstBuf])
            }

            var rebuiltUdtaChildren: [Data] = []
            var insertedMeta = false
            for child in udtaChildren {
                if child.type == "free" { continue }
                if child.type == "meta" {
                    rebuiltUdtaChildren.append(newMetaBuf)
                    insertedMeta = true
                } else {
                    rebuiltUdtaChildren.append(fileBuf.subdata(in: child.start..<child.end))
                }
            }
            if !insertedMeta { rebuiltUdtaChildren.append(newMetaBuf) }
            newUdtaBuf = makeMp4Box("udta", payloads: rebuiltUdtaChildren)
        } else {
            let ilstItems = (imageBuffer != nil && !imageBuffer!.isEmpty) ? [buildMp4CovrBox(imageBuffer!)] : []
            let newIlstBuf = makeMp4Box("ilst", payloads: ilstItems)
            let newMetaBuf = makeMp4Box("meta", payloads: [Data(count: 4), buildMp4HdlrMdirBox(), newIlstBuf])
            newUdtaBuf = makeMp4Box("udta", payloads: [newMetaBuf])
        }

        var rebuiltMoovChildren: [Data] = []
        var insertedUdta = false
        for child in moovChildren {
            if child.type == "free" { continue }
            if child.type == "udta" {
                rebuiltMoovChildren.append(newUdtaBuf)
                insertedUdta = true
            } else {
                rebuiltMoovChildren.append(fileBuf.subdata(in: child.start..<child.end))
            }
        }
        if !insertedUdta { rebuiltMoovChildren.append(newUdtaBuf) }

        var newMoovBuf = makeMp4Box("moov", payloads: rebuiltMoovChildren)
        let delta = newMoovBuf.count - moovBox.size
        if delta != 0 {
            try shiftMp4ChunkOffsets(
                in: &newMoovBuf,
                startOffset: 8,
                endOffset: newMoovBuf.count,
                delta: delta,
                minOffsetToShift: moovBox.end
            )
        }

        var out = Data(capacity: fileBuf.count + delta)
        out.append(fileBuf.subdata(in: 0..<moovBox.start))
        out.append(newMoovBuf)
        out.append(fileBuf.subdata(in: moovBox.end..<fileBuf.count))
        return out
    }

    // MARK: - Container Extraction & Embedding Public API
    public func extractEmbeddedArt(filePath: String) -> (data: Data, mimeType: String)? {
        let fm = FileManager.default
        guard let attrs = try? fm.attributesOfItem(atPath: filePath) else { return nil }
        let modTime = (attrs[.modificationDate] as? Date)?.timeIntervalSince1970 ?? 0
        let fSize = (attrs[.size] as? NSNumber)?.int64Value ?? 0

        lock.lock()
        if let cached = embeddedArtMemoCache[filePath], cached.modTime == modTime, cached.size == fSize {
            lock.unlock()
            if cached.hasArt, let d = cached.data {
                return (d, cached.mimeType ?? "image/jpeg")
            }
            return nil
        }
        lock.unlock()

        let ext = "." + (filePath as NSString).pathExtension.lowercased()
        guard let fileBuf = try? Data(contentsOf: URL(fileURLWithPath: filePath), options: .mappedIfSafe) else {
            return nil
        }

        var extracted: (data: Data, mimeType: String)? = nil
        if ext == ".m4a" || ext == ".alac" || ext == ".mp4" || ext == ".aac" {
            extracted = Self.extractMp4Covr(fileBuf)
        } else if ext == ".flac" {
            extracted = Self.extractFlacPicture(fileBuf)
        } else if ext == ".mp3" {
            extracted = Self.extractMp3Apic(fileBuf)
        }

        lock.lock()
        if embeddedArtMemoCache.count >= 300, let firstKey = embeddedArtMemoCache.keys.first {
            embeddedArtMemoCache.removeValue(forKey: firstKey)
        }
        embeddedArtMemoCache[filePath] = MemoArtEntry(
            modTime: modTime,
            size: fSize,
            hasArt: extracted != nil,
            data: extracted?.data,
            mimeType: extracted?.mimeType
        )
        lock.unlock()

        return extracted
    }

    public func hasEmbeddedArt(filePath: String) -> Bool {
        return extractEmbeddedArt(filePath: filePath) != nil
    }

    public func embedArtData(filePath: String, rawImageData: Data) throws -> Int64 {
        let ext = "." + (filePath as NSString).pathExtension.lowercased()
        let jpegData = try Self.normalizeToJpegData(rawImageData)
        let originalBuf = try Data(contentsOf: URL(fileURLWithPath: filePath))

        let updatedBuf: Data
        if ext == ".mp3" {
            updatedBuf = Self.transformMp3Id3v2(originalBuf, imageBuffer: jpegData)
        } else if ext == ".flac" {
            updatedBuf = try Self.transformFlacPictureBlocks(originalBuf, imageBuffer: jpegData)
        } else if ext == ".m4a" || ext == ".alac" || ext == ".mp4" || ext == ".aac" {
            updatedBuf = try Self.transformMp4CovrAtom(originalBuf, imageBuffer: jpegData)
        } else {
            throw NSError(domain: "ArtworkAndTagService", code: 400, userInfo: [NSLocalizedDescriptionKey: "Unsupported container \(ext) for artwork embedding."])
        }

        guard updatedBuf.count >= 128 else {
            throw NSError(domain: "ArtworkAndTagService", code: 500, userInfo: [NSLocalizedDescriptionKey: "Generated audio container is invalid or empty."])
        }

        let tmpPath = "\(filePath).\(Int(Date().timeIntervalSince1970 * 1000)).tmp\(ext)"
        try updatedBuf.write(to: URL(fileURLWithPath: tmpPath), options: .atomic)
        _ = try FileManager.default.replaceItemAt(
            URL(fileURLWithPath: filePath),
            withItemAt: URL(fileURLWithPath: tmpPath)
        )
        invalidateEmbeddedArtCache(filePath: filePath)
        return Int64(updatedBuf.count)
    }

    public func removeEmbeddedArt(filePath: String) throws -> Int64 {
        let ext = "." + (filePath as NSString).pathExtension.lowercased()
        let originalBuf = try Data(contentsOf: URL(fileURLWithPath: filePath))

        let updatedBuf: Data
        if ext == ".mp3" {
            updatedBuf = Self.transformMp3Id3v2(originalBuf, imageBuffer: nil)
        } else if ext == ".flac" {
            updatedBuf = try Self.transformFlacPictureBlocks(originalBuf, imageBuffer: nil)
        } else if ext == ".m4a" || ext == ".alac" || ext == ".mp4" || ext == ".aac" {
            updatedBuf = try Self.transformMp4CovrAtom(originalBuf, imageBuffer: nil)
        } else {
            return Int64(originalBuf.count)
        }

        guard updatedBuf.count >= 64 else {
            throw NSError(domain: "ArtworkAndTagService", code: 500, userInfo: [NSLocalizedDescriptionKey: "Generated stripped audio container is invalid or empty."])
        }

        let tmpPath = "\(filePath).\(Int(Date().timeIntervalSince1970 * 1000)).tmp\(ext)"
        try updatedBuf.write(to: URL(fileURLWithPath: tmpPath), options: .atomic)
        _ = try FileManager.default.replaceItemAt(
            URL(fileURLWithPath: filePath),
            withItemAt: URL(fileURLWithPath: tmpPath)
        )
        invalidateEmbeddedArtCache(filePath: filePath)
        return Int64(updatedBuf.count)
    }

    // MARK: - Search Term Cleaning, Normalization & Scored Multi-Tier Waterfall
    public struct ArtworkSearchCandidate: Sendable {
        public let provider: String
        public let artistName: String
        public let albumName: String
        public let imageUrl: String
        public let artistScore: Double
        public let albumScore: Double
        public let combinedScore: Double
        public let accepted: Bool
        public let rejectionReason: String?
    }

    public struct ArtworkSearchDiagnostics: Sendable {
        public let query: String
        public let effectiveArtist: String
        public let cleanedAlbum: String
        public let isCompilation: Bool
        public let selected: ArtworkSearchCandidate?
        public let candidates: [ArtworkSearchCandidate]
    }

    public static func cleanSearchTerms(artist: String?, album: String?) -> (cleanedArtist: String, cleanedAlbum: String, originalArtist: String, originalAlbum: String) {
        let origArtist = (artist ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let origAlbum = (album ?? "").trimmingCharacters(in: .whitespacesAndNewlines)

        func clean(_ str: String) -> String {
            let s = str
                .replacingOccurrences(of: "[’‘`]", with: "'", options: .regularExpression)
                .replacingOccurrences(of: "[“”]", with: "\"", options: .regularExpression)
                .replacingOccurrences(of: #"\s*[\(\[](remaster(ed)?(\s*\d{4})?|deluxe|expanded|anniversary|special|bonus|live|mono|stereo|explicit)[\)\]]"#, with: "", options: [.regularExpression, .caseInsensitive])
                .replacingOccurrences(of: #"\s*[\(\[][^)\]]*\b(remaster(ed)?|deluxe|expanded|anniversary|special\s+edition|bonus\s+track|edition|reissue|explicit|mono|stereo)\b[^)\]]*[\)\]]"#, with: "", options: [.regularExpression, .caseInsensitive])
                .replacingOccurrences(of: #"\s*[\(\[](disc|cd)\s*\d+[^)\]]*[\)\]]"#, with: "", options: [.regularExpression, .caseInsensitive])
                .replacingOccurrences(of: #"\s*[\(\[](feat\.?|ft\.?|featuring)\s+[^)\]]+[\)\]]"#, with: "", options: [.regularExpression, .caseInsensitive])
                .replacingOccurrences(of: #"\s+\b(feat\.?|ft\.?|featuring)\s+.*$"#, with: "", options: [.regularExpression, .caseInsensitive])
                .replacingOccurrences(of: #"\s*[\(\[](original\s+motion\s+picture\s+soundtrack|motion\s+picture\s+soundtrack|soundtrack|ost)[\)\]]"#, with: "", options: [.regularExpression, .caseInsensitive])
                .replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
                .replacingOccurrences(of: #"[\s\-–—:]+$"#, with: "", options: .regularExpression)
                .trimmingCharacters(in: .whitespacesAndNewlines)
            return s
        }

        let cArtist = clean(origArtist)
        let cAlbum = clean(origAlbum)
        return (
            cArtist.isEmpty ? origArtist : cArtist,
            cAlbum.isEmpty ? origAlbum : cAlbum,
            origArtist,
            origAlbum
        )
    }

    public static func normalizeForComparison(_ str: String) -> String {
        var s = str
            .folding(options: [.diacriticInsensitive, .caseInsensitive], locale: Locale(identifier: "en_US_POSIX"))
            .lowercased()
            .replacingOccurrences(of: "[’‘`']", with: "", options: .regularExpression)
            .replacingOccurrences(of: "[“”\"]", with: "", options: .regularExpression)
            .replacingOccurrences(of: "&", with: " and ")
            .replacingOccurrences(of: "+", with: " and ")
            .replacingOccurrences(of: #"[^a-z0-9\s]"#, with: " ", options: .regularExpression)
            .replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        if s.hasPrefix("the ") && s.count > 4 {
            s = String(s.dropFirst(4)).trimmingCharacters(in: .whitespacesAndNewlines)
        }
        return s
    }

    public static func levenshteinSimilarity(_ a: String, _ b: String) -> Double {
        if a == b { return 1.0 }
        let aChars = Array(a)
        let bChars = Array(b)
        let m = aChars.count
        let n = bChars.count
        if m == 0 || n == 0 { return 0.0 }

        var prev = Array(0...n)
        var curr = Array(repeating: 0, count: n + 1)

        for i in 1...m {
            curr[0] = i
            for j in 1...n {
                let cost = (aChars[i - 1] == bChars[j - 1]) ? 0 : 1
                curr[j] = min(
                    prev[j] + 1,
                    curr[j - 1] + 1,
                    prev[j - 1] + cost
                )
            }
            prev = curr
        }

        let dist = prev[n]
        return max(0.0, 1.0 - Double(dist) / Double(max(m, n)))
    }

    public static func tokenSimilarity(_ a: String, _ b: String) -> Double {
        let tokensA = Set(a.split(separator: " ").map(String.init))
        let tokensB = Set(b.split(separator: " ").map(String.init))
        if tokensA.isEmpty || tokensB.isEmpty { return 0.0 }
        let inter = tokensA.intersection(tokensB).count
        return (2.0 * Double(inter)) / Double(tokensA.count + tokensB.count)
    }

    public static func isCompilationRelease(
        albumArtist: String?,
        artist: String?,
        album: String?,
        compilation: Bool?
    ) -> Bool {
        if compilation == true { return true }
        let normAA = normalizeForComparison(albumArtist ?? "")
        if ["various artists", "various", "va", "soundtrack", "original soundtrack", "ost"].contains(normAA) {
            return true
        }
        if normAA.contains("various artist") || normAA.contains("soundtrack") {
            return true
        }
        let normArt = normalizeForComparison(artist ?? "")
        if normArt == "various artists" || normArt == "various" {
            return true
        }
        return false
    }

    public static func resolveEffectiveArtist(
        albumArtist: String?,
        artist: String?,
        isCompilation: Bool
    ) -> String {
        let aa = (albumArtist ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let art = (artist ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        if isCompilation {
            if !aa.isEmpty && aa.lowercased() != "unknown artist" {
                return aa
            }
            return "Various Artists"
        }
        if !aa.isEmpty && aa.lowercased() != "unknown artist" {
            return aa
        }
        return art
    }

    private static func containsWholeWordOrPhrase(_ haystack: String, _ needle: String) -> Bool {
        guard !needle.isEmpty else { return false }
        if haystack == needle { return true }
        let paddedH = " \(haystack) "
        let paddedN = " \(needle) "
        return paddedH.contains(paddedN)
    }

    public static func scoreCandidate(
        provider: String,
        candidateArtist: String,
        candidateAlbum: String,
        imageUrl: String,
        expectedArtist: String,
        expectedTrackArtist: String,
        expectedAlbum: String,
        originalArtist: String,
        originalAlbum: String,
        isCompilation: Bool
    ) -> ArtworkSearchCandidate {
        let normExpArtist = normalizeForComparison(expectedArtist)
        let normTrackArtist = normalizeForComparison(expectedTrackArtist)
        let normExpAlbum = normalizeForComparison(expectedAlbum)
        let normCandArtist = normalizeForComparison(candidateArtist)
        let normCandAlbum = normalizeForComparison(candidateAlbum)

        // 1. Artist Match Gate (Mandatory)
        var artistScore = 0.0
        var artistPassed = false

        if isCompilation {
            let isGenericCompArtist = normCandArtist == "various artists" ||
                normCandArtist == "various" ||
                normCandArtist.contains("soundtrack") ||
                normCandArtist.contains("cast") ||
                normCandArtist.contains("ensemble") ||
                normCandArtist.contains("orchestra")
            if isGenericCompArtist {
                artistScore = 1.0
                artistPassed = true
            } else if !normTrackArtist.isEmpty {
                let trackSim = max(
                    levenshteinSimilarity(normCandArtist, normTrackArtist),
                    tokenSimilarity(normCandArtist, normTrackArtist)
                )
                if containsWholeWordOrPhrase(normCandArtist, normTrackArtist) || containsWholeWordOrPhrase(normTrackArtist, normCandArtist) {
                    artistScore = max(trackSim, 0.90)
                } else {
                    artistScore = trackSim
                }
                artistPassed = artistScore >= 0.80
            }
        } else {
            if !normExpArtist.isEmpty && !normCandArtist.isEmpty {
                if normCandArtist == normExpArtist {
                    artistScore = 1.0
                } else if (normExpArtist.count >= 3 && containsWholeWordOrPhrase(normCandArtist, normExpArtist)) ||
                          (normCandArtist.count >= 3 && containsWholeWordOrPhrase(normExpArtist, normCandArtist)) {
                    artistScore = 0.90
                } else {
                    artistScore = max(
                        levenshteinSimilarity(normCandArtist, normExpArtist),
                        tokenSimilarity(normCandArtist, normExpArtist)
                    )
                }
                artistPassed = artistScore >= 0.80
            }
        }

        // 2. Album Title Score
        var albumScore = 0.0
        if !normExpAlbum.isEmpty && !normCandAlbum.isEmpty {
            if normCandAlbum == normExpAlbum {
                albumScore = 1.0
            } else if (normExpAlbum.count >= 4 && containsWholeWordOrPhrase(normCandAlbum, normExpAlbum)) ||
                      (normCandAlbum.count >= 4 && containsWholeWordOrPhrase(normExpAlbum, normCandAlbum)) {
                albumScore = 0.90
            } else {
                albumScore = max(
                    levenshteinSimilarity(normCandAlbum, normExpAlbum),
                    tokenSimilarity(normCandAlbum, normExpAlbum)
                )
            }
        }

        // 3. Tribute / Karaoke / Cover / Instrumental Penalty
        let sourceLower = "\(originalArtist) \(originalAlbum)".lowercased()
        let candLower = "\(candidateArtist) \(candidateAlbum)".lowercased()
        let hardRejectKeywords = ["karaoke", "tribute to", "in the style of", "made famous by", "ringtone"]
        for kw in hardRejectKeywords {
            if candLower.contains(kw) && !sourceLower.contains(kw) {
                return ArtworkSearchCandidate(
                    provider: provider,
                    artistName: candidateArtist,
                    albumName: candidateAlbum,
                    imageUrl: imageUrl,
                    artistScore: artistScore,
                    albumScore: albumScore,
                    combinedScore: 0.0,
                    accepted: false,
                    rejectionReason: "Rejected \(kw) release"
                )
            }
        }

        var penalty = 0.0
        let softPenaltyKeywords = ["tribute", "cover", "instrumental"]
        for kw in softPenaltyKeywords {
            if candLower.contains(kw) && !sourceLower.contains(kw) {
                penalty += 0.45
            }
        }

        if !artistPassed {
            return ArtworkSearchCandidate(
                provider: provider,
                artistName: candidateArtist,
                albumName: candidateAlbum,
                imageUrl: imageUrl,
                artistScore: artistScore,
                albumScore: albumScore,
                combinedScore: max(0.0, (artistScore * 0.45) + (albumScore * 0.55) - penalty),
                accepted: false,
                rejectionReason: String(format: "Artist mismatch (%.2f < 0.80)", artistScore)
            )
        }

        let combined = max(0.0, min(1.0, (artistScore * 0.45) + (albumScore * 0.55) - penalty))
        let accepted = combined >= 0.75 && (!isCompilation || albumScore >= 0.75)
        let reason: String? = accepted ? nil : String(format: "Low confidence (%.2f < 0.75)", combined)

        return ArtworkSearchCandidate(
            provider: provider,
            artistName: candidateArtist,
            albumName: candidateAlbum,
            imageUrl: imageUrl,
            artistScore: artistScore,
            albumScore: albumScore,
            combinedScore: combined,
            accepted: accepted,
            rejectionReason: reason
        )
    }

    private func fetchUrlData(_ urlStr: String) async -> Data? {
        guard let url = URL(string: urlStr) else { return nil }
        var req = URLRequest(url: url, timeoutInterval: 12)
        req.setValue(Self.userAgent, forHTTPHeaderField: "User-Agent")
        guard let (data, resp) = try? await URLSession.shared.data(for: req),
              let http = resp as? HTTPURLResponse,
              (200...299).contains(http.statusCode),
              !data.isEmpty else {
            return nil
        }
        return data
    }

    private func queryItunesCandidates(
        term: String,
        expectedArtist: String,
        expectedTrackArtist: String,
        expectedAlbum: String,
        originalArtist: String,
        originalAlbum: String,
        isCompilation: Bool
    ) async -> [ArtworkSearchCandidate] {
        let trimmed = term.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty,
              let encoded = trimmed.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed),
              let data = await fetchUrlData("https://itunes.apple.com/search?term=\(encoded)&entity=album&limit=10"),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let results = json["results"] as? [[String: Any]] else {
            return []
        }

        var scored: [ArtworkSearchCandidate] = []
        for item in results {
            guard let artUrl = item["artworkUrl100"] as? String, !artUrl.isEmpty else { continue }
            let hiResUrl = artUrl
                .replacingOccurrences(of: "100x100bb.jpg", with: "1000x1000bb.jpg")
                .replacingOccurrences(of: #"/\d+x\d+bb\.(jpg|png)$"#, with: "/1000x1000bb.jpg", options: [.regularExpression, .caseInsensitive])
            let candArtist = (item["artistName"] as? String) ?? ""
            let candAlbum = (item["collectionName"] as? String) ?? ""
            let cand = Self.scoreCandidate(
                provider: "iTunes",
                candidateArtist: candArtist,
                candidateAlbum: candAlbum,
                imageUrl: hiResUrl,
                expectedArtist: expectedArtist,
                expectedTrackArtist: expectedTrackArtist,
                expectedAlbum: expectedAlbum,
                originalArtist: originalArtist,
                originalAlbum: originalAlbum,
                isCompilation: isCompilation
            )
            scored.append(cand)
        }
        return scored.sorted { $0.combinedScore > $1.combinedScore }
    }

    public func searchITunes(
        artist: String,
        album: String,
        trackArtist: String = "",
        originalArtist: String = "",
        originalAlbum: String = "",
        isCompilation: Bool = false
    ) async -> (data: Data, provider: String, diagnostics: ArtworkSearchDiagnostics)? {
        if isCancelled() { return nil }
        let hasArtist = !artist.isEmpty && artist.lowercased() != "unknown artist"
        let hasAlbum = !album.isEmpty && album.lowercased() != "unknown album"
        guard hasAlbum else { return nil }
        if !isCompilation && !hasArtist { return nil }

        let queryTerm: String
        if isCompilation {
            let normAA = Self.normalizeForComparison(artist)
            if normAA.contains("soundtrack") || originalAlbum.lowercased().contains("soundtrack") {
                queryTerm = "\(album) soundtrack"
            } else {
                queryTerm = album
            }
        } else {
            queryTerm = "\(artist) \(album)"
        }

        let candidates = await queryItunesCandidates(
            term: queryTerm,
            expectedArtist: artist,
            expectedTrackArtist: trackArtist,
            expectedAlbum: album,
            originalArtist: originalArtist.isEmpty ? artist : originalArtist,
            originalAlbum: originalAlbum.isEmpty ? album : originalAlbum,
            isCompilation: isCompilation
        )

        let best = candidates.first(where: { $0.accepted })
        let diag = ArtworkSearchDiagnostics(
            query: "iTunes:\(queryTerm)",
            effectiveArtist: artist,
            cleanedAlbum: album,
            isCompilation: isCompilation,
            selected: best,
            candidates: candidates
        )
        guard let winner = best, let imgData = await fetchUrlData(winner.imageUrl) else {
            return nil
        }
        return (imgData, "iTunes", diag)
    }

    private func queryDeezerCandidates(
        queryStr: String,
        expectedArtist: String,
        expectedTrackArtist: String,
        expectedAlbum: String,
        originalArtist: String,
        originalAlbum: String,
        isCompilation: Bool
    ) async -> [ArtworkSearchCandidate] {
        let trimmed = queryStr.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty,
              let encoded = trimmed.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed),
              let data = await fetchUrlData("https://api.deezer.com/search/album?q=\(encoded)&limit=10"),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let items = json["data"] as? [[String: Any]] else {
            return []
        }

        var scored: [ArtworkSearchCandidate] = []
        for item in items {
            guard let url = (item["cover_xl"] as? String) ?? (item["cover_big"] as? String) ?? (item["cover_medium"] as? String),
                  !url.isEmpty else {
                continue
            }
            let artistDict = item["artist"] as? [String: Any]
            let candArtist = (artistDict?["name"] as? String) ?? ""
            let candAlbum = (item["title"] as? String) ?? ""
            let cand = Self.scoreCandidate(
                provider: "Deezer",
                candidateArtist: candArtist,
                candidateAlbum: candAlbum,
                imageUrl: url,
                expectedArtist: expectedArtist,
                expectedTrackArtist: expectedTrackArtist,
                expectedAlbum: expectedAlbum,
                originalArtist: originalArtist,
                originalAlbum: originalAlbum,
                isCompilation: isCompilation
            )
            scored.append(cand)
        }
        return scored.sorted { $0.combinedScore > $1.combinedScore }
    }

    public func searchDeezer(
        artist: String,
        album: String,
        trackArtist: String = "",
        originalArtist: String = "",
        originalAlbum: String = "",
        isCompilation: Bool = false
    ) async -> (data: Data, provider: String, diagnostics: ArtworkSearchDiagnostics)? {
        if isCancelled() { return nil }
        let hasArtist = !artist.isEmpty && artist.lowercased() != "unknown artist"
        let hasAlbum = !album.isEmpty && album.lowercased() != "unknown album"
        guard hasAlbum else { return nil }
        if !isCompilation && !hasArtist { return nil }

        let queries: [String] = isCompilation
            ? ["album:\"\(album)\""]
            : ["artist:\"\(artist)\" album:\"\(album)\"", "\(artist) \(album)"]

        var allCandidates: [ArtworkSearchCandidate] = []
        var usedQuery = queries[0]
        var winner: ArtworkSearchCandidate? = nil

        for q in queries {
            usedQuery = q
            let cands = await queryDeezerCandidates(
                queryStr: q,
                expectedArtist: artist,
                expectedTrackArtist: trackArtist,
                expectedAlbum: album,
                originalArtist: originalArtist.isEmpty ? artist : originalArtist,
                originalAlbum: originalAlbum.isEmpty ? album : originalAlbum,
                isCompilation: isCompilation
            )
            allCandidates = cands
            if let best = cands.first(where: { $0.accepted }) {
                winner = best
                break
            }
        }

        let diag = ArtworkSearchDiagnostics(
            query: "Deezer:\(usedQuery)",
            effectiveArtist: artist,
            cleanedAlbum: album,
            isCompilation: isCompilation,
            selected: winner,
            candidates: allCandidates
        )
        guard let selected = winner, let imgData = await fetchUrlData(selected.imageUrl) else {
            return nil
        }
        return (imgData, "Deezer", diag)
    }

    private func queryMusicBrainzCandidates(
        artist: String,
        album: String,
        trackArtist: String,
        originalArtist: String,
        originalAlbum: String,
        isCompilation: Bool
    ) async -> (query: String, candidates: [ArtworkSearchCandidate]) {
        let now = Date().timeIntervalSince1970
        let elapsed = now - lastMusicBrainzRequestTime
        if elapsed < 1.1 {
            try? await Task.sleep(nanoseconds: UInt64((1.1 - elapsed) * 1_000_000_000))
        }
        lastMusicBrainzRequestTime = Date().timeIntervalSince1970

        let lucene = isCompilation
            ? "release:\"\(album)\""
            : "release:\"\(album)\" AND artist:\"\(artist)\""
        guard let encoded = lucene.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed),
              let mbData = await fetchUrlData("https://musicbrainz.org/ws/2/release/?query=\(encoded)&fmt=json&limit=10"),
              let json = try? JSONSerialization.jsonObject(with: mbData) as? [String: Any],
              let releases = json["releases"] as? [[String: Any]] else {
            return (lucene, [])
        }

        var scored: [ArtworkSearchCandidate] = []
        for rel in releases {
            guard let id = rel["id"] as? String, !id.isEmpty else { continue }
            let candAlbum = (rel["title"] as? String) ?? ""
            var candArtist = ""
            if let credits = rel["artist-credit"] as? [[String: Any]] {
                candArtist = credits.compactMap { credit -> String? in
                    if let name = credit["name"] as? String { return name }
                    if let art = credit["artist"] as? [String: Any], let name = art["name"] as? String { return name }
                    return nil
                }.joined(separator: " ")
            }
            let cand = Self.scoreCandidate(
                provider: "CoverArtArchive",
                candidateArtist: candArtist,
                candidateAlbum: candAlbum,
                imageUrl: "https://coverartarchive.org/release/\(id)/front-1200",
                expectedArtist: artist,
                expectedTrackArtist: trackArtist,
                expectedAlbum: album,
                originalArtist: originalArtist,
                originalAlbum: originalAlbum,
                isCompilation: isCompilation
            )
            scored.append(cand)
        }
        return (lucene, scored.sorted { $0.combinedScore > $1.combinedScore })
    }

    public func searchMusicBrainz(
        artist: String,
        album: String,
        trackArtist: String = "",
        originalArtist: String = "",
        originalAlbum: String = "",
        isCompilation: Bool = false
    ) async -> (data: Data, provider: String, diagnostics: ArtworkSearchDiagnostics)? {
        if isCancelled() { return nil }
        let hasArtist = !artist.isEmpty && artist.lowercased() != "unknown artist"
        let hasAlbum = !album.isEmpty && album.lowercased() != "unknown album"
        guard hasAlbum else { return nil }
        if !isCompilation && !hasArtist { return nil }

        let mbResult = await queryMusicBrainzCandidates(
            artist: artist,
            album: album,
            trackArtist: trackArtist,
            originalArtist: originalArtist.isEmpty ? artist : originalArtist,
            originalAlbum: originalAlbum.isEmpty ? album : originalAlbum,
            isCompilation: isCompilation
        )

        for cand in mbResult.candidates where cand.accepted {
            if let d = await fetchUrlData(cand.imageUrl) {
                let diag = ArtworkSearchDiagnostics(
                    query: "MusicBrainz:\(mbResult.query)",
                    effectiveArtist: artist,
                    cleanedAlbum: album,
                    isCompilation: isCompilation,
                    selected: cand,
                    candidates: mbResult.candidates
                )
                return (d, "CoverArtArchive", diag)
            }
            let fallbackUrl = cand.imageUrl.replacingOccurrences(of: "/front-1200", with: "/front")
            if let d = await fetchUrlData(fallbackUrl) {
                let diag = ArtworkSearchDiagnostics(
                    query: "MusicBrainz:\(mbResult.query)",
                    effectiveArtist: artist,
                    cleanedAlbum: album,
                    isCompilation: isCompilation,
                    selected: cand,
                    candidates: mbResult.candidates
                )
                return (d, "CoverArtArchive", diag)
            }
        }
        return nil
    }

    public func diagnoseArtworkSearch(
        artist: String,
        albumArtist: String?,
        album: String,
        compilation: Bool?
    ) async -> ArtworkSearchDiagnostics {
        let isComp = Self.isCompilationRelease(albumArtist: albumArtist, artist: artist, album: album, compilation: compilation)
        let effectiveRawArtist = Self.resolveEffectiveArtist(albumArtist: albumArtist, artist: artist, isCompilation: isComp)
        let terms = Self.cleanSearchTerms(artist: effectiveRawArtist, album: album)
        let trackArtistTerms = Self.cleanSearchTerms(artist: artist, album: album)

        let itunesQuery = isComp ? terms.cleanedAlbum : "\(terms.cleanedArtist) \(terms.cleanedAlbum)"
        let itunesCands = await queryItunesCandidates(
            term: itunesQuery,
            expectedArtist: terms.cleanedArtist,
            expectedTrackArtist: trackArtistTerms.cleanedArtist,
            expectedAlbum: terms.cleanedAlbum,
            originalArtist: terms.originalArtist,
            originalAlbum: terms.originalAlbum,
            isCompilation: isComp
        )
        if let best = itunesCands.first(where: { $0.accepted }) {
            return ArtworkSearchDiagnostics(
                query: "iTunes:\(itunesQuery)",
                effectiveArtist: terms.cleanedArtist,
                cleanedAlbum: terms.cleanedAlbum,
                isCompilation: isComp,
                selected: best,
                candidates: itunesCands
            )
        }

        let dzQuery = isComp ? "album:\"\(terms.cleanedAlbum)\"" : "artist:\"\(terms.cleanedArtist)\" album:\"\(terms.cleanedAlbum)\""
        let dzCands = await queryDeezerCandidates(
            queryStr: dzQuery,
            expectedArtist: terms.cleanedArtist,
            expectedTrackArtist: trackArtistTerms.cleanedArtist,
            expectedAlbum: terms.cleanedAlbum,
            originalArtist: terms.originalArtist,
            originalAlbum: terms.originalAlbum,
            isCompilation: isComp
        )
        if let best = dzCands.first(where: { $0.accepted }) {
            return ArtworkSearchDiagnostics(
                query: "Deezer:\(dzQuery)",
                effectiveArtist: terms.cleanedArtist,
                cleanedAlbum: terms.cleanedAlbum,
                isCompilation: isComp,
                selected: best,
                candidates: itunesCands + dzCands
            )
        }

        let mbRes = await queryMusicBrainzCandidates(
            artist: terms.cleanedArtist,
            album: terms.cleanedAlbum,
            trackArtist: trackArtistTerms.cleanedArtist,
            originalArtist: terms.originalArtist,
            originalAlbum: terms.originalAlbum,
            isCompilation: isComp
        )
        let mbBest = mbRes.candidates.first(where: { $0.accepted })
        return ArtworkSearchDiagnostics(
            query: "iTunes:\(itunesQuery) -> Deezer:\(dzQuery) -> MB:\(mbRes.query)",
            effectiveArtist: terms.cleanedArtist,
            cleanedAlbum: terms.cleanedAlbum,
            isCompilation: isComp,
            selected: mbBest,
            candidates: itunesCands + dzCands + mbRes.candidates
        )
    }

    public func fetchAndEmbedAlbumArt(
        artist: String,
        albumArtist: String? = nil,
        album: String,
        compilation: Bool? = nil,
        targetAudioPath: String,
        rateLimitDelayMs: Int = 150
    ) async throws -> (status: String, provider: String?, fileSize: Int64?) {
        let isComp = Self.isCompilationRelease(albumArtist: albumArtist, artist: artist, album: album, compilation: compilation)
        let effectiveRawArtist = Self.resolveEffectiveArtist(albumArtist: albumArtist, artist: artist, isCompilation: isComp)
        let terms = Self.cleanSearchTerms(artist: effectiveRawArtist, album: album)
        let trackTerms = Self.cleanSearchTerms(artist: artist, album: album)

        let cacheKey = "\(Self.normalizeForComparison(terms.cleanedArtist))|\(Self.normalizeForComparison(terms.cleanedAlbum))"

        if let existing = extractEmbeddedArt(filePath: targetAudioPath) {
            lock.withLock {
                if albumArtCache[cacheKey] == nil {
                    albumArtCache[cacheKey] = AlbumCacheEntry(data: existing.data, provider: "Embedded", notFound: false)
                }
            }
            return ("ALREADY_EMBEDDED", "Embedded", nil)
        }

        let cached = lock.withLock { albumArtCache[cacheKey] }

        if let cached = cached {
            if let data = cached.data, !data.isEmpty {
                let fSize = try embedArtData(filePath: targetAudioPath, rawImageData: data)
                return ("CACHED", cached.provider ?? "Cache", fSize)
            }
            if cached.notFound {
                return ("NOT_FOUND", nil, nil)
            }
        }

        if rateLimitDelayMs > 0 {
            try? await Task.sleep(nanoseconds: UInt64(rateLimitDelayMs) * 1_000_000)
        }

        var matchData: (data: Data, provider: String)? = nil
        if let res = await searchITunes(
            artist: terms.cleanedArtist,
            album: terms.cleanedAlbum,
            trackArtist: trackTerms.cleanedArtist,
            originalArtist: terms.originalArtist,
            originalAlbum: terms.originalAlbum,
            isCompilation: isComp
        ) {
            matchData = (res.data, res.provider)
        }
        if matchData == nil, let res = await searchDeezer(
            artist: terms.cleanedArtist,
            album: terms.cleanedAlbum,
            trackArtist: trackTerms.cleanedArtist,
            originalArtist: terms.originalArtist,
            originalAlbum: terms.originalAlbum,
            isCompilation: isComp
        ) {
            matchData = (res.data, res.provider)
        }
        if matchData == nil, let res = await searchMusicBrainz(
            artist: terms.cleanedArtist,
            album: terms.cleanedAlbum,
            trackArtist: trackTerms.cleanedArtist,
            originalArtist: terms.originalArtist,
            originalAlbum: terms.originalAlbum,
            isCompilation: isComp
        ) {
            matchData = (res.data, res.provider)
        }

        guard let found = matchData else {
            lock.withLock {
                albumArtCache[cacheKey] = AlbumCacheEntry(data: nil, provider: nil, notFound: true)
            }
            return ("NOT_FOUND", nil, nil)
        }

        lock.withLock {
            albumArtCache[cacheKey] = AlbumCacheEntry(data: found.data, provider: found.provider, notFound: false)
        }

        let fSize = try embedArtData(filePath: targetAudioPath, rawImageData: found.data)
        return ("DOWNLOADED", found.provider, fSize)
    }

    public func runArtworkBackfill(playlistId: String? = nil, trackKeys: [String]? = nil) async throws -> [String: Any] {
        try lock.withLock {
            if isFetchingArtwork {
                throw NSError(domain: "ArtworkAndTagService", code: 409, userInfo: [NSLocalizedDescriptionKey: "Artwork lookup is already in progress."])
            }
            isFetchingArtwork = true
            cancelRequested = false
            for (k, v) in albumArtCache where v.notFound {
                albumArtCache.removeValue(forKey: k)
            }
        }

        defer {
            lock.withLock {
                isFetchingArtwork = false
                cancelRequested = false
            }
        }

        let lib = LibraryService.shared
        lib.syncVaultOnDisk()
        let vaultDir = lib.getVaultDir()

        var targetTracks: [TrackRecord] = []
        var scopeLabel = "Master Library"

        if let pid = playlistId, let pl = lib.playlists[pid] {
            scopeLabel = "Playlist \"\(pl.name)\""
            targetTracks = pl.trackKeys.compactMap { lib.getTrackByKey($0) }
        } else if let keys = trackKeys, !keys.isEmpty {
            scopeLabel = "Selected View (\(keys.count) tracks)"
            targetTracks = keys.compactMap { lib.getTrackByKey($0) }
        } else {
            targetTracks = lib.getAllTracksArray()
        }

        var downloaded = 0
        var cachedCount = 0
        var skipped = 0
        var failed = 0
        var stopped = false
        var itunesCount = 0
        var deezerCount = 0
        var caaCount = 0

        emitArtworkEvent(
            type: "ARTWORK",
            message: "[ARTWORK] Starting embedded artwork backfill for \(scopeLabel) (\(targetTracks.count) tracks)…"
        )

        for track in targetTracks {
            if isCancelled() {
                stopped = true
                break
            }
            let trackKey = !track.trackKey.isEmpty ? track.trackKey : track.normalizedKey
            let audioPath = (vaultDir as NSString).appendingPathComponent(track.filename)
            let nowTs = Int64(Date().timeIntervalSince1970 * 1000)

            do {
                let res = try await fetchAndEmbedAlbumArt(
                    artist: track.artist,
                    albumArtist: track.albumArtist,
                    album: track.album,
                    compilation: track.compilation,
                    targetAudioPath: audioPath,
                    rateLimitDelayMs: 150
                )
                if res.status == "ALREADY_EMBEDDED" {
                    skipped += 1
                    lib.markTrackArtwork(trackKey: trackKey, hasArtwork: true, updatedAt: track.artworkUpdatedAt ?? nowTs)
                    emitArtworkEvent(type: "SKIPPED", message: "[ALREADY_EMBEDDED] \(track.filename)", extra: ["trackKey": trackKey, "hasArtwork": true])
                } else if res.status == "CACHED" || res.status == "DOWNLOADED" {
                    downloaded += 1
                    if res.status == "CACHED" { cachedCount += 1 }
                    if res.provider == "iTunes" { itunesCount += 1 }
                    else if res.provider == "Deezer" { deezerCount += 1 }
                    else if res.provider == "CoverArtArchive" { caaCount += 1 }

                    lib.markTrackArtwork(trackKey: trackKey, hasArtwork: true, updatedAt: nowTs, fileSize: res.fileSize)
                    emitArtworkEvent(
                        type: "ARTWORK",
                        message: "[EMBEDDED] \(track.filename) (\(res.provider ?? "iTunes")\(res.status == "CACHED" ? " cache" : ""))",
                        extra: [
                            "trackKey": trackKey,
                            "hasArtwork": true,
                            "provider": res.provider ?? "iTunes",
                            "cached": res.status == "CACHED",
                            "updatedAt": nowTs
                        ]
                    )
                } else {
                    failed += 1
                    emitArtworkEvent(type: "SKIPPED", message: "[ARTWORK: NOT FOUND] Could not resolve: \(track.artist) - \(track.album)")
                }
            } catch {
                failed += 1
                emitArtworkEvent(type: "ERROR", message: "[ERROR] Embedding artwork failed for \"\(track.title)\": \(error.localizedDescription)")
            }
        }

        lib.persist()
        let summary: [String: Any] = [
            "done": true,
            "stopped": stopped,
            "scope": scopeLabel,
            "total": targetTracks.count,
            "downloaded": downloaded,
            "cached": cachedCount,
            "migrated": 0,
            "skipped": skipped,
            "byProvider": [
                "itunes": itunesCount,
                "deezer": deezerCount,
                "coverArtArchive": caaCount,
                "migrated": 0
            ],
            "failed": failed
        ]

        let statusVerb = stopped ? "Stopped by user" : "Completed"
        emitArtworkEvent(
            type: "DONE",
            message: "[DONE] Embedded Artwork \(statusVerb) (\(scopeLabel)) — Embedded: \(downloaded) (iTunes: \(itunesCount), Deezer: \(deezerCount), CoverArtArchive: \(caaCount), Migrated: 0) | Already Embedded: \(skipped) | Not Found: \(failed)",
            extra: ["summary": summary]
        )
        return summary
    }

    // MARK: - Track Resolution & Manual Artwork Upload / Delete
    public static func normalizeBaseName(_ rawBaseName: String) throws -> String {
        let safeBase = (rawBaseName as NSString).lastPathComponent
        let stripped = safeBase.replacingOccurrences(
            of: #"\.(jpg|jpeg|png|webp|mp3|m4a|flac|alac|wav|aiff|aac|ogg)$"#,
            with: "",
            options: [.regularExpression, .caseInsensitive]
        )
        let trimmed = stripped.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty || trimmed == "." || trimmed == ".." {
            throw NSError(domain: "ArtworkAndTagService", code: 400, userInfo: [NSLocalizedDescriptionKey: "Invalid artwork baseName."])
        }
        return stripped
    }

    public func resolveTrackAudioFile(rawBaseName: String, trackKey: String = "") throws -> (baseName: String, vaultDir: String, audioPath: String?, track: TrackRecord?) {
        let lib = LibraryService.shared
        lib.initializeIfNeeded()
        let vaultDir = lib.getVaultDir()
        let baseName = try Self.normalizeBaseName(rawBaseName)
        let baseNfc = baseName.precomposedStringWithCanonicalMapping.lowercased()
        let baseTrimNfc = baseName.trimmingCharacters(in: .whitespacesAndNewlines).precomposedStringWithCanonicalMapping.lowercased()
        let allTracks = lib.getAllTracksArray()

        var track = !trackKey.isEmpty ? lib.getTrackByKey(trackKey) : nil
        if track == nil {
            track = allTracks.first { t in
                let tBase = LibraryService.getTrackBaseNameFromFilename(t.filename).precomposedStringWithCanonicalMapping.lowercased()
                return tBase == baseNfc || tBase.trimmingCharacters(in: .whitespacesAndNewlines) == baseTrimNfc
            }
        }

        let fm = FileManager.default
        if let t = track, !t.filename.isEmpty {
            let candidate = (vaultDir as NSString).appendingPathComponent(t.filename)
            if fm.isReadableFile(atPath: candidate) {
                return (baseName, vaultDir, candidate, t)
            }
        }

        for ext in LibraryService.supportedExtensions {
            let candidate = (vaultDir as NSString).appendingPathComponent("\(baseName)\(ext)")
            if fm.isReadableFile(atPath: candidate) {
                return (baseName, vaultDir, candidate, track)
            }
        }

        if let entries = try? fm.contentsOfDirectory(atPath: vaultDir) {
            for entry in entries {
                let ext = "." + (entry as NSString).pathExtension.lowercased()
                if !LibraryService.supportedExtensions.contains(ext) { continue }
                let entryBase = (entry as NSString).deletingPathExtension
                    .trimmingCharacters(in: .whitespacesAndNewlines)
                    .precomposedStringWithCanonicalMapping
                    .lowercased()
                if entryBase == baseTrimNfc {
                    return (baseName, vaultDir, (vaultDir as NSString).appendingPathComponent(entry), track)
                }
            }
        }

        return (baseName, vaultDir, nil, track)
    }

    public func getEmbeddedArtworkForBaseName(_ rawBaseName: String, trackKey: String = "") -> (data: Data, mimeType: String, baseName: String)? {
        guard let resolved = try? resolveTrackAudioFile(rawBaseName: rawBaseName, trackKey: trackKey) else {
            return nil
        }
        if let audioPath = resolved.audioPath,
           let extracted = extractEmbeddedArt(filePath: audioPath) {
            return (extracted.data, extracted.mimeType, resolved.baseName)
        }
        // Fallback to companion .jpg if present on disk
        let directJpg = (resolved.vaultDir as NSString).appendingPathComponent("\(resolved.baseName).jpg")
        if let jpgData = try? Data(contentsOf: URL(fileURLWithPath: directJpg)), !jpgData.isEmpty {
            return (jpgData, "image/jpeg", resolved.baseName)
        }
        return nil
    }

    public func saveManualArtwork(
        rawBaseName: String,
        rawImageData: Data,
        mimeType: String = "image/jpeg",
        trackKey: String = "",
        scope: String = "single",
        applyToAlbum: Bool = false,
        includeDisc: Bool = false,
        artist: String = "",
        album: String = ""
    ) throws -> [String: Any] {
        let jpegData = try Self.normalizeToJpegData(rawImageData)
        let resolved = try resolveTrackAudioFile(rawBaseName: rawBaseName, trackKey: trackKey)
        let lib = LibraryService.shared

        let effectiveScope = (scope == "album" || scope == "disc" || scope == "single")
            ? scope
            : (applyToAlbum ? (includeDisc ? "disc" : "album") : "single")
        let shouldApplyToGroup = effectiveScope == "album" || effectiveScope == "disc"
        let shouldScopeToDisc = effectiveScope == "disc" || includeDisc

        let updatedAt = Int64(Date().timeIntervalSince1970 * 1000)
        var affectedTrackKeys: [String] = []

        if let primaryAudioPath = resolved.audioPath {
            let fSize = try embedArtData(filePath: primaryAudioPath, rawImageData: jpegData)
            if let primaryTrack = resolved.track {
                let key = !primaryTrack.trackKey.isEmpty ? primaryTrack.trackKey : primaryTrack.normalizedKey
                lib.markTrackArtwork(trackKey: key, hasArtwork: true, updatedAt: updatedAt, fileSize: fSize)
                if !key.isEmpty { affectedTrackKeys.append(key) }
            }
        }

        let refArtist = resolved.track?.artist ?? artist
        let refAlbum = resolved.track?.album ?? album
        let refAlbumArtist = resolved.track?.albumArtist
        let refComp = resolved.track?.compilation
        let refDisc = resolved.track.map { LibraryService.getTrackDiscNumber($0) } ?? 1

        if shouldApplyToGroup && (!refAlbum.isEmpty || !refArtist.isEmpty) {
            let allTracks = lib.getAllTracksArray()
            let siblings = LibraryService.findAlbumSiblingTracks(
                allTracks,
                referenceArtist: refArtist,
                referenceAlbum: refAlbum,
                referenceAlbumArtist: refAlbumArtist,
                referenceCompilation: refComp,
                referenceDiscNumber: refDisc,
                includeDisc: shouldScopeToDisc
            )
            for track in siblings {
                let trackAudioPath = (resolved.vaultDir as NSString).appendingPathComponent(track.filename)
                var fSize: Int64? = nil
                if trackAudioPath != resolved.audioPath {
                    fSize = try? embedArtData(filePath: trackAudioPath, rawImageData: jpegData)
                }
                let key = !track.trackKey.isEmpty ? track.trackKey : track.normalizedKey
                lib.markTrackArtwork(trackKey: key, hasArtwork: true, updatedAt: updatedAt, fileSize: fSize)
                if !key.isEmpty && !affectedTrackKeys.contains(key) {
                    affectedTrackKeys.append(key)
                }
            }
        }

        lib.persist()
        let affectedCount = max(1, affectedTrackKeys.count)
        let albumGroupKey = resolved.track.map { LibraryService.getAlbumGroupKey(for: $0, includeDisc: shouldScopeToDisc) } ?? ""

        emitArtworkEvent(
            type: "ARTWORK",
            message: "[EMBEDDED ART] Updated embedded container art for \(resolved.baseName)\(affectedCount > 1 ? " (embedded into \(affectedCount) album tracks)" : "")",
            extra: [
                "manual": true,
                "baseName": resolved.baseName,
                "scope": effectiveScope,
                "albumGroupKey": albumGroupKey,
                "affectedTrackKeys": affectedTrackKeys,
                "hasArtwork": true,
                "updatedAt": updatedAt
            ]
        )

        return [
            "success": true,
            "baseName": resolved.baseName,
            "scope": effectiveScope,
            "albumGroupKey": albumGroupKey,
            "affectedCount": affectedCount,
            "updatedCount": affectedCount,
            "affectedTrackKeys": affectedTrackKeys,
            "updatedAt": updatedAt
        ]
    }

    public func deleteManualArtwork(
        rawBaseName: String,
        trackKey: String = "",
        scope: String = "single",
        applyToAlbum: Bool = false,
        includeDisc: Bool = false,
        artist: String = "",
        album: String = ""
    ) throws -> [String: Any] {
        let resolved = try resolveTrackAudioFile(rawBaseName: rawBaseName, trackKey: trackKey)
        let lib = LibraryService.shared

        let effectiveScope = (scope == "album" || scope == "disc" || scope == "single")
            ? scope
            : (applyToAlbum ? (includeDisc ? "disc" : "album") : "single")
        let shouldApplyToGroup = effectiveScope == "album" || effectiveScope == "disc"
        let shouldScopeToDisc = effectiveScope == "disc" || includeDisc

        let updatedAt = Int64(Date().timeIntervalSince1970 * 1000)
        var affectedTrackKeys: [String] = []

        if let primaryAudioPath = resolved.audioPath {
            let fSize = try? removeEmbeddedArt(filePath: primaryAudioPath)
            if let primaryTrack = resolved.track {
                let key = !primaryTrack.trackKey.isEmpty ? primaryTrack.trackKey : primaryTrack.normalizedKey
                lib.markTrackArtwork(trackKey: key, hasArtwork: false, updatedAt: updatedAt, fileSize: fSize)
                if !key.isEmpty { affectedTrackKeys.append(key) }
            }
        }

        let refArtist = resolved.track?.artist ?? artist
        let refAlbum = resolved.track?.album ?? album
        let refAlbumArtist = resolved.track?.albumArtist
        let refComp = resolved.track?.compilation
        let refDisc = resolved.track.map { LibraryService.getTrackDiscNumber($0) } ?? 1

        if shouldApplyToGroup && (!refAlbum.isEmpty || !refArtist.isEmpty) {
            let allTracks = lib.getAllTracksArray()
            let siblings = LibraryService.findAlbumSiblingTracks(
                allTracks,
                referenceArtist: refArtist,
                referenceAlbum: refAlbum,
                referenceAlbumArtist: refAlbumArtist,
                referenceCompilation: refComp,
                referenceDiscNumber: refDisc,
                includeDisc: shouldScopeToDisc
            )
            for track in siblings {
                let trackAudioPath = (resolved.vaultDir as NSString).appendingPathComponent(track.filename)
                let fSize = try? removeEmbeddedArt(filePath: trackAudioPath)
                let key = !track.trackKey.isEmpty ? track.trackKey : track.normalizedKey
                lib.markTrackArtwork(trackKey: key, hasArtwork: false, updatedAt: updatedAt, fileSize: fSize)
                if !key.isEmpty && !affectedTrackKeys.contains(key) {
                    affectedTrackKeys.append(key)
                }
            }
        }

        lib.persist()
        let isComp = Self.isCompilationRelease(
            albumArtist: refAlbumArtist,
            artist: refArtist,
            album: refAlbum,
            compilation: refComp
        )
        let effectiveRawArtist = Self.resolveEffectiveArtist(
            albumArtist: refAlbumArtist,
            artist: refArtist,
            isCompilation: isComp
        )
        let cacheTerms = Self.cleanSearchTerms(artist: effectiveRawArtist, album: refAlbum)
        let cacheKey = "\(Self.normalizeForComparison(cacheTerms.cleanedArtist))|\(Self.normalizeForComparison(cacheTerms.cleanedAlbum))"
        lock.withLock {
            albumArtCache.removeValue(forKey: cacheKey)
        }

        let removedCount = max(1, affectedTrackKeys.count)
        let albumGroupKey = resolved.track.map { LibraryService.getAlbumGroupKey(for: $0, includeDisc: shouldScopeToDisc) } ?? ""

        emitArtworkEvent(
            type: "ARTWORK",
            message: "[EMBEDDED ART] Removed embedded artwork from \(resolved.baseName)\(removedCount > 1 ? " (\(removedCount) album tracks)" : "")",
            extra: [
                "manual": true,
                "baseName": resolved.baseName,
                "scope": effectiveScope,
                "albumGroupKey": albumGroupKey,
                "affectedTrackKeys": affectedTrackKeys,
                "hasArtwork": false,
                "updatedAt": updatedAt
            ]
        )

        return [
            "success": true,
            "baseName": resolved.baseName,
            "scope": effectiveScope,
            "albumGroupKey": albumGroupKey,
            "removedCount": removedCount,
            "affectedCount": removedCount,
            "affectedTrackKeys": affectedTrackKeys,
            "updatedAt": updatedAt
        ]
    }
}
