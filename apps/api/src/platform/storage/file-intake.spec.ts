import { createHash } from 'node:crypto';
import { FileIntake, MAX_FILE_BYTES, MAX_FILE_NAME_LENGTH, sanitiseFileName } from './file-intake';
import type { IntakePolicy, MalwareScanner } from './file-intake';
import { ooxmlOf } from '../../../test/support/zip';

const bytes = (...parts: (string | number[])[]): Uint8Array =>
  Uint8Array.from(
    parts.flatMap((part) => (typeof part === 'string' ? [...Buffer.from(part, 'utf8')] : part)),
  );

const PNG = bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'rest of the image');
const JPEG = bytes([0xff, 0xd8, 0xff, 0xe0], 'JFIF');
const GIF = bytes('GIF89a', [1, 0, 1, 0]);
const WEBP = bytes('RIFF', [0, 0, 0, 0], 'WEBPVP8 ');
const PDF = bytes('%PDF-1.7\n');
const DOCX = ooxmlOf('word/document.xml');
const XLSX = ooxmlOf('xl/workbook.xml');
const PPTX = ooxmlOf('ppt/presentation.xml');
const MACRO_DOCX = ooxmlOf('word/document.xml', { name: 'word/vbaProject.bin' });
const TEXT = bytes('نام,کد ملی\nعلی,123\n');

const OOXML = 'application/vnd.openxmlformats-officedocument';

const ANY: IntakePolicy = {
  maxBytes: 1024,
  allowedTypes: ['png', 'jpeg', 'gif', 'webp', 'pdf', 'docx', 'xlsx', 'pptx', 'txt', 'csv'],
};

