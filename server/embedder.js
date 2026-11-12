import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parseFile } from 'music-metadata';

const execFileAsync = promisify(execFile);

const ALLOWED_IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
]);

// Cached CLI binary resolution (`metaflac`, `ffmpeg`)
const cliCache = new Map();

async function resolveCliBinary(binaryName) {
  if (cliCache.has(binaryName)) {
    return cliCache.get(binaryName);
  }

  const candidatePaths = [
    `/opt/homebrew/bin/${binaryName}`,
    `/usr/local/bin/${binaryName}`,
    `/usr/bin/${binaryName}`,
  ];

  for (const candidate of candidatePaths) {
    try {
      await fsp.access(candidate, fs.constants.X_OK);
      cliCache.set(binaryName, candidate);
      return candidate;
    } catch {
      // Continue checking candidates
    }
  }

  try {
    const { stdout } = await execFileAsync('/usr/bin/which', [binaryName]);
    const resolved = stdout.trim();
    if (resolved) {
      cliCache.set(binaryName, resolved);
      return resolved;
    }
  } catch {
    // Binary not found on PATH
  }

  cliCache.set(binaryName, null);
  return null;
}

/**
 * Ensures an image buffer is a clean, valid JPEG buffer.
 * Automatically converts PNG or WebP images to JPEG using macOS native `/usr/bin/sips`.
 */
export async function normalizeToJpegBuffer(buffer, mimeType = 'image/jpeg') {
  if (!buffer || !Buffer.isBuffer(buffer) || buffer.length < 4) {
    throw new Error('Image buffer is empty or corrupted.');
  }

  const isJpegMagic =
    buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  const isPngMagic =
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47;
  const isWebpMagic =
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP';

  const normMime = String(mimeType || '').toLowerCase();

  const MAX_EMBEDDED_ARTWORK_DIMENSION = 1200;
  const dims = isJpegMagic ? parseJpegDimensions(buffer) : { width: 0, height: 0 };
  const exceedsBounds =
    dims.width > MAX_EMBEDDED_ARTWORK_DIMENSION ||
    dims.height > MAX_EMBEDDED_ARTWORK_DIMENSION;

  if (
    isJpegMagic &&
    !exceedsBounds &&
    (!normMime || normMime.includes('jpeg') || normMime.includes('jpg'))
  ) {
    return { buffer, mimeType: 'image/jpeg' };
  }

  if (
    !isJpegMagic &&
    !isPngMagic &&
    !isWebpMagic &&
    normMime &&
    !ALLOWED_IMAGE_MIME_TYPES.has(normMime)
  ) {
    throw new Error(
      `Unsupported image format (${mimeType}). Please provide JPEG, PNG, or WebP.`
    );
  }

  // Convert PNG/WebP to standard baseline JPEG and constrain max dimensions to 1200x1200
  // to prevent memory buffer overruns on embedded devices and hardware decoders
  const ext = isJpegMagic ? 'jpg' : isPngMagic ? 'png' : isWebpMagic ? 'webp' : 'img';
  const stamp = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const tmpIn = path.join(os.tmpdir(), `av_embed_in_${stamp}.${ext}`);
  const tmpOut = path.join(os.tmpdir(), `av_embed_out_${stamp}.jpg`);

  try {
    await fsp.writeFile(tmpIn, buffer);
    const sipsArgs = ['-s', 'format', 'jpeg', tmpIn, '--out', tmpOut];
    if (exceedsBounds || isPngMagic || isWebpMagic) {
      sipsArgs.splice(3, 0, '-Z', String(MAX_EMBEDDED_ARTWORK_DIMENSION));
    }
    await execFileAsync('/usr/bin/sips', sipsArgs);
    const converted = await fsp.readFile(tmpOut);
    if (converted && converted.length > 0) {
      return { buffer: converted, mimeType: 'image/jpeg' };
    }
  } catch {
    // If sips fails, return original buffer with detected MIME type
  } finally {
    await fsp.unlink(tmpIn).catch(() => {});
    await fsp.unlink(tmpOut).catch(() => {});
  }

  return {
    buffer,
    mimeType: isPngMagic ? 'image/png' : 'image/jpeg',
  };
}

/**
 * Parses JPEG SOF0/SOF2 markers to extract pixel dimensions `{ width, height }` for FLAC PICTURE headers.
 */
