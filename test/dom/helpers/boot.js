/* 실제 panel.html + recorder.js 를 jsdom 에 올려 돌리는 하네스.

   Mapbox 는 WebGL 이라 jsdom 에서 못 돈다. 대신 map 객체를 흉내내고 호출을 기록한다.
   그래서 여기서 잡히는 건 '배선'이다 — 어떤 레이어를 어떤 순서로 만들고, 어떤 값을
   어디에 넣는가. 실제로 그려진 그림이 맞는지는 못 본다 (그건 스크린샷 테스트 몫). */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

export const FIXTURES = {
  vworldHit: { response: { status: 'OK', result: { crs: 'EPSG:4326', type: 'place', items: [
    { title: '왕산해수욕장', category: '테마관광지 > 해수욕장',
      address: { road: '인천광역시 중구 을왕동', parcel: '인천광역시 중구 을왕동 산 105-9' },
      point: { x: '126.3707', y: '37.4470' } }] } } },
  vworldEmpty: { response: { status: 'NOT_FOUND', result: { items: [] } } },
  vworldBadKey: { response: { status: 'ERROR', error: { code: 'INVALID_KEY', text: '등록되지 않은 인증키입니다.' } } },
  googleHit: { places: [{ displayName: { text: '왕산해수욕장' }, formattedAddress: '인천광역시 중구',
    location: { latitude: 37.447, longitude: 126.3707 },
    viewport: { low: { latitude: 37.44, longitude: 126.36 }, high: { latitude: 37.45, longitude: 126.38 } } }] },
  mapboxHit: { features: [{ properties: { name: 'Paris', place_formatted: 'France', feature_type: 'place' },
    geometry: { coordinates: [2.35, 48.86] } }] },
  empty: { features: [] },
};

// 실제 커스텀 스타일과 같은 모양의 레이어들 (국경선 가리기 검증용)
const STYLE_LAYERS = [
  { id: 'background', type: 'background' },
  { id: 'landColor', type: 'fill' },
  { id: 'water', type: 'fill' },
  { id: 'country-border-dot', type: 'line', 'source-layer': 'admin' },
  { id: 'admin-boundaries', type: 'line', 'source-layer': 'admin' },
  { id: 'dispute-boundaries', type: 'line', 'source-layer': 'admin' },
  { id: 'country_border', type: 'line', 'source-layer': 'country_boundaries' },
  { id: 'poi-label', type: 'symbol' },
];

