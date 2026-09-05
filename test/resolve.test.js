/* 검색어 해석. 애매하면 아무것도 안 고르는 게 이 함수의 핵심 계약이다 —
   예전에 '구' 한 글자로 종로구가 조용히 칠해지던 사고가 여기서 났다. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { extract, readSrc, readJSON } from './helpers/extract.js';

const R = extract('recorder/js/recorder.js', ['SIDO_SUFFIX', 'stripSido', 'sidoAbbr',
  'resolveByMeta', 'suggestByMeta', 'buildMeta', 'ADMIN1_RENAME', 'tuneKoreanAdmin1']);

const regions = readSrc('recorder/js/data/regions.js');
const SIDO_META = new Function(`${regions.match(/const SIDO_META = \[[\s\S]*?\];/)[0]}\nreturn SIDO_META;`)();
const sidoMeta = {};
SIDO_META.forEach((s) => { sidoMeta[s.n] = { n: s.n, s: s.s, c: s.c, z: s.z }; });
const sido = (q) => R.resolveByMeta(sidoMeta, q, (s) => R.stripSido(s.n));

test('시도: 약칭·정식명·접미사 뗀 이름 모두 찾는다', () => {
  for (const [q, want] of [
    ['경기', '경기도'], ['경기도', '경기도'],
    ['충북', '충청북도'], ['충청북', '충청북도'], ['충청북도', '충청북도'],
    ['서울', '서울특별시'], ['제주', '제주특별자치도'], ['강원', '강원특별자치도'],
  ]) assert.equal(sido(q), want, `'${q}' → ${want}`);
});

test('시도: 애매하거나 한 글자면 아무것도 고르지 않는다', () => {
  for (const q of ['도', '시', '경', '', '   ', 'ㅋ']) {
    assert.equal(sido(q), null, `'${q}' 로는 아무것도 고르면 안 된다`);
  }
});

test('시도 약칭은 두 글자다 (칩에 그대로 쓰인다)', () => {
  for (const s of SIDO_META) {
    assert.equal(s.s.length, 2, `${s.n} 의 약칭 '${s.s}' 가 두 글자가 아니다`);
  }
});

test('stripSido 는 접미사만 뗀다', () => {
  assert.equal(R.stripSido('경상남도'), '경상남');
  assert.equal(R.stripSido('강원특별자치도'), '강원');
  assert.equal(R.stripSido('서울특별시'), '서울');
  assert.equal(R.stripSido('세종특별자치시'), '세종');
});

// ── 시군구 (파일이 커서 한 번만 읽는다) ──
const sigunguGeo = readJSON('recorder/js/data/sigungu.json');
const sigunguMeta = R.buildMeta(sigunguGeo, 'sido', 10);
const sg = (q) => R.resolveByMeta(sigunguMeta, q);

test('시군구: 정식명과 고유한 약칭은 찾는다', () => {
  assert.equal(sg('강남구'), '서울특별시 강남구');
  assert.equal(sg('서울특별시 종로구'), '서울특별시 종로구');
  assert.equal(sg('춘천시'), '강원특별자치도 춘천시');
});

test('시군구: 한 글자·모호한 조각은 거부한다 (조용한 오작동 방지)', () => {
  for (const q of ['구', '시', '군', '동', '남']) {
    assert.equal(sg(q), null, `'${q}' 가 무언가를 집어냈다`);
  }
});

test('시군구: 동명이 여럿이면 고르지 않는다', () => {
  // 중구·남구·동구는 여러 광역시에 있다
  for (const q of ['중구', '남구', '동구']) {
    const dup = Object.values(sigunguMeta).filter((s) => s.s === q).length;
    if (dup > 1) {
      // 약칭 정확일치는 첫 항목을 쓴다 — 대신 후보 목록에는 정식명으로 올라간다
      assert.ok(sigunguMeta[sg(q)], `'${q}' 결과가 실재하는 시군구여야 한다`);
      // 이름이 정확히 겹치는 후보들은 dup 으로 표시돼 정식명으로 올라간다.
      // ('남구' 로 검색하면 하남구·강남구처럼 겹치지 않는 것도 같이 나오므로 그건 제외하고 본다)
      const exact = R.suggestByMeta(sigunguMeta, q).filter((o) => o.s === q);
      assert.ok(exact.length > 1 && exact.every((o) => o.dup),
        `'${q}' 동명 후보들이 정식명으로 구분되어 올라와야 한다`);
    }
  }
});

test('후보 목록은 지역명이 먼저, 시도로 훑는 검색은 뒤로', () => {
  // '강' 을 치면 강남구·강서구 같은 게 강원도 시·군보다 앞이어야 한다
  const out = R.suggestByMeta(sigunguMeta, '강');
  const firstBySido = out.findIndex((s) => !s.s.includes('강') && s.n.includes('강'));
  const lastByName = out.map((s) => s.s.includes('강')).lastIndexOf(true);
  if (firstBySido >= 0) assert.ok(lastByName < firstBySido, '이름 일치가 시도 일치보다 앞서야 한다');
});

/* ── 행정구역 탭의 남북 시·도 ──
   4,589개 파일을 읽지 않고, 실제 admin1.json 이 주는 모양 그대로의 작은 표를 만들어 본다.
   ('도' 로 끝나는 외국 이름이 141개 섞여 있다는 것까지 재현해야 의미가 있다) */
