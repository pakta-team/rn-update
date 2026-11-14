# types/
> L2 | 父级: ../CLAUDE.md

HarmonyOS 编译期防腐层。声明只描述 ArkTS 全局、librnupdate.so 和 RNOH 最小消费表面，避免把完整宿主工具链引入普通 TypeScript 检查。

## 成员清单

arkts-globals.d.ts: 为 plain tsc/ArkTS 源补足 console、定时器等环境全局
librnupdate.d.ts: 声明 NAPI native module 的 unknown 默认导出，具体方法由 NativePatchCore 收窄
rnoh.d.ts: 声明 pakta 实际消费的 RNInstance、UITurboModuleContext、UITurboModule 与 RNPackage
CLAUDE.md: Harmony 编译期声明边界与成员地图

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
