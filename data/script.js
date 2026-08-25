const TOKEN_FUNCTION_URL = 'https://asia-northeast3-manage-dev-tokens.cloudfunctions.net/getMapboxToken';
const PANEL_URL = './recorder/panel.html?v=3.7.15';   // index.html 의 ?v= 와 같은 값으로 유지할 것

let cachedToken = null;
let statusHideTimer = null;
let statusResetTimer = null;
let statusShowFrame = null;

async function fetchMapboxToken() {
    if (cachedToken) return cachedToken;

    const response = await fetch(TOKEN_FUNCTION_URL);
    if (!response.ok) throw new Error('Mapbox token 서버 응답이 올바르지 않습니다.');

    const data = await response.json();
    if (!data.token) throw new Error('Mapbox token이 응답에 없습니다.');

    cachedToken = data.token;
    return cachedToken;
}

async function loadControlPanel() {
    const mount = document.getElementById('colormap-ui');
    const response = await fetch(PANEL_URL, { cache: 'no-store' });
    if (!response.ok) throw new Error(`설정 패널을 불러오지 못했습니다 (${response.status}).`);

    mount.innerHTML = await response.text();
    return document.getElementById('country-selector-container');
}

function setStatus(message, className = '') {
    const status = document.getElementById('status');
    if (!status) return;

    clearTimeout(statusHideTimer);
    clearTimeout(statusResetTimer);
    if (statusShowFrame !== null) {
        cancelAnimationFrame(statusShowFrame);
        statusShowFrame = null;
    }

    const text = String(message || '').trim();
    if (!text || text === '대기 중') {
        status.className = '';
        status.hidden = true;
        return;
    }

    const tone = className || (/오류|실패|지원하지|지정하세요|비었습니다/.test(text) ? 'error' : '');
    const wasShowing = !status.hidden && status.classList.contains('show');
    status.textContent = text;
    status.className = tone;
    status.hidden = false;

    // 녹화 진행률처럼 빠른 연속 갱신은 팝업을 유지하고, 처음 나타날 때만 페이드인한다.
    if (wasShowing) {
        status.classList.add('show');
    } else {
        statusShowFrame = requestAnimationFrame(() => {
            if (!status.hidden) status.classList.add('show');
            statusShowFrame = null;
        });
    }

    const holdMs = tone === 'busy' ? 1700 : 2800;
    statusHideTimer = setTimeout(() => status.classList.remove('show'), holdMs);
    statusResetTimer = setTimeout(() => {
        status.hidden = true;
        status.className = '';
    }, holdMs + 520);
}

window.showColorMapStatus = setStatus;

function setupPanelShell(panel, map) {
    const minimizeButton = document.getElementById('minimize-button');
    minimizeButton?.addEventListener('click', () => {
        panel.classList.toggle('minimized');
        minimizeButton.setAttribute('aria-expanded', String(!panel.classList.contains('minimized')));
        setTimeout(() => map.resize(), 320);
    });
    minimizeButton?.setAttribute('aria-expanded', 'true');

    const menuSections = [...panel.querySelectorAll('details[data-menu-section]')];
    menuSections.forEach((section) => {
        section.addEventListener('toggle', () => {
            if (!section.open) return;
            menuSections.forEach((other) => {
                if (other !== section) other.open = false;
            });
        });
    });
}

async function bootstrap() {
    if (typeof mapboxgl === 'undefined') throw new Error('mapbox-gl.js를 불러오지 못했습니다.');

    const panel = await loadControlPanel();
    const token = await fetchMapboxToken();
    mapboxgl.accessToken = token;

    const map = new mapboxgl.Map({
        container: 'map',
        style: STYLES.mono_terrain,
        center: [127, 36],
        zoom: 6,
        projection: 'mercator',
        preserveDrawingBuffer: true,
        fadeDuration: 600,
        failIfMajorPerformanceCaveat: false,
        minTileCacheSize: 200,
        maxTileCacheSize: 1500,
    });

    window.map = map;
    window.colorMapInstance = map;

    setupPanelShell(panel, map);
    initRecorder(map);

    map.on('error', (event) => {
        const message = event?.error?.message || '';
        if (/access token|401|Unauthorized|not authorized/i.test(message)) {
            setStatus('Mapbox token 또는 스타일 접근 권한을 확인하세요.');
        }
    });
}

bootstrap().catch((error) => {
    console.error(error);
    const mount = document.getElementById('colormap-ui');
    if (!document.getElementById('country-selector-container')) {
        mount.innerHTML = `<div class="bootstrap-error">${error.message}</div>`;
    } else {
        setStatus(error.message);
    }
});
