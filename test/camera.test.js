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
import { extract, readSrc } from './helpers/extract.js';

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

test('직선 이동은 flyTo 옵션에 곡선을 얹지 않는다', () => {
  /* easeTo 에는 curve 가 없다. 직선 이동의 줌아웃은 옵션이 아니라 프레임을 직접 몰아서
     낸다(아래 '직선 이동의 줌아웃') — 그래서 여기 값은 예전 그대로여야 한다. */
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

/* ── '부드럽게 녹화'도 같은 곡선을 타야 한다 ──
   이 모드는 flyTo 를 안 쓴다. 프레임마다 jumpTo 로 세워 놓고 타일이 다 도착할 때까지
   기다렸다 찍는다 — 이동 중 저해상도 타일이 잡히던 문제를 그렇게 없앴다. 그러면서
   카메라 궤적을 직선 보간으로 대신했고, 비행 곡선이 통째로 빠졌다.
   출발·도착 줌이 같으면 줌이 처음부터 끝까지 고정이라, '이동 중 줌아웃'을 '많이'로
   놔도 이 모드에서만 아무 반응이 없었다. */
const F = extract('recorder/js/recorder.js', ['lerp', 'lerpAngle', 'CLAMP_LAT', 'mercX', 'mercY',
  'unmercX', 'unmercY', 'FLY_CURVES', 'flightPath', 'interpCam', 'flyCurveNow',
  'STRAIGHT_DIPS', 'DIP_REF', 'DIP_DOWN', 'DIP_UP', 'dipSpan', 'dipBell', 'straightDepth', 'dipPath']);

const SEOUL = { center: [127.0, 37.55], zoom: 8, bearing: 0, pitch: 0 };
const BUSAN = { center: [129.08, 35.18], zoom: 8, bearing: 0, pitch: 0 };
const PARIS = { center: [2.35, 48.86], zoom: 10, bearing: 0, pitch: 0 };

const lowest = (from, to, curve, w0 = 1600) => {
  const p = F.flightPath(from, to, curve, w0);
  assert.ok(p, '곡선을 못 세웠다');
  let lo = Infinity;
  for (let k = 0; k <= 400; k++) lo = Math.min(lo, p(k / 400).zoom);
  return from.zoom - lo;
};

test('부드럽게 녹화의 곡선이 flyTo 와 같은 깊이로 내려간다', () => {
  // 위쪽 dipOf 는 mapbox 소스에서 옮긴 것, flightPath 는 recorder.js 안의 구현.
  // 서로 독립적으로 쓴 두 계산이 맞아야 '진짜 flyTo 와 같다'고 말할 수 있다.
  for (const [name, to, zoom] of [['부산', BUSAN, 8], ['파리', PARIS, 10]]) {
    for (const curve of [1.42, 2.0, 2.8, 4.0]) {
      const mine = lowest({ ...SEOUL, zoom }, { ...to, zoom }, curve);
      const ref  = dipOf({ from: SEOUL.center, to: to.center, zoom, curve });
      assert.ok(Math.abs(mine - ref) < 0.02,
        `${name} curve ${curve}: flightPath ${mine.toFixed(3)} vs flyTo ${ref.toFixed(3)}`);
    }
  }
});

test('곡선의 양 끝은 출발·도착과 정확히 맞물린다', () => {
  const p = F.flightPath(SEOUL, BUSAN, 2.8, 1600);
  const a = F.interpCam(SEOUL, BUSAN, 0, p), b = F.interpCam(SEOUL, BUSAN, 1, p);
  assert.ok(Math.abs(a.zoom - SEOUL.zoom) < 1e-6, `출발 줌이 어긋난다: ${a.zoom}`);
  assert.ok(Math.abs(b.zoom - BUSAN.zoom) < 1e-6, `도착 줌이 어긋난다: ${b.zoom}`);
  for (const [i, want] of [[0, SEOUL.center], [1, BUSAN.center]]) {
    const got = (i ? b : a).center;
    assert.ok(Math.abs(got[0] - want[0]) < 1e-6 && Math.abs(got[1] - want[1]) < 1e-6,
      `${i ? '도착' : '출발'} 중심이 어긋난다: ${got}`);
  }
});

test('중간에 실제로 줌이 내려간다 (양 끝 줌이 같아도)', () => {
  const dips = [1.42, 2.0, 2.8, 4.0].map((c) => lowest(SEOUL, BUSAN, c));
  assert.ok(dips[0] > 0.05, `직선 보간처럼 줌이 그대로다 (${dips[0].toFixed(3)})`);
  for (let i = 1; i < dips.length; i++) {
    assert.ok(dips[i] > dips[i - 1], `단계가 단조롭지 않다: ${dips.map((d) => d.toFixed(2)).join(' → ')}`);
  }
});

test('곡선이 없으면(직선 이동) 예전처럼 선형 보간', () => {
  const mid = F.interpCam(SEOUL, BUSAN, 0.5, null);
  assert.equal(mid.zoom, 8, '직선 이동인데 줌이 흔들린다');
});

test('제자리 이동은 곡선을 세우지 않는다 (0 으로 나눈다)', () => {
  assert.equal(F.flightPath(SEOUL, { ...SEOUL, zoom: 12 }, 2.8, 1600), null);
});

/* ── 경로를 따라가는 카메라 ──
   경로선을 아크로 그려 놓고 카메라는 최단거리로 가면, 화면에 그린 화살표가 밖으로 벗어난다.
   서울→런던에서 실제로 그랬다. 줌 곡선은 그대로 두고 중심만 경로 위를 지나게 한다. */
const P = extract('recorder/js/recorder.js', ['geoDist', 'pathFollower']);

const arc = (from, to, bend = 0.18, n = 48) => {
  const mid = [(from[0]+to[0])/2, (from[1]+to[1])/2];
  const dx = to[0]-from[0], dy = to[1]-from[1];
  const c = [mid[0] - dy*bend, mid[1] + dx*bend];
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = i/n, u = 1-t;
    return [u*u*from[0] + 2*u*t*c[0] + t*t*to[0], u*u*from[1] + 2*u*t*c[1] + t*t*to[1]];
  });
};

