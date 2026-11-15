/**
 * [INPUT]: 依赖宿主 RN 身份、运行时架构标志与 SDK UpdateModule
 * [OUTPUT]: 提供 assertOldArchitecture，启动时拒绝新架构或非同一旧桥对象
 * [POS]: RN077 生成宿主的同步启动闸门，不向主 e2etest 注入旧架构限制
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const { NativeModules } = require('react-native');
const { UpdateModule } = require('rn-update');

function assertOldArchitecture() {
  const result = {
    rn: require('react-native/package.json').version,
    bridgeless: !!global.RN$Bridgeless,
    turbo: !!global.__turboModuleProxy,
    fabric: !!global.nativeFabricUIManager,
    legacyBridge: !!global.__fbBatchedBridge,
    nativePakta: !!NativeModules.Pakta,
    sameModule: UpdateModule === NativeModules.Pakta,
  };
  if (
    result.rn !== '0.77.3' ||
    result.bridgeless ||
    result.turbo ||
    result.fabric ||
    !result.legacyBridge ||
    !result.nativePakta ||
    !result.sameModule
  ) {
    throw new Error(`PAKTA_OLDARCH_FAIL ${JSON.stringify(result)}`);
  }
  return result;
}

module.exports = { assertOldArchitecture };
