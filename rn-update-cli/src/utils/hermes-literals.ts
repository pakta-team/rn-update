/**
 * [INPUT]: 依赖 HBC 头部布局解析与二进制文件句柄，读取 Hermes 字面量缓冲区和 v98 shape 表
 * [OUTPUT]: 对外提供字面量缓冲区读取、SLP 值解码、文本渲染与按指令定位的 LiteralResolver
 * [POS]: CLI Hermes 等价校验的二进制语义层，屏蔽 split/shaped HBC 布局差异，不负责反汇编进程
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

/**
 * Binary literal buffers of an HBC file, for the Hermes base equivalence
 * check (see docs/hermes-base-verification.md §3.2).
 *
 * `NewArrayWithBuffer` / `NewObjectWithBuffer` reference their literals by
 * *byte offset* into the serialized literal buffers. The text dump prints
 * those buffers entry by entry without byte positions, so the offsets in the
 * instructions cannot be mapped to entries from the dump alone — and a delta
 * build may lay the buffers out differently (deduplicated runs, different
 * order) while every instruction still resolves to the same literals. Reading
 * the buffers from the file and decoding at each instruction's offset
 * compares what the instruction actually builds.
 *
 * Serialized literal format (hermes SerializedLiteralGenerator): runs of
 * same-typed values. Tag byte: bits 6..4 = type, bit 7 = "length continues in
 * the next byte", bits 3..0 = low 4 bits of the run length (high 8 bits in
 * the next byte when bit 7 is set). Values follow the tag, fixed width per
 * type: none (null/true/false), 8-byte little-endian double, 4/2/1-byte
 * string id, 4-byte little-endian int32. HBC v98 reuses type 6 (the 1-byte
 * string id before) for `undefined`, which takes no value bytes; string ids
 * there are always 2 or 4 bytes wide.
 *
 * Two file layouts use that format:
 * - HBC v87–96 (`split`): arrayBuffer, objKeyBuffer, objValueBuffer.
 *   `NewArrayWithBuffer dst, sizeHint, count, arrayOffset`;
 *   `NewObjectWithBuffer dst, sizeHint, count, keyOffset, valueOffset`.
 * - HBC v98 and v99 (`shaped`): literalValueBuffer (array elements and object values
 *   alike), objKeyBuffer, objShapeTable (8-byte entries: keyOffset u32,
 *   numProps u32). `NewArrayWithBuffer dst, sizeHint, count, valueOffset`;
 *   `NewObjectWithBuffer dst, shapeIndex, valueOffset` and
 *   `NewObjectWithBufferAndParent dst, parent, shapeIndex, valueOffset`.
 */
import { readFile } from 'node:fs/promises';
import { resolveHbcSections } from './hbcTransform';

const TAG_TYPE_MASK = 0x70;
const TAG_LENGTH_CONTINUES = 0x80;
const TAG_LENGTH_LOW = 0x0f;

enum Tag {
  Null = 0x00,
  True = 0x10,
  False = 0x20,
  Number = 0x30,
  LongString = 0x40,
  ShortString = 0x50,
  /** HBC ≤96: 1-byte string id; HBC v98: `undefined` */
  ByteStringOrUndefined = 0x60,
  Integer = 0x70,
}

export type LiteralValue =
  | { kind: 'null' | 'true' | 'false' | 'undefined' }
  | { kind: 'number'; value: number }
  | { kind: 'int'; value: number }
  | { kind: 'string'; id: number };

/** The literal buffers of an HBC file, in one of the two layouts. */
export type LiteralBuffers =
  | {
      layout: 'split';
      version: number;
      array: Buffer;
      objectKeys: Buffer;
      objectValues: Buffer;
    }
  | {
      layout: 'shaped';
      version: number;
      values: Buffer;
      objectKeys: Buffer;
      shapes: Buffer;
    };

const SHAPE_ENTRY_SIZE = 8;

/**
 * The literal buffers of an HBC file's bytes, as views into them. Null for a
 * file whose layout is unknown: the caller then falls back to comparing the
 * dumped buffers as a whole.
 */
export function literalBuffersFromBytes(bytes: Buffer): LiteralBuffers | null {
  const resolved = resolveHbcSections(bytes, bytes.length);
  if (!resolved) return null;
  // resolveHbcSections keeps every section inside the file
  const views = (names: string[]) => {
    const ranges = names.map((name) => resolved.sections.get(name));
    return ranges.every(Boolean)
      ? ranges.map((r) => bytes.subarray(r!.start, r!.start + r!.size))
      : null;
  };
  const { version } = resolved;
  if (resolved.sections.has('objShapeTable')) {
    const bufs = views(['literalValueBuffer', 'objKeyBuffer', 'objShapeTable']);
    if (!bufs) return null;
    const [values, objectKeys, shapes] = bufs;
    return { layout: 'shaped', version, values, objectKeys, shapes };
  }
  const bufs = views(['arrayBuffer', 'objKeyBuffer', 'objValueBuffer']);
  if (!bufs) return null;
  const [array, objectKeys, objectValues] = bufs;
  return { layout: 'split', version, array, objectKeys, objectValues };
}

/** {@link literalBuffersFromBytes} for a file. */
export async function readLiteralBuffers(
  file: string,
): Promise<LiteralBuffers | null> {
  return literalBuffersFromBytes(await readFile(file));
}