function parseJpegDimensions(jpegBuf) {
  try {
    if (jpegBuf.length < 4 || jpegBuf[0] !== 0xff || jpegBuf[1] !== 0xd8) {
      return { width: 0, height: 0 };
    }
    let offset = 2;
    while (offset + 9 < jpegBuf.length) {
      if (jpegBuf[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = jpegBuf[offset + 1];
      if (marker === 0xff) {
        offset += 1;
        continue;
      }
      if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
        offset += 2;
        continue;
      }
      const segLen = jpegBuf.readUInt16BE(offset + 2);
      if (segLen < 2 || offset + 2 + segLen > jpegBuf.length) break;

      // SOF0 (0xC0), SOF1 (0xC1), SOF2 (0xC2)
      if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
        const height = jpegBuf.readUInt16BE(offset + 5);
        const width = jpegBuf.readUInt16BE(offset + 7);
        return { width, height };
      }
      offset += 2 + segLen;
    }
  } catch {
    // Ignore dimension parse errors
  }
  return { width: 0, height: 0 };
}

// ==================================================
// 1. MP3 (ID3v2.3 / ID3v2.4 APIC) PURE NODE.JS ENGINE
// ==================================================

function readSynchsafe32(buf, offset = 0) {
  return (
    ((buf[offset] & 0x7f) << 21) |
    ((buf[offset + 1] & 0x7f) << 14) |
    ((buf[offset + 2] & 0x7f) << 7) |
    (buf[offset + 3] & 0x7f)
  );
}

function writeSynchsafe32(val) {
  const out = Buffer.alloc(4);
  out[0] = (val >>> 21) & 0x7f;
  out[1] = (val >>> 14) & 0x7f;
  out[2] = (val >>> 7) & 0x7f;
  out[3] = val & 0x7f;
  return out;
}

function buildId3v2ApicFrame(imageBuffer, mimeType = 'image/jpeg', versionMajor = 3) {
  const mimeBytes = Buffer.from(mimeType || 'image/jpeg', 'ascii');
  // APIC payload: [encoding(0x00)] [mime\0] [picType(0x03 = Cover front)] [desc\0] [imageBytes]
  const payload = Buffer.concat([
    Buffer.from([0x00]), // ISO-8859-1 encoding
    mimeBytes,
    Buffer.from([0x00]), // Null terminator for MIME string
    Buffer.from([0x03]), // Picture Type 3: Cover (front)
    Buffer.from([0x00]), // Empty description + null terminator
    imageBuffer,
  ]);

  const header = Buffer.alloc(10);
  header.write('APIC', 0, 4, 'ascii');
  if (versionMajor === 4) {
    writeSynchsafe32(payload.length).copy(header, 4);
  } else {
    header.writeUInt32BE(payload.length, 4);
  }
  header.writeUInt16BE(0x0000, 8); // Frame flags

  return Buffer.concat([header, payload]);
}

/**
 * Parses an MP3 file buffer, extracts all non-APIC ID3v2.3/v2.4 frames and the raw MPEG audio stream,
 * and rebuilds the MP3 buffer with either a new APIC frame or with APIC removed.
 */
function transformMp3Id3v2(fileBuf, { imageBuffer = null, mimeType = 'image/jpeg' } = {}) {
  let audioOffset = 0;
  let versionMajor = 3;
  const keptFrameBuffers = [];

  if (
    fileBuf.length >= 10 &&
    fileBuf[0] === 0x49 && // 'I'
    fileBuf[1] === 0x44 && // 'D'
    fileBuf[2] === 0x33 && // '3'
    fileBuf[3] < 0xff &&
    fileBuf[4] < 0xff
  ) {
    const existingVer = fileBuf[3];
    const flags = fileBuf[5];
    const tagSize = readSynchsafe32(fileBuf, 6);
    const hasFooter = existingVer === 4 && (flags & 0x10) !== 0;
    const totalTagBytes = 10 + tagSize + (hasFooter ? 10 : 0);

    if (totalTagBytes <= fileBuf.length) {
      audioOffset = totalTagBytes;
      if (existingVer === 3 || existingVer === 4) {
        versionMajor = existingVer;
        let frameStart = 10;
        const tagEnd = 10 + tagSize;

        // Skip extended header if flag 0x40 is set
        if ((flags & 0x40) !== 0 && frameStart + 4 <= tagEnd) {
          const extSize =
            existingVer === 4
              ? readSynchsafe32(fileBuf, frameStart)
              : fileBuf.readUInt32BE(frameStart);
          frameStart += existingVer === 4 ? extSize : 4 + extSize;
        }

        while (frameStart + 10 <= tagEnd) {
          const frameId = fileBuf.subarray(frameStart, frameStart + 4).toString('ascii');
          if (!/^[A-Z0-9]{4}$/.test(frameId)) {
            break; // Reached padding zeroes
          }

          let frameSize =
            existingVer === 4
              ? readSynchsafe32(fileBuf, frameStart + 4)
              : fileBuf.readUInt32BE(frameStart + 4);

          // Fallback for non-synchsafe v2.4 frames written by non-compliant taggers
          if (
            existingVer === 4 &&
            (frameSize <= 0 || frameStart + 10 + frameSize > tagEnd)
          ) {
            const rawBeSize = fileBuf.readUInt32BE(frameStart + 4);
            if (rawBeSize > 0 && frameStart + 10 + rawBeSize <= tagEnd) {
              frameSize = rawBeSize;
            }
          }

          if (frameSize <= 0 || frameStart + 10 + frameSize > tagEnd) {
            break;
          }

          const fullFrame = fileBuf.subarray(frameStart, frameStart + 10 + frameSize);
          if (frameId !== 'APIC' && frameId !== 'PIC ') {
            keptFrameBuffers.push(fullFrame);
          }

          frameStart += 10 + frameSize;
        }
      }
    }
  }

  if (imageBuffer && imageBuffer.length > 0) {
    keptFrameBuffers.push(buildId3v2ApicFrame(imageBuffer, mimeType, versionMajor));
  }

  const audioStream = fileBuf.subarray(audioOffset);

  if (keptFrameBuffers.length === 0) {
    return audioStream;
  }

  const framesConcat = Buffer.concat(keptFrameBuffers);
  const id3Header = Buffer.alloc(10);
  id3Header.write('ID3', 0, 3, 'ascii');
  id3Header[3] = versionMajor;
  id3Header[4] = 0x00;
  id3Header[5] = 0x00; // Clear extended/unsync flags for clean header
  writeSynchsafe32(framesConcat.length).copy(id3Header, 6);

  return Buffer.concat([id3Header, framesConcat, audioStream]);
}

