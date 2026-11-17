// Logika gry: wojny, oblężenia, bitwy, okupacja, traktaty, gospodarka, AI
import { initFront, frontTick, provInPocket, syncFrontKnights } from './front.mjs';
import { initDiplo, diploMonthly, canPass, warJoiners, pushCallOffer, pushPeaceOffer, separatePeace, makeVassal, aiWarsResolve, hasNap, setRel, addRel, getRel, DP_MAX } from './diplo.mjs';
import { TERRAIN, garrisonMax } from './data.mjs';

// Armie AI maszerują tyle razy wolniej niż gracza (bez oblężeń: niebroniona prowincja zajmowana od razu, jak w HOI4).
export const AI_MARCH = 1.5;
export const SPEEDS = [0, 500, 250, 110, 45, 18]; // ms na dzień; 0 = pauza

export const MONTHS = ['stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca', 'lipca', 'sierpnia', 'września', 'października', 'listopada', 'grudnia'];
const MDAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export function dateOf(day) {
  let y = 1400, m = 0, d = day;
  while (true) {
    const md = m === 1 && y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0) ? 29 : MDAYS[m];
    if (d <= md) break;
    d -= md; m++; if (m === 12) { m = 0; y++; }
  }
  return { y, m: m + 1, d, str: `${d} ${MONTHS[m]} ${y}` };
}

const COUNTRY_ALIAS = {
  'England': 'England',
  'Emirate of Granada': 'Granada',
  'Neapol i Sycylia': 'Naples',
  'Złota Orda': 'Golden Horde',
};

function findCountry(countries, nm) {
  const mapped = COUNTRY_ALIAS[nm] || nm;
  return countries.find(c => c && (c.name === mapped || c.name === nm || c.plName === nm));
}

export function createGame(world, playerCountry) {
  const G = {
    world, player: playerCountry, day: 1, speed: 0, over: null,
    armies: [], nextArmy: 1, wars: [], truces: world.countries.map(() => new Map()),
    events: [], battleFx: [], battles: new Map(), peaceOffers: [],
    offers: [], pausedFor: 0, sound: null, version: 0,
  };
  for (const p of world.prov) {
    if (!p) continue;
    if (!(p.cores instanceof Set)) p.cores = new Set(p.cores || [p.owner]);
    if (p.garrisonMax == null) p.garrisonMax = garrisonMax(p);
    if (p.garrison == null) p.garrison = p.garrisonMax;
  }
  for (const c of world.countries) if (c) {
    c.alive = c.provs.length > 0;
    c.gold = Math.round(120 + c.totalDev * 0.9);
    c.income = 0;
    c.manpowerMax = Math.round(c.totalDev * 420);
    c.manpower = Math.round(c.manpowerMax * 0.45);
    c.forcelimit = Math.round(Math.min(48000, 1500 + c.totalDev * 36));
    c.dp = Math.min(DP_MAX || 10, 5);
    c.wars = [];
    c.allies = new Set();
    c.vassals = new Set();
    c.overlord = null;
    c.exhaustion = 0;
    c.ai = c.id !== playerCountry;
  }
  const allySets = {
    'Poland': ['Hungary'],
    'Teutonic Order': ['Holy Roman Empire', 'Kalmar Union'],
    'Holy Roman Empire': ['Teutonic Order', 'Hungary', 'Kalmar Union', 'Bosnia'],
    'France': ['Scotland'],
    'Castile': ['Aragon', 'Navarre', 'Portugal'],
    'Aragon': ['Castile', 'Navarre', 'Naples'],
    'Ottomans': ['Bulgaria'],
    'Byzantium': ['Venice', 'Trebizond'],
    'Venice': ['Byzantium', 'Papal States', 'Hungary'],
    'England': [],
    'Scotland': ['France'],
  };
  for (const [a, list] of Object.entries(allySets)) {
    for (const b of list) {
      const ca = findCountry(world.countries, a);
      const cb = findCountry(world.countries, b);
      if (ca && cb) { ca.allies.add(cb.id); cb.allies.add(ca.id); }
    }
  }
  initDiplo(G);
  initFront(G);
  for (const c of world.countries) if (c && c.provs.length) {
    const n = Math.min(3, Math.max(1, Math.round(c.totalDev / 150)));
    const total = c.forcelimit * 0.8;
    for (let i = 0; i < n; i++) {
      const pid = c.provs[Math.floor((i * 7919 + 13) % c.provs.length)];
      spawnArmy(G, c.id, pid, Math.round(total / n * (0.85 + 0.3 * ((i * 37) % 10) / 10)), true);
    }
  }
  const pc = world.countries[playerCountry];
  if (pc && pc.capital) spawnArmy(G, playerCountry, pc.capital, Math.round(pc.forcelimit * 0.18), true);
  syncFrontKnights(G);
  log(G, pc ? `${pc.plName}: zaczynasz panowanie. ${pc.plName} liczy ${pc.provs.length} prowincji.` : 'Start');
  return G;
}

export function spawnArmy(G, cid, provId, size, instant = false, days = 40) {
  const a = {
    id: G.nextArmy++, country: cid, prov: provId, prevProv: provId, size, maxSize: size, morale: 0.9,
    path: null, orderQueue: [], supportAttack: false, pinned: false,
    moveLeft: 0, moveTotal: 0, battle: null, rebel: false,
    recruitDays: instant ? 0 : days,
  };
  G.armies.push(a);
  return a;
}

export function log(G, text, kind = 'info') {
  G.events.push({ day: G.day, text, kind });
  if (G.events.length > 60) G.events.shift();
}

export const atWar = (G, a, b) => {
  if (a === b) return false;
  for (const w of G.wars) if ((w.att.includes(a) && w.def.includes(b)) || (w.att.includes(b) && w.def.includes(a))) return true;
  return false;
};
export const warOf = (G, a, b) => {
  if (a === b) return null;
  for (const w of G.wars) if ((w.att.includes(a) && w.def.includes(b)) || (w.att.includes(b) && w.def.includes(a))) return w;
  return null;
};
export const sameSide = (G, a, b) => {
  if (a === b) return true;
  if (atWar(G, a, b)) return false;
  const ca = G.world.countries[a], cb = G.world.countries[b];
  if (!ca || !cb) return false;
  return (ca.allies && ca.allies.has(b)) ||
    (ca.overlord === b || cb.overlord === a) ||
    G.wars.some(w => (w.att.includes(a) && w.att.includes(b)) || (w.def.includes(a) && w.def.includes(b)));
};
export const hostile = (G, a, b) => atWar(G, a, b);

