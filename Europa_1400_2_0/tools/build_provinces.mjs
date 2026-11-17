// Generator prowincji Europy 1400 z realnych danych granic (aourednik/historical-basemaps)
import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'fs';

const LON0 = -11, LON1 = 60, LAT0 = 33.5, LAT1 = 63.5;
const W = 1200;
const TARGET_CELLS = 1300;
const MIN_PROV_CELLS = 220;

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

const mercY = lat => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI / 180) / 2));
const y0 = mercY(LAT0), y1 = mercY(LAT1);
const H = Math.round(W * (y1 - y0) / ((LON1 - LON0) * Math.PI / 180));
const cellLon = (LON1 - LON0) / W;
const cellY = (y1 - y0) / H;
const cellToLon = x => LON0 + (x + 0.5) * cellLon;
const cellToLat = y => {
  const yy = y1 - (y + 0.5) * cellY;
  return (2 * Math.atan(Math.exp(yy)) - Math.PI / 2) * 180 / Math.PI;
};
console.log(`Grid: ${W}x${H} = ${W * H} komórek`);

const gj = JSON.parse(readFileSync(existsSync('data/world_1400.geojson') ? 'data/world_1400.geojson' : 'data/world_1400.mjs', 'utf8'));
const byName = new Map();
for (const f of gj.features) {
  const name = f.properties && f.properties.NAME;
  if (!name || !f.geometry) continue;
  const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
  if (!polys.length) continue;
  let bb = [1e9, 1e9, -1e9, -1e9];
  const walk = c => { for (const p of c) { if (p[0] < bb[0]) bb[0] = p[0]; if (p[1] < bb[1]) bb[1] = p[1]; if (p[0] > bb[2]) bb[2] = p[0]; if (p[1] > bb[3]) bb[3] = p[1]; } };
  polys.forEach(p => p.forEach(walk));
  if (bb[2] < LON0 || bb[0] > LON1 || bb[3] < LAT0 || bb[1] > LAT1) continue;
  if (!byName.has(name)) byName.set(name, { name, polys: [] });
  byName.get(name).polys.push(...polys);
}

const countries = [...byName.values()].map((c, i) => ({ ...c, id: i + 1 }))
  .filter(c => {
    let bb = [1e9, 1e9, -1e9, -1e9];
    const walk = p => { if (p[0] < bb[0]) bb[0] = p[0]; if (p[1] < bb[1]) bb[1] = p[1]; if (p[0] > bb[2]) bb[2] = p[0]; if (p[1] > bb[3]) bb[3] = p[1]; };
    c.polys.forEach(p => p.forEach(r => r.forEach(walk)));
    return bb[2] >= LON0 && bb[0] <= LON1 && bb[3] >= LAT0 && bb[1] <= LAT1;
  });

const areaOf = c => {
  let a = 0;
  for (const p of c.polys) { const r = p[0]; for (let i = 0; i < r.length - 1; i++) a += Math.abs(r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1]); }
  return a;
};
countries.sort((a, b) => areaOf(a) - areaOf(b));
console.log(`Kraje w regionie: ${countries.length}`);

function pip(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}
function inCountry(c, lon, lat) {
  for (const poly of c.polys) {
    if (pip(lon, lat, poly[0])) {
      let hole = false;
      for (let h = 1; h < poly.length; h++) if (pip(lon, lat, poly[h])) { hole = true; break; }
      if (!hole) return true;
    }
  }
  return false;
}

const grid = new Uint16Array(W * H);
const countryCells = new Map();
for (let y = 0; y < H; y++) {
  const lat = cellToLat(y);
  for (let x = 0; x < W; x++) {
    const lon = cellToLon(x);
    for (let ci = 0; ci < countries.length; ci++) {
      const c = countries[ci];
      const bb = c.bb || (c.bb = (() => {
        let b = [1e9, 1e9, -1e9, -1e9];
        const walk = p => { if (p[0] < b[0]) b[0] = p[0]; if (p[1] < b[1]) b[1] = p[1]; if (p[0] > b[2]) b[2] = p[0]; if (p[1] > b[3]) b[3] = p[1]; };
        c.polys.forEach(p => p.forEach(r => r.forEach(walk)));
        return b;
      })());
      if (lon < bb[0] || lon > bb[2] || lat < bb[1] || lat > bb[3]) continue;
      if (inCountry(c, lon, lat)) {
        grid[y * W + x] = c.id;
        if (!countryCells.has(c.id)) countryCells.set(c.id, []);
        countryCells.get(c.id).push(y * W + x);
        break;
      }
    }
  }
}
console.log('Komórki lądu:', [...countryCells.values()].reduce((a, b) => a + b.length, 0));
for (const c of countries) if ((countryCells.get(c.id) || []).length === 0) console.log('  (puste w regionie):', c.name);

