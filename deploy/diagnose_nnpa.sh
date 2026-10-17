#!/usr/bin/env bash
# Diagnose whether the Telum NNPA is usable from IBM's AI/ML container on this VM.
# Prints facts only; nothing is assumed.
set -uo pipefail
echo "== host cpu facility"; grep -m1 -o 'nnpa' /proc/cpuinfo || echo "nnpa not in cpuinfo"
echo "== zdnn libraries"; find / -xdev \( -name 'libzdnn*' -o -name '_z_ops.so' -o -name '*zdnn*plugin*' \) 2>/dev/null | head -20
echo "== tensorflow-plugins dir"; ls -la /opt/venv/lib/python3.12/site-packages/tensorflow-plugins 2>&1 | head
echo "== TF import with full logging"
TF_CPP_MIN_LOG_LEVEL=0 ZDNN_LOGLEVEL=debug /opt/venv/bin/python - <<'EOF' 2>&1 | grep -iv "oneDNN\|cuda\|tensorrt" | tail -40
import tensorflow as tf
print("devices:", tf.config.list_physical_devices())
try:
    from tensorflow.python.framework import load_library
    import glob
    for so in glob.glob('/opt/venv/lib*/python3.12/site-packages/tensorflow*/**/_z_ops.so', recursive=True) + glob.glob('/opt/venv/lib*/python3.12/site-packages/tensorflow-plugins/*.so'):
        print("plugin candidate:", so)
except Exception as e:
    print("plugin probe error:", e)
EOF
echo "== torch_nnpa"
/opt/venv/bin/python - <<'EOF' 2>&1 | tail -15
import torch
try:
    import torch_nnpa
    print("torch_nnpa imported", getattr(torch_nnpa, "__version__", ""))
    for name in ("is_available", "device_count"):
        f = getattr(torch_nnpa, name, None) or getattr(getattr(torch, "nnpa", None), name, None)
        if f:
            print(name, f())
    x = torch.randn(64, 43)
    w = torch.randn(43, 3)
    with torch.inference_mode():
        y = (x.to("nnpa") @ w.to("nnpa")).to("cpu")
    print("nnpa matmul ok", tuple(y.shape))
except Exception as e:
    print("torch_nnpa error:", type(e).__name__, str(e)[:300])
EOF