describe('FileIntake', () => {
  const intake = new FileIntake();

  it.each([
    ['photo.png', PNG, 'png', 'image/png'],
    ['photo.JPG', JPEG, 'jpeg', 'image/jpeg'],
    ['photo.jpeg', JPEG, 'jpeg', 'image/jpeg'],
    ['anim.gif', GIF, 'gif', 'image/gif'],
    ['photo.webp', WEBP, 'webp', 'image/webp'],
    ['form.pdf', PDF, 'pdf', 'application/pdf'],
    ['letter.docx', DOCX, 'docx', `${OOXML}.wordprocessingml.document`],
    ['sheet.xlsx', XLSX, 'xlsx', `${OOXML}.spreadsheetml.sheet`],
    ['deck.pptx', PPTX, 'pptx', `${OOXML}.presentationml.presentation`],
    ['notes.txt', TEXT, 'txt', 'text/plain; charset=utf-8'],
    ['list.csv', TEXT, 'csv', 'text/csv; charset=utf-8'],
  ])('accepts %s by extension and content', async (fileName, content, type, contentType) => {
    const result = await intake.accept({ fileName, bytes: content }, ANY);

    expect(result).toEqual({
      ok: true,
      value: {
        bytes: content,
        type,
        contentType,
        fileName,
        sizeBytes: content.length,
        sha256: createHash('sha256').update(content).digest('hex'),
        scan: 'not-scanned',
      },
    });
  });

  it('computes the SHA-256 of the bytes', async () => {
    const result = await intake.accept({ fileName: 'a.txt', bytes: bytes('abc') }, ANY);

    expect(result.ok && result.value.sha256).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('refuses an empty file', async () => {
    expect(await intake.accept({ fileName: 'a.png', bytes: new Uint8Array() }, ANY)).toEqual({
      ok: false,
      error: { code: 'file.empty' },
    });
  });

  it('refuses a file over the policy limit, and accepts one at it', async () => {
    const policy: IntakePolicy = { maxBytes: PNG.length, allowedTypes: ['png'] };
    const larger = bytes([...PNG], 'x');

    expect(await intake.accept({ fileName: 'a.png', bytes: larger }, policy)).toEqual({
      ok: false,
      error: { code: 'file.too-large', maxBytes: PNG.length },
    });
    expect((await intake.accept({ fileName: 'a.png', bytes: PNG }, policy)).ok).toBe(true);
  });

  it.each(['run.exe', 'page.html', 'icon.svg', 'macro.docm', 'noextension', 'archive.zip'])(
    'refuses the type of %s',
    async (fileName) => {
      expect(await intake.accept({ fileName, bytes: PNG }, ANY)).toEqual({
        ok: false,
        error: { code: 'file.type-not-allowed' },
      });
    },
  );

  it('refuses a catalogue type the policy does not allow', async () => {
    const policy: IntakePolicy = { maxBytes: 1024, allowedTypes: ['pdf'] };

    expect(await intake.accept({ fileName: 'a.png', bytes: PNG }, policy)).toEqual({
      ok: false,
      error: { code: 'file.type-not-allowed' },
    });
  });

  it.each([
    ['an executable renamed to .png', 'a.png', bytes('MZ', [0x90, 0])],
    ['a PDF renamed to .jpg', 'a.jpg', PDF],
    ['HTML renamed to .pdf', 'a.pdf', bytes('<html><script>')],
    ['a PNG renamed to .txt', 'a.txt', PNG],
    ['a ZIP renamed to .csv', 'a.csv', DOCX],
    ['a workbook renamed to .docx', 'a.docx', XLSX],
    ['a macro document renamed to .docx', 'a.docx', MACRO_DOCX],
    ['binary with a NUL renamed to .txt', 'a.txt', bytes('abc', [0], 'def')],
    ['invalid UTF-8 in a .csv', 'a.csv', bytes([0xc3, 0x28])],
    ['a truncated PNG signature', 'a.png', bytes([0x89, 0x50, 0x4e])],
  ])('refuses %s as a type mismatch', async (_, fileName, content) => {
    expect(await intake.accept({ fileName, bytes: content }, ANY)).toEqual({
      ok: false,
      error: { code: 'file.type-mismatch' },
    });
  });

  it('refuses a name with nothing usable left', async () => {
    expect(await intake.accept({ fileName: '../..', bytes: PNG }, ANY)).toEqual({
      ok: false,
      error: { code: 'file.name-invalid' },
    });
  });

  it('judges the type by the sanitised name: a bidi override cannot hide the extension', async () => {
    // U+202E (right-to-left override) makes it read as "photoexe.png"; the extension is .exe.
    const result = await intake.accept({ fileName: 'photo\u202egnp.exe', bytes: PNG }, ANY);

    expect(result).toEqual({ ok: false, error: { code: 'file.type-not-allowed' } });
  });

  describe('with a malware scanner bound', () => {
    const scannerAnswering = (answer: 'clean' | 'infected') => {
      const scan = jest.fn<Promise<'clean' | 'infected'>, [Uint8Array]>();
      scan.mockResolvedValue(answer);
      const scanner: MalwareScanner = { scan };
      return { scanner, scan };
    };

    it('marks a clean file as scanned', async () => {
      const { scanner, scan } = scannerAnswering('clean');
      const result = await new FileIntake(scanner).accept({ fileName: 'a.pdf', bytes: PDF }, ANY);

      expect(result.ok && result.value.scan).toBe('clean');
      expect(scan).toHaveBeenCalledWith(PDF);
    });

    it('refuses an infected file', async () => {
      const result = await new FileIntake(scannerAnswering('infected').scanner).accept(
        { fileName: 'a.pdf', bytes: PDF },
        ANY,
      );

      expect(result).toEqual({ ok: false, error: { code: 'file.infected' } });
    });

    it('counts any answer but clean as infected', async () => {
      const scan = jest.fn<Promise<'clean' | 'infected'>, [Uint8Array]>();
      scan.mockResolvedValue(undefined as unknown as 'clean');
      const result = await new FileIntake({ scan }).accept({ fileName: 'a.pdf', bytes: PDF }, ANY);

      expect(result).toEqual({ ok: false, error: { code: 'file.infected' } });
    });

    it('does not scan a file the checks already refused', async () => {
      const { scanner, scan } = scannerAnswering('clean');
      await new FileIntake(scanner).accept({ fileName: 'a.exe', bytes: PDF }, ANY);

      expect(scan).not.toHaveBeenCalled();
    });

    it('lets a scanner failure through: an unscanned file is never accepted as clean', async () => {
      const scanner: MalwareScanner = { scan: jest.fn().mockRejectedValue(new Error('down')) };

      await expect(
        new FileIntake(scanner).accept({ fileName: 'a.pdf', bytes: PDF }, ANY),
      ).rejects.toThrow('down');
    });
  });

  it.each([
    [{ maxBytes: 0, allowedTypes: ['png'] }],
    [{ maxBytes: MAX_FILE_BYTES + 1, allowedTypes: ['png'] }],
    [{ maxBytes: 1.5, allowedTypes: ['png'] }],
    [{ maxBytes: 10, allowedTypes: [] }],
    [{ maxBytes: 10, allowedTypes: ['toString'] }],
  ])('throws on the malformed policy %p: a policy is code', async (policy) => {
    await expect(
      intake.accept({ fileName: 'a.png', bytes: PNG }, policy as IntakePolicy),
    ).rejects.toThrow(RangeError);
  });
});

describe('sanitiseFileName', () => {
  it.each([
    ['report.pdf', 'report.pdf'],
    ['C:\\Users\\ali\\report.pdf', 'report.pdf'],
    ['../../etc/passwd', 'passwd'],
    ['  .hidden.txt. ', 'hidden.txt'],
    ['a<b>c:d"e|f?g*h.txt', 'abcdefgh.txt'],
    ['line\nbreak\u0000.txt', 'linebreak.txt'],
    ['photo\u202egnp.exe', 'photognp.exe'],
    ['\u2067isolate\u2069.pdf', 'isolate.pdf'],
    // ZWNJ is part of Persian spelling and stays.
    ['نامه\u200cها.pdf', 'نامه\u200cها.pdf'],
    // Decomposed input is stored composed.
    ['cafe\u0301.txt', 'caf\u00e9.txt'],
  ])('turns %p into %p', (raw, expected) => {
    expect(sanitiseFileName(raw)).toBe(expected);
  });

  it.each([
    ['a lone high surrogate', 'a\ud800b.pdf', 'ab.pdf'],
    ['a lone low surrogate', 'a\udc00b.pdf', 'ab.pdf'],
    ['a zero width space', 'in\u200bvoice.pdf', 'invoice.pdf'],
    ['a byte order mark', '\ufeffreport.pdf', 'report.pdf'],
    ['a soft hyphen and a word joiner', 'rep\u00adort\u2060.pdf', 'report.pdf'],
  ])('removes %s', (_, raw, expected) => {
    const name = sanitiseFileName(raw);

    expect(name).toBe(expected);
    expect(() => encodeURIComponent(name ?? '')).not.toThrow();
  });

  it.each(['', '   ', '...', '../', '\u202e'])('answers null for %p', (raw) => {
    expect(sanitiseFileName(raw)).toBeNull();
  });

  it('cuts a long name to the limit and keeps the extension', () => {
    const name = sanitiseFileName(`${'ب'.repeat(300)}.pdf`);

    expect([...(name ?? '')]).toHaveLength(MAX_FILE_NAME_LENGTH);
    expect(name?.endsWith('.pdf')).toBe(true);
  });

  it('does not split a character outside the BMP when cutting', () => {
    const name = sanitiseFileName(`${'😀'.repeat(300)}.txt`) ?? '';

    // encodeURIComponent throws on a lone surrogate.
    expect(() => encodeURIComponent(name)).not.toThrow();
    expect([...name]).toHaveLength(MAX_FILE_NAME_LENGTH);
  });
});
