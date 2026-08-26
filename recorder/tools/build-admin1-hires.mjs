/* 유럽 주요국 행정구역을 각국 공식 데이터(geoBoundaries)로 올린다.

   `build-admin1-split.mjs` 가 만든 나라별 파일을 **덮어쓴다.** 반드시 그 뒤에 돌린다.
   **두 번 연달아 돌리면 안 된다** — 이 도구는 덮어쓴 자기 출력을 다시 읽으므로,
   두 번째 실행에서는 '지금이 더 정밀하다' 로 전부 건너뛴다. 다시 만들려면 split 부터.

   왜 —
     Natural Earth 10m 은 전 세계를 고르게 덮지만 구역당 중앙값 166점이라, 우리 시도
     (2.3만점) 옆에 놓으면 여전히 각져 보인다. 프랑스가 227점이었다.
     geoBoundaries 는 각국 국가기관 데이터를 모아둔 것이라(프랑스 IGN·독일 BKG)
     자릿수가 다르다 — 프랑스가 구역당 12.9만점이다.

   너무 커서 그대로는 못 쓴다(프랑스 원본 전송 26MB). 줄이되 **얼마나 줄여도 안 보이는지**는
   계산으로 나온다 — mapbox-gl 이 타일 좌표를 정수로 반올림하는 격자가 0.0625 px 이고,
   우리가 소스에 준 tolerance 가 0.125 px 다. 그래서 '줌 Z 에서 0.125 px' 를 넘지 않게
   줄이면 그 줌까지는 원본과 화면상 같다. Z=10 으로 잡았다(허용오차 9.55m):
     프랑스 12.9만 → 2.2만점 · 전송 1.6MB   독일 9천 → 5.8천점 · 전송 0.6MB
   대한민국이 2.3만점이니 같은 급이 된다. 온디맨드라 그 나라를 고를 때만 받는다.

   **행정 단위가 나라마다 다르다.** 우리 데이터의 독일은 16개 주(geoBoundaries ADM1)인데
   프랑스는 101개 데파르트망(ADM2)이다 — ADM1 은 13개 레지옹이라 아예 다른 층이다.
   그래서 레벨을 박아두지 않고, 구역 수가 우리와 가까운 쪽을 골라 짝짓기까지 해보고
   잘 붙는 쪽만 쓴다. 안 붙으면 그 나라는 건드리지 않는다 — 억지로 붙이면 엉뚱한
   지역의 모양이 들어가고, 그건 눈으로 알아채기 어렵다.

   짝짓기는 **우리 폴리곤 안에 상대 무게중심이 들어가는가**로 한다. 이름으로 하면
   표기 차이('Nord' vs '노르')에 걸리고, 거리로만 하면 작은 구역이 이웃에 붙는다.

   속성(한글 이름·카메라 목표)은 우리 것을 지킨다. 지오메트리만 바꾼다.

   출처: geoBoundaries (gbOpen). 나라마다 원출처·라이선스가 다르므로 실행 끝에
   찍히는 목록을 README 에 옮겨 둘 것.
   실행: node recorder/tools/build-admin1-hires.mjs
*/
import fs from 'node:fs';
import zlib from 'node:zlib';
import { setSource } from './lib/sources.mjs';

const R = 'recorder/js/data/';
const OUT = R + 'admin1/';
const CACHE = 'recorder/tools/.cache/gb/';
const API = 'https://www.geoboundaries.org/api/current/gbOpen';

/* 방송에서 쓸 만한 나라들. 코어 8개국(한국·북한·일본·중국·미국·러시아·우크라이나·대만)은
   여기 없다 — 원본을 그대로 두기로 한 나라들이다.
   여기 없는 나라도 ISO3 를 넣기만 하면 된다. 어느 층이 맞는지도, 갈아끼울 값어치가
   있는지도 아래에서 스스로 판단하고, 아니면 건너뛴다. */
const TARGETS = [
  // 유럽
  'FRA','DEU','GBR','ITA','ESP','POL','NLD','BEL','CHE','AUT','SWE','NOR','DNK','FIN',
  'PRT','GRC','CZE','HUN','ROU','IRL','SRB','HRV','SVK','BGR','BLR','LTU','EST','SVN',
  'ISL','MDA','ALB','MKD','MNE','CYP','GEO','ARM','AZE','LUX','BIH','LVA',
  // 아시아
  'IND','IDN','VNM','THA','PHL','MYS','SGP','PAK','BGD','MMR','KHM','LAO','MNG','KAZ',
  'UZB','LKA','NPL',
  // 중동·아프리카
  'TUR','ISR','SAU','ARE','IRQ','IRN','EGY','SYR','QAT','KWT','JOR','ZAF','NGA','KEN',
  'ETH','MAR','DZA','LBY',
  // 미주
  'CAN','MEX','BRA','ARG','CHL','COL','PER','VEN','CUB',
  // 오세아니아
  'AUS','NZL','PNG','FJI',
];

