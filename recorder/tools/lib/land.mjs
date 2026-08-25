/* 폴리곤을 육지로 잘라낸다.

   OSM 행정경계는 나라에 따라 **영해까지 포함한다**. 그대로 색칠하면 바다가 칠해진다 —
   브라질 마라냥이 대서양을 덮었고, 터키 얄로바는 넓이가 2.45배였다.
   나라 전체 넓이로는 안 잡힌다(브라질은 합계 1.03배였다). 구역별 넓이로도 안 된다 —
   벨기에 브뤼셀이 13배인데 그건 내륙이고 도시 경계 정의가 달랐던 것이다.
   결국 **육지와 겹치는 부분만 남기는** 수밖에 없다.

   육지는 Natural Earth 10m(퍼블릭 도메인)을 쓴다. 표기 의무가 없고, 전 세계가 닫힌
   폴리곤이라 `build-nk-admin1.mjs` 가 OSM 해안선으로 겪은 문제 — bbox 에서 잘린 탓에
   내륙이 통째로 '바다'로 나오던 것 — 가 여기선 안 생긴다.

   자르는 방식은 build-nk-admin1.mjs 와 같다. 링을 따라가다 바다로 나가면, 나간 지점부터
   다시 들어오는 지점까지를 **해안선 조각으로 바꿔 넣는다.** 직선으로 때우면 안 된다 —
   두만강 하구에서 21.5km 짜리 수평선이 생기고 그 안쪽이 통째로 칠해진 적이 있다.
   이을 길이 없으면(두 교차점이 서로 다른 육지 덩어리에 있으면) 원래 경계를 그대로 둔다.

   Natural Earth 10m 은 해안선이 우리 경계만큼 정밀하지 않아서 자른 자리가 실제와 조금
   다를 수 있다. 바다가 칠해지는 것보다는 낫다는 판단이다. */
import fs from 'node:fs';

const CELL = 0.25;                                       // 격자 한 칸 (도)
const ringsOf = (g) => (g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []);

/* 육지 링을 읽어 격자로 색인한다. 꼭짓점이 44만 개라 색인 없이는 점 하나 판정도 느리다.
   위도 띠(byRow)를 따로 두는 이유는 육지 판정이 가로 광선이라 그 띠 전체가 필요해서다. */
export function loadLand(file) {
  const g = JSON.parse(fs.readFileSync(file, 'utf8'));
  const lines = [];
  for (const f of g.features) for (const poly of ringsOf(f.geometry)) for (const r of poly) lines.push(r);

  const segs = [], byCell = new Map(), byRow = new Map();
  lines.forEach((line, L) => {
    for (let i = 0; i < line.length - 1; i++) {
      const k = segs.push({ a: line[i], b: line[i + 1], L, i }) - 1;
      const { a, b } = segs[k];
      const x0 = Math.floor(Math.min(a[0], b[0]) / CELL), x1 = Math.floor(Math.max(a[0], b[0]) / CELL);
      const y0 = Math.floor(Math.min(a[1], b[1]) / CELL), y1 = Math.floor(Math.max(a[1], b[1]) / CELL);
      for (let y = y0; y <= y1; y++) {
        if (!byRow.has(y)) byRow.set(y, []);
        byRow.get(y).push(k);
        for (let x = x0; x <= x1; x++) {
          const c = x + ':' + y;
          if (!byCell.has(c)) byCell.set(c, []);
          byCell.get(c).push(k);
        }
      }
    }
  });
  return { lines, segs, byCell, byRow };
}

/* 점이 육지인가 — 동쪽으로 광선을 쏴 교차 횟수를 센다. 육지 링은 전부 닫혀 있다. */
export function isLand(p, C) {
  let n = 0;
  for (const k of C.byRow.get(Math.floor(p[1] / CELL)) || []) {
    const { a, b } = C.segs[k];
    if ((a[1] > p[1]) !== (b[1] > p[1])) {
      if ((b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0] > p[0]) n++;
    }
  }
  return n % 2 === 1;
}

