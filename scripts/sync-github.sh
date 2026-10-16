#!/usr/bin/env bash
# GitHub 网络恢复后的收尾同步（2026-10-16 网络中断时未完成的操作）
set -e
echo "=== 1. 同步本地 main（拉取 PR #1 的合并 commit + 本地的脚本 commit）==="
git pull --rebase origin main
echo
echo "=== 2. 推送版本 tag v0.1.0 ==="
git push origin v0.1.0
echo
echo "=== 3. 验证远程状态 ==="
gh api repos/anthonyhann/wechat-assistant/commits/main --jq ".sha[0:7] + \" \" + .commit.message"
gh api repos/anthonyhann/wechat-assistant/tags --jq ".[].name"
echo
echo "完成。"
