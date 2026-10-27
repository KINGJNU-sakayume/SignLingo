"""Landmark backends for extract.py. Each returns one frame of the SignLingo detection contract:
{'body': [33], 'bodyWorld': [33], 'hands': [<=2 {image, world, label, score}]}.

  mediapipe  MediaPipe Python 1.1.0 pose (heavy/full) + hand landmarker; same settings as the browser.
  wilor      MediaPipe pose for the body + WiLoR (CVPR 2025) 3D hands. Needs PyTorch and your own MANO_RIGHT.pkl.
  sam3d      SAM 3D Body (Meta) body and hands from one model. Needs a CUDA GPU and Hugging Face access.

Heavy dependencies are imported only by the backend that needs them (requirements-*.txt).
"""
import contextlib
import hashlib
import io
import math
import shutil
import sys
import urllib.request
from pathlib import Path

import numpy as np

from convert import mhr70_frame, wilor_hand

MEDIAPIPE_MODELS = {
    'pose-heavy': ('https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/1/pose_landmarker_heavy.task',
                   '64437af838a65d18e5ba7a0d39b465540069bc8aae8308de3e318aad31fcbc7b'),
    'pose-full': ('https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task',
                  '5134a3aad27a58b93da0088d431f366da362b44e3ccfbe3462b3827a839011b1'),
    'hand': ('https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
             'fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1'),
}
# Official WiLoR release (Hugging Face Space of the authors; SHA-256 = the LFS object ids) and repository file.
WILOR_FILES = {
    'wilor_final.ckpt': ('https://huggingface.co/spaces/rolpotamias/WiLoR/resolve/main/pretrained_models/wilor_final.ckpt',
                         '3e97aafc7dd08d883a4cc5a027df61fdb6fda6136dbd1319405413862ada6bb2'),
    'detector.pt': ('https://huggingface.co/spaces/rolpotamias/WiLoR/resolve/main/pretrained_models/detector.pt',
                    '5ef3df44e42d2db52d4ffe91f83a22ce9925e2acc9abebf453f2c5d22e380033'),
    'mano_mean_params.npz': ('https://raw.githubusercontent.com/rolpotamias/WiLoR/fcb911312a38fa8badd30d9656a167485d61b8f9/mano_data/mano_mean_params.npz',
                             'efc0ec58e4a5cef78f3abfb4e8f91623b8950be9eff8b8e0dbb0d036ebc63988'),
}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open('rb') as handle:
        for block in iter(lambda: handle.read(1 << 20), b''):
            digest.update(block)
    return digest.hexdigest()


def pinned(path: Path, url: str, expected: str) -> str:
    """Downloads once; refuses bytes that differ from the pinned SHA-256."""
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        print(f'모델 받는 중: {url}', file=sys.stderr)
        urllib.request.urlretrieve(url, path)
    actual = sha256(path)
    if actual != expected:
        raise SystemExit(f'{path}의 SHA-256({actual})이 고정값과 다릅니다. 파일을 지우고 다시 받으세요.')
    return actual


def _point(p, confidence: bool) -> dict:
    out = {'x': round(p.x, 6), 'y': round(p.y, 6), 'z': round(p.z, 6)}
    if confidence:
        for key in ('visibility', 'presence'):
            value = getattr(p, key, None)
            if value is not None and math.isfinite(value):
                out[key] = round(min(1.0, max(0.0, value)), 6)
    return out


