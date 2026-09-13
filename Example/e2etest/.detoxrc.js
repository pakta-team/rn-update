/**
 * [INPUT]: 依赖 Detox 配置约定、Android SDK 环境变量与 scripts/detect-ios-simulator-type
 * [OUTPUT]: 对外提供 iOS/Android 设备选择、可切换 Jest runner 与运行时配置
 * [POS]: e2etest 根级 Detox 设备边界，供 CLI 和 CI 共用
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const { execFileSync } = require('node:child_process');
const { existsSync } = require('node:fs');
const path = require('node:path');
// 与 CI 预热步骤共用同一份探测逻辑,避免两处各自实现选到不同设备。
const {
  detectIosSimulatorType,
} = require('./scripts/detect-ios-simulator-type.js');

function detectAndroidAvdName() {
  if (process.env.DETOX_AVD_NAME) {
    return process.env.DETOX_AVD_NAME;
  }

  try {
    const sdkRoot = process.env.ANDROID_SDK_ROOT || process.env.ANDROID_HOME;
    const executableName =
      process.platform === 'win32' ? 'emulator.exe' : 'emulator';
    const sdkEmulator = sdkRoot
      ? path.join(sdkRoot, 'emulator', executableName)
      : '';
    const emulatorCommand =
      sdkEmulator && existsSync(sdkEmulator) ? sdkEmulator : 'emulator';
    const output = execFileSync(emulatorCommand, ['-list-avds'], {
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString();
    const avds = output
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

    const preferredPatterns = [/^api34$/i, /\bapi[_-]?34\b/i, /\b34\b/];
    for (const pattern of preferredPatterns) {
      const preferredAvd = avds.find((item) => pattern.test(item));
      if (preferredAvd) {
        return preferredAvd;
      }
    }

    if (avds.length > 0) {
      return avds[0];
    }
  } catch {
    // fall through to default
  }

  return 'api34';
}

const iosSimulatorType = detectIosSimulatorType();
const androidAvdName = detectAndroidAvdName();
const iosSimulatorArch = process.arch === 'arm64' ? 'arm64' : 'x86_64';
const androidArchitectures = process.env.DETOX_ANDROID_ARCHS
  ? ` -PreactNativeArchitectures=${process.env.DETOX_ANDROID_ARCHS}`
  : '';
const localSdkCheck = 'node scripts/assert-local-sdk.js && ';
const iosBuildBase =
  'xcodebuild -workspace ios/AwesomeProject.xcworkspace -UseNewBuildSystem=NO -scheme AwesomeProject -sdk iphonesimulator -destination "generic/platform=iOS Simulator" -derivedDataPath ios/build';

/** @type {import('detox').DetoxConfig} */
const config = {
  logger: {
    level: process.env.CI ? 'debug' : undefined,
  },
  testRunner: {
    args: {
      config: process.env.DETOX_JEST_CONFIG || 'e2e/jest.config.js',
      maxWorkers: process.env.CI ? 2 : undefined,
      _: ['e2e'],
    },
  },
  artifacts: {
    plugins: {
      log: process.env.CI ? 'failing' : undefined,
      screenshot: process.env.CI ? 'failing' : undefined,
    },
  },
  apps: {
    'ios.debug': {
      type: 'ios.app',
      binaryPath:
        'ios/build/Build/Products/Debug-iphonesimulator/AwesomeProject.app',
      build: `${localSdkCheck}${iosBuildBase} -configuration Debug ARCHS=${iosSimulatorArch} ONLY_ACTIVE_ARCH=YES`,
      start: 'node scripts/start-rn.js ios',
    },
    'ios.release': {
      type: 'ios.app',
      binaryPath:
        'ios/build/Build/Products/Release-iphonesimulator/AwesomeProject.app',
      build: `${localSdkCheck}export RCT_NO_LAUNCH_PACKAGER=true && ${iosBuildBase} -configuration Release ARCHS=${iosSimulatorArch} ONLY_ACTIVE_ARCH=YES -quiet`,
    },
    'android.debug': {
      type: 'android.apk',
      binaryPath: 'android/app/build/outputs/apk/debug/app-debug.apk',
      build: `${localSdkCheck}node scripts/run-gradle.js assembleDebug assembleAndroidTest -DtestBuildType=debug${androidArchitectures}`,
      start: 'node scripts/start-rn.js android',
      reversePorts: [8081],
    },
    'android.release': {
      type: 'android.apk',
      binaryPath: 'android/app/build/outputs/apk/release/app-release.apk',
      build: `${localSdkCheck}node scripts/run-gradle.js assembleRelease assembleAndroidTest -DtestBuildType=release${androidArchitectures}`,
    },
  },
  devices: {
    simulator: {
      type: 'ios.simulator',
      device: {
        type: iosSimulatorType,
      },
      // CI 上没人看窗口:跳过 `open -a Simulator`(GUI 启动 + 持续渲染开销)
      headless: !!process.env.CI,
    },
    attached: {
      type: 'android.attached',
      device: {
        adbName: '.*',
      },
    },
    emulator: {
      type: 'android.emulator',
      device: {
        avdName: androidAvdName,
      },
    },
  },
  configurations: {
    'ios.sim.debug': {
      device: 'simulator',
      app: 'ios.debug',
    },
    'ios.sim.release': {
      device: 'simulator',
      app: 'ios.release',
    },
    'android.att.debug': {
      device: 'attached',
      app: 'android.debug',
    },
    'android.att.release': {
      device: 'attached',
      app: 'android.release',
    },
    'android.emu.debug': {
      device: 'emulator',
      app: 'android.debug',
    },
    'android.emu.release': {
      device: 'emulator',
      app: 'android.release',
    },
  },
};

module.exports = config;
