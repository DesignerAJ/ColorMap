/* 강·호수(water)가 바다와 같은 톤으로 나오는지.
   단색·단색지형에서 바다는 배경(baseColor)이고 water 는 그 위에 fill-opacity 0.5 로
   얹히는 별도 레이어라, 색이 같아도 회색 육지 위에서 옅은 청회색으로 떠 보였다. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { boot } from './helpers/boot.js';

const paintOf = (e, id, prop) => e.paint.filter((p) => p.id === id && p.p === prop).at(-1)?.v;

test('스타일을 열면 water 가 바다 색·불투명으로 맞춰진다', async () => {
  const e = boot(); e.styleLoad();
  await e.tick(120);   // syncMapColorPickers 는 레이어가 자리 잡길 기다렸다 60ms 뒤에 돈다
  assert.equal(paintOf(e, 'water', 'fill-opacity'), 1,
    'fill-opacity 0.5 그대로면 육지 위에서 옅게 떠 보인다');
  assert.ok(paintOf(e, 'water', 'fill-color'), 'water 색이 바다 색으로 안 맞춰졌다');
});

test('바다색을 바꾸면 강·호수도 같이 따라온다', () => {
  const e = boot(); e.styleLoad();
  const inp = e.$('sea-color');
  inp.value = '#123456';
  inp.dispatchEvent(new e.window.Event('input', { bubbles: true }));
  assert.equal(paintOf(e, 'water', 'fill-color'), '#123456', '강·호수만 옛 색으로 남는다');
  assert.equal(paintOf(e, 'water', 'fill-opacity'), 1);
  // 배경 바다도 같이 칠해져야 한다
  assert.equal(paintOf(e, 'background', 'fill-color') ?? paintOf(e, 'background', 'background-color'), '#123456');
});

test('강·호수 체크박스가 기본으로 켜져 있다 (단색 포함)', async () => {
  for (const style of ['mono_terrain', 'mono', 'detail']) {
    const e = boot();
    e.$('style-select').value = style;
    e.styleLoad();
    await e.tick(120);
    assert.equal(e.$('river-on').checked, true, `${style} 에서 강·호수가 꺼진 채 시작한다`);
    // 체크 상태가 실제 레이어 표시로도 이어져야 한다
    assert.ok(e.layout.some((l) => l.id === 'water' && l.p === 'visibility' && l.v === 'visible'),
      `${style} 에서 water 레이어가 안 켜졌다`);
  }
});

test('위성 스타일에서는 water 를 건드리지 않는다 (사진 위에 얹으면 바다가 뿌옇다)', () => {
  const e = boot();
  e.$('style-select').value = 'satellite';
  e.styleLoad();
  assert.equal(paintOf(e, 'water', 'fill-opacity'), undefined,
    '위성에서는 스타일이 꺼둔 오버레이를 그대로 둬야 한다');
});