test('경로 따라가기: 양 끝이 경로의 끝과 맞는다', () => {
  const coords = arc([127.0, 37.55], [-0.13, 51.51]);
  const at = P.pathFollower(coords);
  assert.ok(at, '경로를 못 세웠다');
  for (const [t, want, label] of [[0, coords[0], '출발'], [1, coords.at(-1), '도착']]) {
    const got = at(t);
    assert.ok(Math.abs(got[0]-want[0]) < 1e-6 && Math.abs(got[1]-want[1]) < 1e-6,
      `${label}이 경로 끝과 다르다: ${got} vs ${want}`);
  }
});

test('경로 따라가기: 중간에 실제로 아크 위에 있다 (직선이 아니다)', () => {
  const from = [127.0, 37.55], to = [-0.13, 51.51];
  const coords = arc(from, to);
  const at = P.pathFollower(coords);
  const mid = at(0.5);
  const straight = [(from[0]+to[0])/2, (from[1]+to[1])/2];
  const off = Math.hypot(mid[0]-straight[0], mid[1]-straight[1]);
  assert.ok(off > 1, `아크 중간이 직선 중간과 ${off.toFixed(2)}° 밖에 안 떨어졌다 — 안 따라가고 있다`);
  /* 그리고 그 점은 경로 **위**에 있어야 한다. 꼭짓점까지의 거리로 재면 안 된다 —
     아크는 가운데가 성겨서 꼭짓점 간격이 2.6° 나 되고, 선분 한가운데면 당연히 멀다.
     선분까지의 거리로 재야 '경로 위인가'를 묻는 것이 된다. */
  let near = Infinity;
  for (let i = 1; i < coords.length; i++) {
    const [ax, ay] = coords[i-1], [bx, by] = coords[i];
    const dx = bx-ax, dy = by-ay, L = dx*dx + dy*dy;
    let u = L ? ((mid[0]-ax)*dx + (mid[1]-ay)*dy) / L : 0;
    u = u < 0 ? 0 : u > 1 ? 1 : u;
    near = Math.min(near, Math.hypot(mid[0]-ax-u*dx, mid[1]-ay-u*dy));
  }
  assert.ok(near < 1e-9, `경로에서 ${near.toExponential(2)}° 떨어져 있다 — 경로 위가 아니다`);
});

