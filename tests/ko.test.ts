import { describe,it,expect } from 'vitest';
import { koMessage } from '../src/i18n/ko';

describe('koMessage',()=>{
  it('translates the stage and the lowercase detail of composed errors',()=>{
    expect(koMessage('Camera permission failure: camera permission was denied. Allow camera access in browser settings and retry.'))
      .toBe('카메라 권한 요청 실패: 카메라 권한이 거부되었습니다. 브라우저 설정에서 허용한 후 다시 시도해 주세요.');
    expect(koMessage('Video capture failure: camera interrupted or muted. Reconnect and retry.')).toContain('영상 녹화 실패: 카메라가 중단');
    expect(koMessage('Model initialization failure: model download failed')).toBe('모델 초기화 실패: 모델 다운로드에 실패했습니다.');
  });
  it('keeps an untranslatable detail instead of dropping it',()=>{
    expect(koMessage('Inference failure: Synthetic failure')).toBe('AI 추론 실패: Synthetic failure');
  });
  it('applies word-boundary replacements',()=>{
    expect(koMessage('left wrist missing')).toBe('왼손 손목 누락');
  });
  it('is stable when applied to already translated text',()=>{
    const once=koMessage('Video capture failure: no new camera frames for 2.5 seconds. Retry.');
    expect(koMessage(once)).toBe(once);
  });
});
