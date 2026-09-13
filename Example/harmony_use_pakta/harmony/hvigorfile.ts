/**
 * [INPUT]: 依赖 @ohos/hvigor 的 JSON5 解析、@ohos/hvigor-ohos-plugin 的 appTasks，并按需读取 signing.local.json5
 * [OUTPUT]: 导出 Harmony 顶层 Hvigor appTasks 配置，并以 config.ohos 覆盖注入本机签名材料
 * [POS]: harmony 工程构建根入口，隔离公共构建模型与开发者私有证书，不改变 RNOH 运行时逻辑
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { existsSync } from 'fs';
import { resolve } from 'path';
import { ParseJsonFile } from '@ohos/hvigor';
import { appTasks } from '@ohos/hvigor-ohos-plugin';

const LOCAL_SIGNING_FILE = 'signing.local.json5';

interface SigningMaterial {
  certpath: string;
  keyAlias: string;
  keyPassword: string;
  profile: string;
  signAlg: 'SHA256withECDSA';
  storeFile: string;
  storePassword: string;
}

interface LocalSigningConfig {
  material: SigningMaterial;
  type?: 'HarmonyOS' | 'OpenHarmony';
}

function readLocalSigningConfig(): LocalSigningConfig | undefined {
  const filePath = resolve(__dirname, LOCAL_SIGNING_FILE);
  return existsSync(filePath)
    ? (ParseJsonFile.parseJsonFile(filePath, false) as LocalSigningConfig)
    : undefined;
}

const localSigningConfig = readLocalSigningConfig();
const localOhosConfig = localSigningConfig
  ? { config: { ohos: { overrides: { signingConfig: localSigningConfig } } } }
  : {};

export default {
  system: appTasks /* Built-in plugin of Hvigor. It cannot be modified. */,
  plugins: [] /* Custom plugin to extend the functionality of Hvigor. */,
  ...localOhosConfig,
};