const provGrid = new Uint16Array(W * H);
const provinces = [];
let nextProv = 1;

for (const c of countries) {
  const cells = countryCells.get(c.id);
  if (!cells || !cells.length) continue;
  const rng = mulberry32(hashStr(c.name) ^ 0x1400);
  const n = Math.max(1, Math.min(45, Math.round(cells.length / TARGET_CELLS)));
  let seeds = [];
  for (let i = 0; i < n; i++) seeds.push(cells[Math.floor(rng() * cells.length)]);
  const idx = i => [i % W, (i / W) | 0];
  const cellSet = new Set(cells);
  for (let iter = 0; iter < 3; iter++) {
    const sums = seeds.map(() => [0, 0, 0]);
    for (const i of cells) {
      const [x, y] = idx(i);
      let best = 0, bd = Infinity;
      for (let s = 0; s < seeds.length; s++) {
        const [sx, sy] = idx(seeds[s]);
        const d = (x - sx) ** 2 + (y - sy) ** 2;
        if (d < bd) { bd = d; best = s; }
      }
      sums[best][0] += x; sums[best][1] += y; sums[best][2]++;
    }
    seeds = seeds.map((s, k) => {
      if (!sums[k][2]) return s;
      const [sx0, sy0] = idx(s);
      let bi = s, bd = Infinity;
      for (let dy = -12; dy <= 12; dy++) for (let dx = -12; dx <= 12; dx++) {
        const j = (sy0 + dy) * W + sx0 + dx;
        if (cellSet.has(j)) { const d = dx * dx + dy * dy; if (d < bd) { bd = d; bi = j; } }
      }
      return bi;
    });
  }
  const assign = new Map();
  for (const i of cells) {
    const [x, y] = idx(i);
    let best = 0, bd = Infinity;
    for (let s = 0; s < seeds.length; s++) {
      const [sx, sy] = idx(seeds[s]);
      const d = (x - sx) ** 2 + (y - sy) ** 2;
      if (d < bd) { bd = d; best = s; }
    }
    assign.set(i, best);
  }
  const compOf = new Map();
  for (const i of cells) {
    if (compOf.has(i)) continue;
    const seed = assign.get(i);
    const comp = [];
    const stack = [i]; compOf.set(i, 'tmp');
    while (stack.length) {
      const j = stack.pop(); comp.push(j);
      const x = j % W, y = (j / W) | 0;
      const nb = [x > 0 ? j - 1 : -1, x < W - 1 ? j + 1 : -1, y > 0 ? j - W : -1, y < H - 1 ? j + W : -1];
      for (const k of nb) if (k >= 0 && k < W * H && cellSet.has(k) && assign.get(k) === seed && !compOf.has(k)) { compOf.set(k, 'tmp'); stack.push(k); }
    }
    const tag = `${seed}:${comp.length}`;
    for (const j of comp) compOf.set(j, tag);
    comp.tag = tag; comp.seed = seed;
    (c._comps || (c._comps = [])).push(comp);
  }
  const comps = c._comps;
  let changed = true;
  while (changed) {
    changed = false;
    for (const comp of comps) {
      if (comp.merged) continue;
      if (comp.length < MIN_PROV_CELLS) {
        let target = null;
        for (const i of comp) {
          const x = i % W, y = (i / W) | 0;
          const nb = [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1];
          for (const k of nb) {
            if (k >= 0 && k < W * H && cellSet.has(k) && !comp.includes(k) && compOf.get(k) !== comp.tag) { target = compOf.get(k); break; }
          }
          if (target) break;
        }
        if (target) {
          for (const j of comp) compOf.set(j, target);
          comp.merged = true; changed = true;
        }
      }
    }
  }
  const tagToProv = new Map();
  for (const comp of comps) {
    if (comp.merged) continue;
    if (tagToProv.has(comp.tag)) { for (const j of comp) tagToProv.get(comp.tag).cells.push(j); continue; }
    const p = { country: c.id, cells: [...comp], adj: new Set(), coastal: false };
    tagToProv.set(comp.tag, p);
  }
  for (const comp of comps) {
    if (!comp.merged) continue;
    const t = tagToProv.get(compOf.get(comp[0]));
    if (t) t.cells.push(...comp);
  }
  for (const p of tagToProv.values()) { p.id = nextProv++; provinces.push(p); for (const j of p.cells) provGrid[j] = p.id; }
  c._comps = null;
}
console.log('Prowincje:', provinces.length);

