// script.js

const tokenFunctionUrl = 'https://asia-northeast3-manage-dev-tokens.cloudfunctions.net/getMapboxToken';

// 받아온 토큰을 저장하여 반복적인 호출을 방지하기 위한 변수
let cachedToken = null;

/**
 * Cloud Function에서 맵박스 토큰을 비동기적으로 가져오는 함수
 * 한 번 가져온 토큰은 캐시에 저장하여 재사용합니다.
 * @returns {Promise<string|null>} 맵박스 토큰 또는 null
 */
export async function fetchMapboxToken() {
    // 캐시된 토큰이 있으면 즉시 반환
    if (cachedToken) {
        return cachedToken;
    }

    try {
        const response = await fetch(tokenFunctionUrl);
        if (!response.ok) {
            throw new Error('서버 응답이 올바르지 않습니다.');
        }
        const data = await response.json();

        // 받아온 토큰을 캐시에 저장
        cachedToken = data.token;
        return cachedToken;

    } catch (error) {
        console.error('맵박스 토큰을 가져오는 데 실패했습니다:', error);
        return null;
    }
}

const MAPBOX_ACCESS_TOKEN = await fetchMapboxToken();
mapboxgl.accessToken = MAPBOX_ACCESS_TOKEN;

/* --- Pickr 연동 래퍼 함수 --- */
function createPickrWrapper(elementId) {
    const inputElement = document.getElementById(elementId);
    if (!inputElement) return { value: '#000000', addEventListener: () => { } };

    const initialColor = inputElement.value || '#000000';

    // 기존 input(막대힌 브라우저 피커) 요소를 우리가 디자인할 원형 div 버튼으로 교체
    const colorBtn = document.createElement('div');
    colorBtn.id = elementId;
    colorBtn.className = 'custom-color-btn';
    colorBtn.style.backgroundColor = initialColor; // 초기 배경색 설정

    inputElement.parentNode.replaceChild(colorBtn, inputElement);

    const pickr = Pickr.create({
        el: colorBtn,
        theme: 'monolith', // 사용자가 요청한 Monolith 테마 적용
        useAsButton: true, // 핵심: Pickr 내장 버튼을 쓰지 않고 우리가 만든 요소(colorBtn)를 트리거로 사용
        default: initialColor,
        defaultRepresentation: 'RGBA', // 기본 표기법을 RGBA로 강제
        components: {
            preview: true,
            opacity: true, // 투명도 조절 허용!
            hue: true,
            interaction: {
                rgba: true,
                hsla: true,
                hex: true,
                input: true
            }
        }
    });

    const wrapper = {
        pickr: pickr, // 외부에서 Pickr 인스턴스에 접근 가능하도록 추가
        get value() {
            // 알파(투명도) 채널까지 포함된 rgba 색상 객체를 Mapbox에 적합한 문자열로 반환
            // pickr가 완전히 로드되지 않았으면 기존 색상값 사용
            if (!pickr || !pickr.getColor()) return initialColor;
            return pickr.getColor().toRGBA().toString(0);
        },
        addEventListener: function (type, listener) {
            // Pickr 이벤트 매핑 시, 드래그 중 버튼 색상이 실시간으로 바뀌게 처리
            pickr.on('change', (color) => {
                colorBtn.style.backgroundColor = color.toRGBA().toString(0);
            });
            if (type === 'input' || type === 'change') {
                pickr.on('changestop', () => listener.call(wrapper));
                pickr.on('save', () => listener.call(wrapper));
                pickr.on('clear', () => {
                    colorBtn.style.backgroundColor = 'transparent';
                    listener.call(wrapper);
                });
            }
        }
    };
    return wrapper;
}

// HTML 요소 가져오기
const countrySelect1 = document.getElementById('country-select-1');
const countrySelect2 = document.getElementById('country-select-2');
const countrySelect3 = document.getElementById('country-select-3');