export function boot({
  vworldKey = '', googleKey = '',
  vworldReply = FIXTURES.vworldEmpty,
  googleReply = { places: [] },
  mapboxReply = FIXTURES.empty,
  loadBorder = false,
  loadCountries = false,
} = {}) {
  const dom = new JSDOM(
    `<!DOCTYPE html><body><div id="colormap-ui">${read('recorder/panel.html')}</div><div id="map"></div></body>`,
    { pretendToBeVisual: true, runScripts: 'outside-only' });
  const { window } = dom;
  const calls = [];
  const warns = [];

  const ctx2d = new Proxy({}, { get: (t, k) =>
    k === 'fillStyle' ? '#000000'
    : k === 'getImageData' ? () => ({ width: 1, height: 1, data: new Uint8ClampedArray(4) })
    : k === 'measureText' ? () => ({ width: 10 })
    : () => {} });
  window.HTMLCanvasElement.prototype.getContext = () => ctx2d;

  /* 레이어는 '순서'가 곧 그리는 순서다 — 색칠이 국경선 위로 올라가는지 같은 문제가
     여기서 갈리므로, addLayer(def, beforeId) / moveLayer(id, beforeId) 를 배열로
     제대로 흉내낸다. 기존 테스트가 쓰던 .get/.delete/.keys 는 그대로 쓸 수 있게 둔다. */
  const layerList = STYLE_LAYERS.map((l) => ({ ...l }));
  const at = (id) => layerList.findIndex((l) => l.id === id);
  const put = (l, before) => {
    const i = before ? at(before) : -1;
    if (i >= 0) layerList.splice(i, 0, l); else layerList.push(l);
  };
  const layers = {
    get: (id) => layerList.find((l) => l.id === id),
    has: (id) => at(id) >= 0,
    delete: (id) => { const i = at(id); if (i >= 0) layerList.splice(i, 1); return i >= 0; },
    keys: () => layerList.map((l) => l.id),
    order: () => layerList.map((l) => l.id),
    indexOf: at,
  };
  const sources = new Map();
  const filters = {
    'country-border-dot': ['all', ['==', ['get', 'admin_level'], 0]],
    'admin-boundaries': ['all', ['==', ['get', 'admin_level'], 1]],
    'dispute-boundaries': ['all', ['==', ['get', 'disputed'], 'true']],
  };
  const handlers = {};
  const paint = [];
  const layout = [];

  const map = {
    _fadeDuration: 300,
    on: (e, f) => (handlers[e] ||= []).push(f),
    once: (e, f) => (handlers[e] ||= []).push(f),
    off: () => {},
    fire: (e, a) => (handlers[e] || []).forEach((f) => f(a)),
    getCenter: () => ({ lng: 127, lat: 37.5, toArray: () => [127, 37.5] }),
    getZoom: () => 6, getBearing: () => 0, getPitch: () => 0,
    getCanvas: () => {
      const c = window.document.createElement('canvas');
      c.width = 1280; c.height = 720;
      Object.defineProperty(c, 'clientWidth', { get: () => 1280 });
      Object.defineProperty(c, 'clientHeight', { get: () => 720 });
      return c;
    },
    getContainer: () => ({ clientWidth: 1280, clientHeight: 720 }),
    getStyle: () => ({ layers: layerList }),
    addSource: (id, s) => sources.set(id, { ...s, setData: (d) => { sources.get(id).data = d; } }),
    getSource: (id) => sources.get(id),
    removeSource: (id) => sources.delete(id),
    addLayer: (d, before) => { put(d, before); calls.push({ api: 'addLayer', id: d.id, before }); },
    getLayer: (id) => layers.get(id),
    removeLayer: (id) => layers.delete(id),
    moveLayer: (id, before) => {
      const i = at(id);
      if (i < 0) return;
      const [l] = layerList.splice(i, 1);
      put(l, before);
      calls.push({ api: 'moveLayer', id, before });
    },
    setPaintProperty: (id, p, v) => paint.push({ id, p, v }),
    getPaintProperty: () => '#334455',
    setLayoutProperty: (id, p, v) => layout.push({ id, p, v }),
    getLayoutProperty: () => 'visible',
    getFilter: (id) => filters[id],
    setFilter: (id, f) => { filters[id] = f; },
    setStyle: () => {}, setProjection: () => {}, setZoom: () => {}, setLanguage: () => {},
    jumpTo: () => {}, flyTo: (o) => calls.push({ api: 'flyTo', o }), easeTo: () => {},
    fitBounds: (b) => calls.push({ api: 'fitBounds', b }),
    project: (c) => ({ x: (c[0] + 180) * 4, y: (90 - c[1]) * 4 }),
    unproject: (p) => ({ lng: p[0] / 4 - 180, lat: 90 - p[1] / 4 }),
    loaded: () => true, isMoving: () => false, areTilesLoaded: () => true,
    triggerRepaint: () => {}, resize: () => {},
    hasImage: () => false, addImage: () => {}, removeImage: () => {},
    queryRenderedFeatures: () => [],
    dragPan: { enable: () => {}, disable: () => {} },
    doubleClickZoom: { enable: () => {}, disable: () => {} },
  };

  window.mapboxgl = {
    accessToken: 'pk.test', maxParallelImageRequests: 16,
    Marker: class {
      setLngLat() { return this; } addTo() { return this; } on() {} remove() {}
      getElement() { return window.document.createElement('div'); }
      getLngLat() { return { lng: 0, lat: 0 }; }
    },
  };
  window.MediaRecorder = { isTypeSupported: () => true };
  window.console.warn = (...a) => warns.push(a.join(' '));

  const borderData = loadBorder ? JSON.parse(read('recorder/js/data/korea-border.json')) : null;
  /* 실제 파일은 10MB 라 테스트에서 읽지 않는다. 레이어 순서만 보면 되므로 최소 도형이면 충분하다. */
  const countryData = loadCountries ? { type: 'FeatureCollection', features: [
    { type: 'Feature', properties: { iso_3166_1_alpha_3: 'KOR', name: '경기도' },
      geometry: { type: 'Polygon', coordinates: [[[126,37],[128,37],[128,38],[126,38],[126,37]]] } },
  ] } : null;
  window.fetch = (url, opt) => {
    const u = String(url);
    if (u.includes('korea-countries')) {
      return countryData ? Promise.resolve({ ok: true, json: async () => countryData })
                         : Promise.reject(new Error('offline'));
    }
    if (u.includes('korea-border')) {
      return borderData ? Promise.resolve({ ok: true, json: async () => borderData })
                        : Promise.reject(new Error('offline'));
    }
    if (u.includes('places.googleapis.com')) {
      calls.push({ api: 'google', mask: opt.headers['X-Goog-FieldMask'], body: JSON.parse(opt.body) });
      return Promise.resolve({ ok: true, json: async () => googleReply });
    }
    if (u.includes('api.mapbox.com')) {
      calls.push({ api: 'mapbox', url: u });
      return Promise.resolve({ ok: true, json: async () => mapboxReply });
    }
    return Promise.reject(new Error('offline'));
  };

  // VWorld 는 JSONP 라 script 삽입을 가로채 콜백을 직접 부른다
  const realAppend = window.document.head.appendChild.bind(window.document.head);
  window.document.head.appendChild = (el) => {
    if (el.tagName === 'SCRIPT' && String(el.src).includes('api.vworld.kr')) {
      const cb = /callback=([^&]+)/.exec(el.src)[1];
      calls.push({ api: 'vworld', type: /[?&]type=([^&]+)/.exec(el.src)[1] });
      setTimeout(() => window[cb]?.(vworldReply), 0);
      return el;
    }
    return realAppend(el);
  };

  const context = vm.createContext(window);
  const run = (code, name) => vm.runInContext(code, context, { filename: name });
  run(read('recorder/js/config.js'), 'config.js');
  run(`SEARCH_KEYS.vworld = ${JSON.stringify(vworldKey)}; SEARCH_KEYS.google = ${JSON.stringify(googleKey)};`, 'keys');
  run(read('recorder/js/data/regions.js'), 'regions.js');
  run(read('recorder/js/recorder.js'), 'recorder.js');
  window.map = map;
  run('initRecorder(window.map)', 'boot');

  const doc = window.document;
  return {
    window, doc, map, calls, warns, paint, layout, layers, sources, filters, run,
    $: (id) => doc.getElementById(id),
    click: (id) => doc.getElementById(id).dispatchEvent(new window.Event('click', { bubbles: true })),
    type: (id, v) => { const i = doc.getElementById(id); i.value = v; i.dispatchEvent(new window.Event('change', { bubbles: true })); },
    chips: (mode) => [...doc.querySelectorAll(`#${mode}-colored-list .chip .nm`)].map((e) => e.textContent),
    styleLoad: () => map.fire('style.load'),
    tick: (ms = 30) => new Promise((r) => setTimeout(r, ms)),
  };
}