test('경로 따라가기: 거리에 비례해 나아간다 (꼭짓점 간격이 고르지 않아도)', () => {
  /* 아크는 양 끝이 촘촘하고 가운데가 성기다. 꼭짓점 번호로 나누면 속도가 들쭉날쭉해진다 —
     거리 기준이어야 화살표가 일정하게 자란다. */
  const coords = arc([127.0, 37.55], [-0.13, 51.51]);
  const at = P.pathFollower(coords);
  const seg = [];
  for (let i = 1; i <= 10; i++) seg.push(P.geoDist(at((i-1)/10), at(i/10)));
  const min = Math.min(...seg), max = Math.max(...seg);
  assert.ok(max / min < 1.2, `구간 길이가 ${(max/min).toFixed(2)} 배까지 벌어진다 — 거리 기준이 아니다`);
});

test('경로 따라가기: 점이 모자라면 세우지 않는다', () => {
  assert.equal(P.pathFollower([]), null);
  assert.equal(P.pathFollower([[127, 37]]), null);
  assert.equal(P.pathFollower([[127, 37], [127, 37]]), null);   // 길이 0
});

/* ── 정수 줌에 걸터앉지 않게 ──
   mapbox 는 정수 줌마다 다른 타일을 쓴다(Math.floor). 줌이 정수에 정확히 걸리면 곡선 공식의
   부동소수점 오차만으로 floor 가 뒤집혀 — 실측 7.999999999988 — 줌아웃이 없어도 타일이
   통째로 바뀐다. 화면은 도로가 있다 없다 하고, 콘솔에 줌을 찍으면 내내 8.000 이라 안 보인다. */
const Z = extract('recorder/js/recorder.js', ['DETAIL_EDGE', 'detailSafeZoom', 'detailSafeCam']);

test('줌아웃이 있으면 아래 칸 꼭대기에서 시작한다', () => {
  for (const [z, want] of [[6, 5.99], [8, 7.99], [10, 9.99], [8.02, 7.99]]) {
    assert.ok(Math.abs(Z.detailSafeZoom(z, true) - want) < 1e-9,
      `${z} → ${Z.detailSafeZoom(z, true)} (${want} 이어야 한다)`);
  }
});

test('줌아웃이 없으면 같은 칸 안쪽으로 뗀다 (칸을 바꾸면 정지 화면만 거칠어진다)', () => {
  for (const z of [6, 8, 10]) {
    const out = Z.detailSafeZoom(z, false);
    assert.ok(out > z, `${z} → ${out}: 위로 떼야 한다`);
    assert.equal(Math.floor(out), z, '타일 칸이 바뀌면 디테일이 떨어진다');
  }
});

test('이미 칸 안쪽이면 건드리지 않는다', () => {
  for (const z of [6.5, 7.2, 8.6, 9.34]) {
    assert.equal(Z.detailSafeZoom(z, true), z);
    assert.equal(Z.detailSafeZoom(z, false), z);
  }
});

test('떼어낸 값은 부동소수점 오차로 경계를 못 넘는다', () => {
  /* 실제로 걸린 문제다 — 8.0 에서 계산값이 7.999999999988 로 내려가 타일이 바뀌었다.
     떼어낸 폭이 그 오차보다 훨씬 커야 한다. */
  for (const dip of [true, false]) {
    const out = Z.detailSafeZoom(8, dip);
    assert.ok(Math.abs(out - Math.round(out)) > 1e-6,
      `${out} 은 경계에 너무 가깝다 — 오차로 뒤집힌다`);
  }
});

