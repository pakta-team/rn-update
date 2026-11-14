import { describe, expect, test } from 'bun:test';
import { ResourceFinder } from '../src/utils/app-info-parser/resource-finder';

// Minimal resources.arsc writer: one string pool, one package (0x7f) with one
// type (id 1) holding a string, an integer and a reference entry.

function u8(n: number) {
  return Buffer.from([n & 0xff]);
}

function u16(n: number) {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n);
  return b;
}

function u32(n: number) {
  const b = Buffer.alloc(4);
  b.writeInt32LE(n);
  return b;
}

function chunk(type: number, header: Buffer[], body: Buffer[]) {
  const headerSize = 8 + Buffer.concat(header).length;
  const size = headerSize + Buffer.concat(body).length;
  return Buffer.concat([
    u16(type),
    u16(headerSize),
    u32(size),
    ...header,
    ...body,
  ]);
}

function stringPool(strings: string[], utf8: boolean) {
  const data: Buffer[] = [];
  const offsets: Buffer[] = [];
  let offset = 0;
  for (const s of strings) {
    let encoded: Buffer;
    if (utf8) {
      const bytes = Buffer.from(s, 'utf8');
      encoded = Buffer.concat([u8(s.length), u8(bytes.length), bytes, u8(0)]);
    } else {
      encoded = Buffer.concat([
        u16(s.length),
        Buffer.from(s, 'utf16le'),
        u16(0),
      ]);
    }
    offsets.push(u32(offset));
    data.push(encoded);
    offset += encoded.length;
  }
  const stringsStart = 28 + 4 * strings.length;
  return chunk(
    0x0001,
    [
      u32(strings.length),
      u32(0),
      u32(utf8 ? 0x100 : 0),
      u32(stringsStart),
      u32(0),
    ],
    [...offsets, ...data],
  );
}

function entry(key: number, dataType: number, data: number) {
  return Buffer.concat([
    u16(8),
    u16(0),
    u32(key),
    u16(8),
    u8(0),
    u8(dataType),
    u32(data),
  ]);
}

function resourceTable(values: string[], utf8: boolean) {
  const typeStrings = stringPool(['string'], utf8);
  const keyStrings = stringPool(['name', 'count', 'alias'], utf8);
  const typeSpec = chunk(
    0x0202,
    [u8(1), u8(0), u16(0), u32(3)],
    [u32(0), u32(0), u32(0)],
  );
  const entries = [
    entry(0, 0x03, 0),
    entry(1, 0x10, 42),
    entry(2, 0x01, 0x7f010000),
  ];
  const indices: Buffer[] = [];
  let at = 0;
  for (const e of entries) {
    indices.push(u32(at));
    at += e.length;
  }
  // header: id, res0, res1, entryCount, entriesStart, config (size field only)
  const type = chunk(
    0x0201,
    [u8(1), u8(0), u16(0), u32(3), u32(24 + 4 * 3), u32(4)],
    [...indices, ...entries],
  );
  const packageHeaderSize = 288;
  const pkg = chunk(
    0x0200,
    [
      u32(0x7f),
      Buffer.alloc(256),
      u32(packageHeaderSize),
      u32(0),
      u32(packageHeaderSize + typeStrings.length),
      u32(0),
      u32(0),
    ],
    [typeStrings, keyStrings, typeSpec, type],
  );
  return chunk(0x0002, [u32(1)], [stringPool(values, utf8), pkg]);
}

describe('ResourceFinder', () => {
  for (const utf8 of [true, false]) {
    test(`decodes a ${utf8 ? 'UTF-8' : 'UTF-16'} resource table`, () => {
      const table = resourceTable(['My App', '应用名称'], utf8);
      expect(new ResourceFinder().processResourceTable(table)).toEqual({
        '@7F010000': ['My App'],
        '@7F010001': ['42'],
        '@7F010002': ['My App'],
      });
    });
  }

  test('rejects a buffer that is not a resource table', () => {
    expect(() =>
      new ResourceFinder().processResourceTable(Buffer.alloc(16)),
    ).toThrow('No RES_TABLE_TYPE found!');
  });

  test('rejects a truncated resource table', () => {
    const table = resourceTable(['My App'], true);
    expect(() =>
      new ResourceFinder().processResourceTable(table.subarray(0, 40)),
    ).toThrow('The buffer size not matches to the resource table size.');
  });
});
