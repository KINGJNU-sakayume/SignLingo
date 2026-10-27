"""Local landmark extractor for SignLingo reference videos (runs on the operator's PC, not in the browser).

Writes `signlingo.detections` v1: the same raw MediaPipe contract the browser detector produces (pose 33 +
hands 21, image and world landmarks). `npm run motion:import` then reconstructs it with the Motion Lab solver.
Differences from the browser path, all recorded in the output:
  * pose model: heavy (default) or full; hand model unchanged
  * analysis size: up to 1920 px (browser: 960 px)
  * decoding: OpenCV, so iPhone HEVC .mov opens without converting to WebM
Usage:
  python tools/extract/extract.py private-data/videos-hq/ksl-thanks.webm --out private-data/exports/heavy
  python tools/extract/extract.py <video>... --out <folder> [--hz 30|15] [--pose heavy|full] [--max-dimension 1920]
                                  [--mirrored] [--delegate cpu|gpu] [--models work/models]
Videos and landmarks stay on this computer. Outputs are private derived data; never commit them.
"""
import argparse
import hashlib
import json
import math
import sys
import urllib.request
from pathlib import Path

import cv2
import mediapipe as mp
from mediapipe.tasks.python import BaseOptions, vision

MODELS = {
    'pose-heavy': ('https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/1/pose_landmarker_heavy.task',
                   '64437af838a65d18e5ba7a0d39b465540069bc8aae8308de3e318aad31fcbc7b'),
    'pose-full': ('https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task',
                  '5134a3aad27a58b93da0088d431f366da362b44e3ccfbe3462b3827a839011b1'),
    'hand': ('https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
             'fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1'),
}
MAX_SECONDS = 120  # Motion Lab's limit; MotionClip timestamps are validated against it.


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open('rb') as handle:
        for block in iter(lambda: handle.read(1 << 20), b''):
            digest.update(block)
    return digest.hexdigest()


def model(name: str, folder: Path) -> tuple[Path, str, str]:
    """Downloads a pinned model once; refuses bytes that differ from the pinned SHA-256."""
    url, expected = MODELS[name]
    path = folder / url.rsplit('/', 1)[1]
    if not path.exists():
        folder.mkdir(parents=True, exist_ok=True)
        print(f'모델 받는 중: {url}', file=sys.stderr)
        urllib.request.urlretrieve(url, path)
    actual = sha256(path)
    if actual != expected:
        raise SystemExit(f'{path}의 SHA-256({actual})이 고정값과 다릅니다. 파일을 지우고 다시 받으세요.')
    return path, url, actual


def appearance_cut(previous, current) -> bool:
    """Port of src/motion/sceneCut.ts appearanceCut on 16x9 RGB thumbnails (values 0-255)."""
    if previous is None:
        return False
    delta = (abs(current.astype('int16') - previous.astype('int16')).sum(axis=2)) / (3 * 255)
    return float(delta.mean()) > .32 and float((delta > .25).mean()) > .65


def point(p, confidence: bool) -> dict:
    out = {'x': round(p.x, 6), 'y': round(p.y, 6), 'z': round(p.z, 6)}
    if confidence:
        for key in ('visibility', 'presence'):
            value = getattr(p, key, None)
            if value is not None and math.isfinite(value):
                out[key] = round(min(1.0, max(0.0, value)), 6)
    return out


def landmarkers(pose_path: Path, hand_path: Path, delegate: str):
    def make(kind: str):
        options = BaseOptions(model_asset_path=str(pose_path if kind == 'pose' else hand_path),
                              delegate=BaseOptions.Delegate.GPU if delegate == 'gpu' else BaseOptions.Delegate.CPU)
        if kind == 'pose':  # Same settings as the browser detector (src/motion/detector.worker.ts).
            return vision.PoseLandmarker.create_from_options(vision.PoseLandmarkerOptions(
                base_options=options, running_mode=vision.RunningMode.VIDEO, num_poses=1,
                min_pose_detection_confidence=.5, min_pose_presence_confidence=.5, min_tracking_confidence=.5))
        return vision.HandLandmarker.create_from_options(vision.HandLandmarkerOptions(
            base_options=options, running_mode=vision.RunningMode.VIDEO, num_hands=2,
            min_hand_detection_confidence=.5, min_hand_presence_confidence=.5, min_tracking_confidence=.5))
    return make('pose'), make('hand')


def select(times: list[float], hz: int) -> list[int]:
    """Frame indices to analyze: for each sample time k/hz from the first frame, the decoded frame nearest to it,
    each frame at most once. A 15 fps file at 30 Hz gives 15 samples per second, like the browser, which skips
    repeated presentation times. Nearest rather than latest-before: containers store millisecond timestamps
    (0, 33, 67, 100 ms at 30 fps), so 67 ms must count as the 66.7 ms sample."""
    chosen, j, k = [], 0, 0
    if not times:
        return chosen
    while True:
        target = times[0] + k / hz
        if target > times[-1] + .5 / hz:
            return chosen
        while j + 1 < len(times) and abs(times[j + 1] - target) <= abs(times[j] - target):
            j += 1
        if not chosen or chosen[-1] != j:
            chosen.append(j)
        k += 1


def samples(path: Path, hz: int):
    """Yields (seconds, frame) for the selected frames. First pass reads timestamps only."""
    capture, times = cv2.VideoCapture(str(path)), []
    fps = capture.get(cv2.CAP_PROP_FPS) or hz
    while capture.grab():
        time = capture.get(cv2.CAP_PROP_POS_MSEC) / 1000
        if times and time <= times[-1]:  # containers without usable timestamps
            time = times[-1] + 1 / fps
        if time > MAX_SECONDS:
            raise SystemExit(f'영상이 {MAX_SECONDS}초를 넘습니다(Motion Lab과 같은 한도).')
        times.append(time)
    capture.release()
    wanted = set(select(times, hz))
    capture = cv2.VideoCapture(str(path))
    try:
        for index in range(len(times)):
            if not capture.grab():
                return
            if index in wanted:
                ok, frame = capture.retrieve()
                if ok:
                    yield times[index], frame
    finally:
        capture.release()


