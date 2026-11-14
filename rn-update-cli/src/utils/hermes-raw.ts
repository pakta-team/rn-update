/**
 * [INPUT]: 依赖 HBC 布局解析、Hermes 原始反汇编与二进制文件数据
 * [OUTPUT]: 对外提供完整 HBC 语义数据读取、原始操作数校验与双文件等价审计
 * [POS]: CLI Hermes base 的无损语义验证层，补足 pretty dump 无法表达的字符串、常量、函数引用与控制流
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

/**
 * Lossless operand audit accompanying the human-readable Hermes comparison.
 * Pretty disassembly truncates strings and BigInts, prints function names in
 * place of IDs, and renders -0 as 0. Never use those spellings as identities.
 *
 * The raw dump supplies instruction/operand boundaries; referenced data and
 * doubles come from the HBC itself. Bytecode layouts are intentionally bounded
 * to the layouts already supported by hbcTransform. Unknown data fails closed.
 */

import { readFile } from 'node:fs/promises';
import { StringDecoder } from 'node:string_decoder';
import { spawn } from 'child_process';
import { resolveHbcSections } from './hbcTransform';
import { type LiteralBuffers, LiteralResolver } from './hermes-literals';

export class UnverifiableHermesBytecode extends Error {}

/** Fail closed on missing references rather than comparing equal placeholders. */
function requireValue<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) {
    throw new UnverifiableHermesBytecode(what);
  }
  return value;
}

/** Bound a reference to its owning section before creating a zero-copy view. */
function checkedSlice(data: Buffer, start: number, length: number): Buffer {
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(length) ||
    start < 0 ||
    length < 0 ||
    start + length > data.length
  ) {
    throw new UnverifiableHermesBytecode('HBC reference outside its section');
  }
  return data.subarray(start, start + length);
}

interface FunctionData {
  offset: number;
  size: number;
  metadata: string;
}

export interface HermesSemanticData {
  bytes: Buffer;
  version: number;
  strings: Map<number, string>;
  functions: FunctionData[];
  bigints: Buffer[];
  regexps: Buffer[];
  metadata: string;
}

/** Read exact strings (including UTF-16 code units) and function identities. */
export async function readHermesSemanticData(
  file: string,
): Promise<HermesSemanticData> {
  return hermesSemanticData(await readFile(file));
}

