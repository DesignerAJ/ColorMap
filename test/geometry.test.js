/* 경로·좌표 계산. 이번에 실제로 났던 버그를 그대로 재현해 막아둔다. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { extract } from './helpers/extract.js';

const G = extract('recorder/js/recorder.js', [
  'easeInOut', 'geoDist', 'wrapDist', 'lerpPt', 'partialPath',
  'unwrapLng', 'unwrapSeq', 'arcSegment', 'parseCoords',
]);

// 하버사인 — 계산을 검산할 독립 기준
const km = (a, b) => {
  const R = 6371, r = Math.PI / 180;
  const dLat = (b[1] - a[1]) * r, dLng = (b[0] - a[0]) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1]*r) * Math.cos(b[1]*r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};
const pathKm = (c) => c.slice(1).reduce((s, p, i) => s + km(c[i], p), 0);
const arcPath = (pts) => {
  const seq = G.unwrapSeq(pts);
  const out = [seq[0]];
  for (let i = 1; i < seq.length; i++) out.push(...G.arcSegment(seq[i-1], seq[i]).slice(1));
  return out;
};

test('날짜변경선: 서울→LA 는 태평양으로 간다', () => {
  const SEOUL = [126.98, 37.57], LA = [-118.24, 34.05];
  const p = arcPath([SEOUL, LA]);
  const direct = km(SEOUL, LA);                       // 대권거리 ≈ 9,586km
  assert.ok(pathKm(p) < direct * 1.4,
    `경로 ${Math.round(pathKm(p))}km 가 대권거리 ${Math.round(direct)}km 대비 너무 길다 — 지구 반대로 돌고 있다`);
  const mid = p[Math.floor(p.length / 2)][0];
  assert.ok(mid > 180 && mid < 250, `중간점 경도 ${mid.toFixed(0)} — 태평양(180~250)을 지나야 한다`);
});

test('날짜변경선을 안 넘는 경로는 좌표가 그대로다', () => {
  // 부동소수 오차만 허용 — 360 을 더하거나 빼면 이 허용치를 한참 넘는다
  for (const [a, b] of [[[126.98,37.57],[2.35,48.86]], [[126.98,37.57],[129.08,35.18]], [[-118.24,34.05],[-74,40.7]]]) {
    const [, moved] = G.unwrapSeq([a, b]);
    assert.ok(Math.abs(moved[0] - b[0]) < 1e-9, `${b[0]} → ${moved[0]} 로 옮겨졌다`);
    assert.equal(moved[1], b[1]);
  }
});

test('unwrapLng 는 항상 짧은 쪽을 고른다', () => {
  assert.equal(G.unwrapLng(127, -118).toFixed(0), '242');   // 태평양 쪽
  assert.equal(G.unwrapLng(-118, 127).toFixed(0), '-233');  // 반대 방향도 대칭
  assert.equal(G.unwrapLng(10, 20), 20);                    // 안 넘으면 그대로
  assert.ok(Math.abs(G.unwrapLng(179, -179) - 181) < 1e-9); // 경계 바로 옆
});

test('geoDist 는 위도를 보정한다 (평면 도 단위와 달라야 한다)', () => {
  const eq = G.geoDist([0, 0], [1, 0]);          // 적도에서 경도 1도
  const hi = G.geoDist([0, 60], [1, 60]);        // 위도 60에서 경도 1도
  assert.ok(hi < eq * 0.55 && hi > eq * 0.45, `위도 60에서는 절반쯤이어야 한다 (${(hi/eq).toFixed(2)}배)`);
  assert.ok(Math.abs(G.geoDist([0,0],[0,1]) - 1) < 1e-9, '위도 방향은 보정 없이 1도');
});

test('partialPath 가 경유지 비율을 그대로 재현한다 (거리 잣대 통일)', () => {
  // 위도가 변하는 경로 — 도 단위와 실제 거리가 크게 갈리는 조건
  const pts = [[0, 0], [40, 0], [40, 70], [80, 70]];
  const coords = arcPath(pts);
  // 경유지가 놓인 거리 비율을 geoDist 로 계산
  const cum = [0];
  for (let i = 1; i < coords.length; i++) cum.push(cum[i-1] + G.geoDist(coords[i-1], coords[i]));
  const total = cum[cum.length - 1];
  for (const k of [1, 2]) {
    let best = 0, bd = Infinity;
    for (let i = 0; i < coords.length; i++) { const d = G.wrapDist(pts[k], coords[i]); if (d < bd) { bd = d; best = i; } }
    const frac = cum[best] / total;
    const tip = G.partialPath(coords, frac).at(-1);
    assert.ok(km(tip, pts[k]) < 30,
      `경유지 ${k} 에서 ${Math.round(km(tip, pts[k]))}km 어긋남 — 선과 카메라가 따로 논다`);
  }
});

test('partialPath 의 양 끝과 겹친 점 처리', () => {
  const c = [[0,0],[1,0],[1,0],[2,0]];                    // 길이 0 인 구간 포함
  assert.deepEqual(G.partialPath(c, 0), [[0,0]]);
  assert.deepEqual(G.partialPath(c, 1), c);
  const mid = G.partialPath(c, 0.5).at(-1);
  assert.ok(Number.isFinite(mid[0]) && Number.isFinite(mid[1]), 'NaN 이 나오면 안 된다');
});

test('wrapDist 는 경도 표기가 달라도 같은 거리로 본다', () => {
  const a = G.wrapDist([-118, 34], [242, 34]);            // 같은 지점, 다른 표기
  assert.ok(a < 1e-6, `${a} — 0 이어야 한다`);
});

test('parseCoords: 위도·경도 순서를 알아서 잡는다', () => {
  assert.deepEqual(G.parseCoords('37.5, 127.0'), { lat: 37.5, lng: 127 });
  assert.deepEqual(G.parseCoords('127.0, 37.5'), { lat: 37.5, lng: 127 });   // 뒤집혀도 복구
  assert.deepEqual(G.parseCoords('37.5 127.0'), { lat: 37.5, lng: 127 });    // 공백 구분
  assert.deepEqual(G.parseCoords('37.5/127.0'), { lat: 37.5, lng: 127 });    // 슬래시
  assert.equal(G.parseCoords('서울'), null);
  assert.equal(G.parseCoords('200, 300'), null);                             // 범위 밖
});

test('easeInOut 은 0→1 로 단조 증가한다', () => {
  assert.equal(G.easeInOut(0), 0);
  assert.equal(G.easeInOut(1), 1);
  let prev = -1;
  for (let t = 0; t <= 1.0001; t += 0.05) { const v = G.easeInOut(t); assert.ok(v >= prev); prev = v; }
});
