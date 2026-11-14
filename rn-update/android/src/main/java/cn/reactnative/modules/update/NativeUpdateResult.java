package cn.reactnative.modules.update;

/**
 * [INPUT]: 无外部依赖，纯值对象
 * [OUTPUT]: 对外提供五个状态常量（SKIPPED/NO_UPDATE/DOWNLOADED/FAILED/CANCELLED）与 of()/downloaded() 工厂、getStatus/getReason/getHash/isActivated
 * [POS]: Android 无桥检查轮的不可变快照，由 PaktaNativeUpdate 产出、宿主 Callback 消费；downloaded 不代表运行中的 RN 实例已重载
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

/**
 * Snapshot of a native check-and-update round. A downloaded result does not
 * mean that the running React Native instance has been reloaded.
 */
public final class NativeUpdateResult {
    public static final String SKIPPED = "skipped";
    public static final String NO_UPDATE = "noUpdate";
    public static final String DOWNLOADED = "downloaded";
    public static final String FAILED = "failed";
    public static final String CANCELLED = "cancelled";

    private final String status;
    private final String reason;
    private final String hash;
    private final boolean activated;

    private NativeUpdateResult(String status, String reason, String hash, boolean activated) {
        this.status = status;
        this.reason = reason;
        this.hash = hash;
        this.activated = activated;
    }

    static NativeUpdateResult of(String status, String reason) {
        return new NativeUpdateResult(status, reason, "", false);
    }

    static NativeUpdateResult downloaded(String hash, boolean activated) {
        return new NativeUpdateResult(DOWNLOADED, "", hash, activated);
    }

    public String getStatus() {
        return status;
    }

    public String getReason() {
        return reason;
    }

    /** Installed update hash, or an empty string when this round installed nothing. */
    public String getHash() {
        return hash;
    }

    /** Whether this round selected the downloaded version for the next launch. */
    public boolean isActivated() {
        return activated;
    }
}
