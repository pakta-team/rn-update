/**
 * [INPUT]: 依赖 Node NAPI 与生产 install_napi.h/round_napi.h，共享安装、配置及轮次内核
 * [OUTPUT]: 提供真实生产回调和仅限宿主的同步重入注入入口，复现 Ark 兑现 Promise 与分配时的回调边界
 * [POS]: Harmony 安装桥宿主装载器；重入钩子只包裹 NAPI 边界，不复制快照或安装规则，不进入 HAR
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
#include <node_api.h>
#include <string>

static void ThrowError(napi_env env, const std::string& text) {
  napi_throw_error(env, nullptr, text.c_str());
}
static bool GetArgCount(napi_env env, napi_callback_info info, size_t* count, napi_value* args) {
  return napi_get_cb_info(env, info, count, args, nullptr, nullptr) == napi_ok;
}
static std::string GetString(napi_env env, napi_value value, bool* ok) {
  size_t length = 0;
  *ok = napi_get_value_string_utf8(env, value, nullptr, 0, &length) == napi_ok;
  if (!*ok) return {};
  std::string text(length + 1, '\0');
  *ok = napi_get_value_string_utf8(env, value, text.data(), text.size(), &length) == napi_ok;
  text.resize(length);
  return text;
}
static napi_value NewString(napi_env env, const std::string& text) {
  napi_value result = nullptr;
  napi_create_string_utf8(env, text.data(), text.size(), &result);
  return result;
}
static void SetStringProperty(napi_env env, napi_value object, const char* key, const std::string& text) {
  napi_set_named_property(env, object, key, NewString(env, text));
}
static void SetBoolProperty(napi_env env, napi_value object, const char* key, bool flag) {
  napi_value value = nullptr;
  napi_get_boolean(env, flag, &value);
  napi_set_named_property(env, object, key, value);
}
static void RejectDeferredWithMessage(napi_env env, napi_deferred deferred, const char* text) {
  napi_value error = nullptr;
  napi_create_error(env, nullptr, NewString(env, text), &error);
  napi_reject_deferred(env, deferred, error);
}
static napi_ref reentry_callback = nullptr;
static std::string reentry_operation;
static void CallReentry(napi_env env, const char* operation, napi_value value) {
  if (!reentry_callback || reentry_operation != operation) return;
  napi_value callback = nullptr;
  napi_get_reference_value(env, reentry_callback, &callback);
  napi_delete_reference(env, reentry_callback);
  reentry_callback = nullptr;
  reentry_operation.clear();
  napi_value receiver = nullptr;
  napi_get_global(env, &receiver);
  napi_value ignored = nullptr;
  napi_call_function(env, receiver, callback, value ? 1 : 0, value ? &value : nullptr, &ignored);
}
static napi_status ResolveWithReentry(napi_env env, napi_deferred deferred, napi_value value) {
  CallReentry(env, "resolve", value);
  return napi_resolve_deferred(env, deferred, value);
}
static napi_status UndefinedWithReentry(napi_env env, napi_value* value) {
  CallReentry(env, "undefined", nullptr);
  return napi_get_undefined(env, value);
}
static napi_status ThrowWithReentry(napi_env env, const char* code, const char* message) {
  CallReentry(env, "throw", nullptr);
  return napi_throw_error(env, code, message);
}
// ---- 仅宿主边界注入：生产代码仍执行自己的注册表、摘要和错误分支 ----
#define napi_resolve_deferred ResolveWithReentry
#define napi_get_undefined UndefinedWithReentry
#define ThrowError ThrowErrorWithReentry
static void ThrowErrorWithReentry(napi_env env, const std::string& text) {
  ThrowWithReentry(env, nullptr, text.c_str());
}
#include "../main/cpp/install_napi.h"
#undef ThrowError
#undef napi_get_undefined
#undef napi_resolve_deferred
#include "../main/cpp/round_napi.h"

static napi_value SetReentry(napi_env env, napi_callback_info info) {
  size_t count = 2;
  napi_value args[2];
  napi_valuetype type = napi_undefined;
  bool ok = false;
  if (!GetArgCount(env, info, &count, args) || count != 2 ||
      napi_typeof(env, args[1], &type) != napi_ok || type != napi_function) {
    ThrowError(env, "reentry: expected operation and callback");
    return nullptr;
  }
  const auto operation = GetString(env, args[0], &ok);
  if (!ok || (operation != "resolve" && operation != "undefined" && operation != "throw")) {
    ThrowError(env, "reentry: invalid operation");
    return nullptr;
  }
  if (reentry_callback) napi_delete_reference(env, reentry_callback);
  napi_create_reference(env, args[1], 1, &reentry_callback);
  reentry_operation = operation;
  napi_value result = nullptr;
  napi_get_undefined(env, &result);
  return result;
}

static napi_value Init(napi_env env, napi_value exports) {
  struct Binding { const char* name; napi_callback callback; };
  const Binding bindings[] = {
    {"installTestReentry", SetReentry},
    {"stepRound", harmony_round::Step},
    {"runnableConfig", harmony_round::Config},
    {"normalizeConfiguration", harmony_round::Normalize},
    {"hostCancellation", harmony_round::Cancellation},
    {"installBuildRecord", harmony_install::Build},
    {"installParseRecord", harmony_install::Parse},
    {"installReadRecord", harmony_install::Read},
    {"installWriteRecord", harmony_install::Write},
    {"installSeal", harmony_install::Seal},
    {"installPromote", harmony_install::Promote},
    {"installIsComplete", harmony_install::Complete},
    {"installCheckActivation", harmony_install::Check},
    {"installActivationUnchanged", harmony_install::Unchanged},
    {"installIsReservedEntry", harmony_install::Reserved},
    {"installCheckUncompressedSize", harmony_install::CheckSize},
    {"installAuditExtractedDirectory", harmony_install::Audit},
    {"installParseManifest", harmony_install::Manifest},
  };
  for (const auto& binding : bindings) {
    napi_value fn = nullptr;
    napi_create_function(env, binding.name, NAPI_AUTO_LENGTH, binding.callback, nullptr, &fn);
    napi_set_named_property(env, exports, binding.name, fn);
  }
  return exports;
}
NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
