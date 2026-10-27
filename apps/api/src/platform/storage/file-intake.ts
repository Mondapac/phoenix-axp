import { createHash } from 'node:crypto';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { err, ok } from '@phoenix/shared-kernel';
import type { Result } from '@phoenix/shared-kernel';
import { contentMatches, FILE_TYPES, fileTypeOfExtension } from './file-types';
import type { FileType } from './file-types';

/** The largest file any policy may accept: an upload is held in memory while it is checked. */
export const MAX_FILE_BYTES = 50 * 1024 * 1024;

/** The longest stored file name, in characters, extension included. */
export const MAX_FILE_NAME_LENGTH = 200;

/**
 * What one upload use case accepts. Each owning module declares its own. The route that parses
 * the request must also cap the body at `maxBytes` (multer `limits.fileSize`, `files: 1`):
 * the intake sees bytes already in memory.
 */
export interface IntakePolicy {
  /** 1 to {@link MAX_FILE_BYTES}. */
  readonly maxBytes: number;
  /** At least one type of the catalogue. */
  readonly allowedTypes: readonly FileType[];
}

export interface IncomingFile {
  /** The name the client sent. Untrusted: it may hold a path, controls or bidi overrides. */
  readonly fileName: string;
  readonly bytes: Uint8Array;
}

export interface AcceptedFile {
  readonly bytes: Uint8Array;
  readonly type: FileType;
  /** From the catalogue, never from the client. */
  readonly contentType: string;
  /** Sanitised: safe to store and to send back in Content-Disposition. */
  readonly fileName: string;
  readonly sizeBytes: number;
  /** Lower-case hex SHA-256 of the bytes. */
  readonly sha256: string;
  /** `not-scanned` while no malware scanner is bound to this deployment. */
  readonly scan: 'clean' | 'not-scanned';
}

export type IntakeRefusal =
  | { readonly code: 'file.empty' }
  | { readonly code: 'file.too-large'; readonly maxBytes: number }
  | { readonly code: 'file.name-invalid' }
  | { readonly code: 'file.type-not-allowed' }
  | { readonly code: 'file.type-mismatch' }
  | { readonly code: 'file.infected' };

/**
 * Injection token for the {@link MalwareScanner} (ADR-0012 decision 3), bound by a global
 * module that exports it. Optional outside production; production refuses to start without
 * one (StorageModule).
 */
export const MALWARE_SCANNER = Symbol('MALWARE_SCANNER');

/** The malware-scan hook. No adapter is bound yet; a deployment binds one (ClamAV, for one). */
export interface MalwareScanner {
  scan(bytes: Uint8Array): Promise<'clean' | 'infected'>;
}

// C0 and C1 controls; lone surrogates, which break percent-encoding of the name later; the
// bidi marks and overrides that can make "gpj.exe" read as "exe.jpg"; and invisible format
// characters (zero width space, word joiner, BOM, soft hyphen). ZWNJ (U+200C) and ZWJ
// (U+200D) stay: Persian names need them.
const UNSAFE_CHARACTERS =
  /[\p{Cc}\p{Cs}\u00ad\u061c\u200b\u200e\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff]|[<>:"|?*]/gu;

/**
 * The file name to store: the last path segment of what the client sent, in NFC, without
 * controls, bidi overrides or characters that file systems refuse, trimmed of spaces and dots
 * at both ends, and cut to {@link MAX_FILE_NAME_LENGTH} characters with the extension kept.
 * `null` when nothing usable is left.
 */
export function sanitiseFileName(raw: string): string | null {
  const segment = raw.split(/[/\\]/).pop() ?? '';
  const cleaned = segment
    .normalize('NFC')
    .replace(UNSAFE_CHARACTERS, '')
    .replace(/^[\s.]+|[\s.]+$/gu, '');
  if (cleaned.length === 0) return null;
  const characters = [...cleaned];
  if (characters.length <= MAX_FILE_NAME_LENGTH) return cleaned;
  const dot = cleaned.lastIndexOf('.');
  const extension = dot > 0 ? [...cleaned.slice(dot)] : [];
  if (extension.length >= MAX_FILE_NAME_LENGTH) return null;
  const stem = [...cleaned.slice(0, dot > 0 ? dot : undefined)];
  return stem.slice(0, MAX_FILE_NAME_LENGTH - extension.length).join('') + extension.join('');
}

/**
 * The file intake of ADR-0012 decision 3: size limit, file name, type by extension proven by
 * content sniffing, then the malware-scan hook. Expected refusals are values with a stable
 * code; the caller turns them into its answer. Storing the accepted bytes and the metadata is
 * the owning module's work.
 */
@Injectable()
export class FileIntake {
  constructor(
    @Optional() @Inject(MALWARE_SCANNER) private readonly scanner: MalwareScanner | null = null,
  ) {}

  /** True when a malware scanner is bound. */
  get scans(): boolean {
    return this.scanner !== null;
  }

  async accept(
    file: IncomingFile,
    policy: IntakePolicy,
  ): Promise<Result<AcceptedFile, IntakeRefusal>> {
    checkPolicy(policy);
    const size = file.bytes.length;
    if (size === 0) return err({ code: 'file.empty' });
    if (size > policy.maxBytes) return err({ code: 'file.too-large', maxBytes: policy.maxBytes });

    const fileName = sanitiseFileName(file.fileName);
    if (fileName === null) return err({ code: 'file.name-invalid' });

    const dot = fileName.lastIndexOf('.');
    const type = dot > 0 ? fileTypeOfExtension(fileName.slice(dot + 1).toLowerCase()) : null;
    if (type === null || !policy.allowedTypes.includes(type)) {
      return err({ code: 'file.type-not-allowed' });
    }
    if (!contentMatches(type, file.bytes)) return err({ code: 'file.type-mismatch' });

    let scan: AcceptedFile['scan'] = 'not-scanned';
    if (this.scanner !== null) {
      // Only an explicit 'clean' passes: any other answer counts as infected.
      if ((await this.scanner.scan(file.bytes)) !== 'clean') return err({ code: 'file.infected' });
      scan = 'clean';
    }

    return ok({
      bytes: file.bytes,
      type,
      contentType: FILE_TYPES[type].contentType,
      fileName,
      sizeBytes: size,
      sha256: createHash('sha256').update(file.bytes).digest('hex'),
      scan,
    });
  }
}

/** A policy is code, not input: a bad one is a programmer error and throws. */
function checkPolicy(policy: IntakePolicy): void {
  if (
    !Number.isInteger(policy.maxBytes) ||
    policy.maxBytes < 1 ||
    policy.maxBytes > MAX_FILE_BYTES
  ) {
    throw new RangeError(`IntakePolicy.maxBytes must be an integer from 1 to ${MAX_FILE_BYTES}`);
  }
  if (
    policy.allowedTypes.length === 0 ||
    policy.allowedTypes.some((type) => !Object.hasOwn(FILE_TYPES, type))
  ) {
    throw new RangeError('IntakePolicy.allowedTypes must name at least one catalogue type');
  }
}
