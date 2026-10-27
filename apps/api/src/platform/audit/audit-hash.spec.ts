// Ported from Mondapac apps/api/src/platform/audit/audit-hash.spec.ts, Market adapted to Tenant.
import { createHash } from 'node:crypto';
import { canonicalJson, Temporal } from '@phoenix/shared-kernel';
import {
  AUDIT_HASH_VERSION,
  chainHashOf,
  chainHashText,
  genesisPrev,
  hashAuditRow,
  holdsUnsafeNumber,
  occurredAtText,
  sameHash,
  type AuditRowRecord,
} from './audit-hash';

// Mondapac docs/design/domain/platform-audit.md 6.2 and 16 ("golden hash vectors", "the fallback row
// hash"). The golden values below are checked in: a change to the construction changes them,
// and the test fails until a new hash version is designed (PA 6.2: a version change never goes
// back). Each is also recomputed here from the byte layout of 6.2, independently of the code.

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex');

/** A fixed row of each tenant fixture, as read back from the database. */
const ROW_FA: AuditRowRecord = {
  id: '01990000-0000-7000-8000-000000000001',
  tenantId: 'demo-fa',
  occurredAt: Temporal.Instant.from('2026-10-08T06:00:00.250Z'),
  actorType: 'ANONYMOUS',
  actorId: null,
  action: 'identity.staff-access.founded',
  targetType: 'identity.staff-access',
  targetId: '01990000-0000-7000-8000-0000000000aa',
  before: null,
  after: {
    state: 'pending',
    origin: 'self',
    siteId: '01990000-0000-7000-8000-0000000000aa',
    accountId: '01990000-0000-7000-8000-0000000000bb',
    boundSubjectId: '01990000-0000-7000-8000-0000000000bb',
  },
  correlationId: 'req-0001',
};
const ROW_EN: AuditRowRecord = {
  ...ROW_FA,
  id: '01990000-0000-7000-8000-000000000002',
  tenantId: 'demo-en',
  occurredAt: Temporal.Instant.from('2026-10-08T06:00:00Z'),
  actorType: 'SYSTEM',
  action: 'identity.role.seeded',
  targetType: 'identity.role',
  targetId: '01990000-0000-7000-8000-0000000000cc',
  after: { scope: 'site', kind: 'system', seedVersion: 1 },
};

/** The canonical row of PA 6.2, written out by hand for ROW_FA. */
const CANONICAL_FA =
  '{"action":"identity.staff-access.founded","actorId":null,' +
  '"actorType":"ANONYMOUS","after":{"accountId":"01990000-0000-7000-8000-0000000000bb",' +
  '"boundSubjectId":"01990000-0000-7000-8000-0000000000bb","origin":"self",' +
  '"siteId":"01990000-0000-7000-8000-0000000000aa","state":"pending"},"before":null,' +
  '"correlationId":"req-0001","id":"01990000-0000-7000-8000-000000000001",' +
  '"occurredAt":"2026-10-08T06:00:00.250Z","targetId":"01990000-0000-7000-8000-0000000000aa",' +
  '"targetType":"identity.staff-access","tenantId":"demo-fa","v":1}';

/** SHA-256 of `tag || 0x00 || body`, the frame of every hash of 6.2. */
function tagged(tag: string, body: Buffer): string {
  return createHash('sha256')
    .update(Buffer.concat([Buffer.from(tag, 'utf8'), Buffer.of(0), body]))
    .digest('hex');
}

/** The link of 6.2 laid out by hand: 2 + 4 + 32 + 8 + 1 + 32 bytes after the tag. */
function linkByHand(
  version: number,
  epoch: number,
  prev: Buffer,
  seq: bigint,
  late: boolean,
  rowHash: Buffer,
): string {
  const body = Buffer.alloc(79);
  body.writeUInt16BE(version, 0);
  body.writeUInt32BE(epoch, 2);
  prev.copy(body, 6);
  body.writeBigUInt64BE(seq, 38);
  body.writeUInt8(late ? 1 : 0, 46);
  rowHash.copy(body, 47);
  return tagged('PHOENIX-AUDIT-CHAIN-v1', body);
}

