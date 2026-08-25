/* 이미 만들어진 나라별 행정구역 파일을 **육지로 잘라낸다.**

   OSM 행정경계는 나라에 따라 영해를 포함한다. 브라질 리우데자네이루는 넓이의 30.8% 가
   바다였고, 마라냥은 대서양을 덮고 있었다. 나라 전체 넓이로는 안 잡힌다 —
   브라질 합계는 1.03배라 `build-admin1-osm.mjs` 의 검사(1.10배)를 통과했다.

   구역별 넓이로도 못 가른다. 벨기에 브뤼셀이 이전 판의 13배인데 그건 **내륙**이고
   도시 경계 정의가 달랐던 것이다. 넓이 증가에 '바다'와 '경계 정의 차이'가 섞여 있어서,
   결국 육지와 겹치는 부분만 남기는 수밖에 없다 (`lib/land.mjs`).

   Overpass 를 다시 부르지 않는다 — 이미 받아 놓은 파일을 고친다. 그래서 언제든 다시
   돌려도 되고, 이미 육지만인 파일에는 아무 일도 하지 않는다.

   **자를 수 없는 자리가 있다.** 강 하구에서는 나가는 지점과 들어오는 지점이 서로 다른
   육지 덩어리에 놓여 해안선으로 이을 길이 없다 — 브라질 파라(아마존 하구)가 그렇다.
   그런 구간은 원래 경계를 그대로 둔다. 직선으로 때우면 없는 땅이 생긴다(두만강 하구에서
   21.5km 짜리 수평선이 났다). 그 나라는 이름과 함께 찍어 두니 확인할 것.

   육지: Natural Earth 10m (퍼블릭 도메인). 없으면 받아 온다.
   실행: node recorder/tools/build-admin1-clip.mjs [ISO3 ...]
*/
import fs from 'node:fs';
import { loadLand, clipRingToLand } from './lib/land.mjs';
import { nudgeTouchingHoles } from './lib/rings.mjs';
import { setSource, readSources } from './lib/sources.mjs';

const R = 'recorder/js/data/';
const OUT = R + 'admin1/';
const LAND = 'recorder/tools/.cache/ne_10m_land.geojson';
const LAND_URL = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_land.geojson';

/* 이만큼 넘게 줄면 자르기가 잘못된 것으로 보고 손대지 않는다. 영해는 보통 구역 넓이의
   몇 %~30% 인데(리우가 30.8% 였다), 절반이 날아가면 육지 판정이 틀린 것이다. */
const MAX_LOSS = 0.45;

/* 반대로 **조금밖에 안 줄면 자르지 않는다.** Natural Earth 10m 해안선은 우리 경계보다
   거칠어서, 영해가 없는 나라에서도 해안이 0.1~0.7% 씩 깎인다. 프랑스 데파르트망은
   원래 바다를 한 곳도 안 덮는데 0.4% 가 깎였다 — 그건 바다를 지운 게 아니라 육지를 깎은
   것이다. 실제 영해는 자릿수가 다르다(미얀마 2.4% · 독일 6.8% · 튀르키예 7.6% ·
   리우데자네이루 30.8%). 그 사이에 선을 긋는다. */
const MIN_LOSS = 0.01;
const PREC = 5;
const round = (v) => Number(v.toFixed(PREC));
const ringsOf = (g) => (g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []);

/* 자르고 나면 바깥 링의 방향이 뒤집힐 수 있다. 벡터 타일에는 '구멍' 표시가 없고 감김
   방향이 유일한 기준이라, 뒤집힌 채 나가면 섬이 통째로 구멍이 된다. */
const signed = (r) => { let a = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += r[j][0]*r[i][1] - r[i][0]*r[j][1]; return a / 2; };
const wind = (poly) => poly.map((r, i) => ((signed(r) > 0) === (i === 0) ? r : r.slice().reverse()));

function areaOf(rings) {
  let t = 0;
  rings.forEach((r, i) => {
    let a = 0, lat = 0;
    for (let k = 0, j = r.length - 1; k < r.length; j = k++) { a += r[j][0]*r[k][1] - r[k][0]*r[j][1]; lat += r[k][1]; }
    t += (i === 0 ? 1 : -1) * Math.abs(a / 2) * 111.32 * 111.32 * Math.cos((lat / r.length) * Math.PI / 180);
  });
  return t;
}

if (!fs.existsSync(LAND)) {
  console.log('Natural Earth 육지 데이터를 받는 중… (10MB, 한 번만)');
  fs.mkdirSync('recorder/tools/.cache', { recursive: true });
  const { execFileSync } = await import('node:child_process');
  execFileSync('curl', ['-sL', '-m', '900', '-A', 'ColorMap/3.4 (+https://github.com/DesignerAJ/ColorMap)',
                        '-o', LAND, LAND_URL], { stdio: 'inherit' });
}
const C = loadLand(LAND);
console.log(`육지 링 ${C.lines.length} · 변 ${C.segs.length.toLocaleString()}\n`);

