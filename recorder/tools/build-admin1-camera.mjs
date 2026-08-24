/* admin1.json 의 카메라 목표점(c·z) 중 **잘못된 것만** 다시 계산한다.

   지역을 고르면 `map.flyTo({ center: c, zoom: z })` 로 그 지역을 비춘다. 이 c·z 는
   파일에 미리 들어 있는 값인데, 두 경우에 엉뚱한 곳을 가리킨다.

   1) 날짜변경선(경도 ±180°)을 넘는 지역
      알래스카는 서경 -179.1° 에서 동경 179.8° 까지 걸쳐 있다. 경도 최소·최대를 그냥
      평균 내면 (-179.1 + 179.8) / 2 ≈ 0.3° — 알래스카가 아니라 **아프리카 앞바다**다.
      실제로 알래스카를 고르면 카메라가 거기로 날아갔다.
      해당: 알래스카 · 축치 자치구 · 피지 동부구 · 피지 북부구 · 키리바시 · 남극

   2) 본토에서 멀리 떨어진 섬을 가진 지역
      칠레 발파라이소주에는 이스터섬(서경 109°)이 딸려 있다. 전체를 감싸는 상자의
      중심은 본토에서 1,800km 떨어진 태평양 한가운데가 된다.
      같은 이유로 일본 도쿄도(오가사와라 제도), 남아프리카 웨스턴케이프(프린스에드워드
      제도), 브라질 이스피리투산투(트린다지섬) 등이 바다를 비추고 있었다.

   고치는 방법
      · 경도를 **연속 좌표계로 펴서** 계산한다. 값들을 정렬해 가장 큰 빈틈을 찾고,
        그 빈틈이 ±180° 를 지나는 것보다 크면 날짜변경선을 넘는 것으로 보고
        작은 쪽 경도에 +360 을 더해 이어 붙인다.
      · **가장 큰 폴리곤이 전체 면적의 절반을 넘으면 그것만** 보고 목표를 정한다.
        본토가 뚜렷하면 본토를 비추고, 세이셸 아우터 아일랜즈처럼 고만고만한 섬이
        흩어져 있으면 전체를 담는다 (그 경우는 전체를 보여주는 편이 맞다).

   **50km 넘게 달라지는 항목만 고쳐 쓴다.** 나머지 4,500여 개는 지금 값으로도 맞고,
   전부 다시 계산하면 손댈 이유가 없는 지역의 화면 구도까지 바뀐다.

   실행: node recorder/tools/build-admin1-camera.mjs
*/
import fs from 'node:fs';

const R = 'recorder/js/data/';
/* 옛 값이 목표 영역 상자 밖을 가리킬 때만 고친다. "얼마나 움직이나"로 재면 안 된다 —
   남극처럼 옛 값도 이미 대륙 위에 있는데 중심만 옮겨가는 경우까지 건드리게 되고,
   실제로 그렇게 했다가 남극 줌이 6 에서 0.4(전 지구)로 튀었다. */
const DOMINANT = 0.5;                                     // 가장 큰 폴리곤이 이 비율을 넘으면 그것만 본다

const polysOf = (g) => (g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []);

const ringArea = (r) => {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += r[j][0]*r[i][1] - r[i][0]*r[j][1];
  return Math.abs(a / 2);
};

/* 경도를 연속 좌표계로 편다. 정렬해서 가장 큰 빈틈을 찾고, 그 빈틈이 ±180° 를 지나는
   구간보다 크면 날짜변경선을 넘는 것이다 — 빈틈 반대편(작은 쪽)에 +360 을 더해 잇는다. */
function unwrapLons(lons) {
  const s = lons.slice().sort((a, b) => a - b);
  let gap = -1, at = 0;
  for (let i = 1; i < s.length; i++) {
    const g = s[i] - s[i-1];
    if (g > gap) { gap = g; at = i; }
  }
  if (360 - (s.at(-1) - s[0]) >= gap) return lons.slice();   // 안 넘는다
  const cut = s[at];
  return lons.map((v) => (v < cut ? v + 360 : v));
}

