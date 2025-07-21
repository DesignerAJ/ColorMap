// script.js

// config.js에서 정의한 토큰 및 국가 데이터 변수를 사용합니다.
mapboxgl.accessToken = MAPBOX_ACCESS_TOKEN;

// HTML 요소 가져오기
const countrySelect1 = document.getElementById('country-select-1');
const countrySelect2 = document.getElementById('country-select-2');
const countrySelect3 = document.getElementById('country-select-3');

const highlightColorPicker1 = document.getElementById('highlight-color-picker-1');
const highlightColorPicker2 = document.getElementById('highlight-color-picker-2');
const highlightColorPicker3 = document.getElementById('highlight-color-picker-3');

const borderColorPicker = document.getElementById('border-color-picker');
const adminColorPicker = document.getElementById('admin-color-picker');

const borderOpacitySlider = document.getElementById('border-opacity-slider');
const adminOpacitySlider = document.getElementById('admin-opacity-slider');

const landColorPicker = document.getElementById('land-color-picker');
const waterColorPicker = document.getElementById('water-color-picker');

const projectionSelect = document.getElementById('projection-select');
const styleSelect = document.getElementById('style-select');

const addCountryButton = document.getElementById('add-country');
const removeCountryButton = document.getElementById('remove-country');

const countryGroup2 = document.getElementById('country-group-2');
const countryGroup3 = document.getElementById('country-group-3');

const landWaterColorGroup = document.getElementById('landwater-color-group');

// 대한민국 시도 관련 HTML 요소 가져오기
const provinceSelect1 = document.getElementById('province-select-1');
const provinceSelect2 = document.getElementById('province-select-2');
const provinceSelect3 = document.getElementById('province-select-3');
const provinceGroup2 = document.getElementById('province-group-2');
const provinceGroup3 = document.getElementById('province-group-3');
const addProvinceButton = document.getElementById('add-province');
const removeProvinceButton = document.getElementById('remove-province');

const highlightColorPickerProvince1 = document.getElementById('highlight-color-picker-province-1');
const highlightColorPickerProvince2 = document.getElementById('highlight-color-picker-province-2');
const highlightColorPickerProvince3 = document.getElementById('highlight-color-picker-province-3');

// 탭 관련 요소
const tabButtons = document.querySelectorAll('.tab-button');
const countryTabContent = document.getElementById('country-tab-content');
const provinceTabContent = document.getElementById('province-tab-content');


// 전역 상태 변수
let activeCountryGroups = 1;
let activeProvinceGroups = 1;
let currentSelectedCountryIsos = [];
let currentSelectedProvinceCodes = []; // 시도 코드 저장을 위한 새 변수
let activeTab = 'country'; // 현재 활성화된 탭을 추적하는 변수 (초기값 'country')
let isFirstGlobeProjection = true; // 지구본 투영법에서 초기 줌 조정을 위한 플래그

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

// 대한민국 시도 목록 데이터는 config.js에서 가져옵니다.
const provinces = PROVINCES_DATA;

// 시도 드롭다운 리스트 채우기 함수
function populateProvinceDropdown(selectElement) {
    const defaultOption = document.createElement('option');
    defaultOption.value = '';
    defaultOption.textContent = '-- 선택 없음 --';
    selectElement.appendChild(defaultOption);

    provinces.forEach(province => {
        const option = document.createElement('option');
        option.value = province.name;
        option.textContent = province.name;
        selectElement.appendChild(option);
    });
}

// 각 시도 드롭다운 채우기
populateProvinceDropdown(provinceSelect1);
populateProvinceDropdown(provinceSelect2);
populateProvinceDropdown(provinceSelect3);

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
    if (activeTab === 'country') {
        flyToSelectedCountries(); // UI 변경 후 지도 이동
    }
    updateDropdownOptions(); // 드롭다운 옵션 업데이트
}

// 동적 시도 그룹 가시성 및 버튼 상태 업데이트 함수
function updateProvinceGroupVisibility() {
    provinceGroup2.classList.toggle('hidden', activeProvinceGroups < 2);
    provinceGroup3.classList.toggle('hidden', activeProvinceGroups < 3);

    addProvinceButton.disabled = (activeProvinceGroups >= 3);
    removeProvinceButton.disabled = (activeProvinceGroups <= 1);

    if (provinceGroup2.classList.contains('hidden')) provinceSelect2.value = '';
    if (provinceGroup3.classList.contains('hidden')) provinceSelect3.value = '';

    updateMapPaintAndFilter(); // UI 변경 후 지도 업데이트
    if (activeTab === 'province') {
        flyToSelectedProvinces(); // UI 변경 후 지도 이동
    }
    updateProvinceDropdownOptions(); // 드롭다운 옵션 업데이트
}


