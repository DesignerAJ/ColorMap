/* 출처를 개별 표기해야 하는 나라들을 OpenStreetMap 으로 갈아끼운다.

   `build-admin1-hires.mjs` 뒤에 돌린다. 같은 파일(admin1/<ISO3>.json)을 덮어쓴다.

   왜 —
     geoBoundaries 는 나라마다 최선의 출처를 고른다. 그래서 품질은 좋은데 **출처가 39가지**다
     (프랑스 IGN, 독일 BKG, 이탈리아 ISTAT …). 지도 이미지를 방송에 내보내면 그 표기 의무가
     이미지에 따라붙는다 — 한 그래픽에 세 나라를 칠하면 기관 셋을 밝혀야 한다.
     바탕 지도가 Mapbox(OSM 기반)라 `© OpenStreetMap contributors` 는 **어차피 표기한다.**
     그러니 행정구역도 OSM 이면 표기가 하나도 늘지 않는다.
     덤으로 Mapbox 의 행정구역선과 출처가 같아져 선과 색칠이 맞는다.

   조악해지지 않는다 — 실측했다. 프랑스 원본은 IGN 이 29,985점/구역, OSM 이 20,945점이지만,
   화면에 쓰는 정밀도(z8)까지 줄이면 IGN 2,259 · OSM 2,602 로 **OSM 이 오히려 많다.**
   서브픽셀까지 줄이고 나면 꼭짓점 수는 원본 밀도가 아니라 그 축척에서의 형태 복잡도로
   정해지기 때문이다. 원본 밀도 차이는 줌 10을 넘겨야 드러난다.

   **영해.** OSM 행정경계가 영해를 포함하는 나라가 있다 — 북한이 그랬고, 그대로 쓰면
   바다가 통째로 칠해진다(`build-nk-admin1.mjs` 가 해안선으로 잘라내는 이유).
   그런데 보편적이지 않다. 프랑스 데파르트망 99개는 바다를 한 곳도 안 덮는다.
   그래서 잘라내는 대신 **넓이로 검사해서 걸러낸다** — 지금 쓰는 데이터(geoBoundaries·
   Natural Earth)는 육지만이므로, OSM 쪽 넓이가 눈에 띄게 크면 바다가 섞인 것이다.
   그런 나라는 건드리지 않고 이름을 찍는다. 해안선 클리핑이 필요한 나라로 따로 다룰 것.

   실행: node recorder/tools/build-admin1-osm.mjs [ISO3 ...]
         인자를 주면 그 나라만 한다 (프랑스만: build-admin1-osm.mjs FRA)
*/
import fs from 'node:fs';
import zlib from 'node:zlib';
import { buildPolygons } from './lib/rings.mjs';
import { cleanRing } from './lib/clean.mjs';
import { setSource } from './lib/sources.mjs';

const R = 'recorder/js/data/';
const OUT = R + 'admin1/';
const OVERPASS = 'https://overpass-api.de/api/interpreter';
const UA = 'ColorMap/3.3 (+https://github.com/DesignerAJ/ColorMap)';

/* 개별 표기가 필요한 39개국. OSM 이 아닌 출처를 쓰고 있는 나라들이다.
   (build-admin1-hires.mjs 가 찍는 출처 목록에서 OpenStreetMap 이 아닌 것들) */
const TARGETS = ['FRA','DEU','ITA','ESP','CHE','SWE','DNK','GRC','CZE','ROU','BLR','MDA',
                 'MKD','GEO','ARM','IND','MMR','SYR','QAT','JOR','ZAF','NGA','ETH','MEX',
                 'BRA','CHL','VEN','AUS','PNG','BEL','PRT','SGP','AUT','AZE','TUR',
                 'NLD','BGR','VNM','ISR'];

const ZOOM = 10, MIN_ZOOM = 7, TOL_PX = 0.125, PREC = 5;
const BUDGET = 1.5 * 1024 * 1024;
const SEA_MARGIN = 1.10;                                 // 넓이가 이보다 커지면 바다가 섞인 것으로 본다