const sources = JSON.parse(fs.readFileSync(R + 'admin1-sources.json', 'utf8'));
const only = process.argv.slice(2).filter((a) => /^[A-Z]{3}$/.test(a));
/* OSM 에서 직접 받은 나라만 본다. geoBoundaries·Natural Earth 는 이미 육지만이라
   손댈 이유가 없고, 괜히 자르면 해안선이 두 데이터 사이에서 미세하게 갈린다. */
const list = only.length ? only
  : Object.entries(sources).filter(([, v]) => v.via === 'OSM').map(([k]) => k).sort();

const regions = fs.readFileSync(R + 'regions.js', 'utf8');
const COUNTRIES = new Function(regions.match(/const COUNTRIES = \[[\s\S]*?\];/)[0] + '\nreturn COUNTRIES;')();
const isoToKo = {};
COUNTRIES.forEach((c) => { isoToKo[c.i] = c.n.replace(/\s*#[^#]*#\s*/g, '').trim(); });

let touched = 0, clean = 0;
const unjoinedAt = [];
for (const iso of list) {
  const file = OUT + iso + '.json';
  if (!fs.existsSync(file)) continue;
  const fc = JSON.parse(fs.readFileSync(file, 'utf8'));
  let before = 0, after = 0, cutRegions = 0, unjoined = 0, refused = 0, islands = 0;

  const feats = fc.features.map((f) => {
    const polys = ringsOf(f.geometry);
    const b = polys.reduce((s, p) => s + areaOf(p), 0);
    before += b;
    let changed = false, pending = 0, unknown = 0;

    /* **폴리곤 구조를 그대로 둔다.** 링을 전부 모아 buildPolygons 로 다시 나누면,
       자른 본토 링이 만을 가로지르면서 그 안의 섬을 감싸고 — 중첩 깊이로 보면 그 섬이
       구멍이 된다. 화면에서는 섬이 색칠 안 되는 것으로 보인다. 실제로 덴마크에서
       폴리곤 83개, 이탈리아 61개가 그렇게 구멍이 됐다.
       바깥 링만 자르고, 구멍(호수)은 건드리지 않는다 — 호수는 원래 물이라 자를 것이 없다. */
    const outPolys = [];
    for (const poly of polys) {
      const cut = clipRingToLand(poly[0], C);
      pending += cut.unjoined;
      if (cut.unknownIsland) unknown++;
      if (cut.changed) changed = true;
      const outer = (cut.ring || poly[0]).map((p) => [round(p[0]), round(p[1])]);
      const holes = poly.slice(1).map((h) => h.map((p) => [round(p[0]), round(p[1])]));
      outPolys.push(wind([outer, ...holes]));
    }
    if (!changed) { after += b; return f; }
    const a = outPolys.reduce((s, p) => s + areaOf(p), 0);
    if (b > 0 && a < b * (1 - MAX_LOSS)) { refused++; after += b; return f; }
    if (b > 0 && a > b * (1 - MIN_LOSS)) { after += b; return f; }   // 잡음 — 원래 것을 둔다
    after += a; cutRegions++; unjoined += pending; islands += unknown;
    return { type: 'Feature', properties: f.properties,
             geometry: { type: 'MultiPolygon', coordinates: outPolys.map((p) => nudgeTouchingHoles(p, round)) } };
  });

  if (!cutRegions) { clean++; continue; }
  fs.writeFileSync(file, JSON.stringify({ type: 'FeatureCollection', features: feats }));
  /* 잘라내면 꼭짓점이 줄어든다. 정밀도 검사가 '이유 없이 줄었다'로 오해하지 않게 적어 둔다. */
  const prev = readSources()[iso] || {};
  setSource(iso, { ...prev, clipped: true });
  touched++;
  const pct = before > 0 ? ((1 - after / before) * 100).toFixed(1) : '0.0';
  console.log(`  ${iso} ${(isoToKo[iso] || '').padEnd(10)} 구역 ${cutRegions}/${fc.features.length} 잘림 · 넓이 ${pct}% 줄어듦` +
    (unjoined ? ` · 못 이은 구간 ${unjoined}` : '') + (islands ? ` · NE 에 없는 섬 ${islands}개는 그대로` : '') + (refused ? ` · 너무 많이 줄어 되돌린 구역 ${refused}` : ''));
  if (unjoined) unjoinedAt.push(`${isoToKo[iso] || iso}(${unjoined})`);
}

console.log(`\n자른 나라 ${touched} · 이미 육지만이던 나라 ${clean}`);
if (unjoinedAt.length) {
  console.log(`\n해안선으로 이을 수 없어 원래 경계를 남긴 곳이 있는 나라: ${unjoinedAt.join(', ')}`);
  console.log('강 하구가 대부분이다. 바다가 조금 남을 수 있으니 눈으로 확인할 것.');
}
console.log('\nnode --test test/*.test.js 로 검증할 것');
