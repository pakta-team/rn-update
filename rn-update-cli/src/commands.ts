/**
 * [INPUT]: 依赖各 CLI 命令组的惰性加载器与命令名/参数约定
 * [OUTPUT]: 对外提供 commandNames、loadCommandHandler 与命令处理器类型
 * [POS]: CLI 命令注册表，以按需加载隔离各命令依赖，避免入口提前加载完整工具链
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

// Command registry. Every command group is `require`d on first use, so a
// command only pays for its own modules: `apps` never loads Metro/Hermes
// plumbing, `bundle` never loads the source-map library, and so on.

type CliCommandHandler = (argv: any) => Promise<unknown> | unknown;
type HandlerMap = Record<string, CliCommandHandler>;

const groups = {
  app: () => require('./app').getAppCommands() as HandlerMap,
  bundle: () => require('./bundle').bundleCommands as HandlerMap,
  cache: () => require('./cache').cacheCommands as HandlerMap,
  diff: () => require('./diff').diffCommands as HandlerMap,
  install: () => require('./install').installCommands as HandlerMap,
  package: () => require('./package').packageCommands as HandlerMap,
  symbolicate: () => require('./symbolicate').symbolicateCommands as HandlerMap,
  user: () => require('./user').userCommands as HandlerMap,
  versions: () => require('./versions').versionCommands as HandlerMap,
};

/**
 * command name → group. Kept in sync with cli.json by tests/commands.test.ts,
 * so a command added to one place but not the other fails the suite.
 */
const commandGroups: Record<string, keyof typeof groups> = {
  login: 'user',
  logout: 'user',
  me: 'user',
  createApp: 'app',
  apps: 'app',
  channels: 'app',
  createChannel: 'app',
  updateChannel: 'app',
  deleteChannel: 'app',
  deleteApp: 'app',
  selectApp: 'app',
  uploadIpa: 'package',
  uploadApk: 'package',
  uploadAab: 'package',
  uploadApp: 'package',
  parseApp: 'package',
  parseIpa: 'package',
  parseApk: 'package',
  parseAab: 'package',
  extractApk: 'package',
  packages: 'package',
  deletePackage: 'package',
  registerPdiff: 'versions',
  publish: 'versions',
  versions: 'versions',
  update: 'versions',
  updateVersionInfo: 'versions',
  deleteVersion: 'versions',
  bundle: 'bundle',
  hdiff: 'diff',
  hdiffFromApk: 'diff',
  hdiffFromApp: 'diff',
  hdiffFromIpa: 'diff',
  install: 'install',
  cache: 'cache',
  symbolicate: 'symbolicate',
};

/** names of all commands, in the order they are listed by `help` */
export const commandNames: readonly string[] = Object.keys(commandGroups);

/** the handler of `name`, loading its module now; undefined for unknown names */
export function loadCommandHandler(
  name: string,
): CliCommandHandler | undefined {
  const group = commandGroups[name];
  if (!group) {
    return undefined;
  }
  return groups[group]()[name];
}
