/* 경계 데이터 무결성.
   이 파일들은 손으로 만들지 않고 build-sido-hires.mjs 가 생성한다.
   생성기를 고칠 때마다 여기서 걸리게 해 둔다 — 눈으로는 안 보이는 문제들이다. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readJSON } from './helpers/extract.js';

const hires = readJSON('recorder/js/data/sido-hires.json');
const border = readJSON('recorder/js/data/korea-border.json');

const ringsOf = (g) => g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
const feat = (name) => hires.features.find((f) => f.properties.name.startsWith(name));
const polysOf = (name) => ringsOf(feat(name).geometry);

function inRing(pt, r) {
  let c = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i], [xj, yj] = r[j];
    if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
const inside = (pt, polys) => polys.some((p) => inRing(pt, p[0]) && !p.slice(1).some((h) => inRing(pt, h)));

const SIDO = ['서울특별시','부산광역시','대구광역시','인천광역시','광주광역시','대전광역시','울산광역시',
  '세종특별자치시','경기도','강원특별자치도','충청북도','충청남도','전북특별자치도','전라남도',
  '경상북도','경상남도','제주특별자치도'];

test('시도 17개가 모두 있다', () => {
  assert.equal(hires.features.length, 17);
  for (const n of SIDO) assert.ok(feat(n), `${n} 없음`);
});

test('자기교차(핀치)가 없다 — 화면에 삼각형 스파이크가 뻗는 원인', () => {
  const bad = [];
  for (const f of hires.features) for (const poly of ringsOf(f.geometry)) for (const ring of poly) {
    const seen = new Set();
    for (let i = 0; i < ring.length - 1; i++) {
      const k = ring[i][0] + ',' + ring[i][1];
      if (seen.has(k)) bad.push(`${f.properties.name} @ ${k}`);
      else seen.add(k);
    }
  }
  assert.deepEqual(bad.slice(0, 5), [], `핀치 ${bad.length}곳`);
});

test('링이 모두 닫혀 있고 점이 3개 이상이다', () => {
  for (const f of hires.features) for (const poly of ringsOf(f.geometry)) for (const ring of poly) {
    assert.ok(ring.length >= 4, `${f.properties.name}: 링 점 ${ring.length}개`);
    assert.deepEqual(ring[0], ring.at(-1), `${f.properties.name}: 링이 닫히지 않음`);
  }
});

test('각 시도가 자기 대표 지점을 칠한다', () => {
  const PT = {
    '서울특별시': [126.978, 37.566], '부산광역시': [129.075, 35.180], '대구광역시': [128.601, 35.869],
    '인천광역시': [126.705, 37.456], '광주광역시': [126.851, 35.160], '대전광역시': [127.385, 36.350],
    '울산광역시': [129.311, 35.539], '세종특별자치시': [127.289, 36.480], '경기도': [127.010, 37.290],
    '강원특별자치도': [127.729, 37.881], '충청북도': [127.490, 36.635], '충청남도': [126.800, 36.658],
    '전북특별자치도': [127.109, 35.820], '전라남도': [126.911, 34.816], '경상북도': [128.505, 36.576],
    '경상남도': [128.681, 35.228], '제주특별자치도': [126.531, 33.499],
  };
  for (const [n, pt] of Object.entries(PT)) {
    assert.ok(inside(pt, polysOf(n)), `${n} 이 자기 대표 지점을 안 칠한다`);
  }
});

test('도 안에 박힌 광역시는 그 도를 칠해도 안 칠해진다 (구멍이 뚫려 있다)', () => {
  for (const [inner, pt, outer] of [
    ['대구', [128.601, 35.869], '경상북도'], ['광주', [126.851, 35.160], '전라남도'],
    ['대전', [127.385, 36.350], '충청남도'], ['울산', [129.311, 35.539], '경상남도'],
    ['세종', [127.289, 36.480], '충청남도'], ['부산', [129.075, 35.180], '경상남도'],
  ]) assert.ok(!inside(pt, polysOf(outer)), `${outer} 를 칠하니 ${inner} 까지 칠해진다`);
});

test('새만금: 매립지는 전북, 수면과 먼바다는 아니다', () => {
  const jb = polysOf('전북특별자치도');
  assert.ok(!inside([126.58, 35.82], jb), '새만금호 수면이 칠해졌다 (바다를 칠한 것처럼 보인다)');
  assert.ok(!inside([126.30, 35.80], jb), '방조제 바깥 먼바다가 칠해졌다');
  assert.ok(inside([126.72, 35.97], jb), '군산 내륙이 안 칠해졌다');
});

test('국경선이 색칠 경계와 꼭짓점 단위로 붙는다', () => {
  const segs = [];
  for (const n of ['경기도', '강원특별자치도']) for (const poly of polysOf(n)) for (const r of poly)
    for (let i = 1; i < r.length; i++) if (r[i][1] > 37.6) segs.push([r[i-1], r[i]]);
  const KM = (dx, dy, lat) => Math.hypot(dx * 111 * Math.cos(lat * Math.PI / 180), dy * 111);
  let worst = 0;
  for (const f of border.features) for (const pt of f.geometry.coordinates) {
    let best = Infinity;
    for (const [a, b] of segs) {
      const dx = b[0]-a[0], dy = b[1]-a[1], L = dx*dx + dy*dy;
      let t = L ? ((pt[0]-a[0])*dx + (pt[1]-a[1])*dy) / L : 0;
      t = Math.max(0, Math.min(1, t));
      const d = KM(pt[0]-(a[0]+dx*t), pt[1]-(a[1]+dy*t), pt[1]);
      if (d < best) best = d;
      if (best === 0) break;
    }
    if (best > worst) worst = best;
  }
  assert.ok(worst < 0.001, `국경선이 색칠에서 최대 ${worst.toFixed(3)}km 떨어져 있다`);
});

test('국경선에 도 경계가 섞이지 않았다 (연천–철원 구간)', () => {
  const cnt = new Map();
  const key = (p) => p[0].toFixed(6) + ',' + p[1].toFixed(6);
  const und = (a, b) => { const x = key(a), y = key(b); return x < y ? x + '|' + y : y + '|' + x; };
  for (const n of ['경기도', '강원특별자치도']) for (const poly of polysOf(n)) for (const r of poly)
    for (let i = 1; i < r.length; i++) if (r[i][1] > 37.6) cnt.set(und(r[i-1], r[i]), (cnt.get(und(r[i-1], r[i])) || 0) + 1);
  let shared = 0;
  for (const f of border.features) { const c = f.geometry.coordinates;
    for (let i = 1; i < c.length; i++) if ((cnt.get(und(c[i-1], c[i])) || 0) >= 2) shared++; }
  assert.equal(shared, 0, `도 경계 ${shared}개가 국경선으로 그려진다`);
});

test('국경선이 서해에서 동해까지 끊김 없이 이어진다', () => {
  const covered = new Set();
  for (const f of border.features) { const c = f.geometry.coordinates;
    for (let i = 1; i < c.length; i++) {
      const lo = Math.min(c[i-1][0], c[i][0]), hi = Math.max(c[i-1][0], c[i][0]);
      for (let x = Math.floor(lo * 100); x <= Math.floor(hi * 100); x++) covered.add(x);
    } }
  const holes = [];
  for (let x = Math.floor(126.52 * 100); x <= Math.floor(128.39 * 100); x++) if (!covered.has(x)) holes.push(x / 100);
  assert.deepEqual(holes.slice(0, 5), [], `선이 지나지 않는 경도 ${holes.length}칸`);
});