export function countryArmies(G, cid) { return G.armies.filter(a => a.country === cid && !a.dead); }
export function armiesIn(G, pid, except) { return G.armies.filter(a => a.prov === pid && a !== except && !a.dead); }
export function strongestIn(G, pid, sideOf) {
  let best = null;
  for (const a of G.armies) if (a.prov === pid && !a.dead && a.recruitDays <= 0 && sideOf(a.country)) { if (!best || a.size > best.size) best = a; }
  return best;
}

export function findPath(G, from, to, passable = () => true, opts = {}) {
  const P = G.world.prov;
  if (!P[from] || !P[to]) return null;
  if (from === to) return [];
  const dist = new Float64Array(P.length).fill(Infinity), prev = new Int32Array(P.length).fill(-1);
  const done = new Uint8Array(P.length);
  dist[from] = 0;
  for (;;) {
    let cur = -1, best = Infinity;
    for (let i = 1; i < P.length; i++) if (!done[i] && dist[i] < best) { cur = i; best = dist[i]; }
    if (cur < 0) return null;
    if (cur === to) {
      const path = [];
      for (let x = to; x !== from; x = prev[x]) path.push(x);
      return path.reverse(); // bez prowincji początkowej
    }
    done[cur] = 1;
    for (const l of P[cur].links) {
      if (done[l.to] || (l.sea && opts.allowSea === false) || !passable(l.to, l)) continue;
      const d = best + Math.max(1, l.days) * (l.sea ? 1.25 : 1);
      if (d < dist[l.to]) { dist[l.to] = d; prev[l.to] = cur; }
    }
  }
}

export function declareWar(G, attacker, defender, reason = '') {
  if (atWar(G, attacker, defender) || attacker === defender) return false;
  const C = G.world.countries, A = C[attacker], D = C[defender];
  if (!A || !D || !A.alive || !D.alive) return false;
  if (G.truces[attacker].get(defender) > G.day) return false;
  if (hasNap(G, attacker, defender)) return false;
  if (A.overlord === defender || D.overlord === attacker) return false;
  if (A.allies.has(defender)) {
    A.allies.delete(defender); D.allies.delete(attacker);
    log(G, `${A.plName} zrywa sojusz. Były sojusznik: ${D.plName}.`, 'bad');
  }
  const { att, def, calls } = warJoiners(G, attacker, defender);
  const w = { att, def, lead: { a: attacker, d: defender }, start: G.day, score: { [attacker]: 0, [defender]: 0 }, battles: 0, occupations: 0, lastOffer: 0 };
  G.wars.push(w);
  for (const cid of [...att, ...def]) C[cid].wars.push(w);
  setRel(G, attacker, defender, Math.min(getRel(G, attacker, defender), -60));
  for (const al of D.allies) if (al !== attacker) addRel(G, attacker, al, -10);
  const nm = l => l.length ? l.map(c => C[c].plName).join(', ') : 'nikt';
  log(G, `${A.plName} wypowiada wojnę: ${D.plName}${reason ? ' (' + reason + ')' : ''}. Po stronie atakującego: ${nm(att.slice(1))}; po stronie obrońcy: ${nm(def.slice(1))}.`, 'war');
  for (const c of calls) pushCallOffer(G, w, c.side);
  syncFrontKnights(G);
  G.version++;
  return true;
}

export function makePeace(G, w, terms) {
  const P = G.world.prov;
  for (const [pid, to] of Object.entries(terms.cede || {})) {
    const p = P[+pid];
    if (!p) continue;
    const from = p.owner;
    p.owner = to; p.controller = to; p.siege = null;
    if (p.cores instanceof Set) p.cores.delete(from);
    p.garrisonMax = garrisonMax(p);
    p.garrison = Math.round(p.garrisonMax * 0.5);
    G.world.countries[from].provs = G.world.countries[from].provs.filter(x => x !== +pid);
    G.world.countries[to].provs.push(+pid);
    log(G, `${P[+pid].name} przechodzi z rąk ${G.world.countries[from].plName} do ${G.world.countries[to].plName}.`, 'peace');
  }
  const golds = !terms.gold ? [] : Array.isArray(terms.gold) ? terms.gold : [terms.gold];
  for (const g of golds) {
    if (!g || g.from == null || g.to == null || !(g.amount > 0)) continue;
    const A = G.world.countries[g.from], B = G.world.countries[g.to];
    const amt = Math.max(0, Math.min(g.amount, Math.floor(A.gold)));
    A.gold -= amt; B.gold += amt;
    if (amt > 0) log(G, `${A.plName} wypłaca ${amt} dukatów reparacji na rzecz ${B.plName}.`, 'peace');
  }
  const end = G.day + 365 * 5;
  for (const a of w.att) for (const b of w.def) {
    G.truces[a].set(b, end); G.truces[b].set(a, end);
  }
  for (const cid of [...w.att, ...w.def]) {
    const c = G.world.countries[cid];
    c.wars = c.wars.filter(x => x !== w);
    c.exhaustion = Math.max(0, c.exhaustion - 2);
  }
  G.wars = G.wars.filter(x => x !== w);
  // Koniec okupacji po pokoju; nadal trwające wojny zachowują kontrolę.
  for (const p of P) if (p && p.controller !== p.owner && !atWar(G, p.owner, p.controller)) {
    p.controller = p.owner; p.siege = null;
  }
  refreshCountries(G);
  for (const a of G.armies) {
    if (a.dead) continue;
    const p = P[a.prov];
    if (p && !canPass(G, a.country, p.id)) {
      const home = G.world.countries[a.country].provs.find(q => P[q] && P[q].controller === a.country) || G.world.countries[a.country].provs[0];
      if (home) { a.prov = home; a.prevProv = home; a.path = null; a.orderQueue = []; a.supportAttack = false; a.moveLeft = 0; a.moveTotal = 0; }
      else a.dead = true;
    }
  }
  for (const a of G.armies) {
    if (a.path?.some(id => !canPass(G, a.country, id))) clearOrder(a);
    a.fighting = false; a.pinned = false;
  }
  G.battles.clear();
  G.offers = G.offers.filter(o => o.war !== w);
  syncFrontKnights(G);
  G.version++;
}

