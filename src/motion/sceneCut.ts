// Tiny RGB thumbnails detect large appearance discontinuities after decoding.
// This is a conservative cut hint, not a guarantee of edit detection.
export function appearanceCut(previous: Uint8ClampedArray | undefined, current: Uint8ClampedArray): boolean {
  if (!previous || previous.length !== current.length || current.length === 0) return false;
  let difference = 0, changed = 0;
  for (let i = 0; i < current.length; i += 4) {
    const delta = (Math.abs(current[i] - previous[i]) + Math.abs(current[i + 1] - previous[i + 1]) + Math.abs(current[i + 2] - previous[i + 2])) / (3 * 255);
    difference += delta; if (delta > .25) changed++;
  }
  const pixels = current.length / 4;
  return difference / pixels > .32 && changed / pixels > .65;
}
