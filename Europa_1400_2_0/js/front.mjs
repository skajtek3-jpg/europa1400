// Jedno źródło kontroli terytorium: controller całej prowincji.
// Raster jest wyłącznie pamięcią renderera, nigdy niezależną symulacją.
import { sameSide, atWar, log } from './game.mjs';

export function initFront(G) {
  const { W, H, prov } = G.world;
  G.ctrl = new Uint16Array(W * H);
  G.pocket = new Uint8Array(W * H);
  G.frontVer = 0;
  G.dirty = [];
  G.pcLast = new Int32Array(prov.length).fill(-1);
  G.supply = new Map();
  G._supplyKey = '';
  syncFrontKnights(G);
}

export function syncFrontKnights(G) {
  if (!G.ctrl) { initFront(G); return; }
  const { countries: C, prov: P } = G.world;
  const n = C.length;
  G.nC = n;
  G.warM = new Uint8Array(n * n);
  for (const w of G.wars) for (const a of w.att) for (const b of w.def) {
    G.warM[a * n + b] = G.warM[b * n + a] = 1;
  }
  let changed = false;
  for (const p of P) if (p && G.pcLast[p.id] !== p.controller) {
    G.pcLast[p.id] = p.controller;
    for (const i of p.cells) G.ctrl[i] = p.controller;
    changed = true;
  }
  const key = P.slice(1).map(p => p.controller).join(',') + '|' + C.filter(Boolean)
    .map(c => `${c.id}:${c.capital}:${[...c.allies]}:${c.overlord}`).join(';')
    + '|' + G.wars.map(w => `${w.att}/${w.def}`).join(';');
  if (key !== G._supplyKey) {
    G._supplyKey = key;
    G.supply.clear();
    // Zaopatrzenie płynie tylko przez przyjazną kontrolę, także po jawnych przeprawach.
    // Neutralna granica i sama obecność brzegu morza nie zasilają kotła.
    for (const c of C) if (c && c.alive) {
      const seen = new Set();
      const home = P[c.capital]?.controller === c.id ? c.capital
        : c.provs.find(id => P[id]?.controller === c.id);
      if (home) {
        const q = [home]; seen.add(home);
        for (let h = 0; h < q.length; h++) for (const l of P[q[h]].links) {
          if (!seen.has(l.to) && sameSide(G, c.id, P[l.to].controller)) {
            seen.add(l.to); q.push(l.to);
          }
        }
      }
      G.supply.set(c.id, seen);
    }
    for (const p of P) if (p) {
      const pocket = !!C[p.controller]?.wars.length && !G.supply.get(p.controller)?.has(p.id);
      if (p.encircled !== pocket) {
        p.encircled = pocket;
        for (const i of p.cells) G.pocket[i] = pocket ? 1 : 0;
      }
    }
    changed = true;
  }
  if (changed) G.frontVer++;
}

export function frontTick(G) {
  syncFrontKnights(G);
  for (const a of G.armies) {
    if (a.dead || a.recruitDays > 0) continue;
    const p = G.world.prov[a.prov];
    const cut = atWarWithAnyone(G, a.country) && !G.supply.get(a.country)?.has(a.prov);
    if (cut) {
      a.size *= 0.997;
      a.morale = Math.max(0.05, a.morale - 0.012);
      if (!a.encircled && a.country === G.player)
        log(G, `Brak zaopatrzenia: armia #${a.id} w ${p.name}. Przebij połączenie z własnym zapleczem.`, 'bad');
    }
    a.encircled = cut;
    if (a.size < 100) a.dead = true;
  }
}
function atWarWithAnyone(G, cid) { return G.world.countries[cid]?.wars.length > 0; }
export function provInPocket(G, p) { return !!p.encircled; }
export function provShare(G, p, cid) { return p.controller === cid ? 1 : 0; }