export function refreshCountries(G) {
  const P = G.world.prov;
  for (const c of G.world.countries) if (c) {
    c.provs = [...new Set(c.provs)].filter(id => P[id]?.owner === c.id);
    c.alive = c.provs.length > 0;
    c.totalDev = c.provs.reduce((n, id) => n + P[id].dev, 0);
    if (!c.provs.includes(c.capital)) c.capital = c.provs.slice().sort((a,b) => P[b].dev-P[a].dev)[0] || 0;
    c.forcelimit = Math.round(Math.min(48000, 1500 + c.totalDev * 36));
  }
}

export function warScore(G, w, side) {
  const ours = w.att.includes(side) ? w.att : w.def, theirs = w.att.includes(side) ? w.def : w.att;
  const value = ids => G.world.prov.filter(p => p && ids.includes(p.owner)).reduce((n,p) => n + p.dev + 3, 0);
  const occupied = (owners, occupiers) => G.world.prov.filter(p => p && owners.includes(p.owner) && occupiers.includes(p.controller)).reduce((n,p) => n + p.dev + 3, 0);
  const occ = occupied(theirs, ours) / Math.max(1, value(theirs));
  const lost = occupied(ours, theirs) / Math.max(1, value(ours));
  if (occ >= 0.999 && lost < 0.999) return 100;
  if (lost >= 0.999 && occ < 0.999) return -100;
  const battle = ours.reduce((n,id) => n+(w.score[id]||0),0) - theirs.reduce((n,id) => n+(w.score[id]||0),0);
  return Math.max(-100, Math.min(100, (occ-lost)*80 + Math.max(-20,Math.min(20,battle))));
}
export function peaceBudget(G, w, asker) {
  const enemy = w.att.includes(asker) ? w.def : w.att;
  const score = warScore(G,w,asker);
  if (score >= 99.9) return enemy.reduce((n,cid) => n + G.world.countries[cid].provs.reduce((k,id) => k+provCost(G,w,id,asker),0),0) + 50;
  const leader = G.world.countries[w.att.includes(asker)?w.lead.d:w.lead.a];
  return Math.max(0,score)*(1+leader.exhaustion*0.045);
}

export function occupiedBy(G, pid) {
  const p = G.world.prov[pid];
  return p.controller !== p.owner ? p.controller : 0;
}

export function demandable(G, w, asker) {
  const enemy = w.att.includes(asker) ? w.def : w.att;
  const P = G.world.prov;
  const own = G.world.prov.filter(p=>p && sameSide(G,asker,p.controller)).map(p=>p.id);
  const controlledBySide = new Set();
  for (const pid of own) if (P[pid]) controlledBySide.add(pid);
  const out = [];
  for (const e of enemy) {
    for (const pid of G.world.countries[e].provs) {
      const p = P[pid];
      if (!p) continue;
      if (sameSide(G,asker,p.controller) || (p.adj && p.adj.some(n => controlledBySide.has(n)))) out.push(pid);
    }
  }
  return out;
}

export function provCost(G, w, pid, asker) {
  const p = G.world.prov[pid];
  let cost = p.dev * 2.6 + p.fort * 5;
  if (p.controller === asker) cost *= 0.7;
  if (!p.adj || !p.adj.some(n => G.world.prov[n] && G.world.prov[n].owner === asker)) cost *= 1.25;
  return Math.max(1, Math.round(cost));
}

export function vassalCost(G, w, cid) {
  let sum = 0;
  for (const pid of G.world.countries[cid].provs) sum += provCost(G, w, pid, G.player);
  return Math.max(1, Math.round(sum * 0.6));
}

export function canVassalize(G, w, cid) {
  const C = G.world.countries, T = C[cid];
  const lead = w.lead.a === G.player || w.lead.d === G.player;
  const enemy = w.att.includes(G.player) ? w.def : w.att;
  return !!(lead && T && enemy.includes(cid) && T.overlord == null && C[G.player].overlord !== cid && T.provs.length > 0);
}

export function aiPeaceJudgement(G, w, asker) {
  const enemyLead = w.att.includes(asker) ? w.lead.d : w.lead.a;
  const E = G.world.countries[enemyLead];
  const myScore = warScore(G, w, asker);
  const cost = G.pendingPeace ? G.pendingPeace.total : 0;
  return { accept: cost <= Math.max(0, myScore) * (1 + E.exhaustion * 0.045), will: E.exhaustion + myScore * 0.55 + E.wars.length * -3 };
}

export function stepLinkDays(G, a, fromPid, toPid) {
  const link = G.world.prov[fromPid]?.links.find(l => l.to === toPid);
  if (!link) return Infinity;
  return Math.max(1, Math.round(link.days * (link.sea ? 1.25 : 1) * (a.rebel ? 1.15 : 1) * (G.world.countries[a.country]?.ai ? AI_MARCH : 1)));
}
function clearOrder(a) {
  a.path = null; a.orderQueue = []; a.supportAttack = false;
  a.moveLeft = 0; a.moveTotal = 0; a.attackTarget = null;
}
function advanceQueueOrFinish(G, a) {
  while (a.orderQueue?.length) {
    const target = a.orderQueue.shift();
    if (target === a.prov) continue;
    const path = findPath(G, a.prov, target, to => canPass(G, a.country, to));
    if (path?.length) {
      a.path = path; a.moveTotal = a.moveLeft = stepLinkDays(G,a,a.prov,path[0]); return;
    }
    if (a.country === G.player) log(G,'Kolejny rozkaz jest niedostępny. Zatrzymano marsz.','bad');
    break;
  }
  clearOrder(a);
}

export function captureProvince(G, p, a) {
  if (!p || !a || a.dead || a.recruitDays > 0 || a.fighting || a.supportAttack || a.retreatUntil > G.day) return false;
  if (!hostile(G,a.country,p.controller)) return false;
  if (G.armies.some(o => !o.dead && !o.recruitDays && o.prov === p.id && hostile(G,a.country,o.country))) return false;
  const old = p.controller;
  p.controller = sameSide(G,a.country,p.owner) ? p.owner : a.country;
  p.siege = null; p.garrison = 0; p.devast = Math.min(0.9,(p.devast||0)+0.04);
  const w = warOf(G,a.country,old);
  if (w) w.occupations++;
  if (a.country === G.player || p.owner === G.player || old === G.player)
    log(G, `${p.name}: ${p.controller === p.owner ? 'wyzwolenie' : 'zajęcie'} — kontrola: ${G.world.countries[p.controller].plName}.`, a.country === G.player ? 'good' : 'bad');
  G.version++;
  syncFrontKnights(G);
  return true;
}

