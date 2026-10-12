import { describe,expect,it } from 'vitest';
import { prefersMainThreadVision } from '../src/motion/detector';

describe('MediaPipe inference backend selection',()=>{
  it('uses a document-backed detector on iPhones',()=>{
    expect(prefersMainThreadVision('Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15','iPhone',5)).toBe(true);
  });
  it('uses a document-backed detector on iPads presenting a desktop user agent',()=>{
    expect(prefersMainThreadVision('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15','MacIntel',5)).toBe(true);
  });
  it('keeps desktop Safari and Chrome on the worker backend',()=>{
    expect(prefersMainThreadVision('Mozilla/5.0 (Macintosh; Intel Mac OS X 13_0) AppleWebKit/605.1.15','MacIntel',0)).toBe(false);
    expect(prefersMainThreadVision('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/125.0','Win32',0)).toBe(false);
  });
  it('does not infer iOS from a touch-enabled non-Apple device',()=>{
    expect(prefersMainThreadVision('Mozilla/5.0 (Linux; Android 14) Chrome/125.0','Linux armv8l',5)).toBe(false);
  });
});
