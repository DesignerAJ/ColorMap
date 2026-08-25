/* 북쪽 육상 국경선을 우리 데이터로 그리는 배선.
   Mapbox 의 KP-KR 선은 우리 행정경계와 최대 3.1km 어긋나서, 색칠이 선을 넘거나
   못 미치는 것처럼 보였다. 그래서 그 구간을 우리 선으로 대신 그린다. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { boot } from './helpers/boot.js';
import { extract } from '../helpers/extract.js';

const { GEO_TOLERANCE } = extract('recorder/js/recorder.js', ['GEO_TOLERANCE']);

const ready = async () => { const e = boot({ loadBorder: true }); await e.tick(); e.styleLoad(); await e.tick(); return e; };

test('국경선 레이어가 우리 데이터로 만들어진다', async () => {
  const e = await ready();
  const L = e.layers.get('kr-land-border');
  assert.ok(L, '국경선 레이어가 없다');
  assert.equal(L.type, 'line');
  assert.equal(e.sources.get('kr-land-border').tolerance, GEO_TOLERANCE,
    '선과 색칠이 다르게 단순화되면 어긋난다 — 같은 값이어야 한다');
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

/* 스타일이 visibility:none 으로 꺼둔 레이어들. 조절 대상이 아니다 — 아래 참고. */
const STYLE_OFF_IDS = ['country_border', 'country-border-dot', 'admin-boundaries-dot',
                       'admin-2-boundaries-bg', 'admin-2-boundaries-dispute'];

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
    return l.type === 'line' && ['admin', 'country_boundaries'].includes(l['source-layer'])
      && (l.layout || {}).visibility !== 'none';        // 스타일이 꺼둔 것은 대상이 아니다
  });
  assert.ok(boundary.length >= 3, '가짜 스타일에 켜진 경계선이 없다 — 검사가 헛돈다');
  const missed = boundary.filter((id) => !touched.has(id));
  assert.deepEqual(missed, [], `조절에서 빠진 경계선 — 투명도를 0 으로 내려도 남는다`);
});

/* ── 반대쪽 실수: 꺼둔 것을 켜면 안 된다 ──
   한때 admin/country_boundaries 소스의 선을 전부 조절 대상으로 삼아 visibility 를
   'visible' 로 밀어 넣었다. 디자이너가 꺼둔 레이어가 스타일마다 서넛 있어서 그게 다 켜졌다.
   그중 country_border 는 country_boundaries 소스라 **maritime 조건이 없어**
   해안선(육지-바다 경계)까지 흰 선이 그어졌고, KP-KR 가리기(admin 소스만 훑는다)에서도
   빠져 있어 우리 국경선과 두 겹이 됐다 — 두 데이터가 어긋나는 양구 위쪽에서 선이
   갈라졌다 합쳐졌고, 점선으로 바꾸면 점선 두 줄로 보였다. */
test('스타일이 꺼둔 경계선은 켜지 않는다', async () => {
  const e = await ready();
  await paintAll(e);
  const touched = new Set([...e.paint.map((p) => p.id), ...e.layout.map((l) => l.id)]);
  for (const id of STYLE_OFF_IDS) {
    assert.ok(!touched.has(id), `${id} 는 디자이너가 꺼둔 레이어인데 건드렸다`);
    assert.equal(e.layers.get(id).layout.visibility, 'none', `${id} 가 켜졌다`);
  }
});

test("'표시' 를 껐다 켜면 다시 보인다 (visibility 로 끄면 못 켠다)", async () => {
  const e = await ready();
  const blk = e.doc.querySelector('.bd-block[data-bd="country"]');
  const on = blk.querySelector('.bd-on');
  const fire = () => on.dispatchEvent(new e.window.Event('change', { bubbles: true }));
  on.checked = false; fire();
  assert.notEqual(e.layers.get('country-border').layout.visibility, 'none',
    'visibility 로 끄면 스타일이 꺼둔 레이어와 구별되지 않아 다시 못 켠다');
  const off = e.paint.filter((p) => p.id === 'country-border' && p.p === 'line-opacity');
  assert.equal(off.at(-1).v, 0, '껐는데 불투명도가 0 이 아니다');

  const mark = e.paint.length;
  on.checked = true; fire();
  const back = e.paint.slice(mark).filter((p) => p.id === 'country-border' && p.p === 'line-opacity');
  assert.ok(back.length && back.at(-1).v > 0, '다시 켰는데 안 보인다');
});

test('국경선 투명도를 0 으로 내리면 국경선이 전부 사라진다', async () => {
  const e = await ready();
  const blk = e.doc.querySelector('.bd-block[data-bd="country"]');
  blk.querySelector('.bd-opacity').value = '0';
  blk.querySelector('.bd-opacity').dispatchEvent(new e.window.Event('input', { bubbles: true }));
  const zeroed = new Set(e.paint.filter((p) => p.p === 'line-opacity' && p.v === 0).map((p) => p.id));
  // 이름 목록에 없어 조절에서 빠져 있던 국경선. 이게 '조절 불가능한 흰색 국경선'이었다.
  assert.ok(zeroed.has('country-border'), "country-border 가 안 사라진다");
  // 행정구역선은 국경선 칸에 딸려가면 안 된다
  for (const id of ['admin-boundaries', 'admin-boundaries-dot']) {
    assert.ok(!zeroed.has(id), `${id} 는 행정구역선인데 국경선 칸에 딸려갔다`);
  }
  // 분쟁지역도 별개다
  for (const id of ['dispute-boundaries', 'admin-2-boundaries-dispute']) {
    assert.ok(!zeroed.has(id), `${id} 는 분쟁지역인데 국경선 칸에 딸려갔다`);
  }
});

/* ── 점선 ──
   점선으로 바꿔도 한국과 북한만 실선으로 보였다. 정점이 촘촘해서가 아니다 —
   line-dasharray 의 단위는 선 두께의 배수이고, 둥근 끝은 대시를 양쪽으로
   두께의 절반씩 불려 그 만큼 간격을 먹는다. [1,1] 이면 간격이 통째로 사라진다.
   우리가 만든 남·북한 선만 line-cap 이 round 였다. */
test('점선을 켜면 선 끝이 각지게 바뀐다 (둥근 끝은 간격을 먹는다)', async () => {
  const e = await ready();
  const blk = e.doc.querySelector('.bd-block[data-bd="country"]');
  const dash = blk.querySelector('.bd-dash-option');
  dash.checked = true;
  dash.dispatchEvent(new e.window.Event('change', { bubbles: true }));

  const caps = e.layout.filter((l) => l.p === 'line-cap');
  const mine = caps.filter((l) => l.id === 'kr-land-border');
  assert.ok(mine.length, '우리 국경선에 line-cap 을 안 건드렸다');
  assert.equal(mine.at(-1).v, 'butt', '점선인데 끝이 둥글다 — 간격이 메워져 실선으로 보인다');
  // 점선을 껐을 때는 다시 둥글게
  const solid = blk.querySelector('.bd-dash-option');
  solid.checked = false;
  solid.dispatchEvent(new e.window.Event('change', { bubbles: true }));
  const after = e.layout.filter((l) => l.p === 'line-cap' && l.id === 'kr-land-border');
  assert.equal(after.at(-1).v, 'round', '실선으로 되돌리면 끝도 되돌아와야 한다');
});
