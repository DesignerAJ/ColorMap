/* 장소 검색 제공자 체인과 검색창 Enter 처리. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, FIXTURES as F } from './helpers/boot.js';

const rows = (e) => [...e.doc.querySelectorAll('#geo-results .geo-item')].map((el) => ({
  name: el.querySelector('.gi-name')?.textContent ?? el.textContent,
  ctx: el.querySelector('.gi-ctx')?.textContent ?? '',
}));
async function search(e, q) {
  const i = e.$('geo-input');
  i.value = q;
  i.dispatchEvent(new e.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await e.tick(120);
  return rows(e);
}

test('한글 질의는 VWorld 가 먼저 — 찾으면 구글은 안 부른다 (유료 절약)', async () => {
  const e = boot({ vworldKey: 'K', googleKey: 'G', vworldReply: F.vworldHit });
  const r = await search(e, '왕산해수욕장');
  assert.equal(r.length, 1);
  assert.equal(r[0].name, '왕산해수욕장');
  assert.match(r[0].ctx, /VWorld/, '출처 표시가 없다');
  assert.match(r[0].ctx, /을왕동/, '주소가 같이 안 나온다');
  assert.ok(!e.calls.some((c) => c.api === 'google'), '구글을 불렀다');
  assert.ok(!e.calls.some((c) => c.api === 'mapbox'), 'Mapbox 를 불렀다');
});

test('VWorld 가 0건이면 구글로, 구글도 0건이면 Mapbox 로', async () => {
  const e1 = boot({ vworldKey: 'K', googleKey: 'G', vworldReply: F.vworldEmpty, googleReply: F.googleHit });
  assert.match((await search(e1, '왕산해수욕장'))[0].ctx, /Google/);
  assert.equal(e1.calls.filter((c) => c.api === 'vworld').length, 2, 'place·address 두 번 시도해야 한다');

  const e2 = boot({ vworldKey: 'K', googleKey: 'G', mapboxReply: F.mapboxHit });
  assert.match((await search(e2, '없는지명'))[0].ctx, /Mapbox/);
  for (const api of ['vworld', 'google', 'mapbox']) {
    assert.ok(e2.calls.some((c) => c.api === api), `${api} 를 건너뛰었다`);
  }
});

test('구글 필드마스크가 Pro 범위를 안 넘는다 (요금 등급)', async () => {
  const e = boot({ vworldKey: 'K', googleKey: 'G', vworldReply: F.vworldEmpty, googleReply: F.googleHit });
  await search(e, '왕산해수욕장');
  const g = e.calls.find((c) => c.api === 'google');
  assert.doesNotMatch(g.mask, /rating|priceLevel|OpeningHours|phone|website/i,
    'Enterprise 필드가 섞이면 요금 등급이 올라간다');
  assert.equal(g.body.languageCode, 'ko');
  assert.ok(g.body.locationBias, '화면 근처 가중치가 빠졌다');
});

test('영문 질의는 Mapbox 부터 (국내 API 건너뜀)', async () => {
  const e = boot({ vworldKey: 'K', googleKey: 'G', mapboxReply: F.mapboxHit });
  assert.equal((await search(e, 'Paris'))[0].name, 'Paris');
  assert.ok(!e.calls.some((c) => c.api === 'vworld'));
});

test('키가 하나도 없으면 예전처럼 Mapbox 만 쓴다', async () => {
  const e = boot({ mapboxReply: F.mapboxHit });
  assert.equal((await search(e, '서울시청')).length, 1);
  assert.ok(!e.calls.some((c) => c.api === 'vworld' || c.api === 'google'));
});

test('VWorld 키가 거부되면 콘솔에 원인을 남기고 다음 제공자로 넘어간다', async () => {
  const e = boot({ vworldKey: 'BAD', googleKey: 'G', vworldReply: F.vworldBadKey, googleReply: F.googleHit });
  assert.match((await search(e, '왕산해수욕장'))[0].ctx, /Google/);
  assert.ok(e.warns.some((w) => /인증키/.test(w) && /사용 도메인/.test(w)),
    '키 문제인지 결과가 없는 건지 구분할 단서가 없다');
});

// ── 색칠 검색창의 Enter ──
function pressEnter(e, id, { composing = false, commitTo = null } = {}) {
  const inp = e.$(id);
  const ev = new e.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
  if (composing) Object.defineProperty(ev, 'isComposing', { get: () => true });
  inp.dispatchEvent(ev);
  // 브라우저 기본 동작: 목록에서 고른 값을 넣고 change 를 흘린다
  if (commitTo !== null && !ev.defaultPrevented) {
    inp.value = commitTo;
    inp.dispatchEvent(new e.window.Event('change', { bubbles: true }));
  }
  return ev;
}

test('목록에서 방향키로 고른 뒤 Enter 로 선택된다', async () => {
  const e = boot(); e.styleLoad();
  e.$('country-input').value = '일';                       // 타이핑 중인 값
  const ev = pressEnter(e, 'country-input', { commitTo: '일본' });
  assert.ok(!ev.defaultPrevented, 'Enter 를 막으면 목록 선택 자체가 취소된다');
  await e.tick();
  assert.deepEqual(e.chips('country'), ['일본']);
  assert.equal(e.$('country-input').value, '', '입력창이 안 비워졌다');
});

test('목록 없이 직접 다 쳐서 Enter 도 된다', async () => {
  const e = boot(); e.styleLoad();
  e.$('country-input').value = '중국';
  pressEnter(e, 'country-input');
  await e.tick();
  assert.deepEqual(e.chips('country'), ['중국']);
});

test('한글 조합 중 Enter 는 글자 확정용이라 무시한다', async () => {
  const e = boot(); e.styleLoad();
  e.$('country-input').value = '미국';
  pressEnter(e, 'country-input', { composing: true });
  await e.tick();
  assert.deepEqual(e.chips('country'), [], '조합 중 Enter 로 추가됐다');
  pressEnter(e, 'country-input');                          // 확정 뒤 두 번째 Enter
  await e.tick();
  assert.deepEqual(e.chips('country'), ['미국']);
});

test('IME 잔여 한 글자가 흘러들어도 엉뚱한 곳이 안 칠해진다', async () => {
  const e = boot(); e.styleLoad();
  e.click('seg-sido');
  e.type('sido-input', '도');                              // 조합 중이던 한 글자
  await e.tick();
  assert.deepEqual(e.chips('sido'), [], "'도' 로 경기도가 칠해졌다");
});
