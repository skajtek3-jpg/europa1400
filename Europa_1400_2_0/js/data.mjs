// Ładowanie danych mapy i budowa modelu świata
export const TERRAIN = {
  plain:   { name: 'Równina',  move: 1.0, def: 0.00, supply: 1.25, siege: 1.0, tint: [0, 0, 0] },
  hills:   { name: 'Wzgórza',  move: 1.2, def: 0.10, supply: 0.95, siege: 1.1, tint: [-10, -8, -12] },
  forest:  { name: 'Lasy',     move: 1.3, def: 0.10, supply: 0.80, siege: 1.0, tint: [-22, -6, -22] },
  mountain:{ name: 'Góry',     move: 1.75, def: 0.25, supply: 0.50, siege: 1.3, tint: [-34, -30, -30] },
  marsh:   { name: 'Bagna',    move: 1.5, def: 0.05, supply: 0.60, siege: 0.9, tint: [-14, 0, -6] },
};

// Przybliżone regiony górskie/leśne/bagienne (lon0, lon1, lat0, lat1) — dane rozgrywki, nie granice
const TERRAIN_BOXES = [
  ['mountain', 5.5, 15.5, 45.6, 47.6],   // Alpy
  ['mountain', -2.0, 3.2, 42.3, 43.3],   // Pireneje
  ['mountain', 20.0, 26.5, 47.4, 49.3],  // Karpaty płn.
  ['mountain', 23.0, 26.5, 45.2, 47.4],  // Karpaty wsch./południowe
  ['mountain', 14.5, 21.5, 42.2, 45.2],  // Góry Dynarskie
  ['mountain', 22.5, 25.5, 42.0, 43.4],  // Bałkany
  ['mountain', 41.0, 60.0, 40.5, 43.5],  // Kaukaz
  ['mountain', 6.0, 14.5, 60.0, 66.0],   // Góry Skandynawskie
  ['mountain', -6.0, -3.2, 56.5, 58.8],  // Highlands
  ['mountain', -9.5, 9.0, 30.0, 35.5],   // Atlas
  ['mountain', 31.0, 37.0, 36.5, 38.5],  // Taurus
  ['hills', 11.0, 14.0, 42.0, 44.5],     // Apeniny
  ['hills', 7.0, 10.0, 43.5, 45.0],
  ['hills', 14.0, 16.0, 38.5, 41.5],
  ['hills', 4.0, 8.0, 48.5, 50.5],       // Ardeny/Wogezy
  ['hills', 2.0, 4.0, 44.0, 46.0],       // Masyw Centralny
  ['hills', 12.0, 18.0, 49.0, 51.0],     // Sudety/Czechy
  ['hills', -5.5, -2.5, 53.0, 55.0],
  ['hills', 33.0, 36.0, 44.4, 45.0],
  ['marsh', 24.0, 32.0, 51.5, 53.2],     // Polesie
  ['marsh', 4.0, 6.5, 51.5, 53.5],       // Niderlandy
  ['marsh', 32.0, 40.0, 56.0, 58.0],
  ['forest', 22.0, 24.5, 52.8, 54.5],    // Puszcze
  ['forest', 30.0, 44.0, 55.5, 63.0],    // Ruś północna
  ['forest', 14.0, 20.0, 58.0, 62.0],    // Szwecja
  ['forest', 20.0, 30.0, 59.0, 63.5],
  ['forest', 8.0, 13.0, 47.5, 50.5],     // Szwarcwald/Bawaria
  ['forest', 16.0, 22.0, 53.5, 55.0],
];

export function decode(json) {
  const { W, H } = json;
  const grid = new Uint16Array(W * H);
  let p = 0;
  for (let i = 0; i < json.rle.length; i += 2) {
    const v = json.rle[i], n = json.rle[i + 1];
    grid.fill(v, p, p + n); p += n;
  }
  if (p !== W * H) throw new Error('Nieprawidłowa długość danych mapy.');
  return grid;
}

function mercLat(y, H, json) {
  const my = l => Math.log(Math.tan(Math.PI / 4 + (l * Math.PI / 180) / 2));
  const y1 = my(json.LAT1), y0 = my(json.LAT0);
  const yy = y1 - (y + 0.5) * (y1 - y0) / H;
  return (2 * Math.atan(Math.exp(yy)) - Math.PI / 2) * 180 / Math.PI;
}

function hash(n) { n = (n ^ 61) ^ (n >>> 16); n = n + (n << 3); n = n ^ (n >>> 4); n = Math.imul(n, 0x27d4eb2d); n = n ^ (n >>> 15); return (n >>> 0) / 4294967296; }

