/* Mapbox 국가 경계 데이터가 잘못 배정한 섬을 모아 보정용 폴리곤을 만든다.

   Mapbox 의 country-boundaries-v1 은 연평도 북쪽의 북한 섬 네 개를 KOR 로 분류한다.
   그래서 국가 단위로 '대한민국'을 칠하면 북한 섬이 함께 칠해졌다. 한국 방송에서는
   그대로 나가면 사고가 되는 종류의 오류다.

   Tilequery 로 황해남도 해역의 섬 62개를 전부 조회해 확인한 결과 이 넷만 KOR 이고
   나머지 58개와 강령반도 본토는 PRK 로 맞게 나온다. 즉 넷만 덮으면 된다.

     갈도    125.6530, 37.7156      장재도  125.6492, 37.7364
     무도    125.5769, 37.7419      료도    126.1948, 37.8170

   갈도·장재도·무도는 OSM 에 북한 군부대(무도방위대·장재도방어대)가 함께 태그돼 있다.

   행정구역(admin1) 단위에서는 이미 북한 황해남도로 제대로 칠해진다 — 이 파일은
   국가 단위 색칠만 보정한다.

   출처: OpenStreetMap contributors (ODbL)
   실행: node recorder/tools/build-country-fixes.mjs
*/
import fs from 'node:fs';

const R = 'recorder/js/data/';
const OVERPASS = 'https://overpass-api.de/api/interpreter';
const NAMES = ['갈도', '장재도', '무도', '료도'];

// 사내 인증서 때문에 node fetch 가 막힌다 — build-nk-admin1.mjs 와 같은 이유로 curl 로 넘어간다
async function overpass(query) {
  try {
    const r = await fetch(OVERPASS, { method: 'POST', body: query });
    if (!r.ok) throw new Error(`Overpass ${r.status}`);
    return await r.json();
  } catch (e) {
    if (!/certificate|fetch failed/i.test(String(e.message || e))) throw e;
    const { execFileSync } = await import('node:child_process');
    return JSON.parse(execFileSync('curl', ['-s', '-m', '300', '-X', 'POST', '--data-binary', '@-', OVERPASS],
      { input: query, maxBuffer: 64 * 1024 * 1024, encoding: 'utf8' }));
  }
}

const close = (r) => (r[0][0] === r.at(-1)[0] && r[0][1] === r.at(-1)[1] ? r : r.concat([r[0].slice()]));

/* 덮는 폴리곤을 바깥으로 넓힌다.

   OSM 섬 모양과 Mapbox 섬 모양이 조금씩 달라서, OSM 모양 그대로 덮으면 가장자리에
   Mapbox 색이 얇게 남는다. Tilequery 로 우리 경계 바깥을 30·80·150·250m 지점에서
   찍어보니 Mapbox 가 최대 150m 까지 더 나가 있었다 (무도가 가장 크고, 250m 에서는
   네 섬 모두 바다). 그래서 200m 를 넓혀 확실히 덮는다.

   섬이 실제보다 조금 커 보이지만, 넷 다 지름 1km 아래라 방송 줌에서는 점 하나다.
   가장자리에 다른 나라 색이 남는 것보다 이쪽이 낫다. */
const BUFFER_M = 200;

function grow(ring) {
  const lo = ring.map(p => p[0]), la = ring.map(p => p[1]);
  const cx = (Math.min(...lo) + Math.max(...lo)) / 2;
  const cy = (Math.min(...la) + Math.max(...la)) / 2;
  const mPerLon = 111000 * Math.cos(cy * Math.PI / 180);
  const out = ring.map(([x, y]) => {
    const dx = (x - cx) * mPerLon, dy = (y - cy) * 111000;
    const L = Math.hypot(dx, dy) || 1;
    return [x + (dx / L) * BUFFER_M / mPerLon, y + (dy / L) * BUFFER_M / 111000];
  });
  out[out.length - 1] = out[0].slice();
  return out;
}

const data = await overpass(`[out:json][timeout:180];
(
  way["place"~"^(island|islet)$"]["name"~"^(${NAMES.join('|')})$"](37.60,125.40,37.95,126.35);
  rel["place"~"^(island|islet)$"]["name"~"^(${NAMES.join('|')})$"](37.60,125.40,37.95,126.35);
);
out geom;`);

const features = [];
for (const e of data.elements) {
  const name = (e.tags || {}).name;
  if (!NAMES.includes(name)) continue;
  const rings = (e.type === 'way'
    ? [close(e.geometry.map(g => [g.lon, g.lat]))]
    : (e.members || []).filter(m => m.geometry && m.geometry.length >= 3)
        .map(m => close(m.geometry.map(g => [g.lon, g.lat])))).map(grow);
  if (!rings.length) continue;
  features.push({
    type: 'Feature',
    // 실제로 어느 나라인지 — 레이어가 이 값으로 색을 고른다
    properties: { name, iso: 'PRK' },
    geometry: rings.length === 1 ? { type: 'Polygon', coordinates: [rings[0]] }
                                 : { type: 'MultiPolygon', coordinates: rings.map(r => [r]) },
  });
  console.log(`  ${name.padEnd(4)} ${rings.reduce((s, r) => s + r.length, 0)}점`);
}

const missing = NAMES.filter(n => !features.some(f => f.properties.name === n));
if (missing.length) throw new Error(`OSM 에서 못 찾음: ${missing.join(', ')}`);

fs.writeFileSync(R + 'country-fixes.json', JSON.stringify({ type: 'FeatureCollection', features }));
console.log(`\ncountry-fixes.json: ${features.length}개 · ${(fs.statSync(R + 'country-fixes.json').size / 1024).toFixed(1)} KB`);
