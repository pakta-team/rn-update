/**
 * [INPUT]: 依赖 source-map、服务端版本查询、应用选择、网络运行时与 source map 裁剪器
 * [OUTPUT]: 对外提供 FrameConsumer、symbolicateStack 与 symbolicateCommands
 * [POS]: CLI 崩溃栈符号化边界，把发布 bundle 的栈位置映射回源码，不参与 bundle 构建
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import fs from 'fs';
import { SourceMapConsumer } from 'source-map';
import { get } from './api';
import { getPlatform, getSelectedApp } from './app';
import type { Platform } from './types';
import { t } from './utils/i18n';
import { webFetch } from './utils/runtime';
import { unpackSourceMap } from './utils/slim-sourcemap';
import { findVersion } from './versions';

// A frame location inside a shipped bundle: `<bundle>:<line>:<column>`. Covers
// `index.bundlejs`, `index.android.bundle`, `main.jsbundle`, `bundle.harmony.js`
// and plain `.js`/`.hbc` names; an optional `address at ` prefix marks a
// Hermes bytecode frame (column = bytecode offset, already 0-based).
const FRAME_PATTERN =
  /(address at )?((?:[\w.-]+\/)*[\w.-]+\.(?:bundlejs|jsbundle|bundle|hbc|js))(?:\?[^\s:)]*)?:(\d+):(\d+)/g;

export interface FrameConsumer {
  originalPositionFor(position: { line: number; column: number }): {
    source?: string | null;
    line?: number | null;
    column?: number | null;
    name?: string | null;
  };
}

/**
 * Rewrites every bundle frame of `stack` to its original source position.
 * JS engines report 1-based columns, so they are shifted to the 0-based
 * columns source maps use; Hermes bytecode frames (`address at`) carry the
 * bytecode offset, which the composed hermes map keys directly.
 */
export function symbolicateStack(
  stack: string,
  consumer: FrameConsumer,
): { text: string; mapped: number } {
  let mapped = 0;
  const text = stack.replace(
    FRAME_PATTERN,
    (
      frame,
      hermes: string | undefined,
      _bundle,
      line: string,
      column: string,
    ) => {
      const position = consumer.originalPositionFor({
        line: Number(line),
        column: hermes ? Number(column) : Math.max(0, Number(column) - 1),
      });
      if (
        !position.source ||
        position.line === null ||
        position.line === undefined
      ) {
        return frame;
      }
      mapped++;
      const original = `${position.source}:${position.line}:${(position.column ?? 0) + 1}`;
      return position.name ? `${original} (${position.name})` : original;
    },
  );
  return { text, mapped };
}

async function readStack(source: string | undefined): Promise<string> {
  if (!source || source === '-') {
    // No file and an interactive terminal: nothing is piped in, so waiting on
    // stdin would just hang. `-` is an explicit request for stdin either way.
    if (!source && process.stdin.isTTY) {
      throw new Error(t('symbolicateUsage'));
    }
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      process.stdin.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      process.stdin.on('end', () =>
        resolve(Buffer.concat(chunks).toString('utf8')),
      );
      process.stdin.on('error', reject);
    });
  }
  return fs.readFileSync(source, 'utf8');
}

export const symbolicateCommands = {
  symbolicate: async ({
    args,
    options,
  }: {
    args: string[];
    options: Record<string, unknown>;
  }) => {
    const hash = typeof options.hash === 'string' ? options.hash : '';
    const versionIdOption =
      typeof options.versionId === 'string' ? options.versionId : '';
    if (!hash && !versionIdOption) {
      throw new Error(t('symbolicateUsage'));
    }
    const platform = await getPlatform(
      typeof options.platform === 'string'
        ? (options.platform as Platform)
        : undefined,
    );
    const appId =
      typeof options.appId === 'string' && options.appId
        ? options.appId
        : (await getSelectedApp(platform, options.config as string | undefined))
            .appId;

    let versionId = versionIdOption;
    if (!versionId) {
      const version = await findVersion(appId, (item) => item.hash === hash);
      if (!version) {
        throw new Error(t('symbolicateVersionNotFound', { hash }));
      }
      versionId = String(version.id);
    }

    const located = await get(`/app/${appId}/version/${versionId}/sourceMap`);
    if (!located?.url) {
      throw new Error(t('symbolicateNoSourceMap', { id: versionId }));
    }
    const response = await webFetch(located.url);
    if (!response.ok) {
      throw new Error(`Failed to download source map: HTTP ${response.status}`);
    }
    // Maps archived by recent CLI versions are gzipped; older ones are plain
    // JSON, and unpackSourceMap accepts both.
    const rawMap = JSON.parse(
      unpackSourceMap(Buffer.from(await response.arrayBuffer())),
    );
    const consumer = new SourceMapConsumer(rawMap);

    const stack = await readStack(args[0]);
    const { text, mapped } = symbolicateStack(stack, consumer);
    if (typeof options.output === 'string' && options.output) {
      fs.writeFileSync(options.output, text);
    } else {
      process.stdout.write(text.endsWith('\n') ? text : `${text}\n`);
    }
    console.error(
      t('symbolicateDone', {
        count: mapped,
        id: versionId,
        hash: located.hash ?? hash,
      }),
    );
    return { versionId, mapped };
  },
};
