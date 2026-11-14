/**
 * [INPUT]: 依赖 Node 子进程、React Native bundle、Hermes 编译器、安全临时目录校验与超时策略
 * [OUTPUT]: 对外提供 bundle 执行、Hermes base 编译与等价结果、Sourcemap 上传参数和中间目录安全断言
 * [POS]: CLI 原生打包编排层，连接 Metro/Hermes 与 ppk 制品生成，不负责 HTTP 发布
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { spawn } from 'child_process';
import { satisfies } from 'compare-versions';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { getHermesBase } from './api';
import { getDepVersion } from './utils/dep-versions';
import {
  emptyDirSync,
  ensureDirSync,
  moveSync,
  removeSync,
} from './utils/fs-helpers';
import {
  classifyHermesCommand,
  compareHermesBytecode,
  type HermesBaseOption,
  type HermesBaseOutcome,
  type HermesBaseSelection,
  type HermesEquivalenceResult,
  hermescArgsWithBase,
  probeHbcVersion,
  resolveHermesBase,
} from './utils/hermes-base';
import { hermesTimeout } from './utils/hermes-timeout';
import { t } from './utils/i18n';
import {
  getJavaScriptRuntime,
  spawnJavaScript,
  spawnJavaScriptSync,
} from './utils/runtime';

const g2js = require('gradle-to-js/lib/parser');

export interface BundleCliOptions {
  taro?: boolean;
  expo?: boolean;
  rncli?: boolean;
}

export interface RunBundleCommandOptions {
  bundleName: string;
  dev: string;
  entryFile: string;
  outputFolder: string;
  platform: string;
  sourcemapOutput: string;
  config?: string;
  forceHermes?: boolean;
  /** Hermes -base-bytecode settings; omitted → compile without a base */
  hermesBase?: HermesBaseRequest;
  /** pass --reset-cache to Metro (default true); false reuses its transform cache */
  resetCache?: boolean;
  cli: BundleCliOptions;
  isSentry: boolean;
}

export interface HermesBaseRequest {
  option: HermesBaseOption;
  appId?: string;
  verify: boolean;
  cacheMaxMb?: number;
}

export interface HermesCompileResult {
  bytecodeVersion: number | null;
  base: HermesBaseSelection | null;
  /** true when --verifyHermesBase ran and passed; false when it failed (base dropped) */
  verified?: boolean;
  /**
   * What became of the base, for version/create. Kept apart from `base`
   * (null whenever nothing shipped with a base) so a rejected base and "no
   * base found" stay distinguishable on the server.
   */
  outcome: HermesBaseOutcome;
  /** first difference / failure reason behind `outcome`, when there is one */
  outcomeDetail?: string;
}

/** Outcome of picking a base: what to compile with, plus the log lines. */
export interface HermesBaseSelectionResult {
  base: HermesBaseSelection | null;
  bytecodeVersion: number | null;
  /** messages to print when the compile phase starts (kept out of Metro's output) */
  logs: string[];
  /** the hermesc the selection was made with (the compile reuses it) */
  hermesCommand?: string;
  /** hermesc could not be resolved; the compile phase will report it */
  commandUnavailable?: boolean;
}

interface GradleConfig {
  crunchPngs?: boolean;
  enableHermes?: boolean;
}

const dependencyFields = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
] as const;

type SyncProcessResult = {
  status: number | null;
  signal: NodeJS.Signals | null;
  error?: Error;
};

type ResolvedExpoCli = {
  cliPath: string;
  usingExpo: boolean;
};

type SentryUploadArtifacts = {
  bundlePath: string;
  sourcemapPath: string;
};

type BuildSentrySourcemapsUploadArgsOptions = {
  sentryCliPath: string;
  bundlePath: string;
  sourcemapPath: string;
  release?: string;
  dist?: string;
  stripPrefix?: string;
  debugIdReference?: boolean;
  useStandaloneSourcemapsCommand?: boolean;
};

const ANDROID_SENTRY_BUNDLE_NAME = 'index.android.bundle';

export interface SentryUploadOptions {
  sentryRelease?: string;
  sentryDist?: string;
}

type SentryUploadMode =
  | {
      type: 'debug-id';
      debugId: string;
    }
  | {
      type: 'release';
      release: string;
      dist?: string;
    };

export function hasProjectDependency(
  dependencyName: string,
  projectRoot = process.cwd(),
): boolean {
  try {
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'),
    ) as Record<string, unknown>;

    return dependencyFields.some((field) => {
      const dependencies = packageJson[field];
      if (typeof dependencies !== 'object' || dependencies === null) {
        return false;
      }
      return dependencyName in dependencies;
    });
  } catch {
    return false;
  }
}

export function resolveExpoCli(projectRoot = process.cwd()): ResolvedExpoCli {
  if (!hasProjectDependency('expo', projectRoot)) {
    return {
      cliPath: '',
      usingExpo: false,
    };
  }

  try {
    const searchPaths = [projectRoot];

    try {
      const expoPackageJsonPath = require.resolve('expo/package.json', {
        paths: [projectRoot],
      });
      searchPaths.push(path.dirname(expoPackageJsonPath));
    } catch {
      // expo 包不存在，忽略
    }

    const cliPath = require.resolve('@expo/cli', {
      paths: searchPaths,
    });
    const expoCliVersion = JSON.parse(
      fs.readFileSync(
        require.resolve('@expo/cli/package.json', {
          paths: searchPaths,
        }),
        'utf8',
      ),
    ).version;

    if (!satisfies(expoCliVersion, '>= 0.10.17')) {
      return {
        cliPath: '',
        usingExpo: false,
      };
    }

    return {
      cliPath,
      usingExpo: true,
    };
  } catch {
    return {
      cliPath: '',
      usingExpo: false,
    };
  }
}