export function tickDay(G) {
  const P = G.world.prov;
  G.day++;
  for (let i = 0; i < P.length; i++) {
    const p = P[i];
    if (!p || !p.build || G.day < p.build.end) continue;
    const { kind, to } = p.build;
    p.bld[kind] = to;
    p.build = null;
    log(G, `Ukończono: ${BUILDINGS[kind].name} (poz. ${to}) w ${p.name}.`);
  }
  for (const a of G.armies) {
    if (a.recruitDays > 0) a.recruitDays--;
    a.fighting = false; a.pinned = false; a.attackTarget = null;
    if (a.path?.length && (!P[a.prov].links.some(l=>l.to===a.path[0]) || !canPass(G,a.country,a.path[0]))) {
      clearOrder(a);
      if (a.country === G.player) log(G,'Marsz zatrzymany: brak dostępnej drogi lub prawa przemarszu.','bad');
    }
  }
  // Walka z sąsiedniej prowincji zatrzymuje ruch przed granicą.
  resolveBattles(G);
  for (const a of G.armies) {
    if (a.dead || a.recruitDays > 0 || a.fighting || a.retreatUntil > G.day) continue;
    if (a.supportAttack) { clearOrder(a); continue; }
    if (!a.path?.length) continue;
    if (a.moveTotal <= 0) a.moveTotal = a.moveLeft = stepLinkDays(G,a,a.prov,a.path[0]);
    a.moveLeft--;
    if (a.moveLeft <= 0) {
      a.prevProv = a.prov; a.prov = a.path.shift();
      captureProvince(G,P[a.prov],a);
      if (a.path.length) a.moveTotal = a.moveLeft = stepLinkDays(G,a,a.prov,a.path[0]);
      else advanceQueueOrFinish(G,a);
    }
  }
  // Zajmowanie i wyzwalanie obejmuje także wojska już stojące w prowincji.
  for (const a of G.armies) if (!a.dead) captureProvince(G,P[a.prov],a);
  frontTick(G);
  for (const a of G.armies) if (!a.dead && !a.recruitDays && !a.fighting && !a.encircled) {
    a.morale = Math.min(1,a.morale+(a.path ? 0.008 : 0.025));
    if (!a.path && a.size < a.maxSize) {
      const c = G.world.countries[a.country];
      const add = Math.min(a.maxSize-a.size, Math.max(0,c.manpower), a.maxSize*0.002);
      a.size += add; c.manpower -= add;
    }
  }
  if (G.day % 30 === 0) economy(G);
  if (G.day % 30 === 15) diploMonthly(G);
  if (G.day % 60 === 40) aiWarsResolve(G);
  if (G.day % 6 === 0) aiThink(G);
  if (G.day % 90 === 0) aiPeaceOffers(G);
  G.armies = G.armies.filter(a => !a.dead);
  while (G.battleFx.length && G.battleFx[0].day < G.day-2) G.battleFx.shift();
}

function economy(G) {
  const W = G.world, P = W.prov;
  for (const c of W.countries) {
    if (!c || !c.provs.length) { if (c) c.alive = false; continue; }
    c.totalDev = c.provs.reduce((s, q) => s + (P[q] ? P[q].dev : 0), 0);
    let income = 0, taxBase = 0, farms = 0, camps = 0, researchPts = 0;
    for (const pid of c.provs) {
      const p = P[pid];
      if (!p || p.controller !== c.id) continue;
      const eff = 1 - (p.devast || 0);
      income += (p.dev * 0.16 + (p.coastal ? 0.4 : 0)) * eff;
      income += (p.dev * 0.16 + (p.coastal ? 0.4 : 0)) * eff * 0.05 * bl(p,'workshop');
      farms += bl(p,'farm');
      camps += bl(p,'camp');
      researchPts += Math.floor(provPop(p) / 725) * bl(p,'library');
      taxBase += p.dev;
    }
    const armies = countryArmies(G, c.id);
    const upkeep = armies.reduce((s, a) => s + a.size * 0.0007, 0) * Math.max(0.2, 1 - 0.2 * camps) + c.provs.reduce((s, pid) => s + (P[pid] ? P[pid].fort * 0.5 : 0), 0);
    c.gold += income - upkeep;
    c.tech = Math.min(1, (c.tech ?? TECH_START) + researchPts * TECH_PER_POINT);
    c.mp = Math.min(MP_MAX, (c.mp ?? MP_MAX) + MP_REGEN);
    for (const pid of c.provs) P[pid].devast = Math.max(0,(P[pid].devast||0)-(0.02 + 0.015*bl(P[pid],'library')));
    c.manpowerMax = Math.round(taxBase * 420);
    c.manpower = Math.min(c.manpowerMax, c.manpower + Math.round(c.manpowerMax * 0.012 * (1 + 0.05 * farms)));
    c.income = income - upkeep;
    if (c.gold < -60) {
      const a = armies.filter(x => x.recruitDays <= 0).sort((x, y) => y.size - x.size)[0];
      if (a) { a.dead = true; c.gold += 30; }
    }
    if (c.wars.length) c.exhaustion = Math.min(20, c.exhaustion + 0.08);
    else c.exhaustion = Math.max(0, c.exhaustion - 0.25);
  }
}

const BATTLE = { loss: 0.035, moraleBase: 0.025, moraleShare: 0.05, breakMorale: 0.25, breakSize: 150, maxDays: 45, pursuit: 0.06 };
const sumSize = L => L.reduce((s, a) => s + a.size, 0);
const avgMorale = L => { const t = sumSize(L) || 1e-9; return L.reduce((s, a) => s + a.morale * a.size, 0) / t; };

