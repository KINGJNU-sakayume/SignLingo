"""Unit tests for convert.py (numpy only): python -m unittest tools/extract/test_convert.py"""
import sys
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
from convert import (MHR70_LEFT_HAND, MHR70_RIGHT_HAND, MHR70_TO_POSE33, NOT_ESTIMATED_POSE33,  # noqa: E402
                     mhr70_frame, wilor_hand)

SIZE, FOCAL = (1000, 800), 900.0


def project(camera):
    return np.stack([FOCAL * camera[:, 0] / camera[:, 2] + SIZE[0] / 2, FOCAL * camera[:, 1] / camera[:, 2] + SIZE[1] / 2], 1)


def synthetic_hand(wrist, direction):
    """21 MediaPipe-order points: each finger fans out from the wrist, base -> tip at 3, 5, 7, 9 cm."""
    points = [wrist]
    for f in range(5):
        spread = np.array([(f - 2) * .02, 0, 0])
        for step in (.03, .05, .07, .09):
            points.append(wrist + direction * step + spread)
    return np.array(points)


class Mhr70(unittest.TestCase):
    def setUp(self):
        rng = np.random.default_rng(1)
        self.k3 = rng.normal(0, .3, (70, 3))
        self.k3[MHR70_RIGHT_HAND] = synthetic_hand(np.array([-.2, .1, 0]), np.array([0, -1, 0]))
        self.k3[MHR70_LEFT_HAND] = synthetic_hand(np.array([.2, .1, 0]), np.array([0, -1, 0]))
        self.t = np.array([0, 0, 2.5])
        self.k2 = project(self.k3 + self.t)

    def test_indices_cover_each_hand_once(self):
        self.assertEqual(sorted(MHR70_RIGHT_HAND), list(range(21, 42)))
        self.assertEqual(sorted(MHR70_LEFT_HAND), list(range(42, 63)))
        self.assertEqual(len(MHR70_TO_POSE33), 33)

    def test_fingers_run_base_to_tip(self):
        frame = mhr70_frame(self.k3, self.t, self.k2, FOCAL, SIZE)
        for hand in frame['hands']:
            world = np.array([[p['x'], p['y'], p['z']] for p in hand['world']])
            for f in range(5):
                chain = world[1 + 4 * f: 5 + 4 * f]
                distances = np.linalg.norm(chain - world[0], axis=1)
                self.assertTrue(np.all(np.diff(distances) > 0), (hand['label'], f, distances))

    def test_hand_side_and_wrist(self):
        frame = mhr70_frame(self.k3, self.t, self.k2, FOCAL, SIZE)
        labels = {h['label']: h for h in frame['hands']}
        self.assertEqual(set(labels), {'Left', 'Right'})
        right = labels['Right']['image'][0]
        self.assertAlmostEqual(right['x'] * SIZE[0], self.k2[41, 0], places=2)
        self.assertAlmostEqual(frame['body'][16]['x'], right['x'], places=5)  # pose right wrist = hand wrist

    def test_body_world_is_hip_centered_and_mouth_not_visible(self):
        frame = mhr70_frame(self.k3, self.t, self.k2, FOCAL, SIZE)
        hips = np.array([[frame['bodyWorld'][i][a] for a in 'xyz'] for i in (23, 24)])
        np.testing.assert_allclose(hips.mean(axis=0), 0, atol=1e-6)
        for i in NOT_ESTIMATED_POSE33:
            self.assertEqual(frame['body'][i]['visibility'], 0)

    def test_off_screen_hand_is_withheld_and_arm_marked(self):
        k2 = self.k2.copy()
        k2[MHR70_LEFT_HAND, 0] += SIZE[0]  # whole left hand outside the frame
        frame = mhr70_frame(self.k3, self.t, k2, FOCAL, SIZE)
        self.assertEqual([h['label'] for h in frame['hands']], ['Right'])
        self.assertLess(frame['body'][15]['visibility'], .45)  # left wrist below the solver's 0.45 gate

    def test_tiny_hand_is_withheld(self):
        frame = mhr70_frame(self.k3, self.t, self.k2, FOCAL, SIZE, min_hand_pixels=10_000)
        self.assertEqual(frame['hands'], [])


class Wilor(unittest.TestCase):
    def test_projection_depth_and_label(self):
        k3 = synthetic_hand(np.zeros(3), np.array([0, -1, .3]))
        t = np.array([.1, .05, 1.2])
        hand = wilor_hand(k3, t, project(k3 + t), FOCAL, SIZE, True, .87)
        self.assertEqual((hand['label'], hand['score']), ('Right', .87))
        image = np.array([[p['x'] * SIZE[0], p['y'] * SIZE[1]] for p in hand['image']])
        np.testing.assert_allclose(image, project(k3 + t), atol=1e-3)
        self.assertEqual(hand['image'][0]['z'], 0)  # wrist is the depth origin
        tip = hand['image'][8]['z']
        self.assertGreater(tip, 0)  # index tip is farther from the camera (+z direction)
        world = np.array([[p['x'], p['y'], p['z']] for p in hand['world']])
        np.testing.assert_allclose(world[8] - world[0], k3[8] - k3[0], atol=1e-6)
        self.assertEqual(wilor_hand(k3, t, project(k3 + t), FOCAL, SIZE, False, 1.4)['label'], 'Left')


if __name__ == '__main__':
    unittest.main()
