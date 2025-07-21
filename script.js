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
const borderColorPicker = document.getElementById('border-color-picker');       // 국경 색상 피커
const adminColorPicker = document.getElementById('admin-color-picker');         // 행정구역 색상 피커
const borderOpacitySlider = document.getElementById('border-opacity-slider');   // 국경선 투명도 슬라이더
const adminOpacitySlider = document.getElementById('admin-opacity-slider');     // 행정구역선 투명도 슬라이더
const landColorPicker = document.getElementById('land-color-picker');           // 육지색 피커
const waterColorPicker = document.getElementById('water-color-picker');         // 바다색 피커
const projectionSelect = document.getElementById('projection-select');          // 투영법 선택 드롭다운
const styleSelect = document.getElementById('style-select');                    // 맵 스타일 선택 드롭다운

// 동적 국가 선택 UI 요소
const countryGroup2 = document.getElementById('country-group-2');
const countryGroup3 = document.getElementById('country-group-3');
const addCountryButton = document.getElementById('add-country');
const removeCountryButton = document.getElementById('remove-country');

// 육지/바다 색상 UI 그룹
const landWaterColorGroup = document.getElementById('landwater-color-group');

let currentSelectedCountryIsos = []; // 현재 선택된 국가 ISO 코드 배열
let activeCountryGroups = 1; // 초기에 국가1만 활성화
let isFirstGlobeProjection = true; // globe 투영법으로 처음 전환되었는지 추적


const mapStyles = [
    { name: '기본 단색', value: 'mapbox://styles/designeraj/cmcvnojkj005p01sq5jax8qhf' },
    { name: '지형도', value: 'mapbox://styles/designeraj/cmd5901wa02kl01ri8v4m1hqw' },
    { name: '위성사진', value: 'mapbox://styles/designeraj/cmcxy4dm5009501sqh385hdu5' }
];
const projections = [
    { name: '2D / 메르카토르', value: 'mercator' },
    { name: '2D / WGS84', value: 'equirectangular' },
    { name: '3D / 구형', value: 'globe' }
    // 필요에 따라 다른 지원되는 투영법을 추가할 수 있습니다.
    // Mapbox GL JS 문서: https://docs.mapbox.com/mapbox-gl-js/api/map/#map-parameters
];