const admin1Sample = () => R.tuneKoreanAdmin1({
  '대한민국 충청북도':     { n: '대한민국 충청북도',     s: '충청북도',     q: '대한민국' },
  '대한민국 경상남도':     { n: '대한민국 경상남도',     s: '경상남도',     q: '대한민국' },
  '대한민국 전북특별자치도': { n: '대한민국 전북특별자치도', s: '전북특별자치도', q: '대한민국' },
  '대한민국 강원특별자치도': { n: '대한민국 강원특별자치도', s: '강원특별자치도', q: '대한민국' },
  '북한 평안남도':        { n: '북한 평안남도',        s: '평안남도',     q: '북한' },
  '북한 황해북도':        { n: '북한 황해북도',        s: '황해북도',     q: '북한' },
  '북한 평양직할시':       { n: '북한 평양직할시',       s: '평양직할시',    q: '북한' },
  '북한 량강도':          { n: '북한 량강도',          s: '량강도',       q: '북한' },
  '북한 강원도':          { n: '북한 강원도',          s: '강원도',       q: '북한' },
  '일본 홋카이도':        { n: '일본 홋카이도',        s: '홋카이도',     q: '일본' },
  '이탈리아 코모도':       { n: '이탈리아 코모도',       s: '코모도',       q: '이탈리아' },
});
const a1 = (q) => R.resolveByMeta(admin1Sample(), q, (s) => s.a);

test('행정구역: 남북 시·도를 약칭과 정식명 둘 다로 찾는다', () => {
  for (const [q, want] of [
    ['충북', '대한민국 충청북도'], ['충청북도', '대한민국 충청북도'],
    ['경남', '대한민국 경상남도'], ['경상남도', '대한민국 경상남도'],
    ['전북', '대한민국 전북특별자치도'],
    ['평남', '북한 평안남도'], ['평안남도', '북한 평안남도'],
    ['황북', '북한 황해북도'], ['평양', '북한 평양직할시'], ['량강', '북한 량강도'],
  ]) assert.equal(a1(q), want, `'${q}' → ${want}`);
});

test('행정구역: 북한 강원도는 이름에 소속을 붙여 우리 강원과 구분한다', () => {
  const meta = admin1Sample();
  assert.equal(meta['북한 강원도'].s, '강원도(북한)');
  assert.equal(meta['북한 강원도'].n, '북한 강원도', '정식명은 그대로여야 한다 (데이터와 같은 키)');
  assert.equal(R.resolveByMeta(meta, '강원도(북한)', (s) => s.a), '북한 강원도');
  // 목록에도 구분된 이름으로 오른다
  assert.ok(R.suggestByMeta(meta, '강원').some((s) => s.s === '강원도(북한)'));
});

test("행정구역: 남북에 다 있는 '강원' 약칭으로는 아무것도 고르지 않는다", () => {
  const meta = admin1Sample();
  assert.equal(meta['북한 강원도'].a, '', '겹치는 약칭은 비워둬야 한다');
  assert.equal(meta['대한민국 강원특별자치도'].a, '');
  assert.equal(a1('강원'), null, '둘 중 하나를 조용히 집어내면 안 된다');
  assert.equal(R.suggestByMeta(meta, '강원', (s) => s.a).length, 2, '대신 후보 목록에 둘 다 올라야 한다');
});

test("행정구역: '도'로 끝나는 외국 이름에는 약칭 규칙을 쓰지 않는다", () => {
  const meta = admin1Sample();
  assert.equal(meta['일본 홋카이도'].a, undefined, '홋카이도 → 홋이 같은 말이 나오면 안 된다');
  assert.equal(meta['이탈리아 코모도'].a, undefined);
  assert.equal(a1('홋카이도'), '일본 홋카이도', '정식 이름으로는 그대로 찾혀야 한다');
});

test('sidoAbbr 은 접미사를 뗀 세 글자에서 1·3번째를 딴다', () => {
  for (const [n, want] of [
    ['충청북도', '충북'], ['경상남도', '경남'], ['함경북도', '함북'], ['황해남도', '황남'],
    ['강원도', '강원'], ['량강도', '량강'], ['평양직할시', '평양'],
    ['강원특별자치도', '강원'], ['서울특별시', '서울'],
  ]) assert.equal(R.sidoAbbr(n), want, `${n} → ${want}`);
});