test('카메라의 나머지 값은 그대로 둔다', () => {
  const cam = { center: [127, 37.5], zoom: 8, bearing: 30, pitch: 45 };
  const out = Z.detailSafeCam(cam, true);
  assert.deepEqual(out.center, cam.center);
  assert.equal(out.bearing, 30);
  assert.equal(out.pitch, 45);
});

/* ── 녹화가 쓰는 카메라는 전부 떼어낸 것이어야 한다 ──
   출발·도착·경유지 중 하나라도 원본 카메라를 그대로 쓰면 그 지점에서 타일 칸이 달라져
   튄다. 실제로 뒤 정지(holdEnc)와 경유지 두 곳이 원본을 쓰고 있어서 도착에서만 튀었다.
   이 검사는 소스를 읽어 '녹화 흐름 안에서 원본 카메라를 쓰는 곳'을 찾는다 —
   함수를 꺼내 돌리는 것으로는 이런 배선 실수를 못 잡는다. */
test('녹화 흐름에서 원본 카메라를 쓰지 않는다', () => {
  const src = readSrc('recorder/js/recorder.js');
  /* 카메라를 실제로 쓰는 자리들. '출발/도착으로 이동' 버튼(go-start·go-end)은
     녹화와 무관하므로 제외한다. */
  const bad = [];
  const lines = src.split('\n');
  lines.forEach((line, i) => {
    if (/go-(start|end)/.test(line)) return;                  // 이동 버튼 — 원본이 맞다
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;              // 주석
    for (const call of ['animateTo(', 'holdEnc(', 'renderFrame(', 'jumpTo(']) {
      const at = line.indexOf(call);
      if (at < 0) continue;
      const arg = line.slice(at + call.length, at + call.length + 20);
      if (/^(startCam|endCam|stops\[[^\]]+\]\.cam|w\.cam)/.test(arg)) {
        bad.push(`${i + 1}: ${line.trim().slice(0, 80)}`);
      }
    }
  });
  assert.deepEqual(bad.slice(0, 3), [],
    `원본 카메라를 쓰는 곳 ${bad.length}군데 — 그 지점에서 타일 칸이 달라져 튄다`);
});



/* ── 직선 이동의 줌아웃 ──

   '이동 방식: 직선' 이면 줌이 출발→도착으로 곧게 보간될 뿐이라, 양 끝 줌이 같으면
   '이동 중 줌아웃'을 무엇으로 놔도 아무 일이 없었다.

   비행 곡선을 그대로 빌려 오면 안 된다. 그 곡선은 경로 전체가 화면에 들어오게 만드는
   것이라 거리가 멀수록 깊고 V 자로 뾰족해진다 — 서울→런던(양 끝 z8) '조금' 이
   5.87단계나 내려가고 바닥권 체류가 18.5% 뿐이라, 절반을 지나자마자 줌인이 시작되는
   것처럼 보였다. 직선은 중심이 등속으로 곧게 가므로 경로를 담을 이유가 없다. */
const dipsFor = (dip, to) => withUI(dip, () => F.straightDepth(dip, SEOUL, to, 1600));
const easePath = (dip, to) => withUI(dip, () => F.dipPath('ease', SEOUL, to, 1600));
const lowOf = (p, from = SEOUL) => {
  let lo = Infinity;
  for (let k = 0; k <= 1000; k++) lo = Math.min(lo, p(k / 1000).zoom);
  return from.zoom - lo;
};
const LONDON = { center: [-0.13, 51.51], zoom: 8, bearing: 0, pitch: 0 };
const easeInOut = (t) => (t < 0.5 ? 2*t*t : 1 - Math.pow(-2*t+2, 2)/2);   // recorder.js 와 같은 것

