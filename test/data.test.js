/* 경계 데이터 무결성.
   이 파일들은 손으로 만들지 않고 build-sido-hires.mjs · build-nk-admin1.mjs 가 생성한다.
   생성기를 고칠 때마다 여기서 걸리게 해 둔다 — 눈으로는 안 보이는 문제들이다. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readJSON } from './helpers/extract.js';

const hires = readJSON('recorder/js/data/sido-hires.json');
const border = readJSON('recorder/js/data/korea-border.json');
const admin1 = readJSON('recorder/js/data/admin1.json');

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

/* ── 북한 1급 행정구역 (build-nk-admin1.mjs) ──
   원래 admin1.json 의 북한 경계는 도당 100~220점짜리라 우리 시도 옆에서 눈에 띄게 각졌고,
   군사분계선이 우리 경기·강원과 중앙값 1.75~6.6km 어긋나 같이 칠하면 선이 겹치거나 벌어졌다. */

const NK = admin1.features.filter((f) => f.properties.country === '북한');
const nkRings = (f) => ringsOf(f.geometry).flat();

test('북한 1급 행정구역이 13개다 (개성·남포가 빠져 있었다)', () => {
  assert.equal(NK.length, 13, `북한이 ${NK.length}개`);
  for (const n of ['개성특별시', '남포특별시', '평양직할시', '라선특별시'])
    assert.ok(NK.some((f) => f.properties.short === n), `${n} 없음`);
});

test('북한 경계가 우리 시도급으로 촘촘하다', () => {
  /* 저해상도로 되돌아가면 여기서 걸린다. 예전 값은 도당 100~220점이었다. */
  const thin = NK.filter((f) => nkRings(f).reduce((s, r) => s + r.length, 0) < 500)
    .map((f) => f.properties.short);
  assert.deepEqual(thin, [], '이 도들이 저해상도로 돌아갔다');
});

test('북한 링이 닫혀 있고 점이 3개 이상이다', () => {
  for (const f of NK) for (const r of nkRings(f)) {
    assert.ok(r.length >= 4, `${f.properties.short}: 링 점 ${r.length}개`);
    assert.deepEqual(r[0], r.at(-1), `${f.properties.short}: 링이 닫히지 않음`);
  }
});

test('군사분계선이 북한 경계와 꼭짓점 단위로 붙는다', () => {
  /* 우리 국경선(= 경기·강원의 북쪽 변)을 북한 쪽 폴리곤에 그대로 치환해 넣었으므로,
     선 위의 점은 전부 북한 경계 위에 있어야 한다. 어긋나면 두 색칠 사이가 벌어진다.

     양 끝 6km 는 뺀다 — 거기서는 국경선이 해안에 닿고, 우리 해안선(국토부)과
     북한 해안선(OSM)이 원래 다른 데이터라 최대 5km 차이가 난다. 군사분계선 문제가 아니다. */
  const KM = (dx, dy, lat) => Math.hypot(dx * 111 * Math.cos(lat * Math.PI / 180), dy * 111);

  const segs = [];                       // 북한 변 — 경도 0.1° 칸으로 나눠 담는다 (5,806 × 전수 비교는 느리다)
  const bucket = new Map();
  for (const f of NK) for (const r of nkRings(f)) for (let i = 1; i < r.length; i++) {
    if (Math.max(r[i][1], r[i-1][1]) < 37.4 || Math.min(r[i][1], r[i-1][1]) > 39) continue;
    const k = segs.push([r[i-1], r[i]]) - 1;
    for (let b = Math.floor(Math.min(r[i][0], r[i-1][0]) * 10); b <= Math.floor(Math.max(r[i][0], r[i-1][0]) * 10); b++)
      (bucket.get(b) || bucket.set(b, []).get(b)).push(k);
  }
  const near = (pt) => [Math.floor(pt[0]*10) - 1, Math.floor(pt[0]*10), Math.floor(pt[0]*10) + 1]
    .flatMap((b) => bucket.get(b) || []);

  /* 선의 양 끝(해안에 닿는 두 점). 조각이 여러 개라 '한 번만 나오는 끝점'이 바다 쪽 끝이다 —
     조각끼리 맞물리는 가운데 이음매를 끝으로 잘못 보면 멀쩡한 10km 를 그냥 건너뛰게 된다. */
  const ends = new Map();
  for (const f of border.features) for (const p of [f.geometry.coordinates[0], f.geometry.coordinates.at(-1)]) {
    const k = p[0].toFixed(6) + ',' + p[1].toFixed(6);
    ends.set(k, (ends.get(k) || 0) + 1);
  }
  const tips = [...ends].filter(([, n]) => n === 1).map(([k]) => k.split(',').map(Number));
  assert.equal(tips.length, 2, `국경선의 끝이 ${tips.length}개 — 조각이 끊겼다`);

  for (const f of border.features) {
    const c = f.geometry.coordinates;
    for (let i = 0; i < c.length; i++) {
      if (tips.some((t) => KM(c[i][0]-t[0], c[i][1]-t[1], c[i][1]) < 6)) continue;
      let best = Infinity;
      for (const k of near(c[i])) {
        const [a, b] = segs[k];
        const dx = b[0]-a[0], dy = b[1]-a[1], L = dx*dx + dy*dy;
        let t = L ? ((c[i][0]-a[0])*dx + (c[i][1]-a[1])*dy) / L : 0;
        t = Math.max(0, Math.min(1, t));
        const d = KM(c[i][0]-(a[0]+dx*t), c[i][1]-(a[1]+dy*t), c[i][1]);
        if (d < best) best = d;
        if (best === 0) break;
      }
      assert.ok(best < 0.001, `국경선 ${c[i]} 이 북한 경계에서 ${best.toFixed(3)}km 떨어져 있다`);
    }
  }
});

