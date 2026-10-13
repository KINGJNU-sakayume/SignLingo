import { describe, expect, it, vi, afterEach } from 'vitest';
import { LESSONS, PROGRESS_KEY, readProgress, saveProgress } from '../src/lessons/catalog';

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
});
