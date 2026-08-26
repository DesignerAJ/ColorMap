# dev-GUHNZ-2 (ColorMap v3.1.0) 작업 기록

이 문서는 `dev-GUHNZ-2` 브랜치를 `main`에 **Squash and Merge**한 뒤에도 이번 작업의
배경, 구현 범위, 원래 커밋 흐름을 AI와 협업 개발자가 추적할 수 있도록 남기는 인수인계 기록이다.
PR 검토용 요약은 [`PR-v3.1.0.md`](./PR-v3.1.0.md), 항상 유효해야 하는 저장소 작업 규칙과 함정은
[`../CLAUDE.md`](../CLAUDE.md)를 우선 참고한다. 이 문서는 두 문서를 대체하지 않고, 이번 브랜치에서
무엇을 왜 바꿨는지를 릴리스 단위로 고정해 둔다.

> 기록 기준: 2026-08-26, 문서 작성 직전 `HEAD` `ec0bf02`
>
> 비교 기준: `main`/`origin/main` `cd6083e` → `dev-GUHNZ-2` `ec0bf02`
>
> 범위: 61개 커밋, 266개 파일, 6,314줄 추가 / 437줄 삭제
>
> 위 수치는 마지막 커밋 `ec0bf02`까지의 값이다. 2.5절의 머지 직전 정리와 이 문서 자체는
> 아직 커밋하지 않았으므로 위 수치와 원 커밋 목록에 포함하지 않았다.

-----

## 1. 먼저 알아둘 결론

- 요청서 [`colormap-recorder-requests.md`](./colormap-recorder-requests.md)의 P0 5건과 P1 4건을 반영했다.
- P2-10 다중 핀은 기존 `위치 핀` 기능에서 여러 개 추가·라벨·개별 삭제가 이미 가능함을 확인했다.
  이번 브랜치에서는 핀 세트의 `localStorage` 저장/불러오기와 전체 핀 화면 맞춤은 구현하지 않았다.
- 남·북한 국가 색칠, 시·도/도 색칠, 경계선, PSD/SVG 내보내기의 레이어 불일치를 정리했다.
- 아크 경로는 카메라·경로선·타일 프리로드가 같은 경로를 사용한다. 직선 경로를 추가했고,
  직선용 줌아웃 궤적을 별도로 구현했다. 도로 경로만 기존처럼 카메라가 최단 경로로 이동한다.
- 전 세계 행정구역 데이터를 초기 일괄 로드에서 국가별 지연 로드로 바꾸고, 정밀도·출처·영해
  문제를 함께 정비했다. 파생 JSON은 손으로 고치지 말고 생성 도구를 수정해 다시 만들어야 한다.
- 스타일의 지명을 켜고 끄는 체크박스와 `핀·경로 설정`만 초기화하는 버튼을 추가했다.
- 브랜치 작업 기록상 자동화 테스트는 173개까지 통과했다. 문서 작성 시 Windows에서 다시 돌린
  결과와 로컬 환경 제약은 6절에 별도로 적었다. WebGL 렌더 결과는 자동 검사하지 못하므로
  머지 전 브라우저 수동 확인도 필요하다.

-----

## 2. 기능별 작업 내용

### 2.1 색칠·경계선·내보내기

#### 남·북한 전용 국가 색칠 레이어

남·북한은 Mapbox 국가 폴리곤 대신 우리 데이터인 `korea-countries.json`을 사용한다. 이 예외
레이어가 일반 국가 레이어와 다른 시점에 추가되면서 다음 문제가 함께 생겼다.

- 대한민국 국가 색칠이 시·도 색칠 위에 올라와 시·도 색이 보이지 않았다.
- PSD와 SVG 내보내기가 남·북한 전용 레이어를 순회하지 않아 남·북한 색칠이 빠졌다.
- PSD의 배경지도 레이어에는 반대로 남·북한 색칠이 구워져, 개별 색칠 레이어를 꺼도 색이 남았다.

`PAINTERS`에서 모드별 실제 레이어를 공통으로 구하도록 정리해 화면, PSD, SVG가 같은 레이어
구성을 사용하게 했다. 남·북한 국가 색칠은 일반 국가 색칠과 같은 높이, 시·도·시군구 아래에 놓인다.

#### 경계선 컨트롤

