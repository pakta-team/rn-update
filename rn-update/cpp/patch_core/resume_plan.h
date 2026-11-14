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