test("'없음'이면 직선 이동은 예전처럼 선형 보간", () => {
  assert.equal(easePath('0', BUSAN), null, "'없음' 인데 궤적을 세웠다");
  assert.equal(withUI('0', () => F.flyCurveNow('ease')), null, '직선이 비행 곡선을 쓴다');
});

test('직선 이동에서 줌이 실제로 내려간다 (양 끝 줌이 같아도)', () => {
  const p = easePath('1', BUSAN);
  assert.ok(p, '궤적을 못 세웠다');
  assert.ok(lowOf(p) > 0.5, `직선인데 줌이 그대로다 (${lowOf(p).toFixed(3)})`);
});

test('단계는 어느 거리에서나 자동 < 조금 < 보통 < 많이', () => {
  for (const [name, to] of [['부산', BUSAN], ['런던', LONDON]]) {
    const v = ['auto', '1', '2', '3'].map((d) => dipsFor(d, to));
    for (let i = 1; i < v.length; i++) {
      assert.ok(v[i] > v[i - 1],
        `서울→${name} 에서 단조롭지 않다: ${v.map((x) => x.toFixed(2)).join(' < ')}`);
    }
  }
});

test('먼 거리라고 폭이 폭발하지 않는다 — 최대 2배까지만', () => {
  /* 비행 곡선은 서울→부산 0.94 → 서울→런던 5.87 로 6배가 된다. 그래서 '조금' 이
     '많이' 처럼 보였다. 직선은 거리로 자라되 두 배를 넘지 않는다. */
  for (const dip of ['auto', '1', '2', '3']) {
    const near = dipsFor(dip, BUSAN), far = dipsFor(dip, LONDON);
    assert.ok(far > near, `${dip}: 먼 거리인데 폭이 안 늘었다`);
    assert.ok(far <= near * 2 + 1e-9, `${dip}: ${(far / near).toFixed(2)}배까지 벌어졌다`);
  }
  assert.ok(dipsFor('1', LONDON) < 2.5, `'조금' 이 ${dipsFor('1', LONDON).toFixed(2)}단계나 내려간다`);
});

test('바닥이 평평하다 — 절반을 지나자마자 줌인이 시작되지 않는다', () => {
  /* 비행 곡선은 먼 거리에서 바닥 체류가 18.5% 뿐이다(서울→런던). 앞뒤로 내려갔다
     올라오는 사이 가운데를 유지해야 줌인 타이밍이 이르게 느껴지지 않는다. */
  const p = easePath('1', LONDON);
  const lo = 8 - lowOf(p);
  let within = 0;
  for (let k = 0; k <= 1000; k++) if (p(k / 1000).zoom < lo + 0.5) within++;
  assert.ok(within / 1001 > 0.45, `바닥권 체류가 ${(within / 1001 * 100).toFixed(1)}% 뿐이다`);
});

test('줌인은 도착 즈음에 들어온다 (좌우 대칭이 아니다)', () => {
  /* 대칭으로 두면 절반을 지나자마자 줌인이 시작되는 것처럼 보인다. 도착 즈음에
     들어와야 어디에 도착하는지가 눈에 남는다. 구간 시간에는 easeInOut 이 한 번 더
     걸리므로 재생 시간 기준으로 봐야 한다. */
  const p = easePath('1', LONDON);
  const lo = 8 - lowOf(p);
  let start = 1;
  for (let k = 1000; k >= 0; k--) {                  // 마지막으로 바닥권에 있던 시점
    if (p(easeInOut(k / 1000)).zoom < lo + 0.5) { start = k / 1000; break; }
  }
  assert.ok(start > 0.65, `줌인이 재생 ${(start * 100).toFixed(0)}% 지점에 벌써 시작된다`);
  assert.ok(start < 0.92, `줌인이 재생 ${(start * 100).toFixed(0)}% 에야 시작돼 도착에서 튄다`);
  assert.ok(F.DIP_UP < F.DIP_DOWN, '올라오는 구간이 내려가는 구간보다 짧아야 늦게 들어온다');
});

