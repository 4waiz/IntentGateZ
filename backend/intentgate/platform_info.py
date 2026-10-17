"""Runtime platform facts for the IBM Z proof screen.

Everything here is read from the running host (uname, /proc/cpuinfo, lscpu, /etc/os-release,
package metadata). Nothing is hard-coded, so the same code reports x86_64 on a laptop and
s390x on LinuxONE.
"""

from __future__ import annotations

import os
import platform
import re
import shutil
import subprocess
import sys
import time
from functools import lru_cache
from importlib import metadata
from pathlib import Path
from typing import Any

STARTED_AT = time.time()

MACHINE_TYPES = {
    "9175": "IBM z17",
    "9176": "IBM z17",
    "3931": "IBM z16",
    "3932": "IBM z16",
    "8561": "IBM z15",
    "8562": "IBM z15",
}


def _read(path: str) -> str:
    try:
        return Path(path).read_text(encoding="utf-8", errors="replace")
    except OSError:
        return ""


def _run(cmd: list[str]) -> str:
    if not shutil.which(cmd[0]):
        return ""
    try:
        return subprocess.run(cmd, capture_output=True, text=True, timeout=5).stdout
    except Exception:
        return ""


def _pkg(name: str) -> str | None:
    try:
        return metadata.version(name)
    except metadata.PackageNotFoundError:
        return None


@lru_cache(maxsize=1)
def static_facts() -> dict[str, Any]:
    u = platform.uname()
    cpuinfo = _read("/proc/cpuinfo")
    lscpu = _run(["lscpu"])
    def _osr(path: str) -> dict:
        out = {}
        for line in _read(path).splitlines():
            if "=" in line:
                k, v = line.split("=", 1)
                out[k] = v.strip('"')
        return out

    os_release = _osr("/etc/os-release")
    host_release = _osr("/host/os-release")  # mounted read-only from the VM when containerised
    features: list[str] = []
    m = re.search(r"^features\s*:\s*(.+)$", cpuinfo, re.MULTILINE)
    if m:
        features = m.group(1).split()
    machine_type = None
    m = re.search(r"machine\s*=\s*([0-9A-Fa-f]{4})", cpuinfo)
    if m:
        machine_type = m.group(1)
    lscpu_fields = {}
    for line in lscpu.splitlines():
        if ":" in line:
            k, v = line.split(":", 1)
            lscpu_fields[k.strip()] = v.strip()
    vendor = None
    m = re.search(r"^vendor_id\s*:\s*(.+)$", cpuinfo, re.MULTILINE)
    if m:
        vendor = m.group(1).strip()
    nnpa = "nnpa" in features or "nnpa" in lscpu.lower()
    sysinfo = _read("/proc/sysinfo")
    model_line = re.search(r"^Model:\s+(.+)$", sysinfo, re.MULTILINE)
    vm_line = re.search(r"^VM00 Control Program:\s+(.+)$", sysinfo, re.MULTILINE)
    return {
        "architecture": u.machine,
        "is_ibm_z": u.machine == "s390x",
        "system": u.system,
        "kernel": u.release,
        "os": host_release.get("PRETTY_NAME") or os_release.get("PRETTY_NAME") or f"{u.system} {u.release}",
        "container_os": os_release.get("PRETTY_NAME") if host_release else None,
        "cpu_vendor": vendor,
        "machine_type": machine_type,
        "machine_model": MACHINE_TYPES.get(machine_type or "", None),
        "machine_model_sysinfo": " ".join(model_line.group(1).split()) if model_line else None,
        "control_program": " ".join(vm_line.group(1).split()) if vm_line else None,
        "cpu_count": os.cpu_count(),
        "hypervisor": lscpu_fields.get("Hypervisor vendor") or lscpu_fields.get("Hypervisor"),
        "virtualization": lscpu_fields.get("Virtualization type"),
        "lscpu_model": lscpu_fields.get("Model name") or lscpu_fields.get("Model"),
        "cpu_features": features,
        "nnpa_facility_detected": nnpa,
        "python": sys.version.split()[0],
        "packages": {
            name: _pkg(name)
            for name in [
                "fastapi",
                "uvicorn",
                "pydantic",
                "numpy",
                "scikit-learn",
                "xgboost",
                "tensorflow",
                "ibm-zdnn-plugin",
                "torch",
                "llama_cpp_python",
                "joblib",
            ]
        },
        "in_container": Path("/.dockerenv").exists() or Path("/run/.containerenv").exists(),
    }


def memory_mb() -> dict[str, float | None]:
    rss = None
    status = _read("/proc/self/status")
    m = re.search(r"VmRSS:\s+(\d+)\s+kB", status)
    if m:
        rss = int(m.group(1)) / 1024
    total = avail = None
    mem = _read("/proc/meminfo")
    mt = re.search(r"MemTotal:\s+(\d+)", mem)
    ma = re.search(r"MemAvailable:\s+(\d+)", mem)
    if mt:
        total = int(mt.group(1)) / 1024
    if ma:
        avail = int(ma.group(1)) / 1024
    return {"process_rss_mb": rss, "host_total_mb": total, "host_available_mb": avail}


def load_avg() -> list[float] | None:
    try:
        return [round(x, 2) for x in os.getloadavg()]
    except (OSError, AttributeError):
        return None


def facts() -> dict[str, Any]:
    return {
        **static_facts(),
        "uptime_s": round(time.time() - STARTED_AT, 1),
        "memory": memory_mb(),
        "load_avg": load_avg(),
        "pid": os.getpid(),
    }