스타일마다 같은 의미의 레이어 id가 다르다. 예를 들어 국경선은 `country_border`,
`country-border`, `admin-0-boundary-bg`처럼 이름이 달라서 id 목록으로 관리하면 반드시 새는
레이어가 생긴다. 이번에는 레이어의 `source`와 `filter`를 읽어 국경선·분쟁선·행정구역선을
분류하도록 바꿨다.

중요한 예외는 다음과 같다.

- 스타일 제작자가 `visibility: none`으로 둔 레이어는 건드리지 않는다. 이를 켜면 위성사진의
  바다가 뿌옇게 되거나, Mapbox의 KP-KR 선이 우리 선과 다시 겹친다.
- 표시 체크박스는 `visibility` 대신 불투명도를 조절한다. 그래야 원래 숨겨진 레이어와 사용자가
  잠시 끈 레이어가 섞이지 않는다.
- 점선일 때는 `line-cap: butt`, 실선일 때는 `round`를 쓴다. 둥근 캡이 점선 사이의 빈칸을
  메워 남·북한 선만 실선처럼 보이던 것이 원인이었다. 지오메트리 정밀도 문제는 아니었다.
- 색칠 레이어를 올린 뒤 경계선을 다시 위로 올릴 때도 이름이 아니라 소스로 찾는다.

#### 색칠 다각형 렌더링

북한·함경남도에서 길게 뻗던 도형은 한 가지 문제가 아니었다.

- OSM 링의 감김 방향을 그대로 내보내 165개 링 중 164개가 본토의 구멍으로 해석되던 문제를
  `tools/lib/rings.mjs`의 `buildPolygons`로 통일했다.
- 국가 색칠 생성 중 핀치에서 갈라진 조각까지 감김 방향을 다시 맞추고, 좌표 정밀도보다 작은
  0.48m² 조각은 제거했다.
- `tolerance: 0`은 정밀도를 보존하는 값이 아니라 단순화를 끄는 값이다. 타일 좌표 반올림 격자보다
  촘촘한 점이 같은 칸에 겹쳐 삼각분할이 깨졌다. 모든 지리 소스에 `GEO_TOLERANCE = 0.125`를
  동일하게 적용했다. 선과 색칠은 같은 값을 써야 서로 어긋나지 않는다.
- `korea-countries.json`과 국가별 `admin1/*.json`까지 핀치·자기교차·감김 방향 검사를 넓혔다.

SVG만 정상이고 화면·MP4·PSD에서만 도형이 뻗으면 데이터보다 캔버스 삼각분할을 먼저 의심한다.
상세한 원인 분류와 진단 순서는 `CLAUDE.md`의 "이 코드베이스의 함정"에 있다.

### 2.2 행정구역 데이터 파이프라인

#### 로딩 구조

기존에는 전 세계 1급 행정구역을 `admin1.json` 한 파일로 10.7MB 전송했다. 현재는 다음처럼
나뉜다.

| 파일 | 역할 |
|---|---|
| `recorder/js/data/admin1.json` | 생성 도구의 원본 입력. 런타임 일괄 로드용이 아님 |
| `recorder/js/data/admin1-meta.json` | 전체 구역의 이름·검색·카메라 속성 |
| `recorder/js/data/admin1-core.json` | 자주 쓰는 8개국의 지오메트리 |
| `recorder/js/data/admin1/<ISO3>.json` | 나머지 227개국의 국가별 지오메트리 |
| `recorder/js/data/admin1-sources.json` | 국가별 실제 출처·라이선스·정밀도 메타데이터 |

첫 로드는 약 10.7MB에서 7.3MB로 줄었다. 국가별 파일은 선택할 때 한 번 받아 보관하며,
227개국 전체가 이전 단일 파일보다 작아서 LRU 제거는 넣지 않았다. 이미 칠한 지역을 메모리에서
쫓아내면 화면에서도 사라지는 문제를 별도로 해결해야 하기 때문이다.

#### 정밀도와 출처

- 한국·북한·일본·중국·미국·러시아·우크라이나·대만 8개국은 기존 원본을 유지한다.
- 나머지는 Natural Earth 10m과 비교해 국가별로 더 정밀한 쪽을 선택한다.
- 주요 66개국은 geoBoundaries의 국가기관 자료를 검토하고, 실제로 더 정밀하며 행정 층과
  구역 대응이 맞는 경우만 사용한다.
