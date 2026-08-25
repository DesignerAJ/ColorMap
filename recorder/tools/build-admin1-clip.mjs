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
import { cleanRing } from './lib/clean.mjs';
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
/* **자르기와 복구는 대상이 다르다.**
   자르는 건 OSM 에서 직접 받은 나라뿐이다 — geoBoundaries·Natural Earth 는 이미 육지만이라
   손댈 이유가 없고, 괜히 자르면 해안선이 두 데이터 사이에서 미세하게 갈린다.
   복구(핀치·자기교차)는 **전부** 한다. 출처를 가릴 이유가 없고, 실제로 Natural Earth 쪽에도
   800곳 가까이 있었다 — 그 나라들도 같은 이유로 일부가 안 그려지고 있었다. */
const CLIP = new Set(Object.entries(sources).filter(([, v]) => v.via === 'OSM').map(([k]) => k));
const list = only.length ? only
  : fs.readdirSync(OUT).filter((f) => f.endsWith('.json')).map((f) => f.replace('.json', '')).sort();

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
  let before = 0, after = 0, cutRegions = 0, fixedRegions = 0, unjoined = 0, refused = 0, islands = 0;

  /* **자르기와 복구는 따로 판정한다.**
     자르기는 넓이 문턱으로 걸러야 한다(NE 해안선이 거칠어 잡음이 섞인다). 복구는 그럴 게
     없다 — 핀치와 자기교차는 언제나 없애는 게 맞다. 한동안 둘을 같이 묶었더니,
     자를 것이 없는 나라(스위스·오스트리아·체코)의 복구가 넓이 문턱에 걸려 버려졌다. */
  const feats = fc.features.map((f) => {
    const polys = ringsOf(f.geometry);
    const b = polys.reduce((s, p) => s + areaOf(p), 0);
    before += b;
    let didClip = false, didClean = false, pending = 0, unknown = 0;
    const clipped = [], cleaned = [];

    for (const poly of polys) {
      /* 구멍도 복구한다. 자르는 건 바깥 링만이지만(호수는 원래 물이라 자를 게 없다)
         핀치·자기교차는 구멍에도 생긴다 — 칠레 아이센의 교차 4곳이 전부 구멍에 있었다.
         복구하면 구멍 하나가 여럿으로 나뉠 수 있으므로 나온 것을 전부 구멍으로 쓴다. */
      const holes = poly.slice(1).flatMap((h) => {
        const rounded = h.map((p) => [round(p[0]), round(p[1])]);
        const fixed = cleanRing(rounded);
        if (fixed.length !== 1 || fixed[0].length !== rounded.length) didClean = true;
        return fixed.length ? fixed : [rounded];
      });
      const orig = poly[0].map((p) => [round(p[0]), round(p[1])]);
      const cut = CLIP.has(iso) ? clipRingToLand(poly[0], C) : { ring: null, changed: false, unjoined: 0 };
      pending += cut.unjoined;
      if (cut.unknownIsland) unknown++;
      if (cut.changed) didClip = true;

      /* 링 하나가 여럿으로 나뉠 수 있다. 구멍은 가장 큰 조각에 붙인다
         (구멍이 있는 폴리곤이 여럿으로 나뉜 적은 없다). */
      const emit = (ring, into) => {
        const pieces = cleanRing(ring);
        if (!pieces.length) { into.push(wind([ring, ...holes])); return false; }
        if (pieces.length !== 1 || pieces[0].length !== ring.length) {
          const big = pieces.reduce((x, y) => (Math.abs(areaOf([x])) >= Math.abs(areaOf([y])) ? x : y));
          for (const p of pieces) into.push(wind(p === big ? [p, ...holes] : [p]));
          return true;
        }
        into.push(wind([pieces[0], ...holes]));
        return false;
      };
      if (emit(orig, cleaned)) didClean = true;
      emit(cut.changed ? (cut.ring || poly[0]).map((p) => [round(p[0]), round(p[1])]) : orig, clipped);
    }

    const finish = (out) => ({ type: 'Feature', properties: f.properties,
      geometry: { type: 'MultiPolygon', coordinates: out.map((p) => nudgeTouchingHoles(p, round)) } });

    if (didClip) {
      const a = clipped.reduce((s, p) => s + areaOf(p), 0);
      const tooMuch = b > 0 && a < b * (1 - MAX_LOSS);
      const tooLittle = b > 0 && a > b * (1 - MIN_LOSS);
      if (tooMuch) refused++;
      if (!tooMuch && !tooLittle) {
        after += a; cutRegions++; unjoined += pending; islands += unknown;
        return finish(clipped);
      }
    }
    after += b;
    if (didClean) { fixedRegions++; return finish(cleaned); }   // 자르진 않아도 고칠 건 고친다
    return f;
  });

  if (!cutRegions && !fixedRegions) { clean++; continue; }   // 자를 것도 고칠 것도 없었다
  fs.writeFileSync(file, JSON.stringify({ type: 'FeatureCollection', features: feats }));
  /* 잘라내면 꼭짓점이 줄어든다. 정밀도 검사가 '이유 없이 줄었다'로 오해하지 않게 적어 둔다. */
  const prev = readSources()[iso] || {};
  setSource(iso, { ...prev, clipped: true });
  touched++;
  const pct = before > 0 ? ((1 - after / before) * 100).toFixed(1) : '0.0';
  console.log(`  ${iso} ${(isoToKo[iso] || '').padEnd(10)} 구역 ${cutRegions}/${fc.features.length} 잘림 · 넓이 ${pct}% 줄어듦` + (fixedRegions ? ` · 핀치·교차 고친 구역 ${fixedRegions}` : '') +
    (unjoined ? ` · 못 이은 구간 ${unjoined}` : '') + (islands ? ` · NE 에 없는 섬 ${islands}개는 그대로` : '') + (refused ? ` · 너무 많이 줄어 되돌린 구역 ${refused}` : ''));
  if (unjoined) unjoinedAt.push(`${isoToKo[iso] || iso}(${unjoined})`);
}

console.log(`\n손댄 나라 ${touched} · 손댈 것 없던 나라 ${clean}`);
if (unjoinedAt.length) {
  console.log(`\n해안선으로 이을 수 없어 원래 경계를 남긴 곳이 있는 나라: ${unjoinedAt.join(', ')}`);
  console.log('강 하구가 대부분이다. 바다가 조금 남을 수 있으니 눈으로 확인할 것.');
}
console.log('\nnode --test test/*.test.js 로 검증할 것');