for (const p of provinces) {
  let sx = 0, sy = 0, cx0 = 1e9, cy0 = 1e9, cx1 = -1e9, cy1 = -1e9;
  for (const j of p.cells) {
    const x = j % W, y = (j / W) | 0;
    sx += x; sy += y;
    if (x < cx0) cx0 = x; if (y < cy0) cy0 = y; if (x > cx1) cx1 = x; if (y > cy1) cy1 = y;
    const nb = [x > 0 ? j - 1 : -1, x < W - 1 ? j + 1 : -1, y > 0 ? j - W : -1, y < H - 1 ? j + W : -1];
    for (const k of nb) {
      if (k < 0 || k >= W * H) continue;
      const o = provGrid[k];
      if (o === 0) p.coastal = true;
      else if (o && o !== p.id) p.adj.add(o);
    }
  }
  p.cx = sx / p.cells.length; p.cy = sy / p.cells.length;
  p.w = cx1 - cx0 + 1; p.h = cy1 - cy0 + 1;
}

for (const p of provinces) {
  const rng = mulberry32(p.id * 7919);
  p.dev = Math.max(1, Math.round(p.cells.length / 55 * (0.75 + rng() * 0.6)));
}
{
  const byCountry = new Map();
  for (const p of provinces) { if (!byCountry.has(p.country)) byCountry.set(p.country, []); byCountry.get(p.country).push(p); }
  for (const [cid, ps] of byCountry) {
    ps.sort((a, b) => b.cells.length - a.cells.length);
    ps.forEach((p, i) => {
      if (i === 0) p.fort = 3;
      else if (i === 1) p.fort = 2;
      else p.fort = p.dev >= 24 ? 2 : p.dev >= 13 ? 1 : 0;
    });
    byCountry.set(cid, ps);
  }
}

