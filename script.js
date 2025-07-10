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
const countrySelect1 = document.getElementById('country-select-1');
const countrySelect2 = document.getElementById('country-select-2');
const countrySelect3 = document.getElementById('country-select-3');
const highlightColorPicker = document.getElementById('highlight-color-picker'); // 국가 강조색 피커
const landColorPicker = document.getElementById('land-color-picker');       // 육지색 피커
const waterColorPicker = document.getElementById('water-color-picker');     // 바다색 피커
const projectionSelect = document.getElementById('projection-select');      // 투영법 선택 드롭다운

let currentSelectedCountryIsos = []; // 현재 선택된 국가 ISO 코드 배열

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

// 드롭다운 리스트 채우기 함수
function populateCountryDropdown(selectElement) {
    // "-- 선택 없음 --" 옵션 추가
    const defaultOption = document.createElement('option');
    defaultOption.value = ''; // 빈 값으로 설정
    defaultOption.textContent = '-- 선택 없음 --';
    selectElement.appendChild(defaultOption);

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
        selectElement.appendChild(option);
    });
}

// 각 국가 드롭다운 채우기
populateCountryDropdown(countrySelect1);
populateCountryDropdown(countrySelect2);
populateCountryDropdown(countrySelect3);

// 초기 선택 국가 설정 (드롭다운을 비워둠)
countrySelect1.value = '';
countrySelect2.value = '';
countrySelect3.value = '';


// 드롭다운 리스트 채우기 (투영법)
projections.forEach(proj => {
    const option = document.createElement('option');
    option.value = proj.value;
    option.textContent = proj.name;
    projectionSelect.appendChild(option);
});

// 초기 투영법 설정 (드롭다운을 'mercator'로 설정)
projectionSelect.value = 'mercator';

// 지도 필터 및 이동 업데이트 함수
function updateMapFilterAndFlyTo() {
    currentSelectedCountryIsos = [
        countrySelect1.value,
        countrySelect2.value,
        countrySelect3.value
    ].filter(iso => iso !== ''); // 빈 값 필터링

    if (currentSelectedCountryIsos.length > 0) {
        map.setFilter('country-color-fill', [
            "in",
            "iso_3166_1_alpha_3",
            ...currentSelectedCountryIsos
        ]);

        // 첫 번째 선택된 국가로 지도를 이동 (또는 모든 선택된 국가의 평균 중심 등으로 개선 가능)
        const firstSelectedCountry = countries.find(c => c.iso === currentSelectedCountryIsos[0]);
        if (firstSelectedCountry) {
            map.flyTo({
                center: firstSelectedCountry.center,
                zoom: firstSelectedCountry.zoom,
                essential: true
            });
        }
    } else {
        // 선택된 국가가 없으면 필터를 제거하여 모든 국가를 표시하지 않음
        map.setFilter('country-color-fill', ["==", "iso_3166_1_alpha_3", ""]);
    }
}


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

    // 초기 로드 시, 필터 및 지도 이동 업데이트
    updateMapFilterAndFlyTo();

    // --- 이벤트 리스너 ---

    // 국가 드롭다운 변경 이벤트
    countrySelect1.addEventListener('change', updateMapFilterAndFlyTo);
    countrySelect2.addEventListener('change', updateMapFilterAndFlyTo);
    countrySelect3.addEventListener('change', updateMapFilterAndFlyTo);

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
        const selectedCountry = countries.find(country => country.iso === currentSelectedCountryIsos[0]); // 첫 번째 선택된 국가
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
});