/* 어느 줌까지 화면상 원본과 같게 둘지. 여기서 시작해 파일이 예산을 넘으면 한 단계씩 낮춘다. */
const ZOOM = 10;
const MIN_ZOOM = 7;                                      // 더 낮추면 나라 전체를 담는 줌에서도 티가 난다
const TOL_PX = 0.125;                                    // 소스의 GEO_TOLERANCE 와 같은 값

/* 나라 하나가 전송 이만큼을 넘지 않게 한다. 온디맨드라 이건 곧 '고르고 기다리는 시간'이다.
   해안선이 험한 나라는 같은 줌 기준으로도 열 배씩 벌어진다 — 칠레가 6MB 였다.
   방송에서 한 나라를 화면에 담는 줌은 대개 5~7 이라, 그런 나라는 조금 더 줄여도 안 보인다. */
const BUDGET = 1.5 * 1024 * 1024;                        // gzip 기준
const PREC = 5;
const round = (v) => Number(v.toFixed(PREC));

const mPerPx = (z) => 40075017 / (Math.pow(2, z) * 512);
const tolAt = (z) => (mPerPx(z) * TOL_PX) / 111320;

const ringsOf = (g) => (g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []);
const ptsOf = (f) => { let n = 0; for (const p of ringsOf(f.geometry)) for (const r of p) n += r.length; return n; };

/* 사내망에서 node 의 fetch 가 TLS 에 막히므로 curl 로 받는다. 받은 건 .cache/ 에 둔다. */
async function grab(url, file) {
  if (fs.existsSync(file) && fs.statSync(file).size > 500) return fs.readFileSync(file, 'utf8');
  fs.mkdirSync(CACHE, { recursive: true });
  const { execFileSync } = await import('node:child_process');
  execFileSync('curl', ['-sL', '-m', '600', '-A', 'ColorMap/3.3 (+https://github.com/DesignerAJ/ColorMap)',
                        '-o', file, url]);
  if (!fs.existsSync(file) || fs.statSync(file).size < 500) throw new Error('받지 못했다: ' + url);
  return fs.readFileSync(file, 'utf8');
}

