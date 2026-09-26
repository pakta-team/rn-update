#!/usr/bin/env node
/**
 * [INPUT]: 依赖 fs/path 探测宿主工程 expo 版本并清理包根 expo-module.config.json
 * [OUTPUT]: postinstall 生命周期钩子，宿主无 Expo 或 SDK < 50 时移除 Expo 自动链接配置
 * [POS]: 包根的消费者侧安装钩子，与 app.plugin.js/react-native.config.js 同属随包分发的外部宿主入口
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
// 上游原版以 npm_package_name === 包名 作开发期守卫，但 npm 在消费者安装时同样
// 把该变量设为依赖自身的包名，守卫反转成"永远跳过"，整个脚本沦为空操作，上游
// 最终在安全审计中将其整体删除。此处改用 node_modules 路径探测修复根因：
// 源码仓库内 __dirname 不含 node_modules 段（开发期，跳过）；消费者安装副本
// 必含 node_modules 段（npm/pnpm 嵌套布局同样命中，执行）。bun 默认不执行
// 依赖 postinstall，此场景下配置原样保留，对 Expo 用户是安全的失败开放。
const fs = require('node:fs');
const path = require('node:path');

const packageRoot = __dirname;
const expoConfigPath = path.join(packageRoot, 'expo-module.config.json');

function getExpoMajorVersion() {
  try {
    // 从包自身位置向上解析，命中宿主工程的 node_modules/expo（npm/yarn/pnpm 通用）
    const expoPackageJsonPath = require.resolve('expo/package.json', {
      paths: [packageRoot],
    });
    const { version } = JSON.parse(
      fs.readFileSync(expoPackageJsonPath, 'utf8')
    );
    const match = typeof version === 'string' ? version.match(/\d+/) : null;
    return match ? parseInt(match[0], 10) : null;
  } catch {
    return null;
  }
}

function main() {
  if (!__dirname.split(path.sep).includes('node_modules')) {
    console.log('check-expo-version: source checkout detected, skipping.');
    return;
  }
  const expoMajor = getExpoMajorVersion();
  if (expoMajor !== null && expoMajor >= 50) {
    console.log(
      `check-expo-version: Expo SDK ${expoMajor} detected, keeping expo-module.config.json.`
    );
    return;
  }
  const reason =
    expoMajor === null ? 'Expo not found' : `Expo SDK ${expoMajor} < 50`;
  if (fs.existsSync(expoConfigPath)) {
    try {
      fs.unlinkSync(expoConfigPath);
      console.log(
        `check-expo-version: ${reason}, removed expo-module.config.json.`
      );
    } catch (error) {
      console.warn(
        `check-expo-version: failed to remove expo-module.config.json: ${error.message}`
      );
    }
  } else {
    console.log(
      `check-expo-version: ${reason}, expo-module.config.json already absent.`
    );
  }
}

main();
