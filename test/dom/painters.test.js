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
  assert.ok(ss.tolerance > 0, 'tolerance 0 은 단순화를 끄는 값이다 — 아래 검사 참고');
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

/* 하네스의 가짜 스타일은 '단색지형' 을 그대로 옮긴 것이다. 스타일이 켜둔 경계선은 셋뿐이고
   (admin-boundaries · country-border · dispute-boundaries) 나머지는 디자이너가
   visibility:none 으로 꺼뒀다. 예전에는 이름 목록으로 골라 country-border 를 놓쳤다. */
const BOUNDARY_IDS = ['admin-boundaries', 'country-border', 'dispute-boundaries'];
// 스타일이 꺼둔 것들 — 우리가 켜서도, 끌어올려서도 안 된다
const STYLE_OFF_IDS = ['country_border', 'country-border-dot', 'admin-boundaries-dot',
                       'admin-2-boundaries-bg', 'admin-2-boundaries-dispute'];

test('네 모드 모두 색칠이 국경선·행정구역선 아래에 깔린다', async () => {
  const geo = (name) => ({ type: 'FeatureCollection', features: [{ type: 'Feature',
    properties: { name, short: name, sido: '서울특별시', country: '일본', c: [127, 37], z: 8 },
    geometry: { type: 'Polygon', coordinates: [[[126,37],[128,37],[128,38],[126,38],[126,37]]] } }] });
  const e = boot();
  const base = e.window.fetch;
  e.window.fetch = (u, o) => {
    const s = String(u);
    /* 행정구역은 셋으로 나뉘어 온다 — 속성만 담은 meta, 자주 쓰는 8개국 core,
       그리고 나라별 파일. 여기서는 core 에 들어 있는 나라 하나로 충분하다. */
    if (s.includes('admin1-meta.json')) {
      const m = geo('오사카부');
      return Promise.resolve({ ok: true, json: async () => ({ ...m, index: {}, features: m.features.map((f) => ({ ...f, geometry: null })) }) });
    }
    if (s.includes('admin1-core.json')) return Promise.resolve({ ok: true, json: async () => geo('오사카부') });
    if (s.includes('sigungu.json')) return Promise.resolve({ ok: true, json: async () => geo('서울특별시 강남구') });
    if (s.includes('sido-hires')) return Promise.resolve({ ok: true, json: async () => geo('서울특별시') });
    return base(u, o);
  };
  e.styleLoad();
  for (const m of ['admin1', 'sigungu']) { e.click(`seg-${m}`); await e.tick(60); }

  const order = e.layers.order();
  const lineAt = BOUNDARY_IDS.map((id) => order.indexOf(id)).filter((i) => i >= 0);
  assert.equal(lineAt.length, BOUNDARY_IDS.length, '가짜 스타일에 경계선이 다 안 들어 있다');
  for (const mode of ['country', 'admin1', 'sido', 'sigungu']) {
    const fill = order.indexOf(`${mode}-color-fill`);
    assert.ok(fill >= 0, `${mode} 색칠 레이어가 없다`);
    const covered = BOUNDARY_IDS.filter((id) => { const i = order.indexOf(id); return i >= 0 && i < fill; });
    assert.deepEqual(covered, [], `${mode} 색칠이 이 선들을 덮는다`);
  }
});

test('경계선 후보를 이름이 아니라 필터로 고른다 (목록에서 빠지는 일이 없게)', () => {
  const e = boot(); e.styleLoad();
  const moved = new Set(e.calls.filter((c) => c.api === 'moveLayer').map((c) => c.id));
  // 이름 목록에 없던 레이어도 끌어올려야 한다 — country-border 를 놓쳐 색칠에 덮였다
  assert.ok(moved.has('country-border'), '국경선이 안 올라갔다');
  assert.ok(moved.has('dispute-boundaries'), '분쟁 경계선이 안 올라갔다');
  // 꺼둔 레이어는 올릴 것도 없다 (올려도 안 보이지만, 대상에서 빠졌다는 확인이기도 하다)
  for (const id of STYLE_OFF_IDS) {
    assert.ok(!moved.has(id), `${id} 는 스타일이 꺼둔 레이어인데 끌어올렸다`);
  }
});

test('대한민국 국가 색칠이 시도·시군구 색칠 아래에 깔린다', async () => {
  /* 국가를 칠한 위에 시도를 칠하면 시도 색이 보여야 한다. 해외는 Mapbox 레이어가
     그려서 멀쩡했는데, 대한민국·북한만 우리 레이어(korea-country-fill)로 그리면서
     반대가 됐다 — PAINTERS 가 먼저 깔린 뒤에 얹히는 탓에 시도 위로 올라갔다.
     그래서 대한민국을 칠하면 시도 색이 국가 색에 가려졌다. */
  const e = boot({ loadCountries: true });
  e.styleLoad();
  await e.tick(40);

  const order = e.layers.order();
  const kc = order.indexOf('korea-country-fill');
  assert.ok(kc >= 0, '남·북한 국가 색칠 레이어가 없다');

  for (const above of ['sido-color-fill', 'country-color-fill']) {
    const i = order.indexOf(above);
    if (i < 0) continue;
    if (above === 'country-color-fill') {
      assert.ok(kc > i, '남·북한 색칠이 Mapbox 국가 색칠보다 아래에 있다');
    } else {
      assert.ok(kc < i, `${above} 이 국가 색칠에 가려진다`);
    }
  }
});