- 이미지 결과물의 출처 표기 수를 줄이기 위해 가능한 39개국은 OpenStreetMap으로 바꿨다.
  바탕 지도도 OSM 기반이므로 추가 표기 의무가 늘지 않는다.
- 프랑스·이탈리아·스페인은 기존 2급 구역 대신 실제 탭 의미에 맞는 1급 구역 18·20·19개로
  교체했다. 구역 목록 자체가 바뀌므로 반드시 원본 `admin1.json`에서 처리한다.
- ISO3166-2 접두사는 ISO3의 앞 두 글자가 아니라 ISO2다. OSM 국가 관계에서 ISO2↔ISO3를
  받아야 하며, 임의 절단하면 AUT→AU처럼 다른 나라를 가져오게 된다.

#### 영해 제거와 링 복구

일부 OSM 행정경계는 영해를 포함한다. 브라질 리우데자네이루는 구역 넓이의 30.8%가 바다였다.
Natural Earth 10m 육지와 겹치는 부분만 남기되 다음 안전장치를 둔다.

- 1% 미만 감소는 해안선 해상도 차이로 보고 자르지 않는다.
- 강 하구처럼 서로 다른 육지 고리에 걸린 구간은 직선으로 닫지 않고 원래 경계를 유지한다.
- Natural Earth에 없는 작은 섬은 삭제하지 않는다.
- 기존 폴리곤과 구멍의 소속 구조를 유지하고 바깥 링만 자른다.
- 자른 뒤에는 바깥 링과 구멍 모두 `tools/lib/clean.mjs`의 `cleanRing`으로 복구한다.
- 국가별 파일 전체에 대해 핀치·자기교차가 0인지 검사한다.

#### 재생성 순서

파생 파일은 손으로 수정하지 않는다. 작업 목적에 따라 앞 단계를 생략할 수 있지만, 전체 재생성은
아래 순서를 지킨다.

```bash
# 원본 구역 목록/카메라 목표를 바꿀 때만 먼저 실행
node recorder/tools/build-admin1-firstlevel.mjs
node recorder/tools/build-admin1-camera.mjs

# 국가별 파생 파일 생성 및 단계별 덮어쓰기
node recorder/tools/build-admin1-split.mjs
node recorder/tools/build-admin1-hires.mjs
node recorder/tools/build-admin1-osm.mjs
node recorder/tools/build-admin1-clip.mjs

# 필수 검증
node --test test/data.test.js
```

`build-admin1-hires.mjs`는 연달아 두 번 실행하지 않는다. 자기 출력을 다시 입력으로 읽어 두 번째
실행에서 모두 "이미 더 정밀함"으로 건너뛴다. 다시 실행하려면 `build-admin1-split.mjs`부터 시작한다.
`recorder/tools/.cache/`에는 100MB를 넘는 원본도 생기므로 절대 커밋하지 않는다.

### 2.3 카메라·경로선·녹화

#### 지역 선택 카메라

알래스카처럼 날짜변경선을 넘는 지역은 경도 최소·최대의 단순 평균이 아프리카 쪽을 가리켰다.
경도를 연속 좌표계로 편 뒤 계산하고, 본토가 전체 면적의 절반을 넘으면 본토 폴리곤만 사용한다.
기존 목표가 실제 구역 밖을 가리키는 항목만 다시 써 불필요한 구도 변화를 막았다.

#### 경로를 따르는 카메라

- 아크: 선, 카메라, 프리로드가 같은 원본 경로를 따른다.
- 직선: 다시 추가했으며 아크와 마찬가지로 카메라가 선 위를 이동한다.
- 도로 경로: 급격한 방향 변화로 화면이 흔들리지 않도록 카메라는 기존 최단 경로를 유지한다.
- `trimArcEnd`는 도착 핀 앞에서 선만 멈추기 위한 처리다. 카메라와 프리로드는 자르기 전 원본
  경로를 따라 도착 지점까지 가야 마지막 프레임에서 점프하지 않는다.
- 경로를 따를 때 선의 성장률도 카메라가 경로상 이동한 거리와 맞춘다. 이전에는 서울→런던에서
  화살표와 카메라가 최대 2,598km 벌어졌다.

