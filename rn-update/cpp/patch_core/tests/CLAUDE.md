# tests/
> L2 | 父级: ../CLAUDE.md

patch_core 宿主机验证层。测试直接链接共享 C/C++ 内核并由 `scripts/test-patch-core.sh` 编译运行；fixture 是跨生成器/执行器的只读契约样本，不承载产品逻辑。

## 成员清单

CLAUDE.md: patch_core 测试职责、成员与 fixture 边界地图
fixtures/: HBC、stream/single hdiff 与 raw stored 样本的二进制/元数据语料，生成物不添加源码 L3
fuzz_hbc_transform_wire.cpp: libFuzzer harness，以任意 (layout, buffer) 组合驱动 HBC 变换验证内存安全（FUZZ=1 经 test-patch-core.sh）
hbc_transform_test.cpp: 对拍 JS 生成的 HBC golden、验证可逆性，并覆盖非法布局和 wire 元数据拒绝
install_core_test.cpp: 直接链接真实安装/manifest/archive 核心，使用临时文件验证封存晋升、激活快照、摘要与累计边界；契约见 ../../../scripts/install-map.md
install-record-vectors.json: 本地 .pakta-complete/schema1/零字节 marker、类型和祖父兼容的正负向量
patch-manifest-vectors.json: copies、CRC32、deletes、保留路径和 HBC 元数据类型的本地向量
archive-limits-vectors.json: 条目大小、精确压缩比、保留前缀、未知长度及符号链接边界向量
patch_core_test.cpp: 集成验证补丁格式、复制合并、路径安全、清理、状态机、SHA-256 与 CRC32
resume_plan_test.cpp: 续传纯规则回归与可选上游 JSON 向量对拍，覆盖 206/416/编码/中断偏移/非法范围；--rpc 提供测试专用真实 C++ 进程边界，不进入生产

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
