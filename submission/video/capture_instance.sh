#!/usr/bin/env bash
# Runs a few read-only commands on the LinuxONE VM and saves the verbatim transcript, which the
# demo video shows as its "live instance" card (overlays.mjs renders it unchanged).
#   bash submission/video/capture_instance.sh linux1@<vm-ip> [identity-file]
set -euo pipefail
HOST="${1:?usage: capture_instance.sh user@host [identity-file]}"
KEY="${2:-$HOME/.ssh/intentgatez_l1cc}"
OUT="$(cd "$(dirname "$0")/../.." && pwd)/evidence/ibmz/instance_session.txt"
SSH=(ssh -i "$KEY" -o BatchMode=yes "$HOST")
cmds=(
  "uname -m"
  "grep -E '^(Manufacturer|Type|Model):' /proc/sysinfo"
  "grep -m1 '^features' /proc/cpuinfo"
  "docker ps --filter name=^intentgate\$ --format '{{.Names}}  {{.Image}}  {{.Status}}'"
  "docker exec intentgate python -c 'from intentgate.torch_mlp import nnpa_status; print(nnpa_status())'"
  "curl -s localhost:8000/api/model/info | python3 -c 'import sys,json; m=json.load(sys.stdin)[\"risk_model\"]; print(m[\"runtime\"], \"| device:\", m[\"accelerator\"][\"device\"], \"| verified:\", m[\"accelerator\"][\"verified\"])'"
)
prompt="$("${SSH[@]}" 'echo "$(whoami)@$(hostname):~\$"')"
{
  echo "# captured $(date -u +%FT%TZ) over ssh from the IntentGate Z LinuxONE VM (read-only commands)"
  for c in "${cmds[@]}"; do
    echo "$prompt $c"
    "${SSH[@]}" "$c" | sed 's/[[:space:]]*$//'
  done
} >"$OUT"
cat "$OUT"