// Checked in (PA 16), Phoenix's own: the tags are PHOENIX-AUDIT-*, the row has no marketId and
// no actingAsId. Computed outside this code from the byte layout, and recomputed by hand below.
const GOLDEN = {
  rowFa: 'bdb12735a57cb74b57a4dc3fc3486043b26614ada93feaf658f314be02c97a4c',
  rowEn: 'bb72008e4b71d0bd87a67bfe55eadced59c57606cbc03773cb97171678afb909',
  chain1: '625053ccc678f9bd51efe42ffeeba0ef23a0e2cb2154d311408564d9cc2e82c5',
  chain2Late: '56017c8aa8fb2abdcbdfb1e83ba7a8bf9042fdfed5ebc5d531aa6bd27ae2cfc6',
  epoch2: 'dfe81f4be57e6dab27680350f0bc32dabf79a7db8fc1e9736e84de8c32dc339d',
  fallback: '3ba624430d7f7696641952cacc39026153e65c10ca4f1c22a55d728c9a0de557',
};

describe('the row hash of hash version 1 (PA 6.2)', () => {
  it('hashes the canonical JSON of the row object, as written out by hand', () => {
    expect(canonicalJson({ ...ROW_FA, v: 1, occurredAt: '2026-10-08T06:00:00.250Z' })).toEqual({
      ok: true,
      value: CANONICAL_FA,
    });
    const hash = hashAuditRow(ROW_FA);

    expect(hash).toEqual({
      hash: expect.any(Uint8Array) as unknown,
      canonical: true,
      fallback: false,
    });
    expect(hex(hash.hash)).toBe(tagged('PHOENIX-AUDIT-ROW-v1', Buffer.from(CANONICAL_FA, 'utf8')));
  });

  it('gives the checked-in golden values for a row of each tenant fixture', () => {
    expect(hex(hashAuditRow(ROW_FA).hash)).toBe(GOLDEN.rowFa);
    expect(hex(hashAuditRow(ROW_EN).hash)).toBe(GOLDEN.rowEn);
  });

  it('writes occurredAt with exactly three fractional digits and Z', () => {
    expect(occurredAtText(Temporal.Instant.from('2026-10-08T06:00:00Z'))).toBe(
      '2026-10-08T06:00:00.000Z',
    );
    expect(occurredAtText(Temporal.Instant.from('2026-10-08T06:00:00.25Z'))).toBe(
      '2026-10-08T06:00:00.250Z',
    );
  });

  it('does not depend on the key order or number text of the jsonb as read back', () => {
    const reordered: AuditRowRecord = {
      ...ROW_FA,
      after: Object.fromEntries(Object.entries(ROW_FA.after as object).reverse()),
    };

    expect(sameHash(hashAuditRow(reordered).hash, hashAuditRow(ROW_FA).hash)).toBe(true);
  });

  it('changes when any column changes, absent values included', () => {
    const base = hex(hashAuditRow(ROW_FA).hash);
    for (const change of [
      { tenantId: 'demo-en' },
      { action: 'identity.role.seeded' },
      { occurredAt: ROW_FA.occurredAt.add({ milliseconds: 1 }) },
      { actorId: '01990000-0000-7000-8000-0000000000dd' },
      { before: {} },
      { correlationId: 'req-0002' },
    ] satisfies Partial<AuditRowRecord>[]) {
      expect(hex(hashAuditRow({ ...ROW_FA, ...change }).hash)).not.toBe(base);
    }
  });
});

describe('the fallback row hash (PA 6.2; Hassan M2, N1 c, I-b)', () => {
  // A jsonb number beyond the double range reads back as Infinity, which canonicalJson refuses.
  const BEYOND: AuditRowRecord = { ...ROW_FA, after: { count: Number.POSITIVE_INFINITY } };

  it('seals a row canonicalJson refuses with the RAW tag over JSON.stringify, flagged noncanonical', () => {
    const hash = hashAuditRow(BEYOND);
    const object = {
      v: 1,
      id: BEYOND.id,
      tenantId: BEYOND.tenantId,
      occurredAt: '2026-10-08T06:00:00.250Z',
      actorType: BEYOND.actorType,
      actorId: null,
      action: BEYOND.action,
      targetType: BEYOND.targetType,
      targetId: BEYOND.targetId,
      before: null,
      after: { count: Number.POSITIVE_INFINITY },
      correlationId: BEYOND.correlationId,
    };

    expect(hash.canonical).toBe(false);
    expect(hash.fallback).toBe(true);
    expect(hex(hash.hash)).toBe(
      tagged('PHOENIX-AUDIT-ROW-RAW-v1', Buffer.from(JSON.stringify(object), 'utf8')),
    );
    expect(hex(hash.hash)).toBe(GOLDEN.fallback);
  });

  it('is chosen only by whether canonicalJson refuses: a canonical row never gets it', () => {
    const hash = hashAuditRow(ROW_FA);

    expect(hash.fallback).toBe(false);
    expect(hex(hash.hash)).not.toBe(
      tagged('PHOENIX-AUDIT-ROW-RAW-v1', Buffer.from(JSON.stringify(ROW_FA), 'utf8')),
    );
  });

  it('writes a number beyond the double range as null, so such rows are always flagged', () => {
    const asNull: AuditRowRecord = { ...ROW_FA, after: { count: null } };

    // Two different stored values, one fallback hash: acceptable only because both are flagged.
    expect(hashAuditRow({ ...ROW_FA, after: { count: Number.NEGATIVE_INFINITY } }).hash).toEqual(
      hashAuditRow(BEYOND).hash,
    );
    expect(hashAuditRow(asNull).fallback).toBe(false);
  });

  it('flags a canonical row whose before or after holds a number that is not a safe integer (8 (k))', () => {
    expect(hashAuditRow({ ...ROW_FA, after: { n: 2 ** 53 } })).toMatchObject({
      canonical: false,
      fallback: false,
    });
    expect(hashAuditRow({ ...ROW_FA, before: { list: [1, 1.5] } }).canonical).toBe(false);
    expect(holdsUnsafeNumber({ a: [{ b: 9_007_199_254_740_991 }] })).toBe(false);
    expect(holdsUnsafeNumber({ a: [{ b: -9_007_199_254_740_992 }] })).toBe(true);
  });
});

