/* 북한 1급 행정구역을 OSM 에서 받아 admin1.json 의 '북한' 항목만 갈아끼운다.

   원래 admin1.json 에 들어 있던 북한 경계는 도당 100~220점짜리 저해상도였다.
   우리 시도가 도당 1.6만점인데 옆에 나란히 그려지니 눈에 띄게 각졌고,
   무엇보다 군사분계선 구간이 우리 경기·강원 경계와 중앙값 1.75~6.6km 어긋나
   같이 칠하면 선이 겹치거나 벌어졌다.

   그래서 두 가지를 한다 —
     1. OSM 에서 도당 800~7,900점짜리 경계를 받아 통째로 교체
     2. 군사분계선에 닿는 도(강원도·개성시)는 그 구간을 korea-border.json 으로 **치환**한다.
        같은 선을 두 데이터가 각자 그리면 아무리 정밀해도 또 어긋나기 때문이다.
        korea-border.json 은 우리 시도 데이터에서 뽑은 선이라, 치환하면 경기·강원과
        꼭짓점 단위로 붙는다 (test/data.test.js 가 그 조건을 검사한다).

   덤으로 원본에 아예 빠져 있던 개성특별시·남포특별시가 들어와 11개 → 13개가 된다.

   출처: OpenStreetMap contributors (ODbL). 새만금과 같은 출처·같은 라이선스다.
   의존성 없음. 실행: node recorder/tools/build-nk-admin1.mjs
*/
import fs from 'node:fs';

const R = 'recorder/js/data/';
const OVERPASS = 'https://overpass-api.de/api/interpreter';

/* OSM 이름 → 이 저장소가 쓰던 이름.
   기존 11개는 이름을 그대로 유지한다 (사용자가 입력하던 값이고, 검색 색인이 여기에 걸려 있다).
   OSM 은 '평양시'·'라선시'로 짧게 쓰지만 우리는 정식 명칭을 쓴다. */
const NAME = {
  '평양시': '평양직할시', '라선시': '라선특별시',
  '남포시': '남포특별시', '개성시': '개성특별시',
};

const KM = (dx, dy, lat) => Math.hypot(dx * 111 * Math.cos(lat * Math.PI / 180), dy * 111);
const KEY = (p) => p[0].toFixed(7) + ',' + p[1].toFixed(7);

/* 사내망에서는 node 의 fetch 가 TLS 에서 막힌다 (SELF_SIGNED_CERT_IN_CHAIN — 인증서를
   가로채는 환경). curl 은 시스템 키체인을 쓰므로 그대로 통과한다. 그래서 fetch 를 먼저
   해보고 막히면 curl 로 넘어간다. 인증서를 끄는(NODE_TLS_REJECT_UNAUTHORIZED=0) 선택은
   하지 않는다 — 한 번 끄면 그 뒤로 아무도 안 켠다. */
async function overpass(query) {
  try {
    const r = await fetch(OVERPASS, { method: 'POST', body: query });
    if (!r.ok) throw new Error(`Overpass ${r.status} — 잠시 뒤 다시 시도하세요`);
    return await r.json();
  } catch (e) {
    if (!/certificate|fetch failed/i.test(String(e.message || e))) throw e;
    console.log('  (node fetch 가 인증서에 막혀 curl 로 받는다)');
    const { execFileSync } = await import('node:child_process');
    const out = execFileSync('curl', ['-s', '-m', '600', '-X', 'POST', '--data-binary', '@-', OVERPASS],
      { input: query, maxBuffer: 512 * 1024 * 1024, encoding: 'utf8' });
    if (!out.trim()) throw new Error('Overpass 응답이 비었다 — 잠시 뒤 다시 시도하세요');
    return JSON.parse(out);
  }
}

