#!/usr/bin/env bash
# 把领航学院 v2 发布到 all4world.cc（在你自己的 Mac 终端运行）
# 用法：bash deploy_all4world.sh 用户名@all4world.cc /服务器上的网站目录/academy
# 例如：bash deploy_all4world.sh root@all4world.cc /var/www/all4world.cc/academy
set -euo pipefail
REMOTE="${1:?请给出 SSH 登录，例如 root@all4world.cc}"
DEST="${2:?请给出服务器上的目标目录，例如 /var/www/all4world.cc/academy}"
SRC="$(cd "$(dirname "$0")/.." && pwd)/v2/"
echo "将 $SRC 同步到 $REMOTE:$DEST"
ssh "$REMOTE" "mkdir -p '$DEST'"
rsync -avz --checksum --exclude '.DS_Store' "$SRC" "$REMOTE:$DEST/"
echo "完成。访问地址取决于该目录在网站中的路径，例如 https://all4world.cc/academy/"
