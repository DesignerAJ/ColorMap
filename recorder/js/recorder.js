/* ============================================================
   카메라 경로 녹화 모듈 (window.map 사용 — ColorMap에도 그대로 이식 가능)
   ============================================================ */
function initRecorder(map) {
  let startCam = null, endCam = null, busy = false;

  const grabCam = () => ({ center: map.getCenter().toArray(), zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch() });
  const easeInOut = (t) => t < 0.5 ? 2*t*t : 1 - Math.pow(-2*t+2, 2)/2;   // 선 자라남 ease 공용
  const idle = () => new Promise((res) => map.once('idle', res));
  // innerHTML 로 목록을 그리는 곳이 많다. 지명·라벨을 끼워 넣기 전에 항상 이걸 거친다.
  const escAttr = (s) => String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

  /* ── 타일 완전 로딩 대기 ──
     idle 이벤트만으로는 부족하다. idle 은 "지금 화면에 그릴 게 없다"는 뜻이라
     아직 안 온 고해상도 타일 대신 부모(저해상도) 타일로 때우고 있어도 발생한다.
     areTilesLoaded() 까지 봐야 진짜로 그 화면의 타일이 다 도착한 상태다. */
  // areTilesLoaded() 는 스타일이 없는 동안 예외를 던진다 (스타일 교체 중 등). 그때는 "아직" 으로 본다.
  const allTilesIn = () => { try { return map.areTilesLoaded(); } catch (_) { return false; } };

  function tilesSettled(timeoutMs = 5000) {
    return new Promise((resolve) => {
      let done = false;
      const finish = () => { if (done) return; done = true; clearTimeout(timer); resolve(); };
      const timer = setTimeout(finish, timeoutMs);   // 응답 없는 타일에 무한정 매달리지 않도록 상한
      const check = () => {
        if (done) return;
        if (map.loaded() && allTilesIn() && !map.isMoving()) finish();
        else map.once('idle', check);
      };
      check();
    });
  }

  /* ── 카메라 이동 옵션 (flyTo / easeTo 공통) ──
     flyTo 는 출발·도착 줌이 같아도 중간에 반드시 줌아웃한다. 거리를 화면에 담았다가
     다시 들어오는 곡선(van Wijk)이 원래 그렇게 생겼고, 거리가 멀수록 더 내려간다.
     줌이 낮아지면 스타일의 zoom 조건 때문에 도로·라벨·디테일 레이어가 빠지므로
     "이동 중에만 지도가 단순해지는" 현상이 생긴다. 타일 로딩과는 무관하다.

     '없음'은 curve 로 평탄화한다. minZoom 을 두 끝점 줌으로 줘도 곡선 공식상 0.5 단계쯤
     남는데(실측: 서울→파리 양 끝 줌 10 에서 9.5), 스타일의 레이어 조건이 정수 줌에
     걸려 있으면 그 0.5 만으로도 도로·지명이 사라질 수 있다. curve 0.01 이면 정확히 10.00 이다.

     단계별 줌아웃도 curve 로 준다. 예전에는 minZoom 으로 "몇 단계 내려갈지"를 직접
     지정했다. 그건 정확히 먹었지만(1/2/3 → 1.16/2.04/3.01) **거리와 무관하게 고정**이라
     긴 이동에서 뒤집혔다 — 서울→파리는 기본 곡선이 6.85 단계나 내려가는데 '많이'가 3.01 이라,
     '자동'에서 '많이'로 바꾸면 줌아웃이 오히려 **줄었다**.
     curve 는 rho 를 키워 곡선 자체를 깊게 만들므로 거리에 비례하고, 1.42(기본)보다 크면
     언제나 '자동'보다 더 내려간다. 값은 재현 계산으로 골랐다(창 1600px 기준, 단위=줌 단계):

                     자동   조금(2.0)  보통(2.8)  많이(4.0)
       서울→부산  325km   0.38     0.94      1.75      2.73
       서울→도쿄 1160km   0.84     1.63      2.55      3.56
       서울→파리 8970km   6.85     7.84      8.81      9.84

     국내 이동에서 라벨의 뜻(1·2·3 단계)에 가깝게 떨어지도록 맞춘 값이다.
     (mapbox 는 minZoom 이 있으면 curve 를 무시하므로 둘을 같이 주면 안 된다) */
  const FLY_CURVES = { 1: 2.0, 2: 2.8, 3: 4.0 };       // '이동 중 줌아웃' 조금 / 보통 / 많이
  function moveOpts(to, mode, durSec) {
    const o = { ...to, duration: durSec*1000, essential: true };
    if (mode === 'fly') {
      const dip = $('fly-dip').value;
      if (dip === '0') o.curve = 0.01;                 // 사실상 직선 — 줌아웃 0
      else if (FLY_CURVES[dip]) o.curve = FLY_CURVES[dip];
      // 'auto' 는 아무것도 안 준다 — mapbox 기본 곡선(1.42)
    }
    return o;
  }

  /* ── 실제 카메라 경로 표본 뽑기 (리허설) ──
     flyTo 는 중간에 줌이 낮아지는 곡선 궤적이라 출발↔도착을 선형 보간해도
     실제로 지나가는 화면과 다르다 = 엉뚱한 타일을 미리 받게 된다.
     그래서 한 번 실제로 이동시켜 보고 지나간 카메라를 그대로 기록한다. */
  async function samplePath(from, to, mode, durSec, maxSamples = 10, follow = null, flight = null) {
    /* 경로를 따라가는 이동은 flyTo 를 흉내내 봐야 소용없다 — 실제로는 아크 위를 지나므로
       flyTo 의 궤적으로 데우면 **엉뚱한 타일**을 받는다. 그러면 이동 중에 아직 안 받은
       타일 대신 저해상도 부모 타일이 그려지고, 지도 디테일이 확확 바뀐다.
       그때는 실제로 쓸 카메라를 그대로 계산해서 뽑는다. */
    if (follow) {
      const out = [];
      for (let i = 1; i <= maxSamples; i++) out.push(interpCam(from, to, easeInOut(i / (maxSamples + 1)), flight, follow));
      return out;
    }
    map.jumpTo(from);
    const seen = [];
    const onMove = () => seen.push(grabCam());
    map.on('move', onMove);
    const o = moveOpts(to, mode, durSec);
    (mode === 'fly' ? map.flyTo(o) : map.easeTo(o));
    await new Promise((res) => { let d=false; const f=()=>{ if(!d){d=true;res();} }; map.once('moveend', f); setTimeout(f, durSec*1000+400); });
    map.off('move', onMove);
    if (!seen.length) return [];
    const out = [];                                   // 궤적을 균등 간격으로 추림 (양 끝은 이미 프리로드됨)
    for (let i = 1; i <= maxSamples; i++) {
      out.push(seen[Math.min(seen.length - 1, Math.floor(seen.length * i / (maxSamples + 1)))]);
    }
    return out;
  }

  /* 표본이 성기면 그 사이 줌에서 아직 안 받은 타일이 나온다 — 이동 중에만 지도가 거칠어
     보이는 원인이다. 비행 곡선은 줌이 크게 오르내리므로 넉넉히 뽑는다. */
  async function prewarmPath(cams, mode, durSec, legs = null) {
    for (let i = 0; i < cams.length - 1; i++) {
      setStatus(`이동 경로 타일 프리로드 중… (구간 ${i+1}/${cams.length-1})`, 'busy');
      const lg = legs && legs[i];
      const pts = await samplePath(cams[i], cams[i+1], mode, durSec, 18, lg && lg.follow, lg && lg.path);
      await warmCams(pts, `이동 경로 타일 ${i+1}/${cams.length-1} ·`);
    }
  }

  /* 지명 참고용 스타일에서만 라벨을 한국어로 바꾼다.
     setLanguage 는 지도 전체에 걸리고 스타일을 바꿔도 유지되므로, 참고용이 아닌
     방송용 스타일로 돌아올 때는 반드시 null 로 되돌려 원본 디자인을 지켜야 한다.
     스타일 로드가 끝난 뒤 걸어야 라벨 레이어에 제대로 반영된다. */
  function applyStyleLanguage() {
    try { map.setLanguage(KO_LABEL_STYLES.has($('style-select').value) ? 'ko' : null); } catch (_) {}
  }
  map.on('style.load', applyStyleLanguage);

  /* 투영은 스타일에도 저장돼 있고, setStyle 은 그 값을 그대로 따라간다.
     '모노톤'만 globe 로 저장돼 있어서, 그 스타일로 바꾸면 지도는 3D 로 튀는데
     투영 드롭다운은 2D 인 채로 남아 둘이 어긋났다. 스타일이 바뀔 때마다 드롭다운
     값을 다시 걸어 화면과 UI 를 맞춘다 — 앞으로 추가할 스타일이 어떻게 저장돼
     있든 안전하다. 사용자가 고른 투영이 늘 이긴다. */
  function applyStyleProjection() {
    try { map.setProjection($('proj-select').value); } catch (_) {}
  }
  map.on('style.load', applyStyleProjection);

  /* 색칠 소스·레이어를 지금 붙여도 되는지 추적한다.
     map.isStyleLoaded() 로 판단하면 안 된다 — 그건 '스타일 + 모든 소스의 타일'이 다 와야
     true 라서 지도를 쓰는 동안에는 사실상 늘 false 다. style.load 안에서 그걸로 판단하면
     매번 styledata 대기로 빠지는데 styledata 는 그 뒤로 다시 안 올 수 있어서, 스타일을
     바꾸면 행정구역·시군구 색칠이 영영 돌아오지 않았다.
     (국가·시도 레이어는 이 검사가 없어서 멀쩡했다 — 증상이 둘로 갈렸던 이유) */
  let styleReady = false;
  map.on('style.load', () => { styleReady = true; });

  $('style-select').addEventListener('change', (e) => {
    styleReady = false;                     // 교체 시작 — style.load 가 올 때까지는 레이어를 못 붙인다
    map.setStyle(STYLES[e.target.value]);
    applyStyleColors();
  });
  $('proj-select').addEventListener('change', (e) => map.setProjection(e.target.value));

  // 줌 슬라이더 (미세 조절) — 지도↔슬라이더 양방향 동기화
  const zoomSlider = $('zoom-slider'), zoomVal = $('zoom-val');
  const syncZoomUI = () => { const z = map.getZoom(); zoomSlider.value = z; zoomVal.textContent = z.toFixed(2); };
  zoomSlider.addEventListener('input', () => map.setZoom(parseFloat(zoomSlider.value)));
  const nudgeZoom = (delta) => map.setZoom(Math.min(22, Math.max(0, map.getZoom() + delta)));
  $('zoom-out').addEventListener('click', () => nudgeZoom(-0.5));
  $('zoom-in').addEventListener('click', () => nudgeZoom(0.5));
  map.on('zoom', syncZoomUI);
  syncZoomUI();

  // 숫자 입력 −/＋ 스텝 버튼
  function stepField(id, dir) {
    const el = $(id); if (!el || el.disabled) return;
    const step = parseFloat(el.step) || 1;
    const min = el.min !== '' ? parseFloat(el.min) : -Infinity;
    const max = el.max !== '' ? parseFloat(el.max) : Infinity;
    let v = (parseFloat(el.value) || 0) + dir * step;
    v = Math.min(max, Math.max(min, v));
    const dec = (String(step).split('.')[1] || '').length;
    el.value = dec ? v.toFixed(dec) : String(v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }
  $('controls').addEventListener('click', (e) => {
    const b = e.target.closest('.step'); if (!b) return;
    stepField(b.dataset.t, parseInt(b.dataset.d, 10));
  });

  /* ── 색상 팝업 (색과 투명도를 한 창에서) ──
     <input type="color"> 를 누르면 macOS 색상 창이 뜨는데 그건 OS 가 그리는 창이라
     투명도 같은 항목을 넣을 수 없다. 그래서 동그라미는 버튼으로 두고 팔레트·직접선택·
     투명도를 담은 팝업을 직접 띄운다. 투명도는 구역마다 따로 가지므로 fill-opacity 도
     fill-color 와 마찬가지로 데이터 기반 표현식으로 넘긴다. */
  const PALETTE = ['#7FAEF5', '#5A8EDB', '#2F62AF', '#1F4E95', '#F17D38', '#22CC92'];
  const DEFAULT_OPACITY = 0.6;
  const pct = (o) => Math.round(o * 100) + '%';

  const colorPopup = document.createElement('div');
  colorPopup.id = 'color-popup';
  colorPopup.hidden = true;
  colorPopup.innerHTML =
    `<div class="cp-swatches">${PALETTE.map(c =>
        `<button type="button" class="cp-sw" data-c="${c}" style="background:${c}" aria-label="${c}"></button>`).join('')}</div>
     <label class="cp-row"><span>직접 선택</span><input type="color" class="cp-color" /></label>
     <label class="cp-row"><span>투명도</span><input type="range" class="cp-opacity" min="0" max="1" step="0.05" /><b class="cp-val"></b></label>`;
  document.body.appendChild(colorPopup);

  const cpColor = colorPopup.querySelector('.cp-color');
  const cpOpacity = colorPopup.querySelector('.cp-opacity');
  const cpVal = colorPopup.querySelector('.cp-val');
  let cpTarget = null;   // { get() -> {color,opacity}, set(color, opacity) }

  const closeColorPopup = () => { colorPopup.hidden = true; cpTarget = null; };
  const markSwatch = (color) => colorPopup.querySelectorAll('.cp-sw')
    .forEach(b => b.classList.toggle('on', b.dataset.c.toLowerCase() === String(color).toLowerCase()));

  function openColorPopup(anchor, target) {
    cpTarget = target;
    const { color, opacity } = target.get();
    cpColor.value = color;
    cpOpacity.value = opacity;
    cpVal.textContent = pct(opacity);
    markSwatch(color);
    colorPopup.hidden = false;
    // 패널이 화면 끝에 붙어 있어도 잘리지 않게 앵커 기준으로 자리를 잡는다
    const r = anchor.getBoundingClientRect();
    const w = colorPopup.offsetWidth, h = colorPopup.offsetHeight;
    let top = r.bottom + 6;
    if (top + h > window.innerHeight) top = Math.max(8, r.top - h - 6);
    colorPopup.style.left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8)) + 'px';
    colorPopup.style.top = top + 'px';
  }
  const cpApply = (color, opacity) => { if (cpTarget) cpTarget.set(color, opacity); };

  colorPopup.addEventListener('click', (e) => {
    const sw = e.target.closest('.cp-sw'); if (!sw) return;
    cpColor.value = sw.dataset.c;
    markSwatch(sw.dataset.c);
    cpApply(sw.dataset.c, parseFloat(cpOpacity.value));
  });
  cpColor.addEventListener('input', () => { markSwatch(cpColor.value); cpApply(cpColor.value, parseFloat(cpOpacity.value)); });
  cpOpacity.addEventListener('input', () => {
    cpVal.textContent = pct(parseFloat(cpOpacity.value));
    cpApply(cpColor.value, parseFloat(cpOpacity.value));
  });
  document.addEventListener('click', (e) => {
    if (colorPopup.hidden || colorPopup.contains(e.target) || e.target.closest('.color-dot')) return;
    closeColorPopup();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeColorPopup(); });

  // 동그라미에 색과 투명도를 함께 보여준다 (체크무늬 위에 반투명 색을 얹는다)
  const paintDot = (dot, color, opacity) => {
    dot.style.setProperty('--c', color);
    dot.style.setProperty('--o', opacity);
  };
  const dotHTML = (color, opacity) =>
    `<button type="button" class="color-dot sw" title="색상·투명도" style="--c:${color}; --o:${opacity}"></button>`;

  /* 검색창 옆 동그라미 = '다음에 칠할 색'. 값은 숨겨둔 <input type="color"> 에 그대로 두어
     기존 코드가 읽던 경로를 바꾸지 않고, 투명도만 data-opacity 로 함께 들고 있는다. */
  function wireNextDot(kind) {
    const dot = $(`${kind}-dot`), input = $(`${kind}-color`);
    if (!dot || !input) return () => {};
    if (!input.dataset.opacity) input.dataset.opacity = DEFAULT_OPACITY;
    const sync = () => paintDot(dot, input.value, parseFloat(input.dataset.opacity));
    sync();
    dot.addEventListener('click', () => openColorPopup(dot, {
      get: () => ({ color: input.value, opacity: parseFloat(input.dataset.opacity) }),
      set: (c, o) => { input.value = c; input.dataset.opacity = o; sync(); },
    }));
    return sync;
  }
  const nextOpacity = (kind) => parseFloat($(`${kind}-color`).dataset.opacity || DEFAULT_OPACITY);

  /* 칩의 동그라미 = 이미 칠한 구역의 색·투명도.
     슬라이더를 끄는 동안 목록을 다시 그리면 누르고 있던 버튼이 사라져 조작이 끊긴다.
     그래서 여기서는 다시 그리지 않고 동그라미 모양만 그 자리에서 갱신한다. */
  function wireChipDot(chip, entry, apply) {
    const dot = chip.querySelector('.color-dot');
    dot.addEventListener('click', () => openColorPopup(dot, {
      get: () => ({ color: entry.color, opacity: entry.opacity }),
      set: (c, o) => { entry.color = c; entry.opacity = o; paintDot(dot, c, o); apply(); },
    }));
  }

  /* ── 구역 색칠 (국가 · 해외 행정구역 · 시도 · 시군구) ──
     네 모드가 하는 일은 같다. 경계 소스에서 키 속성을 읽어 match 표현식으로
     구역마다 색·투명도를 칠하고, 칠한 목록을 칩으로 보여준다.
     예전에는 이 네 벌을 따로 두었는데, 그래서 뭘 고치거나 늘릴 때마다 한 군데씩
     빠뜨려 버그가 났다 (구역별 투명도, 스타일 교체 후 복구가 그렇게 새어 나갔다).
     지금은 다른 부분 — 경계 소스 · 키 이름 · 검색 방식 · 칩에 쓸 이름 — 만
     설정으로 받고, 나머지 로직은 createRegionPainter 한 곳에만 있다. */

  const DEFAULT_COLORS = ['#5A8EDB', '#F17D38'];   // 1번/2번 기본색 (이후 순환)
  const SIDO_SUFFIX = /(특별자치도|특별자치시|특별시|광역시|직할시|도)$/;
  const stripSido = (n) => n.replace(SIDO_SUFFIX, '');
  /* 도 이름의 두 글자 약칭: 충청북도 → 충북, 함경남도 → 함남, 황해북도 → 황북.
     접미사를 뗀 세 글자에서 첫 글자와 셋째 글자를 딴다 — 남북 도 이름이 모두 이 규칙을 따른다.
     ('직할시' 를 SIDO_SUFFIX 에 넣은 것도 북한 평양 때문이다. 남한에는 없는 접미사다.)
     '도' 로 끝나는 외국 이름이 141개(홋카이도·코모도·비엔티안 도…) 있어서 아무 데나 쓰면
     '홋이' 같은 말이 나온다. 남북 것에만 쓸 것 — tuneKoreanAdmin1 이 그 경계를 지킨다. */
  const sidoAbbr = (n) => { const b = stripSido(n); return b.length === 3 ? b[0] + b[2] : b; };
  const cleanName = (n) => n.replace(/#[^#]*#/g, '').trim();
  const SUGGEST_MAX = 12;                          // datalist 후보 최대 개수

  /* 한글 입력 중(조합 중)의 Enter 는 글자를 확정하는 키다. 이때 추가 처리를 하면 안 된다.
     처리해버리면 입력창을 비운 직후 IME 가 조합 중이던 마지막 글자('도봉구' 의 '구')를
     빈 칸에 써넣고, 그 값으로 change 가 한 번 더 돌아 엉뚱한 지역이 함께 칠해졌다.
     ('구' 는 정식명 부분일치로 목록 첫 항목인 종로구를 집어냈다) */
  const isComposingEnter = (e) => e.isComposing || e.keyCode === 229;

  const fetchGeo = (url) => fetch(url).then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); });

  /* 정식명 → { n 정식명, s 약칭, q 구분어(국가·시도), c 중심, z 줌 }.
     약칭이 겹치는 것(중구·동구, 여러 나라의 '북부')은 dup 로 표시해 후보 목록에는
     정식명으로 올린다 — 그래야 서로 구분되어 고를 수 있다. */
  function buildMeta(geo, qualProp, defZoom) {
    const meta = {};
    (geo.features || []).forEach((f) => {
      const p = f.properties || {};
      if (!p.name) return;
      meta[p.name] = { n: p.name, s: p.short || p.name, q: p[qualProp] || '', c: p.c, z: p.z || defZoom };
    });
    const seen = {};
    Object.values(meta).forEach(s => { seen[s.s] = (seen[s.s] || 0) + 1; });
    Object.values(meta).forEach(s => { s.dup = seen[s.s] > 1; });
    return meta;
  }

  /* 입력 → 정식명. 폴백은 후보가 하나로 좁혀질 때만 받아들인다.
     예전에는 첫 일치를 그대로 썼는데, '구'·'시' 처럼 여러 곳에 걸리는 조각이 들어오면
     목록 맨 앞(종로구)이 조용히 잡혔다. 애매하면 아무것도 고르지 않는 편이 낫다.
     한 글자는 아예 보지 않는다 — 약칭은 모두 두 글자 이상이라 한 글자 입력은
     검색어가 아니라 조합 중 흘러든 조각으로 보는 게 맞다 ('시' → 시흥시 방지).
     alias 는 시도의 '경기도 → 경기' 처럼 정식명에서 접미사를 뗀 별칭이다. */
  function resolveByMeta(meta, q, alias) {
    q = String(q).trim(); if (!q) return null;
    if (meta[q]) return q;
    const all = Object.values(meta);
    const alt = alias ? ((s) => alias(s) || '') : (() => '');
    const exact = all.find((s) => s.s === q || alt(s) === q);
    if (exact) return exact.n;
    if (q.length < 2) return null;
    const only = (l) => (l.length === 1 ? l[0].n : null);
    return only(all.filter((s) => s.s.startsWith(q) || alt(s).startsWith(q)))
        || only(all.filter((s) => s.s.includes(q)))
        || only(all.filter((s) => s.n.includes(q)));
  }

  /* 후보 순위: 약칭 앞글자 → 약칭 부분 → 정식명 부분.
     정식명에는 국가·시도가 붙어 있어서('강원특별자치도 춘천시') 같이 취급하면
     '강' 을 쳤을 때 강원도 시·군이 강남구보다 앞에 끼어든다. 이름 자체가 맞는 것을 먼저. */
  function suggestByMeta(meta, q, alias) {
    const alt = alias ? ((s) => alias(s) || '') : (() => '');
    const byName = [], byPart = [], byFull = [];
    for (const s of Object.values(meta)) {
      if (s.s.startsWith(q) || (alt(s) && alt(s).startsWith(q))) byName.push(s);
      else if (s.s.includes(q)) byPart.push(s);
      else if (s.n.includes(q)) byFull.push(s);
    }
    return byName.concat(byPart, byFull);
  }

  /* 시군구(229개, 11MB)·해외 행정구역(4,589개, 29MB)은 경계 파일이 크다.
     앱 첫 로딩을 무겁게 하지 않도록 해당 탭을 처음 열 때만 받아온다.
     실패하면 false 를 돌려주고, 다음 탭 진입 때 다시 시도한다. */
  function lazyGeoLoad(url, hint, install) {
    return (setText) => {
      setText('경계 데이터를 불러오는 중…');
      return fetchGeo(url)
        .then((geo) => { install(geo); setText(''); return true; })
        .catch((e) => {
          setText(e.message === '404'
            ? `경계 데이터 파일이 없습니다 (${hint}). README 의 준비 절차를 참고하세요.`
            : '경계 데이터를 불러오지 못했습니다: ' + e.message);
          return false;
        });
    };
  }

  function createRegionPainter(cfg) {
    const entries = [];                              // [{ key, color, opacity }]
    const el = (suffix) => $(`${cfg.id}-${suffix}`);
    const input = el('input');
    const syncNextDot = wireNextDot(cfg.id);
    const setText = (msg) => { const s = el('status'); if (s) s.textContent = msg || ''; };
    let loading = null, loaded = !cfg.load;

    // 다음에 칠할 기본색 — 칠한 개수만큼 번갈아 (국가만 사용. 나머지는 마지막에 고른 색 유지)
    function syncDefaultColor() {
      if (!cfg.cycleDefaultColor) return;
      el('color').value = DEFAULT_COLORS[entries.length % DEFAULT_COLORS.length];
      syncNextDot();
    }

    // 색과 투명도를 구역마다 따로 준다 — 둘 다 같은 키로 match 한다
    function applyColors() {
      /* 남·북한은 우리 폴리곤 레이어에도 같은 색을 먹여야 한다. 색칠이 **비었을 때도**
         불러야 한다 — 예전에는 아래 빈 목록 분기에서 곧장 return 해 버려서, 전체 삭제나
         탭 전환으로 목록이 비어도 우리 레이어에는 직전 색이 그대로 남아 있었다. */
      if (cfg.id === 'country') queueMicrotask(syncKoreaCountries);
      if (!map.getLayer(cfg.layer)) return;
      /* 남·북한은 우리 레이어가 그린다. Mapbox 레이어에서도 빼야 두 번 칠해지지 않는데,
         필터로만 막으면 스타일을 갈아끼울 때 필터가 원래대로 돌아가는 순간이 있다.
         색 자체를 안 주면 그 틈에도 안 칠해진다 — 필터는 그대로 두고 이중으로 막는다. */
      const list = (cfg.id === 'country' && KC_GEO) ? entries.filter(e => !KC_KEYS.includes(e.key)) : entries;
      if (!list.length) { map.setPaintProperty(cfg.layer, 'fill-color', 'rgba(0,0,0,0)'); return; }
      const col = ['match', ['get', cfg.prop]], op = ['match', ['get', cfg.prop]];
      list.forEach(e => { col.push(e.key, e.color); op.push(e.key, e.opacity); });
      col.push('rgba(0,0,0,0)'); op.push(0);
      map.setPaintProperty(cfg.layer, 'fill-color', col);
      map.setPaintProperty(cfg.layer, 'fill-opacity', op);
    }

    /* 소스·레이어는 스타일을 바꿀 때마다 다시 깔아야 한다.
       붙여도 되는 시점인지는 styleReady 로 판단한다 (isStyleLoaded() 를 쓰면 안 되는
       이유는 위쪽 주석 참고). 지연 로드 모드는 데이터가 오기 전이면 그냥 건너뛰고,
       데이터가 도착하면 load() 가 다시 부른다. */
    function addLayer() {
      if (!styleReady || map.getLayer(cfg.layer)) return;
      const spec = cfg.sourceSpec();
      if (!spec) return;
      if (!map.getSource(cfg.source)) map.addSource(cfg.source, spec);
      const def = {
        id: cfg.layer, type: 'fill', source: cfg.source,
        paint: { 'fill-color': 'rgba(0,0,0,0)', 'fill-opacity': DEFAULT_OPACITY },
      };
      if (cfg.sourceLayer) def['source-layer'] = cfg.sourceLayer;
      if (cfg.filter) def.filter = cfg.filter;
      // 라벨(symbol) 아래에 삽입 → 글씨는 색칠 위로
      map.addLayer(def, (map.getStyle().layers || []).find(l => l.type === 'symbol')?.id);
      applyColors();
      raiseBoundaries();                             // 경계선을 이 색칠 위로
    }

    /* 칩 이름은 짧은 이름을 쓴다. 지금 칠한 것들 중에 같은 짧은 이름이 여럿일 때만
       구분어(국가·시도)를 앞에 붙인다 — '중구' 6곳, 여러 나라의 '북부' 같은 경우.
       슬라이더를 끄는 동안 목록을 다시 그리면 조작이 끊기므로, 색 변경은 여기서
       다시 그리지 않고 wireChipDot 이 동그라미만 그 자리에서 갱신한다. */
    function renderChips() {
      const box = el('colored-list');
      el('list-wrap').style.display = entries.length ? 'block' : 'none';
      box.innerHTML = '';
      const seen = {};
      entries.forEach(e => { const s = cfg.label(e.key); seen[s] = (seen[s] || 0) + 1; });
      entries.forEach((entry, i) => {
        const short = cfg.label(entry.key);
        const qual = (seen[short] > 1 && cfg.qualifier) ? cfg.qualifier(entry.key) : '';
        const chip = document.createElement('div');
        chip.className = 'chip';
        chip.innerHTML = `${dotHTML(entry.color, entry.opacity)}` +
          `<span class="nm" title="${escAttr(cfg.fullName(entry.key))}">${escAttr(qual ? `${qual} ${short}` : short)}</span>` +
          `<span class="x" title="제거">✕</span>`;
        wireChipDot(chip, entry, applyColors);
        chip.querySelector('.x').addEventListener('click', () => {
          entries.splice(i, 1); applyColors(); renderChips(); syncDefaultColor();
        });
        box.appendChild(chip);
      });
    }

    function addFromInput() {
      const key = cfg.resolve(input.value);
      if (!key) return;
      const color = el('color').value, opacity = nextOpacity(cfg.id);
      const existing = entries.find(e => e.key === key);
      if (existing) { existing.color = color; existing.opacity = opacity; }   // 이미 있으면 색만 갱신
      else { entries.push({ key, color, opacity }); syncDefaultColor(); }     // 새로 추가하면 다음 기본색으로
      /* 지오메트리가 아직 없는 나라면 지금 받는다. 칩과 색은 곧바로 반영되고,
         도착하면 setData 가 색칠을 채운다 — 기다리게 하지 않는다. */
      if (cfg.ensure) cfg.ensure(key);
      applyColors(); renderChips();
      const t = cfg.target(key);                                              // 추가한 곳으로 이동
      if (t && t.center) map.flyTo({ center: t.center, zoom: t.zoom, duration: 1200, essential: true });
      input.value = '';
      if (cfg.suggest) el('list').innerHTML = '';    // 입력창을 비웠으니 후보도 같이 치운다
    }

    /* 입력한 글자에 맞는 후보만 datalist 에 채운다. 미리 다 넣어두면 입력창을
       누르는 것만으로 수백 개가 통째로 펼쳐져 쓸모가 없다. */
    function refreshSuggestions() {
      const dl = el('list');
      dl.innerHTML = '';
      const q = input.value.trim();
      if (!q) return;
      cfg.suggest(q).slice(0, SUGGEST_MAX).forEach((s) => {
        const opt = document.createElement('option');
        opt.value = s.dup ? s.n : s.s;               // 동명이면 정식명으로 올려 서로 구분
        if (s.dup) opt.label = s.n;
        dl.appendChild(opt);
      });
    }

    function load() {
      if (!cfg.load || loaded) return Promise.resolve(true);
      if (loading) return loading;
      loading = Promise.resolve(cfg.load(setText)).then((ok) => {
        if (ok === false) { loading = null; return false; }   // 다음 탭 진입 때 재시도
        loaded = true;
        // datalist 는 비워둔 채로 시작한다 (입력에 따라 refreshSuggestions 가 채운다)
        if (cfg.lazyInput) { el('list').innerHTML = ''; input.disabled = false; }
        addLayer(); applyColors();
        return true;
      });
      return loading;
    }

    function reset() { entries.length = 0; applyColors(); renderChips(); syncDefaultColor(); }

    input.addEventListener('change', addFromInput);   // 목록에서 선택(클릭) 시 바로 추가
    /* Enter 는 브라우저 기본 동작이 끝난 '다음'에 처리한다.
       후보 목록에서 방향키로 항목을 고르면 그 값이 입력창에 실제로 들어가는 건
       Enter 의 기본 동작이 끝난 뒤다. 예전처럼 keydown 시점에 값을 읽으면 아직
       타이핑하던 글자('일')만 보여서, 목록에서 '일본' 을 골라 Enter 를 눌러도
       resolve 가 실패하고 아무 일도 일어나지 않았다.
       preventDefault 도 하면 안 된다 — 그걸 막으면 목록 선택 자체가 취소된다.
       (폼이 없으므로 Enter 로 제출될 걱정은 없다)
       목록 선택이 값에 반영되면 change 가 먼저 돌아 이미 추가되는데, 그 경우
       입력창이 비워진 뒤라 아래 호출은 빈 값으로 그냥 빠져나간다. */
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || isComposingEnter(e)) return;   // 조합 중 Enter 는 글자 확정용
      setTimeout(addFromInput, 0);
    });
    el('clear').addEventListener('click', reset);
    if (cfg.suggest) input.addEventListener('input', refreshSuggestions);
    syncDefaultColor();

    return {
      id: cfg.id, layer: cfg.layer, prop: cfg.prop, label: cfg.label,
      entries: () => entries, addLayer, applyColors, reset, load,
      ready: () => !cfg.lazyInput || loaded,          // 입력창을 열어도 되는지 (setUI 가 물어본다)
    };
  }

  /* ── 국가 ── */
  const isoToCountry = {}, nameToIso = {};
  COUNTRIES.forEach(c => { isoToCountry[c.i] = c; });
  (function fillCountryList() {                       // 검색 데이터리스트 채우기 (표시이름 → ISO 매핑)
    const dl = $('country-list');
    COUNTRIES.forEach(c => {
      const nm = cleanName(c.n);
      nameToIso[nm] = c.i;
      const opt = document.createElement('option');
      opt.value = nm;
      dl.appendChild(opt);
    });
  })();

  /* ── 대한민국 시도 ──
     시도 경계는 두 벌을 쓴다.
     regions.js 의 SIDO_GEO 는 17개를 통틀어 19,286점뿐이고 편차가 극심하다
     (서울 67점 · 광주 48점 ↔ 전남 8,871점). 광역시를 확대하면 다각형이 그대로 드러난다.
     그래서 시군구를 시도 단위로 합친 고해상도본(384,303점)을 따로 두고, 시도 탭을 열 때
     받아서 소스만 갈아끼운다. 받기 전에도 색칠은 그대로 되고 도착하면 형태만 정교해진다.
     만드는 법: node recorder/tools/build-sido-hires.mjs */
  /* 데이터 파일에도 ?v= 를 붙인다. index.html 의 값을 그대로 따온다 —
     JSON 에는 캐시 버스터가 없어서, 데이터를 다시 만들어도 브라우저가 옛 파일을 계속
     쓰는지 아닌지 확인할 길이 없었다. 서버가 no-store 를 주면 상관없지만
     GitHub Pages 는 캐시를 준다. */
  const DATA_V = (([...document.scripts].map(s => s.src || '').join(' ')
    .match(/recorder\.js\?v=([\d.]+)/) || [])[1]) || '';
  /* ── GeoJSON 단순화 세기 ──

     한동안 우리 GeoJSON 소스는 전부 tolerance: 0 이었다. mapbox-gl 이 타일을 구우면서
     한 번 더 단순화하는 게 싫어서였다 — 촘촘하게 만든 데이터가 화면에서 각져 보였다.
     그런데 0 은 단순화를 **끄는** 값이고, 끄면 다른 게 깨진다.

     타일 좌표는 마지막에 정수로 반올림된다(extent 8192). 단순화를 안 하면 그 격자보다
     촘촘한 점들이 전부 살아남아 같은 칸으로 내려앉고, 링이 스스로를 훑는 모양이 된다.
     지오메트리 자체는 멀쩡한데 삼각분할만 튄다 — 함경남도에서 화면 밖으로 길게 뻗던
     다각형이 이것이었다. 데이터 검사(핀치·자기교차·감김…)에 아무것도 안 걸리고,
     **SVG 로 뽑으면 멀쩡한데**(SVG 는 지오메트리를 직접 그린다) 화면·MP4·PSD 에서만
     보이던 이유다. 셋 다 캔버스를 굽기 때문이다.

     단위는 **CSS 픽셀**이다. mapbox-gl 이 tolerance × (extent / tileSize) = ×16 을 해서
     타일 단위로 바꾸고, 그 값을 그대로 단순화 문턱으로 쓴다(더글러스-포이커).
       · 반올림 격자 1칸  = 1 타일단위 = 0.0625 px
       · mapbox 기본 0.375 px = 6 타일단위
     그래서 격자보다 크기만 하면 뭉침이 안 생긴다. 0.125 px(2 타일단위)로 둔다 —
     기본값보다 3배 촘촘하면서 격자의 2배라 안전하다. 1/8 픽셀은 눈에 보이지 않는다.

     **선과 색칠에 같은 값을 써야 한다.** 다르게 단순화하면 둘이 어긋난다. */
  const GEO_TOLERANCE = 0.125;

  const dataURL = (u) => (DATA_V ? `${u}?v=${DATA_V}` : u);

  const SIDO_HIRES_URL = './recorder/js/data/sido-hires.json';
  let SIDO_HIRES = null;
  const sidoMeta = {};
  SIDO_META.forEach(s => { sidoMeta[s.n] = { n: s.n, s: s.s, c: s.c, z: s.z }; });
  /* 시도를 짧게 부를 때는 SIDO_META 의 약칭을 쓴다.
     접미사만 떼면(stripSido) '충청북도 → 충청북', '경상남도 → 경상남' 처럼 세 글자가 나와
     평소 쓰는 말과 다르다. 실제로 쓰는 두 글자(충북·경남)는 SIDO_META 에 이미 들어 있다.
     stripSido 는 검색어 별칭('충청북'으로 쳐도 찾히게)으로만 남긴다. */
  const sidoShort = (n) => (sidoMeta[n] && sidoMeta[n].s) || stripSido(n) || n;
  /* 약칭(충북)과 정식명(충청북도)을 둘 다 올린다. 해석은 예전부터 양쪽 다 됐지만
     목록에는 약칭만 있어서, '충청' 까지 친 사람에게는 아무것도 안 뜨고 다 친 뒤에야
     Enter 로 들어갔다. 행정구역 탭도 이제 양쪽으로 찾히므로 두 탭이 같게 동작한다. */
  (function fillSidoList() {
    const dl = $('sido-list');
    SIDO_META.forEach(s => {
      [s.s, s.n].forEach(v => { const opt = document.createElement('option'); opt.value = v; dl.appendChild(opt); });
    });
  })();

  /* ── 해외 행정구역(주·도) ──
     국가 색칠은 Mapbox 타일(country-boundaries-v1)이라 우리 데이터가 필요 없지만,
     그 아래 단위(미국 주·일본 도도부현 등)는 Mapbox 기본 타일에 없다.
     Natural Earth 4,589개를 파일로 두고 탭을 열 때만 받아온다. */
  const admin1Meta = {}, sigunguMeta = {};
  let ADMIN1_GEO = null, SIGUNGU_GEO = null;

  /* 이 탭에는 남북 시·도가 함께 들어 있다 (대한민국 17 + 북한 13). 그래서 두 가지를 손본다.

     1) 북한 강원도는 짧은 이름이 그냥 '강원도' 라, 우리 강원(강원특별자치도) 옆에 놓이면
        어느 쪽인지 알 수 없다. 보이는 이름에만 소속을 붙인다 — 데이터의 short 를 고치면
        정식명이 `북한 ${short}` 로 조립돼 있어서(build-nk-admin1.mjs) '북한 강원도(북한)'
        이 된다. 정식명은 그대로 두고 화면에 쓰는 이름만 바꾼다.

     2) 남북 도를 두 글자 약칭으로도 찾게 한다 (충북·경남·평남·황북). 정식명으로만 찾히던
        탓에 시도 탭에서는 되던 '충북' 이 이 탭에서는 아무것도 안 나왔다.
        약칭이 겹치는 강원(남 강원특별자치도 · 북 강원도)은 아예 빼둔다 — 둘 중 하나를
        조용히 집어내느니 후보 목록에서 직접 고르게 하는 편이 낫다. 이 파일이 '구' 한 글자로
        종로구를 칠하던 사고 이후 지켜온 규칙이다. */
  const ADMIN1_RENAME = { '북한 강원도': '강원도(북한)' };
  function tuneKoreanAdmin1(meta) {
    const ko = Object.values(meta).filter(m => m.q === '대한민국' || m.q === '북한');
    const n = {};
    ko.forEach(m => { m.a = sidoAbbr(m.s); n[m.a] = (n[m.a] || 0) + 1; });   // 약칭은 이름을 바꾸기 전에 딴다
    ko.forEach(m => { if (n[m.a] > 1) m.a = ''; });
    Object.entries(ADMIN1_RENAME).forEach(([full, s]) => { if (meta[full]) meta[full].s = s; });
    return meta;
  }

  /* ── 행정구역 데이터: 나라별 온디맨드 ──

     예전에는 전 세계 1급 행정구역이 admin1.json 한 파일(전송 10.7MB)에 들어 있었고,
     '행정구역' 탭을 처음 열 때 통째로 받았다. 한 번에 칠하는 건 보통 한두 나라인데
     235개국을 다 받고 기다린 것이다.

     이제 셋으로 나눠 받는다 (`build-admin1-split.mjs` 가 만든다):
       admin1-meta.json    전체 4,592 구역의 **속성만** (전송 0.11MB)
                           검색·자동완성·카메라 목표가 여기서 나온다. 지오메트리는 없다.
       admin1-core.json    자주 쓰는 8개국 (전송 7.2MB) — 고를 때 기다리지 않게 미리 받는다
       admin1/<ISO3>.json  나머지 227개국 (중앙값 14KB) — 그 나라를 고를 때 받는다
     첫 로드가 10.7MB → 7.3MB 로 줄고, 나머지는 고를 때 한 번씩 온다.

     **받은 건 버리지 않는다.** 227개국을 전부 받아도 합쳐 6.7MB 라, 지금까지 늘 받던
     10.7MB 보다 적다. LRU 로 쫓아낼 이유가 없다 — 쫓아내면 이미 칠한 구역이 사라지는
     문제를 따로 막아야 하는데, 그 복잡함을 살 이유가 없다. */
  const ADMIN1_DIR = './recorder/js/data/admin1/';
  let ADMIN1_INDEX = null;                          // 나라 이름 → 파일 코드 (코어 8개국은 없다)
  const admin1Have = new Set();                     // 이미 받은 나라
  const admin1Coming = new Map();                   // 받는 중인 나라 → Promise

  /* 이 구역을 그리려면 어느 나라 파일이 필요한가. 코어에 있거나 이미 받았으면 곧장 끝난다. */
  function ensureAdmin1(name) {
    const country = admin1Meta[name] && admin1Meta[name].q;
    const code = country && ADMIN1_INDEX && ADMIN1_INDEX[country];
    if (!code || admin1Have.has(country) || !ADMIN1_GEO) return Promise.resolve();
    if (admin1Coming.has(country)) return admin1Coming.get(country);
    const p = fetchGeo(dataURL(ADMIN1_DIR + code + '.json'))
      .then((geo) => {
        admin1Have.add(country);
        ADMIN1_GEO.features.push(...geo.features);
        // 소스가 이미 깔려 있으면 갈아끼운다. 아직이면 addLayer 가 ADMIN1_GEO 를 그대로 쓴다.
        try { map.getSource('admin1-boundaries')?.setData(ADMIN1_GEO); } catch (_) {}
      })
      .catch(() => {})                              // 못 받으면 색칠만 안 보인다 — 칩과 검색은 그대로 동작
      .finally(() => admin1Coming.delete(country));
    admin1Coming.set(country, p);
    return p;
  }

  /* 녹화·내보내기 전에 부른다. 받는 중인 나라가 있으면 기다린다 —
     칠하자마자 녹화를 누르면 그 나라 지오메트리가 아직 안 왔을 수 있다. */
  const admin1Settled = () => Promise.all([...admin1Coming.values()]);

  /* 메타 먼저, 코어는 그 다음. 메타만 오면 검색·목록이 곧바로 열린다. */
  function loadAdmin1(setText) {
    setText('행정구역 목록을 불러오는 중…');
    return fetchGeo(dataURL('./recorder/js/data/admin1-meta.json'))
      .then((meta) => {
        ADMIN1_INDEX = meta.index || {};
        Object.assign(admin1Meta, tuneKoreanAdmin1(buildMeta(meta, 'country', 6)));
        setText('경계 데이터를 불러오는 중…');
        return fetchGeo(dataURL('./recorder/js/data/admin1-core.json'));
      })
      .then((core) => { ADMIN1_GEO = core; setText(''); return true; })
      .catch((e) => {
        setText(e.message === '404'
          ? '경계 데이터 파일이 없습니다 (js/data/admin1-meta.json). node recorder/tools/build-admin1-split.mjs 로 만드세요.'
          : '경계 데이터를 불러오지 못했습니다: ' + e.message);
        return false;
      });
  }

  const PAINTERS = [
    createRegionPainter({
      id: 'country', source: 'country-boundaries', layer: 'country-color-fill', prop: 'iso_3166_1_alpha_3',
      sourceSpec: () => ({ type: 'vector', url: 'mapbox://mapbox.country-boundaries-v1' }),
      sourceLayer: 'country_boundaries',
      // worldview 필터: 분쟁 경계 중복 방지 (US 세계관 + 'all')
      filter: ['all',
        ['==', ['get', 'disputed'], 'false'],
        ['any', ['==', 'all', ['get', 'worldview']], ['in', 'US', ['get', 'worldview']]]],
      cycleDefaultColor: true,
      resolve:  (q) => nameToIso[String(q).trim()] || null,
      fullName: (iso) => cleanName(isoToCountry[iso].n),
      label:    (iso) => cleanName(isoToCountry[iso].n),
      target:   (iso) => ({ center: isoToCountry[iso].c, zoom: isoToCountry[iso].z }),
    }),
    createRegionPainter({
      id: 'admin1', source: 'admin1-boundaries', layer: 'admin1-color-fill', prop: 'name',
      sourceSpec: () => ADMIN1_GEO && { type: 'geojson', tolerance: GEO_TOLERANCE, data: ADMIN1_GEO },
      lazyInput: true,
      resolve:   (q) => resolveByMeta(admin1Meta, q, (s) => s.a),
      suggest:   (q) => suggestByMeta(admin1Meta, q, (s) => s.a),
      fullName:  (n) => n,
      label:     (n) => (admin1Meta[n] && admin1Meta[n].s) || n,
      qualifier: (n) => (admin1Meta[n] && admin1Meta[n].q) || '',
      target:    (n) => admin1Meta[n] && { center: admin1Meta[n].c, zoom: admin1Meta[n].z },
      ensure:    ensureAdmin1,                      // 그 나라 지오메트리를 그때 받는다
      load:      loadAdmin1,
    }),
    createRegionPainter({
      id: 'sido', source: 'sido-boundaries', layer: 'sido-color-fill', prop: 'name',
      sourceSpec: () => ({ type: 'geojson', tolerance: GEO_TOLERANCE, data: SIDO_HIRES || SIDO_GEO }),
      resolve:  (q) => resolveByMeta(sidoMeta, q, (s) => stripSido(s.n)),
      fullName: (n) => n,
      label:    sidoShort,
      target:   (n) => sidoMeta[n] && { center: sidoMeta[n].c, zoom: sidoMeta[n].z },
      // 색칠은 SIDO_GEO 로 이미 되는 상태라 '불러오는 중'이 아니라 '정밀해지는 중'이라고 알린다
      load: (setText) => {
        setText('경계를 정밀하게 불러오는 중…');
        return fetchGeo(dataURL(SIDO_HIRES_URL))
          .then((geo) => {
            SIDO_HIRES = geo;
            const src = map.getSource('sido-boundaries');
            if (src) src.setData(geo);   // 이미 깔려 있으면 형태만 교체 — 칠한 색은 그대로 유지된다
            setText('');
            return true;
          })
          .catch((e) => {
            setText('정밀 경계를 불러오지 못했습니다 — 기본 경계로 표시합니다.');
            console.warn('시도 고해상도 경계 로드 실패:', e.message);
            return false;
          });
      },
    }),
    createRegionPainter({
      id: 'sigungu', source: 'sigungu-boundaries', layer: 'sigungu-color-fill', prop: 'name',
      sourceSpec: () => SIGUNGU_GEO && { type: 'geojson', tolerance: GEO_TOLERANCE, data: SIGUNGU_GEO },
      lazyInput: true,
      resolve:   (q) => resolveByMeta(sigunguMeta, q),
      suggest:   (q) => suggestByMeta(sigunguMeta, q),
      fullName:  (n) => n,
      label:     (n) => (sigunguMeta[n] && sigunguMeta[n].s) || n,
      qualifier: (n) => sidoShort((sigunguMeta[n] && sigunguMeta[n].q) || ''),   // '경남 중구' 처럼 두 글자로
      target:    (n) => sigunguMeta[n] && { center: sigunguMeta[n].c, zoom: sigunguMeta[n].z },
      load: lazyGeoLoad(dataURL('./recorder/js/data/sigungu.json'), 'js/data/sigungu.json',
        (geo) => { SIGUNGU_GEO = geo; Object.assign(sigunguMeta, buildMeta(geo, 'sido', 10)); }),
    }),
  ];

  /* 색칠 모드 4종. 여기 PAINTERS 한 곳에 모여 있어야 토글·PSD/SVG 내보내기·녹화 중
     잠금에서 빠뜨리지 않는다. (모드를 늘릴 때마다 한 군데씩 누락돼 버그가 났던 부분) */
  /* 탭을 바꿔도 색칠은 지우지 않는다. 국가와 행정구역을 같이 쓰고 싶을 때가 있고
     (예: 중국을 칠하고 우리 시도를 칠하기), 지우고 싶으면 각 탭의 '전체 삭제'가 있다.
     예전에는 전환할 때마다 전부 초기화했는데, 다른 탭을 잠깐 열어봤다가 돌아오면
     하던 작업이 날아갔다. */
  function setColorMode(mode) {
    PAINTERS.forEach((p) => {
      $(`seg-${p.id}`).classList.toggle('active', p.id === mode);
      $(`${p.id}-block`).style.display = p.id === mode ? '' : 'none';
    });
    const p = PAINTERS.find(x => x.id === mode);
    if (p) p.load();                 // 처음 열 때만 실제로 받아옴
  }
  PAINTERS.forEach((p) => $(`seg-${p.id}`).addEventListener('click', () => setColorMode(p.id)));

  /* ── 지역/주소 검색 (Mapbox Geocoding) ── */
  let _geoTimer = null, _geoSeq = 0;
  const geoInput = $('geo-input'), geoResults = $('geo-results');
  function hideGeoResults() { geoResults.style.display = 'none'; geoResults.innerHTML = ''; }
  function showGeoMessage(msg) {
    geoResults.innerHTML = `<div class="geo-item empty">${msg}</div>`;
    geoResults.style.display = 'block';
  }
  // "위도, 경도" 또는 "경도, 위도" 좌표 입력 파싱 (구분자: 쉼표/공백/슬래시). 순서 자동 판별.
  function parseCoords(q) {
    const m = q.match(/^\s*(-?\d{1,3}(?:\.\d+)?)\s*[,\s/]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/);
    if (!m) return null;
    let a = parseFloat(m[1]), b = parseFloat(m[2]), lat, lng;
    if (Math.abs(a) > 90 && Math.abs(b) <= 90) { lng = a; lat = b; }       // 경도,위도
    else if (Math.abs(b) > 90 && Math.abs(a) <= 90) { lat = a; lng = b; }  // 위도,경도
    else { lat = a; lng = b; }                                            // 모호하면 위도,경도 가정
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) { const t = lat; lat = lng; lng = t; }  // 범위 벗어나면 스왑
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
    return { lat, lng };
  }
  async function runGeocode(q) {
    const seq = ++_geoSeq;
    // 좌표 입력이면 바로 그 지점으로 (Geocoding API 호출 없이)
    const c = parseCoords(q);
    if (c) {
      geoResults.innerHTML = '';
      const item = document.createElement('div');
      item.className = 'geo-item';
      item.innerHTML = `<div class="gi-name">📍 좌표 ${c.lat.toFixed(5)}, ${c.lng.toFixed(5)}</div><div class="gi-ctx">위도, 경도 · 클릭하면 이동</div>`;
      item.addEventListener('click', () => { map.flyTo({ center: [c.lng, c.lat], zoom: 14, duration: 1200, essential: true }); hideGeoResults(); });
      geoResults.appendChild(item);
      geoResults.style.display = 'block';
      return;
    }
    const token = mapboxgl.accessToken;
    if (!token) { showGeoMessage('토큰이 필요합니다'); return; }
    try {
      const places = await fetchPlaces(q, token);
      if (seq !== _geoSeq) return;            // 더 최신 검색이 있으면 무시
      if (places == null) { showGeoMessage('검색 실패'); return; }
      const list = places.filter(p => p.center);
      if (!list.length) { showGeoMessage('결과 없음'); return; }
      geoResults.innerHTML = '';
      list.forEach(p => {
        const item = document.createElement('div');
        item.className = 'geo-item';
        // 출처를 같이 보여준다 — 같은 이름이 여러 곳에 있을 때 어느 DB 가 준 값인지가 판단에 도움이 된다
        const meta = [p.ctx, p.src].filter(Boolean).map(escAttr).join(' · ');
        item.innerHTML = `<div class="gi-name">${escAttr(p.name)}</div>${meta ? `<div class="gi-ctx">${meta}</div>` : ''}`;
        item.addEventListener('click', () => {
          const [lng, lat] = p.center;
          if (p.bbox && p.bbox.length === 4) {
            map.fitBounds([[p.bbox[0], p.bbox[1]], [p.bbox[2], p.bbox[3]]], { padding: 60, duration: 1200, essential: true });
          } else {
            map.flyTo({ center: [lng, lat], zoom: p.poi ? 15 : 12, duration: 1200, essential: true });
          }
          geoInput.value = p.name;
          hideGeoResults();
        });
        geoResults.appendChild(item);
      });
      geoResults.style.display = 'block';
    } catch (_) {
      if (seq === _geoSeq) showGeoMessage('검색 오류');
    }
  }
  /* ── 장소 검색 제공자 ──
     결과는 모두 { name, ctx, center:[lng,lat], bbox?, poi?, src } 로 맞춰서 돌려준다.
     src 는 결과 줄에 작게 표시해 어디서 온 값인지 알 수 있게 하는 용도. */
  const keys = (typeof SEARCH_KEYS !== 'undefined') ? SEARCH_KEYS : { vworld: '', google: '' };
  const hasKo = (s) => /[가-힣]/.test(s);

  /* VWorld 는 CORS 헤더를 안 보내서 fetch 로는 브라우저에서 못 부른다.
     대신 callback 파라미터(JSONP)를 지원하므로 script 태그로 받아온다.
     응답이 없거나 키가 틀리면 영영 안 돌아오므로 반드시 시간제한을 건다. */
  let _jsonpSeq = 0;
  function jsonp(url, timeoutMs = 4000) {
    return new Promise((resolve) => {
      const cb = '__cmGeo' + (++_jsonpSeq);
      const s = document.createElement('script');
      let done = false;
      const finish = (v) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        delete window[cb];
        s.remove();
        resolve(v);
      };
      const timer = setTimeout(() => finish(null), timeoutMs);
      window[cb] = (data) => finish(data);
      s.onerror = () => finish(null);
      s.src = url + (url.includes('?') ? '&' : '?') + 'callback=' + cb;
      document.head.appendChild(s);
    });
  }

  /* 같은 오류를 검색할 때마다 쏟아내지 않도록 한 번만 알린다.
     인증키 문제는 대개 둘 중 하나다 — 키 오타, 아니면 지금 주소가 VWorld 에 등록한
     '사용 도메인' 과 다른 것 (로컬에서 쓰려면 127.0.0.1 도 등록해야 한다). */
  let _vworldWarned = '';
  function warnVWorld(msg) {
    if (_vworldWarned === msg) return;
    _vworldWarned = msg;
    console.warn(`[검색] VWorld 사용 불가: ${msg}\n` +
      `  · 인증키를 recorder/js/config.js 의 SEARCH_KEYS.vworld 에 넣었는지\n` +
      `  · VWorld 에 등록한 사용 도메인에 현재 주소(${location.hostname || 'file://'})가 있는지 확인하세요.\n` +
      `  키가 풀릴 때까지는 Mapbox 로 검색합니다 (한국 지명은 잘 안 나옵니다).`);
  }

  /* VWorld 검색 API 2.0. type=place(관심지점)를 먼저 보고, 없으면 address(주소)로 한 번 더.
     좌표계는 EPSG:4326(위경도)로 받아 그대로 쓴다. */
  async function searchVWorld(q) {
    if (!keys.vworld) return [];
    const base = 'https://api.vworld.kr/req/search?service=search&request=search&version=2.0'
               + '&crs=EPSG:4326&size=8&page=1&format=json&errorformat=json'
               + `&key=${encodeURIComponent(keys.vworld)}&query=${encodeURIComponent(q)}`;
    for (const type of ['place', 'address']) {
      const d = await jsonp(`${base}&type=${type}`);
      // 무응답(시간제한·네트워크 오류)이면 두 번째 타입도 마찬가지다. 기다리게 하지 말고 바로 다음 제공자로.
      if (d === null) { warnVWorld('응답 없음 (시간 초과)'); return []; }
      const res = d && d.response;
      /* 키가 거부되면(INVALID_KEY·도메인 불일치) 결과가 0건인 것과 겉보기가 같아서,
         조용히 넘어가면 "검색이 안 되네"로만 보이고 원인을 알 수 없다. 콘솔에 한 번 남긴다. */
      if (res && res.status === 'ERROR') {
        warnVWorld((res.error && (res.error.text || res.error.code)) || '알 수 없는 오류');
        return [];
      }
      if (!res || res.status !== 'OK') continue;
      const items = (res.result && res.result.items) || [];
      const out = items.map((it) => {
        const x = parseFloat(it.point && it.point.x), y = parseFloat(it.point && it.point.y);
        if (!isFinite(x) || !isFinite(y)) return null;
        const addr = it.address || {};
        return {
          name: it.title || '',
          ctx: addr.road || addr.parcel || it.category || '',
          center: [x, y],
          poi: type === 'place',
          src: 'VWorld',
        };
      }).filter(Boolean);
      if (out.length) return out;
    }
    return [];
  }

  /* Google Places API (New) Text Search.
     좌표(location)와 이름(displayName)은 Pro SKU 라 월 5,000건까지 무료다.
     그래서 VWorld 가 0건일 때만 부른다 — 필드마스크에 Enterprise 필드를 넣지 말 것. */
  async function searchGoogle(q) {
    if (!keys.google) return [];
    const c = map.getCenter();
    try {
      const r = await fetch('https://places.googleapis.com/v1/places:searchText', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': keys.google,
          'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.location,places.viewport',
        },
        body: JSON.stringify({
          textQuery: q,
          languageCode: 'ko',
          maxResultCount: 8,
          // 현재 화면 근처를 우선 (강제는 아님 — 멀리 있는 정답도 나와야 한다)
          locationBias: { circle: { center: { latitude: c.lat, longitude: c.lng }, radius: 50000 } },
        }),
      });
      if (!r.ok) return [];
      const d = await r.json();
      return (d.places || []).map((p) => {
        const loc = p.location || {};
        if (!isFinite(loc.longitude) || !isFinite(loc.latitude)) return null;
        const v = p.viewport;
        return {
          name: (p.displayName && p.displayName.text) || p.formattedAddress || '',
          ctx: p.formattedAddress || '',
          center: [loc.longitude, loc.latitude],
          bbox: (v && v.low && v.high) ? [v.low.longitude, v.low.latitude, v.high.longitude, v.high.latitude] : undefined,
          poi: true,
          src: 'Google',
        };
      }).filter(Boolean);
    } catch (_) { return []; }
  }

  // Mapbox: Search Box(약칭·POI 매칭 우수) 우선, 0건/실패 시 Geocoding v5. 현재 화면 중심으로 근접 가중.
  async function searchMapbox(q, token) {
    if (!token) return [];
    const c = map.getCenter();
    const prox = `${c.lng.toFixed(4)},${c.lat.toFixed(4)}`;
    try {   // 1) Search Box forward
      const r = await fetch(`https://api.mapbox.com/search/searchbox/v1/forward?q=${encodeURIComponent(q)}&access_token=${token}&language=ko&limit=6&proximity=${prox}`);
      if (r.ok) {
        const d = await r.json();
        if (d.features && d.features.length) return d.features.map(f => {
          const pr = f.properties || {};
          return { name: pr.name || pr.name_preferred || (f.text || ''), ctx: pr.place_formatted || pr.full_address || '',
                   center: f.geometry && f.geometry.coordinates, bbox: pr.bbox,
                   poi: pr.feature_type === 'poi' || pr.feature_type === 'address', src: 'Mapbox' };
        });
      }
    } catch (_) {}
    try {   // 2) Geocoding v5 폴백
      const r = await fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json?access_token=${token}&language=ko,en&limit=6&autocomplete=true&fuzzyMatch=true&proximity=${prox}&types=country,region,district,place,locality,neighborhood,address,poi`);
      if (!r.ok) return [];
      const d = await r.json();
      return (d.features || []).map(f => {
        const name = f.text || f.place_name;
        return { name, ctx: (f.place_name && f.place_name !== name) ? f.place_name : '', center: f.center, bbox: f.bbox,
                 poi: (f.place_type || []).some(t => ['address','poi','neighborhood'].includes(t)), src: 'Mapbox' };
      });
    } catch (_) { return []; }
  }

  /* 제공자를 순서대로 훑어 처음으로 결과가 나온 곳을 쓴다.
     한글이 섞였으면 국내 API 를 앞에 둔다 — Mapbox 는 한국 POI 가 거의 없어서
     앞에 두면 '결과 없음' 만 돌려주고 뒤 제공자까지 가지도 못한다.
     Google 은 유료 구간이 있으므로 항상 마지막 국내 후보로만 둔다. */
  async function fetchPlaces(q, token) {
    const chain = hasKo(q)
      ? [searchVWorld, searchGoogle, (s) => searchMapbox(s, token)]
      : [(s) => searchMapbox(s, token), searchGoogle];
    let failed = 0;
    for (const provider of chain) {
      try {
        const out = await provider(q);
        if (out && out.length) return out;
      } catch (_) { failed++; }
    }
    return failed === chain.length ? null : [];   // 전부 예외면 '검색 실패', 아니면 '결과 없음'
  }
  geoInput.addEventListener('input', () => {
    const q = geoInput.value.trim();
    clearTimeout(_geoTimer);
    if (q.length < 2) { hideGeoResults(); return; }
    _geoTimer = setTimeout(() => runGeocode(q), 300);   // 디바운스
  });
  geoInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); clearTimeout(_geoTimer); const q = geoInput.value.trim(); if (q.length >= 1) runGeocode(q); }
    else if (e.key === 'Escape') hideGeoResults();
  });
  $('geo-clear').addEventListener('click', () => { geoInput.value = ''; hideGeoResults(); geoInput.focus(); });
  // 바깥 클릭 시 결과 닫기
  document.addEventListener('click', (e) => {
    if (!$('geocode-field').contains(e.target)) hideGeoResults();
  });

  // 타일 전환 부드럽게 (위성 등 raster 레이어 cross-fade 시간)
  const tileFade = $('tile-fade'), tileFadeVal = $('tile-fade-val');
  function setRasterFade(ms) {   // 모든 raster 레이어의 타일 크로스페이드 시간(ms)
    (map.getStyle().layers || []).forEach(l => {
      if (l.type === 'raster') { try { map.setPaintProperty(l.id, 'raster-fade-duration', ms); } catch (_) {} }
    });
  }
  function applyRasterFade() {
    const ms = parseInt(tileFade.value, 10);
    tileFadeVal.textContent = ms + 'ms';
    setRasterFade(ms);
  }
  tileFade.addEventListener('input', applyRasterFade);
  map.on('style.load', applyRasterFade);

  /* 심볼(라벨·아이콘) 페이드인 시간. 기본값이 있으면 타일이 도착한 뒤에도 글자가
     수백 ms 동안 서서히 나타나서, 이동 중 프레임에는 흐리거나 아예 빠진 채로 잡힌다.
     녹화 중에만 0으로 두고 끝나면 되돌린다. (공개 API가 없어 내부 필드를 직접 건드림) */
  const LABEL_FADE_DEFAULT = (typeof map._fadeDuration === 'number') ? map._fadeDuration : null;
  function setLabelFade(ms) {
    if (LABEL_FADE_DEFAULT === null) return;   // 향후 mapbox-gl 버전에서 필드가 사라지면 조용히 무시
    map._fadeDuration = ms;
    map.triggerRepaint();
  }
  const restoreLabelFade = () => setLabelFade(LABEL_FADE_DEFAULT);

  // 초기 + 스타일 전환 시마다 레이어 재생성
  // (뒤의 즉시 호출은 initRecorder 가 style.load 이후에 불린 경우를 위한 대비다.
  //  판단은 styleReady 로 한다 — isStyleLoaded() 를 쓰면 안 되는 이유는 위쪽 주석 참고)
  const addRegionLayers = () => PAINTERS.forEach(p => p.addLayer());   // 데이터 로드 전이면 내부에서 알아서 건너뜀
  map.on('style.load', addRegionLayers);
  if (styleReady) addRegionLayers();

  /* ── 육지색 / 바다색 (직접 변경 + 스타일 색 자동 읽기) / 강 표시 ── */
  // 스타일별 육지 레이어 (색 값으로 확인한 정확한 매핑)
  // 단색지형:landColor / 도로·모노톤:land / 단색:country-boundaries(밝은 회색 나라채움)
  const LAND_CANDIDATES = ['landColor', 'land', 'country-boundaries'];
  // 바다: 단색지형=baseColor, 단색=background (둘 다 남색 배경이 실제 바다). 나머지=water.
  // 바다 레이어: 배경형(baseColor/background)이 있으면 그게 바다, 없으면 water가 바다
  function findSeaLayers() {
    if (map.getLayer('baseColor'))   return ['baseColor'];
    if (map.getLayer('background'))  return ['background'];
    if (map.getLayer('water'))       return ['water'];
    return [];
  }
  // 바다색 적용 대상: 배경형(baseColor/background)과 water를 모두 같은 색으로
  // (단색지형·단색은 바다=배경, water=강·호수인데 둘 다 바다색으로 통일)
  function seaPaintLayers() {
    const ids = [];
    ['baseColor', 'background', 'water'].forEach(id => { if (map.getLayer(id)) ids.push(id); });
    return ids;
  }
  // 강·호수 토글 대상:
  //  - waterway(line) 있으면 그것
  //  - 배경 바다(baseColor/background)가 있으면 water = 강 (배경이 바다 역할)
  function findRiverLayers() {
    const ids = [];
    if (map.getLayer('waterway')) ids.push('waterway');
    if (map.getLayer('waterway-shadow')) ids.push('waterway-shadow');
    if (ids.length) return ids;
    const seaIsBg = map.getLayer('baseColor') || map.getLayer('background');
    if (seaIsBg && map.getLayer('water')) return ['water'];  // water = 강·호수
    return [];
  }
  // 배경 바다(baseColor/background)를 보이게 강제 (water=강 끄면 바다가 비쳐야 하므로)
  function ensureSeaBgVisible() {
    ['baseColor', 'background'].forEach(id => {
      if (map.getLayer(id)) { try { map.setLayoutProperty(id, 'visibility', 'visible'); } catch (_) {} }
    });
  }

  /* 강·호수를 바다와 같은 톤으로 맞춘다.
     단색·단색지형에서 바다는 배경(baseColor)이고, 강·호수는 그 위에 얹히는 water 레이어다.
     색은 이미 사실상 같은데(#172c4d ↔ #172d4f) water 가 fill-opacity 0.5 라
     회색 육지 위에서 옅은 청회색으로 떠 보였다. 색만 맞추고 불투명도를 안 맞추면
     그대로라서 둘 다 바다 값으로 덮는다.
     water 자체가 바다인 스타일(배경형 레이어가 없는 경우)은 건드리지 않는다. */
  function matchWaterToSea(color) {
    if (!color || !map.getLayer('water')) return;
    if (!map.getLayer('baseColor') && !map.getLayer('background')) return;
    try {
      map.setPaintProperty('water', 'fill-color', color);
      map.setPaintProperty('water', 'fill-opacity', 1);
    } catch (_) {}
  }

  // 현재 스타일에서 실제 육지 레이어 하나 찾기 (우선순위 순)
  function findLandLayer() {
    for (const id of LAND_CANDIDATES) { if (map.getLayer(id)) return id; }
    return null;
  }

  function paintProp(layer) {
    return layer.type === 'background' ? 'background-color'
         : layer.type === 'line'       ? 'line-color'
         : 'fill-color';
  }
  // 임의 CSS 색 → #rrggbb (color input 용). 표현식(array)이면 안에서 첫 색 문자열 추출
  function toHex(c) {
    if (!c) return null;
    if (Array.isArray(c)) {
      // ["interpolate"/"match", ...] 같은 식 → 평탄화해서 첫 색 문자열 찾기
      const flat = JSON.stringify(c).match(/(#[0-9a-f]{3,8}|rgba?\([^)]+\)|hsla?\([^)]+\))/i);
      c = flat ? flat[0] : null;
      if (!c) return null;
    }
    if (typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c)) return c;
    try {
      const cv = document.createElement('canvas'); cv.width = cv.height = 1;
      const ctx = cv.getContext('2d');
      ctx.fillStyle = '#000'; ctx.fillStyle = c;   // 잘못된 값이면 #000 유지
      const m = ctx.fillStyle;                      // 브라우저가 정규화 (#rrggbb 또는 rgba)
      if (/^#[0-9a-f]{6}$/i.test(m)) return m;
      const rgb = m.match(/\d+/g);
      if (rgb) return '#' + rgb.slice(0,3).map(n => (+n).toString(16).padStart(2,'0')).join('');
    } catch (_) {}
    return null;
  }
  // 한 그룹의 첫 유효 레이어 색 읽기
  function readGroupColor(ids) {
    for (const id of ids) {
      const layer = map.getLayer(id);
      if (!layer) continue;
      try { const v = map.getPaintProperty(id, paintProp(layer)); const hex = toHex(v); if (hex) return hex; } catch (_) {}
    }
    return null;
  }

  // ── 톤 맞추기용 색 변환 ──
  // 색 문자열 → {r,g,b,a}
  function parseRGBA(c) {
    try {
      const cv = document.createElement('canvas'); cv.width = cv.height = 1;
      const ctx = cv.getContext('2d');
      ctx.clearRect(0,0,1,1); ctx.fillStyle = c; ctx.fillRect(0,0,1,1);
      const d = ctx.getImageData(0,0,1,1).data;
      return { r:d[0], g:d[1], b:d[2], a:d[3]/255 };
    } catch (_) { return null; }
  }
  function rgbToHsl(r,g,b){ r/=255;g/=255;b/=255; const mx=Math.max(r,g,b),mn=Math.min(r,g,b); let h,s,l=(mx+mn)/2; if(mx===mn){h=s=0;}else{const d=mx-mn; s=l>0.5?d/(2-mx-mn):d/(mx+mn); switch(mx){case r:h=(g-b)/d+(g<b?6:0);break;case g:h=(b-r)/d+2;break;default:h=(r-g)/d+4;} h/=6;} return [h*360,s,l]; }
  function hslToCss(h,s,l,a){ return a===undefined||a>=1 ? `hsl(${h.toFixed(0)}, ${(s*100).toFixed(0)}%, ${(l*100).toFixed(0)}%)` : `hsla(${h.toFixed(0)}, ${(s*100).toFixed(0)}%, ${(l*100).toFixed(0)}%, ${a.toFixed(2)})`; }
  // 원본 색의 명도는 유지, 색상·채도는 육지색에 맞춤 (alpha 유지)
  function toneShift(origColor, landHue, landSat) {
    const rgba = parseRGBA(origColor); if (!rgba) return origColor;
    const [, , l] = rgbToHsl(rgba.r, rgba.g, rgba.b);
    return hslToCss(landHue, landSat, l, rgba.a);
  }
  // 표현식/문자열 내 모든 색을 톤 보정 (깊은 복사)
  function recolorExpr(node, landHue, landSat) {
    if (typeof node === 'string') {
      // 색 문자열로 보이면 변환, 아니면 그대로 (키워드 등)
      if (/^#[0-9a-f]{3,8}$/i.test(node) || /^(rgb|hsl)a?\(/i.test(node)) return toneShift(node, landHue, landSat);
      return node;
    }
    if (Array.isArray(node)) return node.map(x => recolorExpr(x, landHue, landSat));
    return node;
  }

  // 톤 보정 대상 오버레이 레이어 (공원·토지이용 등) — 원본 paint 식 백업
  const TONE_LAYERS = ['national-park', 'landuse', 'landcover'];
  const _origTonePaint = {};   // { id: 원본 fill-color }
  function applyToneLayers(landColorHex) {
    const [h, s] = rgbToHsl(...Object.values(parseRGBA(landColorHex)).slice(0,3));
    TONE_LAYERS.forEach(id => {
      const layer = map.getLayer(id); if (!layer) return;
      try {
        if (!(id in _origTonePaint)) _origTonePaint[id] = map.getPaintProperty(id, 'fill-color');
        const orig = _origTonePaint[id];
        if (orig === undefined) return;
        map.setPaintProperty(id, 'fill-color', recolorExpr(orig, h, s));
      } catch (_) {}
    });
  }

  // 그룹 전체에 색 적용
  function paintGroup(ids, color) {
    let n = 0;
    ids.forEach(id => {
      const layer = map.getLayer(id);
      if (!layer) return;
      try { map.setPaintProperty(id, paintProp(layer), color); n++; } catch (_) {}
    });
    return n;
  }
  function setRiverVisible(on) {
    findRiverLayers().forEach(id => { try { map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none'); } catch (_) {} });
  }

  /* 강 표시를 꺼둔 채 시작할 스타일.
     '단색'이 여기 있었는데, 강·호수 색이 바다와 같아진 뒤로는 꺼둘 이유가 없어졌다
     (예전엔 반투명이라 육지 위에 옅게 떠서 지저분해 보였다 — matchWaterToSea 주석 참고).
     지금은 비어 있다. 나중에 특정 스타일만 꺼두고 싶으면 스타일 키를 넣으면 된다. */
  const RIVER_DEFAULT_OFF = [];
  let _riverInitStyle = null;

  // 스타일 로드: 피커를 현재 스타일의 실제 색으로 채우고, 강 표시 상태 반영
  function syncMapColorPickers() {
    for (const k in _origTonePaint) delete _origTonePaint[k];   // 새 스타일이므로 톤 백업 초기화
    const styleKey = $('style-select').value;
    // 위성은 사진이라 '색' 지정은 무의미 → 색 섹션만 숨김
    const isPhoto = (styleKey === 'satellite');
    $('map-color-section').style.display = isPhoto ? 'none' : '';
    // 경계선은 '선'이라 위성 위에도 의미 있음 → 경계선 레이어가 실제로 있을 때만 표시 (없으면 숨김)
    const hasBd = ['country','disputed','admin'].some(k => bdExistingLayers(k).length > 0);
    $('boundary-section').style.display = hasBd ? '' : 'none';
    /* 위성사진은 여기서 멈춘다.
       이 스타일의 landColor·water 는 디자이너가 visibility:none 으로 꺼둔 반투명(0.56)
       오버레이다. 그런데 아래 강·호수 처리는 '배경 바다가 있으면 water = 강' 규칙에 따라
       위성의 water 를 켜버렸고, 연한 하늘색 hsl(194,63%,91%) 이 사진 위를 덮어
       바다가 탁한 흰색으로 보였다. 사진 위에 우리 색을 얹을 이유가 없고,
       색 섹션은 어차피 숨겨 놓았으므로 스타일이 정한 표시 상태를 그대로 둔다. */
    if (isPhoto) { _riverInitStyle = styleKey; return; }
    ensureSeaBgVisible();   // 배경 바다(baseColor 등) 강제로 켜기 — water=강 끄면 바다가 보이게
    const landId = findLandLayer();
    const land = landId ? readGroupColor([landId]) : null;
    const sea  = readGroupColor(findSeaLayers());
    if (land) $('land-color').value = land;
    if (sea) { $('sea-color').value = sea; matchWaterToSea(sea); }   // 강·호수도 같은 톤으로
    // 강 표시: 강 레이어 없는 스타일에선 체크박스 비활성 (줄은 유지)
    const hasRiver = findRiverLayers().length > 0;
    $('river-on').disabled = !hasRiver;
    $('river-on').closest('.map-color-row').style.opacity = hasRiver ? '' : '.45';
    // 스타일이 바뀐 첫 동기화 때만 기본값 적용 (사용자가 켜둔 걸 매번 덮지 않게)
    if (_riverInitStyle !== styleKey) {
      _riverInitStyle = styleKey;
      $('river-on').checked = hasRiver && !RIVER_DEFAULT_OFF.includes(styleKey);
    }
    setRiverVisible($('river-on').checked);
  }

  function paintLandColor(color) {
    const id = findLandLayer();
    if (id) paintGroup([id], color);
    applyToneLayers(color);   // 공원·토지이용 등은 톤만 맞춤 (종류별 명도 차이 유지)
  }

  $('land-color').addEventListener('input', () => paintLandColor($('land-color').value));
  $('sea-color').addEventListener('input',  () => {
    const c = $('sea-color').value;
    paintGroup(seaPaintLayers(), c);
    matchWaterToSea(c);          // 색을 바꿔도 강·호수가 반투명으로 떠 보이지 않게
  });
  $('river-on').addEventListener('change',  () => setRiverVisible($('river-on').checked));

  /* ── 북쪽 육상 국경선을 우리 데이터로 그리기 ──
     화면의 국경선은 Mapbox 의 admin 레이어(KP-KR)에서 오는데, 우리 시군구 행정경계와
     같은 선이 아니다. 벡터 타일을 직접 디코딩해 재보니 국경선 점의 77% 는 200m 이내로
     맞지만 나머지는 최대 3.1km 벌어졌고, 줌을 12까지 올려도 그 최대값이 줄지 않았다
     (= 선의 단순화 문제가 아니라 두 데이터가 실제로 다르다). 그래서 연천 쪽은 색칠이
     선을 넘고 양구 쪽은 선까지 못 미치는 것처럼 보였다.

     DMZ 구간은 우리 데이터에서 뽑은 선으로 대신 그린다. 색칠과 선이 같은 출처라
     어느 줌에서도 정확히 붙는다. Mapbox 쪽 KP-KR 구간은 아래에서 가린다. */
  const KR_BORDER_LAYER = 'kr-land-border';
  const KR_BORDER_URL = './recorder/js/data/korea-border.json';
  let KR_BORDER = null;

  function addKoreaBorderLayer() {
    if (!KR_BORDER || !styleReady || map.getLayer(KR_BORDER_LAYER)) return;
    if (!map.getSource(KR_BORDER_LAYER)) {
      map.addSource(KR_BORDER_LAYER, { type: 'geojson', tolerance: GEO_TOLERANCE, data: KR_BORDER });
    }
    map.addLayer({
      id: KR_BORDER_LAYER, type: 'line', source: KR_BORDER_LAYER,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#ffffff', 'line-width': 2.5, 'line-opacity': 1 },
    });
    applyBoundary('country');   // 국경선 컨트롤(색·투명도·두께·점선)을 그대로 받는다
    raiseBoundaries();
  }

  /* Mapbox 의 한반도 국경선 구간만 숨긴다. admin 소스를 쓰는 레이어 전부에
     iso_3166_1 이 'KP-KR' 인 것을 빼는 조건을 덧붙인다 ('KP-KR-dispute' 도 함께).
     다른 나라 국경선은 그대로 둔다. */
  function hideMapboxKoreanBorder() {
    /* 우리 선이 준비되기 전에는 절대 가리면 안 된다.
       가려놓고 우리 선을 못 그리면 국경선이 통째로 사라진다 (파일 404·네트워크 실패). */
    if (!KR_BORDER) return;
    if (!styleReady) return;   // 스타일 로드 전엔 getStyle() 이 던진다 — style.load 에서 다시 부른다
    for (const l of map.getStyle().layers || []) {
      if (l['source-layer'] !== 'admin') continue;
      try {
        const f = map.getFilter(l.id);
        if (!f || JSON.stringify(f).includes('KP-KR')) continue;   // 이미 처리한 레이어
        map.setFilter(l.id, ['all', f, ['!', ['in', 'KP-KR', ['coalesce', ['get', 'iso_3166_1'], '']]]]);
      } catch (_) {}
    }
  }

  /* 우리 선을 쓰는 이유가 하나 더 있다 — **선과 색칠은 같은 출처여야 한다.**

     2.0 은 시도 색칠을 OSM(admin_level=4)에서, 국경선을 Mapbox 에서 가져왔다. Mapbox 의
     행정경계도 결국 OSM 이라 둘이 맞아떨어졌다. 3.x 는 색칠을 국토부(VWorld)로 바꿨으니
     선도 국토부에서 뽑아야 맞는다. 한때 Mapbox 선으로 되돌렸다가 시도·시군구 색칠이
     선과 어긋나 되돌렸다 (연천·양구에서 최대 3.1km).

     같은 이유로 국가 단위 색칠도 Mapbox 가 아니라 우리 데이터를 쓴다 (아래 COUNTRY_GEO).

     남은 문제는 한강 하구다. `build-korea-border.mjs` 가 경기도·강원도에서만 선을 뽑는데
     강화도·교동도·석모도는 **인천광역시**라, 선이 126.517°E 에서 끊기고 그 앞은 김포
     서쪽 가장자리 — 염하(김포와 강화 사이 물길)를 따라 꺾여 내려간다. 2.0 은 강화·교동
     위로 이어졌다. 하구에는 실제로 군사분계선이 없고(정전협정상 중립수역), 물 위라
     어느 쪽 색칠도 닿지 않으므로 그 구간만 따로 이어 붙여야 한다. */
  fetch(dataURL(KR_BORDER_URL))
    .then((r) => (r.ok ? r.json() : null))
    .then((geo) => { if (!geo) return; KR_BORDER = geo; hideMapboxKoreanBorder(); addKoreaBorderLayer(); })
    .catch(() => {});   // 못 받으면 Mapbox 국경선이 그대로 쓰인다

  map.on('style.load', () => { hideMapboxKoreanBorder(); addKoreaBorderLayer(); });

  /* ── 남·북한만 우리 데이터로 칠한다 ──

     Mapbox 의 country-boundaries-v1 에는 두 가지 문제가 있었다.

     하나, 연평도 북쪽 북한 섬 넷(갈도·장재도·무도·료도)을 KOR 로 분류한다. 대한민국을
     칠하면 북한 섬이 함께 칠해졌다 — 한국 방송에서 그대로 나가면 사고다. Tilequery 로
     황해남도 해역 섬 62개를 전부 확인했고 이 넷만 틀렸다.

     둘, 시도·시군구 색칠과 국경선은 국토부 데이터인데 국가 색칠만 Mapbox 라 같은
     자리에서 최대 3.1km 어긋났다. 2.0 은 시도 색칠이 OSM 이었고 Mapbox 행정경계도
     결국 OSM 이라 우연히 맞아떨어졌던 것이다.

     그래서 KOR·PRK 만 우리 폴리곤으로 그리고 Mapbox 레이어에서는 그 둘을 뺀다.
     나머지 나라는 Mapbox 그대로다. 우리 데이터는 시도 색칠과 **꼭짓점이 같아**
     두 탭을 같이 써도 어긋나지 않는다.

     파일이 커서(10.6MB, 전송 2.3MB) 지연 로드한다. 도착하기 전에 Mapbox 쪽을 먼저
     빼 버리면 그 사이 남·북한을 아예 못 칠하므로 **도착한 뒤에** 뺀다. */
  const KC_LAYER = 'korea-country-fill';
  const KC_KEYS = ['KOR', 'PRK'];
  let KC_GEO = null, _mbCountryFilter = null;

  function addKoreaCountryLayer() {
    if (!KC_GEO || !styleReady || map.getLayer(KC_LAYER)) return;
    if (!map.getSource(KC_LAYER)) map.addSource(KC_LAYER, { type: 'geojson', tolerance: GEO_TOLERANCE, data: KC_GEO });
    /* 국가 색칠이므로 **다른 색칠 모드 아래**에 깔려야 한다. 이 레이어를 다른 색칠처럼
       첫 symbol 바로 아래에 넣으면, PAINTERS 가 먼저 깔린 뒤에 얹히는 탓에 시도·시군구
       **위**로 올라간다. 그러면 대한민국을 칠한 상태에서 시도를 칠해도 시도 색이 안 보인다
       (해외는 Mapbox 레이어가 그려서 멀쩡했고 대한민국·북한만 반대였던 이유).
       그래서 자기보다 위에 있어야 할 색칠 중 가장 아래 것 바로 밑에 끼운다. */
    const above = ['admin1-color-fill', 'sido-color-fill', 'sigungu-color-fill'].find(id => map.getLayer(id));
    map.addLayer({
      id: KC_LAYER, type: 'fill', source: KC_LAYER,
      paint: { 'fill-color': 'rgba(0,0,0,0)', 'fill-opacity': DEFAULT_OPACITY },
    }, above || (map.getStyle().layers || []).find(l => l.type === 'symbol')?.id);
    excludeKoreaFromMapbox();
    syncKoreaCountries();
    raiseBoundaries();
  }

  // Mapbox 국가 레이어에서 남·북한을 뺀다 (우리 레이어와 두 번 칠해지지 않게)
  function excludeKoreaFromMapbox() {
    const painter = PAINTERS.find(p => p.id === 'country');
    if (!KC_GEO || !painter || !map.getLayer(painter.layer)) return;
    const cur = map.getFilter(painter.layer);
    if (cur && JSON.stringify(cur).includes('KOR')) return;      // 이미 뺐다
    if (_mbCountryFilter === null) _mbCountryFilter = cur || false;
    const excl = ['!', ['in', ['get', 'iso_3166_1_alpha_3'], ['literal', KC_KEYS]]];
    try { map.setFilter(painter.layer, _mbCountryFilter ? ['all', _mbCountryFilter, excl] : excl); } catch (_) {}
  }

  // 국가 색칠의 색·투명도를 우리 레이어에도 그대로 먹인다 (applyColors 가 부른다)
  function syncKoreaCountries() {
    if (!KC_GEO || !map.getLayer(KC_LAYER)) return;
    const painter = PAINTERS.find(p => p.id === 'country');
    const es = (painter ? painter.entries() : []).filter(e => KC_KEYS.includes(e.key));
    try {
      if (!es.length) {
        map.setPaintProperty(KC_LAYER, 'fill-color', 'rgba(0,0,0,0)');
        map.setPaintProperty(KC_LAYER, 'fill-opacity', 0);
        return;
      }
      const col = ['match', ['get', 'iso_3166_1_alpha_3']], op = ['match', ['get', 'iso_3166_1_alpha_3']];
      es.forEach(e => { col.push(e.key, e.color); op.push(e.key, e.opacity); });
      col.push('rgba(0,0,0,0)'); op.push(0);
      map.setPaintProperty(KC_LAYER, 'fill-color', col);
      map.setPaintProperty(KC_LAYER, 'fill-opacity', op);
    } catch (_) {}
  }

  fetch(dataURL('./recorder/js/data/korea-countries.json'))
    .then((r) => (r.ok ? r.json() : null))
    .then((geo) => { if (!geo) return; KC_GEO = geo; addKoreaCountryLayer(); })
    .catch(() => {});   // 못 받으면 Mapbox 그대로 — 섬 넷이 우리 색이 되지만 칠하기는 된다

  map.on('style.load', addKoreaCountryLayer);

  /* ── 남·북한 행정구역선도 우리 데이터로 ──

     행정구역선은 스타일의 `admin-1-boundary`·`admin-boundaries` 에서 온다. 그런데 색칠은
     우리 데이터(시도 1.6만점, 북한 도 4~8천점)라 선이 훨씬 성겨 모양이 안 맞았다.
     국경선에서 겪은 것과 같은 문제다 — 선과 색칠은 같은 출처여야 한다.

     `korea-admin1-lines.json` 은 우리 폴리곤에서 **맞닿은 변만** 뽑은 것이다(1MB, 전송 0.3MB).
     폴리곤 외곽선을 통째로 그리면 해안선까지 행정구역선이 되어 나라 둘레에 테두리가 생긴다. */
  const KA_LAYER = 'korea-admin1-lines';
  let KA_GEO = null;

  function addKoreaAdmin1Lines() {
    if (!KA_GEO || !styleReady || map.getLayer(KA_LAYER)) return;
    if (!map.getSource(KA_LAYER)) map.addSource(KA_LAYER, { type: 'geojson', tolerance: GEO_TOLERANCE, data: KA_GEO });
    map.addLayer({
      id: KA_LAYER, type: 'line', source: KA_LAYER,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#ffffff', 'line-width': 1, 'line-opacity': 1 },
    });
    hideMapboxKoreanAdmin1();
    applyBoundary('admin');     // 행정구역선 컨트롤(색·투명도·두께·점선)을 그대로 받는다
    raiseBoundaries();
  }

  /* 스타일의 행정구역선에서 남·북한 구간만 뺀다. 우리 선이 준비되기 전에는 가리지 않는다 —
     가려놓고 못 그리면 행정구역선이 통째로 사라진다. */
  function hideMapboxKoreanAdmin1() {
    if (!KA_GEO || !styleReady) return;
    for (const l of map.getStyle().layers || []) {
      if (l['source-layer'] !== 'admin') continue;
      try {
        const f = map.getFilter(l.id);
        if (!f || JSON.stringify(f).includes('__kr-admin1')) continue;   // 이미 처리한 레이어
        map.setFilter(l.id, ['all', f,
          ['any',
            ['!=', ['get', 'admin_level'], 1],
            ['!', ['in', ['coalesce', ['get', 'iso_3166_1'], '__kr-admin1'], ['literal', ['KR', 'KP']]]]],
        ]);
      } catch (_) {}
    }
  }

  fetch(dataURL('./recorder/js/data/korea-admin1-lines.json'))
    .then((r) => (r.ok ? r.json() : null))
    .then((geo) => { if (!geo) return; KA_GEO = geo; addKoreaAdmin1Lines(); })
    .catch(() => {});   // 못 받으면 스타일의 행정구역선이 그대로 쓰인다

  map.on('style.load', addKoreaAdmin1Lines);

  /* ── 경계선 (국경선 / 분쟁지역 / 행정구역선) ── */

  /* 어떤 레이어가 어느 종류의 경계선인지는 **필터를 읽어서** 정한다.

     예전에는 종류마다 레이어 id 를 적어 뒀는데, 스타일마다 이름이 달라 반드시 빠뜨린다.
     빠진 레이어는 UI 가 손을 못 대므로 투명도를 0 으로 내려도 그대로 남았다 —
     "조절 불가능한 흰색 국경선" 이 그것이다. 실제로 스타일 6개를 받아 세어 보니:

       단색지형·단색   country_border · country-border · admin-2-boundaries-* ·
                       admin-boundaries-dot  → 8개 중 5개가 목록 밖
       위성사진        country-border-dot 이 아예 없어서, 국경선 칸이 우리 선(남·북한)
                       하나만 잡고 있었다 → 한국 국경만 조절되고 나머지는 흰 선만 보였다
       지형도          country-border 가 목록 밖
       모노톤·지명참고용  admin-0/1-* 이름이라 우연히 전부 맞았다 → 원래 멀쩡했다

     증상이 스타일마다 제각각이었던 게 전부 이 표로 설명된다.

     id 대신 필터를 보면 이름이 뭐든 따라온다. Mapbox 의 admin 소스는 세 속성으로
     갈린다 — admin_level(0=국경, 1=행정구역), disputed, maritime.
       · disputed 가 "true" 로 고정 → 분쟁지역
       · admin_level 이 0 으로 **고정** → 국경선
       · 그 외 → 행정구역선
     '고정'이 중요하다. admin-boundaries-dot 은 `>= 0` `<= 1` 이라 둘 다 지나가는데,
     이건 행정구역선 쪽이다. `==` 만 본다.
     country_boundaries 소스에서 나온 선(country_border)은 필터가 없고 국경선뿐이다. */
  const BOUNDARY_SOURCE_LAYERS = new Set(['admin', 'country_boundaries']);

  // 필터 어딘가에 `["==", ["get", prop], value]` 가 있는가 (구문법 `["==", prop, value]` 도 본다)
  function filterPins(filter, prop, value) {
    let found = false;
    (function walk(node) {
      if (found || !Array.isArray(node)) return;
      if (node[0] === '==' && node.length === 3) {
        const lhs = node[1];
        const name = Array.isArray(lhs) && lhs[0] === 'get' ? lhs[1] : lhs;
        if (name === prop && node[2] === value) { found = true; return; }
      }
      node.forEach(walk);
    })(filter);
    return found;
  }

  // 우리가 직접 그리는 경계선 — 소스가 geojson 이라 필터로는 안 잡힌다
  const OUR_BOUNDARY_LAYERS = { country: [KR_BORDER_LAYER], disputed: [], admin: [KA_LAYER] };

  function boundaryKindOf(l) {
    if (l.type !== 'line' || !BOUNDARY_SOURCE_LAYERS.has(l['source-layer'])) return null;
    /* **스타일이 꺼둔 레이어는 켜지 않는다.** 디자이너가 visibility:none 으로 빼둔 것이
       스타일마다 서넛씩 있다. 한 번 전부 켰다가 그대로 사고가 났다 —
         · country_border 는 country_boundaries 소스라 **maritime 조건이 없다.**
           켜면 해안선(육지-바다 경계)에까지 흰 선이 그어진다.
         · 같은 레이어가 KP-KR 가리기에서도 빠져 있어(그건 admin 소스만 훑는다)
           우리 국경선과 두 겹이 됐다. 두 데이터가 어긋나는 양구 위쪽에서 선이
           갈라졌다 합쳐졌고, 점선으로 바꾸면 점선 두 줄로 보였다.
       위성 스타일의 landColor·water 를 건드리면 안 되는 것과 같은 이야기다.
       꺼진 채로 두면 우리가 손대지 않으므로 계속 목록 밖이다 — 스스로 일관된다.
       그래서 '표시' 체크를 끌 때도 visibility 가 아니라 불투명도로 끈다(아래). */
    if ((l.layout || {}).visibility === 'none') return null;
    if (l['source-layer'] === 'country_boundaries') return 'country';
    /* 스타일 원본이 아니라 **지금 걸린** 필터를 읽는다. hideMapboxKoreanAdmin1 이
       남·북한을 빼려고 필터를 덧씌우는데, 덧씌운 절은 admin_level 을 0 으로 고정하지도
       disputed 를 true 로 고정하지도 않으므로 판정은 그대로다. */
    let f = l.filter;
    try { f = map.getFilter(l.id) ?? l.filter; } catch (_) {}
    if (filterPins(f, 'disputed', 'true')) return 'disputed';
    if (filterPins(f, 'admin_level', 0)) return 'country';
    return 'admin';
  }

  function bdExistingLayers(kind) {
    const ids = (map.getStyle()?.layers || []).filter(l => boundaryKindOf(l) === kind).map(l => l.id);
    OUR_BOUNDARY_LAYERS[kind].forEach(id => { if (map.getLayer(id)) ids.push(id); });
    return ids;
  }

  /* ── 색칠 위로 끌어올릴 경계선 찾기 ──
     색칠 레이어는 라벨 바로 아래에 깔리는데, 스타일의 경계선 레이어는 그보다 더 아래에 있다.
     그대로 두면 불투명도 0.6 짜리 색칠이 선 위를 덮어 선 색이 탁해지거나 아예 사라진다.
     색칠을 올린 뒤 경계선만 그 위로 끌어올린다 — 스타일 원래의 상하 순서는 그대로 둔다.

     여기도 이름으로 고르다가 단색지형·단색에서 8개 중 5개를 놓쳐 시군구 경계선이
     색칠에 덮인 적이 있다. 위와 같은 기준을 쓰므로 이제 둘이 어긋날 일이 없다. */
  function boundaryLayerIds(layers) {
    const ours = new Set(Object.values(OUR_BOUNDARY_LAYERS).flat());
    return layers.filter(l => ours.has(l.id) || boundaryKindOf(l)).map(l => l.id);
  }

  function raiseBoundaries() {
    const layers = map.getStyle()?.layers || [];
    const firstSymbol = layers.find(l => l.type === 'symbol')?.id;
    const wanted = new Set(boundaryLayerIds(layers));
    // layers 는 그리는 순서대로다. 그 순서 그대로 옮겨야 -bg 외곽선이 본선 아래에 남는다.
    layers.filter(l => wanted.has(l.id)).forEach((l) => {
      try { map.moveLayer(l.id, firstSymbol); } catch (_) {}
    });
  }
  // 한 종류 경계선에 현재 UI 값 적용
  function applyBoundary(kind) {
    const block = document.querySelector(`.bd-block[data-bd="${kind}"]`);
    if (!block) return;
    const on    = block.querySelector('.bd-on').checked;
    const color = block.querySelector('.bd-color').value;
    const opac  = parseFloat(block.querySelector('.bd-opacity').value);
    const width = parseFloat(block.querySelector('.bd-width').value);
    const dashType = block.querySelector('.bd-dash-option:checked')?.dataset.dash || '';
    const dashPatterns = {
      a: [2, 1.5],
      b: [4, 1.5, 1, 1.5],
      c: [1, 1],
    };
    /* 점선을 켜면 선 끝을 **각지게** 바꾼다.
       line-dasharray 의 단위는 선 두께의 배수인데, 둥근 끝(line-cap: round)은 대시
       양 끝을 각각 두께의 절반만큼 불려서 그린다. 그만큼 간격이 먹힌다 —
       [2, 1.5] 는 간격이 1.5 에서 0.5 로 줄고, [1, 1] 은 0 이 되어 실선처럼 보인다.
       남·북한 선(kr-land-border · korea-admin1-lines)만 round 로 만들어 뒀던 탓에
       "한국과 북한만 점선이 안 보인다"가 됐다. 스타일이 주는 경계선은 전부 기본값
       butt 이라 멀쩡했다(6개 스타일을 받아 확인했다).
       실선일 때는 둥근 끝이 더 낫다 — 조각난 선의 끝이 부드럽게 이어져 보인다. */
    const cap = dashType ? 'butt' : 'round';
    block.classList.toggle('disabled', !on);
    bdExistingLayers(kind).forEach(id => {
      const isBg = id.endsWith('-bg');   // 외곽선(배경 라인)은 좀 더 두껍게/연하게
      try {
        /* 끌 때 visibility 를 none 으로 만들면 그 레이어가 '스타일이 꺼둔 것'과
           구별되지 않아 다시 켤 수 없게 된다(위 참고). 불투명도로 끈다. */
        map.setPaintProperty(id, 'line-opacity', !on ? 0 : (isBg ? Math.min(1, opac) * 0.6 : opac));
        if (!on) return;
        map.setLayoutProperty(id, 'line-cap', cap);
        map.setPaintProperty(id, 'line-color', color);
        map.setPaintProperty(id, 'line-width', isBg ? width + 1.5 : width);
        map.setPaintProperty(id, 'line-dasharray', dashPatterns[dashType] || [1]);
      } catch (_) {}
    });
  }
  function applyAllBoundaries() { ['country','disputed','admin'].forEach(applyBoundary); }
  // 스타일 로드 시: 각 경계선의 현재 색을 피커에 반영 (강제로 다시 칠하지 않음)
  function syncBoundaryPickers() {
    ['country','disputed','admin'].forEach(kind => {
      const block = document.querySelector(`.bd-block[data-bd="${kind}"]`);
      if (!block) return;
      /* 피커에 보일 색은 **맨 위에 그려지는** 선에서 읽는다. 목록이 그리는 순서라
         마지막이 위다. 예전에는 첫 번째를 읽었는데, 그때는 목록이 손으로 적은 id 라
         우연히 위쪽 선이 앞에 있었다. 지금은 스타일 순서 그대로여서 첫 번째는
         맨 아래 선(단색지형이면 country_border 의 하늘색)이다. */
      const layers = bdExistingLayers(kind).filter(id => !id.endsWith('-bg'));
      const main = layers.at(-1);
      if (main) {
        try { const hex = toHex(map.getPaintProperty(main, 'line-color')); if (hex) block.querySelector('.bd-color').value = hex; } catch (_) {}
      }
      // 레이어 없는 종류는 블록 흐리게
      const has = bdExistingLayers(kind).length > 0;
      block.style.opacity = has ? '' : '.4';
      block.querySelectorAll('input').forEach(i => i.disabled = !has);
    });
  }
  // 각 블록의 입력에 핸들러 연결
  document.querySelectorAll('.bd-block').forEach(block => {
    const kind = block.dataset.bd;
    block.querySelectorAll('input').forEach(inp => {
      const updateBoundary = () => {
        if (inp.classList.contains('bd-dash-option') && inp.checked) {
          block.querySelectorAll('.bd-dash-option').forEach(option => {
            if (option !== inp) option.checked = false;
          });
        }
        applyBoundary(kind);
      };
      inp.addEventListener('input', updateBoundary);
      inp.addEventListener('change', updateBoundary);
    });
  });

  // 스타일 바뀌면 피커 갱신 + 경계선 UI 값 적용 (약간의 지연 후 — 레이어 준비 보장). 피커를 네이티브 색으로 먼저 맞춘 뒤 두께/투명도 적용 → 초기에도 보임.
  map.on('style.load', () => { setTimeout(() => { syncMapColorPickers(); syncBoundaryPickers(); applyAllBoundaries(); }, 60); });

  /* ── 경로 선 (카메라 이동 따라 그리기) ── */
  function routeWaypointCoords() {
    // 출발 → 경유지(지정된 것) → 도착 의 center 좌표 배열 (도로 경로 요청용 거점)
    const pts = [];
    if (startCam) pts.push(startCam.center);
    waypoints.forEach(w => { if (w.cam) pts.push(w.cam.center); });
    if (endCam) pts.push(endCam.center);
    return pts;
  }

  // 두 점 사이를 살짝 휜 아크(2차 베지어)로 — 항공노선 느낌
  function arcSegment(a, b, segments = 48, bend = 0.18) {
    const mid = [(a[0]+b[0])/2, (a[1]+b[1])/2];
    const dx = b[0]-a[0], dy = b[1]-a[1];
    // 수직 방향으로 제어점을 띄움 (왼쪽으로 볼록)
    const ctrl = [mid[0] - dy*bend, mid[1] + dx*bend];
    const out = [];
    for (let i = 0; i <= segments; i++) {
      const t = i/segments, u = 1-t;
      out.push([
        u*u*a[0] + 2*u*t*ctrl[0] + t*t*b[0],
        u*u*a[1] + 2*u*t*ctrl[1] + t*t*b[1],
      ]);
    }
    return out;
  }
  /* 날짜변경선(±180°) 넘어가기.
     경도를 그대로 보간하면 서울(127) → LA(-118) 이 태평양이 아니라 유라시아·대서양을
     가로질러 지구를 반대로 돈다. 앞 점 기준으로 ±180 을 넘긴 좌표(예: 242)로 이어
     붙이면 실제로 짧은 쪽을 지나고, mapbox 는 180 을 넘는 경도를 알아서 감아 그린다. */
  function unwrapLng(fromLng, toLng) {
    let d = (toLng - fromLng) % 360;
    if (d > 180) d -= 360;
    if (d < -180) d += 360;
    return fromLng + d;
  }
  // 거점 목록을 '감기지 않은' 연속 좌표계로 펴서 돌려준다 (첫 점은 그대로)
  function unwrapSeq(pts) {
    const out = pts.length ? [pts[0].slice()] : [];
    for (let i = 1; i < pts.length; i++) out.push([unwrapLng(out[i-1][0], pts[i][0]), pts[i][1]]);
    return out;
  }
  // 거점들을 아크로 이어 하나의 조밀한 경로로
  function arcPathCoords() {
    const pts = unwrapSeq(routeWaypointCoords());
    if (pts.length < 2) return pts;
    const out = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      const seg = arcSegment(pts[i-1], pts[i]);
      out.push(...seg.slice(1));  // 첫 점 중복 제거
    }
    return out;
  }

  let roadCoords = null;   // Directions API로 받은 조밀한 도로 좌표 (없으면 직선 사용)

  // 도로 경로 가져오기 (Mapbox Directions API, driving)
  async function fetchRoadRoute() {
    const pts = routeWaypointCoords();
    if (pts.length < 2) { roadCoords = null; return null; }
    // 좌표는 lng,lat;lng,lat 형식. Directions는 최대 25개 좌표.
    const coordStr = pts.map(p => `${p[0]},${p[1]}`).join(';');
    const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${coordStr}` +
      `?geometries=geojson&overview=full&access_token=${mapboxgl.accessToken}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Directions API 오류 ' + res.status);
    const data = await res.json();
    if (!data.routes || !data.routes.length) throw new Error('도로 경로를 찾지 못했습니다');
    roadCoords = data.routes[0].geometry.coordinates;
    return roadCoords;
  }

  // 화살촉 아이콘 (위쪽을 향하는 삼각형). 흰색으로 그려 SDF처럼 icon-color로 색칠
  function arrowImage(size = 64) {
    const cv = document.createElement('canvas'); cv.width = size; cv.height = size;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(size/2, 2);            // 꼭짓점(위)
    ctx.lineTo(size-4, size-6);       // 오른쪽 아래
    ctx.lineTo(4, size-6);            // 왼쪽 아래
    ctx.closePath();
    ctx.fill();
    return ctx.getImageData(0,0,size,size);
  }
  // 두 좌표 간 방위각(도, 북=0, 시계방향) — 화면(웹 메르카토르) 기준
  function bearingDeg(a, b) {
    const dx = b[0]-a[0], dy = b[1]-a[1];
    // 화면상 위가 +lat 이므로 atan2(dx, dy) 로 북쪽 0도
    return Math.atan2(dx, dy) * 180/Math.PI;
  }

  function addRouteLayer() {
    if (map.getSource('route-line')) return;
    map.addSource('route-line', { type: 'geojson', tolerance: 0, data: { type:'Feature', geometry:{ type:'LineString', coordinates:[] } } });
    map.addLayer({
      id: 'route-line-layer', type: 'line', source: 'route-line',
      layout: { 'line-cap':'round', 'line-join':'round' },
      paint: {
        'line-color': $('route-color').value,
        'line-width': parseFloat($('route-width').value),
        'line-dasharray': [1]
      }
    });
    // 점선용 점 레이어 (line-dasharray 깜빡임 회피 → 실제 원 도형)
    map.addSource('route-dots', { type:'geojson', data:{ type:'FeatureCollection', features: [] } });
    map.addLayer({
      id:'route-dots-layer', type:'circle', source:'route-dots',
      paint:{
        'circle-color': $('route-color').value,
        'circle-radius': Math.max(1.5, parseFloat($('route-width').value) * 0.6),
        'circle-pitch-alignment': 'map',
      }
    });
    // 화살표 아이콘 등록
    if (!map.hasImage('route-arrow')) map.addImage('route-arrow', arrowImage(64), { sdf: true });
    map.addSource('route-arrow', { type:'geojson', data: { type:'FeatureCollection', features: [] } });
    map.addLayer({
      id:'route-arrow-layer', type:'symbol', source:'route-arrow',
      layout:{
        'icon-image':'route-arrow',
        'icon-size': ['get','size'],          // 아이콘 크기 (선 굵기 기준 계산해 전달)
        'icon-rotate': ['get','rot'],
        'icon-rotation-alignment':'map',
        'icon-anchor':'center',
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
      paint:{ 'icon-color': $('route-color').value }
    });
  }
  let _lastRouteCoords = [], _lastRouteArrow = true;
  let _routeDotStep = 0;                 // 점선용 점 간격 (지리거리, 고정) — 전체 경로 설정 시 1회 계산
  const _EMPTY_FC = { type:'FeatureCollection', features: [] };
  const _EMPTY_LINE = { type:'Feature', geometry:{ type:'LineString', coordinates: [] } };
  // lng/lat 거리 (위도 보정한 등거리 근사)
  function geoDist(a, b) { const ml = (a[1]+b[1])*0.5*Math.PI/180; return Math.hypot((b[0]-a[0])*Math.cos(ml), b[1]-a[1]); }
  /* 같은 거리인데 경도 표기만 다른 경우(-118 과 242)까지 같게 보는 거리.
     아크 경로는 날짜변경선을 넘으면 180 을 넘긴 경도로 이어지므로, 원래 좌표(-118)와
     경로 좌표(242)를 맞대볼 때는 이걸 써야 한다. */
  function wrapDist(a, b) {
    let dl = Math.abs(a[0] - b[0]) % 360; if (dl > 180) dl = 360 - dl;
    const ml = (a[1]+b[1])*0.5*Math.PI/180;
    return Math.hypot(dl*Math.cos(ml), b[1]-a[1]);
  }
  // 시작점 기준 _routeDotStep 간격으로 점 배치 → 자라나도 이미 찍힌 점은 고정 위치(깜빡임 없음)
  function routeDotsFC(coords) {
    const step = _routeDotStep, feats = [];
    if (!step || !coords || coords.length < 2) return { type:'FeatureCollection', features: feats };
    feats.push({ type:'Feature', geometry:{ type:'Point', coordinates: coords[0] } });
    let acc = 0, next = step;
    for (let i = 1; i < coords.length; i++) {
      const segLen = geoDist(coords[i-1], coords[i]);
      while (segLen > 0 && acc + segLen >= next) {
        feats.push({ type:'Feature', geometry:{ type:'Point', coordinates: lerpPt(coords[i-1], coords[i], (next - acc) / segLen) } });
        next += step;
      }
      acc += segLen;
    }
    return { type:'FeatureCollection', features: feats };
  }
  // 전체 경로 기준 점 간격: 현재 화면에서 ~GAP px 가 되도록 → 고정 지리거리로 환산
  function routeDotStep(coords) {
    if (!coords || coords.length < 2) return 0;
    let geoLen = 0, scrLen = 0, pPrev = map.project(coords[0]);
    for (let i = 1; i < coords.length; i++) { const p = map.project(coords[i]); scrLen += Math.hypot(p.x-pPrev.x, p.y-pPrev.y); geoLen += geoDist(coords[i-1], coords[i]); pPrev = p; }
    const GAP = 8;   // 점 간격 목표(px) — 작을수록 촘촘
    return geoLen / Math.max(2, Math.round(scrLen / GAP));
  }
  /* 전체 경로(미리보기): 간격 갱신 후 그린다. **화살표는 안 그린다** —
     아직 아무것도 자라지 않았는데 도착지에 삼각형만 떠 있으면 이상하다.
     화살표는 선이 자라기 시작할 때 그 끝에 따라붙는다. */
  function setRouteFull(coords) { _routeDotStep = routeDotStep(coords); setRouteData(coords, false); }

  function setRouteData(coords, arrow = true) {
    _lastRouteCoords = coords || [];
    _lastRouteArrow = arrow;
    const src = map.getSource('route-line');
    const aSrc = map.getSource('route-arrow');
    const dSrc = map.getSource('route-dots');
    const isArc = $('route-shape').value !== 'road';   // 아크·직선 모두 우리가 만든 경로다
    const isDash = $('route-dash').value === 'dash';

    let drawCoords = coords || [], arrowFeat = null;
    if (arrow && isArc && coords && coords.length >= 2) {
      const w = parseFloat($('route-width').value);
      const size = (3*w) / 64;
      const tip = coords[coords.length-1], prev = coords[coords.length-2];
      // 화살표는 선의 끝 접선(prev→tip) 방향 → 항상 선 방향과 일치. 끝은 trimArcEnd로 도착핀 앞에서 잘라둠.
      arrowFeat = { type:'Feature', properties:{ rot: bearingDeg(prev, tip), size }, geometry:{ type:'Point', coordinates: tip } };
    }

    // 선: 점선이면 점(원) 도형, 아니면 실선
    if (isDash && drawCoords.length >= 2) {
      if (src) src.setData(_EMPTY_LINE);
      if (dSrc) dSrc.setData(routeDotsFC(drawCoords));
    } else {
      if (src) src.setData({ type:'Feature', geometry:{ type:'LineString', coordinates: drawCoords } });
      if (dSrc) dSrc.setData(_EMPTY_FC);
    }
    if (aSrc) aSrc.setData(arrowFeat ? { type:'FeatureCollection', features:[arrowFeat] } : _EMPTY_FC);
  }
  function applyRouteStyle() {
    if (!map.getLayer('route-line-layer')) return;
    map.setPaintProperty('route-line-layer', 'line-color', $('route-color').value);
    map.setPaintProperty('route-line-layer', 'line-width', parseFloat($('route-width').value));
    map.setPaintProperty('route-line-layer', 'line-dasharray', [1]);   // 점선은 점 도형으로 처리(route-dots)
    if (map.getLayer('route-dots-layer')) {
      map.setPaintProperty('route-dots-layer', 'circle-color', $('route-color').value);
      map.setPaintProperty('route-dots-layer', 'circle-radius', Math.max(1.5, parseFloat($('route-width').value) * 0.6));
    }
    if (map.getLayer('route-arrow-layer')) map.setPaintProperty('route-arrow-layer', 'icon-color', $('route-color').value);
    // 현재 선 좌표로 화살표/점 갱신 (굵기·색·모드 변경 반영)
    if (_lastRouteCoords.length) setRouteData(_lastRouteCoords, _lastRouteArrow);
  }
  // 두 점 사이 선형 보간 (t: 0~1)
  const lerpPt = (a, b, t) => [a[0]+(b[0]-a[0])*t, a[1]+(b[1]-a[1])*t];

  /* 좌표 배열에서 진행률 t(0~1)에 해당하는 부분 경로 반환.
     거리는 반드시 geoDist(위도 보정)로 잰다. 경도 1도는 적도에서 111km 지만
     서울에서 90km, 모스크바에서 62km 다. 도(度)를 그대로 재면 높은 위도의 동서 구간이
     실제보다 길게 잡혀, 같은 경로를 geoDist 로 재는 pathWpFracs(경유지 위치)·
     routeDotsFC(점 간격)와 잣대가 어긋난다 = 선이 경유지·카메라보다 앞서거나 뒤처진다. */
  function partialPath(coords, t) {
    if (!coords || coords.length < 2) return coords || [];
    if (t <= 0) return [coords[0]];
    if (t >= 1) return coords;
    // 누적 거리 기반
    let total = 0; const segLen = [];
    for (let i = 1; i < coords.length; i++) {
      const d = geoDist(coords[i-1], coords[i]);
      segLen.push(d); total += d;
    }
    const target = total * t;
    let acc = 0; const out = [coords[0]];
    for (let i = 1; i < coords.length; i++) {
      if (acc + segLen[i-1] >= target) {
        const r = segLen[i-1] ? (target - acc) / segLen[i-1] : 0;   // 겹친 점(길이 0)에서 NaN 방지
        out.push(lerpPt(coords[i-1], coords[i], r));
        break;
      }
      acc += segLen[i-1]; out.push(coords[i]);
    }
    return out;
  }

  // 경로 좌표에서 각 거점(출발/경유지/도착)이 놓인 '거리 비율(0~1)' — 성장 진행도를 카메라(구간)에 동기화
  let _wpFracs = null;
  function pathWpFracs(coords) {
    const pts = routeWaypointCoords();   // [출발, 경유지..., 도착]
    if (!coords || coords.length < 2 || pts.length < 2) return null;
    const cum = [0];
    for (let i = 1; i < coords.length; i++) cum.push(cum[i-1] + geoDist(coords[i-1], coords[i]));
    const total = cum[cum.length-1] || 1;
    let prev = 0;
    return pts.map((pt, k) => {
      if (k === 0) return 0;
      if (k === pts.length - 1) return 1;
      // 경로 좌표는 날짜변경선을 넘으면 180 을 넘긴 경도라 wrapDist 로 맞대봐야 한다
      let best = 0, bd = Infinity;
      for (let i = 0; i < coords.length; i++) { const d = wrapDist(pt, coords[i]); if (d < bd) { bd = d; best = i; } }
      let f = Math.min(0.999, cum[best] / total);
      if (f < prev) f = prev;            // 단조 증가 보장
      prev = f; return f;
    });
  }
  // 구간 L에서 진행 t일 때의 전체 경로 거리 비율 (경유지 간 거리 차 보정 → 카메라와 동기화). _wpFracs 없으면 균등 분할 폴백.
  function legFrac(L, t, totalLegs) {
    if (_wpFracs && L < _wpFracs.length - 1) return _wpFracs[L] + (_wpFracs[L+1] - _wpFracs[L]) * t;
    return (L + t) / totalLegs;
  }
  // 아크 경로의 '끝'을 화면상 일정 px 만큼 미리 잘라둠 → 선이 도착핀까지 안 가고 그 앞에서 멈춤(되돌아감 없음). 줌 반비례.
  function trimArcEnd(coords) {
    if (!coords || coords.length < 2) return coords;
    let remain = Math.max(10, Math.min(26, 15 * 11 / map.getZoom()));
    // 마지막 경유지~도착 구간 화면 길이의 40%로 제한 → 줌아웃(미리보기) 시에도 경유지를 넘어 자르지 않음
    const pts = routeWaypointCoords();
    if (pts.length >= 2) {
      const pL = map.project(pts[pts.length-2]), pE = map.project(pts[pts.length-1]);
      remain = Math.min(remain, Math.hypot(pL.x - pE.x, pL.y - pE.y) * 0.4);
    }
    let pA = map.project(coords[coords.length-1]);
    for (let i = coords.length - 1; i > 0; i--) {
      const pB = map.project(coords[i-1]);
      const seg = Math.hypot(pA.x - pB.x, pA.y - pB.y);
      if (seg >= remain) {
        const r = seg ? remain / seg : 0;
        const u = map.unproject([pA.x + (pB.x - pA.x) * r, pA.y + (pB.y - pA.y) * r]);
        return coords.slice(0, i).concat([[u.lng, u.lat]]);
      }
      remain -= seg; pA = pB;
    }
    return coords;
  }

  // 현재 선택된 경로 모양에 따른 좌표 (도로는 비동기 fetch 필요)
  async function resolvePathCoords() {
    const shape = $('route-shape').value;
    if (shape === 'arc')  { roadCoords = null; return arcPathCoords(); }
    // road
    try { if (!roadCoords) await fetchRoadRoute(); } catch (_) { roadCoords = null; }
    return roadCoords || arcPathCoords();   // 도로 실패 시 아크로 폴백
  }

  async function previewRoute() {
    if (!$('route-on').checked) return;
    addRouteLayer(); applyRouteStyle();
    const shape = $('route-shape').value;
    if (shape === 'arc') {
      const coords = trimArcEnd(arcPathCoords());
      if (coords.length >= 2) { setRouteFull(coords); setStatus('아크 경로 준비됨 ✓', 'done'); }
      else { setStatus('출발·도착을 먼저 지정하세요.', ''); }
    } else {
      try {
        setStatus('도로 경로 가져오는 중…', 'busy');
        await fetchRoadRoute();
        if (roadCoords) { setRouteFull(roadCoords); setStatus('도로 경로 준비됨 ✓', 'done'); }
        else { setStatus('출발·도착을 먼저 지정하세요.', ''); }
      } catch (err) { roadCoords = null; setStatus('경로 오류: ' + err.message + ' (아크로 표시)', ''); setRouteFull(trimArcEnd(arcPathCoords())); }
    }
  }

  // UI: 토글 / 옵션
  $('route-on').addEventListener('change', (e) => {
    $('route-opts').style.display = e.target.checked ? 'block' : 'none';
    if (e.target.checked) previewRoute();
    else { setRouteData([]); roadCoords = null; }
  });
  $('route-shape').addEventListener('change', () => { roadCoords = null; previewRoute(); });
  $('route-dash').addEventListener('change', applyRouteStyle);
  $('route-color').addEventListener('input', applyRouteStyle);
  $('route-width').addEventListener('input', () => { $('route-w-val').textContent = $('route-width').value; applyRouteStyle(); });
  map.on('style.load', () => { if ($('route-on').checked) { addRouteLayer(); applyRouteStyle(); previewRoute(); } });
  // 줌 변경 시 점선 점 간격을 화면 기준으로 다시 맞춤 (녹화 중 제외 — 녹화는 셋업 시점 간격으로 안정 유지)
  map.on('zoom', () => {
    if (!busy && $('route-on').checked && $('route-dash').value === 'dash' && _lastRouteCoords.length) setRouteFull(_lastRouteCoords);
  });

  /* ── 직접 선 그리기 (수동 폴리라인, 카메라 경로와 무관) ── */
  const drawnStrokes = [];   // 완료된 선들: [ [[lng,lat],...], ... ]
  let drawCurrent = [];      // 현재 그리는 중인 선
  let drawMode = false;
  let _drawMouse = null;     // 러버밴드 미리보기용 커서 좌표

  // 완료선(+ 진행중선/러버밴드) → FeatureCollection. t<1 이면 각 선을 부분만(녹화 reveal).
  function drawFC(t, includeCurrent) {
    const feats = [];
    drawnStrokes.forEach(s => { const c = (t >= 1) ? s : partialPath(s, t); if (c && c.length >= 2) feats.push({ type:'Feature', geometry:{ type:'LineString', coordinates: c } }); });
    if (includeCurrent && drawCurrent.length) {
      const cur = _drawMouse ? drawCurrent.concat([_drawMouse]) : drawCurrent;
      if (cur.length >= 2) feats.push({ type:'Feature', geometry:{ type:'LineString', coordinates: cur } });
    }
    return { type:'FeatureCollection', features: feats };
  }
  function addDrawLayer() {
    if (map.getSource('draw-lines')) return;
    map.addSource('draw-lines', { type:'geojson', tolerance: 0, data: drawFC(1, false) });
    map.addLayer({
      id:'draw-lines-layer', type:'line', source:'draw-lines',
      layout:{ 'line-cap':'round', 'line-join':'round' },
      paint:{ 'line-color': $('draw-color').value, 'line-width': parseFloat($('draw-width').value) }
    });
  }
  function applyDrawStyle() {
    if (!map.getLayer('draw-lines-layer')) return;
    map.setPaintProperty('draw-lines-layer','line-color',$('draw-color').value);
    map.setPaintProperty('draw-lines-layer','line-width',parseFloat($('draw-width').value));
  }
  function setDrawVisible(v) {
    if (map.getLayer('draw-lines-layer')) map.setLayoutProperty('draw-lines-layer','visibility', v ? 'visible' : 'none');
  }
  function refreshDrawPreview() { const src = map.getSource('draw-lines'); if (src) src.setData(drawFC(1, true)); }  // 편집 미리보기(전체+진행중)
  function setDrawData(t)       { const src = map.getSource('draw-lines'); if (src) src.setData(drawFC(t, false)); }  // 녹화 reveal(진행률 t)

  /* 체크만 하고 그리기 모드를 안 켜면 지도를 클릭해도 아무 일이 없다.
     그 상태에서만 버튼을 강조하고 안내 문구를 '다음에 할 일'로 바꾼다. */
  const DRAW_HINT_ON = '그리기 모드 ON → 지도를 클릭해 점을 잇고, 더블클릭(또는 Enter)으로 한 선 완료. 카메라 이동에 맞춰 영상에서 그려집니다.';
  const DRAW_HINT_NUDGE = '아래 ‘✏️ 그리기 모드’ 를 눌러야 지도에 선을 그릴 수 있습니다.';
  function updateDrawNudge() {
    const btn = $('draw-mode'), hint = $('draw-hint');
    if (!btn) return;
    const needs = $('draw-on').checked && !drawMode && !drawnStrokes.length && !drawCurrent.length;
    btn.classList.toggle('nudge', needs);
    if (hint) hint.textContent = needs ? DRAW_HINT_NUDGE : DRAW_HINT_ON;
  }

  function enterDrawMode() {
    drawMode = true;
    $('draw-mode').classList.add('active');
    map.dragPan.disable(); map.doubleClickZoom.disable();
    map.getCanvas().style.cursor = 'crosshair';
    setStatus('그리기 모드: 클릭으로 점 잇기, 더블클릭·Enter로 완료','busy');
    updateDrawNudge();
  }
  function exitDrawMode() {
    if (drawCurrent.length >= 2) drawnStrokes.push(drawCurrent.slice());   // 진행 중 선 자동 완료
    drawCurrent = []; _drawMouse = null; drawMode = false;
    $('draw-mode').classList.remove('active');
    map.dragPan.enable(); map.doubleClickZoom.enable();
    map.getCanvas().style.cursor = '';
    refreshDrawPreview(); setStatus('대기 중',''); updateDrawNudge();
  }
  function finishStroke() {
    if (drawCurrent.length >= 2) drawnStrokes.push(drawCurrent.slice());
    drawCurrent = []; _drawMouse = null; refreshDrawPreview(); updateDrawNudge();
  }

  $('draw-on').addEventListener('change', (e) => {
    $('draw-opts').style.display = e.target.checked ? 'block' : 'none';
    if (e.target.checked) { addDrawLayer(); applyDrawStyle(); setDrawVisible(true); refreshDrawPreview(); }
    else { exitDrawMode(); setDrawVisible(false); }
    updateDrawNudge();
  });
  $('draw-mode').addEventListener('click', () => { drawMode ? exitDrawMode() : enterDrawMode(); });
  $('draw-color').addEventListener('input', applyDrawStyle);
  $('draw-width').addEventListener('input', () => { $('draw-w-val').textContent = $('draw-width').value; applyDrawStyle(); });
  function undoDraw() { if (drawCurrent.length) drawCurrent.pop(); else drawnStrokes.pop(); refreshDrawPreview(); updateDrawNudge(); }
  $('draw-undo').addEventListener('click', undoDraw);
  $('draw-clear').addEventListener('click', () => { drawnStrokes.length = 0; drawCurrent = []; _drawMouse = null; refreshDrawPreview(); updateDrawNudge(); });

  // 지도 포인터: 그리기 모드일 때만 동작
  map.on('click', (e) => {
    if (!drawMode) return;
    const p = [e.lngLat.lng, e.lngLat.lat];
    const last = drawCurrent[drawCurrent.length - 1];
    if (last) { const a = map.project(last), b = map.project(p); if (Math.hypot(a.x-b.x, a.y-b.y) < 8) return; }  // 더블클릭/중복 클릭 무시
    drawCurrent.push(p); refreshDrawPreview();
  });
  map.on('dblclick', (e) => { if (!drawMode) return; if (e.preventDefault) e.preventDefault(); finishStroke(); });
  map.on('mousemove', (e) => { if (!drawMode || !drawCurrent.length) return; _drawMouse = [e.lngLat.lng, e.lngLat.lat]; refreshDrawPreview(); });
  window.addEventListener('keydown', (e) => {
    if (!drawMode) return;
    const t = e.target, inField = t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName);
    if ((e.metaKey || e.ctrlKey) && (e.key === 'z' || e.key === 'Z') && !e.shiftKey) {
      if (inField) return;            // 입력칸에선 기본 텍스트 되돌리기 유지
      e.preventDefault(); undoDraw();   // ⌘Z / Ctrl+Z
    } else if (e.key === 'Enter') finishStroke();
    else if (e.key === 'Escape') { drawCurrent = []; _drawMouse = null; refreshDrawPreview(); }
  });
  map.on('style.load', () => { if ($('draw-on').checked) { addDrawLayer(); applyDrawStyle(); setDrawVisible(true); refreshDrawPreview(); } });

  function applyFrame() {
    const guide = $('frame-guide'), val = $('frame').value;
    if (val === 'full') { guide.style.display = 'none'; readout(); return; }
    const [w, h] = val.split('x').map(Number);
    const vw = innerWidth, vh = innerHeight, s = Math.min(vw/w, vh/h, 1);
    const dw = w*s, dh = h*s;
    Object.assign(guide.style, { width:dw+'px', height:dh+'px', left:(vw-dw)/2+'px', top:(vh-dh)/2+'px', display:'block' });
    readout();
  }
  // 선택된 캡처 영역에 맞춘 소스 크롭(device px) + 출력 크기. 'full'이면 전체 캔버스.
  function frameCropRect(cv) {
    const val = $('frame').value;
    if (val === 'full') return { sx:0, sy:0, sw:cv.width, sh:cv.height, ow:cv.width, oh:cv.height, full:true };
    const [fw, fh] = val.split('x').map(Number);
    const tAR = fw/fh, cAR = cv.width/cv.height;
    let sw, sh;
    if (cAR > tAR) { sh = cv.height; sw = Math.round(sh*tAR); } else { sw = cv.width; sh = Math.round(sw/tAR); }  // 비율 맞춰 중앙 크롭
    return { sx: Math.round((cv.width-sw)/2), sy: Math.round((cv.height-sh)/2), sw, sh, ow: fw, oh: fh, full:false };
  }
  function readout(){
    const cv = map.getCanvas(), val = $('frame').value;
    $('resout').textContent = `실제 녹화 해상도: ${val === 'full' ? (cv.width + ' × ' + cv.height) : val.replace('x',' × ')}`;
  }
  $('frame').addEventListener('change', applyFrame);
  map.on('resize', readout); map.on('idle', readout);
  applyFrame();

  /* ── 출발/도착 핀 마커 + 드래그 지정 ── */
  const PIN = {
    start: { marker: null, color: '#0F3564', label: '' },
    end:   { marker: null, color: '#0F3564', label: '' },
  };
  function pinSVG(color) {
    const el = document.createElement('div');
    el.className = 'map-pin';
    el.innerHTML =
      `<div class="pin-inner"><svg viewBox="0 0 28 38" width="28" height="38" xmlns="http://www.w3.org/2000/svg">
         <path d="M14 0C6.3 0 0 6.3 0 14c0 10 14 24 14 24s14-14 14-24C28 6.3 21.7 0 14 0z" fill="${color}"/>
         <circle cx="14" cy="14" r="6" fill="rgba(255,255,255,.9)"/>
       </svg></div>`;
    return el;
  }

  // 핀 모양을 지도 이미지로 등록 (캔버스에 그려져 녹화에 포함됨)
  function pinImageData(color, scale = 2) {
    const w = 28*scale, h = 38*scale;
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d');
    ctx.scale(scale, scale);
    // 핀 본체
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(14,0);
    ctx.bezierCurveTo(6.3,0, 0,6.3, 0,14);
    ctx.bezierCurveTo(0,24, 14,38, 14,38);
    ctx.bezierCurveTo(14,38, 28,24, 28,14);
    ctx.bezierCurveTo(28,6.3, 21.7,0, 14,0);
    ctx.fill();
    // 흰 원
    ctx.fillStyle = 'rgba(255,255,255,.9)';
    ctx.beginPath(); ctx.arc(14,14,6,0,Math.PI*2); ctx.fill();
    return ctx.getImageData(0,0,w,h);
  }
  // ── 녹화용 핀: 위치 목록 + 뾰족점 팝업 애니메이션 ──
  // 핀은 icon-anchor:'bottom' 이라 icon-size 0→1 로 키우면 뾰족점이 고정된 채 위로 솟는다.
  const easeOutBack = (t) => {
    if (t <= 0) return 0; if (t >= 1) return 1;
    const c1 = 1.70158, c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);   // 살짝 오버슈트 → "톡"
  };
  const POP_MS = 480;                 // 팝업 길이 (실시간 모드 기준)

  // 위치 핀 라벨 (사용자 업로드 폰트 가능)
  let LOC_FONT_FAMILY = '';           // 업로드된 폰트명 ('' = 기본 sans-serif)
  let _locFontFace = null;
  let LOC_HALO = '#ffffff';           // 라벨 외곽선/그림자 색 (위성 스타일에선 어둡게)

  // 라벨을 핀 이미지에 구워 만든다. 좌우 대칭 패딩으로 뾰족점이 항상 가로 중앙(anchor 'bottom') 에 오게 한다.
  function locLabelImageData(rec, side, scale = 2) {
    const text  = (rec.text || '').trim();
    const fSize = Math.max(8, parseInt($('locpin-text-size').value, 10) || 16);
    const tcol  = $('locpin-text-color').value || '#000000';
    const fam   = LOC_FONT_FAMILY ? `'${LOC_FONT_FAMILY}'` : 'sans-serif';
    const gap = 6, pinW = 28, pinH = 38;
    const meas = document.createElement('canvas').getContext('2d');
    meas.font = `600 ${fSize}px ${fam}`;
    const textW = text ? Math.ceil(meas.measureText(text).width) : 0;
    const sideW = textW ? (gap + textW) : 0;
    const cw = pinW + 2 * sideW;                 // 좌우 대칭 → 뾰족점이 가로 중앙
    const ch = Math.max(pinH, Math.ceil(fSize * 1.5));
    const cv = document.createElement('canvas'); cv.width = cw * scale; cv.height = ch * scale;
    const ctx = cv.getContext('2d'); ctx.scale(scale, scale);
    const pinX = cw / 2 - pinW / 2;              // 핀 좌상단 x
    const pinTop = ch - pinH;                    // 바닥 정렬 (뾰족점이 캔버스 맨 아래 중앙)
    // 핀 본체
    ctx.save(); ctx.translate(pinX, pinTop);
    ctx.fillStyle = rec.color;
    ctx.beginPath();
    ctx.moveTo(14,0); ctx.bezierCurveTo(6.3,0,0,6.3,0,14); ctx.bezierCurveTo(0,24,14,38,14,38);
    ctx.bezierCurveTo(14,38,28,24,28,14); ctx.bezierCurveTo(28,6.3,21.7,0,14,0); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.beginPath(); ctx.arc(14,14,6,0,Math.PI*2); ctx.fill();
    ctx.restore();
    // 라벨
    if (textW) {
      ctx.font = `600 ${fSize}px ${fam}`;
      ctx.textBaseline = 'middle';
      const ty = pinTop + 14;                       // 핀 머리 중앙 높이
      let tx;
      if (side === 'left') { ctx.textAlign = 'right'; tx = pinX - gap; }
      else                 { ctx.textAlign = 'left';  tx = pinX + pinW + gap; }
      // 미리보기(CSS text-shadow)와 동일한 '부드러운 글로우' — 그림자 블러로 여러 번 그려 밀도를 맞춤
      ctx.fillStyle = tcol;
      ctx.shadowColor = LOC_HALO; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0; ctx.shadowBlur = 3;
      ctx.fillText(text, tx, ty);
      ctx.fillText(text, tx, ty);
      ctx.fillText(text, tx, ty);
      ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0;   // 그림자 끄고 본문은 또렷하게 한 번 더
      ctx.fillText(text, tx, ty);
    }
    return ctx.getImageData(0, 0, cv.width, cv.height);
  }
  // 도착 컷 화면 기준: 핀이 화면 왼쪽 절반이면 라벨도 왼쪽, 오른쪽 절반이면 오른쪽
  function locSideFor(coord) {
    const cx = (map.getContainer().clientWidth || map.getCanvas().clientWidth) / 2;
    return map.project(coord).x < cx ? 'left' : 'right';
  }
  // 위치 핀 라벨 이미지를 (도착 화면 기준) 굽고 등록 — 프리로드에서 카메라가 도착에 있을 때 호출
  // 한 핀의 (라벨 포함) 이미지를 현재 카메라 화면 기준 좌/우로 굽고 등록
  function bakePinImage(p) {
    const id = 'pin-img-' + p.key;
    const img = locLabelImageData({ color: p.color, text: p.text }, locSideFor(p.coord), 2);
    if (map.hasImage(id)) map.removeImage(id);
    map.addImage(id, img, { pixelRatio: 2 });
    p.img = id;
  }
  function bakeCapPin(key) { const p = _capPins.find(x => x.key === key); if (p) bakePinImage(p); }
  function bakeLocPins() { for (const p of _capPins) if (p.loc) bakePinImage(p); }

  let _capPins = [];                  // [{ key, coord:[lng,lat], img, start:(ms|frame)|null, loc?:bool }]
  let _popLen  = POP_MS;              // 팝업 길이 (모드별 단위: ms 또는 프레임)
  let _capSig  = '';                  // 직전 사이즈 시그니처 (변화 감지)
  let _capChanged = false;            // 마지막 capPinFC 호출에서 사이즈가 바뀌었는지

  function buildCapPinList(showPath, showLoc) {
    const arr = [];
    if (showPath) {
      if (startCam) arr.push({ key:'start', coord: startCam.center.slice(), color: PIN.start.color, text: PIN.start.label, img:'pin-img-blank', start:null });
      let si = 0;
      waypoints.forEach(w => { if (w.cam) { arr.push({ key:'wp'+si, coord: w.cam.center.slice(), color: WP_COLOR, text: w.label, img:'pin-img-blank', start:null }); si++; } });
      if (endCam) arr.push({ key:'end', coord: endCam.center.slice(), color: PIN.end.color, text: PIN.end.label, img:'pin-img-blank', start:null });
    }
    if (showLoc) {
      locPins.forEach((p, i) => arr.push({ key:'loc'+i, coord: p.lngLat.slice(), color: p.color, text: p.text, img:'pin-img-blank', start:null, loc:true, locIndex:i }));
    }
    return arr;
  }
  const pinSize = (p, now) => (p.start == null || now == null) ? 0 : easeOutBack((now - p.start) / _popLen);
  function capPinFC(now) {
    let sig = ''; const feats = [];
    for (const p of _capPins) {
      const s = pinSize(p, now);
      sig += p.key + ':' + s.toFixed(3) + ';';
      feats.push({ type:'Feature', properties:{ img:p.img, size:s }, geometry:{ type:'Point', coordinates:p.coord } });
    }
    _capChanged = (sig !== _capSig); _capSig = sig;
    return { type:'FeatureCollection', features: feats };
  }
  // 핀 등장 트리거 (카메라 도착 시점 등). 한 번만 발동.
  function triggerCapPin(key, now) {
    const p = _capPins.find(x => x.key === key);
    if (p && p.start == null) p.start = now;
  }
  // 위치 핀: 도착 컷(카메라가 도착 지점에 닿을 때) 일제히 등장
  function triggerLocPins(now) {
    for (const p of _capPins) { if (p.loc && p.start == null) p.start = now; }
  }
  function pushCapData(now) {
    const src = map.getSource('capture-pins');
    if (src) src.setData(capPinFC(now));
  }

  // 녹화용 핀 레이어 추가 (출발+경유지+도착+위치핀, 처음엔 size 0 = 숨김)
  function showCapturePins(showPath, showLoc) {
    _capPins = buildCapPinList(showPath, showLoc);
    _capSig = '';
    // 모든 핀 이미지(라벨 포함)는 각 핀이 등장하는 화면 기준으로 좌/우가 정해지므로 프리로드(bakeCapPin/bakeLocPins)에서 굽는다.
    // 그 전엔 투명 placeholder (size 0 이라 안 보임).
    if (!map.hasImage('pin-img-blank')) {
      const c = document.createElement('canvas'); c.width = c.height = 1;
      map.addImage('pin-img-blank', c.getContext('2d').getImageData(0, 0, 1, 1), { pixelRatio: 2 });
    }

    const data = capPinFC(null);   // 전부 size 0 (등장 전)
    if (!map.getSource('capture-pins')) {
      map.addSource('capture-pins', { type:'geojson', data });
      map.addLayer({
        id:'capture-pins-layer', type:'symbol', source:'capture-pins',
        layout:{
          'icon-image': ['get','img'],
          'icon-size': ['get','size'],
          'icon-anchor': 'bottom',
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
        }
      });
    } else {
      map.getSource('capture-pins').setData(data);
    }
  }
  function hideCapturePins() {
    if (map.getLayer('capture-pins-layer')) map.removeLayer('capture-pins-layer');
    if (map.getSource('capture-pins')) map.removeSource('capture-pins');
    for (const p of _capPins) {   // 구운 라벨 이미지 정리 (다음 녹화에서 다시 굽도록)
      if (p.img && p.img !== 'pin-img-blank' && map.hasImage(p.img)) { try { map.removeImage(p.img); } catch (_) {} }
    }
  }
  // 재지정 피드백 헬퍼
  function flash(el) { if (!el) return; el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); }
  function bouncePin(which) {
    const m = PIN[which].marker; if (!m) return;
    const el = m.getElement(); el.classList.remove('bounce'); void el.offsetWidth; el.classList.add('bounce');
  }
  // 지점 지정. lngLat 있으면 드롭(위치+줌), 없으면 '현재 화면' 버튼(핀 있으면 위치 유지·줌만 갱신)
  function setPoint(which, lngLat) {
    const cur = (which === 'start') ? startCam : endCam;
    const cam = grabCam();                        // 현재 줌/베어링/피치
    if (lngLat) {
      cam.center = [lngLat.lng, lngLat.lat];      // 드롭: 위치 교체
    } else if (cur && PIN[which].marker) {
      cam.center = cur.center;                    // 버튼: 기존 핀 위치 유지 (줌만 갱신)
    }
    if (which === 'start') startCam = cam; else endCam = cam;

    // 마커 생성/이동
    if (!PIN[which].marker) {
      const el = pinSVG(PIN[which].color);
      const m = new mapboxgl.Marker({ element: el, anchor: 'bottom', draggable: true })
        .setLngLat(cam.center).addTo(map);
      m.on('dragend', () => {                       // 핀을 끌어 위치 조정
        const ll = m.getLngLat();
        if (which === 'start') startCam.center = [ll.lng, ll.lat];
        else endCam.center = [ll.lng, ll.lat];
        bouncePin(which);                            // 위치 조정도 피드백
      });
      PIN[which].marker = m;
    } else {
      PIN[which].marker.setLngLat(cam.center);
    }
    bouncePin(which);                                // 핀 통통 튀기기

    // UI 갱신
    const tag = which === 'start' ? 'start-tag' : 'end-tag';
    const grab = which === 'start' ? 'set-start' : 'set-end';
    const src = which === 'start' ? 'pin-start' : 'pin-end';
    const go = which === 'start' ? 'go-start' : 'go-end';
    $(tag).textContent = '지정됨';
    $(grab).classList.add('done');
    $(src).classList.add('done');
    flash($(grab)); flash($(src));                   // 버튼·칩 반짝
    $(go).disabled = false;
    setMarkerLabel(PIN[which].marker.getElement(), PIN[which].label);   // 라벨 표시
    ensureLocMoveHook(); updateLocLabelSides();
    updatePinGhost();                                // 영상 미표시(체크 해제)면 흐리게
  }

  $('set-start').addEventListener('click', () => setPoint('start', null));
  $('set-end').addEventListener('click', () => setPoint('end', null));
  $('go-start').addEventListener('click', () => startCam && map.jumpTo(startCam));
  $('go-end').addEventListener('click', () => endCam && map.jumpTo(endCam));
  $('label-start').addEventListener('input', (e) => { PIN.start.label = e.target.value; if (PIN.start.marker) { setMarkerLabel(PIN.start.marker.getElement(), e.target.value); updateLocLabelSides(); } });
  $('label-end').addEventListener('input',   (e) => { PIN.end.label   = e.target.value; if (PIN.end.marker)   { setMarkerLabel(PIN.end.marker.getElement(),   e.target.value); updateLocLabelSides(); } });

  // 핀 색상 변경 (세부 설정)
  function setPinColor(which, color) {
    PIN[which].color = color;
    const dot = $(which === 'start' ? 'pin-dot-start' : 'pin-dot-end');
    const path = dot && dot.querySelector('path');
    if (path) path.setAttribute('fill', color);   // 패널 미니 핀 색
    if (PIN[which].marker) {
      const mEl = PIN[which].marker.getElement();
      mEl.innerHTML = pinSVG(color).innerHTML;       // 지도 핀 다시 칠하기
      setMarkerLabel(mEl, PIN[which].label);          // innerHTML 교체로 지워진 라벨 복원
    }
  }
  $('pin-color-start').addEventListener('input', (e) => setPinColor('start', e.target.value));
  $('pin-color-end').addEventListener('input', (e) => setPinColor('end', e.target.value));

  // 경유지 핀 색 (전체 경유지 핀에 일괄 적용)
  function setWpColor(color) {
    WP_COLOR = color;
    // 지도 위 경유지 마커 다시 칠하기 (번호 라벨 유지)
    waypoints.forEach((w, i) => {
      if (!w.marker) return;
      const el = w.marker.getElement();
      const inner = el.querySelector('.pin-inner');
      if (inner) {
        const num = inner.querySelector('.wp-pin-num');
        const fresh = pinSVG(color);
        inner.innerHTML = fresh.querySelector('.pin-inner').innerHTML;
        if (num) inner.appendChild(num);
      }
    });
    renderWaypoints();   // 패널 칩 핀 색도 갱신
  }
  $('pin-color-wp').addEventListener('input', (e) => setWpColor(e.target.value));

  // 스타일별 기본 핀/선 색 (위성은 어두운 남색이 안 보여서 밝은 회색으로)
  const STYLE_COLORS = { satellite: '#d6dade', _default: '#0F3564' };
  let _lastStyleColor = '#0F3564';
  function applyStyleColors() {
    const styleKey = $('style-select').value;
    const color = STYLE_COLORS[styleKey] || STYLE_COLORS._default;
    if (color === _lastStyleColor) return;   // 변화 없으면 건너뜀
    _lastStyleColor = color;
    // 입력칸 값 갱신
    $('pin-color-start').value = color;
    $('pin-color-wp').value = color;
    $('pin-color-end').value = color;
    $('route-color').value = color;
    // 실제 적용
    setPinColor('start', color);
    setPinColor('end', color);
    setWpColor(color);
    applyRouteStyle();
    // 위성 스타일: 라벨 흰 글자 + 어두운 외곽선/그림자 / 그 외: 어두운 글자 + 흰 외곽선
    const sat = styleKey === 'satellite';
    LOC_HALO = sat ? '#000000' : '#ffffff';
    $('locpin-text-color').value = sat ? '#ffffff' : '#0F3564';
    refreshAllLocLabels();
  }

  // "녹화 영상에 핀 표시" 꺼져 있으면 화면 핀을 반투명 (영상엔 안 나온다는 암시)
  // 미체크(영상 미표시) 핀을 지도에서 흐리게. Mapbox가 마커 inline opacity 를 move/render 마다 덮어쓰므로
  // #map 클래스 토글 + 스타일시트 !important 규칙으로 처리한다 (inline 방식은 패닝하면 풀림).
  function updatePinGhost() {
    $('map').classList.toggle('pins-ghost',    !$('pin-in-video').checked);     // 출발·도착·경유지 핀
    $('map').classList.toggle('locpins-ghost', !$('locpin-in-video').checked);  // 위치 표시 핀
  }
  $('pin-in-video').addEventListener('change', updatePinGhost);
  // '위치 핀 표시' 체크 시에만 위치 핀 컨트롤 펼침 (route-on→route-opts 패턴)
  function updateLocpinField() { $('locpin-field').style.display = $('locpin-in-video').checked ? 'block' : 'none'; }
  $('locpin-in-video').addEventListener('change', () => { updatePinGhost(); updateLocpinField(); });
  updatePinGhost();   // 초기 상태
  updateLocpinField();

  // 드래그용 핀 이미지 (라운드 박스 대신 핀 아이콘만 따라다니게)
  function makeDragPin(color) {
    // 캔버스로 드래그 이미지 생성 — 투명 DOM 요소는 크롬이 다크 배경에 합성해 박스가 보여서 캔버스(자체 알파)로 그린다.
    const cv = document.createElement('canvas');
    cv.width = 32; cv.height = 44;
    const ctx = cv.getContext('2d');
    ctx.scale(32/28, 44/38);          // viewBox 28×38 → 32×44 (SVG와 동일 스케일)
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(14,0); ctx.bezierCurveTo(6.3,0,0,6.3,0,14); ctx.bezierCurveTo(0,24,14,38,14,38);
    ctx.bezierCurveTo(14,38,28,24,28,14); ctx.bezierCurveTo(28,6.3,21.7,0,14,0); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.beginPath(); ctx.arc(14,14,6,0,Math.PI*2); ctx.fill();
    cv.style.cssText = 'position:absolute; top:-1000px; left:-1000px; pointer-events:none; background:transparent;';
    document.body.appendChild(cv);
    return cv;
  }
  let _dragGhost = null;
  // 드래그 앤 드롭: 패널 핀 → 지도
  ['pin-start','pin-end'].forEach(id => {
    const which = $(id).dataset.target;
    $(id).addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', which);
      e.dataTransfer.effectAllowed = 'copy';
      // 핀만 보이는 커스텀 드래그 이미지
      _dragGhost = makeDragPin(PIN[which].color);
      e.dataTransfer.setDragImage(_dragGhost, 16, 44);
      $('drop-hint').classList.add('show');         // 안내 문구 표시
    });
    $(id).addEventListener('dragend', () => {
      $('drop-hint').classList.remove('show');      // 끝나면 숨김
      if (_dragGhost) { _dragGhost.remove(); _dragGhost = null; }
    });
  });
  // 위치 표시 핀 드래그 시작 (색은 locpin-color 입력값)
  $('pin-loc').addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('text/plain', 'loc');
    e.dataTransfer.effectAllowed = 'copy';
    _dragGhost = makeDragPin($('locpin-color').value || '#F17D38');
    e.dataTransfer.setDragImage(_dragGhost, 16, 44);
    $('drop-hint').classList.add('show');
  });
  $('pin-loc').addEventListener('dragend', () => {
    $('drop-hint').classList.remove('show');
    if (_dragGhost) { _dragGhost.remove(); _dragGhost = null; }
  });
  const mapEl = $('map');
  mapEl.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
  mapEl.addEventListener('drop', (e) => {
    e.preventDefault();
    $('drop-hint').classList.remove('show');
    const data = e.dataTransfer.getData('text/plain');
    const rect = mapEl.getBoundingClientRect();
    const pt = [e.clientX - rect.left, e.clientY - rect.top];
    const lngLat = map.unproject(pt);              // 픽셀 → 지도 좌표
    if (data === 'start' || data === 'end') {
      setPoint(data, lngLat);
    } else if (data.startsWith('wp:')) {
      setWaypoint(+data.slice(3), lngLat);
    } else if (data === 'loc') {
      addLocPin(lngLat);
    }
  });

  /* ── 경유지 (최대 3) ── */
  const MAX_WP = 3;
  const waypoints = []; // [{ cam: null|{...}, hold: 2, marker: null }]
  let WP_COLOR = '#0F3564';  // 경유지 핀 기본색 (세부 설정에서 변경)

  // 경유지 마커 생성/이동
  function wpMarker(i) {
    const w = waypoints[i];
    if (!w.cam) return;
    if (!w.marker) {
      const el = pinSVG(WP_COLOR);
      // 번호 라벨
      const lab = document.createElement('div');
      lab.className = 'wp-pin-num'; lab.textContent = (i+1);
      el.querySelector('.pin-inner').appendChild(lab);
      const m = new mapboxgl.Marker({ element: el, anchor: 'bottom', draggable: true })
        .setLngLat(w.cam.center).addTo(map);
      m.on('dragend', () => { const ll = m.getLngLat(); w.cam.center = [ll.lng, ll.lat]; bounceEl(el); });
      w.marker = m;
    } else {
      w.marker.setLngLat(w.cam.center);
      // 번호 갱신
      const lab = w.marker.getElement().querySelector('.wp-pin-num');
      if (lab) lab.textContent = (i+1);
    }
  }
  function bounceEl(el) { el.classList.remove('bounce'); void el.offsetWidth; el.classList.add('bounce'); }
  function refreshWpMarkers() { waypoints.forEach((_, i) => wpMarker(i)); }

  // 경유지 지점 지정 (lngLat 있으면 드롭, 없으면 현재 화면)
  function setWaypoint(i, lngLat) {
    const w = waypoints[i];
    const cam = grabCam();
    if (lngLat) cam.center = [lngLat.lng, lngLat.lat];
    else if (w.cam) cam.center = w.cam.center;     // 현재 화면 버튼: 위치 유지, 줌만
    w.cam = cam;
    wpMarker(i);
    if (w.marker) { bounceEl(w.marker.getElement()); setMarkerLabel(w.marker.getElement(), w.label); }
    ensureLocMoveHook();
    renderWaypoints();
    updateLocLabelSides();
    updatePinGhost();                                // 영상 미표시(체크 해제)면 흐리게
  }

  function renderWaypoints() {
    const box = $('waypoint-list'); box.innerHTML = '';
    waypoints.forEach((w, i) => {
      const row = document.createElement('div');
      row.className = 'wp-row';
      row.innerHTML =
        `<span class="wp-ctl wp-pin${w.cam?' done':''}" draggable="true" data-i="${i}" title="지도로 끌어다 놓기">` +
          `<svg viewBox="0 0 28 38" width="13" height="18"><path d="M14 0C6.3 0 0 6.3 0 14c0 10 14 24 14 24s14-14 14-24C28 6.3 21.7 0 14 0z" fill="${WP_COLOR}"/><circle cx="14" cy="14" r="6" fill="rgba(255,255,255,.9)"/></svg>` +
          ` ${i+1}</span>` +
        `<input type="text" class="wp-ctl wp-label pin-label-in" data-i="${i}" value="${escAttr(w.label||'')}" placeholder="라벨" autocomplete="off" />` +
        `<button type="button" class="wp-ctl wp-set set-view${w.cam?' done':''}" data-i="${i}" title="현재 화면으로 지정"><svg class="vf-ico" viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 7V3h4M13 3h4v4M17 13v4h-4M7 17H3v-4"/></svg></button>` +
        `<span class="set-tag">${w.cam?'지정됨':''}</span>` +
        `<button type="button" class="wp-ctl wp-del" data-i="${i}" title="제거">✕</button>`;
      box.appendChild(row);
    });
    $('add-waypoint').style.display = (waypoints.length >= MAX_WP) ? 'none' : 'block';
    renderGotoButtons();
    renderHoldList();
  }

  // 세부 설정의 경유지 정지 시간 목록
  function renderHoldList() {
    const sec = $('wp-hold-section'), list = $('wp-hold-list');
    if (!waypoints.length) { sec.style.display = 'none'; list.innerHTML = ''; return; }
    sec.style.display = 'block';
    list.innerHTML = '';
    waypoints.forEach((w, i) => {
      const row = document.createElement('div');
      row.className = 'wp-hold-row';
      row.innerHTML =
        `<span class="wp-hold-label">경유지${i+1}</span>` +
        `<span class="wp-hold-wrap"><input type="number" class="wp-hold" data-i="${i}" min="0" step="0.5" value="${w.hold}" title="정지 시간(초)" /><span class="wp-sec">초</span></span>`;
      list.appendChild(row);
    });
  }
  $('wp-hold-list').addEventListener('input', (e) => {
    const inp = e.target.closest('.wp-hold'); if (!inp) return;
    waypoints[+inp.dataset.i].hold = Math.max(0, parseFloat(inp.value) || 0);
  });

  // 출발로/도착으로 사이의 경유지 이동 버튼들
  function renderGotoButtons() {
    const wrap = $('wp-goto'); wrap.innerHTML = '';
    waypoints.forEach((w, i) => {
      const b = document.createElement('button');
      b.textContent = `경유지${i+1}`;
      b.dataset.go = i;
      b.disabled = !w.cam;
      wrap.appendChild(b);
    });
  }
  $('wp-goto').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const i = +b.dataset.go;
    if (waypoints[i] && waypoints[i].cam) map.jumpTo(waypoints[i].cam);
  });

  $('add-waypoint').addEventListener('click', () => {
    if (waypoints.length >= MAX_WP) return;
    waypoints.push({ cam: null, hold: 2, marker: null, label: '' });
    renderWaypoints();
  });
  $('waypoint-list').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const i = +b.dataset.i;
    if (b.classList.contains('wp-set')) { setWaypoint(i, null); }
    else if (b.classList.contains('wp-del')) {
      const w = waypoints[i];
      if (w.marker) { w.marker.remove(); }
      waypoints.splice(i, 1);
      renderWaypoints(); refreshWpMarkers();   // 남은 핀 번호 갱신
      updateLocLabelSides();
    }
  });
  // 경유지 라벨 입력 (목록 재렌더 없이 마커 라벨만 갱신 → 포커스 유지)
  $('waypoint-list').addEventListener('input', (e) => {
    const inp = e.target.closest('.wp-label'); if (!inp) return;
    const i = +inp.dataset.i, w = waypoints[i]; if (!w) return;
    w.label = inp.value;
    if (w.marker) { setMarkerLabel(w.marker.getElement(), w.label); updateLocLabelSides(); }
  });
  // 경유지 핀 드래그 시작
  $('waypoint-list').addEventListener('dragstart', (e) => {
    const p = e.target.closest('.wp-pin'); if (!p) return;
    e.dataTransfer.setData('text/plain', 'wp:' + p.dataset.i);
    e.dataTransfer.effectAllowed = 'copy';
    _dragGhost = makeDragPin(WP_COLOR);
    e.dataTransfer.setDragImage(_dragGhost, 16, 44);
    $('drop-hint').classList.add('show');
  });
  $('waypoint-list').addEventListener('dragend', () => {
    $('drop-hint').classList.remove('show');
    if (_dragGhost) { _dragGhost.remove(); _dragGhost = null; }
  });

  /* ── 위치 표시 핀 (영상용, 카메라 경로와 무관) ── */
  const locPins = [];               // [{ lngLat:[lng,lat], color, text, marker }]
  let _locMoveHooked = false;

  function ensureLocMoveHook() { if (_locMoveHooked) return; _locMoveHooked = true; map.on('move', updateLocLabelSides); }

  // 마커 DOM 라벨 스타일 (미리보기 — 업로드 폰트/크기/색 반영)
  function applyLocLabelStyle(el) {
    const lbl = el.querySelector('.loc-label'); if (!lbl) return;
    lbl.style.fontFamily = LOC_FONT_FAMILY ? `'${LOC_FONT_FAMILY}', sans-serif` : '';
    lbl.style.fontSize = (Math.max(8, parseInt($('locpin-text-size').value, 10) || 16)) + 'px';
    lbl.style.color = $('locpin-text-color').value || '#000';
    lbl.style.textShadow = `0 0 3px ${LOC_HALO}, 0 0 3px ${LOC_HALO}, 0 0 2px ${LOC_HALO}`;
  }
  // 마커 요소에 라벨 텍스트 적용 (모든 핀 공통)
  function setMarkerLabel(el, text) {
    if (!el) return;
    let lbl = el.querySelector('.loc-label');
    if (!lbl) { lbl = document.createElement('div'); lbl.className = 'loc-label'; el.appendChild(lbl); }
    lbl.textContent = text || '';
    applyLocLabelStyle(el);
  }
  // 모든 핀 마커 순회 → fn(el, lngLat, labelText) (출발/도착/경유지/위치)
  function eachPinMarker(fn) {
    if (PIN.start.marker) fn(PIN.start.marker.getElement(), PIN.start.marker.getLngLat(), PIN.start.label);
    if (PIN.end.marker)   fn(PIN.end.marker.getElement(),   PIN.end.marker.getLngLat(),   PIN.end.label);
    waypoints.forEach(w => { if (w.marker) fn(w.marker.getElement(), w.marker.getLngLat(), w.label); });
    locPins.forEach(p => { if (p.marker) fn(p.marker.getElement(), p.marker.getLngLat(), p.text); });
  }
  function updateLocLabelEl(i) { const p = locPins[i]; if (p && p.marker) setMarkerLabel(p.marker.getElement(), p.text); }
  // 화면 좌/우 절반에 따라 라벨 위치 — 모든 핀 (왼쪽 절반→왼쪽, 오른쪽 절반→오른쪽)
  function updateLocLabelSides() {
    const cx = (map.getContainer().clientWidth || 0) / 2;
    eachPinMarker((el, ll) => {
      const left = map.project(ll).x < cx;
      el.classList.toggle('label-left', left);
      el.classList.toggle('label-right', !left);
    });
  }
  function refreshAllLocLabels() { eachPinMarker((el, ll, text) => setMarkerLabel(el, text)); updateLocLabelSides(); }

  function addLocPin(lngLat) {
    const ll = (lngLat && lngLat.lng != null) ? [lngLat.lng, lngLat.lat] : [lngLat[0], lngLat[1]];
    const color = $('locpin-color').value || '#F17D38';
    const el = pinSVG(color); el.classList.add('loc-pin');
    const m = new mapboxgl.Marker({ element: el, anchor:'bottom', draggable:true })
      .setLngLat(ll).addTo(map);
    const rec = { lngLat: ll, color, text: '', marker: m };
    m.on('dragend', () => { const p = m.getLngLat(); rec.lngLat = [p.lng, p.lat]; bounceEl(el); updateLocLabelSides(); renderLocPins(); });
    locPins.push(rec);
    ensureLocMoveHook();
    updateLocLabelEl(locPins.length - 1);
    updateLocLabelSides();
    bounceEl(el);
    renderLocPins();
    updatePinGhost();                                // 영상 미표시(체크 해제)면 흐리게
  }
  function renderLocPins() {
    const box = $('locpin-list'); if (!box) return;
    box.innerHTML = '';
    locPins.forEach((p, i) => {
      const row = document.createElement('div');
      row.className = 'wp-row';
      row.innerHTML =
        `<span class="wp-pin done" style="cursor:default; position:relative;">` +
          `<svg viewBox="0 0 28 38" width="13" height="18"><path d="M14 0C6.3 0 0 6.3 0 14c0 10 14 24 14 24s14-14 14-24C28 6.3 21.7 0 14 0z" fill="${p.color}"/><circle cx="14" cy="14" r="6" fill="rgba(255,255,255,.9)"/></svg>` +
          ` ${i+1}</span>` +
        `<input type="text" class="loc-text" data-i="${i}" value="${escAttr(p.text || '')}" placeholder="라벨 (예: 서울) — 비우면 핀만" style="flex:1; font-size:11px;" title="${p.lngLat[1].toFixed(4)}, ${p.lngLat[0].toFixed(4)}" />` +
        `<button type="button" class="wp-ctl wp-del" data-i="${i}" title="제거">✕</button>`;
      box.appendChild(row);
    });
  }
  $('locpin-list').addEventListener('input', (e) => {
    const inp = e.target.closest('.loc-text'); if (!inp) return;
    const i = +inp.dataset.i; if (!locPins[i]) return;
    locPins[i].text = inp.value;
    updateLocLabelEl(i);            // 마커 라벨만 갱신 (목록 재렌더 X → 포커스 유지)
  });
  $('locpin-list').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const i = +b.dataset.i;
    if (b.classList.contains('wp-del')) {
      const p = locPins[i]; if (p && p.marker) p.marker.remove();
      locPins.splice(i, 1); renderLocPins(); updateLocLabelSides();
    }
  });
  $('locpin-add').addEventListener('click', () => addLocPin(map.getCenter()));

  // ── 라벨 폰트 ──
  // 팀 공용 기본 폰트: assets/fonts 의 파일을 받아서 자동 적용. 교체하려면 아래 url 만 바꾸면 됨.
  const EMBEDDED_LABEL_FONT = { name: '기본', url: '' };  // 라이선스가 확인된 팀 폰트만 연결할 것
  async function loadEmbeddedLabelFont() {
    if (!EMBEDDED_LABEL_FONT.url) return;
    try {
      const res = await fetch(EMBEDDED_LABEL_FONT.url);
      if (!res.ok) throw new Error('font ' + res.status);
      _locFontFace = new FontFace('UserPinFont', await res.arrayBuffer());
      await _locFontFace.load();
      document.fonts.add(_locFontFace);
      LOC_FONT_FAMILY = 'UserPinFont';
      // 어떤 폰트인지 패널에 적어두던 줄은 뺐다 — 고를 수 있는 게 아니라 늘 같은 값이었다.
      refreshAllLocLabels();
    } catch (_) {}
  }
  loadEmbeddedLabelFont();   // 시작 시 내장 폰트 자동 적용

  // 라벨 크기·색 (폰트는 내장 RixSinGo Pro ExtraBold 사용)
  $('locpin-text-size').addEventListener('input', refreshAllLocLabels);
  $('locpin-text-color').addEventListener('input', refreshAllLocLabels);

  // ── 포맷별 코덱 후보 ──
  const CODECS = {
    mp4:  ['video/mp4;codecs=avc1.64003E', 'video/mp4;codecs=avc1', 'video/mp4'],
    webm: ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'],
  };
  const pickMime = (fmt) => CODECS[fmt].find(m => MediaRecorder.isTypeSupported(m)) || '';
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  // 캡처 파이프라인 예열: 첫 녹화가 가끔 "데이터 비었습니다"로 나오는 문제 회피
  // (사용자가 WebM↔MP4 토글·재렌더로 발견한 동작을 짧은 더미 캡처로 자동화 — 영상에 영향 없음)
  function warmupCapture(stream, mime) {
    return new Promise((resolve) => {
      let done = false; const fin = () => { if (!done) { done = true; resolve(); } };
      try {
        const w = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 1_000_000 });
        w.ondataavailable = () => {};           // 결과는 버림 (예열 목적)
        w.onstop = fin; w.onerror = fin;
        w.start();
        setTimeout(() => { try { w.requestData(); w.stop(); } catch (_) { fin(); } }, 300);
      } catch (_) { fin(); }
      setTimeout(fin, 900);                      // 안전 타임아웃
    });
  }

  // WebCodecs H.264 하드웨어 인코더 예열 — "부드럽게 녹화를 먼저 돌리면 실시간 녹화가 풀린다"는 현상을 자동화.
  // (그게 VideoEncoder(=하드웨어 H.264) 초기화 효과로 보임. 잠깐 init→2프레임 인코딩→flush→close.)
  async function warmupEncoder() {
    if (typeof VideoEncoder === 'undefined') return;   // WebCodecs 미지원이면 건너뜀
    let enc = null;
    try {
      const cv = map.getCanvas();
      let W = cv.width - (cv.width % 2), H = cv.height - (cv.height % 2);
      const MAXPIX = 9437184, codedPix = (w,h) => Math.ceil(w/16)*16 * Math.ceil(h/16)*16;
      let g = 0; while (codedPix(W, H) > MAXPIX && g++ < 8) { const s = Math.sqrt(MAXPIX/codedPix(W, H)) * 0.99; W = Math.max(2, Math.floor(W*s/2)*2); H = Math.max(2, Math.floor(H*s/2)*2); }
      if (W < 2 || H < 2) return;
      let codec = 'avc1.640028';
      try { const sup = await VideoEncoder.isConfigSupported({ codec, width:W, height:H, bitrate:8_000_000, framerate:30 }); if (!sup || !sup.supported) codec = 'avc1.640034'; } catch (_) {}
      enc = new VideoEncoder({ output: () => {}, error: () => {} });
      enc.configure({ codec, width:W, height:H, bitrate:8_000_000, framerate:30 });
      let src = cv;
      if (W !== cv.width || H !== cv.height) { const t = Object.assign(document.createElement('canvas'), {width:W, height:H}); t.getContext('2d').drawImage(cv, 0, 0, W, H); src = t; }
      for (let i = 0; i < 2; i++) { const vf = new VideoFrame(src, { timestamp: i*33333, duration: 33333 }); enc.encode(vf, { keyFrame: i === 0 }); vf.close(); }
      await enc.flush();
    } catch (_) {}
    try { if (enc && enc.state !== 'closed') enc.close(); } catch (_) {}
  }

  // 지원되는 포맷만 드롭다운에 채움 (mp4 우선)
  (function fillFormats() {
    const sel = $('format'); sel.innerHTML = '';
    if (pickMime('mp4'))  sel.add(new Option('MP4 (H.264)', 'mp4'));
    if (pickMime('webm')) sel.add(new Option('WebM (VP9)', 'webm'));
    if (!sel.options.length) sel.add(new Option('지원 포맷 없음', ''));
  })();
  const syncRecordFormatLabel = () => {
    const label = $('record-format-label');
    const modeLabel = $('record-mode-label');
    const format = $('format').value || 'video';
    if (label) label.textContent = format === 'webm' ? 'WebM' : format.toUpperCase();
    if (modeLabel) modeLabel.textContent = format === 'mp4' ? '(경로 렌더링)' : '(실시간 녹화)';
  };
  $('format').addEventListener('change', syncRecordFormatLabel);
  syncRecordFormatLabel();

  async function record() {
    console.log('[REC] 클릭됨. startCam=', !!startCam, 'endCam=', !!endCam);
    if (busy) { console.log('[REC] busy 상태라 중단'); return; }
    if (!startCam || !endCam) { console.log('[REC] 출발/도착 미지정 → 중단'); setStatus('출발·도착 지점을 모두 지정하세요.',''); return; }
    busy = true; setUI(false);
    /* 행정구역 지오메트리는 나라별로 늦게 온다. 칠하자마자 녹화를 누르면 아직 안 왔을 수
       있고, 그러면 그 나라만 색이 빠진 영상이 나온다. 여기서 한 번 기다린다 (보통 즉시). */
    await admin1Settled();
    const durSec  = Math.max(0.5, parseFloat($('duration').value) || 4);
    const leadSec = Math.max(0,   parseFloat($('lead').value)     || 0);
    const tailSec = Math.max(0,   parseFloat($('tail').value)     || 0);
    const fps  = parseInt($('fps').value, 10);
    const mode = $('mode').value;
    const mbps = Math.max(2, parseFloat($('bitrate').value) || 16);
    const fmt  = $('format').value || 'webm';
    const mime = pickMime(fmt) || pickMime('webm');
    const ext  = (mime.indexOf('mp4') > -1) ? 'mp4' : 'webm';
    console.log('[REC] 설정: fmt=', fmt, 'mime=', mime, 'fps=', fps, 'mbps=', mbps);
    if (!mime) { console.error('[REC] 지원 코덱 없음!'); setStatus('이 브라우저가 녹화 코덱을 지원하지 않습니다.', ''); busy=false; setUI(true); return; }
    if (typeof map.getCanvas().captureStream !== 'function') { console.error('[REC] captureStream 미지원!'); setStatus('이 브라우저가 captureStream을 지원하지 않습니다.', ''); busy=false; setUI(true); return; }

    let pumping = false, pinRAF = 0, recStream = null;
    if (drawMode) exitDrawMode();          // 녹화 전 그리기 모드 해제 (지도 이동 잠금 풀기)
    const showPath = $('pin-in-video').checked, showLoc = $('locpin-in-video').checked;
    const showPins = showPath || showLoc;
    const locFirst = $('locpin-timing').value === 'first';   // 위치 핀 등장: 첫 컷 vs 마지막 컷
    const pinEls = [PIN.start.marker, PIN.end.marker, ...waypoints.map(w=>w.marker), ...locPins.map(p=>p.marker)].filter(Boolean).map(m => m.getElement());
    pinEls.forEach(el => el.style.display = 'none');     // DOM 마커는 녹화에 안 잡히므로 항상 숨김
    if (showPins) { _popLen = POP_MS; showCapturePins(showPath, showLoc); }   // 켜진 종류만 캔버스 핀으로 표시 (등장 전 size 0)
    try {
      const stops = waypoints.filter(w => w.cam); // 지정된 경유지만

      // 경로 선 준비 (체크된 경우): 도로 경로 우선, 실패 시 직선
      const drawRoute = $('route-on').checked;
      let pathCoords = [];
      if (drawRoute) {
        addRouteLayer(); applyRouteStyle();
        setRouteData([]);                                   // 미리보기 전체경로(끝 화살표) 즉시 비움 → 출발 전 도착에 삼각형 잔상 방지
        pathCoords = await resolvePathCoords();             // 도로 또는 아크 (선택에 따라)
        _routeDotStep = routeDotStep(pathCoords);            // 점선 점 간격 고정 (전체 경로 기준)
        _wpFracs = pathWpFracs(pathCoords);                  // 성장 진행도를 카메라(구간 거리)에 동기화
        setRouteData(pathCoords.length ? [pathCoords[0]] : []);
      }

      // 직접 그린 선 준비 (체크 + 그린 게 있으면): 카메라 이동에 맞춰 reveal
      const drawLinesOn = $('draw-on').checked && drawnStrokes.length > 0;
      if (drawLinesOn) { addDrawLayer(); applyDrawStyle(); setDrawVisible(true); setDrawData(0); }

      // 카메라 이동 단계 수 = 경유지 + 도착 (선은 전체 이동 시간에 걸쳐 비례 진행)
      const totalLegs = stops.length + 1;
      let legDone = 0;   // 완료된 카메라 이동 수

      /* 아크·직선을 그렸으면 카메라도 그 위를 지나게 한다.
         flyTo 는 자기 곡선으로만 움직여서 임의의 경로를 따라갈 수 없다 — 그래서 그때만
         프레임 단위로 직접 몬다(부드럽게 녹화가 늘 하는 방식). 줌 곡선은 그대로 쓴다.
         도로 경로는 여기 해당 없다 — 잘게 꺾여 따라가면 카메라가 흔들린다(요청서 7-2). */
      const followRoute = drawRoute && pathCoords.length >= 2 && $('route-shape').value !== 'road';
      const followW0 = Math.max(map.getCanvas().clientWidth, map.getCanvas().clientHeight) || 1600;
      const followCurve = flyCurveNow(mode);

      // 정수 줌에 걸터앉으면 줌아웃이 없어도 타일이 깜빡인다 (위 detailSafeZoom 참고)
      const hasDip = mode === 'fly' && $('fly-dip').value !== '0';
      const camSeq = [startCam, ...stops.map((s) => s.cam), endCam].map((c) => detailSafeCam(c, hasDip));
      let legPaths = camSeq.slice(0, -1).map(() => ({ path: null, follow: null }));

      const animateTo = async (cam) => {
        const t0 = performance.now();
        let raf = 0;
        const grow = (legT) => {
          const ct = (legDone + easeInOut(legT)) / totalLegs;   // 카메라 시간 진행
          if (drawRoute && pathCoords.length) setRouteData(partialPath(pathCoords, legFrac(legDone, easeInOut(legT), totalLegs)));   // 경로선: 거리 동기화
          if (drawLinesOn) setDrawData(ct);   // 직접 그린 선: 카메라 시간 기준
        };

        if (followRoute) {
          const from = camSeq[legDone];
          const { path: flight, follow } = legPaths[legDone] || {};
          await new Promise((resolve) => {
            const step = () => {
              const legT = Math.min(1, (performance.now() - t0) / (durSec*1000));
              const t = easeInOut(legT);
              grow(legT);
              map.jumpTo(legT >= 1 ? cam : interpCam(from, cam, t, flight, follow));
              if (legT < 1) requestAnimationFrame(step); else resolve();
            };
            requestAnimationFrame(step);
          });
        } else {
          const opts = moveOpts(cam, mode, durSec);   // 비행 곡선의 줌아웃 깊이도 여기서 결정됨
          if ((drawRoute && pathCoords.length) || drawLinesOn) {
            const tick = () => {
              const legT = Math.min(1, (performance.now() - t0) / (durSec*1000));
              grow(legT);
              if (legT < 1) raf = requestAnimationFrame(tick);
            };
            raf = requestAnimationFrame(tick);
          }
          (mode === 'fly' ? map.flyTo(opts) : map.easeTo(opts));
          await new Promise((resolve) => { let d=false; const fn=()=>{ if(!d){d=true;resolve();} }; map.once('moveend', fn); setTimeout(fn, durSec*1000+400); });
          if (raf) cancelAnimationFrame(raf);
        }
        legDone++;
        if (drawRoute && pathCoords.length) setRouteData(partialPath(pathCoords, legFrac(legDone, 0, totalLegs)));
        if (drawLinesOn) setDrawData(legDone / totalLegs);
      };

      // 1) 타일 프리로드 (모든 경유지·도착 워밍 후 출발로)
      setRasterFade(0);                              // 녹화 중 타일 크로스페이드 끔 → 페이드 도중 캡처로 생기는 줄무늬/밴딩 방지
      setLabelFade(0);                               // 라벨 페이드인 끔 → 이동 중 글자가 흐리게 잡히는 것 방지
      setStatus('타일 프리로드 중…','busy');
      map.jumpTo(camSeq[camSeq.length - 1]); await tilesSettled();
      if (showPath) bakeCapPin('end');              // 도착 핀 라벨 (도착 화면 기준 좌/우)
      /* 카메라가 따라갈 경로는 **자르기 전** 것이다. trimArcEnd 는 선을 도착핀 앞에서
         멈추려는 것이지 카메라를 멈추려는 게 아니다 — 잘린 끝까지만 따라가면 마지막
         프레임에서 도착 카메라로 점프해 화면이 튄다. 선은 잘린 것으로 그린다. */
      const camPath = pathCoords.slice();
      if (drawRoute && $('route-shape').value !== 'road' && pathCoords.length >= 2) { pathCoords = trimArcEnd(pathCoords); _wpFracs = pathWpFracs(pathCoords); }   // 아크 끝을 도착핀 앞에서 잘라둠(되돌아감 방지) — 도착 화면 줌 기준
      {
        const whole = followRoute ? pathFollower(camPath) : null;
        legPaths = camSeq.slice(0, -1).map((from, i) => {
          const flight = followCurve ? flightPath(from, camSeq[i + 1], followCurve, followW0) : null;
          if (!whole) return { path: flight, follow: null };
          const a = legFrac(i, 0, totalLegs), b = legFrac(i, 1, totalLegs);
          return { path: flight, follow: (k) => whole(a + (b - a) * k) };
        });
      }
      if (showLoc && !locFirst) bakeLocPins();      // 마지막 컷: 위치 핀 라벨 (도착 화면 기준)
      for (let k = 0; k < stops.length; k++) { map.jumpTo(stops[k].cam); await tilesSettled(); if (showPath) bakeCapPin('wp'+k); }

      // 1-b) 이동 '중간' 타일까지 프리로드.
      //      여기까지는 출발·경유지·도착만 데워져 있어서, 그 사이를 지나갈 때는
      //      아직 안 받은 타일 대신 저해상도 부모 타일이 그려진다 (= 화면이 단순해 보이는 원인).
      if ($('prewarm-path').checked) await prewarmPath(camSeq, mode, durSec, legPaths);

      map.jumpTo(camSeq[0]); await tilesSettled();
      if (showPath) bakeCapPin('start');            // 출발 핀 라벨 (출발 화면 기준)
      if (showLoc && locFirst) bakeLocPins();       // 첫 컷: 위치 핀 라벨 (출발 화면 기준)
      await sleep(250);

      // 캡처 영역(프레임) 크롭 — 크롭 여부와 상관없이 '항상' 2D 캔버스를 거쳐 녹화한다.
      // 지도의 WebGL 캔버스를 captureStream으로 직접 잡으면 크롬이 "캔버스가 변했다"를 놓쳐
      // 프레임이 0개로 나오는 일이 잦다 (→ "녹화 데이터가 비었습니다").
      // 우리가 매 프레임 그리는 2D 캔버스는 그런 문제가 없다.
      const cv0 = map.getCanvas();
      const fr = frameCropRect(cv0);
      const outW = Math.max(2, ((fr.full ? cv0.width  : fr.ow) >> 1) << 1);   // 짝수 보정 (H.264 요구)
      const outH = Math.max(2, ((fr.full ? cv0.height : fr.oh) >> 1) << 1);
      const outCv  = Object.assign(document.createElement('canvas'), { width: outW, height: outH });
      const outCtx = outCv.getContext('2d', { alpha: false });

      // 2) 정지 구간에도 프레임이 빠지지 않도록 캔버스 강제 리페인트 펌프 (+ 캡처 영역 그리기 + 프레임 밀어넣기)
      pumping = true;
      let vTrack = null;                 // 수동 프레임 모드일 때의 비디오 트랙 (아래에서 채움)
      let lastPush = 0;
      const frameGap = 1000 / fps;       // 목표 fps 간격으로만 프레임을 넣어 속도가 빨라지지 않게
      const pump = () => {
        if (!pumping) return;
        requestAnimationFrame(pump);   // 다음 프레임 먼저 예약 → 아래에서 예외가 나도 펌프가 멈추지 않음
        map.triggerRepaint();
        const t = performance.now();
        if (t - lastPush < frameGap - 1) return;   // 목표 fps 간격으로만 복사·캡처 (불필요한 캔버스 블릿 방지)
        lastPush = t;
        try {
          outCtx.drawImage(cv0, fr.sx, fr.sy, fr.sw, fr.sh, 0, 0, outW, outH);
          if (vTrack) vTrack.requestFrame();       // 프레임을 직접 밀어 넣음 (자동 감지에 의존하지 않음)
        } catch (_) {}
      };
      pump();
      // 핀 팝업 애니메이션 드라이버 (매 프레임 사이즈 갱신 + 위치핀 뷰포트 진입 체크)
      const drivePins = () => {
        if (!pumping) { pinRAF = 0; return; }
        if (showPins) pushCapData(performance.now());
        pinRAF = requestAnimationFrame(drivePins);
      };
      if (showPins) drivePins();

      // frameRate 0 = 자동 캡처 끔 → requestFrame()으로 프레임을 직접 밀어 넣는다.
      // (크롬이 캔버스 변경을 감지해 주길 기다리지 않으므로 "프레임 0개"가 구조적으로 불가능)
      let stream = null;
      try {
        const s0 = outCv.captureStream(0);
        const t0 = s0.getVideoTracks()[0];
        if (t0 && typeof t0.requestFrame === 'function') { stream = s0; vTrack = t0; }
        else { try { s0.getTracks().forEach(t => t.stop()); } catch (_) {} }
      } catch (_) {}
      if (!stream) stream = outCv.captureStream(fps);   // requestFrame 미지원 브라우저 폴백 (자동 캡처)
      recStream = stream;
      console.log('[REC] captureStream OK, 트랙:', stream.getVideoTracks().length, '수동 프레임:', !!vTrack);
      setStatus('캡처 준비 중…','busy');
      await warmupEncoder();               // WebCodecs H.264 인코더 예열 ('부드럽게 녹화'가 풀어주던 것과 동일)
      await warmupCapture(stream, mime);   // MediaRecorder 파이프라인 예열 → 첫 시도 빈 데이터 방지
      const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: mbps*1_000_000 });
      console.log('[REC] MediaRecorder 생성 OK, state=', rec.state);
      const chunks = [];
      rec.ondataavailable = (e) => { console.log('[REC] dataavailable:', e.data.size, 'bytes'); e.data.size && chunks.push(e.data); };
      const done = new Promise((resolve) => {
        rec.onstop = () => {
          console.log('[REC] onstop 진입, 청크:', chunks.length, '총 크기:', chunks.reduce((s,c)=>s+c.size,0));
          if (!chunks.length) { setStatus('녹화 데이터가 비었습니다 — 녹화 중 다른 탭/창으로 이동하면 캡처가 멈춥니다. 계속되면 포맷을 MP4로 바꿔 경로 렌더링 저장을 사용하거나, 크롬 하드웨어 가속을 켜세요 (chrome://settings/system 후 재시작).', ''); resolve(); return; }
          const blob = new Blob(chunks, { type: mime.split(';')[0] });
          const url = URL.createObjectURL(blob);
          const name = `colormap_${new Date().toISOString().slice(0,19).replace(/[:T]/g,'')}.${ext}`;
          const a = document.createElement('a');
          a.href = url; a.download = name; a.rel = 'noopener';
          document.body.appendChild(a); a.click(); a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 60000);
          resolve();
        };
      });

      rec.start(500);   // 0.5초마다 청크 강제 수집 (빈 데이터 방지)
      console.log('[REC] 녹화 시작됨, state=', rec.state);

      // 3) 앞 정지 (시작 화면 유지) — 출발 핀 팝업
      if (showPins) { const now = performance.now(); triggerCapPin('start', now); if (locFirst) triggerLocPins(now); }   // 첫 컷이면 위치 핀도 앞 정지에 등장
      setStatus(`녹화 중 · 앞 정지 ${leadSec}s…`,'busy');
      await sleep(leadSec*1000);

      // 4) 경유지 순회: 줌 → 홀드
      for (let k = 0; k < stops.length; k++) {
        setStatus(`녹화 중 · 경유지 ${k+1} 줌…`,'busy');
        await animateTo(stops[k].cam);
        if (showPins) triggerCapPin('wp'+k, performance.now());   // 도착 시 경유지 핀 팝업
        setStatus(`녹화 중 · 경유지 ${k+1} 홀드 ${stops[k].hold}s…`,'busy');
        await sleep(stops[k].hold*1000);
      }

      // 5) 도착으로 줌
      setStatus('녹화 중 · 도착 줌…','busy');
      await animateTo(camSeq[camSeq.length - 1]);
      if (showPins) { const now = performance.now(); triggerCapPin('end', now); if (!locFirst) triggerLocPins(now); }   // 마지막 컷이면 위치 핀이 도착 컷에 등장

      // 6) 뒤 정지 (도착 화면 유지)
      setStatus(`녹화 중 · 뒤 정지 ${tailSec}s…`,'busy');
      await sleep(tailSec*1000);

      pumping = false;
      console.log('[REC] 정지 직전, 수집된 청크:', chunks.length);
      try { if (rec.state === 'recording') rec.requestData(); } catch (_) {}   // 버퍼된 마지막 데이터 flush
      rec.stop(); await done;
      console.log('[REC] 완료');
      setStatus(`저장 준비 완료 ✓ (.${ext} 다운로드)`,'done');
    } catch (err) {
      pumping = false; console.error(err); setStatus('오류: ' + err.message, '');
    } finally {
      // 캡처 트랙을 반드시 정리 — 안 끊으면 녹화할 때마다 살아있는 캔버스 캡처 트랙이 쌓여 다음 녹화가 불안정해진다
      try { if (recStream) recStream.getTracks().forEach(t => t.stop()); } catch (_) {}
      recStream = null;
      busy = false; setUI(true); if (pinRAF) cancelAnimationFrame(pinRAF); hideCapturePins(); refreshDrawPreview(); applyRasterFade(); restoreLabelFade(); pinEls.forEach(el => el.style.display = '');
    }
  }
  /* ── 부드럽게 녹화 (오프라인: 프레임 단위 렌더 → 캡처) ── */
  /* ── 카메라 보간 헬퍼 ──

     '부드럽게 녹화'는 flyTo 를 돌리지 않는다. 프레임마다 jumpTo 로 세워 놓고 타일이
     다 도착할 때까지 기다렸다 찍는다 — 이동 중 저해상도 부모 타일이 잡히던 문제를
     그렇게 없앴다. 그 대신 카메라 궤적을 **직선 보간**으로 대신했고, 그래서 비행 곡선이
     통째로 빠졌다. 출발·도착 줌이 같으면 줌이 처음부터 끝까지 고정이라
     '이동 중 줌아웃' 설정이 이 모드에서만 아무 반응이 없었다.

     그래서 flyTo 의 곡선(van Wijk)을 여기서 직접 계산한다. mapbox-gl v3.13.0 의
     flyTo 를 그대로 옮긴 것이다:
       ρ = curve, w₀ = 화면 긴 변, w₁ = w₀/2^(도착줌-출발줌), u₁ = 투영 픽셀 거리
       r(e) = ln(√(b²+1) − b),  b = (w₁²−w₀²+(∓)ρ⁴u₁²) / (2·(e?w₁:w₀)·ρ²·u₁)
       S = (r(1)−r(0))/ρ,  f = t·S
       줌   = 출발줌 + log₂( cosh(r₀+ρf) / cosh(r₀) )
       중심 = 투영 좌표에서 D(f) 만큼 — 직선 위를 **불균등한 속도로** 지난다
     중심을 위경도로 섞으면 안 된다. flyTo 는 투영(머케이터) 좌표에서 섞는다.

     화면 크기(w₀)에 따라 곡선 깊이가 달라지므로 실제 캔버스 크기를 쓴다. */
  const lerp = (a, b, t) => a + (b - a) * t;
  const lerpAngle = (a, b, t) => { let d = ((b - a + 540) % 360) - 180; return a + d * t; };

  const CLAMP_LAT = (lat) => Math.max(-85.051129, Math.min(85.051129, lat));
  const mercX = (lng) => (180 + lng) / 360;
  const mercY = (lat) => 0.5 - 0.25 * Math.log((1 + Math.sin(CLAMP_LAT(lat) * Math.PI / 180)) / (1 - Math.sin(CLAMP_LAT(lat) * Math.PI / 180))) / Math.PI;
  const unmercX = (x) => x * 360 - 180;
  const unmercY = (y) => (2 * Math.atan(Math.exp((0.5 - y) * 2 * Math.PI)) - Math.PI / 2) * 180 / Math.PI;

  /* 이 이동에 쓸 곡선 세기. 녹화(record)의 moveOpts 와 같은 값을 봐야 두 모드가 같은 그림을 낸다. */
  function flyCurveNow(mode) {
    if (mode !== 'fly') return null;                 // 직선(easeTo) 이동은 곡선이 없다
    const dip = $('fly-dip').value;
    if (dip === '0') return 0.01;
    return FLY_CURVES[dip] || 1.42;                  // 'auto' = mapbox 기본
  }

  /* from → to 의 비행 곡선. t(0~1) 를 카메라로 바꾸는 함수를 돌려준다.
     곡선을 못 세우면(거리 0 등) null — 부르는 쪽이 직선 보간으로 넘어간다. */
  function flightPath(from, to, curve, w0) {
    const rho = curve, T = rho * rho;
    const scale = Math.pow(2, from.zoom);
    const u1 = Math.hypot((mercX(to.center[0]) - mercX(from.center[0])) * 512 * scale,
                          (mercY(to.center[1]) - mercY(from.center[1])) * 512 * scale);
    if (!(u1 > 1e-6) || !(rho > 0)) return null;     // 제자리 이동 — 줌만 바뀐다
    const w1 = w0 / Math.pow(2, to.zoom - from.zoom);
    const r = (e) => {
      const b = (w1*w1 - w0*w0 + (e ? -1 : 1) * T*T * u1*u1) / (2 * (e ? w1 : w0) * T * u1);
      return Math.log(Math.sqrt(b*b + 1) - b);
    };
    const r0 = r(0), S = (r(1) - r0) / rho;
    if (!isFinite(S) || Math.abs(S) < 1e-9) return null;
    const sinh = (v) => (Math.exp(v) - Math.exp(-v)) / 2;
    const cosh = (v) => (Math.exp(v) + Math.exp(-v)) / 2;
    return (t) => {
      const f = t * S, k = r0 + rho * f;
      const d = w0 * ((cosh(r0) * (sinh(k) / cosh(k)) - sinh(r0)) / T) / u1;   // 0 → 1
      return {
        zoom: from.zoom + Math.log2(cosh(k) / cosh(r0)),
        d,
      };
    };
  }

  /* ── 경로를 따라가는 카메라 ──

     경로선을 아크로 그려 놓고 카메라는 최단거리로 가면, 화면에 그린 화살표가 밖으로
     벗어난다. 서울→런던에서 실제로 그랬다.

     줌은 비행 곡선 그대로 두고 **중심만 경로 위를 지나게** 한다. 곡선이 주는 진행도 d 를
     '직선을 따라 얼마나 갔나' 대신 '경로를 따라 얼마나 갔나'로 읽는 것뿐이다.
     그래서 중간에 줌아웃했다 도착에서 다시 들어오는 움직임은 그대로 살아 있다.

     도로 경로는 이렇게 하지 않는다 — 도로는 잘게 꺾여서 따라가면 카메라가 심하게 흔들린다.
     (요청서 7-2) 그건 최단거리로 가고 선만 도로를 그린다. */
  function pathFollower(coords) {
    if (!coords || coords.length < 2) return null;
    const cum = [0];
    for (let i = 1; i < coords.length; i++) cum.push(cum[i-1] + geoDist(coords[i-1], coords[i]));
    const total = cum.at(-1);
    if (!(total > 0)) return null;
    return (frac) => {
      const want = Math.max(0, Math.min(1, frac)) * total;
      let lo = 0, hi = cum.length - 1;
      while (lo < hi - 1) { const mid = (lo + hi) >> 1; if (cum[mid] <= want) lo = mid; else hi = mid; }
      const span = cum[hi] - cum[lo];
      const u = span > 0 ? (want - cum[lo]) / span : 0;
      const a = coords[lo], b = coords[hi];
      return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
    };
  }

  /* ── 정수 줌에 걸터앉지 않게 ──

     mapbox 는 정수 줌마다 다른 타일을 쓴다 — 줌 6.0 은 z6, 5.99 는 z5 이고 z5 타일에는
     애초에 이면도로가 없다. 경계를 넘는 순간 지도 디테일이 한 프레임 사이에 바뀐다.

     **줌이 정수에 정확히 걸려 있으면 줌아웃이 없어도 깜빡인다.** 카메라 줌은 곡선 공식으로
     계산되는데(zoom = 출발줌 + log₂(cosh…)) 그 값이 8 을 미세하게 오르내린다 —
     실측하면 7.999999999988 이 나온다. Math.floor 가 8 과 7 을 오가며 타일이 통째로
     바뀌고, 화면은 도로가 있다 없다 한다. 콘솔에 줌을 찍으면 내내 8.000 이라 원인이 안 보인다.

     이동 **중**에 경계를 넘는 건 문제가 안 된다 — 카메라가 움직이고 있어서 눈에 안 띈다.
     문제는 멈춰 있을 때와 그 직후다.

     그래서 출발·도착 줌이 경계에 붙어 있으면 살짝 떼어 놓는다.
       줌아웃이 있으면  아래 칸 꼭대기로  (8.0 → 7.99) — 정지 화면과 이동 초반이 같은 칸
       줌아웃이 없으면  같은 칸 안쪽으로  (8.0 → 8.01) — 칸을 안 바꾸니 디테일이 그대로
     배율로 1% 안쪽이라 구도는 사실상 그대로다. 이미 칸 안쪽(8.34 등)이면 건드리지 않는다. */
  const DETAIL_EDGE = 0.01;
  function detailSafeZoom(z, dip) {
    const frac = z - Math.floor(z);
    if (frac >= 0.05) return z;                      // 이미 칸 안쪽 — 뒤집힐 일이 없다
    return Math.floor(z) + (dip ? -DETAIL_EDGE : DETAIL_EDGE);
  }
  const detailSafeCam = (c, dip) => ({ ...c, zoom: detailSafeZoom(c.zoom, dip) });

  function interpCam(from, to, t, path, follow) {
    const p = path && path(t);
    // 중심은 투영 좌표에서 섞는다 (flyTo 와 같은 방식). 곡선이 있으면 진행도만 d 로 바꾼다.
    const k = p ? p.d : t;
    /* 따라갈 경로가 있으면 그 위의 점을 쓴다. 진행도(k)는 비행 곡선이 정한 그대로다 —
       그래야 줌아웃·줌인 타이밍과 중심 이동이 어긋나지 않는다. */
    const onPath = follow && follow(k);
    const x = lerp(mercX(from.center[0]), mercX(to.center[0]), k);
    const y = lerp(mercY(from.center[1]), mercY(to.center[1]), k);
    return {
      center: onPath || [unmercX(x), unmercY(y)],
      zoom: p ? p.zoom : lerp(from.zoom, to.zoom, t),
      bearing: lerpAngle(from.bearing || 0, to.bearing || 0, t),
      pitch: lerp(from.pitch || 0, to.pitch || 0, t),
    };
  }

  // 한 프레임 렌더 완료까지 대기 (타일 로딩 포함)
  function renderFrame(cam) {
    return new Promise((resolve) => {
      map.jumpTo(cam);
      let done = false;
      const finish = () => { if (done) return; done = true; clearTimeout(timer); map.once('render', () => resolve()); map.triggerRepaint(); };
      const check = () => {
        if (done) return;
        // loaded() 만 보면 부모(저해상도) 타일로 때운 상태에서도 통과해버린다.
        // areTilesLoaded() 까지 확인해야 그 프레임의 타일이 진짜 다 도착한 것.
        if (map.loaded() && allTilesIn() && !map.isMoving()) finish();
        else map.once('idle', check);
      };
      check();
      // 타일이 제때 안 오면 한 프레임 진행 (멈춤 방지). 프리로드로 대부분 캐시에서 나오므로
      // 이 상한에 걸리는 프레임은 드물다 — 넉넉히 잡아야 그 드문 프레임도 선명하게 나온다.
      const timer = setTimeout(finish, 2500);
    });
  }
  const grabFrame = () => new Promise((res) => map.getCanvas().toBlob(res, 'image/png'));

  async function recordSmooth() {
    if (busy) return;
    if (!startCam || !endCam) { setStatus('출발·도착 지점을 모두 지정하세요.',''); return; }
    // WebCodecs 지원 확인
    if (typeof VideoEncoder === 'undefined' || typeof Mp4Muxer === 'undefined') {
      setStatus('이 브라우저는 부드럽게 녹화(WebCodecs)를 지원하지 않습니다. 크롬 최신 버전을 쓰세요.', '');
      return;
    }
    busy = true; setUI(false);
    /* 행정구역 지오메트리는 나라별로 늦게 온다. 칠하자마자 녹화를 누르면 아직 안 왔을 수
       있고, 그러면 그 나라만 색이 빠진 영상이 나온다. 여기서 한 번 기다린다 (보통 즉시). */
    await admin1Settled();
    const durSec  = Math.max(0.5, parseFloat($('duration').value) || 4);
    const leadSec = Math.max(0,   parseFloat($('lead').value)     || 0);
    const tailSec = Math.max(0,   parseFloat($('tail').value)     || 0);
    const fps  = parseInt($('fps').value, 10);
    const mbps = Math.max(2, parseFloat($('bitrate').value) || 16);

    if (drawMode) exitDrawMode();          // 녹화 전 그리기 모드 해제
    const showPath = $('pin-in-video').checked, showLoc = $('locpin-in-video').checked;
    const showPins = showPath || showLoc;
    const locFirst = $('locpin-timing').value === 'first';   // 위치 핀 등장: 첫 컷 vs 마지막 컷
    const pinEls = [PIN.start.marker, PIN.end.marker, ...waypoints.map(w=>w.marker), ...locPins.map(p=>p.marker)].filter(Boolean).map(m => m.getElement());
    pinEls.forEach(el => el.style.display = 'none');
    if (showPins) { _popLen = Math.max(1, Math.round(POP_MS/1000*fps)); showCapturePins(showPath, showLoc); }   // 팝업 길이 = 프레임 수

    let encoder, muxer, gFrame = 0;   // gFrame: 전역 프레임 카운터 (핀 등장 타이밍 기준)
    try {
      const stops = waypoints.filter(w => w.cam);

      // 경로 선 준비
      const drawRoute = $('route-on').checked;
      let pathCoords = [];
      if (drawRoute) {
        addRouteLayer(); applyRouteStyle();
        setRouteData([]);                                   // 미리보기 전체경로(끝 화살표) 즉시 비움 → 출발 전 도착에 삼각형 잔상 방지
        pathCoords = await resolvePathCoords();
        _routeDotStep = routeDotStep(pathCoords);            // 점선 점 간격 고정 (전체 경로 기준)
        _wpFracs = pathWpFracs(pathCoords);                  // 성장 진행도를 카메라(구간 거리)에 동기화
        setRouteData(pathCoords.length ? [pathCoords[0]] : []);
      }

      const drawLinesOn = $('draw-on').checked && drawnStrokes.length > 0;
      if (drawLinesOn) { addDrawLayer(); applyDrawStyle(); setDrawVisible(true); setDrawData(0); }

      // 구간 시퀀스
      /* 이동 방식·이동 중 줌아웃은 '녹화'와 같은 컨트롤을 본다. 두 모드가 다른 그림을
         내면 안 된다 — 예전에는 이 모드만 직선 보간이라 줌아웃 설정이 통째로 무시됐다.
         곡선 깊이는 화면 크기에 따라 달라지므로 실제 캔버스 긴 변을 넘긴다. */
      const smoothMode = $('mode').value;
      const curve = flyCurveNow(smoothMode);
      const w0 = Math.max(map.getCanvas().clientWidth, map.getCanvas().clientHeight) || 1600;
      const hasDip = smoothMode === 'fly' && $('fly-dip').value !== '0';   // 위 detailSafeZoom 참고
      const seq = [startCam, ...stops.map((w) => w.cam), endCam].map((c) => detailSafeCam(c, hasDip));
      const legs = [];
      for (let i = 0; i < seq.length - 1; i++) legs.push({ from: seq[i], to: seq[i+1], hold: stops[i] ? stops[i].hold : 0 });
      legs.forEach((lg) => {
        lg.path = curve ? flightPath(lg.from, lg.to, curve, w0) : null;
      });
      const totalLegs = legs.length;
      /* 아크를 그렸으면 카메라도 그 위를 지난다. 도로는 그러지 않는다 —
         잘게 꺾여서 따라가면 카메라가 심하게 흔들린다(요청서 7-2).
         경로를 **자른 뒤에** 만들어야 한다(아래 trimArcEnd 참고) — 그래서 여기서는
         조건만 정하고, 실제 연결은 자르기 다음에 한다. */
      const followRoute = drawRoute && pathCoords.length >= 2 && $('route-shape').value !== 'road';

      // 프리로드
      setRasterFade(0);                              // 녹화 중 타일 크로스페이드 끔 → 페이드 도중 캡처로 생기는 줄무늬/밴딩 방지
      setLabelFade(0);                               // 라벨 페이드인 끔 → 프레임에 글자가 흐리게 잡히는 것 방지
      setStatus('타일 프리로드 중…','busy');
      map.jumpTo(endCam); await tilesSettled();
      if (showPath) bakeCapPin('end');              // 도착 핀 라벨 (도착 화면 기준 좌/우)
      const smoothCamPath = pathCoords.slice();     // 카메라는 자르기 전 경로를 따른다
      if (drawRoute && $('route-shape').value !== 'road' && pathCoords.length >= 2) { pathCoords = trimArcEnd(pathCoords); _wpFracs = pathWpFracs(pathCoords); }   // 아크 끝을 도착핀 앞에서 잘라둠(되돌아감 방지) — 도착 화면 줌 기준
      if (followRoute) {                            // 카메라는 자르기 전 경로를 따른다 (위 참고)
        const whole = pathFollower(smoothCamPath);
        legs.forEach((lg, L) => {
          const a = legFrac(L, 0, totalLegs), b = legFrac(L, 1, totalLegs);
          lg.follow = whole ? (k) => whole(a + (b - a) * k) : null;
        });
      }
      if (showLoc && !locFirst) bakeLocPins();      // 마지막 컷: 위치 핀 라벨 (도착 화면 기준)
      for (let k = 0; k < stops.length; k++) { map.jumpTo(stops[k].cam); await tilesSettled(); if (showPath) bakeCapPin('wp'+k); }
      // 경로 타일 미리 데우기 — 각 구간 중간 시점을 훑어 타일 캐시에 올림 → 인코딩 중 프레임별 타일 로딩 대기 ↓ (화질 손실 없음)
      // 프레임 카메라와 **같은 곡선**으로 표본을 뽑아야 궤적이 정확히 일치한다 (안 그러면 엉뚱한 타일을 데운다).
      setStatus('경로 타일 프리로드 중…','busy');
      {
        const N = 12;   // 구간당 표본 수 (촘촘할수록 이동 중 화질이 균일해짐)
        for (let li = 0; li < legs.length; li++) {
          const lg = legs[li];
          for (let s = 1; s <= N; s++) {
            map.jumpTo(interpCam(lg.from, lg.to, easeInOut(s/(N+1)), lg.path, lg.follow));
            await tilesSettled();
            setStatus(`경로 타일 프리로드 중… (구간 ${li+1}/${legs.length} · ${s}/${N})`,'busy');
          }
        }
      }
      await renderFrame(seq[0]);
      if (showPath) bakeCapPin('start');            // 출발 핀 라벨 (출발 화면 기준)
      if (showLoc && locFirst) bakeLocPins();       // 첫 컷: 위치 핀 라벨 (출발 화면 기준)
      await sleep(200);

      // 캔버스 크기 (짝수로 보정 — H.264 요구사항)
      const cv = map.getCanvas();
      const fr = frameCropRect(cv);                 // 캡처 영역 크롭/출력 크기
      let W = fr.full ? (cv.width  - cv.width  % 2) : fr.ow;
      let H = fr.full ? (cv.height - cv.height % 2) : fr.oh;

      // H.264 레벨별 최대 픽셀(매크로블록) 한계에 맞춰 코덱 레벨 자동 선택 + 필요 시 축소
      // 레벨 코드(16진): 4.0=0x28, 4.1=0x29, 4.2=0x2a, 5.0=0x32, 5.1=0x33, 5.2=0x34
      const LEVELS = [
        { hex:'28', maxPix: 2097152 },   // 4.0
        { hex:'29', maxPix: 2097152 },   // 4.1
        { hex:'2a', maxPix: 2228224 },   // 4.2
        { hex:'32', maxPix: 5652480 },   // 5.0
        { hex:'33', maxPix: 9437184 },   // 5.1
        { hex:'34', maxPix: 9437184 },   // 5.2
      ];
      const MAX_PIX = 9437184;           // 레벨 5.2 한계 (약 8.8K²급)
      // H.264는 16×16 매크로블록 단위로 코딩 → 코드영역 = 16의 배수로 올림한 W·H. 이 기준으로 축소 판정.
      const codedPix = (w, h) => Math.ceil(w/16)*16 * Math.ceil(h/16)*16;
      // 너무 크면 비율 유지하며 축소 (16정렬 코드영역 기준, 재정렬 대비 루프)
      let _g = 0;
      while (codedPix(W, H) > MAX_PIX && _g++ < 8) {
        const s = Math.sqrt(MAX_PIX / codedPix(W, H)) * 0.99;
        W = Math.max(2, Math.floor(W*s/2)*2); H = Math.max(2, Math.floor(H*s/2)*2);
        console.log('[SMOOTH] 해상도 축소:', W, 'x', H, '(코드영역', codedPix(W,H), ')');
      }
      const pix = codedPix(W, H);
      const lvl = LEVELS.find(l => pix <= l.maxPix) || LEVELS[LEVELS.length-1];
      const codec = 'avc1.6400' + lvl.hex;   // High profile + 선택 레벨

      // 인코더가 이 설정을 지원하는지 확인 (미지원이면 레벨을 더 올려 재시도)
      let chosen = codec;
      try {
        const sup = await VideoEncoder.isConfigSupported({ codec, width: W, height: H, bitrate: mbps*1_000_000, framerate: fps, hardwareAcceleration: 'prefer-hardware' });
        if (!sup.supported) chosen = 'avc1.640034';   // 최고 레벨로 폴백
      } catch (_) { chosen = 'avc1.640034'; }

      // 하드웨어 인코더가 '실제로' 동작하는지 먼저 2프레임 시험 인코딩으로 확인.
      // isConfigSupported가 true여도 환경에 따라 configure/encode가 곧바로 실패하는데,
      // 그러면 encoder가 closed 상태가 되어 모든 프레임이 조용히 버려진다(=빈 영상). 실패 시 소프트웨어로 폴백.
      const probeAccel = async (accel) => {
        let e = null;
        try {
          e = new VideoEncoder({ output: () => {}, error: () => {} });
          e.configure({ codec: chosen, width: W, height: H, bitrate: mbps*1_000_000, framerate: fps, hardwareAcceleration: accel });
          const c = Object.assign(document.createElement('canvas'), { width: W, height: H });
          c.getContext('2d').fillRect(0, 0, 2, 2);
          for (let i = 0; i < 2; i++) { const vf = new VideoFrame(c, { timestamp: i*33333, duration: 33333 }); e.encode(vf, { keyFrame: i === 0 }); vf.close(); }
          await e.flush();
          return true;
        } catch (err) { console.warn('[SMOOTH] 인코더 시험 실패:', accel, err && err.message); return false; }
        finally { try { if (e && e.state !== 'closed') e.close(); } catch (_) {} }
      };
      setStatus('인코더 준비 중…','busy');
      const accel = (await probeAccel('prefer-hardware')) ? 'prefer-hardware'
                  : (await probeAccel('no-preference'))  ? 'no-preference' : null;
      if (!accel) throw new Error('H.264 인코더를 초기화할 수 없습니다. 크롬 하드웨어 가속을 켜거나(chrome://settings/system) 최신 버전으로 업데이트하세요.');
      if (accel !== 'prefer-hardware') console.warn('[SMOOTH] 하드웨어 인코더 사용 불가 → 소프트웨어 인코딩');

      // mp4-muxer + VideoEncoder 설정
      muxer = new Mp4Muxer.Muxer({
        target: new Mp4Muxer.ArrayBufferTarget(),
        video: { codec: 'avc', width: W, height: H },
        fastStart: 'in-memory',
      });
      let encErr = null, encChunks = 0;
      encoder = new VideoEncoder({
        output: (chunk, meta) => { encChunks++; muxer.addVideoChunk(chunk, meta); },
        error: (e) => { console.error(e); encErr = e; },   // 여기서 멈추지 않고, 아래 flush 전에 한 번에 보고
      });
      encoder.configure({ codec: chosen, width: W, height: H, bitrate: mbps*1_000_000, framerate: fps, hardwareAcceleration: accel });

      // 캔버스 실제 크기와 인코딩 크기가 다르면(축소된 경우) 리샘플용 오프스크린 캔버스
      const needResize = !fr.full || (W !== cv.width || H !== cv.height);
      const rcv = needResize ? Object.assign(document.createElement('canvas'), { width: W, height: H }) : null;
      const rctx = rcv ? rcv.getContext('2d') : null;

      const usPerFrame = 1_000_000 / fps;   // 프레임당 마이크로초
      let frameIdx = 0;
      // 한 프레임 인코딩 (정확한 타임스탬프 부여 → 길이 정확)
      const encodeFrame = async (keyFrame=false) => {
        if (encoder.state === 'closed') return;   // 인코더 오류로 닫혔으면 더 인코딩하지 않음 (연쇄 오류 방지)
        let src = cv;
        if (needResize) { rctx.drawImage(cv, fr.sx, fr.sy, fr.sw, fr.sh, 0, 0, W, H); src = rcv; }  // 크롭/축소 리샘플
        // 캔버스에서 곧바로 VideoFrame 생성 (createImageBitmap 단계 생략 → 프레임당 복사·대기 절감)
        const vf = new VideoFrame(src, { timestamp: Math.round(frameIdx * usPerFrame), duration: Math.round(usPerFrame) });
        encoder.encode(vf, { keyFrame: keyFrame || (frameIdx % (fps*2) === 0) });
        vf.close();
        frameIdx++;
        // 인코더가 밀리지 않도록 가끔 양보
        if (encoder.encodeQueueSize > 8) { while (encoder.encodeQueueSize > 4) await sleep(4); }
      };

      // 한 프레임만 다시 렌더 (카메라 고정, 핀 사이즈 변화 반영용)
      const renderOnce = () => new Promise((res) => { map.once('render', res); map.triggerRepaint(); });
      // 정지 구간: 기본은 한 번 렌더 후 n번 인코딩(빠름). 핀이 팝업 중인 프레임만 다시 렌더.
      const holdEnc = async (cam, n, label) => {
        if (n <= 0) return;
        await renderFrame(cam);
        for (let i = 0; i < n; i++) {
          if (showPins) {
            const fc = capPinFC(gFrame);                        // 사이즈 계산 + 변화 감지 (1회)
            if (_capChanged) { map.getSource('capture-pins').setData(fc); await renderOnce(); }
          }
          await encodeFrame(i === 0);
          gFrame++;
          if (label && i % 5 === 0) setStatus(`${label} ${Math.round(i/fps*10)/10}s`,'busy');
        }
      };

      const leadFrames = Math.round(leadSec * fps);
      const tailFrames = Math.round(tailSec * fps);
      const legFrames  = Math.round(durSec * fps);

      // 앞 정지 — 출발 핀 팝업 (gFrame=0 부터)
      if (showPins) { triggerCapPin('start', gFrame); if (locFirst) triggerLocPins(gFrame); }   // 첫 컷이면 위치 핀도 앞 정지에 등장
      await holdEnc(seq[0], leadFrames, '부드럽게 · 앞 정지');

      // 구간 보간
      for (let L = 0; L < legs.length; L++) {
        const { from, to, hold, path, follow } = legs[L];
        for (let f = 1; f <= legFrames; f++) {
          const t = easeInOut(f / legFrames);
          if (showPins) map.getSource('capture-pins').setData(capPinFC(gFrame));   // 핀 사이즈 갱신
          if (drawRoute && pathCoords.length) setRouteData(partialPath(pathCoords, legFrac(L, t, totalLegs)));
          if (drawLinesOn) setDrawData((L + t) / totalLegs);
          await renderFrame(interpCam(from, to, t, path, follow));   // setData 반영된 프레임 캡처
          await encodeFrame(f === 1);
          gFrame++;
          if (f % 3 === 0) setStatus(`부드럽게 · 구간 ${L+1}/${legs.length} (${Math.round(f/legFrames*100)}%)`,'busy');
        }
        if (drawRoute && pathCoords.length) setRouteData(partialPath(pathCoords, legFrac(L, 1, totalLegs)));
        if (drawLinesOn) setDrawData((L+1)/totalLegs);
        if (showPins) {
          triggerCapPin(L < stops.length ? ('wp'+L) : 'end', gFrame);   // 도착 → 해당 핀 팝업
          if (L === stops.length && !locFirst) triggerLocPins(gFrame);  // 마지막 컷이면 위치 핀이 도착 컷에 등장
        }
        await holdEnc(to, Math.round((hold || 0) * fps), `부드럽게 · 경유지 ${L+1} 홀드`);
      }

      // 뒤 정지
      await holdEnc(endCam, tailFrames, '부드럽게 · 뒤 정지');

      // 마무리: 인코더 비우고 mp4 완성
      setStatus('인코딩 마무리 중…','busy');
      if (encErr) throw new Error('인코더 오류: ' + (encErr.message || encErr) + ' — 크롬 하드웨어 가속 설정을 확인하세요.');
      await encoder.flush();
      if (!encChunks) throw new Error('인코딩된 프레임이 없습니다. 크롬 하드웨어 가속을 켜거나(chrome://settings/system 후 재시작) 화질(비트레이트)을 낮춰 다시 시도하세요.');
      muxer.finalize();
      const { buffer } = muxer.target;
      const blob = new Blob([buffer], { type: 'video/mp4' });
      const url = URL.createObjectURL(blob);
      const name = `colormap_smooth_${new Date().toISOString().slice(0,19).replace(/[:T]/g,'')}.mp4`;
      const a = document.createElement('a');
      a.href = url; a.download = name; a.rel = 'noopener';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);

      const totalFrames = leadFrames + tailFrames + legs.reduce((s,l)=>s+legFrames+Math.round((l.hold||0)*fps),0);
      setStatus(`저장 준비 완료 ✓ (.mp4 · ${(totalFrames/fps).toFixed(1)}초)`,'done');
    } catch (err) {
      console.error(err); setStatus('오류: ' + err.message, '');
      try { if (encoder && encoder.state !== 'closed') encoder.close(); } catch (_) {}
    } finally {
      busy = false; setUI(true); hideCapturePins(); refreshDrawPreview(); applyRasterFade(); restoreLabelFade(); pinEls.forEach(el => el.style.display = '');
    }
  }
  // MP4는 프레임 단위 경로 렌더링을 기본으로 사용한다. WebM 선택 시 기존 실시간 녹화를 유지한다.
  $('record').addEventListener('click', () => $('format').value === 'webm' ? record() : recordSmooth());

  // 현재 지도 → PNG 저장 (preserveDrawingBuffer 덕분에 캔버스 그대로 추출)
  $('capture-png').addEventListener('click', () => {
    if (busy) return;
    /* 핀은 두 벌로 존재한다.
         mapboxgl.Marker  화면에서 보고 끌어다 놓는 DOM 요소 — 캔버스에 안 그려진다
         capture-pins     캔버스에 그려지는 심볼 레이어 — 녹화할 때만 켠다
       예전엔 캔버스만 그대로 떠서 PNG 에 핀이 통째로 빠졌다. 영상은 캔버스 핀을
       켜고 찍으니 멀쩡했고, 그래서 '영상엔 있는데 캡처엔 없는' 상태였다.
       녹화와 같은 절차를 그대로 밟아 화면에 보이는 대로 담는다. */
    const showPath = $('pin-in-video').checked, showLoc = $('locpin-in-video').checked;
    const showPins = showPath || showLoc;
    const pinEls = [PIN.start.marker, PIN.end.marker, ...waypoints.map(w => w.marker), ...locPins.map(p => p.marker)]
      .filter(Boolean).map(m => m.getElement());

    if (showPins) {
      pinEls.forEach(el => el.style.display = 'none');   // DOM 마커는 캔버스 핀과 겹치므로 숨김
      _popLen = POP_MS;
      showCapturePins(showPath, showLoc);
      // 라벨의 좌/우 배치는 핀의 화면 위치로 정해진다. 지금 화면이 곧 캡처될 화면이라 여기서 구우면 된다.
      if (showPath) {
        bakeCapPin('start'); bakeCapPin('end');
        waypoints.forEach((w, k) => { if (w.cam) bakeCapPin('wp' + k); });
      }
      if (showLoc) bakeLocPins();
      // 정지 화면이라 팝업 애니메이션은 필요 없다. 시작 시각을 팝업 길이만큼 과거로 두어 처음부터 100% 크기로.
      const now = performance.now();
      _capPins.forEach(p => { p.start = now - _popLen; });
      pushCapData(now);
    }

    const restore = () => {
      if (!showPins) return;
      hideCapturePins();
      pinEls.forEach(el => el.style.display = '');
    };
    const save = () => {
      map.getCanvas().toBlob((blob) => {
        restore();
        if (!blob) { setStatus('PNG 캡처 실패', ''); return; }
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `colormap_${new Date().toISOString().slice(0,19).replace(/[:T]/g,'')}.png`;
        a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        setStatus('PNG 저장 준비 완료 ✓', 'done');
      }, 'image/png');
    };

    if (showPins) {
      /* 심볼 레이어는 아이콘 배치(placement)가 끝나야 화면에 올라온다.
         render 한 번만 기다리면 배치 전 프레임을 떠서 핀이 빠질 수 있으므로 idle 을 기다린다.
         (idle = 로딩·배치까지 모두 끝난 상태) 혹시 idle 이 안 오면 시간제한으로 진행. */
      let done = false;
      const go = () => { if (done) return; done = true; save(); };
      map.once('idle', go);
      setTimeout(go, 1500);
      map.triggerRepaint();
    } else {
      map.once('render', save);   // 핀이 없으면 최신 프레임만 뜨면 된다
      map.triggerRepaint();
    }
  });

  /* ── PSD 저장 (레이어 분리) ──
     핀·경로선·색칠을 각각 별도 레이어로 담아 포토샵에서 따로 만질 수 있게 한다.

     레이어를 어떻게 분리하나:
       지도는 WebGL 캔버스 한 장이라 여러 번 찍어도 겹쳐 나온다. 그래서 요소를 우리가
       다시 그리는 대신, 지도 렌더러를 그대로 쓰되 매번 '남길 레이어'만 켜고 찍는다.
       배경까지 숨기면 나머지는 투명하게 나오므로 알파가 살아 있는 레이어가 된다.
       지도의 실제 렌더링을 쓰기 때문에 선 굵기·점선·라벨이 화면과 완전히 동일하다.

     ag-psd 는 이 기능에서만 쓰이므로 처음 누를 때 동적으로 불러온다 (810KB). */
  /* 한 모드를 여러 레이어가 나눠 그리는 경우가 있다 — 국가는 나머지 나라를 Mapbox 레이어가,
     남·북한을 우리 폴리곤 레이어가 그린다. prop 은 둘 다 iso_3166_1_alpha_3 로 같다. */
  const fillLayersOf = (p) => [p.layer, ...(p.id === 'country' ? [KC_LAYER] : [])];

  /* 색칠 목록을 손으로 적지 말 것. 예전에 네 개를 적어 뒀다가 남·북한 레이어가 빠졌고,
     PSD 의 '지도' 레이어에 대한민국 색칠이 함께 구워졌다 — 포토샵에서 대한민국 레이어를
     꺼도 색이 남았다. PAINTERS 에서 뽑아 쓰면 모드를 늘려도 여기가 뒤처지지 않는다. */
  const OVERLAY_LAYERS = {
    색칠: PAINTERS.flatMap(fillLayersOf),
    경로선: ['route-line-layer', 'route-dots-layer', 'route-arrow-layer', 'draw-lines-layer'],
    핀: ['capture-pins-layer'],
  };

  /* 색칠 영역은 fill-color 가 match 표현식이라, 한 곳만 남기고 나머지를 투명으로 두면
     그 지역만 그려진다. 지역별로 레이어를 나눌 때 이 방식을 쓴다.
     레이어 id·키 속성·표시 이름은 모드 정의(PAINTERS)에 이미 있으므로 그대로 빌려 쓴다
     — 여기서 따로 적어두면 모드를 늘릴 때 또 한 군데가 뒤처진다. */
  // PSD·SVG 도 한 모드를 나눠 그리는 레이어를 전부 훑어야 남·북한이 빠지지 않는다
  const COLOR_SOURCES = PAINTERS.map(p => ({
    layer: p.layer, layers: fillLayersOf(p),
    prop: p.prop, list: p.entries, keyOf: e => e.key, labelOf: e => p.label(e.key),
  }));
  // 파일명·레이어명에 쓸 안전한 이름 (빈 값이면 대체어)
  const layerName = (s, fallback) => (String(s || '').trim() || fallback).replace(/[\\/:*?"<>|]/g, '');

  let _agPsdLoading = null;
  function loadAgPsd() {
    if (window.agPsd) return Promise.resolve(window.agPsd);
    if (_agPsdLoading) return _agPsdLoading;
    _agPsdLoading = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = './recorder/js/vendor/ag-psd.js';
      s.onload = () => window.agPsd ? res(window.agPsd) : rej(new Error('agPsd 전역이 없습니다'));
      s.onerror = () => { _agPsdLoading = null; rej(new Error('recorder/js/vendor/ag-psd.js 를 불러오지 못했습니다')); };
      document.head.appendChild(s);
    });
    return _agPsdLoading;
  }

  // 렌더가 끝날 때까지 대기 (심볼 배치 포함). idle 이 안 오면 시간제한으로 진행.
  const renderSettled = (ms = 1500) => new Promise((res) => {
    let done = false;
    const go = () => { if (!done) { done = true; res(); } };
    map.once('idle', go);
    setTimeout(go, ms);
    map.triggerRepaint();
  });

  // 현재 캔버스를 ImageData 로. ag-psd 는 canvas 또는 imageData 를 받는다.
  function canvasToImageData() {
    const src = map.getCanvas();
    const c = Object.assign(document.createElement('canvas'), { width: src.width, height: src.height });
    const g = c.getContext('2d');
    g.drawImage(src, 0, 0);
    return g.getImageData(0, 0, c.width, c.height);
  }
  // 완전히 투명하면 그 레이어는 넣지 않는다 (빈 레이어가 쌓이는 것 방지)
  const hasPixels = (img) => { const d = img.data; for (let i = 3; i < d.length; i += 4) if (d[i] > 3) return true; return false; };

  /* ── 오버레이를 배경 없이(투명하게) 뽑기 ──
     레이어를 숨겨 캔버스를 투명하게 만드는 방법에 기댔더니 스타일에 따라 흰 배경이
     같이 찍혔다. 그래서 캔버스 투명도에 의존하지 않고 알파를 직접 역산한다.

     같은 화면을 검정 배경 위와 흰 배경 위에서 각각 찍으면
       검정 위:  Cb = a·C
       흰색 위:  Cw = a·C + (1-a)·255
     이므로  a = 1 - (Cw - Cb)/255,  C = Cb/a  로 원래 색과 알파가 정확히 나온다.
     반투명한 색칠 영역도 그대로 살아난다. */
  const PSD_BG_LAYER = '__psd-bg';
  function setPsdBackdrop(color) {
    if (!map.getLayer(PSD_BG_LAYER)) {
      const first = (map.getStyle().layers || [])[0];
      map.addLayer({ id: PSD_BG_LAYER, type: 'background', paint: { 'background-color': color } },
        first ? first.id : undefined);   // 맨 아래에 깔아야 오버레이가 그 위에 그려진다
    } else {
      map.setPaintProperty(PSD_BG_LAYER, 'background-color', color);
    }
  }
  const removePsdBackdrop = () => { if (map.getLayer(PSD_BG_LAYER)) map.removeLayer(PSD_BG_LAYER); };

  async function captureTransparent() {
    setPsdBackdrop('#000000'); await renderSettled(); const black = canvasToImageData();
    setPsdBackdrop('#ffffff'); await renderSettled(); const white = canvasToImageData();
    removePsdBackdrop();

    const b = black.data, w = white.data, out = new Uint8ClampedArray(b.length);
    for (let i = 0; i < b.length; i += 4) {
      // 알파는 세 채널에서 같은 값이 나오므로 평균을 써서 잡음을 줄인다
      let a = 0;
      for (let k = 0; k < 3; k++) a += 255 - (w[i+k] - b[i+k]);
      a = Math.max(0, Math.min(255, Math.round(a / 3)));
      out[i+3] = a;
      if (a === 0) continue;                       // 완전 투명하면 색은 의미 없음
      const s = 255 / a;                           // 검정 위 값은 a 가 곱해진 상태
      out[i]   = Math.min(255, Math.round(b[i]   * s));
      out[i+1] = Math.min(255, Math.round(b[i+1] * s));
      out[i+2] = Math.min(255, Math.round(b[i+2] * s));
    }
    return { width: black.width, height: black.height, data: out };
  }

  $('capture-psd').addEventListener('click', async () => {
    if (busy) return;
    busy = true; setUI(false);
    await admin1Settled();                          // 아직 안 온 행정구역이 있으면 기다린다
    const showPath = $('pin-in-video').checked, showLoc = $('locpin-in-video').checked;
    const showPins = showPath || showLoc;
    const pinEls = [PIN.start.marker, PIN.end.marker, ...waypoints.map(w => w.marker), ...locPins.map(p => p.marker)]
      .filter(Boolean).map(m => m.getElement());
    const saved = {};
    const setVis = (id, v) => { try { map.setLayoutProperty(id, 'visibility', v); } catch (_) {} };

    try {
      setStatus('PSD 라이브러리 불러오는 중…', 'busy');
      const agPsd = await loadAgPsd();

      // 캔버스 핀은 PNG 캡처와 같은 방식으로 준비 (DOM 마커는 캔버스에 안 그려짐)
      if (showPins) {
        pinEls.forEach(el => el.style.display = 'none');
        _popLen = POP_MS;
        showCapturePins(showPath, showLoc);
        if (showPath) {
          bakeCapPin('start'); bakeCapPin('end');
          waypoints.forEach((w, k) => { if (w.cam) bakeCapPin('wp' + k); });
        }
        if (showLoc) bakeLocPins();
        const now = performance.now();
        _capPins.forEach(p => { p.start = now - _popLen; });
        pushCapData(now);
      }

      /* 레이어 목록은 반드시 핀 레이어를 만든 '뒤에' 읽어야 한다.
         먼저 읽으면 capture-pins-layer 가 목록에 없어 어느 패스에서도 안 숨겨지고,
         지도·경로선 레이어에까지 핀이 같이 찍힌다. */
      const allIds = (map.getStyle().layers || []).map(l => l.id);
      allIds.forEach(id => { saved[id] = map.getLayoutProperty(id, 'visibility') || 'visible'; });
      const overlayIds = new Set(Object.values(OVERLAY_LAYERS).flat());

      // 1) 지도 — 우리 오버레이만 빼고 전부
      setStatus('지도 레이어 캡처 중…', 'busy');
      allIds.forEach(id => setVis(id, overlayIds.has(id) ? 'none' : saved[id]));
      await renderSettled();
      const layers = [{ name: '지도', imageData: canvasToImageData() }];

      /* 2) 색칠 — 지역마다 레이어 하나씩.
            fill-color 의 match 를 한 지역만 남기도록 갈아끼워 그 지역만 그린다.
            여러 개면 포토샵 폴더로 묶고, 하나뿐이면 그냥 레이어 하나로 둔다. */
      const paintBackup = [];
      const colorItems = [];
      for (const src of COLOR_SOURCES) {
        src.live = src.layers.filter(id => map.getLayer(id));       // 지금 깔려 있는 것만
        if (!src.live.length) continue;
        const list = src.list();
        if (!list.length) continue;
        src.live.forEach(id => paintBackup.push({ layer: id, value: map.getPaintProperty(id, 'fill-color') }));
        list.forEach(e => colorItems.push({ src, entry: e }));
      }
      if (colorItems.length) {
        const kids = [];
        for (let i = 0; i < colorItems.length; i++) {
          const { src, entry } = colorItems[i];
          setStatus(`색칠 ${i + 1}/${colorItems.length} 캡처 중…`, 'busy');
          allIds.forEach(id => setVis(id, src.live.includes(id) ? 'visible' : 'none'));
          // 이 지역만 칠하고 나머지는 투명 (같은 모드를 나눠 그리는 레이어 전부에)
          src.live.forEach(id => map.setPaintProperty(id, 'fill-color',
            ['match', ['get', src.prop], src.keyOf(entry), entry.color, 'rgba(0,0,0,0)']));
          const img = await captureTransparent();
          if (hasPixels(img)) kids.push({ name: layerName(src.labelOf(entry), '색칠 ' + (i + 1)), imageData: img });
        }
        paintBackup.forEach(b => map.setPaintProperty(b.layer, 'fill-color', b.value));
        if (kids.length === 1) layers.push(kids[0]);
        else if (kids.length) layers.push({ name: '색칠', opened: false, children: kids });
      }

      // 3) 경로선 — 한 덩어리로 (선·점·화살표·직접 그린 선이 하나의 그림)
      {
        const ids = OVERLAY_LAYERS.경로선.filter(id => map.getLayer(id));
        if (ids.length) {
          setStatus('경로선 캡처 중…', 'busy');
          allIds.forEach(id => setVis(id, ids.includes(id) ? 'visible' : 'none'));
          const img = await captureTransparent();
          if (hasPixels(img)) layers.push({ name: '경로선', imageData: img });
        }
      }

      /* 4) 핀 — 핀마다 레이어 하나씩.
            capture-pins 소스에 해당 핀 하나만 남겨 그린다. */
      if (showPins && map.getLayer('capture-pins-layer') && _capPins.length) {
        // 핀 레이어만 남기고 전부 숨긴다.
        // (allIds 에 capture-pins-layer 도 들어 있으므로 통째로 'none' 하면 핀까지 사라진다)
        allIds.forEach(id => setVis(id, id === 'capture-pins-layer' ? 'visible' : 'none'));
        setVis('capture-pins-layer', 'visible');   // 목록에 없던 경우까지 확실히
        const src = map.getSource('capture-pins');
        const full = capPinFC(performance.now());          // 전부 size 1 인 상태
        const kids = [];
        const label = (p, i) => {
          if (p.text) return p.text;
          if (p.key === 'start') return '출발';
          if (p.key === 'end') return '도착';
          if (p.key.startsWith('wp')) return '경유지 ' + (+p.key.slice(2) + 1);
          if (p.loc) return '위치 ' + (p.locIndex + 1);
          return '핀 ' + (i + 1);
        };
        for (let i = 0; i < full.features.length; i++) {
          setStatus(`핀 ${i + 1}/${full.features.length} 캡처 중…`, 'busy');
          src.setData({ type: 'FeatureCollection', features: [full.features[i]] });
          const img = await captureTransparent();
          if (hasPixels(img)) kids.push({ name: layerName(label(_capPins[i], i), '핀 ' + (i + 1)), imageData: img });
        }
        src.setData(full);
        if (kids.length === 1) layers.push(kids[0]);
        else if (kids.length) layers.push({ name: '핀', opened: false, children: kids });
      }

      const W = map.getCanvas().width, H = map.getCanvas().height;
      const buf = agPsd.writePsdBuffer({ width: W, height: H, children: layers });
      const blob = new Blob([buf], { type: 'image/vnd.adobe.photoshop' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `colormap_${new Date().toISOString().slice(0,19).replace(/[:T-]/g,'')}.psd`;
      a.rel = 'noopener'; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      // 폴더 안의 레이어까지 세어 실제 개수를 알린다
      const countLayers = (arr) => arr.reduce((n, l) => n + (l.children ? l.children.length : 1), 0);
      setStatus(`PSD 저장 준비 완료 ✓ (${countLayers(layers)}개 레이어: ${layers.map(l => l.name).join(', ')})`, 'done');
    } catch (err) {
      console.error(err);
      setStatus('PSD 저장 준비 중 오류: ' + err.message, '');
    } finally {
      // 레이어 표시 상태와 핀을 원래대로
      removePsdBackdrop();   // 실패해도 임시 배경 레이어는 반드시 걷어낸다
      Object.keys(saved).forEach(id => setVis(id, saved[id]));
      if (showPins) { hideCapturePins(); pinEls.forEach(el => el.style.display = ''); }
      busy = false; setUI(true);
      map.triggerRepaint();
    }
  });


  // ── 색칠한 국가/시도 영역을 현재 화면 위치·크기 그대로 SVG로 내보내기 ──
  // 화면에 렌더된 폴리곤(queryRenderedFeatures)을 map.project 로 화면 픽셀에 투영 → <path>.
  // 벡터 타일은 타일 단위로 조각나므로, 외곽링/구멍 winding 을 통일하고 fill-rule:nonzero 로 조각을 안전하게 합친다.
  $('export-svg').addEventListener('click', () => {
    if (busy) return;
    const run = () => {
      try {
        /* '현재 지도 캡처'(PNG)는 캔버스를 그대로 뽑으므로 실제 픽셀 크기다.
           레티나에서는 CSS 1280×720 이 캔버스 2560×1440 이 된다.
           반면 map.project() 는 CSS 픽셀을 돌려주므로, 그대로 쓰면 SVG 가 PNG 의
           절반 크기로 나와 포토샵에서 겹쳤을 때 위치가 안 맞는다.
           PNG 쪽 해상도에 맞춰 배율을 곱한다. */
        const cv = map.getCanvas();
        const dpr = cv.clientWidth ? (cv.width / cv.clientWidth) : 1;
        const W = Math.round(cv.width), H = Math.round(cv.height);
        const r1 = (n) => Math.round(n * 10) / 10;
        const projRing = (ring) => ring.map(c => { const p = map.project(c); return { x: p.x * dpr, y: p.y * dpr }; });
        const signedArea = (pts) => { let a = 0; for (let i=0,n=pts.length;i<n;i++){ const p=pts[i],q=pts[(i+1)%n]; a += p.x*q.y - q.x*p.y; } return a; };
        const emitRing = (pts, wantPos) => {
          if (pts.length < 3) return '';
          const seq = ((signedArea(pts) >= 0) === wantPos) ? pts : pts.slice().reverse();
          let d = 'M';
          for (let i=0;i<seq.length;i++) d += (i ? 'L' : '') + r1(seq[i].x) + ',' + r1(seq[i].y);
          return d + 'Z';
        };
        const geomToPath = (geom) => {
          const polys = geom && geom.type === 'Polygon' ? [geom.coordinates]
                      : geom && geom.type === 'MultiPolygon' ? geom.coordinates : [];
          let d = '';
          for (const poly of polys) for (let r=0;r<poly.length;r++) d += emitRing(projRing(poly[r]), r === 0);  // r0=외곽, 나머지=구멍
          return d;
        };
        const acc = [];   // { key, d, color, opacity }
        const collect = (layerId, keyProp, entryOf) => {
          if (!map.getLayer(layerId)) return;
          const byKey = {};
          for (const f of map.queryRenderedFeatures({ layers: [layerId] })) {
            const key = f.properties && f.properties[keyProp];
            const e = entryOf(key); if (!e) continue;                // 색칠 안 된 것 제외
            const d = geomToPath(f.geometry); if (!d) continue;
            (byKey[key] || (byKey[key] = { key, d: '', color: e.color, opacity: e.opacity })).d += d;
          }
          for (const k in byKey) acc.push(byKey[k]);
        };
        // 국가는 Mapbox 레이어와 우리 남·북한 레이어가 나눠 그린다 — 둘 다 훑어야 빠지지 않는다
        PAINTERS.forEach(p => fillLayersOf(p)
          .forEach(id => collect(id, p.prop, (key) => p.entries().find(x => x.key === key))));

        if (!acc.length) { setStatus('화면에 보이는 색칠 영역이 없습니다.', ''); return; }

        const stamp = new Date().toISOString().slice(0,19).replace(/[:T-]/g,'');
        const pathTag = (p) =>
          `  <path d="${p.d}" fill="${p.color}" fill-opacity="${p.opacity}" fill-rule="nonzero" data-region="${escAttr(p.key)}"/>`;
        // 파일을 나눠도 width/height/viewBox 는 같게 유지한다.
        // 그래야 편집 프로그램에서 그대로 겹쳐 올리면 원래 배치가 복원된다.
        const wrap = (inner) =>
          `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">\n${inner}\n</svg>\n`;
        const save = (text, name) => {
          const url = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml;charset=utf-8' }));
          const a = document.createElement('a');
          a.href = url; a.download = name; a.rel = 'noopener';
          document.body.appendChild(a); a.click(); a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 5000);
        };

        save(wrap(acc.map(pathTag).join('\n')), `colormap_regions_${stamp}.svg`);
        setStatus(`SVG 저장 준비 완료 ✓ (${acc.length}개 영역)`, 'done');
      } catch (err) { console.error(err); setStatus('SVG 내보내기 오류: ' + err.message, ''); }
    };
    if (map.loaded() && !map.isMoving()) run();
    else { setStatus('타일 로딩 대기 중…', 'busy'); map.once('idle', run); }
  });

  function setStatus(msg, cls){
    if (typeof window.showColorMapStatus === 'function') {
      window.showColorMapStatus(msg, cls || '');
      return;
    }
    const el = $('status');
    if (!el) return;
    el.textContent = msg;
    el.className = cls || '';
    el.hidden = !msg || msg === '대기 중';
  }
  function setUI(enabled){
    ['set-start','set-end','go-start','go-end','label-start','label-end','record','capture-png','capture-psd','export-svg','duration','lead','tail','fps','mode','bitrate','format','frame','tile-fade','pin-color-start','pin-color-wp','pin-color-end','land-color','sea-color','river-on','style-select','proj-select','zoom-slider','zoom-out','zoom-in','country-input','country-color','country-clear','country-dot','admin1-input','admin1-color','admin1-clear','admin1-dot','sido-input','sido-color','sido-clear','sido-dot','sigungu-input','sigungu-color','sigungu-clear','sigungu-dot','geo-input','geo-clear','add-waypoint','route-on','route-shape','route-dash','route-color','route-width','pin-in-video','locpin-in-video','locpin-add','locpin-color','locpin-text-size','locpin-text-color','locpin-timing','draw-on','draw-mode','draw-color','draw-width','draw-undo','draw-clear']
      .forEach(id => { $(id).disabled = !enabled; });
    document.querySelectorAll('.step, .wp-ctl, #wp-goto button, .bd-block input, .loc-text').forEach(b => { b.disabled = !enabled; });
    if (enabled){
      $('go-start').disabled = !startCam; $('go-end').disabled = !endCam;
      // 시군구·해외 행정구역 검색창은 경계 데이터를 받기 전까지 계속 잠겨 있어야 한다.
      // 위 목록이 일괄로 풀어버리므로 여기서 되돌린다.
      PAINTERS.forEach(p => { if (!p.ready()) $(`${p.id}-input`).disabled = true; });
    }
  }
}