function resolveBattles(G) {
  const P = G.world.prov, alive = new Set(), engaged = new Set();
  const ready = G.armies.filter(a => !a.dead && !a.recruitDays && !(a.retreatUntil > G.day));
  const byProv = new Map();
  for (const a of ready) { if (!byProv.has(a.prov)) byProv.set(a.prov,[]); byProv.get(a.prov).push(a); }
  const targets = new Set(ready.filter(a=>a.path?.length).map(a=>a.path[0]));
  for (const [pid,arr] of byProv) if (arr.some(a=>arr.some(b=>hostile(G,a.country,b.country)))) targets.add(pid);
  for (const pid of targets) {
    const locals = byProv.get(pid) || [];
    const incoming = ready.filter(a => a.path?.[0] === pid && a.prov !== pid && P[a.prov].links.some(l=>l.to===pid));
    const attackers = [...incoming,...locals];
    for (const a of attackers) {
      if (a.dead || engaged.has(a.id)) continue;
      const defender = locals.find(d => !d.dead && !engaged.has(d.id) && hostile(G,a.country,d.country));
      if (!defender) continue;
      const L1 = attackers.filter(x=>!x.dead && !engaged.has(x.id) && sameSide(G,a.country,x.country) && hostile(G,x.country,defender.country));
      const L2 = locals.filter(x=>!x.dead && !engaged.has(x.id) && sameSide(G,defender.country,x.country) && hostile(G,x.country,a.country));
      if (!L1.length || !L2.length) continue;
      for (const x of [...L1,...L2]) { engaged.add(x.id); x.attackTarget=pid; }
      const key = pid+':'+Math.min(a.country,defender.country)+':'+Math.max(a.country,defender.country);
      alive.add(key);
      const previous = G.battles.get(key);
      if (previous && previous.s1 !== a.country) fightDay(G,key,pid,defender.country,L2,a.country,L1);
      else fightDay(G,key,pid,a.country,L1,defender.country,L2);
    }
  }
  for (const key of [...G.battles.keys()]) if (!alive.has(key)) G.battles.delete(key);
}

function fightDay(G, key, pid, s1, L1, s2, L2) {
  const P = G.world.prov, C = G.world.countries, p = P[pid];
  let B = G.battles.get(key);
  if (!B) {
    B = { key, pid, s1, s2, start: G.day, loss1: 0, loss2: 0, share1: 0.5 };
    G.battles.set(key, B);
    if (G.player === s1 || G.player === s2 || sameSide(G, G.player, s1) || sameSide(G, G.player, s2))
      log(G, `Bitwa pod ${p.name}: ${C[s1].plName} (${Math.round(sumSize(L1))}) przeciw ${C[s2].plName} (${Math.round(sumSize(L2))}).`);
  }
  for (const a of L1) { a.fighting = true; a.pinned = true; }
  for (const a of L2) { a.fighting = true; a.pinned = true; }
  const T = TERRAIN[p.terrain] || { def: 0, siege: 1 };
  const str = arr => arr.reduce((s, a) => s + a.size * (0.35 + a.morale * 0.65), 0);
  const v1 = str(L1) * (1 + (sameSide(G,p.controller,s1) ? T.def + p.fort*0.08 + bl(p,'zamek')*0.2 + bl(p,'watch')*0.04 : 0)) * (0.9 + Math.random() * 0.2);
  const v2 = str(L2) * (1 + (sameSide(G,p.controller,s2) ? T.def + p.fort*0.08 + bl(p,'zamek')*0.2 + bl(p,'watch')*0.04 : 0)) * (0.9 + Math.random() * 0.2);
  const tot = (v1 + v2) || 1, r1 = v1 / tot, r2 = v2 / tot;
  B.share1 = r1;
  const n1 = sumSize(L1), n2 = sumSize(L2);
  const l1 = n1 * BATTLE.loss * r2, l2 = n2 * BATTLE.loss * r1;
  for (const a of L1) a.size = Math.max(0, a.size - l1 * a.size / (n1 || 1e-9));
  for (const a of L2) a.size = Math.max(0, a.size - l2 * a.size / (n2 || 1e-9));
  B.loss1 += l1; B.loss2 += l2;
  for (const a of L1) a.morale = Math.max(0, a.morale - (BATTLE.moraleBase + BATTLE.moraleShare * r2 + Math.random() * 0.01));
  for (const a of L2) a.morale = Math.max(0, a.morale - (BATTLE.moraleBase + BATTLE.moraleShare * r1 + Math.random() * 0.01));
  const broke = L => sumSize(L) < BATTLE.breakSize || avgMorale(L) < BATTLE.breakMorale;
  const b1 = broke(L1), b2 = broke(L2);
  if (!b1 && !b2 && G.day - B.start < BATTLE.maxDays) return;
  const winner = b1 !== b2 ? (b1 ? s2 : s1) : (v1 >= v2 ? s1 : s2);
  endBattle(G, B, winner, winner === s1 ? L1 : L2, winner === s1 ? L2 : L1);
}

function endBattle(G, B, winner, winArr, loseArr) {
  const P = G.world.prov, C = G.world.countries, p = P[B.pid];
  const lossW = winner === B.s1 ? B.loss1 : B.loss2, lossL = winner === B.s1 ? B.loss2 : B.loss1;
  const loser = winner === B.s1 ? B.s2 : B.s1;
  const days = G.day - B.start + 1;
  G.battles.delete(B.key);
  const w = warOf(G, B.s1, B.s2);
  if (w) { w.score[winner] = (w.score[winner] || 0) + 2 + Math.round(lossW + lossL) / 500; w.battles++; }
  G.battleFx.push({ prov: B.pid, day: G.day, winner });
  if (G.player === winner || G.player === loser)
    log(G, `Bitwa pod ${p.name} zakończona po ${days} dn.: ${C[winner].plName} zwycięża (straty: ${Math.round(lossW)} zwycięzców, ${Math.round(lossL)} pokonanych).`, G.player === winner ? 'good' : 'bad');
  for (const a of loseArr) {
    a.fighting = false; a.pinned = false;
    a.size *= 1-BATTLE.pursuit;
    clearOrder(a);
    if (a.size < 180) { a.dead=true; continue; }
    // Atakujący zostaje w prowincji wyjściowej. Obrońca może ujść tylko do
    // sąsiedniej przyjaznej prowincji bez wroga; otoczona jednostka kapituluje.
    if (a.prov === B.pid) {
      const escape = P[a.prov].links.filter(l => !l.sea && sameSide(G,a.country,P[l.to].controller)
        && !G.armies.some(o=>!o.dead && !o.recruitDays && o.prov===l.to && hostile(G,a.country,o.country)))
        .sort((x,y)=>x.days-y.days)[0];
      if (!escape) { a.dead=true; continue; }
      a.prevProv = a.prov; a.prov=escape.to;
    }
    a.retreatUntil=G.day+4;
    a.morale=Math.max(0.1,a.morale);
  }
  for (const a of winArr) {
    a.fighting=false; a.pinned=false;
    if (a.size < 120) { a.dead=true; continue; }
    if (a.supportAttack) clearOrder(a);
    else if (a.path?.length) a.moveTotal=a.moveLeft=stepLinkDays(G,a,a.prov,a.path[0]);
  }
}

