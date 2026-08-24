/* '이동 중 줌아웃' 단계.

   flyTo 는 출발·도착 줌이 같아도 중간에 줌아웃한다(van Wijk 곡선). 그 깊이를 UI 에서
   고르게 해 뒀는데, 예전에는 minZoom 으로 "몇 단계 내려갈지"를 직접 지정했다.
   정확히 먹기는 했지만 **거리와 무관하게 고정**이라 긴 이동에서 뒤집혔다 —
   서울→파리는 기본 곡선이 6.85 단계 내려가는데 '많이'가 3.01 이라, '자동'에서 '많이'로
   바꾸면 줌아웃이 오히려 줄었다.

   그래서 curve 로 바꿨다. 이 파일은 두 가지를 지킨다:
     1. 어떤 값이 실제로 flyTo 에 전달되는가
     2. 그 값이 정말 단조 증가하는가 — mapbox 의 곡선 공식을 그대로 옮겨 최저 줌을 계산한다.
        1 번만으로는 '자동보다 큰가'를 알 수 없다. 뒤집혔던 게 바로 그 부분이다. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { extract } from './helpers/extract.js';

const R = extract('recorder/js/recorder.js', ['FLY_CURVES', 'moveOpts']);

const MAPBOX_DEFAULT_CURVE = 1.42;                     // flyTo 의 기본값

// $('fly-dip') / $('mode') 를 흉내낸다. moveOpts 는 자유변수로 $ 와 map 을 쓴다.
const withUI = (dip, fn) => {
  const prev$ = globalThis.$, prevMap = globalThis.map;
  globalThis.$ = (id) => ({ value: id === 'fly-dip' ? dip : '' });
  globalThis.map = { getZoom: () => 8 };
  try { return fn(); } finally { globalThis.$ = prev$; globalThis.map = prevMap; }
};
const opts = (dip, mode = 'fly') =>
  withUI(dip, () => R.moveOpts({ center: [127, 37], zoom: 8 }, mode, 4));

test("'없음'은 곡선을 평탄하게 눕힌다 (minZoom 으로는 0.5 단계가 남는다)", () => {
  const o = opts('0');
  assert.equal(o.curve, 0.01);
  assert.equal(o.minZoom, undefined, 'minZoom 과 curve 를 같이 주면 mapbox 가 curve 를 무시한다');
});

test("'자동'은 mapbox 기본 곡선 그대로 — 아무것도 얹지 않는다", () => {
  const o = opts('auto');
  assert.equal(o.curve, undefined);
  assert.equal(o.minZoom, undefined);
});

test('단계는 curve 로 준다 (minZoom 은 거리와 무관해 긴 이동에서 뒤집혔다)', () => {
  for (const dip of ['1', '2', '3']) {
    const o = opts(dip);
    assert.equal(o.curve, R.FLY_CURVES[dip], `${dip} 단계의 curve 가 안 걸린다`);
    assert.equal(o.minZoom, undefined, 'minZoom 으로 돌아가면 거리 비례가 깨진다');
  }
});

test('단계가 커질수록 곡선이 깊고, 전부 기본 곡선보다 깊다', () => {
  const v = ['1', '2', '3'].map((d) => R.FLY_CURVES[d]);
  assert.ok(v[0] > MAPBOX_DEFAULT_CURVE,
    `'조금'(${v[0]})이 기본 곡선(${MAPBOX_DEFAULT_CURVE})보다 얕다 — '자동'보다 덜 줌아웃된다`);
  assert.ok(v[0] < v[1] && v[1] < v[2], `단계가 단조 증가하지 않는다: ${v.join(' < ')}`);
});

test('비행이 아니면 곡선을 건드리지 않는다', () => {
  const o = opts('3', 'ease');
  assert.equal(o.curve, undefined);
  assert.equal(o.minZoom, undefined);
});

/* ── 실제로 얼마나 내려가는지 ──
   mapbox-gl v3.13.0 의 flyTo 를 그대로 옮긴 것이다. zoom(t) = s + log2(cosh(C+ρt)/cosh(C))
   이므로 최저 줌은 C+ρt = 0 인 지점. 이 계산은 실측과 맞다 —
   서울→파리(양 끝 줌 10)에서 minZoom 지정 시 9.50, curve 0.01 에서 10.00 이 나오고
   둘 다 브라우저에서 잰 값과 같다. */
function dipOf({ from, to, zoom, curve = MAPBOX_DEFAULT_CURVE, w0 = 1600 }) {
  const mercX = (lng) => (180 + lng) / 360;
  const mercY = (lat) => { const s = Math.sin(lat * Math.PI / 180); return 0.5 - 0.25 * Math.log((1 + s) / (1 - s)) / Math.PI; };
  const world = 512 * Math.pow(2, zoom);
  const u1 = Math.hypot((mercX(to[0]) - mercX(from[0])) * world, (mercY(to[1]) - mercY(from[1])) * world);
  const w1 = w0, T = curve * curve;                    // 양 끝 줌이 같으므로 w1 === w0
  const E = (e) => {
    const t = (w1 * w1 - w0 * w0 + (e ? -1 : 1) * T * T * u1 * u1) / (2 * (e ? w1 : w0) * T * u1);
    return Math.log(Math.sqrt(t * t + 1) - t);
  };
  const C = E(0), S = (E(1) - C) / curve;
  if (!isFinite(S)) return 0;
  const cosh = (v) => (Math.exp(v) + Math.exp(-v)) / 2;
  let lo = Infinity;
  for (let k = 0; k <= 2000; k++) lo = Math.min(lo, Math.log2(cosh(C + curve * S * k / 2000) / cosh(C)));
  return -lo;                                          // 내려간 줌 단계
}

test('가까운 이동에서도 먼 이동에서도 자동 < 조금 < 보통 < 많이', () => {
  const SEOUL = [127.0, 37.55];
  const LEGS = [
    ['서울→부산',  [129.08, 35.18], 8],
    ['서울→도쿄',  [139.69, 35.69], 7],
    ['서울→파리',  [  2.35, 48.86], 10],
    ['서울→뉴욕',  [-74.00, 40.71], 10],
  ];
  for (const [name, to, zoom] of LEGS) {
    const auto = dipOf({ from: SEOUL, to, zoom });
    const step = ['1', '2', '3'].map((d) => dipOf({ from: SEOUL, to, zoom, curve: R.FLY_CURVES[d] }));
    assert.ok(auto < step[0], `${name}: '조금'(${step[0].toFixed(2)})이 '자동'(${auto.toFixed(2)})보다 얕다`);
    assert.ok(step[0] < step[1] && step[1] < step[2],
      `${name}: 단계가 단조롭지 않다 — ${step.map((v) => v.toFixed(2)).join(' → ')}`);
  }
});

test("'없음'은 정말 0 이다 (0.5 단계도 남으면 도로·지명이 빠진다)", () => {
  const d = dipOf({ from: [127.0, 37.55], to: [2.35, 48.86], zoom: 10, curve: 0.01 });
  assert.ok(d < 0.01, `줌아웃이 ${d.toFixed(3)} 단계 남았다`);
});