const highlightColorPicker1 = createPickrWrapper('highlight-color-picker-1');
const highlightColorPicker2 = createPickrWrapper('highlight-color-picker-2');
const highlightColorPicker3 = createPickrWrapper('highlight-color-picker-3');

const borderColorPicker = createPickrWrapper('border-color-picker');
const disputedColorPicker = createPickrWrapper('disputed-color-picker');
const adminColorPicker = createPickrWrapper('admin-color-picker');

const borderOpacitySlider = document.getElementById('border-opacity-slider');
const adminOpacitySlider = document.getElementById('admin-opacity-slider');
const borderWidthSlider = document.getElementById('border-width-slider');
const adminWidthSlider = document.getElementById('admin-width-slider');

const borderDotlineChecker = document.getElementById('border-dotline-checker');
const adminDotlineChecker = document.getElementById('admin-dotline-checker');

const landColorPicker = createPickrWrapper('land-color-picker');
const waterColorPicker = createPickrWrapper('water-color-picker');
const waterChecker = document.getElementById('water-checker');

const projectionSelect = document.getElementById('projection-select');
const styleSelect = document.getElementById('style-select');

const addCountryButton = document.getElementById('add-country');
const removeCountryButton = document.getElementById('remove-country');

const countryGroup2 = document.getElementById('country-group-2');
const countryGroup3 = document.getElementById('country-group-3');

const landWaterColorGroup = document.getElementById('landwater-color-group');
const mapZoomSlider = document.getElementById('map-zoom-slider'); // 줌 슬라이더 요소 추가

// 대한민국 시도 관련 HTML 요소 가져오기
const provinceSelect1 = document.getElementById('province-select-1');
const provinceSelect2 = document.getElementById('province-select-2');
const provinceSelect3 = document.getElementById('province-select-3');
const provinceGroup2 = document.getElementById('province-group-2');
const provinceGroup3 = document.getElementById('province-group-3');
const addProvinceButton = document.getElementById('add-province');
const removeProvinceButton = document.getElementById('remove-province');

const highlightColorPickerProvince1 = createPickrWrapper('highlight-color-picker-province-1');
const highlightColorPickerProvince2 = createPickrWrapper('highlight-color-picker-province-2');
const highlightColorPickerProvince3 = createPickrWrapper('highlight-color-picker-province-3');

// 탭 관련 요소
const tabButtons = document.querySelectorAll('.tab-button');
const countryTabContent = document.getElementById('country-tab-content');
const provinceTabContent = document.getElementById('province-tab-content');
const minimizeButton = document.getElementById('minimize-button'); // 최소화 버튼
const countrySelectorContainer = document.getElementById('country-selector-container'); // 전체 컨테이너

// 전역 상태 변수
let activeCountryGroups = 1;
let activeProvinceGroups = 1;
let currentSelectedCountryIsos = [];
let currentSelectedProvinceCodes = []; // 시도 코드 저장을 위한 새 변수
let activeTab = 'country'; // 현재 활성화된 탭을 추적하는 변수 (초기값 'country')
let isFirstGlobeProjection = true; // 지구본 투영법에서 초기 줌 조정을 위한 플래그
let isMinimized = false; // 최소화 상태를 추적하는 변수

const map = new mapboxgl.Map({
    container: 'map',
    style: 'mapbox://styles/designeraj/cmma6v98500gl01suhod9gfsz', // 사용자의 커스텀 스타일 URL
    center: [127, 36], // 초기 지도 중심 (한국)
    zoom: 6, // 초기 지도 줌 레벨
    projection: 'mercator', // 초기 투영법 설정 (기본값)
});

// 국가 목록 데이터는 config.js에서 가져옵니다.
const countries = COUNTRIES_DATA;