// ==================================================
// 2. FLAC (METADATA_BLOCK_PICTURE) ENGINE
// ==================================================

function buildFlacPictureBlockPayload(imageBuffer, mimeType = 'image/jpeg') {
  const mimeBuf = Buffer.from(mimeType || 'image/jpeg', 'ascii');
  const descBuf = Buffer.alloc(0);
  const { width, height } = parseJpegDimensions(imageBuffer);

  const headerBuf = Buffer.alloc(32 + mimeBuf.length + descBuf.length);
  let pos = 0;
  headerBuf.writeUInt32BE(3, pos); // Picture type 3: Cover (front)
  pos += 4;
  headerBuf.writeUInt32BE(mimeBuf.length, pos);
  pos += 4;
  mimeBuf.copy(headerBuf, pos);
  pos += mimeBuf.length;
  headerBuf.writeUInt32BE(descBuf.length, pos);
  pos += 4;
  descBuf.copy(headerBuf, pos);
  pos += descBuf.length;
  headerBuf.writeUInt32BE(width, pos);
  pos += 4;
  headerBuf.writeUInt32BE(height, pos);
  pos += 4;
  headerBuf.writeUInt32BE(24, pos); // 24-bit color depth
  pos += 4;
  headerBuf.writeUInt32BE(0, pos); // 0 indexed palette colors
  pos += 4;
  headerBuf.writeUInt32BE(imageBuffer.length, pos);

  return Buffer.concat([headerBuf, imageBuffer]);
}

/**
 * Pure Node.js lossless FLAC metadata block transformer.
 * Preserves STREAMINFO, VORBIS_COMMENT, SEEKTABLE, APPLICATION, CUESHEET verbatim,
 * replaces or strips PICTURE (type 6) blocks, and leaves audio frames untouched.
 */
function transformFlacPictureBlocks(
  fileBuf,
  { imageBuffer = null, mimeType = 'image/jpeg' } = {}
) {
  let flacStart = 0;
  // Handle FLAC files that have a prepended ID3v2 header before the 'fLaC' magic bytes
  if (
    fileBuf.length >= 14 &&
    fileBuf[0] === 0x49 &&
    fileBuf[1] === 0x44 &&
    fileBuf[2] === 0x33
  ) {
    const id3Size = 10 + readSynchsafe32(fileBuf, 6);
    if (id3Size + 4 <= fileBuf.length) {
      flacStart = id3Size;
    }
  }

  if (
    fileBuf.length < flacStart + 8 ||
    fileBuf.subarray(flacStart, flacStart + 4).toString('ascii') !== 'fLaC'
  ) {
    throw new Error('Invalid FLAC container (missing fLaC magic header).');
  }

  let offset = flacStart + 4;
  const keptBlocks = []; // [{ type, payload }]
  let foundLast = false;

  while (offset + 4 <= fileBuf.length && !foundLast) {
    const byte0 = fileBuf[offset];
    const isLast = (byte0 & 0x80) !== 0;
    const blockType = byte0 & 0x7f;
    const blockLen =
      (fileBuf[offset + 1] << 16) |
      (fileBuf[offset + 2] << 8) |
      fileBuf[offset + 3];

    offset += 4;
    if (offset + blockLen > fileBuf.length) {
      throw new Error('Corrupted FLAC metadata block length.');
    }

    const payload = fileBuf.subarray(offset, offset + blockLen);
    offset += blockLen;

    // Keep all non-PICTURE (6) and non-PADDING (1) metadata blocks
    if (blockType !== 6 && blockType !== 1) {
      keptBlocks.push({ type: blockType, payload });
    }

    if (isLast) {
      foundLast = true;
    }
  }

  if (keptBlocks.length === 0) {
    throw new Error('FLAC file is missing required STREAMINFO block.');
  }

  if (imageBuffer && imageBuffer.length > 0) {
    const picPayload = buildFlacPicturePicturePayloadSafe(imageBuffer, mimeType);
    keptBlocks.push({ type: 6, payload: picPayload });
  }

  // Add a small 1 KB PADDING block at the end of metadata for fast future edits
  keptBlocks.push({ type: 1, payload: Buffer.alloc(1024, 0) });

  const serializedBlocks = keptBlocks.map((blk, idx) => {
    const isLast = idx === keptBlocks.length - 1;
    const hdr = Buffer.alloc(4);
    hdr[0] = (isLast ? 0x80 : 0x00) | (blk.type & 0x7f);
    hdr[1] = (blk.payload.length >>> 16) & 0xff;
    hdr[2] = (blk.payload.length >>> 8) & 0xff;
    hdr[3] = blk.payload.length & 0xff;
    return Buffer.concat([hdr, blk.payload]);
  });

  const audioFrames = fileBuf.subarray(offset);
  return Buffer.concat([
    Buffer.from('fLaC', 'ascii'),
    ...serializedBlocks,
    audioFrames,
  ]);
}

