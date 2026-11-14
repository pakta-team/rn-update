#pragma once
#include "resume_plan.h"

static napi_value ResumeParseContentRange(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value args[2] = {};
  if (!GetArgCount(env, info, &argc, args) || argc != 2) {
    ThrowError(env, "resumeParseContentRange: missing arguments");
    return nullptr;
  }
  try {
    bool ok = false;
    const std::string range = GetString(env, args[0], &ok);
    if (!ok) return nullptr;
    int64_t start = 0;
    if (napi_get_value_int64(env, args[1], &start) != napi_ok) {
      ThrowError(env, "resumeParseContentRange: expected start");
      return nullptr;
    }
    napi_value result = nullptr;
    napi_create_int64(env, pakta::resume::ParseContentRangeTotal(range, start), &result);
    return result;
  } catch (...) {
    ThrowError(env, "resumeParseContentRange failed");
    return nullptr;
  }
}

static napi_value ResumePlanRequest(napi_env env, napi_callback_info info) {
  size_t argc = 3;
  napi_value args[3] = {};
  if (!GetArgCount(env, info, &argc, args) || argc != 3) {
    ThrowError(env, "resumePlanRequest: missing arguments");
    return nullptr;
  }
  try {
    bool ok = false;
    const std::string text = GetString(env, args[0], &ok);
    if (!ok) return nullptr;
    const std::string url = GetString(env, args[1], &ok);
    if (!ok) return nullptr;
    int64_t size = 0;
    if (napi_get_value_int64(env, args[2], &size) != napi_ok) {
      ThrowError(env, "resumePlanRequest: expected size");
      return nullptr;
    }
    return MakeUtf8String(env, pakta::resume::PlanRequestJson(text, url, size));
  } catch (...) {
    ThrowError(env, "resumePlanRequest failed");
    return nullptr;
  }
}

static napi_value ResumeClassifyResponse(napi_env env, napi_callback_info info) {
  size_t argc = 8;
  napi_value args[8] = {};
  if (!GetArgCount(env, info, &argc, args) || argc != 8) {
    ThrowError(env, "resumeClassifyResponse: missing arguments");
    return nullptr;
  }
  try {
    int32_t status = 0;
    int64_t offset = 0, length = 0, size = 0;
    if (napi_get_value_int32(env, args[0], &status) != napi_ok ||
        napi_get_value_int64(env, args[1], &offset) != napi_ok ||
        napi_get_value_int64(env, args[4], &length) != napi_ok ||
        napi_get_value_int64(env, args[7], &size) != napi_ok) {
      ThrowError(env, "resumeClassifyResponse: expected numbers");
      return nullptr;
    }
    bool ok = false;
    const std::string range = GetString(env, args[2], &ok);
    if (!ok) return nullptr;
    const std::string encoding = GetString(env, args[3], &ok);
    if (!ok) return nullptr;
    const std::string text = GetString(env, args[5], &ok);
    if (!ok) return nullptr;
    const std::string url = GetString(env, args[6], &ok);
    if (!ok) return nullptr;
    return MakeUtf8String(env, pakta::resume::ClassifyResponseJson(
        status, offset, range, encoding, length, text, url, size));
  } catch (...) {
    ThrowError(env, "resumeClassifyResponse failed");
    return nullptr;
  }
}

static napi_value ResumeSidecar(napi_env env, napi_callback_info info) {
  size_t argc = 5;
  napi_value args[5] = {};
  if (!GetArgCount(env, info, &argc, args) || argc != 5) {
    ThrowError(env, "resumeSidecar: missing arguments");
    return nullptr;
  }
  try {
    std::string strings[4];
    for (size_t i = 0; i < 4; ++i) {
      bool ok = false;
      strings[i] = GetString(env, args[i], &ok);
      if (!ok) return nullptr;
    }
    int64_t total = 0;
    if (napi_get_value_int64(env, args[4], &total) != napi_ok) {
      ThrowError(env, "resumeSidecar: expected total");
      return nullptr;
    }
    return MakeUtf8String(env, pakta::resume::SidecarJson(
        strings[0], strings[1], strings[2], strings[3], total));
  } catch (...) {
    ThrowError(env, "resumeSidecar failed");
    return nullptr;
  }
}
