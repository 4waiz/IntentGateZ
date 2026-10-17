#!/usr/bin/env bash
# Build and (re)start the IntentGate Z backend container on the LinuxONE VM.
# Expects the repo at ~/IntentGateZ and secrets in ~/intentgate.env (never committed).
set -euo pipefail
cd "$HOME/IntentGateZ"

if [ ! -f "$HOME/intentgate.env" ]; then
  umask 077
  {
    echo "INTENTGATE_SIGNING_KEY=$(head -c 48 /dev/urandom | base64 | tr -d '\n=+/')"
    echo "INTENTGATE_OPERATOR_TOKEN=$(head -c 32 /dev/urandom | base64 | tr -d '\n=+/')"
    echo "INTENTGATE_CORS_ORIGINS=${IG_CORS_ORIGINS:-https://localhost}"
    echo "INTENTGATE_RISK_RUNTIME=${IG_RISK_RUNTIME:-}"
  } > "$HOME/intentgate.env"
fi

sudo docker build -f deploy/Dockerfile -t intentgate-z:latest .
sudo docker rm -f intentgate >/dev/null 2>&1 || true
sudo docker run -d --name intentgate \
  --restart unless-stopped \
  --network host \
  --memory 2g --cpus 1.6 \
  --security-opt seccomp=unconfined \
  --env-file "$HOME/intentgate.env" \
  ${IG_LLM_ENV:-} \
  -v "$HOME/intentgate-data:/app/backend/data" \
  -v "$HOME/IntentGateZ/evidence:/app/evidence:ro" \
  -v "$HOME/IntentGateZ/ml/artifacts:/app/ml/artifacts:ro" \
  -v "$HOME/IntentGateZ/ml/results:/app/ml/results:ro" \
  intentgate-z:latest

for i in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:8000/api/health >/dev/null; then
    curl -fsS http://127.0.0.1:8000/api/health | jq '{status, platform, model: .model.runtime}'
    exit 0
  fi
  sleep 2
done
echo "backend did not become healthy"; sudo docker logs --tail 80 intentgate; exit 1
