/* 한강 하구 구간을 이어 붙이고, 염하로 잘못 꺾인 꼬리를 잘라낸다.

   `build-korea-border.mjs` 는 경기도·강원도에서만 선을 뽑는다. 그런데 강화도·교동도·
   석모도는 **인천광역시**라, 선이 126.53°E 에서 끊기고 그 앞 96점은 김포 서쪽 가장자리 —
   염하(김포와 강화 사이 물길)를 따라 남쪽으로 꺾여 내려갔다. 2.0 은 강화·교동 **위로**
   이어졌다.

   인천을 재료에 넣어도 해결되지 않는다. 우리 시도 데이터로 만들 수 있는 선은 강화·교동의
   해안선이지 하구 한가운데를 지나는 선이 아니기 때문이다. 애초에 **한강 하구에는 군사분계선이
   없다** — 정전협정상 중립수역(파주 만우리 ~ 강화 말도, 약 70km)이다. 하구를 가로지르는 선은
   실측된 경계가 아니라 표기 관례이고, 2.0 이 쓰던 관례가 곧 Mapbox = OSM 의 선이다.

   그래서 육상 군사분계선까지는 우리 데이터(색칠과 꼭짓점 단위로 붙는다), 하구부터 서쪽은
   OSM 의 KP-KR 경계를 쓴다. 하구는 물 위라 어느 쪽 색칠도 닿지 않으므로 출처가 달라도
   어긋나 보일 일이 없다.

   이음매는 우리 선에서 OSM 하구 구간의 동쪽 끝(126.6522, 37.7810)에 가장 가까운 점이다.
   실측 50m 로 맞아떨어진다.

   결과는 `korea-border.json` 한 파일에 담는다. 육상 구간은 `kind: "land"`, 하구·해상
   구간은 `kind: "estuary"` 로 표시한다 — `build-nk-admin1.mjs` 가 북한 경계를 맞물릴 때
   육상 구간만 써야 하기 때문이다 (하구는 북한 육지 경계가 아니다).

   출처: OpenStreetMap contributors (ODbL)
   실행: node recorder/tools/build-han-estuary.mjs
*/
import fs from 'node:fs';

const R = 'recorder/js/data/';
const OVERPASS = 'https://overpass-api.de/api/interpreter';

/* Overpass 는 User-Agent 없는 요청을 406 Not Acceptable 로 막는다. node 의 fetch 는
   기본 UA 가 'node' 인데 그것도 막힌다 — curl 은 통과하므로 오래 '사내망 탓'으로 보였다.
   실제 응답은 HTML 안내문이라 '혼잡'과 구별이 안 돼 재시도만 네 번 돌다 죽었다.
   UA 를 밝히면 그대로 통과한다. OSM 은 어차피 UA 로 연락처를 밝히길 요구한다. */
const UA = 'ColorMap/3.0 (+https://github.com/DesignerAJ/ColorMap)';
const KM = (dx, dy, lat) => Math.hypot(dx * 111 * Math.cos(lat * Math.PI / 180), dy * 111);
const KEY = (p) => p[0].toFixed(7) + ',' + p[1].toFixed(7);

// 사내 인증서 때문에 node fetch 가 막힌다 — build-nk-admin1.mjs 와 같은 이유로 curl 로 넘어간다
/* Overpass 는 부하가 걸리면 JSON 대신 HTML 안내문을 준다. 그대로 파싱하면 터지므로
   기다렸다 다시 부른다 — 하루에 여러 번 돌리면 실제로 자주 걸린다. */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function overpassOnce(query) {
  try {
    const r = await fetch(OVERPASS, { method: 'POST', body: query, headers: { 'User-Agent': UA } });
    if (!r.ok) throw new Error(`Overpass ${r.status}`);
    return await r.json();
  } catch (e) {
    if (!/certificate|fetch failed/i.test(String(e.message || e))) throw e;
    const { execFileSync } = await import('node:child_process');
    const out = execFileSync('curl', ['-s', '-m', '300', '-A', UA, '-X', 'POST', '--data-binary', '@-', OVERPASS],
      { input: query, maxBuffer: 64 * 1024 * 1024, encoding: 'utf8' });
    if (!out.trim().startsWith('{')) throw new Error('Overpass 가 JSON 을 주지 않았다 (혼잡)');
    return JSON.parse(out);
  }
}