function aiThink(G) {
  const W = G.world, P = W.prov;
  for (const c of W.countries) {
    if (!c || !c.ai || !c.alive || !c.provs.length) continue;
    const armies = countryArmies(G, c.id).filter(a => !a.recruitDays && !a.dead);
    if (G.day % 12 === 0 && armies.length < 5 && c.gold > 260 && c.manpower > 3200 && c.wars.length) {
      const pid = c.provs.find(q => P[q] && P[q].controller === c.id);
      if (pid) {
        const sz = Math.min(6000, Math.round(c.forcelimit * 0.3));
        if (c.manpower >= sz && c.gold >= sz * 0.05) {
          c.manpower -= sz; c.gold -= sz * 0.05;
          spawnArmy(G, c.id, pid, sz);
        }
      }
    }
    if (!c.wars.length) continue;
    const enemies = new Set();
    for (const w of c.wars) for (const e of (w.att.includes(c.id) ? w.def : w.att)) enemies.add(e);
    const targets = c.provs.filter(id=>atWar(G,c.id,P[id].controller)).map(pid=>({pid,prio:3}));
    for (const e of enemies) {
      const ec = W.countries[e];
      if (!ec) continue;
      for (const pid of ec.provs) {
        const p = P[pid];
        if (!p) continue;
        if (p.controller === e || (p.controller !== c.id && p.controller !== p.owner)) {
          if ((p.adj && p.adj.some(n => P[n] && P[n].controller === c.id)) || p.controller === e) {
            targets.push({ pid, prio: (p.controller === c.id ? -1 : 0) + (p.controller === e ? 1 : 0) + ((p.adj && p.adj.some(n => P[n] && P[n].owner === c.id)) ? 0.5 : 0) });
          }
        }
      }
    }
    targets.sort((a, b) => b.prio - a.prio);
    const taken = new Set(armies.filter(a => a.path).map(a => a.path[a.path.length - 1]));
    for (const a of armies) {
      if (a.size < 180 || a.morale < 0.35 || a.retreatUntil > G.day) continue;
      if (a.path || a.fighting) continue;
      const here = P[a.prov];
      if (!here) continue;
      if ((here.siege && here.siege.side === c.id) || (here.controller !== c.id && atWar(G, c.id, here.controller))) continue;
      const ownOccupied = c.provs.find(q => P[q] && P[q].controller !== c.id && P[q].controller !== P[q].owner);
      if (ownOccupied != null && P[ownOccupied].adj && P[ownOccupied].adj.some(n => P[n] && P[n].id === a.prov)) {
        a.prevProv = a.prov;
        a.path = [ownOccupied];
        const days = stepLinkDays(G, a, a.prov, ownOccupied);
        a.moveTotal = days; a.moveLeft = days; continue;
      }
      let t = null, best = Infinity;
      for (const cand of targets) {
        if (cand.pid === a.prov) continue;
        const q = P[cand.pid];
        const d = Math.hypot(q.ax - here.ax, q.ay - here.ay) / 25;
        const sc = d - cand.prio * 2 + (taken.has(cand.pid) ? 6 : 0);
        if (sc < best) { best = sc; t = cand; }
      }
      if (t) {
        taken.add(t.pid);
        const path = findPath(G, a.prov, t.pid, to => canPass(G, c.id, to));
        if (path && path.length) {
          a.prevProv = a.prov;
          a.path = path;
          const days = stepLinkDays(G, a, a.prov, path[0]);
          a.moveTotal = days; a.moveLeft = days;
        }
      }
    }
  }
}

function aiPeaceOffers(G) {
  for (const w of [...G.wars]) {
    const leadA = w.lead.a, leadD = w.lead.d;
    for (const [aiSide, otherSide] of [[leadA, leadD], [leadD, leadA]]) {
      if (otherSide !== G.player) continue;
      const AI = G.world.countries[aiSide];
      const my = warScore(G, w, G.player);
      if (AI && my > 25 && AI.exhaustion > 3 && G.day - w.lastOffer > 200) {
        w.lastOffer = G.day;
        pushPeaceOffer(G, w, aiSide);
      }
    }
  }
}

export function playerHaltArmies(G, armies) {
  const list = Array.isArray(armies) ? armies : [armies];
  let changed = false;
  for (const a of list) {
    if (!a || a.dead || a.country !== G.player) continue;
    if (a.path || (a.orderQueue && a.orderQueue.length) || a.supportAttack) {
      a.path = null;
      a.orderQueue = [];
      a.moveLeft = 0;
      a.moveTotal = 0;
      a.supportAttack = false;
      changed = true;
    }
  }
  if (changed) {
    log(G, `Wstrzymano rozkazy dla ${list.length} ${list.length === 1 ? 'armii' : 'armii'} (H).`);
    G.version++;
  }
  return changed;
}

