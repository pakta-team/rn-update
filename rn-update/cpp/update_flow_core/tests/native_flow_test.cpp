#include <cstdio>
#include <fstream>
#include <sstream>
#include <string>

#include "../native_config.h"
#include "../native_round.h"
#include "../round_engine.h"

using flowjson::Value;
namespace core = pakta::updateflow;

namespace {
int failures = 0;
size_t checks = 0;

Value Json(const std::string& text) {
  bool ok = false;
  Value result = flowjson::Parse(text, &ok);
  if (!ok) {
    std::fprintf(stderr, "invalid test JSON: %.120s\n", text.c_str());
    failures++;
  }
  return result;
}

void Equal(const Value& actual, const Value& expected, const std::string& name) {
  checks++;
  if (!Value::DeepEquals(actual, expected)) {
    std::fprintf(stderr, "%s\nexpected: %s\nactual: %s\n", name.c_str(),
                 flowjson::Stringify(expected).c_str(),
                 flowjson::Stringify(actual).c_str());
    failures++;
  }
}

Value Adapt(Value value) {
  if (value.IsString()) {
    const auto& text = value.AsString();
    if (!text.empty() && (text.front() == '{' || text.front() == '[')) {
      bool ok = false;
      Value parsed = flowjson::Parse(text, &ok);
      if (ok) return Value::String(flowjson::Stringify(Adapt(parsed)));
    }
    return value;
  }
  if (value.IsArray()) {
    Value result = Value::Array();
    for (const auto& item : value.elements()) result.Push(Adapt(item));
    return result;
  }
  if (value.IsObject()) {
    Value result = Value::Object();
    for (const auto& item : value.members()) result.Set(item.first, Adapt(item.second));
    if (!value.Get("cInfo").IsUndefined() && value.Get("channel").IsUndefined()) {
      Value body = Value::Object();
      for (const auto& item : result.members()) {
        body.Set(item.first, item.second);
        if (item.first == "packageVersion") body.Set("channel", Value::String("default"));
      }
      return body;
    }
    return result;
  }
  return value;
}

Value Fixtures(const Value& value, const Value& fixtures) {
  if (value.IsString() && !value.AsString().empty() && value.AsString()[0] == '@') {
    const Value result = fixtures.Get(value.AsString().substr(1));
    if (result.IsUndefined()) failures++;
    return result;
  }
  if (value.IsArray()) {
    Value result = Value::Array();
    for (const auto& item : value.elements()) result.Push(Fixtures(item, fixtures));
    return result;
  }
  if (value.IsObject()) {
    Value result = Value::Object();
    for (const auto& item : value.members()) result.Set(item.first, Fixtures(item.second, fixtures));
    return result;
  }
  return value;
}

void Config(const Value& doc) {
  for (const auto& c : doc.Get("cases").elements()) {
    Equal(Value::Bool(core::ConfigsEquivalent(c.Get("a").AsString(), c.Get("b").AsString())),
          c.Get("equivalent"), c.Get("name").AsString());
    Equal(Value::Bool(core::ConfigsEquivalent(c.Get("b").AsString(), c.Get("a").AsString())),
          c.Get("equivalent"), c.Get("name").AsString());
  }
  for (const auto& c : doc.Get("runnable").elements()) {
    Equal(Json(core::RunnableConfigJson(c.Get("config").AsString())), c.Get("expected"), c.Get("name").AsString());
  }
  for (const auto& c : doc.Get("normalize").elements()) {
    std::string out, error;
    bool ok = core::NormalizeConfiguration(c.Get("options").AsString(), &out, &error);
    if (c.Get("expected").IsString()) {
      Value expected = Json(c.Get("expected").AsString());
      expected.Set("channel", Value::String("default"));
      const Value options = Json(c.Get("options").AsString());
      if (options.Get("endpoints").IsUndefined()) {
        expected.Set("endpoints", Json("[\"https://pakta.yoghourt.space/api\"]"));
        if (options.Get("queryUrls").IsUndefined()) {
          expected.Set("queryUrls", Json("[\"https://cdn.jsdelivr.net/gh/pakta-team/rn-update@main/endpoints.json\"]"));
        }
      }
      Equal(ok ? Json(out) : Value::String(error), expected, c.Get("name").AsString());
    } else {
      Equal(Value::String(ok ? out : error), c.Get("error"), c.Get("name").AsString());
    }
  }
}

void NativeRound(const Value& doc) {
  for (const auto& c : doc.Get("prepare").elements()) {
    Value actual = core::PrepareRound(c.Get("config").AsString(), c.Get("env"), c.Get("sample").AsNumber());
    if (actual.IsObject()) actual.Set("body", Json(actual.Get("body").AsString()));
    Equal(actual, Adapt(c.Get("expected")), c.Get("name").AsString());
  }
  for (const auto& c : doc.Get("query").elements()) {
    Value state = core::PrepareRound(c.Get("config").AsString(), c.Get("env"), c.Get("sample").AsNumber()).Get("query");
    Value requests = Value::Array(), text, found = Value::Null();
    for (int i = 0; i < 64; ++i) {
      state = core::NextQueryStep(state, text);
      if (state.Get("found").Truthy()) { found = text; break; }
      if (!state.Get("url").IsString()) break;
      const auto url = state.Get("url").AsString();
      requests.Push(Value::String((state.Get("post").Truthy() ? "POST " : "GET ") + url));
      text = c.Get("responses").Get(url);
    }
    Value actual = Value::Object();
    actual.Set("requests", requests);
    actual.Set("result", found);
    Equal(actual, c.Get("expected"), c.Get("name").AsString());
  }
  for (const auto& c : doc.Get("respond").elements()) {
    Equal(core::HandleRoundResponse(c.Get("response").AsString(), c.Get("config").AsString(), c.Get("env"), c.Get("request").AsString(), c.Get("ts").AsNumber()),
          c.Get("expected"), c.Get("name").AsString());
  }
}

void Engine(const Value& doc) {
  const Value fixtures = Adapt(doc.Get("fixtures"));
  for (const auto& c : doc.Get("rounds").elements()) {
    Value state;
    std::string stateJson;
    for (const auto& step : c.Get("steps").elements()) {
      Value event = Fixtures(step.Get("event"), fixtures);
      Value result = core::StepRound(state, event);
      Equal(result.Get("commands"), Fixtures(Adapt(step.Get("commands")), fixtures), c.Get("name").AsString());
      Equal(Json(core::StepRoundJson(stateJson, flowjson::Stringify(event))), result, "JSON/value parity");
      state = result.Get("state");
      stateJson = flowjson::Stringify(state);
    }
    Equal(state.Get("phase"), Value::String("done"), c.Get("name").AsString());
  }
  for (const auto& raw : doc.Get("host").elements()) {
    Value c = Fixtures(raw, fixtures);
    Equal(Value::String(core::HostCancellation(c.Get("hostConfig").AsString(), c.Get("roundConfig").AsString(), c.Get("storedConfig").AsString(), c.Get("roundConfigGeneration").AsNumber(), c.Get("configGeneration").AsNumber(), c.Get("roundResetGeneration").AsNumber(), c.Get("resetGeneration").AsNumber())), c.Get("expected"), c.Get("name").AsString());
  }
  for (const auto& c : doc.Get("safePath").elements()) {
    Equal(Value::Bool(core::IsSafePathComponent(c.Get("name").AsString())), c.Get("expected"), "safePath");
  }
}

void Local(const Value& doc) {
  for (const auto& c : doc.Get("local").elements()) {
    const auto op = c.Get("op").AsString();
    Value actual;
    if (op == "prepare") {
      const Value round = core::PrepareRound(c.Get("config").AsString(), c.Get("env"), 0);
      actual = Json(round.Get("body").AsString());
    } else if (op == "normalize") {
      std::string out, error;
      actual = core::NormalizeConfiguration(c.Get("config").AsString(), &out, &error)
                   ? Json(out) : Value::String(error);
    } else if (op == "respond") {
      actual = core::HandleRoundResponse(c.Get("response").AsString(), c.Get("config").AsString(), c.Get("env"), c.Get("request").AsString(), 42);
    } else if (op == "queryBudget") {
      Value state = c.Get("state");
      int count = 0;
      while (count <= 8) {
        state = core::NextQueryStep(state, Value::Undefined());
        if (!state.Get("url").IsString()) break;
        ++count;
      }
      actual = Value::Number(count);
    } else if (op == "cancelPhases") {
      bool passed = true;
      for (const char* phase : {"env", "http", "installed", "download", "committed"}) {
        Value state = Value::Object();
        state.Set("phase", Value::String(phase));
        Value event = Json("{\"type\":\"cancel\",\"reason\":\"config_changed\",\"now\":2}");
        Value result = core::StepRound(state, event);
        Equal(Json(core::StepRoundJson(flowjson::Stringify(state), flowjson::Stringify(event))), result, "cancel JSON/value parity");
        Equal(result.Get("commands"), Json("[{\"type\":\"finish\",\"status\":\"cancelled\",\"reason\":\"config_changed\"}]"), phase);
        event.Set("type", Value::String(phase));
        const Value late = core::StepRound(result.Get("state"), event);
        Equal(late.Get("commands"), Value::Array(), "late cancelled event");
        passed = passed && late.Get("state").Get("phase").AsString() == "done";
      }
      actual = Value::Bool(passed);
    } else if (op == "broken") {
      actual = Json(core::StepRoundJson(c.Get("state").AsString(), c.Get("event").AsString())).Get("commands");
    } else {
      std::fprintf(stderr, "unknown local op %s\n", op.c_str());
      failures++;
    }
    Equal(actual, c.Get("expected"), c.Get("name").AsString());
  }
}
}

int main(int argc, char** argv) {
  if (argc < 2) return 2;
  for (int i = 1; i < argc; ++i) {
    std::ifstream file(argv[i]);
    if (!file) return 2;
    std::stringstream text;
    text << file.rdbuf();
    Value doc = Json(text.str());
    const size_t before = checks;
    Config(doc);
    NativeRound(doc);
    Engine(doc);
    Local(doc);
    if (before == checks) return 2;
    std::printf("%s: %zu assertions\n", argv[i], checks - before);
  }
  std::printf("native flow: %zu assertions, %d failures\n", checks, failures);
  return failures ? 1 : 0;
}