export async function runReactNativeBundleCommand({
  bundleName,
  dev,
  entryFile,
  outputFolder,
  platform,
  sourcemapOutput,
  config,
  forceHermes,
  hermesBase,
  resetCache = true,
  cli,
  isSentry,
}: RunBundleCommandOptions): Promise<HermesCompileResult | null> {
  let gradleConfig: GradleConfig = {};
  if (platform === 'android') {
    gradleConfig = await checkGradleConfig(process.cwd());
    if (gradleConfig.crunchPngs !== false) {
      console.warn(t('androidCrunchPngsWarning'));
    }
  }

  const reactNativeBundleArgs: string[] = [];
  const envArgs = process.env.PAKTA_ENV_ARGS;

  if (envArgs) {
    reactNativeBundleArgs.push(...envArgs.trim().split(/\s+/));
  }

  outputFolder = assertSafeToEmpty(outputFolder);
  emptyDirSync(outputFolder);

  let cliPath = '';
  let usingExpo = false;

  const getExpoCli = () => {
    const resolvedExpoCli = resolveExpoCli();
    cliPath = resolvedExpoCli.cliPath;
    usingExpo = resolvedExpoCli.usingExpo;
  };

  const getRnCli = () => {
    try {
      cliPath = require.resolve('react-native/local-cli/cli.js', {
        paths: [process.cwd()],
      });
    } catch {
      cliPath = require.resolve('@react-native-community/cli/build/bin.js', {
        paths: [process.cwd()],
      });
    }
  };

  const getTaroCli = () => {
    try {
      cliPath = require.resolve('@tarojs/cli/bin/taro', {
        paths: [process.cwd()],
      });
    } catch {
      // fallback 到 RN CLI
    }
  };

  if (cli.expo) {
    getExpoCli();
  } else if (cli.taro) {
    getTaroCli();
  } else if (cli.rncli) {
    getRnCli();
  }

  if (!cliPath) {
    getExpoCli();
    if (!usingExpo) {
      getRnCli();
    }
  }

  if (isSentry) {
    // optional only on harmony
    const sentryProperties = `${platform}/sentry.properties`;
    if (
      platform === 'ios' ||
      platform === 'android' ||
      (platform === 'harmony' && fs.existsSync(sentryProperties))
    ) {
      process.env.SENTRY_PROPERTIES = sentryProperties;
    }
  }

  let bundleCommand = 'bundle';
  if (usingExpo) {
    bundleCommand = 'export:embed';
  } else if (platform === 'harmony') {
    bundleCommand = 'bundle-harmony';
  } else if (cli.taro) {
    bundleCommand = 'build';
  }

  if (platform === 'harmony') {
    bundleName = 'bundle.harmony.js';
    if (forceHermes === undefined) {
      forceHermes = true;
    }
  }

  reactNativeBundleArgs.push(
    cliPath,
    bundleCommand,
    '--assets-dest',
    outputFolder,
    '--bundle-output',
    path.join(outputFolder, bundleName),
  );

  if (platform !== 'harmony') {
    reactNativeBundleArgs.push('--platform', platform);
    if (resetCache) reactNativeBundleArgs.push('--reset-cache');
  }

  if (cli.taro) {
    reactNativeBundleArgs.push('--type', 'rn');
  } else {
    reactNativeBundleArgs.push('--dev', dev, '--entry-file', entryFile);
  }

  if (sourcemapOutput) {
    reactNativeBundleArgs.push('--sourcemap-output', sourcemapOutput);
  }

  if (config) {
    reactNativeBundleArgs.push('--config', config);
  }

  // Decide about Hermes before Metro runs so the base lookup (server query,
  // Range download, cache) overlaps the bundling instead of following it.
  const hermesEnabled = await detectHermesEnabled(
    platform,
    forceHermes,
    gradleConfig,
  );

  const jsRuntime = getJavaScriptRuntime();
  const reactNativeBundleProcess = spawnJavaScript(reactNativeBundleArgs);
  console.log(
    `Running bundle command: ${jsRuntime} ${reactNativeBundleArgs.join(' ')}`,
  );
  // Metro is running; the synchronous head of the selection (hermesc lookup,
  // HBC version probe) now overlaps it instead of delaying its start.
  const pendingBase =
    hermesEnabled && hermesBase
      ? startHermesBaseSelection(hermesBase)
      : undefined;

  let hermesResult: HermesCompileResult | null = null;
  await new Promise<void>((resolve, reject) => {
    reactNativeBundleProcess.stdout.on('data', (data) => {
      console.log(data.toString().trim());
    });

    reactNativeBundleProcess.stderr.on('data', (data) => {
      console.error(data.toString().trim());
    });

    reactNativeBundleProcess.once('error', reject);

    reactNativeBundleProcess.on('close', async (exitCode) => {
      if (exitCode) {
        reject(new Error(t('bundleCommandError', { code: exitCode })));
        return;
      }

      try {
        if (hermesEnabled) {
          hermesResult = await compileHermesByteCode({
            bundleName,
            outputFolder,
            sourcemapOutput,
            shouldCleanSourcemap: !isSentry,
            baseRequest: hermesBase,
            pendingBase,
          });
        }

        if (platform === 'harmony') {
          const harmonyRawAssetsPath =
            'harmony/entry/src/main/resources/rawfile/assets';
          ensureDirSync(harmonyRawAssetsPath);
          fs.cpSync(outputFolder, harmonyRawAssetsPath, {
            recursive: true,
            force: true,
            // sourcemaps must not ship inside the native package
            filter: (src) => !src.endsWith('.map'),
          });
          moveSync(
            `${harmonyRawAssetsPath}/bundle.harmony.js`,
            `${harmonyRawAssetsPath}/../bundle.harmony.js`,
          );
        }

        resolve();
      } catch (error) {
        reject(error);
      }
    });
  });
  return hermesResult;
}

/**
 * Validate the intermediate directory before it is emptied and return the
 * canonical path that was validated. The caller must use this returned path:
 * validating one spelling and deleting through another re-opens symlink
 * redirection.
 */
