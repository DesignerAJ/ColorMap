// script.js

// config.js에서 정의한 토큰 및 국가 데이터 변수를 사용합니다.
mapboxgl.accessToken = MAPBOX_ACCESS_TOKEN;

const map = new mapboxgl.Map({
    container: 'map',
    style: 'mapbox://styles/designeraj/cmcvnojkj005p01sq5jax8qhf', // 사용자의 커스텀 스타일 URL
    center: [127, 36], // 초기 지도 중심 (한국)
    zoom: 4, // 초기 지도 줌 레벨
    projection: 'mercator', // 초기 투영법 설정 (기본값)
});

// 줌 인터페이스 (NavigationControl) 추가 (지도 왼쪽 상단)
map.addControl(new mapboxgl.NavigationControl(), 'top-left');

// 국가 목록 데이터는 config.js에서 가져옵니다.
const countries = COUNTRIES_DATA;

// UI 요소 가져오기
const countrySelect1 = document.getElementById('country-select-1');
const countrySelect2 = document.getElementById('country-select-2');
const countrySelect3 = document.getElementById('country-select-3');
const highlightColorPicker1 = document.getElementById('highlight-color-picker-1'); // 국가 강조색 피커
const highlightColorPicker2 = document.getElementById('highlight-color-picker-2'); // 국가 강조색 피커
const highlightColorPicker3 = document.getElementById('highlight-color-picker-3'); // 국가 강조색 피커
const landColorPicker = document.getElementById('land-color-picker');       // 육지색 피커
const waterColorPicker = document.getElementById('water-color-picker');     // 바다색 피커
const projectionSelect = document.getElementById('projection-select');      // 투영법 선택 드롭다운
const styleSelect = document.getElementById('style-select');                // 맵 스타일 선택 드롭다운

let currentSelectedCountryIsos = []; // 현재 선택된 국가 ISO 코드 배열

const projections = [
    { name: '메르카토르 (기본)', value: 'mercator' },
    { name: '구형 지구 (3D)', value: 'globe' },
    { name: '내추럴어스', value: 'naturalEarth' }
    // 필요에 따라 다른 지원되는 투영법을 추가할 수 있습니다.
    // Mapbox GL JS 문서: https://docs.mapbox.com/mapbox-gl-js/api/map/#map-parameters
];

