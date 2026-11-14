import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const windows = process.platform === 'win32';
const nativeRoot = windows
  ? `/mnt/${root[0].toLowerCase()}${root.slice(2).replaceAll('\\', '/')}`
  : root;
const binary = `${nativeRoot}/.tmp/config-host/config_host`;
let built = false;

export function configCore(op: string, args: unknown[]): unknown {
  if (!built) {
    mkdirSync(`${root}/.tmp/config-host`, { recursive: true });
    const sources = [
      'flow_json.cpp',
      'update_flow_core.cpp',
      'native_config.cpp',
      'native_round.cpp',
      'round_engine.cpp',
      'tests/config_host.cpp',
    ].map((name) => `${nativeRoot}/cpp/update_flow_core/${name}`);
    const command = [
      '-std=c++17',
      '-Wall',
      '-Wextra',
      '-Werror',
      ...sources,
      '-o',
      binary,
    ];
    const build = spawnSync(
      windows ? 'wsl' : 'c++',
      windows ? ['-d', 'Ubuntu', '--', 'c++', ...command] : command,
      { encoding: 'utf8' }
    );
    if (build.status !== 0)
      throw new Error(build.stderr || 'config host build failed');
    built = true;
  }
  const result = spawnSync(
    windows ? 'wsl' : binary,
    windows ? ['-d', 'Ubuntu', '--', binary] : [],
    { input: JSON.stringify({ op, args }), encoding: 'utf8' }
  );
  if (result.status !== 0)
    throw new Error(result.stderr || 'config host failed');
  return JSON.parse(result.stdout);
}

export function normalizeConfiguration(options: string): string {
  const result = configCore('normalize', [options]) as {
    value: string;
    error?: string;
  };
  if (result.error) throw new Error(result.error);
  return result.value;
}
