/**
 * [INPUT]: 依赖 node:assert/strict 与调用方传入的本地 contract 事实对象
 * [OUTPUT]: 提供 validateContract，拒绝缺失/未知事实、非法值、重复编号与跨分区关联漂移
 * [POS]: scripts 的 T08 预检边界，生成器在目标文件 IO 前调用；生命周期仅校验为事实，不生成执行路径
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const assert = require('node:assert/strict');

function validateContract(contract) {
  const keys = ['schema', 'nativeErrors', 'jsErrors', 'archiveLimits', 'stateOperations', 'archivePatchTypes', 'taskTypes', 'wireVersions', 'installRecord', 'endpointBudget', 'androidAbis', 'lifecycle'];
  assert.deepEqual(Object.keys(contract).sort(), keys.sort(), 'contract sections');
  assert.equal(contract.schema, 1, 'contract schema');
  const object = (value) => assert(value && typeof value === 'object' && !Array.isArray(value), 'expected object');
  const integer = (value, minimum = 1) => assert(Number.isSafeInteger(value) && value >= minimum, 'expected bounded integer');
  const unique = (values) => assert.equal(new Set(values).size, values.length, 'duplicate contract value');
  const named = (values) => {
    object(values);
    assert(Object.keys(values).length > 0, 'empty fact section');
    for (const name of Object.keys(values)) assert(/^[A-Z][A-Za-z0-9]*$/.test(name), 'invalid fact name');
  };
  const requiredNames = {
    nativeErrors: 'InvalidOptions DownloadFailed PatchFailed FileOperationFailed SwitchVersionFailed MarkSuccessFailed RestartFailed ResetFailed InvalidHashInfo UnsupportedPlatform ApkInstallPermissionRequired ApkInstallFailed',
    archiveLimits: 'MaxArchiveBytes MaxTotalUncompressedBytes MaxEntryBytes MaxEntries MaxCompressionRatio RatioCheckMinBytes MaxManifestBytes FreeDiskMarginBytes UnknownLengthFreeSpaceProbeBytes',
    stateOperations: 'SwitchVersion MarkSuccess Rollback ClearFirstTime ClearRollbackMark ResolveLaunch',
    archivePatchTypes: 'Full PatchFromPackage PatchFromPpk',
    taskTypes: 'Cleanup PatchFull PatchFromPackage PatchFromPpk PlainDownload',
    wireVersions: 'HbcTransformSupportedVersion SupportedDiffVersion',
  };
  for (const [section, names] of Object.entries(requiredNames)) {
    object(contract[section]);
    assert.deepEqual(Object.keys(contract[section]).sort(), names.split(' ').sort(), `unknown/missing ${section} fact`);
  }
  named(contract.nativeErrors);
  unique(Object.values(contract.nativeErrors));
  for (const code of Object.values(contract.nativeErrors)) assert(/^[A-Z][A-Z0-9_]*$/.test(code), 'invalid native error');
  assert(Array.isArray(contract.jsErrors));
  unique(contract.jsErrors);
  for (const code of contract.jsErrors) assert(typeof code === 'string' && /^[A-Z][A-Z0-9_]*$/.test(code), 'invalid JS error');
  for (const code of Object.values(contract.nativeErrors)) assert(contract.jsErrors.includes(code), 'native error absent from JS');
  for (const section of ['archiveLimits', 'stateOperations', 'archivePatchTypes', 'taskTypes', 'wireVersions']) {
    named(contract[section]);
    for (const value of Object.values(contract[section])) integer(value, section === 'taskTypes' ? 0 : 1);
  }
  for (const section of ['stateOperations', 'archivePatchTypes', 'taskTypes']) unique(Object.values(contract[section]));
  for (const [patch, task] of [['Full', 'PatchFull'], ['PatchFromPackage', 'PatchFromPackage'], ['PatchFromPpk', 'PatchFromPpk']]) {
    assert.equal(contract.archivePatchTypes[patch], contract.taskTypes[task], 'patch/task numbering mismatch');
  }
  assert.deepEqual(Object.keys(contract.installRecord).sort(), ['FileName', 'Schema', 'StagingSuffix']);
  integer(contract.installRecord.Schema);
  assert(/^\.pakta-[a-z-]+$/.test(contract.installRecord.FileName), 'invalid marker');
  assert(/^\.[a-z-]+$/.test(contract.installRecord.StagingSuffix), 'invalid staging suffix');
  assert.deepEqual(Object.keys(contract.endpointBudget).sort(), ['hedgeDelayMs', 'maxRequests']);
  integer(contract.endpointBudget.maxRequests);
  integer(contract.endpointBudget.hedgeDelayMs, 0);
  assert(Array.isArray(contract.androidAbis) && contract.androidAbis.length > 0);
  unique(contract.androidAbis.map(abi => abi.name));
  for (const abi of contract.androidAbis) {
    assert.deepEqual(Object.keys(abi).sort(), ['machine', 'minPageAlignment', 'name']);
    assert(/^[a-z0-9_-]+$/.test(abi.name), 'invalid ABI');
    integer(abi.machine);
    integer(abi.minPageAlignment, 0);
    assert(abi.machine <= 65535, 'ELF machine overflow');
    assert(abi.minPageAlignment === 0 || Number.isInteger(Math.log2(abi.minPageAlignment)), 'invalid page alignment');
  }
  assert.deepEqual(Object.keys(contract.lifecycle).sort(), ['android', 'apple', 'harmony', 'mode']);
  assert.equal(contract.lifecycle.mode, 'facts-only', 'lifecycle must not execute');
  for (const platform of ['android', 'harmony', 'apple']) {
    const facts = contract.lifecycle[platform];
    object(facts);
    assert(typeof facts.source === 'string' && !facts.source.includes('..'), 'invalid lifecycle source');
    assert(Array.isArray(facts.keys) && facts.keys.length > 0, 'missing lifecycle keys');
    unique(facts.keys);
    for (const key of facts.keys) assert(typeof key === 'string' && key.length > 0, 'invalid lifecycle key');
    assert(typeof facts.reset === 'string' && facts.reset.length > 0, 'missing reset facts');
    assert(typeof facts.directories === 'string' && facts.directories.length > 0, 'missing directory facts');
  }
  return contract;
}

module.exports = { validateContract };
