#!/usr/bin/env node
/**
 * [INPUT]: 依赖 RN 0.77 模板、e2e harness 与 package-candidate 的本地 tgz 身份校验
 * [OUTPUT]: 提供 generateProject 及命令入口，生成只消费同一候选包的旧架构宿主
 * [POS]: e2etest 隔离消费边界，闭合 JS/Node 编译输入、重定位原生根并注入安装、Release、运行时断言
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { readCandidate } = require('../../../scripts/package-candidate');

const RN_VERSION = '0.77.3';
const RN_CLI_VERSION = '15.0.1';
const appName = 'AwesomeProject';
const scriptDir = __dirname;
const baseE2eDir = path.resolve(scriptDir, '..');
const repoRoot = path.resolve(baseE2eDir, '../..');
function generateProject(options = {}) {
  if (!options.tarball && !process.env.RNU_SDK_TARBALL) {
    throw new Error('RNU_SDK_TARBALL must point to a local candidate .tgz');
  }
  const candidate = readCandidate(
    options.tarball || process.env.RNU_SDK_TARBALL,
    options.sha256 || process.env.RNU_SDK_SHA256
  );
  const workspaceRoot = path.resolve(
    options.workspaceRoot ||
      process.env.RNU_RN077_OLDARCH_ROOT ||
      path.join(repoRoot, '.e2e-rn077-oldarch')
  );
  const projectRoot = path.join(workspaceRoot, appName);

  function run(command, args, options = {}) {
    const result = spawnSync(command, args, {
      stdio: 'inherit',
      shell: process.platform === 'win32',
      ...options,
    });

    if (result.status !== 0) {
      throw new Error(
        `${command} ${args.join(' ')} failed with exit code ${result.status}`
      );
    }
  }

  function copyFromBase(relativePath) {
    fs.mkdirSync(path.dirname(path.join(projectRoot, relativePath)), {
      recursive: true,
    });
    fs.cpSync(
      path.join(baseE2eDir, relativePath),
      path.join(projectRoot, relativePath),
      {
        recursive: true,
        force: true,
      }
    );
  }

  function readText(relativePath) {
    return fs.readFileSync(path.join(projectRoot, relativePath), 'utf8');
  }

  function writeText(relativePath, content) {
    fs.writeFileSync(path.join(projectRoot, relativePath), content);
  }

  function createReactNativeProject() {
    if (fs.existsSync(projectRoot)) {
      throw new Error(`Refusing to overwrite existing project: ${projectRoot}`);
    }
    fs.mkdirSync(workspaceRoot, { recursive: true });

    (options.initialize || run)(
      'npx',
      [
        `@react-native-community/cli@${RN_CLI_VERSION}`,
        'init',
        appName,
        '--version',
        RN_VERSION,
        '--skip-install',
      ],
      { cwd: workspaceRoot }
    );
  }

  function copyE2eHarness() {
    [
      '.detoxrc.js',
      '.watchmanconfig',
      'app.json',
      'e2e',
      'index.js',
      'jest.config.js',
      'jest.setup.js',
      'metro.config.js',
      'react-native.config.js',
      'scripts',
      'src',
      'tsconfig.json',
      'tsconfig.node.json',
      'update.json',
    ].forEach(copyFromBase);

    const tsConfig = JSON.parse(readText('tsconfig.json'));
    delete tsConfig.compilerOptions.paths;
    writeText('tsconfig.json', `${JSON.stringify(tsConfig, null, 2)}\n`);

    for (const config of ['metro.config.js', 'react-native.config.js']) {
      writeText(
        config,
        readText(config).replace(
          "path.resolve(__dirname, '../..')",
          "path.join(__dirname, 'node_modules', 'rn-update')"
        )
      );
    }
    fs.copyFileSync(
      candidate.tarball,
      path.join(projectRoot, 'rn-update-candidate.tgz')
    );
    writeText(
      'rn077-candidate.json',
      `${JSON.stringify(
        {
          version: candidate.metadata.version,
          sha256: candidate.sha256,
        },
        null,
        2
      )}\n`
    );
    writeText(
      'scripts/assert-local-sdk.js',
      "module.exports = require('./assert-rn077-oldarch');\nif (require.main === module) module.exports();\n"
    );
    writeText(
      'index.js',
      "import { assertOldArchitecture } from './scripts/rn077-runtime-proof';\nassertOldArchitecture();\n" +
        readText('index.js')
    );

    writeText(
      'babel.config.js',
      "module.exports = {\n  presets: ['module:@react-native/babel-preset'],\n};\n"
    );
  }

  function writePackageJson() {
    const generatedPackageJson = JSON.parse(readText('package.json'));

    const packageJson = {
      name: 'e2etest-rn077-oldarch',
      version: generatedPackageJson.version,
      private: true,
      scripts: {
        android: 'react-native run-android',
        ios: 'react-native run-ios',
        start: 'react-native start',
        test: 'jest',
        server: 'bun scripts/local-e2e-server.ts',
        'prepare:e2e': 'node scripts/run-prepare-local-update-artifacts.js',
        'test:e2e:android':
          'E2E_PLATFORM=android detox test --configuration android.emu.release --headless --record-logs all',
        'assert:oldarch': 'node scripts/assert-rn077-oldarch.js',
        apk: 'node scripts/assert-rn077-oldarch.js && node scripts/run-gradle.js assembleRelease && node scripts/assert-rn077-oldarch.js --release',
      },
      dependencies: {
        react: '18.3.1',
        'react-native': RN_VERSION,
        'rn-update': 'file:./rn-update-candidate.tgz',
      },
      devDependencies: {
        ...generatedPackageJson.devDependencies,
        '@types/node': '^24.6.0',
        detox: '20.51.4',
      },
      engines: {
        node: '>=22',
      },
      trustedDependencies: ['detox', 'dtrace-provider'],
    };

    writeText('package.json', `${JSON.stringify(packageJson, null, 2)}\n`);
  }

  function configureAndroidOldArchitecture() {
    let gradleProperties = readText('android/gradle.properties');
    if (!/^newArchEnabled=(true|false)\r?$/m.test(gradleProperties)) {
      throw new Error('RN template is missing newArchEnabled');
    }
    gradleProperties = gradleProperties.replace(
      /^newArchEnabled=.*$/m,
      'newArchEnabled=false'
    );
    writeText('android/gradle.properties', gradleProperties);

    let appBuildGradle = readText('android/app/build.gradle');
    appBuildGradle = appBuildGradle.replace(
      /versionName "1\.0"/,
      [
        'versionName "1.0"',
        "        testBuildType System.getProperty('testBuildType', 'debug')",
        '        testInstrumentationRunner "androidx.test.runner.AndroidJUnitRunner"',
      ].join('\n')
    );
    appBuildGradle = appBuildGradle.replace(
      /release \{\n\s+\/\/ Caution!/,
      'release {\n            crunchPngs false\n            // Caution!'
    );
    appBuildGradle = appBuildGradle.replace(
      /dependencies \{\n/,
      `${[
        'def detoxVersion = new groovy.json.JsonSlurper().parse(file("$rootDir/../node_modules/detox/package.json")).version',
        '',
        'repositories {',
        '    maven {',
        '        url("$rootDir/../node_modules/detox/Detox-android")',
        '    }',
        '}',
        '',
        'dependencies {',
      ].join('\n')}\n`
    );
    appBuildGradle = appBuildGradle.replace(
      /implementation\("com\.facebook\.react:react-android"\)\n/,
      [
        'implementation("com.facebook.react:react-android")',
        '',
        // biome-ignore lint/suspicious/noTemplateCurlyInString: Groovy expands this placeholder in generated Gradle.
        '    androidTestImplementation("com.wix:detox:${detoxVersion}")',
        '    androidTestImplementation("junit:junit:4.13.2")',
        '    androidTestImplementation("androidx.test:runner:1.6.2")',
        '    androidTestImplementation("androidx.test:rules:1.6.1")',
        '    androidTestImplementation("androidx.test.ext:junit:1.2.1")',
        '',
      ].join('\n')
    );
    writeText('android/app/build.gradle', appBuildGradle);

    copyFromBase(
      'android/app/src/androidTest/java/com/awesomeproject/DetoxTest.java'
    );
    copyFromBase('android/app/src/main/res/xml/network_security_config.xml');

    let manifest = readText('android/app/src/main/AndroidManifest.xml');
    manifest = manifest.replace(
      /android:theme="@style\/AppTheme"/,
      [
        'android:theme="@style/AppTheme"',
        '      android:networkSecurityConfig="@xml/network_security_config"',
      ].join('\n')
    );
    writeText('android/app/src/main/AndroidManifest.xml', manifest);

    let mainApplication = readText(
      'android/app/src/main/java/com/awesomeproject/MainApplication.kt'
    );
    mainApplication = mainApplication.replace(
      'import com.facebook.soloader.SoLoader\n',
      [
        'import com.facebook.soloader.SoLoader',
        'import cn.reactnative.modules.update.UpdateContext',
        '',
      ].join('\n')
    );
    mainApplication = mainApplication.replace(
      '        override fun getJSMainModuleName(): String = "index"\n',
      [
        '        override fun getJSMainModuleName(): String = "index"',
        '',
        '        override fun getJSBundleFile(): String? = UpdateContext.getBundleUrl(this@MainApplication)',
        '',
      ].join('\n')
    );
    writeText(
      'android/app/src/main/java/com/awesomeproject/MainApplication.kt',
      mainApplication
    );
  }

  function main() {
    createReactNativeProject();
    copyE2eHarness();
    writePackageJson();
    configureAndroidOldArchitecture();
    process.stdout.write(
      `Created RN ${RN_VERSION} old architecture e2e project: ${projectRoot}\n`
    );
  }

  main();
  return projectRoot;
}

module.exports = { generateProject };
if (require.main === module) generateProject();
