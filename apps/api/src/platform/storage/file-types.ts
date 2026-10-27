import { isOoxmlPackage } from './ooxml';

/**
 * The closed catalogue of file types the platform accepts (ADR-0012 decision 3). A type is
 * named by its file extension and proven by its content: the browser's declared content type
 * is never trusted. Types that can carry script (SVG, HTML) or macros (docm, xlsm) are not
 * here on purpose; adding one is a security-review change.
 */
export const FILE_TYPES = {
  png: { contentType: 'image/png', extensions: ['png'], content: 'png' },
  jpeg: { contentType: 'image/jpeg', extensions: ['jpg', 'jpeg'], content: 'jpeg' },
  gif: { contentType: 'image/gif', extensions: ['gif'], content: 'gif' },
  webp: { contentType: 'image/webp', extensions: ['webp'], content: 'webp' },
  pdf: { contentType: 'application/pdf', extensions: ['pdf'], content: 'pdf' },
  docx: {
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    extensions: ['docx'],
    content: 'docx',
  },
  xlsx: {
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    extensions: ['xlsx'],
    content: 'xlsx',
  },
  pptx: {
    contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    extensions: ['pptx'],
    content: 'pptx',
  },
  txt: { contentType: 'text/plain; charset=utf-8', extensions: ['txt'], content: 'text' },
  csv: { contentType: 'text/csv; charset=utf-8', extensions: ['csv'], content: 'text' },
} as const satisfies Record<string, FileTypeDefinition>;

export type FileType = keyof typeof FILE_TYPES;

type ContentCheck =
  'png' | 'jpeg' | 'gif' | 'webp' | 'pdf' | 'docx' | 'xlsx' | 'pptx' | 'zip' | 'text';

interface FileTypeDefinition {
  readonly contentType: string;
  readonly extensions: readonly string[];
  readonly content: ContentCheck;
}

/** The type a lower-case extension names, or `null` for any other extension. */
export function fileTypeOfExtension(extension: string): FileType | null {
  for (const [type, definition] of Object.entries(FILE_TYPES)) {
    if ((definition.extensions as readonly string[]).includes(extension)) return type as FileType;
  }
  return null;
}

/** True when `bytes` really are a file of `type`, by its signature or, for text, its encoding. */
export function contentMatches(type: FileType, bytes: Uint8Array): boolean {
  return CHECKS[FILE_TYPES[type].content](bytes);
}

const ascii = (text: string): number[] => [...text].map((char) => char.charCodeAt(0));

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false;
  return signature.every((byte, index) => bytes[offset + index] === byte);
}

const UTF8 = new TextDecoder('utf-8', { fatal: true });

/** Any binary signature in the catalogue: a text file must not start with one. */
const BINARY_CHECKS: readonly ContentCheck[] = ['png', 'jpeg', 'gif', 'webp', 'pdf', 'zip'];

const CHECKS: Record<ContentCheck, (bytes: Uint8Array) => boolean> = {
  png: (bytes) => startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  jpeg: (bytes) => startsWith(bytes, [0xff, 0xd8, 0xff]),
  gif: (bytes) => startsWith(bytes, ascii('GIF87a')) || startsWith(bytes, ascii('GIF89a')),
  webp: (bytes) => startsWith(bytes, ascii('RIFF')) && startsWith(bytes, ascii('WEBP'), 8),
  pdf: (bytes) => startsWith(bytes, ascii('%PDF-')),
  // Office Open XML: a ZIP package with the format's main part and no macros (ooxml.ts).
  docx: (bytes) => isOoxmlPackage(bytes, 'word/document.xml'),
  xlsx: (bytes) => isOoxmlPackage(bytes, 'xl/workbook.xml'),
  pptx: (bytes) => isOoxmlPackage(bytes, 'ppt/presentation.xml'),
  // Any ZIP local file header: never accepted as a type, only refused as text.
  zip: (bytes) => startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]),
  // Valid UTF-8 with no NUL byte, and not a binary format renamed to .txt or .csv.
  text: (bytes) => {
    if (bytes.includes(0)) return false;
    if (BINARY_CHECKS.some((check) => CHECKS[check](bytes))) return false;
    try {
      UTF8.decode(bytes);
      return true;
    } catch {
      return false;
    }
  },
};
