/**
 * [INPUT]: 依赖 Metro 默认配置、文件缓存、e2etest 依赖树与仓库根 SDK 源码
 * [OUTPUT]: 对外提供强制解析当前工作树 SDK、锁定宿主 React 单例的 resolver，以及受控 watch/cache/worker 配置
 * [POS]: e2etest Metro 构建边界，确保 bundle 消费当前工作树且不引入第二份 React Native
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const path = require('node:path');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');
const { FileStore } = require('metro-cache');

const sdkRoot = path.resolve(__dirname, '../..');
const sdkSourceRoot = path.join(sdkRoot, 'src');
const appNodeModules = path.join(__dirname, 'node_modules');
const sdkNodeModules = path.join(sdkRoot, 'node_modules');
const defaultConfig = getDefaultConfig(__dirname);

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const sdkNodeModulesBlockList = new RegExp(
  `^${escapeRegExp(sdkNodeModules)}[\\\\/].*`
);

const defaultBlockList = defaultConfig.resolver.blockList;
const blockListPatterns = Array.isArray(defaultBlockList)
  ? defaultBlockList
  : [defaultBlockList];
const combinedBlockList = new RegExp(
  `(?:${[...blockListPatterns, sdkNodeModulesBlockList]
    .map((pattern) => pattern.source)
    .join('|')})`
);

function mapPackage(moduleName, packageName, packageRoot, entryFile) {
  if (moduleName === packageName) {
    return entryFile || packageRoot;
  }

  const prefix = `${packageName}/`;
  return moduleName.startsWith(prefix)
    ? path.join(packageRoot, moduleName.slice(prefix.length))
    : null;
}

function isInside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return (
    relative === '' ||
    (!relative.startsWith('..') && !path.isAbsolute(relative))
  );
}

function mapModuleName(moduleName, originModulePath = '') {
  // SDK 的版本号来自工作树 package.json，避免 node_modules 中旧发布包的
  // 元数据把本地源码伪装成旧版本；实际 JS/native 入口同样固定到 sdkRoot。
  if (
    moduleName === '../package.json' &&
    originModulePath &&
    isInside(sdkSourceRoot, originModulePath)
  ) {
    return path.join(sdkRoot, 'package.json');
  }

  return (
    mapPackage(
      moduleName,
      'rn-update',
      sdkRoot,
      path.join(sdkSourceRoot, 'index.ts')
    ) ||
    mapPackage(moduleName, 'react', path.join(appNodeModules, 'react')) ||
    mapPackage(
      moduleName,
      'react-native',
      path.join(appNodeModules, 'react-native')
    ) ||
    moduleName
  );
}

function resolveRequest(context, moduleName, platform) {
  return context.resolveRequest(
    context,
    mapModuleName(moduleName, context.originModulePath),
    platform
  );
}

// 守门器读取这些只读元数据，对实际 Metro 配置不增加自定义字段。
resolveRequest.localSdkRoot = sdkRoot;
resolveRequest.mapModuleName = mapModuleName;

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const config = {
  // 观察 SDK 根以包含 package.json 身份文件；resolver.blockList 排除根
  // node_modules，因此不会把第二棵依赖树纳入 Metro 文件地图或拖慢 Windows
  // 首次 cache 构建。app 的 node_modules 仍是唯一 React/RN 实例来源。
  watchFolders: [sdkRoot],
  resolver: {
    blockList: combinedBlockList,
    // 当前本地 SDK 依赖 nanoid/non-secure；Metro 的条件 exports 会把它
    // 解析到 .cjs，React Native bundle 阶段无法消费，回退文件解析即可。
    unstable_enablePackageExports: false,
    // extraNodeModules 的优先级低于逐级 node_modules 查找，单独使用会让
    // e2etest 静默打进已发布旧包。resolveRequest 必须先把目标改成绝对路径。
    resolveRequest,
    extraNodeModules: {
      react: path.join(appNodeModules, 'react'),
      'react-native': path.join(appNodeModules, 'react-native'),
      'rn-update': sdkRoot,
    },
    nodeModulesPaths: [appNodeModules],
  },
  // transform cache 是内容寻址的,落到项目内固定目录让 CI 用 actions/cache
  // 跨 run 持久化(prep 的 4 次 ppk 打包 + xcodebuild 里的基座打包共享)。
  cacheStores: [new FileStore({ root: path.join(__dirname, '.metro-cache') })],
  // Windows/CI runners can expose many logical CPUs but limited memory; the
  // default worker count otherwise spawns enough Hermes transforms to OOM.
  maxWorkers: Number(process.env.RNU_METRO_MAX_WORKERS || 2),
};

module.exports = mergeConfig(defaultConfig, config);