export function assertSafeToEmpty(dir: string, cwd = process.cwd()): string {
  const requested = path.resolve(cwd, dir);
  const lexicalCwd = path.resolve(cwd);
  const lexicalHome = path.resolve(os.homedir());
  const lexicalTmp = path.resolve(os.tmpdir());

  const contains = (parent: string, child: string) => {
    const relative = path.relative(parent, child);
    return (
      relative === '' ||
      (!relative.startsWith('..') && !path.isAbsolute(relative))
    );
  };
  const samePath = (left: string, right: string) => {
    const normalize = (value: string) => {
      const resolved = path.resolve(value);
      return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
    };
    return normalize(left) === normalize(right);
  };
  const reject = (target: string): never => {
    throw new Error(t('unsafeIntermediateDir', { dir: target }));
  };
  const validate = (
    target: string,
    projectRoot: string,
    home: string,
    tmpRoot: string,
  ) => {
    // Reject each protected directory and all of its ancestors.
    for (const protectedPath of [
      path.parse(target).root,
      projectRoot,
      home,
      tmpRoot,
    ]) {
      if (contains(target, protectedPath)) reject(target);
    }
    // Never allow build cleanup inside source-control metadata.
    for (const metadata of ['.git', '.hg', '.svn']) {
      if (contains(path.join(projectRoot, metadata), target)) reject(target);
    }
  };

  validate(requested, lexicalCwd, lexicalHome, lexicalTmp);

  // A final-component symlink is the direct dangerous case: emptyDirSync would
  // enumerate and remove entries from its target rather than removing the link.
  if (fs.existsSync(requested) && fs.lstatSync(requested).isSymbolicLink()) {
    reject(requested);
  }

  // emptyDirSync creates a missing directory too; create it first so it can be
  // canonicalized and the exact validated path can be passed to deletion.
  ensureDirSync(requested);
  const canonical = (value: string, allowWindowsLexicalFallback = false) => {
    try {
      return fs.realpathSync.native(value);
    } catch (error) {
      // Windows 安全策略可能拒绝读取用户目录的最终句柄；这里的目录
      // 已经通过词法边界校验，回退词法路径只用于比较受保护根目录，
      // 不能替代目标目录本身的 canonicalize，避免重新打开 symlink 绕过。
      if (process.platform === 'win32' && allowWindowsLexicalFallback) {
        return path.resolve(value);
      }
      throw error;
    }
  };
  const target = canonical(requested);
  const canonicalCwd = canonical(lexicalCwd);
  const canonicalHome = canonical(lexicalHome, true);
  const canonicalTmp = canonical(lexicalTmp, true);

  validate(target, canonicalCwd, canonicalHome, canonicalTmp);

  // Reject a symlink in any component below a known safe base. System aliases
  // such as macOS /var -> /private/var remain valid because the base itself is
  // canonicalized before the relative suffix is appended.
  for (const [lexicalBase, canonicalBase] of [
    [lexicalCwd, canonicalCwd],
    [lexicalHome, canonicalHome],
    [lexicalTmp, canonicalTmp],
  ] as const) {
    if (contains(lexicalBase, requested)) {
      const relative = path.relative(lexicalBase, requested);
      if (!samePath(path.resolve(canonicalBase, relative), target)) {
        reject(target);
      }
      break;
    }
  }

  return target;
}

/**
 * Whether the app runs Hermes, i.e. whether the bundle must be compiled to
 * bytecode. A JS bundle shipped to a Hermes app still runs, but starts slower
 * and cannot use the Hermes base delta, so false negatives are what this
 * guards against.
 *
 * Android: `hermesEnabled` in gradle.properties wins; then the legacy
 * `project.ext.react.enableHermes` of build.gradle; with neither, the React
 * Native gradle plugin (0.71+) defaults to Hermes and older versions to JSC.
 * iOS: an installed `Pods/hermes-engine`; when `pod install` has not run on
 * this machine (CI), Expo's `Podfile.properties.json` or the pod listed in
 * `Podfile.lock` tell the same.
 */
export async function detectHermesEnabled(
  platform: string,
  forceHermes: boolean | undefined,
  gradleConfig: GradleConfig,
  projectRoot = process.cwd(),
): Promise<boolean> {
  if (forceHermes) {
    console.log(t('forceHermes'));
    return true;
  }
  if (platform === 'android') {
    const hermesEnabled = await readGradleHermesEnabled(
      path.join(projectRoot, 'android', 'gradle.properties'),
    );
    if (hermesEnabled !== undefined) {
      return hermesEnabled;
    }
    if (typeof gradleConfig.enableHermes === 'boolean') {
      return gradleConfig.enableHermes;
    }
    return reactNativeDefaultsToHermes(projectRoot);
  }
  if (platform === 'ios') {
    return detectIosHermes(projectRoot);
  }
  return false;
}

/**
 * `hermesEnabled` from gradle.properties (the last assignment wins, as in
 * Gradle); undefined when the file, the key or a boolean value is missing.
 */
async function readGradleHermesEnabled(
  file: string,
): Promise<boolean | undefined> {
  let content: string;
  try {
    content = await fs.promises.readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn(`${file}: ${(error as Error).message ?? error}`);
    }
    return undefined;
  }
  let value: boolean | undefined;
  for (const match of content.matchAll(
    /^[ \t\f]*hermesEnabled[ \t\f]*[=: \t\f][ \t\f]*(.*?)[ \t\f]*\r?$/gm,
  )) {
    value =
      match[1] === 'true' ? true : match[1] === 'false' ? false : undefined;
  }
  return value;
}

/** React Native's gradle plugin (0.71+) enables Hermes unless a property says otherwise */
function reactNativeDefaultsToHermes(projectRoot: string): boolean {
  const version = getDepVersion('react-native', projectRoot);
  // major.minor by hand: React Native is 0.x, and the check must not depend
  // on a semver library (tests replace compare-versions wholesale)
  const match = version ? /^(\d+)\.(\d+)\./.exec(version) : null;
  if (!match) {
    return false;
  }
  const [major, minor] = [Number(match[1]), Number(match[2])];
  return major > 0 || minor >= 71;
}

type IosJavaScriptEngine = 'hermes' | 'jsc';

/** Remove Ruby comments without treating a # inside a quoted string as one. */
function stripRubyComments(source: string): string {
  return source
    .split(/\r?\n/)
    .map((line) => {
      let quote: "'" | '"' | undefined;
      let escaped = false;
      for (let index = 0; index < line.length; index++) {
        const char = line[index];
        if (escaped) {
          escaped = false;
          continue;
        }
        if (quote) {
          if (char === '\\') {
            escaped = true;
          } else if (char === quote) {
            quote = undefined;
          }
          continue;
        }
        if (char === "'" || char === '"') {
          quote = char;
        } else if (char === '#') {
          return line.slice(0, index);
        }
      }
      return line;
    })
    .join('\n');
}

/**
 * Read explicit iOS engine configuration. An explicit JSC/disabled-Hermes
 * setting wins over installed pods because CocoaPods may still fetch the
 * hermes-engine dependency for a JSC build.
 */
