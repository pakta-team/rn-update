#!/bin/bash
# [INPUT]: 接收一条 adb 子命令，读取 `adb devices` 当前 emulator-* 列表。
# [OUTPUT]: 将该命令依次发送到所有运行中的 Android 模拟器并报告完成。
# [POS]: CI Android 辅助入口，被 E2E workflow 用于同步多设备状态。
# [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
echo "Running $1 on all running emulators..."
devices=`adb devices`

for device in $devices; do
    if [[ "$device" =~ "emulator-" ]]; then
      adb -s $device $1
    fi
done
echo "All Done."