/* 릴레이션의 way 조각을 이어 닫힌 링으로. 조각 순서와 방향이 제각각이라 양쪽 끝을 다 본다. */
function stitch(members) {
  const pool = members.filter(m => m.type === 'way' && m.geometry && m.geometry.length > 1)
    .map(m => m.geometry.map(g => [g.lon, g.lat]));
  const rings = [];
  while (pool.length) {
    let cur = pool.shift();
    let grew = true;
    while (grew && KEY(cur[0]) !== KEY(cur.at(-1))) {
      grew = false;
      for (let i = 0; i < pool.length; i++) {
        const p = pool[i];
        if (KEY(cur.at(-1)) === KEY(p[0]))     { cur = cur.concat(p.slice(1));                       pool.splice(i,1); grew = true; break; }
        if (KEY(cur.at(-1)) === KEY(p.at(-1))) { cur = cur.concat(p.slice().reverse().slice(1));      pool.splice(i,1); grew = true; break; }
        if (KEY(cur[0])     === KEY(p.at(-1))) { cur = p.slice(0,-1).concat(cur);                     pool.splice(i,1); grew = true; break; }
        if (KEY(cur[0])     === KEY(p[0]))     { cur = p.slice().reverse().slice(0,-1).concat(cur);   pool.splice(i,1); grew = true; break; }
      }
    }
    if (KEY(cur[0]) !== KEY(cur.at(-1))) cur.push(cur[0].slice());
    if (cur.length >= 4) rings.push(cur);
  }
  return rings;
}

const ringArea = (r) => {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += r[j][0]*r[i][1] - r[i][0]*r[j][1];
  return Math.abs(a / 2);
};

// ── 국경선 ──────────────────────────────────────────────────────────
/* korea-border.json 은 LineString 여러 개로 나뉘어 있고 끝점이 맞물린다. 하나로 잇는다.

   `kind: 'estuary'` 조각은 뺀다 — 한강 하구부터 서쪽은 물 위를 지나는 표기선(OSM)이라
   북한의 육지 경계가 아니다. 넣으면 북한 도를 엉뚱한 곳에 맞물리려 든다. */
function loadBorder() {
  const b = JSON.parse(fs.readFileSync(R + 'korea-border.json'));
  const lines = b.features.filter(f => (f.properties || {}).kind !== 'estuary')
    .map(f => f.geometry.coordinates);
  let line = lines.shift();
  while (lines.length) {
    const i = lines.findIndex(l => KEY(l[0]) === KEY(line.at(-1)) || KEY(l.at(-1)) === KEY(line.at(-1))
                                || KEY(l[0]) === KEY(line[0])     || KEY(l.at(-1)) === KEY(line[0]));
    if (i < 0) throw new Error('국경선 조각이 이어지지 않는다');
    const l = lines.splice(i, 1)[0];
    if      (KEY(l[0])     === KEY(line.at(-1))) line = line.concat(l.slice(1));
    else if (KEY(l.at(-1)) === KEY(line.at(-1))) line = line.concat(l.slice().reverse().slice(1));
    else if (KEY(l.at(-1)) === KEY(line[0]))     line = l.slice(0,-1).concat(line);
    else                                          line = l.slice().reverse().slice(0,-1).concat(line);
  }
  return line;
}

/* 점에서 국경선까지 — 가장 가까운 변의 인덱스와 그 변에서의 위치(t)까지 돌려준다.
   치환할 구간을 잘라내려면 거리만으로는 부족하고 '선 위 어디인가'가 필요하다. */
function project(p, line) {
  let best = { d: Infinity, i: 0, t: 0, pt: line[0] };
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i], b = line[i+1];
    const dx = b[0]-a[0], dy = b[1]-a[1], L = dx*dx + dy*dy;
    let t = L ? ((p[0]-a[0])*dx + (p[1]-a[1])*dy) / L : 0;
    t = Math.max(0, Math.min(1, t));
    const pt = [a[0] + dx*t, a[1] + dy*t];
    const d = KM(p[0]-pt[0], p[1]-pt[1], p[1]);
    if (d < best.d) best = { d, i, t, pt };
  }
  return best;
}

// 국경선 위 두 지점 사이를 잘라낸다 (진행 방향 포함)
function borderSlice(from, to, line) {
  const fwd = from.i < to.i || (from.i === to.i && from.t <= to.t);
  const [a, b] = fwd ? [from, to] : [to, from];
  const mid = line.slice(a.i + 1, b.i + 1).map(p => p.slice());
  const out = [a.pt.slice(), ...mid, b.pt.slice()];
  return fwd ? out : out.reverse();
}

/* 군사분계선에 닿는 구간을 우리 국경선으로 치환한다.

   TOL: 국경선에 '닿아 있다'로 볼 거리. OSM 과 우리 선은 최대 2km 안쪽에서 논다.
   GAP: 그 안에서 잠깐 벌어지는 곳(최대 2.9km)이 있어 구간이 토막나는데,
        토막마다 따로 치환하면 사이에 OSM 선이 남아 어긋난 채로 남는다.
        연속으로 GAP 개까지 벗어나는 건 같은 구간으로 본다. */
