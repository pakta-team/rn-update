/**
 * [INPUT]: 依赖 checkPlugins、本地化文案、临时平台配置与控制台 spy
 * [OUTPUT]: 验证 Sentry 缺省、单平台及双平台检测的 bundle 参数和单次日志契约
 * [POS]: CLI 插件检测回归边界，以真实配置文件锁定检测结果，不执行插件安装
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { checkPlugins } from '../src/utils/check-plugin';
import { t } from '../src/utils/i18n';

describe('checkPlugins', () => {
  let tmpDir: string;
  let origCwd: string;
  let logSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-plugin-test-'));
    origCwd = process.cwd();
    process.chdir(tmpDir);
    logSpy = spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    process.chdir(origCwd);
    logSpy.mockRestore();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const writeProperties = (platform: string) => {
    fs.mkdirSync(path.join(tmpDir, platform), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, platform, 'sentry.properties'),
      'defaults.org=test\n',
    );
  };

  test('nothing is enabled without sentry.properties', async () => {
    expect(await checkPlugins()).toEqual({ sentry: false, sourcemap: false });
    expect(logSpy).not.toHaveBeenCalled();
  });

  for (const platform of ['ios', 'android']) {
    test(`${platform}/sentry.properties enables sentry and source maps`, async () => {
      writeProperties(platform);
      expect(await checkPlugins()).toEqual({ sentry: true, sourcemap: true });
      expect(logSpy).toHaveBeenCalledTimes(1);
      expect(logSpy).toHaveBeenCalledWith(
        t('pluginDetected', { name: 'sentry' }),
      );
    });
  }

  test('both platforms enable sentry and source maps with one detection log', async () => {
    writeProperties('ios');
    writeProperties('android');

    expect(await checkPlugins()).toEqual({ sentry: true, sourcemap: true });
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledWith(
      t('pluginDetected', { name: 'sentry' }),
    );
  });
});
