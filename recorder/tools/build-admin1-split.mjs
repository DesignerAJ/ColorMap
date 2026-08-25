/* '행정구역' 탭 데이터를 나라별로 쪼개고, 거친 나라는 Natural Earth 로 올린다.

   왜 쪼개나 —
     admin1.json 은 전 세계 1급 행정구역이 한 파일에 들어 있어 전송 10.7MB 다.
     탭을 처음 열 때 눈에 띄게 기다린다. 그런데 한 번에 칠하는 건 보통 한두 나라다.

   왜 정밀도를 올리나 —
     이 파일은 나라마다 정밀도가 제각각이다. 구역당 꼭짓점 **중앙값이 73점**이라
     프랑스(90)·이탈리아(65)·영국(35)은 각진 다각형으로 보인다. 반면 행정구역 **선**은
     스타일이 주는 Mapbox admin 벡터타일(OSM 기반)이라 훨씬 정밀해서, 같은 자리에서
     선은 매끄러운데 색칠만 각지는 게 눈에 띈다.
     Natural Earth 10m 은 중앙값 166점으로 2~3배 정밀하다.

   무엇을 안 건드리나 —
     아래 KEEP 의 8개국. 한국·북한은 우리가 만든 고해상도이고(2.3만·1.4만점),
     러시아·일본·우크라이나는 원본이 이미 NE 보다 정밀하다. 미국·중국·대만은
     NE 가 2.5배 정밀하지만 "지금대로" 요청이라 그대로 둔다 — 바꾸려면 여기서 빼면 된다.
     KEEP 은 쪼개지 않고 admin1-core.json 한 덩어리로 낸다. 자주 쓰는 나라라
     고를 때마다 기다리지 않는 편이 낫다.

   내보내는 것 —
     admin1-meta.json      전체 구역의 속성만 (검색·자동완성·카메라). 전송 117KB
     admin1-core.json      KEEP 8개국 지오메트리. 전송 7.6MB
     admin1/<ISO3>.json    나머지 227개국. 중앙값 6KB, 합쳐도 2.9MB

   admin1.json 은 그대로 둔다 — 이 도구와 build-korea-countries.mjs 의 입력이다.
   (생성물을 손으로 고치지 말 것. 이 도구를 고치고 다시 생성한다)

   출처: Natural Earth (public domain). README 에 밝혀 둘 것.
   실행: node recorder/tools/build-admin1-split.mjs
*/
import fs from 'node:fs';
import path from 'node:path';

const R = 'recorder/js/data/';
const OUT_DIR = R + 'admin1/';
const CACHE = 'recorder/tools/.cache/';
const NE_URL = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_1_states_provinces.geojson';
const NE_FILE = CACHE + 'ne_10m_admin_1_states_provinces.geojson';

/* 그대로 두는 나라. admin1.json 에 적힌 이름 그대로 써야 한다 ('러시아 연방'·'대한민국'). */
const KEEP = ['대한민국', '북한', '일본', '중국', '미국', '러시아 연방', '우크라이나', '대만'];

/* NE 가 우리 것보다 이만큼은 정밀해야 갈아끼운다. 1.2 는 '엎치락뒤치락하면 그냥 둔다'는 뜻 —
   비슷한 데이터를 굳이 바꾸면 이름·모양이 미묘하게 달라지기만 하고 얻는 게 없다. */
const GAIN = 1.2;

const PREC = 5;                                          // 약 1m. 방송 지도에 1cm 는 의미가 없다
const round = (v) => Number(v.toFixed(PREC));
const trim = (c) => (typeof c[0] === 'number' ? [round(c[0]), round(c[1])] : c.map(trim));

