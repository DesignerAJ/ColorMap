/* 기존 ColorMap 지도에 카메라 녹화 패널을 연결한다. */
(() => {
  const shell = document.getElementById('recorder-shell');
  const openButton = document.getElementById('open-camera-recorder');
  const mainPanel = document.getElementById('country-selector-container');
  let mapRef = null;
  let initialized = false;
  const overlayVisibility = new Map();
  const overlayLayerIds = [
    'recorder-country-color-fill', 'admin1-color-fill', 'sido-color-fill', 'sigungu-color-fill',
    'route-line-layer', 'route-dots-layer', 'route-arrow-layer', 'draw-lines-layer', 'capture-pins-layer'
  ];

  const panelReady = fetch('./recorder/panel.html?v=2.1.2', { cache: 'no-store' })
    .then((response) => {
      if (!response.ok) throw new Error(`녹화 패널을 불러오지 못했습니다 (${response.status})`);
      return response.text();
    })
    .then((html) => {
      const parsed = new DOMParser().parseFromString(html, 'text/html');
      ['frame-guide', 'drop-hint', 'geo-float', 'panel', 'action-panel'].forEach((id) => {
        const node = parsed.getElementById(id);
        if (node) shell.appendChild(document.importNode(node, true));
      });

      const panel = shell.querySelector('#panel');
      const controls = shell.querySelector('#controls');
      const tokenField = shell.querySelector('#token-field');
      const styleSelect = shell.querySelector('#style-select');
      const footer = shell.querySelector('#action-panel .action-footer');
      const actionPanel = shell.querySelector('#action-panel');

      if (!panel || !controls || !footer) throw new Error('녹화 패널 마크업이 올바르지 않습니다.');
      if (tokenField) tokenField.remove();
      if (styleSelect) styleSelect.id = 'recorder-style-select';

      const header = document.createElement('div');
      header.className = 'recorder-header';
      header.innerHTML = '<div class="recorder-title">카메라 경로 녹화</div><button type="button" id="close-camera-recorder" title="기본 설정으로 돌아가기">✕</button>';
      panel.insertBefore(header, panel.firstChild);

      controls.style.display = 'block';
      panel.style.display = 'block';
      controls.appendChild(footer);
      if (actionPanel) actionPanel.remove();

      shell.querySelector('#close-camera-recorder').addEventListener('click', closeRecorder);
      const handle = shell.querySelector('#panel-handle');
      if (handle) handle.addEventListener('click', () => panel.classList.toggle('collapsed'));

      const mainSettings = shell.querySelector('#main-settings');
      const detailSettings = shell.querySelector('#detail-settings');
      if (mainSettings && detailSettings) {
        mainSettings.addEventListener('toggle', () => { if (mainSettings.open) detailSettings.open = false; });
        detailSettings.addEventListener('toggle', () => { if (detailSettings.open) mainSettings.open = false; });
      }

      openButton.disabled = false;
      openButton.textContent = '● 카메라 경로 녹화';
      return true;
    })
    .catch((error) => {
      console.error(error);
      openButton.textContent = '녹화 기능 로드 실패';
      openButton.title = error.message;
      throw error;
    });

  function openRecorder() {
    panelReady.then(() => {
      shell.hidden = false;
      mainPanel.style.display = 'none';
      document.body.classList.add('recorder-mode');
      setRecorderOverlaysVisible(true);
      if (mapRef) setTimeout(() => mapRef.resize(), 0);
    }).catch(() => {});
  }

  function closeRecorder() {
    shell.hidden = true;
    mainPanel.style.display = '';
    document.body.classList.remove('recorder-mode');
    setRecorderOverlaysVisible(false);
    if (mapRef) setTimeout(() => mapRef.resize(), 0);
  }

  function setRecorderOverlaysVisible(visible) {
    if (!mapRef || typeof mapRef.getLayer !== 'function') return;
    overlayLayerIds.forEach((id) => {
      if (!mapRef.getLayer(id)) return;
      if (!visible) {
        overlayVisibility.set(id, mapRef.getLayoutProperty(id, 'visibility') || 'visible');
        mapRef.setLayoutProperty(id, 'visibility', 'none');
      } else if (overlayVisibility.has(id)) {
        mapRef.setLayoutProperty(id, 'visibility', overlayVisibility.get(id));
      }
    });
  }

  async function initializeRecorder(map) {
    if (!map || typeof map.on !== 'function' || typeof map.getCanvas !== 'function') return;
    mapRef = map;
    if (initialized) return;
    await panelReady;
    initRecorder(mapRef);
    mapRef.on('style.load', () => {
      if (shell.hidden) setTimeout(() => setRecorderOverlaysVisible(false), 80);
    });
    initialized = true;
  }

  openButton.addEventListener('click', openRecorder);
  window.addEventListener('colormap:map-ready', (event) => initializeRecorder(window.colorMapInstance || event.detail.map));
  if (window.colorMapInstance) initializeRecorder(window.colorMapInstance);
})();
