"""Pure conversions from other models' outputs to the SignLingo detection contract (MediaPipe pose 33 + hand 21).

No model code here, only numpy, so the mappings are unit-tested without GPUs or gated weights (test_convert.py).
Coordinate conventions of the contract (src/motion/types.ts, SPACES):
  image:  normalized x = px / width, y = px / height of the unmirrored analysis frame; z = depth relative to the
          wrist (hands) or hip midpoint (pose) on roughly the same scale as x, smaller = closer to the camera
  world:  meters, camera-oriented axes (x right, y down, z away from the camera); pose origin = hip midpoint,
          hand origin arbitrary (the solver only uses differences from the wrist)
Both WiLoR and SAM 3D Body output camera-frame points in this OpenCV orientation (x right, y down, z forward):
their 2D keypoints are K @ (points + translation) / z.
"""
import numpy as np

# MediaPipe hand: wrist, then per finger base -> tip (thumb CMC, MCP, IP, TIP; others MCP, PIP, DIP, TIP).
# WiLoR (MANO via mano_to_openpose) already uses this OpenPose order.

# SAM 3D Body MHR70 (sam_3d_body/metadata/mhr70.py): per finger "tip, first, second, third joint"; the skeleton
# links wrist -> third_joint -> second -> first -> tip, so the base is the "third joint". Reverse to base -> tip.
_FINGERS_RIGHT = [(24, 23, 22, 21), (28, 27, 26, 25), (32, 31, 30, 29), (36, 35, 34, 33), (40, 39, 38, 37)]
MHR70_RIGHT_HAND = [41] + [i for finger in _FINGERS_RIGHT for i in finger]
MHR70_LEFT_HAND = [62] + [i + 21 for finger in _FINGERS_RIGHT for i in finger]

# MediaPipe pose 33 from MHR70. MHR70 has one point per eye and no mouth: eye inner/outer reuse the eye, mouth
# corners reuse the nose and are marked not visible. Pose "pinky/index/thumb" (17-22) take the finger bases.
MHR70_TO_POSE33 = [
    0,            # 0 nose
    1, 1, 1,      # 1-3 left eye inner / eye / outer
    2, 2, 2,      # 4-6 right eye inner / eye / outer
    3, 4,         # 7 left ear, 8 right ear
    0, 0,         # 9-10 mouth corners (not estimated)
    5, 6, 7, 8,   # 11-14 shoulders, elbows
    62, 41,       # 15 left wrist, 16 right wrist
    61, 40,       # 17-18 pinky base
    49, 28,       # 19-20 index base
    45, 24,       # 21-22 thumb base
    9, 10,        # 23-24 hips
    11, 12, 13, 14,  # 25-28 knees, ankles
    17, 20,       # 29-30 heels
    15, 18,       # 31-32 big toes (MediaPipe foot index)
]
NOT_ESTIMATED_POSE33 = {9, 10}


def _round(value: float) -> float:
    return round(float(value), 6)


def image_points(pixels: np.ndarray, camera: np.ndarray, origin_depth: float, focal: float, size: tuple[int, int],
                 visibility: np.ndarray | None = None) -> list[dict]:
    """pixels (N,2) in analysis pixels, camera (N,3) camera-frame meters; z relative to `origin_depth`."""
    width, height = size
    out = []
    for k, ((u, v), point) in enumerate(zip(pixels, camera)):
        z = focal * (point[2] - origin_depth) / (origin_depth * width) if origin_depth > 0 else 0.0
        entry = {'x': _round(u / width), 'y': _round(v / height), 'z': _round(z)}
        if visibility is not None:
            entry['visibility'] = _round(visibility[k])
            entry['presence'] = _round(visibility[k])
        out.append(entry)
    return out


def world_points(points: np.ndarray, origin: np.ndarray, visibility: np.ndarray | None = None) -> list[dict]:
    out = []
    for k, (x, y, z) in enumerate(points - origin):
        entry = {'x': _round(x), 'y': _round(y), 'z': _round(z)}
        if visibility is not None:
            entry['visibility'] = _round(visibility[k])
            entry['presence'] = _round(visibility[k])
        out.append(entry)
    return out


