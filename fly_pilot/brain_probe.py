"""Probe the whole-brain model (Shiu et al.) to get the jet's control law.

Builds the FlyWire v783 leaky integrate-and-fire network once, using the
parameters in model.py from the brain model checkout (set BRAIN_MODEL). It then drives one visual population at a time
(left or right LC10a, LPLC2, LC4) at several firing rates and records how
fast the descending neurons respond, compared with an unstimulated baseline.

Output: assets/brain_response.json, a table of descending-neuron rates (Hz)
for each input population and input rate. The game interpolates it at runtime.

Usage: python brain_probe.py [--t-run-ms 500] [--trials 3] [--quick]
"""
import argparse, json, os, sys, time
from pathlib import Path
import numpy as np, pandas as pd

ROOT = Path(__file__).resolve().parent
BRAIN_MODEL = Path(os.environ.get("BRAIN_MODEL", ROOT.parent))  # checkout of philshiu/Drosophila_brain_model
sys.path.insert(0, str(BRAIN_MODEL))
from brian2 import NeuronGroup, Synapses, PoissonGroup, SpikeMonitor, Network, ms, Hz, mV, prefs, defaultclock
from model import default_params as P

INPUT_TYPES = ["LC10a", "LPLC2", "LC4"]
OUTPUT_TYPES = ["DNp01", "DNa02", "DNa01", "DNa03", "DNb01", "DNp02", "DNp04", "DNp11", "DNp03", "DNp06", "DNa04", "DNb05", "DNp15"]
RATES = [40, 80, 160]

ap = argparse.ArgumentParser()
ap.add_argument("--t-run-ms", type=float, default=500)
ap.add_argument("--trials", type=int, default=3)
ap.add_argument("--quick", action="store_true", help="one condition only, to time a run")
args = ap.parse_args()

prefs.codegen.target = "numpy"  # no C compiler needed on Windows
comp = pd.read_csv(BRAIN_MODEL / "Completeness_783.csv", index_col=0)
con = pd.read_parquet(BRAIN_MODEL / "Connectivity_783.parquet")
ann = pd.read_csv(ROOT / "data/neuron_annotations.tsv", sep="\t", dtype={"root_id": np.int64},
                  usecols=["root_id", "cell_type", "side"], low_memory=False)
idx = {fid: i for i, fid in enumerate(comp.index)}
ann = ann[ann.root_id.isin(idx)]

def group(cell_type, side):
    return [idx[r] for r in ann[(ann.cell_type == cell_type) & (ann.side == side)].root_id]

inputs = {f"{t}_{s}": group(t, s) for t in INPUT_TYPES for s in ("left", "right")}
outputs = {f"{t}_{s}": group(t, s) for t in OUTPUT_TYPES for s in ("left", "right")}
outputs = {k: v for k, v in outputs.items() if v}
for k, v in inputs.items(): print(f"input  {k:12s} {len(v)} neurons")
print("outputs:", ", ".join(outputs))

t0 = time.time()
neu = NeuronGroup(len(comp), P["eqs"], method="linear", threshold=P["eq_th"], reset=P["eq_rst"],
                  refractory="rfc", namespace=P)
neu.v = P["v_0"]; neu.g = 0 * mV; neu.rfc = P["t_rfc"]
syn = Synapses(neu, neu, "w : volt", on_pre="g += w", delay=P["t_dly"])
syn.connect(i=con["Presynaptic_Index"].values, j=con["Postsynaptic_Index"].values)
syn.w = con["Excitatory x Connectivity"].values * P["w_syn"]
all_in = sorted({i for v in inputs.values() for i in v})
pos_in = {n: k for k, n in enumerate(all_in)}
poi = PoissonGroup(len(all_in), rates=0 * Hz)
drive = Synapses(poi, neu, on_pre=f"g += {float(P['w_syn'] / mV) * P['f_poi']}*mV")
drive.connect(i=np.arange(len(all_in)), j=np.array(all_in))
watch = sorted({i for v in outputs.values() for i in v})
mon = SpikeMonitor(neu, record=watch)
net = Network(neu, syn, poi, drive, mon)
net.store("init")
print(f"network built in {time.time() - t0:.0f} s ({len(comp)} neurons, {len(con)} connections)")

def run(rate_by_group):
    rvec = np.zeros(len(all_in))
    for g, r in rate_by_group.items():
        rvec[[pos_in[n] for n in inputs[g]]] = r
    out = {k: [] for k in outputs}
    for _ in range(args.trials):
        net.restore("init")
        poi.rates = rvec * Hz
        net.run(args.t_run_ms * ms)
        counts = np.bincount(np.asarray(mon.i), minlength=len(comp))
        for k, v in outputs.items():
            out[k].append(float(counts[v].mean() / (args.t_run_ms / 1000)))
    return {k: round(float(np.mean(v)), 2) for k, v in out.items()}

conds = [("baseline", 0)] + [(g, r) for g in inputs for r in RATES]
if args.quick: conds = conds[:1] + [("LPLC2_left", 160)]
results = {}
for g, r in conds:
    t1 = time.time()
    res = run({} if g == "baseline" else {g: r})
    results.setdefault(g, {})[str(r)] = res
    top = sorted(res.items(), key=lambda kv: -kv[1])[:4]
    print(f"{g:12s} {r:4d} Hz  ({time.time() - t1:5.0f} s)  " + ", ".join(f"{k}={v}" for k, v in top), flush=True)

meta = {"model": "Shiu et al. whole-brain LIF, FlyWire v783 (../model.py parameters)",
        "t_run_ms": args.t_run_ms, "trials": args.trials, "input_rates_hz": RATES,
        "inputs": {k: len(v) for k, v in inputs.items()}, "outputs": list(outputs)}
if not args.quick:
    (ROOT / "assets").mkdir(exist_ok=True)
    json.dump({"meta": meta, "responses": results}, open(ROOT / "assets/brain_response.json", "w"), indent=1)
    print("wrote assets/brain_response.json")
