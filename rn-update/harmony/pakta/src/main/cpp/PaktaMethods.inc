/**
 * [INPUT]: 依赖 src/NativePakta.ts，由 scripts/generate-native-bindings.js 生成，禁止手改
 * [OUTPUT]: 提供 PAKTA_METHOD(name, arity, mode) 完整方法表，Promise 一律 ASYNC
 * [POS]: Harmony C++ 的单一方法清单，被 HostFunction 定义与注册两次展开
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
PAKTA_METHOD(getConstants, 0, SYNC)
PAKTA_METHOD(setLocalHashInfo, 2, ASYNC)
PAKTA_METHOD(getLocalHashInfo, 1, ASYNC)
PAKTA_METHOD(setUuid, 1, ASYNC)
PAKTA_METHOD(syncNativeConfig, 1, ASYNC)
PAKTA_METHOD(getNativeCheckCache, 0, ASYNC)
PAKTA_METHOD(markJsCheckCompleted, 1, ASYNC)
PAKTA_METHOD(reloadUpdate, 1, ASYNC)
PAKTA_METHOD(restartApp, 0, ASYNC)
PAKTA_METHOD(setNeedUpdate, 1, ASYNC)
PAKTA_METHOD(markSuccess, 1, ASYNC)
PAKTA_METHOD(getBundleHash, 0, ASYNC)
PAKTA_METHOD(resetToPackagedBundle, 0, ASYNC)
PAKTA_METHOD(downloadPatchFromPpk, 1, ASYNC)
PAKTA_METHOD(downloadPatchFromPackage, 1, ASYNC)
PAKTA_METHOD(downloadFullUpdate, 1, ASYNC)
PAKTA_METHOD(downloadAndInstallApk, 1, ASYNC)
PAKTA_METHOD(addListener, 1, SYNC)
PAKTA_METHOD(removeListeners, 1, SYNC)
