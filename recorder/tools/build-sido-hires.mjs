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

   분기점 처리 (여기가 핵심이다):
     한 점에서 변이 셋 이상 뻗어나가는 곳이 있다 — 육지가 한 점에서만 맞닿는 지점이다.
     거기서 다음 변을 **임의로 고르면 링이 엉뚱한 갈래로 이어진다.** 전혀 다른 곳까지
     갔다가 돌아오고, mapbox-gl 이 그걸 삼각분할하면 폴리곤을 가로지르는 거대한 삼각형이
     된다 — 줌에 따라 나타났다 사라지는 그 삼각형이다.
     assembleRings 는 들어온 방향의 반대편에서 각도 순으로 가장 가까운 변을 고른다.
     평면 그래프의 면을 따라 도는 표준 방법이라 분기점에서도 제 갈래로 이어진다.

   그래도 남는 것들:
     splitAtPinches   같은 점을 두 번 지나는 링을 그 점에서 나눈다
     cleanRing        꼭짓점을 공유하지 않고 가로지르는 변(슬리버)을 잘라낸다
     nudgeTouchingHoles  구멍이 바깥 링과 맞닿은 점을 안쪽으로 약 2m 민다
     셋 다 같은 삼각형 증상을 낸다. 하나만 고쳐서는 안 없어진다.

   사용법: node recorder/tools/build-sido-hires.mjs
*/

import fs from 'node:fs';
import { nudgeTouchingHoles } from './lib/rings.mjs';
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

   한 점에서 여러 변이 뻗어나가는 분기점이 있다 — 육지가 한 점에서만 맞닿는 곳이다.
   거기서 다음 변을 **아무거나 집어 들면 안 된다.** 그렇게 하면 링이 엉뚱한 갈래로 이어져
   전혀 다른 곳까지 갔다가 돌아오고, mapbox-gl 이 그걸 삼각분할하면 폴리곤을 가로지르는
   거대한 삼각형이 된다. 안산·시흥 해안의 삼각형이 이것이었다.

   들어온 방향의 반대편에서 각도 순으로 **가장 가까운 변**을 고른다. 평면 그래프의 면을
   따라 도는 표준 방법이고, 이렇게 하면 분기점에서도 링이 제 갈래로 이어진다.
   (핀치·자기교차·맞닿은 구멍을 나중에 고치는 것보다, 애초에 제대로 잇는 게 맞다.) */
function assembleRings(edges, coord) {
  const out = new Map();                                  // 시작점 → [끝점, …]
  for (const [a, b] of edges) {
    if (!out.has(a)) out.set(a, []);
    out.get(a).push(b);
  }
  const angleOf = (from, to) => {
    const p = coord.get(from), q = coord.get(to);
    return Math.atan2(q[1] - p[1], q[0] - p[0]);
  };
  const rings = [];
  for (const [s0] of edges) {
    while (out.get(s0)?.length) {
      const ring = [s0];
      let prev = null, cur = s0;
      for (;;) {
        const nexts = out.get(cur);
        if (!nexts || !nexts.length) break;                // 끊긴 사슬 — 아래에서 버린다
        let idx = 0;
        if (prev !== null && nexts.length > 1) {
          const back = angleOf(cur, prev);
          let best = Infinity;
          nexts.forEach((n, i) => {
            let d = back - angleOf(cur, n);                 // 시계 방향으로 얼마나 돌아야 만나는가
            while (d <= 1e-12) d += Math.PI * 2;
            if (d < best) { best = d; idx = i; }
          });
        }
        const nxt = nexts.splice(idx, 1)[0];
        ring.push(nxt);
        prev = cur;
        cur = nxt;
        if (cur === s0) break;
      }
      if (ring.length > 3 && ring[0] === ring[ring.length - 1]) rings.push(...splitAtPinches(ring));
    }
  }
  return rings;
}

/* 진짜 자기교차(끝점을 공유하지 않고 가로지르는 두 변) 복구.

   1m 안팎으로 되돌아오는 슬리버가 남으면 mapbox-gl 의 삼각분할이 폴리곤을 가로지르는
   거대한 삼각형을 그린다 — 충남 해안에서 실제로 났다. 핀치(같은 점 재방문)와 증상은
   같지만 꼭짓점을 공유하지 않아 splitAtPinches 로는 안 잡힌다.

   교차점에서 링을 둘로 나누고 각각 다시 검사한다. 면적이 사실상 없는 조각(12m² 미만)은
   버린다 — 그 크기의 슬리버는 화면에 그릴 수 없고, 남겨두면 또 다른 삼각형이 된다. */
