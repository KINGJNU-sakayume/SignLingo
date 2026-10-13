import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync('src/design/tokens.css', 'utf8');
const tokens = Object.fromEntries([...css.matchAll(/--([a-z-]+):\s*(#[0-9A-Fa-f]{6})/g)].map(([, name, value]) => [name, value]));
const color = (value: string) => value.startsWith('#') ? value : tokens[value];
function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
  return .2126 * r + .7152 * g + .0722 * b;
}
function contrast(foreground: string, background: string) {
  const [a, b] = [luminance(color(foreground)), luminance(color(background))];
  return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
}
// [text, background, minimum, where it is used]. 3:1 pairs are only used for ≥19px bold text or icons.
const pairs: [string, string, number, string][] = [
  ['ink', 'canvas', 4.5, 'body text'], ['ink', 'canvas-soft', 4.5, 'body text on soft background'],
  ['ink-muted', 'canvas', 4.5, 'secondary text'], ['ink-muted', 'canvas-soft', 4.5, 'secondary text on soft background'],
  ['ink-muted', 'locked', 4.5, 'coming-soon banner'], ['ink', 'locked', 4.5, 'locked surfaces'],
  ['leaf-deep', 'leaf-tint', 4.5, 'correct feedback sheet'], ['coral-deep', 'coral-tint', 4.5, 'wrong feedback sheet'],
  ['sky-deep', 'sky-tint', 4.5, 'neutral feedback sheet and selected choice'], ['sun-ink', 'sun-tint', 4.5, 'celebration card'],
  ['ink-muted', 'sky-tint', 4.5, 'small note inside the neutral sheet'], ['sky-deep', 'canvas', 4.5, 'ghost buttons and links'],
  ['leaf-deep', 'canvas', 4.5, 'current-node bubble text'], ['sun-on', 'sun', 4.5, 'sun buttons, banners and trophy'],
  ['#FFFFFF', 'sky', 4.5, 'sky buttons and banners'], ['#FFFFFF', 'grape', 4.5, 'grape banners'],
  ['#FFFFFF', 'leaf', 3, '19px bold primary buttons and leaf banners only'], ['#FFFFFF', 'coral', 3, '19px bold danger button only'],
  ['locked-ink', 'locked', 3, 'locked node icons and disabled button labels'], ['grape-deep', 'canvas', 4.5, 'grape popover button text'],
  ['sun-on', 'canvas', 4.5, 'sun popover button text'], ['grape-deep', 'grape-tint', 4.5, 'grape tint cards'],
];
describe('learning design tokens', () => {
  it('defines every colour referenced by the contrast table', () => {
    for (const [text, background] of pairs) { expect(color(text), text).toMatch(/^#/); expect(color(background), background).toMatch(/^#/); }
  });
  it.each(pairs)('%s on %s meets %s:1 (%s)', (text, background, minimum) => {
    expect(contrast(text, background)).toBeGreaterThanOrEqual(minimum);
  });
  it('keeps SignLingo values distinct from Duolingo brand green', () => {
    expect(Object.values(tokens).map(v => v.toUpperCase())).not.toContain('#58CC02');
  });
});
