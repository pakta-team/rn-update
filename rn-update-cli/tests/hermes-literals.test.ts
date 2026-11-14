/**
 * [INPUT]: 依赖 Hermes 字面量解码器与合成 HBC fixture，覆盖 split/shaped 布局和边界错误
 * [OUTPUT]: 对外提供 hermes-literals 单元测试，锁定 v87–96 与 v98 字面量语义
 * [POS]: CLI Hermes 二进制语义层的回归防线，不参与生产运行时
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'child_process';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import {
  LITERAL_SEPARATOR,
  normalizeDisassemblyLine,
} from '../src/utils/hermes-base';
import {
  decodeSerializedLiterals,
  LiteralResolver,
  readLiteralBuffers,
  renderLiteral,
} from '../src/utils/hermes-literals';

// Every hermesc found runs the real-build tests, so a checkout with both the
// classic compiler (HBC 96) and hermes-compiler (HBC 98) covers both layouts.
const HERMESC_CANDIDATES = [
  '../../rn-update/node_modules/react-native/sdks/hermesc/linux64-bin/hermesc',
  '../../rn-update/node_modules/react-native/sdks/hermesc/osx-bin/hermesc',
  '../../rn-update/Example/testHotUpdate/node_modules/hermes-compiler/hermesc/osx-bin/hermesc',
  '../../rn-update/.e2e-rn077-oldarch/AwesomeProject/node_modules/react-native/sdks/hermesc/osx-bin/hermesc',
].map((p) => path.resolve(__dirname, p));
const hermescs = (
  process.env.HERMESC
    ? [process.env.HERMESC]
    : HERMESC_CANDIDATES.filter((p) => fs.existsSync(p))
).filter(
  // a linux64 binary can sit next to the osx one; keep only what runs here
  (p) => fs.existsSync(p) && spawnSync(p, ['-version']).status === 0,
);

/** tag byte: type | length (≤ 15) */
const tag = (type: number, length: number) => type | length;
const NULL = 0x00;
const TRUE = 0x10;
const FALSE = 0x20;
const NUMBER = 0x30;
const LONG_STRING = 0x40;
const SHORT_STRING = 0x50;
const BYTE_STRING = 0x60;
const INTEGER = 0x70;

const u16 = (n: number) => [n & 0xff, n >> 8];
const i32 = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeInt32LE(n);
  return [...b];
};
const f64 = (n: number) => {
  const b = Buffer.alloc(8);
  b.writeDoubleLE(n);
  return [...b];
};

describe('decodeSerializedLiterals', () => {
  test('every tag type, fixed value widths, runs of several entries', () => {
    const buf = Buffer.from([
      tag(SHORT_STRING, 2),
      ...u16(300),
      ...u16(7),
      tag(INTEGER, 1),
      ...i32(-42),
      tag(NUMBER, 1),
      ...f64(2.5),
      tag(BYTE_STRING, 1),
      0x52,
      tag(NULL, 1),
      tag(TRUE, 2),
      tag(FALSE, 1),
      tag(LONG_STRING, 1),
      ...i32(70000),
    ]);
    expect(decodeSerializedLiterals(buf, 0, 10)).toEqual([
      { kind: 'string', id: 300 },
      { kind: 'string', id: 7 },
      { kind: 'int', value: -42 },
      { kind: 'number', value: 2.5 },
      { kind: 'string', id: 82 },
      { kind: 'null' },
      { kind: 'true' },
      { kind: 'true' },
      { kind: 'false' },
      { kind: 'string', id: 70000 },
    ]);
    // a count shorter than the run stops inside it
    expect(decodeSerializedLiterals(buf, 0, 1)).toEqual([
      { kind: 'string', id: 300 },
    ]);
  });

  test('a run longer than 15 carries its length in a second byte', () => {
    const entries = 1000;
    const bytes = [0x80 | SHORT_STRING | (entries >> 8), entries & 0xff];
    for (let i = 0; i < entries; i++) bytes.push(...u16(i));
    const values = decodeSerializedLiterals(Buffer.from(bytes), 0, entries);
    expect(values).toHaveLength(entries);
    expect(values![999]).toEqual({ kind: 'string', id: 999 });
  });

  test('offsets may start inside an earlier literal (the builder overlaps them)', () => {
    // seen in a real build: literal A = [..., [String 82]] ends with the
    // value byte 0x52, and literal B starts at that same byte, where 0x52 is
    // read as a tag (two short strings) — a sequential parse of the buffer
    // cannot see B, only the instruction offsets can
    const buf = Buffer.from([
      tag(BYTE_STRING, 1),
      0x52,
      0xcd,
      0x09,
      0xb3,
      0x05,
      tag(TRUE, 1),
    ]);
    expect(decodeSerializedLiterals(buf, 0, 1)).toEqual([
      { kind: 'string', id: 82 },
    ]);
    expect(decodeSerializedLiterals(buf, 1, 3)).toEqual([
      { kind: 'string', id: 0x09cd },
      { kind: 'string', id: 0x05b3 },
      { kind: 'true' },
    ]);
  });

  test('reaching outside the buffer is null, never a guess', () => {
    const buf = Buffer.from([tag(INTEGER, 2), ...i32(1)]);
    expect(decodeSerializedLiterals(buf, 0, 1)).toEqual([
      { kind: 'int', value: 1 },
    ]);
    expect(decodeSerializedLiterals(buf, 0, 2)).toBeNull();
    expect(decodeSerializedLiterals(buf, 5, 1)).toBeNull();
    expect(decodeSerializedLiterals(buf, -1, 1)).toBeNull();
    expect(
      decodeSerializedLiterals(Buffer.from([0x80 | NULL]), 0, 1),
    ).toBeNull();
  });
});

