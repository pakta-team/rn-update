# locales/
> L2 | 父级: ../CLAUDE.md

CLI 双语产品文案层。键集合必须中英文对称；命令层只通过 `t()` 消费语义键，不能在此承载上传或发布判断。`resolveLanguage` 仅为中文 locale 选择 `zh`，所有其他 locale 选择英文。

成员清单

en.ts: Pakta 英文资源与所有非中文 locale 的兜底文案，覆盖渠道、上传、投放和 pdiff 错误提示
zh.ts: Pakta 中文资源，仅供中文 locale 使用，覆盖渠道、上传、投放和 pdiff 错误提示

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
