/**
 * [INPUT]: 依赖经 contract-schema 校验的本地常量事实与现有跨语言声明形状
 * [OUTPUT]: 提供 targets，返回文件、事实所有者、唯一匹配模式与等值声明内容
 * [POS]: scripts 的 T08 声明分区所有权表，只覆盖常量，不拥有生命周期、JNI 或业务执行代码
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const java = 'android/src/main/java/cn/reactnative/modules/update/';
const ets = 'harmony/pakta/src/main/ets/';
const cpp = 'cpp/patch_core/';
const upper = (name) => name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase();
const quote = (value) => JSON.stringify(value);
const literal = (value, language, suffix = '') => typeof value === 'string'
  ? language === 'ts' ? `'${value}'` : quote(value)
  : `${value}${suffix}`;

function targets(contract) {
  const partitions = [];
  const add = (file, owner, pattern, content) => partitions.push({ file, owner, pattern, content });
  const declaration = (file, owner, name, prefix, value, language, suffix = '') => {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    add(file, owner, new RegExp(`^[ \\t]*${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[ \\t]+${escaped}[ \\t]*=[^;]*;`, 'gm'),
      `${file.endsWith('.java') ? '    ' : ''}${prefix} ${name} = ${literal(value, language, suffix)};`);
  };
  for (const [name, code] of Object.entries(contract.nativeErrors)) {
    declaration(`${cpp}error_codes.h`, 'nativeErrors', `k${name}`, 'constexpr const char*', code, 'cpp');
    declaration(`${java}ErrorCodes.java`, 'nativeErrors', code, 'static final String', code, 'java');
    declaration(`${ets}ErrorCodes.ts`, 'nativeErrors', `ERROR_${code}`, 'export const', code, 'ts');
  }
  add('src/error.ts', 'jsErrors.type', /^export type UpdateErrorCode\s*=[\s\S]*?;(?=\r?\n\r?\nconst KNOWN_CODES)/gm,
    `export type UpdateErrorCode =\n${contract.jsErrors.map(code => `  | '${code}'`).join('\n')};`);
  add('src/error.ts', 'jsErrors.set', /^const KNOWN_CODES = new Set<string>\(\[[\s\S]*?\]\);/gm,
    `const KNOWN_CODES = new Set<string>([\n${contract.jsErrors.map(code => `  '${code}',`).join('\n')}\n]);`);
  for (const [name, value] of Object.entries(contract.archiveLimits)) {
    declaration(`${cpp}archive_limits.h`, 'archiveLimits', `k${name}`, 'constexpr long long', value, 'cpp', 'LL');
    declaration(`${java}ArchiveLimits.java`, 'archiveLimits', upper(name), 'static final long', value, 'java', 'L');
    declaration(`${ets}ArchiveLimits.ts`, 'archiveLimits', upper(name), 'export const', value, 'ts');
  }
  for (const [name, value] of Object.entries(contract.installRecord)) {
    declaration(`${cpp}install_record.h`, 'installRecord', `k${name}`, typeof value === 'number' ? 'constexpr int' : 'constexpr const char*', value, 'cpp');
    declaration(`${java}InstallRecord.java`, 'installRecord', upper(name), typeof value === 'number' ? 'static final int' : 'static final String', value, 'java');
    declaration(`${ets}InstallRecord.ts`, 'installRecord', name === 'StagingSuffix' ? upper(name) : `INSTALL_RECORD_${upper(name)}`, 'export const', value, 'ts');
  }
  for (const [name, value] of Object.entries(contract.stateOperations)) {
    add(`${cpp}state_ops.h`, 'stateOperations', new RegExp(`^  k${name} = [^,]+,`, 'gm'), `  k${name} = ${value},`);
    if (name !== 'ClearFirstTime') declaration(`${java}UpdateContext.java`, 'stateOperations', `STATE_OP_${upper(name)}`, 'private static final int', value, 'java');
    declaration(`${ets}NativePatchCore.ts`, 'stateOperations', `STATE_OP_${upper(name)}`, 'export const', value, 'ts');
  }
  for (const [name, value] of Object.entries(contract.archivePatchTypes)) {
    add(`${cpp}archive_patch_core.h`, 'archivePatchTypes', new RegExp(`^  k${name} = [^,]+,`, 'gm'), `  k${name} = ${value},`);
    const alias = { Full: 'FULL', PatchFromPackage: 'FROM_PACKAGE', PatchFromPpk: 'FROM_PPK' }[name];
    declaration(`${ets}NativePatchCore.ts`, 'archivePatchTypes', `ARCHIVE_PATCH_TYPE_${alias}`, 'export const', value, 'ts');
  }
  for (const [name, value] of Object.entries(contract.taskTypes)) {
    const alias = upper(name);
    const androidName = alias.replace('FROM_PACKAGE', 'FROM_APK');
    const harmonyName = alias.replace('FROM_PACKAGE', 'FROM_APP');
    add(`${java}DownloadTaskParams.java`, 'taskTypes', new RegExp(`^    static final int TASK_TYPE_${androidName}[ \\t]*=[^;]*;`, 'gm'), `    static final int TASK_TYPE_${androidName} = ${value};`);
    add(`${ets}DownloadTaskParams.ts`, 'taskTypes', new RegExp(`^  static readonly TASK_TYPE_${harmonyName}: number = [^;]*;`, 'gm'), `  static readonly TASK_TYPE_${harmonyName}: number = ${value};`);
  }
  for (const [name, value] of Object.entries(contract.wireVersions)) {
    declaration(`${cpp}hbc_transform_wire.h`, 'wireVersions', `k${name}`, 'constexpr uint32_t', value, 'cpp');
  }
  declaration('src/endpoint.ts', 'endpointBudget', 'DEFAULT_HEDGE_DELAY_MS', 'export const', contract.endpointBudget.hedgeDelayMs, 'ts');
  declaration('src/endpoint.ts', 'endpointBudget', 'MAX_ENDPOINT_REQUESTS', 'export const', contract.endpointBudget.maxRequests, 'ts');
  declaration(`${java}NativeCheckOrchestrator.java`, 'endpointBudget', 'MAX_CHECK_HTTP_ATTEMPTS', 'private static final int', contract.endpointBudget.maxRequests, 'java');
  declaration(`${ets}NativeCheckOrchestrator.ts`, 'endpointBudget', 'MAX_CHECK_HTTP_ATTEMPTS', 'const', contract.endpointBudget.maxRequests, 'ts');
  add('ios/RCTPakta/RCTPakta.mm', 'endpointBudget', /^    const NSUInteger maxHttpAttempts = [^;]*;/gm, `    const NSUInteger maxHttpAttempts = ${contract.endpointBudget.maxRequests};`);
  const abis = contract.androidAbis.map(abi => abi.name);
  add('scripts/verify-android-so.js', 'androidAbis.names', /^const ABIS = \[[^;]*;/gm, `const ABIS = ${JSON.stringify(abis)};`);
  add('scripts/verify-android-so.js', 'androidAbis.machine', /^const ABI_MACHINE = \{[\s\S]*?\};/gm, `const ABI_MACHINE = ${JSON.stringify(Object.fromEntries(contract.androidAbis.map(abi => [abi.name, abi.machine])), null, 2)};`);
  add('scripts/verify-android-so.js', 'androidAbis.alignment', /^const PAGE_ALIGN_ABIS = \{[^;]*;/gm, `const PAGE_ALIGN_ABIS = ${JSON.stringify(Object.fromEntries(contract.androidAbis.filter(abi => abi.minPageAlignment).map(abi => [abi.name, abi.minPageAlignment])))};`);
  add('scripts/check-packlist.js', 'androidAbis.names', /^const requiredAbis = \[[^;]*;/gm, `const requiredAbis = ${JSON.stringify(abis)};`);
  return partitions;
}

module.exports = { targets };
