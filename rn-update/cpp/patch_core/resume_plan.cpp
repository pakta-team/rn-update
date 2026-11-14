#include "resume_plan.h"

#include <cmath>
#include "../update_flow_core/flow_json.h"

namespace pakta {
namespace resume {
namespace {
using flowjson::Value;
bool IsSpace(char c) { return c == ' ' || c == '\t'; }
std::string Trim(const std::string& text) {
  size_t begin = 0;
  size_t end = text.size();
  while (begin < end && IsSpace(text[begin])) ++begin;
  while (end > begin && IsSpace(text[end - 1])) --end;
  return text.substr(begin, end - begin);
}
long long ParseDigits(const std::string& text) {
  if (text.empty() || text.size() > 18) return -1;
  long long value = 0;
  for (char c : text) {
    if (c < '0' || c > '9') return -1;
    value = value * 10 + (c - '0');
  }
  return value;
}
struct Sidecar {
  bool valid = false;
  std::string etag;
  std::string last_modified;
  long long total = 0;
};
Sidecar ReadSidecar(const std::string& text, const std::string& url) {
  Sidecar sidecar;
  if (text.empty() || text.size() > kMaxSidecarBytes) return sidecar;
  bool ok = false;
  Value root = flowjson::Parse(text, &ok);
  if (!ok || !root.IsObject() || !root.Get("url").IsString() ||
      root.Get("url").AsString() != url) return sidecar;
  sidecar.valid = true;
  if (root.Get("etag").IsString()) sidecar.etag = root.Get("etag").AsString();
  if (root.Get("lastModified").IsString())
    sidecar.last_modified = root.Get("lastModified").AsString();
  const Value& total = root.Get("total");
  if (total.IsNumber() && total.AsNumber() > 0 &&
      total.AsNumber() < 9007199254740992.0 &&
      std::floor(total.AsNumber()) == total.AsNumber())
    sidecar.total = static_cast<long long>(total.AsNumber());
  return sidecar;
}
Value Number(long long n) { return Value::Number(static_cast<double>(n)); }
Value Action(const char* action) {
  Value result = Value::Object();
  result.Set("action", Value::String(action));
  return result;
}
std::string Complete(long long total) {
  Value result = Action("complete");
  result.Set("total", Number(total));
  return flowjson::Stringify(result);
}
bool IsEncoded(const std::string& text) {
  std::string encoding = Trim(text);
  for (char& c : encoding)
    if (c >= 'A' && c <= 'Z') c = static_cast<char>(c - 'A' + 'a');
  return !encoding.empty() && encoding != "identity";
}
}

long long ParseContentRangeTotal(const std::string& header, long long expected_start) {
  const std::string unit = "bytes ";
  if (header.compare(0, unit.size(), unit) != 0) return -1;
  const std::string range = header.substr(unit.size());
  const size_t slash = range.find('/');
  const size_t dash = range.find('-');
  if (slash == std::string::npos || dash == std::string::npos || dash > slash)
    return -1;
  const long long start = ParseDigits(Trim(range.substr(0, dash)));
  const long long end = ParseDigits(Trim(range.substr(dash + 1, slash - dash - 1)));
  if (start < 0 || end < 0 || start != expected_start || end < start) return -1;
  const std::string total_part = Trim(range.substr(slash + 1));
  if (total_part == "*") return 0;
  const long long total = ParseDigits(total_part);
  return total > end ? total : -1;
}

std::string PlanRequestJson(const std::string& text, const std::string& url,
                            long long partial_size) {
  const Sidecar sidecar = ReadSidecar(text, url);
  if (sidecar.valid && partial_size > 0) {
    if (sidecar.total > 0 && partial_size == sidecar.total) return Complete(sidecar.total);
    if (sidecar.total <= 0 || partial_size < sidecar.total) {
      Value headers = Value::Object();
      headers.Set("Range", Value::String("bytes=" + std::to_string(partial_size) + "-"));
      headers.Set("Accept-Encoding", Value::String("identity"));
      const std::string& validator = sidecar.etag.empty() ? sidecar.last_modified : sidecar.etag;
      if (!validator.empty()) headers.Set("If-Range", Value::String(validator));
      Value result = Action("resume");
      result.Set("offset", Number(partial_size));
      result.Set("headers", headers);
      return flowjson::Stringify(result);
    }
  }
  return flowjson::Stringify(Action("fresh"));
}

std::string ClassifyResponseJson(int status, long long offset,
                                 const std::string& range, const std::string& encoding,
                                 long long length, const std::string& text,
                                 const std::string& url, long long size) {
  if (status == 416) {
    const Sidecar sidecar = ReadSidecar(text, url);
    if (sidecar.valid && sidecar.total > 0 && size == sidecar.total)
      return Complete(sidecar.total);
    return flowjson::Stringify(Action("restart"));
  }
  if (status < 200 || status > 299) return flowjson::Stringify(Action("httpError"));
  const bool encoded = IsEncoded(encoding);
  const bool append = status == 206 && offset > 0;
  long long total = 0;
  if (append) {
    total = encoded ? -1 : ParseContentRangeTotal(range, offset);
    if (total < 0) return flowjson::Stringify(Action("restart"));
  } else if (!encoded && length > 0) {
    total = length;
  }
  Value result = Action("write");
  result.Set("append", Value::Bool(append));
  result.Set("base", Number(append ? offset : 0));
  result.Set("total", Number(total));
  result.Set("encoded", Value::Bool(encoded));
  result.Set("persistSidecar", Value::Bool(!encoded));
  return flowjson::Stringify(result);
}

std::string SidecarJson(const std::string& url, const std::string& etag,
                        const std::string& modified, const std::string& text,
                        long long total) {
  const Sidecar previous = ReadSidecar(text, url);
  const std::string& kept_etag = etag.empty() ? previous.etag : etag;
  const std::string& kept_modified = modified.empty() ? previous.last_modified : modified;
  Value meta = Value::Object();
  meta.Set("url", Value::String(url));
  if (!kept_etag.empty()) meta.Set("etag", Value::String(kept_etag));
  if (!kept_modified.empty()) meta.Set("lastModified", Value::String(kept_modified));
  if (total > 0) meta.Set("total", Number(total));
  return flowjson::Stringify(meta);
}
}
}
