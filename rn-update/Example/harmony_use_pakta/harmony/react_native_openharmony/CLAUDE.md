# react_native_openharmony/
> L2 | 父级: ../CLAUDE.md

react-native codegen-harmony 的只读输出边界。`generated/` 由 RN/RNOH 工具链按原生模块声明生成，手工修改会在下一次 codegen 时丢失，因此这里记录生成来源与消费方向，不复制业务契约到生成文件。

## 成员清单

generated/: ArkTS 类型、组件和 TurboModule 导出入口；只读生成物，不手工编辑，不追加 L3 头部

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