/* 선분이 해안선과 만나는 첫 지점 (P0 쪽에서 가까운 순). */
function crossing(P0, P1, C) {
  let best = null;
  const x0 = Math.floor(Math.min(P0[0], P1[0]) / CELL), x1 = Math.floor(Math.max(P0[0], P1[0]) / CELL);
  const y0 = Math.floor(Math.min(P0[1], P1[1]) / CELL), y1 = Math.floor(Math.max(P0[1], P1[1]) / CELL);
  const seen = new Set();
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
    for (const k of C.byCell.get(x + ':' + y) || []) {
      if (seen.has(k)) continue;
      seen.add(k);
      const { a, b, L, i } = C.segs[k];
      const d1 = (P1[0]-P0[0]) * (a[1]-P0[1]) - (P1[1]-P0[1]) * (a[0]-P0[0]);
      const d2 = (P1[0]-P0[0]) * (b[1]-P0[1]) - (P1[1]-P0[1]) * (b[0]-P0[0]);
      const d3 = (b[0]-a[0]) * (P0[1]-a[1]) - (b[1]-a[1]) * (P0[0]-a[0]);
      const d4 = (b[0]-a[0]) * (P1[1]-a[1]) - (b[1]-a[1]) * (P1[0]-a[0]);
      if (!(((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0)))) continue;
      const t = d3 / (d3 - d4);
      const P = [P0[0] + t * (P1[0]-P0[0]), P0[1] + t * (P1[1]-P0[1])];
      const dist = (P[0]-P0[0])**2 + (P[1]-P0[1])**2;
      if (!best || dist < best.dist) best = { P, L, i, dist };
    }
  }
  return best;
}

/* 두 교차점 사이의 해안선 조각. 같은 링이어야 하고, 짧은 쪽으로 돈다.

   **길이에 상한이 있어야 한다.** 육지 링 하나가 남미 대륙 전체이기도 해서, 짧은 쪽이라도
   대륙을 반 바퀴 도는 경우가 생긴다. 그러면 그 안쪽이 통째로 그 구역이 되어 넓이가
   수천 배로 튄다(실제로 브라질이 4,090배가 됐다). 해안을 따라 돌아가는 거리는 두 지점
   사이 직선거리의 몇 배 안쪽이다 — 그보다 길면 이을 수 없는 것으로 본다. */
const DETOUR = 25;                                       // 직선거리의 이 배수까지만 해안을 따라간다
const dist2 = (a, b) => (a[0]-b[0])**2 + (a[1]-b[1])**2;
function pathLen(pts) { let d = 0; for (let i = 1; i < pts.length; i++) d += Math.sqrt(dist2(pts[i-1], pts[i])); return d; }

function coastSlice(from, to, C) {
  if (from.L !== to.L) return null;                      // 다른 육지 덩어리 — 이을 길이 없다
  const line = C.lines[from.L], n = line.length - 1;
  const walk = (dir) => {
    const out = [from.P.slice()];
    let i = from.i;
    for (let step = 0; step < n; step++) {
      i = dir > 0 ? (i + 1) % n : (i - 1 + n) % n;
      if (i === to.i) { out.push(to.P.slice()); return out; }
      out.push(line[i].slice());
    }
    return null;
  };
  const straight = Math.sqrt(dist2(from.P, to.P));
  const ok = (s) => s && pathLen(s) <= Math.max(straight * DETOUR, 0.5);   // 0.5° 는 아주 짧은 구간용 여유
  const cands = [walk(1), walk(-1)].filter(ok);
  if (!cands.length) return null;
  return cands.reduce((a, b) => (pathLen(a) <= pathLen(b) ? a : b));
}

/* 링을 육지로 자른다. 통째로 바다면 null 을 돌려준다(섬이 아니라 영해 조각인 경우). */
export function clipRingToLand(ring, C) {
  const open = ring.slice(0, -1), n = open.length;
  if (n < 3) return { ring, changed: false, unjoined: 0 };
  const land = open.map((p) => isLand(p, C));
  if (land.every(Boolean)) return { ring, changed: false, unjoined: 0 };
  if (!land.some(Boolean)) return { ring: null, changed: true, unjoined: 0 };
  const start = land.indexOf(true);
  const out = [];
  let unjoined = 0;
  for (let c = 0; c < n; c++) {
    const k = (start + c) % n;
    if (land[k]) { out.push(open[k].slice()); continue; }
    let len = 0;
    while (len < n && !land[(start + c + len) % n]) len++;
    const prev = (start + c - 1 + n) % n, next = (start + c + len) % n;
    const ex = crossing(open[prev], open[k], C);
    const en = crossing(open[next], open[(next - 1 + n) % n], C);
    const slice = ex && en ? coastSlice(ex, en, C) : null;
    if (slice) out.push(...slice);
    else { unjoined++; for (let t = 0; t < len; t++) out.push(open[(start + c + t) % n].slice()); }
    c += len - 1;
  }
  if (out.length < 4) return { ring: null, changed: true, unjoined };
  out.push(out[0].slice());
  return { ring: out, changed: true, unjoined };
}
