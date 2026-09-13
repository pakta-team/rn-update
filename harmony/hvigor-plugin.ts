/**
 * [INPUT]: 依赖 Node fs/path、包装应用 AppScope/app.json5 与 Hvigor 的当前工作目录
 * [OUTPUT]: 对外提供 reactNativeUpdatePlugin，在构建前生成 rawfile/meta.json 的 build time 与 versionName，并保留宿主固定 channel
 * [POS]: Harmony 根构建扩展，把应用身份转成 UpdateContext 可读取的 opaque 构建元信息
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

// Structural view of the hvigor objects this plugin touches, so the file has
// no compile-time dependency on @ohos/hvigor typings (it is compiled by the
// consumer's hvigor, whatever version that is).
interface HvigorTaskContext {
  getBuildMode?: () => string;
}

interface HvigorModuleContext {
  getBuildMode?: () => string;
}

interface HvigorTask {
  name: string;
  run: (taskContext?: HvigorTaskContext) => void;
  dependencies?: string[];
  postDependencies?: string[];
}

interface HvigorNodeLike {
  getNodePath?: () => string;
  getParentNode?: () => HvigorNodeLike | undefined;
  getContext?: (pluginId: string) => HvigorModuleContext | undefined;
  registerTask?: (task: HvigorTask) => void;
}

export const META_RELATIVE_PATH = 'src/main/resources/rawfile/meta.json';
const TASK_NAME = 'paktaWriteBuildMeta';
// OhosPluginId.OHOS_HAP_PLUGIN / OHOS_HSP_PLUGIN / OHOS_HAR_PLUGIN.
const MODULE_PLUGIN_IDS = ['ohosHapPlugin', 'ohosHspPlugin', 'ohosHarPlugin'];

function readVersionName(projectDir: string): string {
  const appJsonPath = path.resolve(projectDir, 'AppScope/app.json5');
  if (!fs.existsSync(appJsonPath)) {
    return '';
  }
  const content = fs.readFileSync(appJsonPath, 'utf-8');
  const match = content.match(
    /(?:"versionName"|versionName):\s*["']([^"']+)["']/,
  );
  return match?.[1] || '';
}

// Only `hvigorw assemble{Hap,App,Hsp,Har}` (DevEco's Build/Run actions pass
// the same task) should touch the consumer's source tree; IDE sync
// (`--sync`), `clean` and friends must not rewrite meta.json.
export function isAssembleInvocation(argv: string[]): boolean {
  return argv.some(arg => /^assemble/i.test(arg));
}

export function resolveBuildMode(
  node: HvigorNodeLike,
  taskContext: HvigorTaskContext | undefined,
  argv: string[],
): string {
  if (taskContext && typeof taskContext.getBuildMode === 'function') {
    return String(taskContext.getBuildMode());
  }
  if (typeof node.getContext === 'function') {
    for (const pluginId of MODULE_PLUGIN_IDS) {
      try {
        const context = node.getContext(pluginId);
        if (context && typeof context.getBuildMode === 'function') {
          return String(context.getBuildMode());
        }
      } catch (e) {
        // not this module type
      }
    }
  }
  // `hvigorw assembleHap -p buildMode=release` (DevEco passes the same
  // property for its build actions); hvigor's default mode is debug.
  const fromArgv = argv.find(arg => arg.startsWith('buildMode='));
  return fromArgv ? fromArgv.substring('buildMode='.length) : 'debug';
}

// The plugin is meant for a module hvigorfile (entry/hvigorfile.ts). When it
// is applied from the project hvigorfile instead, the node path is the
// project root (AppScope lives there): fall back to entry/ like the original
// plugin did, so an existing setup keeps working.
export function resolveModuleDir(node: HvigorNodeLike, cwd: string): string {
  const nodePath =
    typeof node.getNodePath === 'function' ? node.getNodePath() : '';
  if (!nodePath) {
    return path.resolve(cwd, 'entry');
  }
  if (fs.existsSync(path.join(nodePath, 'AppScope', 'app.json5'))) {
    console.warn(
      'reactNativeUpdatePlugin: applied at project level; writing meta.json ' +
        'into entry/. Apply it from the module hvigorfile instead.',
    );
    return path.join(nodePath, 'entry');
  }
  return nodePath;
}

export function resolveProjectDir(
  node: HvigorNodeLike,
  moduleDir: string,
): string {
  const parent =
    typeof node.getParentNode === 'function' ? node.getParentNode() : undefined;
  if (parent && typeof parent.getNodePath === 'function') {
    const parentPath = parent.getNodePath();
    if (parentPath) {
      return parentPath;
    }
  }
  return path.dirname(moduleDir);
}

// Debug builds get "0" like Android's `pakta_build_time` resValue: a debug
// rebuild must not look like a new binary and reset the update state. Release
// builds use an opaque UUID; no consumer may infer time or ordering from it.
export function buildMetaContent(
  buildMode: string,
  versionName: string,
  _now: number,
  channel = '',
): { pakta_build_time: string; versionName: string; channel?: string } {
  const content: {
    pakta_build_time: string;
    versionName: string;
    channel?: string;
  } = {
    pakta_build_time:
      buildMode.toLowerCase() === 'release' ? randomUUID() : '0',
    versionName,
  };
  const normalizedChannel = channel.trim();
  if (normalizedChannel) {
    content.channel = normalizedChannel;
  }
  return content;
}

/**
 * Writes rawfile/meta.json (pakta_build_time + versionName) into the module
 * this plugin is applied to. The write happens in a build task that runs
 * before resources are compiled, not in apply(): apply() runs on every hvigor
 * invocation including IDE sync, and only assemble invocations register the
 * task at all.
 */