function configuredIosEngine(ios: string): IosJavaScriptEngine | undefined {
  let expoEngine: IosJavaScriptEngine | undefined;
  try {
    const value = JSON.parse(
      fs.readFileSync(path.join(ios, 'Podfile.properties.json'), 'utf8'),
    )?.['expo.jsEngine'];
    if (value === 'hermes' || value === 'jsc') expoEngine = value;
  } catch {
    // no Expo properties file
  }

  let podfile = '';
  try {
    podfile = fs.readFileSync(path.join(ios, 'Podfile'), 'utf8');
  } catch {
    // no Podfile
  }
  const activePodfile = stripRubyComments(podfile);
  const envValue = (name: string) =>
    new RegExp(
      `ENV\\s*\\[\\s*['"]${name}['"]\\s*\\]\\s*(?:\\|\\|=|=)\\s*['"]([^'"]+)['"]`,
      'i',
    )
      .exec(activePodfile)?.[1]
      ?.toLowerCase();
  const useHermes = envValue('USE_HERMES');
  const useThirdPartyJsc = envValue('USE_THIRD_PARTY_JSC');
  const hermesOption =
    /(?:^|[,(]\s*)(?::hermes_enabled\s*=>|hermes_enabled\s*:)\s*(true|false)\b/im
      .exec(activePodfile)?.[1]
      ?.toLowerCase();

  if (
    useThirdPartyJsc === '1' ||
    useThirdPartyJsc === 'true' ||
    useHermes === '0' ||
    useHermes === 'false' ||
    hermesOption === 'false' ||
    expoEngine === 'jsc'
  ) {
    return 'jsc';
  }
  if (
    useHermes === '1' ||
    useHermes === 'true' ||
    hermesOption === 'true' ||
    expoEngine === 'hermes'
  ) {
    return 'hermes';
  }
  return undefined;
}

/** Hermes on iOS: explicit configuration first, installed artifacts second. */
export function detectIosHermes(projectRoot: string): boolean {
  const ios = path.join(projectRoot, 'ios');
  const configured = configuredIosEngine(ios);
  if (configured) return configured === 'hermes';

  if (fs.existsSync(path.join(ios, 'Pods', 'hermes-engine'))) {
    return true;
  }
  // CI may not have run pod install, so use the lockfile only as weak evidence.
  try {
    const lock = fs.readFileSync(path.join(ios, 'Podfile.lock'), 'utf8');
    if (/^\s*-\s+hermes-engine\b/m.test(lock)) return true;
  } catch {
    // no lockfile either
  }
  return false;
}

function getHermesOSBin() {
  if (os.platform() === 'win32') return 'win64-bin';
  if (os.platform() === 'darwin') return 'osx-bin';
  if (os.platform() === 'linux') return 'linux64-bin';
}

function getHermesExecutableName() {
  return os.platform() === 'win32' ? 'hermesc.exe' : 'hermesc';
}

function dirnameOfPackage(
  packageJsonPath: string,
  projectRoot = process.cwd(),
) {
  return path.dirname(
    require.resolve(packageJsonPath, {
      paths: [projectRoot],
    }),
  );
}

function assertSuccessfulSyncProcess(
  result: SyncProcessResult,
  command: string,
) {
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      `${command} failed with ${
        result.status === null
          ? `signal ${result.signal}`
          : `exit code ${result.status}`
      }`,
    );
  }
}

function normalizeString(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

export function resolveHermesCommand(projectRoot = process.cwd()): string {
  const osBin = getHermesOSBin();
  if (!osBin) {
    throw new Error(
      t('unsupportedPlatformForHermes', { platform: os.platform() }),
    );
  }

  const executableName = getHermesExecutableName();
  const candidates: string[] = [];

  try {
    const rnDir = dirnameOfPackage('react-native/package.json', projectRoot);
    candidates.push(path.join(rnDir, 'sdks', 'hermesc', osBin, executableName));
  } catch {
    // react-native is required for normal RN projects; keep looking so the
    // final error can include all candidates we were able to infer.
  }

  try {
    const hermesCompilerDir = dirnameOfPackage(
      'hermes-compiler/package.json',
      projectRoot,
    );
    candidates.push(
      path.join(hermesCompilerDir, 'hermesc', osBin, executableName),
    );
  } catch {
    // RN 0.85+ uses hermes-compiler, older projects may still use other paths.
  }

  try {
    const hermesEngineDir = dirnameOfPackage(
      'hermes-engine/package.json',
      projectRoot,
    );
    candidates.push(
      path.join(hermesEngineDir, osBin, executableName),
      path.join(hermesEngineDir, 'hermesc', osBin, executableName),
    );
  } catch {
    // RN 0.70-era projects commonly used hermes-engine; optional for newer RN.
  }

  const hermesCommand = candidates.find((candidate) =>
    fs.existsSync(candidate),
  );
  if (hermesCommand) {
    return hermesCommand;
  }

  throw new Error(
    `Cannot find hermesc. Tried:\n${candidates.map((candidate) => `- ${candidate}`).join('\n')}`,
  );
}

async function checkGradleConfig(projectRoot: string): Promise<GradleConfig> {
  // undefined when build.gradle does not mention Hermes at all (React Native
  // 0.71+ moved the switch to gradle.properties; see detectHermesEnabled)
  let enableHermes: boolean | undefined;
  let crunchPngs: boolean | undefined;
  try {
    const gradleConfig = await g2js.parseFile(
      path.join(projectRoot, 'android', 'app', 'build.gradle'),
    );
    crunchPngs = gradleConfig.android.buildTypes.release.crunchPngs;
    const projectConfig = gradleConfig['project.ext.react'];
    if (projectConfig) {
      for (const packagerConfig of projectConfig) {
        if (packagerConfig.includes('enableHermes')) {
          enableHermes = packagerConfig.includes('true');
          break;
        }
      }
    }
  } catch {
    // ignore parsing failures
  }
  return {
    enableHermes,
    crunchPngs,
  };
}

/**
 * hermesc argument policy. `-output-source-map` is always passed: hermesc then
 * strips the debug info section from the bytecode (like React Native's own
 * release builds, 15-40% smaller bytecode and smaller hot-update patches) and
 * writes its own `<bundle>.map` next to the output. When the user asked for a
 * sourcemap that file is composed with the packager map as before; otherwise it
 * simply stays in the intermediate directory (never packed into the ppk) so
 * `address at` stack frames can still be symbolicated later.
 */
/**
 * hermesc echoes every diagnostic as three lines (header, the offending source
 * line, a caret line). Minified bundles put a whole module on one line, so a
 * single warning can be 100k+ characters and blindly keeping the tail of stderr
 * buries the actual error under warning noise. Keep the diagnostic headers,
 * prefer errors over warnings, and cap the length of whatever survives.
 */
export function summarizeHermescStderr(stderr: string): string {
  const raw = String(stderr ?? '').split(/\r?\n/);
  const kept: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    const line = raw[i].trim();
    if (!line) continue;
    if (/^\^~*$/.test(line)) continue; // caret line
    // the line before a caret is the echoed source, never the message
    const next = raw[i + 1]?.trim();
    if (next && /^\^~*$/.test(next)) continue;
    kept.push(line.length > 300 ? `${line.slice(0, 300)}…` : line);
  }
  if (kept.length === 0) return '';
  const isError = (line: string) =>
    /(?::\s*|^)(?:fatal error|error)\b/i.test(line) ||
    /^(?:Assertion|Stack dump|PLEASE submit a bug report)/i.test(line);
  const errors = kept.filter(isError);
  if (errors.length > 0) return errors.slice(-3).join(' ');
  const notWarnings = kept.filter(
    (line) => !/:\s*(?:warning|note):/i.test(line),
  );
  return (notWarnings.length > 0 ? notWarnings : kept).slice(-3).join(' ');
}

