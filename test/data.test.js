/* 경계 데이터 무결성.
   이 파일들은 손으로 만들지 않고 build-sido-hires.mjs · build-nk-admin1.mjs 가 생성한다.
   생성기를 고칠 때마다 여기서 걸리게 해 둔다 — 눈으로는 안 보이는 문제들이다. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { readJSON, readSrc, ROOT } from './helpers/extract.js';

const hires = readJSON('recorder/js/data/sido-hires.json');
const border = readJSON('recorder/js/data/korea-border.json');
const admin1 = readJSON('recorder/js/data/admin1.json');

/* 국경선은 두 종류가 한 파일에 있다.
   land   — 우리 시도 데이터에서 뽑은 육상 군사분계선. 색칠과 꼭짓점 단위로 붙어야 한다.
   shore   — 고성 종점에서 해안선까지 227m. 우리 시도 경계는 VWorld 가 DMZ 를 빼서
             해안선보다 안쪽에서 끝나므로, 그대로 두면 선이 바다에 못 닿는다.
   estuary — 한강 하구부터 서쪽. 정전협정상 중립수역이라 군사분계선이 없고, 우리 데이터로는
            만들 수 없어 OSM 의 KP-KR 경계를 쓴다. 물 위라 어느 색칠과도 맞물리지 않는다.
   아래 검사들은 반드시 land 만 본다 — estuary 를 섞으면 전부 실패한다. */
const landBorder = border.features.filter((f) => (f.properties || {}).kind === 'land');
const estuary = border.features.filter((f) => (f.properties || {}).kind === 'estuary');

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
  for (const f of landBorder) for (const pt of f.geometry.coordinates) {
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
  for (const f of landBorder) { const c = f.geometry.coordinates;
    for (let i = 1; i < c.length; i++) if ((cnt.get(und(c[i-1], c[i])) || 0) >= 2) shared++; }
  assert.equal(shared, 0, `도 경계 ${shared}개가 국경선으로 그려진다`);
});

