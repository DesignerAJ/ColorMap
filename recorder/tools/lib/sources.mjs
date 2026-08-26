/* 나라별 경계가 어디서 왔는지 적어 두는 대장.

   행정구역 데이터는 도구 셋이 차례로 덮어쓴다 —
     build-admin1-split.mjs   Natural Earth 를 깐다
     build-admin1-hires.mjs   각국 공식기관(geoBoundaries)으로 덮는다
     build-admin1-osm.mjs     OpenStreetMap 으로 다시 덮는다
   그래서 "이 나라 경계가 어디서 왔나"가 **실행 순서에만 암묵적으로** 남아 있었고,
   README 의 출처 목록이 실제와 어긋나기 쉬웠다. 지도 이미지를 내보내면 그 표기 의무가
   이미지에 따라붙으므로 어긋나면 곤란하다.

   그래서 파일을 쓰는 도구가 그때그때 여기에 적는다. 나중에 사람이 옮겨 적지 않는다.
   `test/data.test.js` 의 '출처 대장이 나라별 파일과 맞는다' 가 빠진 나라를 잡는다. */
import fs from 'node:fs';

const PATH = 'recorder/js/data/admin1-sources.json';

export function readSources() {
  try { return JSON.parse(fs.readFileSync(PATH, 'utf8')); } catch { return {}; }
}

/* 한 나라의 출처를 적는다. zoom 은 '이 줌까지는 화면상 원본과 같다'는 뜻이고,
   10 보다 작으면 전송 크기 상한에 걸려 낮춘 것이다 — 정밀도 검사가 그걸 근거로 봐준다. */
export function setSource(iso, { source, license, via, zoom }) {
  const all = readSources();
  all[iso] = { source, license, via, ...(zoom ? { zoom } : {}) };
  fs.writeFileSync(PATH, JSON.stringify(all, null, 1));
}