function buildFlacPicturePicturePayloadSafe(imageBuffer, mimeType) {
  const payload = buildFlacPictureBlockPayload(imageBuffer, mimeType);
  if (payload.length > 0xffffff) {
    throw new Error('Artwork image exceeds FLAC 16 MB metadata block limit.');
  }
  return payload;
}

// ==================================================
// 3. M4A / ALAC / MP4 (ISO BMFF `covr` ATOM) ENGINE
// ==================================================

/**
 * Parses top-level or child MP4/M4A boxes (atoms) inside `[startOffset, endOffset)`.
 */
function parseMp4Boxes(buf, startOffset = 0, endOffset = buf.length) {
  const boxes = [];
  let offset = startOffset;

  while (offset + 8 <= endOffset) {
    const rawSize = buf.readUInt32BE(offset);
    const type = buf.subarray(offset + 4, offset + 8).toString('latin1');
    let headerLen = 8;
    let boxSize = rawSize;

    if (rawSize === 1) {
      if (offset + 16 > endOffset) break;
      boxSize = Number(buf.readBigUInt64BE(offset + 8));
      headerLen = 16;
    } else if (rawSize === 0) {
      boxSize = endOffset - offset;
    }

    if (boxSize < headerLen || offset + boxSize > endOffset) {
      break;
    }

    boxes.push({
      type,
      start: offset,
      end: offset + boxSize,
      size: boxSize,
      headerLen,
      bodyStart: offset + headerLen,
    });

    offset += boxSize;
  }

  return boxes;
}

function makeMp4Box(typeStr, payloadBuffers) {
  const payload = Array.isArray(payloadBuffers)
    ? Buffer.concat(payloadBuffers)
    : payloadBuffers;
  const header = Buffer.alloc(8);
  header.writeUInt32BE(8 + payload.length, 0);
  header.write(typeStr, 4, 4, 'latin1');
  return Buffer.concat([header, payload]);
}

function buildMp4HdlrMdirBox() {
  // Standard Apple iTunes metadata handler box (`hdlr` -> `mdir` / `appl`)
  const payload = Buffer.alloc(25, 0);
  payload.write('mdir', 4, 4, 'ascii');
  payload.write('appl', 8, 4, 'ascii');
  return makeMp4Box('hdlr', payload);
}

function buildMp4CovrBox(imageBuffer, mimeType = 'image/jpeg') {
  // Type indicator: 13 (0x0D) = JPEG, 14 (0x0E) = PNG
  const isPng =
    String(mimeType || '').toLowerCase().includes('png') ||
    (imageBuffer[0] === 0x89 && imageBuffer[1] === 0x50);
  const typeIndicator = isPng ? 14 : 13;

  const dataHeader = Buffer.alloc(16);
  dataHeader.writeUInt32BE(16 + imageBuffer.length, 0);
  dataHeader.write('data', 4, 4, 'ascii');
  dataHeader.writeUInt32BE(typeIndicator, 8);
  dataHeader.writeUInt32BE(0, 12); // Locale = 0

  const dataBox = Buffer.concat([dataHeader, imageBuffer]);
  return makeMp4Box('covr', dataBox);
}

/**
 * Recursively updates `stco` (32-bit) and `co64` (64-bit) chunk offset tables inside `moov`
 * for all chunks whose original file offset was `>= minOffsetToShift`.
 */
