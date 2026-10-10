"""Export NeuroMechFly's body mesh (GLB) and compound-eye geometry (JSON) for the game.

Body: every mesh geom in the neutral pose, coloured from flygym's visuals.yaml.
Eyes: for each of the 721 ommatidia per eye, the viewing direction in the thorax
frame, recovered by inverting flygym's pipeline (pinhole eye camera -> fisheye
correction -> ommatidia id map). Also the ommatidium's centre on the hexagonal
retina image, used to draw what the fly sees.
"""
import fnmatch, json, sys
from pathlib import Path
import numpy as np, yaml, mujoco as mj, trimesh
from flygym.compose import NeuroMechFly
from flygym.anatomy import Skeleton, JointPreset, AxisOrder
from flygym.compose import KinematicPosePreset
import flygym

out = Path(sys.argv[1]); out.mkdir(parents=True, exist_ok=True)
asset_dir = Path(flygym.__file__).parent / "assets/model/neuromechfly"

fly = NeuroMechFly()
fly.add_joints(Skeleton(joint_preset=JointPreset.ALL_BIOLOGICAL, axis_order=AxisOrder.ROLL_PITCH_YAW),
               neutral_pose=KinematicPosePreset.NEUTRAL)
fly.add_vision()
model, data = fly.compile()
key = model.key("neutral").id if model.nkey else None
if key is not None: mj.mj_resetDataKeyframe(model, data, key)
mj.mj_forward(model, data)

# ---------- colours from visuals.yaml ----------
vis = yaml.safe_load(open(asset_dir / "visuals.yaml"))
def colour_for(body_name):
    rgba = [0.6, 0.45, 0.25, 1.0]
    for vs in vis.values():
        pats = vs["apply_to"] if isinstance(vs["apply_to"], list) else [vs["apply_to"]]
        if any(fnmatch.fnmatch(body_name, p) for p in pats):
            m = vs["material"].get("rgba", [1, 1, 1, 1])
            t = vs.get("texture", {}).get("rgb1")
            rgba = (list(t) if t else list(m[:3])) + [m[3]]
    return rgba

thorax = model.body("c_thorax").id
R_th = data.xmat[thorax].reshape(3, 3); p_th = data.xpos[thorax]
meshes = []
for g in range(model.ngeom):
    if model.geom_type[g] != mj.mjtGeom.mjGEOM_MESH: continue
    mid = model.geom_dataid[g]
    va, vn = model.mesh_vertadr[mid], model.mesh_vertnum[mid]
    fa, fn = model.mesh_faceadr[mid], model.mesh_facenum[mid]
    v = model.mesh_vert[va:va + vn].copy(); f = model.mesh_face[fa:fa + fn].copy()
    R = data.geom_xmat[g].reshape(3, 3); p = data.geom_xpos[g]
    vw = v @ R.T + p                      # world
    vt = (vw - p_th) @ R_th               # thorax frame
    body = mj.mj_id2name(model, mj.mjtObj.mjOBJ_BODY, model.geom_bodyid[g])
    rgba = colour_for(body)
    tm = trimesh.Trimesh(vertices=vt, faces=f, process=False)
    tm.visual = trimesh.visual.ColorVisuals(tm, face_colors=np.tile(np.array(rgba) * 255, (len(f), 1)).astype(np.uint8))
    tm.metadata["name"] = body
    meshes.append((body, tm))
scene = trimesh.Scene()
for name, tm in meshes: scene.add_geometry(tm, node_name=name, geom_name=name)
scene.export(out / "fly.glb")
allv = np.vstack([tm.vertices for _, tm in meshes])
print("segments:", len(meshes), "bbox (thorax frame, mm):", allv.min(0).round(2), allv.max(0).round(2))
hp = (data.xpos[model.body("c_head").id] - p_th) @ R_th
print("head offset in thorax frame:", hp.round(3))

# ---------- compound eyes ----------
vcfg = yaml.safe_load(open(asset_dir / "vision.yaml"))
idmap = np.load(asset_dir / "vision/ommatidia_id_map.npy").astype(int)
pale = np.load(asset_dir / "vision/pale_mask.npy").astype(int)
nrows, ncols = idmap.shape
zoom, k = vcfg["fisheye_zoom"], vcfg["fisheye_distortion_coefficient"]
tanh = np.tan(np.radians(vcfg["fovy_per_eye"]) / 2); aspect = ncols / nrows
eyes = {}
for eye, cam in (("left", "l_eye_cam_camera"), ("right", "r_eye_cam_camera")):
    cid = model.camera(cam).id
    Rc = data.cam_xmat[cid].reshape(3, 3)
    dirs, uv = [], []
    for o in range(1, idmap.max() + 1):
        rows, cols = np.nonzero(idmap == o)
        d_sum = np.zeros(3)
        for r, c in zip(rows, cols):           # same mapping as Retina._correct_fisheye
            rn = ((2 * r - nrows) / nrows) / zoom; cn = ((2 * c - ncols) / ncols) / zoom
            den = 1 - k * (rn * rn + cn * cn) + 1e-6
            sr = ((rn / den + 1) * nrows) / 2; sc = ((cn / den + 1) * ncols) / 2
            x = (2 * (sc + 0.5) / ncols - 1) * tanh * aspect
            y = -(2 * (sr + 0.5) / nrows - 1) * tanh
            ray = np.array([x, y, -1.0]); d_sum += ray / np.linalg.norm(ray)
        dw = Rc @ (d_sum / np.linalg.norm(d_sum))
        dt = R_th.T @ dw
        dirs.append((dt / np.linalg.norm(dt)).round(4).tolist())
        uv.append([round(cols.mean() / ncols, 4), round(rows.mean() / nrows, 4)])
    d = np.array(dirs)
    print(eye, "ommatidia:", len(dirs), "mean dir:", d.mean(0).round(3))
    eyes[eye] = {"dirs": dirs, "uv": uv, "pale": pale[: len(dirs)].tolist()}
json.dump({"frame": "NeuroMechFly thorax frame (x forward, y left, z up)", **eyes},
          open(out / "eyes.json", "w"), separators=(",", ":"))
print("wrote", out)