test('종 모양은 양 끝에서 0 이고 가운데는 1 로 평평하다', () => {
  const [down, up] = [0.3, 0.25];
  assert.equal(F.dipBell(0, down, up), 0);
  assert.equal(F.dipBell(1, down, up), 0);
  assert.equal(F.dipBell(down, down, up), 1, '내려간 자리에서 바로 바닥이어야 평평한 구간이 생긴다');
  assert.equal(F.dipBell(1 - up, down, up), 1);
  for (let k = 0; k <= 100; k++) {                   // 가운데는 통째로 바닥이다
    const t = down + (1 - up - down) * (k / 100);
    assert.equal(F.dipBell(t, down, up), 1, `가운데가 평평하지 않다 (t=${t})`);
  }
});

test('깊이 내려갈수록 오르내리는 데 오래 쓴다', () => {
  /* 폭을 고정해 두면 '많이'(서울→런던 6.35단계)가 줌 시간 2.5초에서 초당 18.9단계로
     튄다. 지배적인 항은 깊이 ÷ 줌 시간이라 폭으로는 다 못 잡지만, 가장 거친 쪽을
     집중적으로 완화한다. */
  const spans = [1, 2, 4, 8].map((d) => [F.dipSpan(F.DIP_DOWN, d), F.dipSpan(F.DIP_UP, d)]);
  for (let i = 1; i < spans.length; i++) {
    assert.ok(spans[i][0] >= spans[i-1][0] && spans[i][1] >= spans[i-1][1],
      `깊어졌는데 폭이 줄었다: ${JSON.stringify(spans)}`);
  }
  const [dn, up] = spans[spans.length - 1];
  assert.ok(dn + up < 0.85, `전부 오르내리는 데 써서 바닥이 없다 (${dn}+${up})`);
  assert.ok(up < dn, '올라오는 구간이 더 길면 줌인이 일찍 시작돼 도착지에서 멀어진다');
});

const rateOf = (dip, to, dur = 2.5) => {
  const p = withUI(dip, () => F.dipPath('ease', SEOUL, to, 1600));
  let mx = 0;
  for (let k = 1; k <= 2000; k++) {
    const r = Math.abs(p(easeInOut(k / 2000)).zoom - p(easeInOut((k - 1) / 2000)).zoom) * 2000 / dur;
    if (r > mx) mx = r;
  }
  return mx;
};

test('줌 변화율이 줌 시간에 반비례한다 — 완만하게 하려면 시간을 늘린다', () => {
  const fast = rateOf('2', LONDON, 2.5), slow = rateOf('2', LONDON, 5);
  assert.ok(Math.abs(fast / slow - 2) < 1e-6, `시간을 두 배로 줬는데 ${(fast/slow).toFixed(2)}배다`);
});

test('화면상 속도가 고르다 — 중심을 등속으로 두면 중간 지점으로 줌인한다', () => {
  /* 화면상 속도는 2^줌 에 비례한다. 중심을 등속으로 두면 줌이 낮은 동안 화면이 기어가고
     줌이 올라오면 휙 지나간다 — 서울→런던에서 줌인이 시작될 때 중심이 아직 중부 유럽이라
     런던이 아니라 중간 지점으로 줌인하는 것처럼 보였다.
     진행도를 2^-줌 에 비례하게 매겨 화면상 속도를 고르게 한다. */
  for (const [name, to] of [['부산', BUSAN], ['런던', LONDON]]) {
    for (const dip of ['1', '3']) {
      const p = withUI(dip, () => F.dipPath('ease', SEOUL, to, 1600));
      const v = [];
      for (let k = 1; k <= 400; k++) {
        const x = p((k - 1) / 400), y = p(k / 400);
        v.push((y.d - x.d) * Math.pow(2, (x.zoom + y.zoom) / 2));
      }
      const spread = Math.max(...v) / Math.min(...v);
      assert.ok(spread < 1.1, `서울→${name} ${dip}: 화면상 속도가 ${spread.toFixed(2)}배까지 벌어진다`);
      assert.ok(v.every((x) => x > 0), `서울→${name} ${dip}: 중심이 뒤로 간다`);
    }
  }
});

