/**
 * [INPUT]: 依赖 CLI i18n 键与中文产品术语
 * [OUTPUT]: 对外提供 Pakta 中文文案，仅由中文 locale 选择
 * [POS]: locales 中文资源事实源，只表达交互语义，不参与上传裁决
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
export default {
  accountSummary:
    '当前账号：{{account}} | 套餐：{{tier}} | 有效期至：{{expiry}}',
  accountUnknown: '未知',
  accountNoExpiry: '未设置有效期',
  accountRenewalWarning:
    '[注意] 您的 Pakta 付费套餐将在 {{days}} 天内到期，请及时续费，以免影响服务：{{- url}}',
  addedToGitignore: '已将 {{line}} 添加到 .gitignore',
  androidCrunchPngsWarning:
    'android 的 crunchPngs 选项似乎尚未禁用（如已禁用则请忽略此提示），这可能导致热更包体积异常增大，具体请参考 https://github.com/pakta-team/rn-update/blob/main/rn-update/README-CN.md#安装与原生接入 \n',
  aabOpenApksFailed: '无法打开生成的 .apks 文件',
  aabReadUniversalApkFailed: '无法读取 universal.apk',
  aabUniversalApkNotFound: '在生成的 .apks 中未找到 universal.apk',
  aabBundletoolDownloadHint:
    '未找到 bundletool，正在通过 npx 下载 node-bundletool（首次下载可能需要一些时间）。',
  aabManifestNotFound: '在 AAB 的 base/manifest/ 中找不到 AndroidManifest.xml',
  aabParseResourcesWarning: '[警告] 解析 resources.arsc 失败：{{error}}',
  aabParseFailed: '解析 AAB 失败：{{error}}',
  aabParseManifestError: '解析 AndroidManifest.xml 出错：{{error}}',
  aabParseResourcesError: '解析 resources.arsc 出错：{{error}}',
  appId: '应用 id',
  appIdMismatchApk:
    'appId不匹配！当前apk: {{appIdInPkg}}, 当前{{- source}}: {{appId}}',
  appIdMismatchApp:
    'appId不匹配！当前app: {{appIdInPkg}}, 当前{{- source}}: {{appId}}',
  appIdMismatchIpa:
    'appId不匹配！当前ipa: {{appIdInPkg}}, 当前{{- source}}: {{appId}}',
  appKeyMismatchApk:
    'appKey不匹配！当前apk: {{appKeyInPkg}}, 当前{{- source}}: {{appKey}}',
  appKeyMismatchApp:
    'appKey不匹配！当前app: {{appKeyInPkg}}, 当前{{- source}}: {{appKey}}',
  appKeyMismatchIpa:
    'appKey不匹配！当前ipa: {{appKeyInPkg}}, 当前{{- source}}: {{appKey}}',
  appName: '应用名称',
  appNameQuestion: '应用名称:',
  appPlatformMismatch:
    '应用 {{appId}} 是 {{appPlatform}} 平台的应用，但当前命令的平台是 {{platform}}',
  appNotSelected:
    '尚未选择应用。请先运行 `pakta selectApp --platform {{platform}}` 来选择应用',
  appUploadSuccess:
    '已成功上传app原生包（id: {{id}}, version: {{version}}, buildTime: {{buildTime}}）',
  autoUpdatePermission:
    'CLI 自动更新已跳过：全局包目录不可写。请修复包管理器的全局目录权限后运行：{{- command}}',
  autoUpdateSuccess: 'CLI 已在后台自动更新：{{from}} -> {{to}}',
  apkUploadSuccess:
    '已成功上传apk原生包（id: {{id}}, version: {{version}}, buildTime: {{buildTime}}）',
  boundTo: ', 已绑定：{{name}} ({{id}})',
  buildTimeNotFound:
    '无法获取此包的编译时间戳。请更新 `rn-update` 到最新版本后重新打包上传。',
  bundleCommandError: '"react-native bundle" 命令退出，代码为 {{code}}。',
  bundleNotFound:
    '找不到 bundle 文件。请确保此 {{packageType}} 为 release 版本，且 bundle 文件名为默认的 `{{entryFile}}`',
  bundlingWithRN: '正在使用 react-native {{version}} 打包',
  cancelled: '已取消',
  composingSourceMap: '正在生成 source map',
  copyingDebugId: '正在复制 debugid',
  createAppSuccess: '已成功创建应用（id: {{id}}）',
  channelAutoCreated: '渠道 {{channel}} 不存在，已自动创建',
  deleteFile: '删除 {{- file}}',
  enterAppIdQuestion: '输入应用 id:',
  enterNativePackageId: '输入原生包 id:',
  expiredStatus: '(已过期)',
  failedToParseUpdateJson: '无法解析文件 `{{- configPath}}`。请手动删除它。',
  fileGenerated: '已生成 {{- file}}',
  fileSizeExceeded:
    '此文件大小 {{fileSize}} , 超出当前额度 {{maxSize}} 。您可以考虑升级付费业务以提升此额度。详情请访问: {{- pricingPageUrl}}',
  forceHermes: '强制启用 Hermes 编译',
  hermesEnabledCompiling: 'Hermes 已启用，正在编译为 hermes 字节码：\n',
  ipaUploadSuccess:
    '已成功上传ipa原生包（id: {{id}}, version: {{version}}, buildTime: {{buildTime}}）',
  latestVersionTag: '（最新：{{version}}）',
  lockBestPractice: `
关于 lock 文件的最佳实践：
1. 开发团队中的所有成员应该使用相同的包管理器，维护同一份 lock 文件。
2. 将 lock 文件添加到版本控制中（但不要同时提交多种不同格式的 lock 文件）。
3. 代码审核时应关注 lock 文件的变化。
这样可以最大限度避免因依赖关系不一致而导致的热更异常，也降低供应链攻击等安全隐患。
`,
  lockNotFound:
    '没有检测到任何 lock 文件，这可能导致依赖关系不一致而使热更异常。',
  loggedOut: '已退出登录',
  loginExpired: '登录信息已过期，请使用 `pakta login` 命令重新登录',
  loginFirst: '尚未登录。\n请在项目目录中运行`pakta login`命令来登录',
  multipleLocksFound:
    '检测到多种不同格式的锁文件({{- lockFiles}})，这可能导致依赖关系不一致而使热更异常。',
  nativePackageId: '原生包 Id',
  nativeVersion: '原生版本',
  nativeVersionNotFoundGte: '未查询到 >= {{version}} 的原生版本',
  nativeVersionNotFoundLte: '未查询到 <= {{version}} 的原生版本',
  nativeVersionNotFoundBetween: '未查询到 {{min}} 至 {{max}} 之间的原生版本',
  conflictingPackageSelectors:
    'packageId / packageVersion / packageVersionRange / minPackageVersion+maxPackageVersion 只能使用其中一组，不能混用',
  nativeVersionNotFoundMatch: '未查询到匹配原生版本：{{version}}',
  nativeVersionAlreadyRegistered:
    '原生包 {{version}} 已登记且内嵌 JS 内容一致，无需重复上传（id: {{id}}）',
  nativeVersionBundleConflict:
    '原生包 {{version}} 已登记但内嵌 JS 内容不同。请提升原生版本号后再上传，否则该版本的增量更新判定会失准',
  nativePackageIdNotFound: '未查询到原生包 id: {{id}}',
  noPackagesFound: '未查询到任何原生包（appId: {{appId}}）',
  offset: '偏移量 {{offset}}',
  operationComplete: '操作完成，共已绑定 {{count}} 个原生版本',
  operationSuccess: '操作成功',
  packageIdRequired: '请提供 packageId 或 packageVersion 参数',
  standaloneTargetRequired:
    '独立服务非交互发布必须提供 --targets、--packageId 或 --packageVersion。',
  packageUploadSuccess: '已成功上传新热更包（id: {{id}}）',
  depsChangeWarningTitle: '检测到依赖变化',
  depsChangeSummary:
    '依赖变化：新增 {{added}} 项，移除 {{removed}} 项，版本变更 {{changed}} 项。',
  depsChangeTargetPackage: '目标原生包：{{packageName}} (id: {{packageId}})',
  depsChangeDependencyHeader: '依赖',
  depsChangeVersionHeader: '版本变化',
  depsChangeAddedLabel: '新增',
  depsChangeRemovedLabel: '移除',
  depsChangeChangedLabel: '变更',
  depsChangeArrow: '->',
  depsChangeRiskWarning:
    '警告：如果变更依赖是纯 JS 模块，则一般没有影响；若包含原生代码新增或变化，热更可能导致功能不正常甚至闪退，建议发布前使用扫码功能完整测试。',
  depsChangeFetchFailed: '获取热更依赖信息失败：{{error}}',
  depsChangeNonBlockingHint: '以上仅为依赖变化提示，不会阻止本次发布。',
  packing: '正在打包',
  pausedStatus: '(已暂停)',
  platform: '平台',
  platformQuestion: '平台(ios/android/harmony):',
  pluginDetectionError: '检测 {{name}} 插件时出错：{{error}}',
  pluginDetected: '检测到 {{name}} 插件',
  sourceMapNotFound: '找不到 source map：{{path}}',
  sourceMapMissingWarning:
    '本版本没有归档 source map，之后的崩溃堆栈将无法还原。请用默认的 --sourcemap 打包，或在 publish 时传 --sourcemap <文件>。',
  sourceMapArchived: 'source map 已随版本 {{id}} 归档',
  sourceMapAlreadyArchivedWarning:
    '此热更 hash 已经登记，本次新的 source map 未附加到已有包。',
  sourceMapUploadFailedWarning:
    'source map 上传失败（{{error}}），本次发布不归档 map。升级更新服务端后可归档 source map。',
  symbolicateUsage:
    '用法：pakta symbolicate <堆栈文件 | -> --hash <热更 hash> [--platform ios|android|harmony] [--output <文件>]',
  symbolicateVersionNotFound: '当前应用下找不到 hash 为 {{hash}} 的已发布版本',
  symbolicateNoSourceMap: '版本 {{id}} 发布时未归档 source map，无法还原',
  symbolicateDone: '已按版本 {{id}}（{{hash}}）还原 {{count}} 个堆栈帧',
  publishUsage:
    '使用方法: pakta publish ppk后缀文件 --platform ios|android|harmony',
  rnuVersionNotFound: 'rn-update: 无法获取版本号。请在项目目录中运行命令',
  rolloutConfigSet:
    '已在原生版本 {{versions}} 上设置灰度发布 {{rollout}}% 热更包 {{version}}',
  rolloutRangeError: 'rollout 必须是 1-100 的整数',
  runningHermesc: '运行 hermesc：{{- command}} {{- args}}',
  hermesSourcemapKept:
    '字节码已剥离 debug info（与 RN release 构建一致）；Hermes sourcemap 保留在 {{- file}}，可用于事后符号化崩溃堆栈。',
  sentryReactNativeNotFound: '无法找到 @sentry/react-native，请确保已正确安装',
  sentryCliNotFound: '无法找到 Sentry CLI 工具，请确保已正确安装 @sentry/cli',
  sentryReleaseCreated: '已为版本 {{version}} 创建 Sentry release',
  totalApps: '共 {{count}} 个 {{platform}} 应用',
  totalPackages: '共 {{count}} 个包',
  unsupportedPlatform: '无法识别的平台 `{{platform}}`',
  uploadBundlePrompt: '是否现在上传此热更包?(Y/N)',
  uploadingSourcemap: '正在上传 sourcemap',
  usageDiff: '用法：pakta {{command}} <origin> <next>',
  usageParseApk: '使用方法: pakta parseApk apk后缀文件',
  usageParseAab: '使用方法: pakta parseAab aab后缀文件',
  usageExtractApk:
    '使用方法: pakta extractApk aab后缀文件 [--output apk文件] [--includeAllSplits] [--splits 分包名列表]',
  usageParseApp: '使用方法: pakta parseApp app后缀文件',
  usageParseIpa: '使用方法: pakta parseIpa ipa后缀文件',
  usageUploadApk: '使用方法: pakta uploadApk apk后缀文件',
  usageUploadAab:
    '使用方法: pakta uploadAab aab后缀文件 [--includeAllSplits] [--splits 分包名列表]',
  usageUploadApp: '使用方法: pakta uploadApp app后缀文件',
  usageUploadIpa: '使用方法: pakta uploadIpa ipa后缀文件',
  versionBind:
    '已将热更包 {{version}} 绑定到原生版本 {{nativeVersion}} (id: {{id}})',
  versionIdRequired: '非交互模式下请提供 versionId。',
  welcomeMessage: '欢迎使用 pakta 热更新服务，{{name}}。',
  versionNameQuestion: '输入版本名称:',
  versionDescriptionQuestion: '输入版本描述:',
  versionMetaInfoQuestion: '输入自定义的 meta info:',
  updateNativePackageQuestion: '是否现在将此热更应用到原生包上？(Y/N)',
  unnamed: '(未命名)',
  dryRun: '以下是 dry-run 模拟运行结果，不会实际执行任何操作：',
  usingCustomVersion: '使用自定义版本：{{version}}',
  confirmDeletePackage: '确认删除原生包 {{packageId}}? 此操作不可撤销 (Y/N):',
  deletePackageSuccess: '原生包 {{packageId}} 删除成功',
  deletePackagesSuccess: '已删除 {{count}} 个原生包：{{packageIds}}',
  deletePackageError: '删除原生包 {{packageId}} 失败: {{error}}',
  usageDeletePackage:
    '使用方法: pakta deletePackage [packageId] --packageIds [packageIds] --appId [appId]',
  deleteVersionSuccess: '热更包 {{versionId}} 删除成功',
  deleteVersionsSuccess: '已删除 {{count}} 个热更包：{{versionIds}}',
  deleteVersionError: '删除热更包 {{versionId}} 失败: {{error}}',
  bundleFileNotFound: '未找到 bundle 文件！请使用默认的 bundle 文件名和路径。',
  diffPackageGenerated: '{{- output}} 已生成。',
  nodeHdiffpatchRequired:
    '此功能需要 "node-hdiffpatch"。请运行 "{{scriptName}} install node-hdiffpatch" 来安装',
  hbcTransformRoundTripFailed:
    'HBC 变换 round-trip 自检未通过，已回退普通 diff。',
  hbcTransformNeedsPatch:
    'hbcTransform 需要 node-hdiffpatch 的 patch 能力，选项已忽略。',
  bundleStreamNeedsHdiffpatch:
    'bundleStreamThreshold 需要 node-hdiffpatch 的 diffStream/patchStream 能力，选项已忽略。',
  apkExtracted: 'APK 已提取到 {{output}}',
  composeSourceMapsNotFound:
    '找不到 react-native/scripts/compose-source-maps.js，跳过 hermes sourcemap 合成。上传的 sourcemap 可能与编译后的 bundle 不匹配。',
  installPackageRequired:
    '请指定要安装的包，例如 "{{scriptName}} install node-hdiffpatch"',
  installFailed: '安装 {{packages}} 失败: {{error}}',
  proxyNetworkError:
    '网络连接异常，可能是代理/VPN 导致。请尝试关闭代理后重试。',
  proxyNetworkErrorTips:
    '常见解决方法：\n1. 关闭系统代理或 VPN\n2. 检查 HTTP_PROXY / HTTPS_PROXY 环境变量\n3. 检查 .npmrc 中的 proxy 配置',
  invalidId: '无效的 id：{{id}}',
  outputPathRequired: '必须指定输出路径。',
  unsupportedFileType: '不支持的文件类型：{{fileType}}',
  failedToLoadSession: '加载登录状态失败',
  appIdRequired: '必须指定 appId',
  unknownCommand: '未知命令：{{command}}',
  unsupportedPlatformForHermes: 'Hermes 不支持当前系统平台：{{platform}}',
  invalidManifest: '无效的 manifest',
  failedToResolveResource: '资源解析失败：{{error}}',
  hermesBaseNone: 'Hermes base：未使用（{{- reason}}），按普通方式编译',
  hermesBaseUsing: 'Hermes base：{{- source}}（HBC v{{version}}）',
  hermesBaseDownloading: 'Hermes base：下载 {{- url}}',
  hermesBaseRangeFetched:
    'Hermes base：已通过 HTTP Range 仅下载 bundle（{{fetchedKb}} KB / 整包 {{totalKb}} KB）',
  hermesBaseRangeFallback:
    'Hermes base：无法按需下载（{{- reason}}），改为下载整包',
  hermesBaseCompileFailed:
    'Hermes base 编译失败（{{- reason}}），改为不带 -base-bytecode 重编',
  hermesBaseCompileFailedLog: 'Hermes base：完整编译错误已写入 {{- file}}',
  hermesBasePlainCompileFailed:
    'Hermes base：用于校验的普通编译失败（{{- reason}}），放弃 base，不带 base 重新编译',
  hermesBaseVerified:
    'Hermes base：字节码与普通编译等价，校验通过（{{functions}} 个函数）',
  hermesBaseVerifyFailed:
    'Hermes base：字节码与普通编译不等价（{{- detail}}），放弃 base',
  hermesBaseVerifyDumpFailed:
    'Hermes base：无法比对字节码（{{- detail}}），放弃 base',
  hermesBaseVerifyDumpsWritten:
    'Hermes base：两份反汇编已写入 {{- withBase}} 与 {{- plain}}',
  cacheCleaned: '已清理 {{count}} 个缓存 bundle',
  cacheStats: 'bundle 缓存：{{- dir}} — {{files}} 个文件，{{mb}} MB',
  loginCredentialsRequired:
    '需要提供邮箱和密码。用法：{{scriptName}} login <邮箱> <密码>',
  bundleUnexpectedArgs:
    'bundle 不接受位置参数，收到：{{- args}}。布尔选项不带值，关闭请使用 --no-<选项>（例如 --no-sourcemap）。',
  unsafeIntermediateDir:
    '拒绝清空中间目录 {{- dir}}：该路径指向受保护目录或包含符号链接。请用 --intermediaDir 指定一个专用的构建目录。',
  appKeyMissing: '应用 {{appId}} 未返回有效的 appKey。',
  accessTokenMissing: '登录响应中没有 access token。',
  bundleHashRequired: '独立服务登记原生包体必须包含 bundleHash。',
  channelAssertionFailed:
    '渠道断言失败：安装包内为 {{channel}}，而 --channel 为 {{requestedChannel}}。--channel 不会覆盖包内渠道。',
  channelCodeRequired: '渠道 code 不能为空。',
  channelAmbiguous:
    '渠道 {{channel}} 匹配多个已登记身份，请指定精确 code 或 channelId。',
  channelIdentityCannotCreate:
    '无法保留渠道 {{channel}} 的身份自动创建：服务端只创建小写 code，请明确登记所需身份。',
  channelHasNoNativePackages: '渠道 {{channel}} 下没有可绑定的原生包。',
  channelNotRegistered: '渠道 {{channel}} 尚未在应用中登记。',
  channelCreated: '已创建渠道 {{channel}}。',
  channelUpdated: '已更新渠道 {{channel}}。',
  channelManagementStandaloneOnly:
    '渠道管理需要独立服务，请设置 RNU_SERVICE_URL。',
  channelIdRequired: '{{command}} 需要 channelId。',
  deploymentIdsRequired: 'deploymentIds 不能为空。',
  deploymentInvalid:
    '投放 {{deploymentId}} 不属于应用 {{appId}} 或缺少目标身份。',
  deploymentPublishFailed: '发布失败，投放 ID：{{deploymentIds}}',
  deploymentStrategyMissing:
    '服务端未返回目标策略：{{channelId}}/{{packageVersion}}。',
  deploymentTargetsSinglePackage: 'deploymentIds 必须属于同一个热更新包。',
  duplicateDeploymentTarget:
    'targets.json 重复指定目标：{{channelId}}/{{packageVersion}}。',
  nativePackageQuotaMissing:
    '服务端未返回有效的原生包大小额度，请升级服务端后重试。',
  nativePackageTargetMissingInfo:
    '所选原生包缺少渠道或版本信息，无法创建投放目标。',
  specifiedNativePackageTargetMissingInfo:
    '指定的原生包缺少渠道或版本信息，无法创建投放目标。',
  objectStorageUploadFailed: '对象存储上传失败：HTTP {{status}}',
  objectStoragePartETagMissing:
    '对象存储未返回第 {{partNumber}} 个分片的 ETag。',
  pdiffServiceRequired:
    '逐构建 pdiff 登记需要独立服务，请设置 RNU_SERVICE_URL。',
  pdiffArgumentsRequired:
    'pdiff 登记需要 --deploymentId、--nativeVersionId 和 --diffFromHash。',
  pdiffHashInvalid: '--diffFromHash 必须是 64 位小写 SHA-256 摘要。',
  pdiffFileNotFound: 'pdiff 文件不存在：{{filePath}}',
  pdiffFileExtensionInvalid:
    'pdiff 文件必须以 .apk.patch、.ipa.patch、.hap.patch 或 .app.patch 结尾。',
  standaloneUploadAppIdRequired: '独立服务上传必须提供 appId。',
  standalonePackageVersionRequired: '独立服务发布必须指定 packageVersion。',
  targetsFileReadFailed: '无法读取 targets 文件：{{error}}',
  targetsFileInvalid: 'targets.json 必须是数组，或包含 targets 数组。',
  targetsRequired: '至少指定一个渠道版本组。',
  staleLocalBuild:
    'CLI 编译产物已过期。请在 rn-update-cli 目录执行 npm run build 后重试。',
  unspecified: '（未指定）',
  errorStackHint: '（设置 RNU_DEBUG=1 可打印完整堆栈）',
};
