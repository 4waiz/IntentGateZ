#!/usr/bin/env bash
# Training/evaluation/benchmark part of run_ml_on_linuxone.sh (datasets already generated).
set -euo pipefail
REPO=/home/ibm-user/shared/IntentGateZ
run() { sudo docker exec -w "$REPO" notebook bash -lc "$*"; }
run "/opt/venv/bin/python ml/train.py --data datasets/intentgate_synthetic_seed7.csv --seed 7"
for seed in 11 23 42 99; do
  run "/opt/venv/bin/python ml/train.py --data datasets/intentgate_synthetic_seed${seed}.csv --seed $seed --no-artifacts --no-charts"
done
run "/opt/venv/bin/python ml/aggregate_seeds.py"
run "/opt/venv/bin/python ml/benchmark_nnpa.py --reps 30"
run "INTENTGATE_DB_PATH=:memory: /opt/venv/bin/python ml/benchmark.py --mode inprocess --n 3000 --reps 3"
echo "== done"