def extract(video: Path, args, pose_model, hand_model) -> dict:
    capture = cv2.VideoCapture(str(video))
    if not capture.isOpened():
        raise SystemExit(f'영상을 열지 못했습니다: {video}')
    width, height = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH)), int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT))
    fps = capture.get(cv2.CAP_PROP_FPS) or 0
    scale = min(1.0, args.max_dimension / max(width, height)) if args.max_dimension else 1.0
    size = (round(width * scale), round(height * scale))
    pose, hands = landmarkers(pose_model[0], hand_model[0], args.delegate)
    frames, origin, last, thumbnail, used_delegate = [], None, -1, None, args.delegate
    try:
        for seconds, image in samples(video, args.hz):
            if args.mirrored:
                image = cv2.flip(image, 1)  # Unmirror pixels before both models, as the browser does.
            if scale < 1:
                image = cv2.resize(image, size, interpolation=cv2.INTER_AREA)
            rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
            origin = seconds if origin is None else origin
            stamp = max(last + 1, round((seconds - origin) * 1000))  # VIDEO mode needs increasing integer ms
            last = stamp
            picture = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
            p, h = pose.detect_for_video(picture, stamp), hands.detect_for_video(picture, stamp)
            small = cv2.resize(rgb, (16, 9), interpolation=cv2.INTER_AREA)
            frame = {
                'timestamp': stamp,
                'body': [point(q, True) for q in p.pose_landmarks[0]] if p.pose_landmarks else [],
                'bodyWorld': [point(q, True) for q in p.pose_world_landmarks[0]] if p.pose_world_landmarks else [],
                'hands': [{
                    'image': [point(q, False) for q in h.hand_landmarks[i]],
                    'world': [point(q, False) for q in h.hand_world_landmarks[i]],
                    'label': h.handedness[i][0].category_name if h.handedness[i] else 'Unknown',
                    'score': round(h.handedness[i][0].score, 6) if h.handedness[i] else 0,
                } for i in range(len(h.hand_landmarks))][:2],
            }
            if appearance_cut(thumbnail, small):
                frame['discontinuity'] = 'cut'
            thumbnail = small
            frames.append(frame)
            print(f'\r{video.name}: {len(frames)}프레임', end='', file=sys.stderr)
    finally:
        pose.close()
        hands.close()
        capture.release()
    print(file=sys.stderr)
    if not frames:
        raise SystemExit(f'디코딩된 프레임이 없습니다: {video}')
    tracked = sum(1 for f in frames if f['body'])
    if not tracked:
        raise SystemExit(f'몸 랜드마크를 하나도 찾지 못했습니다: {video}')
    end = frames[-1]['timestamp'] / 1000 + (1 / fps if fps else 1 / args.hz)
    return {
        'format': 'signlingo.detections', 'version': 1,
        'detector': f'mediapipe-python@{mp.__version__}/pose-{args.pose}',
        'models': {'pose': pose_model[1], 'hand': hand_model[1]},
        'modelSha256': {'pose': pose_model[2], 'hand': hand_model[2]},
        'source': {'name': video.name, 'size': video.stat().st_size, 'sha256': sha256(video),
                   'duration': round(min(MAX_SECONDS, end), 6), 'timeOffset': round(origin, 6),
                   'width': width, 'height': height, 'mirrored': args.mirrored, 'sampleHz': args.hz},
        'analysis': {'decoder': f'opencv@{cv2.__version__}', 'width': size[0], 'height': size[1],
                     'maxDimension': args.max_dimension, 'delegate': used_delegate, 'sourceFps': round(fps, 3),
                     'bodyFrames': tracked},
        'frames': frames,
    }


def main():
    parser = argparse.ArgumentParser(description='SignLingo local landmark extractor (signlingo.detections v1).')
    parser.add_argument('videos', nargs='+', type=Path)
    parser.add_argument('--out', required=True, type=Path)
    parser.add_argument('--hz', type=int, default=30, choices=(15, 30))
    parser.add_argument('--pose', default='heavy', choices=('heavy', 'full'))
    parser.add_argument('--max-dimension', type=int, default=1920, help='analysis long side in pixels; 0 = original size')
    parser.add_argument('--mirrored', action='store_true', help='only if the SAVED pixels are mirrored')
    parser.add_argument('--delegate', default='cpu', choices=('cpu', 'gpu'))
    parser.add_argument('--models', type=Path, default=Path('work/models'))
    args = parser.parse_args()
    pose_model, hand_model = model(f'pose-{args.pose}', args.models), model('hand', args.models)
    args.out.mkdir(parents=True, exist_ok=True)
    for video in args.videos:
        try:
            doc = extract(video, args, pose_model, hand_model)
        except RuntimeError as error:
            if args.delegate != 'gpu':
                raise
            print(f'GPU 위임 실패({error}); CPU로 다시 실행합니다.', file=sys.stderr)
            args.delegate = 'cpu'
            doc = extract(video, args, pose_model, hand_model)
        out = args.out / (video.stem + '.detections.json')
        out.write_text(json.dumps(doc, ensure_ascii=False, separators=(',', ':')))
        print(f'{out} · {len(doc["frames"])}프레임, 몸 {doc["analysis"]["bodyFrames"]}프레임')


if __name__ == '__main__':
    main()
