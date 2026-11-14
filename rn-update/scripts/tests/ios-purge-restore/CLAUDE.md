# ios-purge-restore/
> L2 | 父级: ../../CLAUDE.md

tvOS 清理恢复（purge-restore，上游 #646 后续）的原生行为验证宿主。核心信条：测试编译的是从 RCTPakta.mm **现取现译的未修改生产方法体**，不是第二套状态机；本目录只供应 IO 假体与注入缝隙。提取产物（.inc）只落 .tmp、不检查入库，每次运行从源码重建以保证测试对象永不过期。

## 成员清单

CLAUDE.md: 本测试宿主的成员、提取契约与验证边界地图
README.md: 语义文档；运行命令、"Production code, not a second state machine" 契约、五类顺序表与负控说明（语义文档，不受 L3 约束）
extract.py: 提取引擎；正则分词 + 字面量掩码（保偏移保换行）驱动花括号匹配，从 RCTPakta.mm 提取函数/方法/RCT_EXPORT_METHOD，fail-closed 于缺失/歧义/括号失衡，generate() 产出带 #line 的四个 .inc，--mutation 生成负控突变
purge_restore_test.mm: Foundation-only 测试宿主；TestDefaults NSObject 假体（doesNotRecognizeSelector 兜底）+ os_unfair_lock 持有断言 + 注入式等待/信号/截止缝隙，锁定五类提交顺序与 defaults 隔离；tvOS/DEBUG 宏替换仅限本 TU
test_extract.py: 提取器守护测试；8 例锁定偏移保真、原型跳过、fail-closed 与突变漂移，unittest discover 在 Linux 即可运行
test_apple_split.py: 展开真实生产片段，校验未改守卫/启动方法摘要、唯一包含/执行器及800行和Podspec内外边界
apple-characterization.json: 拆分前生产翻译单元和关键方法 SHA-256，只作旧行为基线，不用新轮次覆盖旧摘要
test_round.py: 严格提取生产命令循环并以 C++17/Werror 链接真实核心回放；IO/finish 受限替换，负控关闭救援标记必须失败，不是 Apple 编译
test_install_link.py: 从Podspec读取全部共享C++源并真实链接安装测试、三个删源链接负控；guard原始ObjC++声明/初始化经clang语法检查及两条编译负控，实际长度接线/Accept链接真实核运行10项行为及两组归零突变，不模拟Foundation/CocoaPods/Xcode
test_launch_preflight.py: 现提生产进程耗时/网络路径/恢复方法与预算常量，受限转换后编译14场景及4行为突变；系统API/dispatch/提交协作者为替身，不证明Foundation并发
test_configuration.py: 现提Apple配置门禁/等价/取消表达式链接真实共享核并运行三组行为突变；配置JNI显式允许本机native access并以-Xcheck:jni锁定Unicode和非法配置异常前缀，拒绝真正JNI警告，不冒充Foundation或ART

## 验证边界

根 test.yml 的独立 Linux job 通过 python3 -B discover 持续运行全部 test_*.py（含源码闭包与行为负控），本地对应 test:apple-source。scripts/test-ios-purge-restore.sh 保留 macOS Foundation 专项：先以-B跑 test_extract.py，再以-B提取并编译基线；VERIFY_REGRESSIONS=1 时追加三个命名突变负控与 TestDefaults 读写拒绝编译探针，负控必须以指定失败消息被捕获。不把含GNU链接参数的全目录测试塞入macOS，不删除已有缓存。

T11 提交摘要守卫接入：extract.py 额外提取安装记录常量及 reader/存在性/激活校验函数；宿主包含 digest/install_record 头，B 夹具写入由真实 Sha256File 生成摘要的 schema 1 记录，构建入口链接 digest.cpp，避免新提交守卫令既有 tvOS 顺序用例变成不完整安装。2026-11-13 Windows 实跑提取器 8/8 及真实源码 generate 成功；缺 Xcode/macOS Foundation，编译、五类原生顺序及突变负控待 Mac 验证，未计通过。既有 L3 与父级脚本地图已检查，职责/输出边界不变。

