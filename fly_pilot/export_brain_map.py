"""Export neuron positions for the in-game brain map.

Frontal (x, y) projection of FlyWire v783 neuron positions:
- a sample of all neurons, by super class, drawn as the brain's silhouette
- every neuron of the populations the fly pilot uses (LC10a, LPLC2, LC4)
- the descending neurons recorded in brain_response.json
"""
import json
from pathlib import Path
import numpy as np, pandas as pd

ROOT = Path(__file__).resolve().parent
a = pd.read_csv(ROOT / "data/neuron_annotations.tsv", sep="\t", low_memory=False,
                usecols=["root_id", "pos_x", "pos_y", "super_class", "cell_class", "cell_type", "side"])
a = a.dropna(subset=["pos_x", "pos_y"])
x0, x1 = a.pos_x.quantile([0.002, 0.998]); y0, y1 = a.pos_y.quantile([0.002, 0.998])
def norm(df):
    return np.round(np.c_[(df.pos_x - x0) / (x1 - x0), (df.pos_y - y0) / (y1 - y0)], 4).tolist()

group = {"optic": "visual", "visual_projection": "visual", "visual_centrifugal": "visual",
         "central": "central", "descending": "descending", "ascending": "central",
         "sensory": "sensory", "motor": "descending", "endocrine": "central"}
rng = np.random.default_rng(1)
bg = a.sample(7000, random_state=1)
kc = a[a.cell_class == "Kenyon_Cell"].sample(500, random_state=2)   # mushroom bodies, for orientation
out = {"background": [[*p, group.get(c, "central")] for p, c in zip(norm(bg), bg.super_class)],
       "mushroom": norm(kc), "populations": {}, "neurons": {}}
for t in ["LC10a", "LPLC2", "LC4"]:
    for s in ["left", "right"]:
        out["populations"][f"{t}_{s}"] = norm(a[(a.cell_type == t) & (a.side == s)])
resp = json.load(open(ROOT / "assets/brain_response.json"))
for n in resp["meta"]["outputs"]:
    t, s = n.rsplit("_", 1)
    r = a[(a.cell_type == t) & (a.side == s)]
    if len(r): out["neurons"][n] = norm(r)[0]
json.dump(out, open(ROOT / "assets/brain_map.json", "w"), separators=(",", ":"))
print({k: len(v) for k, v in out["populations"].items()}, len(out["neurons"]), "DNs")
print("note: FlyWire x grows toward the fly's left? sample LC10a_left mean x:",
      np.mean([p[0] for p in out["populations"]["LC10a_left"]]).round(3))
