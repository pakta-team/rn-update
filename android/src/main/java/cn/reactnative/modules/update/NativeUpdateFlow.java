/**
 * [INPUT]: 依赖 NativeUpdateCore 与 cpp/update_flow_core 的字符串 JSON JNI 实现
 * [OUTPUT]: 对内提供检查请求构造、端点排序和响应决策三个无 IO 原生入口
 * [POS]: NativeCheckOrchestrator 与跨平台纯决策核心之间的窄桥，不解释或持久化 JSON
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
package cn.reactnative.modules.update;

/**
 * JNI bindings to the shared update-flow decision layer
 * (cpp/update_flow_core). String-in/string-out JSON on purpose — it matches
 * the decision layer's own boundary and keeps this surface trivially stable.
 * A null return means the input did not parse; callers skip the check round.
 */
final class NativeUpdateFlow {
    static {
        NativeUpdateCore.ensureLoaded();
    }

    private NativeUpdateFlow() {
    }

    static native String buildCheckRequestBody(String inputJson);

    static native String orderEndpointCandidates(String endpointsJson, double randomSample);

    static native boolean isValidCheckResponse(String responseText);

    static native String handleCheckResponse(
        String responseText, String identityJson, String afterDownload);
}
