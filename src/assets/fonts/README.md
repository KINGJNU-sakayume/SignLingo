# Self-hosted learning fonts

Both families are licensed under the SIL Open Font License 1.1. The license texts are copied
next to the subsets. The OFL notice is also embedded in each source font's name table
(name ID 13), which was checked before subsetting. The subsets are Modified Versions under
the OFL, so they are renamed **SignLingo Display** (from Jua) and **SignLingo Body** (from
Pretendard, whose license reserves the name "Pretendard"). Copyright and license records in
each file are unchanged.

| Family | Use | Upstream source | Source SHA-256 |
| --- | --- | --- | --- |
| Jua (BM JUA, Woowahan Brothers) | Headings, buttons, numbers | `google/fonts` `ofl/jua/Jua-Regular.ttf` | `769677aef240bfc3b9965f2b50748075bff885e6c6992fc591a3fb268279f898` |
| Pretendard 1.3.9 Regular | Body text | npm `pretendard@1.3.9` `dist/web/static/woff2/Pretendard-Regular.woff2` | `fad853f7f47c6c8b103171e7193fa095708cdcd70850a71d93aa5379e8a61d63` |
| Pretendard 1.3.9 SemiBold | Emphasised body text | npm `pretendard@1.3.9` `dist/web/static/woff2/Pretendard-SemiBold.woff2` | `c863f76a7de5c1ddc1ed8b2fa794964530774592c4f31407a84e2a2ae93f17f0` |

Each `*-core.woff2` holds ASCII, punctuation and every Hangul syllable used by the app source
and published manifest. Each matching `*-ext.woff2` holds the rest of the KS X 1001 Hangul
syllables and is only downloaded when a page shows one of them (`unicode-range`). Regenerate
them with `scripts/fonts/subset.py` after changing learner-facing Korean text.

NanumSquareRound was the first choice in the design brief. It was not used because its
license could not be confirmed first-hand: the rights holder's license page was unreachable
from the build environment and the font's own metadata reads "All rights reserved" without
an OFL notice. Jua was the brief's stated alternative.