class MediaPipeBackend:
    """Pose + hands as the browser runs them (src/motion/detector.worker.ts), in Python."""

    def __init__(self, args, hands: bool = True):
        import mediapipe as mp
        from mediapipe.tasks.python import BaseOptions, vision
        self.mp, self.hands_enabled = mp, hands
        names = [f'pose-{args.pose}'] + (['hand'] if hands else [])
        self.models, self.model_sha256 = {}, {}
        for name in names:
            url, expected = MEDIAPIPE_MODELS[name]
            path = args.models / url.rsplit('/', 1)[1]
            key = 'pose' if name.startswith('pose') else 'hand'
            self.model_sha256[key] = pinned(path, url, expected)
            self.models[key] = url
        delegate = BaseOptions.Delegate.GPU if args.delegate == 'gpu' else BaseOptions.Delegate.CPU
        base = lambda key: BaseOptions(model_asset_path=str(args.models / self.models[key].rsplit('/', 1)[1]), delegate=delegate)
        self._create = lambda: (
            vision.PoseLandmarker.create_from_options(vision.PoseLandmarkerOptions(
                base_options=base('pose'), running_mode=vision.RunningMode.VIDEO, num_poses=1,
                min_pose_detection_confidence=.5, min_pose_presence_confidence=.5, min_tracking_confidence=.5)),
            vision.HandLandmarker.create_from_options(vision.HandLandmarkerOptions(
                base_options=base('hand'), running_mode=vision.RunningMode.VIDEO, num_hands=2,
                min_hand_detection_confidence=.5, min_hand_presence_confidence=.5, min_tracking_confidence=.5)) if hands else None)
        self.pose = self.hands = None
        self.reset()
        self.id = f'mediapipe-python@{mp.__version__}/pose-{args.pose}'

    def detect(self, rgb: np.ndarray, stamp: int) -> dict:
        picture = self.mp.Image(image_format=self.mp.ImageFormat.SRGB, data=np.ascontiguousarray(rgb))
        p = self.pose.detect_for_video(picture, stamp)
        frame = {
            'body': [_point(q, True) for q in p.pose_landmarks[0]] if p.pose_landmarks else [],
            'bodyWorld': [_point(q, True) for q in p.pose_world_landmarks[0]] if p.pose_world_landmarks else [],
            'hands': [],
        }
        if self.hands:
            h = self.hands.detect_for_video(picture, stamp)
            frame['hands'] = [{
                'image': [_point(q, False) for q in h.hand_landmarks[i]],
                'world': [_point(q, False) for q in h.hand_world_landmarks[i]],
                'label': h.handedness[i][0].category_name if h.handedness[i] else 'Unknown',
                'score': round(h.handedness[i][0].score, 6) if h.handedness[i] else 0,
            } for i in range(len(h.hand_landmarks))][:2]
        return frame

    def reset(self):
        """New video: VIDEO-mode landmarkers need increasing timestamps and carry tracking state, so start fresh."""
        self.close()
        self.pose, self.hands = self._create()

    def close(self):
        for landmarker in (self.pose, self.hands):
            if landmarker:
                landmarker.close()
        self.pose = self.hands = None


class WilorBackend:
    """MediaPipe pose (body) + WiLoR hands. WiLoR runs per frame (no temporal model); the solver's tracking
    associates hands to the pose wrists exactly as for MediaPipe hands."""

    def __init__(self, args):
        import torch
        from wilor_mini.pipelines.wilor_hand_pose3d_estimation_pipeline import WiLorHandPose3dEstimationPipeline
        if not args.mano or not Path(args.mano).is_file():
            raise SystemExit('WiLoR에는 MANO 손 모델이 필요합니다. https://mano.is.tue.mpg.de 에서 가입·동의 후 받은 '
                             'MANO_RIGHT.pkl 경로를 --mano로 주세요(제3자 사본은 MANO 라이선스상 쓰지 않습니다).')
        self.body = MediaPipeBackend(args, hands=False)
        root = args.models / 'wilor'
        files = root / 'pretrained_models'
        self.model_sha256 = dict(self.body.model_sha256)
        for name, (url, expected) in WILOR_FILES.items():
            self.model_sha256[name] = pinned(files / name, url, expected)
        mano = files / 'MANO_RIGHT.pkl'
        if not mano.exists() or sha256(mano) != sha256(Path(args.mano)):
            shutil.copyfile(args.mano, mano)  # the pipeline reads it from its folder; never downloads it then
        self.model_sha256['MANO_RIGHT.pkl'] = sha256(mano)
        self.models = {**self.body.models, 'hand': WILOR_FILES['wilor_final.ckpt'][0], 'handDetector': WILOR_FILES['detector.pt'][0],
                       'mano': 'MANO_RIGHT.pkl (user-supplied, https://mano.is.tue.mpg.de)'}
        self.device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
        dtype = torch.float16 if self.device.type == 'cuda' else torch.float32
        self.pipe = WiLorHandPose3dEstimationPipeline(device=self.device, dtype=dtype, verbose=False, wilor_pretrained_dir=str(root))
        self.hand_conf = args.hand_conf
        self.id = f'{self.body.id}+wilor@{self.device.type}'

    def detect(self, rgb: np.ndarray, stamp: int) -> dict:
        frame = self.body.detect(rgb, stamp)
        bgr = np.ascontiguousarray(rgb[:, :, ::-1])
        found = self.pipe.hand_detector(bgr, conf=self.hand_conf, verbose=False)[0]
        if not len(found):
            return frame
        boxes = found.boxes.data.cpu().numpy()  # x0, y0, x1, y1, conf, cls
        boxes = boxes[np.argsort(-boxes[:, 4])][:2]
        results = self.pipe.predict_with_bboxes(rgb, boxes[:, :4], boxes[:, 5].tolist())
        size = (rgb.shape[1], rgb.shape[0])
        for box, result in zip(boxes, results):
            preds = result['wilor_preds']
            frame['hands'].append(wilor_hand(preds['pred_keypoints_3d'][0], preds['pred_cam_t_full'][0], preds['pred_keypoints_2d'][0],
                                             float(preds['scaled_focal_length']), size, bool(box[5] >= .5), float(box[4])))
        return frame

    def reset(self):
        self.body.reset()

    def close(self):
        self.body.close()


