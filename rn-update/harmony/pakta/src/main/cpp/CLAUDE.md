# cpp/
> L2 | 父级: ../CLAUDE.md

HarmonyOS 原生桥层。pakta.cpp 通过 NAPI 暴露共享 patch/state/update-flow 能力，PaktaTurboModule.cpp 只把 RNOH TurboModule 方法表映射到 ArkTS；不在此重写算法。

## 成员清单

CMakeLists.txt: 选择仓库或 staged native 源，构建 rnupdate 与可选 rnoh_pakta 共享库；Release 以 macro-prefix-map 去除 NAPI __FILE__ 的源码目录
pakta.cpp: NAPI 参数校验、状态/补丁异步任务、摘要及共享配置/轮次导出入口；T27 删除四个旧flow包装/注册及直连策略头，保留续传复用的MakeUtf8String
resume_napi.h: 被 pakta.cpp 单点包含的内部 NAPI 适配，校验续传参数并捕获 C++ 异常；请求、响应、sidecar 和范围规则全部委托共享 resume_plan
install_napi.h: 安装记录/Seal/Promote/Activation 及 manifest/archive 共享核适配；摘要和目录审计异步，提交快照同步复核，external 校验环境归属并保护注册表；十三导出已登记且编译单元接齐
round_napi.h: 共享 StepRound/配置门禁/HostCancellation 的内部字符串薄绑定，生产与 Node 宿主包含同一实现，捕获 C++ 异常；不执行 IO、不改变公共 RN 方法
PaktaPackage.h: RNOH Package 与 TurboModuleFactoryDelegate 注册器
PaktaMethods.inc: T09 从 src/NativePakta.ts 派生的完整方法名/参数数/同步异步宏表，不得手改；Promise 方法固定 ASYNC
PaktaTurboModule.cpp: 两次展开同一 PaktaMethods.inc，分别定义 JSI HostFunction 与注册方法，再按同步/异步模式转发 ArkTS；由 parity 校验展开与派发
PaktaTurboModule.h: 声明 RNOH ArkTSTurboModule 的 Pakta C++ 类型
CLAUDE.md: HarmonyOS C++ 桥与共享内核依赖方向地图

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
