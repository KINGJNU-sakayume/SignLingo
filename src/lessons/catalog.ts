/** Educational metadata only. This repository does not ship validated KSL gesture assets. */
export type LessonDefinition = {
  id:string; title:string; description:string; unit:string; status:'needs-content'|'planned';
};
export const LESSONS:readonly LessonDefinition[]=[
  {id:'first-expression',title:'나의 첫 수어 표현',description:'검증된 동작 자료를 연결하여 3D 시범을 보고 직접 따라 해 봅니다.',unit:'첫걸음',status:'needs-content'},
  {id:'fingerspelling',title:'지문자 익히기',description:'한국수어 지문자를 단계별로 배우는 레슨을 준비하고 있습니다.',unit:'기초 학습',status:'planned'},
  {id:'everyday-expressions',title:'일상 표현',description:'상황별 표현과 복습을 다룰 예정입니다.',unit:'기초 학습',status:'planned'},
  {id:'sentences',title:'문장과 대화',description:'수어 문장과 비수지 신호를 함께 배우는 과정을 준비하고 있습니다.',unit:'확장 학습',status:'planned'},
];
export type LessonProgress={viewed:boolean;attempts:number;lastAttempt?:string;lastEvidence?:'sufficient'|'limited'};
export type ProgressRecord=Record<string,LessonProgress>;
export const PROGRESS_KEY='signlingo.lessons.progress.v1';
export function readProgress():ProgressRecord{
  try{
    const raw=window.localStorage.getItem(PROGRESS_KEY);if(!raw)return {};
    const data:unknown=JSON.parse(raw);if(!data||typeof data!=='object'||Array.isArray(data))return {};
    const record:ProgressRecord={};
    for(const [key,value] of Object.entries(data)){
      if(!value||typeof value!=='object'||Array.isArray(value))continue;
      const x=value as Record<string,unknown>;
      if(typeof x.viewed!=='boolean'||!Number.isInteger(x.attempts)||typeof x.attempts!=='number'||x.attempts<0||x.attempts>100000)continue;
      record[key]={viewed:x.viewed,attempts:x.attempts,...(typeof x.lastAttempt==='string'?{lastAttempt:x.lastAttempt}:{}),
        ...((x.lastEvidence==='sufficient'||x.lastEvidence==='limited')?{lastEvidence:x.lastEvidence}:{})};
    }
    return record;
  }catch{return {};}
}
export function saveProgress(data:ProgressRecord){try{window.localStorage.setItem(PROGRESS_KEY,JSON.stringify(data));}catch{/* Local storage may be unavailable. */}}
