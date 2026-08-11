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
  monotone:     'mapbox://styles/designeraj/cmcvnojkj005p01sq5jax8qhf', // 단색 대체
  // 지명 참고용 — Mapbox 기본 제공 스타일. 지명·도로명이 전부 나와서 위치 확인에 씀.
  // 방송용이 아니라 "여기가 어디인지" 확인하는 용도. 이 스타일에서만 라벨을 한국어로 바꾼다.
  placenames:   'mapbox://styles/mapbox/streets-v12',                // 지명 참고용
};

// 라벨을 한국어로 표시할 스타일. 나머지(방송용)는 원본 디자인의 라벨을 그대로 둔다.
const KO_LABEL_STYLES = new Set(['placenames']);

// 토큰과 지도 인스턴스는 루트 ColorMap 앱이 생성하고 관리합니다.
