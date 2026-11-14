/**
 * [INPUT]: 依赖当前服务端点、RNU_SERVICE_URL、测试兼容开关与运行时网络请求
 * [OUTPUT]: 对外提供当前 Go 服务默认寻址、服务模式判定、健康探测和并发竞速
 * [POS]: CLI 网络寻址层；生产默认和所有无显式覆盖的请求只连接当前独立服务
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { defaultEndpoints } from './constants';
import { runtimeFetch } from './runtime';

export const ping = async (url: string, signal?: AbortSignal) => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await (Promise.race([
      runtimeFetch(url, {
        method: 'HEAD',
        signal,
      }).then(({ status }) => {
        if (status === 200) {
          return url;
        }
        throw new Error('ping failed');
      }),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error('ping timeout'));
        }, 5000);
      }),
    ]) as Promise<string | null>);
  } finally {
    // clear the timer so it doesn't keep the process alive for 5s
    clearTimeout(timer);
  }
};

const HEDGE_DELAY_MS = 250;

// Hedged race instead of pinging every endpoint at once: the preferred (first)
// url is tried immediately, each following one only after HEDGE_DELAY_MS of
// silence (or immediately when a previous ping failed). The first success wins
// and the losing pings are aborted. Falls back to urls[0] when all fail.
export const testUrls = async (
  urls?: string[],
  hedgeDelayMs: number = HEDGE_DELAY_MS,
) => {
  if (!urls?.length) {
    return null;
  }
  return new Promise<string>((resolve) => {
    const controllers: AbortController[] = [];
    let nextIndex = 0;
    let pending = 0;
    let settled = false;
    let hedgeTimer: ReturnType<typeof setTimeout> | undefined;

    const finish = (
      winner: string | null,
      winnerController?: AbortController,
    ) => {
      if (settled) {
        return;
      }
      settled = true;
      if (hedgeTimer) {
        clearTimeout(hedgeTimer);
      }
      for (const controller of controllers) {
        if (controller !== winnerController) {
          controller.abort();
        }
      }
      resolve(winner ?? urls[0]);
    };

    const launchNext = () => {
      if (hedgeTimer) {
        clearTimeout(hedgeTimer);
        hedgeTimer = undefined;
      }
      if (settled || nextIndex >= urls.length) {
        return;
      }
      const url = urls[nextIndex++];
      const controller = new AbortController();
      controllers.push(controller);
      pending++;
      ping(url, controller.signal).then(
        () => finish(url, controller),
        () => {
          pending--;
          if (settled) {
            return;
          }
          if (nextIndex < urls.length) {
            // A failure frees its slot: hedge the next url right away.
            launchNext();
          } else if (pending === 0) {
            finish(null);
          }
        },
      );
      if (!settled && nextIndex < urls.length) {
        hedgeTimer = setTimeout(launchNext, hedgeDelayMs);
      }
    };

    launchNext();
  });
};

let baseUrlPromise: Promise<string> | undefined;

export const isStandaloneService = (): boolean =>
  Boolean(process.env.RNU_SERVICE_URL) ||
  process.env.PAKTA_TEST_COMPAT_ROUTES !== '1';

async function resolveBaseUrl(): Promise<string> {
  const testEndpoint =
    process.env.RNU_SERVICE_URL ||
    process.env.PAKTA_REGISTRY ||
    process.env.RNU_API;
  if (testEndpoint) {
    return testEndpoint.replace(/\/+$/, '');
  }
  // Only the test fixture can select the old path shape; production always
  // resolves the current service and never probes a historical domain.
  return defaultEndpoints[0];
}

/**
 * The API base url: the explicit deployment override or the current default.
 * Resolved lazily on the first API call (offline commands such as `hdiff`/`help`
 * never resolve it) and memoized for the process lifetime.
 */
export const getBaseUrl = (): Promise<string> => {
  if (!baseUrlPromise) {
    baseUrlPromise = resolveBaseUrl();
  }
  return baseUrlPromise;
};