T16：extract.py 递归展开内部片段后提取，保持真实方法体；展开后的 #line 仅指展开视图，不是原片段位置。行为提取/回放及 Foundation 待验分层见 ../../apple-round-map.md。

2026-11-13 scripts边界收尾：test_apple_split.py/test_round.py仅补L3，不改摘要/提取/回放算法。首次discover的restore摘要失败保留记录；并行预检任务更新后`python -B -m unittest discover`复跑14/14，含131安装检查及34条真实循环轨迹/救援标记负控。更新归各并行任务，不归本轮实现；仍非Apple原生构建。本轮全程-B，未生成新pycache，进入前已有缓存不归本轮清理。

T16 预检续批：先以缺失生产函数失败，再完成真实提取14场景/4突变；全目录Python14项通过。原Foundation宿主仅补进程耗时/网络路径IO假体，extract补提最小预算常量；原生顺序与突变未在Windows执行，详见 ../../apple-round-map.md。不改旧摘要基线，restore改由行为测试覆盖。

T11 Apple增量：Foundation构建入口补链接install_record.cpp/flow_json.cpp；生产commit不再锁内摘要，而是锁外CheckActivation与锁内Unchanged。Windows最终全目录14项通过（含并行预检专项）、安装核131检查、34回放及源码generate通过；Foundation未运行。文件契约与限制见 ../../install-map.md。

2026-11-14 Apple归档P1：生产仅给guard增加initWithArchiveBytes并传入RCTPaktaFileSize取得的实际长度，不改共享算法。先取得平台接线失败及真实C++正常单项/累计超过1MiB、100:1边界误拒证据，再修复；测试宿主原有窄化位移和链接缺口先行修正，编译错误不计行为负控。最终全目录16/16，包括guard的3组平台接线突变、10项真实核检查及2组成功编译后按预期失败的归零突变；SDK439/439、contract10/10、lint通过，Harmony SDK类型检查明确skip。输入为条目元数据，不是真实ZIP/SSZipArchive解压；Foundation/Apple工具链仍未运行。详细契约见 ../../install-map.md。

2026-11-14 缓存卫生：先核实 Git 跟踪状态并将当前四份 __pycache__ 字节码及 SDK 根 .pytest_cache 四个文件逐字节备份至 TEMP/pakta-t01-recovery-20261114-115634/protected-current，再删除生成缓存；其中 extract.cpython-313.pyc 与 test_extract.cpython-313-pytest-8.4.2.pyc 原为 tracked，保留显式删除差异，不改索引。SDK .gitignore 排除 __pycache__/.pytest_cache/*.pyc；测试入口继续使用 -B。本次只核验恢复与缓存，不重跑算法测试，不改变既有验收结论；逐文件摘要见 TEMP 同目录 protected-current-manifest.json。

2026-11-14 远程首轮补缺：真实 macOS Foundation job 编译发现宿主没有同步渠道身份与版本级清理协作者。提取器现从生产展开源码纳入 `keyBinaryChannel`、`PaktaClearVersionScopedState`，宿主只增加固定测试渠道的 IO 接口，不改生产方法体。Linux JNI job 的 JDK 25 native-access 提示通过显式 JVM 授权解决，`-Xcheck:jni` 与警告拒绝仍保留；本段仅登记修复，实际 Mac 通过需以后续 run 证明。

2026-11-15 真实 Expo iOS 编译揭示旧 guard 测试转换成 C++ 后漏检 ObjC ivar 语法。新正控现取 holder、完整 @interface 与 init 原文，以 clang++ Objective-C++ 模式只做语法检查；内联 ivar 初始化器和去除 holder 默认构造两条突变必须编译失败。Linux 最小 NSObject/协议仅补语法依赖，不链接 Foundation，完整 Apple 编译仍由真实 Mac workflow 证明。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
