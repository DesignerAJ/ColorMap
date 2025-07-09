// script.js

// config.js에서 정의한 토큰 및 국가 데이터 변수를 사용합니다.
mapboxgl.accessToken = MAPBOX_ACCESS_TOKEN;

const map = new mapboxgl.Map({
    container: 'map',
    style: 'mapbox://styles/designeraj/cmcvnojkj005p01sq5jax8qhf', // 사용자의 커스텀 스타일 URL
    center: [127, 36], // 초기 지도 중심 (한국)
    zoom: 4, // 초기 지도 줌 레벨
    projection: 'mercator' // 초기 투영법 설정 (기본값)
});

// 줌 인터페이스 (NavigationControl) 추가 (지도 왼쪽 상단)
map.addControl(new mapboxgl.NavigationControl(), 'top-left');

// 국가 목록 데이터는 config.js에서 가져옵니다.
const countries = COUNTRIES_DATA;

// UI 요소 가져오기
const countrySelect = document.getElementById('country-select');
const highlightColorPicker = document.getElementById('highlight-color-picker'); // 국가 강조색 피커
const landColorPicker = document.getElementById('land-color-picker');       // 육지색 피커
const waterColorPicker = document.getElementById('water-color-picker');     // 바다색 피커
const projectionSelect = document.getElementById('projection-select');      // 투영법 선택 드롭다운

let currentSelectedCountryIso = 'KOR'; // 현재 선택된 국가 ISO 코드 (초기값은 한국)

// 지원하는 투영법 목록 (Mapbox GL JS v2.x 기준)
const projections = [
    { name: '메르카토르 (기본)', value: 'mercator' },
    { name: '구형 지구 (3D)', value: 'globe' },
    { name: '알버스', value: 'albers' },
    { name: '램버트 등각원추', value: 'lambertConformalConic' },
    { name: '이퀄어스', value: 'equalEarth' },
    { name: '내추럴어스', value: 'naturalEarth' }
    // 필요에 따라 다른 지원되는 투영법을 추가할 수 있습니다.
    // Mapbox GL JS 문서: https://docs.mapbox.com/mapbox-gl-js/api/map/#map-parameters
];


// 드롭다운 리스트 채우기 (국가)
countries.forEach(country => {
    const option = document.createElement('option');
    option.value = country.iso;
    option.textContent = country.name;
    if (country.tag) {
        option.textContent += ` ${country.tag}`;
    }
    if (country.tagColor) {
        option.style.color = country.tagColor;
    }
    countrySelect.appendChild(option);
});

// 초기 선택 국가 설정 (드롭다운을 한국으로 설정)
countrySelect.value = 'KOR';


// 드롭다운 리스트 채우기 (투영법)
projections.forEach(proj => {
    const option = document.createElement('option');
    option.value = proj.value;
    option.textContent = proj.name;
    projectionSelect.appendChild(option);
});

// 초기 투영법 설정 (드롭다운을 'mercator'로 설정)
projectionSelect.value = 'mercator';

