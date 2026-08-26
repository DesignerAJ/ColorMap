/* 프랑스·이탈리아·스페인의 행정구역을 **1급**으로 갈아끼운다.

   `admin1.json` 원본이 나라마다 다른 층을 담고 있었다. 탭 이름은 '행정구역'(1급)인데:
     독일 16개 주(맞음) · 대한민국 17개 시도(맞음)
     프랑스 101개 **데파르트망**(2급, 1급은 18개 레지옹)
     이탈리아 110개 **도**(2급, 1급은 20개 주)
     스페인 52개 **provincia**(2급, 1급은 19개 자치주)
   전 세계를 훑어 실질적으로 어긋난 건 이 셋과 기니·부르키나파소·스리랑카뿐이었다.
   방송에서 "프랑스 뫼르트에모젤"보다 "프랑스 그랑테스트"를 쓰므로 셋을 1급으로 바꾼다.

   **지오메트리만 바뀌는 게 아니라 구역 목록 자체가 바뀐다** — 이름·검색·카메라 목표가
   전부 새로 생긴다. 그래서 파생 파일이 아니라 원본 `admin1.json` 을 고친다.
   그 뒤 build-admin1-split → -hires → -osm 순서로 다시 돌려야 한다.

   한국어 이름은 OSM 의 `name:ko` 를 먼저 쓰고, 없으면 아래 표로 채운다.
   이탈리아는 20개 전부 OSM 에 있고, 프랑스는 8개·스페인은 13개가 비어 있었다.

   출처: OpenStreetMap contributors (ODbL).
   실행: node recorder/tools/build-admin1-firstlevel.mjs
*/
import fs from 'node:fs';
import { buildPolygons } from './lib/rings.mjs';

const R = 'recorder/js/data/';
const OVERPASS = 'https://overpass-api.de/api/interpreter';
const UA = 'ColorMap/3.3 (+https://github.com/DesignerAJ/ColorMap)';

const TARGETS = [
  { ko: '프랑스',   prefix: 'FR', level: '4', want: 18 },
  { ko: '이탈리아', prefix: 'IT', level: '4', want: 20 },
  { ko: '스페인',   prefix: 'ES', level: '4', want: 19 },
];

/* OSM 에 name:ko 가 없는 것들. 통용되는 표기로 채운다.
   레위니옹은 OSM 이 '리유니온'으로 갖고 있는데, 기존 데이터와 일반 표기를 따라 덮어쓴다. */
const KO = {
  'Centre-Val de Loire': '상트르발드루아르',
  'Provence-Alpes-Côte d\'Azur': '프로방스알프코트다쥐르',
  'Bretagne': '브르타뉴',
  'Martinique': '마르티니크',
  'Grand Est': '그랑테스트',
  'Occitanie': '옥시타니',
  'Normandie': '노르망디',
  'Hauts-de-France': '오드프랑스',
  'La Rioja': '라리오하',
  'Cantabria': '칸타브리아',
  'Navarra / Nafarroa': '나바라',
  'Galicia': '갈리시아',
  'Castilla y León': '카스티야레온',
  'Euskadi': '바스크',
  'Comunitat Valenciana': '발렌시아',
  'Aragón': '아라곤',
  'Región de Murcia': '무르시아',
  'Canarias': '카나리아 제도',
  'Extremadura': '엑스트레마두라',
  'Castilla-La Mancha': '카스티야라만차',
  'Comunidad de Madrid': '마드리드',
};
const KO_OVERRIDE = { '리유니온': '레위니옹' };

const PREC = 5;
const round = (v) => Number(v.toFixed(PREC));
const mPerPx = (z) => 40075017 / (Math.pow(2, z) * 512);
const TOL = (mPerPx(10) * 0.125) / 111320;               // 줌 10 까지 화면상 원본과 같다
const KEY = (p) => p[0].toFixed(7) + ',' + p[1].toFixed(7);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const polysOf = (g) => (g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []);

