# T13 续传半部：实现与验证
> 父级地图：CLAUDE.md；验证日期：2026-11-13

## 所有权与协议

对照上游 `e35f7dff7cf59d803476918a5dab41579d7031e4` 的 resume_plan 迁入本地 `pakta::resume`，复用既有 flow_json，不引入第二套 JSON 库。纯核心只规划请求、分类响应和生成 sidecar；网络、文件、空间检查、取消、进度与重试仍归平台下载器。

保留 `<archive>.resume` 的 url/etag/lastModified/total 磁盘格式与 64 KiB 读取校验。可信 partial 使用实际文件长度生成 Range，优先 ETag，其次 Last-Modified；完整归档免网络。206 仅在起点匹配且未编码时追加，200 替换，416 完整则完成，否则清零；无效范围和编码范围至多重启一次。HTTP 错误体不进入归档，中断保留 partial 和 sidecar。

三端下载器在一次下载入口固定单调时钟截止时间，清零重试不能重置预算。Android 与 Apple 保留原有 HTTPS 重定向降级拒绝；Harmony 本轮未新增重定向拦截，不将共享纯规则描述为网络安全策略。

本轮不修改 UpdateContext、更新轮次或 scripts/contract.json；ResumePlan JNI 与 Harmony resume NAPI 是下载内部接口，不新增公共 React Native 桥方法。

## 文件契约

| 文件 | 输入、输出与职责边界 |
| --- | --- |
| cpp/patch_core/resume_plan.h | 声明纯续传接口及 sidecar 上限，供三端适配层消费；不拥有平台 IO。 |
| cpp/patch_core/resume_plan.cpp | 消费 sidecar JSON、文件长度与响应头，输出请求/响应决策和 sidecar JSON；严格拒绝带符号、尾随文本、起点不符或倒序的 Content-Range。 |
| cpp/patch_core/resume_plan_android.cpp | Java String 经标准 UTF-8 字节转换后调用纯核心，返回 JSON；局部引用有界，保留 JNI 异常，C++ 异常不越过 JNI。 |
| android/src/main/java/cn/reactnative/modules/update/ResumePlan.java | 加载既有 rnupdate 库，向包内 DownloadTask 暴露三个静态 native 方法，不成为公共 RN 协议。 |
| android/src/main/java/cn/reactnative/modules/update/BundledResourceCopier.java | 只读消费 DownloadTask 已校验的来源→目标 File 列表和来源→CRC map；不再要求 JNI DTO 携带 CRC，日志复用 UpdateContext.TAG，密度资格从目标父目录恢复。 |
| android/src/test/java/cn/reactnative/modules/update/BundledResourceCopierTest.java | 直接编译调用生产双 map 接口；真实 ZIP/文件 IO，ContextWrapper 仅替换安装包路径，不加载 JNI，不模拟设备 Resources 解析。 |
| harmony/pakta/src/main/cpp/resume_napi.h | 在 pakta.cpp 的 NAPI 值适配环境中提供四个续传入口；参数校验和异常映射归桥层，规则归共享核心。 |
| cpp/patch_core/tests/resume_plan_test.cpp | 直接链接生产核心，验证本地边界及可选上游向量；测试专用 --rpc 供控制流测试调用，不进入生产导出。 |
| scripts/test-resume-core.sh | 以宿主 C++17 编译真实规则和 flow_json；SANITIZE=1 启用 ASan/UBSan，参数原样传给测试程序。 |
| src/__tests__/resumeDownload.test.ts | 执行真实 Harmony DownloadTask 源码，以模拟网络/文件 IO 和真实 C++ 子进程决策验证控制流；不是设备网络或 NAPI 运行证明。 |

新增文件契约在此集中登记；Android ResumePlan、copier 与新增测试的 L3 已补齐/对齐，其他平台及核心源码头部未在 Android 收尾中修改，不能将此记录视为全仓 L3 协议全部满足。Android/Harmony DownloadTask 仍超过工作区 800 行目标，本轮未借续传迁移扩展到安装链拆分。

## 实跑证据

- `wsl -d Ubuntu -- sh -lc 'cd /mnt/d/code/rn-update/rn-update && SANITIZE=1 sh scripts/test-resume-core.sh /mnt/d/code/react-native-update/cpp/patch_core/tests/resume-plan-vectors.json'`：163 checks，0 failures，ASan/UBSan 无报告；普通模式此前同为 163/0。
- `bun run test`：Node 契约回归通过，SDK 462 pass / 0 fail，1408 expect，29 files。总数包含其他任务的既有测试，不全归 T13。
- 其中 resumeDownload 专项 9 项：206 追加、416 清零、非法数字范围、错起点、编码范围、第二次 416 停止、中断再续、完整归档免请求、503 响应体隔离。
- `bun run lint`：Biome、TypeScript、常量只读检查和 19 方法四端 parity 通过。此命令默认 Harmony SDK 探测跳过，不当作 SDK 检查证据。
- 显式设置 `DEVECO_SDK_HOME=C:\Program Files\Huawei\DevEco Studio\sdk`、`HARMONY_TYPECHECK_REQUIRED=1` 后运行 `node scripts/check-harmony-types.js`：真实类型检查通过。
- DevEco clang++ 以 aarch64-linux-ohos、SDK sysroot、C++17 对 pakta.cpp 执行 `-fsyntax-only`：exit 0；包含 resume NAPI，不等价于 HAR 链接或设备调用。
- NDK 28.2.13676358 对最新 JNI 编译四 ABI 至 `.tmp/t13-android/lib`，`node scripts/verify-android-so.js .tmp/t13-android/lib` 通过架构、所需 JNI 符号及 64 位 16 KiB LOAD 对齐检查。