// 드롭다운 리스트 채우기 함수
function populateCountryDropdown(selectElement) {
    const defaultOption = document.createElement('option');
    defaultOption.value = '';
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
countrySelect2.value = ''; // 초기에는 선택되지 않음
countrySelect3.value = ''; // 초기에는 선택되지 않음

// 동적 국가 그룹 가시성 및 버튼 상태 업데이트 함수
function updateCountryGroupVisibility() {
    if (activeCountryGroups < 2) {
        countryGroup2.classList.add('hidden');
    } else {
        countryGroup2.classList.remove('hidden');
    }

    if (activeCountryGroups < 3) {
        countryGroup3.classList.add('hidden');
    } else {
        countryGroup3.classList.remove('hidden');
    }

    addCountryButton.disabled = (activeCountryGroups >= 3);
    removeCountryButton.disabled = (activeCountryGroups <= 1);

    // 국가 그룹이 숨겨질 때 해당 드롭다운 값 초기화
    if (countryGroup2.classList.contains('hidden')) {
        countrySelect2.value = '';
    }
    if (countryGroup3.classList.contains('hidden')) {
        countrySelect3.value = '';
    }

    updateMapPaintAndFilter(); // UI 변경 후 지도 업데이트
    flyToSelectedCountries(); // UI 변경 후 지도 이동
    updateDropdownOptions(); // 드롭다운 옵션 업데이트
}

// 드롭다운 옵션 업데이트 함수
function updateDropdownOptions() {
    const allSelects = [countrySelect1, countrySelect2, countrySelect3];
    const selectedValues = allSelects.map(select => select.value).filter(value => value !== '');

    allSelects.forEach(selectElement => {
        Array.from(selectElement.options).forEach(option => {
            if (option.value === '') {
                option.disabled = false; // "-- 선택 없음 --" 옵션은 항상 활성화
                option.style.textDecoration = 'none';
                return;
            }

            // 현재 드롭다운의 선택된 값은 제외하고 다른 드롭다운에서 선택된 값인지 확인
            const isSelectedInOtherDropdown = selectedValues.includes(option.value) && option.value !== selectElement.value;

            if (isSelectedInOtherDropdown) {
                option.disabled = true;
            } else {
                option.disabled = false;
            }
        });
    });
}


// 드롭다운 리스트 채우기 (투영법)
projections.forEach(proj => {
    const option = document.createElement('option');
    option.value = proj.value;
    option.textContent = proj.name;
    projectionSelect.appendChild(option);
});

projectionSelect.value = 'mercator'; // 초기 투영법 설정 (드롭다운을 'mercator'로 설정)

// 드롭다운 리스트 채우기 (맵 스타일)
mapStyles.forEach(style => {
    const option = document.createElement('option');
    option.value = style.value;
    option.textContent = style.name;
    styleSelect.appendChild(option);
});

// 육지/바다 색상 UI 가시성 제어 함수
function handleColorUIVisibility() {
    const currentStyleValue = styleSelect.value;
    const isDefaultStyle = (currentStyleValue === 'mapbox://styles/designeraj/cmcvnojkj005p01sq5jax8qhf');

    if (landWaterColorGroup) {
        if (isDefaultStyle) {
            landWaterColorGroup.classList.remove('hidden');
        } else {
            landWaterColorGroup.classList.add('hidden');
        }
    }
}

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

        // fill-opacity를 스타일이 '기본': 1, '지형': 0.4, '위성': 0.5으로 설정
        let newOpacity;
        if (currentStyleValue === 'mapbox://styles/designeraj/cmcvnojkj005p01sq5jax8qhf') { // 기본
            newOpacity = 1;
        } else if (currentStyleValue === 'mapbox://styles/designeraj/cmd5901wa02kl01ri8v4m1hqw') { // 지형
            newOpacity = 0.4;
        } else if (currentStyleValue === 'mapbox://styles/designeraj/cmcxy4dm5009501sqh385hdu5') { // 위성
            newOpacity = 0.5;
        } else {
            newOpacity = 1; // 기본값
        }
        map.setPaintProperty('country-color-fill', 'fill-opacity', newOpacity);

        // 국경선 색상 및 투명도 업데이트
        if (map.getLayer('country-border')) {
            map.setPaintProperty('country-border', 'line-color', borderColorPicker.value);
            map.setPaintProperty('country-border', 'line-opacity', parseFloat(borderOpacitySlider.value));
        }

        // 행정구역선 색상 및 투명도 업데이트
        if (map.getLayer('admin-boundaries')) {
            map.setPaintProperty('admin-boundaries', 'line-color', adminColorPicker.value);
            map.setPaintProperty('admin-boundaries', 'line-opacity', parseFloat(adminOpacitySlider.value));
        }

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
        const lastSelectedIso = currentSelectedCountryIsos[currentSelectedCountryIsos.length - 1];
        const selectedCountry = countries.find(c => c.iso === lastSelectedIso);

        if (selectedCountry && selectedCountry.center) {
            const newCenter = [...selectedCountry.center];
            let newZoom = selectedCountry.zoom;

            // 현재 투영법이 'globe'인지 확인
            const currentProjection = map.getProjection().name;

            if (currentProjection === 'globe' && isFirstGlobeProjection) {
                newZoom = 2.5; // globe 투영법으로 처음 전환 시 줌 레벨을 2.5로 설정
                isFirstGlobeProjection = false; // 플래그를 false로 설정하여 다음부터는 적용되지 않도록 함
            } else {
                // 모바일 화면 (768px 이하)에서만 오프셋과 줌 아웃 적용
                if (window.innerWidth <= 768) {
                    newZoom = selectedCountry.zoom - 1;
                    newZoom = Math.max(2, newZoom);
                    const centerOffset = -24.95 / newZoom + 2.475;
                    newCenter[1] += centerOffset;
                    newCenter[1] = Math.max(-90, newCenter[1]);
                }
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

    // 3. 국경선 레이어 추가
    map.addLayer(
        {
            id: 'country-border',
            source: 'country-boundaries',
            'source-layer': 'country_boundaries',
            type: 'line',
            paint: {
                'line-color': borderColorPicker.value, // 초기 색상
                'line-width': 1,
                'line-opacity': parseFloat(borderOpacitySlider.value), // 초기 투명도
            },
        },
        'country-color-fill' // 'country-color-fill' 레이어 위에 삽입
    );

    // 4. 행정구역선 레이어 추가
    map.addLayer(
        {
            id: 'admin-boundaries',
            source: 'country-boundaries',
            'source-layer': 'country_boundaries',
            type: 'line',
            filter: ['==', ['get', 'admin_level'], 2], // admin_level 2 (주/도 경계) 필터링
            paint: {
                'line-color': adminColorPicker.value, // 초기 색상
                'line-width': 0.5,
                'line-opacity': parseFloat(adminOpacitySlider.value), // 초기 투명도
            },
        },
        'country-border' // 'country-border' 레이어 위에 삽입
    );

    // 5. 육지색 변경을 위한 레이어 설정
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
    updateMapPaintAndFilter();
    flyToSelectedCountries();
    handleColorUIVisibility(); // 초기 UI 가시성 설정
    updateCountryGroupVisibility(); // 초기 국가 그룹 가시성 설정

    // --- 이벤트 리스너 ---

    // '+' 버튼 클릭 이벤트
    addCountryButton.addEventListener('click', () => {
        if (activeCountryGroups < 3) {
            activeCountryGroups++;
            updateCountryGroupVisibility();
        }
    });

    // '-' 버튼 클릭 이벤트
    removeCountryButton.addEventListener('click', () => {
        if (activeCountryGroups > 1) {
            activeCountryGroups--;
            updateCountryGroupVisibility();
        }
    });

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

    // 국경 색상 선택기 변경 이벤트
    borderColorPicker.addEventListener('input', updateMapPaintAndFilter);

    // 행정구역 색상 선택기 변경 이벤트
    adminColorPicker.addEventListener('input', updateMapPaintAndFilter);

    // 국경선 투명도 슬라이더 변경 이벤트
    borderOpacitySlider.addEventListener('input', updateMapPaintAndFilter);

    // 행정구역선 투명도 슬라이더 변경 이벤트
    adminOpacitySlider.addEventListener('input', updateMapPaintAndFilter);

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
            }
        }
    });

    // 투영법 선택 드롭다운 변경 이벤트
    projectionSelect.addEventListener('change', function () {
        const newProjection = this.value;
        map.setProjection(newProjection);

        // 투영법이 'globe'로 변경될 때 isFirstGlobeProjection 플래그를 재설정
        if (newProjection === 'globe') {
            isFirstGlobeProjection = true;
        } else {
            isFirstGlobeProjection = false; // 다른 투영법으로 변경 시 초기화
        }

        // 투영법 변경 시, 지도를 선택된 국가 중심으로 다시 이동시키는 것이 좋습니다.
        // 현재 선택된 국가의 정보로 다시 flyTo를 호출합니다.
        flyToSelectedCountries();
    });

    // 맵 스타일 선택 드롭다운 변경 이벤트
    styleSelect.addEventListener('change', function () {
        const newStyle = this.value;
        map.setStyle(newStyle);
        handleColorUIVisibility(); // 스타일 변경 시 UI 가시성 업데이트
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
                    'fill-opacity': 0.4, // 초기값 0.4로 설정
                },
            },
            'water' // 'water' 레이어 아래에 삽입
        );

        // 3. 국경선 레이어 추가 (스타일 변경 시 다시 추가)
        map.addLayer(
            {
                id: 'country-border',
                source: 'country-boundaries',
                'source-layer': 'country_boundaries',
                type: 'line',
                paint: {
                    'line-color': borderColorPicker.value, // 초기 색상
                    'line-width': 1,
                    'line-opacity': parseFloat(borderOpacitySlider.value), // 초기 투명도
                },
            },
            'country-color-fill' // 'country-color-fill' 레이어 위에 삽입
        );

        // 4. 행정구역선 레이어 추가 (스타일 변경 시 다시 추가)
        map.addLayer(
            {
                id: 'admin-boundaries',
                source: 'country-boundaries',
                'source-layer': 'country_boundaries',
                type: 'line',
                filter: ['==', ['get', 'admin_level'], 2], // admin_level 2 (주/도 경계) 필터링
                paint: {
                    'line-color': adminColorPicker.value, // 초기 색상
                    'line-width': 0.5,
                    'line-opacity': parseFloat(adminOpacitySlider.value), // 초기 투명도
                },
            },
            'country-border' // 'country-border' 레이어 위에 삽입
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
        handleColorUIVisibility(); // 스타일 변경 시 UI 가시성 업데이트
        updateCountryGroupVisibility(); // 스타일 변경 시 국가 그룹 가시성 업데이트
    });

});
