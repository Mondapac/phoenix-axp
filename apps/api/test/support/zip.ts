/**
 * A minimal ZIP writer for tests: stored (uncompressed) entries, CRC left at zero, which is
 * enough for code that reads the central directory only. `declaredSize` overrides an entry's
 * uncompressed size in the central directory, to fake a zip bomb without building one.
 */
export interface ZipEntry {
  readonly name: string;
  readonly content?: string;
  readonly declaredSize?: number;
}

export function zipOf(entries: readonly ZipEntry[]): Uint8Array {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const data = Buffer.from(entry.content ?? '', 'utf8');

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(entry.declaredSize ?? data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += local.length + name.length + data.length;
  }

  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);

  return new Uint8Array(Buffer.concat([...locals, directory, end]));
}

/** A minimal package of one Office Open XML kind, by its main part. */
export function ooxmlOf(mainPart: string, ...extra: ZipEntry[]): Uint8Array {
  return zipOf([
    { name: '[Content_Types].xml', content: '<Types/>' },
    { name: mainPart },
    ...extra,
  ]);
}
