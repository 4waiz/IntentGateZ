#!/usr/bin/env bash
# Start IBM's JupyterLab container privately (localhost only, private token) and execute the
# two mandatory reference labs headlessly so the executed notebooks can be kept as evidence.
#   Lab 1 (predictive / hybrid multi-model): Churn_Scikit_PyTorch.ipynb
#   Lab 2 (predictive + generative AI):     Loan_Approval_Demo.ipynb
# Access the UI through an SSH tunnel:  ssh -L 38888:127.0.0.1:38888 linux1@<vm>
set -uo pipefail
IMG=registry.linuxone.cloud.marist.edu/l1cc/jupyterlab-image-s390x:latest
TOKEN_FILE="$HOME/.jupyter_token"
[ -f "$TOKEN_FILE" ] || (umask 077; head -c 24 /dev/urandom | base64 | tr -d '\n=+/' > "$TOKEN_FILE")
TOKEN=$(cat "$TOKEN_FILE")

if ! sudo docker ps --format '{{.Names}}' | grep -qx notebook; then
  sudo docker rm -f notebook >/dev/null 2>&1 || true
  sudo docker run --network host --name notebook -d \
    --security-opt seccomp=unconfined \
    -v "$HOME/shared:/home/ibm-user/shared" \
    "$IMG" jupyter lab --ip=127.0.0.1 --ServerApp.port=38888 --ServerApp.token="$TOKEN" --no-browser
  sleep 15
fi
sudo docker exec notebook bash -lc 'ls /home/ibm-user'

mkdir -p "$HOME/shared/labs_executed"
for nb in Churn_Scikit_PyTorch.ipynb Loan_Approval_Demo.ipynb; do
  echo "== executing $nb"
  start=$(date +%s)
  sudo docker exec -w /home/ibm-user notebook bash -lc \
    "/opt/venv/bin/jupyter nbconvert --to notebook --execute --ExecutePreprocessor.timeout=3600 --output /home/ibm-user/shared/labs_executed/${nb%.ipynb}.executed.ipynb $nb" \
    > "$HOME/shared/labs_executed/${nb%.ipynb}.log" 2>&1
  echo "rc=$? elapsed=$(( $(date +%s) - start ))s" | tee -a "$HOME/shared/labs_executed/${nb%.ipynb}.log"
done
ls -la "$HOME/shared/labs_executed"
