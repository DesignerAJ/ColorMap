/* '행정구역' 탭의 대한민국 17개를 우리 시도 데이터로 갈아끼운다.

   admin1.json 은 전 세계 1급 행정구역이 한 파일에 들어 있는 외부 데이터인데,
   대한민국 부분이 도당 100~500점짜리 저해상도였다 — 경기도 231점, 강원도 159점.
   같은 지역을 '시도' 탭에서는 1.6만점으로 그리므로 두 탭의 모양이 전혀 달랐다.

   이름도 낡아 있었다. 행정 개편 전 이름(강원도·전라북도)이라 '시도' 탭
   (강원특별자치도·전북특별자치도)과 어긋났다.

   그래서 `sido-hires.json` 의 지오메트리와 현행 명칭을 그대로 가져온다.
   두 탭이 같은 데이터를 쓰므로 같이 칠해도 어긋나지 않는다.

   카메라 목표점(c·z)은 원래 값을 유지한다 — 손보던 값이고, 경계가 정밀해져도
   어디를 비출지는 달라질 이유가 없다.

   좌표는 소수점 5자리(약 1m)로 줄인다. admin1.json 은 지연 로드라 크기가 곧 대기 시간이고,
   방송 지도에 1cm 는 의미가 없다.

   실행: node recorder/tools/build-kr-admin1.mjs
*/
import fs from 'node:fs';

const R = 'recorder/js/data/';
const PREC = 5;

/* 행정 개편으로 이름이 바뀐 둘. admin1 쪽 옛 이름 → sido-hires 의 현행 이름.
   나머지 15개는 이름이 같다. */
const RENAMED = { '강원도': '강원특별자치도', '전라북도': '전북특별자치도' };

const round = (v) => Number(v.toFixed(PREC));
const trim = (c) => (typeof c[0] === 'number' ? [round(c[0]), round(c[1])] : c.map(trim));

// 정밀도를 줄이면 이웃한 점이 겹칠 수 있다 — 연속 중복점을 걷어낸다 (핀치 = 화면의 삼각형 스파이크)
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

const hires = JSON.parse(fs.readFileSync(R + 'sido-hires.json'));
const admin1 = JSON.parse(fs.readFileSync(R + 'admin1.json'));
if (hires.features.length !== 17) throw new Error(`시도가 ${hires.features.length}개 — 17개여야 한다`);

const old = new Map(admin1.features.filter(f => f.properties.country === '대한민국')
  .map(f => [RENAMED[f.properties.short] || f.properties.short, f.properties]));
if (old.size !== 17) throw new Error(`admin1 의 대한민국이 ${old.size}개 — 17개여야 한다`);
const keep = admin1.features.filter(f => f.properties.country !== '대한민국');

console.log(`admin1.json: 전체 ${admin1.features.length} · 대한민국 ${old.size} · 나머지 ${keep.length}\n`);

const built = [];
for (const f of hires.features) {
  const name = f.properties.name;
  const prev = old.get(name);
  if (!prev) throw new Error(`admin1 에 짝이 없다: ${name}`);
  const polys = [];
  for (const poly of polysOf(f.geometry)) {
    const rings = poly.map(r => dedupeRing(trim(r))).filter(Boolean);
    if (rings.length) polys.push(rings);
  }
  built.push({
    type: 'Feature',
    properties: { country: '대한민국', short: name, name: `대한민국 ${name}`, c: prev.c, z: prev.z },
    geometry: polys.length === 1 ? { type: 'Polygon', coordinates: polys[0] }
                                 : { type: 'MultiPolygon', coordinates: polys },
  });
  const before = [...old.entries()].find(([k]) => k === name);
  const pts = polys.flat(2).length;
  console.log(`  ${name.padEnd(9)} ${String(pts).padStart(6)}점` +
    (prev.short !== name ? `  (이름: ${prev.short} → ${name})` : ''));
  void before;
}

admin1.features = keep.concat(built);
fs.writeFileSync(R + 'admin1.json', JSON.stringify(admin1));
console.log(`\nadmin1.json 갱신: ${(fs.statSync(R + 'admin1.json').size / 1048576).toFixed(1)} MB`);
console.log('node --test test/data.test.js 로 검증할 것');