test('줌인이 시작될 때는 이미 도착지 위에 있다', () => {
  /* 이게 어긋나면 "중간 지점으로 줌인" 으로 보인다. 서울→런던은 남은 4% 도 400km 라
     자리가 아주 좁다 — 그래서 거리 기준으로 못을 박아 둔다. */
  for (const dip of ['1', '3']) {
    const p = withUI(dip, () => F.dipPath('ease', SEOUL, LONDON, 1600));
    const lo = 8 - lowOf(p);
    let start = 1;
    for (let k = 1000; k >= 0; k--) {
      if (p(easeInOut(k / 1000)).zoom < lo + 0.5) { start = k / 1000; break; }
    }
    const gone = p(easeInOut(start)).d;
    assert.ok(gone > 0.88,
      `${dip}: 줌인이 시작될 때 거리의 ${(gone * 100).toFixed(1)}% 밖에 안 갔다`);
  }
});

test('직선 이동도 양 끝은 출발·도착과 정확히 맞물린다', () => {
  const p = easePath('3', LONDON);
  const a = F.interpCam(SEOUL, LONDON, 0, p), b = F.interpCam(SEOUL, LONDON, 1, p);
  assert.ok(Math.abs(a.zoom - SEOUL.zoom) < 1e-9, `출발 줌이 어긋난다: ${a.zoom}`);
  assert.ok(Math.abs(b.zoom - LONDON.zoom) < 1e-9, `도착 줌이 어긋난다: ${b.zoom}`);
  assert.ok(Math.abs(b.center[0] - LONDON.center[0]) < 1e-6, `도착 중심이 어긋난다: ${b.center}`);
});

test('비행은 예전 그대로다 — 직선용 궤적이 끼어들지 않는다', () => {
  const flyP = withUI('1', () => F.dipPath('fly', SEOUL, BUSAN, 1600));
  const ref = F.flightPath(SEOUL, BUSAN, 2.0, 1600);
  for (const t of [0.25, 0.5, 0.75]) {
    assert.ok(Math.abs(flyP(t).zoom - ref(t).zoom) < 1e-12, '비행 곡선이 바뀌었다');
    assert.ok(Math.abs(flyP(t).d - ref(t).d) < 1e-12, '비행의 완급이 사라졌다');
  }
});

/* ── 선과 카메라가 같은 잣대로 간다 ──
   선은 거리 비율로 자라고 카메라는 곡선이 정한 진행도로 간다. 두 잣대가 다르면
   선 끝의 화살표가 카메라 중앙에서 벗어난다 — 서울→런던에서 비행은 2,598km,
   직선은 722km 까지 벌어졌다. 경로를 따라갈 때는 선도 카메라의 진행도로 자란다. */
test('경로를 따라갈 때는 선 성장에 카메라의 진행도를 넘긴다', () => {
  const src = readSrc('recorder/js/recorder.js');

  // 실시간 녹화: grow 에 진행도를 넘기는가
  assert.match(src, /grow\(legT, follow \? \(flight \? flight\(t\)\.d : t\) : null\)/,
    '실시간 녹화가 선을 시간으로만 자라게 한다');

  // 부드럽게 녹화: legFrac 에 넘기는 값이 카메라 진행도인가
  assert.match(src, /const prog = follow \? \(path \? path\(t\)\.d : t\) : t;/,
    '부드럽게 녹화가 선을 시간으로만 자라게 한다');
  assert.match(src, /setRouteData\(partialPath\(pathCoords, legFrac\(L, prog, totalLegs\)\)\)/,
    '계산해 놓고 안 쓴다');
});