#### 줌 궤적

- 비행의 `이동 중 줌아웃`은 고정 목표 줌 대신 곡률을 조절해 거리가 멀수록 더 깊어지고,
  `자동 < 조금 < 보통 < 많이` 순서를 유지한다.
- 부드럽게 녹화는 `flyTo`가 아니라 프레임별 `jumpTo`를 쓰므로 Mapbox 비행 곡선을 직접 재현했다.
- 직선 이동에는 비행 곡선을 재사용하지 않는다. 거리별 폭, 비대칭 평저 종 모양, `2^-zoom`
  비례 진행도를 조합한 전용 궤적을 쓴다. 더 완만하게 하려면 `줌 시간(초)`을 늘려야 한다.
- 정수 줌 경계에서 부동소수점 오차로 타일 레벨이 왕복하지 않도록 녹화용 카메라를 경계에서
  0.01만큼 떼며, 출발·도착·경유지·정지 프레임·프리로드 전체에 같은 보정값을 사용한다.

핵심 수학과 회귀값은 `test/camera.test.js`에 있다. 카메라 코드를 바꿀 때 결과 좌표만 확인하지
말고 비행 곡선, 선 성장률, 정수 줌 경계, 프리로드 경로를 함께 확인한다.

### 2.4 검색·스타일·패널 UI

#### 검색

- 시·도 자동완성은 기본적으로 약칭 17개만 보여준다.
- `충청북도` 같은 풀네임 입력도 계속 찾을 수 있으며, 풀네임에만 걸리는 검색어일 때 필요한
  후보를 동적으로 추가한다.
- 한글 검색은 VWorld `district`로 국내 행정지명인지 먼저 판별한다. 국내 지명이 아니면
  Mapbox → Google로 넘기고, 국내 상호 검색은 마지막에 둔다. `파리`, `런던`, `도쿄`, `베를린`
  검색에서 국내 상호가 먼저 나오던 문제를 막았다.
- VWorld `district`와 `address` 요청에는 `category`가 필수다. 누락 시 `PARAM_REQUIRED`인데
  과거에는 인증키 오류로 잘못 기록됐다.

#### 스타일 지명 표시 체크박스

별도 무라벨 스타일을 추가하는 대신 현재 스타일의 지명을 켜고 끄는 체크박스를 넣었다.

- 스타일이 처음 올라올 때는 레이어를 바꾸지 않고 현재 상태만 체크박스에 반영한다.
- 사용자가 체크박스를 만졌을 때만 글자를 모두 켜거나 끈다.
- 한 번 선택한 값은 스타일을 바꿔도 유지한다.
- 줌 14 이상에서만 보이는 건물 번호·출입구 레이어는 초기 체크 상태의 근거로 삼지 않는다.
- 경로 화살표와 캡처용 핀도 symbol 레이어이므로 글자 토글 대상에서 제외한다.
- `language=ko`는 `name`을 한국어로 채우는 대신 `name_ko` 등 `name_xx` 필드를 타일에서 제거한다.
  `name_ko`를 참조하는 레이어만 `name`을 보도록 바꾸고, 글자를 끄면 원래 식으로 복원한다.

기존 `지명 참고용` 스타일 이름은 역할에 맞게 `일반지도`로 바꿨다.

#### 핀·경로 설정 초기화

`핀·경로 설정` 제목 줄 오른쪽에 해당 섹션만 부팅 직후 값으로 되돌리는 반시계 화살표 버튼을 추가했다.
출발·도착·경유지·위치 핀, 경로선과 직접 그린 선, 핀 스타일과 해당 섹션의 입력값을 초기화한다.
국가/행정구역 색칠과 별도 녹화 설정은 건드리지 않는다.

구현 시 기본값을 JavaScript에 중복 작성하지 않고 부팅 직후 DOM 값을 스냅샷한다. 복원 후 기존
`input`·`change` 이벤트를 발생시켜 미리보기와 파생 표시도 같은 핸들러로 갱신한다. 지도 마커는
입력값보다 먼저 제거한다. 버튼은 `summary` 안에 있으므로 클릭 시 섹션이 접히지 않도록 감싼
요소에서 기본 동작을 막는다.