/** {@link readHermesSemanticData} for HBC bytes already in memory. */
export function hermesSemanticData(bytes: Buffer): HermesSemanticData {
  const resolved = requireValue(
    resolveHbcSections(bytes, bytes.length),
    'unsupported or unreadable HBC layout',
  );
  // A newly added diff-transform layout must not silently opt into semantic
  // parsing: function header and operand schemas need an independent review.
  if (
    !(
      (resolved.version >= 87 && resolved.version <= 96) ||
      resolved.version === 98 ||
      resolved.version === 99
    )
  ) {
    throw new UnverifiableHermesBytecode('unsupported semantic HBC version');
  }
  const { layout } = resolved;
  const section = (name: string) => {
    const r = requireValue(resolved.sections.get(name), `missing ${name}`);
    return checkedSlice(bytes, r.start, r.size);
  };
  const strings = new Map<number, string>();
  const small = section('smallStringTable');
  const overflow = section('overflowStringTable');
  const storage = section('stringStorage');
  for (let at = 0; at < small.length; at += 4) {
    const word = small.readUInt32LE(at);
    const utf16 = (word & 1) !== 0;
    let offset = (word >>> 1) & 0x7fffff;
    let length = word >>> 24;
    if (length === 255) {
      const entry = checkedSlice(overflow, offset * 8, 8);
      offset = entry.readUInt32LE(0);
      length = entry.readUInt32LE(4);
    }
    const value = checkedSlice(storage, offset, length * (utf16 ? 2 : 1));
    strings.set(at / 4, value.toString(utf16 ? 'utf16le' : 'latin1'));
  }
  const string = (id: number) =>
    requireValue(strings.get(id), `unresolved string id ${id}`);
  // Audited v98 function schema: hermes-compiler 250829098.0.16/.17
  // (250829098 stable snapshot), NOT every static_h build reporting HBC 98.
  // Large headers: 37 bytes, flags[36]; small cache bits: 6/1/1. Upstream
  // 7193d4485beeb87cd7a3b6ca8b6b5d97a1a433c4 removed NumCacheNewObject
  // without immediately bumping HBC: 36 bytes/flags[35], cache bits 7/1.
  // hbcTransform's file-header variants do not distinguish that function
  // schema change. A compiler upgrade needs independent large/small fixtures;
  // do not infer either schema from numStringSwitchImms or HBC version alone.
  // Audited v99 function schema: hermes-compiler 260318099.0.4 (RN 0.88), the
  // first HBC bump after that removal, so it always has the 36-byte form.
  const shaped = resolved.version >= 98;
  const noCacheNewObject = resolved.version === 99;
  const largeSize = noCacheNewObject ? 36 : 37;
  const entrySize = shaped ? 12 : 16;
  const headers = section('functionHeaders');
  const functions: FunctionData[] = [];
  for (let at = 0; at < headers.length; at += entrySize) {
    const word0 = headers.readUInt32LE(at);
    const word1 = headers.readUInt32LE(at + 4);
    let flags = headers[at + entrySize - 1];
    let offset = word0 & 0x1ffffff;
    let size: number;
    let name: number;
    let fields: number[];
    if (flags & 0x20) {
      // SmallFuncHeader::getLargeHeaderOffset, classic and Static Hermes.
      const largeOffset = shaped
        ? ((word1 >>> 14) & 0xff) * 0x1000000 + offset
        : (headers.readUInt32LE(at + 8) & 0x1ffffff) * 0x10000 + offset;
      const large = checkedSlice(bytes, largeOffset, shaped ? largeSize : 31);
      offset = large.readUInt32LE(0);
      size = large.readUInt32LE(shaped ? 12 : 8);
      name = large.readUInt32LE(shaped ? 16 : 12);
      flags = large[shaped ? largeSize - 1 : 30];
      fields = shaped
        ? [4, 8, 20, 24, 28].map((p) => large.readUInt32LE(p))
        : [4, 20, 24].map((p) => large.readUInt32LE(p));
      fields.push(
        ...large.subarray(shaped ? 32 : 28, shaped ? largeSize - 1 : 30),
      );
    } else if (shaped) {
      size = word1 & 0x3fff;
      name = (word1 >>> 14) & 0xff;
      fields = [
        (word0 >>> 25) & 31,
        word0 >>> 30,
        (word1 >>> 22) & 31,
        word1 >>> 27,
        headers[at + 8],
        headers[at + 9],
        ...(noCacheNewObject
          ? [headers[at + 10] & 127, headers[at + 10] >>> 7]
          : [
              headers[at + 10] & 63,
              (headers[at + 10] >>> 6) & 1,
              headers[at + 10] >>> 7,
            ]),
      ];
    } else {
      size = word1 & 0x7fff;
      name = word1 >>> 15;
      fields = [
        word0 >>> 25,
        headers.readUInt32LE(at + 8) >>> 25,
        headers[at + 12],
        headers[at + 13],
        headers[at + 14],
      ];
    }
    checkedSlice(bytes, offset, size);
    functions.push({
      offset,
      size,
      // Debug presence and compact/overflow encoding are not runtime semantics.
      metadata: JSON.stringify([string(name), flags & ~0x30, fields]),
    });
  }
  const pairedStorage = (tableName: string, storageName: string) => {
    const table = section(tableName);
    const data = section(storageName);
    const entries: Buffer[] = [];
    for (let at = 0; at < table.length; at += 8) {
      entries.push(
        checkedSlice(data, table.readUInt32LE(at), table.readUInt32LE(at + 4)),
      );
    }
    return entries;
  };
  const counts = Object.fromEntries(
    layout.headerFields.map((name, i) => [
      name,
      bytes.readUInt32LE(32 + i * 4),
    ]),
  );
  const options = bytes[32 + layout.headerFields.length * 4];
  const moduleTable = section('cjsModuleTable');
  const modules: unknown[] = [];
  for (let at = 0; at < moduleTable.length; at += 8) {
    const id = moduleTable.readUInt32LE(at);
    modules.push([
      options & 2 ? id : string(id),
      moduleTable.readUInt32LE(at + 4),
    ]);
  }
  const sourceTable = section('functionSourceTable');
  const sources: unknown[] = [];
  for (let at = 0; at < sourceTable.length; at += 8) {
    sources.push([
      sourceTable.readUInt32LE(at),
      string(sourceTable.readUInt32LE(at + 4)),
    ]);
  }
  return {
    bytes,
    version: resolved.version,
    strings,
    functions,
    bigints: pairedStorage('bigIntTable', 'bigIntStorage'),
    regexps: pairedStorage('regExpTable', 'regExpStorage'),
    metadata: JSON.stringify([
      resolved.version,
      counts.globalCodeIndex,
      counts.segmentID,
      options,
      modules,
      sources,
    ]),
  };
}