function snapToBorder(ring, line, TOL = 2, GAP = 80) {
  const open = ring.slice(0, -1);
  const n = open.length;
  const near = open.map(p => project(p, line).d < TOL);
  if (!near.some(Boolean)) return null;

  // 짧은 끊김 메우기 (원형)
  const filled = near.slice();
  for (let s = 0; s < n; s++) {
    if (filled[s] || !near[(s - 1 + n) % n]) continue;
    let k = 0;
    while (k <= GAP && !near[(s + k) % n]) k++;
    if (k <= GAP && near[(s + k) % n]) for (let j = 0; j < k; j++) filled[(s + j) % n] = true;
  }
  if (filled.every(Boolean)) return null;          // 링 전체가 국경선일 리 없다 — 안전장치

  // 최장 연속 구간 (원형)
  let start = filled.findIndex((v, i) => v && !filled[(i - 1 + n) % n]);
  let bestS = -1, bestLen = 0;
  for (let c = 0; c < n; c++) {
    const s = (start + c) % n;
    if (!filled[s] || filled[(s - 1 + n) % n]) continue;
    let len = 0;
    while (len < n && filled[(s + len) % n]) len++;
    if (len > bestLen) { bestLen = len; bestS = s; }
  }
  if (bestLen < 20) return null;                   // 스치기만 한 도는 건드리지 않는다

  const S = bestS, E = (bestS + bestLen - 1) % n;
  const sub = borderSlice(project(open[S], line), project(open[E], line), line);
  const rest = [];
  for (let k = 1; k < n - bestLen + 1; k++) rest.push(open[(E + k) % n].slice());
  const out = sub.concat(rest);
  out.push(out[0].slice());
  return { ring: out, replaced: bestLen, added: sub.length };
}

// ── 바다 잘라내기 ───────────────────────────────────────────────────
/* OSM 행정경계는 **영해까지** 포함한다. 황해남도 멤버 way 72개 중 25개가 `maritime=yes` 다.
   그대로 쓰면 도를 칠했을 때 서해가 통째로 칠해진다.

   그런데 태그로 거르면 안 된다 — 태그 없는 way 도 바다를 지나서, 태그만 믿고 자르면
   '육지' 쪽 끝점이 해안에서 22km 떨어진 곳에 찍힌다. 그래서 태그 대신 **꼭짓점이
   해안선 안쪽인지 직접 판정**한다.

   판정은 동쪽으로 광선을 쏴 해안선과 만나는 횟수를 센다. 해안선을 닫힌 고리로 이어
   쓰는 방법도 있지만, 받아온 해안선은 bbox 에서 잘려 있어 억지로 닫으면 고리 안쪽이
   바다가 되어 버린다(내륙 4개 도가 통째로 '바다'로 나왔다). 북한 동쪽은 이 범위 안에서
   전부 바다라 동쪽 광선은 그 문제를 겪지 않는다. */
async function loadCoast() {
  const d = await overpass(`[out:json][timeout:600];
way["natural"="coastline"](37.40,123.80,43.30,131.40);
out geom;`);
  const segs = [], byLat = new Map();
  const CELL = 0.05;
  for (const w of d.elements) {
    const g = w.geometry;
    for (let i = 0; i < g.length - 1; i++) {
      const k = segs.push([[g[i].lon, g[i].lat], [g[i+1].lon, g[i+1].lat]]) - 1;
      const [a, b] = segs[k];
      for (let c = Math.floor(Math.min(a[1],b[1])/CELL); c <= Math.floor(Math.max(a[1],b[1])/CELL); c++) {
        if (!byLat.has(c)) byLat.set(c, []);
        byLat.get(c).push(k);
      }
    }
  }
  const lines = stitch(d.elements.map(w => ({ type: 'way', geometry: w.geometry })));
  return { segs, byLat, CELL, lines, ways: d.elements.length };
}

const inLand = (p, C) => {
  let n = 0;
  for (const k of C.byLat.get(Math.floor(p[1] / C.CELL)) || []) {
    const [a, b] = C.segs[k];
    if ((a[1] > p[1]) !== (b[1] > p[1])) {
      if (p[0] < (b[0]-a[0]) * (p[1]-a[1]) / (b[1]-a[1]) + a[0]) n++;
    }
  }
  return n % 2 === 1;
};