### 2.5 머지 직전 UI·문서 정리 (미커밋)

`ec0bf02` 이후 작업 복사본에서 아래 내용을 정리했다. 이 절은 Squash and Merge 전 마지막 작업
상태를 기록한 것이며, 사용자 지시에 따라 아직 커밋하지 않았다.

- 제품 버전 표기를 `v3.1.0`으로 확정하고 `README.md`, `CLAUDE.md`, `AGENTS.md`, PR 문서와
  이 기록에 반영했다. `?v=3.7.22`는 릴리스 버전이 아닌 캐시 무효화 키로 구분했다.
- 지도 디자인 카드를 `타입·투영 → 육지색·바다색·강·호수·지명 표시` 순으로 재배치했다.
  `지명 표시 (체크용)`은 두 줄 중앙 정렬로 강·호수 오른쪽에 두고 불필요한 구분선을 없앴다.
- 상단 `colormap-panel-title`과 전용 CSS를 제거하고, 패널 최하단에
  `© 2026 ColorMap Project by KBS 보도그래픽부` 문구를 작은 회청색으로 추가했다.
- 저장·초기화 등의 토스트를 화면 중앙에서 하단 중앙으로 옮기고, 아래에서 살짝 올라오는
  디졸브 동작으로 맞췄다.
- 메뉴·핀·내보내기 용어를 `핀·경로 설정`, `개별 핀`, `핀 라벨 크기`, `녹화 세부 설정`,
  `경로 영상`으로 정리했다. 체크박스 간격과 지역 탭 글자 크기도 조정했다.
- 행정구역선 기본값을 흰색·투명도 0.5로 조정하고, 저장·내보내기 영역의 불필요한 하단선을
  제거했다.
- 요청서를 루트에서 `docs/colormap-recorder-requests.md`로 옮기고, 검토 기록을
  `TO_GUHNZ_20260817.md`와 `TO_GUHNZ_20260826.md`로 날짜별 보존했다. 파일 내용이 같은 이동은
  내용 변경 없이 경로만 바뀌었다.
- Windows CRLF에서도 DOM 잠금 목록 검사가 동작하도록 정규식을 보완하고, 새 지도 디자인 구조와
  패널 footer를 확인하는 회귀 검사를 갱신했다.

-----

## 3. 주요 파일과 책임

| 경로 | 이번 변경에서의 역할 |
|---|---|
| `recorder/js/recorder.js` | 색칠/경계선, 검색, 카메라 궤적, 녹화, 지명 토글, 초기화의 주 구현 |
| `recorder/panel.html` | 직선 경로, 지명 체크박스, 초기화 버튼, 최종 패널 구조와 용어 |
| `recorder/css/app.css` | 지명/초기화 컨트롤과 지도 디자인 카드 배치 |
| `data/style.css` | 통합 패널 외형, 하단 토스트, footer와 확대·축소 바 |
| `README.md` | 현재 릴리스와 `vMajor.Minor.Patch` 버전 정책 |
| `docs/PR-v3.1.0.md` | Squash and Merge용 PR 요약 |
| `recorder/js/config.js` | `일반지도` 명칭과 검색 키 설정 |
| `recorder/js/data/admin1*.json` | 원본·코어·메타·출처 및 국가별 행정구역 생성물 |
| `recorder/tools/build-admin1-*.mjs` | 행정 층, 카메라, 분할, 고정밀화, OSM 전환, 육지 클리핑 파이프라인 |
| `recorder/tools/lib/rings.mjs` | 링 분류, 중첩 깊이, 감김 방향, 맞닿은 구멍 처리 |
| `recorder/tools/lib/clean.mjs` | 핀치와 자기교차 복구 |
| `recorder/tools/lib/land.mjs` | 육지 판정과 해안선 연결 |
| `recorder/tools/lib/sources.mjs` | `admin1-sources.json` 출처 메타데이터 갱신 |
| `test/camera.test.js` | 비행/직선 궤적과 녹화 카메라 연결 회귀 검사 |
| `test/data.test.js` | 데이터 분할, 정밀도, 링 위상, 선·색칠 일치 검사 |
| `test/dom/*.test.js` | 레이어 순서·내보내기·검색·글자·초기화 UI 회귀 검사 |

