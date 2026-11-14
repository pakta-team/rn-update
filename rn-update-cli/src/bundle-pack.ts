/**
 * [INPUT]: 依赖文件系统、路径、yazl ZIP 写入器、本地化文案与 ZIP 条目压缩策略
 * [OUTPUT]: 对外提供 packBundle，将 bundle 目录打包为 CLI 发布制品
 * [POS]: CLI PPK 制品打包器，只决定条目边界和压缩方式，不负责 bundle 生成与上传
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import fs from 'fs';
import path from 'path';
import { t } from './utils/i18n';
import { createOutputZip } from './utils/zip-entries';
import { zipOptionsForPayloadFile } from './utils/zip-options';

const ignorePackingExtensions = ['DS_Store', 'txt.map'];

export async function packBundle(
  dir: string,
  output: string,
  bundleName?: string,
): Promise<void> {
  const ignorePackingFileNames = [
    'index.bundlejs.map',
    'bundle.harmony.js.map',
  ];
  if (bundleName) {
    ignorePackingFileNames.push(`${bundleName}.map`);
  }
  console.log(t('packing'));
  const { zipfile, writePromise, abort } = createOutputZip(output);

  function addDirectory(root: string, rel: string) {
    if (rel) {
      zipfile.addEmptyDirectory(rel);
    }
    for (const name of fs.readdirSync(root)) {
      if (
        ignorePackingFileNames.includes(name) ||
        ignorePackingExtensions.some((ext) => name.endsWith(`.${ext}`))
      ) {
        continue;
      }
      const fullPath = path.join(root, name);
      const stat = fs.statSync(fullPath);
      if (stat.isFile()) {
        zipfile.addFile(
          fullPath,
          rel + name,
          zipOptionsForPayloadFile(fullPath, rel + name),
        );
      } else if (stat.isDirectory()) {
        addDirectory(fullPath, `${rel}${name}/`);
      }
    }
  }

  try {
    addDirectory(dir, '');
    zipfile.end();
    await writePromise;
  } catch (error) {
    await abort();
    throw error;
  }
  console.log(t('fileGenerated', { file: output }));
}
