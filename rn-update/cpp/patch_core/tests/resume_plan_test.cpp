/**
 * [INPUT]: 依赖生产 resume_plan、flow_json 和可选上游 JSON 向量，不替换续传规则
 * [OUTPUT]: 提供续传规划独立回归程序，以及供宿主控制流测试调用的 --rpc JSON 进程入口
 * [POS]: patch_core 的纯规则对拍层；验证范围、响应与 sidecar 边界，不执行真实 HTTP 或平台下载
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
#include <cstdio>
#include <fstream>
#include <iostream>
#include <sstream>
#include "../../update_flow_core/flow_json.h"
#include "../resume_plan.h"

using flowjson::Value;
static int failures = 0;
static int cases = 0;
static void Check(bool ok, const std::string& name) {
  ++cases;
  if (!ok) { ++failures; std::fprintf(stderr, "FAIL: %s\n", name.c_str()); }
}
static Value Parse(const std::string& text) {
  bool ok = false;
  Value value = flowjson::Parse(text, &ok);
  Check(ok, "valid JSON result");
  return value;
}
static bool Equal(const Value& a, const Value& b) {
  if (a.kind() != b.kind()) return false;
  if (a.IsObject()) {
    if (a.members().size() != b.members().size()) return false;
    for (const auto& member : a.members())
      if (!Equal(member.second, b.Get(member.first))) return false;
    return true;
  }
  if (a.IsArray()) {
    if (a.Size() != b.Size()) return false;
    for (size_t i = 0; i < a.Size(); ++i)
      if (!Equal(a.At(i), b.At(i))) return false;
    return true;
  }
  return Value::StrictEquals(a, b);
}
static long long Int(const Value& v) { return static_cast<long long>(v.AsNumber()); }
static std::string Str(const Value& v) { return v.AsString(); }

int main(int argc, char** argv) {
  using namespace pakta::resume;
  if (argc > 1 && std::string(argv[1]) == "--rpc") {
    std::stringstream input;
    input << std::cin.rdbuf();
    const Value request = Parse(input.str());
    const Value& a = request.Get("args");
    const std::string op = Str(request.Get("op"));
    std::string result;
    if (op == "plan") result = PlanRequestJson(Str(a.At(0)), Str(a.At(1)), Int(a.At(2)));
    else if (op == "sidecar") result = SidecarJson(Str(a.At(0)), Str(a.At(1)),
        Str(a.At(2)), Str(a.At(3)), Int(a.At(4)));
    else result = ClassifyResponseJson(static_cast<int>(Int(a.At(0))), Int(a.At(1)),
        Str(a.At(2)), Str(a.At(3)), Int(a.At(4)), Str(a.At(5)), Str(a.At(6)), Int(a.At(7)));
    std::printf("%s", result.c_str());
    return failures ? 1 : 0;
  }
  const std::string url = "https://cdn.example.com/a.ppk";
  const std::string meta = SidecarJson(url, "\"v1\"", "", "", 10);
  for (long long size : {1LL, 3LL, 7LL, 9LL}) {
    Value plan = Parse(PlanRequestJson(meta, url, size));
    Check(plan.Get("action").AsString() == "resume" && Int(plan.Get("offset")) == size,
          "interrupted transfer resumes at actual file size");
    Check(plan.Get("headers").Get("If-Range").AsString() == "\"v1\"",
          "validator preserved");
    Value response = Parse(ClassifyResponseJson(206, size,
        "bytes " + std::to_string(size) + "-9/10", "", 10-size, meta, url, size));
    Check(response.Get("append").AsBool() && Int(response.Get("total")) == 10,
          "206 append and whole total");
  }
  Check(Parse(PlanRequestJson(meta, url, 10)).Get("action").AsString() == "complete",
        "death between download and extraction");
  Check(Parse(PlanRequestJson(meta, url + "?changed", 3)).Get("action").AsString() == "fresh",
        "URL identity mismatch");
  Check(Parse(PlanRequestJson(std::string(65537, 'x'), url, 3)).Get("action").AsString() == "fresh",
        "oversized sidecar");
  Check(Parse(ClassifyResponseJson(416, 3, "", "", 0, meta, url, 3)).Get("action").AsString() == "restart",
        "416 stale partial");
  Check(Parse(ClassifyResponseJson(416, 10, "", "", 0, meta, url, 10)).Get("action").AsString() == "complete",
        "416 complete partial");
  Check(!Parse(ClassifyResponseJson(200, 3, "", "", 10, meta, url, 3)).Get("append").AsBool(),
        "200 replaces partial");
  Check(Parse(ClassifyResponseJson(503, 3, "", "", 10, meta, url, 3)).Get("action").AsString() == "httpError",
        "error body never authorized");
  for (const std::string range : {"", "bytes 3x-9/10", "bytes 3-9/10abc",
      "bytes +3-9/10", "bytes 3-2/10", "bytes 3-9/9", "bytes 0-9/10",
      "bytes 3-9/99999999999999999999"}) {
    Check(ParseContentRangeTotal(range, 3) == -1, "invalid range: " + range);
    Check(Parse(ClassifyResponseJson(206, 3, range, "", 7, meta, url, 3))
        .Get("action").AsString() == "restart", "invalid range restarts");
  }
  Check(Parse(ClassifyResponseJson(206, 3, "bytes 3-9/10", "GZip", 7, meta, url, 3))
      .Get("action").AsString() == "restart", "encoded range restarts");
  Check(!Parse(ClassifyResponseJson(200, 0, "", "gzip", 10, "", url, 0))
      .Get("persistSidecar").AsBool(), "encoded transfer cannot resume");
  if (argc > 1) {
    std::ifstream in(argv[1]);
    std::stringstream buffer;
    buffer << in.rdbuf();
    const Value file = Parse(buffer.str());
    Check(file.IsObject(), "upstream vector file loaded");
    const std::string vector_url = Str(file.Get("url"));
    for (const auto& c : file.Get("contentRange").elements())
      Check(ParseContentRangeTotal(Str(c.Get("header")), Int(c.Get("start"))) ==
          Int(c.Get("expected")), "upstream range " + Str(c.Get("header")));
    for (const auto& c : file.Get("planRequest").elements())
      Check(Equal(Parse(PlanRequestJson(Str(c.Get("sidecar")), vector_url,
          Int(c.Get("size")))), c.Get("expected")), "upstream plan " + Str(c.Get("name")));
    for (const auto& c : file.Get("classifyResponse").elements())
      Check(Equal(Parse(ClassifyResponseJson(static_cast<int>(Int(c.Get("status"))),
          Int(c.Get("offset")), Str(c.Get("contentRange")), Str(c.Get("contentEncoding")),
          Int(c.Get("contentLength")), Str(c.Get("sidecar")), vector_url,
          Int(c.Get("size")))), c.Get("expected")), "upstream response " + Str(c.Get("name")));
    for (const auto& c : file.Get("sidecar").elements())
      Check(Equal(Parse(SidecarJson(vector_url, Str(c.Get("etag")),
          Str(c.Get("lastModified")), Str(c.Get("previous")), Int(c.Get("total")))),
          c.Get("expected")), "upstream sidecar " + Str(c.Get("name")));
  }
  std::printf("resume checks: %d, failures: %d\n", cases, failures);
  return failures ? 1 : 0;
}