/** hermesc arguments writing `bundlePath` from `input` (in place by default) */
export function buildHermescArgs(
  bundlePath: string,
  input: string = bundlePath,
): string[] {
  return [
    '-emit-binary',
    '-out',
    bundlePath,
    input,
    '-O',
    '-output-source-map',
  ];
}

interface ProcessOutcome {
  status: number | null;
  signal: NodeJS.Signals | null;
  stderr: string;
  error?: Error;
}

/** captured stderr is bounded to this much head and this much tail */
const STDERR_KEEP_BYTES = 512 * 1024;

/** spawn without blocking the event loop, so two hermesc runs can overlap */
function runProcess(
  command: string,
  args: string[],
  captureStderr: boolean,
): Promise<ProcessOutcome> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'ignore', captureStderr ? 'pipe' : 'ignore'],
      timeout: hermesTimeout(
        process.env.PAKTA_HERMES_COMPILE_TIMEOUT_MS,
        300_000,
      ),
      killSignal: 'SIGKILL',
    });
    // hermesc echoes whole (minified) source lines per diagnostic: keep the
    // head and the tail, never an unbounded transcript
    const head: Buffer[] = [];
    const tail: Buffer[] = [];
    let headBytes = 0;
    let tailBytes = 0;
    let dropped = false;
    child.stderr?.on('data', (chunk: Buffer) => {
      if (headBytes < STDERR_KEEP_BYTES) {
        head.push(chunk);
        headBytes += chunk.length;
        return;
      }
      tail.push(chunk);
      tailBytes += chunk.length;
      while (tail.length > 1 && tailBytes > STDERR_KEEP_BYTES) {
        tailBytes -= (tail.shift() as Buffer).length;
        dropped = true;
      }
    });
    let settled = false;
    const finish = (outcome: ProcessOutcome) => {
      if (settled) return;
      settled = true;
      resolve(outcome);
    };
    child.once('error', (error) =>
      finish({ status: null, signal: null, stderr: '', error }),
    );
    child.once('close', (status, signal) =>
      finish({
        status,
        signal,
        stderr:
          Buffer.concat(head).toString() +
          (dropped ? '\n[... output truncated ...]\n' : '') +
          Buffer.concat(tail).toString(),
      }),
    );
  });
}

export interface CompileHermesOptions {
  bundleName: string;
  outputFolder: string;
  sourcemapOutput: string;
  shouldCleanSourcemap: boolean;
  baseRequest?: HermesBaseRequest;
  /** base selection started alongside Metro (see startHermesBaseSelection) */
  pendingBase?: Promise<HermesBaseSelectionResult>;
  /** defaults to the hermesc the selection used, else the project's */
  hermesCommand?: string;
}

/** how long the compile phase waits for a base that is still being fetched */
const HERMES_BASE_WAIT_MS = 60_000;

/**
 * The selection runs while Metro bundles; when Metro is done first, wait a
 * bounded time for it — a stalled download must never hold up the compile.
 */
async function awaitPendingBase(
  pending: Promise<HermesBaseSelectionResult>,
): Promise<HermesBaseSelectionResult> {
  const waitMs = hermesTimeout(
    process.env.PAKTA_HERMES_BASE_WAIT_MS,
    HERMES_BASE_WAIT_MS,
  );
  let timer: NodeJS.Timeout | undefined;
  const gaveUp = new Promise<HermesBaseSelectionResult>((resolve) => {
    timer = setTimeout(
      () =>
        resolve({
          base: null,
          bytecodeVersion: null,
          logs: [
            t('hermesBaseNone', {
              reason: `base not ready after ${Math.round(waitMs / 1000)}s`,
            }),
          ],
        }),
      waitMs,
    );
  });
  try {
    return await Promise.race([pending, gaveUp]);
  } finally {
    clearTimeout(timer);
  }
}

/** plain compile of `input` into `out`; throws when hermesc fails */
async function compilePlain(
  hermesCommand: string,
  out: string,
  input: string = out,
): Promise<void> {
  const args = buildHermescArgs(out, input);
  console.log(
    t('runningHermesc', { command: hermesCommand, args: args.join(' ') }),
  );
  assertSuccessfulSyncProcess(
    await runProcess(hermesCommand, args, false),
    hermesCommand,
  );
}

/**
 * Merge the packager map with the hermes map into `sourcemapOutput` (which is
 * normally the hermes map's own path). Resolves false when React Native's
 * composer cannot be found; throws when it fails.
 */
async function composeSourceMaps(
  packagerMap: string,
  hermesMap: string,
  sourcemapOutput: string,
): Promise<boolean> {
  let composerPath: string;
  try {
    // resolve through the project so hoisted node_modules (monorepos) work.
    // Extensionless first: RN >= 0.87 maps "./scripts/*" to "./scripts/*.js"
    // in its exports, so the ".js" specifier resolves to ".js.js" and
    // fails; CJS resolution adds the extension itself on older RN.
    composerPath = require.resolve('react-native/scripts/compose-source-maps', {
      paths: [process.cwd()],
    });
  } catch {
    try {
      composerPath = require.resolve(
        'react-native/scripts/compose-source-maps.js',
        { paths: [process.cwd()] },
      );
    } catch {
      console.warn(t('composeSourceMapsNotFound'));
      return false;
    }
  }
  console.log(t('composingSourceMap'));
  assertSuccessfulSyncProcess(
    await runProcess(
      getJavaScriptRuntime(),
      [composerPath, packagerMap, hermesMap, '-o', sourcemapOutput],
      false,
    ),
    composerPath,
  );
  return true;
}

