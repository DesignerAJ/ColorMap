/* 남·북한의 1급 행정구역 경계선을 우리 폴리곤에서 뽑는다.

   행정구역선은 Mapbox 스타일의 `admin-1-boundary`·`admin-boundaries` 에서 온다.
   그런데 색칠은 우리 데이터(시도 1.6만점, 북한 도 4~8천점)라 선이 훨씬 성기고
   모양이 안 맞았다 — 국경선에서 겪은 것과 같은 문제다. 선과 색칠은 같은 출처여야 한다.

   **맞닿은 변만 고른다.** 폴리곤 외곽선을 통째로 그리면 해안선까지 행정구역선으로
   그려져 나라 둘레에 굵은 테두리가 생긴다. 방향을 무시한 같은 변이 두 번 나오면
   두 지역이 맞대고 있는 내부 경계이고, 한 번만 나오면 해안선이나 나라 바깥 가장자리다.
   (`build-korea-border.mjs` 가 국경선을 고를 때 쓰는 것과 같은 방법.)

   재료
     대한민국 — sido-hires.json 의 시도 17개
     북한     — admin1.json 의 북한 13개

   좌표는 소수점 5자리(약 1m). 색칠 쪽도 같은 정밀도로 넣어 두었다.

   실행: node recorder/tools/build-korea-admin1-lines.mjs
*/
import fs from 'node:fs';

const R = 'recorder/js/data/';
const PREC = 5;

const round = (v) => Number(v.toFixed(PREC));
const key = (p) => round(p[0]) + ',' + round(p[1]);
const und = (a, b) => { const x = key(a), y = key(b); return x < y ? x + '|' + y : y + '|' + x; };
const polysOf = (g) => (g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []);

/* 맞닿은 변을 모아 선으로 잇는다. 변 하나하나를 따로 그리면 점선·둥근 끝 같은 선 옵션이
   변마다 끊겨 지저분해지므로, 이어붙여 긴 선으로 만든다. */
function sharedLines(features, label) {
  const seen = new Map();
  for (const f of features) for (const poly of polysOf(f.geometry)) for (const ring of poly)
    for (let i = 1; i < ring.length; i++) {
      const k = und(ring[i-1], ring[i]);
      if (!seen.has(k)) seen.set(k, { n: 0, a: ring[i-1], b: ring[i] });
      seen.get(k).n++;
    }
  const edges = [...seen.values()].filter(e => e.n >= 2);

  // 끝점 → 변 목록으로 이어붙이기
  const at = new Map();
  edges.forEach((e, i) => {
    for (const p of [e.a, e.b]) {
      const k = key(p);
      if (!at.has(k)) at.set(k, []);
      at.get(k).push(i);
    }
  });
  const used = new Array(edges.length).fill(false);
  const lines = [];
  const step = (from, i) => {
    const e = edges[i];
    return key(e.a) === from ? e.b : e.a;
  };
  for (let s = 0; s < edges.length; s++) {
    if (used[s]) continue;
    used[s] = true;
    let line = [edges[s].a, edges[s].b];
    // 양쪽으로 뻗어 나간다
    for (const dir of [1, 0]) {
      for (;;) {
        const tip = dir ? line.at(-1) : line[0];
        const next = (at.get(key(tip)) || []).find(i => !used[i]);
        if (next === undefined) break;
        used[next] = true;
        const other = step(key(tip), next);
        if (dir) line.push(other); else line.unshift(other);
      }
    }
    lines.push(line.map(p => [round(p[0]), round(p[1])]));
  }
  const pts = lines.reduce((s, l) => s + l.length, 0);
  console.log(`  ${label.padEnd(6)} 맞닿은 변 ${edges.length.toLocaleString()} → 선 ${lines.length}줄 · ${pts.toLocaleString()}점`);
  return lines;
}

const hires = JSON.parse(fs.readFileSync(R + 'sido-hires.json'));
const admin1 = JSON.parse(fs.readFileSync(R + 'admin1.json'));
const nk = admin1.features.filter(f => f.properties.country === '북한');
if (hires.features.length !== 17) throw new Error(`시도가 ${hires.features.length}개`);
if (nk.length !== 13) throw new Error(`북한 도가 ${nk.length}개`);

console.log('행정구역 경계선을 뽑는 중…');
const features = [];
for (const [label, src, iso] of [['대한민국', hires.features, 'KR'], ['북한', nk, 'KP']]) {
  for (const line of sharedLines(src, label)) {
    if (line.length < 2) continue;
    features.push({ type: 'Feature', properties: { iso }, geometry: { type: 'LineString', coordinates: line } });
  }
}
if (!features.length) throw new Error('맞닿은 변이 하나도 없다 — 이웃 폴리곤이 꼭짓점을 공유하지 않는 것');

fs.writeFileSync(R + 'korea-admin1-lines.json', JSON.stringify({ type: 'FeatureCollection', features }));
console.log(`\nkorea-admin1-lines.json: 선 ${features.length}줄 · ${(fs.statSync(R + 'korea-admin1-lines.json').size / 1048576).toFixed(1)} MB`);
