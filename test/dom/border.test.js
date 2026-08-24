/* 북쪽 육상 국경선을 우리 데이터로 그리는 배선.
   Mapbox 의 KP-KR 선은 우리 행정경계와 최대 3.1km 어긋나서, 색칠이 선을 넘거나
   못 미치는 것처럼 보였다. 그래서 그 구간을 우리 선으로 대신 그린다. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { boot } from './helpers/boot.js';

const ready = async () => { const e = boot({ loadBorder: true }); await e.tick(); e.styleLoad(); await e.tick(); return e; };

test('국경선 레이어가 우리 데이터로 만들어진다', async () => {
  const e = await ready();
  const L = e.layers.get('kr-land-border');
  assert.ok(L, '국경선 레이어가 없다');
  assert.equal(L.type, 'line');
  assert.equal(e.sources.get('kr-land-border').tolerance, 0, '단순화되면 색칠과 어긋난다');
  const feats = e.sources.get('kr-land-border').data.features;
  assert.ok(feats.length >= 2 && feats.reduce((s, f) => s + f.geometry.coordinates.length, 0) > 5000,
    '국경선 데이터가 비었거나 너무 성기다');
});

test('Mapbox 의 한반도 국경선 구간만 가린다', async () => {
  const e = await ready();
  for (const id of ['country-border-dot', 'admin-boundaries', 'dispute-boundaries']) {
    assert.match(JSON.stringify(e.filters[id]), /KP-KR/, `${id} 에 제외 조건이 안 붙었다 — 선이 두 줄로 보인다`);
  }
  assert.ok(!e.filters['country_border'],
    'country_boundaries 소스는 우리 데이터와 이미 맞으므로 건드리면 안 된다');
});

test('국경선 컨트롤이 우리 레이어에도 그대로 걸린다', async () => {
  const e = await ready();
  const blk = e.doc.querySelector('.bd-block[data-bd="country"]');
  blk.querySelector('.bd-color').value = '#ff0000';
  blk.querySelector('.bd-width').value = '4';
  blk.querySelector('.bd-color').dispatchEvent(new e.window.Event('input', { bubbles: true }));
  const mine = e.paint.filter((p) => p.id === 'kr-land-border');
  assert.ok(mine.some((p) => p.p === 'line-color' && p.v === '#ff0000'), '색이 안 걸린다');
  assert.ok(mine.some((p) => p.p === 'line-width' && p.v === 4), '두께가 안 걸린다');
  assert.ok(mine.some((p) => p.p === 'line-opacity'), '투명도가 안 걸린다');
  assert.ok(mine.some((p) => p.p === 'line-dasharray'), '점선이 안 걸린다');
});

test('스타일을 바꿔도 다시 붙는다', async () => {
  const e = await ready();
  e.layers.delete('kr-land-border');
  e.sources.delete('kr-land-border');
  e.styleLoad();
  assert.ok(e.layers.get('kr-land-border'), '스타일 교체 후 국경선이 사라진다');
});

test('국경선 파일을 못 받으면 Mapbox 선을 그대로 쓴다', async () => {
  const e = boot({ loadBorder: false });                   // fetch 실패
  await e.tick(); e.styleLoad(); await e.tick();
  assert.ok(!e.layers.get('kr-land-border'));
  assert.ok(!JSON.stringify(e.filters['country-border-dot']).includes('KP-KR'),
    '우리 선도 없는데 Mapbox 선까지 가리면 국경선이 아예 안 보인다');
});

/* ── 조절 대상에서 빠지는 레이어가 없어야 한다 ──
   국경선 UI 가 종류마다 손으로 적은 id 목록을 쓰던 시절, 스타일마다 이름이 달라
   반드시 몇 개를 빠뜨렸다. 빠진 레이어는 UI 가 손을 못 대니 투명도를 0 으로 내려도
   흰 선이 그대로 남았다 — 6개 스타일 중 4개에서 그랬다.
     단색지형·단색  country_border · country-border · admin-2-* · admin-boundaries-dot
     위성사진       country-border-dot 이 없어 국경선 칸이 우리 선 하나만 잡았다
     지형도         country-border
   이제 id 가 아니라 필터를 읽어 종류를 정한다. 이 두 검사가 그 약속을 지킨다. */

const paintAll = async (e) => {
  for (const kind of ['country', 'disputed', 'admin']) {
    const blk = e.doc.querySelector(`.bd-block[data-bd="${kind}"]`);
    blk.querySelector('.bd-opacity').value = '0';
    blk.querySelector('.bd-opacity').dispatchEvent(new e.window.Event('input', { bubbles: true }));
  }
};

test('경계선 레이어가 하나도 조절에서 빠지지 않는다', async () => {
  const e = await ready();
  await paintAll(e);
  const touched = new Set(e.paint.map((p) => p.id));
  const boundary = e.layers.order().filter((id) => {
    const l = e.layers.get(id);
    return l.type === 'line' && ['admin', 'country_boundaries'].includes(l['source-layer']);
  });
  const missed = boundary.filter((id) => !touched.has(id));
  assert.deepEqual(missed, [], `조절에서 빠진 경계선 — 투명도를 0 으로 내려도 남는다`);
});

test('국경선 투명도를 0 으로 내리면 국경선이 전부 사라진다', async () => {
  const e = await ready();
  const blk = e.doc.querySelector('.bd-block[data-bd="country"]');
  blk.querySelector('.bd-opacity').value = '0';
  blk.querySelector('.bd-opacity').dispatchEvent(new e.window.Event('input', { bubbles: true }));
  const zeroed = new Set(e.paint.filter((p) => p.p === 'line-opacity' && p.v === 0).map((p) => p.id));
  // 흰 선의 정체였던 셋. -bg 는 0.6 을 곱해도 0 이라 같이 사라진다.
  for (const id of ['country_border', 'country-border', 'country-border-dot', 'admin-2-boundaries-bg']) {
    assert.ok(zeroed.has(id), `${id} 가 안 사라진다 — 이게 '조절 불가능한 흰색 국경선'이었다`);
  }
  // 행정구역선은 국경선 칸에 딸려가면 안 된다
  for (const id of ['admin-boundaries', 'admin-boundaries-dot']) {
    assert.ok(!zeroed.has(id), `${id} 는 행정구역선인데 국경선 칸에 딸려갔다`);
  }
  // 분쟁지역도 별개다
  for (const id of ['dispute-boundaries', 'admin-2-boundaries-dispute']) {
    assert.ok(!zeroed.has(id), `${id} 는 분쟁지역인데 국경선 칸에 딸려갔다`);
  }
});