const PL = {
  'Poland-Lithuania': 'Polska i Litwa', 'Teutonic Knights': 'Zakon Krzyżacki', 'Holy Roman Empire': 'Święte Cesarstwo Rzymskie',
  'Kingdom of Hungary': 'Królestwo Węgier', France: 'Francja', 'English territory': 'Anglia', Scotland: 'Szkocja',
  'Kalmar Union': 'Unia Kalmarska', Castile: 'Kastylia', 'Aragón': 'Aragonia', Navarre: 'Nawarra', Portugal: 'Portugalia',
  Granada: 'Emirat Grenady', 'Papal States': 'Państwo Kościelne', Venice: 'Wenecja', Sicily: 'Neapol i Sycylia',
  Sardinia: 'Sardynia', Corsica: 'Korsyka', Cyprus: 'Cypr', Bosnia: 'Bośnia', 'Byzantine Empire': 'Cesarstwo Bizantyjskie',
  'Ottoman Empire': 'Imperium Osmańskie', 'Bulgar Khanate': 'Carstwo Bułgarskie', 'Principality of Wallachia': 'Wołoszczyzna',
  Moldova: 'Mołdawia', Novgorod: 'Republika Nowogrodzka', 'Blue Horde': 'Złota Orda', 'White Horde': 'Biała Orda',
  'Seljuk Caliphate': 'Sułtanat Seldżucki', 'Beylik of Aydin': 'Bejlik Aydin', Trebizond: 'Cesarstwo Trapezuntu',
  Georgia: 'Gruzja', 'Mamluke Sultanate': 'Sułtanat Mameluków', 'Hafsid Caliphate': 'Kalifat Hafsydów', Morocco: 'Maroko',
  'Sámi': 'Sámi', 'Timurid Empire': 'Imperium Timurydów', Siberians: 'Syberia (plemiona)', Britany: 'Bretania'
};
const ANCHORS = {
  'Poland-Lithuania': [
    [16.9, 52.4, 'Wielkopolska'], [18.6, 53.0, 'Kujawy'], [20.9, 52.3, 'Mazowsze'], [19.9, 50.7, 'Małopolska'],
    [21.5, 49.5, 'Ruś Halicka'], [23.5, 49.8, 'Wołyń'], [25.7, 49.1, 'Podole'], [27.2, 49.3, 'Kijowszczyzna'],
    [29.8, 49.7, 'Czernihowszczyzna'], [24.0, 53.1, 'Podlasie'], [25.5, 54.3, 'Litwa'], [22.8, 55.4, 'Żmudź'],
    [26.8, 54.9, 'Łatgalia'], [28.6, 55.6, 'Inflanty Polskie'], [30.4, 53.6, 'Połock'], [32.0, 53.0, 'Witebsk'],
    [31.5, 54.8, 'Nowogródek'], [33.0, 54.0, 'Smoleńsk'], [23.6, 54.8, 'Auksztota'], [21.0, 51.4, 'Sieradz']
  ],
  'Holy Roman Empire': [
    [13.4, 50.0, 'Czechy'], [16.6, 49.2, 'Morawy'], [16.4, 48.2, 'Austria'], [11.0, 49.5, 'Bawaria'], [13.0, 51.1, 'Saksonia'],
    [12.5, 52.4, 'Brandenburgia'], [9.7, 51.3, 'Hesja'], [11.0, 50.7, 'Turyngia'], [10.0, 47.6, 'Szwabia'], [7.4, 47.7, 'Alzacja'],
    [6.2, 49.4, 'Lotaryngia'], [5.2, 51.9, 'Niderlandy'], [4.9, 45.6, 'Burgundia'], [7.0, 45.2, 'Sabaudia'], [9.2, 45.5, 'Lombardia'],
    [11.0, 43.5, 'Toskania'], [12.4, 44.5, 'Emilia'], [14.9, 42.6, 'Neapol'], [10.0, 48.8, 'Frankonia'], [8.2, 50.2, 'Nadrenia'],
    [9.2, 54.2, 'Holsztyn'], [14.5, 48.8, 'Styria'], [15.5, 47.0, 'Karyntia'], [13.8, 46.5, 'Tyrol'], [6.8, 43.6, 'Genua'],
    [7.6, 45.1, 'Piemont'], [12.0, 46.5, 'Górna Adyga']
  ],
  France: [
    [2.35, 48.9, 'Île-de-France'], [0.5, 49.2, 'Normandia'], [0.2, 47.5, 'Andegawenia'], [-0.1, 46.5, 'Poitou'],
    [-0.6, 44.5, 'Gaskonia'], [1.7, 43.9, 'Langwedocja'], [3.0, 45.5, 'Owernia'], [4.8, 45.2, 'Delfinat'],
    [5.0, 47.3, 'Burgundia'], [4.3, 49.0, 'Szampania'], [6.2, 49.0, 'Lotaryngia'], [2.0, 50.2, 'Pikardia'], [2.6, 50.9, 'Flandria'],
    [-2.0, 48.5, 'Maine'], [-3.0, 48.0, 'Anjou-Turena'], [1.5, 47.0, 'Berrycz'], [-1.0, 47.5, 'Touraine']
  ],
  'English territory': [
    [-0.8, 51.3, 'Kent'], [-2.2, 51.4, 'Wessex'], [-1.2, 52.7, 'Mercja'], [-1.7, 54.0, 'Yorkshire'], [-3.0, 54.6, 'Kumbria'],
    [-1.6, 55.4, 'Northumberland'], [-3.4, 52.5, 'Walia'], [-6.3, 53.4, 'Leinster'], [-9.0, 53.5, 'Connacht'],
    [-8.8, 52.3, 'Munster'], [-7.5, 53.5, 'Ulster'], [-3.0, 51.5, 'Kornwalia']
  ],
  'Kingdom of Hungary': [
    [19.2, 47.4, 'Środkowe Węgry'], [19.4, 48.5, 'Górne Węgry'], [23.0, 46.8, 'Siedmiogród'], [21.4, 46.2, 'Slawonia'],
    [16.6, 45.6, 'Chorwacja'], [15.6, 44.1, 'Dalmacja'], [22.5, 48.2, 'Kryżana'], [17.5, 46.8, 'Południowe Zadunaje'],
    [20.5, 47.9, 'Nitra'], [21.8, 47.4, 'Bihor']
  ],
  Castile: [
    [-3.7, 40.0, 'Nowa Kastylia'], [-4.5, 41.7, 'Stara Kastylia'], [-5.7, 42.6, 'León'], [-6.2, 39.9, 'Estremadura'],
    [-4.8, 37.4, 'Andaluzja'], [-8.0, 42.7, 'Galicja'], [-6.1, 43.3, 'Asturia'], [-4.0, 43.2, 'Biskaja'],
    [-2.0, 41.6, 'Soria'], [-5.0, 42.0, 'Salamanca'], [-3.0, 41.6, 'Segowia'], [-2.5, 39.0, 'Murcja']
  ],
  'Aragón': [
    [2.2, 41.5, 'Katalonia'], [-1.0, 41.7, 'Aragonia'], [-0.4, 39.5, 'Walencja'], [2.9, 39.6, 'Baleary'],
    [0.9, 41.2, 'Barcelona'], [0.6, 40.7, 'Tortosa'], [-0.9, 40.0, 'Teruel'], [1.6, 42.5, 'Girona']
  ],
  'Ottoman Empire': [
    [24.0, 43.5, 'Serbia'], [22.5, 41.3, 'Macedonia'], [26.4, 41.6, 'Tracja'], [28.2, 41.0, 'Konstantynopol (okup.)'],
    [27.8, 42.4, 'Bułgaria'], [25.0, 42.2, 'Kosowo'], [21.5, 42.0, 'Albania'], [29.2, 40.4, 'Bitinia'],
    [30.7, 38.4, 'Anatolia'], [31.8, 37.9, 'Konya'], [28.8, 39.4, 'Smyrna'], [32.5, 40.2, 'Ankyra'], [33.8, 41.7, 'Kastamonu'],
    [27.0, 39.0, 'Saruhan'], [26.5, 38.4, 'Menteşa']
  ],
  'Byzantine Empire': [
    [23.5, 36.8, 'Morea'], [22.8, 37.5, 'Korynt'], [26.2, 38.5, 'Archipelag'], [28.0, 40.4, 'Bitynia'],
    [26.5, 40.2, 'Gallipoli'], [23.9, 40.5, 'Salonika'], [24.0, 35.5, 'Kreta'], [25.5, 40.6, 'Athos'],
    [22.0, 36.4, 'Maina'], [28.0, 41.3, 'Tenedos']
  ],
  'Kalmar Union': [
    [12.6, 55.7, 'Skania'], [9.5, 56.2, 'Jutlandia'], [16.0, 60.5, 'Svealand'], [14.0, 58.2, 'Götaland'],
    [6.6, 61.2, 'Vestlandet'], [10.5, 59.7, 'Østlandet'], [11.0, 63.8, 'Trøndelag'], [18.5, 63.5, 'Norrland'],
    [21.0, 65.0, 'Västerbotten'], [8.5, 57.5, 'Fionia'], [10.2, 56.3, 'Zelandia'], [12.0, 55.0, 'Lolland'],
    [15.5, 62.0, 'Dalarna'], [13.5, 57.7, 'Gotlandia']
  ],
  Novgorod: [
    [31.3, 58.5, 'Nowogród Wielki'], [38.5, 60.3, 'Ziemie Dwinskie'], [44.0, 62.5, 'Wiatka'], [50.5, 58.5, 'Wiatka Płn.'],
    [34.5, 59.5, 'Wołogda'], [36.0, 57.5, 'Kostroma'], [33.0, 60.8, 'Karelia'], [40.5, 62.5, 'Biarmia']
  ],
  'Blue Horde': [
    [47.3, 47.6, 'Saraj'], [34.5, 45.2, 'Krym'], [39.5, 47.0, 'Azow'], [49.0, 55.3, 'Wielki Bułgar'], [46.0, 51.0, 'Saraiczyk'],
    [43.0, 48.0, 'Orda Krymska'], [38.0, 55.0, 'Ruś Moskiewska'], [36.0, 53.5, 'Riazań']
  ],
  'Teutonic Knights': [
    [18.7, 53.6, 'Ziemia Chełmińska'], [20.3, 54.4, 'Prusy Dolne'], [21.8, 54.1, 'Prusy Górne'], [22.8, 54.0, 'Pomezania'],
    [23.8, 53.9, 'Lubawa'], [20.8, 55.3, 'Żuławy'], [24.5, 57.5, 'Inflanty'], [25.7, 59.0, 'Estonia'],
    [21.4, 56.7, 'Kurlandia'], [26.5, 58.3, 'Wironia'], [23.0, 57.2, 'Semigalia']
  ],
  'Papal States': [[12.3, 41.9, 'Lacjum'], [12.5, 43.4, 'Umbria'], [13.3, 43.2, 'Marche'], [12.4, 44.0, 'Romanja'], [13.8, 42.3, 'Abruzja']],
  Venice: [[12.3, 45.4, 'Wenecja'], [13.0, 45.9, 'Friul'], [11.6, 45.5, 'Werona'], [12.5, 45.2, 'Padwa']],
  Sicily: [[13.4, 37.1, 'Sycylia'], [16.5, 41.0, 'Apulia'], [15.0, 40.6, 'Basilicata'], [15.3, 39.9, 'Kalabria'], [14.3, 40.8, 'Kampania'], [17.3, 40.9, 'Otranto']],
  Portugal: [[-8.5, 40.2, 'Porto'], [-8.0, 38.7, 'Lizbona'], [-7.5, 37.2, 'Alentejo'], [-8.9, 41.0, 'Minho'], [-8.2, 41.8, 'Trás-os-Montes'], [-7.5, 38.0, 'Estremadura (Pt.)'], [-8.9, 37.0, 'Algarve']],
  Granada: [[-3.6, 37.1, 'Vega de Granada'], [-4.5, 36.7, 'Ronda'], [-2.6, 36.8, 'Almería'], [-4.0, 37.4, 'Jaén']],
  Scotland: [[-3.2, 56.0, 'Lowlands'], [-3.5, 57.2, 'Highlands'], [-2.0, 57.7, 'Moray'], [-5.5, 56.0, 'Argyll'], [-6.0, 58.0, 'Ross'], [-2.8, 56.5, 'Fife'], [-4.0, 55.0, 'Galloway']],
  'Mamluke Sultanate': [[31.2, 30.0, 'Egipt'], [36.3, 33.5, 'Syria'], [35.0, 31.5, 'Palestyna'], [32.6, 25.0, 'Nubia'], [39.0, 34.0, 'Mezopotamia Górna']],
  'Hafsid Caliphate': [[10.2, 36.8, 'Tunezja'], [8.0, 36.5, 'Konstantyna'], [5.0, 36.7, 'Algier'], [13.0, 35.5, 'Trypolitania'], [15.5, 32.5, 'Sabratka']],
  Morocco: [[-7.5, 33.5, 'Fès'], [-8.5, 31.5, 'Marrakesz'], [-5.0, 34.5, 'Taza'], [-9.5, 30.5, 'Sús'], [-2.5, 34.0, 'Tlemsen']]
};

