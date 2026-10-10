# Fly pilot

Python scripts that turn a fruit fly model into the data files the game uses
(`public/fly/`). You only need them to rebuild those files; the game runs without them.

| Part | Source | Becomes |
|---|---|---|
| Body | [NeuroMechFly / flygym](https://github.com/NeLy-EPFL/flygym), neutral pose | `fly.glb`, the fly in the cockpit |
| Eyes | NeuroMechFly retina, 721 ommatidia per eye | `eyes.json`, the viewing direction of every ommatidium |
| Brain | [Shiu et al. whole-brain model](https://github.com/philshiu/Drosophila_brain_model) on FlyWire v783 | `brain_response.json`, descending-neuron rates for each visual input |
| Cell types and positions | [FlyWire annotations](https://github.com/flyconnectome/flywire_annotations) (Schlegel et al. 2024) | Finding LC10a, LPLC2, LC4, DNa02, DNp01, …; `brain_map.json` for the brain panel |

## Rebuild the data

You need Python 3.12+, a checkout of `philshiu/Drosophila_brain_model` (for `model.py`
and the v783 connectome), and the FlyWire annotations file.

```bash
pip install flygym brian2 pandas pyarrow trimesh
mkdir -p fly_pilot/data
curl -L -o fly_pilot/data/neuron_annotations.tsv \
  https://raw.githubusercontent.com/flyconnectome/flywire_annotations/main/supplemental_files/Supplemental_file1_neuron_annotations.tsv

python fly_pilot/export_fly_assets.py fly_pilot/assets                       # body + eyes
BRAIN_MODEL=/path/to/Drosophila_brain_model \
  python fly_pilot/brain_probe.py --trials 4 --t-run-ms 500                  # about 35 min on a CPU
python fly_pilot/export_brain_map.py                                         # neuron positions
python fly_pilot/finalize.py                                                 # picks the steering neurons, copies to public/fly
```

## What the probe found

Driving one eye's LC10a neurons (small moving targets) fires DNa02 and DNa04 on the
same side, and nothing on the other side. That is a turn toward the target.
Driving LPLC2 or LC4 (looming) on either side fires the giant fiber, DNp01, on both
sides at up to ~125 Hz. The model's right side responds much more weakly than its
left, so the game scales each side by its own maximum.

## Limits

- The probe drives one population at a time; the game adds their effects together,
  which only approximates the real, non-linear brain.
- Distant aircraft are drawn up to 30× larger for the fly (never more than ~6° wide).
  At true size its ~5° ommatidia could not see a jet beyond about 100 m.
- Everything that is not the eyes or the descending-neuron table is game code. See
  the main README.
