/**
 * [INPUT]: 依赖 e2etest 的 RN CLI/Metro 强制解析配置、安装包元数据与仓库根 package.json
 * [OUTPUT]: 对外提供原生根、JS 入口、React 单例和版本元数据一致性断言，失败即阻断假验证
 * [POS]: e2etest 构建/测试前置守门器，防止 node_modules 发布包掩盖当前工作树
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const fs = require('node:fs');
const path = require('node:path');

function assertLocalSdk() {
  const projectRoot = path.resolve(__dirname, '..');
  const sdkRoot = path.resolve(projectRoot, '../..');
  const sdkPackage = JSON.parse(
    fs.readFileSync(path.join(sdkRoot, 'package.json'), 'utf8')
  );
  const rnConfig = require(path.join(projectRoot, 'react-native.config.js'));
  const configuredNativeRoot = path.resolve(
    rnConfig.dependencies?.['rn-update']?.root || ''
  );
  if (configuredNativeRoot !== sdkRoot) {
    throw new Error(
      `rn-update native root is ${configuredNativeRoot}, expected ${sdkRoot}`
    );
  }

  const metroConfig = require(path.join(projectRoot, 'metro.config.js'));
  const metroResolver = metroConfig.resolver?.resolveRequest;
  const configuredMetroRoot = path.resolve(metroResolver?.localSdkRoot || '');
  if (configuredMetroRoot !== sdkRoot) {
    throw new Error(
      `rn-update Metro root is ${configuredMetroRoot}, expected ${sdkRoot}`
    );
  }

  if (typeof metroResolver?.mapModuleName !== 'function') {
    throw new Error('Metro local SDK resolver map is missing');
  }

  const mappedSdkEntry = path.resolve(
    metroResolver.mapModuleName(
      'rn-update',
      path.join(projectRoot, 'index.js')
    )
  );
  const expectedSdkEntry = path.join(sdkRoot, 'src', 'index.ts');
  if (mappedSdkEntry !== expectedSdkEntry) {
    throw new Error(
      `rn-update JS entry is ${mappedSdkEntry}, expected ${expectedSdkEntry}`
    );
  }

  const mappedReactRoot = path.resolve(
    metroResolver.mapModuleName(
      'react',
      path.join(sdkRoot, 'src', 'provider.tsx')
    )
  );
  const expectedReactRoot = path.join(projectRoot, 'node_modules', 'react');
  if (mappedReactRoot !== expectedReactRoot) {
    throw new Error(
      `SDK React root is ${mappedReactRoot}, expected ${expectedReactRoot}`
    );
  }

  const mappedReactNativeRoot = path.resolve(
    metroResolver.mapModuleName(
      'react-native',
      path.join(sdkRoot, 'src', 'core.ts')
    )
  );
  const expectedReactNativeRoot = path.join(
    projectRoot,
    'node_modules',
    'react-native'
  );
  if (mappedReactNativeRoot !== expectedReactNativeRoot) {
    throw new Error(
      `SDK React Native root is ${mappedReactNativeRoot}, expected ${expectedReactNativeRoot}`
    );
  }

  const mappedMetadata = path.resolve(
    metroResolver.mapModuleName(
      '../package.json',
      path.join(sdkRoot, 'src', 'core.ts')
    )
  );
  const expectedMetadata = path.join(sdkRoot, 'package.json');
  if (mappedMetadata !== expectedMetadata) {
    throw new Error(
      `SDK package metadata resolves to ${mappedMetadata}, expected ${expectedMetadata}`
    );
  }

  if (sdkPackage.name !== 'rn-update' || !sdkPackage.version) {
    throw new Error(`Invalid local SDK package at ${sdkRoot}`);
  }

  process.stdout.write(
    `Using local rn-update ${sdkPackage.version} JS/native sources at ${sdkRoot}\n`
  );
  return sdkRoot;
}

module.exports = assertLocalSdk;

if (require.main === module) {
  assertLocalSdk();
}