const clean = (n) => n.replace(/\s*#[^#]*#\s*/g, '').trim();   // COUNTRIES 의 '#분쟁지역#' 표시
const ringsOf = (g) => (g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []);
const ptsOf = (f) => { let n = 0; for (const p of ringsOf(f.geometry)) for (const r of p) n += r.length; return n; };

/* 면적이 가장 큰 바깥 링의 무게중심. 구역끼리 짝지을 때 쓴다 —
   이름으로 짝지으면 표기 차이('경기도' vs 'Gyeonggi-do')에 걸려 조용히 어긋난다. */
function centroid(f) {
  let best = null, ba = -1;
  for (const poly of ringsOf(f.geometry)) {
    const r = poly[0];
    let a = 0, cx = 0, cy = 0;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const cr = r[j][0] * r[i][1] - r[i][0] * r[j][1];
      a += cr; cx += (r[j][0] + r[i][0]) * cr; cy += (r[j][1] + r[i][1]) * cr;
    }
    a /= 2;
    if (Math.abs(a) > ba) { ba = Math.abs(a); best = a ? [cx / (6 * a), cy / (6 * a)] : r[0]; }
  }
  return best;
}

/* 사내망에서는 node 의 fetch 가 TLS 에서 막힌다. curl 은 시스템 키체인을 쓰므로 통과한다.
   40MB 짜리라 매번 받지 않고 .cache/ 에 둔다 (저장소에는 안 들어간다). */
async function loadNaturalEarth() {
  if (fs.existsSync(NE_FILE)) {
    console.log(`Natural Earth: 받아둔 것 사용 (${(fs.statSync(NE_FILE).size / 1e6).toFixed(1)} MB)`);
    return JSON.parse(fs.readFileSync(NE_FILE, 'utf8'));
  }
  fs.mkdirSync(CACHE, { recursive: true });
  console.log('Natural Earth 10m 을 받는 중… (40MB, 한 번만)');
  const { execFileSync } = await import('node:child_process');
  execFileSync('curl', ['-sL', '-m', '900', '-o', NE_FILE, NE_URL], { stdio: 'inherit' });
  if (!fs.existsSync(NE_FILE) || fs.statSync(NE_FILE).size < 1e6) throw new Error('Natural Earth 를 받지 못했다');
  return JSON.parse(fs.readFileSync(NE_FILE, 'utf8'));
}

// ── 실행 ──
const regions = fs.readFileSync(R + 'regions.js', 'utf8');
const COUNTRIES = new Function(regions.match(/const COUNTRIES = \[[\s\S]*?\];/)[0] + '\nreturn COUNTRIES;')();
const koToIso = {};
COUNTRIES.forEach((c) => { koToIso[clean(c.n)] = c.i; });

const admin1 = JSON.parse(fs.readFileSync(R + 'admin1.json', 'utf8'));
const ne = await loadNaturalEarth();

const neByIso = new Map();
for (const f of ne.features) {
  const a = f.properties.adm0_a3;
  if (!neByIso.has(a)) neByIso.set(a, []);
  neByIso.get(a).push(f);
}

const oursByCountry = new Map();
for (const f of admin1.features) {
  const c = f.properties.country || '';
  if (!oursByCountry.has(c)) oursByCountry.set(c, []);
  oursByCountry.get(c).push(f);
}

/* 한 나라의 구역들을 NE 로 갈아끼운다. 속성(한글 이름·카메라 목표)은 **우리 것을 지킨다** —
   검색 색인과 카메라가 거기 걸려 있다. 지오메트리만 바꾼다. */
function upgrade(feats, pool) {
  const neC = pool.map((f) => ({ f, c: centroid(f) }));
  const used = new Set();
  let swapped = 0;
  const out = feats.map((f) => {
    const c = centroid(f);
    let best = null, bd = Infinity;
    for (const n of neC) {
      if (used.has(n.f)) continue;
      const d = Math.hypot(n.c[0] - c[0], n.c[1] - c[1]);
      if (d < bd) { bd = d; best = n; }
    }
    // 2° 밖이면 짝이 아니다. 억지로 붙이면 엉뚱한 구역의 모양이 들어온다.
    if (!best || bd >= 2) return f;
    used.add(best.f); swapped++;
    return { type: 'Feature', properties: f.properties,
             geometry: { type: best.f.geometry.type, coordinates: best.f.geometry.coordinates } };
  });
  return { out, swapped };
}

