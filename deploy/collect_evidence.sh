#!/usr/bin/env bash
# Capture IBM Z hardware/runtime evidence into evidence/ibmz/ (IPv4 addresses are masked).
set -uo pipefail
OUT="${1:-$HOME/IntentGateZ/evidence/ibmz}"
mkdir -p "$OUT"
mask() { sed -E 's/\b([0-9]{1,3}\.){3}[0-9]{1,3}\b/x.x.x.x/g'; }
run() {
  local name="$1"; shift
  { echo "\$ $*"; echo "# captured $(date -u +%FT%TZ) on $(uname -m)"; "$@" 2>&1; } | mask > "$OUT/$name.txt"
}
run uname_m uname -m
run uname_a uname -a
run os_release cat /etc/os-release
run lscpu lscpu
run cpuinfo cat /proc/cpuinfo
run lscpu_nnpa bash -c "lscpu | grep -i nnpa || echo 'nnpa not listed by lscpu'"
run cpuinfo_features bash -c "grep -m1 '^features' /proc/cpuinfo"
run machine_type bash -c "grep -m1 -o 'machine = [0-9A-F]*' /proc/cpuinfo"
run sysinfo bash -c "cat /proc/sysinfo 2>/dev/null | grep -E 'Type|Model|Manufacturer|LPAR|VM00 Control Program' || echo 'no /proc/sysinfo'"
run memory free -h
run disk df -h /
run docker_version sudo docker version
run docker_ps sudo docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}'
run docker_images sudo docker images --format 'table {{.Repository}}\t{{.Tag}}\t{{.Size}}'
run container_python sudo docker exec intentgate /opt/venv/bin/python -c "import platform,sklearn,numpy;print(platform.machine(), platform.python_version(), 'sklearn', sklearn.__version__, 'numpy', numpy.__version__)"
run container_tf_devices sudo docker exec intentgate /opt/venv/bin/python -c "import os;os.environ['TF_CPP_MIN_LOG_LEVEL']='2';import tensorflow as tf, importlib.metadata as m;print('tensorflow', tf.__version__, 'ibm-zdnn-plugin', m.version('ibm-zdnn-plugin'));print(tf.config.list_physical_devices())"
run api_health curl -fsS http://127.0.0.1:8000/api/health
run api_platform curl -fsS http://127.0.0.1:8000/api/platform
echo "evidence written to $OUT"; ls -la "$OUT"
