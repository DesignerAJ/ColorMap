/* 색칠 4모드(국가·해외행정구역·시도·시군구)가 한 팩토리에서 나오므로,
   한 모드에서 깨지면 나머지도 같이 깨진다. 여기서 그 배선을 지킨다. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, FIXTURES } from './helpers/boot.js';

test('부팅과 style.load 가 예외 없이 지나간다', () => {
  const e = boot();
  e.styleLoad();
  assert.ok(e.$('country-selector-container'), '패널이 붙지 않았다');
});

test('국가: 검색 → 칩 → 색 표현식 → 이동', async () => {
  const e = boot(); e.styleLoad();
  e.type('country-input', '독일');
  assert.deepEqual(e.chips('country'), ['독일']);
  assert.equal(e.$('country-list-wrap').style.display, 'block');
  assert.ok(e.calls.some((c) => c.api === 'flyTo'), '추가한 나라로 이동하지 않았다');

  const fc = e.paint.filter((p) => p.id === 'country-color-fill' && p.p === 'fill-color').at(-1);
  const fo = e.paint.filter((p) => p.id === 'country-color-fill' && p.p === 'fill-opacity').at(-1);
  assert.equal(fc.v[0], 'match');
  assert.ok(fc.v.includes('DEU'), 'ISO 코드가 색 표현식에 없다');
  assert.equal(fo.v[0], 'match', '투명도도 구역별 match 여야 한다');
});

test('국가: 기본색이 두 가지로 번갈아 나온다', () => {
  const e = boot(); e.styleLoad();
  const c1 = e.$('country-color').value;
  e.type('country-input', '독일');
  const c2 = e.$('country-color').value;
  assert.notEqual(c1, c2, '두 번째 나라도 같은 색이면 구분이 안 된다');
});

test('국가: 칩 제거와 전체 삭제', () => {
  const e = boot(); e.styleLoad();
  e.type('country-input', '독일');
  e.type('country-input', '프랑스');
  assert.equal(e.chips('country').length, 2);
  e.doc.querySelector('#country-colored-list .chip .x')
    .dispatchEvent(new e.window.Event('click', { bubbles: true }));
  assert.equal(e.chips('country').length, 1);
  e.click('country-clear');
  assert.deepEqual(e.chips('country'), []);
  assert.equal(e.$('country-list-wrap').style.display, 'none');
});

test('시도: 약칭으로 찾고 칩에는 두 글자로, title 은 정식명으로', () => {
  const e = boot(); e.styleLoad();
  e.click('seg-sido');
  for (const [q, short, full] of [
    ['경기', '경기', '경기도'], ['충북', '충북', '충청북도'],
    ['전남', '전남', '전라남도'], ['경남', '경남', '경상남도'],
  ]) {
    e.type('sido-input', q);
    const chip = e.doc.querySelector('#sido-colored-list .chip:last-child .nm');
    assert.equal(chip.textContent, short, `${full} 칩 이름`);
    assert.equal(chip.getAttribute('title'), full, `${full} title`);
  }
});

test('레이어 종류: 국가는 벡터타일, 시도는 GeoJSON', () => {
  const e = boot(); e.styleLoad();
  const cs = e.sources.get('country-boundaries');
  assert.equal(cs.type, 'vector');
  assert.equal(e.layers.get('country-color-fill')['source-layer'], 'country_boundaries');
  assert.ok(Array.isArray(e.layers.get('country-color-fill').filter), 'worldview 필터가 빠졌다');

  const ss = e.sources.get('sido-boundaries');
  assert.equal(ss.type, 'geojson');
  assert.equal(ss.tolerance, 0, 'tolerance 0 이 아니면 화면에서 각져 보인다');
  assert.ok(!e.layers.get('sido-color-fill')['source-layer']);
});

test('데이터 없는 모드는 레이어를 안 만들고 입력창을 잠가 둔다', async () => {
  const e = boot(); e.styleLoad();
  assert.ok(!e.layers.get('admin1-color-fill'), '데이터 전에 레이어를 만들었다');
  e.click('seg-admin1');
  await e.tick();
  assert.ok(e.$('admin1-input').disabled, '데이터를 못 받았는데 입력창이 열려 있다');
  assert.match(e.$('admin1-status').textContent, /불러오지 못했습니다/);
});

test('모드를 바꿔도 이전 색칠이 남는다', () => {
  /* 국가와 행정구역을 같이 쓰고 싶을 때가 있다 (중국을 칠하고 우리 시도를 칠하는 식).
     예전에는 전환할 때마다 전부 초기화라, 다른 탭을 잠깐 열어봤다가 돌아오면 작업이 날아갔다.
     지우고 싶으면 각 탭의 '전체 삭제'가 있다. */
  const e = boot(); e.styleLoad();
  e.type('country-input', '독일');
  e.click('seg-sido');
  assert.deepEqual(e.chips('country'), ['독일'], '탭을 바꿨다고 색칠이 지워졌다');
  assert.equal(e.$('country-block').style.display, 'none');
  assert.equal(e.$('sido-block').style.display, '');
  assert.ok(e.$('seg-sido').classList.contains('active'));
});

