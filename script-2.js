// script.js

// config.js에서 정의한 토큰 변수를 사용합니다.
mapboxgl.accessToken = MAPBOX_ACCESS_TOKEN;

var map = new mapboxgl.Map({
    container: 'map',
    // style: 'mapbox://styles/mapbox/light-v11',
    style: 'mapbox://styles/designeraj/cmcvnojkj005p01sq5jax8qhf',
    center: [127, 36], // 한국 중심으로 설정
    zoom: 6 // 한국을 잘 볼 수 있도록 줌 레벨 조정
});

map.on('load', function () {
    // 국가 경계 소스 추가
    map.addSource('country-boundaries', { // 소스 ID를 더 명확하게 변경
        type: 'vector',
        url: 'mapbox://mapbox.country-boundaries-v1',
    });

    // 국가 경계 레이어 추가 (채우기)
    map.addLayer(
        {
            id: 'country-color-fill',
            source: 'country-boundaries',
            'source-layer': 'country_boundaries',
            type: 'fill',
            paint: {
                'fill-color': '#ff0000',
                'fill-opacity': 0.3,
            },
        }
    );

    // 한국을 필터링하여 강조
    map.setFilter('country-color-fill', [
        "in",
        "iso_3166_1_alpha_3",
        'KOR' // 대한민국 ISO 3166-1 alpha-3 코드
    ]);

    // 선택 사항: 국가 경계선 레이어 추가 (선)
    map.addLayer(
        {
            id: 'country-borders', // 레이어 ID
            source: 'country-boundaries',
            'source-layer': 'country_boundaries',
            type: 'line',
            paint: {
                'line-color': '#AA0000', // 검은색 선
                'line-width': 0.5,
                'line-opacity': 0.5
            }
        }
    );

    // 한국 경계선도 필터링
    map.setFilter('country-borders', [
        "in",
        "iso_3166_1_alpha_3",
        'KOR'
    ]);
});