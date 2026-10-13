import { useState } from 'react';
import { commonsFilePage, commonsImage, FINGERSPELLING_ITEMS, KSL_COMMONS_CATEGORY, KSL_COMMONS_LICENSE } from './fingerspelling';
import './fingerspelling.css';

const STORAGE_KEY='signlingo.fingerspelling.seen.v1';
function getSeen():string[]{
  try {
    const value=JSON.parse(localStorage.getItem(STORAGE_KEY)??'[]');
    return Array.isArray(value)?value.filter((x:unknown)=>typeof x==='string'&&FINGERSPELLING_ITEMS.some(item=>item.file===x)):[];
  } catch {return [];}
}
export function FingerspellingLesson() {
  const [selected,setSelected]=useState(0);
  const [filter,setFilter]=useState<'all'|'consonant'|'vowel'>('all');
  const [seen,setSeen]=useState<string[]>(getSeen);
  const [imageFailed,setImageFailed]=useState(false);
  const visible=FINGERSPELLING_ITEMS.filter(item=>filter==='all'||item.group===filter);
  const item=FINGERSPELLING_ITEMS[selected];
  const visited=seen.includes(item.file);
  function choose(index:number) {setSelected(index);setImageFailed(false);}
  function navigate(delta:number) {
    const position=visible.findIndex(i=>i.file===item.file);
    const next=visible[(position+delta+visible.length)%visible.length];
    choose(FINGERSPELLING_ITEMS.findIndex(i=>i.file===next.file));
  }
  function setGroup(group:typeof filter) {
    setFilter(group);
    const next=FINGERSPELLING_ITEMS.findIndex(i=>group==='all'||i.group===group);
    choose(next);
  }
  function toggleSeen() {
    const updated=visited?seen.filter(name=>name!==item.file):[...seen,item.file];
    setSeen(updated);
    try{localStorage.setItem(STORAGE_KEY,JSON.stringify(updated));}catch{/* Optional local-only progress */ }
  }
  return <section className="fingerspelling" aria-label="한글 지문자 사진 학습">
    <div className="fingerspelling-heading">
      <div><p className="lesson-meta">OPEN CONTENT / 한글 지문자</p><h2>손 모양을 한 글자씩 살펴보세요.</h2><p className="lesson-note">위키미디어 공용의 실제 한국수어 지문자 사진 32점. 영상 또는 자동 수어 채점 자료가 아닙니다. 정확한 손 방향과 동작은 별도의 수어 교육 자료로 함께 확인하세요.</p></div>
      <p className="fingerspelling-count"><strong>{seen.length}</strong> / {FINGERSPELLING_ITEMS.length}<span>사진 관찰 완료</span></p>
    </div>
    <div className="fingerspelling-filters" aria-label="지문자 종류">
      {([['all','전체'],['consonant','자음'],['vowel','모음']] as const).map(([key,label])=><button type="button" key={key} aria-pressed={filter===key} onClick={()=>setGroup(key)}>{label}</button>)}
    </div>
    <div className="fingerspelling-viewer">
      <figure className="fingerspelling-photo">
        {!imageFailed?<img key={item.file} src={commonsImage(item.file)} onError={()=>setImageFailed(true)} alt={'한국수어 지문자 '+item.letter+'의 손 모양 사진'} loading="eager" referrerPolicy="no-referrer"/>:
          <div className="fingerspelling-fallback" role="alert"><p>사진을 불러오지 못했습니다.</p><a href={commonsFilePage(item.file)} target="_blank" rel="noreferrer">원본 사진에서 보기 ↗</a></div>}
        <figcaption>사진: Kwamikagami · Wikimedia Commons · CC BY-SA 3.0 (원본 그대로 표시)</figcaption>
      </figure>
      <div className="fingerspelling-current">
        <span className="lesson-meta">{item.group==='consonant'?'자음':'모음'} · {selected+1} / {FINGERSPELLING_ITEMS.length}</span>
        <strong className="fingerspelling-letter">{item.letter}</strong>
        <p>정적인 손 모양 사진을 관찰한 뒤 직접 따라 해 보세요. 사진만으로 움직임·방향의 모든 정보를 전달할 수는 없습니다.</p>
        <div className="fingerspelling-controls">
          <button type="button" className="button secondary" onClick={()=>navigate(-1)}>← 이전</button>
          <button type="button" className="button secondary" onClick={()=>navigate(1)}>다음 →</button>
        </div>
        <button type="button" className="button primary" onClick={toggleSeen}>{visited?'관찰 기록 취소':'사진 관찰 완료'}</button>
        <p className="lesson-note">관찰 기록은 현재 브라우저에만 저장되며 수어 능력 평가가 아닙니다.</p>
        <p className="fingerspelling-attribution"><a href={commonsFilePage(item.file)} target="_blank" rel="noreferrer">사진 원본 · 개별 라이선스 정보 ↗</a><a href={KSL_COMMONS_LICENSE} target="_blank" rel="noreferrer">CC BY-SA 3.0 ↗</a></p>
      </div>
    </div>
    <div className="fingerspelling-grid" aria-label="지문자 사진 선택">
      {visible.map(candidate=>{
        const index=FINGERSPELLING_ITEMS.indexOf(candidate);
        return <button type="button" key={candidate.file} aria-label={'지문자 '+candidate.letter+' 선택'} aria-pressed={selected===index} onClick={()=>choose(index)}>
          <span>{candidate.letter}</span><small>{seen.includes(candidate.file)?'관찰함':'살펴보기'}</small>
        </button>;
      })}
    </div>
    <p className="lesson-note">자료 출처: <a href={KSL_COMMONS_CATEGORY} target="_blank" rel="noreferrer">Wikimedia Commons — Korean manual alphabet (32 files)</a>. 원본 파일은 수정하거나 저장소에 복제하지 않았습니다. 각 이미지의 원저작권·표시는 원본 파일 페이지에서 확인할 수 있습니다. 한국수어 단어/문장 학습 콘텐츠와는 별도입니다.</p>
  </section>;
}
