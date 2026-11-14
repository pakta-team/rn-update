/**
 * [INPUT]: 依赖 NativeUpdateCore 与 android/jni/native_round_jni 的共享配置及轮次绑定
 * [OUTPUT]: 对内提供 StepRound、配置归一化/门禁/等价与宿主取消入口
 * [POS]: Android 配置适配和轮次执行器到共享纯核的窄桥，不解释或持久化 JSON
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

    static native String stepRound(String stateJson, String eventJson);

    static native String runnableConfig(String configJson);

    static native String normalizeConfiguration(String optionsJson);

    static native boolean configsEquivalent(String first, String second);

    static native String hostCancellation(String hostConfig, String roundConfig, String storedConfig,
        long roundConfigGeneration, long configGeneration, long roundResetGeneration, long resetGeneration);
}
