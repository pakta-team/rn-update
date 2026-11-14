/**
 * [INPUT]: 依赖旧版版本查询/绑定 API、渠道版本模型和终端交互工具
 * [OUTPUT]: 对外提供版本查询、依赖变更提示、原生包绑定及版本选择操作
 * [POS]: CLI 兼容发布操作层；独立服务的 UpdatePackage/Deployment 编排位于 standalone-publish.ts
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import chalk from 'chalk';
import { get, post } from './api';
import type { Package, Version } from './types';
import { isNonInteractive, loadTtyTable, question } from './utils';
import { t } from './utils/i18n';

type Deps = Record<string, string>;
type DepChangeType = 'added' | 'removed' | 'changed';

interface DepChange {
  dependency: string;
  oldVersion: string;
  newVersion: string;
  type: DepChangeType;
}

interface DepsChangeSummary {
  added: number;
  removed: number;
  changed: number;
}

export function normalizeDeps(input: unknown): Deps | undefined {
  if (!input) {
    return undefined;
  }

  let raw: unknown = input;
  if (typeof input === 'string') {
    try {
      raw = JSON.parse(input);
    } catch (_e) {
      return undefined;
    }
  }

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return undefined;
  }

  const deps: Deps = {};
  for (const [name, version] of Object.entries(
    raw as Record<string, unknown>,
  )) {
    if (typeof version === 'string' && version) {
      deps[name] = version;
    }
  }

  return Object.keys(deps).length > 0 ? deps : undefined;
}

function getDepsChanges(oldDeps?: Deps, newDeps?: Deps): DepChange[] {
  if (!oldDeps || !newDeps) {
    return [];
  }

  const rows: DepChange[] = [];
  const keys = Object.keys({ ...oldDeps, ...newDeps }).sort((a, b) =>
    a.localeCompare(b),
  );

  for (const key of keys) {
    const oldVersion = oldDeps[key];
    const newVersion = newDeps[key];

    if (oldVersion === undefined && newVersion !== undefined) {
      rows.push({
        dependency: key,
        oldVersion: '-',
        newVersion,
        type: 'added',
      });
      continue;
    }

    if (oldVersion !== undefined && newVersion === undefined) {
      rows.push({
        dependency: key,
        oldVersion,
        newVersion: '-',
        type: 'removed',
      });
      continue;
    }

    if (
      oldVersion !== undefined &&
      newVersion !== undefined &&
      oldVersion !== newVersion
    ) {
      rows.push({
        dependency: key,
        oldVersion,
        newVersion,
        type: 'changed',
      });
    }
  }

  return rows;
}

export function toNumericIds(ids: string[]) {
  return ids.map((id) => {
    const numericId = Number(id);
    if (!Number.isInteger(numericId) || numericId <= 0) {
      throw new Error(t('invalidId', { id }));
    }
    return numericId;
  });
}

function getDepsChangeSummary(changes: DepChange[]): DepsChangeSummary {
  return changes.reduce(
    (acc, item) => {
      if (item.type === 'added') {
        acc.added += 1;
      } else if (item.type === 'removed') {
        acc.removed += 1;
      } else {
        acc.changed += 1;
      }
      return acc;
    },
    { added: 0, removed: 0, changed: 0 },
  );
}

function renderVersionChange(change: DepChange) {
  const arrow = chalk.gray(` ${t('depsChangeArrow')} `);

  if (change.type === 'added') {
    return `${chalk.red(t('depsChangeAddedLabel'))} | ${chalk.gray(
      change.oldVersion,
    )}${arrow}${chalk.red(change.newVersion)}`;
  }

  if (change.type === 'removed') {
    return `${chalk.green(t('depsChangeRemovedLabel'))} | ${chalk.green(
      change.oldVersion,
    )}${arrow}${chalk.gray(change.newVersion)}`;
  }

  return `${chalk.yellow(t('depsChangeChangedLabel'))} | ${chalk.yellow(
    change.oldVersion,
  )}${arrow}${chalk.yellow(change.newVersion)}`;
}

function printDepsChangesForPackage({
  pkg,
  versionDeps,
}: {
  pkg: Package;
  versionDeps: Deps;
}) {
  const pkgDeps = normalizeDeps(pkg.deps);
  if (!pkgDeps) {
    return false;
  }

  const changes = getDepsChanges(pkgDeps, versionDeps);
  if (changes.length === 0) {
    return false;
  }

  const summary = getDepsChangeSummary(changes);
  const summaryText = t('depsChangeSummary', {
    added: chalk.red(String(summary.added)),
    removed: chalk.green(String(summary.removed)),
    changed: chalk.yellow(String(summary.changed)),
  });
  const header = [
    { value: t('depsChangeDependencyHeader') },
    { value: t('depsChangeVersionHeader') },
  ];
  const rows = changes.map((change) => [
    change.dependency,
    renderVersionChange(change),
  ]);

  console.log('');
  console.log(chalk.bgYellow.black.bold(` ${t('depsChangeWarningTitle')} `));
  console.log(
    chalk.yellow(
      t('depsChangeTargetPackage', {
        packageName: pkg.name,
        packageId: pkg.id,
      }),
    ),
  );
  console.log(summaryText);
  // tty-table is ~25 ms to load; only pay for it when a table is rendered
  const Table = loadTtyTable();
  console.log(Table(header, rows).render());
  console.log(chalk.yellow(t('depsChangeRiskWarning')));
  return true;
}

async function findVersionDeps(appId: string, versionId: string) {
  const targetId = String(versionId);
  const limit = 100;
  let offset = 0;

  while (true) {
    const { data, count } = await get(
      `/app/${appId}/version/list?offset=${offset}&limit=${limit}`,
    );
    const versions: Version[] = Array.isArray(data) ? data : [];
    const version = versions.find((item) => String(item.id) === targetId);

    if (version) {
      return normalizeDeps(version.deps);
    }

    offset += versions.length;
    if (versions.length === 0 || offset >= Number(count || 0)) {
      break;
    }
  }

  return undefined;
}

export async function printDepsChangesForPublish({
  appId,
  versionId,
  pkgs,
  providedVersionDeps,
}: {
  appId: string;
  versionId?: string;
  pkgs: Package[];
  providedVersionDeps?: Deps;
}) {
  if (!versionId || pkgs.length !== 1) {
    return;
  }

  let versionDeps = normalizeDeps(providedVersionDeps);
  if (!versionDeps) {
    try {
      versionDeps = await findVersionDeps(appId, versionId);
    } catch (error: any) {
      console.warn(
        chalk.yellow(
          t('depsChangeFetchFailed', {
            error: error?.message || String(error),
          }),
        ),
      );
      return;
    }
  }

  if (!versionDeps) {
    return;
  }

  let hasChanges = false;
  for (const pkg of pkgs) {
    const printed = printDepsChangesForPackage({ pkg, versionDeps });
    hasChanges = hasChanges || printed;
  }

  if (hasChanges) {
    console.log(chalk.yellow(t('depsChangeNonBlockingHint')));
  }
}

const versionPageLimit = 10;

export async function fetchVersions(
  appId: string,
  offset = 0,
  limit = versionPageLimit,
): Promise<Version[]> {
  const { data } = await get(
    `/app/${appId}/version/list?offset=${offset}&limit=${limit}`,
  );
  return Array.isArray(data) ? data : [];
}

/**
 * 按谓词从最新版本向旧分页查找；崩溃与绑定通常发生在近期版本。
 */
