/**
 * [INPUT]: 依赖 PaktaTurboModule、RNOH call/callAsync 与 NativePakta 派生的 PaktaMethods.inc
 * [OUTPUT]: 从同一生成表展开 HostFunction 与方法注册，保持参数数量和 Promise 模式一致
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

#define PAKTA_METHOD(name, arity, mode) PAKTA_##mode##_METHOD(name)
#include "PaktaMethods.inc"
#undef PAKTA_METHOD

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

#define PAKTA_METHOD(name, arity, mode) \
  registerMethod(#name, arity, HostFunction_##name);
#include "PaktaMethods.inc"
#undef PAKTA_METHOD
}
