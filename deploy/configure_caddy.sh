#!/usr/bin/env bash
# Install the IntentGate Z Caddyfile for a domain and reload Caddy (HTTPS via Let's Encrypt).
#   bash deploy/configure_caddy.sh intentgatez.<ip-with-dashes>.sslip.io
set -euo pipefail
DOMAIN="${1:?usage: configure_caddy.sh <domain>}"
cd "$(dirname "$0")/.."
sed "s/{\$IG_DOMAIN}/${DOMAIN}/" deploy/Caddyfile | sudo tee /etc/caddy/Caddyfile >/dev/null
sudo mkdir -p /var/log/caddy && sudo chown caddy:caddy /var/log/caddy
sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
sudo systemctl enable caddy >/dev/null 2>&1 || true
sudo systemctl restart caddy
sleep 3
systemctl is-active caddy