const OPERAND_BYTES: Record<string, number> = {
  Reg8: 1,
  Reg32: 4,
  UInt8: 1,
  UInt16: 2,
  UInt32: 4,
  Addr8: 1,
  Addr32: 4,
  Imm32: 4,
  Double: 8,
};

// Zero-based string operand positions from BytecodeList.def, with the missing
// DefineOwnById annotation supplied explicitly. Keep classic and v98 variants.
const STRING_OPERANDS: Record<string, number[]> = {
  DeclareGlobalVar: [0],
  ThrowIfHasRestrictedGlobalProperty: [0],
  GetById: [3],
  GetByIdWithReceiver: [4],
  TryGetById: [3],
  PutById: [3],
  TryPutById: [3],
  PutNewOwnById: [2],
  PutNewOwnNEById: [2],
  PutByIdLoose: [3],
  PutByIdStrict: [3],
  TryPutByIdLoose: [3],
  TryPutByIdStrict: [3],
  DefineOwnById: [3],
  DelById: [2],
  LoadConstString: [1],
  CreatePrivateName: [1],
  CreateRegExp: [1, 2],
};

interface RawInstruction {
  offset: number;
  opcode: string;
  operands: { type: string; value: number; bits?: string }[];
  size: number;
}

/** Remove encoding-width suffixes; operand values remain part of the audit. */
/** The opcode without its operand-width suffix (`GetByIdLong` → `GetById`). */
export function foldWidthSuffix(opcode: string): string {
  for (const suffix of ['LongIndex', 'Long', 'Short']) {
    if (opcode.length > suffix.length && opcode.endsWith(suffix)) {
      return opcode.slice(0, -suffix.length);
    }
  }
  return opcode;
}

/** The first line of a function in either dump. */
export function isFunctionHeader(line: string): boolean {
  return /^(?:Function|NCFunction|Constructor)</.test(line);
}

/**
 * Read raw operand boundaries and verify integer values against the HBC bytes.
 * Doubles use their exact bits, not the rounded number printed by hermesc.
 */
function parseRawInstruction(
  line: string,
  data: HermesSemanticData,
  fn: FunctionData,
): RawInstruction {
  const m = /^\[@ (\d+)\] ([A-Za-z][A-Za-z0-9]*)(.*)$/.exec(line);
  if (!m)
    throw new UnverifiableHermesBytecode(
      `unrecognized raw instruction: ${line.slice(0, 100)}`,
    );
  const offset = Number(m[1]);
  let size = 1;
  const operands =
    m[3].trim() === ''
      ? []
      : m[3]
          .trim()
          .split(/,\s*/)
          .map((text) => {
            const operand = /^([^<>]+)<([A-Za-z0-9]+)>$/.exec(text);
            if (!operand || !Object.hasOwn(OPERAND_BYTES, operand[2])) {
              throw new UnverifiableHermesBytecode(
                `unknown raw operand: ${text}`,
              );
            }
            const type = operand[2];
            const width = OPERAND_BYTES[type];
            const raw = checkedSlice(
              checkedSlice(data.bytes, fn.offset, fn.size),
              offset + size,
              width,
            );
            size += width;
            // Raw dump doubles are also rounded! Compare the actual IEEE-754 bits.
            if (type === 'Double')
              return { type, value: 0, bits: raw.toString('hex') };
            const value = Number(operand[1]);
            const binaryValue =
              type === 'Addr8'
                ? raw.readInt8(0)
                : type === 'Addr32' || type === 'Imm32'
                  ? raw.readInt32LE(0)
                  : width === 1
                    ? raw.readUInt8(0)
                    : width === 2
                      ? raw.readUInt16LE(0)
                      : raw.readUInt32LE(0);
            if (!Number.isSafeInteger(value) || value !== binaryValue) {
              throw new UnverifiableHermesBytecode(
                'raw operand does not match the HBC bytes',
              );
            }
            return { type, value };
          });
  return { offset, opcode: m[2], operands, size };
}