// 더글러스-포이커. 링이 무너지지 않게 4점 미만이 되면 원본을 쓴다.
function simplify(ring, tol) {
  if (ring.length < 5) return ring;
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

// ── 실행 ──
const regions = fs.readFileSync(R + 'regions.js', 'utf8');
const COUNTRIES = new Function(regions.match(/const COUNTRIES = \[[\s\S]*?\];/)[0] + '\nreturn COUNTRIES;')();
const clean = (n) => n.replace(/\s*#[^#]*#\s*/g, '').trim();
const isoToKo = {};
COUNTRIES.forEach((c) => { isoToKo[c.i] = clean(c.n); });

const credits = [];
let done = 0, skipped = 0;
console.log(`geoBoundaries → 유럽 주요국 ${TARGETS.length}개국 (줌 ${ZOOM} 까지 화면상 무손실, 허용오차 ${mPerPx(ZOOM) * TOL_PX < 10 ? (mPerPx(ZOOM) * TOL_PX).toFixed(2) : '?'}m)\n`);

for (const iso of TARGETS) {
  const file = OUT + iso + '.json';
  if (!fs.existsSync(file)) { console.log(`  ${iso}  건너뜀 — ${file} 이 없다 (build-admin1-split.mjs 를 먼저 돌릴 것)`); skipped++; continue; }
  const ours = JSON.parse(fs.readFileSync(file, 'utf8'));

  // 우리 구역 수에 가장 가까운 레벨을 고른다
  let pick = null;
  /* ADM3 까지 본다. 나라마다 어느 층이 우리 '1급 행정구역'에 해당하는지가 제각각이다 —
     이탈리아는 geoBoundaries 의 ADM1 이 5개 광역권, ADM2 가 20개 주라서
     우리 110개 도(道)와 맞는 건 ADM3 다. */
  for (const lvl of ['ADM1', 'ADM2', 'ADM3']) {
    let meta;
    try { meta = JSON.parse(await grab(`${API}/${iso}/${lvl}/`, CACHE + `${iso}-${lvl}.meta.json`)); }
    catch { continue; }
    const o = Array.isArray(meta) ? meta[0] : meta;
    if (!o || !o.gjDownloadURL) continue;
    const n = Number(o.admUnitCount) || 0;
    const gap = Math.abs(n - ours.features.length) / Math.max(1, ours.features.length);
    if (!pick || gap < pick.gap) pick = { lvl, o, n, gap };
  }
  if (!pick || pick.gap > 0.25) {
    console.log(`  ${iso}  건너뜀 — 우리 ${ours.features.length}구역과 맞는 레벨이 없다` +
                (pick ? ` (가장 가까운 ${pick.lvl} ${pick.n}구역)` : ''));
    skipped++; continue;
  }

  let gb;
  try { gb = JSON.parse(await grab(pick.o.gjDownloadURL, CACHE + `${iso}-${pick.lvl}.geojson`)); }
  catch (e) { console.log(`  ${iso}  건너뜀 — 내려받기 실패: ${e.message}`); skipped++; continue; }

  // 짝짓기: 우리 폴리곤 안에 상대 무게중심이 들어가는가
  const pool = gb.features.map((f) => ({ f, c: centroid(f) })).filter((x) => x.c);
  const used = new Set();
  let matched = 0;
  const pairs = ours.features.map((mine) => {
    let hit = pool.find((x) => !used.has(x.f) && inFeature(x.c, mine));
    if (!hit) {                                          // 안에 없으면 가장 가까운 것 — 단 아주 가까울 때만
      let bd = Infinity, best = null;
      const c = centroid(mine);
      for (const x of pool) { if (used.has(x.f)) continue;
        const d = Math.hypot(x.c[0] - c[0], x.c[1] - c[1]);
        if (d < bd) { bd = d; best = x; } }
      if (best && bd < 0.3) hit = best;                  // 약 30km
    }
    if (hit) { used.add(hit.f); matched++; }
    return { mine, src: hit || null };                   // 짝이 없으면 src 가 null 이다
  });

  /* 줌 기준을 낮춰가며 예산에 맞춘다. 낮출수록 허용오차가 커지지만, 그 줌까지는
     여전히 화면상 원본과 같다 — 어디까지 보장하느냐만 달라진다. */
  const render = (z) => pairs.map((p) => {
    if (!p.src) return p.mine;                           // 짝 없는 구역은 원래 것 그대로
    const g = p.src.f.geometry;
    const polys = ringsOf(g).map((poly) => poly.map((r) => simplify(r, tolAt(z))));
    return { type: 'Feature', properties: p.mine.properties,
             geometry: { type: g.type, coordinates: g.type === 'Polygon' ? polys[0] : polys } };
  });

  let usedZoom = ZOOM, out = render(usedZoom), body = JSON.stringify({ type: 'FeatureCollection', features: out });
  while (zlib.gzipSync(Buffer.from(body), { level: 9 }).length > BUDGET && usedZoom > MIN_ZOOM) {
    usedZoom--;
    out = render(usedZoom);
    body = JSON.stringify({ type: 'FeatureCollection', features: out });
  }

  /* 짝을 못 찾은 구역은 원래 지오메트리를 그대로 둔다. 상대 파일에 아예 없는 경우가 있다 —
     네덜란드 15개는 본토 12개 주에 카리브 자치령 3개가 붙은 것이라 12/15 가 정상이다.
     그래서 못 찾은 게 있다고 나라를 통째로 버리지는 않는다. 다만 절반도 못 붙으면
     레벨을 잘못 고른 것이므로 손대지 않는다 — 그 상태로 쓰면 한 나라 안에서
     모양의 출처가 뒤섞인다. */
  const rate = matched / ours.features.length;
  if (rate < 0.7) {
    console.log(`  ${iso}  건너뜀 — ${ours.features.length}구역 중 ${matched}개만 짝을 찾았다 (${(rate * 100).toFixed(0)}%)`);
    skipped++; continue;
  }

  /* 구역 수가 맞는다고 더 정밀한 건 아니다. 이란(3,831점)·캐나다(5,901점)처럼 원본이
     이미 촘촘한 나라가 있어서, 그냥 갈아끼우면 조용히 나빠진다. 줄어들면 손대지 않는다.
     (아래 데이터 테스트는 admin1.json 원본과 비교하므로 이 경우를 못 잡는다 —
      원본보다는 나은데 지금보다 나쁜 상태가 그대로 통과한다) */
  const before = ours.features.reduce((s, f) => s + ptsOf(f), 0) / ours.features.length;
  const after = out.reduce((s, f) => s + ptsOf(f), 0) / out.length;
  if (after < before) {
    console.log(`  ${iso}  건너뜀 — 지금이 더 정밀하다 (${Math.round(before)} → ${Math.round(after)}점)`);
    skipped++; continue;
  }
  fs.writeFileSync(file, body);
  setSource(iso, { source: pick.o.boundarySourceFullName || pick.o.boundarySource || '?',
                   license: pick.o.boundaryLicense || '?', via: 'geoBoundaries', zoom: usedZoom });
  const kb = (fs.statSync(file).size / 1024).toFixed(0);
  console.log(`  ${iso} ${(isoToKo[iso] || '').padEnd(8)} ${pick.lvl} · ${matched}/${ours.features.length}구역 · ` +
              `${Math.round(before)} → ${Math.round(after)}점 · ${kb}KB · z${usedZoom}` + (matched < ours.features.length ? ` · ${ours.features.length - matched}개는 그대로` : ''));
  credits.push(`${isoToKo[iso] || iso}: ${pick.o.boundarySourceFullName || pick.o.boundarySource || '?'} (${pick.o.boundaryLicense || '?'})`);
  done++;
}

console.log(`\n올린 나라 ${done} · 건너뛴 나라 ${skipped}`);
console.log('\n출처 (README 에 옮길 것):');
credits.forEach((c) => console.log('  ' + c));
console.log('\nnode --test test/*.test.js 로 검증할 것');