export function playerIssueOrder(G, armies, targetPid, { queue = false, supportAttack = false } = {}) {
  if (!G.world.prov[targetPid]) return false;
  let ok=false;
  for (const a of (Array.isArray(armies)?armies:[armies])) {
    if (!a || a.dead || a.country!==G.player || a.recruitDays>0 || a.retreatUntil>G.day) continue;
    if (supportAttack) {
      if (a.fighting || !G.world.prov[a.prov].links.some(l=>l.to===targetPid) || !canPass(G,a.country,targetPid)) continue;
      if (!G.armies.some(d=>!d.dead && !d.recruitDays && d.prov===targetPid && hostile(G,a.country,d.country))) continue;
      clearOrder(a); a.supportAttack=true; a.path=[targetPid];
      a.moveTotal=a.moveLeft=stepLinkDays(G,a,a.prov,targetPid); ok=true;
    } else if (queue && a.path?.length) {
      const tail=a.orderQueue?.length ? a.orderQueue.at(-1) : a.path.at(-1);
      if (targetPid===tail) { ok=true; continue; }
      const path=findPath(G,tail,targetPid,id=>canPass(G,a.country,id));
      if (path?.length) { a.orderQueue.push(targetPid); ok=true; }
    } else if (playerMoveArmy(G,a,targetPid)) ok=true;
  }
  if (ok) G.version++;
  return ok;
}
export function playerMoveArmy(G, a, targetPid) {
  const P=G.world.prov;
  if (!a || a.dead || a.country!==G.player || a.recruitDays>0 || a.retreatUntil>G.day || !P[targetPid]) return false;
  const path=findPath(G,a.prov,targetPid,id=>canPass(G,a.country,id));
  if (!path) return false;
  if (a.fighting) {
    const defending = a.attackTarget===a.prov;
    if (defending) {
      const first=path[0];
      if (!first || !sameSide(G,a.country,P[first].controller) || G.armies.some(o=>!o.dead && o.prov===first && hostile(G,a.country,o.country))) return false;
      a.size*=0.95; a.morale=Math.max(0.1,a.morale-0.1);
      a.prevProv=a.prov; a.prov=first; a.retreatUntil=G.day+4;
      clearOrder(a); a.fighting=false; a.pinned=false;
      log(G,`Odwrót do ${P[first].name}. Utrata 5% ludzi; reorganizacja: 4 dni.`,'bad');
      G.version++; return true;
    }
    a.fighting=false; a.pinned=false;
  }
  clearOrder(a);
  if (path.length) { a.path=path; a.prevProv=a.prov; a.moveTotal=a.moveLeft=stepLinkDays(G,a,a.prov,path[0]); }
  G.version++; return true;
}

export const MIN_SPLIT = 400;
export function canSplit(a) { return !!a && !a.dead && a.recruitDays <= 0 && a.size >= MIN_SPLIT && !a.fighting && !a.path; }

export function playerSplitArmy(G, army) {
  if (!army || army.country !== G.player || army.retreatUntil > G.day || !canSplit(army)) return null;
  const half = Math.floor(army.size / 2);
  const n = spawnArmy(G, army.country, army.prov, army.size - half, true);
  const originalMax = army.maxSize;
  army.size = half;
  army.maxSize = originalMax/2; n.maxSize = originalMax-army.maxSize;
  n.morale = army.morale; n.rebel = army.rebel;
  const p = G.world.prov[army.prov];
  log(G, `Podzielono armię w ${p.name}: ${Math.round(army.size)} + ${Math.round(n.size)} ludzi.`);
  G.version++;
  return n;
}

export function playerUndoSplit(G, orig, half) {
  if (!orig || !half || orig.dead || half.dead || orig.prov !== half.prov || half.path) return false;
  const tot = orig.size + half.size;
  orig.morale = (orig.morale * orig.size + half.morale * half.size) / tot;
  orig.size = tot; orig.maxSize += half.maxSize; half.dead = true;
  G.armies = G.armies.filter(a => !a.dead);
  G.version++;
  return true;
}

export function playerMergeArmies(G, pid) {
  const list = G.armies.filter(a => a.country === G.player && a.prov === pid && !a.dead && a.recruitDays <= 0 && !a.path && !a.fighting && !(a.retreatUntil > G.day));
  if (list.length < 2) return null;
  list.sort((a, b) => b.size - a.size);
  const main = list[0];
  let total = 0, mor = 0;
  for (const a of list) { total += a.size; mor += a.morale * a.size; }
  for (const o of list.slice(1)) o.dead = true;
  G.armies = G.armies.filter(a => !a.dead);
  main.size = total; main.maxSize = list.reduce((n,a)=>n+a.maxSize,0); main.morale = mor / total;
  log(G, `Połączono ${list.length} armie w ${G.world.prov[pid].name}: razem ${Math.round(total)} ludzi.`);
  G.version++;
  return main;
}

// Założenia: koszty z tooltipów Wilna (rozwój VILNIUS_DEV), reszta skaluje się z rozwojem prowincji.
export const VILNIUS_DEV = 36;
export const MP_MAX = 100, MP_REGEN = 1;            // punkty ruchu: pula kraju, +1 dziennie
export const TECH_START = 0.4, TECH_PER_POINT = 0.00002;

export const BUILDINGS = {
  zamek:    { name: 'Twierdza', max: 3, base: 5837, mp: 1.4, tech: 0.5, days: 30, desc: '+20% obrony za poziom; chowa armię przed wrogą Wieżą Obserwacyjną' },
  watch:    { name: 'Wieża Obserwacyjna', max: 2, base: 3500, mp: 1.4, tech: 0.2, days: 20, desc: '+4% obrony za poziom; widzi jednostki wroga w sąsiednich prowincjach' },
  farm:     { name: 'Farma', max: 3, base: 3846, mp: 1.4, tech: 0.15, days: 20, desc: '+5% przyrostu naturalnego (regeneracja ludzi) za poziom' },
  workshop: { name: 'Warsztat', max: 3, base: 4114, mp: 1.8, tech: 0.4, days: 25, desc: '+5% wpływów z produkcji prowincji za poziom' },
  library:  { name: 'Biblioteka', max: 2, base: 9528, mp: 1.0, tech: 0.25, days: 25, desc: '+1 punkt badań za każde 725 ludzi w prowincji (za poziom, dziennie)' },
  armory:   { name: 'Zbrojownia', max: 3, base: 16870, mp: 2.8, tech: 0.4, days: 25, desc: '−0,01 złota za jednostkę rekrutacji za poziom' },
  camp:     { name: 'Obóz Zaopatrzeniowy', max: 2, base: 12801, mp: 1.4, tech: 0.3, days: 25, desc: '−20% utrzymania wojska za poziom' },
};

export function bl(p, k) { return (p && p.bld && p.bld[k]) || 0; }
export function provPop(p) { return p.dev * 300; }  // założenie: ludność prowincji = rozwój × 300

function goldPerMan(p) { return Math.max(0, 0.05 - 0.01 * bl(p, 'armory')); }

export function recruitQuote(G, size, pid) {
  return { gold: size * goldPerMan(G.world.prov[pid]), days: 40 };
}

export function recruitMaxSize(G, pid) {
  const c = G.world.countries[G.player], p = G.world.prov[pid];
  if (!c || !p) return 0;
  const bySize = Math.floor(Math.min(c.manpower, c.gold / goldPerMan(p)) / 100) * 100;
  return Math.max(0, Math.min(50000, bySize));
}

