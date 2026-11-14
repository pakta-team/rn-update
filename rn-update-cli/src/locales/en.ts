/**
 * [INPUT]: 依赖 CLI i18n 键与英文产品术语
 * [OUTPUT]: 对外提供 Pakta 英文文案，作为所有非中文 locale 和缺失翻译的兜底
 * [POS]: locales 英文资源事实源，与 zh.ts 保持键集合对称，不参与上传裁决
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
export default {
  accountSummary:
    'Account: {{account}} | Plan: {{tier}} | Expires at: {{expiry}}',
  accountUnknown: 'Unknown',
  accountNoExpiry: 'No expiry specified',
  accountRenewalWarning:
    '[Notice] Your Pakta paid plan expires in {{days}} days. Renew soon to avoid service disruption: {{- url}}',
  addedToGitignore: 'Added {{line}} to .gitignore',
  androidCrunchPngsWarning:
    'The crunchPngs option of android seems not disabled (Please ignore this warning if already disabled), which may cause abnormal consumption of mobile network traffic. Please refer to https://github.com/pakta-team/rn-update/blob/main/rn-update/README.md#installation-and-native-setup \n',
  aabOpenApksFailed: 'Failed to open generated .apks file',
  aabReadUniversalApkFailed: 'Failed to read universal.apk',
  aabUniversalApkNotFound: 'universal.apk not found in generated .apks',
  aabBundletoolDownloadHint:
    'bundletool not found. Downloading node-bundletool via npx (first run may take a while).',
  aabManifestNotFound:
    "AndroidManifest.xml can't be found in AAB base/manifest/",
  aabParseResourcesWarning:
    '[Warning] Failed to parse resources.arsc: {{error}}',
  aabParseFailed: 'Failed to parse AAB: {{error}}',
  aabParseManifestError: 'Parse AndroidManifest.xml error: {{error}}',
  aabParseResourcesError: 'Parser resources.arsc error: {{error}}',
  appId: 'App ID',
  appIdMismatchApk:
    'App ID mismatch! Current APK: {{appIdInPkg}}, current {{- source}}: {{appId}}',
  appIdMismatchApp:
    'App ID mismatch! Current APP: {{appIdInPkg}}, current {{- source}}: {{appId}}',
  appIdMismatchIpa:
    'App ID mismatch! Current IPA: {{appIdInPkg}}, current {{- source}}: {{appId}}',
  appKeyMismatchApk:
    'App Key mismatch! Current APK: {{appKeyInPkg}}, current {{- source}}: {{appKey}}',
  appKeyMismatchApp:
    'App Key mismatch! Current APP: {{appKeyInPkg}}, current {{- source}}: {{appKey}}',
  appKeyMismatchIpa:
    'App Key mismatch! Current IPA: {{appKeyInPkg}}, current {{- source}}: {{appKey}}',
  appName: 'App Name',
  appNameQuestion: 'App Name:',
  appPlatformMismatch:
    'App {{appId}} is a {{appPlatform}} app, but this command targets {{platform}}',
  appNotSelected:
    'App not selected. run `pakta selectApp --platform {{platform}}` first!',
  appUploadSuccess:
    'Successfully uploaded APP native package (id: {{id}}, version: {{version}}, buildTime: {{buildTime}})',
  autoUpdatePermission:
    'CLI auto-update was skipped because the global package directory is not writable. Fix the package-manager prefix permissions, then run: {{- command}}',
  autoUpdateSuccess:
    'CLI was automatically updated in the background: {{from}} -> {{to}}',
  apkUploadSuccess:
    'Successfully uploaded APK native package (id: {{id}}, version: {{version}}, buildTime: {{buildTime}})',
  boundTo: ', bound to: {{name}} ({{id}})',
  buildTimeNotFound:
    'Cannot get the build timestamp of this package. Please update `rn-update` to the latest version and re-package and upload.',
  bundleCommandError:
    '"react-native bundle" command exited with code {{code}}.',
  bundleNotFound:
    'Bundle file not found. Please ensure that this {{packageType}} is a release version and the bundle file name is the default `{{entryFile}}`',
  bundlingWithRN: 'Bundling with react-native: {{version}}',
  cancelled: 'Cancelled',
  composingSourceMap: 'Composing source map',
  copyingDebugId: 'Copying debugid',
  createAppSuccess: 'App created successfully (id: {{id}})',
  channelAutoCreated: 'Channel {{channel}} was missing and has been created',
  deleteFile: 'Delete {{- file}}',
  enterAppIdQuestion: 'Enter AppId:',
  enterNativePackageId: 'Enter native package ID:',
  expiredStatus: '(Expired)',
  failedToParseUpdateJson:
    'Failed to parse file `{{- configPath}}`. Try to remove it manually.',
  fileGenerated: '{{- file}} generated.',
  fileSizeExceeded:
    'This file size is {{fileSize}} , exceeding the current quota {{maxSize}} . You may consider upgrading to a higher plan to increase this quota. Details can be found at: {{- pricingPageUrl}}',
  forceHermes: 'Forcing Hermes enabled for this build',
  hermesEnabledCompiling: 'Hermes enabled, now compiling to hermes bytecode:\n',
  ipaUploadSuccess:
    'Successfully uploaded IPA native package (id: {{id}}, version: {{version}}, buildTime: {{buildTime}})',
  latestVersionTag: '(latest: {{version}})',
  lockBestPractice: `
Best practices for lock files:
1. All members of the development team should use the same package manager to maintain a single lock file.
2. Add the lock file to version control (but do not commit multiple lock files of different formats).
3. Pay attention to changes in the lock file during code review.
This can reduce the risk of inconsistent dependencies and supply chain attacks.
`,
  lockNotFound:
    'No lock file detected, which may cause inconsistent dependencies and hot-updating issues.',
  loggedOut: 'Logged out',
  loginExpired:
    'Login information has expired. Please use `pakta login` command to re-login',
  loginFirst:
    'Not logged in.\nPlease run `pakta login` in the project directory to login.',
  multipleLocksFound:
    'Multiple lock files detected ({{- lockFiles}}), which may cause inconsistent dependencies and hot-updating issues.',
  nativePackageId: 'Native Package ID',
  nativeVersion: 'Native Version',
  nativeVersionNotFoundGte: 'No native version found >= {{version}}',
  nativeVersionNotFoundLte: 'No native version found <= {{version}}',
  nativeVersionNotFoundBetween:
    'No native version found between {{min}} and {{max}}',
  conflictingPackageSelectors:
    'Only one of packageId / packageVersion / packageVersionRange / minPackageVersion+maxPackageVersion can be used at a time',
  nativeVersionNotFoundMatch: 'No matching native version found: {{version}}',
  nativeVersionAlreadyRegistered:
    'Native package {{version}} is already registered with identical embedded JS; skipping duplicate upload (id: {{id}})',
  nativeVersionBundleConflict:
    'Native package {{version}} is already registered with different embedded JS. Increment the native version before uploading, or incremental update matching will become unreliable',
  nativePackageIdNotFound: 'No native package id found: {{id}}',
  noPackagesFound: 'No packages found. (appId: {{appId}})',
  offset: 'Offset {{offset}}',
  operationComplete: 'Operation complete, bound to {{count}} native versions',
  operationSuccess: 'Operation successful',
  packageIdRequired: 'Please provide packageId or packageVersion parameter',
  standaloneTargetRequired:
    'Standalone non-interactive publishing requires --targets, --packageId, or --packageVersion.',
  packageUploadSuccess:
    'Successfully uploaded new hot update package (id: {{id}})',
  depsChangeWarningTitle: 'Dependency changes detected',
  depsChangeSummary:
    'Dependency changes: added {{added}}, removed {{removed}}, changed {{changed}}.',
  depsChangeTargetPackage:
    'Target native package: {{packageName}} (id: {{packageId}})',
  depsChangeDependencyHeader: 'Dependency',
  depsChangeVersionHeader: 'Version change',
  depsChangeAddedLabel: 'Added',
  depsChangeRemovedLabel: 'Removed',
  depsChangeChangedLabel: 'Changed',
  depsChangeArrow: '->',
  depsChangeRiskWarning:
    'Warning: if changed dependencies are pure JS modules, impact is usually low; if native code is newly introduced or changed, OTA update may cause abnormal behavior or even crashes. Test thoroughly before production release.',
  depsChangeFetchFailed: 'Failed to fetch OTA dependency info: {{error}}',
  depsChangeNonBlockingHint:
    'This is only a dependency change warning and will not block publishing.',
  packing: 'Packing',
  pausedStatus: '(Paused)',
  platform: 'Platform',
  platformQuestion: 'Platform(ios/android/harmony):',
  pluginDetectionError: 'error while detecting {{name}} plugin: {{error}}',
  pluginDetected: 'detected {{name}} plugin',
  publishUsage:
    'Usage: pakta publish <ppk file> --platform ios|android|harmony',
  sourceMapNotFound: 'Source map not found: {{path}}',
  sourceMapMissingWarning:
    'No source map was archived with this version: crashes cannot be symbolicated later. Bundle with the default --sourcemap, or pass --sourcemap <file> to publish.',
  sourceMapArchived: 'Source map archived with version {{id}}',
  sourceMapAlreadyArchivedWarning:
    'This update hash is already registered; the new source map was not attached.',
  sourceMapUploadFailedWarning:
    'Source map upload failed ({{error}}); publishing without an archived map. Upgrade the update server to archive source maps.',
  symbolicateUsage:
    'Usage: pakta symbolicate <stack file | -> --hash <updateHash> [--platform ios|android|harmony] [--output <file>]',
  symbolicateVersionNotFound:
    'No published version with hash {{hash}} found for this app',
  symbolicateNoSourceMap:
    'Version {{id}} was published without a source map; nothing to symbolicate against',
  symbolicateDone:
    'Symbolicated {{count}} frame(s) against version {{id}} ({{hash}})',
  rnuVersionNotFound:
    'rn-update: Cannot get the version number. Please run the command in the project directory',
  rolloutConfigSet:
    'Set {{rollout}}% rollout for OTA update {{version}} on native version(s) {{versions}}',
  rolloutRangeError: 'rollout must be an integer between 1-100',
  runningHermesc: 'Running hermesc: {{- command}} {{- args}}',
  hermesSourcemapKept:
    'Debug info is stripped from the bytecode (like RN release builds); the Hermes sourcemap is kept at {{- file}} for symbolicating crash stacks later.',
  sentryReactNativeNotFound:
    'Cannot find @sentry/react-native, please make sure it is properly installed',
  sentryCliNotFound:
    'Cannot find Sentry CLI tool, please make sure @sentry/cli is properly installed',
  sentryReleaseCreated: 'Sentry release created for version: {{version}}',
  totalApps: 'Total {{count}} {{platform}} apps',
  totalPackages: 'Total {{count}} packages',
  unsupportedPlatform: 'Unsupported platform `{{platform}}`',
  uploadBundlePrompt: 'Upload this bundle now?(Y/N)',
  uploadingSourcemap: 'Uploading sourcemap',
  usageDiff: 'Usage: pakta {{command}} <origin> <next>',
  usageParseApk: 'Usage: pakta parseApk <apk file>',
  usageParseAab: 'Usage: pakta parseAab <aab file>',
  usageExtractApk:
    'Usage: pakta extractApk <aab file> [--output <apk file>] [--includeAllSplits] [--splits <split names>]',
  usageParseApp: 'Usage: pakta parseApp <app file>',
  usageParseIpa: 'Usage: pakta parseIpa <ipa file>',
  usageUploadApk: 'Usage: pakta uploadApk <apk file>',
  usageUploadAab:
    'Usage: pakta uploadAab <aab file> [--includeAllSplits] [--splits <split names>]',
  usageUploadApp: 'Usage: pakta uploadApp <app file>',
  usageUploadIpa: 'Usage: pakta uploadIpa <ipa file>',
  versionBind:
    'Bound hot update {{version}} to native version {{nativeVersion}} (id: {{id}})',
  versionIdRequired: 'Please provide versionId in non-interactive mode.',
  welcomeMessage: 'Welcome to Pakta hot update service, {{name}}.',
  versionNameQuestion: 'Enter OTA update name:',
  versionDescriptionQuestion: 'Enter OTA update description:',
  versionMetaInfoQuestion: 'Enter custom meta info:',
  updateNativePackageQuestion: 'Bind to native package now?(Y/N)',
  unnamed: '(Unnamed)',
  dryRun: 'Below is the dry-run result, no actual operation will be performed:',
  usingCustomVersion: 'Using custom version: {{version}}',
  confirmDeletePackage:
    'Confirm delete native package {{packageId}}? This operation cannot be undone (Y/N):',
  deletePackageSuccess: 'Native package {{packageId}} deleted successfully',
  deletePackagesSuccess: 'Deleted {{count}} native packages: {{packageIds}}',
  deletePackageError:
    'Failed to delete native package {{packageId}}: {{error}}',
  usageDeletePackage:
    'Usage: pakta deletePackage [packageId] --packageIds [packageIds] --appId [appId]',
  deleteVersionSuccess: 'Version {{versionId}} deleted successfully',
  deleteVersionsSuccess: 'Deleted {{count}} OTA versions: {{versionIds}}',
  deleteVersionError: 'Failed to delete version {{versionId}}: {{error}}',
  bundleFileNotFound:
    'Bundle file not found! Please use default bundle file name and path.',
  diffPackageGenerated: '{{- output}} generated.',
  nodeHdiffpatchRequired:
    'This function needs "node-hdiffpatch". Please run "{{scriptName}} install node-hdiffpatch" to install',
  hbcTransformRoundTripFailed:
    'HBC transform round-trip verification failed; falling back to plain diff.',
  hbcTransformNeedsPatch:
    'hbcTransform requires patch support from node-hdiffpatch; option ignored.',
  bundleStreamNeedsHdiffpatch:
    'bundleStreamThreshold requires diffStream/patchStream from node-hdiffpatch; option ignored.',
  apkExtracted: 'APK extracted to {{output}}',
  composeSourceMapsNotFound:
    'Cannot find react-native/scripts/compose-source-maps.js, skipping hermes sourcemap composing. The uploaded sourcemap may not match the compiled bundle.',
  installPackageRequired:
    'Please specify the package to install, e.g. "{{scriptName}} install node-hdiffpatch"',
  installFailed: 'Failed to install {{packages}}: {{error}}',
  proxyNetworkError:
    'Network error — likely caused by a proxy/VPN. Please try disabling your proxy and retry.',
  proxyNetworkErrorTips:
    'Common fixes:\n1. Disable system proxy or VPN\n2. Check HTTP_PROXY / HTTPS_PROXY environment variables\n3. Check proxy settings in .npmrc',
  invalidId: 'Invalid id: {{id}}',
  outputPathRequired: 'Output path is required.',
  unsupportedFileType: 'Unsupported file type: {{fileType}}',
  failedToLoadSession: 'Failed to load session',
  appIdRequired: 'appId is required',
  unknownCommand: 'Unknown command: {{command}}',
  unsupportedPlatformForHermes: 'Unsupported platform for Hermes: {{platform}}',
  invalidManifest: 'Invalid manifest',
  failedToResolveResource: 'Failed to resolve resource: {{error}}',
  hermesBaseNone:
    'Hermes base: none ({{- reason}}); compiling without -base-bytecode',
  hermesBaseUsing: 'Hermes base: {{- source}} (HBC v{{version}})',
  hermesBaseDownloading: 'Hermes base: downloading {{- url}}',
  hermesBaseRangeFetched:
    'Hermes base: fetched only the bundle via HTTP Range ({{fetchedKb}} KB of {{totalKb}} KB)',
  hermesBaseRangeFallback:
    'Hermes base: partial download unavailable ({{- reason}}); downloading the whole package',
  hermesBaseCompileFailed:
    'Hermes base compile failed ({{- reason}}); retrying without -base-bytecode',
  hermesBaseCompileFailedLog:
    'Hermes base: full compiler output written to {{- file}}',
  hermesBasePlainCompileFailed:
    'Hermes base: the plain compile used for verification failed ({{- reason}}); dropping the base and compiling again without it',
  hermesBaseVerified:
    'Hermes base: bytecode verified equivalent to a plain compile ({{functions}} functions)',
  hermesBaseVerifyFailed:
    'Hermes base: bytecode differs from a plain compile ({{- detail}}); dropping the base',
  hermesBaseVerifyDumpFailed:
    'Hermes base: could not compare the bytecode ({{- detail}}); dropping the base',
  hermesBaseVerifyDumpsWritten:
    'Hermes base: disassemblies written to {{- withBase}} and {{- plain}}',
  cacheCleaned: 'Removed {{count}} cached bundle(s)',
  cacheStats: 'Bundle cache: {{- dir}} — {{files}} file(s), {{mb}} MB',
  loginCredentialsRequired:
    'Email and password are required. Usage: {{scriptName}} login <email> <password>',
  bundleUnexpectedArgs:
    'bundle takes no positional arguments, got: {{- args}}. Boolean flags take no value; switch one off with --no-<flag> (e.g. --no-sourcemap).',
  unsafeIntermediateDir:
    'Refusing to empty {{- dir}} as the intermediate directory: it resolves to a protected or symbolic-link location. Point --intermediaDir at a dedicated build directory.',
  appKeyMissing: 'App {{appId}} did not return a valid app key.',
  accessTokenMissing: 'Login response did not include an access token.',
  bundleHashRequired:
    'Standalone native package registration requires bundleHash.',
  channelAssertionFailed:
    'Channel assertion failed: the package contains {{channel}}, but --channel is {{requestedChannel}}. --channel cannot override the package channel.',
  channelCodeRequired: 'Channel code cannot be empty.',
  channelAmbiguous:
    'Channel {{channel}} matches multiple registered identities. Specify an exact code or channelId.',
  channelIdentityCannotCreate:
    'Cannot auto-create channel {{channel}} without changing its identity: the service only creates lowercase codes. Register the intended identity explicitly.',
  channelHasNoNativePackages:
    'Channel {{channel}} has no native packages available to bind.',
  channelNotRegistered: 'Channel {{channel}} is not registered for this app.',
  channelCreated: 'Channel {{channel}} created successfully.',
  channelUpdated: 'Channel {{channel}} updated successfully.',
  channelManagementStandaloneOnly:
    'Channel management requires the standalone service. Set RNU_SERVICE_URL.',
  channelIdRequired: '{{command}} requires channelId.',
  deploymentIdsRequired: 'deploymentIds cannot be empty.',
  deploymentInvalid:
    'Deployment {{deploymentId}} does not belong to app {{appId}} or is missing target identity.',
  deploymentPublishFailed:
    'Publish failed for deployment IDs: {{deploymentIds}}',
  deploymentStrategyMissing:
    'The server did not return a deployment strategy for {{channelId}}/{{packageVersion}}.',
  deploymentTargetsSinglePackage:
    'deploymentIds must belong to the same hot update package.',
  duplicateDeploymentTarget:
    'targets.json specifies the deployment target more than once: {{channelId}}/{{packageVersion}}.',
  nativePackageQuotaMissing:
    'The server did not return a valid native package quota. Upgrade the server and try again.',
  nativePackageTargetMissingInfo:
    'The selected native package is missing channel or version information, so a deployment target cannot be created.',
  specifiedNativePackageTargetMissingInfo:
    'The specified native package is missing channel or version information, so a deployment target cannot be created.',
  objectStorageUploadFailed: 'Object storage upload failed: HTTP {{status}}',
  objectStoragePartETagMissing:
    'Object storage did not return an ETag for part {{partNumber}}.',
  pdiffServiceRequired:
    'Per-build pdiff registration requires the standalone service. Set RNU_SERVICE_URL.',
  pdiffArgumentsRequired:
    'pdiff registration requires --deploymentId, --nativeVersionId, and --diffFromHash.',
  pdiffHashInvalid:
    '--diffFromHash must be a 64-character lowercase SHA-256 digest.',
  pdiffFileNotFound: 'pdiff file not found: {{filePath}}',
  pdiffFileExtensionInvalid:
    'pdiff files must end with .apk.patch, .ipa.patch, .hap.patch, or .app.patch.',
  standaloneUploadAppIdRequired: 'Standalone service uploads require appId.',
  standalonePackageVersionRequired:
    'Standalone publishing requires packageVersion.',
  targetsFileReadFailed: 'Unable to read the targets file: {{error}}',
  targetsFileInvalid:
    'targets.json must be an array or an object containing a targets array.',
  targetsRequired: 'Specify at least one channel/version target.',
  staleLocalBuild:
    'The local CLI build is out of date. Run npm run build in rn-update-cli and try again.',
  unspecified: '(unspecified)',
  errorStackHint: '(set RNU_DEBUG=1 to print the stack trace)',
};
