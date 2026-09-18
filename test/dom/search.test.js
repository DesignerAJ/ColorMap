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

test('한글 질의는 제공자를 한꺼번에 부른다 (순서대로 기다리지 않는다)', async () => {
  /* 예전에는 순서대로 부르다 결과가 하나라도 나오면 멈췄다. 그래서 앞 제공자가 준
     **틀린 답이 정답을 덮었고**(남대문시장 → 남대문시장4길), 앞이 빌수록 왕복이 쌓였다
     (실측 서울 1번 123ms, 경복궁 6번 620ms). 이제 넷을 동시에 던진다.

     대신 **Google 이 매번 불린다** — 예전의 '유료 절약'은 없어졌다. 검색 1회 = Google 1건.
     이건 알고 한 맞바꿈이다(월 5,000건 무료). 되돌리려면 fetchPlaces 의 chain 을 볼 것. */
  const e = boot({ vworldKey: 'K', googleKey: 'G', vworldReply: F.vworldHit });
  const r = await search(e, '왕산해수욕장');
  assert.equal(r.length, 1, '같은 곳을 여러 제공자가 줬는데 중복이 안 걷혔다');
  assert.equal(r[0].name, '왕산해수욕장');
  assert.match(r[0].ctx, /VWorld/, '출처 표시가 없다');
  assert.match(r[0].ctx, /을왕동/, '주소가 같이 안 나온다');
  for (const api of ['google', 'mapbox']) {
    assert.ok(e.calls.some((c) => c.api === api), `${api} 를 안 불렀다 — 동시 호출이 아니다`);
  }
});

test('표기가 다른 해외 지명이 국내 상호명에 밀리지 않는다', async () => {
  /* VWorld 는 국내만 아는 데다 상호명까지 주므로 '파리' 가 파리바게뜨로 뒤덮였었다.
     Mapbox 는 한글 질의에도 로마자 'Paris' 를 주므로 **질의와 글자가 하나도 안 겹친다** —
     그래서 '질의로 시작하면 위로' 같은 규칙을 쓰면 파리바게뜨가 이긴다.
     정확히 일치가 없을 때는 제공자 순서(행정지명 → Mapbox → Google → 상호명)에 맡긴다. */
  const e = boot({
    vworldKey: 'K', googleKey: 'G',
    vworldReply: (type) => (type === 'district' ? F.vworldEmpty : F.vworldParisShops),
    mapboxReply: F.mapboxHit,
  });
  const r = await search(e, '파리');
  assert.equal(r[0].name, 'Paris', `첫 결과가 '${r[0].name}' — 해외 도시가 먼저 나와야 한다`);
  /* 상호명도 목록에는 남는다(동시에 부르므로). 위로만 안 오면 된다 —
     같이 지워버리면 정말 파리바게뜨를 찾던 사람이 못 찾는다. */
  const shops = r.findIndex((x) => x.name.includes('파리바게뜨'));
  assert.ok(shops > 0, '국내 상호명이 첫 줄에 올라왔거나 아예 사라졌다');
});