const round = (v) => Number(v.toFixed(PREC));
const mPerPx = (z) => 40075017 / (Math.pow(2, z) * 512);
const tolAt = (z) => (mPerPx(z) * TOL_PX) / 111320;
const KEY = (p) => p[0].toFixed(7) + ',' + p[1].toFixed(7);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ringsOf = (g) => (g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []);
const ptsOf = (f) => { let n = 0; for (const p of ringsOf(f.geometry)) for (const r of p) n += r.length; return n; };

/* 위도 보정한 대략 넓이(㎢). 바다가 섞였는지만 보면 되므로 이 정도로 충분하다. */
function areaOf(f) {
  let total = 0;
  for (const poly of ringsOf(f.geometry)) {
    poly.forEach((r, i) => {
      let a = 0, lat = 0;
      for (let k = 0, j = r.length - 1; k < r.length; j = k++) {
        a += r[j][0] * r[k][1] - r[k][0] * r[j][1];
        lat += r[k][1];
      }
      const cos = Math.cos((lat / r.length) * Math.PI / 180);
      total += (i === 0 ? 1 : -1) * Math.abs(a / 2) * 111.32 * 111.32 * cos;
    });
  }
  return total;
}

/* Overpass — build-nk-admin1.mjs 와 같은 이유로 UA 를 밝히고(없으면 406), 504 에 넉넉히 재시도한다. */
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

/* 릴레이션 조각(way)을 이어 닫힌 링으로. 조각 순서와 방향이 제각각이라 양쪽 끝을 다 본다.
   (build-nk-admin1.mjs 의 stitch 와 같은 처리) */
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
        if (KEY(cur.at(-1)) === KEY(p[0]))     { cur = cur.concat(p.slice(1));                  pool.splice(i,1); grew = true; break; }
        if (KEY(cur.at(-1)) === KEY(p.at(-1))) { cur = cur.concat(p.slice().reverse().slice(1)); pool.splice(i,1); grew = true; break; }
        if (KEY(cur[0])     === KEY(p.at(-1))) { cur = p.slice(0,-1).concat(cur);                pool.splice(i,1); grew = true; break; }
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
const inRing = (pt, r) => {
  let hit = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i], [xj, yj] = r[j];
    if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
};
const inFeature = (pt, f) => ringsOf(f.geometry).some((poly) =>
  inRing(pt, poly[0]) && !poly.slice(1).some((h) => inRing(pt, h)));

/* ISO3166-2 는 **ISO2** 접두사를 쓴다(프랑스 FR-59). ISO3 의 앞 두 글자를 그대로 쓰면
   엉뚱한 나라를 받는다 — AUT→AU 는 호주, MEX→ME 는 몬테네그로, CHL→CH 는 스위스,
   ARM→AR 은 아르헨티나, ISR→IS 는 아이슬란드다. 한 번 그렇게 짜서 7개국이 엉뚱한 나라를
   받았고, 넓이·짝짓기 검사가 전부 걸러내 데이터가 망가지진 않았지만 조용히 넘어갈 뻔했다.
   매핑은 OSM 의 국가 관계에서 받는다 (ISO3166-1 과 ISO3166-1:alpha3 를 함께 갖고 있다). */
let ISO2 = null;
async function iso2Of(iso3) {
  if (!ISO2) {
    const d = await overpass(`[out:json][timeout:300];
rel["boundary"="administrative"]["admin_level"="2"]["ISO3166-1:alpha3"];
out tags;`);
    ISO2 = {};
    for (const e of d.elements || []) {
      const t = e.tags || {};
      if (t['ISO3166-1:alpha3'] && t['ISO3166-1']) ISO2[t['ISO3166-1:alpha3']] = t['ISO3166-1'];
    }
    console.log(`ISO3→ISO2 매핑 ${Object.keys(ISO2).length}개를 받았다\n`);
  }
  return ISO2[iso3] || null;
}

