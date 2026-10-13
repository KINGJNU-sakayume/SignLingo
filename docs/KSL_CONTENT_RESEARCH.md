# KSL content research — Phase 5

Research date: 2026-10-13. This is a content acquisition record, not a legal opinion or linguistic certification. Main was checked through GitHub at `1b4e3878e17b5a4eb1922ad349767ee02c9de0c2` (Phase 4 / PR #7). No protected endpoint, account, dataset API, or media download was used.

## Official sources investigated

- [National Institute of Korean Language: Korean Sign Language Dictionary](https://sldict.korean.go.kr/front/main/main.do)
- [Dictionary copyright policy](https://sldict.korean.go.kr/front/main/copyRightPolicy.do)
- [Dictionary explanation of entries](https://sldict.korean.go.kr/front/help/popup/help3.do)
- [Dictionary popular everyday signs: exact observed page](https://sldict.korean.go.kr/front/sign/signViewMoreList.do)
- [Official pilot KSL–Korean / Korean–KSL dictionary](https://sldict.korean.go.kr/demondicKor/signKorSearch.do)
- [AI-Hub: requested dataset link](https://aihub.or.kr/aidata/7965), redirecting to [수어 영상, dataset 103](https://aihub.or.kr/aihubdata/data/view.do?currMenu=115&topMenu=100&aihubDataSe=data&dataSetSn=103)
- [AI-Hub usage policy](https://aihub.or.kr/intrcn/guid/usagepolicy.do), specifically the **AI 허브 개방 데이터** section. Conditions for other datasets further down the page are not assumed to govern dataset 103.

## Confirmed findings and limits

The dictionary distinguishes Korean equivalents from KSL information; an equivalent can contain several Korean words. Therefore display labels below are **Korean equivalents, not invented linguistic glosses**, and do not define a Korean-sentence-to-KSL translation. The official pilot dictionary illustrates multiple senses and distinct entries for similar Korean labels, particularly `없다`. No regional or grammatical variant was inferred from these lists.

Dictionary general material is subject to CC BY-NC-ND 2.0 KR unless separately stated. Attribution, noncommercial use and unchanged use are conditions. Its policy expressly separates video licensing; NIKL does not own some everyday/specialist sign videos. **The site-wide notice is not permission to download, redistribute or transform a particular video.** The five selected everyday-entry pages individually show attribution/noncommercial/no-derivatives conditions. Their transformation and derived-motion publication decisions are therefore `denied` under the observed terms, pending separate permission. Generating and distributing a reconstructed animation has not been cleared. Obtain video-specific permission and explicit derivative-animation permission from the actual rights holder. Linking to an official page does not grant embedding or rehosting rights.

AI-Hub describes 536,000 clips spanning 3,000 words, 2,000 sentences and 1,000 fingerspelling/numeral items, with multi-view video and keypoint/annotation data. The dataset page requires approval before API download and states eligibility restrictions. Its public sample annotation includes `화장실` and `있다`; these are research observations, not acquired lessons. The platform's general policy allows commercial/noncommercial AI research/development subject to conditions, limits AI data to model training, requires NIA attribution including derivatives, prohibits provision/viewing by unapproved third parties, and requires separate agreement for overseas use/export. It does **not** establish permission for public GitHub/Pages teaching videos or downloadable motion libraries. Attribution alone is insufficient.

No authenticated download approval, general lesson integration API entitlement, media-specific license grant, or permission for 3D teaching derivatives was obtained. A public repository and GitHub Pages distribute files to third parties, so training permission must not be substituted for redistribution permission. GitHub hosting location and worldwide access must be covered where applicable. No third-party video URL, thumbnail, video embed or extracted pose data is shipped.

## Ten initial vocabulary candidates

`src/content/catalog.json` records each exact detail-page URL, observed ID and textual locator. After the browser tool exposed only list text, a normal public HTML inspection of the two source lists revealed their detail-navigation parameters. Ten public detail pages were then requested without authentication; all returned HTTP 200 with the expected expression on 2026-10-13. No multimedia URL was fetched. Everyday entries use `origin_no`; pilot entries use `sign_seq`. These database IDs identify source records, not linguistic glosses or verified regional variants.

| Stable internal ID | Korean display label | Proposed placement | Exact source / entry locator |
| --- | --- | --- | --- |
| ksl-thanks | 고맙다, 감사 | First meeting / courtesy | [개별 항목: origin_no:11920](https://sldict.korean.go.kr/front/sign/signContentsMoreView.do?origin_no=11920&top_category=CTE) — 고맙다,감사 |
| ksl-sorry | 미안 | Courtesy | [개별 항목: origin_no:10985](https://sldict.korean.go.kr/front/sign/signContentsMoreView.do?origin_no=10985&top_category=CTE) — 미안 |
| ksl-meet | 만나다, 직면 | First meeting | [개별 항목: origin_no:12165](https://sldict.korean.go.kr/front/sign/signContentsMoreView.do?origin_no=12165&top_category=CTE) — 만나다,직면 |
| ksl-okay | 괜찮다, 무방하다 | Everyday responses | [개별 항목: origin_no:9466](https://sldict.korean.go.kr/front/sign/signContentsMoreView.do?origin_no=9466&top_category=CTE) — 괜찮다,무방하다 |
| ksl-no | 아니다, 아니, 부인(하다) | Everyday responses | [개별 항목: origin_no:11433](https://sldict.korean.go.kr/front/sign/signContentsMoreView.do?origin_no=11433&top_category=CTE) — 아니다,아니,부인(하다) |
| ksl-like | 마음에 들다 | Preferences | [개별 항목: pilot-sign_seq:4](https://sldict.korean.go.kr/demondicKor/signKorDetail.do?sign_seq=4&search_translation=99&search_sign_seq=0) — 마음에 들다 |
| ksl-absent | 없다 | Everyday responses | [개별 항목: pilot-sign_seq:8](https://sldict.korean.go.kr/demondicKor/signKorDetail.do?sign_seq=8&search_translation=99&search_sign_seq=0) — 없다 , (물건이나 돈이) 없다 , 없다 , (자신감이) 없다 |
| ksl-what | 무엇, 무슨 | Questions | [개별 항목: pilot-sign_seq:5](https://sldict.korean.go.kr/demondicKor/signKorDetail.do?sign_seq=5&search_translation=99&search_sign_seq=0) — 무엇, 무슨, 어디, 어떻게, 어떤, 어떠하다 |
| ksl-ask | 묻다, 질문하다 | Questions | [개별 항목: pilot-sign_seq:7](https://sldict.korean.go.kr/demondicKor/signKorDetail.do?sign_seq=7&search_translation=99&search_sign_seq=0) — 묻다, 질문하다, 질문을 받다 |
| ksl-help | 돕다, 도와주다 | Everyday help | [개별 항목: pilot-sign_seq:18](https://sldict.korean.go.kr/demondicKor/signKorDetail.do?sign_seq=18&search_translation=99&search_sign_seq=0) — 돕다, 도와주다, 지원(하다), 도움을 받다 |

The catalog's short `meaning` fields summarize the Korean equivalents and, where present, detail-page definitions for acquisition planning. For example, the pilot distinguishes material support from helping with work, and separates several absence senses. They are not copied gesture instructions or verified teaching definitions. Hands, directionality, facial expression, grammar, usage, sense boundaries and teaching descriptions must be reviewed from the selected full entry and authorized video before release. Source entry IDs are confirmed; `gloss` and the selected variant ID remain deliberately unresolved. Listed video availability is not confirmation that a usable downloadable file exists.

## Curriculum design (provisional)

1. First meeting and courtesy: prioritize **one** short `고맙다` variant if an educator confirms it is visually distinguishable and suitable for the existing upper-body camera system; then add `미안` and a reviewed sense of `만나다`. Do not label any movement simple without inspecting it.
2. Everyday responses and preferences: `괜찮다`, `아니다`, `마음에 들다`, then a carefully selected `없다` entry. First recognize a demonstration, then repeat it, then revisit the observed differences.
3. Questions and help: `무엇`, `묻다`, `돕다`, with attention to direction, roles and nonmanual signals. Do not synthesize questions by concatenating Korean words.
4. Self-introduction and Korean fingerspelling remain upcoming categories without expression mappings. The AI-Hub inventory confirms relevant data exists, but does not identify/authorize particular lessons. Obtain exact entries and expert-designed progression first.

This order is a proposed educational structure, not a validated syllabus. A Deaf KSL educator should decide whether the first lesson or order needs changing.

## Acquisition and publication inventory

| Item | Actually obtained | Legally cleared for this app | Published |
| --- | --- | --- | --- |
| Source/policy observations and short metadata | Yes | Original research metadata only; no media grant implied | Research report and candidate metadata in source |
| Dictionary videos/images | No | No | No |
| AI-Hub dataset or sample media | No | No access approval / redistribution permission | No |
| Real derived MotionClips | No | No | No |
| Expert linguistic or reconstruction reviews | No | No | No |
| Synthetic automated-test geometry | Existing/generated test fixtures only | For software tests, not KSL education | Never in `public/` or learner catalog |

**Published expressions: zero.** The production manifest has no expressions; upcoming courses cannot start. No asset was marked source-approved, linguistically verified, or ready to publish. The browser can reference the official dictionary homepage without claiming an interactive lesson is available.

## Remaining blockers and practical owner steps

1. Ask NIKL/the identified video owner to confirm the selected sense/variant for the documented entry, obtain the original video, attribution wording, and written permission for local processing, 3D derivatives, editing/correction, video display, motion redistribution, public GitHub and worldwide static hosting. Ask whether noncommercial/no-derivatives limitations can be separately waived for these uses.
2. For AI-Hub, follow the normal eligibility/application process and use its approved API/Shell method only after approval. Separately ask the performing institutions/NIA about educational playback, downloadable derived keypoints/motion and overseas hosting. The dataset page lists Testworks as the contact. No inquiry was sent during this task.
3. Alternatively commission a short original recording from a consenting Deaf KSL educator, with performer and producer releases covering those uses. This is a practical acquisition option, not an asset already obtained.
4. Have a qualified KSL reviewer identify the actual entry and variant and review the video **and rendered avatar**, handshape, palm orientation, movement, contact, timing, facial expression, body posture, grammar, description and practice suitability. Existing reconstruction does not estimate facial language; exclude expressions whose essential cues cannot be represented adequately.
5. Follow [CONTENT_PUBLISHING.md](CONTENT_PUBLISHING.md). Preserve private consent originals outside the repository; commit only authorized redacted evidence records. Reprocess or correct the Motion Lab export, independently review reconstruction, then conduct linguistic review. Both approvals bind the exact package digest.
6. Publish one validated expression first, run the static build/browser checks, and review the PR's content files and evidence. Expand only when further expressions meet the same standard.
