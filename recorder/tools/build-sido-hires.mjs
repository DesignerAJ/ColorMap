/* 시군구 경계를 시도 단위로 합쳐(dissolve) 고해상도 시도 경계를 만든다.

   왜 필요한가:
     regions.js 의 SIDO_GEO 는 시도 17개를 통틀어 19,286점뿐이고, 편차가 심하다.
       서울 67점 · 광주 48점 · 대전 60점 · 세종 53점  ↔  전남 8,871점
     광역시를 확대하면 다각형이 그대로 드러난다. 반면 시군구는 252개 609,626점이라
     같은 지역을 훨씬 촘촘하게 그린다. 시군구를 시도로 합치면 그 정밀도를 그대로 얻는다.

   왜 mapshaper 를 안 쓰는가:
     npm 레지스트리가 사내 인증서에 막혀 설치가 안 된다. 다행히 이 작업은 위상만
     맞으면 외부 라이브러리 없이 된다 — 아래 방식이 mapshaper 의 -dissolve2 와 같다.

   원리:
     인접한 두 시군구는 같은 변을 정반대 방향으로 한 번씩 지난다. 방향까지 포함해
     변을 모으면 내부 경계는 (a→b) 와 (b→a) 가 짝을 이루므로 지우고, 남은 변만
     이어붙이면 시도 외곽선이 된다. 실측으로 확인했다 — 공유 변 112,596개가
     정확히 두 번씩만 쓰여 위상이 깨끗하다.

   핀치(자기교차) 처리:
     변을 이을 때 한 점에서 셋 이상이 뻗어나가는 분기점을 만나면 다음 변을 임의로
     고르게 되는데, 그러면 링이 그 점을 두 번 지나며 자기 자신과 만난다. 그대로 두면
     mapbox-gl 의 삼각분할이 그 지점을 가로질러 이어버려 화면에 얇고 긴 삼각형이
     뻗어나온다 — 줌에 따라 나타났다 사라지는 '중첩된 삼각형'의 정체다.
     splitAtPinches 로 그 점에서 링을 나눠 없앤다 (41곳 → 0곳, 면적은 그대로).

   사용법: node recorder/tools/build-sido-hires.mjs
*/

import fs from 'node:fs';
import path from 'node:path';

const SRC = 'recorder/js/data/sigungu.json';
const OUT = 'recorder/js/data/sido-hires.json';

/* 시군구 경계만으로는 메울 수 없는 구역을 마지막에 얹는다.
   지금은 새만금 하나다 — 방조제 안쪽은 어느 시군구에도 배정돼 있지 않아
   (국토부 VWorld 시군구 레이어에서도 그 지점은 NOT_FOUND) 아무리 잘 합쳐도
   전북 한복판이 빈 채로 남는다. 시군구 관할은 미확정이지만 시도로는 전북이 분명하다.
   파일 안의 _source·_howto 에 출처와 만든 방법을 적어 두었다. */
const PATCHES = ['recorder/js/data/saemangeum.json'];

const key = (p) => `${p[0]},${p[1]}`;                    // 좌표는 이미 소수 4자리로 고정돼 있다
const ringsOf = (g) =>
  g.type === 'Polygon' ? [g.coordinates]
  : g.type === 'MultiPolygon' ? g.coordinates
  : [];

/* 부호 있는 넓이 — 양수면 반시계(CCW). 링의 방향과 크기 판정에 함께 쓴다. */
function signedArea(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  }
  return a / 2;
}

function bboxOf(ring) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of ring) {
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return [x0, y0, x1, y1];
}

const bboxInside = (a, b) => a[0] >= b[0] && a[1] >= b[1] && a[2] <= b[2] && a[3] <= b[3];

/* 링이 다른 링 안에 들어 있는지. 한 점만 보고 정하면 안 된다 —
   핀치를 잘라 만든 링은 첫 점이 바깥 링과 맞닿은 공유 꼭짓점이라
   그 점 하나로는 안팎 판정이 흔들린다. 여러 점을 고르게 뽑아 다수결로 정한다. */
