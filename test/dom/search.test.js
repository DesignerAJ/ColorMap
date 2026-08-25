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

test('행정지명이 없으면 해외를 보고, 국내 상호명은 맨 뒤로 미룬다', async () => {
  /* 예전에는 VWorld 가 결과를 주면 거기서 끝냈다. VWorld 는 국내만 아는 데다 상호명까지
     주므로 '파리' 가 파리바게뜨로 뒤덮였다. 이제 행정지명 → 해외 → 국내 상호명 순이다. */
  const e = boot({
    vworldKey: 'K', googleKey: 'G',
    vworldReply: (type) => (type === 'district' ? F.vworldEmpty : F.vworldParisShops),
    mapboxReply: F.mapboxHit,
  });
  const r = await search(e, '파리');
  assert.equal(r[0].name, 'Paris', `첫 결과가 '${r[0].name}' — 해외 도시가 먼저 나와야 한다`);
  assert.ok(!r.some((x) => x.name.includes('파리바게뜨')), '국내 상호명이 섞여 올라왔다');

  const types = e.calls.filter((c) => c.api === 'vworld').map((c) => c.type);
  assert.ok(types.includes('district'), '행정지명을 먼저 안 봤다');
  assert.ok(!types.includes('place'), '해외에서 찾았는데도 국내 상호명까지 불렀다');
});

test('행정지명에 걸리면 거기서 끝낸다 (해외·유료 API 를 안 부른다)', async () => {
  const e = boot({ vworldKey: 'K', googleKey: 'G', vworldReply: F.vworldHit, mapboxReply: F.mapboxHit });
  const r = await search(e, '강남구');
  assert.match(r[0].ctx, /VWorld/);
  assert.ok(!e.calls.some((c) => c.api === 'google'), '구글을 불렀다 — 유료 구간이다');
  assert.ok(!e.calls.some((c) => c.api === 'mapbox'), 'Mapbox 를 불렀다');
});

test('국내 상호명은 앞이 다 비었을 때 그대로 나온다', async () => {
  /* 맨 뒤로 미뤄도 '서울시청' 은 나와야 한다 — Mapbox 는 한국 POI 가 사실상 비어 있어서
     그 앞 단계가 전부 0건이기 때문이다(실측 확인). */
  const e = boot({
    vworldKey: 'K', googleKey: 'G',
    vworldReply: (type) => (type === 'district' ? F.vworldEmpty : F.vworldHit),
  });
  const r = await search(e, '서울시청');
  assert.equal(r[0].name, '왕산해수욕장');            // 픽스처의 place 결과
  assert.match(r[0].ctx, /VWorld/);
});

test('행정지명은 시도 → 시군구 → 읍면동 순으로 본다 (category 가 필수다)', async () => {
  /* 실측: type=district·address 는 category 없이 부르면 PARAM_REQUIRED 로 떨어진다.
     예전 코드는 address 를 category 없이 불러서 그 폴백이 늘 실패했고,
     콘솔에 '인증키 문제' 경고까지 잘못 띄웠다. */
  const e = boot({ vworldKey: 'K', vworldReply: F.vworldEmpty });
  await search(e, '없는지명');
  const d = e.calls.filter((c) => c.api === 'vworld' && c.type === 'district');
  assert.deepEqual(d.map((c) => c.category), ['L1', 'L2', 'L3'], '시도→시군구→읍면동 순이어야 한다');
  for (const c of e.calls.filter((x) => x.api === 'vworld')) {
    if (c.type !== 'place') assert.ok(c.category, `type=${c.type} 를 category 없이 불렀다 — 늘 실패한다`);
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
