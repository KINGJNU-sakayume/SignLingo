"""Local landmark extractor for SignLingo reference videos (runs on the operator's PC, not in the browser).

Writes `signlingo.detections` v1, the browser detector's raw contract (MediaPipe pose 33 + hands 21, image and
world landmarks); `npm run motion:import` reconstructs it with the Motion Lab solver. Backends (backends.py):
  mediapipe  MediaPipe Python 1.1.0, pose heavy (default) or full + the browser's hand model
  wilor      MediaPipe pose + WiLoR 3D hands (PyTorch; your own MANO_RIGHT.pkl)
  sam3d      SAM 3D Body body and hands (CUDA GPU; Hugging Face access)
All backends share decoding (OpenCV: iPhone HEVC .mov opens directly), nearest-frame sampling, the analysis size
(up to 1920 px; the browser uses 960 px) and the scene-cut hint.
Usage:
  python tools/extract/extract.py <video>... --out <folder> [--backend mediapipe|wilor|sam3d] [--hz 30|15]
         [--pose heavy|full] [--max-dimension 1920] [--mirrored] [--delegate cpu|gpu] [--models work/models]
         [--mano MANO_RIGHT.pkl] [--hand-conf 0.3] [--sam3d-repo <checkout>] [--sam3d-checkpoint <folder>]
Videos and landmarks stay on this computer. Outputs are private derived data; never commit them.
"""
import argparse
import json
import sys
from pathlib import Path

import cv2

sys.path.insert(0, str(Path(__file__).parent))
import backends  # noqa: E402

MAX_SECONDS = 120  # Motion Lab's limit; MotionClip timestamps are validated against it.


def appearance_cut(previous, current) -> bool:
    """Port of src/motion/sceneCut.ts appearanceCut on 16x9 RGB thumbnails (values 0-255)."""
    if previous is None:
        return False
    delta = (abs(current.astype('int16') - previous.astype('int16')).sum(axis=2)) / (3 * 255)
    return float(delta.mean()) > .32 and float((delta > .25).mean()) > .65


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


def extract(video: Path, args, backend) -> dict:
    capture = cv2.VideoCapture(str(video))
    if not capture.isOpened():
        raise SystemExit(f'영상을 열지 못했습니다: {video}')
    width, height = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH)), int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT))
    fps = capture.get(cv2.CAP_PROP_FPS) or 0
    capture.release()
    scale = min(1.0, args.max_dimension / max(width, height)) if args.max_dimension else 1.0
    size = (round(width * scale), round(height * scale))
    backend.reset()
    frames, origin, last, thumbnail = [], None, -1, None
    for seconds, image in samples(video, args.hz):
        if args.mirrored:
            image = cv2.flip(image, 1)  # Unmirror pixels before the models, as the browser does.
        if scale < 1:
            image = cv2.resize(image, size, interpolation=cv2.INTER_AREA)
        rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
        origin = seconds if origin is None else origin
        stamp = max(last + 1, round((seconds - origin) * 1000))  # VIDEO mode needs increasing integer ms
        last = stamp
        frame = {'timestamp': stamp, **backend.detect(rgb, stamp)}
        small = cv2.resize(rgb, (16, 9), interpolation=cv2.INTER_AREA)
        if appearance_cut(thumbnail, small):
            frame['discontinuity'] = 'cut'
        thumbnail = small
        frames.append(frame)
        if sys.stderr.isatty():
            print(f'\r{video.name}: {len(frames)}프레임', end='', file=sys.stderr)
    if sys.stderr.isatty():
        print(file=sys.stderr)
    if not frames:
        raise SystemExit(f'디코딩된 프레임이 없습니다: {video}')
    tracked = sum(1 for f in frames if f['body'])
    if not tracked:
        raise SystemExit(f'몸 랜드마크를 하나도 찾지 못했습니다: {video}')
    end = frames[-1]['timestamp'] / 1000 + (1 / fps if fps else 1 / args.hz)
    return {
        'format': 'signlingo.detections', 'version': 1,
        'detector': backend.id, 'models': backend.models, 'modelSha256': backend.model_sha256,
        'source': {'name': video.name, 'size': video.stat().st_size, 'sha256': backends.sha256(video),
                   'duration': round(min(MAX_SECONDS, end), 6), 'timeOffset': round(origin, 6),
                   'width': width, 'height': height, 'mirrored': args.mirrored, 'sampleHz': args.hz},
        'analysis': {'backend': args.backend, 'decoder': f'opencv@{cv2.__version__}', 'width': size[0], 'height': size[1],
                     'maxDimension': args.max_dimension, 'delegate': args.delegate, 'sourceFps': round(fps, 3),
                     'bodyFrames': tracked, 'handSets': sum(len(f['hands']) for f in frames)},
        'frames': frames,
    }


def main():
    parser = argparse.ArgumentParser(description='SignLingo local landmark extractor (signlingo.detections v1).')
    parser.add_argument('videos', nargs='+', type=Path)
    parser.add_argument('--out', required=True, type=Path)
    parser.add_argument('--backend', default='mediapipe', choices=('mediapipe', 'wilor', 'sam3d'))
    parser.add_argument('--hz', type=int, default=30, choices=(15, 30))
    parser.add_argument('--pose', default='heavy', choices=('heavy', 'full'), help='MediaPipe pose model (mediapipe, wilor)')
    parser.add_argument('--max-dimension', type=int, default=1920, help='analysis long side in pixels; 0 = original size')
    parser.add_argument('--mirrored', action='store_true', help='only if the SAVED pixels are mirrored')
    parser.add_argument('--delegate', default='cpu', choices=('cpu', 'gpu'), help='MediaPipe delegate')
    parser.add_argument('--models', type=Path, default=Path('work/models'))
    parser.add_argument('--mano', help='wilor: MANO_RIGHT.pkl from https://mano.is.tue.mpg.de')
    parser.add_argument('--hand-conf', type=float, default=.3, help='wilor: hand detector confidence (WiLoR default 0.3)')
    parser.add_argument('--sam3d-repo', help='sam3d: facebookresearch/sam-3d-body checkout')
    parser.add_argument('--sam3d-checkpoint', default='checkpoints/sam-3d-body-dinov3', help='sam3d: folder with model.ckpt, assets/mhr_model.pt')
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    try:
        backend = backends.create(args)
    except RuntimeError as error:
        if args.delegate != 'gpu':
            raise
        print(f'GPU 위임 실패({error}); CPU로 다시 실행합니다.', file=sys.stderr)
        args.delegate = 'cpu'
        backend = backends.create(args)
    try:
        for video in args.videos:
            doc = extract(video, args, backend)
            out = args.out / (video.stem + '.detections.json')
            out.write_text(json.dumps(doc, ensure_ascii=False, separators=(',', ':')))
            print(f'{out} · {len(doc["frames"])}프레임, 몸 {doc["analysis"]["bodyFrames"]}프레임, 손 {doc["analysis"]["handSets"]}개')
    finally:
        backend.close()


if __name__ == '__main__':
    main()
