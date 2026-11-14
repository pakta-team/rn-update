/**
 * [INPUT]: 依赖真实 hermesc、随机 JavaScript 生成器、@babel/parser 字面量解析、failureFingerprint 指纹与 hermesFuzzSucceeded 判定
 * [OUTPUT]: 对外提供 Hermes base 等价校验的可复现模糊测试脚本与失败现场
 * [POS]: CLI 测试工具层，验证归一化规则不会误杀等价构建或漏报植入差异
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/**
 * Differential fuzzing of the Hermes base equivalence check.
 *
 * Generates random JS programs, compiles each one twice with a real hermesc —
 * plain, and against a randomly chosen base (another program, or a mutated
 * copy of the same one) — and runs `compareHermesBytecode` on the pair. Both
 * builds come from the same source, so every `different` is either a
 * normalization gap in the check (a false rejection: fix by adding a rule to
 * `normalizeDisassemblyLine` + a unit test) or a real hermesc delta-mode bug
 * (report upstream; record it in docs/hermes-base-verification.md §3).
 *
 * Every tenth round and the final round also plant a one-literal change into
 * the delta build and assert the check still catches it, so a rule that folds
 * too much shows up here as well. Success requires all requested comparisons,
 * zero compilation failures and at least one effective planted difference.
 *
 *   HERMESC=<path> bun scripts/fuzz-hermes-base.ts [--rounds N] [--seed S]
 *                                                  [--out DIR] [--verbose]
 *
 * hermesc discovery without HERMESC follows tests/hermes-base.test.ts. Failing
 * cases (both sources, all three HBC files) are kept under --out
 * (default: a fresh temp dir, printed at the end); passing cases are deleted.
 * Exit code: 0 when every round was equivalent and every planted change was
 * caught with useful coverage, 1 otherwise; invalid arguments exit 2.
 */
import { spawnSync } from 'node:child_process';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { failureFingerprint } from '../src/utils/failure-fingerprint';
import { compareHermesBytecode } from '../src/utils/hermes-base';
import { fuzzStringLiterals } from './hermes-fuzz-literals';
import { hermesFuzzSucceeded } from './hermes-fuzz-result';

// ---------------------------------------------------------------------------
// arguments
// ---------------------------------------------------------------------------

/** Read a flag's next token; undefined alone does not imply flag omission. */
function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0) return undefined;
  return process.argv[index + 1];
}

// Only an omitted flag uses the default; a missing value becomes NaN.
const ROUNDS = Number(
  process.argv.includes('--rounds') ? argValue('rounds') : 200,
);
if (!Number.isSafeInteger(ROUNDS) || ROUNDS <= 0) {
  console.error('--rounds must be a positive safe integer');
  process.exit(2);
}
const SEED = Number(argValue('seed') ?? Date.now() % 2 ** 31);
const VERBOSE = process.argv.includes('--verbose');
const OUT_DIR =
  argValue('out') ?? fs.mkdtempSync(path.join(os.tmpdir(), 'rnu-fuzz-hermes-'));

const HERMESC_CANDIDATES = [
  '../../rn-update/node_modules/react-native/sdks/hermesc/linux64-bin/hermesc',
  '../../rn-update/node_modules/react-native/sdks/hermesc/osx-bin/hermesc',
  '../../rn-update/Example/testHotUpdate/node_modules/hermes-compiler/hermesc/osx-bin/hermesc',
].map((p) => path.resolve(__dirname, p));
const hermesc =
  process.env.HERMESC || HERMESC_CANDIDATES.find((p) => fs.existsSync(p));
if (!hermesc || !fs.existsSync(hermesc)) {
  console.error('hermesc not found: set HERMESC=<path to hermesc>');
  process.exit(2);
}

// ---------------------------------------------------------------------------
// seeded random
// ---------------------------------------------------------------------------

