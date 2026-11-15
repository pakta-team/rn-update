# jni/
> L2 | 父级: ../CLAUDE.md

Android NDK 组合入口。该层只把仓库自有补丁/决策核心与受控第三方解码器编译为 librnupdate.so；算法语义留在 cpp，Java 通过稳定 JNI 数据对象消费结果。

## 成员清单

CLAUDE.md: JNI 构建边界、第三方依赖与自产适配文件的语义地图
Android.mk: 汇集 patch_core、共享策略/配置/轮次、hpatch及LZMA/HDiffPatch生成rnupdate；T27撤掉旧update_flow_jni输入，保留新轮次消费的update_flow_core
native_round_jni.cpp: StepRound、RunnableConfig、ConfigsEquivalent、HostCancellation 的内部 JNI 入口，Java 字符串经标准 UTF-8 字节转换，局部引用有界并保留 Java 异常；不拥有平台 IO
native_install_jni.cpp: 独立安装/manifest/archive JNI，委托真实共享核；标准 UTF-8，激活句柄注册表持有原始路径与快照并由 mutex 保护，release 显式回收，不接受 Java 拼造快照
Application.mk: 固定 Android 21、四 ABI、静态 libc++、体积优化与符号可见性策略
hpatch.c: 在文件流上识别 HDIFFSF20/HDIFF13 并选择 single/stream 补丁执行路径
hpatch.h: 暴露 hpatch_by_file 与稳定负数错误码，供共享 C++ Android 胶水调用
HDiffPatch/: 上游补丁算法子模块，视为第三方源码，不承载本项目 GEB 契约
lzma/: 上游 LZMA/LZMA2 解码子模块，视为第三方源码，不承载本项目 GEB 契约

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