정적 배포라 빌드 단계가 없다. `index.html` 7곳과 `data/script.js`의 `PANEL_URL` 1곳,
총 8개의 `?v=` 값을 항상 같이 바꾼다. 이 기록 시점 값은 `3.7.22`다. 이는 브라우저 캐시를
끊는 내부 키이며 제품 릴리스 `v3.1.0`과는 별개다.

-----

## 4. 구현 중 확인된 잘못된 추정

향후 비슷한 증상을 만났을 때 같은 방향을 반복해서 파지 않도록 남긴다.

| 증상 | 처음 추정 | 실제 원인 |
|---|---|---|
| 한국·북한 점선이 실선처럼 보임 | 고정밀 지오메트리 때문에 점선이 뭉침 | 둥근 `line-cap`이 점선 간격을 메움 |
| 줌아웃 `많이`가 반응하지 않음 | `minZoom`이 무시됨 | 부드럽게 녹화 경로가 비행 곡선을 쓰지 않았고, 장거리에서는 고정 단계가 `자동`보다 얕았음 |
| 북한 재생성 실패 | 사내망/Overpass 혼잡 | User-Agent 없는 요청에 대한 406을 혼잡으로 잘못 기록 |
| 함경남도 긴 도형 | 원본 폴리곤 오류 | 링 감김 방향과 `tolerance: 0`에 따른 타일 삼각분할 문제 |
| 이동 중 지도 디테일 변화 | 프리로드 표본 부족 | 정수 줌 경계의 부동소수점 왕복과 일부 경로의 실제 프리로드 불일치 |
| 한국어 해외 도시가 국내 상호로 검색 | 검색 공급자 품질 문제 | 국내 전용 VWorld를 첫 성공 즉시 확정하던 검색 순서 |
| 방송용 스타일에서 글자가 안 켜짐 | 라벨 레이어가 없음 | `language=ko`가 `name_ko` 필드를 제거하고, 스타일은 그 필드를 직접 참조 |
| 브라질 바다가 칠해짐 | 나라 전체 넓이 비교로 검출 가능 | 국가 합계에서는 차이가 작고 구역별 OSM 영해 경계에서 크게 발생 |

-----

## 5. 원 커밋 색인

Squash 병합 후 `main`에는 아래 커밋이 개별 기록으로 남지 않는다. 상세한 시행착오와 수치는 각
커밋 본문에 있으므로, 브랜치나 보존 태그가 남아 있을 때 `git show <hash>`로 확인한다.

### 2026-08-24

- `7f4fd66` Point the camera at Alaska instead of the Gulf of Guinea
- `c0923c4` Put the two Koreas' country fill under the province fills
- `3d7a6ca` Include the two Koreas when exporting fills to PSD and SVG
- `011d9b9` Keep the two Koreas out of the PSD base-map layer
- `4f8695a` Keep the real boundary where the coastline cannot be joined
- `2d99cf7` 북한 색칠에 뻗던 긴 다각형: 링 감김 방향을 바로잡는다

### 2026-08-25

- `dfd0432` Tell Overpass who is calling, and stop reading 406 as congestion
- `5f450e7` Wind every ring in the country fill, including the pinch offcuts
- `05a7cbf` Record why Overpass was unreachable, and that the data is rebuilt
- `15c9822` Find boundary layers by what they filter on, not by name
- `956a528` Square off the line ends when the border is dashed
- `e66ceb5` Scale the mid-flight zoom-out with distance instead of pinning it
- `da9209c` Bump the cache-busting version to 3.2.30
- `e86e1fe` Leave the layers the designer switched off alone
- `afb4aed` Fly the same curve when recording frame by frame
- `96fed78` Check the country fill for self-intersections too
- `7ff456d` Simplify the GeoJSON again — tolerance 0 was switching it off
- `5135126` Fetch admin regions one country at a time, and sharpen the coarse ones
- `fb8a258` Take the European regions to their national mapping agencies
- `5047009` Widen the national-agency swap to 66 countries, and stop it going backwards
- `e6a9f6d` Move the regions to OpenStreetMap where the credit was a separate one
- `29643f0` Cut the regions back to land, so the sea stops getting painted
- `50af135` Keep the islands when cutting the sea away
- `fa7d23d` Repair the rings after cutting, and check the files nobody was checking
- `a7711ce` Write down what Maranhão is not
- `9c410d9` Send the camera along the arc it drew, and add a straight route
- `cb29e68` Drop the straight route, and preload the path the camera actually takes
- `8f437cb` Hold the detail layers open through the zoom-out, and land where the line ends
- `4b7d95c` Start just below the tile boundary so the first moving frame matches the still
- `abf647d` Keep the camera off exact integer zooms