const roman = n => { const R = ['I','II','III','IV','V','VI','VII','VIII','IX','X','XI','XII','XIII','XIV','XV','XVI','XVII','XVIII','XIX','XX','XXI','XXII','XXIII','XXIV','XXV','XXVI','XXVII','XXVIII','XXIX','XXX','XXXI','XXXII','XXXIII','XXXIV','XXXV','XXXVI','XXXVII','XXXVIII','XXXIX','XL','XLI','XLII','XLIII','XLIV','XLV']; return R[n - 1] || String(n + 1); };
const pairs = [];
for (const p of provinces) {
  const c = countries.find(cc => cc.id === p.country);
  const anchors = ANCHORS[c.name] || [];
  const lon = cellToLon(p.cx), lat = cellToLat(p.cy);
  for (const a of anchors) {
    const d = Math.hypot((a[0] - lon) * Math.cos(lat * Math.PI / 180), a[1] - lat);
    if (d < 2.2) pairs.push({ p, name: a[2], d });
  }
}
pairs.sort((a, b) => a.d - b.d);
const usedNames = new Set(), named = new Set();
for (const { p, name } of pairs) {
  if (usedNames.has(name) || named.has(p)) continue;
  p.name = name; usedNames.add(name); named.add(p);
}
for (const p of provinces) if (!named.has(p)) {
  const c = countries.find(cc => cc.id === p.country);
  p.name = `${PL[c.name] || c.name} ${roman(p.id % 50 || 1)}`;
}

