/**
 * [INPUT]: 依赖 React Native UI、rn-update Pakta/UpdateProvider、本地测试配置与可选真服务运行时配置
 * [OUTPUT]: 对外提供 e2etest 首屏组件、更新按钮、原生 channel/buildTime/bundleHash 与服务端 bundleStatus 诊断和 Detox testID
 * [POS]: 样例消费端唯一 UI 入口；默认消费本地 E2E 服务，也允许构建入口注入真实服务以验证控制面到真机的数据闭环
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  Pakta,
  UpdateModule,
  UpdateProvider,
  buildTime as nativeBuildTime,
  channel as nativeChannel,
  useUpdate,
} from 'rn-update';
import {
  getLocalUpdateEndpoint,
  LOCAL_UPDATE_APP_KEYS,
  LOCAL_UPDATE_LABELS,
} from '../e2e/localUpdateConfig.ts';

let eventListener:
  | ((type: string, data?: Record<string, unknown>) => void)
  | null = null;
let checkStateListener:
  | ((state: {
      status: string;
      resultKind: string;
      hash?: string;
      bundleStatus?: string;
    }) => void)
  | null = null;
type UpdateStrategyMode = 'silentAndNow' | 'silentAndLater';
const updatePlatform = Platform.OS === 'android' ? 'android' : 'ios';
type RuntimeUpdateConfig = {
  appKey: string;
  endpoint: string;
};
const runtimeGlobal = globalThis as typeof globalThis & {
  __RNU_E2E_UPDATE_CONFIG?: RuntimeUpdateConfig;
};
const runtimeUpdateConfig = runtimeGlobal.__RNU_E2E_UPDATE_CONFIG;
const updateAppKey =
  runtimeUpdateConfig?.appKey || LOCAL_UPDATE_APP_KEYS[updatePlatform];
const updateEndpoint =
  runtimeUpdateConfig?.endpoint || getLocalUpdateEndpoint(updatePlatform);

function App() {
  const {
    checkUpdate,
    client: contextClient,
    packageVersion,
    currentHash,
    lastError,
    progress: { received, total } = {},
    currentVersionInfo,
    resetToPackagedBundle,
  } = useUpdate();
  if (!contextClient) {
    throw new Error('UpdateProvider did not provide a client');
  }
  const client = contextClient;
  const [lastEvent, setLastEvent] = useState('idle');
  const [lastEventData, setLastEventData] = useState('(empty)');
  const [lastEventVersion, setLastEventVersion] = useState('(none)');
  const [lastCheckStatus, setLastCheckStatus] = useState('(none)');
  const [lastCheckResult, setLastCheckResult] = useState('(none)');
  const [lastBundleStatus, setLastBundleStatus] = useState('(none)');
  const [nativeBundleHash, setNativeBundleHash] = useState('(pending)');
  const [selectedStrategy, setSelectedStrategy] =
    useState<UpdateStrategyMode>('silentAndNow');
  const bundleLabelGlobal = globalThis as typeof globalThis & {
    __RNU_E2E_BUNDLE_LABEL?: string;
  };
  const bundleLabel =
    bundleLabelGlobal.__RNU_E2E_BUNDLE_LABEL || LOCAL_UPDATE_LABELS.base;

  const applyStrategy = (strategy: UpdateStrategyMode) => {
    client.setOptions({ updateStrategy: strategy });
    setSelectedStrategy(strategy);
  };

  useEffect(() => {
    let active = true;
    Promise.resolve(UpdateModule.getBundleHash())
      .then((hash: string) => {
        if (active) {
          setNativeBundleHash(hash || '(empty)');
        }
      })
      .catch((error: unknown) => {
        if (active) {
          const message =
            error instanceof Error ? error.message : String(error);
          setNativeBundleHash(`(error: ${message})`);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const listener = (type: string, data?: Record<string, unknown>) => {
      setLastEvent(type);
      const message = JSON.stringify(data ?? {});
      setLastEventData(message || '(empty)');
      setLastEventVersion(
        typeof data?.newVersion === 'string' ? data.newVersion : '(none)'
      );
    };
    const checkListener = (state: {
      status: string;
      resultKind: string;
      hash?: string;
      bundleStatus?: string;
    }) => {
      setLastCheckStatus(state.status);
      setLastCheckResult(
        state.hash ? `${state.resultKind}:${state.hash}` : state.resultKind
      );
      setLastBundleStatus(state.bundleStatus || '(none)');
    };
    eventListener = listener;
    checkStateListener = checkListener;
    return () => {
      if (eventListener === listener) {
        eventListener = null;
      }
      if (checkStateListener === checkListener) {
        checkStateListener = null;
      }
    };
  }, []);

  return (
    <View style={styles.container}>
      <Text style={styles.welcome}>rn-update e2etest (JS changed)</Text>
      <Text testID="bundle-label">bundleLabel: {bundleLabel}</Text>
      <Text testID="current-hash">currentHash: {currentHash || '(empty)'}</Text>
      <Text testID="bundle-hash">bundleHash: {nativeBundleHash}</Text>
      <Text testID="channel">channel: {nativeChannel}</Text>
      <Text testID="build-time">
        buildTime: {nativeBuildTime || '(empty)'}
      </Text>
      <Text testID="update-strategy">updateStrategy: {selectedStrategy}</Text>

      <View style={styles.buttonRow}>
        <Pressable
          testID="strategy-silent-now"
          style={styles.button}
          onPress={() => {
            applyStrategy('silentAndNow');
          }}
        >
          <Text style={styles.buttonText}>Use SilentAndNow</Text>
        </Pressable>

        <Pressable
          testID="strategy-silent-later"
          style={styles.button}
          onPress={() => {
            applyStrategy('silentAndLater');
          }}
        >
          <Text style={styles.buttonText}>Use SilentAndLater</Text>
        </Pressable>
        <Pressable
          testID="reset-to-packaged"
          style={styles.button}
          onPress={async () => {
            setLastEvent('triggerReset');
            // 静默失败语义:失败不抛错而是返回 false,错误进 lastError
            const ok = await resetToPackagedBundle({ restart: false });
            setLastEvent(ok ? 'resetDone' : 'resetFailed');
          }}
        >
          <Text style={styles.buttonText}>Reset</Text>
        </Pressable>
      </View>

      <Pressable
        testID="check-update"
        style={styles.button}
        onPress={() => {
          setLastEvent('triggerCheckUpdate');
          setLastEventData('(manual)');
          setLastEventVersion('(none)');
          checkUpdate();
        }}
      >
        <Text style={styles.buttonText}>Check Update</Text>
      </Pressable>

      <Text testID="package-version">packageVersion: {packageVersion}</Text>
      <Text testID="client-version">clientVersion: {client?.version}</Text>
      <Text testID="endpoint" style={styles.diagnosticText} numberOfLines={1}>
        endpoint: {updateEndpoint}
      </Text>
      <Text testID="progress">
        progress: {received || 0} / {total || 0}
      </Text>
      <Text testID="last-event">lastEvent: {lastEvent}</Text>
      <Text
        testID="last-event-data"
        style={styles.diagnosticText}
        numberOfLines={1}
      >
        lastEventData: {lastEventData}
      </Text>
      <Text testID="last-event-version">
        lastEventVersion: {lastEventVersion}
      </Text>
      <Text testID="last-check-status">lastCheckStatus: {lastCheckStatus}</Text>
      <Text testID="last-check-result">lastCheckResult: {lastCheckResult}</Text>
      <Text testID="bundle-status">bundleStatus: {lastBundleStatus}</Text>
      <Text testID="last-error" style={styles.diagnosticText} numberOfLines={1}>
        lastError: {lastError?.message || '(none)'}
      </Text>
      <Text
        testID="version-info"
        style={styles.diagnosticText}
        numberOfLines={1}
      >
        currentVersionInfo: {JSON.stringify(currentVersionInfo) || '(empty)'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 24,
    backgroundColor: '#F5FCFF',
  },
  welcome: {
    fontSize: 20,
    textAlign: 'center',
    marginBottom: 12,
  },
  buttonRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
  },
  button: {
    marginTop: 8,
    borderRadius: 8,
    backgroundColor: '#0a84ff',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  buttonText: {
    textAlign: 'center',
    color: '#ffffff',
    fontWeight: '600',
  },
  diagnosticText: {
    maxWidth: '100%',
  },
});

const updateClient = new Pakta({
  appKey: updateAppKey,
  server: {
    main: [updateEndpoint],
  },
  debug: true,
  updateStrategy: 'silentAndNow',
  checkStrategy: null,
  autoMarkSuccess: true,
  afterCheckUpdate: (state) => {
    const result = state.result;
    const resultKind = result?.update
      ? 'update'
      : result?.upToDate
        ? 'upToDate'
        : result?.expired
          ? 'expired'
          : result?.paused
            ? `paused:${result.paused}`
            : '(none)';
    checkStateListener?.({
      status: state.status,
      resultKind,
      hash: result?.hash,
      bundleStatus: result?.bundleStatus,
    });
  },
  logger: ({ type, data }) => {
    eventListener?.(type, data);
  },
});

export default function Root() {
  return (
    <UpdateProvider client={updateClient}>
      <App />
    </UpdateProvider>
  );
}
