import { crc32, deflateRawSync, inflateRawSync } from "node:zlib";

const UINT32_LIMIT = 0xffffffff;
const ENTRY_LIMIT = 0xffff;
const UTF8 = 0x0800;
const decoder = new TextDecoder("utf-8", { fatal: true });
export const MAX_UNCOMPRESSED_BYTES = 512 * 1024 * 1024;

export function assertArchivePath(name, { directory = false } = {}) {
  // eslint-disable-next-line no-control-regex -- Archive paths must reject control characters and backslashes.
  if (typeof name !== "string" || !name || /[\u0000-\u001f\u007f\\]/u.test(name)) {
    throw new Error("Archive paths must be nonempty, portable relative paths.");
  }
  const value = directory && name.endsWith("/") ? name.slice(0, -1) : name;
  if (
    !value ||
    value.startsWith("/") ||
    /^[a-z]:/iu.test(value) ||
    value.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    throw new Error("Unsafe archive path: " + name);
  }
  if (Buffer.byteLength(name, "utf8") > 0xffff) {
    throw new Error("Archive filename exceeds the ZIP32 limit.");
  }
  return name;
}

function assertZip32(value, label) {
  if (!Number.isSafeInteger(value) || value < 0 || value >= UINT32_LIMIT) {
    throw new Error(label + " exceeds the supported ZIP32 limit.");
  }
}

/**
 * A small deterministic ZIP32 writer for release artifacts. It writes files only,
 * uses UTF-8 names and fixed timestamps, and never follows filesystem links.
 */
