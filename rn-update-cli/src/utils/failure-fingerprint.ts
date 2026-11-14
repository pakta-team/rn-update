/**
 * [INPUT]: 依赖 node:crypto 的 createHash 与字符串正则处理
 * [OUTPUT]: 对外提供 redactFailureDetail 脱敏、failureFingerprint 分组指纹
 * [POS]: src/utils 的唯一指纹实现，被 hermes-base 上报、fuzz 去重与回归测试共享
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

/**
 * One implementation of the failure fingerprint, shared by everything that
 * groups the same failure: the version/create report, the fuzzer's dedup of
 * its findings, and (later) the replay of the stored corpus. Two
 * implementations would mean the counts behind "how often does this happen"
 * are fiction, so callers import from here rather than writing their own
 * regexes.
 *
 * Redaction is the other half. A detail line carries whatever hermesc printed,
 * which is the user's own code: the first rejection seen in production named
 * the property `promotionRequestItemId`. Details travel to the server, into
 * issue lists and -- once the fix loop runs -- into public pull requests and CI
 * fixtures, so the identifiers are replaced by tokens *before* the report
 * leaves the machine. The local console keeps the unredacted text: that is
 * where the name is actually useful.
 */
import { sha256Hex as sha } from './hash';

/** stable stand-in for one redacted value; the same input always yields it */
const token = (kind: string, value: string) =>
  `${kind}#${sha(value).slice(0, 8)}`;

/**
 * Replace the parts of a detail line that can only come from the user's code:
 * quoted string operands (property names, string literals), function names,
 * and filesystem paths that reach the line through a compiler's stderr. What
 * stays is the shape a fix is reasoned about -- opcodes, registers, counts,
 * literal kinds -- plus each redacted value's length and character class.
 *
 * This is redaction by class, not a proof: it covers the shapes the comparison
 * and the compilers are known to emit. Anything that arrives in an unknown
 * shape still has its paths and quoted runs stripped, so a new detail format
 * cannot silently start leaking identifiers.
 */
export function redactFailureDetail(detail: string): string {
  return (
    detail
      // Paths first: a compiler's stderr reaches the line with them, and
      // running this pass after the others would eat the `/<length>` suffix
      // the string pass writes.
      .replace(/(?:\.{0,2}\/)[^\s:,)"']*/g, (path: string) => {
        const ext = /\.([A-Za-z0-9]+)$/.exec(path);
        return `${token('path', path)}${ext ? `.${ext[1]}` : ''}`;
      })
      // Function<name>(…) headers, including the raw-audit variants
      .replace(
        /\b(Function|NCFunction|Constructor)<([^>]*)>/g,
        (_all, kind: string, name: string) =>
          `${kind}<${name ? token('fn', name) : ''}>`,
      )
      // Quoted operands. hermesc does not escape quotes inside strings, so the
      // run is taken as-is up to the next quote; a stray tail keeps whatever
      // the earlier passes left rather than being reconstructed.
      .replace(/"([^"\n]*)"/g, (_all, value: string) => {
        const units = Array.from(value);
        const ascii = units.every((char) => char.charCodeAt(0) < 0x80);
        return `"${token('str', value)}/${units.length}${ascii ? '' : '/u16'}"`;
      })
  );
}

/**
 * The grouping key: a redacted detail with everything that varies between two
 * occurrences of the same defect removed -- registers, ids, offsets, labels,
 * counts and the redaction tokens themselves. Sixteen bytes; the server stores
 * it as 32 hex characters.
 */
export function failureFingerprint(detail: string): string {
  const shape = redactFailureDetail(detail)
    .replace(/#[0-9a-f]{8}/g, '#')
    .replace(/\br\d+\b/g, 'r')
    .replace(/\bL\d+\b/g, 'L')
    .replace(/\d+/g, 'N')
    .replace(/\s+/g, ' ')
    .trim();
  return sha(shape).slice(0, 32);
}
