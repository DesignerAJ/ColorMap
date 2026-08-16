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
/* korea-border.json 은 LineString 두 개로 나뉘어 있고 끝점이 맞물린다. 하나로 잇는다. */
function loadBorder() {
  const b = JSON.parse(fs.readFileSync(R + 'korea-border.json'));
  const lines = b.features.map(f => f.geometry.coordinates);
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
console.log(`국경선 ${border.length}점을 하나로 이었다\n`);

const built = [];
for (const e of data.elements) {
  const osmName = e.tags['name:ko'] || e.tags.name;
  const short = NAME[osmName] || osmName;
  let rings = stitch(e.members).sort((a, b) => ringArea(b) - ringArea(a));

  let note = '';
  const snapped = snapToBorder(rings[0], border);
  if (snapped) {
    rings[0] = snapped.ring;
    note = ` · 국경 구간 ${snapped.replaced}점 → 우리 국경선 ${snapped.added}점으로 치환`;
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
