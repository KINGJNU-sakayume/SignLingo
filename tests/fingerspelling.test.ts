import {describe,expect,it} from 'vitest';
import {commonsFilePage,commonsImage,FINGERSPELLING_ITEMS} from '../src/lessons/fingerspelling';
describe('attributed Korean fingerspelling source records',()=>{
  it('exposes 32 distinct, source-linked photos with no synthetic motion',()=>{
    expect(FINGERSPELLING_ITEMS).toHaveLength(32);
    expect(new Set(FINGERSPELLING_ITEMS.map(item=>item.file)).size).toBe(32);
    expect(new Set(FINGERSPELLING_ITEMS.map(item=>item.letter)).size).toBe(32);
    for(const item of FINGERSPELLING_ITEMS){
      expect(item.letter.length).toBe(1);
      expect(item.file).toMatch(/^[a-z]+$/);
      expect(commonsFilePage(item.file)).toMatch(/^https:\/\/commons.wikimedia.org\/wiki\/File:KSL_[a-z]+\.jpg$/);
      expect(commonsImage(item.file)).toMatch(/^https:\/\/commons.wikimedia.org\/wiki\/Special:FilePath\/KSL_[a-z]+\.jpg$/);
    }
  });
});