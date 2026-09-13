#!/usr/bin/env bash
# [INPUT]: 接收可选平台参数，依赖 lsof、npm 与本地 Metro 8081 端口。
# [OUTPUT]: 清理旧 packager、启动 RN 服务，并在 index.bundle 可访问后保持进程存活。
# [POS]: testHotUpdate 本地开发辅助入口，不参与发布产物。
# [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md

trap 'kill $RN_PID' EXIT

PLATFORM=$1

kill -9 $(lsof -i :8081 | awk '{print $2}' | tail -n +2) & npm start &
RN_PID=$!
sleep 2 && curl>/dev/null http://localhost:8081/index.bundle
wait $RN_PID
