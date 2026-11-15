/**
 * [INPUT]: 依赖标准字符串表达 HTTP 校验器、范围头与持久化 sidecar，不依赖平台网络或文件 API
 * [OUTPUT]: 声明 64 KiB sidecar 上限，以及范围解析、请求规划、响应分类和 sidecar JSON 契约
 * [POS]: patch_core 面向三端下载器的无 IO 续传边界；实现归 resume_plan.cpp，平台桥只传递值
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
#pragma once

#include <string>

#pragma GCC visibility push(hidden)
namespace pakta {
namespace resume {
constexpr long long kMaxSidecarBytes = 64 * 1024;
long long ParseContentRangeTotal(const std::string& header, long long expected_start);
std::string PlanRequestJson(const std::string& sidecar, const std::string& url,
                            long long partial_size);
std::string ClassifyResponseJson(int status, long long resume_offset,
                                 const std::string& content_range,
                                 const std::string& content_encoding,
                                 long long content_length,
                                 const std::string& sidecar, const std::string& url,
                                 long long partial_size);
std::string SidecarJson(const std::string& url, const std::string& etag,
                        const std::string& last_modified,
                        const std::string& previous_sidecar, long long total);
}
}
#pragma GCC visibility pop
