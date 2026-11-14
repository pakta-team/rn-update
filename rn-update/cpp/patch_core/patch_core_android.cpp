/**
 * [INPUT]: 依赖 JNI、jni_util 与 patch_core 的文件源补丁和旧版本清理能力
 * [OUTPUT]: 对 Android DownloadTask 暴露 applyPatchFromFileSource、cleanupOldEntries JNI 入口
 * [POS]: patch_core 的 Android 执行桥，只负责 Java 参数映射与异常传播，不复制补丁算法
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
#include <jni.h>

#include <exception>
#include <string>
#include <vector>

#include "jni_util.h"
#include "patch_core.h"

namespace {

using pakta::jni_util::JArrayToVector;
using pakta::jni_util::JStringToString;
using pakta::jni_util::ThrowRuntimeException;

}  // namespace

extern "C" JNIEXPORT void JNICALL
Java_cn_reactnative_modules_update_DownloadTask_applyPatchFromFileSource(
    JNIEnv* env,
    jclass,
    jstring source_root,
    jstring target_root,
    jstring origin_bundle_path,
    jstring bundle_patch_path,
    jstring bundle_output_path,
    jstring merge_source_subdir,
    jboolean enable_merge,
    jobjectArray copy_froms,
    jobjectArray copy_tos,
    jobjectArray deletes,
    jstring hbc_transform_meta) {
  // C++ exceptions (bad_alloc/length_error from input-proportional STL
  // allocations) must not unwind through the JNI boundary: convert them to a
  // Java RuntimeException like every other failure of this entry point.
  try {
    const std::vector<std::string> from_values = JArrayToVector(env, copy_froms);
    const std::vector<std::string> to_values = JArrayToVector(env, copy_tos);

    if (from_values.size() != to_values.size()) {
      ThrowRuntimeException(env, "copy_froms and copy_tos length mismatch");
      return;
    }

    pakta::patch::FileSourcePatchOptions options;
    options.source_root = JStringToString(env, source_root);
    options.target_root = JStringToString(env, target_root);
    options.origin_bundle_path = JStringToString(env, origin_bundle_path);
    options.bundle_patch_path = JStringToString(env, bundle_patch_path);
    options.bundle_output_path = JStringToString(env, bundle_output_path);
    options.merge_source_subdir = JStringToString(env, merge_source_subdir);
    options.enable_merge = enable_merge == JNI_TRUE;
    options.bundle_hbc_transform_meta = JStringToString(env, hbc_transform_meta);

    for (size_t index = 0; index < from_values.size(); ++index) {
      options.manifest.copies.push_back(pakta::patch::CopyOperation{
          from_values[index],
          to_values[index],
      });
    }
    options.manifest.deletes = JArrayToVector(env, deletes);

    const pakta::patch::Status status =
        pakta::patch::ApplyPatchFromFileSource(options);
    if (!status.ok) {
      ThrowRuntimeException(env, status.message);
    }
  } catch (const std::exception& error) {
    ThrowRuntimeException(env, error.what());
  } catch (...) {
    ThrowRuntimeException(env, "Unexpected native exception in applyPatchFromFileSource");
  }
}

extern "C" JNIEXPORT void JNICALL
Java_cn_reactnative_modules_update_DownloadTask_cleanupOldEntries(
    JNIEnv* env,
    jclass,
    jstring root_dir,
    jstring keep_current,
    jstring keep_previous,
    jint max_age_days) {
  try {
    const pakta::patch::Status status = pakta::patch::CleanupOldEntries(
        JStringToString(env, root_dir),
        JStringToString(env, keep_current),
        JStringToString(env, keep_previous),
        static_cast<int>(max_age_days));
    if (!status.ok) {
      ThrowRuntimeException(env, status.message);
    }
  } catch (const std::exception& error) {
    ThrowRuntimeException(env, error.what());
  } catch (...) {
    ThrowRuntimeException(env, "Unexpected native exception in cleanupOldEntries");
  }
}