export function reactNativeUpdatePlugin() {
  return {
    pluginId: 'reactNativeUpdatePlugin',
    apply(node?: HvigorNodeLike) {
      const argv = process.argv;
      if (!isAssembleInvocation(argv)) {
        return;
      }
      const safeNode: HvigorNodeLike = node ?? {};
      const moduleDir = resolveModuleDir(safeNode, process.cwd());
      const projectDir = resolveProjectDir(safeNode, moduleDir);

      const writeMeta = (taskContext?: HvigorTaskContext) => {
        const buildMode = resolveBuildMode(safeNode, taskContext, argv);
        const metaFilePath = path.resolve(moduleDir, META_RELATIVE_PATH);
        fs.mkdirSync(path.dirname(metaFilePath), { recursive: true });
        let channel = '';
        try {
          const existing = JSON.parse(fs.readFileSync(metaFilePath, 'utf8')) as {
            channel?: unknown;
          };
          if (typeof existing.channel === 'string') {
            channel = existing.channel;
          }
        } catch {
          // First build or a hand-written malformed file: the new metadata
          // remains valid and the host can add channel before packaging.
        }
        const metaContent = buildMetaContent(
          buildMode,
          readVersionName(projectDir),
          Date.now(),
          channel,
        );
        fs.writeFileSync(metaFilePath, JSON.stringify(metaContent, null, 2));
        console.log(`Build time written to ${metaFilePath} (${buildMode})`);
      };

      if (typeof safeNode.registerTask === 'function') {
        try {
          safeNode.registerTask({
            name: TASK_NAME,
            run: writeMeta,
            dependencies: ['default@PreBuild'],
            postDependencies: ['default@ProcessResource'],
          });
          return;
        } catch (e) {
          console.warn(
            `reactNativeUpdatePlugin: task registration failed (${
              e instanceof Error ? e.message : String(e)
            }), writing meta.json at apply time`,
          );
        }
      }
      // Very old hvigor without task registration: keep the previous
      // behaviour (write at apply time), still only for assemble builds.
      writeMeta();
    },
  };
}
