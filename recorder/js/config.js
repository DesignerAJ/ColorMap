/* ============================================================
   전역 설정 — 지도 스타일 / Mapbox 토큰
   ============================================================ */

const $ = (id) => document.getElementById(id);

// 타일 동시 요청 수 (기본 16). 카메라가 빠르게 움직일 때 기본값으로는 타일이 제때
// 도착하지 못해 저해상도 부모 타일이 그려진다. 프리로드 속도에도 그대로 영향.
if (typeof mapboxgl !== 'undefined') mapboxgl.maxParallelImageRequests = 64;

// ── 기존 ColorMap 스타일 ──
const STYLES = {
  mono_terrain: 'mapbox://styles/designeraj/cmma6v98500gl01suhod9gfsz', // 단색지형
  mono:         'mapbox://styles/designeraj/cmcvnojkj005p01sq5jax8qhf', // 단색
  satellite:    'mapbox://styles/designeraj/cmcxy4dm5009501sqh385hdu5', // 위성사진
  detail:       'mapbox://styles/designeraj/cmmcpegvn00fn01sugpfi79x7', // 지형도
  monotone:     'mapbox://styles/designeraj/cmsswn1sr006u01rf9agr824g', // 모노톤
  // 지명 참고용 — Mapbox 기본 제공 스타일. 지명·도로명이 전부 나와서 위치 확인에 씀.
  // 방송용이 아니라 "여기가 어디인지" 확인하는 용도. 이 스타일에서만 라벨을 한국어로 바꾼다.
  placenames:   'mapbox://styles/mapbox/streets-v12',                // 지명 참고용
};

// 라벨을 한국어로 표시할 스타일. 나머지(방송용)는 원본 디자인의 라벨을 그대로 둔다.
const KO_LABEL_STYLES = new Set(['placenames']);

/* ── 장소 검색 인증키 ──
   Mapbox 는 한국 POI 데이터가 사실상 비어 있다. 실측(12개 표본)에서 '왕산해수욕장',
   '해운대해수욕장', '김포공항', '서울시청', '전주한옥마을' 이 전부 0건이었고
   맞힌 건 '독도' 와 '남대문시장'(그마저 도로명) 둘뿐이었다. 그래서 한국 검색은
   국내 API 로 처리하고 Mapbox 는 해외 폴백으로만 쓴다.

   검색 순서: 한글이 섞이면 VWorld → (0건이면) Google → (그래도 0건이면) Mapbox
              한글이 없으면 Mapbox → (0건이면) Google

   vworld : https://www.vworld.kr → 오픈API → 인증키 발급 (2.0 검색 API, 무료)
            발급할 때 '사용 도메인'에 이 앱을 띄우는 주소를 넣어야 한다.
            로컬 테스트까지 하려면 http://127.0.0.1:5500 도 함께 등록.
            호출 횟수 제한은 현재 없다(서버 부하에 따라 변경될 수 있음).
            CORS 헤더를 안 주는 대신 JSONP(callback)를 지원해서 그 방식으로 부른다.

   google : https://console.cloud.google.com → 'Places API (New)' 사용 설정 → 사용자 인증 정보에서 API 키
            키에는 반드시 '애플리케이션 제한 → HTTP 리퍼러' 를 걸 것 (브라우저에 노출되는 키다).
            좌표를 받으려면 Text Search 의 Pro SKU 를 쓸 수밖에 없어 월 5,000건까지 무료,
            초과분은 1,000건당 약 $32. VWorld 가 못 찾은 것만 넘기므로 넘길 일은 거의 없다.

   비워두면 그 제공자는 조용히 건너뛴다 — 키가 하나도 없으면 예전처럼 Mapbox 만 쓴다. */
const SEARCH_KEYS = {
  vworld: '4A95A9B9-1922-31EC-B503-3B54973F0458',
  google: 'AIzaSyCF7w78TOloInjVtjO0A5Jl1aBbukmsv5g',
};

// 토큰과 지도 인스턴스는 루트 ColorMap 앱이 생성하고 관리합니다.