async function overpass(query) {
  /* Overpass 는 504 를 간헐적으로 뱉는다 — 부하가 걸리면 서버가 게이트웨이에서 끊는다.
     같은 질의가 바로 다음 시도에 200 으로 돌아온다. 이 스크립트는 질의를 여러 번 하고
     한 번에 몇 분씩 걸리므로, 중간에 한 번 걸려 죽으면 처음부터 다시다.
     네 번으로는 모자랐다 (실측: 세 번 연속 504 뒤 네 번째 200). 넉넉히 기다린다. */
  const waits = [0, 10, 20, 40, 60, 90, 120, 180];
  let last;
  for (let i = 0; i < waits.length; i++) {
    // 재시도 사유를 '혼잡'으로 단정하지 않는다 — 406(UA 차단)을 혼잡으로 읽어 네 번 헛돌았다
    if (waits[i]) { console.log(`  ${last} — ${waits[i]}초 뒤 다시 시도`); await sleep(waits[i] * 1000); }
    try { return await overpassOnce(query); } catch (e) {
      last = e.message || e;
      if (i === waits.length - 1) throw e;
    }
  }
}

function stitch(parts) {
  const pool = parts.slice();
  const lines = [];
  while (pool.length) {
    let cur = pool.shift();
    let grew = true;
    while (grew) {
      grew = false;
      for (let i = 0; i < pool.length; i++) {
        const p = pool[i];
        if (KEY(cur.at(-1)) === KEY(p[0]))     { cur = cur.concat(p.slice(1));                     pool.splice(i,1); grew = true; break; }
        if (KEY(cur.at(-1)) === KEY(p.at(-1))) { cur = cur.concat(p.slice().reverse().slice(1));    pool.splice(i,1); grew = true; break; }
        if (KEY(cur[0])     === KEY(p.at(-1))) { cur = p.slice(0,-1).concat(cur);                   pool.splice(i,1); grew = true; break; }
        if (KEY(cur[0])     === KEY(p[0]))     { cur = p.slice().reverse().slice(0,-1).concat(cur); pool.splice(i,1); grew = true; break; }
      }
    }
    lines.push(cur);
  }
  return lines;
}

const border = JSON.parse(fs.readFileSync(R + 'korea-border.json'));
const land = border.features.filter(f => (f.properties || {}).kind !== 'estuary');
if (!land.length) throw new Error('육상 구간이 없다');
console.log(`korea-border.json: 조각 ${land.length} · ${land.reduce((s,f)=>s+f.geometry.coordinates.length,0)}점`);

console.log('OSM 에서 KP-KR 경계를 받는 중…');
const data = await overpass(`[out:json][timeout:300];
way["boundary"="administrative"]["admin_level"="2"](37.55,125.30,38.40,127.20);
out geom;`);
const ways = data.elements.filter(w => w.geometry && w.geometry.length > 1);
if (!ways.length) throw new Error('OSM 응답에 경계 way 가 없다');
const lines = stitch(ways.map(w => w.geometry.map(g => [g.lon, g.lat])));
const chain = lines.sort((a, b) => b.length - a.length)[0];
const west = chain[0][0] < chain.at(-1)[0] ? chain : chain.slice().reverse();   // 서 → 동
console.log(`  way ${ways.length} → ${lines.length}줄, 가장 긴 줄 ${chain.length}점 (경도 ${west[0][0].toFixed(3)} ~ ${west.at(-1)[0].toFixed(3)})`);

/* 이음매 찾기 — 하구 구간(한강·maritime)의 동쪽 끝. 여기서부터 서쪽이 우리가 못 만드는 구간이다. */
const hanPts = ways.filter(w => (w.tags||{}).name === '한강' || (w.tags||{}).maritime === 'yes')
  .flatMap(w => w.geometry.map(g => [g.lon, g.lat]));
if (!hanPts.length) throw new Error('하구(한강·maritime) 구간을 못 찾았다');
const joint = hanPts.reduce((a, p) => (p[0] > a[0] ? p : a), hanPts[0]);
console.log(`  하구 동쪽 끝(이음매): ${joint[0].toFixed(4)}, ${joint[1].toFixed(4)}`);

// 우리 선에서 이음매에 가장 가까운 점 — 그 뒤(서쪽 꼬리)를 버린다
let cut = { d: Infinity };
for (const f of land) {
  const c = f.geometry.coordinates;
  c.forEach((p, i) => { const d = KM(p[0]-joint[0], p[1]-joint[1], p[1]); if (d < cut.d) cut = { d, f, i }; });
}
console.log(`  우리 선에서 가장 가까운 점: ${cut.d.toFixed(3)}km`);
if (cut.d > 1) throw new Error(`이음매가 우리 선에서 ${cut.d.toFixed(2)}km 떨어져 있다 — 확인 필요`);

