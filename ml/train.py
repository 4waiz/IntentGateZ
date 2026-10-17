"""Train, compare and select the IntentGate Z risk model; evaluate rules vs ML vs hybrid.

Protocol
1. Fit every candidate on the TRAIN split only.
2. Choose each method's decision thresholds on the VALIDATION split (maximise macro-F1 subject
   to a false-block rate on legitimate ALLOW actions of at most 2%).
3. Select the serving model by validation macro-F1 of the hybrid (policy + ML) gateway, with
   single-request latency as tie-breaker.
4. Report every method ONCE on the held-out TEST split (unseen text templates).

Outputs: ml/artifacts/ (model files + model_meta.json), ml/results/evaluation_seed<S>.json,
ml/results/charts/*.png. Run on IBM LinuxONE to produce the published numbers:

    python ml/train.py --data datasets/intentgate_synthetic_seed7.csv
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import sys
import time
from importlib import metadata
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier, RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import confusion_matrix, f1_score, precision_recall_fscore_support
from sklearn.neural_network import MLPClassifier
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
from intentgate.features import FEATURE_NAMES  # noqa: E402

CLASSES = ["ALLOW", "CHALLENGE", "BLOCK"]
CI = {c: i for i, c in enumerate(CLASSES)}
MAX_FALSE_BLOCK = 0.02


def pkg(name: str) -> str | None:
    try:
        return metadata.version(name)
    except metadata.PackageNotFoundError:
        return None


# ----------------------------------------------------------------------------- metrics


def evaluate(y: np.ndarray, yhat: np.ndarray, families: pd.Series | None = None) -> dict:
    p, r, f, s = precision_recall_fscore_support(y, yhat, labels=[0, 1, 2], zero_division=0)
    cm = confusion_matrix(y, yhat, labels=[0, 1, 2])
    allow = y == 0
    block = y == 2
    legit = y != 2
    out = {
        "n": int(len(y)),
        "accuracy": round(float((y == yhat).mean()), 4),
        "macro_f1": round(float(f1_score(y, yhat, average="macro")), 4),
        "per_class": {c: {"precision": round(float(p[i]), 4), "recall": round(float(r[i]), 4), "f1": round(float(f[i]), 4), "support": int(s[i])} for i, c in enumerate(CLASSES)},
        "confusion_matrix": cm.tolist(),
        "false_block_rate_allow": round(float((yhat[allow] == 2).mean()), 4) if allow.any() else None,
        "false_block_rate_legit": round(float((yhat[legit] == 2).mean()), 4) if legit.any() else None,
        "unsafe_miss_rate": round(float((yhat[block] == 0).mean()), 4) if block.any() else None,
        "unsafe_block_rate": round(float((yhat[block] == 2).mean()), 4) if block.any() else None,
        "legit_acceptance_rate": round(float((yhat[allow] == 0).mean()), 4) if allow.any() else None,
        "challenge_rate": round(float((yhat == 1).mean()), 4),
    }
    if families is not None:
        fam = {}
        for name, idx in families.groupby(families).groups.items():
            ii = np.asarray([families.index.get_loc(k) for k in idx])
            yy, hh = y[ii], yhat[ii]
            fam[name] = {
                "n": int(len(ii)),
                "true_label": CLASSES[int(np.bincount(yy, minlength=3).argmax())],
                "pred_allow": round(float((hh == 0).mean()), 4),
                "pred_challenge": round(float((hh == 1).mean()), 4),
                "pred_block": round(float((hh == 2).mean()), 4),
            }
        out["families"] = fam
    return out


def ml_decide(P: np.ndarray, tau_block: float, tau_review: float) -> np.ndarray:
    out = np.zeros(len(P), dtype=int)
    out[(P[:, 1] + P[:, 2]) >= tau_review] = 1
    out[P[:, 2] >= tau_block] = 2
    return out


def tune(P: np.ndarray, y: np.ndarray, hard: np.ndarray | None) -> tuple[dict, float]:
    best, best_f1 = {"tau_block": 0.9, "tau_review": 0.5}, -1.0
    for tb in np.round(np.arange(0.40, 0.995, 0.025), 3):
        for tr in np.round(np.arange(0.10, 0.95, 0.025), 3):
            pred = ml_decide(P, tb, tr)
            if hard is not None:
                pred = np.maximum(pred, hard)
            allow = y == 0
            fb = (pred[allow] == 2).mean() if allow.any() else 0
            if fb > MAX_FALSE_BLOCK:
                continue
            f = f1_score(y, pred, average="macro")
            if f > best_f1 + 1e-9:
                best_f1, best = f, {"tau_block": float(tb), "tau_review": float(tr)}
    return best, float(best_f1)


def rules_heuristic(df: pd.DataFrame) -> np.ndarray:
    """Hard policy verdict plus the soft heuristics an engineer would hand-write."""
    hard = df["hard_verdict"].map(CI).to_numpy()
    soft = np.zeros(len(df), dtype=int)
    soft[(df["lexical_hits"] >= 1) & (df["n_untrusted_sources"] > 0)] = 1
    soft[(df["lexical_hits"] >= 2) & (df["n_untrusted_sources"] > 0)] = 2
    soft[df["entity_alignment"] < 0.5] = np.maximum(soft[df["entity_alignment"] < 0.5], 1)
    soft[df["eta_ratio"] > 1.6] = np.maximum(soft[df["eta_ratio"] > 1.6], 1)
    soft[df["recent_actions_10m"] >= 6] = np.maximum(soft[df["recent_actions_10m"] >= 6], 1)
    return np.maximum(hard, soft)


# ----------------------------------------------------------------------------- models


def candidates(seed: int) -> dict:
    models = {
        "logistic_regression": Pipeline([("scale", StandardScaler()), ("clf", LogisticRegression(C=1.0, max_iter=4000, class_weight="balanced"))]),
        "random_forest": RandomForestClassifier(n_estimators=200, min_samples_leaf=2, class_weight="balanced_subsample", n_jobs=-1, random_state=seed),
        "hist_gradient_boosting": HistGradientBoostingClassifier(max_iter=300, learning_rate=0.08, max_leaf_nodes=31, l2_regularization=1.0, class_weight="balanced", random_state=seed),
        "mlp": Pipeline([("scale", StandardScaler()), ("clf", MLPClassifier(hidden_layer_sizes=(64, 32), alpha=1e-3, early_stopping=True, max_iter=400, random_state=seed))]),
    }
    try:
        import xgboost as xgb

        models["xgboost"] = xgb.XGBClassifier(n_estimators=300, max_depth=6, learning_rate=0.08, subsample=0.9, colsample_bytree=0.9, objective="multi:softprob", num_class=3, tree_method="hist", n_jobs=os.cpu_count(), random_state=seed)
    except Exception:
        pass
    return models


def torch_candidate(Xtr, ytr, Xva, yva, seed: int):
    """PyTorch MLP for the IBM Telum NNPA inference path (torch_nnpa). Trained on CPU."""
    try:
        from intentgate.torch_mlp import train as torch_train
    except Exception:
        return None
    try:
        return torch_train(Xtr, ytr, Xva, yva, seed)
    except Exception as exc:  # pragma: no cover - platform dependent
        print("torch candidate skipped:", exc)
        return None


def latency(model, X: np.ndarray, n: int = 300) -> dict:
    row = X[:1]
    for _ in range(10):
        model.predict_proba(row)
    t = []
    for i in range(n):
        r = X[i % len(X)][None, :]
        t0 = time.perf_counter()
        model.predict_proba(r)
        t.append((time.perf_counter() - t0) * 1000)
    b = X[: min(1000, len(X))]
    t0 = time.perf_counter()
    model.predict_proba(b)
    bt = time.perf_counter() - t0
    a = np.asarray(t)
    return {"single_p50_ms": round(float(np.percentile(a, 50)), 4), "single_p95_ms": round(float(np.percentile(a, 95)), 4), "batch_rows": len(b), "batch_rows_per_s": round(len(b) / bt, 1)}


def importance(name: str, model, Xva: np.ndarray, yva: np.ndarray) -> dict:
    est = model.named_steps["clf"] if hasattr(model, "named_steps") else model
    if hasattr(est, "feature_importances_"):
        imp = np.asarray(est.feature_importances_, dtype=float)
    elif hasattr(est, "coef_"):
        imp = np.abs(est.coef_).mean(0)
    else:
        rng = np.random.default_rng(0)
        X = Xva[:2000].copy()
        y = yva[:2000]
        base = f1_score(y, model.predict_proba(X).argmax(1), average="macro")
        imp = np.zeros(X.shape[1])
        for j in range(X.shape[1]):
            Xp = X.copy()
            Xp[:, j] = rng.permutation(Xp[:, j])
            imp[j] = max(0.0, base - f1_score(y, model.predict_proba(Xp).argmax(1), average="macro"))
    imp = imp / (imp.sum() + 1e-12)
    return {k: round(float(v), 5) for k, v in zip(FEATURE_NAMES, imp)}


# ----------------------------------------------------------------------------- charts


def charts(res: dict, test_df: pd.DataFrame, P_sel: np.ndarray, out_dir: Path) -> list[str]:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    bg, panel, fg, muted = "#050B12", "#0C1A28", "#E8F0F7", "#8496A8"
    teal, amber, red, blue = "#00D5B5", "#FFBC5C", "#FF5D70", "#0F62FE"
    plt.rcParams.update({"figure.facecolor": bg, "axes.facecolor": panel, "axes.edgecolor": "#24384c", "axes.labelcolor": fg, "xtick.color": muted, "ytick.color": muted, "text.color": fg, "font.size": 10, "axes.titleweight": "bold"})
    out_dir.mkdir(parents=True, exist_ok=True)
    made = []
    m = res["test"]

    methods = [("Hard policy only", "hard_policy"), ("Rules + heuristics", "rules_heuristic"), (f"ML only ({res['selected_model']})", "ml_only"), ("IntentGate Z hybrid", "hybrid")]
    fig, axes = plt.subplots(1, 4, figsize=(16, 4))
    for ax, (title, key) in zip(axes, methods):
        cm = np.asarray(m[key]["confusion_matrix"])
        ax.imshow(cm, cmap="Blues")
        for i in range(3):
            for j in range(3):
                ax.text(j, i, str(cm[i, j]), ha="center", va="center", color=fg if cm[i, j] < cm.max() * 0.6 else bg, fontsize=11)
        ax.set_xticks(range(3), CLASSES)
        ax.set_yticks(range(3), CLASSES)
        ax.set_xlabel("predicted")
        ax.set_ylabel("true")
        ax.set_title(f"{title}\nmacro-F1 {m[key]['macro_f1']:.3f}", fontsize=10)
    fig.tight_layout()
    fig.savefig(out_dir / "confusion_matrices.png", dpi=150)
    plt.close(fig)
    made.append("confusion_matrices")

    fig, ax = plt.subplots(figsize=(9, 4.2))
    labels = [t for t, _ in methods]
    xs = np.arange(len(labels))
    vals = [[m[k]["macro_f1"] for _, k in methods], [m[k]["unsafe_miss_rate"] for _, k in methods], [m[k]["false_block_rate_allow"] for _, k in methods]]
    for i, (v, c, n) in enumerate(zip(vals, [teal, red, amber], ["macro-F1", "unsafe miss rate", "false-block rate (legit)"])):
        ax.bar(xs + (i - 1) * 0.26, v, 0.26, color=c, label=n)
        for x, val in zip(xs, v):
            ax.text(x + (i - 1) * 0.26, val + 0.01, f"{val:.3f}", ha="center", fontsize=8, color=fg)
    ax.set_xticks(xs, labels, fontsize=9)
    ax.set_ylim(0, 1.08)
    ax.legend(frameon=False, fontsize=9)
    ax.set_title("Held-out test set: rules vs ML vs hybrid")
    fig.tight_layout()
    fig.savefig(out_dir / "method_comparison.png", dpi=150)
    plt.close(fig)
    made.append("method_comparison")

    fig, ax = plt.subplots(figsize=(8, 4))
    names = [n for n in res["validation"]["models"] if res["validation"]["models"][n]["hybrid_macro_f1"] is not None]
    v = [res["validation"]["models"][n]["hybrid_macro_f1"] for n in names]
    ax.barh(names, v, color=[teal if n == res["selected_model"] else blue for n in names])
    for i, val in enumerate(v):
        ax.text(val + 0.003, i, f"{val:.3f}", va="center", fontsize=9)
    ax.set_xlim(min(v) - 0.05, 1.0)
    ax.set_title("Model selection: validation macro-F1 of the hybrid gateway")
    fig.tight_layout()
    fig.savefig(out_dir / "model_selection.png", dpi=150)
    plt.close(fig)
    made.append("model_selection")

    y = test_df["label"].map(CI).to_numpy()
    risk = 1 - P_sel[:, 0]
    fig, ax = plt.subplots(figsize=(8, 4))
    bins = np.linspace(0, 1, 41)
    for c, col in zip(CLASSES, [teal, amber, red]):
        ax.hist(risk[y == CI[c]], bins=bins, alpha=0.6, color=col, label=f"true {c}")
    ax.axvline(res["thresholds"]["tau_review"], color=amber, ls="--", lw=1)
    ax.set_yscale("log")
    ax.set_xlabel("model risk score (1 - P(ALLOW))")
    ax.legend(frameon=False)
    ax.set_title("Risk score distribution on the test set")
    fig.tight_layout()
    fig.savefig(out_dir / "risk_distribution.png", dpi=150)
    plt.close(fig)
    made.append("risk_distribution")

    fams = {k: v for k, v in m["hybrid"]["families"].items() if v["true_label"] == "BLOCK"}
    order = sorted(fams, key=lambda k: fams[k]["pred_block"] + fams[k]["pred_challenge"])
    fig, ax = plt.subplots(figsize=(9, 0.38 * len(order) + 1.2))
    ys = np.arange(len(order))
    for off, key, col, lab in [(-0.27, "rules_heuristic", muted, "rules + heuristics"), (0.0, "ml_only", blue, "ML only"), (0.27, "hybrid", teal, "hybrid")]:
        vals = [m[key]["families"][f]["pred_block"] + m[key]["families"][f]["pred_challenge"] for f in order]
        ax.barh(ys + off, vals, 0.27, color=col, label=lab)
    ax.set_yticks(ys, [o.replace(":", " · ") for o in order], fontsize=8)
    ax.set_xlim(0, 1.05)
    ax.set_xlabel("share of unsafe actions stopped (BLOCK or CHALLENGE)")
    ax.legend(frameon=False, fontsize=8, loc="lower right")
    ax.set_title("Attack-family detection on the test set")
    fig.tight_layout()
    fig.savefig(out_dir / "attack_family_detection.png", dpi=150)
    plt.close(fig)
    made.append("attack_family_detection")

    fig, ax = plt.subplots(figsize=(8, 4))
    pc = m["hybrid"]["per_class"]
    xs = np.arange(3)
    for i, (k, col) in enumerate([("precision", blue), ("recall", teal), ("f1", amber)]):
        v = [pc[c][k] for c in CLASSES]
        ax.bar(xs + (i - 1) * 0.26, v, 0.26, color=col, label=k)
    ax.set_xticks(xs, CLASSES)
    ax.set_ylim(0, 1.05)
    ax.legend(frameon=False)
    ax.set_title("Hybrid gateway: per-class precision / recall / F1 (test)")
    fig.tight_layout()
    fig.savefig(out_dir / "per_class_metrics.png", dpi=150)
    plt.close(fig)
    made.append("per_class_metrics")

    if res.get("ablation"):
        fig, ax = plt.subplots(figsize=(8, 3.6))
        names = list(res["ablation"].keys())
        v = [res["ablation"][n]["hybrid_macro_f1_test"] for n in names]
        ax.barh(names, v, color=[teal if n == "all features" else blue for n in names])
        for i, val in enumerate(v):
            ax.text(val + 0.002, i, f"{val:.3f}", va="center", fontsize=9)
        ax.set_xlim(min(v) - 0.05, 1.0)
        ax.set_title("Ablation: hybrid macro-F1 on test when feature groups are removed")
        fig.tight_layout()
        fig.savefig(out_dir / "ablation.png", dpi=150)
        plt.close(fig)
        made.append("ablation")
    return made


# ----------------------------------------------------------------------------- main

GROUPS = {
    "no text / injection signals": ["injection_score", "rationale_injection_score", "lexical_hits", "imperative_density", "text_similarity"],
    "no provenance signals": ["n_untrusted_sources", "untrusted_security_fields"],
    "no behaviour history": ["param_change_count", "recent_actions_10m", "recent_high_value_10m", "agent_prior_blocks"],
    "no intent-alignment signals": ["entity_alignment", "scope_violations", "op_in_intent"],
}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default=str(ROOT / "datasets" / "intentgate_synthetic_seed7.csv"))
    ap.add_argument("--out", default=str(ROOT / "ml" / "artifacts"))
    ap.add_argument("--results", default=str(ROOT / "ml" / "results"))
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--no-torch", action="store_true")
    ap.add_argument("--no-artifacts", action="store_true", help="evaluation only (used by repeated-seed runs)")
    ap.add_argument("--no-charts", action="store_true")
    args = ap.parse_args()
    out, res_dir = Path(args.out), Path(args.results)
    out.mkdir(parents=True, exist_ok=True)
    res_dir.mkdir(parents=True, exist_ok=True)

    data_path = Path(args.data)
    df = pd.read_csv(data_path)
    sha = hashlib.sha256(data_path.read_bytes()).hexdigest()
    tr, va, te = (df[df.split == s].reset_index(drop=True) for s in ("train", "val", "test"))
    Xtr, Xva, Xte = (d[FEATURE_NAMES].to_numpy(dtype=np.float32) for d in (tr, va, te))
    ytr, yva, yte = (d["label"].map(CI).to_numpy() for d in (tr, va, te))
    hva, hte = va["hard_verdict"].map(CI).to_numpy(), te["hard_verdict"].map(CI).to_numpy()

    models = candidates(args.seed)
    fitted, val_report, timing = {}, {}, {}
    for name, model in models.items():
        t0 = time.perf_counter()
        model.fit(Xtr, ytr)
        timing[name] = round(time.perf_counter() - t0, 2)
        fitted[name] = model
    nnpa = {"available": False}
    if not args.no_torch:
        tm = torch_candidate(Xtr, ytr, Xva, yva, args.seed)
        if tm is not None:
            fitted["torch_mlp"] = tm
            timing["torch_mlp"] = getattr(tm, "train_seconds", None)
            from intentgate.torch_mlp import nnpa_status

            nnpa = nnpa_status()

    tuned = {}
    for name, model in fitted.items():
        Pva = model.predict_proba(Xva)
        thr_h, f1_h = tune(Pva, yva, hva)
        thr_m, f1_m = tune(Pva, yva, None)
        lat = latency(model, Xte, n=200)
        if name == "torch_mlp" and nnpa.get("available"):
            model.to("nnpa")
            lat = {"cpu": lat, "nnpa": latency(model, Xte, n=200)}
            model.to("cpu")
        tuned[name] = {"hybrid": thr_h, "ml_only": thr_m}
        feasible = f1_h >= 0
        val_report[name] = {
            "hybrid_macro_f1": round(f1_h, 4) if feasible else None,
            "ml_only_macro_f1": round(f1_m, 4) if f1_m >= 0 else None,
            "feasible_under_false_block_constraint": feasible,
            "thresholds_hybrid": thr_h if feasible else None,
            "thresholds_ml_only": thr_m if f1_m >= 0 else None,
            "train_seconds": timing.get(name),
            "latency": lat,
        }
        p50s = f"cpu {lat['cpu']['single_p50_ms']}ms / nnpa {lat['nnpa']['single_p50_ms']}ms" if "cpu" in lat else f"{lat['single_p50_ms']}ms"
        print(f"{name:24s} val hybrid F1={f1_h:.4f}  ml-only F1={f1_m:.4f}  p50={p50s}  feasible={feasible}")

    def p50(n):
        lat = val_report[n]["latency"]
        return lat["single_p50_ms"] if "single_p50_ms" in lat else lat["cpu"]["single_p50_ms"]

    cpu_models = [n for n in fitted if n != "torch_mlp" and val_report[n]["feasible_under_false_block_constraint"]]
    best_cpu = max(cpu_models, key=lambda n: (round(val_report[n]["hybrid_macro_f1"], 3), -p50(n)))
    selected = best_cpu
    selection_rule = "best validation macro-F1 of the hybrid gateway among CPU models (ties broken by single-request latency)"
    if "torch_mlp" in fitted and val_report["torch_mlp"]["feasible_under_false_block_constraint"] and nnpa.get("available") and nnpa.get("smoke_test"):
        if val_report["torch_mlp"]["hybrid_macro_f1"] >= val_report[best_cpu]["hybrid_macro_f1"] - 0.01:
            selected = "torch_mlp"
            selection_rule = (
                "PyTorch MLP served on the IBM Telum NNPA because its validation hybrid macro-F1 is within 0.01 of the best CPU model "
                f"({best_cpu}); otherwise the best CPU model is served"
            )
    sel = fitted[selected]
    thr = tuned[selected]["hybrid"]
    Pte = sel.predict_proba(Xte)
    results_test = {
        "hard_policy": evaluate(yte, hte, te["family"]),
        "rules_heuristic": evaluate(yte, rules_heuristic(te), te["family"]),
        "ml_only": evaluate(yte, ml_decide(Pte, **tuned[selected]["ml_only"]), te["family"]),
        "hybrid": evaluate(yte, np.maximum(ml_decide(Pte, **thr), hte), te["family"]),
    }
    all_models_test = {}
    for name, model in fitted.items():
        if not val_report[name]["feasible_under_false_block_constraint"]:
            all_models_test[name] = {"hybrid_macro_f1": None, "ml_only_macro_f1": None, "note": "no threshold met the false-block constraint on validation"}
            continue
        P = model.predict_proba(Xte)
        all_models_test[name] = {
            "hybrid_macro_f1": evaluate(yte, np.maximum(ml_decide(P, **tuned[name]["hybrid"]), hte))["macro_f1"],
            "ml_only_macro_f1": evaluate(yte, ml_decide(P, **tuned[name]["ml_only"]))["macro_f1"],
        }

    ablation = {"all features": {"hybrid_macro_f1_test": results_test["hybrid"]["macro_f1"]}}
    base = candidates(args.seed)[selected] if selected in candidates(args.seed) else None
    if base is not None:
        from sklearn.base import clone

        for gname, cols in GROUPS.items():
            keep = [i for i, f in enumerate(FEATURE_NAMES) if f not in cols]
            m = clone(base).fit(Xtr[:, keep], ytr)
            th, _ = tune(m.predict_proba(Xva[:, keep]), yva, hva)
            pred = np.maximum(ml_decide(m.predict_proba(Xte[:, keep]), **th), hte)
            ablation[gname] = {"hybrid_macro_f1_test": evaluate(yte, pred)["macro_f1"], "removed": cols}

    # expected calibration error for P(BLOCK)
    pb = Pte[:, 2]
    yb = (yte == 2).astype(float)
    bins = np.linspace(0, 1, 11)
    ece = 0.0
    for lo, hi in zip(bins[:-1], bins[1:]):
        msk = (pb >= lo) & (pb < hi if hi < 1 else pb <= hi)
        if msk.any():
            ece += msk.mean() * abs(pb[msk].mean() - yb[msk].mean())
    brier = float(np.mean(np.sum((Pte - np.eye(3)[yte]) ** 2, axis=1)))

    allow_means = tr[tr.label == "ALLOW"][FEATURE_NAMES].mean().to_dict()
    imp = importance(selected, sel, Xva, yva)
    plat = {
        "architecture": platform.machine(),
        "system": platform.system(),
        "release": platform.release(),
        "python": platform.python_version(),
        "cpu_count": os.cpu_count(),
        "packages": {k: pkg(k) for k in ("numpy", "pandas", "scikit-learn", "xgboost", "torch", "torch_nnpa", "tensorflow", "ibm-zdnn-plugin")},
    }
    version = f"igz-risk-{selected.replace('_', '-')}-{time.strftime('%Y%m%d%H%M')}-{sha[:8]}"
    res = {
        "version": version,
        "dataset": {"file": data_path.name, "sha256": sha, "rows": len(df), "train": len(tr), "val": len(va), "test": len(te), "test_label_counts": te["label"].value_counts().to_dict()},
        "protocol": "fit on train; thresholds and model selection on validation; single evaluation on held-out test with unseen text templates",
        "max_false_block_constraint": MAX_FALSE_BLOCK,
        "selected_model": selected,
        "best_cpu_model": best_cpu,
        "selection_rule": selection_rule,
        "nnpa_status": nnpa,
        "thresholds": thr,
        "validation": {"models": val_report},
        "test": results_test,
        "test_all_models": all_models_test,
        "calibration": {"p_block_ece_10bin": round(float(ece), 4), "multiclass_brier": round(brier, 4), "note": "risk scores are reported as model scores; calibration measured here, not assumed"},
        "ablation": ablation,
        "platform": plat,
        "seed": args.seed,
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }

    if not args.no_artifacts:
        artifacts = {}
        cpu_sel = fitted[best_cpu]
        if best_cpu == "xgboost":
            cpu_sel.save_model(out / "risk_model_xgb.json")
            artifacts["xgboost"] = "risk_model_xgb.json"
        joblib.dump(cpu_sel, out / "risk_model.joblib", compress=3)
        artifacts["sklearn"] = "risk_model.joblib"
        if "torch_mlp" in fitted:
            fitted["torch_mlp"].to("cpu").save(out / "risk_mlp_torch.pt", {"seed": args.seed})
            artifacts["torch"] = "risk_mlp_torch.pt"
        serving = "torch" if selected == "torch_mlp" else ("xgboost" if best_cpu == "xgboost" else "sklearn")
        name_of = lambda m: type(m.named_steps["clf"] if hasattr(m, "named_steps") else m).__name__  # noqa: E731
        meta = {
            "version": version,
            "serving_runtime": serving,
            "torch_device": "nnpa" if serving == "torch" else "cpu",
            "selected_model": selected,
            "best_cpu_model": best_cpu,
            "selection_rule": selection_rule,
            "artifacts": artifacts,
            "models": {"sklearn": {"name": name_of(cpu_sel)}, "torch": {"name": "PyTorch MLP 43-64-32-3"}},
            "feature_names": FEATURE_NAMES,
            "classes": CLASSES,
            "thresholds": thr,
            "thresholds_by_model": {n: tuned[n]["hybrid"] for n in tuned if val_report[n]["feasible_under_false_block_constraint"]},
            "feature_importance": imp,
            "benign_means": {k: round(float(v), 6) for k, v in allow_means.items()},
            "training": {**plat, "trained_at": res["generated_at"], "dataset": data_path.name, "dataset_sha256": sha, "seed": args.seed},
            "nnpa_status_at_training": nnpa,
            "metrics": {"test_hybrid": {k: results_test["hybrid"][k] for k in ("macro_f1", "accuracy", "false_block_rate_allow", "unsafe_miss_rate", "challenge_rate")}},
        }
        (out / "model_meta.json").write_text(json.dumps(meta, indent=2))

    if not args.no_charts:
        res["charts"] = charts(res, te, Pte, res_dir / "charts")
    (res_dir / f"evaluation_seed{args.seed}.json").write_text(json.dumps(res, indent=2))
    print(json.dumps({"selected": selected, "thresholds": thr, **{k: {kk: results_test[k][kk] for kk in ("macro_f1", "unsafe_miss_rate", "false_block_rate_allow", "challenge_rate")} for k in results_test}}, indent=2))


if __name__ == "__main__":
    main()