/**
 * Decode `count` literal values starting at byte `offset`. Null when the
 * offset or a run reaches outside the buffer or a tag type is unknown; the
 * caller fails verification rather than treating two failures as equivalent. `layout` decides
 * what type 6 means (see the file comment).
 */
export function decodeSerializedLiterals(
  buffer: Buffer,
  offset: number,
  count: number,
  layout: LiteralBuffers['layout'] = 'split',
): LiteralValue[] | null {
  if (
    !Number.isSafeInteger(offset) ||
    !Number.isSafeInteger(count) ||
    offset < 0 ||
    count < 0 ||
    count > 1_000_000
  )
    return null;
  const values: LiteralValue[] = [];
  let pos = offset;
  while (values.length < count) {
    if (pos < 0 || pos >= buffer.length) return null;
    const tag = buffer[pos++];
    let length = tag & TAG_LENGTH_LOW;
    if (tag & TAG_LENGTH_CONTINUES) {
      if (pos >= buffer.length) return null;
      length = (length << 8) | buffer[pos++];
    }
    if (length === 0) return null;
    const type = tag & TAG_TYPE_MASK;
    for (let i = 0; i < length && values.length < count; i++) {
      switch (type) {
        case Tag.Null:
          values.push({ kind: 'null' });
          break;
        case Tag.True:
          values.push({ kind: 'true' });
          break;
        case Tag.False:
          values.push({ kind: 'false' });
          break;
        case Tag.Number:
          if (pos + 8 > buffer.length) return null;
          values.push({ kind: 'number', value: buffer.readDoubleLE(pos) });
          pos += 8;
          break;
        case Tag.LongString:
          if (pos + 4 > buffer.length) return null;
          values.push({ kind: 'string', id: buffer.readUInt32LE(pos) });
          pos += 4;
          break;
        case Tag.ShortString:
          if (pos + 2 > buffer.length) return null;
          values.push({ kind: 'string', id: buffer.readUInt16LE(pos) });
          pos += 2;
          break;
        case Tag.ByteStringOrUndefined:
          if (layout === 'shaped') {
            values.push({ kind: 'undefined' });
            break;
          }
          if (pos + 1 > buffer.length) return null;
          values.push({ kind: 'string', id: buffer[pos] });
          pos += 1;
          break;
        case Tag.Integer:
          if (pos + 4 > buffer.length) return null;
          values.push({ kind: 'int', value: buffer.readInt32LE(pos) });
          pos += 4;
          break;
        default:
          return null;
      }
    }
  }
  return values;
}

/**
 * One literal as text, string ids resolved through the dump's string table
 * (an unknown id fails closed). Doubles keep their exact bits in
 * the text so -0 and 0, or two NaNs, never collide by accident.
 */
export function renderLiteral(
  value: LiteralValue,
  strings: Map<number, string>,
): string {
  switch (value.kind) {
    case 'null':
    case 'true':
    case 'false':
    case 'undefined':
      return value.kind;
    case 'int':
      return `[int ${value.value}]`;
    case 'number': {
      const bits = Buffer.alloc(8);
      bits.writeDoubleLE(value.value);
      return `[double ${Object.is(value.value, -0) ? '-0' : String(value.value)}#${bits.toString('hex')}]`;
    }
    case 'string': {
      const text = strings.get(value.id);
      if (text === undefined)
        throw new Error(`unresolved string id ${value.id}`);
      return `[String ${JSON.stringify(text)}]`;
    }
  }
}

/**
 * Decodes the literals an instruction refers to, for one side of a compare.
 * Returns rendered entries, or null when the offset cannot be decoded.
 */
export class LiteralResolver {
  constructor(
    private readonly buffers: LiteralBuffers,
    private readonly strings: Map<number, string>,
  ) {}

  private decode(
    buffer: Buffer,
    offset: number,
    count: number,
  ): string[] | null {
    const values = decodeSerializedLiterals(
      buffer,
      offset,
      count,
      this.buffers.layout,
    );
    return values ? values.map((v) => renderLiteral(v, this.strings)) : null;
  }

  get layout(): LiteralBuffers['layout'] {
    return this.buffers.layout;
  }

  array(offset: number, count: number): string[] | null {
    const b = this.buffers;
    return this.decode(
      b.layout === 'split' ? b.array : b.values,
      offset,
      count,
    );
  }

  objectKeys(offset: number, count: number): string[] | null {
    return this.decode(this.buffers.objectKeys, offset, count);
  }

  objectValues(offset: number, count: number): string[] | null {
    const b = this.buffers;
    return this.decode(
      b.layout === 'split' ? b.objectValues : b.values,
      offset,
      count,
    );
  }

  /** Shape table entry (HBC v98); null out of range or in the split layout. */
  shape(index: number): { keyOffset: number; count: number } | null {
    const b = this.buffers;
    if (b.layout !== 'shaped' || !Number.isSafeInteger(index) || index < 0)
      return null;
    const at = index * SHAPE_ENTRY_SIZE;
    if (at + SHAPE_ENTRY_SIZE > b.shapes.length) return null;
    return {
      keyOffset: b.shapes.readUInt32LE(at),
      count: b.shapes.readUInt32LE(at + 4),
    };
  }
}
