#!/usr/bin/env bash
# Checkpoints the working tree to GitHub every INTERVAL seconds (default 240 = 4 minutes).
# Secrets are kept out by .gitignore and the .githooks/pre-commit guard.
set -u
cd "$(dirname "$0")/.."
INTERVAL="${INTERVAL:-240}"
while true; do
  sleep "$INTERVAL"
  git add -A >/dev/null 2>&1
  if ! git diff --cached --quiet; then
    areas=$(git diff --cached --name-only | awk -F/ '{print $1}' | sort -u | head -6 | paste -sd, -)
    git commit -q -m "checkpoint: ${areas}" || { echo "$(date -u +%FT%TZ) commit blocked"; continue; }
  fi
  if [ -n "$(git log origin/main..HEAD --oneline 2>/dev/null)" ] || ! git rev-parse --verify -q origin/main >/dev/null; then
    git push -q origin HEAD:main 2>&1 | tail -2
    echo "$(date -u +%FT%TZ) pushed $(git rev-parse --short HEAD)"
  fi
done
