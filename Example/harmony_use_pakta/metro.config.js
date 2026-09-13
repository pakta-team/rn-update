/**
 * [INPUT]: 依赖 RN Metro 默认配置与 @react-native-oh/react-native-harmony 的 Harmony transformer/resolver。
 * [OUTPUT]: 导出合并后的 Metro 配置，供普通 RN 与 Harmony e2e bundle 构建使用。
 * [POS]: harmony_use_pakta JavaScript 打包边界，决定 RNOH 模块如何被解析和转换。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const { mergeConfig, getDefaultConfig } = require('@react-native/metro-config');
const {
  createHarmonyMetroConfig,
} = require('@react-native-oh/react-native-harmony/metro.config');

const configuredMaxWorkers = Number(process.env.RNU_METRO_MAX_WORKERS || 2);
const maxWorkers = Number.isFinite(configuredMaxWorkers)
  ? Math.max(1, Math.floor(configuredMaxWorkers))
  : 2;

/**
 * @type {import("metro-config").ConfigT}
 */
const config = {
  // Harmony 模拟器与 Metro 会同时占用较多内存；允许 CI/本机按宿主资源
  // 限制 worker 数量，避免默认逻辑 CPU 数在 Windows 上触发 Node OOM。
  maxWorkers,
  transformer: {
    getTransformOptions: async () => ({
      transform: {
        experimentalImportSupport: false,
        inlineRequires: true,
      },
    }),
  },
};

module.exports = mergeConfig(
  getDefaultConfig(__dirname),
  createHarmonyMetroConfig({
    reactNativeHarmonyPackageName: '@react-native-oh/react-native-harmony',
  }),
  config
);