/* ── GeoJSON 단순화 세기 ──
   tolerance: 0 은 단순화를 **끄는** 값이다. 끄면 타일 좌표를 정수로 반올림할 때
   격자보다 촘촘한 점들이 같은 칸으로 내려앉아 링이 스스로를 훑고, 삼각분할이 튄다 —
   함경남도에서 화면 밖으로 길게 뻗던 다각형이 이것이었다. 지오메트리는 멀쩡해서
   데이터 검사에 아무것도 안 걸렸고, SVG 로 뽑으면 멀쩡한데(지오메트리를 직접 그린다)
   화면·MP4·PSD 에서만 보였다(셋 다 캔버스를 굽는다).
   단위는 CSS 픽셀이고 반올림 격자는 0.0625 px 다. 그보다 커야 뭉치지 않는다. */
test('지리 데이터 소스는 반올림 격자보다 큰 값으로 단순화한다', async () => {
  const e = boot({ loadBorder: true, loadCountries: true });
  await e.tick(); e.styleLoad(); await e.tick(40);
  const GRID_PX = 1 / 16;                                // 타일 1칸 = extent 8192 / tileSize 512
  const MAPBOX_DEFAULT = 0.375;
  const geo = [...e.sources.keys()].filter((id) =>
    e.sources.get(id).type === 'geojson' &&                       // 벡터 타일은 tolerance 가 없다
    !['route-line', 'draw-lines', 'capture-pins'].includes(id));  // 매 프레임 새로 만드는 오버레이는 제외
  assert.ok(geo.length >= 2, '검사할 GeoJSON 소스가 없다 — 하네스를 확인할 것');
  for (const id of geo) {
    const t = e.sources.get(id).tolerance;
    assert.ok(t > GRID_PX, `${id}: tolerance ${t} — 반올림 격자(${GRID_PX})보다 작으면 점이 뭉쳐 삼각분할이 튄다`);
    assert.ok(t <= MAPBOX_DEFAULT, `${id}: tolerance ${t} — mapbox 기본값보다 거칠다`);
  }
  // 선과 색칠이 다르게 단순화되면 어긋난다
  assert.equal(new Set(geo.map((id) => e.sources.get(id).tolerance)).size, 1,
    '소스마다 단순화 세기가 다르다 — 선과 색칠이 어긋난다');
});

/* ── 시도 검색 목록 ──
   입력창을 누르기만 해도 후보가 펼쳐지는데, 예전에는 약칭과 정식명을 각각 option 으로
   넣어서 17개 시도가 34줄로 떴다 — '충북'과 '충청북도'가 나란히 놓여 고르는 데 방해였다.

   네이티브 datalist 는 브라우저가 value·label 양쪽으로 거르고 둘 다 그리므로, 라벨을
   숨기면서 검색만 남길 수는 없다. 그래서 목록을 입력에 따라 다시 짠다 — 평소엔 약칭뿐이고
   정식명에만 걸리는 글자를 칠 때만 그 줄이 생긴다. */
const sidoOptions = (e) => [...e.doc.querySelectorAll('#sido-list option')].map((o) => o.value);
const typeSido = (e, q) => {
  const i = e.$('sido-input');
  i.value = q;
  i.dispatchEvent(new e.window.Event('input', { bubbles: true }));
  return sidoOptions(e);
};

test('평소 시도 목록은 약칭 17줄뿐이다', () => {
  const e = boot();
  const opts = sidoOptions(e);
  assert.equal(opts.length, 17, `${opts.length}줄 — 시도는 17개다 (정식명을 늘 올리면 34줄이 된다)`);
  assert.ok(opts.includes('충북'), '약칭이 없다');
  assert.ok(!opts.includes('충청북도'), '정식명이 늘 올라가 있다 — 중복이다');
  assert.equal(new Set(opts).size, 17, '같은 값이 두 번 올라가 있다');
  assert.deepEqual([...e.doc.querySelectorAll('#sido-list option')].filter((o) => o.label).map((o) => o.value), [],
    'label 이 붙어 목록에 군더더기가 보인다');
});

test('약칭으로 걸리는 글자면 정식명을 안 넣는다', () => {
  const e = boot();
  const opts = typeSido(e, '충');                     // 충북·충남이 이미 걸린다
  assert.ok(!opts.some((v) => v.length > 3), `정식명이 섞였다: ${opts.filter((v) => v.length > 3)}`);
});

test("정식명에만 걸리는 글자를 치면 그때 그 줄이 생긴다", () => {
  const e = boot();
  const opts = typeSido(e, '충청');                   // 약칭 '충북'·'충남' 으로는 안 걸린다
  assert.ok(opts.includes('충청북도'), "'충청' 을 쳤는데 충청북도가 안 뜬다");
  assert.ok(opts.includes('충청남도'), "'충청' 을 쳤는데 충청남도가 안 뜬다");
});

test('입력을 지우면 다시 약칭만 남는다', () => {
  const e = boot();
  typeSido(e, '충청');
  assert.equal(typeSido(e, '').length, 17, '정식명 줄이 남아 있다');
});
