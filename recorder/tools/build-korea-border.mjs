/* 우리 시도 데이터에서 북쪽 육상 국경선(군사분계선 구간)만 뽑아 선으로 만든다.
   해안선은 빼야 하므로, Mapbox 국경선 근처(5km 이내)에 있는 변만 고른다 —
   두 데이터가 최대 3km 어긋나므로 5km 면 넉넉히 다 잡히고 해안선은 안 걸린다. */
import fs from 'node:fs';
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader as Pbf } from 'pbf';

/* Mapbox 토큰이 필요하다: MAPBOX_TOKEN=... node recorder/tools/build-korea-border.mjs
   벡터 타일에서 KP-KR 국경선을 받아, 그 근처(5km)에 있는 우리 시도 경계 변만 골라 잇는다.
   의존성: npm i @mapbox/vector-tile pbf */
const TOKEN = process.env.MAPBOX_TOKEN;
if (!TOKEN) { console.error('MAPBOX_TOKEN 환경변수가 필요합니다.'); process.exit(1); }
const R = 'recorder/js/data/';

const lon2x = (lon, z) => Math.floor((lon + 180) / 360 * 2 ** z);
const lat2y = (lat, z) => Math.floor((1 - Math.log(Math.tan(lat*Math.PI/180) + 1/Math.cos(lat*Math.PI/180)) / Math.PI) / 2 * 2 ** z);

async function mapboxBorder(z = 11) {
  const out = [];
  for (let x = lon2x(126.4, z); x <= lon2x(128.7, z); x++)
    for (let y = lat2y(38.9, z); y <= lat2y(37.6, z); y++) {
      const r = await fetch(`https://api.mapbox.com/v4/mapbox.mapbox-streets-v8/${z}/${x}/${y}.mvt?access_token=${TOKEN}`);
      if (!r.ok) continue;
      const buf = Buffer.from(await r.arrayBuffer()); if (!buf.length) continue;
      let t; try { t = new VectorTile(new Pbf(buf)); } catch (_) { continue; }
      const L = t.layers.admin; if (!L) continue;
      for (let i = 0; i < L.length; i++) {
        const f = L.feature(i), p = f.properties;
        if (p.admin_level !== 0) continue;
        if (!/US|all/.test(String(p.worldview || ''))) continue;
        const g = f.toGeoJSON(x, y, z);
        const ls = g.geometry.type === 'LineString' ? [g.geometry.coordinates] : g.geometry.coordinates;
        for (const ln of ls) out.push(ln);
      }
    }
  return out;
}

const KM = (dx, dy, lat) => Math.hypot(dx * 111 * Math.cos(lat*Math.PI/180), dy * 111);
function nearLine(pt, segs) {
  for (const [a, b] of segs) {
    const dx = b[0]-a[0], dy = b[1]-a[1], L2 = dx*dx + dy*dy;
    let t = L2 ? ((pt[0]-a[0])*dx + (pt[1]-a[1])*dy) / L2 : 0;
    t = Math.max(0, Math.min(1, t));
    if (KM(pt[0] - (a[0]+dx*t), pt[1] - (a[1]+dy*t), pt[1]) < 5) return true;
  }
  return false;
}