class Sam3dBackend:
    """SAM 3D Body: body and hands of the largest detected person (one signer) from one model, per frame."""

    def __init__(self, args):
        import torch
        if not torch.cuda.is_available():
            raise SystemExit('SAM 3D Body는 CUDA GPU가 필요합니다(공식 코드가 추론 중 cuda를 고정해서 씁니다).')
        if not args.sam3d_repo or not (Path(args.sam3d_repo) / 'sam_3d_body').is_dir():
            raise SystemExit('--sam3d-repo에 facebookresearch/sam-3d-body 체크아웃 경로를 주세요(docs/LOCAL_EXTRACTION.md).')
        sys.path.insert(0, str(Path(args.sam3d_repo).resolve()))
        from sam_3d_body import SAM3DBodyEstimator, load_sam_3d_body
        checkpoint = Path(args.sam3d_checkpoint)
        ckpt, mhr = checkpoint / 'model.ckpt', checkpoint / 'assets' / 'mhr_model.pt'
        if not ckpt.exists() or not mhr.exists():
            raise SystemExit(f'{checkpoint}에 model.ckpt와 assets/mhr_model.pt가 없습니다. Hugging Face에서 접근 승인 후 '
                             f'`hf download facebook/sam-3d-body-dinov3 --local-dir {checkpoint}`로 받으세요.')
        with contextlib.redirect_stdout(io.StringIO()):
            model, cfg = load_sam_3d_body(str(ckpt), device=torch.device('cuda'), mhr_path=str(mhr))
            self.estimator = SAM3DBodyEstimator(sam_3d_body_model=model, model_cfg=cfg)
        self.models = {'body': f'facebook/{checkpoint.name}', 'hand': f'facebook/{checkpoint.name} (hand decoder)'}
        self.model_sha256 = {'model.ckpt': sha256(ckpt), 'mhr_model.pt': sha256(mhr)}
        self.id = f'sam-3d-body/{checkpoint.name}'

    def detect(self, rgb: np.ndarray, stamp: int) -> dict:
        with contextlib.redirect_stdout(io.StringIO()):  # the estimator prints on every call
            people = self.estimator.process_one_image(np.ascontiguousarray(rgb))
        if not people:
            return {'body': [], 'bodyWorld': [], 'hands': []}
        person = max(people, key=lambda p: float((p['bbox'][2] - p['bbox'][0]) * (p['bbox'][3] - p['bbox'][1])))
        return mhr70_frame(person['pred_keypoints_3d'], person['pred_cam_t'], person['pred_keypoints_2d'],
                           float(np.asarray(person['focal_length']).reshape(-1)[0]), (rgb.shape[1], rgb.shape[0]))

    def reset(self):
        pass  # per-image model, no state between frames

    def close(self):
        pass


def create(args):
    return {'mediapipe': MediaPipeBackend, 'wilor': WilorBackend, 'sam3d': Sam3dBackend}[args.backend](args)