/** Canonicalize one complete function; addresses become instruction ordinals. */
export function normalizeRawHermesFunction(
  lines: string[],
  data: HermesSemanticData,
  functionIndex: number,
  buffers: LiteralBuffers,
): string[] {
  const fn = requireValue(
    data.functions[functionIndex],
    'function index outside HBC table',
  );
  const instructions = lines
    .filter((line) => line.startsWith('[@ '))
    .map((line) => parseRawInstruction(line, data, fn));
  const targets = new Map<number, number>();
  let end = 0;
  for (const [index, inst] of instructions.entries()) {
    if (inst.offset !== end)
      throw new UnverifiableHermesBytecode(
        'incomplete or unordered raw instruction stream',
      );
    targets.set(inst.offset, index);
    end += inst.size;
  }
  // Static Hermes retains legal zero-byte (dead) functions in the table.
  // Their metadata is still audited, and the raw reader still requires every
  // function header. Only a body shorter/longer than its declared size fails.
  if (end !== fn.size) {
    throw new UnverifiableHermesBytecode(
      'raw dump ended before the function body',
    );
  }
  const target = (offset: number) =>
    requireValue(
      targets.get(offset),
      `branch target ${offset} is not an instruction`,
    );
  const string = (id: number) =>
    requireValue(data.strings.get(id), `unresolved string id ${id}`);
  const literal = new LiteralResolver(buffers, data.strings);
  const output = [fn.metadata];
  for (const inst of instructions) {
    const op = foldWidthSuffix(inst.opcode);
    const values = inst.operands.map((o) => o.value);
    const refs = STRING_OPERANDS[op] ?? [];
    const operands: unknown[] = inst.operands.map((operand, i) => {
      if (refs.includes(i)) return ['string', string(operand.value)];
      if (operand.type.startsWith('Addr'))
        return ['target', target(inst.offset + operand.value)];
      if (operand.type === 'Double') return ['double', operand.bits];
      return [
        operand.type.startsWith('Reg') ? 'register' : 'integer',
        operand.value,
      ];
    });
    if (op === 'LoadConstBigInt') {
      operands[1] = [
        'bigint',
        requireValue(data.bigints[values[1]], 'unresolved BigInt').toString(
          'hex',
        ),
      ];
    } else if (op === 'CreateRegExp') {
      operands[3] = [
        'regexp',
        requireValue(data.regexps[values[3]], 'unresolved RegExp').toString(
          'hex',
        ),
      ];
    } else if (op === 'NewArrayWithBuffer') {
      if (values.length !== 4)
        throw new UnverifiableHermesBytecode('unknown array buffer operands');
      operands[3] = requireValue(
        literal.array(values[3], values[2]),
        'undecodable array literal',
      );
    } else if (
      op === 'NewObjectWithBuffer' ||
      op === 'NewObjectWithBufferAndParent'
    ) {
      if (buffers.layout === 'split') {
        if (values.length !== 5 || op !== 'NewObjectWithBuffer')
          throw new UnverifiableHermesBytecode('unknown split object operands');
        operands[3] = requireValue(
          literal.objectKeys(values[3], values[2]),
          'undecodable object keys',
        );
        operands[4] = requireValue(
          literal.objectValues(values[4], values[2]),
          'undecodable object values',
        );
      } else {
        const shapeAt = op === 'NewObjectWithBufferAndParent' ? 2 : 1;
        if (values.length !== shapeAt + 2)
          throw new UnverifiableHermesBytecode(
            'unknown shaped object operands',
          );
        const shape = requireValue(
          literal.shape(values[shapeAt]),
          'unknown object shape',
        );
        operands[shapeAt] = requireValue(
          literal.objectKeys(shape.keyOffset, shape.count),
          'undecodable shape keys',
        );
        operands[shapeAt + 1] = requireValue(
          literal.objectValues(values[shapeAt + 1], shape.count),
          'undecodable shape values',
        );
      }
    } else if (op === 'NewTypedObjectWithBuffer') {
      // HBC v99 typed-mode buffer user; its literal operands are not decoded.
      throw new UnverifiableHermesBytecode('typed object literal buffer');
    } else if (op === 'CacheNewObject') {
      if (buffers.layout !== 'shaped' || values.length !== 4) {
        throw new UnverifiableHermesBytecode('unknown cached object operands');
      }
      const shape = requireValue(
        literal.shape(values[2]),
        'unknown cached object shape',
      );
      operands[2] = requireValue(
        literal.objectKeys(shape.keyOffset, shape.count),
        'undecodable cached object keys',
      );
    } else if (
      op === 'UIntSwitchImm' ||
      op === 'SwitchImm' ||
      op === 'StringSwitchImm'
    ) {
      const strings = op === 'StringSwitchImm';
      const tableAt = strings ? 2 : 1;
      const count = strings ? values[4] : values[4] - values[3] + 1;
      // The table offset is relative to the instruction, rounded up to 4-byte alignment.
      const start =
        Math.ceil((fn.offset + inst.offset + values[tableAt]) / 4) * 4;
      const table = checkedSlice(data.bytes, start, count * (strings ? 8 : 4));
      const entries: unknown[] = [];
      for (let i = 0; i < count; i++) {
        const at = i * (strings ? 8 : 4);
        entries.push([
          strings ? string(table.readUInt32LE(at)) : values[3] + i,
          target(inst.offset + table.readInt32LE(at + (strings ? 4 : 0))),
        ]);
      }
      operands[tableAt] = entries;
    }
    output.push(JSON.stringify([op, operands]));
  }
  return output;
}