(async () => {
  const lines = await mapboxBorder();
  const mbSegs = [];
  for (const ln of lines) for (let i = 1; i < ln.length; i++)
    if (ln[i][1] > 37.6 && ln[i][1] < 38.9) mbSegs.push([ln[i-1], ln[i]]);
  console.log(`Mapbox 국경선 참조 선분 ${mbSegs.length}개`);

  const H = JSON.parse(fs.readFileSync(R + 'sido-hires.json', 'utf8'));
  const ringsOf = (g) => g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
  const key = (p) => p[0].toFixed(6) + ',' + p[1].toFixed(6);

  /* 경기·강원의 링 변을 모은다. 방향을 무시한 같은 변이 두 번 나오면 두 도가 맞대고 있는
     내부 경계다 (연천–철원 사이 도 경계가 대표적). 국경선은 나라 바깥쪽 가장자리라 한 번만
     나온다. 이걸로 걸러내지 않으면, DMZ 와 5km 안쪽에서 만나는 도 경계 구간이 국경선
     굵기·색으로 그려진다 — 실제로 연천–철원 접점에서 160개 변이 그렇게 새어 들어갔었다. */
  const und = (a, b) => { const ka = key(a), kb = key(b); return ka < kb ? ka + '|' + kb : kb + '|' + ka; };
  const seen = new Map();
  const all = [];
  for (const nm of ['경기도', '강원특별자치도']) {
    const f = H.features.find(x => x.properties.name === nm);
    for (const poly of ringsOf(f.geometry)) for (const ring of poly)
      for (let i = 1; i < ring.length; i++) {
        const a = ring[i-1], b = ring[i];
        if (a[1] < 37.6 || b[1] < 37.6) continue;
        const k = und(a, b);
        seen.set(k, (seen.get(k) || 0) + 1);
        all.push([a, b, k]);
      }
  }
  const edges = [];
  let dropped = 0;
  for (const [a, b, k] of all) {
    if (seen.get(k) >= 2) { dropped++; continue; }          // 도끼리 공유하는 내부 경계
    const mid = [(a[0]+b[0])/2, (a[1]+b[1])/2];
    if (nearLine(mid, mbSegs)) edges.push([a, b]);
  }
  console.log(`도 경계(공유 변) 제외 ${dropped}개 · 국경선 근처로 골라낸 변 ${edges.length}개`);

  // 변을 이어 연속된 선으로 (끝점이 맞는 것끼리)
  const byStart = new Map();
  for (const [a, b] of edges) {
    const k = key(a);
    if (!byStart.has(k)) byStart.set(k, []);
    byStart.get(k).push(b);
  }
  const used = new Set();
  const chains = [];
  for (const [a, b] of edges) {
    const ek = key(a) + '>' + key(b);
    if (used.has(ek)) continue;
    const chain = [a]; let cur = b; used.add(ek);
    chain.push(b);
    while (true) {
      const nx = byStart.get(key(cur));
      if (!nx) break;
      let moved = false;
      for (const n of nx) {
        const k2 = key(cur) + '>' + key(n);
        if (used.has(k2)) continue;
        used.add(k2); chain.push(n); cur = n; moved = true; break;
      }
      if (!moved) break;
    }
    if (chain.length > 2) chains.push(chain);
  }
  chains.sort((a, b) => b.length - a.length);
  const kept = chains.filter(c => c.length >= 20);       // 짧은 부스러기 제거
  const pts = kept.reduce((s, c) => s + c.length, 0);
  console.log(`선 ${chains.length}개 중 ${kept.length}개 유지 / ${pts}점`);
  kept.slice(0, 6).forEach((c, i) => {
    const x = c.map(p => p[0]), y = c.map(p => p[1]);
    console.log(`  ${i+1}: ${String(c.length).padStart(5)}점  경도 ${Math.min(...x).toFixed(2)}~${Math.max(...x).toFixed(2)}  위도 ${Math.min(...y).toFixed(2)}~${Math.max(...y).toFixed(2)}`);
  });

  fs.writeFileSync('recorder/js/data/korea-border.json', JSON.stringify({
    _note: '북쪽 육상 국경선(군사분계선 구간). 화면의 국경선을 우리 시도 데이터에서 뽑아 그리기 위한 선이다. '
         + 'Mapbox 의 KP-KR 국경선(admin 레이어)은 우리 행정경계와 최대 3.1km 어긋나서, 색칠이 선을 넘거나 못 미치는 것처럼 보였다. '
         + '같은 데이터에서 뽑은 선을 쓰면 색칠과 꼭짓점 단위로 정확히 붙는다.',
    _howto: 'sido-hires 의 경기도·강원특별자치도 링에서 (1) 두 도가 공유하는 내부 변(연천–철원 도 경계 등)을 빼고 '
          + '(2) Mapbox 국경선 5km 이내인 변만 골라 이어붙였다. 해안선은 그 범위 밖이라 안 걸린다. '
          + '재생성: MAPBOX_TOKEN=... node recorder/tools/build-korea-border.mjs',
    type: 'FeatureCollection',
    features: kept.map(c => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: c } })),
  }));
  console.log('\n저장: korea-border.json');
})();
