import { describe, expect, it, vi, afterEach } from 'vitest';
import { LESSONS, PROGRESS_KEY, readProgress, saveProgress, progressKey, recordPractice } from '../src/lessons/catalog';
import { approvedFixture } from './content-fixtures';

afterEach(()=>vi.unstubAllGlobals());
function storage(){
  const data=new Map<string,string>();
  vi.stubGlobal('window',{localStorage:{
    getItem:(key:string)=>data.get(key)??null,
    setItem:(key:string,value:string)=>{data.set(key,value);},
  }});
  return data;
}
describe('guided lesson progress',()=>{
  it('does not ship fictional KSL motion assets or mark unverified content as ready',()=>{
    expect(LESSONS[0].status).toBe('needs-content');
    expect(LESSONS.slice(1).every(x=>x.status==='planned')).toBe(true);
  });
  it('stores only observed learning activity and no raw motion or score',()=>{
    const data=storage();
    saveProgress({'first-expression':{viewed:true,attempts:2,lastEvidence:'limited'}});
    expect(JSON.parse(data.get(PROGRESS_KEY)!)).toEqual({'first-expression':{viewed:true,attempts:2,lastEvidence:'limited'}});
    expect(readProgress()['first-expression'].attempts).toBe(2);
  });
  it('rejects malformed or legacy progress safely',()=>{
    const data=storage();data.set(PROGRESS_KEY,'{broken');
    expect(readProgress()).toEqual({});
    data.set(PROGRESS_KEY,JSON.stringify({ok:{viewed:false,attempts:1},bad:{viewed:'no',attempts:-3}}));
    expect(readProgress()).toEqual({ok:{viewed:false,attempts:1}});
  });
  it('preserves legacy records and stores bounded feedback history separately for each content revision',async()=>{
    storage(); const {entry}=await approvedFixture();
    let progress={viewed:true,attempts:0};
    for(let i=0;i<25;i++)progress=recordPractice(progress,'limited',['손 추적 정보를 확인해 주세요.']);
    saveProgress({'first-expression':{viewed:true,attempts:2},[progressKey(entry)]:progress});
    const restored=readProgress(); expect(restored['first-expression'].attempts).toBe(2);
    expect(restored[progressKey(entry)].history).toHaveLength(20);
    expect(restored[progressKey(entry)].attempts).toBe(25);
    expect(restored[progressKey({...entry,revision:2})]).toBeUndefined();
  });
  it('continues working when browser storage is blocked',()=>{
    vi.stubGlobal('window',{localStorage:{getItem:()=>{throw new Error('blocked');},setItem:()=>{throw new Error('full');}}});
    expect(readProgress()).toEqual({});expect(()=>saveProgress({})).not.toThrow();
  });
});