test('전체 삭제는 그 모드의 색칠만 지운다', () => {
  const e = boot(); e.styleLoad();
  e.type('country-input', '독일');
  e.click('seg-sido');
  e.type('sido-input', '경기');
  e.click('sido-clear');
  assert.deepEqual(e.chips('sido'), [], '시도가 안 지워졌다');
  assert.deepEqual(e.chips('country'), ['독일'], '다른 모드까지 지웠다');
});

test('스타일을 바꿔도 색칠 레이어가 다시 붙는다', () => {
  const e = boot(); e.styleLoad();
  e.type('country-input', '독일');
  e.layers.delete('country-color-fill');
  e.sources.delete('country-boundaries');
  e.styleLoad();
  assert.ok(e.layers.get('country-color-fill'), '스타일 교체 후 색칠이 돌아오지 않는다');
});

/* 하네스의 가짜 스타일에는 실제 스타일과 같은 경계선 레이어들이 들어 있다.
   admin-2-* 는 시군구 경계선이고, country_border 는 country_boundaries 소스에서 온
   국경선이다. 예전에는 이 둘이 끌어올림 목록에 없어서 색칠에 덮였다. */
const BOUNDARY_IDS = ['country-border-dot', 'admin-boundaries', 'dispute-boundaries', 'country_border'];

test('네 모드 모두 색칠이 국경선·행정구역선 아래에 깔린다', async () => {
  const geo = (name) => ({ type: 'FeatureCollection', features: [{ type: 'Feature',
    properties: { name, short: name, sido: '서울특별시', country: '일본', c: [127, 37], z: 8 },
    geometry: { type: 'Polygon', coordinates: [[[126,37],[128,37],[128,38],[126,38],[126,37]]] } }] });
  const e = boot();
  const base = e.window.fetch;
  e.window.fetch = (u, o) => {
    const s = String(u);
    if (s.includes('admin1.json')) return Promise.resolve({ ok: true, json: async () => geo('오사카부') });
    if (s.includes('sigungu.json')) return Promise.resolve({ ok: true, json: async () => geo('서울특별시 강남구') });
    if (s.includes('sido-hires')) return Promise.resolve({ ok: true, json: async () => geo('서울특별시') });
    return base(u, o);
  };
  e.styleLoad();
  for (const m of ['admin1', 'sigungu']) { e.click(`seg-${m}`); await e.tick(60); }

  const order = e.layers.order();
  const lineAt = BOUNDARY_IDS.map((id) => order.indexOf(id)).filter((i) => i >= 0);
  assert.ok(lineAt.length >= 4, '가짜 스타일에 경계선이 다 안 들어 있다');
  for (const mode of ['country', 'admin1', 'sido', 'sigungu']) {
    const fill = order.indexOf(`${mode}-color-fill`);
    assert.ok(fill >= 0, `${mode} 색칠 레이어가 없다`);
    const covered = BOUNDARY_IDS.filter((id) => { const i = order.indexOf(id); return i >= 0 && i < fill; });
    assert.deepEqual(covered, [], `${mode} 색칠이 이 선들을 덮는다`);
  }
});

test('경계선 후보를 이름이 아니라 소스로 고른다 (목록에서 빠지는 일이 없게)', () => {
  const e = boot(); e.styleLoad();
  // admin 소스의 선인데 BOUNDARY_LAYERS 에는 없는 레이어도 끌어올려야 한다
  const moved = new Set(e.calls.filter((c) => c.api === 'moveLayer').map((c) => c.id));
  assert.ok(moved.has('country_border'), 'country_boundaries 소스의 국경선이 안 올라갔다');
  assert.ok(moved.has('dispute-boundaries'), 'admin 소스의 분쟁 경계선이 안 올라갔다');
});