export async function loadWorld() {
  const embedded = typeof document !== 'undefined' && document.getElementById('world-data');
  const res = embedded ? {ok:true,json:async()=>JSON.parse(embedded.textContent)} : await fetch('data/provinces.json');
  if (!res.ok) throw new Error('Nie można wczytać mapy (' + res.status + '). Uruchom grę przez serve.py.');
  const json = await res.json();
  const { W, H } = json;
  const grid = decode(json);
  // Mikroprowincje (kilka pikseli, np. wąskie pasy Zakonu) scalamy z sąsiadem: najpierw z tego samego kraju, potem z najdłuższą wspólną granicą.
  {
    const MIN_CELLS = 30;
    const nOld = json.provinces.length;
    const area = new Uint32Array(nOld + 2);
    for (let i = 0; i < grid.length; i++) { const v = grid[i]; if (v >= 1 && v <= nOld) area[v]++; }
    const ownerOf = new Int32Array(nOld + 2);
    for (const p of json.provinces) ownerOf[p.id] = p.c;
    const adjSet = new Map();
    for (const p of json.provinces) adjSet.set(p.id, new Set((p.adj || []).filter(q => q >= 1 && q <= nOld && q !== p.id)));
    const cells = new Map();
    for (let id = 1; id <= nOld; id++) if (area[id] > 0 && area[id] < MIN_CELLS) cells.set(id, []);
    for (let i = 0; i < grid.length; i++) { const v = grid[i]; if (cells.has(v)) cells.get(v).push(i); }
    const tinyOrder = [...cells.keys()].sort((a, b) => area[a] - area[b] || a - b);
    for (const t of tinyOrder) {
      if (area[t] === 0 || area[t] >= MIN_CELLS) continue;
      const border = new Map();
      for (const i of cells.get(t)) {
        const x = i % W;
        for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i - W, i + W]) {
          if (j < 0 || j >= grid.length) continue;
          const v = grid[j];
          if (v >= 1 && v !== t) border.set(v, (border.get(v) || 0) + 1);
        }
      }
      let target = 0;
      if (border.size) {
        let bestScore = -1;
        for (const [v, n] of border) {
          const score = n + (ownerOf[v] === ownerOf[t] ? 100000 : 0);
          if (score > bestScore || (score === bestScore && v < target)) { bestScore = score; target = v; }
        }
      } else {
        // izolowany skrawek bez lądowego sąsiada: wyspy od 5 px zostają (zdobywane przeprawą),
        // mniejsze to zwykły szum mapy i znikają z gry (ich piksele stają się pustym morzem)
        if (area[t] >= 5) continue;
        for (const q of adjSet.get(t)) { const aq = adjSet.get(q); if (aq) aq.delete(t); }
        area[t] = 0;
        continue;
      }
      for (const i of cells.get(t)) grid[i] = target;
      area[target] += area[t]; area[t] = 0;
      if (cells.has(target)) cells.get(target).push(...cells.get(t));
      cells.get(t).length = 0;
      const at = adjSet.get(target), ta = adjSet.get(t);
      for (const q of ta) {
        if (q === target) continue;
        const aq = adjSet.get(q); if (aq) { aq.delete(t); aq.add(target); }
        at.add(q);
      }
      at.delete(t); at.delete(target);
    }
    // ponumerowanie od nowa (bez usuniętych prowincji)
    const newId = new Int32Array(nOld + 2);
    let k = 0;
    for (let id = 1; id <= nOld; id++) if (area[id] > 0) newId[id] = ++k;
    for (let i = 0; i < grid.length; i++) { const v = grid[i]; if (v >= 1 && v <= nOld) grid[i] = newId[v]; }
    json.provinces = json.provinces.filter(p => area[p.id] > 0).map(p => ({
      ...p, id: newId[p.id], adj: [...adjSet.get(p.id)].map(q => newId[q]).filter(q => q > 0),
    }));
  }
  const lonOf = x => json.LON0 + (x + 0.5) * (json.LON1 - json.LON0) / W;
  const latOf = y => mercLat(y, H, json);
  const kmPerCell = y => 111.32 * Math.cos(latOf(y) * Math.PI / 180) * (json.LON1 - json.LON0) / W;

  const countries = [null];
  for (const c of json.countries) {
    countries[c.id] = { ...c, provs: [], gold: 0, manpower: 0, manpowerMax: 0, wars: [], allies: new Set(), truces: new Map(), alive: true, ai: true, capital: 0, exhaustion: 0, prestige: 0, rebel: false };
  }
  const nProv = json.provinces.length;
  const prov = new Array(nProv + 1).fill(null);
  for (const p of json.provinces) {
    prov[p.id] = {
      id: p.id, core: p.c, owner: p.c, controller: p.c, name: p.name, cx: p.cx, cy: p.cy,
      dev: p.dev, fort: p.fort, coastal: !!p.coastal, adj: (p.adj || []).filter(q => q != null && q >= 1 && q <= nProv), links: [],
      cores: new Set([p.c]), siege: null, unrest: 0, devast: 0, integration: 0, garrison: 0, garrisonMax: 0,
      terrain: 'plain', bbox: [1e9, 1e9, -1e9, -1e9], cells: null, ax: 0, ay: 0, bld: { watch: 0, farm: 0, workshop: 0, library: 0, armory: 0, camp: 0 }, build: null,
    };
  }
  // komórki prowincji + bbox
  const counts = new Uint32Array(nProv + 2);
  for (let i = 0; i < grid.length; i++) if (grid[i] >= 1 && grid[i] <= nProv) counts[grid[i]]++;
  for (let id = 1; id <= nProv; id++) prov[id].cells = new Uint32Array(counts[id]);
  const fillPos = new Uint32Array(nProv + 2);
  for (let i = 0; i < grid.length; i++) {
    const v = grid[i]; if (!v || v < 1 || v > nProv) continue;
    const p = prov[v]; p.cells[fillPos[v]++] = i;
    const x = i % W, y = (i / W) | 0, b = p.bbox;
    if (x < b[0]) b[0] = x; if (y < b[1]) b[1] = y; if (x > b[2]) b[2] = x; if (y > b[3]) b[3] = y;
  }
  // odległość każdej komórki od granicy prowincji (BFS z komórek granicznych)
  const dist = new Uint16Array(W * H).fill(65535);
  const q = new Int32Array(W * H); let qh = 0, qt = 0;
  for (let i = 0; i < grid.length; i++) {
    const v = grid[i]; if (!v) continue;
    const x = i % W, y = (i / W) | 0;
    if (x === 0 || y === 0 || x === W - 1 || y === H - 1 || grid[i - 1] !== v || grid[i + 1] !== v || grid[i - W] !== v || grid[i + W] !== v) { dist[i] = 0; q[qt++] = i; }
  }
  while (qh < qt) {
    const i = q[qh++], v = grid[i], d = dist[i] + 1;
    for (const j of [i % W > 0 ? i - 1 : -1, i % W < W - 1 ? i + 1 : -1, i - W, i + W]) if (j >= 0 && j < grid.length && grid[j] === v && dist[j] > d) { dist[j] = d; q[qt++] = j; }
  }
  // kotwica: punkt najgłębiej wewnątrz prowincji (z lekką preferencją środka) — tu stoją armie i nazwa
  for (let id = 1; id <= nProv; id++) {
    const p = prov[id];
    let best = -1, bs = -Infinity;
    for (const i of p.cells) {
      const x = i % W, y = (i / W) | 0;
      const sc = dist[i] - 0.12 * Math.sqrt((x - p.cx) ** 2 + (y - p.cy) ** 2);
      if (sc > bs) { bs = sc; best = i; }
    }
    if (best < 0) {
      p.ax = Math.round(p.cx); p.ay = Math.round(p.cy);
    } else {
      p.ax = best % W; p.ay = (best / W) | 0;
    }
    p.depth = best >= 0 ? dist[best] : 0;
    p.lon = lonOf(p.ax); p.lat = latOf(p.ay);
    // teren
    let t = 'plain';
    for (const [type, a, b, c, d] of TERRAIN_BOXES) if (p.lon >= a && p.lon <= b && p.lat >= c && p.lat <= d) { t = type; if (type === 'mountain') break; }
    if (t === 'plain') { const r = hash(id * 31 + 7); if (r < 0.14) t = 'hills'; else if (r < 0.22) t = 'forest'; }
    p.terrain = t;
  }
  // czyść symetrię sąsiedztwa i policz dni marszu
  const linkMap = new Map();
  const addLink = (a, b, days, sea) => {
    const k = a < b ? `${a}:${b}` : `${b}:${a}`;
    if (linkMap.has(k)) return; linkMap.set(k, true);
    prov[a].links.push({ to: b, days, sea }); prov[b].links.push({ to: a, days, sea });
  };
  const distKm = (a, b) => {
    const dx = a.ax - b.ax, dy = a.ay - b.ay, k = kmPerCell((a.ay + b.ay) / 2);
    return Math.hypot(dx, dy) * k;
  };
  for (let id = 1; id <= nProv; id++) {
    const a = prov[id];
    for (const n of a.adj) {
      const b = prov[n]; if (!b) continue;
      const km = distKm(a, b);
      const mult = (TERRAIN[a.terrain].move + TERRAIN[b.terrain].move) / 2;
      addLink(id, n, Math.max(2, Math.round(km / 30 * mult)), false);
    }
  }
  // połączenia morskie (przeprawy) — najbliższe pary wybrzeżnych prowincji w różnych "wyspach" lądowych
  const comp = new Int32Array(nProv + 1).fill(-1); let nc = 0;
  for (let id = 1; id <= nProv; id++) if (comp[id] < 0) { const st = [id]; comp[id] = nc; while (st.length) { const x = st.pop(); for (const l of prov[x].links) if (comp[l.to] < 0) { comp[l.to] = nc; st.push(l.to); } } nc++; }
  const coastal = prov.filter(p => p && p.coastal);
  for (const a of coastal) {
    const cand = [];
    for (const b of coastal) {
      if (a.id >= b.id || comp[a.id] === comp[b.id]) continue;
      const km = distKm(a, b); if (km < 300) cand.push([km, b]);
    }
    cand.sort((x, y) => x[0] - y[0]);
    for (const [km, b] of cand.slice(0, 3)) addLink(a.id, b.id, Math.round(km / 18 * 1.4 + 4), true);
  }
  // Połączenia ratunkowe dla wysp pominiętych przez limit trzech najbliższych
  // sąsiadów (m.in. Sycylia i Wyspy Owcze). Zawsze jawna przeprawa morska.
  for (let attempt = 0; attempt < nProv; attempt++) {
    const group = new Int32Array(nProv + 1).fill(-1); let groups=0;
    for(let id=1;id<=nProv;id++)if(group[id]<0){const q=[id];group[id]=groups;for(let h=0;h<q.length;h++)for(const l of prov[q[h]].links)if(group[l.to]<0){group[l.to]=groups;q.push(l.to);}groups++;}
    if(groups<=1)break;
    let best=null,bestKm=900;
    for(const a of coastal)for(const b of coastal)if(a.id<b.id&&group[a.id]!==group[b.id]){const km=distKm(a,b);if(km<bestKm){bestKm=km;best=[a,b];}}
    if(!best)break;
    addLink(best[0].id,best[1].id,Math.round(bestKm/30+4),true);
  }
  for (const p of prov) if (p) p.adj = p.links.filter(l => !l.sea).map(l => l.to);
  // sprawdź: ile komponentów lądowych po łączeniach
  const comp2 = new Int32Array(nProv + 1).fill(-1); let nc2 = 0;
  for (let id = 1; id <= nProv; id++) if (comp2[id] < 0) { const st = [id]; comp2[id] = nc2; while (st.length) { const x = st.pop(); for (const l of prov[x].links) if (comp2[l.to] < 0) { comp2[l.to] = nc2; st.push(l.to); } } nc2++; }

  // Eksklawy: część kraju niepołączona (lądem ani przeprawą) z jego główną częścią przechodzi do sąsiada.
  // Główna część = spójny obszar o największym rozwoju. Kilka przebiegów, bo nowy właściciel też musi być spójny.
  for (let pass = 0; pass < 8; pass++) {
    const seen = new Uint8Array(nProv + 1), byOwner = new Map();
    for (let id = 1; id <= nProv; id++) {
      if (seen[id]) continue;
      const o = prov[id].owner, ids = [id]; seen[id] = 1;
      for (let h = 0; h < ids.length; h++) for (const l of prov[ids[h]].links) if (!seen[l.to] && prov[l.to].owner === o) { seen[l.to] = 1; ids.push(l.to); }
      if (!byOwner.has(o)) byOwner.set(o, []);
      byOwner.get(o).push(ids);
    }
    let changed = false;
    for (const parts of byOwner.values()) {
      if (parts.length < 2) continue;
      const dev = ids => ids.reduce((n, x) => n + prov[x].dev, 0);
      parts.sort((a, b) => dev(b) - dev(a));
      for (const ids of parts.slice(1)) {
        const votes = new Map();
        for (const x of ids) for (const l of prov[x].links) { const q = prov[l.to].owner; if (q !== prov[x].owner) votes.set(q, (votes.get(q) || 0) + (l.sea ? 1 : 10)); } // granica lądowa waży więcej niż przeprawa
        const best = [...votes].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
        if (best) { for (const x of ids) prov[x].owner = prov[x].controller = best[0]; changed = true; }
      }
    }
    if (!changed) break;
  }

  // przypisanie krajów
  for (let id = 1; id <= nProv; id++) countries[prov[id].owner].provs.push(id);
  for (const c of countries) if (c) {
    c.provs.sort((a, b) => prov[b].dev - prov[a].dev);
    c.capital = c.provs[0] || 0;
    c.totalDev = c.provs.reduce((s, id) => s + prov[id].dev, 0);
  }
  for (const p of prov) if (p) { p.garrisonMax = garrisonMax(p); p.garrison = p.garrisonMax; }

  return { json, W, H, grid, prov, countries, kmPerCell, lonOf, latOf, components: nc2, seaComponents: nc };
}

export function garrisonMax(p) {
  return p.fort === 0 ? Math.round(120 + p.dev * 6) : Math.round([0, 1200, 2800, 5500][p.fort] + p.dev * 18);
}