map.on('load', function () {
    // 1. 국가 경계 데이터 소스 추가
    map.addSource('country-boundaries', {
        type: 'vector',
        url: 'mapbox://mapbox.country-boundaries-v1',
    });

    // 2. 국가 경계 레이어 추가 및 색칠
    map.addLayer(
        {
            id: 'country-color-fill',
            source: 'country-boundaries',
            'source-layer': 'country_boundaries',
            type: 'fill',
            paint: {
                'fill-color': highlightColorPicker.value,
                'fill-opacity': 0.4,
            },
        }
        // 'country-label' 인수는 제거됨
    );

    // 3. 육지색 변경을 위한 레이어 설정 ('base' 레이어)
    const landLayerId = 'base'; // 사용자의 요청에 따라 'base'로 설정. 실제 ID를 확인하세요!

    if (map.getLayer(landLayerId)) {
        const layerType = map.getLayer(landLayerId).type;
        if (layerType === 'fill') {
            map.setPaintProperty(landLayerId, 'fill-color', landColorPicker.value);
        } else if (layerType === 'background') {
            map.setPaintProperty(landLayerId, 'background-color', landColorPicker.value);
        }
    } else {
        console.warn(`Layer with ID '${landLayerId}' (land) not found in the map style. Check Mapbox Studio.`);
    }

    // 4. 바다색 변경을 위한 레이어 설정 ('background' 레이어)
    const backgroundLayerId = 'background'; // 사용자가 확인해준 바다색 레이어 ID

    if (map.getLayer(backgroundLayerId)) {
        if (map.getLayer(backgroundLayerId).type === 'background') {
            map.setPaintProperty(backgroundLayerId, 'background-color', waterColorPicker.value);
        } else {
            console.warn(`Layer with ID '${backgroundLayerId}' is not of 'background' type. Cannot set 'background-color'.`);
        }
    } else {
        console.warn(`Layer with ID '${backgroundLayerId}' (background/water) not found in the map style. Check Mapbox Studio.`);
    }

    // 초기 로드 시, 현재 선택된 국가(기본값: 한국)를 지도에 색칠
    map.setFilter('country-color-fill', [
        "in",
        "iso_3166_1_alpha_3",
        currentSelectedCountryIso
    ]);

    // 초기 로드 시, 선택된 국가로 지도를 이동
    const initialCountry = countries.find(c => c.iso === currentSelectedCountryIso);
    if (initialCountry) {
        map.flyTo({
            center: initialCountry.center,
            zoom: initialCountry.zoom,
            essential: true
        });
    }

    // --- 이벤트 리스너 ---

    // 국가 드롭다운 변경 이벤트
    countrySelect.addEventListener('change', function () {
        currentSelectedCountryIso = this.value;

        map.setFilter('country-color-fill', [
            "in",
            "iso_3166_1_alpha_3",
            currentSelectedCountryIso
        ]);

        const selectedCountry = countries.find(country => country.iso === currentSelectedCountryIso);
        if (selectedCountry) {
            map.flyTo({
                center: selectedCountry.center,
                zoom: selectedCountry.zoom,
                essential: true
            });
        }
    });

    // 국가 강조색 선택기 변경 이벤트
    highlightColorPicker.addEventListener('input', function () {
        const newColor = this.value;
        if (map.getLayer('country-color-fill')) {
            map.setPaintProperty('country-color-fill', 'fill-color', newColor);
        }
    });

    // 육지색 선택기 변경 이벤트
    landColorPicker.addEventListener('input', function () {
        const newColor = this.value;
        if (map.getLayer(landLayerId)) {
            const layerType = map.getLayer(landLayerId).type;
            if (layerType === 'fill') {
                map.setPaintProperty(landLayerId, 'fill-color', newColor);
            } else if (layerType === 'background') {
                map.setPaintProperty(landLayerId, 'background-color', newColor);
            }
        }
    });

    // 바다색 선택기 변경 이벤트
    waterColorPicker.addEventListener('input', function () {
        const newColor = this.value;
        if (map.getLayer(backgroundLayerId)) {
            if (map.getLayer(backgroundLayerId).type === 'background') {
                map.setPaintProperty(backgroundLayerId, 'background-color', newColor);
            } else {
                console.warn(`Layer with ID '${backgroundLayerId}' is not of 'background' type. Cannot set 'background-color'.`);
            }
        }
    });

    // 투영법 선택 드롭다운 변경 이벤트
    projectionSelect.addEventListener('change', function () {
        const newProjection = this.value;
        map.setProjection(newProjection);

        // 투영법 변경 시, 지도를 선택된 국가 중심으로 다시 이동시키는 것이 좋습니다.
        // 현재 선택된 국가의 정보로 다시 flyTo를 호출합니다.
        const selectedCountry = countries.find(country => country.iso === currentSelectedCountryIso);
        if (selectedCountry) {
            map.flyTo({
                center: selectedCountry.center,
                zoom: selectedCountry.zoom,
                essential: true
            });
        }
    });

    // 마우스 커서 변경 (국가 강조 레이어)
    map.on('mouseenter', 'country-color-fill', function () {
        map.getCanvas().style.cursor = 'grab';
    });
    map.on('mouseleave', 'country-color-fill', function () {
        map.getCanvas().style.cursor = '';
    });

    // 지도가 로드된 후 초기 국가 선택 이벤트를 강제로 발생시켜 초기 상태 설정
    countrySelect.dispatchEvent(new Event('change'));
});