// ── 실행 ──
const only = process.argv.slice(2).filter((a) => /^[A-Z]{3}$/.test(a));
const list = only.length ? only : TARGETS;

const regions = fs.readFileSync(R + 'regions.js', 'utf8');
const COUNTRIES = new Function(regions.match(/const COUNTRIES = \[[\s\S]*?\];/)[0] + '\nreturn COUNTRIES;')();
const isoToKo = {};
COUNTRIES.forEach((c) => { isoToKo[c.i] = c.n.replace(/\s*#[^#]*#\s*/g, '').trim(); });
const iso2 = {};
COUNTRIES.forEach((c) => { iso2[c.i] = null; });

let done = 0, skipped = 0, seaHit = [];
console.log(`OpenStreetMap → ${list.length}개국\n`);

for (const iso of list) {
  const file = OUT + iso + '.json';
  if (!fs.existsSync(file)) { console.log(`  ${iso}  건너뜀 — ${file} 이 없다`); skipped++; continue; }
  const ours = JSON.parse(fs.readFileSync(file, 'utf8'));
  const want = ours.features.length;

  /* 어느 admin_level 이 우리 '1급 행정구역'에 해당하는지는 나라마다 다르다.
     먼저 지오메트리 없이 세어 보고 개수가 맞는 층을 고른다 — 지오메트리까지 받으면
     프랑스 한 나라가 107MB 라, 층마다 받아보는 건 감당이 안 된다. */
  const p2 = await iso2Of(iso);
  if (!p2) { console.log(`  ${iso}  건너뜀 — ISO2 코드를 못 찾았다`); skipped++; continue; }
  let counts;
  try {
    counts = await overpass(`[out:json][timeout:300];
rel["boundary"="administrative"]["ISO3166-2"~"^${p2}-"];
out tags;`);
  } catch (e) { console.log(`  ${iso}  건너뜀 — 층 세기 실패: ${e.message}`); skipped++; continue; }

  const byLevel = new Map();
  for (const e of counts.elements || []) {
    const lv = e.tags && e.tags.admin_level;
    if (lv) byLevel.set(lv, (byLevel.get(lv) || 0) + 1);
  }
  let pick = null;
  for (const [lv, n] of byLevel) {
    const gap = Math.abs(n - want) / Math.max(1, want);
    if (!pick || gap < pick.gap) pick = { lv, n, gap };
  }
  if (!pick || pick.gap > 0.25) {
    console.log(`  ${iso}  건너뜀 — 우리 ${want}구역과 맞는 admin_level 이 없다` +
                (pick ? ` (가장 가까운 level ${pick.lv}: ${pick.n}개)` : ' (ISO3166-2 태그 없음)'));
    skipped++; continue;
  }

  let data;
  try {
    data = await overpass(`[out:json][timeout:900];
rel["boundary"="administrative"]["admin_level"="${pick.lv}"]["ISO3166-2"~"^${p2}-"];
out geom;`);
  } catch (e) { console.log(`  ${iso}  건너뜀 — 내려받기 실패: ${e.message}`); skipped++; continue; }

  const built = (data.elements || []).map((e) => {
    /* 조립한 링에는 핀치와 자기교차가 남는다 — OSM 조각을 이어 붙이는 과정에서 생긴다.
       그대로 두면 mapbox-gl 의 삼각분할이 깨져 일부가 아예 안 그려진다(브라질 마라냥에서
       섬이 색칠 안 되는 것으로 보였다). 시도 데이터에서 85곳을 고친 처리를 그대로 쓴다. */
    const rings = stitch(e.members || []).flatMap(cleanRing);
    if (!rings.length) return null;
    return { type: 'Feature', properties: { name: (e.tags && (e.tags['name:ko'] || e.tags.name)) || '?' },
             geometry: { type: 'MultiPolygon', coordinates: buildPolygons(rings) } };
  }).filter(Boolean);
  if (!built.length) { console.log(`  ${iso}  건너뜀 — 링을 못 만들었다`); skipped++; continue; }

  /* 영해가 섞였는지 넓이로 본다. 지금 데이터는 육지만이므로 눈에 띄게 커지면 바다다.
     북한이 그랬고, 그대로 쓰면 바다가 통째로 칠해진다. */
  const areaNow = ours.features.reduce((s, f) => s + areaOf(f), 0);
  const areaOsm = built.reduce((s, f) => s + areaOf(f), 0);
  if (areaNow > 0 && areaOsm > areaNow * SEA_MARGIN) {
    console.log(`  ${iso} ${(isoToKo[iso] || '').padEnd(8)} 건너뜀 — 영해가 섞였다 ` +
                `(넓이 ${Math.round(areaNow).toLocaleString()} → ${Math.round(areaOsm).toLocaleString()}㎢, ` +
                `${(areaOsm / areaNow).toFixed(2)}배) · 해안선 클리핑이 필요한 나라`);
    seaHit.push(iso); skipped++; continue;
  }

  // 구역 짝짓기 — 우리 폴리곤 안에 상대 무게중심이 들어가는가
  const pool = built.map((f) => ({ f, c: centroid(f) })).filter((x) => x.c);
  const used = new Set();
  let matched = 0;
  const pairs = ours.features.map((mine) => {
    let hit = pool.find((x) => !used.has(x.f) && inFeature(x.c, mine));
    if (!hit) {
      let bd = Infinity, best = null;
      const c = centroid(mine);
      for (const x of pool) { if (used.has(x.f)) continue;
        const d = Math.hypot(x.c[0] - c[0], x.c[1] - c[1]);
        if (d < bd) { bd = d; best = x; } }
      if (best && bd < 0.3) hit = best;
    }
    if (hit) { used.add(hit.f); matched++; }
    return { mine, src: hit || null };
  });
  const rate = matched / want;
  if (rate < 0.7) {
    console.log(`  ${iso}  건너뜀 — ${want}구역 중 ${matched}개만 짝을 찾았다 (${(rate*100).toFixed(0)}%)`);
    skipped++; continue;
  }

  const render = (z) => pairs.map((p) => {
    if (!p.src) return p.mine;
    const g = p.src.f.geometry;
    const polys = ringsOf(g).map((poly) => poly.map((r) => simplify(r, tolAt(z))));
    return { type: 'Feature', properties: p.mine.properties,
             geometry: { type: g.type, coordinates: g.type === 'Polygon' ? polys[0] : polys } };
  });
  let usedZoom = ZOOM, out = render(usedZoom), body = JSON.stringify({ type: 'FeatureCollection', features: out });
  while (zlib.gzipSync(Buffer.from(body), { level: 9 }).length > BUDGET && usedZoom > MIN_ZOOM) {
    usedZoom--; out = render(usedZoom); body = JSON.stringify({ type: 'FeatureCollection', features: out });
  }

  const before = ours.features.reduce((s, f) => s + ptsOf(f), 0) / want;
  const after = out.reduce((s, f) => s + ptsOf(f), 0) / out.length;
  fs.writeFileSync(file, body);
  setSource(iso, { source: 'OpenStreetMap contributors', license: 'ODbL 1.0', via: 'OSM', zoom: usedZoom });
  console.log(`  ${iso} ${(isoToKo[iso] || '').padEnd(8)} level ${pick.lv} · ${matched}/${want}구역 · ` +
              `${Math.round(before)} → ${Math.round(after)}점 · ${(fs.statSync(file).size/1024).toFixed(0)}KB · z${usedZoom}` +
              (matched < want ? ` · ${want - matched}개는 그대로` : ''));
  done++;
}

console.log(`\nOSM 으로 바꾼 나라 ${done} · 건너뛴 나라 ${skipped}`);
if (seaHit.length) console.log(`영해가 섞여 손대지 않은 나라: ${seaHit.join(', ')}`);
console.log('\nnode --test test/*.test.js 로 검증할 것');
