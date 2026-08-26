/* 파일들 사이의 약속이 어긋나지 않았는지 본다.
   문법은 멀쩡한데 서로 안 맞아서 조용히 깨지는 부류만 모았다. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readSrc } from './helpers/extract.js';

const index = readSrc('index.html');
const script = readSrc('data/script.js');
const panel = readSrc('recorder/panel.html');
const recorder = readSrc('recorder/js/recorder.js');

test('캐시 버스팅 ?v= 값이 전부 같다', () => {
  /* 하나만 깜빡하면 "CSS 는 새것, JS 는 옛것"이 캐시에 남아 원인을 못 찾는 버그가 된다.
     실제로 CSS 2.3.3 / JS 2.2.0·2.2.9 로 갈려 있었고, 고쳐도 화면이 안 바뀌었다. */
  const versions = [...index.matchAll(/\?v=([\d.]+)/g), ...script.matchAll(/\?v=([\d.]+)/g)].map((m) => m[1]);
  assert.ok(versions.length >= 8, `?v= 참조가 ${versions.length}개뿐 — 빠뜨린 파일이 있는지 확인`);
  assert.deepEqual([...new Set(versions)], [versions[0]], `버전이 갈렸다: ${[...new Set(versions)].join(', ')}`);
});

test('JS 가 찾는 DOM id 가 패널에 모두 있다', () => {
  const ids = new Set([...panel.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
  ids.add('map');                                          // index.html 에 있다
  const missing = new Set();
  for (const m of recorder.matchAll(/\$\('([^']+)'\)/g)) if (!ids.has(m[1])) missing.add(m[1]);
  // 템플릿 문자열로 만드는 id 는 모드 이름을 넣어 펼쳐서 확인한다
  for (const m of recorder.matchAll(/\$\(`([^`]+)`\)/g)) {
    for (const mode of ['country', 'admin1', 'sido', 'sigungu']) {
      const id = m[1].replace(/\$\{cfg\.id\}|\$\{p\.id\}/g, mode);
      if (id.includes('${')) continue;                     // suffix 변수는 아래에서 따로 본다
      if (!ids.has(id)) missing.add(id);
    }
  }
  assert.deepEqual([...missing], [], '패널에 없는 id 를 참조한다');
});

test('색칠 모드 4종이 쓰는 id 가 패널에 모두 있다', () => {
  const ids = new Set([...panel.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
  const missing = [];
  for (const mode of ['country', 'admin1', 'sido', 'sigungu']) {
    for (const suffix of ['input', 'color', 'dot', 'clear', 'list', 'list-wrap', 'colored-list', 'block']) {
      if (!ids.has(`${mode}-${suffix}`)) missing.push(`${mode}-${suffix}`);
    }
    if (!ids.has(`seg-${mode}`)) missing.push(`seg-${mode}`);
  }
  // country 는 지연 로드가 없어 status 줄이 없다 — setText 가 알아서 건너뛴다
  assert.deepEqual(missing, [], '모드별 컨트롤이 빠졌다');
});

test('녹화 중 잠그는 컨트롤이 전부 실재한다', () => {
  const ids = new Set([...panel.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
  const list = recorder.match(/\['set-start'[\s\S]*?\]\r?\n\s*\.forEach/);
  assert.ok(list, 'setUI 의 id 목록을 찾지 못했다');
  const missing = [...list[0].matchAll(/'([^']+)'/g)].map((m) => m[1]).filter((id) => !ids.has(id));
  assert.deepEqual(missing, [], 'setUI 가 없는 id 를 잠그려 한다 — 녹화 시작이 통째로 멈춘다');
});

test('패널 조각 버전이 index.html 과 같다', () => {
  const a = index.match(/\?v=([\d.]+)/)[1];
  const b = script.match(/panel\.html\?v=([\d.]+)/)[1];
  assert.equal(b, a, 'PANEL_URL 버전만 뒤처졌다');
});

test('패널 제목은 없고 저작권 문구는 최하단에 있다', () => {
  assert.doesNotMatch(panel, /colormap-panel-title|ColorMap 3\.1/, '삭제한 상단 제목이 남아 있다');
  assert.match(
    panel,
    /<footer class="colormap-panel-footer">© 2026 ColorMap Project by KBS 보도그래픽부<\/footer>\s*<\/div>\s*$/,
    '저작권 문구가 패널 최하단에 없거나 내용이 달라졌다',
  );
});

test('검색 인증키가 커밋에 실제 값으로 남아 있는지 알려준다', () => {
  /* 실패시키지는 않는다 — 도메인 제한을 전제로 브라우저에 노출되는 키라 그대로 두기로 했다.
     다만 어떤 키가 들어 있는지는 눈에 보여야 한다. */
  const cfg = readSrc('recorder/js/config.js');
  const filled = [...cfg.matchAll(/(\w+):\s*'([^']*)'/g)]
    .filter(([, k, v]) => ['vworld', 'google'].includes(k) && v.length > 0)
    .map(([, k, v]) => `${k}(${v.slice(0, 4)}…)`);
  console.log(`      키가 들어 있는 항목: ${filled.length ? filled.join(', ') : '없음'}`);
  assert.ok(true);
});