function segIntersect(p1, p2, p3, p4) {
  const d1x = p2[0]-p1[0], d1y = p2[1]-p1[1], d2x = p4[0]-p3[0], d2y = p4[1]-p3[1];
  const den = d1x*d2y - d1y*d2x;
  if (!den) return null;
  const t = ((p3[0]-p1[0])*d2y - (p3[1]-p1[1])*d2x) / den;
  const u = ((p3[0]-p1[0])*d1y - (p3[1]-p1[1])*d1x) / den;
  if (t <= 0 || t >= 1 || u <= 0 || u >= 1) return null;
  return [p1[0] + d1x*t, p1[1] + d1y*t];
}

function findCrossing(open) {
  const n = open.length, C = 0.01, grid = new Map();
  const seg = (i) => [open[i], open[(i+1) % n]];
  for (let i = 0; i < n; i++) {
    const [a, b] = seg(i);
    const x0 = Math.floor(Math.min(a[0],b[0])/C), x1 = Math.floor(Math.max(a[0],b[0])/C);
    const y0 = Math.floor(Math.min(a[1],b[1])/C), y1 = Math.floor(Math.max(a[1],b[1])/C);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
      const k = x + ':' + y;
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(i);
    }
  }
  for (const arr of grid.values()) for (let a = 0; a < arr.length; a++) for (let b = a+1; b < arr.length; b++) {
    const i = Math.min(arr[a], arr[b]), j = Math.max(arr[a], arr[b]);
    if (j - i < 2 || (i === 0 && j === n - 1)) continue;
    const P = segIntersect(...seg(i), ...seg(j));
    if (P) return { i, j, P };
  }
  return null;
}

const MIN_AREA = 1e-12;                                   // 도² — 위도 36°에서 약 12m²

/* 좌표 배열용 핀치 분리. 위쪽 splitAtPinches 는 키 문자열 링에 쓰는 것이고,
   교차 복구는 좌표를 다루므로 같은 처리가 한 벌 더 필요하다. */
function splitPinchesXY(ring) {
  const out = [], stack = [], pos = new Map();
  const k = (p) => p[0] + "," + p[1];
  for (const p of ring) {
    if (pos.has(k(p))) {
      const at = pos.get(k(p));
      const loop = stack.slice(at).concat([p]);
      if (loop.length > 3) out.push(loop);
      for (let t = at + 1; t < stack.length; t++) pos.delete(k(stack[t]));
      stack.length = at + 1;
    } else {
      pos.set(k(p), stack.length);
      stack.push(p);
    }
  }
  return out.length ? out : [ring];
}

/* 교차를 자르면 그 자리에 같은 좌표가 둘 생겨 핀치가 되고, 핀치를 나누면 또 교차가
   드러날 수 있다. 둘 다 없어질 때까지 번갈아 돌린다. */
function cleanRing(ring) {
  let rings = [ring];
  for (let round = 0; round < 5; round++) {
    const next = rings.flatMap(repairCrossings).flatMap(splitPinchesXY)
      .filter((r) => r.length >= 4 && Math.abs(signedArea(r)) > MIN_AREA);
    if (next.length === rings.length && next.every((r, i) => r.length === rings[i].length)) return next;
    rings = next;
  }
  return rings;
}

function repairCrossings(ring) {
  const queue = [ring.slice(0, -1)], done = [];
  let guard = 0;
  while (queue.length && guard++ < 2000) {
    const open = queue.pop();
    if (open.length < 3) continue;
    const c = findCrossing(open);
    if (!c) { done.push([...open, open[0].slice()]); continue; }
    queue.push([...open.slice(0, c.i + 1), c.P, ...open.slice(c.j + 1)]);
    queue.push([c.P, ...open.slice(c.i + 1, c.j + 1)]);
  }
  return done.filter((r) => r.length >= 4 && Math.abs(signedArea(r)) > MIN_AREA);
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
  const rings = assembleRings(kept, coord).map((r) => r.map((k) => coord.get(k))).flatMap(cleanRing);
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
  const polys = outers.map((oi) => nudgeTouchingHoles([
    wind(info[oi].ring, true),
    ...holesOf.get(oi).map((hi) => wind(info[hi].ring, false)),
  ]));

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
  // 보충 폴리곤도 같은 정리를 거쳐야 한다 — 새만금 안의 56m 짜리 구멍이 바깥 링과 맞닿아 있었다
  polys.push(...patch.geometry.coordinates.map((poly) => nudgeTouchingHoles(poly)));
  target.geometry = { type: 'MultiPolygon', coordinates: polys };
  const pts = patch.geometry.coordinates.reduce((s, poly) => s + poly.reduce((t, r) => t + r.length, 0), 0);
  totalPts += pts;
  console.log(`보충: ${patch.appendTo} ← ${path.basename(p)} (폴리곤 ${patch.geometry.coordinates.length}개 ${pts}점)`);
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({ type: 'FeatureCollection', features }));
const mb = (fs.statSync(OUT).size / 1048576).toFixed(1);
console.log(`\n완료: ${OUT} — 시도 ${features.length}개 / ${totalPts.toLocaleString()}점 / ${mb}MB`);
