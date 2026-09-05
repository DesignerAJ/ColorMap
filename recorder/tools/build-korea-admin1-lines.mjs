/* 남·북한의 1급 행정구역 경계선을 우리 폴리곤에서 뽑는다.

   행정구역선은 Mapbox 스타일의 `admin-1-boundary`·`admin-boundaries` 에서 온다.
   그런데 색칠은 우리 데이터(시도 1.6만점, 북한 도 4~8천점)라 선이 훨씬 성기고
   모양이 안 맞았다 — 국경선에서 겪은 것과 같은 문제다. 선과 색칠은 같은 출처여야 한다.

   **맞닿은 변만 고른다.** 뽑는 방법은 `lib/shared-edges.mjs` 에 있다 —
   영국 등 다른 나라를 뽑는 `build-admin1-lines.mjs` 도 같은 모듈을 쓴다.

   재료
     대한민국 — sido-hires.json 의 시도 17개
     북한     — admin1.json 의 북한 13개

   좌표는 소수점 5자리(약 1m). 색칠 쪽도 같은 정밀도로 넣어 두었다.

   실행: node recorder/tools/build-korea-admin1-lines.mjs
*/
import fs from 'node:fs';
import { sharedLines } from './lib/shared-edges.mjs';

const R = 'recorder/js/data/';

const hires = JSON.parse(fs.readFileSync(R + 'sido-hires.json'));
const admin1 = JSON.parse(fs.readFileSync(R + 'admin1.json'));
const nk = admin1.features.filter(f => f.properties.country === '북한');
if (hires.features.length !== 17) throw new Error(`시도가 ${hires.features.length}개`);
if (nk.length !== 13) throw new Error(`북한 도가 ${nk.length}개`);

console.log('행정구역 경계선을 뽑는 중…');
const features = [];
for (const [label, src, iso] of [['대한민국', hires.features, 'KR'], ['북한', nk, 'KP']]) {
  const stats = {};
  for (const line of sharedLines(src, stats)) {
    features.push({ type: 'Feature', properties: { iso }, geometry: { type: 'LineString', coordinates: line } });
  }
  console.log(`  ${label.padEnd(6)} 맞닿은 변 ${stats.edges.toLocaleString()} → 선 ${stats.lines}줄 · ${stats.points.toLocaleString()}점`);
}
if (!features.length) throw new Error('맞닿은 변이 하나도 없다 — 이웃 폴리곤이 꼭짓점을 공유하지 않는 것');

fs.writeFileSync(R + 'korea-admin1-lines.json', JSON.stringify({ type: 'FeatureCollection', features }));
console.log(`\nkorea-admin1-lines.json: 선 ${features.length}줄 · ${(fs.statSync(R + 'korea-admin1-lines.json').size / 1048576).toFixed(1)} MB`);