const COLORS = {
  'Poland-Lithuania': '#c84848', 'Teutonic Knights': '#5a554c', 'Holy Roman Empire': '#8d9fb5', 'Kingdom of Hungary': '#5e8a5e',
  France: '#4f6fb5', 'English territory': '#a04a52', Scotland: '#6a8ab0', 'Kalmar Union': '#c4a83c', Castile: '#d9c26a',
  'Aragón': '#df9a44', Navarre: '#b5a04a', Portugal: '#5d8a5a', Granada: '#8a5a8f', 'Papal States': '#e8e2d2',
  Venice: '#b03a4a', Sicily: '#d4a03a', Sardinia: '#a08a5a', Corsica: '#8a9a6a', Cyprus: '#b09a7a', Bosnia: '#6a7a5a',
  'Byzantine Empire': '#7a4fa0', 'Ottoman Empire': '#3f7d4f', 'Bulgar Khanate': '#7a8a6a', 'Principality of Wallachia': '#9a7a4a',
  Moldova: '#6a8a8a', Novgorod: '#b06a3a', 'Blue Horde': '#9a8a5f', 'White Horde': '#a89a6a', 'Seljuk Caliphate': '#6a8a6a',
  'Beylik of Aydin': '#7a6a8a', Trebizond: '#9a4a6a', Georgia: '#b5654a', 'Mamluke Sultanate': '#c2a05a',
  'Hafsid Caliphate': '#9a7a4a', Morocco: '#a89a5a', 'Sámi': '#8a9aa0', 'Timurid Empire': '#6a5a9a', Siberians: '#7a8a8a',
  Britany: '#4a6a8a'
};
for (const c of countries) { c.color = COLORS[c.name] || '#999999'; c.plName = PL[c.name] || c.name; }