// 선분이 해안선을 처음 만나는 지점 (P0 쪽에서 가까운 순) — 어느 해안선 줄의 몇 번째 변인지까지
function crossing(P0, P1, C) {
  let best = null;
  for (let L = 0; L < C.lines.length; L++) {
    const ln = C.lines[L];
    for (let i = 0; i < ln.length - 1; i++) {
      const a = ln[i], b = ln[i+1];
      if (Math.min(a[1],b[1]) > Math.max(P0[1],P1[1]) || Math.max(a[1],b[1]) < Math.min(P0[1],P1[1])) continue;
      if (Math.min(a[0],b[0]) > Math.max(P0[0],P1[0]) || Math.max(a[0],b[0]) < Math.min(P0[0],P1[0])) continue;
      const d1x = P1[0]-P0[0], d1y = P1[1]-P0[1], d2x = b[0]-a[0], d2y = b[1]-a[1];
      const den = d1x*d2y - d1y*d2x;
      if (!den) continue;
      const t = ((a[0]-P0[0])*d2y - (a[1]-P0[1])*d2x) / den;
      const u = ((a[0]-P0[0])*d1y - (a[1]-P0[1])*d1x) / den;
      if (t < 0 || t > 1 || u < 0 || u > 1) continue;
      if (!best || t < best.t) best = { t, L, i, pt: [P0[0]+d1x*t, P0[1]+d1y*t] };
    }
  }
  return best;
}

/* 해안선 한 줄 위의 두 지점 사이 — 두 방향 중 짧은 쪽.
   만(灣) 하나를 도는 길과 대륙을 한 바퀴 도는 길 중 고르는 문제라 짧은 쪽이 늘 맞다. */
function coastSlice(from, to, C) {
  const ln = C.lines[from.L], n = ln.length - 1;
  const walk = (dir) => {
    const out = [];
    let i = dir > 0 ? (from.i + 1) % n : from.i;
    for (let g = 0; g < n; g++) {
      if (dir > 0 ? i === (to.i + 1) % n : i === to.i) break;
      out.push(ln[i].slice());
      i = (i + dir + n) % n;
    }
    return out;
  };
  const f = walk(1), b = walk(-1);
  return [from.pt.slice(), ...(f.length <= b.length ? f : b), to.pt.slice()];
}

function clipToLand(ring, C) {
  const open = ring.slice(0, -1);
  const n = open.length;
  const land = open.map((p) => inLand(p, C));
  const sea = land.filter((x) => !x).length;
  if (!sea) return { ring, sea: 0 };
  if (!land.some(Boolean)) return { ring, sea, failed: '전부 바다로 판정' };

  const start = land.findIndex(Boolean);
  const out = [];
  let bridged = 0, straight = 0;
  for (let c = 0; c < n; c++) {
    const k = (start + c) % n;
    if (land[k]) { out.push(open[k].slice()); continue; }
    let len = 0;
    while (len < n && !land[(start + c + len) % n]) len++;
    const prev = (start + c - 1 + n) % n, next = (start + c + len) % n;
    const ex = crossing(open[prev], open[k], C);
    const en = crossing(open[next], open[(next - 1 + n) % n], C);
    if (ex && en && ex.L === en.L) { out.push(...coastSlice(ex, en, C)); bridged++; }
    else { out.push(...(ex ? [ex.pt.slice()] : []), ...(en ? [en.pt.slice()] : [])); straight++; }
    c += len - 1;
  }
  out.push(out[0].slice());
  return { ring: out, sea, bridged, straight };
}

// 원래(영해 포함) 폴리곤 안에 통째로 들어가는 섬은 따로 붙인다 — 안 그러면 갈도·무도 같은 섬이 사라진다
function islandsInside(origRing, C) {
  const inRing = (pt, r) => {
    let c = false;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [xi, yi] = r[i], [xj, yj] = r[j];
      if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj-xi) * (pt[1]-yi)) / (yj-yi) + xi) c = !c;
    }
    return c;
  };
  const out = [];
  for (const ln of C.lines) {
    if (ln.length < 4 || KEY(ln[0]) !== KEY(ln.at(-1))) continue;
    if (ln.length > 5000) continue;                       // 본토 해안선은 섬이 아니다
    const mid = ln[Math.floor(ln.length / 2)];
    if (!inRing(mid, origRing) || !inRing(ln[0], origRing)) continue;
    out.push(ln.map((p) => p.slice()));
  }
  return out;
}

