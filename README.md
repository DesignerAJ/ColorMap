# 국가, 대한민국 시도 경계 및 영역 지도
> for KBS 보도그래픽부

## 카메라 경로 녹화 통합

`dev`에는 기존의 유리 패널 디자인을 유지한 채 카메라 경로 녹화 기능이 통합되어 있습니다.
`#country-selector-container` 하나에서 지역 선택, 지도 디자인, 카메라 경로와 내보내기를 모두 제어합니다.

- 카메라 출발·경유지·도착 지정
- MP4 / WebM 녹화와 프레임 단위 부드러운 녹화
- 국가·해외 행정구역·시도·시군구 색칠
- 경로선, 위치 핀, 직접 선 그리기
- PNG, PSD, SVG 내보내기

`recorder/panel.html`은 단독 웹앱이 아니라 루트 앱의 단일 설정 패널을 구성하는 UI 조각입니다.
별도의 recorder 지도나 전환 버튼은 없으며 지도와 Mapbox token은 `data/script.js`가 한 번만 생성하고 관리합니다.
메뉴는 이후 기능별 재구성이 쉽도록 `details[data-menu-section]` 단위로 구분합니다.

로컬에서는 `file://`로 열지 말고 서버를 실행합니다.

```bash
python -m http.server 5500
```

브라우저에서 `http://127.0.0.1:5500/`으로 접속합니다.

`recorder/js/data/admin1.json`과 `sigungu.json`은 해당 탭을 처음 열 때만 불러옵니다.
위치 핀 라벨은 기본 폰트를 사용합니다. 팀 폰트를 연결하려면 사용권을 먼저 확인한 뒤
`recorder/js/recorder.js`의 `EMBEDDED_LABEL_FONT`에 파일 경로를 지정합니다.