function ringInside(ring, outer) {
  const n = ring.length - 1;
  let inside = 0, tested = 0;
  for (let s = 1; s <= 7; s++) {
    const p = ring[Math.floor((n * s) / 8)];
    if (!p) continue;
    tested++;
    if (pointInRing(p, outer)) inside++;
  }
  return tested > 0 && inside * 2 > tested;
}

function pointInRing(pt, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > pt[1]) !== (yj > pt[1]) &&
        pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/* 한 링이 같은 점을 두 번 지나면 그 지점에서 자기 자신과 만난다(핀치).
   분기점(한 점에서 변이 셋 이상 뻗는 곳)에서 다음 변을 아무거나 집어 들면 이런 링이 생긴다.
   그대로 두면 mapbox-gl 의 삼각분할이 그 지점을 가로질러 이어버려, 화면에 얇고 긴
   삼각형이 뻗어나온다 — 줌에 따라 나타났다 사라지는 '중첩된 삼각형'의 정체다.

   위상적으로 이런 링은 '한 점에서 붙어 있는 두 개의 링'이다. 그 점에서 잘라 나누면
   양쪽 다 온전한 링이 되고 면적도 그대로 보존된다. 스택을 쌓고 가다 이미 지나온 점을
   다시 만나면 그 사이 구간을 닫힌 링으로 떼어낸다. */
function splitAtPinches(ring) {
  const out = [], stack = [], pos = new Map();
  for (const k of ring) {
    if (pos.has(k)) {
      const at = pos.get(k);
      const loop = stack.slice(at).concat([k]);
      if (loop.length > 3) out.push(loop);
      for (let t = at + 1; t < stack.length; t++) pos.delete(stack[t]);
      stack.length = at + 1;
    } else {
      pos.set(k, stack.length);
      stack.push(k);
    }
  }
  return out;
}

/* 남은 방향 변들을 이어 닫힌 링으로 만든다.
   한 점에서 여러 변이 뻗어나가는 경우(육지가 한 점에서만 맞닿는 곳)가 있어
   시작점별로 나가는 변을 목록으로 들고 하나씩 꺼내 쓴다. */
function assembleRings(edges) {
  const out = new Map();                                  // 시작점 → [끝점, …]
  for (const [a, b] of edges) {
    if (!out.has(a)) out.set(a, []);
    out.get(a).push(b);
  }
  const rings = [];
  for (const [start] of edges) {
    while (out.get(start)?.length) {
      const ring = [start];
      let cur = start;
      while (true) {
        const nexts = out.get(cur);
        if (!nexts || !nexts.length) break;                // 끊긴 사슬 — 아래에서 버린다
        const nxt = nexts.pop();
        ring.push(nxt);
        cur = nxt;
        if (cur === start) break;
      }
      if (ring.length > 3 && ring[0] === ring[ring.length - 1]) rings.push(...splitAtPinches(ring));
    }
  }
  return rings;
}

// ── 실행 ──
const src = JSON.parse(fs.readFileSync(SRC, 'utf8'));
const groups = new Map();
for (const f of src.features || []) {
  const sd = f.properties?.sido;
  if (!sd || !f.geometry) continue;
  if (!groups.has(sd)) groups.set(sd, []);
  groups.get(sd).push(f);
}

const features = [];
let totalPts = 0;