const dropped = cut.f.geometry.coordinates.length - 1 - cut.i;
cut.f.geometry.coordinates = cut.f.geometry.coordinates.slice(0, cut.i + 1);
console.log(`  염하 꼬리 ${dropped}점 잘라냄`);

/* 동쪽 끝도 같은 문제가 있다. 군사분계선은 고성에서 동해에 닿으며 끝나는데,
   선이 거기서 멈추지 않고 **해안을 따라 5.8km 더 남쪽으로** 내려가 있었다.
   그만큼의 해안이 선 북쪽에 놓여 북한 땅처럼 보인다.

   원인은 서쪽 꼬리와 같다 — `build-korea-border.mjs` 가 Mapbox 국경선에서 5km 안쪽에
   있는 우리 시도 변을 모으는데, 해안에서는 해안선도 그 안에 들어온다.

   군사분계선이 바다에 닿는 지점은 강원도 경계의 **최북단**이다. 거기서 자른다. */
/* 조각이 서로 맞물리는 이음매는 건드리면 안 된다 — 거기서 자르면 선이 끊긴다.
   한 번만 나오는 끝점(= 자유로운 끝)에서만 자른다. */
const endCount = new Map();
for (const f of land) for (const p of [f.geometry.coordinates[0], f.geometry.coordinates.at(-1)]) {
  const kk = KEY(p);
  endCount.set(kk, (endCount.get(kk) || 0) + 1);
}
for (const f of land) {
  const c = f.geometry.coordinates;
  if (endCount.get(KEY(c[0])) !== 1) continue;            // 시작점이 이음매다
  let top = 0;
  c.forEach((p, i) => { if (p[1] > c[top][1]) top = i; });
  if (!top) continue;                                     // 이미 최북단에서 시작한다
  let len = 0;
  for (let i = 1; i <= top; i++) len += KM(c[i][0]-c[i-1][0], c[i][1]-c[i-1][1], c[i][1]);
  if (len > 15) throw new Error(`동쪽 꼬리가 ${len.toFixed(1)}km — 너무 길다. 최북단이 종점이 맞는지 확인하세요`);
  f.geometry.coordinates = c.slice(top);
  console.log(`  동해안 꼬리 ${top}점 (${len.toFixed(2)}km) 잘라냄 — 종점 ${c[top][0].toFixed(4)}, ${c[top][1].toFixed(4)}`);
}

/* 잘라낸 종점은 우리 시도 경계의 끝인데, 화면에 그려지는 해안선은 OSM(=Mapbox) 것이라
   265m 쯤 더 동쪽에 있다. VWorld 가 DMZ 를 빼면서 생긴 차이다. 그대로 두면 국경선이
   바다에 닿지 못하고 살짝 못 미친 채 끊겨 보인다.

   종점에서 가장 가까운 해안선까지 이어 붙인다. 실측으로 방위 59°(2시 방향) · 265m 다. */
