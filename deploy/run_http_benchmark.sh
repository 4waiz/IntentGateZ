#!/usr/bin/env bash
# HTTP load benchmark against the running backend on this VM (client inside IBM's container).
set -euo pipefail
cd "$HOME/IntentGateZ"
TOKEN=$(grep '^INTENTGATE_OPERATOR_TOKEN=' "$HOME/intentgate.env" | cut -d= -f2)
sudo docker exec -e IG_OPERATOR_TOKEN="$TOKEN" -w /home/ibm-user/shared/IntentGateZ notebook \
  /opt/venv/bin/python ml/benchmark.py --mode http --url http://127.0.0.1:8000 --n "${N:-1200}" --concurrency "${C:-1,4,8,16}"