function shiftMp4ChunkOffsetsInBuffer(
  buf,
  startOffset,
  endOffset,
  delta,
  minOffsetToShift
) {
  if (delta === 0) return;

  const CONTAINER_TYPES = new Set([
    'moov',
    'trak',
    'mdia',
    'minf',
    'stbl',
    'edts',
    'dinf',
    'udta',
  ]);

  const boxes = parseMp4Boxes(buf, startOffset, endOffset);
  for (const box of boxes) {
    if (box.type === 'stco') {
      if (box.bodyStart + 8 <= box.end) {
        const entryCount = buf.readUInt32BE(box.bodyStart + 4);
        let pos = box.bodyStart + 8;
        for (let i = 0; i < entryCount && pos + 4 <= box.end; i += 1) {
          const oldOffset = buf.readUInt32BE(pos);
          if (oldOffset >= minOffsetToShift) {
            const updated = oldOffset + delta;
            if (updated < 0 || updated > 0xffffffff) {
              throw new Error('stco 32-bit chunk offset overflow.');
            }
            buf.writeUInt32BE(updated >>> 0, pos);
          }
          pos += 4;
        }
      }
    } else if (box.type === 'co64') {
      if (box.bodyStart + 8 <= box.end) {
        const entryCount = buf.readUInt32BE(box.bodyStart + 4);
        let pos = box.bodyStart + 8;
        const bigMin = BigInt(minOffsetToShift);
        const bigDelta = BigInt(delta);
        for (let i = 0; i < entryCount && pos + 8 <= box.end; i += 1) {
          const oldOffset = buf.readBigUInt64BE(pos);
          if (oldOffset >= bigMin) {
            buf.writeBigUInt64BE(oldOffset + bigDelta, pos);
          }
          pos += 8;
        }
      }
    } else if (CONTAINER_TYPES.has(box.type)) {
      shiftMp4ChunkOffsetsInBuffer(
        buf,
        box.bodyStart,
        box.end,
        delta,
        minOffsetToShift
      );
    }
  }
}

/**
 * Rebuilds `moov.udta.meta.ilst` with `covr` injected/replaced or removed,
 * adjusts `stco` / `co64` chunk offsets by the exact byte delta, and returns the updated M4A buffer.
 */
