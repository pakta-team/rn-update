/**
 * [INPUT]: 依赖调用方提供的 HBC 原始字节与经校验的布局描述，不内置 Hermes 版本分支
 * [OUTPUT]: 对外提供 HbcDeltaField、HbcSectionDesc、HbcLayoutDesc 与可逆原地变换函数
 * [POS]: patch_core 的 Hermes 变换解释器，由 wire 元数据层驱动并为 hdiff 变换域服务
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
#pragma once

#include <cstddef>
#include <cstdint>

namespace pakta {
namespace hbc {

// Hermes 字节码(HBC)delta-friendly 可逆变换的通用解释器。
//
// 布局描述表来自 patch 的 __diff.json 元数据(生成端 CLI 写入),本解释器
// 不含任何 HBC 版本分支——Hermes 版本演进只需要生成端更新描述表,客户端
// 零跟进。描述表被视为不可信输入:所有段边界、条目大小、位域范围在改写
// 任何字节之前完成全量校验;校验失败时 buffer 保持原样。
//
// 变换语义与生成端(rn-update-cli src/utils/hbcTransform.ts)
// 严格一致:对描述的偏移位域做前项差分(wrapping,模字段位宽)。
// wrapping 保证与数据单调性无关的严格可逆。

struct HbcDeltaField {
  // 条目内字节偏移处按小端读取 u32,取 [bit, bit+bits) 位做差分
  uint32_t byte;
  uint32_t bit;
  uint32_t bits;
};

struct HbcSectionDesc {
  // 段大小 = headerCounts[countIndex] × entrySize(字节段 entrySize 为 1)
  uint32_t countIndex;
  uint32_t entrySize;
  const HbcDeltaField* deltaFields;
  uint32_t deltaFieldCount;
};

// 与 wire 格式的位置约定一致:counts 槽位 0 = fileLength,
// 最后一个槽位 = debugInfoOffset(结构校验依赖)。
struct HbcLayoutDesc {
  uint32_t headerCountFields;
  const HbcSectionDesc* sections;
  uint32_t sectionCount;
};

// 对 data 原地执行变换(inverse=false)或逆变换(inverse=true)。
// 返回 false 表示 data 不是该描述表下结构合法的 HBC(或描述表本身非法),
// 此时 data 未被修改。
bool TransformHbcInPlace(
    uint8_t* data,
    size_t size,
    const HbcLayoutDesc& layout,
    bool inverse);

} // namespace hbc
} // namespace pakta