let shore = null;
const tip = land.map(f => f.geometry.coordinates)
  .sort((a, b) => Math.max(...b.map(p => p[0])) - Math.max(...a.map(p => p[0])))[0];
{
  const P = tip[0];
  const box = [P[1]-0.03, P[0]-0.03, P[1]+0.03, P[0]+0.03].map(v => v.toFixed(4));
  const cd = await overpass(`[out:json][timeout:120];
way["natural"="coastline"](${box[0]},${box[1]},${box[2]},${box[3]});
out geom;`);
  /* 방위 60°(2시 방향)로 쏜 반직선이 해안선과 처음 만나는 곳까지 잇는다.
     최단 수선(79°)보다 이쪽이 실제 군사분계선이 바다로 나가는 각에 가깝다.
     그 방향에서 못 만나면 최단 수선으로 물러선다. */
  const BRG = 60;
  const rad = BRG * Math.PI / 180;
  const step = 3 / 111;                                   // 3km 짜리 반직선이면 충분하다
  const Q = [P[0] + step * Math.sin(rad) / Math.cos(P[1]*Math.PI/180), P[1] + step * Math.cos(rad)];
  let best = null, ray = null;
  for (const w of cd.elements || []) {
    const g = (w.geometry || []).map(q => [q.lon, q.lat]);
    for (let i = 1; i < g.length; i++) {
      const a = g[i-1], b = g[i];
      // (1) 반직선과의 교차
      const d1x = Q[0]-P[0], d1y = Q[1]-P[1], d2x = b[0]-a[0], d2y = b[1]-a[1];
      const den = d1x*d2y - d1y*d2x;
      if (den) {
        const t = ((a[0]-P[0])*d2y - (a[1]-P[1])*d2x) / den;
        const u = ((a[0]-P[0])*d1y - (a[1]-P[1])*d1x) / den;
        if (t > 0 && t <= 1 && u >= 0 && u <= 1) {
          const pt = [P[0] + d1x*t, P[1] + d1y*t];
          const d = KM(P[0]-pt[0], P[1]-pt[1], P[1]);
          if (!ray || d < ray.d) ray = { d, pt };
        }
      }
      // (2) 최단 수선 (물러설 곳)
      const L = d2x*d2x + d2y*d2y;
      let s = L ? ((P[0]-a[0])*d2x + (P[1]-a[1])*d2y) / L : 0;
      s = Math.max(0, Math.min(1, s));
      const pp = [a[0] + d2x*s, a[1] + d2y*s];
      const dd = KM(P[0]-pp[0], P[1]-pp[1], P[1]);
      if (!best || dd < best.d) best = { d: dd, pt: pp };
    }
  }
  if (ray) best = ray;
  if (!best) console.warn('  해안선을 못 찾아 동쪽 종점을 그대로 둔다');
  else if (best.d > 2) console.warn(`  해안선이 ${best.d.toFixed(2)}km 떨어져 있어 잇지 않는다`);
  else {
    const brg = (Math.atan2((best.pt[0]-P[0]) * Math.cos(P[1]*Math.PI/180), best.pt[1]-P[1]) * 180/Math.PI + 360) % 360;
    /* 별도 조각(kind: "shore")으로 낸다. 이 227m 는 우리 시도 경계가 아니라 해안선까지
       건너가는 다리라, 육상 구간과 섞으면 '국경선이 색칠과 꼭짓점 단위로 붙는다' 검사에 걸린다. */
    shore = {
      type: 'Feature',
      properties: { kind: 'shore' },
      geometry: { type: 'LineString', coordinates: [[Number(best.pt[0].toFixed(6)), Number(best.pt[1].toFixed(6))], P.slice()] },
    };
    console.log(`  동쪽 종점을 해안선까지 이음 — 방위 ${brg.toFixed(0)}° · ${(best.d*1000).toFixed(0)}m (별도 조각)`);
  }
}

/* 서쪽 끝은 **말도**(강화군 서도면)에서 끊는다.

   OSM 의 KP-KR 경계는 서해 멀리 124.98°E 까지 이어지지만, 정전협정상 중립수역이
   끝나는 곳이 말도다(파주 만우리 ~ 강화 말도, 약 70km). 그 서쪽은 NLL 로, 성격이
   다른 선이라 같은 굵기·같은 색으로 이어 그리면 하나의 확정된 국경처럼 읽힌다.
   2.0 도 이 언저리까지만 그렸다. */
const MALDO = [126.1331, 37.6871];

let ji = 0, jd = Infinity;
west.forEach((p, i) => { const d = KM(p[0]-joint[0], p[1]-joint[1], p[1]); if (d < jd) { jd = d; ji = i; } });
let wi = 0, wd = Infinity;
west.forEach((p, i) => { const d = KM(p[0]-MALDO[0], p[1]-MALDO[1], p[1]); if (d < wd) { wd = d; wi = i; } });
if (wi >= ji) throw new Error('말도가 이음매보다 동쪽이다 — 좌표를 확인하세요');
const estuary = west.slice(wi, ji + 1);
if (estuary.length < 2) throw new Error('하구 구간이 비었다');
console.log(`  서쪽 끝: 말도에서 ${wd.toFixed(1)}km (${west[wi][0].toFixed(4)}, ${west[wi][1].toFixed(4)}) · 그 서쪽 ${wi}점 버림`);
console.log(`  하구 구간 ${estuary.length}점 (경도 ${estuary[0][0].toFixed(3)} ~ ${estuary.at(-1)[0].toFixed(3)})`);

land.forEach(f => { f.properties = { ...(f.properties || {}), kind: 'land' }; });
border.features = land.concat(shore ? [shore] : []).concat([{
  type: 'Feature',
  properties: { kind: 'estuary' },
  geometry: { type: 'LineString', coordinates: estuary },
}]);

fs.writeFileSync(R + 'korea-border.json', JSON.stringify(border));
console.log(`\nkorea-border.json 갱신: 육상 ${land.length}조각 + 하구 1조각 · ${(fs.statSync(R + 'korea-border.json').size/1024).toFixed(0)} KB`);
console.log('node --test test/data.test.js 로 검증할 것');