test('국경선이 하구부터 동해까지 끊김 없이 이어진다', () => {
  /* 양 끝은 일부러 거기서 끝난다 —
       서쪽 126.136  말도(강화군 서도면). 그 서쪽은 NLL 이라 성격이 다른 선이다.
       동쪽 128.357  군사분계선이 동해에 닿는 강원도 최북단. 예전에는 여기서 멈추지 않고
                     해안을 따라 5.8km 더 남쪽으로 내려가, 그만큼의 해안이 북한 쪽에
                     놓인 것처럼 보였다. */
  const covered = new Set();
  for (const f of border.features) { const c = f.geometry.coordinates;
    for (let i = 1; i < c.length; i++) {
      const lo = Math.min(c[i-1][0], c[i][0]), hi = Math.max(c[i-1][0], c[i][0]);
      for (let x = Math.floor(lo * 100); x <= Math.floor(hi * 100); x++) covered.add(x);
    } }
  const holes = [];
  for (let x = Math.floor(126.14 * 100); x <= Math.floor(128.35 * 100); x++) if (!covered.has(x)) holes.push(x / 100);
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
  for (const f of landBorder) for (const p of [f.geometry.coordinates[0], f.geometry.coordinates.at(-1)]) {
    const k = p[0].toFixed(6) + ',' + p[1].toFixed(6);
    ends.set(k, (ends.get(k) || 0) + 1);
  }
  const tips = [...ends].filter(([, n]) => n === 1).map(([k]) => k.split(',').map(Number));
  assert.equal(tips.length, 2, `국경선의 끝이 ${tips.length}개 — 조각이 끊겼다`);

  for (const f of landBorder) {
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

/* ── 국가 단위 색칠용 남·북한 폴리곤 (build-korea-countries.mjs) ──
   Mapbox 의 country-boundaries-v1 은 연평도 북쪽 북한 섬 넷을 KOR 로 분류하고,
   시도·시군구 색칠(국토부)과 같은 자리에서 최대 3.1km 어긋났다. 남·북한만 우리
   데이터로 그려 둘 다 없앤다. */

const countries = readJSON('recorder/js/data/korea-countries.json');
/* 나라마다 feature 하나가 아니라 시도·도마다 하나다 (거대한 feature 하나는 삼각분할이
   깨져 화면에 삼각형이 뻗는다). 그래서 iso 로 묶어서 본다. */
const countryFeats = (iso) => countries.features.filter((f) => f.properties.iso_3166_1_alpha_3 === iso);
const inCountry = (pt, iso) => countryFeats(iso).some((f) => ringsOf(f.geometry)
  .some((p) => inRing(pt, p[0]) && !p.slice(1).some((h) => inRing(pt, h))));

test('국가 폴리곤에 KOR·PRK 가 모두 있다', () => {
  assert.equal(countryFeats('KOR').length, 17, '대한민국이 시도 17개로 나뉘어 있어야 한다');
  assert.equal(countryFeats('PRK').length, 13, '북한이 도 13개로 나뉘어 있어야 한다');
});

test('연평도 북쪽 북한 섬 넷이 북한이다', () => {
  /* Mapbox 는 이 넷을 KOR 로 준다 — 대한민국을 칠하면 북한 섬이 함께 칠해졌다.
     황해남도 해역 섬 62개를 Tilequery 로 전부 확인했고 틀린 건 이 넷뿐이었다. */
  for (const [name, pt] of Object.entries({
    '갈도': [125.6530, 37.7156], '장재도': [125.6492, 37.7364],
    '무도': [125.5769, 37.7419], '료도': [126.1948, 37.8170],
  })) {
    assert.ok(inCountry(pt, 'PRK'), `${name} 이 북한이 아니다`);
    assert.ok(!inCountry(pt, 'KOR'), `${name} 이 대한민국으로 칠해진다 — 방송 사고`);
  }
});

test('우리 섬과 내륙은 대한민국이다', () => {
  for (const [name, pt] of Object.entries({
    '대연평도': [125.6967, 37.6653], '소연평도': [125.7130, 37.6094],
    '백령도': [124.7100, 37.9650], '강화도': [126.48, 37.72], '교동도': [126.28, 37.79],
    '서울시청': [126.978, 37.566], '제주': [126.531, 33.499],
  })) {
    assert.ok(inCountry(pt, 'KOR'), `${name} 이 대한민국이 아니다`);
    assert.ok(!inCountry(pt, 'PRK'), `${name} 이 북한으로 칠해진다 — 방송 사고`);
  }
});

test('북한 주요 도시는 북한이다', () => {
  for (const [name, pt] of Object.entries({
    '평양': [125.75, 39.03], '개성': [126.55, 37.97], '해주': [125.715, 38.040],
  })) assert.ok(inCountry(pt, 'PRK'), `${name} 이 북한이 아니다`);
});

test('국가 폴리곤이 바다를 칠하지 않는다', () => {
  for (const [name, pt] of Object.entries({
    '연평도 북쪽': [125.60, 37.70], '동해 청진 앞': [130.10, 41.80], '서한만': [124.60, 39.40],
  })) for (const iso of ['KOR', 'PRK']) {
    assert.ok(!inCountry(pt, iso), `${name} 이 ${iso} 로 칠해진다`);
  }
});

test('국가 폴리곤이 시도 색칠과 꼭짓점까지 같다', () => {
  /* 좌표 정밀도만 5자리로 줄였을 뿐 같은 데이터다. 어긋나면 국가 탭과 시도 탭을
     같이 썼을 때 경계가 이중으로 보인다. */
  const r5 = (v) => Number(v.toFixed(5));
  const korPts = new Set();
  for (const f of countryFeats('KOR')) for (const poly of ringsOf(f.geometry)) for (const r of poly)
    for (const p of r) korPts.add(p[0] + ',' + p[1]);
  let missing = 0, total = 0;
  for (const f of hires.features) for (const poly of ringsOf(f.geometry)) for (const r of poly)
    for (const p of r) { total++; if (!korPts.has(r5(p[0]) + ',' + r5(p[1]))) missing++; }
  assert.ok(missing / total < 0.001, `시도 꼭짓점 ${missing}/${total} 이 국가 폴리곤에 없다`);
});

test('한강 하구 구간이 있고, 육상 국경선과 이어진다', () => {
  /* 우리 데이터로 뽑은 선은 경기도·강원도만 보므로 하구가 통째로 빠진다 —
     강화도·교동도·석모도는 인천광역시라 재료에 없다. 그 자리를 OSM 의 KP-KR 경계로 잇는다. */
  assert.equal(estuary.length, 1, `하구 조각이 ${estuary.length}개`);
  const e = estuary[0].geometry.coordinates;
  assert.ok(e.length >= 10, `하구 구간이 ${e.length}점뿐`);

  const KM = (dx, dy, lat) => Math.hypot(dx * 111 * Math.cos(lat * Math.PI / 180), dy * 111);
  const ends = landBorder.flatMap((f) => [f.geometry.coordinates[0], f.geometry.coordinates.at(-1)]);
  const gap = Math.min(...[e[0], e.at(-1)].flatMap((p) => ends.map((q) => KM(p[0]-q[0], p[1]-q[1], p[1]))));
  assert.ok(gap < 0.2, `하구 구간이 육상 국경선에서 ${gap.toFixed(2)}km 떨어져 있다 — 선이 끊겨 보인다`);
});

test('국경선이 염하(김포–강화 사이)로 꺾여 들어가지 않는다', () => {
  /* 한때 육상선이 126.53°E 에서 끊기고 김포 서쪽 가장자리를 따라 남쪽으로 내려갔다
     (꼬리의 최고 위도 37.754). 2.0 은 강화·교동 위로 이어졌고 그게 맞는 모양이다.
     방송에 그대로 나가면 사고다.

     경계값이 빠듯하다 — 정상적인 하구 선도 이 경도대에서 위도 37.762 까지 내려온다.
     둘 사이가 900m 라 37.758 로 가른다. 하구 선을 다시 만들 때 이 값을 확인할 것. */
  const inChannel = (p) => p[0] > 126.48 && p[0] < 126.60 && p[1] > 37.60 && p[1] < 37.758;
  for (const f of border.features) {
    const bad = f.geometry.coordinates.filter(inChannel);
    assert.equal(bad.length, 0,
      `${(f.properties || {}).kind || '?'} 구간의 ${bad.length}점이 염하 안에 있다 (예: ${JSON.stringify(bad[0])})`);
  }
});

test('하구 구간이 강화도·교동도 북쪽으로 지난다', () => {
  /* 2.0 이 그리던 모양. 섬 남쪽으로 지나면 강화·교동이 북한 쪽에 놓인 것처럼 보인다. */
  const e = estuary[0].geometry.coordinates;
  const at = (lon) => {
    let best = null;
    for (let i = 1; i < e.length; i++) {
      const [a, b] = [e[i-1], e[i]];
      if ((a[0] - lon) * (b[0] - lon) > 0) continue;
      const t = (lon - a[0]) / ((b[0] - a[0]) || 1);
      best = Math.max(best ?? -90, a[1] + (b[1] - a[1]) * t);
    }
    return best;
  };
  for (const [name, lon, north] of [['강화도', 126.48, 37.80], ['교동도', 126.28, 37.82]]) {
    const lat = at(lon);
    assert.ok(lat !== null, `${name} 경도(${lon})에서 하구 구간을 못 찾았다`);
    assert.ok(lat > north, `하구 구간이 ${name} 북쪽(${north})이 아니라 ${lat.toFixed(3)} 을 지난다`);
  }
});

test('하구 구간이 말도에서 끝난다 (그 서쪽 NLL 까지 잇지 않는다)', () => {
  /* OSM 의 KP-KR 경계는 서해 124.98°E 까지 이어지지만, 정전협정상 중립수역이 끝나는 곳은
     강화군 서도면 말도다. 그 서쪽은 NLL 이라 성격이 다른 선인데, 같은 굵기·같은 색으로
     이어 그리면 하나의 확정된 국경처럼 읽힌다. 2.0 도 이 언저리까지만 그렸다. */
  const MALDO = [126.1331, 37.6871];
  const KM = (dx, dy, lat) => Math.hypot(dx * 111 * Math.cos(lat * Math.PI / 180), dy * 111);
  const e = estuary[0].geometry.coordinates;
  const westEnd = e.reduce((a, p) => (p[0] < a[0] ? p : a), e[0]);
  const d = KM(westEnd[0] - MALDO[0], westEnd[1] - MALDO[1], westEnd[1]);
  assert.ok(d < 6, `하구 구간 서쪽 끝이 말도에서 ${d.toFixed(1)}km 떨어져 있다`);
  assert.ok(westEnd[0] > 126.0, `하구 구간이 ${westEnd[0].toFixed(3)}°E 까지 뻗어 있다 — 말도보다 서쪽`);
});

/* ── 남·북한 행정구역선 (build-korea-admin1-lines.mjs) ──
   스타일이 주는 행정구역선은 우리 색칠보다 훨씬 성겨서 모양이 안 맞았다.
   우리 폴리곤에서 맞닿은 변만 뽑아 그린다. */

const adminLines = readJSON('recorder/js/data/korea-admin1-lines.json');

test('행정구역선이 남·북한 양쪽에 있다', () => {
  for (const iso of ['KR', 'KP']) {
    const n = adminLines.features.filter((f) => f.properties.iso === iso)
      .reduce((s, f) => s + f.geometry.coordinates.length, 0);
    assert.ok(n > 5000, `${iso} 행정구역선이 ${n}점뿐 — 저해상도로 돌아갔다`);
  }
});

test('행정구역선 꼭짓점이 색칠 꼭짓점과 같다', () => {
  /* 선과 색칠이 같은 출처여야 어느 줌에서도 붙는다. 어긋나면 국경선에서 겪은 것과 같은
     '선 따로 색 따로' 가 행정구역선에서 반복된다. */
  const r5 = (v) => Number(v.toFixed(5));
  const pts = new Set();
  for (const f of hires.features) for (const poly of ringsOf(f.geometry)) for (const r of poly)
    for (const p of r) pts.add(r5(p[0]) + ',' + r5(p[1]));
  for (const f of NK) for (const r of nkRings(f)) for (const p of r) pts.add(r5(p[0]) + ',' + r5(p[1]));

  let missing = 0, total = 0;
  for (const f of adminLines.features) for (const p of f.geometry.coordinates) {
    total++;
    if (!pts.has(p[0] + ',' + p[1])) missing++;
  }
  assert.equal(missing, 0, `행정구역선 ${missing}/${total} 점이 색칠에 없는 좌표다`);
});

test('행정구역선에 해안선이 섞이지 않았다', () => {
  /* 폴리곤 외곽선을 통째로 그리면 해안선까지 행정구역선이 되어 나라 둘레에 테두리가 생긴다.
     맞닿은 변(두 번 나오는 변)만 골라야 한다. 제주는 섬이라 맞닿은 이웃이 없다 —
     제주 해안이 선에 들어 있으면 외곽선을 그리고 있다는 뜻이다. */
  const KM = (dx, dy, lat) => Math.hypot(dx * 111 * Math.cos(lat * Math.PI / 180), dy * 111);
  const JEJU = [126.5312, 33.3617];
  let near = Infinity;
  for (const f of adminLines.features) for (const p of f.geometry.coordinates) {
    const d = KM(p[0] - JEJU[0], p[1] - JEJU[1], p[1]);
    if (d < near) near = d;
  }
  assert.ok(near > 30, `제주에서 ${near.toFixed(1)}km 떨어진 곳에 행정구역선이 있다 — 해안선이 섞였다`);
});

/* ── 나라별 행정구역선 (admin1-lines/) ──
   Mapbox 의 1급 행정구역 정의가 우리 데이터와 다른 나라를 우리 폴리곤에서 다시 뽑은 것.
   영국은 Mapbox 가 넷(잉글랜드·스코틀랜드·웨일스·북아일랜드)으로만 나누는데 우리는 232개다.
   만드는 도구는 recorder/tools/build-admin1-lines.mjs. */

const ADMIN1_LINE_ISO = [{ iso3: 'GBR', iso2: 'GB', minPts: 3000, coast: { name: '실리 제도', at: [-6.2967, 49.92455], km: 30 } }];

for (const { iso3, iso2, minPts } of ADMIN1_LINE_ISO) {
  test(`${iso3} 행정구역선이 있고 ISO2 표기가 맞다`, () => {
    const lines = readJSON(`recorder/js/data/admin1-lines/${iso3}.json`);
    const pts = lines.features.reduce((s, f) => s + f.geometry.coordinates.length, 0);
    assert.ok(pts > minPts, `${iso3} 행정구역선이 ${pts}점뿐 — 뽑기가 실패했다`);
    /* Mapbox admin 소스의 iso_3166_1 과 맞아야 화면에서 그 나라 선만 골라 뺄 수 있다.
       ISO3 앞 두 글자를 그대로 쓰면 엉뚱한 나라가 된다(AUT→AU 는 호주). */
    for (const f of lines.features) {
      assert.equal(f.properties.iso, iso2, `${iso3} 선의 iso 가 ${f.properties.iso} — ISO2 여야 한다`);
    }
  });

  test(`${iso3} 행정구역선 꼭짓점이 색칠 꼭짓점과 같다`, () => {
    /* 선과 색칠이 같은 출처여야 어느 줌에서도 붙는다 — 남·북한과 같은 기준이다. */
    const lines = readJSON(`recorder/js/data/admin1-lines/${iso3}.json`);
    const geo = readJSON(`recorder/js/data/admin1/${iso3}.json`);
    const r5 = (v) => Number(v.toFixed(5));
    const pts = new Set();
    for (const f of geo.features) for (const poly of ringsOf(f.geometry)) for (const r of poly)
      for (const p of r) pts.add(r5(p[0]) + ',' + r5(p[1]));

    let missing = 0, total = 0;
    for (const f of lines.features) for (const p of f.geometry.coordinates) {
      total++;
      if (!pts.has(p[0] + ',' + p[1])) missing++;
    }
    assert.equal(missing, 0, `${iso3} 행정구역선 ${missing}/${total} 점이 색칠에 없는 좌표다`);
  });
}

test('GBR 행정구역선에 해안선이 섞이지 않았다', () => {
  /* 폴리곤 외곽선을 통째로 그리면 해안선까지 행정구역선이 되어 나라 둘레에 테두리가 생긴다.
     맞닿은 변(두 번 나오는 변)만 골라야 한다. 실리 제도는 본토에서 45km 떨어진 섬이라
     맞닿은 이웃이 없다 — 그 해안이 선에 들어 있으면 외곽선을 그리고 있다는 뜻이다. */
  const lines = readJSON('recorder/js/data/admin1-lines/GBR.json');
  const KM = (dx, dy, lat) => Math.hypot(dx * 111 * Math.cos(lat * Math.PI / 180), dy * 111);
  const SCILLY = [-6.2967, 49.92455];
  let near = Infinity;
  for (const f of lines.features) for (const p of f.geometry.coordinates) {
    const d = KM(p[0] - SCILLY[0], p[1] - SCILLY[1], p[1]);
    if (d < near) near = d;
  }
  assert.ok(near > 30, `실리 제도에서 ${near.toFixed(1)}km 떨어진 곳에 행정구역선이 있다 — 해안선이 섞였다`);
});

test('국가 폴리곤과 행정구역 폴리곤에 핀치가 없다', () => {
  /* 한 링이 같은 점을 두 번 지나면 mapbox-gl 의 삼각분할이 그 점을 가로질러 이어,
     화면에 얇고 긴 삼각형이 뻗는다 — 충남 해안에서 실제로 그렇게 보였다.
     정밀도를 줄이거나 해안선으로 자르는 과정에서 새로 생길 수 있어 여기서 막는다. */
  const check = (feats, label) => {
    const bad = [];
    for (const f of feats) for (const poly of ringsOf(f.geometry)) for (const r of poly) {
      const seen = new Set();
      for (let i = 0; i < r.length - 1; i++) {
        const k = r[i][0] + ',' + r[i][1];
        if (seen.has(k)) bad.push(`${label} @ ${k}`); else seen.add(k);
      }
    }
    assert.deepEqual(bad.slice(0, 3), [], `${label}: 핀치 ${bad.length}곳`);
  };
  check(countries.features, 'korea-countries');
  check(NK, 'admin1 북한');
  check(admin1.features.filter((f) => f.properties.country === '대한민국'), 'admin1 대한민국');
});

test('링 감김 방향이 GeoJSON 규약대로다 (바깥 반시계 / 구멍 시계)', () => {
  /* **벡터 타일에는 '구멍' 이라는 표시가 없다 — 감김 방향이 유일한 기준이다.**
     GeoJSON 에서 링을 폴리곤마다 따로 내보내도 타일로 구우면 한 줄로 늘어서고,
     mapbox-gl 은 첫 링의 부호를 바깥으로 잡은 뒤 부호가 반대인 링을 전부 앞 폴리곤의
     구멍으로 붙인다. 그래서 방향이 섞이면 섬과 호수가 통째로 구멍이 되고, 그 구멍들이
     서로 겹쳐 화면에 긴 다각형이 뻗는다 — 함경남도(128.0, 40.04)에서 링 165개 중
     164개가 그렇게 본토의 구멍이 됐다. 삼각형 스파이크의 여섯 번째 원인이다. */
  const area = (r) => {
    let a = 0;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += r[j][0] * r[i][1] - r[i][0] * r[j][1];
    return a / 2;
  };
  const check = (feats, label) => {
    const bad = [];
    for (const f of feats) for (const poly of ringsOf(f.geometry)) {
      poly.forEach((r, i) => {
        const a = area(r);
        if (!a) return;                                   // 넓이 0 은 아래 다른 검사가 잡는다
        const want = i === 0;                             // 바깥 링만 반시계
        if ((a > 0) !== want) bad.push(`${label} ${f.properties.short || f.properties.name} ${i === 0 ? '바깥' : '구멍'}링`);
      });
    }
    assert.deepEqual(bad.slice(0, 3), [], `${label}: 방향이 뒤집힌 링 ${bad.length}개`);
  };
  check(countries.features, 'korea-countries');
  check(NK, 'admin1 북한');
  check(admin1.features.filter((f) => f.properties.country === '대한민국'), 'admin1 대한민국');
  check(hires.features, 'sido-hires');
});

test('국가 폴리곤이 시도마다 나뉘어 있다', () => {
  /* 처음에는 나라별로 폴리곤 4,173개를 MultiPolygon 하나에 몰아넣었는데, 그 거대한
     feature 를 타일마다 삼각분할하면서 충남 해안에 삼각형이 뻗었다. 시도 탭은 시도마다
     feature 를 나눠 쓰고 멀쩡하므로 같은 구조를 따른다. */
  assert.equal(countries.features.length, 30, `feature 가 ${countries.features.length}개 — 시도 17 + 북한 13 이어야 한다`);
  const big = countries.features
    .filter((f) => ringsOf(f.geometry).flat().reduce((s, r) => s + r.length, 0) > 200000);
  assert.deepEqual(big.map((f) => f.properties.name), [], '한 feature 에 점이 20만개를 넘는다 — 다시 뭉쳤다');
});

test('경계 폴리곤에 자기교차가 없다 (핀치가 아닌 가로지름)', () => {
  /* 1m 안팎으로 되돌아오는 슬리버는 꼭짓점을 공유하지 않아 핀치 검사에 안 걸리는데,
     mapbox-gl 의 삼각분할은 여기서도 폴리곤을 가로지르는 거대한 삼각형을 그린다.
     충남 해안에서 실제로 났고, 시도 17개에 85곳이 있었다. */
  const same = (a, b) => a[0] === b[0] && a[1] === b[1];
  const o = (a, b, c) => { const v = (b[0]-a[0])*(c[1]-a[1]) - (b[1]-a[1])*(c[0]-a[0]); return v > 0 ? 1 : v < 0 ? -1 : 0; };
  const crosses = (p1, p2, p3, p4) => {
    if (same(p1,p3) || same(p1,p4) || same(p2,p3) || same(p2,p4)) return false;
    const d1 = o(p3,p4,p1), d2 = o(p3,p4,p2), d3 = o(p1,p2,p3), d4 = o(p1,p2,p4);
    return ((d1>0&&d2<0)||(d1<0&&d2>0)) && ((d3>0&&d4<0)||(d3<0&&d4>0));
  };
  const bad = [];
  /* korea-countries 도 봐야 한다. 이 파일은 시도(7자리)를 **5자리로 새로 반올림**하는데,
     반올림은 없던 겹침을 만들어낸다 — CLAUDE.md 가 경고하는 그 단계다. 원본 둘이
     깨끗해도 이 출력이 깨끗하다는 보장이 없어서, 한동안 아무도 안 보는 파일이었다. */
  for (const [feats, label] of [[hires.features, '시도'], [NK, '북한'], [countries.features, '국가']]) {
    for (const f of feats) for (const poly of ringsOf(f.geometry)) for (const r of poly) {
      if (r.length < 5) continue;
      const C = 0.01, grid = new Map();                   // 전수 비교는 느리다 — 격자로 후보만
      for (let i = 0; i < r.length - 1; i++) {
        for (let x = Math.floor(Math.min(r[i][0],r[i+1][0])/C); x <= Math.floor(Math.max(r[i][0],r[i+1][0])/C); x++)
          for (let y = Math.floor(Math.min(r[i][1],r[i+1][1])/C); y <= Math.floor(Math.max(r[i][1],r[i+1][1])/C); y++) {
            const k = x + ':' + y;
            if (!grid.has(k)) grid.set(k, []);
            grid.get(k).push(i);
          }
      }
      for (const arr of grid.values()) for (let a = 0; a < arr.length; a++) for (let b = a+1; b < arr.length; b++) {
        const i = Math.min(arr[a],arr[b]), j = Math.max(arr[a],arr[b]);
        if (j - i < 2) continue;
        if (crosses(r[i], r[i+1], r[j], r[j+1]))
          bad.push(`${label} ${f.properties.name || f.properties.short} @ ${r[i]}`);
      }
    }
  }
  assert.deepEqual(bad.slice(0, 3), [], `자기교차 ${bad.length}곳`);
});

test('구멍이 바깥 링과 꼭짓점을 공유하지 않는다', () => {
  /* 구멍이 바깥 링과 한 점에서 맞닿으면 mapbox-gl 이 구멍을 바깥 링에 잇는 다리를 놓다가
     폭 0 인 삼각형을 만들고, 화면에는 폴리곤을 가로지르는 큰 삼각형으로 나온다.
     안산·시흥 해안(경기 126.655, 37.216)에서 실제로 났고 시도 17개에 26곳 있었다.
     핀치·자기교차와 증상이 같지만 원인이 또 다르다 — 셋을 다 막아야 한다. */
  const bad = [];
  const scan = (feats, label) => {
    for (const f of feats) for (const poly of ringsOf(f.geometry)) {
      if (poly.length < 2) continue;
      const outer = new Set(poly[0].map((p) => p[0] + ',' + p[1]));
      for (const hole of poly.slice(1)) for (const p of hole) {
        if (outer.has(p[0] + ',' + p[1])) bad.push(`${label} ${f.properties.name || f.properties.short} @ ${p}`);
      }
    }
  };
  scan(hires.features, '시도');
  scan(countries.features, '국가');
  scan(admin1.features.filter((f) => ['대한민국', '북한'].includes(f.properties.country)), '행정구역');
  assert.deepEqual(bad.slice(0, 3), [], `구멍이 바깥 링과 맞닿은 곳 ${bad.length}개`);
});

test('구멍 안에 또 구멍이 없고, 구멍끼리 맞닿지 않는다', () => {
  /* 구멍 안의 링은 사실 육지다 — 호수 속의 섬. 그걸 다시 구멍으로 넣으면 구멍 둘이
     겹쳐 놓이고 mapbox-gl 이 구멍을 바깥 링에 잇다가 폴리곤을 가로지르는 삼각형을
     그린다. 충남 부사호(126.560, 36.470)와 경기(126.691, 37.111)에서 실제로 났다.
     링을 중첩 깊이로 분류해 짝수는 육지, 홀수만 구멍으로 둔다. */
  const mid = (r) => {
    for (let i = 0; i + 2 < r.length; i++) {
      const p = [(r[i][0]+r[i+1][0]+r[i+2][0])/3, (r[i][1]+r[i+1][1]+r[i+2][1])/3];
      if (inRing(p, r)) return p;
    }
    return r[0];
  };
  const bad = [];
  const scan = (feats, label) => {
    for (const f of feats) for (const poly of ringsOf(f.geometry)) {
      const holes = poly.slice(1);
      for (let i = 0; i < holes.length; i++) {
        for (let j = 0; j < holes.length; j++) {
          if (i !== j && inRing(mid(holes[i]), holes[j]))
            bad.push(`${label} ${f.properties.name || f.properties.short}: 구멍 안의 구멍 @ ${holes[i][0]}`);
        }
        for (let j = i + 1; j < holes.length; j++) {
          const s = new Set(holes[i].map((p) => p[0] + ',' + p[1]));
          for (const q of holes[j]) if (s.has(q[0] + ',' + q[1]))
            bad.push(`${label} ${f.properties.name || f.properties.short}: 구멍끼리 맞닿음 @ ${q}`);
        }
      }
    }
  };
  scan(hires.features, '시도');
  scan(countries.features, '국가');
  scan(admin1.features.filter((f) => ['대한민국', '북한'].includes(f.properties.country)), '행정구역');
  assert.deepEqual(bad.slice(0, 3), [], `${bad.length}곳`);
});


test('국경선 동쪽 끝이 고성에서 바다에 닿고 해안을 따라 내려가지 않는다', () => {
  /* 군사분계선은 고성에서 동해에 닿으며 끝난다. 예전에는 거기서 멈추지 않고 해안선을 따라
     5.83km 남쪽으로 더 그려져, 그만큼의 해안이 선 북쪽에 놓여 북한 땅처럼 보였다.
     서쪽 염하 꼬리와 같은 원인 — Mapbox 국경선 5km 안쪽의 변을 모으다 해안선까지 걸린다.

     우리 시도 경계는 VWorld 가 DMZ 를 빼서 해안선보다 227m 안쪽에서 끝난다. 그대로 두면
     선이 바다에 못 닿고 끊겨 보이므로 방위 60°(2시 방향)로 해안선까지 잇는다 — kind: "shore". */
  const f = landBorder.reduce((a, b) =>
    Math.max(...b.geometry.coordinates.map((p) => p[0])) > Math.max(...a.geometry.coordinates.map((p) => p[0])) ? b : a);
  const c = f.geometry.coordinates;
  let top = 0;
  c.forEach((p, i) => { if (p[1] > c[top][1]) top = i; });
  assert.ok(top === 0 || top === c.length - 1,
    `최북단이 ${top}/${c.length - 1} 번째 — 끝이 아니라 중간이다. 지나쳐 간 만큼 해안이 북쪽에 놓인다`);
  const tip = c[top];
  assert.ok(tip[1] > 38.61 && tip[1] < 38.62, `동쪽 종점 위도 ${tip[1].toFixed(4)} — 고성(38.614) 언저리가 아니다`);

  const shore = border.features.filter((x) => (x.properties || {}).kind === 'shore');
  assert.equal(shore.length, 1, '해안선까지 잇는 조각이 없다 — 선이 바다에 못 닿는다');
  const KM = (dx, dy, lat) => Math.hypot(dx * 111 * Math.cos(lat * Math.PI / 180), dy * 111);
  const s = shore[0].geometry.coordinates;
  const gap = Math.min(...s.map((p) => KM(p[0]-tip[0], p[1]-tip[1], p[1])));
  assert.ok(gap < 0.001, `해안 조각이 종점에서 ${(gap*1000).toFixed(0)}m 떨어져 있다`);
  const len = KM(s[0][0]-s.at(-1)[0], s[0][1]-s.at(-1)[1], s[0][1]);
  assert.ok(len > 0.05 && len < 1, `해안까지 ${(len*1000).toFixed(0)}m — 너무 짧거나 길다`);
});

test('행정구역 카메라 목표가 그 지역을 가리킨다', () => {
  /* 지역을 고르면 flyTo 로 c·z 를 비춘다. 이 값은 파일에 미리 들어 있는데,
     경도 최소·최대를 그냥 평균 내어 만든 탓에 두 경우에 엉뚱한 곳을 가리켰다.

       날짜변경선을 넘는 지역   알래스카는 -179.1° ~ 179.8° 라 평균이 0.3° —
                            아프리카 앞바다다. 실제로 카메라가 거기로 날아갔다.
       멀리 떨어진 섬이 있는 곳  칠레 발파라이소(이스터섬), 일본 도쿄도(오가사와라),
                            남아프리카 웨스턴케이프(프린스에드워드) 등

     build-admin1-camera.mjs 가 경도를 연속 좌표계로 펴고, 본토가 뚜렷하면 본토만 보고
     목표를 정한다. 88개를 고쳤고 가장 크게는 키리바시가 17,797km 옮겨졌다. */
  const KM = (a, b) => {
    let d = a[0] - b[0];
    while (d > 180) d -= 360;
    while (d < -180) d += 360;
    return Math.hypot(d * 111 * Math.cos(b[1] * Math.PI / 180), (a[1] - b[1]) * 111);
  };
  const bad = [];
  for (const f of admin1.features) {
    const c = f.properties && f.properties.c;
    if (!c) continue;
    // 도형 안이면 통과. 큰 지역은 중심이 경계에서 수백 km 떨어지는 게 정상이다
    if (ringsOf(f.geometry).some((p) => inRing(c, p[0]))) continue;
    let best = Infinity, i = 0;
    (function walk(x) {
      if (typeof x[0] === 'number') {
        if (i++ % 20 === 0) { const d = KM(x, c); if (d < best) best = d; }   // 성능 — 20개마다
        return;
      }
      x.forEach(walk);
    })(f.geometry.coordinates);
    if (best > 500) bad.push(`${f.properties.name} @ ${JSON.stringify(c)} → ${Math.round(best)}km`);
  }
  assert.deepEqual(bad.slice(0, 5), [], `카메라 목표가 지역에서 멀리 떨어진 곳 ${bad.length}개`);
});

test('북한 경계에 없던 긴 직선이 끼어들지 않는다', () => {
  /* 해안선으로 자를 때 두 교차점이 서로 다른 해안선 고리에 있으면 이어붙일 길이 없다.
     강 하구가 그렇다 — OSM 해안선은 강어귀에서 끊기고 강둑은 해안선이 아니다.
     예전에는 그 자리를 두 점을 잇는 직선으로 때웠고, 두만강 하구에 21.5km 짜리 수평선이
     생겨 그 선과 해안 사이가 통째로 칠해졌다. 화면의 삼각형이 그것이었다.
     지금은 원래 경계를 그대로 둔다.

     10km 로 잡는다 — 량강도 백두산 쪽처럼 원본 OSM 에 7.6km 짜리 직선 국경이 실제로 있다. */
  const KM = (dx, dy, lat) => Math.hypot(dx * 111 * Math.cos(lat * Math.PI / 180), dy * 111);
  const bad = [];
  for (const f of NK) for (const r of nkRings(f)) {
    for (let i = 1; i < r.length; i++) {
      const d = KM(r[i][0]-r[i-1][0], r[i][1]-r[i-1][1], r[i][1]);
      if (d > 10) bad.push(`${f.properties.short} ${d.toFixed(1)}km @ ${JSON.stringify(r[i-1])}`);
    }
  }
  assert.deepEqual(bad.slice(0, 3), [], `10km 넘는 변 ${bad.length}개`);
});

/* ── 나라별로 쪼갠 행정구역 데이터 ──
   전 세계 1급 행정구역을 한 파일(전송 10.7MB)로 받던 것을 셋으로 나눴다.
   meta 는 속성만, core 는 자주 쓰는 8개국, 나머지는 나라별 파일이다.
   나누는 과정에서 구역이 하나라도 새면 검색에는 뜨는데 색칠이 안 되는 상태가 된다 —
   화면에서는 "왜 이 지역만 안 칠해지지" 로만 보이고 원인을 짚기 어렵다. */
test('쪼갠 행정구역 데이터에서 새는 구역이 없다', () => {
  const meta = readJSON('recorder/js/data/admin1-meta.json');
  const core = readJSON('recorder/js/data/admin1-core.json');
  const dir = path.join(ROOT, 'recorder/js/data/admin1');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));

  assert.equal(meta.features.length, admin1.features.length,
    'meta 의 구역 수가 admin1.json 과 다르다');

  // 지오메트리를 가진 구역을 전부 모은다 (core + 나라별 파일)
  const have = new Set();
  const add = (fc, where) => fc.features.forEach((f) => {
    assert.ok(f.geometry, `${where}: 지오메트리가 없는 구역 ${f.properties.name}`);
    assert.ok(!have.has(f.properties.name), `${where}: ${f.properties.name} 이 두 번 들어 있다`);
    have.add(f.properties.name);
  });
  add(core, 'core');
  for (const f of files) add(readJSON('recorder/js/data/admin1/' + f), f);

  const missing = meta.features.map((f) => f.properties.name).filter((n) => !have.has(n));
  assert.deepEqual(missing.slice(0, 5), [], `지오메트리가 없는 구역 ${missing.length}개`);

  // 나라 → 파일 이름표가 실제 파일을 가리켜야 한다
  const bad = Object.entries(meta.index).filter(([, code]) => !files.includes(code + '.json'));
  assert.deepEqual(bad.slice(0, 5), [], '이름표가 가리키는 파일이 없다');

  /* core 에 든 나라는 이름표에 없어야 한다 — 있으면 이미 가진 걸 또 받고,
     같은 구역이 소스에 두 번 들어가 색칠이 겹친다. */
  const coreCountries = new Set(core.features.map((f) => f.properties.country));
  const overlap = [...coreCountries].filter((c) => meta.index[c]);
  assert.deepEqual(overlap, [], 'core 국가가 이름표에도 있다 — 두 번 받는다');

  /* meta 의 모든 나라는 core 이거나 이름표에 있어야 한다. 둘 다 아니면 받을 길이 없다. */
  const reach = meta.features.map((f) => f.properties.country)
    .filter((c) => !coreCountries.has(c) && !(c in meta.index));
  assert.deepEqual([...new Set(reach)].slice(0, 5), [], '받을 길이 없는 나라가 있다');
});

test('쪼갠 뒤에도 정밀도가 떨어진 나라가 없다', () => {
  /* Natural Earth 로 갈아끼우면서 나라별로 '더 나은 쪽'을 고른다. 방향을 잘못 잡으면
     이미 정밀했던 나라(일본 5,284점·러시아 6,921점)가 조용히 거칠어진다. */
  const core = readJSON('recorder/js/data/admin1-core.json');
  const dir = path.join(ROOT, 'recorder/js/data/admin1');
  const pts = (f) => ringsOf(f.geometry).flat().reduce((s, r) => s + r.length, 0);
  const agg = (feats, into) => feats.forEach((f) => {
    const c = f.properties.country;
    into.set(c, (into.get(c) || 0) + pts(f));
  });
  const before = new Map(), after = new Map();
  agg(admin1.features, before);
  agg(core.features, after);
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.json'))) {
    agg(readJSON('recorder/js/data/admin1/' + f).features, after);
  }
  /* 줄어들어도 되는 경우가 하나 있다 — 나라당 전송 1.5MB 상한에 걸려 기준 줌을 낮춘 때다.
     그건 의도한 맞바꿈이고, 그 줌까지는 화면상 원본과 같다. 어느 나라가 왜 낮아졌는지는
     admin1-sources.json 에 적혀 있으므로 그걸 근거로 본다 — '줄었으니 통과'가 아니라
     '줄어든 이유가 적혀 있으니 통과'다. 이유 없이 줄면 여전히 걸린다(ISO 코드를 잘못 써서
     엉뚱한 나라를 받은 적이 있는데, 그런 게 조용히 지나가면 안 된다). */
  const sources = readJSON('recorder/js/data/admin1-sources.json');
  const isoOf = {};
  for (const [iso, v] of Object.entries(sources)) isoOf[iso] = v;
  const koToIso = {};
  {
    const src = readSrc('recorder/js/data/regions.js');
    const CO = new Function(src.match(/const COUNTRIES = \[[\s\S]*?\];/)[0] + '\nreturn COUNTRIES;')();
    CO.forEach((c) => { koToIso[c.n.replace(/\s*#[^#]*#\s*/g, '').trim()] = c.i; });
  }
  const worse = [...before.entries()]
    .filter(([c, b]) => (after.get(c) || 0) < b * 0.95)
    .filter(([c]) => {
      const s = isoOf[koToIso[c]];
      if (!s) return true;
      if (s.zoom && s.zoom < 10) return false;          // 전송 상한에 걸려 줌을 낮춘 나라
      if (s.clipped) return false;                      // 영해를 잘라낸 나라 — 줄어드는 게 정상이다
      return true;
    })
    .map(([c, b]) => `${c || '(이름 없음)'} ${b} → ${after.get(c) || 0}`);
  assert.deepEqual(worse.slice(0, 5), [], `이유 없이 정밀도가 떨어진 나라 ${worse.length}개`);
});

test('출처 대장이 나라별 파일과 맞는다', () => {
  /* 어느 나라 경계가 어디서 왔는지는 실행 순서에만 암묵적으로 남아 있었다 —
     split 이 Natural Earth 를 깔고, hires 가 geoBoundaries 로 덮고, osm 이 다시 덮는다.
     그래서 README 의 출처 목록이 실제와 어긋나기 쉬웠다. 방송 이미지에 따라붙는
     표기 의무라 어긋나면 곤란하다. admin1-sources.json 이 그 대장이다. */
  const sources = readJSON('recorder/js/data/admin1-sources.json');
  const dir = path.join(ROOT, 'recorder/js/data/admin1');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json') && !f.startsWith('_'))
    .map((f) => f.replace('.json', ''));
  const missing = files.filter((iso) => !sources[iso]);
  assert.deepEqual(missing.slice(0, 5), [], `대장에 없는 나라 ${missing.length}개`);
  for (const [iso, v] of Object.entries(sources)) {
    assert.ok(v.source && v.license, `${iso}: 출처나 라이선스가 비었다`);
  }
});

/* ── 나라별 행정구역 파일에도 핀치·자기교차가 없어야 한다 ──
   위쪽 검사들은 sido-hires · korea-countries · admin1 의 북한만 본다. 나라별로 쪼갠
   admin1/<ISO3>.json 은 아무도 안 보고 있었고, 그래서 OSM 에서 받아온 프랑스가
   핀치 64 · 자기교차 132 를 그대로 달고 들어왔다. 영해를 잘라내면서 더 늘기도 했다.
   증상은 늘 같다 — mapbox-gl 의 삼각분할이 깨져 **일부가 아예 안 그려진다.**
   브라질 마라냥에서 섬이 색칠 안 되는 것으로 보였던 게 이것이다. */
test('나라별 행정구역 파일에 핀치·자기교차가 없다', () => {
  const dir = path.join(ROOT, 'recorder/js/data/admin1');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  const same = (a, b) => a[0] === b[0] && a[1] === b[1];
  const o = (a, b, c) => { const v = (b[0]-a[0])*(c[1]-a[1]) - (b[1]-a[1])*(c[0]-a[0]); return v > 0 ? 1 : v < 0 ? -1 : 0; };
  const crosses = (p1, p2, p3, p4) => {
    if (same(p1,p3) || same(p1,p4) || same(p2,p3) || same(p2,p4)) return false;
    const d1 = o(p3,p4,p1), d2 = o(p3,p4,p2), d3 = o(p1,p2,p3), d4 = o(p1,p2,p4);
    return ((d1>0&&d2<0)||(d1<0&&d2>0)) && ((d3>0&&d4<0)||(d3<0&&d4>0));
  };
  const bad = [];
  for (const file of files) {
    const fc = readJSON('recorder/js/data/admin1/' + file);
    for (const f of fc.features) for (const poly of ringsOf(f.geometry)) for (const r of poly) {
      const seen = new Set();
      for (let i = 0; i < r.length - 1; i++) {
        const k = r[i][0] + ',' + r[i][1];
        if (seen.has(k)) bad.push(`핀치 ${file} ${f.properties.short} @ ${k}`); else seen.add(k);
      }
      if (r.length < 5) continue;
      const C = 0.01, grid = new Map();                   // 전수 비교는 느리다 — 격자로 후보만
      for (let i = 0; i < r.length - 1; i++)
        for (let x = Math.floor(Math.min(r[i][0],r[i+1][0])/C); x <= Math.floor(Math.max(r[i][0],r[i+1][0])/C); x++)
          for (let y = Math.floor(Math.min(r[i][1],r[i+1][1])/C); y <= Math.floor(Math.max(r[i][1],r[i+1][1])/C); y++) {
            const k = x + ':' + y;
            if (!grid.has(k)) grid.set(k, []);
            grid.get(k).push(i);
          }
      for (const arr of grid.values()) for (let a = 0; a < arr.length; a++) for (let b = a + 1; b < arr.length; b++) {
        const i = Math.min(arr[a], arr[b]), j = Math.max(arr[a], arr[b]);
        if (j - i < 2) continue;
        if (crosses(r[i], r[i+1], r[j], r[j+1])) bad.push(`교차 ${file} ${f.properties.short} @ ${r[i]}`);
      }
    }
  }
  assert.deepEqual(bad.slice(0, 3), [], `핀치·자기교차 ${bad.length}곳`);
});
