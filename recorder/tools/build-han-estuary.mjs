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
const KM = (dx, dy, lat) => Math.hypot(dx * 111 * Math.cos(lat * Math.PI / 180), dy * 111);
const KEY = (p) => p[0].toFixed(7) + ',' + p[1].toFixed(7);

// 사내 인증서 때문에 node fetch 가 막힌다 — build-nk-admin1.mjs 와 같은 이유로 curl 로 넘어간다
async function overpass(query) {
  try {
    const r = await fetch(OVERPASS, { method: 'POST', body: query });
    if (!r.ok) throw new Error(`Overpass ${r.status}`);
    return await r.json();
  } catch (e) {
    if (!/certificate|fetch failed/i.test(String(e.message || e))) throw e;
    console.log('  (node fetch 가 인증서에 막혀 curl 로 받는다)');
    const { execFileSync } = await import('node:child_process');
    return JSON.parse(execFileSync('curl', ['-s', '-m', '300', '-X', 'POST', '--data-binary', '@-', OVERPASS],
      { input: query, maxBuffer: 64 * 1024 * 1024, encoding: 'utf8' }));
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

// OSM 쪽에서 이음매보다 서쪽만 남긴다
let ji = 0, jd = Infinity;
west.forEach((p, i) => { const d = KM(p[0]-joint[0], p[1]-joint[1], p[1]); if (d < jd) { jd = d; ji = i; } });
const estuary = west.slice(0, ji + 1);
if (estuary.length < 2) throw new Error('하구 구간이 비었다');
console.log(`  하구 구간 ${estuary.length}점 (경도 ${estuary[0][0].toFixed(3)} ~ ${estuary.at(-1)[0].toFixed(3)})`);

land.forEach(f => { f.properties = { ...(f.properties || {}), kind: 'land' }; });
border.features = land.concat([{
  type: 'Feature',
  properties: { kind: 'estuary' },
  geometry: { type: 'LineString', coordinates: estuary },
}]);

fs.writeFileSync(R + 'korea-border.json', JSON.stringify(border));
console.log(`\nkorea-border.json 갱신: 육상 ${land.length}조각 + 하구 1조각 · ${(fs.statSync(R + 'korea-border.json').size/1024).toFixed(0)} KB`);
console.log('node --test test/data.test.js 로 검증할 것');
