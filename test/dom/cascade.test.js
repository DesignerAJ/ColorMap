/* CSS 캐스케이드 회귀.

   왜 필요한가:
     data/style.css 에 2.0 시절 규칙이 아직 남아 있고, ID 를 끼고 있어 명시도가 높다.
     app.css 가 @scope 안에 써둔 컴포넌트별 규칙은 @scope 만으로는 명시도가 안 오르므로
     그런 규칙에 진다. 실제로 패널 라벨 34개가 통째로 16px 로 그려지고 있었고,
     select 의 화살표는 background 축약형에 지워져 드롭다운에 아무 표시가 없었다.
     둘 다 문법 오류가 아니라 '어느 규칙이 이기는가' 문제라 눈으로만 잡힌다.

   방법:
     두 스타일시트를 index.html 로드 순서대로 겹쳐, 요소별로 이기는 규칙을 직접 계산한다.
     (@scope 는 명시도를 올리지 않으므로 그대로 두고 명시도·순서로만 판정) */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const ROOT = path.resolve(import.meta.dirname, '../..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

function parseRules(css) {
  const out = [];
  const src = css.replace(/\/\*[\s\S]*?\*\//g, '');
  let i = 0;
  while (i < src.length) {
    const brace = src.indexOf('{', i);
    if (brace < 0) break;
    const sel = src.slice(i, brace).trim();
    let depth = 1, j = brace + 1;
    while (j < src.length && depth) { if (src[j] === '{') depth++; else if (src[j] === '}') depth--; j++; }
    const body = src.slice(brace + 1, j - 1);
    if (/^@scope/.test(sel)) out.push(...parseRules(body));
    else if (!/^@/.test(sel)) {
      const decls = {};
      let d = 0, cur = '';
      for (const ch of body) {
        if (ch === '(') d++;
        if (ch === ')') d--;
        if (ch === ';' && !d) { addDecl(decls, cur); cur = ''; } else cur += ch;
      }
      addDecl(decls, cur);
      sel.split(',').forEach((s) => { s = s.trim(); if (s && !s.includes('{')) out.push({ sel: s, decls }); });
    }
    i = j;
  }
  return out;
}
function addDecl(o, txt) {
  const k = txt.indexOf(':');
  if (k < 0) return;
  const prop = txt.slice(0, k).trim();
  if (prop && !prop.startsWith('/')) o[prop] = txt.slice(k + 1).trim();
}
function spec(sel) {
  const s = sel.replace(/::[\w-]+/g, ' ');
  const a = (s.match(/#[\w-]+/g) || []).length;
  const b = (s.match(/\.[\w-]+/g) || []).length + (s.match(/\[[^\]]+\]/g) || []).length
          + (s.match(/:(?!:)(?!not\b)[\w-]+/g) || []).length;
  const c = (s.replace(/#[\w-]+|\.[\w-]+|\[[^\]]+\]|:[\w-]+(\([^)]*\))?/g, ' ').match(/\b[a-zA-Z][\w-]*\b/g) || []).length;
  return [a, b, c];
}
const cmp = (x, y) => (x[0] - y[0]) || (x[1] - y[1]) || (x[2] - y[2]);

const rules = [];
for (const f of ['data/style.css', 'recorder/css/app.css']) {
  parseRules(read(f)).forEach((r) => rules.push({ ...r, file: f, order: rules.length, sp: spec(r.sel) }));
}
const dom = new JSDOM(`<!DOCTYPE html><body><div id="colormap-ui">${read('recorder/panel.html')}</div></body>`);
const doc = dom.window.document;

function winner(el, prop) {
  const hits = rules.filter((r) => prop in r.decls && (() => { try { return el.matches(r.sel); } catch { return false; } })());
  if (!hits.length) return null;
  hits.sort((x, y) => cmp(x.sp, y.sp) || (x.order - y.order));
  return hits.at(-1);
}
const size = (sel, prop = 'font-size') => {
  const el = doc.querySelector(sel);
  assert.ok(el, `요소가 없다: ${sel}`);
  const inline = /font-size:\s*([\d.]+px)/.exec(el.getAttribute('style') || '');
  if (prop === 'font-size' && inline) return inline[1];
  return winner(el, prop)?.decls[prop] ?? null;
};

test('지도 디자인 패널 라벨이 설계한 크기로 그려진다', () => {
  assert.equal(size('#design-settings .bd-head .line-label'), '12px');
  assert.equal(size('#design-settings .mc-label'), '12px');
  assert.equal(size('#design-settings .mc-toggle'), '12px');
  assert.equal(size('#design-settings .style-projection-card > label'), '12px');
  assert.equal(size('#design-settings .bd-cell'), '10px', '투명도·두께가 옆의 점선(10px)과 따로 놀면 안 된다');
});

test('패널 어느 라벨도 16px 로 그려지지 않는다', () => {
  const big = [];
  for (const el of doc.querySelectorAll('#country-selector-container label')) {
    const inline = /font-size:\s*([\d.]+px)/.exec(el.getAttribute('style') || '');
    const v = inline ? inline[1] : winner(el, 'font-size')?.decls['font-size'];
    if (v === '16px') big.push((el.textContent || '').trim().slice(0, 12));
  }
  assert.deepEqual(big, [], '2.0 시절 포괄 규칙이 다시 이기고 있다');
});

test('라벨에 크기 규칙이 하나도 안 걸리는 경우가 없다', () => {
  // 규칙이 없으면 컨테이너의 20px 을 상속받아 오히려 커진다
  const orphan = [];
  for (const el of doc.querySelectorAll('#country-selector-container label')) {
    if (/font-size/.test(el.getAttribute('style') || '')) continue;
    if (!winner(el, 'font-size')) orphan.push((el.textContent || '').trim().slice(0, 12));
  }
  assert.deepEqual(orphan, [], '이 라벨들은 컨테이너 20px 을 물려받는다');
});

test('드롭다운에 화살표가 남아 있다', () => {
  const sel = doc.getElementById('style-select');
  const bi = winner(sel, 'background-image');
  const bg = winner(sel, 'background');
  assert.ok(bi, '화살표 이미지가 없다');
  const wiped = bg && bg.order > bi.order && cmp(bg.sp, bi.sp) >= 0;
  assert.ok(!wiped, 'background 축약형이 뒤에서 화살표를 지운다 — background-color 를 써야 한다');
  assert.equal(winner(sel, 'appearance')?.decls['appearance'], 'none');
  assert.ok(winner(sel, 'padding-right'), '화살표 자리를 안 비우면 긴 항목이 밑으로 파고든다');
});

test('그리기 모드 버튼의 강조 상태 글자가 배경과 다른 색이다', () => {
  const btn = doc.getElementById('draw-mode');
  const base = winner(btn, 'background-color') ?? winner(btn, 'background');
  const nudge = rules.filter((r) => r.sel === '#draw-mode.nudge' && 'color' in r.decls).at(-1);
  assert.ok(nudge, '.nudge 규칙이 없다');
  assert.notEqual(nudge.decls.color, '#fff', '흰 버튼 위 흰 글씨가 되어 글자가 사라진다');
  assert.notEqual(nudge.decls.color, (base?.decls['background-color'] ?? '').trim());
});

test('점선 예시와 체크박스가 같은 칸·간격을 쓴다 (열 맞춤)', () => {
  const img = rules.filter((r) => r.sel === '.dash-reference img').at(-1);
  const ref = rules.filter((r) => r.sel === '.dash-reference').at(-1);
  const box = rules.filter((r) => r.sel === '.bd-dash-options input[type="checkbox"]').at(-1);
  const opts = rules.filter((r) => r.sel === '.bd-dash-options').at(-1);
  assert.equal(img.decls.width, box.decls.width, '칸 너비가 다르면 열이 어긋난다');
  assert.equal(ref.decls.gap, opts.decls.gap, '간격이 다르면 열이 어긋난다');
});
