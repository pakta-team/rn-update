/**
 * [INPUT]: 依赖进程环境与操作系统用户目录
 * [OUTPUT]: 对外提供品牌、当前 Go API 服务端点、Pakta 前端价格页、凭据文件和临时目录常量
 * [POS]: CLI 全局常量层；当前独立服务是唯一默认事实源，服务地址不再回退到分叉前项目
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import { createHash } from 'crypto';
import os from 'os';
import path from 'path';

export const scriptName = 'pakta';

export const ppkBundleFileNames = ['index.bundlejs', 'bundle.harmony.js'];
export const isPPKBundleFileName = (fileName: string) =>
  ppkBundleFileNames.includes(fileName);

export const credentialFile = '.pakta.token';

/** Standalone service credentials never share a token across service URLs. */
export function credentialFileForService(serviceUrl?: string): string {
  const normalized = serviceUrl?.trim().replace(/\/+$/, '');
  if (!normalized) {
    return credentialFile;
  }
  const suffix = createHash('sha256')
    .update(normalized)
    .digest('hex')
    .slice(0, 16);
  return path.join(os.homedir(), `.${scriptName}-${suffix}.token`);
}
// update.json 是 CLI 与客户端 SDK 共同读取的应用配置入口。
export const updateJson = 'update.json';
export const tempDir = '.pakta';
export const currentServiceUrl = 'https://pakta.yoghourt.space';
export const frontendBaseUrl = 'https://pakta.site';
export const pricingPageUrl = `${frontendBaseUrl}/pricing`;

export const defaultEndpoints = [currentServiceUrl];