export interface RawAuditResult {
  status: 'equivalent' | 'different' | 'dump-failed';
  detail?: string;
}

/** Decode split UTF-8 sequences without buffering the whole raw dump. */
async function* linesOf(stream: NodeJS.ReadableStream): AsyncGenerator<string> {
  const decoder = new StringDecoder('utf8');
  let rest = '';
  for await (const chunk of stream as AsyncIterable<Buffer>) {
    rest += decoder.write(chunk);
    let at = rest.indexOf('\n');
    while (at >= 0) {
      yield rest.slice(0, at).replace(/\r$/, '');
      rest = rest.slice(at + 1);
      at = rest.indexOf('\n');
    }
  }
  rest += decoder.end();
  if (rest) yield rest;
}

/**
 * Audit a pair of raw dumps while retaining one function per side plus HBC data.
 * Cancellation/errors fail closed; both subprocesses are terminated and reaped.
 */
export async function auditRawHermesBytecode(
  command: string,
  files: [string, string],
  data: [HermesSemanticData, HermesSemanticData],
  buffers: [LiteralBuffers, LiteralBuffers],
  signal: AbortSignal,
): Promise<RawAuditResult> {
  if (data[0].metadata !== data[1].metadata)
    return { status: 'different', detail: 'HBC runtime metadata differs' };
  const children = files.map((file) =>
    spawn(
      command,
      ['-b', '-dump-bytecode', '-pretty-disassemble=false', file],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
        signal,
        killSignal: 'SIGKILL',
      },
    ),
  );
  const exits = children.map(
    (child) =>
      new Promise<string | null>((resolve) => {
        let stderr = '';
        let processError: Error | undefined;
        child.stderr?.on('data', (chunk: Buffer) => {
          stderr = (stderr + chunk.toString()).slice(-4096);
        });
        child.once('error', (error) => {
          child.stdout?.destroy();
          processError = error;
          if (!child.pid) resolve(error.message);
        });
        child.once('close', (code, reason) =>
          resolve(
            processError
              ? processError.message
              : code === 0
                ? null
                : `${reason ?? `exit ${code}`}: ${stderr.trim().slice(-300)}`,
          ),
        );
      }),
  );
  const functions = async function* (side: number): AsyncGenerator<string[]> {
    let lines: string[] | null = null;
    let index = 0;
    const normalize = (body: string[]) =>
      normalizeRawHermesFunction(body, data[side], index++, buffers[side]);
    for await (const line of linesOf(children[side].stdout!)) {
      if (isFunctionHeader(line)) {
        if (lines) yield normalize(lines);
        lines = [];
      } else if (
        /^(?:RegExp Bytecodes:|Debug |Textified callees table)/.test(line)
      ) {
        if (lines) yield normalize(lines);
        lines = null;
      } else if (lines) {
        lines.push(line);
      }
    }
    if (lines) yield normalize(lines);
    const error = await exits[side];
    if (error)
      throw new UnverifiableHermesBytecode(
        `${side === 0 ? 'base' : 'plain'} raw dump: ${error}`,
      );
    if (index !== data[side].functions.length)
      throw new UnverifiableHermesBytecode(
        'raw dump function count does not match HBC header',
      );
  };
  const a = functions(0);
  const b = functions(1);
  let index = 0;
  try {
    for (;;) {
      const [left, right] = await Promise.all([a.next(), b.next()]);
      if (left.done || right.done) {
        return left.done && right.done
          ? { status: 'equivalent' }
          : { status: 'different', detail: 'raw function counts differ' };
      }
      const length = Math.max(left.value.length, right.value.length);
      for (let i = 0; i < length; i++) {
        if (left.value[i] !== right.value[i]) {
          return {
            status: 'different',
            detail: `function #${index}, raw instruction ${i}: ${left.value[i]?.slice(0, 150)} vs ${right.value[i]?.slice(0, 150)}`,
          };
        }
      }
      index++;
    }
  } catch (error) {
    return {
      status: 'dump-failed',
      detail: error instanceof Error ? error.message : String(error),
    };
  } finally {
    for (const child of children) {
      child.stdout?.destroy();
      child.kill('SIGKILL');
    }
    await Promise.all(exits);
  }
}
