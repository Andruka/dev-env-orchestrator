#!/usr/bin/env bash
# Запуск панели: ./start.sh  (открыть http://localhost:7777)
cd "$(dirname "$0")" && exec node server.js
