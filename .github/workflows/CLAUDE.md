# workflows/
> L2 | 父级: ../CLAUDE.md

工作流中的运行目录、paths、缓存、artifact 和脚本入口均以独立 SDK 根目录为基准。CLI 通过 setup-cli 单独检出；手动 cli_ref、仓库变量 RNU_CLI_REF、main 依次回退，真实运行记录实际提交。CLI 自身的测试与发布留在 CLI 仓库。SDK/CLI 本轮共同版本为 1.2.0；设备 CI 消费前须先将配套 CLI 同步到公开远端，或将 cli_ref/RNU_CLI_REF 固定到已存在的配套提交或 tag，不能将本机未推送内容称为 CI 输入。

成员清单
test.yml: JS/JVM/JNI/C++/HAR/候选消费及 Apple 源码检查，tvOS 独立 Release 宿主执行两版本 forceBoot、重启和缓存恢复。
lint.yml: 冻结 SDK 依赖后执行 Biome、TypeScript、Harmony 与桥接契约静态检查。
e2e_android.yml: 同轮重建四 ABI 库，执行 RN085/RN077 Release、Debug smoke 和无 forceBoot 的真实坏 JS 救援，候选与宿主证据独立保存。
e2e_ios.yml: iOS core/native 独立 Release 与坏 JS 救援，保留实际原生输入缓存键和限定证据上传。
expo_build.yml: Expo57 两平台源码 Release 编译，以及同轮 Android 候选的 fresh 宿主坏 JS 救援，Gradle 保留 stderr/stacktrace。
e2e_harmony.yml: 仅手动运行具备 DevEco/设备/签名的自托管 runner；Windows 显式候选/HAR与全新外部短工程执行九项和独立 healthy/crashprobe。
publish.yml: 保留 v* tag 与手动现存 tag 发布，先校验和重建原生库，按 Harmony 输入变化构建或复用 HAR；只消费和发布同一个已校验 tgz，成功后创建 GitHub Release。
ci-failure-email.yml: 对工作流失败建立或恢复 issue，不在隔离验证分支通知，也不保留上游个人 mention。
scripts/: tvOS 驱动、Windows Harmony 编排和 Firebase/模拟器辅助脚本。

Harmony Windows runner 必须预置 HDC_TARGET、HDC_PATH、DEVECO_STUDIO_HOME、RNU_WSL_HDIFF_ROOT、RNU_HARMONY_SIGNING_FILE，并提供 RNU_HARMONY_SDK_TGZ/SDK_SHA256、HAR_PATH/HAR_SHA256、PROJECT/NATIVE_PROJECT。摘要必须属于本次明确输入，工程须不存在且位于 checkout 外；不继承历史固定候选、工程名或一次性 runner 标签。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
