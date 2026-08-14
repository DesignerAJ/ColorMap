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

test('모드를 바꾸면 이전 색칠이 초기화된다', () => {
  const e = boot(); e.styleLoad();
  e.type('country-input', '독일');
  e.click('seg-sido');
  assert.deepEqual(e.chips('country'), []);
  assert.equal(e.$('country-block').style.display, 'none');
  assert.equal(e.$('sido-block').style.display, '');
  assert.ok(e.$('seg-sido').classList.contains('active'));
});

test('스타일을 바꿔도 색칠 레이어가 다시 붙는다', () => {
  const e = boot(); e.styleLoad();
  e.type('country-input', '독일');
  e.layers.delete('country-color-fill');
  e.sources.delete('country-boundaries');
  e.styleLoad();
  assert.ok(e.layers.get('country-color-fill'), '스타일 교체 후 색칠이 돌아오지 않는다');
});

test('경계선이 색칠 위로 올라간다', () => {
  const e = boot(); e.styleLoad();
  assert.ok(e.calls.some((c) => c.api === 'moveLayer'), 'raiseBoundaries 가 안 돌았다 — 선이 색칠에 덮인다');
});