const mapStyles = [
    { name: '단색지형', value: 'mapbox://styles/designeraj/cmma6v98500gl01suhod9gfsz' },
    { name: '단색', value: 'mapbox://styles/designeraj/cmcvnojkj005p01sq5jax8qhf' },
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

const krGeojson = './data/KoreaAdmin_Simple_250718.geojson'; // 로컬 테스트용
const krLineGeojson = './data/KoreaAdmin_line_250808.geojson'; // 로컬 테스트용
// const krGeojson = '../ColorMap/data/KoreaAdmin_Simple_250718.geojson'; // 업로드시 사용
// const krLineGeojson = '../ColorMap/data/KoreaAdmin_line_250808.geojson'; // 업로드시 사용


// 데이터리스트 채우기 함수
function populateDatalist(datalistElement, data, type) {
    datalistElement.innerHTML = ''; // 기존 옵션 초기화
    data.forEach(item => {
        const option = document.createElement('option');
        if (type === 'country') {
            option.value = item.name;
            option.dataset.iso = item.iso;
        } else {
            option.value = item.name;
        }
        datalistElement.appendChild(option);
    });
}

// 각 국가 데이터리스트 채우기
populateDatalist(document.getElementById('country-datalist-1'), COUNTRIES_DATA, 'country');
populateDatalist(document.getElementById('country-datalist-2'), COUNTRIES_DATA, 'country');
populateDatalist(document.getElementById('country-datalist-3'), COUNTRIES_DATA, 'country');

// 대한민국 시도 목록 데이터는 config.js에서 가져옵니다.
const provinces = PROVINCES_DATA;

// 각 시도 데이터리스트 채우기
populateDatalist(document.getElementById('province-datalist-1'), PROVINCES_DATA, 'province');
populateDatalist(document.getElementById('province-datalist-2'), PROVINCES_DATA, 'province');
populateDatalist(document.getElementById('province-datalist-3'), PROVINCES_DATA, 'province');


// 초기 선택 국가 설정
countrySelect1.value = '대한민국';
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
}


// 국가 이름으로 ISO 코드를 찾는 함수
function getCountryIsoByName(name) {
    const country = COUNTRIES_DATA.find(c => c.name === name);
    return country ? country.iso : null;
}

// 입력 값 유효성 검사 및 ISO 코드 변환 함수
function getSelectedCountryIso(inputElement) {
    const countryName = inputElement.value;
    return getCountryIsoByName(countryName);
}

// 동적 데이터리스트 업데이트 (국가)
function updateCountryDatalist() {
    const allSelects = [countrySelect1, countrySelect2, countrySelect3].filter(el => !el.parentElement.classList.contains('hidden'));
    const selectedNames = allSelects.map(select => select.value).filter(value => value !== '');

    allSelects.forEach(selectElement => {
        const datalist = document.getElementById(selectElement.getAttribute('list'));
        const currentVal = selectElement.value;

        // 다른 input에서 선택된 값을 제외한 목록 생성
        const filteredCountries = COUNTRIES_DATA.filter(country =>
            !selectedNames.includes(country.name) || country.name === currentVal
        );

        populateDatalist(datalist, filteredCountries, 'country');
    });
}