## Android 收尾增量（2026-11-13）

未修改共享核心、Apple、Harmony、UpdateContext、下载轮次、JNI DTO 或 contract.json。原编译错误来自 copier 沿用了上游 `File + CopyGroupResult[]` 接口，而本地 DownloadTask 已经以 buildCopyList 做目标规范路径校验并独立收集来源 CRC；修复只对齐 copier 的双 HashMap 输入并消除不存在的 Texts.LOG_TAG。CRC map 以缺键表示未声明，数值 0 仍参与内容校验。remainingFiles 使用新 map，不消费调用方列表；密度替代仅提取目标 File 的父目录名/文件名，不把绝对 staging 路径送入资源解析。

- 在 `Example/e2etest/android` 实跑 `./gradlew.bat :rn-update:compileDebugJavaWithJavac :rn-update:testDebugUnitTest --console=plain --offline`：生产 Java 编译通过，单测阶段因 JUnit 4.13.2 / org.json 20240303 尚未缓存而退出；随后去掉 `--offline` 实跑 `:rn-update:testDebugUnitTest` 成功，XML 汇总 **39 tests / 0 failures / 0 errors / 0 skipped**，包含 copier 新增 **7/7**，不是此前宿主桩测试。日志分别为 `TEMP/pakta-t13-android-gradle.log` 与 `TEMP/pakta-t13-android-tests.log`。
- copier 回归覆盖多目标/map 只读、无 CRC 的规范路径、base/split 同名不同内容的 CRC 来源选择、CRC=0 的改名空资源、内容漂移拒绝、已定位资源写失败拒绝，以及缺失密度的资格边界。运行依赖 Gradle mockable Android jar，不能推导设备 Resources 密度解析已验。
- 用 Windows NDK **28.2.13676358** `ndk-build.cmd -B -j8`，原样消费 `android/jni/Android.mk` 与 `Application.mk`，全量生成 `.tmp/t13-android-final/{obj,lib}`，不复用此前隔离目录；日志 `TEMP/pakta-t13-android-so-build.log`。
- `node scripts/verify-android-so.js .tmp/t13-android-final/lib` 通过后逐 ABI 复制到 `android/lib` 并比较 SHA-256，再运行默认 `node scripts/verify-android-so.js` **通过**：四 ABI machine、全部 14 个所需 JNI 符号（含三个 ResumePlan 入口）及 64 位 LOAD ≥16384 对齐。原默认检查拒绝旧库为历史负控，当前发布目录已替换。

发布目录 SHA-256（隔离构建与同步后逐项一致）：

| ABI | 字节 | android/lib/&lt;abi&gt;/librnupdate.so SHA-256 |
| --- | ---: | --- |
| arm64-v8a | 347968 | `d050d84b1db6e5a361c082a0cbe4769258e45e0ec793299870eeea9bafa1f343` |
| armeabi-v7a | 215972 | `9b5011f775056928dd9d4e31c580a771d6066b8c42b0f7d6f463948fcdbbf21a` |
| x86 | 325000 | `cb36cdf683589c0e7fe787e722b38c69141ca86cd2b4d370a3d16078cf09e38d` |
| x86_64 | 345656 | `13cd961263469d7cdd4a31560a41d2710c40d6c5706825964cf259b99151c213` |

关键构建输入 SHA-256（本次读取及编译，不改动核心）：

| 文件 | SHA-256 |
| --- | --- |
| cpp/patch_core/resume_plan.cpp | `079d6988d6541528ad718e243e7523d7143221845b0de3a3a07fa4cfcc258eee` |
| cpp/patch_core/resume_plan.h | `e3b680e81a49273025dd96baec3bfb1e2568842b9efedf6208ccbbb6143e0b70` |
| cpp/patch_core/resume_plan_android.cpp | `07c3a77eab7676b9ec06308a5d4ca2b8a9e8c7919ce9414d29b0ce8ec5503a44` |
| android/jni/Android.mk | `324422c3631ae79af56729d3593f282b651919eefc0cd07df612bae2c955a7b0` |
| android/jni/Application.mk | `7d22d7be0a4e7754cabc1785e7e07abfd0e6019c46f29d22f2712fb20520acb1` |

## 未验与阻塞

- Android copier 接口编译与发布 SO 不同步两项阻塞已解除；Gradle JVM 回归不等价于 APK/设备安装或真实续传验收。
- 本节T13时点只有JNI编译/语法证据；后续Android安装JNI Linux宿主运行见install-map.md，Harmony新HAR双ABI及Node NAPI宿主见harmony-round-map.md，不能继续把“未链接新HAR”作为当前状态。Android ART/OpenHarmony设备与Apple Xcode/Foundation仍未验。
- Harmony 控制流测试要求宿主 C++17 编译器；Windows 使用已安装 Ubuntu WSL，不静默跳过。网络和文件 IO 为替身，不能证明真实重定向、磁盘断电或系统取消语义。
- 未重新生成 npm 发布候选；此前候选和三端旧产物不能作为本轮发布证据。

2026-11-13脚本收尾：test-resume-core.sh仅补L3，不改固定BUILD_DIR、SANITIZE与参数转发；不会因此重算163项历史证据。发布清单现要求resume共享源/Android桥/Harmony桥，HAR闸门要求四个resume注册；具体新输入正负控和prepack阻塞见本目录CLAUDE.md。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
