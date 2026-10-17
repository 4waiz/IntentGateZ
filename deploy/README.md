# Deploying IntentGate Z on IBM LinuxONE Community Cloud

These are the exact steps used for the hosted demo. The VM is event infrastructure with a
limited lifetime, so the live URL works only while the team's datathon server exists.

## 1. Server

* LinuxONE Community Cloud dashboard → Create Instance → image **Ubuntu24.04-Datathon**.
  (Accounts registered with event code SSF2026 also see the larger AI-lab flavor.)
* Import your own SSH public key; keep the private key on your workstation only.
* User: `linux1`. SSH: `ssh -i <private-key> linux1@<vm-ip>`

## 2. One-time setup (on the VM)

```bash
git clone https://github.com/4waiz/IntentGateZ.git ~/shared/IntentGateZ
ln -sfn ~/shared/IntentGateZ ~/IntentGateZ
cd ~/IntentGateZ
bash deploy/setup_vm.sh        # Docker (IBM-documented install), Caddy, ports 80/443, IBM AI/ML image
```

The default image firewall only allows SSH; the script inserts ACCEPT rules for 80 and 443
and saves them. Nothing else is opened: the API listens on 127.0.0.1:8000 and Jupyter on
127.0.0.1:38888 (reach it with `ssh -L 38888:127.0.0.1:38888 linux1@<vm-ip>`).

## 3. IBM reference labs and the ML pipeline (inside IBM's s390x container)

```bash
bash deploy/run_labs.sh            # starts JupyterLab privately, executes the two mandatory labs
bash deploy/run_ml_on_linuxone.sh  # text models, 5 dataset seeds, model selection, NNPA + gateway benchmarks
```

## 4. Backend container and HTTPS

```bash
bash deploy/deploy_backend.sh      # docker build FROM IBM's image + run with --restart unless-stopped
bash deploy/configure_caddy.sh intentgatez.<ip-with-dashes>.sslip.io
```

`sslip.io` is wildcard DNS (`a-b-c-d.sslip.io` → `a.b.c.d`), which lets Caddy obtain a
Let's Encrypt certificate without registering a domain. Secrets (`INTENTGATE_SIGNING_KEY`,
`INTENTGATE_OPERATOR_TOKEN`) are generated into `~/intentgate.env` (mode 600) and never committed.

## 5. Frontend

Build locally (`cd frontend && npm ci && npm run build`) and copy `frontend/dist/` to
`/srv/intentgate/` on the VM. Caddy serves it and proxies `/api/*` to the backend, so the
browser talks to a single HTTPS origin.

## 6. Evidence

```bash
bash deploy/collect_evidence.sh    # uname, lscpu, /proc/cpuinfo, docker, API health/platform → evidence/ibmz/
```

IPv4 addresses are masked in captured files.

## Operations

| Task | Command |
|---|---|
| Logs | `sudo docker logs -f intentgate`, `sudo journalctl -u caddy -f` |
| Restart | `sudo docker restart intentgate` (also restarts automatically) |
| Health | `curl -s https://<domain>/api/health` |
| Verify audit chain | `sudo docker exec intentgate /opt/venv/bin/python -m intentgate.audit verify` |
| Reset all sandboxes | `curl -X POST -H "X-IG-Operator: $(grep OPERATOR ~/intentgate.env | cut -d= -f2)" https://<domain>/api/admin/reset-all` |