for (const [sido, feats] of groups) {
  // 1) 모든 링의 방향 변을 모은다
  const dir = new Map();                                  // "a|b" → 개수
  const coord = new Map();                                // "x,y" → [x, y] (되돌릴 때 씀)
  for (const f of feats) {
    for (const poly of ringsOf(f.geometry)) {
      for (const ring of poly) {
        for (let i = 0; i < ring.length - 1; i++) {
          const a = key(ring[i]), b = key(ring[i + 1]);
          if (a === b) continue;
          coord.set(a, ring[i]); coord.set(b, ring[i + 1]);
          const k = `${a}|${b}`;
          dir.set(k, (dir.get(k) || 0) + 1);
        }
      }
    }
  }

  // 2) 반대 방향 짝이 있으면 둘 다 지운다 = 내부 경계 제거
  const kept = [];
  for (const [k, n] of dir) {
    const [a, b] = k.split('|');
    const back = dir.get(`${b}|${a}`) || 0;
    const remain = n - back;                              // 짝지어 상쇄하고 남은 만큼만 유지
    for (let i = 0; i < remain; i++) kept.push([a, b]);
  }

  // 3) 남은 변을 링으로 잇는다
  const rings = assembleRings(kept).map((r) => r.map((k) => coord.get(k)));
  if (!rings.length) { console.error(`${sido}: 링 조립 실패 — 건너뜀`); continue; }

  // 4) 바깥 링 / 구멍 구분 — 다른 링 안에 들어 있으면 구멍이다
  //    (광주가 전남 안에, 대구가 경북 안에 있는 식으로 실제로 구멍이 생긴다)
  const info = rings.map((r) => ({ ring: r, bbox: bboxOf(r), area: Math.abs(signedArea(r)) }));
  info.sort((a, b) => b.area - a.area);                    // 큰 것부터 — 포함 판정을 빨리 끝낸다
  const holesOf = new Map();
  const outers = [];
  for (let i = 0; i < info.length; i++) {
    let parent = -1;
    for (let j = 0; j < outers.length; j++) {
      const o = info[outers[j]];
      if (bboxInside(info[i].bbox, o.bbox) && ringInside(info[i].ring, o.ring)) { parent = outers[j]; break; }
    }
    if (parent === -1) { outers.push(i); holesOf.set(i, []); }
    else holesOf.get(parent).push(i);
  }

  // 5) GeoJSON 규약대로 방향을 맞춘다 (바깥 반시계 / 구멍 시계)
  const wind = (ring, ccw) => (signedArea(ring) < 0) === ccw ? ring.slice().reverse() : ring;
  const polys = outers.map((oi) => [
    wind(info[oi].ring, true),
    ...holesOf.get(oi).map((hi) => wind(info[hi].ring, false)),
  ]);

  const pts = polys.reduce((s, p) => s + p.reduce((t, r) => t + r.length, 0), 0);
  totalPts += pts;
  const before = feats.reduce((s, f) =>
    s + ringsOf(f.geometry).reduce((t, p) => t + p.reduce((u, r) => u + r.length, 0), 0), 0);
  console.log(`${sido.padEnd(9)} 시군구 ${String(feats.length).padStart(3)}개 ${String(before).padStart(7)}점 → 폴리곤 ${String(polys.length).padStart(4)}개 ${String(pts).padStart(7)}점`);

  features.push({
    type: 'Feature',
    properties: { name: sido, short: sido.replace(/(특별자치도|특별자치시|특별시|광역시|도)$/, '') || sido },
    geometry: polys.length === 1
      ? { type: 'Polygon', coordinates: polys[0] }
      : { type: 'MultiPolygon', coordinates: polys },
  });
}

// 보충 폴리곤 얹기 — 겹치지 않는 조각이라 MultiPolygon 에 그대로 덧붙이면 된다
for (const p of PATCHES) {
  if (!fs.existsSync(p)) { console.warn(`보충 파일 없음, 건너뜀: ${p}`); continue; }
  const patch = JSON.parse(fs.readFileSync(p, 'utf8'));
  const target = features.find((f) => f.properties.name === patch.appendTo);
  if (!target) { console.warn(`${patch.appendTo} 를 못 찾음 — ${p} 건너뜀`); continue; }
  const polys = target.geometry.type === 'Polygon' ? [target.geometry.coordinates] : target.geometry.coordinates;
  polys.push(...patch.geometry.coordinates);
  target.geometry = { type: 'MultiPolygon', coordinates: polys };
  const pts = patch.geometry.coordinates.reduce((s, poly) => s + poly.reduce((t, r) => t + r.length, 0), 0);
  totalPts += pts;
  console.log(`보충: ${patch.appendTo} ← ${path.basename(p)} (폴리곤 ${patch.geometry.coordinates.length}개 ${pts}점)`);
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({ type: 'FeatureCollection', features }));
const mb = (fs.statSync(OUT).size / 1048576).toFixed(1);
console.log(`\n완료: ${OUT} — 시도 ${features.length}개 / ${totalPts.toLocaleString()}점 / ${mb}MB`);