const rle = [];
{
  let cur = provGrid[0], cnt = 0;
  for (let i = 0; i < provGrid.length; i++) {
    if (provGrid[i] === cur) cnt++;
    else { rle.push(cur, cnt); cur = provGrid[i]; cnt = 1; }
  }
  rle.push(cur, cnt);
}
console.log('RLE par:', rle.length / 2);

const out = {
  W, H, LON0, LON1, LAT0, LAT1,
  countries: countries.map(c => ({ id: c.id, name: c.name, plName: c.plName, color: c.color })),
  provinces: provinces.map(p => ({
    id: p.id, c: p.country, name: p.name, cx: +p.cx.toFixed(1), cy: +p.cy.toFixed(1),
    dev: p.dev, fort: p.fort, coastal: p.coastal ? 1 : 0, adj: [...p.adj]
  })),
  rle
};
writeFileSync('data/provinces.json', JSON.stringify(out));
console.log('Zapisano data/provinces.json:', (JSON.stringify(out).length / 1024).toFixed(0), 'KB');

const ppm = `P6
${W} ${H}
255
`;
const buf = Buffer.alloc(W * H * 3);
const hex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const colOf = new Map(countries.map(c => [c.id, hex(c.color)]));
for (let i = 0; i < W * H; i++) {
  const v = provGrid[i];
  const c = v === 0 ? [90, 110, 130] : colOf.get(grid[i]) || [200, 0, 0];
  buf[i * 3] = c[0]; buf[i * 3 + 1] = c[1]; buf[i * 3 + 2] = c[2];
}
writeFileSync('data/preview.ppm', ppm);
appendFileSync, existsSync('data/preview.ppm', buf);
console.log('Podgląd: data/preview.ppm');