test('buildMeta 가 중복 약칭을 dup 으로 표시한다', () => {
  const dups = Object.values(sigunguMeta).filter((s) => s.dup);
  assert.ok(dups.length > 0, '동명 시군구가 있어야 정상이다');
  for (const d of dups) {
    const same = Object.values(sigunguMeta).filter((s) => s.s === d.s).length;
    assert.ok(same > 1, `${d.n} 이 dup 인데 실제로는 하나뿐이다`);
  }
});

/* ── 검색 결과 순위 (rankPlaces) ──

   제공자를 동시에 부르게 되면서, 어느 답을 위로 올릴지가 검색 품질을 그대로 결정한다.
   예전에는 순서대로 부르다 처음 결과가 나온 곳에서 멈췄고, 그래서 '남대문시장' 을 치면
   Mapbox 가 준 도로명 '남대문시장4길' 이 이겨 정작 남대문시장은 나오지도 않았다. */
const P = extract('recorder/js/recorder.js', ['normName', 'geoDist', 'rankPlaces']);
const place = (name, center = [127, 37.5], src = 'X') => ({ name, center, src });

test('이름이 정확히 맞는 결과가 부분 일치보다 위로 온다', () => {
  // 실제로 났던 사고: 도로명이 먼저 나와 시장을 덮었다
  const out = P.rankPlaces('남대문시장', [
    place('남대문시장4길', [126.9754, 37.5589], 'Mapbox'),
    place('남대문시장', [126.9779, 37.5594], 'Google'),
  ]);
  assert.equal(out[0].name, '남대문시장');
});

test('표기가 다른 해외 지명이 국내 상호명에 밀리지 않는다', () => {
  /* **이 검사가 순위 규칙의 핵심이다.** '파리' 를 치면 파리바게뜨가 아니라 프랑스 파리가
     나와야 하는데, Mapbox 는 한글 질의에도 로마자 'Paris' 를 준다 — 질의와 글자가 하나도
     안 겹친다. 그래서 '질의로 시작하면 위로' 같은 중간 순위를 두면 '파리바게뜨' 가 'Paris'
     를 이겨 버린다. 표기가 다른 언어끼리는 글자로 잴 수 없으므로, 정확히 일치가 없을 때는
     제공자 순서(행정지명 → Mapbox → Google → 국내 상호명)에 맡긴다. */
  const out = P.rankPlaces('파리', [
    place('Paris', [2.3522, 48.8566], 'Mapbox'),
    place('파리바게뜨 역삼점', [127.0361, 37.5006], 'VWorld'),
    place('파리크라상 광화문점', [126.9769, 37.5714], 'VWorld'),
  ]);
  assert.equal(out[0].name, 'Paris', `첫 결과가 '${out[0].name}' — 해외 도시가 먼저 나와야 한다`);
});

test('정확히 일치가 없으면 제공자 순서를 지킨다', () => {
  // 넣은 순서가 곧 제공자 순서다 (한글 질의: 행정지명 → Mapbox → Google → 상호명)
  const out = P.rankPlaces('강남', [
    place('강남구', [127.0473, 37.5172], 'VWorld'),
    place('강남역', [127.0276, 37.4979], 'Google'),
  ]);
  assert.equal(out[0].name, '강남구');
});

test('정확히 일치는 뒤 제공자에 있어도 앞으로 끌어올린다', () => {
  /* 이게 없으면 남대문시장 사고가 그대로다 — 앞 제공자(Mapbox)의 도로명이 뒤 제공자의
     정답을 계속 덮는다. '정확히 일치' 만이 제공자 순서를 뒤집을 수 있는 근거다. */
  const out = P.rankPlaces('광장시장', [
    place('광장시장길', [126.999, 37.5701], 'Mapbox'),
    place('광장시장', [126.9998, 37.5701], 'VWorld'),
  ]);
  assert.equal(out[0].name, '광장시장');
});

test('여러 제공자가 준 같은 곳은 한 줄만 남는다', () => {
  const out = P.rankPlaces('경복궁', [
    place('경복궁', [126.977, 37.5796], 'Mapbox'),
    place('경복궁', [126.9770, 37.5797], 'Google'),   // 같은 곳, 좌표만 미세하게 다름
    place('경복궁', [126.977, 37.5796], 'VWorld'),
  ]);
  assert.equal(out.length, 1);
});

test('이름이 같아도 멀리 떨어져 있으면 둘 다 남는다', () => {
  // 동명이지(同名異地)를 합쳐버리면 사용자가 고를 방법이 없어진다
  const out = P.rankPlaces('중앙동', [
    place('중앙동', [129.0356, 35.1013], 'VWorld'),   // 부산
    place('중앙동', [126.9195, 37.4563], 'VWorld'),   // 안양
  ]);
  assert.equal(out.length, 2);
});

test('목록이 12줄을 넘지 않는다', () => {
  const many = Array.from({ length: 30 }, (_, i) => place(`곳${i}`, [127 + i, 37]));
  assert.ok(P.rankPlaces('곳', many).length <= 12);
});
