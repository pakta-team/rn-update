/**
 * [INPUT]: 依赖 rn-update 的 Pakta/UpdateProvider/useUpdate 与 localUpdateConfig 端点常量。
 * [OUTPUT]: 对外提供 Harmony e2e 最小 App，暴露 bundle label、hash、进度、生命周期事件和检查结果 testID。
 * [POS]: e2e bundle 的可观测 UI，被 entry.base/v1/v2/v4 共同复用并由 hdc 驱动断言。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Pakta, UpdateProvider, useUpdate } from 'rn-update';
import {
  getLocalUpdateEndpoint,
  LOCAL_UPDATE_APP_KEY,
  LOCAL_UPDATE_LABELS,
} from './localUpdateConfig';

let eventListener: ((type: string) => void) | null = null;
let checkResultListener: ((result: string) => void) | null = null;

function App() {
  const {
    checkUpdate,
    packageVersion,
    currentHash,
    lastError,
    client,
    progress: { received, total } = {},
  } = useUpdate();
  const [lastEvent, setLastEvent] = useState('(none)');
  const [lastCheckResult, setLastCheckResult] = useState('(none)');
  const bundleLabelGlobal = globalThis as typeof globalThis & {
    __RNU_E2E_BUNDLE_LABEL?: string;
  };
  const bundleLabel =
    bundleLabelGlobal.__RNU_E2E_BUNDLE_LABEL || LOCAL_UPDATE_LABELS.base;

  useEffect(() => {
    const onEvent = (type: string) => setLastEvent(type);
    const onCheckResult = (result: string) => setLastCheckResult(result);
    eventListener = onEvent;
    checkResultListener = onCheckResult;
    return () => {
      if (eventListener === onEvent) {
        eventListener = null;
      }
      if (checkResultListener === onCheckResult) {
        checkResultListener = null;
      }
    };
  }, []);

  return (
    <View style={styles.container}>
      <Text style={styles.welcome}>rn-update harmony e2e</Text>
      <Text testID="bundle-label">bundleLabel: {bundleLabel}</Text>
      <Text testID="current-hash">currentHash: {currentHash || '(empty)'}</Text>

      <Pressable
        testID="check-update"
        style={styles.button}
        onPress={() => {
          checkUpdate();
        }}
      >
        <Text style={styles.buttonText}>Check Update</Text>
      </Pressable>

      <Text testID="package-version">packageVersion: {packageVersion}</Text>
      <Text testID="client-version">clientVersion: {client?.version}</Text>
      <Text testID="last-event">lastEvent: {lastEvent}</Text>
      <Text testID="last-check-result">lastCheckResult: {lastCheckResult}</Text>
      <Text testID="endpoint" numberOfLines={1}>
        endpoint: {getLocalUpdateEndpoint()}
      </Text>
      <Text testID="progress">
        progress: {received || 0} / {total || 0}
      </Text>
      <Text testID="last-error" numberOfLines={1}>
        lastError: {lastError?.message || '(none)'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
    backgroundColor: '#F5FCFF',
  },
  welcome: {
    fontSize: 20,
    textAlign: 'center',
    marginBottom: 12,
  },
  button: {
    marginTop: 8,
    marginBottom: 8,
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
});

const updateClient = new Pakta({
  appKey: LOCAL_UPDATE_APP_KEY,
  server: {
    main: [getLocalUpdateEndpoint()],
  },
  debug: true,
  updateStrategy: 'silentAndNow',
  checkStrategy: null,
  afterCheckUpdate: (state: any) => {
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
    checkResultListener?.(resultKind);
  },
  logger: ({ type }: { type: string }) => {
    eventListener?.(type);
  },
});

export default function Root() {
  return (
    <UpdateProvider client={updateClient}>
      <App />
    </UpdateProvider>
  );
}
