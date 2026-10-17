"""Print the AI/ML stack available on this host (run inside IBM's s390x container)."""

import importlib.metadata as md
import os
import platform

os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "2")

print("machine", platform.machine(), "python", platform.python_version())
for p in ["numpy", "pandas", "scikit-learn", "xgboost", "tensorflow", "ibm-zdnn-plugin", "torch", "torch_nnpa", "llama_cpp_python", "onnx", "fastapi", "uvicorn", "pydantic", "joblib", "matplotlib", "nbconvert", "httpx"]:
    try:
        print(f"{p:18s} {md.version(p)}")
    except md.PackageNotFoundError:
        print(f"{p:18s} -")
try:
    import tensorflow as tf

    print("tf physical devices:", tf.config.list_physical_devices())
except Exception as exc:
    print("tensorflow import failed:", exc)
