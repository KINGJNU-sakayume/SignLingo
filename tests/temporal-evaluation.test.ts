import { expect, it } from 'vitest';
import { practiceClip } from './practice-fixtures';
import { maskObservations, poseError, controlledOcclusion } from '../src/motion/temporalEvaluation';
import { reconstructTemporal } from '../src/motion/temporalReconstruction';

it('controlled masking removes withheld poses, detections and identity before both passes', () => {
  const clip = practiceClip({ count: 9, duration: .266 }), snapshot = JSON.stringify(clip);
  const masked = maskObservations(clip, 2, 2, 'left', 'hand-and-wrist');
  expect(masked.frames[2].hands).toHaveLength(1);
  expect(masked.frames[2].assignment.left).toBeUndefined();
  expect(masked.frames[2].pose.quality.leftState).toBe('missing');
  expect(masked.frames[2].pose.quality.leftArm).toBe(0);
  expect(masked.frames[2].pose.rotations).not.toEqual(clip.frames[2].pose.rotations);
  reconstructTemporal(masked);
  expect(JSON.stringify(clip)).toBe(snapshot);
});

it('error metrics are zero for identical poses and long gaps cannot count as complete', () => {
  const clip = practiceClip({ count: 9, duration: .266 });
  const error = poseError(clip.frames[0].pose, clip.frames[0].pose, 'left');
  for (const value of Object.values(error)) expect(value).toBeLessThan(.00001);
  const report = controlledOcclusion(clip, 'hand').find(row => row.gapFrames === 5)!;
  expect(report.trials).toBeGreaterThan(0);
  expect(report.complete).toBe(0);
  expect(report.after).toBeNull();
});