async function overpass(query) {
  const waits = [0, 10, 20, 40, 60, 90, 120, 180];
  let last;
  for (let i = 0; i < waits.length; i++) {
    if (waits[i]) { console.log(`     ${last} — ${waits[i]}초 뒤 다시 시도`); await sleep(waits[i] * 1000); }
    try {
      const { execFileSync } = await import('node:child_process');
      const out = execFileSync('curl', ['-s', '-m', '900', '-A', UA, '-X', 'POST', '--data-binary', '@-', OVERPASS],
        { input: query, maxBuffer: 1536 * 1024 * 1024, encoding: 'utf8' });
      if (!out.trim().startsWith('{')) throw new Error('JSON 이 아닌 응답 (혼잡)');
      return JSON.parse(out);
    } catch (e) { last = (e.message || String(e)).slice(0, 60); if (i === waits.length - 1) throw e; }
  }
}

function stitch(members) {
  const pool = members.filter((m) => m.type === 'way' && m.geometry && m.geometry.length > 1)
    .map((m) => m.geometry.map((g) => [g.lon, g.lat]));
  const rings = [];
  while (pool.length) {
    let cur = pool.shift(), grew = true;
    while (grew && KEY(cur[0]) !== KEY(cur.at(-1))) {
      grew = false;
      for (let i = 0; i < pool.length; i++) {
        const p = pool[i];
        if (KEY(cur.at(-1)) === KEY(p[0]))     { cur = cur.concat(p.slice(1));                     pool.splice(i,1); grew = true; break; }
        if (KEY(cur.at(-1)) === KEY(p.at(-1))) { cur = cur.concat(p.slice().reverse().slice(1));    pool.splice(i,1); grew = true; break; }
        if (KEY(cur[0])     === KEY(p.at(-1))) { cur = p.slice(0,-1).concat(cur);                   pool.splice(i,1); grew = true; break; }
        if (KEY(cur[0])     === KEY(p[0]))     { cur = p.slice().reverse().slice(0,-1).concat(cur); pool.splice(i,1); grew = true; break; }
      }
    }
    if (KEY(cur[0]) !== KEY(cur.at(-1))) cur.push(cur[0].slice());
    if (cur.length >= 4) rings.push(cur);
  }
  return rings;
}

function simplify(ring, tol) {
  if (ring.length < 5) return ring.map((p) => [round(p[0]), round(p[1])]);
  const keep = new Uint8Array(ring.length);
  keep[0] = keep[ring.length - 1] = 1;
  const stack = [[0, ring.length - 1]], t2 = tol * tol;
  while (stack.length) {
    const [a, b] = stack.pop();
    if (b - a < 2) continue;
    const [ax, ay] = ring[a], [bx, by] = ring[b];
    const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
    let bi = -1, bd = -1;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = ring[i];
      let d;
      if (L === 0) d = (px - ax) ** 2 + (py - ay) ** 2;
      else { let t = ((px - ax) * dx + (py - ay) * dy) / L; t = t < 0 ? 0 : t > 1 ? 1 : t;
             d = (px - ax - t * dx) ** 2 + (py - ay - t * dy) ** 2; }
      if (d > bd) { bd = d; bi = i; }
    }
    if (bd > t2) { keep[bi] = 1; stack.push([a, bi], [bi, b]); }
  }
  const out = ring.filter((_, i) => keep[i]).map((p) => [round(p[0]), round(p[1])]);
  return out.length >= 4 ? out : ring.map((p) => [round(p[0]), round(p[1])]);
}

const ringArea = (r) => { let a = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += r[j][0]*r[i][1] - r[i][0]*r[j][1]; return Math.abs(a / 2); };

/* 카메라 목표 — build-admin1-camera.mjs 의 cameraFor 와 같은 규칙이다.
   본토가 전체 면적의 절반을 넘으면 본토만 보고 정한다 (프랑스 해외령이 딸려 있어도
   본토를 비춘다). 그렇지 않으면 전체를 담는다. z 는 기존 값들에서 역산한 관계를 따른다. */
