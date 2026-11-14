#!/usr/bin/env bash
# [INPUT]: 依赖 Bash 的脚本目录定位与 scripts/verify-android-so.js 的 Node 验证实现
# [OUTPUT]: 以兼容旧调用方的 shell 入口转发 Android ABI/ELF/JNI 完整性检查及其退出码
# [POS]: scripts 的验证适配层，保持历史命令不变，不复制 ELF 解析逻辑
# [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
# Thin wrapper kept for backward compatibility; the actual verification lives
# in verify-android-so.js (pure-node ELF .dynsym reader, no binutils needed —
# llvm-nm/nm are absent on some CI images, e.g. the HarmonyOS docker image).
exec node "$(dirname "${BASH_SOURCE[0]}")/verify-android-so.js"