export async function findVersion(
  appId: string,
  predicate: (version: Version) => boolean,
): Promise<Version | undefined> {
  const limit = 100;
  for (let offset = 0; offset < 100 * limit; offset += limit) {
    const page = await fetchVersions(appId, offset, limit);
    const found = page.find(predicate);
    if (found || page.length < limit) {
      return found;
    }
  }
  return undefined;
}

async function showVersion(appId: string, offset: number) {
  const data = await fetchVersions(appId, offset, versionPageLimit);
  console.log(t('offset', { offset }));
  for (const version of data) {
    const pkgCount = version.packages?.length || 0;
    let packageInfo = '';
    if (pkgCount === 0) {
      packageInfo = 'no package';
    } else {
      packageInfo = (version.packages ?? [])
        .slice(0, 3)
        .map((pkg: Package) => pkg.name)
        .join(', ');
      if (pkgCount > 3) {
        packageInfo += `...and ${pkgCount - 3} more`;
      } else {
        packageInfo = `[${packageInfo}]`;
      }
    }
    console.log(
      `${version.id}) ${version.hash.slice(0, 8)} ${
        version.name
      } ${packageInfo}`,
    );
  }
  return data;
}

export async function listVersions(appId: string, interactive = true) {
  let offset = 0;
  while (true) {
    const data = await showVersion(appId, offset);
    if (!interactive) {
      return data;
    }
    const cmd = await question('page Up/page Down/Begin/Quit(U/D/B/Q)');
    switch (cmd.toLowerCase()) {
      case 'u':
        offset = Math.max(0, offset - 10);
        break;
      case 'd':
        offset += 10;
        break;
      case 'b':
        offset = 0;
        break;
      case 'q':
        return data;
      case '':
        return data;
    }
  }
}

export async function chooseVersion(appId: string) {
  let offset = 0;
  while (true) {
    const data = await showVersion(appId, offset);
    if (isNonInteractive()) {
      throw new Error(t('versionIdRequired'));
    }
    const cmd = await question(
      'Enter versionId or page Up/page Down/Begin(U/D/B)',
    );
    switch (cmd.toUpperCase()) {
      case 'U':
        offset = Math.max(0, offset - 10);
        break;
      case 'D':
        offset += 10;
        break;
      case 'B':
        offset = 0;
        break;
      default: {
        const versionId = Number.parseInt(cmd, 10);
        const v = data.find(
          (version: Version) => String(version.id) === String(versionId),
        );
        if (v) {
          return v;
        }
      }
    }
  }
}

export const bindVersionToPackages = async ({
  appId,
  versionId,
  pkgs,
  rollout,
  dryRun,
}: {
  appId: string;
  versionId: string | null;
  pkgs: Package[];
  rollout?: number;
  dryRun?: boolean;
}) => {
  if (dryRun) {
    console.log(chalk.yellow(t('dryRun')));
  }
  if (rollout !== undefined) {
    console.log(
      `${t('rolloutConfigSet', {
        version: versionId,
        versions: pkgs.map((pkg: Package) => pkg.name).join(', '),
        rollout: rollout,
      })}`,
    );
  }

  if (!dryRun) {
    if (pkgs.length === 1) {
      await post(`/app/${appId}/binding`, {
        versionId,
        rollout,
        packageId: pkgs[0].id,
      });
    } else {
      await post(`/app/${appId}/binding`, {
        versionId,
        rollout,
        packageIds: toNumericIds(pkgs.map((pkg) => String(pkg.id))),
      });
    }
  }

  for (const pkg of pkgs) {
    console.log(
      `${t('versionBind', {
        version: versionId,
        nativeVersion: pkg.name,
        id: pkg.id,
      })}`,
    );
  }
  console.log(t('operationComplete', { count: pkgs.length }));
};
