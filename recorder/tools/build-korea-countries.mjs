/* 국가 단위 색칠용 남·북한 폴리곤을 우리 데이터에서 만든다.

   국가 색칠은 Mapbox 의 country-boundaries-v1 을 썼는데 두 가지가 문제였다.

   하나, 연평도 북쪽 북한 섬 네 개(갈도·장재도·무도·료도)를 KOR 로 분류한다.
   대한민국을 칠하면 북한 섬이 함께 칠해졌다 — 한국 방송에서는 사고가 되는 오류다.

   둘, 선과 색칠의 출처가 갈렸다. 3.x 는 시도·시군구 색칠과 국경선을 모두 국토부
   데이터로 맞춰 놨는데, 국가 색칠만 Mapbox 라 같은 자리에서 최대 3.1km 어긋났다.

   그래서 남·북한만 우리 데이터로 그린다. 나머지 나라는 Mapbox 그대로다.

     대한민국 = sido-hires.json 의 시도 17개
     북한     = admin1.json 의 북한 13개 (build-nk-admin1.mjs 가 만든 것)

   합집합을 구하지 않고 폴리곤을 그대로 이어 붙인다. 한 가지 색으로 칠하는 레이어라
   안쪽 경계선은 어차피 안 보이고, 도 안에 박힌 광역시는 도 쪽 구멍과 맞물려 있어
   그대로 두면 정확히 채워진다. 무엇보다 시도 색칠과 **꼭짓점이 같아** 두 탭을 같이
   써도 어긋나지 않는다.

   좌표는 소수점 5자리(약 1m)로 줄인다. 원본은 7자리인데 방송 지도에 1cm 는 의미가 없고,
   이 파일은 지연 로드라 크기가 곧 대기 시간이다.

   실행: node recorder/tools/build-korea-countries.mjs
*/
import fs from 'node:fs';
import { nudgeTouchingHoles } from './lib/rings.mjs';

const R = 'recorder/js/data/';
const PREC = 5;

const round = (v) => Number(v.toFixed(PREC));
function trim(coords) {
  if (typeof coords[0] === 'number') return [round(coords[0]), round(coords[1])];
  return coords.map(trim);
}
// 정밀도를 줄이면 이웃한 점이 같아질 수 있다 — 링에서 연속 중복점을 걷어낸다 (핀치 방지)
function dedupeRing(ring) {
  const out = [ring[0]];
  for (let i = 1; i < ring.length; i++) {
    const p = ring[i], q = out.at(-1);
    if (p[0] !== q[0] || p[1] !== q[1]) out.push(p);
  }
  if (out.length < 4) return null;
  if (out[0][0] !== out.at(-1)[0] || out[0][1] !== out.at(-1)[1]) out.push(out[0].slice());
  return out;
}

const polysOf = (g) => (g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []);

/* 한 링이 같은 점을 두 번 지나면 그 지점에서 자기 자신과 만난다(핀치). 그대로 두면
   mapbox-gl 의 삼각분할이 그 점을 가로질러 이어 화면에 얇고 긴 삼각형이 뻗는다 —
   줌에 따라 나타났다 사라지는 그 삼각형이다. 위상적으로는 한 점에서 붙은 링 두 개이므로
   그 점에서 잘라 나누면 양쪽 다 온전해지고 면적도 그대로다.
   (build-sido-hires.mjs 의 splitAtPinches 와 같은 처리. 정밀도를 줄이면 원본에 없던
   핀치가 새로 생길 수 있어 여기서도 돌린다.) */
function splitAtPinches(ring) {
  const out = [], stack = [], pos = new Map();
  for (const p of ring) {
    const k = p[0] + ',' + p[1];
    if (pos.has(k)) {
      const at = pos.get(k);
      const loop = stack.slice(at).concat([p]);
      if (loop.length > 3) out.push(loop);
      for (let t = at + 1; t < stack.length; t++) pos.delete(stack[t][0] + ',' + stack[t][1]);
      stack.length = at + 1;
    } else {
      pos.set(k, stack.length);
      stack.push(p);
    }
  }
  return out.length ? out : [ring];
}

const ringArea = (r) => {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += r[j][0]*r[i][1] - r[i][0]*r[j][1];
  return Math.abs(a / 2);
};

/* 원본 feature 하나당 결과 feature 하나로 낸다.

   처음에는 나라별로 폴리곤 4,173개를 MultiPolygon 하나에 몰아넣었는데, 그 거대한 feature
   하나를 mapbox-gl 이 타일마다 삼각분할하면서 충남 해안에 얇은 삼각형이 뻗었다.
   시도 탭은 시도마다 feature 를 나눠 쓰고 멀쩡하므로, 같은 구조를 따른다.
   색은 iso 속성으로 match 하므로 feature 가 나뉘어도 한 색으로 칠해진다. */
function collect(features, iso, label) {
  const out = [];
  let polys = 0, pinched = 0;
  for (const f of features) {
    const groups = [];
    for (const poly of polysOf(f.geometry)) {
      const rings = poly.map((r) => dedupeRing(trim(r))).filter(Boolean);
      if (!rings.length) continue;
      const [outer, ...holes] = rings;
      const parts = splitAtPinches(outer);
      if (parts.length > 1) pinched++;
      // 구멍은 가장 큰 조각에 붙인다 (구멍이 있는 폴리곤에서 핀치가 난 적은 없다)
      const sorted = parts.map((p) => p).sort((a, b) => ringArea(b) - ringArea(a));
      sorted.forEach((p, i) => groups.push(nudgeTouchingHoles(i === 0 ? [p, ...holes] : [p], round)));
    }
    if (!groups.length) continue;
    polys += groups.length;
    out.push({
      type: 'Feature',
      properties: { iso_3166_1_alpha_3: iso, name: f.properties.name || f.properties.short },
      geometry: groups.length === 1 ? { type: 'Polygon', coordinates: groups[0] }
                                    : { type: 'MultiPolygon', coordinates: groups },
    });
  }
  const pts = out.reduce((s, f) => s + polysOf(f.geometry).flat(2).length, 0);
  console.log(`  ${label.padEnd(6)} feature ${String(out.length).padStart(3)} · 폴리곤 ${String(polys).padStart(4)} · ${pts.toLocaleString()}점` +
    (pinched ? ` · 핀치 ${pinched}곳을 잘라 나눔` : ``));
  return out;
}

const hires = JSON.parse(fs.readFileSync(R + 'sido-hires.json'));
const admin1 = JSON.parse(fs.readFileSync(R + 'admin1.json'));
const nk = admin1.features.filter((f) => f.properties.country === '북한');
if (hires.features.length !== 17) throw new Error(`시도가 ${hires.features.length}개 — 17개여야 한다`);
if (nk.length !== 13) throw new Error(`북한 도가 ${nk.length}개 — 13개여야 한다`);

console.log('국가 폴리곤을 만드는 중…');
const out = {
  type: 'FeatureCollection',
  features: collect(hires.features, 'KOR', '대한민국').concat(collect(nk, 'PRK', '북한')),
};

fs.writeFileSync(R + 'korea-countries.json', JSON.stringify(out));
console.log(`\nkorea-countries.json: ${(fs.statSync(R + 'korea-countries.json').size / 1048576).toFixed(1)} MB`);
console.log('node --test test/data.test.js 로 검증할 것');
