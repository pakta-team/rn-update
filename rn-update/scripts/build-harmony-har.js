#!/usr/bin/env node
/**
 * [INPUT]: 依赖 Node fs/path/child_process、跨平台 DevEco/ohpm/hvigorw 工具链，以及 harmony/pakta、har-wrapper、android/jni 与 cpp 源码
 * [OUTPUT]: 自动发现 macOS/Windows DevEco，暂存跨平台原生源码，构建 Harmony HAR，并在清理后交付指定产物
 * [POS]: scripts 的 HarmonyOS 打包编排器，连接共享 C++/Android 源码与 HAR 发布包装，不实现平台运行时逻辑
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const projectRoot = path.resolve(__dirname, '..');
const androidJniDir = path.join(projectRoot, 'android', 'jni');
const patchCoreDir = path.join(projectRoot, 'cpp', 'patch_core');
const updateFlowCoreDir = path.join(projectRoot, 'cpp', 'update_flow_core');
const harmonyModuleDir = path.join(projectRoot, 'harmony', 'pakta');
const harmonyBuildDir = path.join(harmonyModuleDir, 'build');
const harmonyNativeStageDir = path.join(
  harmonyModuleDir,
  'src',
  'main',
  'cpp',
  'android-generated'
);
const harmonyNativeStageJniDir = path.join(harmonyNativeStageDir, 'jni');
const harmonyNativeStagePatchCoreDir = path.join(
  harmonyNativeStageDir,
  'patch_core'
);
const wrapperProjectDir = path.join(projectRoot, 'harmony', 'har-wrapper');
const defaultOutputPath = path.join(projectRoot, 'harmony', 'pakta.har');
const wrapperProjectFiles = [
  'hvigorfile.ts',
  path.join('hvigor', 'hvigor-config.json5'),
  'oh-package.json5',
  path.join('AppScope', 'app.json5'),
  'build-profile.json5',
];

const args = parseArgs(process.argv.slice(2));
const buildMode = normalizeBuildMode(
  args['build-mode'] || process.env.HARMONY_BUILD_MODE || 'debug'
);
const skipInstall =
  args['skip-install'] || process.env.HARMONY_SKIP_INSTALL === '1';
const outputDir = args['out-dir']
  ? path.resolve(projectRoot, args['out-dir'])
  : process.env.HARMONY_HAR_OUTPUT_DIR
    ? path.resolve(projectRoot, process.env.HARMONY_HAR_OUTPUT_DIR)
    : null;
const outputPath = args['out-file']
  ? path.resolve(projectRoot, args['out-file'])
  : process.env.HARMONY_HAR_OUTPUT_PATH
    ? path.resolve(projectRoot, process.env.HARMONY_HAR_OUTPUT_PATH)
    : outputDir
      ? null
      : defaultOutputPath;

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

function main() {
  let buildError = null;

  // Setup runs inside the guard too: a failed version sync or staging copy
  // must still clean the android-generated staging directory (its own or a
  // stale one from an earlier build) instead of leaving it behind.
  try {
    syncOhPackageVersion();
    syncBuildProfileVersion();
    syncHarmonyNativeSources();
    buildHar();
  } catch (error) {
    buildError = error;
  }

  try {
    cleanupHarmonyNativeSources();
  } catch (error) {
    if (!buildError) {
      buildError = error;
    } else {
      console.warn(
        `Warning: failed to clean staged Harmony native sources: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  if (buildError) {
    throw buildError;
  }
}

function buildHar() {
  ensureWrapperProject();

  const devecoRoots = getDevEcoRoots();
  const hvigorwPath = resolveBinary('hvigorw', [
    process.env.HVIGORW_PATH,
    ...devecoRoots.map((root) =>
      path.join(root, 'tools', 'hvigor', 'bin', 'hvigorw')
    ),
    ...devecoRoots.map((root) =>
      path.join(root, 'tools', 'hvigor', 'bin', 'hvigorw.js'),
    ),
  ]);
  const ohpmPath = resolveBinary('ohpm', [
    process.env.OHPM_PATH,
    ...devecoRoots.map((root) =>
      path.join(root, 'tools', 'ohpm', 'bin', 'pm-cli.js'),
    ),
    ...devecoRoots.map((root) =>
      path.join(root, 'tools', 'ohpm', 'bin', 'ohpm'),
    ),
  ]);

  if (!hvigorwPath) {
    fail('Cannot find hvigorw. Set HVIGORW_PATH or install DevEco Studio.');
  }

  if (!ohpmPath) {
    fail('Cannot find ohpm. Set OHPM_PATH or install DevEco Studio.');
  }

  const nodeExecutable = resolveDevEcoNode(devecoRoots) || process.execPath;

  const env = {
    ...process.env,
  };

  const selectedSdkHome = env.DEVECO_SDK_HOME
    ? path.resolve(env.DEVECO_SDK_HOME)
    : findUsableDevEcoSdkHome(devecoRoots);
  if (selectedSdkHome) {
    env.DEVECO_SDK_HOME = selectedSdkHome;
  }

  if (!env.DEVECO_STUDIO_HOME && selectedSdkHome) {
    env.DEVECO_STUDIO_HOME = path.dirname(selectedSdkHome);
  }

  if (!skipInstall) {
    if (hasDependencies(harmonyModuleDir)) {
      runCommand(ohpmPath, ['install'], {
        cwd: harmonyModuleDir,
        env,
        label: 'Install Harmony dependencies',
        nodeExecutable,
      });
    }

    if (hasDependencies(wrapperProjectDir)) {
      runCommand(ohpmPath, ['install'], {
        cwd: wrapperProjectDir,
        env,
        label: 'Install wrapper project dependencies',
        nodeExecutable,
      });
    }
  }

  const hvigorArgs = ['assembleHar'];
  if (buildMode !== 'debug') {
    hvigorArgs.push('-p', `buildMode=${buildMode}`);
  }
  if (process.env.CI === 'true') {
    hvigorArgs.push('--no-daemon');
  }

  runCommand(hvigorwPath, hvigorArgs, {
    cwd: wrapperProjectDir,
    env,
    label: `Build Harmony HAR (${buildMode})`,
    nodeExecutable,
  });

  const harPath = findNewestHar(harmonyBuildDir);
  if (!harPath) {
    fail(
      `Build finished but no .har artifact was found under ${relativeToProject(
        harmonyBuildDir
      )}`
    );
  }

  let finalPath = harPath;
  if (outputDir || outputPath) {
    finalPath = outputPath || path.join(outputDir, path.basename(harPath));
    fs.mkdirSync(path.dirname(finalPath), { recursive: true });
    fs.copyFileSync(harPath, finalPath);
  }

  console.log(`HAR package ready: ${finalPath}`);
}

// The HAR carries its own version in oh-package.json5. Consumers'
// oh-package-lock.json5 and diagnostics can only tell installs apart when it
// equals the npm version, so rewrite it from package.json before assembleHar
// (scripts/check-release-version.js keeps the committed value honest).
function syncOhPackageVersion() {
  const packageJsonPath = path.join(projectRoot, 'package.json');
  const ohPackagePath = path.join(harmonyModuleDir, 'oh-package.json5');
  const version = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')).version;
  if (typeof version !== 'string' || !version) {
    fail('package.json has no version to write into oh-package.json5');
  }
  const content = fs.readFileSync(ohPackagePath, 'utf8');
  // JSON5 allows the key bare or quoted (check-release-version.js matches
  // the same shapes).
  const versionLine =
    /^(\s*(?:"version"|'version'|version)\s*:\s*)(['"])([^'"]*)\2(\s*,?)/m;
  const match = content.match(versionLine);
  if (!match) {
    fail(
      `Cannot find a version field in ${relativeToProject(ohPackagePath)}`
    );
  }
  if (match[3] === version) {
    return;
  }
  const updated = content.replace(
    versionLine,
    (_, prefix, quote, __, suffix) => `${prefix}${quote}${version}${quote}${suffix}`
  );
  fs.writeFileSync(ohPackagePath, updated);
  console.log(
    `Updated ${relativeToProject(ohPackagePath)} version ${match[3]} -> ${version}`
  );
}

function syncBuildProfileVersion() {
  const packageJsonPath = path.join(projectRoot, 'package.json');
  const buildProfilePath = path.join(harmonyModuleDir, 'BuildProfile.ets');
  const version = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')).version;
  if (typeof version !== 'string' || !version) {
    fail('package.json has no version to write into BuildProfile.ets');
  }
  const content = fs.readFileSync(buildProfilePath, 'utf8');
  const versionLine =
    /^([ \t]*export const HAR_VERSION = ['"])([^'"]+)(['"];?[ \t]*)(?=\r?$)/m;
  const match = content.match(versionLine);
  if (!match) {
    fail(
      `Cannot find HAR_VERSION in ${relativeToProject(buildProfilePath)}`
    );
  }
  if (match[2].trim() === version) {
    return;
  }
  const updated = content.replace(
    versionLine,
    (_, prefix, _previousVersion, suffix) => prefix + version + suffix,
  );
  fs.writeFileSync(buildProfilePath, updated);
  console.log(
    `Updated ${relativeToProject(buildProfilePath)} version -> ${version}`,
  );
}

function syncHarmonyNativeSources() {
  ensureFileExists(
    path.join(androidJniDir, 'hpatch.c'),
    `Missing Android native source: ${relativeToProject(
      path.join(androidJniDir, 'hpatch.c')
    )}`
  );
  ensureFileExists(
    path.join(androidJniDir, 'hpatch.h'),
    `Missing Android native source: ${relativeToProject(
      path.join(androidJniDir, 'hpatch.h')
    )}`
  );
  ensureFileExists(
    path.join(androidJniDir, 'HDiffPatch'),
    `Missing Android native source directory: ${relativeToProject(
      path.join(androidJniDir, 'HDiffPatch')
    )}`
  );
  ensureFileExists(
    path.join(androidJniDir, 'lzma', 'C'),
    `Missing Android native source directory: ${relativeToProject(
      path.join(androidJniDir, 'lzma', 'C')
    )}`
  );
  ensureFileExists(
    path.join(patchCoreDir, 'patch_core.cpp'),
    `Missing shared patch core source: ${relativeToProject(
      path.join(patchCoreDir, 'patch_core.cpp')
    )}`
  );
  ensureFileExists(
    path.join(updateFlowCoreDir, 'update_flow_core.cpp'),
    `Missing shared update flow core source: ${relativeToProject(
      path.join(updateFlowCoreDir, 'update_flow_core.cpp')
    )}`
  );

  fs.rmSync(harmonyNativeStageDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(harmonyNativeStageJniDir, 'lzma'), {
    recursive: true,
  });

  copyPath(
    path.join(androidJniDir, 'hpatch.c'),
    path.join(harmonyNativeStageJniDir, 'hpatch.c')
  );
  copyPath(
    path.join(androidJniDir, 'hpatch.h'),
    path.join(harmonyNativeStageJniDir, 'hpatch.h')
  );
  copyPath(
    path.join(androidJniDir, 'HDiffPatch'),
    path.join(harmonyNativeStageJniDir, 'HDiffPatch')
  );
  copyPath(
    path.join(androidJniDir, 'lzma', 'C'),
    path.join(harmonyNativeStageJniDir, 'lzma', 'C')
  );
  copyPath(patchCoreDir, harmonyNativeStagePatchCoreDir);
  copyPath(
    updateFlowCoreDir,
    path.join(harmonyNativeStageDir, 'update_flow_core')
  );
}

function cleanupHarmonyNativeSources() {
  fs.rmSync(harmonyNativeStageDir, { recursive: true, force: true });
}

function copyPath(sourcePath, targetPath) {
  const stats = fs.statSync(sourcePath);
  if (stats.isDirectory()) {
    fs.cpSync(sourcePath, targetPath, {
      recursive: true,
      force: true,
      filter: (entry) => path.basename(entry) !== '.git',
    });
    return;
  }

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.copyFileSync(sourcePath, targetPath);
}

function ensureWrapperProject() {
  wrapperProjectFiles.forEach((relativePath) => {
    const fullPath = path.join(wrapperProjectDir, relativePath);
    ensureFileExists(
      fullPath,
      `Missing Harmony wrapper file: ${relativeToProject(fullPath)}`
    );
  });
}

function parseArgs(argv) {
  const parsed = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      fail(`Unsupported argument: ${token}`);
    }

    const keyValue = token.slice(2).split('=');
    const key = keyValue[0];
    const inlineValue = keyValue.length > 1 ? keyValue.slice(1).join('=') : '';

    if (key === 'skip-install') {
      parsed[key] = true;
      continue;
    }

    const value = inlineValue || argv[index + 1];
    if (!value || value.startsWith('--')) {
      fail(`Missing value for --${key}`);
    }

    parsed[key] = value;
    if (!inlineValue) {
      index += 1;
    }
  }

  return parsed;
}

function normalizeBuildMode(value) {
  const mode = String(value).toLowerCase();
  if (mode === 'debug' || mode === 'release') {
    return mode;
  }

  fail(`Unsupported build mode: ${value}. Use debug or release.`);
}

function getDevEcoRoots() {
  const roots = new Set();
  const envCandidates = [
    process.env.DEVECO_STUDIO_HOME,
    process.env.DEVECO_SDK_HOME,
  ].filter(Boolean);

  envCandidates.forEach((candidate) => {
    const normalized = normalizeDevEcoRoot(candidate);
    if (normalized) {
      roots.add(normalized);
    }
  });

  roots.add('/Applications/DevEco-Studio.app/Contents');
  if (process.platform === 'win32') {
    const programFilesRoots = [
      process.env.ProgramFiles,
      process.env['ProgramFiles(x86)'],
    ].filter(Boolean);
    for (const programFilesRoot of programFilesRoots) {
      roots.add(path.join(programFilesRoot, 'Huawei', 'DevEco Studio'));
      roots.add(path.join(programFilesRoot, 'Huawei', 'DevEco Studio Release'));
    }
  }
  return Array.from(roots);
}

function normalizeDevEcoRoot(value) {
  const resolved = path.resolve(value);
  const basename = path.basename(resolved);

  if (basename === 'sdk') {
    return path.dirname(resolved);
  }

  if (basename === 'Contents') {
    return resolved;
  }

  if (resolved.endsWith('.app')) {
    return path.join(resolved, 'Contents');
  }

  if (fs.existsSync(path.join(resolved, 'Contents', 'tools'))) {
    return path.join(resolved, 'Contents');
  }

  return resolved;
}

function resolveBinary(name, candidates) {
  const expandedCandidates = candidates.flatMap((candidate) =>
    expandBinaryCandidate(candidate),
  );
  const explicitPath = findExistingPath(expandedCandidates);
  if (explicitPath) {
    return explicitPath;
  }

  const lookupCommand = process.platform === 'win32' ? 'where.exe' : 'which';
  const whichResult = spawnSync(lookupCommand, [name], {
    encoding: 'utf8',
  });
  if (whichResult.status === 0) {
    const resolved = whichResult.stdout.trim();
    if (resolved) {
      return resolved;
    }
  }

  return null;
}

function expandBinaryCandidate(candidate) {
  if (!candidate) {
    return [];
  }
  if (path.extname(candidate)) {
    return [candidate];
  }
  if (process.platform !== 'win32') {
    return [candidate];
  }
  return [
    `${candidate}.js`,
    `${candidate}.exe`,
    `${candidate}.cmd`,
    `${candidate}.bat`,
    candidate,
  ];
}

function findExistingPath(candidates) {
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function findUsableDevEcoSdkHome(roots) {
  const candidates = roots.map((root) => path.join(root, 'sdk'));
  return (
    candidates.find((candidate) => {
      return (
        fs.existsSync(path.join(candidate, 'default', 'openharmony', 'ets')) &&
        fs.existsSync(
          path.join(candidate, 'default', 'openharmony', 'native', 'llvm'),
        ) &&
        fs.existsSync(path.join(candidate, 'default', 'hms', 'native'))
      );
    }) || null
  );
}

function resolveDevEcoNode(roots) {
  const candidates = [
    process.env.NODE_HOME ? path.join(process.env.NODE_HOME, 'node.exe') : null,
    ...roots.map((root) => path.join(root, 'tools', 'node', 'node.exe')),
  ].filter(Boolean);
  return findExistingPath(candidates);
}

function runCommand(command, commandArgs, options) {
  const { cwd, env, label, nodeExecutable } = options;
  console.log(`> ${label}`);
  console.log(`  ${[command, ...commandArgs].join(' ')}`);

  const extension = path.extname(command).toLowerCase();
  const isNodeScript = extension === '.js';
  const isWindowsBatch =
    process.platform === 'win32' && /\.(?:bat|cmd)$/i.test(command);
  const executable = isNodeScript
    ? nodeExecutable || process.execPath
    : isWindowsBatch
      ? process.env.ComSpec || 'cmd.exe'
      : command;
  const executableArgs = isNodeScript
    ? [command, ...commandArgs]
    : isWindowsBatch
      ? [
          '/d',
          '/s',
          '/c',
          `call "${command}" ${commandArgs
            .map(quoteWindowsBatchArgument)
            .join(' ')}`,
        ]
      : commandArgs;

  const result = spawnSync(executable, executableArgs, {
    cwd,
    env,
    stdio: 'inherit',
  });

  if (result.status !== 0) {
    const detail = result.error ? `: ${result.error.message}` : '';
    fail(`${label} failed with exit code ${result.status || 1}${detail}.`);
  }
}

function quoteWindowsBatchArgument(value) {
  const text = String(value);
  if (!/[\s"&|<>^]/.test(text)) {
    return text;
  }
  return `"${text.replace(/"/g, '""')}"`;
}

function findNewestHar(rootDir) {
  if (!fs.existsSync(rootDir)) {
    return null;
  }

  let latestFile = null;
  let latestMtime = 0;
  const queue = [rootDir];

  while (queue.length > 0) {
    const currentDir = queue.pop();
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        queue.push(fullPath);
        continue;
      }

      if (!entry.isFile() || !entry.name.endsWith('.har')) {
        continue;
      }

      const stat = fs.statSync(fullPath);
      if (!latestFile || stat.mtimeMs > latestMtime) {
        latestFile = fullPath;
        latestMtime = stat.mtimeMs;
      }
    }
  }

  return latestFile;
}

function ensureFileExists(filePath, message) {
  if (!fs.existsSync(filePath)) {
    fail(message);
  }
}

function relativeToProject(filePath) {
  return path.relative(projectRoot, filePath) || '.';
}

function fail(message) {
  throw new Error(message);
}

function hasDependencies(dir) {
  try {
    const pkgPath = path.join(dir, 'oh-package.json5');
    if (!fs.existsSync(pkgPath)) {
      return false;
    }
    const pkgContent = fs.readFileSync(pkgPath, 'utf8');
    const cleanJson = pkgContent.replace(
      /\/\*[\s\S]*?\*\/|([^\\:]|^)\/\/.*$/gm,
      ''
    );
    const pkg = eval('(' + cleanJson + ')');
    const hasDeps =
      pkg.dependencies && Object.keys(pkg.dependencies).length > 0;
    const hasDevDeps =
      pkg.devDependencies && Object.keys(pkg.devDependencies).length > 0;
    return !!(hasDeps || hasDevDeps);
  } catch (e) {
    return true;
  }
}
