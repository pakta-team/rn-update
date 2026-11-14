/**
 * [INPUT]: 依赖 @ohos.hilog 的 domain/prefix/format 记录能力与调用方字符串参数
 * [OUTPUT]: 对外提供 pakta Logger 单例，收敛 debug/info/warn/error 日志格式
 * [POS]: Harmony 平台日志适配层，业务模块不直接散落 hilog 参数或 console 策略
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import hilog from '@ohos.hilog';

class Logger {
  private domain: number;
  private prefix: string;
  private format: string = '%{public}s,%{public}s';
  private isDebug: boolean;

  constructor(
    prefix: string = 'MyApp',
    domain: number = 0xff00,
    isDebug = false,
  ) {
    this.prefix = prefix;
    this.domain = domain;
    this.isDebug = isDebug;
  }

  // debug 级别默认关闭;宿主处于 RN 调试模式(RNOH isDebugModeEnabled)时由
  // TurboModule 在启动时打开,方便接入调试。info/warn/error 永远输出。
  // (HAR 自身没有可靠的构建期 DEBUG 信号:hvigor 只为宿主模块生成
  // BuildProfile,在 HAR 里 import 'BuildProfile' 无法解析。)
  setDebug(enabled: boolean): void {
    this.isDebug = enabled;
  }

  private tagOf(args: string[]): string {
    return args.length > 0 ? args[0] : '';
  }

  private messageOf(args: string[]): string {
    return args.length > 1 ? args.slice(1).join(' ') : '';
  }

  debug(...args: string[]): void {
    if (this.isDebug) {
      hilog.debug(
        this.domain,
        this.prefix,
        this.format,
        this.tagOf(args),
        this.messageOf(args),
      );
    }
  }

  info(...args: string[]): void {
    hilog.info(
      this.domain,
      this.prefix,
      this.format,
      this.tagOf(args),
      this.messageOf(args),
    );
  }

  warn(...args: string[]): void {
    hilog.warn(
      this.domain,
      this.prefix,
      this.format,
      this.tagOf(args),
      this.messageOf(args),
    );
  }

  error(...args: string[]): void {
    hilog.error(
      this.domain,
      this.prefix,
      this.format,
      this.tagOf(args),
      this.messageOf(args),
    );
  }
}

export default new Logger('pakta', 0xff00, false);
