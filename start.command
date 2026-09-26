#!/bin/bash
cd "$(dirname "$0")" || exit 1
if ! command -v python3 >/dev/null 2>&1; then
  echo "请先安装 Python 3.10 或更高版本：https://www.python.org/downloads/"
  read -r -p "按回车键关闭。"
  exit 1
fi
python3 backend/server.py --open "$@"
read -r -p "按回车键关闭。"
