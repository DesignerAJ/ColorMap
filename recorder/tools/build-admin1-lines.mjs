/* 나라의 행정구역 경계선을 **우리 폴리곤에서** 뽑는다.

   화면의 행정구역선은 Mapbox 스타일의 `admin-1-boundary` 에서 온다. 그런데 Mapbox 의
   1급 행정구역 정의가 우리 데이터와 다른 나라가 있다. 영국이 그렇다 —
   Mapbox 는 잉글랜드·스코틀랜드·웨일스·북아일랜드 **넷**으로만 나누는데,
   우리 `admin1/GBR.json` 에는 카운티·단일자치체·런던 자치구까지 **232개**가 들어 있다.
   그래서 영국을 색칠하면 구역은 232개로 칠해지는데 선은 4개만 그어져 있었다.

   남·북한에서 쓴 방법을 그대로 쓴다(`build-korea-admin1-lines.mjs`). 선과 색칠이
   같은 출처라 어느 줌에서도 정확히 붙는다. 뽑는 방법은 `lib/shared-edges.mjs` 에 있다 —
   **맞닿은 변만** 고른다. 폴리곤 외곽선을 통째로 그리면 해안선까지 행정구역선이 되어
   나라 둘레에 굵은 테두리가 생긴다.

   **이웃 폴리곤이 꼭짓점을 공유해야 한다.** 공유하지 않으면 맞닿은 변이 하나도 안 나온다
   (출처에 따라 다르다). 실측으로 영국(Natural Earth)은 변의 64%가 공유된다.
   결과가 너무 적으면 그 나라는 이 방법을 못 쓰는 것이므로 아래에서 막는다.

   입력  recorder/js/data/admin1/<ISO3>.json   (build-admin1-split.mjs 의 출력)
   출력  recorder/js/data/admin1-lines/<ISO3>.json

   properties.iso 는 **ISO2** 다 — Mapbox admin 소스의 `iso_3166_1` 과 맞춰야
   화면에서 그 나라의 스타일 행정구역선만 골라 뺄 수 있다.
   ISO3 앞 두 글자를 그대로 쓰면 안 된다(CLAUDE.md 참고). 아래 표에 적어 둔다.

   실행: node recorder/tools/build-admin1-lines.mjs [ISO3 ...]     (기본 GBR)
*/
import fs from 'node:fs';
import path from 'node:path';
import { sharedLines } from './lib/shared-edges.mjs';

const R = 'recorder/js/data/';
const OUT_DIR = R + 'admin1-lines/';

/* ISO3 → ISO2. 화면에서 Mapbox 선을 뺄 때 쓰는 값이라 반드시 맞아야 한다.
   나라를 늘릴 때 여기에 같이 적는다 — 없으면 도구가 멈춘다. */
const ISO2 = { GBR: 'GB' };

// 맞닿은 변이 이만큼도 안 나오면 이웃끼리 꼭짓점을 공유하지 않는 데이터다
const MIN_SHARE = 0.2;

const codes = process.argv.slice(2).filter(a => !a.startsWith('-'));
const targets = codes.length ? codes.map(c => c.toUpperCase()) : ['GBR'];

fs.mkdirSync(OUT_DIR, { recursive: true });

const polysOf = (g) => (g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []);
const countEdges = (features) => features.reduce((s, f) =>
  s + polysOf(f.geometry).reduce((t, poly) =>
    t + poly.reduce((u, ring) => u + Math.max(0, ring.length - 1), 0), 0), 0);

for (const iso3 of targets) {
  const iso2 = ISO2[iso3];
  if (!iso2) throw new Error(`${iso3} 의 ISO2 를 모른다 — 이 파일의 ISO2 표에 적을 것 ` +
    `(ISO3 앞 두 글자를 그대로 쓰면 안 된다: AUT→AU 는 호주, CHL→CH 는 스위스다)`);

  const src = R + `admin1/${iso3}.json`;
  if (!fs.existsSync(src)) throw new Error(`${src} 가 없다 — 코어 8개국은 admin1-core.json 에 있어 이 도구로는 못 읽는다`);
  const geo = JSON.parse(fs.readFileSync(src, 'utf8'));
  const features = geo.features || [];
  if (features.length < 2) throw new Error(`${iso3} 구역이 ${features.length}개 — 뽑을 내부 경계가 없다`);

  console.log(`${iso3}: 구역 ${features.length}개에서 행정구역 경계선을 뽑는 중…`);
  const total = countEdges(features);
  const stats = {};
  const lines = sharedLines(features, stats);
  const shareRate = total ? (stats.edges * 2) / total : 0;
  console.log(`  변 ${total.toLocaleString()} 중 맞닿은 변 ${stats.edges.toLocaleString()} (${(shareRate * 100).toFixed(1)}%)` +
              ` → 선 ${stats.lines}줄 · ${stats.points.toLocaleString()}점`);
  if (shareRate < MIN_SHARE) {
    throw new Error(`${iso3} 는 이웃끼리 꼭짓점을 공유하지 않는다(공유율 ${(shareRate * 100).toFixed(1)}%) — ` +
      `이 방법으로는 행정구역선을 뽑을 수 없다. 스타일이 주는 선을 그대로 쓸 것`);
  }

  const out = {
    type: 'FeatureCollection',
    features: lines.map(line => ({
      type: 'Feature',
      properties: { iso: iso2 },
      geometry: { type: 'LineString', coordinates: line },
    })),
  };
  const dest = OUT_DIR + `${iso3}.json`;
  fs.writeFileSync(dest, JSON.stringify(out));
  const mb = fs.statSync(dest).size / 1048576;
  console.log(`  → ${path.relative('.', dest)}  ${mb.toFixed(2)} MB\n`);
}