const meta = [];
const coreFeats = [];
const files = [];
let upgraded = 0, upgradedCountries = 0, keptCoarse = 0;

for (const [ko, feats] of oursByCountry) {
  const isCore = KEEP.includes(ko);
  let use = feats;

  if (!isCore) {
    const pool = neByIso.get(koToIso[ko]);
    if (pool) {
      const ourAvg = feats.reduce((s, f) => s + ptsOf(f), 0) / feats.length;
      const neAvg = pool.reduce((s, f) => s + ptsOf(f), 0) / pool.length;
      if (neAvg > ourAvg * GAIN) {
        const r = upgrade(feats, pool);
        use = r.out; upgraded += r.swapped;
        if (r.swapped) upgradedCountries++;
      } else keptCoarse++;
    } else keptCoarse++;
  }

  use = use.map((f) => ({ type: 'Feature', properties: f.properties,
                          geometry: { type: f.geometry.type, coordinates: trim(f.geometry.coordinates) } }));
  use.forEach((f) => meta.push({ type: 'Feature', properties: f.properties, geometry: null }));

  if (isCore) { coreFeats.push(...use); continue; }

  /* 파일 이름은 ISO3 다. 없는 나라(분쟁지역 표기 등)는 나라 이름을 그대로 쓸 수 없으므로
     (URL 에 한글이 들어가면 서버·CDN 마다 인코딩이 달라진다) 코드를 만들어 붙인다. */
  /* 나라 이름이 비어 있는 구역이 67개 있다 — 가자·웨스트뱅크·소말릴란드처럼
     admin1.json 이 어느 나라에도 넣지 않은 곳들이다. 한 파일로 묶는다. */
  const iso = koToIso[ko] || (ko ? null : '_etc');
  const code = iso || 'X' + String(files.length).padStart(3, '0');
  files.push({ code, ko, feats: use });
}

fs.mkdirSync(OUT_DIR, { recursive: true });
for (const f of fs.readdirSync(OUT_DIR)) fs.unlinkSync(path.join(OUT_DIR, f));   // 옛 파일이 남지 않게

const write = (p, obj) => { fs.writeFileSync(p, JSON.stringify(obj)); return fs.statSync(p).size; };
const MB = (b) => (b / 1e6).toFixed(1) + ' MB';

/* 나라 → 파일 이름표. 런타임이 '어느 나라를 받아야 하나'를 이걸로 안다.
   메타에 같이 넣어 두면 파일 하나로 끝난다. */
const index = {};
files.forEach((f) => { index[f.ko] = f.code; });

const metaSize = write(R + 'admin1-meta.json', { type: 'FeatureCollection', index, features: meta });
const coreSize = write(R + 'admin1-core.json', { type: 'FeatureCollection', features: coreFeats });
let restSize = 0;
for (const f of files) restSize += write(OUT_DIR + f.code + '.json', { type: 'FeatureCollection', features: f.feats });

console.log(`\n  그대로 둔 나라 ${KEEP.length}개 · 구역 ${coreFeats.length}`);
console.log(`  Natural Earth 로 올린 나라 ${upgradedCountries}개 · 구역 ${upgraded}`);
console.log(`  원본이 더 정밀하거나 짝이 없어 그대로 둔 나라 ${keptCoarse}개`);
console.log(`\n  admin1-meta.json  ${MB(metaSize)}  (전체 ${meta.length} 구역)`);
console.log(`  admin1-core.json  ${MB(coreSize)}`);
console.log(`  admin1/           ${MB(restSize)}  (파일 ${files.length}개)`);
console.log('\nnode --test test/*.test.js 로 검증할 것');
