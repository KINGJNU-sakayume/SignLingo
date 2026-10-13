/** A directly linked, credited, static handshape collection.
 * Wikimedia Commons category contains 32 images by Kwamikagami (CC BY-SA 3.0).
 * These are photos, NOT motion clips, verified Korean Sign Language lessons,
 * or valid input to the MotionClip/Practice scorer.
 */
export type FingerspellingItem = { letter:string; file:string; group:'consonant'|'vowel' };
export const FINGERSPELLING_ITEMS:readonly FingerspellingItem[] = [
  {letter:'ㄱ',file:'g',group:'consonant'},
  {letter:'ㄴ',file:'n',group:'consonant'},
  {letter:'ㄷ',file:'d',group:'consonant'},
  {letter:'ㄹ',file:'r',group:'consonant'},
  {letter:'ㅁ',file:'m',group:'consonant'},
  {letter:'ㅂ',file:'b',group:'consonant'},
  {letter:'ㅅ',file:'s',group:'consonant'},
  {letter:'ㅆ',file:'ss',group:'consonant'},
  {letter:'ㅇ',file:'ng',group:'consonant'},
  {letter:'ㅈ',file:'j',group:'consonant'},
  {letter:'ㅊ',file:'ch',group:'consonant'},
  {letter:'ㅋ',file:'k',group:'consonant'},
  {letter:'ㅌ',file:'t',group:'consonant'},
  {letter:'ㅍ',file:'p',group:'consonant'},
  {letter:'ㅎ',file:'h',group:'consonant'},
  {letter:'ㅏ',file:'a',group:'vowel'},
  {letter:'ㅐ',file:'ae',group:'vowel'},
  {letter:'ㅑ',file:'ya',group:'vowel'},
  {letter:'ㅒ',file:'yae',group:'vowel'},
  {letter:'ㅓ',file:'eo',group:'vowel'},
  {letter:'ㅔ',file:'e',group:'vowel'},
  {letter:'ㅕ',file:'yeo',group:'vowel'},
  {letter:'ㅖ',file:'ye',group:'vowel'},
  {letter:'ㅗ',file:'o',group:'vowel'},
  {letter:'ㅛ',file:'yo',group:'vowel'},
  {letter:'ㅜ',file:'u',group:'vowel'},
  {letter:'ㅠ',file:'yu',group:'vowel'},
  {letter:'ㅡ',file:'eu',group:'vowel'},
  {letter:'ㅣ',file:'i',group:'vowel'},
  {letter:'ㅚ',file:'oe',group:'vowel'},
  {letter:'ㅟ',file:'wi',group:'vowel'},
  {letter:'ㅢ',file:'ui',group:'vowel'},
] as const;
export const commonsFilePage=(file:string)=>'https://commons.wikimedia.org/wiki/File:KSL_'+file+'.jpg';
export const commonsImage=(file:string)=>'https://commons.wikimedia.org/wiki/Special:FilePath/KSL_'+file+'.jpg';
export const KSL_COMMONS_CATEGORY='https://commons.wikimedia.org/wiki/Category:Korean_manual_alphabet';
export const KSL_COMMONS_LICENSE='https://creativecommons.org/licenses/by-sa/3.0/';
