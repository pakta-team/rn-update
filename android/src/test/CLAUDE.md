# test/
> L2 | 父级: ../CLAUDE.md

Android JVM 单元测试源集。纯逻辑沿用 Gradle JVM；Windows经WSL、Linux本机的testInstallHost前置任务使用 Gradle 编译类和依赖，在 Linux JVM 加载真实 JNI/共享核。Android API/SharedPreferences 为替身，文件/ZIP/SHA-256 与提交方法是真实执行，不等于设备。

## 成员清单

java/cn/reactnative/modules/update/AndroidRoundCancellationTest.java: 六项执行器边界回归，覆盖 HTTP/下载双代际主动取消、锁内配置拒绝回执和环境失败 breadcrumb 回收；不模拟真实网络或提交锁
java/cn/reactnative/modules/update/ExpoHostExceptionTest.java: Expo 宿主专属四项适配器回归，直接执行真实 HostHandler，验证正式包重抛同一致命异常/保留受检异常因果链、开发态保留宿主处理与 Metro；非 Expo 源集排除，不冒充进程或救援设备证明
java/cn/reactnative/modules/update/SyncRoundReplayTest.java: 回放共享向量中 28 条 Android 可产生的轮次，真实执行 AndroidRound，脚本替换引擎和 IO，逐项验证事件、命令参数、deadline、结果与 breadcrumb；不加载 JNI
java/cn/reactnative/modules/update/BundledResourceCopierTest.java: 直接消费双 map 接口，以 ContextWrapper 包路径替身和真实 ZIP 验证多目标、规范化、split CRC 寻址、零 CRC、漂移/写失败拒绝及密度资格；T11后SafeZipFile保留路径检查加载真实JNI
java/cn/reactnative/modules/update/CleanupKeepNamesTest.java: keepnames 槽位填充、去重与三版本延迟保护回归
java/cn/reactnative/modules/update/HttpUtilsTest.java: Content-Range 解析与矛盾形态拒绝回归
java/cn/reactnative/modules/update/FirstLoadTest.java: 真实 UpdateContext/JNI 状态核心的十项首启回归；进程前台状态、Application 生命周期和 SharedPreferences 为替身，验证无 UI 重启保留 firstTime、Activity 单次补记及过期/成功/重置后零写
java/cn/reactnative/modules/update/InstallRecordTest.java: 完成记录真实磁盘行为（TemporaryFolder + SHA-256）回归，覆盖零字节 marker 兼容、非空空对象（含空白变体）在读取/完成判定/激活三入口拒绝及 schema/版本/摘要校验
java/cn/reactnative/modules/update/SharedInstallBoundaryTest.java: 先于实现执行的短摘要/保留祖先负控；迁移后以真实 JNI 验证拒绝
java/cn/reactnative/modules/update/SharedInstallNativeTest.java: 真实 JNI 的 Seal/Promote/Unicode/激活快照生命周期、legacy/祖父兼容、CRC/HBC/manifest 和精确压缩比/目录 symlink 回归
java/cn/reactnative/modules/update/InstallCommitTest.java: 反射分配真实 UpdateContext，代理 SharedPreferences 统计 commit；实际 JNI 状态核心与文件快照驱动两入口零写拒绝、成功单提交、双代际及 Seal 后拒绝晋升；受控配置 commit 停点验证原子启动快照，配置完成后的旧快照零写拒绝
java/cn/reactnative/modules/update/SafeZipFileTest.java: 恶意/畸形 zip（穿越、超限、炸弹）拒绝回归
java/cn/reactnative/modules/update/UpdateFileUtilsTest.java: 路径组件安全判定回归
CLAUDE.md: Android JVM 测试边界与成员地图

T11 定向验证（2026-11-13）：先补三项空对象拒绝测试，修复前 12 项中新增三项失败，最小修复后 12/12 通过。验证使用 TEMP/pakta-t11-marker 的 javac 17 + JUnit 4.12 + 真实 org.json 20180813 + Hamcrest 1.3，编译仓库 InstallRecord、UpdateFileUtils 与 InstallRecordTest；仅桩化 Android Build/Log，SDK_INT=0，真实执行文件 IO 与 SHA-256。此为宿主 JVM 证据，不代表 Gradle 声明的 JUnit 4.13.2/org.json 20240303、API 26+ 目录 sync、设备激活或其他平台已验。

T15（2026-11-13）：在 Example/e2etest/android 运行 Gradle :rn-update:compileDebugJavaWithJavac :rn-update:testDebugUnitTest --offline 成功，73 tests / 0 failures / 0 errors / 0 skipped，其中回放 28、取消边界 6；使用声明的 JUnit 4.13.2/org.json 20240303。详情见 [Android轮次地图](../../../scripts/android-round-map.md)，不等价于设备宿主 API、JNI Unicode 或真实 HTTPS 验收。

首启收尾（2026-11-14）：进入时 FirstLoadTest 为未跟踪的七项遗留测试，已有 Gradle 排除/宿主脚本接线，无本轮前成功回执。扩至十项后，修复前宿主 51 项中 Activity 补记相关两项失败；补齐 onActivityStarted 对既有 startDeferredFirstLoad 的调用后，Gradle 前置 Linux JNI 宿主 51/51、普通 JVM XML 46/46，合计 97 项、零失败/错误/测试跳过。宿主为 JUnit 文本，不冒充 97 项 XML。详细命令、lint 和未验边界见 [首启回执](../../../scripts/android-round-map.md#首启收尾2026-11-14)。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md

启动快照收尾（2026-11-14）：InstallCommitTest 新增两项受控交错/过期提交测试，Gradle入口真实编译后 testInstallHost 为53项（原51+2），普通JVM XML仍46项，均零失败；两项快照测试只在Linux JNI宿主执行，见 [快照回执](../../../scripts/android-round-map.md#android-启动快照原子性2026-11-14)。不外推ART、设备落盘或四ABI重建。
