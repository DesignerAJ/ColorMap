# ColorMap — 작업 맥락

KBS 보도그래픽부용 지도 도구. 지역을 색칠하고 카메라 경로를 녹화해 MP4·PNG·PSD·SVG로 내보낸다.
**빌드 단계가 없다.** 파일을 그대로 서빙하며, GitHub Pages가 `main`을 배포한다.

> 이 파일에 넣을 것: **코드만 봐선 모르는 것** — 결정의 근거, 함정, 환경 제약, 남은 일.
> 변경 이유는 커밋 메시지에, 그 줄이 왜 그런지는 코드 주석에 남긴다. 여기까지 끌고 오면
> 매 세션 읽히는 파일이 비대해져 오히려 안 읽힌다. 자동으로 채워지지 않으니 직접 갱신할 것.

## 지금 상태

- 작업 브랜치 `dev-GUHNZ` (3.x). **배포된 `main`은 아직 2.0이다** — 3.x는 배포된 적 없다.
- 저장소는 **공개(public)**. `github.com/DesignerAJ/ColorMap`

## 구조

```
index.html          ?v= 로 캐시를 끊는다. CSS 2 + JS 5, 총 7곳
data/script.js      부팅: 토큰 받아 map 생성 → panel.html 주입 → initRecorder(map)
                    PANEL_URL 의 ?v= 도 index.html 과 같이 올려야 한다 (총 8곳)
recorder/panel.html 패널 UI 조각 (단독 페이지 아님)
recorder/js/config.js    스타일 목록, SEARCH_KEYS
recorder/js/recorder.js  거의 전부. 3,000줄이 initRecorder 클로저 하나에 들어 있다
data/style.css + recorder/css/app.css   순서대로 겹친다 (아래 '캐스케이드' 참고)
```

## 데이터 파이프라인

```
sigungu.json  ──(build-sido-hires.mjs)──>  sido-hires.json
                        + saemangeum.json (보충 폴리곤)
sido-hires.json ──(build-korea-border.mjs)──>  korea-border.json (북쪽 국경선)
```

- 생성물을 손으로 고치지 말 것. 도구를 고치고 다시 생성한다.
- `build-korea-border.mjs` 는 `MAPBOX_TOKEN` 과 `npm i @mapbox/vector-tile pbf` 가 필요하다.
- 재생성하면 `node --test test/data.test.js` 로 반드시 검증한다.

## 환경 제약

- **사내 npm 이 인증서에 막혀 설치가 안 된다.** 그래서 테스트를 두 층으로 나눴다 —
  `test/` 는 의존성 0, `test/dom/` 은 jsdom 필요(CI에서 설치). 새 의존성을 함부로 늘리지 말 것.
- 이 맥을 만든 환경에선 `python3` 이 깨져 있었다(Command Line Tools). `node tools/serve.mjs` 를 쓴다.
- **검색 인증키는 브라우저에 노출되는 값이다.** 도메인·리퍼러 제한이 유일한 방어선.
  - VWorld: 사용 도메인에 `127.0.0.1` 과 `designeraj.github.io` 둘 다 등록해야 한다.
    로컬에서 `등록되지 않은 인증키입니다` 가 뜨면 대개 이것.
  - Google: **아직 안 넣었다.** 넣을 때 HTTP 리퍼러 제한 + Places API 로 API 제한까지 걸 것.
    Text Search 는 좌표를 받으려면 Pro SKU 라 월 5,000건 무료, 초과 시 1,000건당 약 $32.
  - 키를 저장소에 그대로 두기로 했다 (공개 사이트라 어차피 노출되고, 도메인 제한이 실질 방어).

## 이 코드베이스의 함정

**CSS 캐스케이드.** `data/style.css` 에 2.0 시절 규칙이 남아 있고 ID 를 끼고 있어 명시도가 높다.
`app.css` 는 `@scope` 안에 있는데 **`@scope` 는 명시도를 올려주지 않는다.** 그래서 클래스 규칙이
`#country-selector-container label` 같은 규칙에 진다. 패널 라벨 34개가 통째로 16px 로 그려지던
사고가 여기서 났다. 라벨 크기를 만질 땐 `test/dom/cascade.test.js` 를 먼저 돌려볼 것.

**레이어 순서.** 색칠은 첫 symbol 레이어 바로 아래에 깔고, 경계선을 그 위로 끌어올린다
(`raiseBoundaries`). 끌어올릴 대상은 **이름이 아니라 소스**(`admin`·`country_boundaries`)로 고른다 —
이름으로 나열했더니 8개 중 5개를 놓쳐 시군구 경계선이 색칠에 덮였다.

**스타일마다 레이어 이름이 다르다.** 같은 국경선이 `country_border`·`country-border`·
`admin-0-boundary-bg` 로 제각각이다. 새 스타일을 추가하면 실제 레이어 목록을 먼저 확인할 것.