describe('renderLiteral', () => {
  const strings = new Map([[82, 'color']]);
  test('strings resolve through the table; unknown ids fail closed', () => {
    expect(renderLiteral({ kind: 'string', id: 82 }, strings)).toBe(
      '[String "color"]',
    );
    expect(() => renderLiteral({ kind: 'string', id: 5 }, strings)).toThrow(
      'unresolved string id 5',
    );
  });
  test('doubles keep their bits: -0 and 0 differ, two NaNs agree', () => {
    const zero = renderLiteral({ kind: 'number', value: 0 }, strings);
    const negZero = renderLiteral({ kind: 'number', value: -0 }, strings);
    expect(zero).not.toBe(negZero);
    expect(negZero.startsWith('[double -0#')).toBe(true);
    expect(renderLiteral({ kind: 'number', value: NaN }, strings)).toBe(
      renderLiteral({ kind: 'number', value: NaN }, strings),
    );
    expect(renderLiteral({ kind: 'int', value: 7 }, strings)).toBe('[int 7]');
    expect(renderLiteral({ kind: 'null' }, strings)).toBe('null');
  });
});

describe('normalizeDisassemblyLine with binary literals', () => {
  const strings = new Map([
    [1, 'a'],
    [2, 'b'],
    [3, 'k'],
  ]);
  const array = Buffer.from([
    tag(BYTE_STRING, 2),
    1,
    2,
    tag(INTEGER, 1),
    ...i32(9),
  ]);
  const keys = Buffer.from([tag(BYTE_STRING, 1), 3]);
  const values = Buffer.from([tag(TRUE, 1)]);
  const resolver = new LiteralResolver(
    {
      layout: 'split',
      version: 96,
      array,
      objectKeys: keys,
      objectValues: values,
    },
    strings,
  );

  test('New*WithBuffer lines carry the decoded literals, width suffix folded', () => {
    expect(
      normalizeDisassemblyLine(
        '    NewArrayWithBufferLong r4, 3, 3, 0',
        strings,
        resolver,
      ),
    ).toBe(
      `    NewArrayWithBuffer r4 size=3 n=3 [[String "a"]${LITERAL_SEPARATOR}[String "b"]${LITERAL_SEPARATOR}[int 9]]`,
    );
    // an offset into the second run only sees what starts there
    expect(
      normalizeDisassemblyLine(
        '    NewArrayWithBuffer r4, 1, 1, 3',
        strings,
        resolver,
      ),
    ).toBe('    NewArrayWithBuffer r4 size=1 n=1 [[int 9]]');
    expect(
      normalizeDisassemblyLine(
        '    NewObjectWithBuffer r1, 1, 1, 0, 0',
        strings,
        resolver,
      ),
    ).toBe('    NewObjectWithBuffer r1 size=1 n=1 {[String "k"]: true}');
  });

  test('an undecodable offset fails closed even when both sides are broken', () => {
    expect(() =>
      normalizeDisassemblyLine(
        '    NewArrayWithBuffer r4, 2, 2, 9',
        strings,
        resolver,
      ),
    ).toThrow('undecodable');
  });

  test('without buffers only the size hint survives (whole-buffer fallback)', () => {
    expect(
      normalizeDisassemblyLine(
        '    NewArrayWithBufferLong r4, 3, 3, 0',
        strings,
      ),
    ).toBe('    NewArrayWithBuffer r4 sizes=3');
  });
});

