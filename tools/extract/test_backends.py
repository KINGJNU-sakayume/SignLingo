"""detect() plumbing of the WiLoR and SAM 3D Body backends with stub models (the real models need PyTorch, MANO,
gated checkpoints and CUDA): python -m unittest tools/extract/test_backends.py"""
import sys
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
from backends import Sam3dBackend, WilorBackend  # noqa: E402
from convert import MHR70_LEFT_HAND, MHR70_RIGHT_HAND  # noqa: E402
from test_convert import FOCAL, SIZE, project, synthetic_hand  # noqa: E402

RGB = np.zeros((SIZE[1], SIZE[0], 3), np.uint8)


class Array:
    def __init__(self, value): self.value = np.asarray(value, float)
    def cpu(self): return self
    def numpy(self): return self.value


class StubBody:
    def detect(self, rgb, stamp): return {'body': [{'x': 0, 'y': 0, 'z': 0}] * 33, 'bodyWorld': [{'x': 0, 'y': 0, 'z': 0}] * 33, 'hands': []}


class StubWilor:
    def __init__(self, boxes): self.boxes, self.calls = boxes, []

    def hand_detector(self, image, conf, verbose):
        self.calls.append(('detect', image[0, 0].tolist(), conf))
        return [type('R', (), {'boxes': type('B', (), {'data': Array(self.boxes)})(), '__len__': lambda s: len(self.boxes)})()]

    def predict_with_bboxes(self, rgb, boxes, is_rights):
        self.calls.append(('predict', boxes.tolist(), is_rights))
        out = []
        for right in is_rights:
            k3 = synthetic_hand(np.zeros(3), np.array([0, -1, .2]))
            t = np.array([.3 if right else -.3, 0, 1.5])
            out.append({'wilor_preds': {'pred_keypoints_3d': k3[None], 'pred_cam_t_full': t[None],
                                        'pred_keypoints_2d': project(k3 + t)[None], 'scaled_focal_length': FOCAL}})
        return out


def wilor(boxes):
    backend = WilorBackend.__new__(WilorBackend)
    backend.body, backend.pipe, backend.hand_conf = StubBody(), StubWilor(boxes), .3
    return backend


class WilorDetect(unittest.TestCase):
    def test_top_two_hands_by_confidence_with_sides(self):
        backend = wilor([[0, 0, 10, 10, .4, 1], [5, 5, 20, 20, .9, 0], [1, 1, 3, 3, .35, 1]])
        frame = backend.detect(RGB, 0)
        self.assertEqual([(h['label'], h['score']) for h in frame['hands']], [('Left', .9), ('Right', .4)])
        _, boxes, rights = backend.pipe.calls[1]
        self.assertEqual(boxes, [[5, 5, 20, 20], [0, 0, 10, 10]])
        self.assertEqual(rights, [0.0, 1.0])
        self.assertEqual(len(frame['body']), 33)
        hand = frame['hands'][0]
        self.assertEqual((len(hand['image']), len(hand['world'])), (21, 21))

    def test_detector_receives_bgr(self):
        rgb = RGB.copy(); rgb[0, 0] = [255, 0, 0]
        backend = wilor([])
        backend.detect(rgb, 0)
        self.assertEqual(backend.pipe.calls[0][1], [0, 0, 255])

    def test_no_hands(self):
        self.assertEqual(wilor([]).detect(RGB, 0)['hands'], [])


class Sam3dDetect(unittest.TestCase):
    def test_largest_person_is_converted(self):
        k3 = np.random.default_rng(2).normal(0, .3, (70, 3))
        k3[MHR70_RIGHT_HAND] = synthetic_hand(np.array([-.2, .1, 0]), np.array([0, -1, 0]))
        k3[MHR70_LEFT_HAND] = synthetic_hand(np.array([.2, .1, 0]), np.array([0, -1, 0]))
        t = np.array([0, 0, 2.5])
        person = lambda box, shift: {'bbox': np.array(box, float), 'pred_keypoints_3d': k3, 'pred_cam_t': t + shift,
                                     'pred_keypoints_2d': project(k3 + t + shift), 'focal_length': np.array(FOCAL)}
        backend = Sam3dBackend.__new__(Sam3dBackend)
        backend.estimator = type('E', (), {'process_one_image': lambda self, img: [person([0, 0, 10, 10], 0), person([0, 0, 500, 700], 0)]})()
        frame = backend.detect(RGB, 0)
        self.assertEqual(len(frame['body']), 33)
        self.assertEqual(sorted(h['label'] for h in frame['hands']), ['Left', 'Right'])
        backend.estimator = type('E', (), {'process_one_image': lambda self, img: []})()
        self.assertEqual(backend.detect(RGB, 0), {'body': [], 'bodyWorld': [], 'hands': []})


if __name__ == '__main__':
    unittest.main()
