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

function collect(features, label) {
  const polys = [];
  let dropped = 0;
  for (const f of features) {
    for (const poly of polysOf(f.geometry)) {
      const rings = poly.map((r) => dedupeRing(trim(r))).filter(Boolean);
      if (rings.length) polys.push(rings); else dropped++;
    }
  }
  const pts = polys.flat(2).length;
  console.log(`  ${label.padEnd(6)} 폴리곤 ${String(polys.length).padStart(4)} · ${pts.toLocaleString()}점` +
    (dropped ? ` (정밀도 축소로 사라진 링 ${dropped})` : ''));
  return polys;
}

const hires = JSON.parse(fs.readFileSync(R + 'sido-hires.json'));
const admin1 = JSON.parse(fs.readFileSync(R + 'admin1.json'));
const nk = admin1.features.filter((f) => f.properties.country === '북한');
if (hires.features.length !== 17) throw new Error(`시도가 ${hires.features.length}개 — 17개여야 한다`);
if (nk.length !== 13) throw new Error(`북한 도가 ${nk.length}개 — 13개여야 한다`);

console.log('국가 폴리곤을 만드는 중…');
const out = {
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', properties: { iso_3166_1_alpha_3: 'KOR', name: '대한민국' },
      geometry: { type: 'MultiPolygon', coordinates: collect(hires.features, '대한민국') } },
    { type: 'Feature', properties: { iso_3166_1_alpha_3: 'PRK', name: '북한' },
      geometry: { type: 'MultiPolygon', coordinates: collect(nk, '북한') } },
  ],
};

fs.writeFileSync(R + 'korea-countries.json', JSON.stringify(out));
console.log(`\nkorea-countries.json: ${(fs.statSync(R + 'korea-countries.json').size / 1048576).toFixed(1)} MB`);
console.log('node --test test/data.test.js 로 검증할 것');
