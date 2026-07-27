#!/bin/bash
set -e
cd /opt/dastarhan
git pull origin main
docker compose restart
sleep 3
curl -sk https://dastarhan.duckdns.org:8443/ -o /dev/null -w "статус: %{http_code}\n"