export function buildInfo(G, pid, kind) {
  const def = BUILDINGS[kind], p = G.world.prov[pid], c = G.world.countries[G.player];
  const lvl = bl(p, kind), next = lvl + 1;
  const gold = def.base * (p.dev / VILNIUS_DEV) * next, mp = def.mp * next;
  const tech = c.tech ?? TECH_START, mpHave = c.mp ?? MP_MAX;
  let why = null;
  if (p.build) why = 'trwa już budowa w tej prowincji';
  else if (lvl >= def.max) why = 'osiągnięto maks. poziom';
  else if (tech < def.tech) why = `wymagana technologia ${def.tech}`;
  else if (mpHave < mp) why = 'za mało punktów ruchu';
  else if (c.gold < gold) why = 'za mało złota';
  return { def, lvl, next, gold, mp, tech, mpHave, days: def.days * next, why, ok: !why };
}

export function playerBuild(G, pid, kind) {
  const def = BUILDINGS[kind], p = G.world.prov[pid], c = G.world.countries[G.player];
  if (!def || !p || !c || p.owner !== G.player || p.controller !== G.player) return false;
  const i = buildInfo(G, pid, kind);
  if (!i.ok) return false;
  c.gold -= i.gold; c.mp = i.mpHave - i.mp;
  p.build = { kind, to: i.next, end: G.day + i.days };
  log(G, `Rozpoczęto budowę: ${def.name} (poz. ${i.next}) w ${p.name}, ${i.days} dni.`);
  return true;
}

export function playerRecruit(G, size, targetPid = null) {
  if (!Number.isFinite(size) || size < 100 || size > 50000) return false;
  const c = G.world.countries[G.player];
  if (!c) return false;
  const pid = targetPid == null ? c.provs.find(q => G.world.prov[q]?.controller === G.player) : targetPid;
  if (!pid || !c.provs.includes(pid) || G.world.prov[pid]?.controller !== G.player) return false;
  const q = recruitQuote(G, size, pid);
  if (c.manpower < size || c.gold < q.gold) return false;
  c.manpower -= size; c.gold -= q.gold;
  spawnArmy(G, G.player, pid, size, false, q.days);
  log(G, `Rozpoczęto mobilizację ${size} ludzi w ${G.world.prov[pid].name} (${q.days} dni).`);
  return true;
}

export function playerDeclareWar(G, target) {
  if (G.truces[G.player].get(target) > G.day) return false;
  if (hasNap(G, G.player, target)) return false;
  return declareWar(G, G.player, target, 'pretensje terytorialne');
}

export function playerPeaceDemand(G, w, demands, goldFromEnemy, vassals = []) {
  if (!G.wars.includes(w) || ![...w.att,...w.def].includes(G.player)) return {ok:false,msg:'Ta wojna już się skończyła.'};
  const enemyLead = w.att.includes(G.player) ? w.lead.d : w.lead.a;
  const E = G.world.countries[enemyLead];
  const valid = new Set(demandable(G,w,G.player));
  if (!Array.isArray(demands) || demands.some(d=>!valid.has(d.pid)) || !Number.isFinite(goldFromEnemy) || goldFromEnemy<0) return {ok:false,msg:'Nieprawidłowe warunki traktatu.'};
  demands = [...new Map(demands.map(d=>[d.pid,d])).values()];
  let total = 0;
  const vassalSet = new Set(vassals);
  for (const cid of vassalSet) if (!canVassalize(G, w, cid)) return { ok: false, msg: 'Tego państwa nie można teraz uczynić wasalem.' };
  demands = demands.filter(d => !vassalSet.has(G.world.prov[d.pid].owner));
  for (const d of demands) total += provCost(G, w, d.pid, G.player);
  for (const cid of vassalSet) total += vassalCost(G, w, cid);
  const myScore = warScore(G, w, G.player);
  const cap = peaceBudget(G,w,G.player);
  const goldCap = Math.max(0, Math.min(E.gold, Math.max(0, (cap - total)) * 4));
  const accept = goldFromEnemy <= goldCap && total + goldFromEnemy / 4 <= cap + 0.001;
  if (!accept) {
    return { ok: false, msg: `Posłowie ${E.plName} odrzucają żądania jako zbyt wygórowane (maks. ~${Math.round(cap)} pkt, żądasz ${Math.round(total)}).` };
  }
  const cede = {};
  for (const d of demands) cede[d.pid] = G.player;
  const isLead = w.lead.a === G.player || w.lead.d === G.player;
  if (!isLead) {
    separatePeace(G, w, G.player, cede, goldFromEnemy > 0 ? { from: enemyLead, to: G.player, amount: Math.min(goldFromEnemy, goldCap) } : null);
    log(G, `Pokój separatystyczny (${E.plName}): ${demands.length} prowincji${goldFromEnemy > 0 ? ` i ${Math.min(goldFromEnemy, goldCap)} dukatów` : ''}.`, 'peace');
    return { ok: true };
  }
  makePeace(G, w, {
    cede,
    gold: goldFromEnemy > 0 ? { from: enemyLead, to: G.player, amount: Math.min(goldFromEnemy, goldCap) } : null,
  });
  for (const cid of vassalSet) {
    makeVassal(G, G.player, cid);
    log(G, `${G.world.countries[cid].plName} zostaje twoim wasalem na mocy traktatu pokojowego.`, 'peace');
  }
  log(G, `Podpisano traktat pokojowy z ${E.plName}: ${demands.length} prowincji${goldFromEnemy > 0 ? ` i ${Math.min(goldFromEnemy, goldCap)} dukatów` : ''}${vassalSet.size ? `, wasali: ${vassalSet.size}` : ''}.`, 'peace');
  return { ok: true };
}

export function acceptWhitePeace(G, w) {
  if (w.lead.a !== G.player && w.lead.d !== G.player) { separatePeace(G, w, G.player, {}, null); log(G, 'Wycofano się z wojny — pokój separatystyczny, status quo.', 'peace'); return; }
  makePeace(G, w, {});
  log(G, 'Zawarto biały pokój — status quo ante bellum.', 'peace');
}

export function tick(G, ms) {
  const spd = SPEEDS[G.speed];
  if (!spd) return;
  G._acc = (G._acc || 0) + ms;
  let guard = 0;
  while (G._acc >= spd && guard++ < 400) { tickDay(G); G._acc -= spd; }
}