def in_frame(pixels: np.ndarray, size: tuple[int, int], margin: float = 0.0) -> np.ndarray:
    width, height = size
    return ((pixels[:, 0] >= -margin * width) & (pixels[:, 0] <= (1 + margin) * width)
            & (pixels[:, 1] >= -margin * height) & (pixels[:, 1] <= (1 + margin) * height))


def hand_detection(keypoints_3d: np.ndarray, translation: np.ndarray, pixels: np.ndarray, focal: float,
                   size: tuple[int, int], label: str, score: float) -> dict:
    """One hand in MediaPipe order: keypoints_3d (21,3) model-frame meters, translation (3,) to the camera frame,
    pixels (21,2) their projection in the analysis frame."""
    camera = keypoints_3d + translation
    return {
        'image': image_points(pixels, camera, float(camera[0, 2]), focal, size),
        'world': world_points(keypoints_3d, keypoints_3d.mean(axis=0)),
        'label': label, 'score': _round(min(1.0, max(0.0, score))),
    }


def wilor_hand(keypoints_3d: np.ndarray, cam_t_full: np.ndarray, keypoints_2d: np.ndarray, focal: float,
               size: tuple[int, int], is_right: bool, confidence: float) -> dict:
    """WiLoR output (already un-flipped for left hands) -> one MediaPipe-order hand.

    The label is the anatomical side (WiLoR flips left-hand crops). MediaPipe Tasks labels match the anatomical
    side on unmirrored frames in this project's clips (e.g. 160 of 163 assigned hands in the ksl-thanks HQ clip),
    and the solver only uses labels as a weak tie-breaker after the pose-wrist distance."""
    return hand_detection(np.asarray(keypoints_3d, float).reshape(21, 3), np.asarray(cam_t_full, float).reshape(3),
                          np.asarray(keypoints_2d, float).reshape(21, 2), focal, size,
                          'Right' if is_right else 'Left', confidence)


def mhr70_frame(keypoints_3d: np.ndarray, cam_t: np.ndarray, keypoints_2d: np.ndarray, focal: float,
                size: tuple[int, int], min_hand_pixels: float = 20.0, hand_score: float = 0.9) -> dict:
    """SAM 3D Body person output (MHR70 keypoints) -> body, bodyWorld and hands of one detection frame.

    SAM 3D Body gives no per-keypoint confidence and always completes the whole body. Visibility here is a
    frame-membership proxy: 0.95 inside the analysis frame, 0.05 outside (the solver's gates then withhold
    off-screen arms). A hand is emitted only when all 21 points lie inside the frame and the hand spans at least
    `min_hand_pixels`; its score is the constant `hand_score`, not a model confidence."""
    k3 = np.asarray(keypoints_3d, float)[:70]
    k2 = np.asarray(keypoints_2d, float)[:70]
    t = np.asarray(cam_t, float).reshape(3)
    camera = k3 + t
    hips = (k3[9] + k3[10]) / 2
    pose3, pose2, pose_camera = k3[MHR70_TO_POSE33], k2[MHR70_TO_POSE33], camera[MHR70_TO_POSE33]
    visible = np.where(in_frame(pose2, size), 0.95, 0.05)
    for index in NOT_ESTIMATED_POSE33:
        visible[index] = 0.0
    hands = []
    for label, indices in (('Left', MHR70_LEFT_HAND), ('Right', MHR70_RIGHT_HAND)):
        pixels = k2[indices]
        span = float(np.ptp(pixels, axis=0).max())
        if in_frame(pixels, size).all() and span >= min_hand_pixels:
            hands.append(hand_detection(k3[indices], t, pixels, focal, size, label, hand_score))
    return {
        'body': image_points(pose2, pose_camera, float((camera[9, 2] + camera[10, 2]) / 2), focal, size, visible),
        'bodyWorld': world_points(pose3, hips, visible),
        'hands': hands,
    }
