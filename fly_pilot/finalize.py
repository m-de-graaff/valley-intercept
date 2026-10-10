"""Pick the steering neurons from the probe results and copy everything into the game."""
import json, shutil
from pathlib import Path
ROOT = Path(__file__).resolve().parent
d = json.load(open(ROOT / "assets/brain_response.json"))
R = d["responses"]
# ipsilateral turning: which turn neurons does a target on one side drive, on which side?
cands = ["DNa02", "DNa01", "DNa03", "DNa04"]
gain = {}
for c in cands:
    same = R["LC10a_left"]["160"][f"{c}_left"] + R["LC10a_right"]["160"][f"{c}_right"]
    other = R["LC10a_left"]["160"][f"{c}_right"] + R["LC10a_right"]["160"][f"{c}_left"]
    gain[c] = (same - other) / 2
    print(f"{c}: target-side {same/2:.1f} Hz, opposite side {other/2:.1f} Hz")
# DNa02 drives turns toward its own side (Rayshubskiy et al. 2020); use it, plus any
# other candidate that is at least half as lateralised.
best = max(gain.values())
use = [c for c in cands if gain[c] >= 0.5 * best and gain[c] > 5]
# The model's two sides differ a lot in strength (right LC10a -> DNa02 is much weaker),
# so each side is scaled by its own strongest response.
def side_max(s):
    return max(sum(R[g][r][f"{c}_{s}"] for c in use) for g in R if g != "baseline" for r in R[g])
d["turning"] = {"left": [f"{c}_left" for c in use], "right": [f"{c}_right" for c in use],
                "normLeft": round(side_max("left") * 0.6, 1), "normRight": round(side_max("right") * 0.6, 1),
                "label": " + ".join(use) + " turn toward own side; DNp01 = escape"}
print("turning:", d["turning"])
json.dump(d, open(ROOT / "assets/brain_response.json", "w"), indent=1)
dst = ROOT.parent / "public/fly"; dst.mkdir(parents=True, exist_ok=True)
for f in ("brain_response.json", "eyes.json", "fly.glb"): shutil.copy(ROOT / "assets" / f, dst / f)
print("copied to", dst)