describe('the chain hash of hash version 1 (PA 6.2; Hassan L2; Ali 2026-10-08)', () => {
  const rowHash = hashAuditRow(ROW_FA).hash;

  it('links the genesis, then a late seal, as laid out by hand, to the golden values', () => {
    const first = chainHashOf({
      hashVersion: AUDIT_HASH_VERSION,
      epoch: 1,
      prev: genesisPrev(),
      chainSeq: 1n,
      late: false,
      rowHash,
    });
    const second = chainHashOf({
      hashVersion: 1,
      epoch: 1,
      prev: first,
      chainSeq: 2n,
      late: true,
      rowHash: hashAuditRow(ROW_EN).hash,
    });

    expect(hex(first)).toBe(linkByHand(1, 1, Buffer.alloc(32), 1n, false, Buffer.from(rowHash)));
    expect(hex(second)).toBe(
      linkByHand(1, 1, Buffer.from(first), 2n, true, Buffer.from(hashAuditRow(ROW_EN).hash)),
    );
    expect(hex(first)).toBe(GOLDEN.chain1);
    expect(hex(second)).toBe(GOLDEN.chain2Late);
  });

  it('binds the epoch: the same link in epoch 2 gives another hash (golden)', () => {
    const epoch2 = chainHashOf({
      hashVersion: 1,
      epoch: 2,
      prev: genesisPrev(),
      chainSeq: 1n,
      late: false,
      rowHash,
    });

    expect(hex(epoch2)).toBe(linkByHand(1, 2, Buffer.alloc(32), 1n, false, Buffer.from(rowHash)));
    expect(hex(epoch2)).toBe(GOLDEN.epoch2);
    expect(hex(epoch2)).not.toBe(GOLDEN.chain1);
  });

  it('binds the hash version, the sequence, the late flag, the predecessor and the row', () => {
    const base = {
      hashVersion: 1,
      epoch: 1,
      prev: genesisPrev(),
      chainSeq: 1n,
      late: false,
      rowHash,
    };
    const reference = hex(chainHashOf(base));
    for (const change of [
      { hashVersion: 2 },
      { chainSeq: 2n },
      { late: true },
      { prev: new Uint8Array(32).fill(1) },
      { rowHash: new Uint8Array(32).fill(2) },
    ]) {
      expect(hex(chainHashOf({ ...base, ...change }))).not.toBe(reference);
    }
  });

  it.each([
    ['a hash version beyond uint16', { hashVersion: 0x10000 }],
    ['epoch 0', { epoch: 0 }],
    ['chain_seq 0', { chainSeq: 0n }],
    ['a short predecessor', { prev: new Uint8Array(31) }],
    ['a long row hash', { rowHash: new Uint8Array(33) }],
  ])('refuses %s', (_case, change) => {
    expect(() =>
      chainHashOf({
        hashVersion: 1,
        epoch: 1,
        prev: genesisPrev(),
        chainSeq: 1n,
        late: false,
        rowHash,
        ...change,
      }),
    ).toThrow(RangeError);
  });

  it('hands out a new genesis each time, and writes a hash as sha256: text at the boundaries', () => {
    const genesis = genesisPrev();
    genesis[0] = 1;

    expect(genesisPrev()).toEqual(new Uint8Array(32));
    expect(chainHashText(new Uint8Array(32).fill(0xab))).toBe(`sha256:${'ab'.repeat(32)}`);
    expect(() => chainHashText(new Uint8Array(31))).toThrow(RangeError);
  });
});
