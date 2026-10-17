#!/usr/bin/env bash
# Official training, evaluation and benchmarks on IBM LinuxONE, run inside IBM's s390x
# AI/ML container so scikit-learn, XGBoost and TensorFlow + ibm-zdnn-plugin are the IBM builds.
# The repo must be cloned at ~/shared/IntentGateZ (visible in the container).
set -euo pipefail
REPO=/home/ibm-user/shared/IntentGateZ
run() { sudo docker exec -w "$REPO" notebook bash -lc "$*"; }

run "/opt/venv/bin/python -c 'import platform,sklearn,xgboost,tensorflow as tf;print(platform.machine(),sklearn.__version__,xgboost.__version__,tf.__version__,tf.config.list_physical_devices())'"
run "/opt/venv/bin/python ml/train_text.py"
for seed in 7 11 23 42 99; do
  run "/opt/venv/bin/python ml/generate_dataset.py --n 12000 --seed $seed --text-model ml/artifacts"
done
# Primary run: produces the serving artefacts, charts and evaluation_seed7.json.
run "/opt/venv/bin/python ml/train.py --data datasets/intentgate_synthetic_seed7.csv --seed 7"
# Repeated runs on independently generated datasets (evaluation only).
for seed in 11 23 42 99; do
  run "/opt/venv/bin/python ml/train.py --data datasets/intentgate_synthetic_seed${seed}.csv --seed $seed --no-artifacts --no-charts"
done
run "/opt/venv/bin/python ml/aggregate_seeds.py"
run "/opt/venv/bin/python ml/benchmark_nnpa.py --reps 30"
run "INTENTGATE_DB_PATH=:memory: /opt/venv/bin/python ml/benchmark.py --mode inprocess --n 3000 --reps 3"
echo "== done"; ls -la "$HOME/shared/IntentGateZ/ml/results"
