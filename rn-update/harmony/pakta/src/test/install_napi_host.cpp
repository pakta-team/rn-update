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
#include "../main/cpp/install_napi.h"
#include "../main/cpp/round_napi.h"

static napi_value Init(napi_env env, napi_value exports) {
  struct Binding { const char* name; napi_callback callback; };
  const Binding bindings[] = {
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