function transformMp4CovrAtom(
  fileBuf,
  { imageBuffer = null, mimeType = 'image/jpeg' } = {}
) {
  const topBoxes = parseMp4Boxes(fileBuf, 0, fileBuf.length);
  const moovBox = topBoxes.find((b) => b.type === 'moov');
  if (!moovBox) {
    throw new Error('Invalid M4A/MP4 container: missing moov atom.');
  }

  const moovChildren = parseMp4Boxes(fileBuf, moovBox.bodyStart, moovBox.end);
  const existingUdta = moovChildren.find((b) => b.type === 'udta');

  let newUdtaBuf;
  if (existingUdta) {
    const udtaChildren = parseMp4Boxes(
      fileBuf,
      existingUdta.bodyStart,
      existingUdta.end
    );
    const existingMeta = udtaChildren.find((b) => b.type === 'meta');

    let newMetaBuf;
    if (existingMeta) {
      // `meta` is a FullBox (4-byte version/flags after the 8-byte header)
      const metaVersionFlags =
        existingMeta.bodyStart + 4 <= existingMeta.end
          ? fileBuf.subarray(existingMeta.bodyStart, existingMeta.bodyStart + 4)
          : Buffer.alloc(4, 0);
      const metaChildrenStart = existingMeta.bodyStart + 4;
      const metaChildren = parseMp4Boxes(
        fileBuf,
        metaChildrenStart,
        existingMeta.end
      );
      const existingIlst = metaChildren.find((b) => b.type === 'ilst');

      let newIlstBuf;
      if (existingIlst) {
        const ilstChildren = parseMp4Boxes(
          fileBuf,
          existingIlst.bodyStart,
          existingIlst.end
        );
        const keptIlstItems = ilstChildren
          .filter((b) => b.type !== 'covr' && b.type !== 'free')
          .map((b) => fileBuf.subarray(b.start, b.end));

        if (imageBuffer && imageBuffer.length > 0) {
          keptIlstItems.push(buildMp4CovrBox(imageBuffer, mimeType));
        }
        newIlstBuf = makeMp4Box('ilst', keptIlstItems);
      } else {
        const items =
          imageBuffer && imageBuffer.length > 0
            ? [buildMp4CovrBox(imageBuffer, mimeType)]
            : [];
        newIlstBuf = makeMp4Box('ilst', items);
      }

      const rebuiltMetaChildren = [];
      let hasHdlr = false;
      let insertedIlst = false;

      for (const child of metaChildren) {
        if (child.type === 'free') continue;
        if (child.type === 'hdlr') hasHdlr = true;
        if (child.type === 'ilst') {
          rebuiltMetaChildren.push(newIlstBuf);
          insertedIlst = true;
        } else {
          rebuiltMetaChildren.push(fileBuf.subarray(child.start, child.end));
        }
      }

      if (!hasHdlr) {
        rebuiltMetaChildren.unshift(buildMp4HdlrMdirBox());
      }
      if (!insertedIlst) {
        rebuiltMetaChildren.push(newIlstBuf);
      }

      newMetaBuf = makeMp4Box('meta', [
        metaVersionFlags,
        ...rebuiltMetaChildren,
      ]);
    } else {
      const ilstItems =
        imageBuffer && imageBuffer.length > 0
          ? [buildMp4CovrBox(imageBuffer, mimeType)]
          : [];
      const newIlstBuf = makeMp4Box('ilst', ilstItems);
      newMetaBuf = makeMp4Box('meta', [
        Buffer.alloc(4, 0),
        buildMp4HdlrMdirBox(),
        newIlstBuf,
      ]);
    }

    const rebuiltUdtaChildren = [];
    let insertedMeta = false;
    for (const child of udtaChildren) {
      if (child.type === 'free') continue;
      if (child.type === 'meta') {
        rebuiltUdtaChildren.push(newMetaBuf);
        insertedMeta = true;
      } else {
        rebuiltUdtaChildren.push(fileBuf.subarray(child.start, child.end));
      }
    }
    if (!insertedMeta) {
      rebuiltUdtaChildren.push(newMetaBuf);
    }

    newUdtaBuf = makeMp4Box('udta', rebuiltUdtaChildren);
  } else {
    const ilstItems =
      imageBuffer && imageBuffer.length > 0
        ? [buildMp4CovrBox(imageBuffer, mimeType)]
        : [];
    const newIlstBuf = makeMp4Box('ilst', ilstItems);
    const newMetaBuf = makeMp4Box('meta', [
      Buffer.alloc(4, 0),
      buildMp4HdlrMdirBox(),
      newIlstBuf,
    ]);
    newUdtaBuf = makeMp4Box('udta', [newMetaBuf]);
  }

  const rebuiltMoovChildren = [];
  let insertedUdta = false;
  for (const child of moovChildren) {
    if (child.type === 'free') continue;
    if (child.type === 'udta') {
      rebuiltMoovChildren.push(newUdtaBuf);
      insertedUdta = true;
    } else {
      rebuiltMoovChildren.push(fileBuf.subarray(child.start, child.end));
    }
  }
  if (!insertedUdta) {
    rebuiltMoovChildren.push(newUdtaBuf);
  }

  const newMoovBuf = makeMp4Box('moov', rebuiltMoovChildren);
  const oldMoovSize = moovBox.size;
  const delta = newMoovBuf.length - oldMoovSize;

  // Update stco / co64 chunk offsets if any mdat chunks appear after moovBox.end
  if (delta !== 0) {
    shiftMp4ChunkOffsetsInBuffer(
      newMoovBuf,
      8,
      newMoovBuf.length,
      delta,
      moovBox.end
    );
  }

  return Buffer.concat([
    fileBuf.subarray(0, moovBox.start),
    newMoovBuf,
    fileBuf.subarray(moovBox.end),
  ]);
}

// ==================================================
// PUBLIC EMBEDDER & EXTRACTION API
// ==================================================

// Fast in-memory LRU cache for extracted embedded artwork & presence checks
// Key: filePath, Value: { mtimeMs, size, hasArt, buffer, mimeType }
const embeddedArtMemoCache = new Map();
const MAX_MEMO_CACHE_ENTRIES = 300;

export function invalidateEmbeddedArtCache(filePath) {
  if (!filePath) {
    embeddedArtMemoCache.clear();
    return;
  }
  embeddedArtMemoCache.delete(filePath);
}

function setMemoCacheEntry(filePath, entry) {
  if (embeddedArtMemoCache.size >= MAX_MEMO_CACHE_ENTRIES) {
    const oldestKey = embeddedArtMemoCache.keys().next().value;
    if (oldestKey) embeddedArtMemoCache.delete(oldestKey);
  }
  embeddedArtMemoCache.set(filePath, entry);
}

/**
 * Checks whether an audio file on disk currently contains embedded cover artwork.
 */
