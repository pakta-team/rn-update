/**
 * [INPUT]: 依赖当前 checkout SDK 源码和明确的空输出目录；生成宿主固定 RN-tvos/React/CLI 版本
 * [OUTPUT]: 提供独立 tvOS 原生应用、Podfile、Xcode 工程生成器与依赖/源码同源断言
 * [POS]: CI 的真实 tvOS 编译夹具；物理隔离 SDK 以消费宿主 RN，不生成更新策略或发布候选
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
  },
}, null, 2) + '\n');
fs.writeFileSync(path.join(destination, 'index.js'), "// Native compilation host; no JS bundle is executed.\n");
fs.mkdirSync(path.join(destination, 'ios'));
// RN0.85 的 RCTSwiftUI 含 Swift 静态对象；宿主 Swift 编译负责链接兼容运行库。
fs.writeFileSync(path.join(destination, 'ios/SwiftRuntime.swift'), `import Foundation
@objc(PaktaTVSwiftRuntime)
final class PaktaTVSwiftRuntime: NSObject {}
`);
fs.writeFileSync(path.join(destination, 'ios/main.mm'), `#import <UIKit/UIKit.h>
#import "RCTPakta.h"

@interface PaktaTVAppDelegate : UIResponder <UIApplicationDelegate>
@property (nonatomic, strong) UIWindow *window;
@end
@implementation PaktaTVAppDelegate
- (BOOL)application:(UIApplication *)application didFinishLaunchingWithOptions:(NSDictionary *)options {
    // 强引用原生模块，使最终应用链接验证 SDK 而非只生成静态库。
    Class module = [RCTPakta class];
    NSCAssert(module != Nil, @"Pakta module must be linked");
    self.window = [[UIWindow alloc] initWithFrame:UIScreen.mainScreen.bounds];
    self.window.rootViewController = [UIViewController new];
    [self.window makeKeyAndVisible];
    return YES;
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
    'INFOPLIST_KEY_UILaunchScreen_Generation' => 'YES',
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
