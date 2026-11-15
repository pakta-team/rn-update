/**
 * [INPUT]: 依赖当前 checkout SDK 源码和明确的空输出目录；生成宿主固定 RN-tvos/React/CLI 版本
 * [OUTPUT]: 提供独立 tvOS RN 应用、base/v1/v2 运行探针、Podfile/Xcode 工程与依赖/源码同源断言
 * [POS]: CI 的真实 tvOS 消费端；物理隔离 SDK，运行时只确认健康，不由 JS 检查、下载或激活更新
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const destination = process.argv[2];
assert(destination && path.isAbsolute(destination), 'an absolute empty host directory is required');
assert(!fs.existsSync(destination), 'host directory must not exist');
const checkout = path.resolve(__dirname, '../../..');
const sdk = path.join(checkout, 'rn-update');
const vendor = path.join(destination, 'vendor/rn-update');
fs.mkdirSync(vendor, { recursive: true });
for (const file of ['package.json', 'rn-update.podspec', 'react-native.config.js', 'check-expo-version.js']) {
  fs.copyFileSync(path.join(sdk, file), path.join(vendor, file));
}
// 本地 file 依赖也可能安装包的开发依赖；消费端只保留 SDK 运行/peer 契约。
const sdkManifest = JSON.parse(fs.readFileSync(path.join(vendor, 'package.json'), 'utf8'));
delete sdkManifest.devDependencies;
fs.writeFileSync(path.join(vendor, 'package.json'), JSON.stringify(sdkManifest, null, 2) + '\n');
for (const directory of ['src', 'ios', 'android', 'cpp']) {
  fs.cpSync(path.join(sdk, directory), path.join(vendor, directory), {
    recursive: true,
    filter: (source) => !path.relative(sdk, source).split(path.sep).some(
      (part) => ['.git', 'node_modules', 'build', '.cxx', '__pycache__', '.pytest_cache'].includes(part)),
  });
}
fs.writeFileSync(path.join(destination, 'package.json'), JSON.stringify({
  name: 'pakta-tvos-validation', version: '1.0.0', private: true,
  dependencies: {
    react: '19.2.3', 'react-native': 'npm:react-native-tvos@0.85.3-3',
    'rn-update': 'file:./vendor/rn-update',
  },
  devDependencies: {
    '@react-native-community/cli': '20.1.0',
    '@react-native-community/cli-platform-ios': '20.1.0',
    '@react-native/babel-preset': '0.85.3',
    '@react-native/metro-config': '0.85.3',
  },
}, null, 2) + '\n');
for (const version of ['base', 'v1', 'v2']) {
  fs.writeFileSync(path.join(destination, version === 'base' ? 'index.js' : `entry.${version}.js`),
    `/**
 * [INPUT]: 依赖 runtime 的真实 RN 注册与健康探针
 * [OUTPUT]: 注册 ${version} 标记的 tvOS 应用
 * [POS]: 隔离更新制品的唯一版本差异，不改变更新策略
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
require('./runtime').register('${version}');\n`);
}
fs.writeFileSync(path.join(destination, 'babel.config.js'),
  "module.exports = {presets: ['module:@react-native/babel-preset']};\n");
fs.writeFileSync(path.join(destination, 'metro.config.js'),
  "const {getDefaultConfig} = require('@react-native/metro-config');\nmodule.exports = {...getDefaultConfig(__dirname), maxWorkers: 1};\n");
fs.writeFileSync(path.join(destination, 'runtime.js'), `/**
 * [INPUT]: 依赖真实 React/RN、SDK 公共门面与宿主传入的本次冷启动标识
 * [OUTPUT]: 渲染版本标记并报告真实桥/JS 身份与 markSuccess 结果
 * [POS]: tvOS 运行证明；JS 不检查、不下载、不切换，只把健康结果交回原生
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const React = require('react');
const {AppRegistry, Platform, Text, View} = require('react-native');
const {Pakta, PaktaModule, getUpdateMetadata} = require('rn-update');
const endpoint = 'http://127.0.0.1:31338';
const client = new Pakta({
  appKey: 'tvos-runtime-validation', server: {main: [endpoint], queryUrls: []},
  checkStrategy: null, updateStrategy: null, autoMarkSuccess: false,
  disableTelemetry: true, disableErrorReporting: true,
});
async function sendProbe(version, launchId, accepted) {
  await fetch(endpoint + '/probe', {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({version, launchId, accepted, rendered: true,
      isTV: Platform.isTV, dev: __DEV__, metadata: getUpdateMetadata(),
      constants: PaktaModule.getConstants()}),
  });
}
exports.register = (version) => {
  function App({launchId}) {
    React.useEffect(() => {
      let interval;
      const timer = setTimeout(async () => {
        const metadata = getUpdateMetadata();
        const accepted = metadata.currentVersion && metadata.isFirstTime
          ? await client.markSuccess() : null;
        const report = () => sendProbe(version, launchId, accepted)
          .catch((error) => console.error('TV_RUNTIME_PROBE', String(error)));
        await report();
        interval = setInterval(report, 1000);
      }, 1500);
      return () => {clearTimeout(timer); clearInterval(interval);};
    }, [launchId]);
    return React.createElement(View, {style: {flex: 1, backgroundColor: '#102030',
      alignItems: 'center', justifyContent: 'center'}},
      React.createElement(Text, {style: {color: '#fff', fontSize: 48}},
        'Pakta tvOS ' + version));
  }
  AppRegistry.registerComponent('PaktaTVValidation', () => App);
};
`);
fs.mkdirSync(path.join(destination, 'ios'));
fs.writeFileSync(path.join(destination, 'ios/Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>NSAppTransportSecurity</key><dict><key>NSAllowsArbitraryLoads</key><true/></dict>
</dict></plist>
`);
// RN0.85 的 RCTSwiftUI 含 Swift 静态对象；宿主 Swift 编译负责链接兼容运行库。
fs.writeFileSync(path.join(destination, 'ios/SwiftRuntime.swift'), `import Foundation
@objc(PaktaTVSwiftRuntime)
final class PaktaTVSwiftRuntime: NSObject {}
`);
fs.writeFileSync(path.join(destination, 'ios/main.mm'), `/**
 * [INPUT]: 依赖 RCTAppDelegate、生成的依赖提供者与 RCTPakta bundle 选择入口
 * [OUTPUT]: 启动真实 RN 根视图，并把进程冷启动标识传入 JS 探针
 * [POS]: tvOS 测试宿主；版本选择完全由 SDK 原生生命周期拥有
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
#import <UIKit/UIKit.h>
#import <RCTAppDelegate.h>
#import <ReactAppDependencyProvider/RCTAppDependencyProvider.h>
#import "RCTPakta.h"

@interface PaktaTVAppDelegate : RCTAppDelegate
@end
@implementation PaktaTVAppDelegate
- (BOOL)application:(UIApplication *)application didFinishLaunchingWithOptions:(NSDictionary *)options {
    self.moduleName = @"PaktaTVValidation";
    self.dependencyProvider = [RCTAppDependencyProvider new];
    self.initialProps = @{@"launchId": NSProcessInfo.processInfo.environment[@"PAKTA_TV_LAUNCH_ID"] ?: @"missing"};
    return [super application:application didFinishLaunchingWithOptions:options];
}
- (NSURL *)bundleURL {
    return [RCTPakta bundleURL];
}
@end
int main(int argc, char *argv[]) {
    @autoreleasepool { return UIApplicationMain(argc, argv, nil, NSStringFromClass(PaktaTVAppDelegate.class)); }
}
`);
fs.writeFileSync(path.join(destination, 'ios/Podfile'), `require_relative '../node_modules/react-native/scripts/react_native_pods'
platform :tvos, min_supported_versions[:tvos]
prepare_react_native_project!
target 'PaktaTVValidation' do
  use_react_native!(
    :path => '../node_modules/react-native',
    :app_path => "#{Pod::Config.instance.installation_root}/.."
  )
  pod 'rn-update', :path => '../node_modules/rn-update'
  post_install do |installer|
    react_native_post_install(installer, '../node_modules/react-native', :mac_catalyst_enabled => false)
  end
end
`);
fs.writeFileSync(path.join(destination, 'ios/create-project.rb'), `require 'xcodeproj'
project = Xcodeproj::Project.new('PaktaTVValidation.xcodeproj')
target = project.new_target(:application, 'PaktaTVValidation', :tvos, '15.1')
target.source_build_phase.add_file_reference(project.main_group.new_file('main.mm'))
target.source_build_phase.add_file_reference(project.main_group.new_file('SwiftRuntime.swift'))
target.build_configurations.each do |config|
  config.build_settings.merge!({
    'PRODUCT_BUNDLE_IDENTIFIER' => 'space.yoghourt.pakta.tvvalidation',
    'GENERATE_INFOPLIST_FILE' => 'YES',
    'INFOPLIST_FILE' => 'Info.plist',
    'INFOPLIST_KEY_UILaunchScreen_Generation' => 'YES',
    'INFOPLIST_KEY_CFBundleShortVersionString' => '1.0.0',
    'INFOPLIST_KEY_CFBundleVersion' => '1',
    'TARGETED_DEVICE_FAMILY' => '3',
    'CLANG_ENABLE_MODULES' => 'YES',
    'CLANG_ENABLE_OBJC_ARC' => 'YES',
    'CLANG_CXX_LANGUAGE_STANDARD' => 'c++20',
    'SWIFT_VERSION' => '5.0',
    'ALWAYS_EMBED_SWIFT_STANDARD_LIBRARIES' => 'YES',
    'CODE_SIGNING_ALLOWED' => 'NO'
  })
end
project.save
scheme = Xcodeproj::XCScheme.new
scheme.add_build_target(target)
scheme.set_launch_target(target)
scheme.save_as(project.path, 'PaktaTVValidation', true)
`);
fs.writeFileSync(path.join(destination, 'assert-host.js'), `const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const sdk = fs.realpathSync('node_modules/rn-update');
assert(sdk.startsWith(fs.realpathSync('.') + path.sep), 'SDK must be physically inside this host');
const react = require.resolve('react-native/package.json');
assert.equal(require(react).name, 'react-native-tvos');
assert.equal(require(react).version, '0.85.3-3');
assert.equal(fs.realpathSync(require.resolve('react-native/package.json', {paths: [sdk]})), fs.realpathSync(react));
for (const file of ['src/NativePakta.ts', 'rn-update.podspec', 'ios/RCTPakta/RCTPaktaInstallRecord.inc']) {
  assert.deepEqual(fs.readFileSync(path.join(sdk, file)), fs.readFileSync(path.join(process.env.GITHUB_WORKSPACE, 'rn-update', file)));
}
console.log('tvOS host uses isolated current SDK and react-native-tvos 0.85.3-3');
`);
console.log(destination);
