/* 경계 폴리곤을 만드는 도구들이 함께 쓰는 링 정리.

   구멍이 바깥 링과 꼭짓점을 공유하면(= 한 점에서 맞닿으면) mapbox-gl 이 구멍을 바깥 링에
   잇는 다리를 놓다가 폭 0 인 삼각형을 만든다. 화면에는 폴리곤을 가로지르는 큰 삼각형으로
   나온다 — 안산·시흥 해안(경기 126.655, 37.216)에서 실제로 났고, 시도 17개에 26곳 있었다.

   구멍을 바깥 링에 합치는 게 위상적으로는 더 옳지만, 그러면 핀치가 생겨 다시 나눠야 하고
   그 과정에서 또 교차가 생긴다. 맞닿은 점을 구멍 안쪽으로 아주 조금 미는 편이 훨씬 안전하다.

   미는 폭이 까다롭다 —
     · 좌표를 소수점 5자리(약 1m)로 줄이는 도구가 있어, 그보다 작게 밀면 반올림이
       원래 자리로 되돌려 놓는다. 1e-6 으로 밀었다가 그대로 살아남는 걸 확인했다.
     · 반대로 크게 밀면 작은 구멍의 모양이 뭉개진다.
     · 게다가 반올림 자체가 **없던 겹침을 새로 만들기도 한다** (서로 다른 두 점이 같은
       값으로 내려앉는다). 그래서 한 번 밀고 끝내면 안 되고, 남아 있으면 폭을 키워
       다시 민다.
   buildPolygons 는 그 앞 단계다 — 링 뭉치를 바깥 링과 구멍으로 나누고 감김 방향을 맞춘다.
   **벡터 타일에는 "구멍" 이라는 표시가 없다. 감김 방향이 유일한 기준이다.** GeoJSON 에서
   링을 폴리곤마다 따로 내보내도 타일로 구우면 한 줄로 늘어서고, mapbox-gl 은 첫 링의
   부호를 바깥으로 잡은 뒤 부호가 반대인 링을 전부 앞 폴리곤의 구멍으로 붙인다.
   그래서 방향이 섞이면 섬과 호수가 통째로 구멍이 되고, 그 구멍들이 서로 겹쳐
   또 삼각형이 뻗는다 — 함경남도(128.0, 40.04)에서 링 165개가 그렇게 됐다.
*/
const key = (p) => p[0] + ',' + p[1];

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

function pointInRing(pt, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > pt[1]) !== (yj > pt[1]) &&
        pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/* 꼭짓점 하나로 판정하면 경계가 맞닿은 링에서 틀린다. 고르게 7개를 뽑아 과반으로 정한다. */
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

/* 링 뭉치 → GeoJSON 폴리곤 배열.

   바깥 링 / 구멍은 **중첩 깊이**로 정한다. "어떤 바깥 링 안에 있으면 구멍"으로 처리하면
   안 된다. 구멍 안에 또 링이 있는 경우가 있는데(호수 속의 섬), 그걸 다시 구멍으로 넣으면
   구멍 둘이 겹쳐 놓이고 mapbox-gl 이 구멍을 바깥 링에 잇다가 엉뚱한 삼각형을 그린다 —
   충남 부사호(126.560, 36.470)와 경기(126.691, 37.111)에서 실제로 났다.

   깊이 0 = 바깥, 1 = 구멍, 2 = 그 구멍 안의 섬(다시 바깥), … 짝수면 육지, 홀수면 구멍.
   부모는 자기를 감싸는 링 중 **가장 작은 것**이라야 한다. 큰 것부터 훑으며 마지막으로
   자기를 감싼 링이 곧 가장 작은 부모다. */
export function buildPolygons(rings, round = (v) => v) {
  const info = rings.map((r) => ({ ring: r, bbox: bboxOf(r), area: Math.abs(signedArea(r)) }));
  info.sort((a, b) => b.area - a.area);                    // 큰 것부터 — 부모는 늘 앞에 있다
  const depth = new Array(info.length).fill(0);
  const parentOf = new Array(info.length).fill(-1);
  for (let i = 0; i < info.length; i++) {
    for (let j = 0; j < i; j++) {
      if (!bboxInside(info[i].bbox, info[j].bbox)) continue;
      if (!ringInside(info[i].ring, info[j].ring)) continue;
      parentOf[i] = j;                                     // 계속 덮어써서 가장 작은(마지막) 부모가 남는다
    }
    depth[i] = parentOf[i] === -1 ? 0 : depth[parentOf[i]] + 1;
  }
  const holesOf = new Map();
  const outers = [];
  for (let i = 0; i < info.length; i++) {
    if (depth[i] % 2 === 0) { outers.push(i); holesOf.set(i, []); }
    else holesOf.get(parentOf[i]).push(i);
  }

  // GeoJSON 규약대로 방향을 맞춘다 (바깥 반시계 / 구멍 시계)
  const wind = (ring, ccw) => (signedArea(ring) < 0) === ccw ? ring.slice().reverse() : ring;
  return outers.map((oi) => nudgeTouchingHoles([
    wind(info[oi].ring, true),
    ...holesOf.get(oi).map((hi) => wind(info[hi].ring, false)),
  ], round));
}

export function nudgeTouchingHoles(poly, round = (v) => v) {
  if (poly.length < 2) return poly;
  let out = poly;
  for (let attempt = 0; attempt < 6; attempt++) {
    /* 바깥 링뿐 아니라 **다른 구멍과 맞닿아도** 같은 문제가 난다 — 충남 부사호 주변에서
       구멍끼리 꼭짓점 10개를 공유하고 있었다. 자기보다 앞선 링 전체를 본다. */
    const outer = new Set(out[0].map(key));
    const seen = out.slice(1).map((h, i) => {
      const s = new Set(outer);
      for (let j = 0; j < i; j++) for (const p of out[j + 1]) s.add(key(p));
      return s;
    });
    if (!out.slice(1).some((h, i) => h.some((p) => seen[i].has(key(p))))) return out;
    const step = 2e-5 * Math.pow(2, attempt);             // 약 2m 에서 시작해 배로 키운다
    out = [out[0], ...out.slice(1).map((hole, hi) => {
      /* 스프레드(Math.min(...xs))로 최소·최대를 구하면 링이 크면 스택이 터진다 —
         육지로 자른 뒤 십만 점짜리 링이 들어오면서 실제로 터졌다. 훑어서 구한다. */
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const p of hole) {
        if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0];
        if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1];
      }
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      const span = Math.max(x1 - x0, y1 - y0);
      const d = Math.min(step, span / 8);
      let hit = false;
      const moved = hole.map((p) => {
        if (!seen[hi].has(key(p))) return p;
        hit = true;
        const dx = cx - p[0], dy = cy - p[1], L = Math.hypot(dx, dy) || 1;
        return [round(p[0] + (dx / L) * d), round(p[1] + (dy / L) * d)];
      });
      if (!hit) return hole;
      moved[moved.length - 1] = moved[0].slice();          // 링을 다시 닫는다
      return moved;
    })];
  }
  return out;
}