// 드롭다운 옵션 업데이트 함수
function updateDropdownOptions() {
    const allSelects = [countrySelect1];
    if (activeCountryGroups >= 2) {
        allSelects.push(countrySelect2);
    }
    if (activeCountryGroups >= 3) {
        allSelects.push(countrySelect3);
    }

    const selectedValues = allSelects.map(select => select.value).filter(value => value !== '');

    // 모든 드롭다운의 모든 옵션을 먼저 활성화 상태로 초기화
    [countrySelect1, countrySelect2, countrySelect3].forEach(selectElement => {
        Array.from(selectElement.options).forEach(option => {
            option.disabled = false;
            option.style.textDecoration = 'none';
        });
    });

    // 활성화된 드롭다운에 대해서만 중복 옵션 비활성화 로직 적용
    allSelects.forEach(selectElement => {
        Array.from(selectElement.options).forEach(option => {
            if (option.value === '') {
                // "-- 선택 없음 --" 옵션은 항상 활성화
                option.disabled = false;
                option.style.textDecoration = 'none';
                return;
            }

            // 현재 드롭다운의 선택된 값은 제외하고, 다른 활성화된 드롭다운에서 선택된 값인지 확인
            const isSelectedInOtherActiveDropdown = selectedValues.includes(option.value) && option.value !== selectElement.value;

            if (isSelectedInOtherActiveDropdown) {
                option.disabled = true;
                option.style.textDecoration = 'line-through'; // 추가
            }
        });
    });
}