### 2026-08-26

- `63ed948` Use the adjusted camera everywhere the recording touches it, not just at the start
- `852e0de` Show each 시도 once, and let the full name still find it
- `829becb` Leave the full name off the 시도 list
- `37dfb0f` Ask whether a Korean query is a place here before answering with a shop
- `8fddb02` Bring the full name back to 시도 search without putting it in the list
- `e4a7c3b` Note that the VWorld key still needs a production one
- `1c4f9aa` Add a labelless map alongside 지명 참고용
- `cee269f` Make the labels a checkbox, and stop switching on the ones that were off
- `74cc53a` 글자 체크박스가 정말로 글자를 켜게 한다
- `173aa64` 모노톤에서 글자가 안 켜지던 것과, 켜면 영어로 나오던 것
- `309f2de` 글자를 한 번 고르면 스타일을 바꿔도 그 선택이 따라간다
- `183ca8e` name_ko 로 글자를 찍는 스타일에서 글자가 빈 문자열이 되던 것
- `c3190cd` '지명 참고용' 을 '일반지도' 로 바꾼다
- `0a91ca0` 3.7 PR 본문 초안 — 팀장님 지적사항 반영 현황을 항목별로
- `261ca72` PR 본문: 요청서 10개 항목을 축으로 합친다
- `c61b0db` 직선 경로를 되살리고, 경로선 기본을 아크로
- `760cb1b` 직선 이동에도 줌아웃을 걸 수 있게 한다
- `5cda439` 직선 이동의 줌아웃은 비행 곡선을 빌리지 않는다
- `ec20f54` 직선 이동의 줌인을 도착 즈음으로 미룬다
- `41be783` 직선 이동에서 중간 지점으로 줌인하던 것
- `0be710c` 경로선이 카메라와 같은 잣대로 자라게 한다
- `96c0189` 깊이 내려갈수록 오르내리는 데 오래 쓴다
- `58cdb57` PR 본문에 직선 이동의 줌아웃과 선-카메라 동기화를 넣는다
- `27be186` PR-3.7 내용 수정
- `5e3926c` 맥락 문서를 지금 상태에 맞춘다
- `1fcb9f4` PR 본문에 머지 방식과 3.0 아카이브 태그를 적는다
- `7481d4a` '핀·녹화 경로 설정' 만 처음으로 되돌리는 버튼
- `bffa0eb` 되돌리기 버튼을 기호 하나로
- `9aa39b5` 되돌리기 버튼 높이를 다른 버튼과 맞춘다
- `8b09918` 되돌리기 버튼을 제목 줄 오른쪽 끝으로
- `ec0bf02` PR 본문에 되돌리기 버튼을 넣는다

-----

## 6. 테스트와 검증 범위

자동화 검증 명령은 다음과 같다.

```bash
node --test test/*.test.js
node --test test/dom/*.test.js
```

브랜치의 마지막 커밋과 당시 PR 기준으로는 의존성 없는 테스트 107개와 jsdom 테스트 66개,
합계 173개가 통과했다. 머지 직전 footer 검사가 하나 추가되어 현재 의존성 없는 테스트는
108개다.

문서 작성 시점의 Windows 작업 복사본에서 다시 실행한 결과는 다음과 같다.

- `node --test test/*.test.js`: **108개 전부 통과**
- 기존 CRLF 실패는 줄바꿈을 `\r?\n`으로 허용해 해결했다.
- `node --test test/dom/*.test.js`: 로컬에 `jsdom`이 설치되어 있지 않아 실행하지 못했다.
  GitHub Actions는 `npm install` 후 66개를 실행한다.
- 브라우저 수동 확인: 지도 디자인 재배치, 두 줄 지명 라벨, 하단 토스트, 상단 제목 제거,
  패널 최하단 저작권 문구의 위치와 넘침 여부를 확인했다.

주요 회귀 범위는 다음과 같다.