describe('normalizeDisassemblyLine with v98 shaped literals', () => {
  const strings = new Map([
    [1, 'a'],
    [3, 'k'],
    [4, 'm'],
  ]);
  // one value buffer for arrays and objects; the object at 0 overlaps the
  // array at 1, as hermesc lays them out
  const values = Buffer.from([
    tag(TRUE, 1),
    tag(SHORT_STRING, 1),
    ...u16(1),
    tag(INTEGER, 1),
    ...i32(7),
  ]);
  // v98 has no 1-byte string ids
  const keys = Buffer.from([tag(SHORT_STRING, 2), ...u16(3), ...u16(4)]);
  // shape 0: keys at 0, 2 props; shape 1: keys at 99 (out of range)
  const shapes = Buffer.from([0, 0, 0, 0, 2, 0, 0, 0, 99, 0, 0, 0, 1, 0, 0, 0]);
  const resolver = new LiteralResolver(
    { layout: 'shaped', version: 98, values, objectKeys: keys, shapes },
    strings,
  );

  test('arrays and objects read the shared value buffer, keys through the shape', () => {
    expect(
      normalizeDisassemblyLine(
        '    NewArrayWithBuffer r2, 2, 2, 1',
        strings,
        resolver,
      ),
    ).toBe(
      `    NewArrayWithBuffer r2 size=2 n=2 [[String "a"]${LITERAL_SEPARATOR}[int 7]]`,
    );
    expect(
      normalizeDisassemblyLine(
        '    NewObjectWithBufferLong r2, 0, 0',
        strings,
        resolver,
      ),
    ).toBe(
      `    NewObjectWithBuffer r2 n=2 {[String "k"]: true${LITERAL_SEPARATOR}[String "m"]: [String "a"]}`,
    );
  });

  test('type 6 is undefined in v98 (no value bytes), a 1-byte string id before', () => {
    const buf = Buffer.from([tag(BYTE_STRING, 2), tag(INTEGER, 1), ...i32(4)]);
    expect(decodeSerializedLiterals(buf, 0, 3, 'shaped')).toEqual([
      { kind: 'undefined' },
      { kind: 'undefined' },
      { kind: 'int', value: 4 },
    ]);
    // the same bytes in the split layout: two string ids, 0x71 and 0x04
    expect(decodeSerializedLiterals(buf, 0, 2, 'split')).toEqual([
      { kind: 'string', id: 0x71 },
      { kind: 'string', id: 4 },
    ]);
    expect(renderLiteral({ kind: 'undefined' }, strings)).toBe('undefined');
  });

  test('the parent register of AndParent stays; it is not a buffer operand', () => {
    expect(
      normalizeDisassemblyLine(
        '    NewObjectWithBufferAndParent r3, r1, 0, 0',
        strings,
        resolver,
      ),
    ).toBe(
      `    NewObjectWithBufferAndParent r3 r1 n=2 {[String "k"]: true${LITERAL_SEPARATOR}[String "m"]: [String "a"]}`,
    );
  });

  test('a shape or key offset out of range fails closed', () => {
    expect(() =>
      normalizeDisassemblyLine(
        '    NewObjectWithBuffer r2, 5, 0',
        strings,
        resolver,
      ),
    ).toThrow('undecodable');
    expect(() =>
      normalizeDisassemblyLine(
        '    NewObjectWithBuffer r2, 1, 0',
        strings,
        resolver,
      ),
    ).toThrow('undecodable');
  });

  test('the shape index itself is not compared, only what it points at', () => {
    const twin = new LiteralResolver(
      {
        layout: 'shaped',
        version: 98,
        values,
        objectKeys: keys,
        // same shape as index 1 instead of 0
        shapes: Buffer.from([9, 0, 0, 0, 9, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0]),
      },
      strings,
    );
    expect(
      normalizeDisassemblyLine(
        '    NewObjectWithBuffer r2, 1, 0',
        strings,
        twin,
      ),
    ).toBe(
      normalizeDisassemblyLine(
        '    NewObjectWithBuffer r2, 0, 0',
        strings,
        resolver,
      ),
    );
  });
});