export async function hasEmbeddedArt(filePath) {
  try {
    const st = await fsp.stat(filePath);
    const cached = embeddedArtMemoCache.get(filePath);
    if (cached && cached.mtimeMs === st.mtimeMs && cached.size === st.size) {
      return Boolean(cached.hasArt);
    }

    const metadata = await parseFile(filePath, {
      duration: false,
      skipCovers: false,
    });
    const pictures = metadata?.common?.picture;
    const hasArt =
      Array.isArray(pictures) &&
      pictures.length > 0 &&
      pictures[0]?.data &&
      pictures[0].data.length > 0;

    if (hasArt) {
      const pic =
        pictures.find((p) => p.type === 'Cover (front)') || pictures[0];
      const buf = Buffer.isBuffer(pic.data) ? pic.data : Buffer.from(pic.data);
      const mimeType =
        pic.format && pic.format.includes('/') ? pic.format : 'image/jpeg';
      setMemoCacheEntry(filePath, {
        mtimeMs: st.mtimeMs,
        size: st.size,
        hasArt: true,
        buffer: buf,
        mimeType,
      });
    } else {
      setMemoCacheEntry(filePath, {
        mtimeMs: st.mtimeMs,
        size: st.size,
        hasArt: false,
        buffer: null,
        mimeType: null,
      });
    }

    return Boolean(hasArt);
  } catch {
    return false;
  }
}

/**
 * Extracts the embedded cover artwork buffer and MIME type from an audio file using `music-metadata`.
 * Returns `{ buffer, mimeType }` or `null` if no embedded cover art is present.
 */
export async function extractEmbeddedArt(filePath) {
  try {
    const st = await fsp.stat(filePath);
    const cached = embeddedArtMemoCache.get(filePath);
    if (cached && cached.mtimeMs === st.mtimeMs && cached.size === st.size) {
      if (cached.hasArt && cached.buffer) {
        return { buffer: cached.buffer, mimeType: cached.mimeType };
      }
      if (cached.hasArt === false) {
        return null;
      }
    }

    const metadata = await parseFile(filePath, {
      duration: false,
      skipCovers: false,
    });
    const pictures = metadata?.common?.picture;
    if (
      Array.isArray(pictures) &&
      pictures.length > 0 &&
      pictures[0]?.data &&
      pictures[0].data.length > 0
    ) {
      const pic =
        pictures.find((p) => p.type === 'Cover (front)') || pictures[0];
      const buf = Buffer.isBuffer(pic.data)
        ? pic.data
        : Buffer.from(pic.data);
      const mimeType =
        pic.format && pic.format.includes('/') ? pic.format : 'image/jpeg';
      setMemoCacheEntry(filePath, {
        mtimeMs: st.mtimeMs,
        size: st.size,
        hasArt: true,
        buffer: buf,
        mimeType,
      });
      return { buffer: buf, mimeType };
    }

    setMemoCacheEntry(filePath, {
      mtimeMs: st.mtimeMs,
      size: st.size,
      hasArt: false,
      buffer: null,
      mimeType: null,
    });
    return null;
  } catch {
    return null;
  }
}

/**
 * Embeds `imageBuffer` directly into the audio container at `filePath` without re-encoding audio streams.
 * Performs all modifications on a temporary file (`${filePath}.tmp${ext}`), verifies container integrity,
 * and replaces atomically via `fs.renameSync`.
 */
export async function embedArtBuffer(
  filePath,
  rawImageBuffer,
  rawMimeType = 'image/jpeg'
) {
  if (!filePath || typeof filePath !== 'string') {
    throw new Error('Target audio filePath is required.');
  }

  const ext = path.extname(filePath).toLowerCase();
  const { buffer: jpegBuffer, mimeType } = await normalizeToJpegBuffer(
    rawImageBuffer,
    rawMimeType
  );

  if (ext === '.wav' || ext === '.aiff' || ext === '.aif' || ext === '.ogg') {
    console.warn(
      `[EMBEDDER] Embedded picture tags not natively supported for container ${ext}: ${path.basename(
        filePath
      )}`
    );
    return {
      embedded: false,
      unsupportedContainer: true,
      extension: ext,
    };
  }

  const stamp = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const tmpAudioPath = `${filePath}.${stamp}.tmp${ext}`;
  const tmpArtPath = path.join(os.tmpdir(), `av_art_${stamp}.jpg`);

  try {
    if (ext === '.mp3') {
      const originalBuf = await fsp.readFile(filePath);
      const updatedBuf = transformMp3Id3v2(originalBuf, {
        imageBuffer: jpegBuffer,
        mimeType,
      });
      await fsp.writeFile(tmpAudioPath, updatedBuf);
    } else if (ext === '.flac') {
      const metaflacBin = await resolveCliBinary('metaflac');
      if (metaflacBin) {
        await fsp.copyFile(filePath, tmpAudioPath);
        await fsp.writeFile(tmpArtPath, jpegBuffer);
        await execFileAsync(metaflacBin, [
          '--remove',
          '--block-type=PICTURE',
          `--import-picture-from=${tmpArtPath}`,
          tmpAudioPath,
        ]);
      } else {
        const originalBuf = await fsp.readFile(filePath);
        const updatedBuf = transformFlacPictureBlocks(originalBuf, {
          imageBuffer: jpegBuffer,
          mimeType,
        });
        await fsp.writeFile(tmpAudioPath, updatedBuf);
      }
    } else if (
      ext === '.m4a' ||
      ext === '.alac' ||
      ext === '.mp4' ||
      ext === '.aac'
    ) {
      const ffmpegBin = await resolveCliBinary('ffmpeg');
      let usedFfmpeg = false;

      if (ffmpegBin) {
        try {
          await fsp.writeFile(tmpArtPath, jpegBuffer);
          await execFileAsync(ffmpegBin, [
            '-y',
            '-i',
            filePath,
            '-i',
            tmpArtPath,
            '-map',
            '0:a',
            '-map',
            '1',
            '-codec',
            'copy',
            '-disposition:v:0',
            'attached_pic',
            tmpAudioPath,
          ]);
          usedFfmpeg = true;
        } catch {
          usedFfmpeg = false;
        }
      }

      if (!usedFfmpeg) {
        const originalBuf = await fsp.readFile(filePath);
        const updatedBuf = transformMp4CovrAtom(originalBuf, {
          imageBuffer: jpegBuffer,
          mimeType,
        });
        await fsp.writeFile(tmpAudioPath, updatedBuf);
      }
    } else {
      return {
        embedded: false,
        unsupportedContainer: true,
        extension: ext,
      };
    }

    // Verify the temporary file is non-empty and readable before atomic replace
    const tmpStat = await fsp.stat(tmpAudioPath);
    if (!tmpStat.isFile() || tmpStat.size < 128) {
      throw new Error('Generated temporary audio container is invalid or empty.');
    }

    // Atomic replacement of master track
    fs.renameSync(tmpAudioPath, filePath);
    invalidateEmbeddedArtCache(filePath);

    return {
      embedded: true,
      extension: ext,
      fileSize: tmpStat.size,
    };
  } catch (err) {
    await fsp.unlink(tmpAudioPath).catch(() => {});
    throw err;
  } finally {
    await fsp.unlink(tmpArtPath).catch(() => {});
  }
}

