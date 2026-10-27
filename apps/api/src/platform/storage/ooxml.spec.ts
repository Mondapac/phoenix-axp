import { ooxmlOf, zipOf } from '../../../test/support/zip';
import { isOoxmlPackage, MAX_OOXML_ENTRIES, MAX_OOXML_UNCOMPRESSED_BYTES } from './ooxml';

const DOCX = 'word/document.xml';

describe('isOoxmlPackage', () => {
  it('accepts a package with its content types and main part', () => {
    expect(isOoxmlPackage(ooxmlOf(DOCX, { name: 'word/styles.xml' }), DOCX)).toBe(true);
  });

  it('matches part names without regard to case', () => {
    expect(isOoxmlPackage(ooxmlOf('Word/Document.xml'), DOCX)).toBe(true);
  });

  it('accepts a package with a trailing archive comment', () => {
    const zip = ooxmlOf(DOCX);
    const withComment = new Uint8Array(zip.length + 5);
    withComment.set(zip);
    withComment.set(Buffer.from('hello'), zip.length);
    new DataView(withComment.buffer).setUint16(zip.length - 2, 5, true);

    expect(isOoxmlPackage(withComment, DOCX)).toBe(true);
  });

  it.each([
    ['a workbook renamed to .docx', ooxmlOf('xl/workbook.xml')],
    ['an archive without content types', zipOf([{ name: DOCX }])],
    ['any other archive', zipOf([{ name: 'setup.exe', content: 'MZ' }])],
    ['a macro document renamed to .docx', ooxmlOf(DOCX, { name: 'word/vbaProject.bin' })],
    ['an entry that climbs out', ooxmlOf(DOCX, { name: '../../evil.sh' })],
    ['an absolute entry name', ooxmlOf(DOCX, { name: '/etc/passwd' })],
    ['a backslash entry name', ooxmlOf(DOCX, { name: '..\\evil.bat' })],
    [
      'a declared size over the limit (zip bomb)',
      ooxmlOf(DOCX, { name: 'word/big.xml', declaredSize: MAX_OOXML_UNCOMPRESSED_BYTES + 1 }),
    ],
    [
      'too many entries',
      zipOf([
        { name: '[Content_Types].xml' },
        { name: DOCX },
        ...Array.from({ length: MAX_OOXML_ENTRIES }, (_, index) => ({ name: `p/${index}` })),
      ]),
    ],
    [
      'an empty archive',
      Uint8Array.from([0x50, 0x4b, 0x05, 0x06, ...new Array<number>(18).fill(0)]),
    ],
    ['a bare local header', Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 1, 2, 3])],
  ])('refuses %s', (_, bytes) => {
    expect(isOoxmlPackage(bytes, DOCX)).toBe(false);
  });

  it('refuses a truncated package without throwing', () => {
    const zip = ooxmlOf(DOCX);

    for (const cut of [30, 60, zip.length - 30, zip.length - 1]) {
      expect(isOoxmlPackage(zip.subarray(0, cut), DOCX)).toBe(false);
    }
  });

  it('refuses a directory offset pointing past its end record', () => {
    const zip = ooxmlOf(DOCX);
    new DataView(zip.buffer).setUint32(zip.length - 6, zip.length, true);

    expect(isOoxmlPackage(zip, DOCX)).toBe(false);
  });
});
