# Valley Intercept

A three.js jet dogfight flown by a fruit fly. The fly sees through a model of a real
compound eye, and a whole-brain simulation built on the fly's wiring diagram (the
FlyWire connectome) picks its target, its turn direction and its escapes. Game code
does the actual flying, and the brain panel labels what is what.

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # production build into dist/
```

## What comes from the fly

- **Eyes.** 721 ommatidia per eye with the viewing directions of NeuroMechFly's retina.
- **Target choice and turn direction.** LC10a neurons (small moving targets) drive the
  turning neurons DNa02/DNa04 on the same side, as measured in the whole-brain model.
- **Escape.** Looming (LPLC2, LC4) drives the giant fiber, DNp01; the jet breaks away.

## What is game code

- **Flight skills:** pursuit geometry, gun lead, airbrake to fight speed, overshoot
  avoidance, missile defence, terrain recovery, going home to repair.
- **Jet sensors:** radar and radar warning, because the fly's eyes are blind in a ~46°
  cone behind it.
- **Learning**, inspired by the mushroom body: damage raises the fly's wariness of
  whatever situation it was in, and each wave it tries varied tactics and keeps the
  ones that score better. Saved in the browser.

## Playing

Open the **Controls** pane (top right):

- **Who flies:** the fruit fly, you (mouse aim; the fly's suggestion is shown), or 1v1 against the fly.
- **Camera:** cinematic director, fly cam, pilot, chase, free orbit, aim cam.
- **Game:** pause (P), speed (1/2/3), hide HUD (H), screenshot (K), fullscreen, next wave (N).

## Layout

- `src/main.js`: world, aircraft, weapons, enemies, waves, HUD, modes
- `src/flypilot.js`: the fly's eyes, brain table and flight skills
- `src/learning.js`: danger memory and tactic tuning
- `src/brainviz.js`: brain panel (real neuron positions, spike raster)
- `src/director.js`: cameras; `src/post.js`: bloom and grading; `src/audio.js`: synthesized sound
- `public/fly/`: fly body, eye geometry, brain response table, neuron positions
- `fly_pilot/`: Python scripts that produce `public/fly/` (see its README)

## Credits

- Fly body and eye model: [NeuroMechFly / flygym](https://github.com/NeLy-EPFL/flygym), Apache-2.0
  (Wang-Chen et al., *Nature Methods* 2024).
- Whole-brain model: [Shiu et al.](https://github.com/philshiu/Drosophila_brain_model),
  *Nature* 2024.
- Connectome and annotations: [FlyWire](https://flywire.ai/) (Dorkenwald et al. 2024;
  Schlegel et al. 2024), CC BY 4.0. `public/fly/brain_map.json` and
  `brain_response.json` are derived from it.
