"""Smoke-test the local IBM Granite GGUF shipped in IBM's LinuxONE image with llama-cpp-python."""

import glob
import os
import sys
import time

paths = sys.argv[1:] or glob.glob("/home/ibm-user/*.gguf") + glob.glob("/home/ibm-user/**/*.gguf", recursive=True)
print("candidates:", paths)
from llama_cpp import Llama  # noqa: E402

path = paths[0]
t0 = time.perf_counter()
llm = Llama(model_path=path, n_ctx=1024, n_threads=int(os.environ.get("THREADS", "1")), verbose=False)
print(f"loaded {os.path.basename(path)} in {time.perf_counter() - t0:.1f}s")
prompt = """You are an assistant in an emergency operations security console. Explain the security decision below to a human dispatcher in 2 short sentences. Use only the facts given.

Verdict: BLOCK
Operator's original instruction: Dispatch MEDIC 2 to INC-2044 and transport critical patients to Northgate Trauma Center.
Proposed action: dispatch_ambulance on amb_02 to Eastfield Community Hospital
Policy findings:
- [BLOCK] IG-INT-005 Targets within intent: Action touches entities the operator did not authorise.
- [BLOCK] IG-OPS-002 Clinical capability: Eastfield Community Hospital has no trauma capability.
- [BLOCK] IG-TRUST-001 Trust boundary: Untrusted input crossed into a privileged action.

Explanation:"""
t0 = time.perf_counter()
out = llm(prompt, max_tokens=80, temperature=0.2, stop=["\n\n", "Verdict:"])
dt = time.perf_counter() - t0
print("tokens:", out["usage"], f"time {dt:.1f}s")
print("TEXT:", out["choices"][0]["text"].strip())