// 시도 드롭다운 옵션 업데이트 함수
function updateProvinceDropdownOptions() {
    const allSelects = [provinceSelect1];
    if (activeProvinceGroups >= 2) allSelects.push(provinceSelect2);
    if (activeProvinceGroups >= 3) allSelects.push(provinceSelect3);

    const selectedValues = allSelects.map(select => select.value).filter(value => value !== '');

    [provinceSelect1, provinceSelect2, provinceSelect3].forEach(selectElement => {
        Array.from(selectElement.options).forEach(option => {
            option.disabled = false;
            option.style.textDecoration = 'none';
        });
    });

    allSelects.forEach(selectElement => {
        Array.from(selectElement.options).forEach(option => {
            if (option.value === '') {
                option.disabled = false;
                option.style.textDecoration = 'none';
                return;
            }
            const isSelectedInOtherActiveDropdown = selectedValues.includes(option.value) && option.value !== selectElement.value;
            if (isSelectedInOtherActiveDropdown) {
                option.disabled = true;
                option.style.textDecoration = 'line-through';
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
    const currentStyleValue = styleSelect.value; // 현재 선택된 스타일 값 가져오기

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

    if (activeTab === 'country') {
        const selectedCountry1 = countrySelect1.value;
        const selectedCountry2 = countrySelect2.value;
        const selectedCountry3 = countrySelect3.value;

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
            map.setPaintProperty('country-color-fill', 'fill-opacity', newOpacity);

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
        // 시도 레이어 숨김
        if (map.getLayer('province-color-fill')) {
            map.setFilter('province-color-fill', ["==", "name", ""]);
        }

    } else if (activeTab === 'province') {
        const selectedProvince1 = provinceSelect1.value;
        const selectedProvince2 = provinceSelect2.value;
        const selectedProvince3 = provinceSelect3.value;

        if (map.getLayer('province-color-fill')) {
            currentSelectedProvinceCodes = [];
            const selectedProvince1 = provinceSelect1.value;
            const selectedProvince2 = provinceSelect2.value;
            const selectedProvince3 = provinceSelect3.value;

            if (selectedProvince1) {
                currentSelectedProvinceCodes.push(selectedProvince1);
            }
            if (selectedProvince2) {
                currentSelectedProvinceCodes.push(selectedProvince2);
            }
            if (selectedProvince3) {
                currentSelectedProvinceCodes.push(selectedProvince3);
            }

            if (currentSelectedProvinceCodes.length > 0) {
                const proPaintExpression = ['match', ['get', 'name']];
                if (selectedProvince1) {
                    proPaintExpression.push(selectedProvince1, highlightColorPickerProvince1.value);
                }
                if (selectedProvince2) {
                    proPaintExpression.push(selectedProvince2, highlightColorPickerProvince2.value);
                }
                if (selectedProvince3) {
                    proPaintExpression.push(selectedProvince3, highlightColorPickerProvince3.value);
                }
                proPaintExpression.push('rgba(0, 0, 0, 0)'); // 기본값 (투명)

                map.setPaintProperty('province-color-fill', 'fill-color', proPaintExpression);
                map.setPaintProperty('province-color-fill', 'fill-opacity', newOpacity);

                map.setFilter('province-color-fill', [
                    "in",
                    "name",
                    ...currentSelectedProvinceCodes
                ]);
            } else {
                // 선택된 시도가 없으면 레이어를 투명하게 설정하고 필터를 비활성화
                map.setPaintProperty('province-color-fill', 'fill-color', 'rgba(0, 0, 0, 0)');
                map.setPaintProperty('province-color-fill', 'fill-opacity', 0); // 완전히 투명하게
                map.setFilter('province-color-fill', ["==", "name", ""]);
            }
        }
        // 국가 레이어 숨김
        if (map.getLayer('country-color-fill')) {
            map.setFilter('country-color-fill', ["==", "iso_3166_1_alpha_3", ""]);
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

// 선택된 시도들의 위치 중간값으로 이동 및 줌 조정 함수
function flyToSelectedProvinces() {
    if (currentSelectedProvinceCodes.length > 0) {
        const lastSelectedCode = currentSelectedProvinceCodes[currentSelectedProvinceCodes.length - 1];
        const selectedProvince = provinces.find(p => p.name === lastSelectedCode);

        if (selectedProvince && selectedProvince.center) {
            const newCenter = [...selectedProvince.center];
            let newZoom = selectedProvince.zoom;

            const currentProjection = map.getProjection().name;

            if (currentProjection === 'globe' && isFirstGlobeProjection) {
                newZoom = 2.5;
                isFirstGlobeProjection = false;
            } else {
                if (window.innerWidth <= 768) {
                    newZoom = selectedProvince.zoom - 1;
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

    // 3. 대한민국 시도 경계 데이터 소스 추가 (Mapbox Studio에서 생성한 타일셋 URL)
    // 이 URL은 Mapbox Studio에서 대한민국 시도 경계 데이터를 업로드하여 생성해야 합니다.
    // 예시: 'mapbox://styles/your-username/your-tileset-id'
    // 현재는 임시로 Mapbox의 일반 admin-0-boundary 레이어를 사용합니다.
    // TODO: 실제 대한민국 시도 타일셋 URL로 변경 필요
    map.addSource('province-boundaries', {
        type: 'geojson',
        data: 'data/KoreaAdmin_Simple_250718.geojson'
    });

    // 4. 대한민국 시도 경계 레이어 추가 및 색칠
    map.addLayer(
        {
            id: 'province-color-fill',
            source: 'province-boundaries',
            type: 'fill',
            paint: {
                'fill-color': 'rgba(255, 29, 29, 1)',
                'fill-opacity': 0.4,
            },
            filter: ["==", "name", ""] // 초기에는 아무것도 선택되지 않도록 필터링
        },
        'water' // 'water' 레이어 아래에 삽입
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

    // 6. 바다색 변경을 위한 레이어 설정
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
    updateProvinceGroupVisibility(); // 초기 시도 그룹 가시성 설정

    // --- 이벤트 리스너 ---

    // 탭 버튼 클릭 이벤트
    tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            const tabName = button.dataset.tab;

            // 모든 탭 버튼과 콘텐츠에서 'active' 클래스 제거
            tabButtons.forEach(btn => btn.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(content => {
                content.classList.remove('active');
                content.classList.add('hidden'); // 모든 탭 콘텐츠를 숨김
            });

            // 클릭된 탭에 'active' 클래스 추가하고 'hidden' 클래스 제거
            button.classList.add('active');
            const activeContent = document.getElementById(`${tabName}-tab-content`);
            activeContent.classList.add('active');
            activeContent.classList.remove('hidden'); // 활성화된 탭 콘텐츠를 보이게 함

            activeTab = tabName; // 활성 탭 업데이트

            // 탭 전환 시 데이터 초기화 및 지도 업데이트
            if (activeTab === 'country') {
                activeProvinceGroups = 1; // 다른 탭의 그룹 수를 1로 초기화
                provinceSelect1.value = ''; // 시도1 드롭다운 초기화
                updateProvinceGroupVisibility();
                updateMapPaintAndFilter(); // 국가 탭에 맞게 지도 업데이트
                flyToSelectedCountries(); // 국가 탭에 맞게 지도 이동
            } else if (activeTab === 'province') {
                activeCountryGroups = 1; // 다른 탭의 그룹 수를 1로 초기화
                countrySelect1.value = ''; // 국가1 드롭다운 초기화
                updateCountryGroupVisibility();
                updateMapPaintAndFilter(); // 시도 탭에 맞게 지도 업데이트
                flyToSelectedProvinces(); // 시도 탭에 맞게 지도 이동
            }
        });
    });

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

    // 시도 '+' 버튼 클릭 이벤트
    addProvinceButton.addEventListener('click', () => {
        if (activeProvinceGroups < 3) {
            activeProvinceGroups++;
            updateProvinceGroupVisibility();
        }
    });

    // 시도 '-' 버튼 클릭 이벤트
    removeProvinceButton.addEventListener('click', () => {
        if (activeProvinceGroups > 1) {
            activeProvinceGroups--;
            updateProvinceGroupVisibility();
        }
    });

    // 국가 드롭다운 변경 이벤트
    countrySelect1.addEventListener('change', function () {
        updateMapPaintAndFilter();
        updateDropdownOptions(); // 추가
        flyToSelectedCountries();
    });
    countrySelect2.addEventListener('change', function () {
        updateMapPaintAndFilter();
        updateDropdownOptions(); // 추가
        flyToSelectedCountries();
    });
    countrySelect3.addEventListener('change', function () {
        updateMapPaintAndFilter();
        updateDropdownOptions(); // 추가
        flyToSelectedCountries();
    });

    // 시도 드롭다운 변경 이벤트
    provinceSelect1.addEventListener('change', function () {
        updateMapPaintAndFilter();
        updateProvinceDropdownOptions();
        flyToSelectedProvinces();
    });
    provinceSelect2.addEventListener('change', function () {
        updateMapPaintAndFilter();
        updateProvinceDropdownOptions();
        flyToSelectedProvinces();
    });
    provinceSelect3.addEventListener('change', function () {
        updateMapPaintAndFilter();
        updateProvinceDropdownOptions();
        flyToSelectedProvinces();
    });

    // 국가 강조색 선택기 변경 이벤트
    highlightColorPicker1.addEventListener('input', updateMapPaintAndFilter);
    highlightColorPicker2.addEventListener('input', updateMapPaintAndFilter);
    highlightColorPicker3.addEventListener('input', updateMapPaintAndFilter);

    // 시도 강조색 선택기 변경 이벤트
    highlightColorPickerProvince1.addEventListener('input', updateMapPaintAndFilter);
    highlightColorPickerProvince2.addEventListener('input', updateMapPaintAndFilter);
    highlightColorPickerProvince3.addEventListener('input', updateMapPaintAndFilter);

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
        // 기존 레이어 및 소스 제거
        if (map.getLayer('country-color-fill')) map.removeLayer('country-color-fill');
        if (map.getSource('country-boundaries')) map.removeSource('country-boundaries');
        if (map.getLayer('province-color-fill')) map.removeLayer('province-color-fill');
        if (map.getSource('province-boundaries')) map.removeSource('province-boundaries');

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

        // 3. 대한민국 시도 경계 데이터 소스 추가 (Mapbox Studio에서 생성한 타일셋 URL)
        map.addSource('province-boundaries', {
            type: 'geojson',
            data: 'data/KoreaAdmin_Simple_250718.geojson'
        });

        // 4. 대한민국 시도 경계 레이어 추가 및 색칠
        map.addLayer(
            {
                id: 'province-color-fill',
                source: 'province-boundaries',
                type: 'fill',
                paint: {
                    'fill-color': 'rgba(255, 29, 29, 1)', // 초기값은 투명
                    'fill-opacity': 0.4,
                },
                filter: ["==", "name", ""] // 초기에는 아무것도 선택되지 않도록 필터링
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
        handleColorUIVisibility(); // 스타일 변경 시 UI 가시성 업데이트
        updateCountryGroupVisibility(); // 스타일 변경 시 국가 그룹 가시성 업데이트
    });

});
