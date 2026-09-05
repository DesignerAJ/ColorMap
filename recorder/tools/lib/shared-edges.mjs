/* 폴리곤 모음에서 **이웃끼리 맞대고 있는 변만** 뽑아 선으로 잇는다.

   폴리곤 외곽선을 통째로 그리면 해안선까지 행정구역선이 되어 나라 둘레에 굵은 테두리가
   생긴다. 방향을 무시한 같은 변이 두 번 나오면 두 구역이 맞댄 내부 경계이고,
   한 번만 나오면 해안선이나 나라 바깥 가장자리다.

   변 하나하나를 따로 내보내면 점선·둥근 끝 같은 선 옵션이 변마다 끊겨 지저분해지므로,
   끝점을 물고 이어붙여 긴 선으로 만든다.

   `build-korea-admin1-lines.mjs` 와 `build-admin1-lines.mjs` 가 같이 쓴다.
   (국경선을 고르는 `build-korea-border.mjs` 도 같은 발상이다.) */

export const PREC = 5;   // 소수점 5자리 ≈ 1m. 색칠 쪽도 같은 정밀도로 넣어 두었다

const round = (v) => Number(v.toFixed(PREC));
const key = (p) => round(p[0]) + ',' + round(p[1]);
const und = (a, b) => { const x = key(a), y = key(b); return x < y ? x + '|' + y : y + '|' + x; };
const polysOf = (g) => (g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []);

/* 맞닿은 변을 이어붙인 선들을 돌려준다. [[ [lng,lat], ... ], ...]
   stats 를 주면 { edges, lines, points } 를 채워 준다 (호출한 쪽에서 로그로 쓴다). */
export function sharedLines(features, stats) {
  const seen = new Map();
  for (const f of features) for (const poly of polysOf(f.geometry)) for (const ring of poly)
    for (let i = 1; i < ring.length; i++) {
      const k = und(ring[i - 1], ring[i]);
      if (!seen.has(k)) seen.set(k, { n: 0, a: ring[i - 1], b: ring[i] });
      seen.get(k).n++;
    }
  const edges = [...seen.values()].filter(e => e.n >= 2);

  // 끝점 → 그 점에 붙은 변들
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
    for (const dir of [1, 0]) {          // 양쪽으로 뻗어 나간다
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
  const out = lines.filter(l => l.length >= 2);
  if (stats) {
    stats.edges = edges.length;
    stats.lines = out.length;
    stats.points = out.reduce((s, l) => s + l.length, 0);
  }
  return out;
}