const mapStyles = [
    { name: '기본', value: 'mapbox://styles/designeraj/cmcvnojkj005p01sq5jax8qhf' },
    { name: '표준', value: 'mapbox://styles/mapbox/standard' },
    { name: '위성', value: 'mapbox://styles/designeraj/cmcxy4dm5009501sqh385hdu5' }
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

// 초기 선택 국가 설정
countrySelect1.value = 'KOR';
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

// 드롭다운 리스트 채우기 (맵 스타일)
mapStyles.forEach(style => {
    const option = document.createElement('option');
    option.value = style.value;
    option.textContent = style.name;
    styleSelect.appendChild(option);
});

// 지도 색상 및 필터 업데이트 함수
function updateMapPaintAndFilter() {
    const selectedCountry1 = countrySelect1.value;
    const selectedCountry2 = countrySelect2.value;
    const selectedCountry3 = countrySelect3.value;
    const currentStyleValue = styleSelect.value; // 현재 선택된 스타일 값 가져오기

    // Mapbox 'match' 표현식을 사용하여 단일 레이어의 색상 업데이트
    if (map.getLayer('country-color-fill')) {
        const paintExpression = ['match', ['get', 'iso_3166_1_alpha_3']];
        currentSelectedCountryIsos = [];

        if (selectedCountry1) {
            paintExpression.push(selectedCountry1, highlightColorPicker1.value);
            currentSelectedCountryIsos.push(selectedCountry1);
        }
        if (selectedCountry2) {
            paintExpression.push(selectedCountry2, highlightColorPicker2.value);
            currentSelectedCountryIsos.push(selectedCountry2);
        }
        if (selectedCountry3) {
            paintExpression.push(selectedCountry3, highlightColorPicker3.value);
            currentSelectedCountryIsos.push(selectedCountry3);
        }
        paintExpression.push('rgba(0, 0, 0, 0)'); // 기본값 (투명)

        map.setPaintProperty('country-color-fill', 'fill-color', paintExpression);

        // fill-opacity를 스타일이 '위성'일 때 0.5, 그 외에는 0.4로 설정
        const newOpacity = (currentStyleValue === 'mapbox://styles/designeraj/cmcxy4dm5009501sqh385hdu5') ? 0.4 : 1;
        map.setPaintProperty('country-color-fill', 'fill-opacity', newOpacity);

        // 필터는 모든 선택된 국가를 포함하도록 업데이트
        if (currentSelectedCountryIsos.length > 0) {
            map.setFilter('country-color-fill', [
                "in",
                "iso_3166_1_alpha_3",
                ...currentSelectedCountryIsos
            ]);
        } else {
            map.setFilter('country-color-fill', ["==", "iso_3166_1_alpha_3", ""]); // 선택된 국가가 없으면 숨김
        }
    }
}

// 선택된 국가들의 위치 중간값으로 이동 및 줌 조정 함수
function flyToSelectedCountries() {
    if (currentSelectedCountryIsos.length > 0) {
        let totalLat = 0;
        let totalLng = 0;
        let count = 0;
        let minZoom = Infinity; // 가장 작은 줌 레벨 (가장 넓은 범위)

        currentSelectedCountryIsos.forEach(iso => {
            const country = countries.find(c => c.iso === iso);
            if (country && country.center) {
                totalLng += country.center[0];
                totalLat += country.center[1];
                count++;
                if (country.zoom < minZoom) {
                    minZoom = country.zoom;
                }
            }
        });

        if (count > 0) {
            const avgLng = totalLng / count;
            const avgLat = totalLat / count;
            const newCenter = [avgLng, avgLat];

            let newZoom = 4; // 기본 줌 레벨
            if (count === 1) {
                const selectedCountry = countries.find(c => c.iso === currentSelectedCountryIsos[0]);
                if (selectedCountry) {
                    newZoom = selectedCountry.zoom; // 단일 국가일 경우 해당 국가의 줌 레벨 사용
                }
            } else {
                // 여러 국가일 경우, 가장 작은 줌 레벨을 기준으로 약간 더 축소
                newZoom = Math.max(minZoom - 1, 2); // 최소 줌 레벨은 2로 제한
            }

            map.flyTo({
                center: newCenter,
                zoom: newZoom,
                essential: true
            });
        }
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
                'fill-color': 'rgba(0, 0, 0, 0)', // 초기값은 투명으로 설정하고, updateMapPaintAndFilter에서 실제 색상 적용
                'fill-opacity': 0.4, // 초기값 0.4로 설정
            },
        },
        'water' // 'water' 레이어 아래에 삽입
    );

    // 3. 육지색 변경을 위한 레이어 설정
    const landLayerId = 'landColor';

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

    // 4. 바다색 변경을 위한 레이어 설정
    const backgroundLayerId = 'baseColor';

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
    updateMapPaintAndFilter(); // 이름 변경
    flyToSelectedCountries(); // 새로 추가

    // --- 이벤트 리스너 ---

    // 국가 드롭다운 변경 이벤트
    countrySelect1.addEventListener('change', function () {
        updateMapPaintAndFilter();
        flyToSelectedCountries();
    });
    countrySelect2.addEventListener('change', function () {
        updateMapPaintAndFilter();
        flyToSelectedCountries();
    });
    countrySelect3.addEventListener('change', function () {
        updateMapPaintAndFilter();
        flyToSelectedCountries();
    });

    // 국가 강조색 선택기 변경 이벤트
    highlightColorPicker1.addEventListener('input', updateMapPaintAndFilter);
    highlightColorPicker2.addEventListener('input', updateMapPaintAndFilter);
    highlightColorPicker3.addEventListener('input', updateMapPaintAndFilter);

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
        flyToSelectedCountries(); // 변경
    });

    // 맵 스타일 선택 드롭다운 변경 이벤트
    styleSelect.addEventListener('change', function () {
        const newStyle = this.value;
        map.setStyle(newStyle);
    });

    // 스타일이 변경될 때마다 레이어를 다시 추가하고 필터를 업데이트
    map.on('style.load', function () {
        // 1. 국가 경계 데이터 소스 추가 (스타일 변경 시 다시 추가)
        map.addSource('country-boundaries', {
            type: 'vector',
            url: 'mapbox://mapbox.country-boundaries-v1',
        });

        // 2. 국가 경계 레이어 추가 및 색칠 (스타일 변경 시 다시 추가)
        map.addLayer(
            {
                id: 'country-color-fill',
                source: 'country-boundaries',
                'source-layer': 'country_boundaries',
                type: 'fill',
                paint: {
                    'fill-color': 'rgba(0, 0, 0, 0)', // 초기값은 투명으로 설정하고, updateMapPaintAndFilter에서 실제 색상 적용
                    'fill-opacity': 1, // 초기값 0.4로 설정
                },
            },
            'water' // 'water' 레이어 아래에 삽입
        );

        // 육지색 및 바다색 레이어 업데이트 (스타일 변경 시 다시 적용)
        const landLayerId = 'landColor';
        if (map.getLayer(landLayerId)) {
            const layerType = map.getLayer(landLayerId).type;
            if (layerType === 'fill') {
                map.setPaintProperty(landLayerId, 'fill-color', landColorPicker.value);
            } else if (layerType === 'background') {
                map.setPaintProperty(landLayerId, 'background-color', landColorPicker.value);
            }
        }

        const backgroundLayerId = 'baseColor';
        if (map.getLayer(backgroundLayerId)) {
            if (map.getLayer(backgroundLayerId).type === 'background') {
                map.setPaintProperty(backgroundLayerId, 'background-color', waterColorPicker.value);
            }
        }

        // 필터 및 지도 이동 업데이트
        updateMapPaintAndFilter(); // 레이어 추가 후 색상 및 필터 적용
        flyToSelectedCountries(); // 지도 이동
    });

});