test('행정지명이 있으면 그것이 맨 위에 온다', async () => {
  /* 동시에 불러도 순서는 지켜야 한다 — 한글 질의는 행정지명이 맨 앞이다.
     '강남구' 는 어느 제공자도 정확히 일치를 주지 않는 픽스처라 제공자 순서가 그대로 남는다. */
  const e = boot({ vworldKey: 'K', googleKey: 'G', vworldReply: F.vworldHit, mapboxReply: F.mapboxHit });
  const r = await search(e, '강남구');
  assert.match(r[0].ctx, /VWorld/, `첫 결과가 '${r[0].name}' — 행정지명이 먼저여야 한다`);
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

/* ── 결과 목록 키보드 이동 ──
   검색 → 이동까지 손을 마우스로 옮기지 않고 끝낼 수 있어야 한다.
   예전에는 결과 줄이 클릭만 받아서, 검색해 놓고 반드시 마우스를 집어야 했다. */
const press = (e, key) => {
  const ev = new e.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  e.$('geo-input').dispatchEvent(ev);
  return ev;
};
const activeName = (e) =>
  e.doc.querySelector('#geo-results .geo-item.active .gi-name')?.textContent ?? null;

// 픽스처가 두 줄을 준다 — 파리바게뜨 역삼점 / 파리크라상 광화문점
async function twoResults() {
  const e = boot({ vworldKey: 'K', vworldReply: F.vworldParisShops });
  const r = await search(e, '파리');
  assert.equal(r.length, 2, '픽스처가 두 줄이 아니다 — 아래 검사들이 의미를 잃는다');
  return e;
}

test('↓ 로 목록에 내려가고 ↑↓ 로 옮긴다', async () => {
  const e = await twoResults();
  assert.equal(activeName(e), null, '검색만 했는데 벌써 한 줄이 짚혀 있다');

  const ev = press(e, 'ArrowDown');
  assert.ok(ev.defaultPrevented, '기본 동작을 안 막으면 캐럿이 같이 움직인다');
  assert.equal(activeName(e), '파리바게뜨 역삼점');

  press(e, 'ArrowDown');
  assert.equal(activeName(e), '파리크라상 광화문점');
  press(e, 'ArrowUp');
  assert.equal(activeName(e), '파리바게뜨 역삼점');
});

test('끝에서 더 누르면 반대편으로 돈다', async () => {
  const e = await twoResults();
  press(e, 'ArrowUp');                       // 아무것도 안 짚었을 때 ↑ 는 마지막 줄
  assert.equal(activeName(e), '파리크라상 광화문점');
  press(e, 'ArrowDown');                     // 마지막에서 ↓ 는 첫 줄
  assert.equal(activeName(e), '파리바게뜨 역삼점');
});

test('짚은 줄에서 Enter 를 누르면 클릭한 것과 같이 동작한다', async () => {
  const e = await twoResults();
  press(e, 'ArrowDown');
  press(e, 'ArrowDown');
  press(e, 'Enter');
  await e.tick();
  assert.ok(e.calls.some((c) => c.api === 'flyTo' || c.api === 'fitBounds'), '지도가 안 움직였다');
  assert.equal(e.$('geo-input').value, '파리크라상 광화문점', '고른 이름이 입력창에 안 들어갔다');
  assert.equal(e.$('geo-results').style.display, 'none', '고르고 나서 목록이 안 닫혔다');
});

test('아무것도 안 짚었으면 Enter 는 예전처럼 검색이다', async () => {
  const e = await twoResults();
  const before = e.calls.filter((c) => c.api === 'vworld').length;
  press(e, 'Enter');
  await e.tick(120);
  assert.ok(e.calls.filter((c) => c.api === 'vworld').length > before, '검색을 다시 안 돌렸다');
  assert.notEqual(e.$('geo-results').style.display, 'none', '목록이 닫혔다');
});

/* 아래 둘은 실제로 났던 버그다. 한글로 검색하고 ↓ 를 누르면 첫 줄이 아니라 **두 번째 줄**로
   뛰었고, 그대로 두면 300ms 뒤에 강조가 저절로 풀렸다. 원인이 둘 다 IME 조합 확정이었다. */

test('조합 중 방향키는 글자 확정용이라 줄을 안 옮긴다', async () => {
  /* 확정과 이동으로 keydown 이 두 번 흘러서 한 번에 두 줄 뛰었다.
     Enter 를 조합 중에 무시하는 것과 같은 이유다. */
  const e = await twoResults();
  const ev = new e.window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true });
  Object.defineProperty(ev, 'isComposing', { get: () => true });
  e.$('geo-input').dispatchEvent(ev);
  assert.equal(activeName(e), null, '조합 중 방향키로 줄이 옮겨졌다');

  press(e, 'ArrowDown');                     // 확정된 뒤의 진짜 이동
  assert.equal(activeName(e), '파리바게뜨 역삼점', '확정 뒤 첫 ↓ 는 첫 줄이어야 한다');
});

test('조합이 끝나며 같은 값으로 input 이 또 와도 짚어둔 줄이 안 풀린다', async () => {
  /* compositionend 와 함께 input 이 한 번 더 흐르는데 값은 이미 그대로다. 그걸로 검색을
     다시 돌리면 목록이 새로 그려지면서 짚어둔 줄이 사라진다 — ↓ 로 골라 놓고 가만히
     있으면 강조가 저절로 풀리던 것이 이것이다. */
  const e = await twoResults();
  press(e, 'ArrowDown');
  assert.equal(activeName(e), '파리바게뜨 역삼점');

  const before = e.calls.filter((c) => c.api === 'vworld').length;
  e.$('geo-input').dispatchEvent(new e.window.Event('input', { bubbles: true }));   // 값은 '파리' 그대로
  await e.tick(400);                         // 디바운스(300ms)가 지나도록 기다린다
  assert.equal(e.calls.filter((c) => c.api === 'vworld').length, before, '같은 질의로 검색을 다시 돌렸다');
  assert.equal(activeName(e), '파리바게뜨 역삼점', '가만히 있었는데 짚어둔 줄이 풀렸다');
});

test('글자를 고치면 그때는 다시 검색한다', async () => {
  // 위 검사 때문에 '값이 같으면 안 돈다' 가 '아예 안 돈다' 가 되면 검색이 죽는다
  const e = await twoResults();
  const before = e.calls.filter((c) => c.api === 'vworld').length;
  e.$('geo-input').value = '파리시';
  e.$('geo-input').dispatchEvent(new e.window.Event('input', { bubbles: true }));
  await e.tick(400);
  assert.ok(e.calls.filter((c) => c.api === 'vworld').length > before, '글자를 고쳤는데 검색을 안 돌렸다');
});

test('목록이 없으면 ↓ 를 가로채지 않는다 (입력창 캐럿 이동)', async () => {
  const e = boot({ vworldKey: 'K', vworldReply: F.vworldEmpty });
  await search(e, '없는지명');                 // '결과 없음' 은 고를 수 없는 줄이다
  const ev = press(e, 'ArrowDown');
  assert.ok(!ev.defaultPrevented, '고를 것도 없는데 캐럿 이동을 막았다');
  assert.equal(activeName(e), null);
});

test('Escape 로 목록을 닫으면 짚은 줄도 없어진다', async () => {
  const e = await twoResults();
  press(e, 'ArrowDown');
  press(e, 'Escape');
  assert.equal(e.$('geo-results').style.display, 'none');
  press(e, 'Enter');                          // 닫힌 목록의 줄이 Enter 로 되살아나면 안 된다
  await e.tick();
  assert.ok(!e.calls.some((c) => c.api === 'flyTo'), '닫은 목록에서 골라졌다');
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