function cameraFor(geometry) {
  const outers = polysOf(geometry).map((p) => p[0]).filter((r) => r && r.length >= 4);
  if (!outers.length) return null;
  const areas = outers.map(ringArea);
  const total = areas.reduce((a, b) => a + b, 0);
  const biggest = areas.indexOf(Math.max(...areas));
  const use = total && areas[biggest] / total >= DOMINANT ? [outers[biggest]] : outers;

  const pts = use.flat();
  const lons = unwrapLons(pts.map((p) => p[0]));
  let lo = Infinity, hi = -Infinity, a0 = Infinity, a1 = -Infinity;
  for (const v of lons) { if (v < lo) lo = v; if (v > hi) hi = v; }
  for (const p of pts) { if (p[1] < a0) a0 = p[1]; if (p[1] > a1) a1 = p[1]; }

  let cx = (lo + hi) / 2;
  while (cx > 180) cx -= 360;                             // 다시 -180~180 으로
  while (cx < -180) cx += 360;
  /* z 는 이 파일의 기존 값들에서 역산한 관계를 따른다 — 가로세로 중 긴 변 기준.
     너무 당겨서 지역이 화면 밖으로 나가지 않게 6 을 상한으로 둔다 (원본도 그렇게 되어 있다). */
  const span = Math.max(hi - lo, a1 - a0) || 0.01;
  const z = Math.min(Math.round((Math.log2(360 / span) + 0.35) * 10) / 10, 12.5);
  return { c: [Number(cx.toFixed(5)), Number(((a0 + a1) / 2).toFixed(5))], z,
    box: { lo, hi, a0, a1 }, dominant: total ? areas[biggest] / total : 0 };
}

/* 경도는 연속 좌표계(+360 이 더해졌을 수 있음)라 두 표기 모두로 견줘 본다. */
function inBox(c, b) {
  if (c[1] < b.a0 || c[1] > b.a1) return false;
  for (const lon of [c[0], c[0] + 360, c[0] - 360]) if (lon >= b.lo && lon <= b.hi) return true;
  return false;
}

const KM = (a, b) => {
  let d = a[0] - b[0];
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  return Math.hypot(d * 111 * Math.cos(b[1] * Math.PI / 180), (a[1] - b[1]) * 111);
};

const admin1 = JSON.parse(fs.readFileSync(R + 'admin1.json'));
console.log(`admin1.json: ${admin1.features.length}개\n`);

const fixed = [];
for (const f of admin1.features) {
  const p = f.properties;
  if (!p || !p.c) continue;
  const t = cameraFor(f.geometry);
  if (!t) continue;
  if (inBox(p.c, t.box)) continue;                        // 옛 값이 이미 제 영역 안이다
  const moved = KM(t.c, p.c);
  fixed.push({ name: p.name, from: p.c, to: t.c, moved, z: [p.z, t.z], dom: t.dominant });
  p.c = t.c;
  p.z = t.z;
}

fixed.sort((a, b) => b.moved - a.moved);
console.log(`카메라 목표를 고친 항목: ${fixed.length}개`);
for (const x of fixed.slice(0, 12)) {
  console.log(`  ${x.name.padEnd(24)} ${JSON.stringify(x.from)} → ${JSON.stringify(x.to)}` +
    `  (${Math.round(x.moved).toLocaleString()}km, z ${x.z[0]}→${x.z[1]}, 최대폴리곤 ${(x.dom*100).toFixed(0)}%)`);
}
if (fixed.length > 12) console.log(`  … 그 외 ${fixed.length - 12}개`);

fs.writeFileSync(R + 'admin1.json', JSON.stringify(admin1));
console.log(`\nadmin1.json 갱신: ${(fs.statSync(R + 'admin1.json').size / 1048576).toFixed(1)} MB`);
console.log('node --test test/data.test.js 로 검증할 것');
