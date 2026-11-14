/**
 * [INPUT]: 依赖文件系统、CLI 凭据/临时目录常量与本地化文案
 * [OUTPUT]: 对外提供 addGitIgnore，幂等写入 Pakta CLI 工作目录的忽略项
 * [POS]: CLI 项目卫生辅助层，只修改当前项目 .gitignore，不参与命令业务流程
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import fs from 'fs';
// import path from 'path';
import { credentialFile, tempDir } from './constants';
import { t } from './i18n';

export function addGitIgnore() {
  const shouldIgnore = [credentialFile, tempDir];

  const gitignorePath = '.gitignore';

  if (!fs.existsSync(gitignorePath)) {
    return;
  }

  const gitignoreContent = fs.readFileSync(gitignorePath, 'utf-8');

  const gitignoreLines = gitignoreContent.split('\n');

  // `.pakta`, `/.pakta` and `.pakta/` all ignore the same directory; a
  // trailing slash only matches directories, so it counts for tempDir alone
  const covers = (entry: string, line: string) => {
    const pattern = line.trim().replace(/^\//, '');
    return pattern === entry || (entry === tempDir && pattern === `${entry}/`);
  };
  for (const line of gitignoreLines) {
    const index = shouldIgnore.findIndex((entry) => covers(entry, line));
    if (index !== -1) {
      shouldIgnore.splice(index, 1);
    }
  }

  if (shouldIgnore.length > 0) {
    gitignoreLines.push('# rn-update');
    for (const line of shouldIgnore) {
      gitignoreLines.push(line);
      console.log(t('addedToGitignore', { line }));
    }

    fs.writeFileSync(gitignorePath, gitignoreLines.join('\n'));
  }
}