// ── 실행 ────────────────────────────────────────────────────────────
const admin1 = JSON.parse(fs.readFileSync(R + 'admin1.json'));
const keep = admin1.features.filter(f => f.properties.country !== '북한');
const old = new Map(admin1.features.filter(f => f.properties.country === '북한')
  .map(f => [f.properties.short, f.properties]));
console.log(`admin1.json: 전체 ${admin1.features.length} · 북한 ${old.size} · 나머지 ${keep.length}`);

console.log('OSM 에서 북한 1급 행정구역을 받는 중…');
const data = await overpass(`[out:json][timeout:600];
rel["boundary"="administrative"]["admin_level"="4"]["ISO3166-2"~"^KP-"];
out geom;`);
if (data.elements.length < 13) throw new Error(`행정구역이 ${data.elements.length}개뿐 — OSM 응답을 확인하세요`);

const border = loadBorder();
console.log(`국경선 ${border.length}점을 하나로 이었다`);

console.log('해안선을 받는 중… (영해를 잘라내는 데 쓴다)');
const coast = await loadCoast();
console.log(`해안선 ${coast.ways}조각 · ${coast.segs.length}변 → ${coast.lines.length}줄\n`);

const built = [];
for (const e of data.elements) {
  const osmName = e.tags['name:ko'] || e.tags.name;
  const short = NAME[osmName] || osmName;
  let rings = stitch(e.members).sort((a, b) => ringArea(b) - ringArea(a));
  const orig = rings[0];

  // 1) 영해를 잘라낸다 (내륙 도는 바다쪽 점이 0개라 그대로 지나간다)
  const clipped = clipToLand(orig, coast);
  if (clipped.failed) throw new Error(`${short}: ${clipped.failed}`);
  rings[0] = clipped.ring;
  let note = clipped.sea ? ` · 바다쪽 ${clipped.sea}점 잘라냄` : '';
  if (clipped.straight) note += ` (해안선 잇기 실패 ${clipped.straight}곳은 직선 처리)`;

  // 2) 잘라내면서 사라진 섬을 되붙인다 (갈도·무도·장재도 같은 것)
  if (clipped.sea) {
    const isl = islandsInside(orig, coast);
    if (isl.length) { rings = rings.concat(isl); note += ` · 섬 ${isl.length}개 되붙임`; }
  }

  // 3) 군사분계선 구간을 우리 국경선으로 치환
  const snapped = snapToBorder(rings[0], border);
  if (snapped) {
    rings[0] = snapped.ring;
    note += ` · 국경 ${snapped.replaced}점 → 우리 선 ${snapped.added}점`;
  }

  const pts = rings.flat();
  const lo = pts.map(p => p[0]), la = pts.map(p => p[1]);
  const [w, h] = [Math.max(...lo) - Math.min(...lo), Math.max(...la) - Math.min(...la)];
  const prev = old.get(short);
  /* 기존 항목은 카메라 목표점을 그대로 둔다 — 손보던 값이고, 경계가 정밀해져도
     대표점이 달라질 이유가 없다. 새로 들어오는 개성·남포만 계산한다.
     z 는 이 파일의 기존 값들에서 역산한 관계(가로세로 중 긴 변 기준)를 따랐다. */
  const c = prev ? prev.c : [(Math.min(...lo) + Math.max(...lo)) / 2, (Math.min(...la) + Math.max(...la)) / 2];
  const z = prev ? prev.z : Math.round((Math.log2(360 / Math.max(w, h)) + 0.35) * 10) / 10;

  built.push({
    type: 'Feature',
    properties: { country: '북한', short, name: `북한 ${short}`, c, z },
    geometry: rings.length === 1
      ? { type: 'Polygon', coordinates: [rings[0]] }
      : { type: 'MultiPolygon', coordinates: rings.map(r => [r]) },
  });
  console.log(`  ${short.padEnd(7)} 링 ${String(rings.length).padStart(2)} · ${String(pts.length).padStart(6)}점` +
    `${prev ? '' : '  (새로 추가)'}${note}`);
}

built.sort((a, b) => a.properties.short.localeCompare(b.properties.short, 'ko'));
admin1.features = keep.concat(built);
fs.writeFileSync(R + 'admin1.json', JSON.stringify(admin1));
const mb = fs.statSync(R + 'admin1.json').size / 1048576;
console.log(`\nadmin1.json 갱신: 북한 ${old.size} → ${built.length}개 · ${mb.toFixed(1)} MB`);
console.log('node --test test/data.test.js 로 검증할 것');
