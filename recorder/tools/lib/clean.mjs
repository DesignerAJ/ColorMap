/* 링에서 자기교차와 핀치를 걷어낸다.

   mapbox-gl 의 삼각분할은 링이 자기 자신과 만나면 깨진다. 화면에는 폴리곤을 가로지르는
   얇고 긴 삼각형이 뻗거나, **일부가 아예 안 그려진다** — 브라질 마라냥에서 섬이 색칠
   안 되는 것으로 보였던 게 그것이다(핀치 11 · 자기교차 35).

   둘은 다른 문제다.
     핀치     한 링이 같은 점을 두 번 지난다. 그 점에서 잘라 링 둘로 나눈다.
     자기교차 꼭짓점을 공유하지 않고 두 변이 그냥 가로지른다. 교차점에서 잘라 나눈다.
   **번갈아 돌려야 한다** — 교차를 자르면 핀치가 생기고, 핀치를 나누면 또 교차가 드러난다.

   원래 `build-sido-hires.mjs` 안에 있던 것을 꺼냈다. 시도 데이터에서 85곳을 고친 코드이고,
   영해를 잘라낸 뒤에도 같은 처리가 필요해서 둘이 같이 쓴다 — 복사본이 갈라지면
   그 함정들이 되살아난다. */

const MIN_AREA = 1e-12;                                   // 도² — 위도 36°에서 약 12m²

export function signedArea(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  }
  return a / 2;
}

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

/* 좌표 배열용 핀치 분리. 같은 점을 두 번 지나면 그 사이를 떼어 낸다. */
export function splitPinchesXY(ring) {
  const out = [], stack = [], pos = new Map();
  const k = (p) => p[0] + ',' + p[1];
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

export function repairCrossings(ring) {
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

/* 교차 복구와 핀치 분리를 번갈아, 더 이상 안 바뀔 때까지. 링 하나가 여러 개로 나뉠 수 있다. */
export function cleanRing(ring) {
  let rings = [ring];
  for (let round = 0; round < 5; round++) {
    const next = rings.flatMap(repairCrossings).flatMap(splitPinchesXY)
      .filter((r) => r.length >= 4 && Math.abs(signedArea(r)) > MIN_AREA);
    if (next.length === rings.length && next.every((r, i) => r.length === rings[i].length)) return next;
    rings = next;
  }
  return rings;
}
