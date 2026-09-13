/**
 * [INPUT]: 依赖 PaktaTurboModule、RNOH ArkTSTurboModule call/callAsync、React JSI 与 markSuccess(expectedHash) 参数契约
 * [OUTPUT]: 实现同步/异步 HostFunction 包装并注册完整 Pakta 方法表，包含版本绑定成功确认与冷启动/哈希能力
 * [POS]: Harmony C++ 到 ArkTS 的 TurboModule 方法桥，保持 JS 契约完整而不复制业务实现
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
#include "PaktaTurboModule.h"

using namespace facebook;
using namespace rnoh;

namespace {

jsi::Value CallSync(
    jsi::Runtime &rt,
    react::TurboModule &turboModule,
    const char *methodName,
    const jsi::Value *args,
    size_t count) {
  return jsi::Value(
      static_cast<ArkTSTurboModule &>(turboModule).call(
          rt, methodName, args, count));
}

jsi::Value CallAsync(
    jsi::Runtime &rt,
    react::TurboModule &turboModule,
    const char *methodName,
    const jsi::Value *args,
    size_t count) {
  return jsi::Value(
      static_cast<ArkTSTurboModule &>(turboModule).callAsync(
          rt, methodName, args, count));
}

#define PAKTA_SYNC_METHOD(method_name)                                   \
  static jsi::Value HostFunction_##method_name(                          \
      jsi::Runtime &rt,                                                  \
      react::TurboModule &turboModule,                                   \
      const jsi::Value *args,                                            \
      size_t count) {                                                    \
    return CallSync(rt, turboModule, #method_name, args, count);         \
  }

#define PAKTA_ASYNC_METHOD(method_name)                                  \
  static jsi::Value HostFunction_##method_name(                          \
      jsi::Runtime &rt,                                                  \
      react::TurboModule &turboModule,                                   \
      const jsi::Value *args,                                            \
      size_t count) {                                                    \
    return CallAsync(rt, turboModule, #method_name, args, count);        \
  }

// Only the constants and the RN event plumbing are synchronous. Every
// Promise-returning spec method (src/NativePakta.ts) MUST be registered
// with PAKTA_ASYNC_METHOD: a sync registration converts the ArkTS Promise
// into an empty jsi object and its rejection becomes an unhandled ArkTS
// rejection, so JS would report e.g. setNeedUpdate as successful while
// nothing was switched. scripts/check-native-spec-parity.js enforces this.
PAKTA_SYNC_METHOD(getConstants)
PAKTA_SYNC_METHOD(addListener)
PAKTA_SYNC_METHOD(removeListeners)

PAKTA_ASYNC_METHOD(setLocalHashInfo)
PAKTA_ASYNC_METHOD(getLocalHashInfo)
PAKTA_ASYNC_METHOD(setUuid)
PAKTA_ASYNC_METHOD(setNeedUpdate)
PAKTA_ASYNC_METHOD(markSuccess)
PAKTA_ASYNC_METHOD(reloadUpdate)
PAKTA_ASYNC_METHOD(restartApp)
PAKTA_ASYNC_METHOD(downloadPatchFromPpk)
PAKTA_ASYNC_METHOD(downloadPatchFromPackage)
PAKTA_ASYNC_METHOD(downloadFullUpdate)
PAKTA_ASYNC_METHOD(downloadAndInstallApk)
// 10.50+ additions. This table is the only bridge RNOH gives JS into the
// ArkTS module: a method missing here is `undefined` on the JS side, and the
// JS feature-detects then treat the whole capability as "old native" and
// silently skip it — which is how the native cold-start check shipped dark
// on Harmony. Every new spec method MUST be registered here.
PAKTA_ASYNC_METHOD(syncNativeConfig)
PAKTA_ASYNC_METHOD(getNativeCheckCache)
PAKTA_ASYNC_METHOD(markJsCheckCompleted)
PAKTA_ASYNC_METHOD(getBundleHash)
PAKTA_ASYNC_METHOD(resetToPackagedBundle)

#undef PAKTA_SYNC_METHOD
#undef PAKTA_ASYNC_METHOD

} // namespace

PaktaTurboModule::PaktaTurboModule(
    const ArkTSTurboModule::Context ctx,
    const std::string name)
    : ArkTSTurboModule(ctx, name) {
  const auto registerMethod =
      [this](const std::string &methodName,
             size_t argCount,
             auto hostFunction) {
        methodMap_[methodName] = MethodMetadata{argCount, hostFunction};
      };

  registerMethod("getConstants", 0, HostFunction_getConstants);
  registerMethod("setLocalHashInfo", 2, HostFunction_setLocalHashInfo);
  registerMethod("getLocalHashInfo", 1, HostFunction_getLocalHashInfo);
  registerMethod("setUuid", 1, HostFunction_setUuid);
  registerMethod("reloadUpdate", 1, HostFunction_reloadUpdate);
  registerMethod("restartApp", 0, HostFunction_restartApp);
  registerMethod("setNeedUpdate", 1, HostFunction_setNeedUpdate);
  registerMethod("markSuccess", 1, HostFunction_markSuccess);
  registerMethod("downloadPatchFromPpk", 1, HostFunction_downloadPatchFromPpk);
  registerMethod(
      "downloadPatchFromPackage", 1, HostFunction_downloadPatchFromPackage);
  registerMethod("downloadFullUpdate", 1, HostFunction_downloadFullUpdate);
  registerMethod(
      "downloadAndInstallApk", 1, HostFunction_downloadAndInstallApk);
  registerMethod("addListener", 1, HostFunction_addListener);
  registerMethod("removeListeners", 1, HostFunction_removeListeners);
  registerMethod("syncNativeConfig", 1, HostFunction_syncNativeConfig);
  registerMethod("getNativeCheckCache", 0, HostFunction_getNativeCheckCache);
  registerMethod("markJsCheckCompleted", 1, HostFunction_markJsCheckCompleted);
  registerMethod("getBundleHash", 0, HostFunction_getBundleHash);
  registerMethod(
      "resetToPackagedBundle", 0, HostFunction_resetToPackagedBundle);
}