export async function compileHermesByteCode({
  bundleName,
  outputFolder,
  sourcemapOutput,
  shouldCleanSourcemap,
  baseRequest,
  pendingBase,
  hermesCommand,
}: CompileHermesOptions): Promise<HermesCompileResult> {
  console.log(t('hermesEnabledCompiling'));

  const bundlePath = path.join(outputFolder, bundleName);
  const hermesMap = `${bundlePath}.map`;
  const packagerMap = path.join(outputFolder, `${bundleName}.txt.map`);
  if (sourcemapOutput) {
    // hermesc is about to write its own map at `<bundle>.map`, which is where
    // the packager map normally sits: move it aside (copy only when elsewhere)
    if (path.resolve(sourcemapOutput) === path.resolve(hermesMap)) {
      fs.renameSync(sourcemapOutput, packagerMap);
    } else {
      fs.copyFileSync(sourcemapOutput, packagerMap);
    }
  } else {
    console.log(t('hermesSourcemapKept', { file: hermesMap }));
  }

  // the selection already resolved hermesc while Metro ran; only look it up
  // again when there was no selection (or it could not find the binary)
  let selection = pendingBase ? await awaitPendingBase(pendingBase) : null;
  const command =
    hermesCommand ?? selection?.hermesCommand ?? resolveHermesCommand();
  if (!selection || selection.commandUnavailable) {
    selection = await selectHermesBase(command, baseRequest);
  }
  for (const line of selection.logs) console.log(line);
  const result: HermesCompileResult = {
    bytecodeVersion: selection.bytecodeVersion,
    base: null,
    outcome: 'none',
  };
  const base = selection.base;
  // the packager + hermes maps merged into sourcemapOutput
  let composed = false;

  if (!base) {
    await compilePlain(command, bundlePath);
  } else {
    // The JS bundle moves into a work dir and both hermesc runs read it there
    // (no copies); the base compile writes the real output, and with
    // verification on the plain compile the check needs runs concurrently
    // into `plain/` — it simply becomes the result when the base is rejected,
    // so a rejected base never costs a third compile.
    const workDir = path.join(outputFolder, '.hermes-base');
    const jsSource = path.join(workDir, bundleName);
    const plainPath = path.join(workDir, 'plain', bundleName);
    const wantPlain = Boolean(baseRequest?.verify);
    ensureDirSync(path.dirname(plainPath));
    fs.renameSync(bundlePath, jsSource);
    const args = hermescArgsWithBase(
      buildHermescArgs(bundlePath, jsSource),
      base.path,
    );
    console.log(t('runningHermesc', { command, args: args.join(' ') }));
    const [attempt, plain] = await Promise.all([
      // -w: warnings only bloat the captured stderr, errors still print
      runProcess(command, [...args, '-w'], true),
      wantPlain
        ? runProcess(command, buildHermescArgs(plainPath, jsSource), false)
        : Promise.resolve<ProcessOutcome | null>(null),
    ]);
    let usedBase = attempt.status === 0 && !attempt.error;
    if (!usedBase) {
      const fullStderr = attempt.error
        ? String(attempt.error.message ?? attempt.error)
        : attempt.stderr;
      const reason =
        summarizeHermescStderr(fullStderr) ||
        (attempt.signal
          ? `signal ${attempt.signal} (compiler deadline or external termination)`
          : '');
      console.warn(
        t('hermesBaseCompileFailed', {
          reason: reason || `exit ${attempt.status}`,
        }),
      );
      result.outcomeDetail = `base compile failed: ${reason || `exit ${attempt.status}`}`;
      if (fullStderr.trim()) {
        // the summary drops noise; keep everything for bug reports — next to
        // the intermediate dir, never inside it (its content is packed)
        const logPath = hermesBaseErrorLogPath(outputFolder);
        try {
          fs.writeFileSync(logPath, fullStderr);
          console.warn(t('hermesBaseCompileFailedLog', { file: logPath }));
        } catch {}
      }
    }
    const plainOk = plain !== null && plain.status === 0 && !plain.error;
    // compose the base output's map while the disassembly compare runs; it is
    // redone from the plain map in the rare case the base is rejected
    const speculativeCompose =
      usedBase && sourcemapOutput
        ? composeSourceMaps(packagerMap, hermesMap, sourcemapOutput).then(
            (value) => ({ ok: true as const, value }),
            (error: unknown) => ({ ok: false as const, error }),
          )
        : null;
    if (usedBase && wantPlain) {
      if (!plainOk) {
        // The check could not run. That is not evidence against the base,
        // but verification was asked for and did not happen, so the base is
        // dropped exactly like a dump that could not be read: never ship
        // unverified when asked to verify. The plain compile is simply
        // repeated below (compilePlain), which surfaces a real compiler
        // failure as the build error it is.
        const reason =
          (plain?.error && String(plain.error.message ?? plain.error)) ||
          `exit ${plain?.status}`;
        console.warn(t('hermesBasePlainCompileFailed', { reason }));
        result.outcome = 'dump-failed';
        result.outcomeDetail = `plain compile failed: ${reason}`;
        usedBase = false;
      } else {
        const dumpTo = hermesBaseDumpPaths(outputFolder);
        let outcome: HermesEquivalenceResult;
        try {
          outcome = await compareHermesBytecode(
            command,
            bundlePath,
            plainPath,
            {
              dumpTo,
            },
          );
        } catch (error: any) {
          outcome = {
            status: 'dump-failed',
            detail: String(error?.message ?? error),
            functions: 0,
          };
        }
        result.verified = outcome.status === 'equivalent';
        if (outcome.status !== 'equivalent') {
          result.outcome =
            outcome.status === 'different' ? 'rejected' : 'dump-failed';
          result.outcomeDetail = outcome.detail;
        }
        if (outcome.status === 'equivalent') {
          console.log(
            t('hermesBaseVerified', { functions: outcome.functions }),
          );
        } else {
          // a dump that could not be read is not evidence either way; the
          // base is still dropped (never ship unverified when asked to
          // verify), but the log says which case this is
          console.warn(
            t(
              outcome.status === 'different'
                ? 'hermesBaseVerifyFailed'
                : 'hermesBaseVerifyDumpFailed',
              { detail: outcome.detail ?? '' },
            ),
          );
          if (dumpTo) {
            console.warn(
              t('hermesBaseVerifyDumpsWritten', {
                withBase: dumpTo.withBase,
                plain: dumpTo.plain,
              }),
            );
          }
          usedBase = false;
        }
      }
    }
    if (speculativeCompose) {
      const done = await speculativeCompose;
      if (!done.ok && usedBase) throw done.error;
      composed = usedBase && done.ok && done.value;
    }
    if (!usedBase) {
      if (plainOk) {
        moveSync(plainPath, bundlePath);
        if (fs.existsSync(`${plainPath}.map`)) {
          moveSync(`${plainPath}.map`, hermesMap);
        }
      } else {
        await compilePlain(command, bundlePath, jsSource);
      }
    }
    removeSync(workDir);
    result.base = usedBase ? base : null;
    if (usedBase) result.outcome = 'used';
  }
  if (sourcemapOutput && !composed) {
    await composeSourceMaps(packagerMap, hermesMap, sourcemapOutput);
  }
  if (shouldCleanSourcemap) {
    removeSync(packagerMap);
  }
  return result;
}

/** where a failed base attempt's full hermesc output goes (never packed) */
export function hermesBaseErrorLogPath(outputFolder: string): string {
  return path.join(
    path.dirname(path.resolve(outputFolder)),
    'hermes-base-error.log',
  );
}

/**
 * With PAKTA_HERMES_BASE_DEBUG set, both disassemblies of the equivalence
 * check are kept next to the intermediate directory (never packed) so a
 * rejected base can be reported with the exact difference.
 */
