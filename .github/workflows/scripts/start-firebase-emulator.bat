@REM [INPUT]: 依赖 Windows shell、Bun/Bunx functions 构建链与当前 scripts 目录下的 firebase.json。
@REM [OUTPUT]: 在 Windows 上启动 Auth、Database、Firestore、Functions、Storage emulator suite。
@REM [POS]: CI Firebase 辅助入口，与 Unix start-firebase-emulator.sh 保持同一服务契约。
@REM [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
pushd "%~dp0functions"
bun install --frozen-lockfile
if errorlevel 1 exit /b 1
bun run build
if errorlevel 1 exit /b 1
popd
pushd "%~dp0"
@REM this is just to see what our current directory is. Should be .github/workflow/scripts
echo %cd%
@REM strangely, unless you specify the config file as being right in the current directory, it won't find it, and everything fails
bunx --no-install firebase emulators:start --config %cd%\firebase.json --only auth,database,firestore,functions,storage --project react-native-firebase-testing
