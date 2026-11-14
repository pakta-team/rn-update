#!/bin/bash
# [INPUT]: 依赖 firebase CLI、functions 子工程和可选 --no-daemon 参数。
# [OUTPUT]: 构建 Firebase Functions，启动 emulator suite，并轮询 localhost:8080 就绪状态。
# [POS]: CI Firebase 测试夹具启动器，为工作流提供可重复的本地后端边界。
# [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
if ! [ -x "$(command -v bunx)" ]; then
  echo "❌ Bun is missing. Install Bun before starting the Firebase emulator suite."
  exit 1
fi

EMU_START_COMMAND="bunx --no-install firebase emulators:start --only auth,database,firestore,functions,storage --project react-native-firebase-testing"
#EMU_START_COMMAND="sleep 120"
MAX_RETRIES=3
MAX_CHECKATTEMPTS=60
CHECKATTEMPTS_WAIT=1

# Make sure functions are ready to go. The fixture owns a Bun lockfile so its
# TypeScript/Node type boundary cannot drift with the repository root.
pushd "$(dirname "$0")/functions" && bun install --frozen-lockfile && bun run build && popd


RETRIES=1
while [ $RETRIES -le $MAX_RETRIES ]; do

  if [ "$1" == "--no-daemon" ]; then
    echo "Starting Firebase Emulator Suite in foreground."
    $EMU_START_COMMAND
    exit 0
  else
    echo "Starting Firebase Emulator Suite in background."
    $EMU_START_COMMAND &
    CHECKATTEMPTS=1
    while [ $CHECKATTEMPTS -le $MAX_CHECKATTEMPTS ]; do
      sleep $CHECKATTEMPTS_WAIT
      if curl --output /dev/null --silent --fail http://localhost:8080; then
        echo "Firebase Emulator Suite is online!"
        exit 0;
      fi
      echo "Waiting for Firebase Emulator Suite to come online, check $CHECKATTEMPTS of $MAX_CHECKATTEMPTS..."
      ((CHECKATTEMPTS = CHECKATTEMPTS + 1))
    done
  fi

  echo "Firebase Emulator Suite did not come online in $MAX_CHECKATTEMPTS checks. Try $RETRIES of $MAX_RETRIES."
  ((RETRIES = RETRIES + 1))

done
echo "Firebase Emulator Suite did not come online after $MAX_RETRIES attempts."
exit 1