describe('readLiteralBuffers', () => {
  test('a file without a known layout is null', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rnu-literals-'));
    try {
      const file = path.join(dir, 'x.hbc');
      const buf = Buffer.alloc(200);
      Buffer.from('c61fbc03c103191f', 'hex').copy(buf, 0);
      buf.writeUInt32LE(96, 8);
      fs.writeFileSync(file, buf);
      expect(await readLiteralBuffers(file)).toBeNull();
      fs.writeFileSync(file, Buffer.from('not hbc'));
      expect(await readLiteralBuffers(file)).toBeNull();
    } finally {
      fs.removeSync(dir);
    }
  });

  for (const hermesc of hermescs) {
    test(`decodes what each instruction of a real build refers to (${path.relative(path.resolve(__dirname, '../..'), hermesc)})`, async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rnu-literals-real-'));
      try {
        const js = path.join(dir, 'a.js');
        const hbc = path.join(dir, 'a.hbc');
        fs.writeFileSync(
          js,
          'var a = ["color", 1, null, 2.5]; var b = {k: true, m: "color"}; print(a, b);\n',
        );
        expect(
          spawnSync(hermesc, ['-emit-binary', '-out', hbc, js, '-O', '-w'], {
            stdio: 'ignore',
          }).status,
        ).toBe(0);
        const dump = spawnSync(
          hermesc,
          ['-b', '-dump-bytecode', '-pretty-disassemble', hbc],
          { encoding: 'utf8' },
        ).stdout;
        const strings = new Map<number, string>();
        for (const line of dump.split('\n')) {
          const m = /^\s*[is](\d+)\[[^\]]*\](?: #[0-9A-F]+)?: (.*)$/.exec(line);
          if (m) strings.set(Number(m[1]), m[2]);
        }
        const buffers = await readLiteralBuffers(hbc);
        expect(buffers).not.toBeNull();
        // the dump's own version decides which layout must have been read
        const version = Number(/Bytecode version number: (\d+)/.exec(dump)![1]);
        expect(buffers!.layout).toBe(version >= 98 ? 'shaped' : 'split');
        const resolver = new LiteralResolver(buffers!, strings);
        const array = /NewArrayWithBuffer\w*\s+r\d+, \d+, (\d+), (\d+)/.exec(
          dump,
        )!;
        expect(resolver.array(Number(array[2]), Number(array[1]))).toEqual([
          '[String "color"]',
          '[int 1]',
          'null',
          expect.stringMatching(/^\[double 2\.5#/),
        ]);
        let keys: string[] | null;
        let values: string[] | null;
        if (buffers!.layout === 'shaped') {
          const object = /NewObjectWithBuffer\w*\s+r\d+, (\d+), (\d+)$/m.exec(
            dump,
          )!;
          const shape = resolver.shape(Number(object[1]))!;
          expect(shape.count).toBe(2);
          keys = resolver.objectKeys(shape.keyOffset, shape.count);
          values = resolver.objectValues(Number(object[2]), shape.count);
        } else {
          const object =
            /NewObjectWithBuffer\w*\s+r\d+, \d+, (\d+), (\d+), (\d+)/.exec(
              dump,
            )!;
          keys = resolver.objectKeys(Number(object[2]), Number(object[1]));
          values = resolver.objectValues(Number(object[3]), Number(object[1]));
        }
        expect(keys).toEqual(['[String "k"]', '[String "m"]']);
        expect(values).toEqual(['true', '[String "color"]']);
      } finally {
        fs.removeSync(dir);
      }
    });
  }
});