export function encodeZip(files) {
  const entries = files instanceof Map ? [...files] : Object.entries(files);
  if (entries.length >= ENTRY_LIMIT) throw new Error("Too many ZIP32 entries.");
  entries.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  const localParts = [];
  const centralParts = [];
  const names = new Set();
  let localSize = 0;
  let centralSize = 0;
  let uncompressedSize = 0;

  for (const [name, value] of entries) {
    assertArchivePath(name);
    if (names.has(name)) throw new Error("Duplicate archive path: " + name);
    names.add(name);
    const nameBytes = Buffer.from(name, "utf8");
    const data = Buffer.from(value);
    uncompressedSize += data.length;
    if (uncompressedSize > MAX_UNCOMPRESSED_BYTES) {
      throw new Error("Release files exceed the 512 MiB uncompressed package limit.");
    }
    const compressed = deflateRawSync(data, { level: 9 });
    assertZip32(data.length, "File size");
    assertZip32(compressed.length, "Compressed size");
    const checksum = crc32(data) >>> 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(UTF8, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(0x0021, 12); // 1980-01-01, midnight
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE((3 << 8) | 20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(UTF8, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(0x0021, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE((0o100644 << 16) >>> 0, 38);
    central.writeUInt32LE(localSize, 42);

    localParts.push(local, nameBytes, compressed);
    centralParts.push(central, nameBytes);
    localSize += local.length + nameBytes.length + compressed.length;
    centralSize += central.length + nameBytes.length;
    assertZip32(localSize, "Archive offset");
    assertZip32(centralSize, "Central directory");
  }
  assertZip32(localSize + centralSize + 22, "Archive size");
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(localSize, 16);
  return Buffer.concat([...localParts, ...centralParts, end]);
}

/**
 * Read the ZIP32 format emitted above without extracting it. Central/local
 * headers, bounds, duplicate names, file types, sizes, and CRCs are checked.
 */
export function decodeZip(input, { maxUncompressedBytes = MAX_UNCOMPRESSED_BYTES } = {}) {
  const zip = Buffer.from(input);
  if (zip.length < 22) throw new Error("Truncated ZIP archive.");
  let endOffset = -1;
  for (let index = zip.length - 22; index >= Math.max(0, zip.length - 65557); index -= 1) {
    if (zip.readUInt32LE(index) === 0x06054b50 && index + 22 + zip.readUInt16LE(index + 20) === zip.length) {
      endOffset = index;
      break;
    }
  }
  if (endOffset < 0) throw new Error("ZIP end record is missing or malformed.");
  const count = zip.readUInt16LE(endOffset + 10);
  const centralSize = zip.readUInt32LE(endOffset + 12);
  const centralOffset = zip.readUInt32LE(endOffset + 16);
  if (
    zip.readUInt16LE(endOffset + 4) !== 0 ||
    zip.readUInt16LE(endOffset + 6) !== 0 ||
    zip.readUInt16LE(endOffset + 8) !== count ||
    count >= ENTRY_LIMIT ||
    centralOffset >= UINT32_LIMIT ||
    centralSize >= UINT32_LIMIT ||
    centralOffset + centralSize !== endOffset
  ) {
    throw new Error("Multi-disk, ZIP64, or inconsistent ZIP archives are not supported.");
  }
  const files = new Map();
  const ranges = [];
  let cursor = centralOffset;
  let totalSize = 0;
  for (let index = 0; index < count; index += 1) {
    if (cursor + 46 > endOffset || zip.readUInt32LE(cursor) !== 0x02014b50) {
      throw new Error("Invalid ZIP central directory.");
    }
    const flags = zip.readUInt16LE(cursor + 8);
    const method = zip.readUInt16LE(cursor + 10);
    const checksum = zip.readUInt32LE(cursor + 16);
    const compressedSize = zip.readUInt32LE(cursor + 20);
    const size = zip.readUInt32LE(cursor + 24);
    const nameLength = zip.readUInt16LE(cursor + 28);
    const extraLength = zip.readUInt16LE(cursor + 30);
    const commentLength = zip.readUInt16LE(cursor + 32);
    const mode = zip.readUInt32LE(cursor + 38) >>> 16;
    const localOffset = zip.readUInt32LE(cursor + 42);
    const recordEnd = cursor + 46 + nameLength + extraLength + commentLength;
    if (recordEnd > endOffset || !nameLength) throw new Error("Truncated ZIP entry.");
    if (
      (flags !== UTF8 && flags !== 0) ||
      (method !== 0 && method !== 8) ||
      zip.readUInt16LE(cursor + 34) !== 0 ||
      compressedSize >= UINT32_LIMIT ||
      size >= UINT32_LIMIT ||
      localOffset >= UINT32_LIMIT
    ) {
      throw new Error("Encrypted, ZIP64, or unsupported ZIP entry.");
    }
    if ((mode & 0o170000) === 0o120000) throw new Error("Symbolic links are not allowed in releases.");
    const nameBytes = zip.subarray(cursor + 46, cursor + 46 + nameLength);
    const name = decoder.decode(nameBytes);
    assertArchivePath(name, { directory: true });
    if (files.has(name)) throw new Error("Duplicate archive path: " + name);
    if (localOffset + 30 > centralOffset || zip.readUInt32LE(localOffset) !== 0x04034b50) {
      throw new Error("Invalid ZIP local header.");
    }
    const localNameLength = zip.readUInt16LE(localOffset + 26);
    const localExtraLength = zip.readUInt16LE(localOffset + 28);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    const dataEnd = dataOffset + compressedSize;
    if (
      dataEnd > centralOffset ||
      zip.readUInt16LE(localOffset + 6) !== flags ||
      zip.readUInt16LE(localOffset + 8) !== method ||
      zip.readUInt32LE(localOffset + 14) !== checksum ||
      zip.readUInt32LE(localOffset + 18) !== compressedSize ||
      zip.readUInt32LE(localOffset + 22) !== size ||
      localNameLength !== nameLength ||
      !zip.subarray(localOffset + 30, localOffset + 30 + localNameLength).equals(nameBytes)
    ) {
      throw new Error("ZIP central and local headers disagree.");
    }
    totalSize += size;
    if (totalSize > maxUncompressedBytes) throw new Error("ZIP exceeds the uncompressed size limit.");
    const compressed = zip.subarray(dataOffset, dataEnd);
    let data;
    try {
      data =
        method === 0 ? Buffer.from(compressed) : inflateRawSync(compressed, { maxOutputLength: Math.max(1, size) });
    } catch (error) {
      throw new Error("Invalid compressed ZIP data: " + name, { cause: error });
    }
    if (data.length !== size || crc32(data) >>> 0 !== checksum) {
      throw new Error("ZIP checksum or size mismatch: " + name);
    }
    if (name.endsWith("/") && data.length) throw new Error("ZIP directory has file data.");
    files.set(name, data);
    ranges.push([localOffset, dataEnd]);
    cursor = recordEnd;
  }
  if (cursor !== endOffset) throw new Error("Unexpected ZIP central directory data.");
  ranges.sort((left, right) => left[0] - right[0]);
  let expectedOffset = 0;
  for (const [start, finish] of ranges) {
    if (start !== expectedOffset) throw new Error("Overlapping or hidden ZIP entries.");
    expectedOffset = finish;
  }
  if (expectedOffset !== centralOffset) throw new Error("Unexpected data before the ZIP central directory.");
  return files;
}
