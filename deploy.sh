#!/bin/bash
set -e
cd /opt/dastarhan
[ -n "$1" ] && tar xzf "$1" -C site/ && echo "распакован: $1"
docker compose up -d
sleep 2
docker exec dastarhan-web wget -qO- http://localhost/ >/dev/null && echo "OK сайт отвечает" || echo "FAIL"