const DOMINANT = 0.5;
function cameraFor(geometry) {
  const outers = polysOf(geometry).map((p) => p[0]).filter((r) => r && r.length >= 4);
  if (!outers.length) return null;
  const areas = outers.map(ringArea);
  const total = areas.reduce((a, b) => a + b, 0);
  const biggest = areas.indexOf(Math.max(...areas));
  const use = total && areas[biggest] / total >= DOMINANT ? [outers[biggest]] : outers;
  const pts = use.flat();
  let lo = Infinity, hi = -Infinity, a0 = Infinity, a1 = -Infinity;
  for (const p of pts) { if (p[0] < lo) lo = p[0]; if (p[0] > hi) hi = p[0];
                         if (p[1] < a0) a0 = p[1]; if (p[1] > a1) a1 = p[1]; }
  const span = Math.max(hi - lo, a1 - a0) || 0.01;
  return { c: [round((lo + hi) / 2), round((a0 + a1) / 2)],
           z: Math.min(Math.round((Math.log2(360 / span) + 0.35) * 10) / 10, 12.5) };
}

// ── 실행 ──
const admin1 = JSON.parse(fs.readFileSync(R + 'admin1.json', 'utf8'));
console.log(`admin1.json: 전체 ${admin1.features.length} 구역\n`);

const replaced = new Map();
for (const t of TARGETS) {
  const had = admin1.features.filter((f) => f.properties.country === t.ko).length;
  console.log(`${t.ko} — 지금 ${had}구역, OSM level ${t.level} 을 받는 중…`);
  const data = await overpass(`[out:json][timeout:900];
rel["boundary"="administrative"]["admin_level"="${t.level}"]["ISO3166-2"~"^${t.prefix}-"];
out geom;`);
  const feats = [];
  for (const e of data.elements || []) {
    const rings = stitch(e.members || []);
    if (!rings.length) continue;
    const raw = buildPolygons(rings);
    const polys = raw.map((poly) => poly.map((r) => simplify(r, TOL))).filter((poly) => poly[0].length >= 4);
    if (!polys.length) continue;
    const osmKo = e.tags['name:ko'];
    const short = KO_OVERRIDE[osmKo] || osmKo || KO[e.tags.name] || e.tags.name;
    if (!osmKo && !KO[e.tags.name]) console.log(`   ⚠ 한국어 이름 없음: ${e.tags.name} — 원어 그대로 넣는다`);
    const geometry = { type: 'MultiPolygon', coordinates: polys };
    const cam = cameraFor(geometry);
    feats.push({ type: 'Feature',
      properties: { country: t.ko, short, name: `${t.ko} ${short}`, c: cam.c, z: cam.z },
      geometry });
  }
  if (feats.length !== t.want) {
    console.log(`   ⚠ ${feats.length}개가 나왔다 (${t.want}개를 기대) — 확인 필요`);
  }
  replaced.set(t.ko, feats);
  console.log(`   → ${feats.length}구역: ${feats.map((f) => f.properties.short).join(', ')}\n`);
}

const kept = admin1.features.filter((f) => !replaced.has(f.properties.country));
const out = [...kept];
for (const feats of replaced.values()) out.push(...feats);
fs.writeFileSync(R + 'admin1.json', JSON.stringify({ type: 'FeatureCollection', features: out }));
console.log(`admin1.json 갱신: ${admin1.features.length} → ${out.length} 구역 · ${(fs.statSync(R + 'admin1.json').size / 1e6).toFixed(1)} MB`);
console.log('\n이어서 돌릴 것:');
console.log('  node recorder/tools/build-admin1-split.mjs');
console.log('  node recorder/tools/build-admin1-hires.mjs');
console.log('  node recorder/tools/build-admin1-osm.mjs');
