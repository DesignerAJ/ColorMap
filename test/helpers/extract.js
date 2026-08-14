/* recorder.js 안의 순수 함수를 테스트에서 꺼내 쓰기 위한 도구.

   왜 이런 게 필요한가:
     검증하고 싶은 함수들(geoDist·partialPath·arcSegment·resolveByMeta …)이
     initRecorder 클로저 안에 있어서 밖에서 import 할 수 없다. 그렇다고 테스트를
     위해 프로덕션 코드를 모듈로 쪼개는 건 지금 단계에서 위험이 더 크다.
     그래서 소스에서 해당 선언만 떼어내 평가한다.

   한계:
     - 이름으로 찾으므로 함수 이름을 바꾸면 테스트가 '없는 함수'로 실패한다.
       (조용히 통과하지 않고 확실히 깨지므로 오히려 안전하다)
     - const 는 한 줄짜리만 지원한다. 여러 줄이면 여기서 던진다.
     나중에 recorder.js 를 ES 모듈로 쪼개면 이 파일은 통째로 없애고 import 로 바꾸면 된다. */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');
export const readSrc = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
export const readJSON = (rel) => JSON.parse(readSrc(rel));
export { ROOT };

/* function NAME(...) { ... } 를 중괄호 짝을 세어 통째로 떼어낸다 */
function grabFunction(src, name) {
  const i = src.search(new RegExp(`\\bfunction\\s+${name}\\s*\\(`));
  if (i < 0) return null;
  let depth = 0;
  for (let k = src.indexOf('{', i); k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}') { depth--; if (!depth) return src.slice(i, k + 1); }
  }
  return null;
}

/* 줄 끝 // 주석을 떼어낸다 (따옴표 안의 // 는 건드리지 않는다) */
function stripComment(line) {
  let q = null;
  for (let i = 0; i < line.length - 1; i++) {
    const c = line[i];
    if (q) { if (c === '\\') i++; else if (c === q) q = null; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; continue; }
    if (c === '/' && line[i + 1] === '/') return line.slice(0, i);
  }
  return line;
}

/* const NAME = ... ;  (한 줄) */
function grabConst(src, name) {
  const re = new RegExp(`^\\s*const\\s+${name}\\s*=.*$`, 'm');
  const m = src.match(re);
  if (!m) return null;
  const line = stripComment(m[0]).trim();
  if (!line.endsWith(';') && !line.endsWith('}')) {
    throw new Error(`${name}: 여러 줄 const 는 지원하지 않는다 (extract.js 참고) — "${line}"`);
  }
  return line;
}

/* 주어진 이름들을 한 스코프에 모아 평가하고 객체로 돌려준다.
   서로를 참조해도 되도록(partialPath → geoDist) 한 번에 묶어서 만든다. */
export function extract(rel, names) {
  const src = readSrc(rel);
  const parts = names.map((n) => {
    const code = grabFunction(src, n) ?? grabConst(src, n);
    if (!code) throw new Error(`${rel} 에서 '${n}' 선언을 찾지 못했다 — 이름이 바뀌었는지 확인할 것`);
    return code;
  });
  const body = `${parts.join('\n')}\nreturn { ${names.join(', ')} };`;
  return new Function(body)();
}