export function hermesBaseDumpPaths(
  outputFolder: string,
  env: NodeJS.ProcessEnv = process.env,
): { withBase: string; plain: string } | undefined {
  const flag = env.PAKTA_HERMES_BASE_DEBUG?.trim().toLowerCase();
  if (!flag || flag === '0' || flag === 'false') return undefined;
  const dir = path.dirname(path.resolve(outputFolder));
  return {
    withBase: path.join(dir, 'hermes-base-dump-base.txt'),
    plain: path.join(dir, 'hermes-base-dump-plain.txt'),
  };
}

/**
 * Begin resolving the base right away (before Metro); the compile phase awaits
 * the result. Never rejects: any failure is reported there instead.
 */
export function startHermesBaseSelection(
  request: HermesBaseRequest,
): Promise<HermesBaseSelectionResult> {
  return (async () => {
    let hermesCommand: string;
    try {
      hermesCommand = resolveHermesCommand();
    } catch {
      return {
        base: null,
        bytecodeVersion: null,
        logs: [],
        commandUnavailable: true,
      };
    }
    try {
      return await selectHermesBase(hermesCommand, request);
    } catch (error: any) {
      return {
        base: null,
        bytecodeVersion: null,
        logs: [
          t('hermesBaseNone', { reason: error?.message ?? String(error) }),
        ],
        hermesCommand,
      };
    }
  })();
}

async function selectHermesBase(
  hermesCommand: string,
  request: HermesBaseRequest | undefined,
): Promise<HermesBaseSelectionResult> {
  const logs: string[] = [];
  const none = (bytecodeVersion: number | null = null) => ({
    base: null,
    bytecodeVersion,
    logs,
    hermesCommand,
  });
  if (!request || request.option === 'none') {
    if (request) {
      logs.push(t('hermesBaseNone', { reason: 'disabled by option' }));
    }
    return none();
  }
  const gate = classifyHermesCommand(hermesCommand);
  if (!gate.allowed) {
    logs.push(
      t('hermesBaseNone', { reason: gate.reason ?? 'hermesc not eligible' }),
    );
    return none();
  }
  const bytecodeVersion = probeHbcVersion(hermesCommand);
  if (bytecodeVersion === null) {
    logs.push(t('hermesBaseNone', { reason: 'could not probe HBC version' }));
    return none();
  }
  try {
    const base = await resolveHermesBase({
      option: request.option,
      bytecodeVersion,
      appId: request.appId,
      cacheMaxMb: request.cacheMaxMb,
      fetchBase: getHermesBase,
      log: (message) => logs.push(message),
    });
    return { base, bytecodeVersion, logs, hermesCommand };
  } catch (error: any) {
    logs.push(t('hermesBaseNone', { reason: error?.message ?? String(error) }));
    return none(bytecodeVersion);
  }
}

export async function copyDebugidForSentry(
  bundleName: string,
  outputFolder: string,
  sourcemapOutput: string,
): Promise<void> {
  if (sourcemapOutput) {
    let copyDebugidPath: string | undefined;
    try {
      copyDebugidPath = require.resolve(
        '@sentry/react-native/scripts/copy-debugid.js',
        {
          paths: [process.cwd()],
        },
      );
    } catch {
      console.error(t('sentryReactNativeNotFound'));
      return;
    }

    if (!fs.existsSync(copyDebugidPath)) {
      return;
    }
    console.log(t('copyingDebugId'));
    assertSuccessfulSyncProcess(
      spawnJavaScriptSync(
        [
          copyDebugidPath,
          path.join(outputFolder, `${bundleName}.txt.map`),
          path.join(outputFolder, `${bundleName}.map`),
        ],
        {
          stdio: 'ignore',
        },
      ),
      copyDebugidPath,
    );
  }
  removeSync(path.join(outputFolder, `${bundleName}.txt.map`));
}

export async function prepareSentryUploadArtifacts(
  bundleName: string,
  outputFolder: string,
  platform: string,
): Promise<SentryUploadArtifacts> {
  const bundlePath = path.join(outputFolder, bundleName);
  const sourcemapPath = path.join(outputFolder, `${bundleName}.map`);

  if (platform !== 'android' || bundleName === ANDROID_SENTRY_BUNDLE_NAME) {
    return {
      bundlePath,
      sourcemapPath,
    };
  }

  const androidBundlePath = path.join(outputFolder, ANDROID_SENTRY_BUNDLE_NAME);
  const androidSourcemapPath = path.join(
    outputFolder,
    `${ANDROID_SENTRY_BUNDLE_NAME}.map`,
  );
  await fs.promises.copyFile(bundlePath, androidBundlePath);

  const sourcemap = JSON.parse(
    await fs.promises.readFile(sourcemapPath, 'utf8'),
  ) as Record<string, unknown>;
  sourcemap.file = ANDROID_SENTRY_BUNDLE_NAME;
  await fs.promises.writeFile(androidSourcemapPath, JSON.stringify(sourcemap));

  return {
    bundlePath: androidBundlePath,
    sourcemapPath: androidSourcemapPath,
  };
}

export async function readSourcemapDebugId(
  sourcemapPath: string,
): Promise<string | undefined> {
  try {
    const sourcemap = JSON.parse(
      await fs.promises.readFile(sourcemapPath, 'utf8'),
    ) as Record<string, unknown>;
    const debugId = sourcemap.debugId ?? sourcemap.debug_id;
    return typeof debugId === 'string' ? normalizeString(debugId) : undefined;
  } catch {
    return undefined;
  }
}

function resolveSentryReleaseFromValues(
  releaseValue: string | undefined,
  distValue: string | undefined,
): { release: string; dist?: string } | undefined {
  const release = normalizeString(releaseValue);
  if (!release) {
    return undefined;
  }
  return {
    release,
    dist: normalizeString(distValue),
  };
}

export async function resolveSentryUploadMode(
  sourcemapPath: string,
  options: SentryUploadOptions = {},
): Promise<SentryUploadMode> {
  const optionRelease = resolveSentryReleaseFromValues(
    options.sentryRelease,
    options.sentryDist,
  );
  if (optionRelease) {
    return {
      type: 'release',
      ...optionRelease,
    };
  }

  const debugId = await readSourcemapDebugId(sourcemapPath);
  if (debugId) {
    return {
      type: 'debug-id',
      debugId,
    };
  }

  const environmentRelease = resolveSentryReleaseFromValues(
    process.env.SENTRY_RELEASE,
    process.env.SENTRY_DIST,
  );
  if (environmentRelease) {
    return {
      type: 'release',
      ...environmentRelease,
    };
  }

  throw new Error(
    '[pakta/sentry] Generated source map does not contain a Debug ID. ' +
      'Add @sentry/react-native/metro to metro.config.js so the OTA bundle can be matched by Debug ID, ' +
      'or set --sentry-release/--sentry-dist (or SENTRY_RELEASE/SENTRY_DIST) for legacy release matching.',
  );
}

