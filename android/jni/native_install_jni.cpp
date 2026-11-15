/**
 * [INPUT]: 依赖 JNI、install_record/archive_limits/patch_manifest 与 flow_json 共享能力
 * [OUTPUT]: 实现 NativeInstall 的记录/封存晋升/manifest/归档接口及显式释放的激活快照句柄
 * [POS]: Android 安装防腐层；mutex 注册表绑定原始路径和真实快照，平台状态锁与代际不由此持有
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
#include <jni.h>
#include <limits>
#include <memory>
#include <mutex>
#include <stdexcept>
#include <string>
#include <unordered_map>

#include "install_record.h"
#include "archive_limits.h"
#include "patch_manifest.h"
#include "flow_json.h"

namespace {
using flowjson::Value;
namespace install = pakta::install_record;
namespace archive = pakta::archive_limits;

struct Snapshot {
  std::string directory;
  std::string bundle;
  install::Activation activation;
};
std::mutex snapshots_mutex;
std::unordered_map<jlong, Snapshot> snapshots;
jlong next_snapshot = 1;

std::string Text(JNIEnv* env, jstring value) {
  if (!value) return "";
  if (env->PushLocalFrame(8) != 0) throw std::runtime_error("JNI local frame");
  jclass cls = env->FindClass("java/lang/String");
  jmethodID method = cls ? env->GetMethodID(cls, "getBytes", "(Ljava/lang/String;)[B") : nullptr;
  jstring encoding = env->NewStringUTF("UTF-8");
  auto bytes = method && encoding ? static_cast<jbyteArray>(env->CallObjectMethod(value, method, encoding)) : nullptr;
  if (!bytes || env->ExceptionCheck()) {
    env->PopLocalFrame(nullptr);
    throw std::runtime_error("JNI UTF-8 input");
  }
  const jsize size = env->GetArrayLength(bytes);
  std::string text(static_cast<size_t>(size), '\0');
  if (size) env->GetByteArrayRegion(bytes, 0, size, reinterpret_cast<jbyte*>(&text[0]));
  env->PopLocalFrame(nullptr);
  if (env->ExceptionCheck()) throw std::runtime_error("JNI byte read");
  if (text.find('\0') != std::string::npos) throw std::runtime_error("embedded NUL");
  return text;
}

jstring JavaText(JNIEnv* env, const std::string& text) {
  if (env->PushLocalFrame(8) != 0) throw std::runtime_error("JNI local frame");
  auto bytes = env->NewByteArray(static_cast<jsize>(text.size()));
  if (bytes) env->SetByteArrayRegion(bytes, 0, static_cast<jsize>(text.size()), reinterpret_cast<const jbyte*>(text.data()));
  jclass cls = env->FindClass("java/lang/String");
  jmethodID ctor = cls ? env->GetMethodID(cls, "<init>", "([BLjava/lang/String;)V") : nullptr;
  jstring encoding = env->NewStringUTF("UTF-8");
  jobject result = bytes && ctor && encoding && !env->ExceptionCheck() ? env->NewObject(cls, ctor, bytes, encoding) : nullptr;
  return static_cast<jstring>(env->PopLocalFrame(result));
}

void Error(JNIEnv* env, const char* type, const std::string& message) {
  if (env->ExceptionCheck()) return;
  jclass cls = env->FindClass(type);
  if (cls) {
    env->ThrowNew(cls, message.c_str());
    env->DeleteLocalRef(cls);
  }
}

void Require(const pakta::patch::Status& status) {
  if (!status) throw std::runtime_error(status.message);
}

std::string Manifest(const std::string& text) {
  pakta::patch::PatchManifest manifest;
  std::string hbc;
  Require(pakta::patch::ParsePatchManifest(text, {}, &manifest, &hbc));
  auto result = Value::Object();
  auto copies = Value::Object();
  auto crcs = Value::Object();
  auto deletes = Value::Array();
  for (const auto& copy : manifest.copies) {
    copies.Set(copy.to, Value::String(copy.from));
    if (copy.has_expected_crc) crcs.Set(copy.to, Value::Number(copy.expected_crc));
  }
  for (const auto& path : manifest.deletes) deletes.Push(Value::String(path));
  result.Set("copies", std::move(copies));
  result.Set("copiesCrc", std::move(crcs));
  result.Set("deletes", std::move(deletes));
  if (!hbc.empty()) {
    bool ok = false;
    auto transforms = Value::Object();
    transforms.Set("index.bundlejs.patch", flowjson::Parse(hbc, &ok));
    if (!ok) throw std::runtime_error("invalid HBC output");
    result.Set("hbcTransform", std::move(transforms));
  }
  return flowjson::Stringify(result);
}
}

extern "C" JNIEXPORT jstring JNICALL
Java_cn_reactnative_modules_update_NativeInstall_execute(
    JNIEnv* env, jclass, jstring operation, jstring first, jstring second,
    jstring third, jstring fourth) {
  try {
    const auto op = Text(env, operation);
    const auto a = Text(env, first);
    const auto b = Text(env, second);
    const auto c = Text(env, third);
    const auto d = Text(env, fourth);
    std::string result;
    if (op == "build") Require(install::Build(a, b, c, &result));
    else if (op == "write") Require(install::Write(a, b));
    else if (op == "read") {
      const auto record = install::Read(a);
      if (record.state == install::Record::State::kAbsent || record.state == install::Record::State::kInvalid ||
          (record.state == install::Record::State::kPresent && !install::Names(record, record.version_hash))) return nullptr;
      auto value = Value::Object();
      if (record.state == install::Record::State::kPresent) {
        value.Set("schema", Value::Number(install::kSchema));
        value.Set("versionHash", Value::String(record.version_hash));
        value.Set("bundleSha256", Value::String(record.bundle_sha256));
        if (!record.artifact_sha256.empty()) value.Set("artifactSha256", Value::String(record.artifact_sha256));
      }
      result = flowjson::Stringify(value);
    } else if (op == "complete") result = install::IsComplete(a, b, "index.bundlejs") ? "true" : "false";
    else if (op == "digest") result = install::RecordedBundleSha256(a);
    else if (op == "seal") {
      const auto sealed = install::Seal(a, b, "index.bundlejs", c, d);
      if (!sealed.status && sealed.file_failure) {
        Error(env, "cn/reactnative/modules/update/FileOperationException", sealed.status.message);
        return nullptr;
      }
      Require(sealed.status);
    } else if (op == "promote") {
      const auto status = install::Promote(a, b);
      if (!status) {
        Error(env, "cn/reactnative/modules/update/FileOperationException", status.message);
        return nullptr;
      }
    } else if (op == "reserved") result = archive::IsReservedEntryName(a) ? "true" : "false";
    else if (op == "manifest") result = Manifest(a);
    else if (op == "audit") {
      size_t consumed = 0;
      const auto bytes = std::stoll(b, &consumed);
      if (consumed != b.size() || bytes < 0) throw std::runtime_error("invalid archive size");
      Require(archive::CheckExtractedDirectory(a, bytes));
    } else throw std::runtime_error("unknown install operation");
    return JavaText(env, result);
  } catch (const std::exception& e) { Error(env, "java/io/IOException", e.what()); }
  catch (...) { Error(env, "java/io/IOException", "native install failure"); }
  return nullptr;
}

extern "C" JNIEXPORT jlong JNICALL
Java_cn_reactnative_modules_update_NativeInstall_checkActivation(
    JNIEnv* env, jclass, jstring directory, jstring hash, jstring bundle, jboolean grandfathered) {
  try {
    Snapshot snapshot{Text(env, directory), Text(env, bundle), {}};
    Require(install::CheckActivation(snapshot.directory, Text(env, hash), snapshot.bundle, grandfathered, &snapshot.activation));
    std::lock_guard<std::mutex> lock(snapshots_mutex);
    if (next_snapshot == std::numeric_limits<jlong>::max()) throw std::runtime_error("snapshot identifiers exhausted");
    const auto handle = next_snapshot++;
    snapshots.emplace(handle, std::move(snapshot));
    return handle;
  } catch (const std::exception& e) { Error(env, "java/io/IOException", e.what()); }
  catch (...) { Error(env, "java/io/IOException", "activation failure"); }
  return 0;
}

extern "C" JNIEXPORT jboolean JNICALL
Java_cn_reactnative_modules_update_NativeInstall_unchanged(
    JNIEnv* env, jclass, jlong handle, jboolean grandfathered) {
  try {
    std::lock_guard<std::mutex> lock(snapshots_mutex);
    const auto found = snapshots.find(handle);
    if (found == snapshots.end()) throw std::runtime_error("invalid activation snapshot");
    const auto& snapshot = found->second;
    return install::Unchanged(snapshot.directory, snapshot.bundle, grandfathered, snapshot.activation);
  } catch (const std::exception& e) { Error(env, "java/io/IOException", e.what()); }
  catch (...) { Error(env, "java/io/IOException", "snapshot failure"); }
  return JNI_FALSE;
}

extern "C" JNIEXPORT void JNICALL
Java_cn_reactnative_modules_update_NativeInstall_release(JNIEnv*, jclass, jlong handle) {
  std::lock_guard<std::mutex> lock(snapshots_mutex);
  snapshots.erase(handle);
}

extern "C" JNIEXPORT jlong JNICALL
Java_cn_reactnative_modules_update_NativeInstall_inspect(
    JNIEnv* env, jclass, jobjectArray names, jlongArray sizes, jlongArray compressed, jlong archive_bytes) {
  try {
    if (!names || !sizes || !compressed || archive_bytes < 0 || archive_bytes > archive::kMaxArchiveBytes)
      throw std::runtime_error("invalid archive inspection");
    const auto count = env->GetArrayLength(names);
    Require(archive::CheckEntryCount(count));
    if (env->GetArrayLength(sizes) != count || env->GetArrayLength(compressed) != count)
      throw std::runtime_error("archive array lengths differ");
    archive::EntryAccumulator accumulator(archive_bytes);
    for (jsize i = 0; i < count; ++i) {
      jlong size = 0, packed = 0;
      env->GetLongArrayRegion(sizes, i, 1, &size);
      env->GetLongArrayRegion(compressed, i, 1, &packed);
      auto name = static_cast<jstring>(env->GetObjectArrayElement(names, i));
      const auto text = Text(env, name);
      if (name) env->DeleteLocalRef(name);
      if (env->ExceptionCheck()) return 0;
      Require(accumulator.Accept(size, packed, false, text));
    }
    return accumulator.total_uncompressed();
  } catch (const std::exception& e) { Error(env, "java/io/IOException", e.what()); }
  catch (...) { Error(env, "java/io/IOException", "archive inspection failure"); }
  return 0;
}
