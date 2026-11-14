/**
 * [INPUT]: 依赖 install_record 共享核与 pakta.cpp 的 NAPI 参数、Promise 和导出工具
 * [OUTPUT]: 提供封存、晋升、完整性查询及不可伪造的激活快照桥接
 * [POS]: Harmony 安装防腐层；工作线程执行摘要 IO，主线程提交前复核快照；注册表锁只保护原生快照，不跨越可同步重入的 NAPI 边界
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
#pragma once
#include "install_record.h"
#include "archive_limits.h"
#include "patch_manifest.h"
#include "flow_json.h"
#include <cmath>
#include <mutex>
#include <unordered_set>

namespace harmony_install {
struct Snapshot {
  napi_env owner = nullptr;
  std::string dir;
  std::string hash;
  bool grandfathered = false;
  pakta::install_record::Activation passed;
};
struct Work {
  napi_async_work work = nullptr;
  napi_deferred deferred = nullptr;
  Snapshot snapshot;
  std::string artifact;
  bool seal = false;
  bool write = false;
  bool audit = false;
  long long archive_bytes = 0;
  std::string error;
};
static std::unordered_set<Snapshot*> snapshots;
static std::mutex snapshots_mutex;
constexpr const char* kBundle = "bundle.harmony.js";
static bool Strings(napi_env env, napi_callback_info info, size_t count,
                    napi_value* args, std::string* strings, size_t string_count) {
  size_t argc = 0;
  if (napi_get_cb_info(env, info, &argc, nullptr, nullptr, nullptr) != napi_ok || argc != count) {
    ThrowError(env, "install: wrong arguments");
    return false;
  }
  if (!GetArgCount(env, info, &argc, args) || argc != count) {
    ThrowError(env, "install: wrong arguments");
    return false;
  }
  for (size_t i = 0; i < string_count; ++i) {
    napi_valuetype type = napi_undefined;
    if (napi_typeof(env, args[i], &type) != napi_ok || type != napi_string) {
      ThrowError(env, "install: expected string");
      return false;
    }
    bool ok = false;
    strings[i] = GetString(env, args[i], &ok);
    if (!ok) return false;
    if (strings[i].find('\0') != std::string::npos) {
      ThrowError(env, "install: invalid string");
      return false;
    }
  }
  return true;
}
static napi_value Queue(napi_env env, Work* w) {
  napi_value promise = nullptr;
  if (napi_create_promise(env, &w->deferred, &promise) != napi_ok) {
    delete w;
    ThrowError(env, "install: cannot create promise");
    return nullptr;
  }
  napi_value name = NewString(env, "install");
  const auto created = napi_create_async_work(env, nullptr, name,
    [](napi_env, void* data) {
      auto* work = static_cast<Work*>(data);
      try {
        if (work->audit) {
          const auto status = pakta::archive_limits::CheckExtractedDirectory(
              work->snapshot.dir, work->archive_bytes);
          if (!status) work->error = "[PATCH_FAILED] " + status.message;
        } else if (work->write) {
          const auto status = pakta::install_record::Write(work->snapshot.dir, work->artifact);
          if (!status) work->error = "[FILE_OPERATION_FAILED] " + status.message;
        } else if (work->seal) {
          const auto result = pakta::install_record::Seal(work->snapshot.dir,
              work->snapshot.hash, kBundle, work->artifact);
          if (!result.status) work->error = std::string(result.file_failure
              ? "[FILE_OPERATION_FAILED] " : "[PATCH_FAILED] ") + result.status.message;
        } else {
          const auto status = pakta::install_record::CheckActivation(work->snapshot.dir,
              work->snapshot.hash, kBundle, work->snapshot.grandfathered, &work->snapshot.passed);
          if (!status) work->error = "[SWITCH_VERSION_FAILED] " + status.message;
        }
      } catch (...) {
        work->error = work->write ? "[FILE_OPERATION_FAILED] install exception"
                      : work->seal || work->audit ? "[PATCH_FAILED] install exception"
                                 : "[SWITCH_VERSION_FAILED] install exception";
      }
    },
    [](napi_env env, napi_status status, void* data) {
      auto* work = static_cast<Work*>(data);
      if (status != napi_ok || !work->error.empty()) {
        RejectDeferredWithMessage(env, work->deferred,
            work->error.empty() ? "install: async work aborted" : work->error.c_str());
      } else if (work->seal || work->write || work->audit) {
        napi_value value = nullptr;
        napi_get_undefined(env, &value);
        napi_resolve_deferred(env, work->deferred, value);
      } else {
        auto* snapshot = new Snapshot(std::move(work->snapshot));
        snapshot->owner = env;
        napi_value value = nullptr;
        if (napi_create_external(env, snapshot,
            [](napi_env, void* data, void*) {
              auto* passed = static_cast<Snapshot*>(data);
              {
                std::lock_guard<std::mutex> guard(snapshots_mutex);
                snapshots.erase(passed);
              }
              delete passed;
            },
            nullptr, &value) != napi_ok) {
          delete snapshot;
          RejectDeferredWithMessage(env, work->deferred, "install: cannot create snapshot");
        } else {
          {
            std::lock_guard<std::mutex> guard(snapshots_mutex);
            snapshots.insert(snapshot);
          }
          // Ark 可同步执行 Promise 后续逻辑；注册表发布完成后必须先解锁。
          napi_resolve_deferred(env, work->deferred, value);
        }
      }
      napi_delete_async_work(env, work->work);
      delete work;
    }, w, &w->work);
  if (created != napi_ok || napi_queue_async_work(env, w->work) != napi_ok) {
    if (created == napi_ok) napi_delete_async_work(env, w->work);
    RejectDeferredWithMessage(env, w->deferred, "install: cannot queue work");
    delete w;
  }
  return promise;
}
static napi_value Seal(napi_env env, napi_callback_info info) {
  napi_value args[3];
  std::string values[3];
  if (!Strings(env, info, 3, args, values, 3)) return nullptr;
  auto* w = new Work();
  w->seal = true;
  w->snapshot.dir = values[0];
  w->snapshot.hash = values[1];
  w->artifact = values[2];
  return Queue(env, w);
}
static napi_value Check(napi_env env, napi_callback_info info) {
  napi_value args[3];
  std::string values[2];
  if (!Strings(env, info, 3, args, values, 2)) return nullptr;
  bool grandfathered = false;
  if (napi_get_value_bool(env, args[2], &grandfathered) != napi_ok) {
    ThrowError(env, "install: expected boolean");
    return nullptr;
  }
  auto* w = new Work();
  w->snapshot.dir = values[0];
  w->snapshot.hash = values[1];
  w->snapshot.grandfathered = grandfathered;
  return Queue(env, w);
}
static napi_value Unchanged(napi_env env, napi_callback_info info) {
  napi_value args[1];
  void* data = nullptr;
  if (!Strings(env, info, 1, args, nullptr, 0) ||
      napi_get_value_external(env, args[0], &data) != napi_ok || !data) {
    ThrowError(env, "[SWITCH_VERSION_FAILED] invalid activation snapshot");
    return nullptr;
  }
  auto* s = static_cast<Snapshot*>(data);
  const char* error = nullptr;
  {
    std::lock_guard<std::mutex> guard(snapshots_mutex);
    if (snapshots.find(s) == snapshots.end() || s->owner != env) {
      error = "[SWITCH_VERSION_FAILED] foreign activation snapshot";
    } else {
      try {
        if (!pakta::install_record::Unchanged(s->dir, kBundle, s->grandfathered, s->passed)) {
          error = "[SWITCH_VERSION_FAILED] install changed before commit";
        }
      } catch (...) {
        error = "[SWITCH_VERSION_FAILED] snapshot verification failed";
      }
    }
  }
  if (error) {
    ThrowError(env, error);
    return nullptr;
  }
  napi_value value = nullptr;
  napi_get_undefined(env, &value);
  return value;
}
static napi_value Complete(napi_env env, napi_callback_info info) {
  napi_value args[2];
  std::string values[2];
  if (!Strings(env, info, 2, args, values, 2)) return nullptr;
  bool complete = false;
  try { complete = pakta::install_record::IsComplete(values[0], values[1], kBundle); }
  catch (...) { complete = false; }
  napi_value result = nullptr;
  napi_get_boolean(env, complete, &result);
  return result;
}
static napi_value Promote(napi_env env, napi_callback_info info) {
  napi_value args[2];
  std::string values[2];
  if (!Strings(env, info, 2, args, values, 2)) return nullptr;
  try {
    const auto status = pakta::install_record::Promote(values[0], values[1]);
    if (!status) {
      ThrowError(env, "[FILE_OPERATION_FAILED] " + status.message);
      return nullptr;
    }
  } catch (...) {
    ThrowError(env, "[FILE_OPERATION_FAILED] promote exception");
    return nullptr;
  }
  napi_value value = nullptr;
  napi_get_undefined(env, &value);
  return value;
}
static napi_value RecordValue(napi_env env, const pakta::install_record::Record& record) {
  using State = pakta::install_record::Record::State;
  napi_value result = nullptr;
  if (record.state == State::kAbsent || record.state == State::kInvalid) {
    napi_get_null(env, &result);
    return result;
  }
  napi_create_object(env, &result);
  SetBoolProperty(env, result, "legacy", record.state == State::kLegacy);
  if (record.state == State::kPresent) {
    if (record.current_schema) {
      napi_value schema = nullptr;
      napi_create_int32(env, pakta::install_record::kSchema, &schema);
      napi_set_named_property(env, result, "schema", schema);
    }
    SetStringProperty(env, result, "versionHash", record.version_hash);
    SetStringProperty(env, result, "bundleSha256", record.bundle_sha256);
    SetStringProperty(env, result, "artifactSha256", record.artifact_sha256);
  }
  return result;
}
static napi_value Parse(napi_env env, napi_callback_info info) {
  napi_value args[1];
  std::string values[1];
  if (!Strings(env, info, 1, args, values, 1)) return nullptr;
  try { return RecordValue(env, pakta::install_record::Parse(values[0])); }
  catch (...) { ThrowError(env, "[PATCH_FAILED] record parse exception"); return nullptr; }
}
static napi_value Read(napi_env env, napi_callback_info info) {
  napi_value args[1];
  std::string values[1];
  if (!Strings(env, info, 1, args, values, 1)) return nullptr;
  try { return RecordValue(env, pakta::install_record::Read(values[0])); }
  catch (...) { ThrowError(env, "[FILE_OPERATION_FAILED] record read exception"); return nullptr; }
}
static napi_value Build(napi_env env, napi_callback_info info) {
  napi_value args[3];
  std::string values[3];
  if (!Strings(env, info, 3, args, values, 3)) return nullptr;
  try {
    std::string text;
    const auto status = pakta::install_record::Build(values[0], values[1], values[2], &text);
    if (!status) { ThrowError(env, "[PATCH_FAILED] " + status.message); return nullptr; }
    return NewString(env, text);
  } catch (...) { ThrowError(env, "[PATCH_FAILED] record build exception"); return nullptr; }
}
static napi_value Write(napi_env env, napi_callback_info info) {
  napi_value args[2];
  std::string values[2];
  if (!Strings(env, info, 2, args, values, 2)) return nullptr;
  auto* w = new Work();
  w->write = true;
  w->snapshot.dir = values[0];
  w->artifact = values[1];
  return Queue(env, w);
}
static bool Size(napi_env env, napi_value value, long long* out) {
  double number = 0;
  napi_valuetype type = napi_undefined;
  if (napi_typeof(env, value, &type) != napi_ok || type != napi_number ||
      napi_get_value_double(env, value, &number) != napi_ok ||
      !std::isfinite(number) || number < 0 || number > 9007199254740991.0 ||
      std::floor(number) != number) {
    ThrowError(env, "[PATCH_FAILED] invalid archive size");
    return false;
  }
  *out = static_cast<long long>(number);
  return true;
}
static napi_value CheckSize(napi_env env, napi_callback_info info) {
  napi_value args[2];
  if (!Strings(env, info, 2, args, nullptr, 0)) return nullptr;
  long long archive = 0, expanded = 0;
  if (!Size(env, args[0], &archive) || !Size(env, args[1], &expanded)) return nullptr;
  const auto status = pakta::archive_limits::CheckUncompressedSize(archive, expanded);
  if (!status) { ThrowError(env, "[PATCH_FAILED] " + status.message); return nullptr; }
  napi_value result = nullptr;
  napi_get_undefined(env, &result);
  return result;
}
static napi_value Reserved(napi_env env, napi_callback_info info) {
  napi_value args[1];
  std::string values[1];
  if (!Strings(env, info, 1, args, values, 1)) return nullptr;
  napi_value result = nullptr;
  napi_get_boolean(env, pakta::archive_limits::IsReservedEntryName(values[0]), &result);
  return result;
}
static napi_value Audit(napi_env env, napi_callback_info info) {
  napi_value args[2];
  std::string values[1];
  if (!Strings(env, info, 2, args, values, 1)) return nullptr;
  long long archive = 0;
  if (!Size(env, args[1], &archive)) return nullptr;
  auto* w = new Work();
  w->audit = true;
  w->snapshot.dir = values[0];
  w->archive_bytes = archive;
  return Queue(env, w);
}
static napi_value Manifest(napi_env env, napi_callback_info info) {
  napi_value args[2];
  std::string values[1];
  if (!Strings(env, info, 2, args, values, 1)) return nullptr;
  bool normalize = false;
  if (napi_get_value_bool(env, args[1], &normalize) != napi_ok) {
    ThrowError(env, "[PATCH_FAILED] expected manifest normalization boolean");
    return nullptr;
  }
  try {
    pakta::patch::PatchManifestOptions options;
    options.bundle_patch_entry_name = "bundle.harmony.js.patch";
    if (normalize) options.copy_source_prefix = "resources/rawfile/";
    pakta::patch::PatchManifest manifest;
    std::string hbc;
    const auto status = pakta::patch::ParsePatchManifest(values[0], options, &manifest, &hbc);
    if (!status) { ThrowError(env, "[PATCH_FAILED] " + status.message); return nullptr; }
    auto result = flowjson::Value::Object();
    auto from = flowjson::Value::Array(), to = flowjson::Value::Array();
    auto crc = flowjson::Value::Array(), deletes = flowjson::Value::Array();
    for (const auto& copy : manifest.copies) {
      from.Push(flowjson::Value::String(copy.from));
      to.Push(flowjson::Value::String(copy.to));
      crc.Push(copy.has_expected_crc ? flowjson::Value::Number(copy.expected_crc) : flowjson::Value::Null());
    }
    for (const auto& path : manifest.deletes) deletes.Push(flowjson::Value::String(path));
    result.Set("copyFroms", std::move(from));
    result.Set("copyTos", std::move(to));
    result.Set("copyCrcs", std::move(crc));
    result.Set("deletes", std::move(deletes));
    result.Set("hbcTransformMeta", flowjson::Value::String(hbc));
    return NewString(env, flowjson::Stringify(result));
  } catch (...) { ThrowError(env, "[PATCH_FAILED] manifest exception"); return nullptr; }
}
}