export function buildSentrySourcemapsUploadArgs({
  sentryCliPath,
  bundlePath,
  sourcemapPath,
  release,
  dist,
  stripPrefix = process.cwd(),
  debugIdReference = false,
  useStandaloneSourcemapsCommand = true,
}: BuildSentrySourcemapsUploadArgsOptions): string[] {
  const uploadArgs = ['--strip-prefix', stripPrefix, bundlePath, sourcemapPath];

  if (debugIdReference) {
    if (!useStandaloneSourcemapsCommand) {
      throw new Error(
        '[pakta/sentry] Debug ID upload requires sentry-cli sourcemaps upload.',
      );
    }
    return [
      sentryCliPath,
      'sourcemaps',
      'upload',
      '--debug-id-reference',
      ...uploadArgs,
    ];
  }

  if (!release) {
    throw new Error(
      '[pakta/sentry] Legacy Sentry sourcemap upload requires a release.',
    );
  }

  if (!useStandaloneSourcemapsCommand) {
    return [
      sentryCliPath,
      'releases',
      'files',
      release,
      'upload-sourcemaps',
      ...(dist ? ['--dist', dist] : []),
      ...uploadArgs,
    ];
  }

  return [
    sentryCliPath,
    'sourcemaps',
    'upload',
    '--release',
    release,
    ...(dist ? ['--dist', dist] : []),
    ...uploadArgs,
  ];
}

/**
 * What the installed sentry-cli supports, from one `sourcemaps upload --help`
 * run: the standalone `sourcemaps upload` command (else the legacy
 * `releases files upload-sourcemaps`), and its `--debug-id-reference` flag.
 */
function probeSentryCli(sentryCliPath: string) {
  const result = spawnJavaScriptSync(
    [sentryCliPath, 'sourcemaps', 'upload', '--help'],
    { encoding: 'utf8' },
  );
  const standalone = !result.error && result.status === 0;
  return {
    standalone,
    debugIdReference:
      standalone &&
      typeof result.stdout === 'string' &&
      result.stdout.includes('--debug-id-reference'),
  };
}

/** --sentry-release/--sentry-dist, else SENTRY_RELEASE/SENTRY_DIST */
function explicitSentryRelease(options: SentryUploadOptions) {
  return (
    resolveSentryReleaseFromValues(options.sentryRelease, options.sentryDist) ??
    resolveSentryReleaseFromValues(
      process.env.SENTRY_RELEASE,
      process.env.SENTRY_DIST,
    )
  );
}

function runSentryCli(args: string[]): SyncProcessResult {
  return spawnJavaScriptSync(args, {
    stdio: 'inherit',
  });
}

function uploadSourcemapsWithRelease({
  sentryCliPath,
  bundlePath,
  sourcemapPath,
  release,
  dist,
  useStandaloneSourcemapsCommand,
}: {
  sentryCliPath: string;
  bundlePath: string;
  sourcemapPath: string;
  release: string;
  dist?: string;
  useStandaloneSourcemapsCommand: boolean;
}): void {
  assertSuccessfulSyncProcess(
    runSentryCli([sentryCliPath, 'releases', 'set-commits', release, '--auto']),
    sentryCliPath,
  );
  console.log(t('sentryReleaseCreated', { version: release }));

  console.log(t('uploadingSourcemap'));
  assertSuccessfulSyncProcess(
    runSentryCli(
      buildSentrySourcemapsUploadArgs({
        sentryCliPath,
        bundlePath,
        sourcemapPath,
        release,
        dist,
        useStandaloneSourcemapsCommand,
      }),
    ),
    sentryCliPath,
  );
}

export async function uploadSourcemapForSentry(
  bundleName: string,
  outputFolder: string,
  sourcemapOutput: string,
  platform = '',
  sentryOptions: SentryUploadOptions = {},
): Promise<void> {
  if (!sourcemapOutput) {
    return;
  }

  let sentryCliPath: string | undefined;
  try {
    sentryCliPath = require.resolve('@sentry/cli/bin/sentry-cli', {
      paths: [process.cwd()],
    });
  } catch {
    console.error(t('sentryCliNotFound'));
    return;
  }

  const { bundlePath, sourcemapPath } = await prepareSentryUploadArtifacts(
    bundleName,
    outputFolder,
    platform,
  );
  const uploadMode = await resolveSentryUploadMode(
    sourcemapPath,
    sentryOptions,
  );
  const sentryCli = probeSentryCli(sentryCliPath);
  const useStandaloneSourcemapsCommand = sentryCli.standalone;

  if (uploadMode.type === 'release') {
    uploadSourcemapsWithRelease({
      sentryCliPath,
      bundlePath,
      sourcemapPath,
      release: uploadMode.release,
      dist: uploadMode.dist,
      useStandaloneSourcemapsCommand,
    });
    return;
  }

  console.log(t('uploadingSourcemap'));
  if (!sentryCli.debugIdReference) {
    const explicitRelease = explicitSentryRelease(sentryOptions);
    if (!explicitRelease) {
      throw new Error(
        '[pakta/sentry] sentry-cli does not support Debug ID source map upload. ' +
          'Upgrade @sentry/cli, or set --sentry-release/--sentry-dist for legacy release matching.',
      );
    }
    uploadSourcemapsWithRelease({
      sentryCliPath,
      bundlePath,
      sourcemapPath,
      release: explicitRelease.release,
      dist: explicitRelease.dist,
      useStandaloneSourcemapsCommand,
    });
    return;
  }

  console.log(
    `[pakta/sentry] Using source map Debug ID: ${uploadMode.debugId}`,
  );
  const debugIdResult = runSentryCli(
    buildSentrySourcemapsUploadArgs({
      sentryCliPath,
      bundlePath,
      sourcemapPath,
      debugIdReference: true,
      useStandaloneSourcemapsCommand,
    }),
  );

  if (debugIdResult.status === 0 && !debugIdResult.error) {
    return;
  }

  const explicitRelease = explicitSentryRelease(sentryOptions);
  if (!explicitRelease) {
    assertSuccessfulSyncProcess(debugIdResult, sentryCliPath);
    return;
  }

  console.warn(
    '[pakta/sentry] Debug ID source map upload failed; falling back to explicit release/dist upload.',
  );
  uploadSourcemapsWithRelease({
    sentryCliPath,
    bundlePath,
    sourcemapPath,
    release: explicitRelease.release,
    dist: explicitRelease.dist,
    useStandaloneSourcemapsCommand,
  });
}