test('북한 도가 바다를 칠하지 않는다', () => {
  /* OSM 행정경계는 영해까지 포함한다 — 그대로 쓰면 황해남도를 칠했을 때 서해가 통째로
     칠해졌다. build-nk-admin1.mjs 가 해안선으로 잘라낸다. 그게 풀리면 여기서 걸린다.

     좌표는 실제로 바다인 곳만 골랐다. '남포 앞바다'처럼 바다처럼 보여도 0.3km 옆에
     섬이 있는 지점이 있어서, 넣기 전에 OSM 에서 섬이 없는지 확인해야 한다. */
  const SEA = {
    '연평도 북쪽': [125.60, 37.70],
    '백령도 동쪽': [124.95, 37.95],
    '서한만': [124.60, 39.40],
    '동해 청진 앞': [130.10, 41.80],
    '동해 원산 앞': [128.00, 39.20],
  };
  const painted = [];
  for (const [name, pt] of Object.entries(SEA)) {
    const by = NK.filter((f) => nkRings(f).some((r) => inRing(pt, r))).map((f) => f.properties.short);
    if (by.length) painted.push(`${name} → ${by.join(',')}`);
  }
  assert.deepEqual(painted, [], '바다가 칠해진다');
});

test('바다를 잘라내도 북한 섬이 남아 있다', () => {
  /* 해안선으로 자르면 본토만 남고 섬이 사라진다 — 되붙이는 단계가 빠지면 여기서 걸린다.
     갈도·장재도·무도는 연평도 북쪽의 북한 섬이다 (OSM 에 북한 군부대가 함께 태그돼 있다). */
  for (const [name, pt] of Object.entries({
    '갈도': [125.6530, 37.7156], '장재도': [125.6492, 37.7364], '무도': [125.5769, 37.7419],
  })) {
    const by = NK.filter((f) => nkRings(f).some((r) => inRing(pt, r))).map((f) => f.properties.short);
    assert.deepEqual(by, ['황해남도'], `${name} 이 황해남도로 안 칠해진다 (${by.join(',') || '아무데도 없음'})`);
  }
});

test('북한 색칠이 우리 섬을 침범하지 않는다', () => {
  for (const [name, pt] of Object.entries({
    '대연평도': [125.6967, 37.6653], '소연평도': [125.7130, 37.6094],
    '백령도': [124.7100, 37.9650], '강화도': [126.45, 37.72],
  })) {
    const by = NK.filter((f) => nkRings(f).some((r) => inRing(pt, r))).map((f) => f.properties.short);
    assert.deepEqual(by, [], `${name} 을 북한이 칠한다`);
  }
});
