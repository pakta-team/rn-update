/**
 * [INPUT]: 依赖 JNI 环境、Java 字符串/数组对象与标准字符串容器
 * [OUTPUT]: 对外提供 header-only 的 JStringToString、JArrayToVector 与 ThrowRuntimeException
 * [POS]: patch_core 的 Android JNI 公共适配层，被补丁执行和状态/归档桥接单元共同复用
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
#pragma once

#include <jni.h>

#include <string>
#include <vector>

// Small JNI helpers shared by the Android glue translation units
// (patch_core_android.cpp and update_core_android.cpp). Header-only with inline
// linkage so both can include it without a separate compilation unit.

namespace pakta {
namespace jni_util {

inline std::string JStringToString(JNIEnv* env, jstring value) {
  if (value == nullptr) {
    return std::string();
  }

  const char* chars = env->GetStringUTFChars(value, nullptr);
  if (chars == nullptr) {
    return std::string();
  }

  std::string result(chars);
  env->ReleaseStringUTFChars(value, chars);
  return result;
}

inline std::vector<std::string> JArrayToVector(
    JNIEnv* env,
    jobjectArray values) {
  std::vector<std::string> result;
  if (values == nullptr) {
    return result;
  }

  const jsize size = env->GetArrayLength(values);
  result.reserve(static_cast<size_t>(size));
  for (jsize index = 0; index < size; ++index) {
    auto* item = static_cast<jstring>(env->GetObjectArrayElement(values, index));
    result.push_back(JStringToString(env, item));
    env->DeleteLocalRef(item);
  }
  return result;
}

inline void ThrowRuntimeException(JNIEnv* env, const char* message) {
  jclass exception = env->FindClass("java/lang/RuntimeException");
  if (exception != nullptr) {
    env->ThrowNew(exception, message);
  }
}

inline void ThrowRuntimeException(JNIEnv* env, const std::string& message) {
  ThrowRuntimeException(env, message.c_str());
}

}  // namespace jni_util
}  // namespace pakta
