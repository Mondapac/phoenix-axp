/**
 * Checks that a ZIP archive is an Office Open XML package of one kind, from its central
 * directory alone (nothing is decompressed): the package's content-types part and main part
 * are there, no VBA project is, every entry name is relative, and the entry count and the
 * declared uncompressed size stay under limits that rule out zip bombs. A macro file renamed
 * to .docx, or any other archive, fails.
 */
export const MAX_OOXML_ENTRIES = 10_000;
export const MAX_OOXML_UNCOMPRESSED_BYTES = 256 * 1024 * 1024;

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const END_OF_DIRECTORY = 0x06054b50;
const END_RECORD_SIZE = 22;
const MAX_COMMENT = 0xffff;

const UTF8 = new TextDecoder('utf-8', { fatal: true });

export function isOoxmlPackage(bytes: Uint8Array, mainPart: string): boolean {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < END_RECORD_SIZE || view.getUint32(0, true) !== LOCAL_HEADER) return false;

  const end = findEndOfDirectory(view);
  if (end < 0) return false;
  const entries = view.getUint16(end + 10, true);
  const directorySize = view.getUint32(end + 12, true);
  const directoryOffset = view.getUint32(end + 16, true);
  // ZIP64 markers or a directory outside the file: not an Office document we accept.
  if (entries === 0xffff || directoryOffset === 0xffffffff) return false;
  if (entries === 0 || entries > MAX_OOXML_ENTRIES) return false;
  if (directoryOffset + directorySize > end) return false;

  const names = new Set<string>();
  let uncompressed = 0;
  let offset = directoryOffset;
  for (let index = 0; index < entries; index += 1) {
    if (offset + 46 > end || view.getUint32(offset, true) !== CENTRAL_HEADER) return false;
    uncompressed += view.getUint32(offset + 24, true);
    if (uncompressed > MAX_OOXML_UNCOMPRESSED_BYTES) return false;
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const nameStart = offset + 46;
    if (nameStart + nameLength > end) return false;
    let name: string;
    try {
      name = UTF8.decode(bytes.subarray(nameStart, nameStart + nameLength));
    } catch {
      return false;
    }
    if (!isSafeEntryName(name)) return false;
    names.add(name.toLowerCase());
    offset = nameStart + nameLength + extraLength + commentLength;
  }

  if (!names.has('[content_types].xml') || !names.has(mainPart)) return false;
  return ![...names].some((name) => name === 'vbaproject.bin' || name.endsWith('/vbaproject.bin'));
}

/** The end-of-central-directory record, searched from the end past a comment of any length. */
function findEndOfDirectory(view: DataView): number {
  const lowest = Math.max(0, view.byteLength - END_RECORD_SIZE - MAX_COMMENT);
  for (let offset = view.byteLength - END_RECORD_SIZE; offset >= lowest; offset -= 1) {
    if (view.getUint32(offset, true) === END_OF_DIRECTORY) return offset;
  }
  return -1;
}

function isSafeEntryName(name: string): boolean {
  if (name.length === 0 || name.startsWith('/') || name.includes('\\')) return false;
  return !name.split('/').includes('..');
}
