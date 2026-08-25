# 국가, 대한민국 시도 경계 및 영역 지도
> for KBS 보도그래픽부

## 카메라 경로 녹화 통합

`dev`에는 기존의 유리 패널 디자인을 유지한 채 카메라 경로 녹화 기능이 통합되어 있습니다.
`#country-selector-container` 하나에서 지역 선택, 지도 디자인, 카메라 경로, 녹화 설정과 내보내기를 모두 제어합니다.

- 카메라 출발·경유지·도착 지정
- MP4 / WebM 녹화와 프레임 단위 부드러운 녹화
- 국가·해외 행정구역·시도·시군구 색칠
- 경로선, 위치 핀, 직접 선 그리기
- PNG, PSD, SVG 내보내기

`recorder/panel.html`은 단독 웹앱이 아니라 루트 앱의 단일 설정 패널을 구성하는 UI 조각입니다.
별도의 recorder 지도나 전환 버튼은 없으며 지도와 Mapbox token은 `data/script.js`가 한 번만 생성하고 관리합니다.
접이식 메뉴는 `지역 선택 → 지도 디자인 → 카메라 경로 · 핀과 선 → 녹화 설정` 순서의 `details[data-menu-section]` 단위로 구분합니다.
MP4·PSD·PNG·SVG 내보내기 버튼은 접이식 메뉴 밖에서 한 줄로 항상 노출되며, 지도 줌은 그 아래 아이콘형 컨트롤로 배치합니다.
MP4는 별도 보조 버튼 없이 프레임 단위 경로 렌더링 방식으로 부드럽게 저장합니다.
작업 상태는 패널 안에 상주하지 않고 화면 중앙에 잠시 나타난 뒤 디졸브됩니다.

로컬에서는 `file://`로 열지 말고 서버를 실행합니다.

```bash
node tools/serve.mjs          # 또는  python -m http.server 5500
```

브라우저에서 `http://127.0.0.1:5500/`으로 접속합니다.
`tools/serve.mjs`는 캐시를 끄고 서빙하므로 파일을 고치면 새로고침만으로 반영됩니다.

작업 맥락과 이어서 할 일은 [CLAUDE.md](CLAUDE.md), 테스트는 [test/README.md](test/README.md)를 참고하세요.

`recorder/js/data/admin1.json`과 `sigungu.json`은 해당 탭을 처음 열 때만 불러옵니다.
위치 핀 라벨은 기본 폰트를 사용합니다. 팀 폰트를 연결하려면 사용권을 먼저 확인한 뒤
`recorder/js/recorder.js`의 `EMBEDDED_LABEL_FONT`에 파일 경로를 지정합니다.

## 데이터 출처

시도 경계(`sido-hires.json`)는 `sigungu.json`을 시도 단위로 합쳐 만듭니다
(`node recorder/tools/build-sido-hires.mjs`).

여기에 새만금 보충 폴리곤(`saemangeum.json`) 하나가 얹힙니다. 새만금 방조제 안쪽은
어느 행정구역에도 배정돼 있지 않아서 — 국토교통부 VWorld 의 시군구(`LT_C_ADSIGG_INFO`)와
시도(`LT_C_ADSIDO_INFO`) 레이어 **둘 다** 그 지점을 `NOT_FOUND`로 돌려줍니다 —
시군구를 합치기만 해서는 전북 한복판이 빈 채로 남습니다.
시군구 관할은 아직 미확정이지만 시도 단위로는 전북이 분명하므로 전북에 포함시켰습니다.

넣는 범위는 **매립된 땅까지**입니다. 새만금호 수면(186km²)은 뺐습니다 — 방조제 안쪽을
통째로 채우면 큰 수면이 육지색이 되어 바다를 칠한 것처럼 보입니다.

