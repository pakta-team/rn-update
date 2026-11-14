# src/
> L2 | 父级: ../CLAUDE.md

Callable function 源码层。`index.ts` 是 Firebase 导出面，区域函数验证部署位置，`sample-data.ts` 提供深层值的共享基准，保持测试输入/输出可重复。

## 成员清单

index.ts: 导出 helloWorld、默认区域和自定义区域 callable functions
testFunctionDefaultRegion.ts: 默认区域类型识别、样本深等比较与 HttpsError 断言
testFunctionCustomRegion.ts: europe-west1 区域 callable smoke function
sample-data.ts: 深层对象/数组/标量样本数据
exports.ts: 兼容旧测试工具的 CommonJS SAMPLE_DATA 导出

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
