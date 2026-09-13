# [INPUT]: 依赖仓库 cpp/patch_core、cpp/update_flow_core、hpatch 适配及 HDiffPatch/LZMA 第三方源码
# [OUTPUT]: 对外生成名为 rnupdate 的 Android C++17 共享库并收敛导出符号
# [POS]: jni 原生链接清单，是 Java System.loadLibrary 与共享 C++ 实现之间的构建桥
# [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md

LOCAL_PATH := $(call my-dir)

include $(CLEAR_VARS)

LOCAL_MODULE := rnupdate
LOCAL_CPPFLAGS += -std=c++17
LOCAL_LDFLAGS += -Wl,--exclude-libs,ALL
LOCAL_C_INCLUDES := \
	$(LOCAL_PATH) \
	$(LOCAL_PATH)/HDiffPatch \
	$(LOCAL_PATH)/HDiffPatch/libHDiffPatch/HPatch \
	$(LOCAL_PATH)/lzma/C \
	$(LOCAL_PATH)/../../cpp/patch_core \
	$(LOCAL_PATH)/../../cpp/update_flow_core

Hdp_Files := \
	hpatch.c \
    HDiffPatch/libHDiffPatch/HPatch/patch.c \
	HDiffPatch/file_for_patch.c \
	lzma/C/LzmaDec.c \
    lzma/C/Lzma2Dec.c

LOCAL_SRC_FILES := \
	../../cpp/patch_core/archive_patch_core.cpp \
	../../cpp/patch_core/digest.cpp \
	../../cpp/patch_core/hbc_transform.cpp \
	../../cpp/patch_core/hbc_transform_wire.cpp \
	../../cpp/patch_core/patch_core.cpp \
	../../cpp/patch_core/patch_core_android.cpp \
	../../cpp/patch_core/state_core.cpp \
	../../cpp/patch_core/update_core_android.cpp \
	../../cpp/update_flow_core/flow_json.cpp \
	../../cpp/update_flow_core/update_flow_core.cpp \
	../../cpp/update_flow_core/update_flow_jni.cpp \
	$(Hdp_Files)

include $(BUILD_SHARED_LIBRARY)