> 이 폴리곤은 OpenStreetMap 데이터로 만들었습니다 (새만금호 `relation/12336578`,
> 새만금 방조제 `relation/13076572`).
> © OpenStreetMap contributors, [ODbL 1.0](https://www.openstreetmap.org/copyright)

북쪽 육상 국경선은 Mapbox가 아니라 **우리 시도 데이터에서 뽑은 선**(`korea-border.json`)을
그립니다. Mapbox의 KP-KR 국경선은 우리 행정경계와 최대 3.1km 어긋나서 — 벡터 타일을 직접
디코딩해 재보면 77%는 200m 이내지만 나머지가 벌어지고, 줌 12까지 올려도 최대값이 줄지
않습니다 — 색칠이 국경선을 넘거나 못 미치는 것처럼 보였습니다. 같은 데이터에서 뽑은 선을
쓰면 색칠과 꼭짓점 단위로 정확히 붙습니다. Mapbox의 해당 구간은 `admin` 소스를 쓰는
레이어에 `iso_3166_1 != 'KP-KR'` 조건을 덧붙여 가리며, 다른 나라 국경선은 그대로 둡니다.
다시 만들려면 `MAPBOX_TOKEN=... node recorder/tools/build-korea-border.mjs`
(`npm i @mapbox/vector-tile pbf` 필요).

행정구역 데이터는 나라별로 나눠 받습니다. `node recorder/tools/build-admin1-split.mjs` 가
`admin1.json` 을 `admin1-meta.json`(속성) · `admin1-core.json`(자주 쓰는 8개국) ·
`admin1/<ISO3>.json`(나머지)으로 쪼갭니다. 이때 거친 나라 224곳의 경계를
**Natural Earth 10m**(퍼블릭 도메인)으로 올립니다 — 구역당 중앙값 73 → 166점.
출처: Natural Earth (naturalearthdata.com), 퍼블릭 도메인.

행정구역 경계는 나라마다 출처가 다릅니다. **어느 나라가 어디서 왔는지는
`recorder/js/data/admin1-sources.json` 에 적혀 있습니다** — 도구가 파일을 쓸 때마다
직접 갱신하므로 사람이 옮겨 적지 않습니다.

| 출처 | 나라 수 | 표기 |
|---|---|---|
| OpenStreetMap (ODbL 1.0) | 57 | `© OpenStreetMap contributors` 한 줄 |
| Natural Earth | 160 | 퍼블릭 도메인 — 의무 없음 |
| 각국 공식기관 (geoBoundaries) | 9 | 아래 개별 표기 |

바탕 지도가 Mapbox(OSM 기반)라 `© OpenStreetMap contributors` 는 어차피 표기해야 하므로,
OSM 으로 맞춘 57개국은 **표기가 늘지 않습니다**. 개별 표기가 필요한 건 아래 9개국뿐입니다.

  - 그리스: EuroGeoGraphics, Regional IM Working Group - Europe (Creative Commons Attribution 4.0 International (CC BY 4.0))
  - 베트남: geoBoundaries, Wikipedia (Public Domain)
  - 스웨덴: geoBoundaries, Erik Frohne (Creative Commons Attribution 3.0 License)
  - 싱가포르: Urban Redevelopment Authority, derived from ADM 3 (Open Data Commons Open Database License 1.0)
  - 아제르바이잔: Wikipedia (Creative Commons Attribution-ShareAlike 3.0 Unported)
  - 오스트레일리아: Australian Bureau of Statistics (Creative Commons Attribution 4.0 International (CC BY 4.0))
  - 칠레: La Biblioteca del Congreso Nacional de Chile (BCN), OCHA ROLAC (Creative Commons Attribution 3.0 Intergovernmental Organisations (CC BY 3.0 IGO))
  - 카타르: geoBoundaries, Qatar Open Data Portal (Creative Commons Attribution 4.0 International (CC BY 4.0))
  - 파푸아뉴기니: Papua New Guinea National Statistics Office, OCHA ROAP (Creative Commons Attribution 3.0 Intergovernmental Organisations (CC BY 3.0 IGO))

만드는 순서 (뒤 도구가 앞 도구의 결과를 덮어씁니다):

```bash
node recorder/tools/build-admin1-firstlevel.mjs   # 프랑스·이탈리아·스페인을 1급으로 (admin1.json 을 고친다)
node recorder/tools/build-admin1-split.mjs        # 나라별로 쪼개고 Natural Earth 로 올린다
node recorder/tools/build-admin1-hires.mjs        # 각국 공식기관 데이터로 올린다
node recorder/tools/build-admin1-osm.mjs          # 개별 표기가 필요한 나라를 OSM 으로 바꾼다
```

`build-admin1-hires.mjs` 와 `-osm.mjs` 는 **연달아 두 번 돌리면 안 됩니다** — 덮어쓴 자기
출력을 다시 읽어 전부 건너뜁니다. 다시 만들려면 split 부터.

북한 1급 행정구역(`admin1.json` 안의 '북한' 13개)은 OpenStreetMap 에서 받아
`node recorder/tools/build-nk-admin1.mjs` 로 만듭니다. 원래 들어 있던 경계는 도당
100~220점짜리라 도당 1.6만점인 우리 시도 옆에서 눈에 띄게 각졌고, 군사분계선 구간이
우리 경기·강원과 중앙값 1.75~6.6km 어긋나 같이 칠하면 선이 겹치거나 벌어졌습니다.

군사분계선에 닿는 도(강원도·개성특별시)는 그 구간을 **`korea-border.json` 으로 치환**합니다.
같은 선을 두 데이터가 각자 그리면 아무리 정밀해도 또 어긋나기 때문입니다. 치환하면 우리
색칠과 꼭짓점 단위로 붙습니다. 양 끝 해안 6km 는 예외로 두었습니다 — 거기서는 우리
해안선(국토부)과 북한 해안선(OSM)이 원래 다른 데이터라 최대 5km 차이가 납니다.

OSM 행정경계는 **영해까지 포함합니다** — 그대로 쓰면 황해남도를 칠했을 때 서해가 통째로
칠해집니다. 그래서 해안선(`natural=coastline`)을 함께 받아 바다로 나간 부분을 잘라냅니다.
`maritime=yes` 태그로 거르는 방법은 쓰지 않았습니다. 태그 없는 way 도 바다를 지나서,
태그만 믿고 자르면 '육지' 쪽 끝점이 해안에서 22km 떨어진 곳에 찍혔습니다. 대신 꼭짓점마다
**해안선 안쪽인지 직접 판정**합니다(동쪽으로 광선을 쏴 교차 횟수를 셉니다).

잘라내면 본토만 남으므로, 원래 폴리곤 안에 들어가던 섬을 되붙입니다. 연평도 북쪽의
갈도·장재도·무도가 여기 해당합니다 — OSM 에 북한 군부대가 함께 태그된 북한 섬입니다.

원본에 아예 빠져 있던 개성특별시·남포특별시가 이때 들어와 11개 → 13개가 됩니다.

> 북한 경계는 OpenStreetMap 데이터로 만들었습니다 (`admin_level=4`, `ISO3166-2=KP-*`).
> © OpenStreetMap contributors, [ODbL 1.0](https://www.openstreetmap.org/copyright)

국가 단위 색칠은 **남·북한만 우리 데이터로** 그립니다(`korea-countries.json`,
`node recorder/tools/build-korea-countries.mjs`). Mapbox의 country-boundaries-v1이
연평도 북쪽 북한 섬 넷(갈도·장재도·무도·료도)을 KOR로 분류해 대한민국을 칠하면 함께
칠해졌고, 시도·시군구 색칠과 국경선은 국토부인데 국가 색칠만 Mapbox라 같은 자리에서
최대 3.1km 어긋났기 때문입니다. 2.0은 시도 색칠이 OSM이었고 Mapbox 행정경계도 결국
OSM이라 우연히 맞아떨어졌던 것입니다. 나머지 나라는 Mapbox 그대로입니다.

행정구역선도 남·북한은 우리 폴리곤에서 뽑습니다(`korea-admin1-lines.json`,
`node recorder/tools/build-korea-admin1-lines.mjs`). 스타일이 주는 `admin-1-boundary`가
우리 색칠보다 훨씬 성겨 모양이 안 맞았기 때문입니다. 맞닿은 변만 고릅니다 — 외곽선을
통째로 그리면 해안선까지 행정구역선이 되어 나라 둘레에 테두리가 생깁니다.

장소 검색은 VWorld(국토교통부)와 Google Places를 씁니다 — 인증키는
`recorder/js/config.js`의 `SEARCH_KEYS`에 넣습니다. 두 키 모두 브라우저에 노출되는
값이라 발급처에서 사용 도메인·HTTP 리퍼러 제한을 걸어야 합니다.