- 남·북한 국가/행정구역 색칠 순서와 PSD/SVG 내보내기
- 스타일별 국경선·행정구역선 분류, 숨김 레이어 보존, 점선 캡
- 비행/직선 카메라 궤적, 프리로드, 정수 줌 보정, 선 성장률
- 시·도 별칭 검색과 VWorld/Mapbox/Google 검색 순서
- 지명 표시 체크박스와 `name_ko` 보정
- 핀·경로 설정 초기화와 지도 마커 제거
- 국가별 행정구역 데이터 분할, 출처, 정밀도, 감김 방향, 핀치, 자기교차

`test/dom`은 `jsdom`이 필요하다. 사내 npm 인증서 문제로 로컬 설치가 막힐 수 있으며, 이 경우
전체 DOM 테스트는 GitHub Actions 결과로 확인한다.

-----

## 7. 머지 전후 확인할 것

### 브라우저 수동 확인

자동 테스트는 WebGL 결과를 직접 보지 못하므로 다음은 수동 확인이 필요하다.

- 6개 스타일에서 국경선 투명도 0, 행정구역선 점선, 지명 표시 체크박스 동작
- 위성사진에서 숨겨진 `landColor`·`water`가 켜져 바다가 뿌옇게 되지 않는지
- 북한·함경남도를 칠하고 줌 7 부근에서 긴 도형이 뻗지 않는지
- 대한민국 국가 색칠 위에 시·도 색칠이 보이고 PSD/SVG에도 각각 나오는지
- 서울→런던 아크 녹화에서 화살표가 카메라 중심 근처를 따라가는지
- 직선 + 줌아웃 `조금`, 줌 시간 약 5초에서 도착지 부근으로 자연스럽게 줌인하는지
- 출발·도착의 정지 프레임에서 도로·지형 음영이 순간적으로 바뀌지 않는지
- 초기화 버튼이 핀·경로만 지우고 색칠과 녹화 설정은 유지하는지

### 남아 있는 작업과 한계

- 브라질 마라냥의 일부 섬이 화면에서 칠해지지 않는 현상은 미해결이다. 데이터상 포함 여부,
  구멍, 핀치, 자기교차, 폴리곤 손실, 감김 방향은 모두 배제했다. 다음 조사는 브라우저에서
  `map.queryRenderedFeatures`, `map.showLayers2DWireframe`, 줌별 타일 삼각분할을 확인한다.
- `recorder/js/config.js`의 VWorld 키는 개발용이다. 운영 전 운영용 키로 교체하고 `?v=` 8곳을
  함께 올려야 한다.
- Google Places 키는 HTTP 리퍼러 제한까지 적용했으나 API 제한을 `Places API (New)` 하나로
  좁히는 운영 설정이 남아 있다.
- WebGL 스크린샷 회귀 테스트가 없다. 위성 오버레이와 다각형 스파이크 같은 렌더링 문제는
  현재 수동 확인에 의존한다.
- 패널 보조 글자색 `--muted`의 근사 대비는 3.95:1이다. 더 진하게 바꿀지는 별도 판단 사항이다.
- 국가별 행정구역 색칠 선은 남·북한을 제외하면 여전히 Mapbox 선이다. 선과 색칠을 꼭짓점
  단위로 맞추려면 `korea-admin1-lines.json`과 같은 방식으로 각 폴리곤에서 선을 생성해야 한다.

### Squash 병합 시 히스토리 보존

이 브랜치를 Squash and Merge하면 위 61개 커밋은 `main`의 조상으로 남지 않는다. 브랜치까지
삭제하면 커밋 본문의 상세한 조사 기록을 안정적으로 찾기 어렵다. 이 문서를 커밋한 최종 브랜치
HEAD에 `archive/v3.1.0-dev-GUHNZ-2` 같은 보존 태그를 만들고 원격에 푸시한 뒤 브랜치를 삭제하는
것을 권장한다. 이전 `v3.0.0` 작업은 실제 태그 이름 `archive/3.0-dev-GUHNZ`로 이미 보존되어 있다.

태그를 남기지 못하더라도 이 문서의 2·4절이 설계 이유와 실패한 접근을, 5절이 원래 커밋 순서를
복원하기 위한 최소 색인 역할을 한다.