// 동적 데이터리스트 업데이트 (시도)
function updateProvinceDatalist() {
    const allSelects = [provinceSelect1, provinceSelect2, provinceSelect3].filter(el => !el.parentElement.classList.contains('hidden'));
    const selectedNames = allSelects.map(select => select.value).filter(value => value !== '');

    allSelects.forEach(selectElement => {
        const datalist = document.getElementById(selectElement.getAttribute('list'));
        const currentVal = selectElement.value;

        const filteredProvinces = PROVINCES_DATA.filter(province =>
            !selectedNames.includes(province.name) || province.name === currentVal
        );

        populateDatalist(datalist, filteredProvinces, 'province');
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
    const isDefaultStyle = (
        currentStyleValue === 'mapbox://styles/designeraj/cmma6v98500gl01suhod9gfsz' ||
        currentStyleValue === 'mapbox://styles/designeraj/cmcvnojkj005p01sq5jax8qhf'
    );

    if (landWaterColorGroup) {
        if (isDefaultStyle) {
            landWaterColorGroup.classList.remove('hidden');
        } else {
            landWaterColorGroup.classList.add('hidden');
            waterChecker.checked = false; // 스타일이 변경되면 물 체크박스 해제
        }
    }
}

// 맵 스타일별 디폴트 투명도(Alpha) 적용 함수
function applyDefaultAlphaByStyle() {
    if (!styleSelect) return;
    const currentStyle = styleSelect.value;
    // '단색' 스타일만 1.0, 나머지는 0.6
    const defaultAlpha = (currentStyle === 'mapbox://styles/designeraj/cmcvnojkj005p01sq5jax8qhf') ? 1.0 : 0.60;

    const fillPickers = [
        highlightColorPicker1, highlightColorPicker2, highlightColorPicker3,
        highlightColorPickerProvince1, highlightColorPickerProvince2, highlightColorPickerProvince3
    ];

    fillPickers.forEach(wrapper => {
        if (wrapper && wrapper.pickr) {
            const color = wrapper.pickr.getColor().toRGBA();
            // 기존 색상(RGB)은 유지하고 alpha만 변경
            wrapper.pickr.setColor(`rgba(${color[0]}, ${color[1]}, ${color[2]}, ${defaultAlpha})`);
        }
    });
}

// 지도 색상 및 필터 업데이트 함수
function updateMapPaintAndFilter() {
    const currentStyleValue = styleSelect.value; // 현재 선택된 스타일 값 가져오기

    // (기존의 지형/단색 스타일에 따른 일괄 fill-opacity 지정 로직 삭제됨)

    const countryDashLineProperty = [
        "step",
        ["zoom"],
        ["literal", [2, 2]],
        6,
        ["literal", [2, 2]],
        12,
        ["literal", [5, 3]]
    ]

    const adminDashLineProperty = [
        "step",
        ["zoom"],
        ["literal", [2, 3]],
        6,
        ["literal", [2, 3]],
        12,
        ["literal", [4, 3]]
    ]

    // 국경선 색상 업데이트 (투명도 제거)
    if (map.getLayer('country-border')) {
        map.setPaintProperty('country-border', 'line-color', borderColorPicker.value);
        map.setPaintProperty('country-border', 'line-width', parseFloat(borderWidthSlider.value));
        if (borderDotlineChecker.checked) {
            map.setPaintProperty('country-border', 'line-dasharray', countryDashLineProperty);
        } else {
            // 실선으로 초기화
            map.setPaintProperty('country-border', 'line-dasharray', [1, 0]);
        }
    }

    // 분쟁지역선 업데이트
    if (map.getLayer('dispute-boundaries')) {
        map.setPaintProperty('dispute-boundaries', 'line-color', disputedColorPicker.value);
        map.setPaintProperty('dispute-boundaries', 'line-width', parseFloat(borderWidthSlider.value) * 0.8);
    }

    // 행정구역선 업데이트
    if (map.getLayer('admin-boundaries')) {
        map.setPaintProperty('admin-boundaries', 'line-color', adminColorPicker.value);
        map.setPaintProperty('admin-boundaries', 'line-width', parseFloat(adminWidthSlider.value));
        if (adminDotlineChecker.checked) {
            map.setPaintProperty('admin-boundaries', 'line-dasharray', adminDashLineProperty);
        } else {
            map.setPaintProperty('admin-boundaries', 'line-dasharray', [1, 0]);
        }
    }

    // 시도 경계선 레이어 업데이트
    if (map.getLayer('province-border-line')) {
        map.setPaintProperty('province-border-line', 'line-color', adminColorPicker.value);
        map.setPaintProperty('province-border-line', 'line-width', parseFloat(adminWidthSlider.value));
        if (adminDotlineChecker.checked) {
            map.setPaintProperty('province-border-line', 'line-dasharray', adminDashLineProperty);
        } else {
            map.setPaintProperty('province-border-line', 'line-dasharray', [1, 0]);
        }
    }

    // 강/호수 레이어 가시성 및 색상 업데이트
    if (map.getLayer('water')) {
        const waterIsVisible = waterChecker.checked;
        map.setLayoutProperty('water', 'visibility', waterIsVisible ? 'visible' : 'none');
        if (waterIsVisible) {
            map.setPaintProperty('water', 'fill-color', waterColorPicker.value);
            map.setPaintProperty('water', 'fill-outline-color', waterColorPicker.value);
        }
    }

    if (activeTab === 'country') {
        const selectedCountry1 = getSelectedCountryIso(countrySelect1);
        const selectedCountry2 = getSelectedCountryIso(countrySelect2);
        const selectedCountry3 = getSelectedCountryIso(countrySelect3);

        if (map.getLayer('country-color-fill')) {
            map.setLayoutProperty('country-color-fill', 'visibility', 'visible'); // 다시 보이게
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

            if (currentSelectedCountryIsos.length > 0) {
                map.setPaintProperty('country-color-fill', 'fill-color', paintExpression);
            } else {
                map.setPaintProperty('country-color-fill', 'fill-color', 'rgba(0, 0, 0, 0)');
            }

            let worldviewFilter = [
                "match",
                ["get", "worldview"],
                [
                    "AR,CN,IN,MA,RS,RU,TR,US"
                ],
                true,
                false
            ];

            if (currentSelectedCountryIsos.length > 0) {
                map.setFilter('country-color-fill', [
                    'all',
                    ['any',
                        ['==', 'all', ['get', 'worldview']],
                        ['in', 'US', ['get', 'worldview']],
                    ],
                ]);
            } else {
                map.setFilter('country-color-fill', ["==", "iso_3166_1_alpha_3", ""]); // 선택된 국가가 없으면 숨김
            }

        }
        // 시도 색상 레이어 숨김 (필터 대신 visibility 속성 활용)
        if (map.getLayer('province-color-fill')) {
            map.setLayoutProperty('province-color-fill', 'visibility', 'none');
            map.setFilter('province-color-fill', ["==", "name", ""]);
        }
        // 시도 경계선 레이어 숨김 (opacity 0 대신 visibility none 활용)
        if (map.getLayer('province-border-line')) {
            map.setLayoutProperty('province-border-line', 'visibility', 'none');
        }
        // admin-boundaries 레이어 다시 보이게
        if (map.getLayer('admin-boundaries')) {
            map.setLayoutProperty('admin-boundaries', 'visibility', 'visible');
        }

    } else if (activeTab === 'province') {

        // admin-boundaries 레이어 숨김
        if (map.getLayer('admin-boundaries')) {
            map.setLayoutProperty('admin-boundaries', 'visibility', 'none');
        }
        // 시도 경계선 레이어 보이게
        if (map.getLayer('province-border-line')) {
            map.setLayoutProperty('province-border-line', 'visibility', 'visible');
        }

        // 시도 색상 레이어 보이게
        if (map.getLayer('province-color-fill')) {
            map.setLayoutProperty('province-color-fill', 'visibility', 'visible');

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

                map.setFilter('province-color-fill', [
                    "in",
                    "name",
                    ...currentSelectedProvinceCodes
                ]);
            } else {
                // 선택된 시도가 없으면 레이어를 투명하게 설정하고 필터 초기화
                map.setPaintProperty('province-color-fill', 'fill-color', 'rgba(0, 0, 0, 0)');
                map.setFilter('province-color-fill', ["==", "name", ""]);
            }
        }
        // 국가 색상 레이어 숨김
        if (map.getLayer('country-color-fill')) {
            map.setLayoutProperty('country-color-fill', 'visibility', 'none');
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

    // 초기 스타일 투명도 적용
    applyDefaultAlphaByStyle();

    // 줌 슬라이더 초기값 설정
    mapZoomSlider.value = map.getZoom().toFixed(1);

    // 줌 슬라이더 변경 이벤트
    mapZoomSlider.addEventListener('input', function () {
        map.setZoom(parseFloat(this.value));
    });

    // 맵 줌 변경 이벤트 (맵 줌이 변경될 때 슬라이더 업데이트)
    map.on('zoom', function () {
        mapZoomSlider.value = map.getZoom().toFixed(1);
    });

    // 1. 국가 경계 데이터 소스 추가
    map.addSource('country-boundaries', {
        type: 'vector',
        url: 'mapbox://mapbox.country-boundaries-v1',
    });

    // 2. 국가 경계 레이어 추가 및 색칠
    let worldviewFilter = [
        "all",
        [
            "match",
            ["get", "worldview"],
            [
                "AR,CN,IN,MA,RS,RU,TR,US"
            ],
            true,
            false
        ]
    ];

    map.addLayer(
        {
            id: 'country-color-fill',
            source: 'country-boundaries',
            'source-layer': 'country_boundaries',
            filter: worldviewFilter, // 세계관 필터 적용
            type: 'fill',
            paint: {
                'fill-color': 'rgba(0, 0, 0, 0)' // 초기값은 투명으로 설정하고, updateMapPaintAndFilter에서 실제 색상 적용
            },
        },
        'water' // 'water' 레이어 아래에 삽입
    );

    // 3. 대한민국 시도 경계 geoJson데이터
    map.addSource('province-boundaries', {
        type: 'geojson',
        data: krGeojson
    });

    map.addSource('province-boundaries-line', {
        type: 'geojson',
        data: krLineGeojson
    });

    // 4. 대한민국 시도 경계 레이어 추가 및 색칠
    map.addLayer(
        {
            id: 'province-color-fill',
            source: 'province-boundaries',
            type: 'fill',
            paint: {
                'fill-color': 'rgba(0, 0, 0, 0)'
            },
            filter: ["==", "name", ""] // 초기에는 아무것도 선택되지 않도록 필터링
        },
        'water' // 'water' 레이어 아래에 삽입
    );

    // 4-1. 대한민국 시도 경계선 레이어 추가 (라인)
    const linePaintPropsLoad = {
        'line-color': adminColorPicker.value, // admin-boundaries와 동일한 색상 공유
        'line-width': parseFloat(adminWidthSlider.value) // 행정구역선 두께 공유
    };
    if (adminDotlineChecker.checked) {
        linePaintPropsLoad['line-dasharray'] = adminDashLineProperty; // 점선 유무 공유
    }

    map.addLayer({
        id: 'province-border-line',
        source: 'province-boundaries-line',
        type: 'line',
        paint: linePaintPropsLoad,
        layout: {
            'line-join': 'round',
            'line-cap': 'round',
            'visibility': activeTab === 'province' ? 'visible' : 'none'
        }
    }); // 최상단에 그리기 위해 삽입 기준 생략

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

    // 최소화 버튼 클릭 이벤트
    minimizeButton.addEventListener('click', () => {
        isMinimized = !isMinimized; // 상태 토글
        countrySelectorContainer.classList.toggle('minimized', isMinimized); // minimized 클래스 토글

        // 아이콘 변경
        const icon = minimizeButton.querySelector('i');
        if (isMinimized) {
            icon.classList.remove('fa-angle-up');
            icon.classList.add('fa-angle-down');
        } else {
            icon.classList.remove('fa-angle-down');
            icon.classList.add('fa-angle-up');
        }
    });

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

    // 국가 입력 필드 이벤트 리스너
    [countrySelect1, countrySelect2, countrySelect3].forEach(input => {
        input.addEventListener('focus', updateCountryDatalist);
        input.addEventListener('change', function () {
            // 유효한 국가 이름인지 확인
            const iso = getSelectedCountryIso(this);
            if (this.value && !iso) {
                this.value = ''; // 유효하지 않으면 값 초기화
            }
            updateMapPaintAndFilter();
            flyToSelectedCountries();
            updateCountryDatalist(); // 선택 후 다른 목록들도 업데이트
        });
    });

    // 시도 입력 필드 이벤트 리스너
    [provinceSelect1, provinceSelect2, provinceSelect3].forEach(input => {
        input.addEventListener('focus', updateProvinceDatalist);
        input.addEventListener('change', function () {
            const isValid = PROVINCES_DATA.some(p => p.name === this.value);
            if (this.value && !isValid) {
                this.value = ''; // 유효하지 않으면 값 초기화
            }
            updateMapPaintAndFilter();
            flyToSelectedProvinces();
            updateProvinceDatalist(); // 선택 후 다른 목록들도 업데이트
        });
    });

    // 국가 강조색 선택기 변경 이벤트
    highlightColorPicker1.addEventListener('input', updateMapPaintAndFilter);
    highlightColorPicker2.addEventListener('input', updateMapPaintAndFilter);
    highlightColorPicker3.addEventListener('input', updateMapPaintAndFilter);

    // 시도 강조색 선택기 변경 이벤트
    highlightColorPickerProvince1.addEventListener('input', updateMapPaintAndFilter);
    highlightColorPickerProvince2.addEventListener('input', updateMapPaintAndFilter);
    highlightColorPickerProvince3.addEventListener('input', updateMapPaintAndFilter);

    // 국경/분쟁/행정 색상 선택기 변경 이벤트
    borderColorPicker.addEventListener('input', updateMapPaintAndFilter);
    disputedColorPicker.addEventListener('input', updateMapPaintAndFilter);
    adminColorPicker.addEventListener('input', updateMapPaintAndFilter);

    // 국경선 투명도 외부 슬라이더 변경 시 Pickr 알파 조절 (동기화)
    borderOpacitySlider.addEventListener('input', function () {
        [borderColorPicker, disputedColorPicker].forEach(wrapper => {
            if (wrapper.pickr) {
                let rgba = wrapper.pickr.getColor().toRGBA();
                rgba[3] = parseFloat(borderOpacitySlider.value);
                wrapper.pickr.setColor(`rgba(${rgba[0]}, ${rgba[1]}, ${rgba[2]}, ${rgba[3]})`);
            }
        });
        updateMapPaintAndFilter();
    });

    // Pickr 투명도 변경 시 외부 국경선 슬라이더 갱신 (역동기화)
    [borderColorPicker, disputedColorPicker].forEach(wrapper => {
        if (wrapper.pickr) wrapper.pickr.on('change', (color) => {
            borderOpacitySlider.value = color.toRGBA()[3];
        });
    });

    // 행정구역선 투명도 외부 슬라이더 변경 시 Pickr 알파 조절 (동기화)
    adminOpacitySlider.addEventListener('input', function () {
        if (adminColorPicker.pickr) {
            let rgba = adminColorPicker.pickr.getColor().toRGBA();
            rgba[3] = parseFloat(adminOpacitySlider.value);
            adminColorPicker.pickr.setColor(`rgba(${rgba[0]}, ${rgba[1]}, ${rgba[2]}, ${rgba[3]})`);
        }
        updateMapPaintAndFilter();
    });

    // Pickr 투명도 변경 시 외부 행정구역선 슬라이더 갱신 (역동기화)
    if (adminColorPicker.pickr) {
        adminColorPicker.pickr.on('change', (color) => {
            adminOpacitySlider.value = color.toRGBA()[3];
        });
    }

    // 국경선 두께 슬라이더 변경 이벤트
    borderWidthSlider.addEventListener('input', updateMapPaintAndFilter);

    // 행정구역선 두께 슬라이더 변경 이벤트
    adminWidthSlider.addEventListener('input', updateMapPaintAndFilter);

    // 점선 체크박스 변경 이벤트
    borderDotlineChecker.addEventListener('change', updateMapPaintAndFilter);
    adminDotlineChecker.addEventListener('change', updateMapPaintAndFilter);

    // 강/호수 체크박스 변경 이벤트
    waterChecker.addEventListener('change', updateMapPaintAndFilter);

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
        // 강/호수 레이어 색상도 함께 업데이트 (체크된 경우)
        if (waterChecker.checked && map.getLayer('water')) {
            map.setPaintProperty('water', 'fill-color', newColor);
            map.setPaintProperty('water', 'fill-outline-color', newColor);
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

        // 스타일별 디폴트 alpha 적용
        applyDefaultAlphaByStyle();

        map.setStyle(newStyle, { diff: false }); // diff 비활성화하여 리렌더링 오류 및 404 방지
        handleColorUIVisibility(); // 스타일 변경 시 UI 가시성 업데이트
    });

    // 스타일이 변경될 때마다 레이어를 다시 추가하고 필터를 업데이트
    map.on('style.load', function () {
        // 기존 레이어 및 소스 제거
        if (map.getLayer('country-color-fill')) map.removeLayer('country-color-fill');
        if (map.getSource('country-boundaries')) map.removeSource('country-boundaries');
        if (map.getLayer('province-color-fill')) map.removeLayer('province-color-fill');
        if (map.getLayer('province-border-line')) map.removeLayer('province-border-line');
        if (map.getSource('province-boundaries')) map.removeSource('province-boundaries');
        if (map.getSource('province-line-boundaries')) map.removeSource('province-line-boundaries');

        // 1. 국가 경계 데이터 소스 추가 (스타일 변경 시 다시 추가)
        map.addSource('country-boundaries', {
            type: 'vector',
            url: 'mapbox://mapbox.country-boundaries-v1',
        });

        let worldviewFilter = [
            "all",
            [
                "match",
                ["get", "worldview"],
                [
                    "AR,CN,IN,MA,RS,RU,TR,US"
                ],
                true,
                false
            ]
        ];

        // 2. 국가 경계 레이어 추가 및 색칠 (스타일 변경 시 다시 추가)
        map.addLayer(
            {
                id: 'country-color-fill',
                source: 'country-boundaries',
                'source-layer': 'country_boundaries',
                filter: worldviewFilter, // 세계관 필터 적용
                type: 'fill',
                paint: {
                    'fill-color': 'rgba(0, 0, 0, 0)', // 초기값은 투명으로 설정하고, updateMapPaintAndFilter에서 실제 색상 적용
                },
            },
            'water' // 'water' 레이어 아래에 삽입
        );

        // 3. 대한민국 시도 경계 데이터 소스 추가 (Mapbox Studio에서 생성한 타일셋 URL 대신 로컬 GEOJSON)
        map.addSource('province-boundaries', {
            type: 'geojson',
            data: krGeojson
        });

        // 3-1. 대한민국 시도 경계선 전용 라인 데이터 소스 추가
        map.addSource('province-line-boundaries', {
            type: 'geojson',
            data: krLineGeojson
        });

        // 4. 대한민국 시도 경계 레이어 추가 및 색칠
        map.addLayer(
            {
                id: 'province-color-fill',
                source: 'province-boundaries',
                type: 'fill',
                paint: {
                    'fill-color': 'rgba(255, 29, 29, 1)', // 초기값은 투명
                },
                filter: ["==", "name", ""] // 초기에는 아무것도 선택되지 않도록 필터링
            },
            'water' // 'water' 레이어 아래에 삽입
        );

        // 4-1. 대한민국 시도 경계선 레이어 추가 (라인)
        const linePaintProps = {
            'line-color': adminColorPicker.value, // admin-boundaries와 동일한 색상 공유
            'line-width': parseFloat(adminWidthSlider.value) // 행정구역선 두께 공유
        };
        if (adminDotlineChecker.checked) {
            linePaintProps['line-dasharray'] = adminDashLineProperty; // 점선 유무 공유
        }

        map.addLayer({
            id: 'province-border-line',
            source: 'province-line-boundaries',
            type: 'line',
            paint: linePaintProps,
            layout: {
                'line-join': 'round',
                'line-cap': 'round',
                'visibility': activeTab === 'province' ? 'visible' : 'none' // 현재 탭에 맞춰 초기 가시성 설정
            }
        }); // 최상단에 그리기 위해 삽입 기준 생략

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
