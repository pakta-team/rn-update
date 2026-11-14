package cn.reactnative.modules.update;

/**
 * [INPUT]: 依赖 NativeUpdateFlow.normalizeConfiguration 的 JNI 共享归一化能力及 JSONException 签名兼容
 * [OUTPUT]: 对内提供 normalize(String) JSON 快照委托，共享核拒绝 channel；原生返回 null 时抛 IllegalStateException
 * [POS]: PaktaNativeUpdate.configure 的配置适配器，不再独立维护白名单/URL 算法，不落盘或变更更新状态
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import org.json.JSONException;

/** Internal normalizer for the JSONObject accepted by PaktaNativeUpdate.configure. */
final class NativeUpdateConfig {
    private NativeUpdateConfig() {}

    static String normalize(String json) throws JSONException {
        String result = NativeUpdateFlow.normalizeConfiguration(json);
        if (result == null) throw new IllegalStateException("Native configuration unavailable");
        return result;
    }
}