**IME.** 한글 조합 중 Enter 는 글자 확정용이라 무시해야 한다. 동시에 목록에서 방향키로 고른 값은
Enter 의 **기본 동작이 끝난 뒤에야** 입력창에 들어온다 — 그래서 `setTimeout(…, 0)` 으로 미뤄 읽고
`preventDefault` 는 하지 않는다.

**패널 글자 대비.** 카드 바탕은 `흰색 70% → 반투명 패널 → 지도` 로 겹쳐 있어 **실제 배경이
지도에 따라 달라진다.** 그래서 대비 수치는 근사치다. 그래도 눈에 띄게 안 보이는 값은 걸러야 하니
`test/dom/cascade.test.js` 가 팔레트를 검사한다 — 완료 표시(`--ok`)는 4.5:1, 나머지는 3:1 기준.
색을 새로 정할 땐 그 테스트를 먼저 돌려볼 것. `--ok` 가 한때 1.84:1 이라 '지정됨'이 안 읽혔다.

## 결정과 근거 (되돌리기 전에 읽을 것)

- **새만금**은 국토부 VWorld 의 시군구·시도 레이어 **양쪽 다** `NOT_FOUND` 다. 어디에도 배정돼
  있지 않다. 시도 단위로는 전북이 분명하므로 별도 폴리곤으로 전북에 얹었다.
  **매립지만** 넣고 새만금호 수면(186km²)은 뺐다 — 통째로 채우면 바다를 칠한 것처럼 보인다.
  출처는 OSM(ODbL)이라 `README` 와 `saemangeum.json` 에 출처를 밝혀 두었다.
- **북쪽 국경선**은 Mapbox 대신 우리 시도 데이터에서 뽑아 그린다. Mapbox 의 KP-KR 선은 우리
  행정경계와 최대 3.1km 어긋나고 줌을 올려도 안 줄어든다(= 단순화가 아니라 데이터가 다름).
  국토부 경계와는 중앙값 6m 로 일치하며, 어긋나는 20곳은 전부 VWorld 가 DMZ 를 빼서 생긴 차이였다.
  Mapbox 쪽 KP-KR 구간은 `iso_3166_1 != 'KP-KR'` 로 가린다.
- **위성 스타일**에서는 `landColor`·`water` 를 건드리지 않는다. 디자이너가 `visibility:none` 으로
  꺼둔 반투명 오버레이라, 켜면 사진 위에 얹혀 바다가 뿌예진다.
- **강·호수**는 바다와 색·불투명도를 맞춘다(`matchWaterToSea`). 스타일의 `water` 는 색은 같은데
  `fill-opacity: 0.5` 라 육지가 비쳐 옅어 보였다. 그 뒤로 꺼둘 이유가 없어져
  `RIVER_DEFAULT_OFF` 를 비웠다 — 물 레이어가 있는 스타일은 모두 켜진 채로 시작한다.

## 실행과 검증

```bash
node tools/serve.mjs                  # http://127.0.0.1:5500
node --test test/*.test.js            # 33개, 설치 불필요
npm install && node --test test/dom/*.test.js   # 35개, jsdom 필요
```

푸시하면 `.github/workflows/qa.yml` 이 둘 다 돌린다 (배포는 건드리지 않는다).
테스트가 막고 있는 실제 사고 목록은 `test/README.md` 에 있다.

**커밋 메시지에 왜 그렇게 했는지가 적혀 있다.** 어떤 코드가 이상해 보이면
`git log -p --follow <파일>` 을 먼저 보는 게 빠르다.

## 이어서 할 일

1. **브라우저 확인** — 3.x 를 실제 화면에서 훑은 적이 아직 부족하다. 특히 단색지형에서
   시군구 경계선·강 색, 위성 바다, 연천·양구 국경선.
2. **Google Places 키** — `SEARCH_KEYS.google` 에 넣으면 VWorld 가 못 찾은 것만 넘어간다.
   현재 VWorld 만으로 12개 표본 중 11개를 찾고 `경포대해수욕장` 하나가 비었다.
3. **스크린샷 회귀(Playwright)** — 지금 테스트는 jsdom 이라 **WebGL 렌더 결과를 못 본다.**
   위성 바다 뿌옇던 것, 색칠 삼각형 스파이크 둘 다 눈으로만 잡혔다. 유일하게 비어 있는 층.
4. **`main` 머지·배포** — 공개 사이트가 바로 바뀌므로 1번을 마친 뒤에.
5. **`--muted` 를 진하게 갈지 결정** — 지금 `#64748b` 은 카드 위 대비 3.95:1 로 작은 글씨
   기준(4.5:1)에 살짝 못 미친다. 보조 라벨(투명도·두께·점선·힌트) 전반에 쓰이는 색이라
   임의로 안 바꿨다. 진하게 가려면 `#5a6577` 정도면 넘긴다.
6. (선택) `recorder.js` 를 ES 모듈로 쪼개기. 그러면 `test/helpers/extract.js` 를 버리고
   `import` 로 바꿀 수 있다.
