#include <jni.h>
#include <stdexcept>
#include "resume_plan.h"

class LocalFrame {
 public:
  explicit LocalFrame(JNIEnv* env) : env_(env) {
    if (env_->PushLocalFrame(8) != 0) throw std::runtime_error("JNI local frame");
  }
  ~LocalFrame() { env_->PopLocalFrame(nullptr); }
 private:
  JNIEnv* env_;
};

static std::string JStringToString(JNIEnv* env, jstring value) {
  if (env->ExceptionCheck()) throw std::runtime_error("JNI pending exception");
  if (value == nullptr) return "";
  LocalFrame frame(env);
  jclass string_class = env->FindClass("java/lang/String");
  if (string_class == nullptr) throw std::runtime_error("JNI String class");
  jmethodID get_bytes = env->GetMethodID(string_class, "getBytes", "(Ljava/lang/String;)[B");
  if (get_bytes == nullptr) throw std::runtime_error("JNI getBytes method");
  jstring encoding = env->NewStringUTF("UTF-8");
  if (encoding == nullptr) throw std::runtime_error("JNI encoding allocation");
  jbyteArray bytes = static_cast<jbyteArray>(env->CallObjectMethod(value, get_bytes, encoding));
  if (bytes == nullptr || env->ExceptionCheck()) throw std::runtime_error("JNI UTF-8 conversion");
  const jsize size = env->GetArrayLength(bytes);
  std::string result(static_cast<size_t>(size), '\0');
  if (size > 0) env->GetByteArrayRegion(bytes, 0, size, reinterpret_cast<jbyte*>(&result[0]));
  if (env->ExceptionCheck()) throw std::runtime_error("JNI byte array read");
  return result;
}

static jstring ToJString(JNIEnv* env, const std::string& text) {
  if (env->ExceptionCheck()) return nullptr;
  jclass string_class = env->FindClass("java/lang/String");
  if (string_class == nullptr) return nullptr;
  jmethodID constructor = env->GetMethodID(string_class, "<init>", "([BLjava/lang/String;)V");
  if (constructor == nullptr) { env->DeleteLocalRef(string_class); return nullptr; }
  jbyteArray bytes = env->NewByteArray(static_cast<jsize>(text.size()));
  if (bytes == nullptr) { env->DeleteLocalRef(string_class); return nullptr; }
  jstring encoding = env->NewStringUTF("UTF-8");
  if (encoding == nullptr) {
    env->DeleteLocalRef(bytes);
    env->DeleteLocalRef(string_class);
    return nullptr;
  }
  env->SetByteArrayRegion(bytes, 0, static_cast<jsize>(text.size()),
                         reinterpret_cast<const jbyte*>(text.data()));
  jstring result = env->ExceptionCheck() ? nullptr :
      static_cast<jstring>(env->NewObject(string_class, constructor, bytes, encoding));
  env->DeleteLocalRef(bytes);
  env->DeleteLocalRef(encoding);
  env->DeleteLocalRef(string_class);
  return result;
}

extern "C" JNIEXPORT jstring JNICALL
Java_cn_reactnative_modules_update_ResumePlan_planRequest(
    JNIEnv* env, jclass, jstring text, jstring url, jlong size) {
  try {
    const std::string result = pakta::resume::PlanRequestJson(
        JStringToString(env, text), JStringToString(env, url), size);
    return ToJString(env, result);
  } catch (...) { return nullptr; }
}

extern "C" JNIEXPORT jstring JNICALL
Java_cn_reactnative_modules_update_ResumePlan_classifyResponse(
    JNIEnv* env, jclass, jint status, jlong offset, jstring range,
    jstring encoding, jlong length, jstring text, jstring url, jlong size) {
  try {
    const std::string result = pakta::resume::ClassifyResponseJson(
        status, offset, JStringToString(env, range), JStringToString(env, encoding),
        length, JStringToString(env, text), JStringToString(env, url), size);
    return ToJString(env, result);
  } catch (...) { return nullptr; }
}

extern "C" JNIEXPORT jstring JNICALL
Java_cn_reactnative_modules_update_ResumePlan_sidecar(
    JNIEnv* env, jclass, jstring url, jstring etag, jstring modified,
    jstring previous, jlong total) {
  try {
    const std::string result = pakta::resume::SidecarJson(
        JStringToString(env, url), JStringToString(env, etag),
        JStringToString(env, modified), JStringToString(env, previous), total);
    return ToJString(env, result);
  } catch (...) { return nullptr; }
}
