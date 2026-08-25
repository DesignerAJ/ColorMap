/* 유럽 주요국 행정구역을 각국 공식 데이터(geoBoundaries)로 올린다.

   `build-admin1-split.mjs` 가 만든 나라별 파일을 **덮어쓴다.** 반드시 그 뒤에 돌린다.

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

const R = 'recorder/js/data/';
const OUT = R + 'admin1/';
const CACHE = 'recorder/tools/.cache/gb/';
const API = 'https://www.geoboundaries.org/api/current/gbOpen';

/* 유럽 주요국. 우크라이나·러시아는 코어(원본이 이미 정밀)라 여기 없다. */
const TARGETS = ['FRA','DEU','GBR','ITA','ESP','POL','NLD','BEL','CHE','AUT',
                 'SWE','NOR','DNK','FIN','PRT','GRC','CZE','HUN','ROU','IRL',
                 'SRB','HRV','SVK','BGR'];

const ZOOM = 10;                                         // 이 줌까지 화면상 원본과 같다
const TOL_PX = 0.125;                                    // 소스의 GEO_TOLERANCE 와 같은 값
const PREC = 5;
const round = (v) => Number(v.toFixed(PREC));

const mPerPx = (z) => 40075017 / (Math.pow(2, z) * 512);
const TOL_DEG = (mPerPx(ZOOM) * TOL_PX) / 111320;

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
  const out = ours.features.map((mine) => {
    let hit = pool.find((x) => !used.has(x.f) && inFeature(x.c, mine));
    if (!hit) {                                          // 안에 없으면 가장 가까운 것 — 단 아주 가까울 때만
      let bd = Infinity, best = null;
      const c = centroid(mine);
      for (const x of pool) { if (used.has(x.f)) continue;
        const d = Math.hypot(x.c[0] - c[0], x.c[1] - c[1]);
        if (d < bd) { bd = d; best = x; } }
      if (best && bd < 0.3) hit = best;                  // 약 30km
    }
    if (!hit) return mine;
    used.add(hit.f); matched++;
    const polys = ringsOf(hit.f.geometry).map((poly) => poly.map((r) => simplify(r, TOL_DEG)));
    return { type: 'Feature', properties: mine.properties,
             geometry: { type: hit.f.geometry.type, coordinates: hit.f.geometry.type === 'Polygon' ? polys[0] : polys } };
  });

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

  const before = ours.features.reduce((s, f) => s + ptsOf(f), 0) / ours.features.length;
  fs.writeFileSync(file, JSON.stringify({ type: 'FeatureCollection', features: out }));
  const after = out.reduce((s, f) => s + ptsOf(f), 0) / out.length;
  const kb = (fs.statSync(file).size / 1024).toFixed(0);
  console.log(`  ${iso} ${(isoToKo[iso] || '').padEnd(8)} ${pick.lvl} · ${matched}/${ours.features.length}구역 · ` +
              `${Math.round(before)} → ${Math.round(after)}점 · ${kb}KB` + (matched < ours.features.length ? ` · ${ours.features.length - matched}개는 그대로` : ''));
  credits.push(`${isoToKo[iso] || iso}: ${pick.o.boundarySourceFullName || pick.o.boundarySource || '?'} (${pick.o.boundaryLicense || '?'})`);
  done++;
}

console.log(`\n올린 나라 ${done} · 건너뛴 나라 ${skipped}`);
console.log('\n출처 (README 에 옮길 것):');
credits.forEach((c) => console.log('  ' + c));
console.log('\nnode --test test/*.test.js 로 검증할 것');
