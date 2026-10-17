#!/usr/bin/env bash
# One-time setup of the IBM LinuxONE Community Cloud VM (Ubuntu 24.04-Datathon, s390x).
# Installs Docker (IBM-documented method), Caddy and git, pulls the IBM AI/ML image and
# opens only HTTP/HTTPS for the public demo. Run as linux1:  bash deploy/setup_vm.sh
set -euo pipefail

echo "== architecture: $(uname -m)"
[ "$(uname -m)" = "s390x" ] || echo "WARNING: not running on s390x"

sudo apt-get update -y
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y git curl ca-certificates jq caddy iptables-persistent || \
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y git curl ca-certificates jq caddy

if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com -o /tmp/get-docker.sh
  sudo sh /tmp/get-docker.sh
  sudo usermod -aG docker "$USER"
fi
sudo systemctl enable --now docker

sudo docker pull registry.linuxone.cloud.marist.edu/l1cc/jupyterlab-image-s390x:latest

# Firewall: allow HTTP(S) for Caddy. Port 8000 (API) stays bound to 127.0.0.1 and Jupyter is
# reached only through an SSH tunnel, so neither needs a rule.
sudo iptables -C INPUT -p tcp --dport 80 -j ACCEPT 2>/dev/null || sudo iptables -I INPUT -p tcp --dport 80 -j ACCEPT
sudo iptables -C INPUT -p tcp --dport 443 -j ACCEPT 2>/dev/null || sudo iptables -I INPUT -p tcp --dport 443 -j ACCEPT
if command -v netfilter-persistent >/dev/null; then sudo netfilter-persistent save; fi

sudo mkdir -p /srv/intentgate /var/log/caddy
sudo chown -R "$USER":"$USER" /srv/intentgate
mkdir -p "$HOME/intentgate-data" "$HOME/shared"
chmod a+w "$HOME/shared" "$HOME/intentgate-data"
echo "== setup complete"