/**
 * Strips embedded cover artwork from an audio container (`.mp3`, `.flac`, `.m4a`/`.alac`)
 * without re-encoding the audio bitstream, using atomic file replacement.
 */
export async function removeEmbeddedArt(filePath) {
  if (!filePath || typeof filePath !== 'string') {
    throw new Error('Target audio filePath is required.');
  }

  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.wav' || ext === '.aiff' || ext === '.aif' || ext === '.ogg') {
    return { removed: false, unsupportedContainer: true, extension: ext };
  }

  const stamp = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const tmpAudioPath = `${filePath}.${stamp}.tmp${ext}`;

  try {
    if (ext === '.mp3') {
      const originalBuf = await fsp.readFile(filePath);
      const updatedBuf = transformMp3Id3v2(originalBuf, { imageBuffer: null });
      await fsp.writeFile(tmpAudioPath, updatedBuf);
    } else if (ext === '.flac') {
      const metaflacBin = await resolveCliBinary('metaflac');
      if (metaflacBin) {
        await fsp.copyFile(filePath, tmpAudioPath);
        await execFileAsync(metaflacBin, [
          '--remove',
          '--block-type=PICTURE',
          tmpAudioPath,
        ]);
      } else {
        const originalBuf = await fsp.readFile(filePath);
        const updatedBuf = transformFlacPictureBlocks(originalBuf, {
          imageBuffer: null,
        });
        await fsp.writeFile(tmpAudioPath, updatedBuf);
      }
    } else if (
      ext === '.m4a' ||
      ext === '.alac' ||
      ext === '.mp4' ||
      ext === '.aac'
    ) {
      const ffmpegBin = await resolveCliBinary('ffmpeg');
      let usedFfmpeg = false;

      if (ffmpegBin) {
        try {
          await execFileAsync(ffmpegBin, [
            '-y',
            '-i',
            filePath,
            '-map',
            '0:a',
            '-codec',
            'copy',
            tmpAudioPath,
          ]);
          usedFfmpeg = true;
        } catch {
          usedFfmpeg = false;
        }
      }

      if (!usedFfmpeg) {
        const originalBuf = await fsp.readFile(filePath);
        const updatedBuf = transformMp4CovrAtom(originalBuf, {
          imageBuffer: null,
        });
        await fsp.writeFile(tmpAudioPath, updatedBuf);
      }
    } else {
      return { removed: false, unsupportedContainer: true, extension: ext };
    }

    const tmpStat = await fsp.stat(tmpAudioPath);
    if (!tmpStat.isFile() || tmpStat.size < 64) {
      throw new Error('Generated stripped audio container is invalid or empty.');
    }

    fs.renameSync(tmpAudioPath, filePath);
    invalidateEmbeddedArtCache(filePath);
    return {
      removed: true,
      extension: ext,
      fileSize: tmpStat.size,
    };
  } catch (err) {
    await fsp.unlink(tmpAudioPath).catch(() => {});
    throw err;
  }
}
