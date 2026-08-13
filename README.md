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
python -m http.server 5500
```

브라우저에서 `http://127.0.0.1:5500/`으로 접속합니다.

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

장소 검색은 VWorld(국토교통부)와 Google Places를 씁니다 — 인증키는
`recorder/js/config.js`의 `SEARCH_KEYS`에 넣습니다. 두 키 모두 브라우저에 노출되는
값이라 발급처에서 사용 도메인·HTTP 리퍼러 제한을 걸어야 합니다.