class Rng {
  private state: number;
  constructor(seed: number) {
    this.state = seed >>> 0 || 1;
  }
  /** mulberry32 */
  next(): number {
    let t = (this.state += 0x6d2b79f5) >>> 0;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  int(maxExclusive: number): number {
    return Math.floor(this.next() * maxExclusive);
  }
  range(min: number, maxInclusive: number): number {
    return min + this.int(maxInclusive - min + 1);
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
  pick<T>(items: readonly T[]): T {
    return items[this.int(items.length)];
  }
}

// ---------------------------------------------------------------------------
// program generator
// ---------------------------------------------------------------------------

const WORDS = [
  'alpha',
  'beta',
  'gamma',
  'delta',
  'user',
  'item',
  'count',
  'total',
  'name',
  'value',
  'key',
  'node',
  'list',
  'map',
  'cache',
  'route',
  'state',
  'props',
  'render',
  'update',
  'fetch',
  'parse',
  'token',
  'index',
  'offset',
  'size',
  'width',
  'height',
  'color',
  'style',
  'label',
  'title',
  'text',
  'data',
  'result',
  'error',
  'config',
  'option',
  'flag',
  'mode',
  'type',
  'kind',
];
const RESERVED = new Set([
  'delete',
  'default',
  'export',
  'import',
  'switch',
  'return',
  'case',
  'class',
  'function',
  'const',
  'let',
  'var',
  'new',
  'this',
  'in',
]);

class Gen {
  private counter = 0;
  /** identifiers declared at top level so far (usable by later statements) */
  private globals: string[] = [];
  /** string literals used so far; reused to create shared table entries */
  private strings: string[] = [];

  constructor(private rng: Rng) {}

  private ident(): string {
    let name = `${this.rng.pick(WORDS)}${this.rng.chance(0.5) ? this.rng.pick(WORDS)[0].toUpperCase() + this.rng.pick(WORDS).slice(1) : ''}`;
    if (this.rng.chance(0.4)) name += this.rng.int(100);
    if (this.rng.chance(0.15)) name = `_${name}`;
    if (this.rng.chance(0.1)) name = `$${name}`;
    if (RESERVED.has(name)) name = `${name}_`;
    return name;
  }

  private newGlobal(): string {
    // unique: suffix by counter so redeclaration never shadows unexpectedly
    const name = `${this.ident()}_${this.counter++}`;
    this.globals.push(name);
    return name;
  }

  private stringLiteral(): string {
    if (this.strings.length > 0 && this.rng.chance(0.35)) {
      return this.rng.pick(this.strings);
    }
    let text: string;
    switch (this.rng.int(8)) {
      case 0:
        text = this.rng.pick(WORDS);
        break;
      case 1:
        text = `${this.rng.pick(WORDS)} ${this.rng.pick(WORDS)} ${this.rng.int(1000)}`;
        break;
      case 2:
        text = ''; // empty string
        break;
      case 3:
        text = `${this.rng.pick(WORDS)}\\n\\t\\"quoted\\"`;
        break;
      case 4:
        text = `中文${this.rng.int(100)}字符串`;
        break;
      case 5:
        text = `emoji😀${this.rng.int(10)}`;
        break;
      case 6:
        text = 'x'.repeat(this.rng.range(1, 300));
        break;
      default:
        text = `${this.rng.pick(WORDS)}-${this.rng.pick(WORDS)}.${this.rng.pick(WORDS)}`;
    }
    const literal = this.rng.chance(0.5) ? `"${text}"` : `'${text}'`;
    this.strings.push(literal);
    return literal;
  }

  private numberLiteral(): string {
    switch (this.rng.int(7)) {
      case 0:
        return String(this.rng.int(10));
      case 1:
        return String(this.rng.int(1 << 20));
      case 2:
        return `${this.rng.int(1000)}.${this.rng.int(1000)}`;
      case 3:
        return `-${this.rng.int(500)}`;
      case 4:
        return `0x${this.rng.int(0xffffff).toString(16)}`;
      case 5:
        return String(2 ** this.rng.range(31, 52));
      default:
        return this.rng.pick(['NaN', 'Infinity', '-0', '0', '1e21', '1.5e-7']);
    }
  }

  private primitive(): string {
    switch (this.rng.int(5)) {
      case 0:
      case 1:
        return this.stringLiteral();
      case 2:
        return this.numberLiteral();
      case 3:
        return this.rng.pick(['true', 'false']);
      default:
        return this.rng.pick(['null', 'undefined']);
    }
  }

  private propertyKey(): string {
    switch (this.rng.int(6)) {
      case 0:
        return String(this.rng.int(50)); // numeric key
      case 1:
        return this.stringLiteral(); // quoted key
      case 2:
        return `[${this.stringLiteral()}]`; // computed key (constant)
      default:
        return this.ident();
    }
  }

  /** literal array/object, nested to `depth`; the delta build re-lays these buffers */
  private literal(depth: number): string {
    if (depth <= 0 || this.rng.chance(0.3)) return this.primitive();
    if (this.rng.chance(0.5)) {
      const count = this.rng.range(0, 24);
      const items: string[] = [];
      for (let i = 0; i < count; i++) items.push(this.literal(depth - 1));
      if (this.rng.chance(0.2)) items.push(''); // hole
      return `[${items.join(', ')}]`;
    }
    const count = this.rng.range(0, 16);
    const seen = new Set<string>();
    const entries: string[] = [];
    for (let i = 0; i < count; i++) {
      const key = this.propertyKey();
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push(`${key}: ${this.literal(depth - 1)}`);
    }
    if (this.rng.chance(0.15)) {
      entries.push(
        `get ${this.ident()}() { return ${this.primitive()}; }`,
        `method${this.rng.int(10)}(a) { return a + ${this.primitive()}; }`,
      );
    }
    if (this.rng.chance(0.1)) entries.push(`__proto__: null`);
    return `{${entries.join(', ')}}`;
  }

  /** an expression over the given in-scope names, depth limited */
  private expr(scope: string[], depth: number): string {
    const leaf = () =>
      scope.length > 0 && this.rng.chance(0.6)
        ? this.rng.pick(scope)
        : this.primitive();
    if (depth <= 0) return leaf();
    switch (this.rng.int(16)) {
      case 0:
        return `(${this.expr(scope, depth - 1)} ${this.rng.pick(['+', '-', '*', '/', '%', '<', '===', '!==', '&&', '||', '??', '|', '&', '<<', '>>>'])} ${this.expr(scope, depth - 1)})`;
      case 1:
        return `(${leaf()}).${this.ident()}`;
      case 2:
        return `(${leaf()})[${this.stringLiteral()}]`;
      case 3:
        return `(${leaf()})[${this.numberLiteral()}]`;
      case 4:
        // parenthesized: hermesc's lexer reads a `/` right after a template
        // literal as the start of a regex (a hermesc quirk, not a check result)
        return `(\`${this.rng.pick(WORDS)} \${${this.expr(scope, depth - 1)}} ${this.rng.pick(WORDS)} \${${leaf()}}\`)`;
      case 5:
        return `/${this.rng.pick(['[a-z]+', '\\d{2,4}', '^foo(bar)?$', '(?:a|b)*c', '[\\u4e00-\\u9fa5]+', 'x*y+'])}/${this.rng.pick(['', 'g', 'i', 'gi', 'u', 'm'])}.test(String(${leaf()}))`;
      case 6:
        return `typeof ${leaf()}`;
      case 7:
        return `(${this.expr(scope, depth - 1)} ? ${this.expr(scope, depth - 1)} : ${this.expr(scope, depth - 1)})`;
      case 8:
        return `((${this.ident()}) => (${this.expr(scope, depth - 1)}))(${leaf()})`;
      case 9:
        return `(${this.stringLiteral()} in Object(${leaf()}))`;
      case 10:
        return `[${leaf()}, ...[${this.literal(1)}]].length`;
      case 11:
        return `String(${leaf()}).${this.rng.pick(['length', 'toUpperCase()', 'trim()', 'split("-").length', 'indexOf("a")', 'slice(1, 3)'])}`;
      case 12:
        return `!${leaf()}`;
      case 13:
        return `(${leaf()} instanceof Object)`;
      case 14:
        return this.literal(2);
      default:
        return leaf();
    }
  }

  private block(scope: string[], depth: number): string {
    const lines: string[] = [];
    const locals = [...scope];
    const count = this.rng.range(1, 5);
    for (let i = 0; i < count; i++) {
      lines.push(this.statement(locals, depth - 1));
    }
    return lines.join('\n');
  }

  private statement(scope: string[], depth: number): string {
    const out = (e: string) => `print(${e});`;
    if (depth <= 0) return out(this.expr(scope, 1));
    switch (this.rng.int(14)) {
      case 0: {
        const name = `${this.ident()}L${this.counter++}`;
        scope.push(name);
        return `${this.rng.pick(['var', 'let'])} ${name} = ${this.expr(scope, 2)};`;
      }
      case 1: {
        // integer switch (UIntSwitchImm when dense)
        const cases = this.rng.range(2, 9);
        let s = `switch (${this.expr(scope, 1)} | 0) {\n`;
        for (let i = 0; i < cases; i++) {
          s += `case ${i}: ${out(this.stringLiteral())} ${this.rng.chance(0.7) ? 'break;' : ''}\n`;
        }
        if (this.rng.chance(0.7)) s += `default: ${out(this.primitive())}\n`;
        return `${s}}`;
      }
      case 2: {
        // string switch (StringSwitchImm)
        const cases = this.rng.range(2, 8);
        let s = `switch (String(${this.expr(scope, 1)})) {\n`;
        const used = new Set<string>();
        for (let i = 0; i < cases; i++) {
          const lit = this.stringLiteral();
          if (used.has(lit)) continue;
          used.add(lit);
          s += `case ${lit}: ${out(this.numberLiteral())} break;\n`;
        }
        s += `default: ${out(this.primitive())}\n`;
        return `${s}}`;
      }
      case 3: {
        const e = `${this.ident()}E`;
        return `try {\n${this.block(scope, depth)}\n} catch (${e}) {\n${out(`${this.stringLiteral()} + ${e}`)}\n}${this.rng.chance(0.4) ? ` finally {\n${out(this.stringLiteral())}\n}` : ''}`;
      }
      case 4: {
        const it = `i${this.counter++}`;
        return `for (var ${it} = 0; ${it} < ${this.rng.range(1, 20)}; ${it}++) {\n${this.block([...scope, it], depth)}\n${this.rng.chance(0.3) ? `if (${it} > ${this.rng.int(10)}) break;` : ''}\n}`;
      }
      case 5:
        return `if (${this.expr(scope, 2)}) {\n${this.block(scope, depth)}\n}${this.rng.chance(0.5) ? ` else {\n${this.block(scope, depth)}\n}` : ''}`;
      case 6: {
        // closure with captured mutable state
        const fn = `closure${this.counter++}`;
        const c = `c${this.counter++}`;
        return `function ${fn}() {\nvar ${c} = ${this.numberLiteral()};\nreturn function (${this.ident()}A) {\n${c} = ${c} + 1;\n${this.block([...scope, c], depth)}\nreturn ${c} + ${this.stringLiteral()};\n};\n}\n${out(`${fn}()(${this.expr(scope, 1)})`)}`;
      }
      case 7: {
        // a class as Babel emits it for classic Hermes (no native `class`):
        // constructor function, prototype methods, static, defineProperty getter
        const cls = `Cls${this.counter++}`;
        const param = `${this.ident()}P`;
        const method = `${this.ident()}M`;
        return `function ${cls}(${param}) {\nthis.${this.ident()} = ${param};\nthis[${this.stringLiteral()}] = ${this.literal(2)};\n}\n${cls}.prototype.${method} = function (x) {\n${this.block([...scope, 'x'], depth)}\nreturn this;\n};\n${cls}.${this.ident()}S = function () { return ${this.literal(1)}; };\nObject.defineProperty(${cls}.prototype, ${this.stringLiteral()}, { get: function () { return ${this.expr(scope, 1)}; }, configurable: true });\n${out(`new ${cls}(${this.expr(scope, 1)}).${method}(${this.primitive()})`)}`;
      }
      case 8: {
        // property writes on a fresh object (DefineOwnById / PutById)
        const o = `obj${this.counter++}`;
        let s = `var ${o} = ${this.literal(1)};\n`;
        const writes = this.rng.range(1, 12);
        for (let i = 0; i < writes; i++) {
          s += `${o}.${this.ident()} = ${this.expr([...scope, o], 1)};\n`;
        }
        if (this.rng.chance(0.3)) s += `delete ${o}.${this.ident()};\n`;
        scope.push(o);
        return `${s}${out(`JSON.stringify(${o})`)}`;
      }
      case 9: {
        // function with many params/locals (register pressure)
        const fn = `fn${this.counter++}`;
        const params = Array.from(
          { length: this.rng.range(0, 8) },
          (_, i) => `p${i}`,
        );
        return `function ${fn}(${params.join(', ')}) {\n${this.block([...scope, ...params], depth)}\nreturn ${this.expr([...scope, ...params], 2)};\n}\n${out(`${fn}(${params.map(() => this.expr(scope, 1)).join(', ')})`)}`;
      }
      case 10: {
        const w = `w${this.counter++}`;
        return `var ${w} = ${this.rng.range(0, 5)};\nwhile (${w} < ${this.rng.range(1, 8)}) {\n${w}++;\n${this.block([...scope, w], depth)}\n}`;
      }
      case 11: {
        // destructuring + spread
        const a = `d${this.counter++}`;
        const b = `d${this.counter++}`;
        scope.push(a, b);
        return `var { ${this.ident()}: ${a} = ${this.primitive()}, ...${b} } = Object(${this.expr(scope, 1)});\n${out(`[${a}, ${b}]`)}`;
      }
      case 12:
        return `${this.rng.pick(scope.length ? scope : ['print'])}${this.rng.chance(0.5) ? `.${this.ident()}` : ''} = ${this.expr(scope, 2)};`;
      default:
        return out(this.expr(scope, 3));
    }
  }

  program(): string {
    this.globals = [];
    this.strings = [];
    const lines: string[] = this.rng.chance(0.3) ? ['"use strict";'] : [];
    const declarations = this.rng.range(8, 40);
    for (let i = 0; i < declarations; i++) {
      const name = this.newGlobal();
      lines.push(`var ${name} = ${this.literal(3)};`);
    }
    const statements = this.rng.range(10, 60);
    for (let i = 0; i < statements; i++) {
      lines.push(this.statement([...this.globals], 3));
    }
    // keep everything reachable so -O cannot drop it
    lines.push(`print(${this.globals.join(', ')});`);
    return `${lines.join('\n')}\n`;
  }

  /** a plausible "previous version" of `source`: a few small edits */
  mutate(source: string): string {
    let text = source;
    const edits = this.rng.range(1, 6);
    const lines = text.split('\n');
    for (let i = 0; i < edits; i++) {
      switch (this.rng.int(5)) {
        case 0: {
          // rename one global everywhere
          const m = /var ([A-Za-z_$][\w$]*_\d+) =/.exec(text);
          if (m) text = text.split(m[1]).join(`${m[1]}Old`);
          break;
        }
        case 1: {
          // A regex can match the gap after an escaped closing quote. Use
          // parser offsets and encode the replacement as one complete token.
          const literals = fuzzStringLiterals(text).filter(
            ({ value }) => value.length > 0 && value.length <= 40,
          );
          if (literals.length > 0) {
            const literal = this.rng.pick(literals);
            text =
              text.slice(0, literal.start) +
              JSON.stringify(`${literal.value}~`) +
              text.slice(literal.end);
          }
          break;
        }
        case 2: {
          // drop a line that is a complete simple statement
          const index = this.rng.int(lines.length);
          if (
            /^(print|var)\b.*;$/.test(lines[index]) &&
            !/^var [\w$]+ = \{?$/.test(lines[index])
          ) {
            lines.splice(index, 1);
            text = lines.join('\n');
          }
          break;
        }
        case 3:
          // add a statement at the end
          text += `print(${this.stringLiteral()}, ${this.numberLiteral()});\n`;
          break;
        default: {
          // change a number
          const m = /\b(\d{2,5})\b/.exec(text);
          if (m) text = text.replace(m[0], String(Number(m[1]) + 1));
        }
      }
    }
    return text;
  }

  /** identical to `source` except one string literal value — must be caught */
  /** `marker`: the new string, to tell whether it survived the optimizer */
  plantDifference(source: string): { source: string; marker: string } | null {
    const literals = fuzzStringLiterals(source).filter(({ value }) =>
      /^[A-Za-z]{3,20}$/.test(value),
    );
    if (literals.length === 0) return null;
    const target = this.rng.pick(literals);
    const marker = `${target.value}Z`;
    return {
      source:
        source.slice(0, target.start) +
        JSON.stringify(marker) +
        source.slice(target.end),
      marker,
    };
  }
}

// ---------------------------------------------------------------------------
// compile + compare
// ---------------------------------------------------------------------------

/** Compile a generated source, returning diagnostics on compiler failure. */
function compile(
  input: string,
  out: string,
  extra: string[] = [],
): string | null {
  const run = spawnSync(
    hermesc!,
    ['-emit-binary', '-out', out, input, '-O', '-w', ...extra],
    { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
  );
  if (run.status === 0) return null;
  return (run.stderr || run.stdout || `exit ${run.status}`).trim();
}

/**
 * Collapse ids/offsets/registers so one normalization gap counts once. This is
 * the same key the CLI reports and the server groups by: a finding here and
 * the same defect seen in the field have to land in one bucket, which they
 * only do while both sides call this one function.
 */
const dedupeKey = failureFingerprint;

interface Finding {
  key: string;
  detail: string;
  round: number;
  dir: string;
  count: number;
}

/** Run seeded comparisons and exit successfully only with effective coverage. */
async function main() {
  const rng = new Rng(SEED);
  const gen = new Gen(rng);
  fs.ensureDirSync(OUT_DIR);
  console.log(
    `fuzz-hermes-base: ${ROUNDS} rounds, seed ${SEED}, hermesc ${hermesc}, out ${OUT_DIR}`,
  );

  const pool: string[] = [];
  const findings = new Map<string, Finding>();
  let equivalent = 0;
  let dumpFailed = 0;
  let compileErrors = 0;
  let planted = 0;
  let plantedMissed = 0;
  let plantedFolded = 0;
  let plantedCompileErrors = 0;
  const started = Date.now();

  for (let round = 0; round < ROUNDS; round++) {
    const dir = path.join(OUT_DIR, `round-${String(round).padStart(4, '0')}`);
    fs.ensureDirSync(dir);
    const next = gen.program();
    const baseSource =
      pool.length > 0 && rng.chance(0.5) ? rng.pick(pool) : gen.mutate(next);
    pool.push(next);
    if (pool.length > 50) pool.shift();

    const nextJs = path.join(dir, 'next.js');
    const baseJs = path.join(dir, 'base.js');
    fs.writeFileSync(nextJs, next);
    fs.writeFileSync(baseJs, baseSource);
    const baseHbc = path.join(dir, 'base.hbc');
    const plainHbc = path.join(dir, 'next.plain.hbc');
    const deltaHbc = path.join(dir, 'next.delta.hbc');

    let keep = false;
    const error =
      compile(baseJs, baseHbc) ??
      compile(nextJs, plainHbc) ??
      compile(nextJs, deltaHbc, [`-base-bytecode=${baseHbc}`]);
    if (error) {
      // the generator produced something hermesc will not take: a generator
      // bug, not a check result — keep it so the generator can be fixed
      compileErrors++;
      fs.writeFileSync(path.join(dir, 'compile-error.txt'), error);
      console.log(`round ${round}: compile error (kept in ${dir})`);
      continue;
    }

    const outcome = await compareHermesBytecode(hermesc!, deltaHbc, plainHbc);
    if (outcome.status === 'equivalent') {
      equivalent++;
      if (VERBOSE)
        console.log(
          `round ${round}: equivalent (${outcome.functions} functions)`,
        );
    } else if (outcome.status === 'different') {
      keep = true;
      const key = dedupeKey(outcome.detail ?? '');
      const known = findings.get(key);
      if (known) known.count++;
      else
        findings.set(key, {
          key,
          detail: outcome.detail ?? '',
          round,
          dir,
          count: 1,
        });
      console.log(`round ${round}: DIFFERENT — ${outcome.detail}`);
    } else {
      keep = true;
      dumpFailed++;
      console.log(`round ${round}: dump failed — ${outcome.detail}`);
    }

    // Include the last round so even a short run attempts a negative case.
    if (round % 10 === 9 || round === ROUNDS - 1) {
      const wrong = gen.plantDifference(next);
      if (wrong) {
        const wrongJs = path.join(dir, 'wrong.js');
        const wrongHbc = path.join(dir, 'wrong.delta.hbc');
        fs.writeFileSync(wrongJs, wrong.source);
        const wrongError = compile(wrongJs, wrongHbc, [
          `-base-bytecode=${baseHbc}`,
        ]);
        if (wrongError) {
          plantedCompileErrors++;
          keep = true;
          fs.writeFileSync(
            path.join(dir, 'planted-compile-error.txt'),
            wrongError,
          );
          console.log(`round ${round}: planted compile error (kept in ${dir})`);
        } else {
          // The literal may sit in code the optimizer removes or folds
          // (`!'x'`, an unreachable switch case — Static Hermes folds far more
          // than classic hermesc). Then both builds are really equivalent and
          // the round tests nothing; the string storage tells, independently
          // of the check under test (ASCII strings are stored as is).
          if (!fs.readFileSync(wrongHbc).includes(wrong.marker)) {
            plantedFolded++;
            keep = true;
            if (VERBOSE) {
              console.log(
                `round ${round}: planted "${wrong.marker}" optimized away`,
              );
            }
          } else {
            planted++;
            const caught = await compareHermesBytecode(
              hermesc!,
              wrongHbc,
              plainHbc,
            );
            if (caught.status !== 'different') {
              plantedMissed++;
              keep = true;
              console.log(
                `round ${round}: PLANTED DIFFERENCE MISSED (${caught.status})`,
              );
            } else if (VERBOSE) {
              console.log(
                `round ${round}: planted difference caught — ${caught.detail}`,
              );
            }
          }
        }
      } else {
        // Keep the input to diagnose a run with no effective negative cases.
        keep = true;
      }
    }

    if (!keep) fs.removeSync(dir);
  }

  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  const different = [...findings.values()].reduce((n, f) => n + f.count, 0);
  console.log('');
  console.log(`rounds: ${ROUNDS} in ${seconds}s (seed ${SEED})`);
  console.log(`equivalent: ${equivalent}`);
  console.log(`different: ${different} (${findings.size} unique)`);
  console.log(`dump failed: ${dumpFailed}`);
  console.log(`compile errors (generator): ${compileErrors}`);
  console.log(`planted compile errors: ${plantedCompileErrors}`);
  console.log(
    `planted differences: ${planted}, missed: ${plantedMissed} (${plantedFolded} more optimized away, not counted)`,
  );
  if (planted === 0) {
    console.error(
      'No effective planted difference was checked; coverage is insufficient.',
    );
  }
  if (findings.size > 0) {
    console.log('');
    console.log('unique differences (first occurrence, reproduction dir):');
    for (const f of findings.values()) {
      console.log(`  ×${f.count}  round ${f.round}  ${f.dir}`);
      console.log(`       ${f.detail}`);
    }
  }
  const ok = hermesFuzzSucceeded({
    rounds: ROUNDS,
    equivalent,
    different,
    dumpFailed,
    compileErrors,
    planted,
    plantedMissed,
    plantedCompileErrors,
  });
  if (!ok) console.log(`\nfailing cases kept under ${OUT_DIR}`);
  else if (!argValue('out')) fs.removeSync(OUT_DIR);
  process.exit(ok ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
