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
*/
const key = (p) => p[0] + ',' + p[1];

export function nudgeTouchingHoles(poly, round = (v) => v) {
  if (poly.length < 2) return poly;
  let out = poly;
  for (let attempt = 0; attempt < 6; attempt++) {
    const outer = new Set(out[0].map(key));
    if (!out.slice(1).some((h) => h.some((p) => outer.has(key(p))))) return out;
    const step = 2e-5 * Math.pow(2, attempt);             // 약 2m 에서 시작해 배로 키운다
    out = [out[0], ...out.slice(1).map((hole) => {
      const xs = hole.map((p) => p[0]), ys = hole.map((p) => p[1]);
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
      const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
      const d = Math.min(step, span / 8);
      let hit = false;
      const moved = hole.map((p) => {
        if (!outer.has(key(p))) return p;
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
