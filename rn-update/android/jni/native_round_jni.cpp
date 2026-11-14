/**
 * [INPUT]: 依赖 JNI 字符串边界与共享 native_config/round_engine，不依赖 Android IO
 * [OUTPUT]: 实现 NativeUpdateFlow 的轮次步进、配置门禁/等价/宿主归一化和取消检查 JNI 入口
 * [POS]: Android 共享轮次薄绑定；使用标准 UTF-8，捕获 C++ 异常，不保存轮次状态或执行命令
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
#include <jni.h>
#include <string>
#include <stdexcept>

#include "../../cpp/update_flow_core/round_engine.h"
#include "../../cpp/update_flow_core/native_config.h"

namespace {
class LocalFrame {
 public:
  explicit LocalFrame(JNIEnv* env) : env_(env) {
    if (env_->PushLocalFrame(16) != 0) throw std::runtime_error("JNI local frame");
  }
  ~LocalFrame() { env_->PopLocalFrame(nullptr); }
 private:
  JNIEnv* env_;
};

std::string Text(JNIEnv* env, jstring value) {
  if (env->ExceptionCheck()) throw std::runtime_error("JNI pending exception");
  if (!value) return "";
  LocalFrame frame(env);
  jclass cls = env->FindClass("java/lang/String");
  if (!cls) throw std::runtime_error("JNI String class");
  jmethodID method = env->GetMethodID(cls, "getBytes", "(Ljava/lang/String;)[B");
  if (!method) throw std::runtime_error("JNI getBytes");
  jstring encoding = env->NewStringUTF("UTF-8");
  if (!encoding) throw std::runtime_error("JNI encoding");
  auto bytes = static_cast<jbyteArray>(env->CallObjectMethod(value, method, encoding));
  if (!bytes || env->ExceptionCheck()) throw std::runtime_error("JNI UTF-8");
  jsize size = env->GetArrayLength(bytes);
  std::string result(static_cast<size_t>(size), '\0');
  if (size) env->GetByteArrayRegion(bytes, 0, size, reinterpret_cast<jbyte*>(&result[0]));
  if (env->ExceptionCheck()) throw std::runtime_error("JNI byte read");
  return result;
}

jstring JavaString(JNIEnv* env, const std::string& value) {
  if (env->ExceptionCheck()) return nullptr;
  jbyteArray bytes = env->NewByteArray(static_cast<jsize>(value.size()));
  if (!bytes) return nullptr;
  env->SetByteArrayRegion(bytes, 0, static_cast<jsize>(value.size()),
                         reinterpret_cast<const jbyte*>(value.data()));
  jclass cls = env->FindClass("java/lang/String");
  if (!cls || env->ExceptionCheck()) { env->DeleteLocalRef(bytes); return nullptr; }
  jmethodID ctor = env->GetMethodID(cls, "<init>", "([BLjava/lang/String;)V");
  jstring charset = env->NewStringUTF("UTF-8");
  jstring result = nullptr;
  if (ctor && charset && !env->ExceptionCheck()) {
    result = static_cast<jstring>(env->NewObject(cls, ctor, bytes, charset));
  }
  env->DeleteLocalRef(bytes);
  env->DeleteLocalRef(cls);
  if (charset) env->DeleteLocalRef(charset);
  return result;
}
}

extern "C" JNIEXPORT jstring JNICALL
Java_cn_reactnative_modules_update_NativeUpdateFlow_stepRound(
    JNIEnv* env, jclass, jstring state, jstring event) {
  try {
    std::string stateText = state ? Text(env, state) : "null";
    std::string eventText = Text(env, event);
    if (env->ExceptionCheck()) return nullptr;
    return JavaString(env, pakta::updateflow::StepRoundJson(stateText, eventText));
  } catch (...) {
    return nullptr;
  }
}

extern "C" JNIEXPORT jstring JNICALL
Java_cn_reactnative_modules_update_NativeUpdateFlow_runnableConfig(
    JNIEnv* env, jclass, jstring config) {
  try {
    return JavaString(env, pakta::updateflow::RunnableConfigJson(Text(env, config)));
  } catch (...) { return nullptr; }
}

extern "C" JNIEXPORT jboolean JNICALL
Java_cn_reactnative_modules_update_NativeUpdateFlow_configsEquivalent(
    JNIEnv* env, jclass, jstring first, jstring second) {
  try {
    return pakta::updateflow::ConfigsEquivalent(Text(env, first), Text(env, second));
  } catch (...) { return JNI_FALSE; }
}

extern "C" JNIEXPORT jstring JNICALL
Java_cn_reactnative_modules_update_NativeUpdateFlow_normalizeConfiguration(
    JNIEnv* env, jclass, jstring options) {
  try {
    std::string out, error;
    if (pakta::updateflow::NormalizeConfiguration(Text(env, options), &out, &error, true)) {
      return JavaString(env, out);
    }
    jclass type = env->FindClass("java/lang/IllegalArgumentException");
    jstring message = JavaString(env, error);
    if (type && message && !env->ExceptionCheck()) {
      jmethodID ctor = env->GetMethodID(type, "<init>", "(Ljava/lang/String;)V");
      if (ctor) {
        auto exception = static_cast<jthrowable>(env->NewObject(type, ctor, message));
        if (exception) { env->Throw(exception); env->DeleteLocalRef(exception); }
      }
    }
    if (type) env->DeleteLocalRef(type);
    if (message) env->DeleteLocalRef(message);
    return nullptr;
  } catch (...) { return nullptr; }
}

extern "C" JNIEXPORT jstring JNICALL
Java_cn_reactnative_modules_update_NativeUpdateFlow_hostCancellation(
    JNIEnv* env, jclass, jstring host, jstring round, jstring stored,
    jlong roundConfig, jlong config, jlong roundReset, jlong reset) {
  try {
    return JavaString(env, pakta::updateflow::HostCancellation(
        Text(env, host), Text(env, round), Text(env, stored),
        roundConfig, config, roundReset, reset));
  } catch (...) { return nullptr; }
}
