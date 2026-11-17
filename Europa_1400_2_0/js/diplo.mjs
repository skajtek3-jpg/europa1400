// Dyplomacja w stylu Age of History 2: stosunki, punkty dyplomacji, sojusze, pakty,
// prawo przejścia, gwarancje niepodległości, wasale, wezwania do wojny, propozycje AI.
import { atWar, log, declareWar, countryArmies, makePeace, provCost, refreshCountries, warScore } from './game.mjs';
import { syncFrontKnights } from './front.mjs';

export const DP_MAX = 10;
export const COST = { improve: 1, insult: 1, gift: 1, alliance: 2, nap: 2, access: 1, guarantee: 2, vassal: 3, annex: 5, call: 1 };
const key = (a, b) => a < b ? a + ':' + b : b + ':' + a;

const ALIAS = {
  'England': 'England',
  'Emirate of Granada': 'Granada',
  'Neapol i Sycylia': 'Naples',
  'Złota Orda': 'Golden Horde',
};

function findCountry(C, nm) {
  const mapped = ALIAS[nm] || nm;
  return C.find(c => c && (c.name === mapped || c.name === nm || c.plName === nm));
}

// ---------- inicjalizacja ----------
export function initDiplo(G) {
  const C = G.world.countries, n = C.length;
  G.rel = new Float32Array(n * n);
  G.nap = new Map();      // para → dzień końca paktu o nieagresji
  G.access = new Map();   // "kto>przez kogo" → dzień końca prawa przejścia
  G.guar = new Map();     // gwarant → Set gwarantowanych
  G.offers = [];          // propozycje AI dla gracza
  G.nextOffer = 1;
  for (const c of C) if (c) { c.dp = 3; c.overlord = null; c.vassals = new Set(); c.vassalSince = 0; }
  // stosunki startowe: sąsiedzi lekko nieufni, sojusznicy przyjaźni, pewne historyczne rywalizacje
  const nb = neighborsAll(G);
  for (const c of C) if (c) for (const o of nb[c.id]) if (o > c.id) {
    const h = ((c.id * 7919 + o * 104729) % 31) - 18; // −18..+12, deterministycznie
    setRel(G, c.id, o, h);
  }
  for (const c of C) if (c) for (const a of c.allies) setRel(G, c.id, a, 60);
  const rivals = [
    ['Poland', 'Teutonic Order', -55],
    ['France', 'England', -60],
    ['Scotland', 'England', -45],
    ['Byzantium', 'Ottomans', -50],
    ['Novgorod', 'Teutonic Order', -30],
    ['Castile', 'Granada', -50],
    ['Venice', 'Ottomans', -25],
    ['Hungary', 'Ottomans', -40],
  ];
  for (const [a, b, v] of rivals) {
    const ca = findCountry(C, a), cb = findCountry(C, b);
    if (ca && cb) setRel(G, ca.id, cb.id, v);
  }
}

export function getRel(G, a, b) { return a === b ? 100 : G.rel[a * G.world.countries.length + b]; }
export function setRel(G, a, b, v) {
  const n = G.world.countries.length; v = Math.max(-100, Math.min(100, v));
  G.rel[a * n + b] = v; G.rel[b * n + a] = v;
}
export function addRel(G, a, b, d) { setRel(G, a, b, getRel(G, a, b) + d); }

// ---------- sąsiedztwo ----------
let nbCache = null, nbVer = -1, nbWorld = null;
export function neighborsAll(G) {
  if (nbCache && nbWorld === G.world && nbVer === G.version) return nbCache;
  const C = G.world.countries, P = G.world.prov;
  const out = C.map(() => new Set());
  for (let id = 1; id < P.length; id++) {
    const p = P[id]; if (!p) continue;
    for (const q of p.adj) { const o = P[q] && P[q].owner; if (o != null && o !== p.owner) out[p.owner].add(o); }
    for (const l of p.links) { const o = P[l.to] && P[l.to].owner; if (o != null && o !== p.owner && l.sea) out[p.owner].add(o); }
  }
  nbCache = out; nbVer = G.version; nbWorld = G.world;
  return out;
}
export const isNeighbor = (G, a, b) => neighborsAll(G)[a].has(b);

// ---------- statusy ----------
export const hasNap = (G, a, b) => (G.nap.get(key(a, b)) || 0) > G.day;
export const hasAccess = (G, who, through) => (G.access.get(who + '>' + through) || 0) > G.day;
export const guarantees = (G, g, t) => !!(G.guar.get(g) && G.guar.get(g).has(t));
export const guarantorsOf = (G, t) => [...G.guar.entries()].filter(([, s]) => s.has(t)).map(([g]) => g);
export const isAlly = (G, a, b) => G.world.countries[a].allies.has(b);
export const isVassalPair = (G, a, b) => G.world.countries[a].overlord === b || G.world.countries[b].overlord === a;
export function truceLeft(G, a, b) { const t = G.truces[a].get(b) || 0; return t > G.day ? t - G.day : 0; }

// siła militarna (armie + potencjał rezerw)
export function power(G, cid) {
  const c = G.world.countries[cid];
  const army = countryArmies(G, cid).reduce((s, a) => s + a.size, 0);
  return army + Math.min(c.manpower, c.forcelimit) * 0.35;
}
function blocPower(G, cid, vs) {
  const c = G.world.countries[cid];
  let s = power(G, cid);
  for (const a of c.allies) if (a !== vs && !isAlly(G, a, vs)) s += power(G, a) * 0.5;
  for (const v of c.vassals) s += power(G, v) * 0.9;
  if (c.overlord != null && c.overlord !== vs) s += power(G, c.overlord) * 0.9;
  for (const g of guarantorsOf(G, cid)) if (g !== vs) s += power(G, g) * 0.6;
  return s;
}

// czy armia kraju `cid` może wejść do prowincji `pid` (poza wojną z właścicielem)
export function canPass(G, cid, pid) {
  const p = G.world.prov[pid];
  if (!p || !G.world.countries[cid]) return false;
  const o = p.owner, ct = p.controller;
  if (ct === cid) return true;
  if (o === ct) {
    if (o === cid) return true;
    if (atWar(G, cid, o)) return true;
    return friendlyTerritory(G, cid, o);
  }
  if (atWar(G, cid, ct)) return true;
  return friendlyTerritory(G, cid, ct) && (atWar(G, cid, o) || friendlyTerritory(G, cid, o) || o === cid);
}
function friendlyTerritory(G, cid, o) {
  const C = G.world.countries;
  if (C[cid].allies.has(o) || isVassalPair(G, cid, o) || hasAccess(G, cid, o)) return true;
  return G.wars.some(w => (w.att.includes(cid) && w.att.includes(o)) || (w.def.includes(cid) && w.def.includes(o)));
}

// ---------- ocena propozycji przez AI (deterministyczna — gracz widzi powód) ----------
export function evaluate(G, from, to, type) {
  const C = G.world.countries, A = C[from], T = C[to];
  const rel = getRel(G, from, to);
  const no = reason => ({ ok: false, reason });
  if (!T.alive && !T.provs.length) return no('Państwo nie istnieje.');
  if (atWar(G, from, to) && type !== 'improve' && type !== 'insult') return no('Jesteście w stanie wojny.');
  switch (type) {
    case 'improve': return rel >= 100 ? no('Stosunki są już doskonałe.') : { ok: true };
    case 'insult': return { ok: true };
    case 'gift': return A.gold < 50 ? no('Brak 50 dukatów w skarbcu.') : { ok: true };
    case 'alliance': {
      if (A.allies.has(to)) return no('Już jesteście sojusznikami.');
      if (T.overlord != null) return no(`${T.plName} jest wasalem — polityką zagraniczną kieruje suweren.`);
      const need = 40 + (T.allies.size >= 3 ? 20 : 0) + (power(G, from) < power(G, to) * 0.3 ? 15 : 0);
      const enemyFriend = [...A.wars].some(w => (w.att.includes(from) ? w.def : w.att).some(e => T.allies.has(e)));
      if (enemyFriend) return no('Walczysz z ich sojusznikiem.');
      if (rel < need) return no(`Wymagane stosunki co najmniej +${need} (obecnie ${fmt(rel)}).`);
      return { ok: true };
    }
    case 'nap': {
      if (hasNap(G, from, to)) return no('Pakt już obowiązuje.');
      if (A.allies.has(to)) return no('Sojusznicy nie potrzebują paktu.');
      if (rel < 0) return no(`Wymagane stosunki co najmniej 0 (obecnie ${fmt(rel)}).`);
      return { ok: true };
    }
    case 'access': {
      if (hasAccess(G, from, to)) return no('Prawo przejścia już obowiązuje.');
      if (A.allies.has(to) || isVassalPair(G, from, to)) return no('Sojusznicy i wasale mają je automatycznie.');
      const need = 15;
      if (rel < need) return no(`Wymagane stosunki co najmniej +${need} (obecnie ${fmt(rel)}).`);
      return { ok: true };
    }
    case 'guarantee': {
      if (guarantees(G, from, to)) return no('Już gwarantujesz ich niepodległość.');
      if (T.overlord != null) return no('Wasali chroni suweren.');
      if (C[to].totalDev > C[from].totalDev) return no('Gwarantować można tylko słabszym państwom.');
      return { ok: true };
    }
    case 'vassal': {
      if (T.overlord === from) return no('Już jest twoim wasalem.');
      if (T.overlord != null) return no('Ma już suwerena.');
      if (T.wars.length) return no('Prowadzi wojnę — nie podejmie takich rozmów.');
      if (T.provs.length > 14) return no('Zbyt duże państwo (maks. 14 prowincji).');
      const ratio = power(G, from) / Math.max(1, power(G, to));
      const devR = C[from].totalDev / Math.max(1, C[to].totalDev);
      if (devR < 3) return no(`Musisz być co najmniej 3× większy (rozwój ${C[from].totalDev} vs ${C[to].totalDev}).`);
      if (ratio < 3) return no('Twoja armia musi być co najmniej 3× silniejsza.');
      if (rel < 50) return no(`Wymagane stosunki co najmniej +50 (obecnie ${fmt(rel)}).`);
      return { ok: true };
    }
    case 'annex': {
      if (T.overlord !== from) return no('To nie jest twój wasal.');
      const yrs = (G.day - T.vassalSince) / 365;
      if (yrs < 5) return no(`Wasal musi być pod twoją zwierzchnością 5 lat (minęło ${yrs.toFixed(1)}).`);
      if (rel < 60) return no(`Wymagane stosunki co najmniej +60 (obecnie ${fmt(rel)}).`);
      const cost = annexCost(G, to);
      if (A.gold < cost) return no(`Potrzebujesz ${cost} dukatów.`);
      return { ok: true };
    }
    case 'call': return { ok: true };
  }
  return no('Nieznana akcja.');
}
export const annexCost = (G, cid) => Math.round(G.world.countries[cid].totalDev * 1.2 + 50);
export const plProv = n => n === 1 ? '1 prowincja' : (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20)) ? n + ' prowincje' : n + ' prowincji';
const fmt = v => (v > 0 ? '+' : '') + Math.round(v);

// ---------- akcje (gracz albo AI) ----------
export function diploAction(G, from, to, type, opts = {}) {
  const C = G.world.countries, A = C[from], T = C[to];
  if (!A || !T || from === to || !(type in COST)) return {ok:false,msg:'Nieprawidłowa akcja dyplomatyczna.'};
  const cost = COST[type] || 0;
  if (A.dp < cost) return { ok: false, msg: `Za mało punktów dyplomacji (potrzeba ${cost}).` };
  const ev = evaluate(G, from, to, type);
  const proposal = ['alliance', 'nap', 'access', 'vassal'].includes(type);
  if (!ev.ok && !proposal) return { ok: false, msg: ev.reason };
  A.dp -= cost;
  const me = from === G.player;
  if (!ev.ok) {
    if (type === 'vassal') addRel(G, from, to, -15);
    return { ok: false, msg: `${T.plName} odrzuca propozycję. ${ev.reason}` };
  }
  let msg = '';
  switch (type) {
    case 'improve': {
      const r = getRel(G, from, to);
      const d = r < 0 ? 12 : r < 50 ? 9 : 5;
      addRel(G, from, to, d); msg = `${T.plName}: stosunki poprawiają się (${fmt(d)}).`; break;
    }
    case 'insult': addRel(G, from, to, -25); msg = `${T.plName}: posłowie obrażeni, stosunki −25.`; break;
    case 'gift': {
      const amt = opts.amount ?? 50;
      if (!Number.isFinite(amt) || amt < 1 || amt > A.gold) { A.dp += cost; return {ok:false,msg:'Nieprawidłowa kwota daru.'}; }
      const d = Math.min(30, Math.round(amt / (4 + T.totalDev * 0.02)));
      A.gold -= amt; T.gold += amt; addRel(G, from, to, d);
      msg = `${T.plName} otrzymuje dar: ${amt} dukatów. Stosunki ${fmt(d)}.`; break;
    }
    case 'alliance':
      A.allies.add(to); T.allies.add(from); addRel(G, from, to, 10);
      msg = `${A.plName} i ${T.plName} zawierają sojusz.`; break;
    case 'nap':
      G.nap.set(key(from, to), G.day + 365 * 10); addRel(G, from, to, 8);
      msg = `${A.plName} i ${T.plName} podpisują pakt o nieagresji na 10 lat.`; break;
    case 'access':
      G.access.set(from + '>' + to, G.day + 365 * 5); addRel(G, from, to, 3);
      msg = `${T.plName}: zgoda na przejście wojsk (${A.plName}) przez 5 lat.`; break;
    case 'guarantee': {
      if (!G.guar.has(from)) G.guar.set(from, new Set());
      G.guar.get(from).add(to); addRel(G, from, to, 15);
      msg = `${A.plName} — gwarancja niepodległości: ${T.plName}.`; break;
    }
    case 'vassal':
      makeVassal(G, from, to);
      msg = `${T.plName} zostaje wasalem. Suweren: ${A.plName}.`; break;
    case 'annex': {
      const cost2 = annexCost(G, to);
      A.gold -= cost2;
      const n = T.provs.length;
      annexVassal(G, from, to);
      msg = `${A.plName}: aneksja wasala — ${T.plName} (${plProv(n)}, ${cost2} dukatów).`; break;
    }
  }
  if (msg) log(G, msg, me || to === G.player ? 'good' : 'info');
  G.version++;
  return { ok: true, msg };
}

function annexVassal(G, lord, v) {
  const C = G.world.countries, P = G.world.prov;
  for (const pid of [...C[v].provs]) {
    const p = P[pid];
    p.owner = lord; if (p.controller === v) p.controller = lord;
    C[lord].provs.push(pid);
  }
  C[v].provs = [];
  C[v].alive = false;
  C[lord].vassals.delete(v); C[v].overlord = null;
  for (const a of G.armies) if (a.country === v) a.country = lord;
  for (const al of C[v].allies) C[al].allies.delete(v);
  C[v].allies.clear();
  refreshCountries(G); syncFrontKnights(G);
}

export function breakAlliance(G, from, to) {
  const C = G.world.countries;
  if (!C[from].allies.has(to)) return { ok: false, msg: 'Nie jesteście sojusznikami.' };
  C[from].allies.delete(to); C[to].allies.delete(from);
  addRel(G, from, to, -30);
  log(G, `${C[from].plName} zrywa sojusz. Były sojusznik: ${C[to].plName}.`, 'bad');
  G.version++;
  return { ok: true };
}
export function cancelGuarantee(G, from, to) {
  const s = G.guar.get(from); if (!s || !s.has(to)) return { ok: false, msg: 'Brak gwarancji.' };
  s.delete(to); addRel(G, from, to, -15);
  log(G, `${G.world.countries[from].plName} wycofuje gwarancję: ${G.world.countries[to].plName}.`, 'bad');
  G.version++;
  return { ok: true };
}
export function makeVassal(G, lord, v) {
  const C = G.world.countries, T = C[v], A = C[lord];
  T.overlord = lord; A.vassals.add(v); T.vassalSince = G.day;
  for (const al of [...T.allies]) if (getRel(G, al, lord) < 0) { T.allies.delete(al); C[al].allies.delete(v); }
}

export function releaseVassal(G, lord, v) {
  const C = G.world.countries;
  if (C[v].overlord !== lord) return { ok: false, msg: 'To nie jest twój wasal.' };
  C[v].overlord = null; C[lord].vassals.delete(v);
  addRel(G, lord, v, 20);
  log(G, `${C[lord].plName} uwalnia wasala: ${C[v].plName}.`, 'info');
  G.version++;
  return { ok: true };
}

export function callToWar(G, from, ally, w) {
  const C = G.world.countries;
  const A = C[from];
  if (A.dp < COST.call) return { ok: false, msg: 'Za mało punktów dyplomacji.' };
  const side = w.att.includes(from) ? 'att' : 'def';
  const enemies = side === 'att' ? w.def : w.att;
  if (w.att.includes(ally) || w.def.includes(ally)) return { ok: false, msg: 'Już uczestniczy w tej wojnie.' };
  A.dp -= COST.call;
  const r = getRel(G, from, ally);
  const conflict = enemies.some(e => C[ally].allies.has(e) || hasNap(G, ally, e) || isVassalPair(G, ally, e) || truceLeft(G, ally, e));
  const vassal = C[ally].overlord === from;
  if (!vassal && (conflict || r < 25)) {
    addRel(G, from, ally, -5);
    return { ok: false, msg: `${C[ally].plName} odmawia${conflict ? ' — wiążą ich układy z wrogiem' : ` (wymagane stosunki +25, obecnie ${fmt(r)})`}.` };
  }
  joinWar(G, w, ally, side);
  return { ok: true, msg: `${C[ally].plName} przystępuje do wojny po twojej stronie.` };
}

export function joinWar(G, w, cid, side) {
  const C = G.world.countries;
  if (w.att.includes(cid) || w.def.includes(cid)) return;
  w[side].push(cid);
  C[cid].wars.push(w);
  w.score[cid] = w.score[cid] || 0;
  for (const v of C[cid].vassals) if (!w.att.includes(v) && !w.def.includes(v)) { w[side].push(v); C[v].wars.push(w); }
  log(G, `${C[cid].plName} przystępuje do wojny (strona: ${C[side === 'att' ? w.lead.a : w.lead.d].plName}).`, 'war');
  G.version++;
}

export function warJoiners(G, attacker, defender) {
  const C = G.world.countries;
  const att = [attacker], def = [defender], calls = [];
  const blocked = (cid, enemy) =>
    cid === enemy ||
    C[cid].allies.has(enemy) ||
    hasNap(G, cid, enemy) ||
    isVassalPair(G, cid, enemy) ||
    truceLeft(G, cid, enemy) > 0 ||
    !C[cid].provs.length;
  const tryAdd = (cid, side, prob) => {
    const list = side === 'def' ? def : att, other = side === 'def' ? att : def;
    const enemy = side === 'def' ? attacker : defender;
    if (list.includes(cid) || other.includes(cid) || blocked(cid, enemy)) return;
    if (cid === G.player) { if (!calls.some(c => c.cid === cid)) calls.push({ cid, side }); return; }
    if (Math.random() < prob) list.push(cid);
  };
  const D = C[defender], A = C[attacker];
  if (D.overlord != null) tryAdd(D.overlord, 'def', 1);
  for (const v of D.vassals) tryAdd(v, 'def', 1);
  for (const al of D.allies) tryAdd(al, 'def', 0.45 + Math.max(0, getRel(G, al, defender)) / 200);
  for (const g of guarantorsOf(G, defender)) tryAdd(g, 'def', 0.75);
  for (const v of A.vassals) tryAdd(v, 'att', 1);
  for (const al of A.allies) tryAdd(al, 'att', 0.25 + Math.max(0, getRel(G, al, attacker)) / 250);
  for (const side of ['att', 'def']) for (const cid of [...(side === 'att' ? att : def)]) for (const v of C[cid].vassals) tryAdd(v, side, 1);
  return { att, def, calls };
}

// ---------- miesięczny cykl: punkty, dryf stosunków, AI ----------
export function diploMonthly(G) {
  const C = G.world.countries, n = C.length;
  for (const c of C) if (c && c.provs.length) c.dp = Math.min(DP_MAX, c.dp + 1.5 + (c.totalDev > 400 ? 0.3 : 0));
  const nb = neighborsAll(G);
  for (let a = 1; a < n; a++) {
    const ca = C[a]; if (!ca || !ca.provs.length) continue;
    for (let b = a + 1; b < n; b++) {
      const cb = C[b]; if (!cb || !cb.provs.length) continue;
      let target = nb[a].has(b) ? -20 : 0;
      if (ca.allies.has(b)) target = 45;
      else if (isVassalPair(G, a, b)) target = 35;
      else if (hasNap(G, a, b)) target = 15;
      if (atWar(G, a, b)) target = -80;
      const r = getRel(G, a, b);
      const rate = atWar(G, a, b) ? 2.5 : 0.6;
      if (Math.abs(r - target) > 0.01) setRel(G, a, b, r + Math.sign(target - r) * Math.min(rate, Math.abs(target - r)));
    }
  }
  for (const c of C) if (c && c.overlord != null && c.provs.length) {
    const t = Math.max(0, (c.income || 0) * 0.15);
    c.gold -= t; C[c.overlord].gold += t;
  }
  for (const [k, end] of G.nap) if (end <= G.day) G.nap.delete(k);
  for (const [k, end] of G.access) if (end <= G.day) G.access.delete(k);
  G.offers = G.offers.filter(o => o.expires > G.day && (o.type !== 'call' || G.wars.includes(o.war)) && (o.type !== 'peace' || G.wars.includes(o.war)));
  aiDiplomacy(G);
  G.version++;
}

function aiDiplomacy(G) {
  const C = G.world.countries;
  const nb = neighborsAll(G);
  let warsNow = G.wars.length;
  for (const c of C) {
    if (!c || !c.ai || !c.provs.length) continue;
    const me = c.id;
    const ns = [...nb[me]].filter(o => C[o] && C[o].provs.length);
    const rival = ns.filter(o => !c.allies.has(o) && !hasNap(G, me, o) && !isVassalPair(G, me, o) && getRel(G, me, o) < 10)
      .sort((x, y) => power(G, x) - power(G, y))[0];
    if (rival != null && c.dp >= 2 && Math.random() < 0.18 && power(G, me) > power(G, rival) * 1.2) { c.dp -= 1; addRel(G, me, rival, -12); }
    if (c.dp >= 3 && Math.random() < 0.3) {
      const pool = [...c.allies, ...ns.filter(o => getRel(G, me, o) >= 0 || power(G, o) > power(G, me) * 1.5)];
      const t = pool[Math.floor(Math.random() * pool.length)];
      if (t != null && t !== me && t !== rival && !atWar(G, me, t)) { c.dp -= 1; addRel(G, me, t, 6); }
    }
    if (c.dp >= 4 && c.allies.size < 2 && c.overlord == null && Math.random() < 0.08) {
      const cand = [...ns, ...[...ns].flatMap(o => [...nb[o]])].filter(o => o !== me && o !== G.player && C[o] && C[o].provs.length && !c.allies.has(o) && C[o].overlord == null);
      const t = cand.sort((x, y) => getRel(G, me, y) - getRel(G, me, x))[0];
      if (t != null && C[t].allies.size < 3 && getRel(G, me, t) >= 50 && evaluate(G, me, t, 'alliance').ok && evaluate(G, t, me, 'alliance').ok) diploAction(G, me, t, 'alliance');
    }
    if (c.dp >= 4 && Math.random() < 0.06) {
      const t = ns.filter(o => o !== G.player && !hasNap(G, me, o) && !c.allies.has(o) && power(G, o) > power(G, me) * 1.3 && getRel(G, me, o) >= 5)[0];
      if (t != null) diploAction(G, me, t, 'nap');
    }
    for (const al of [...c.allies]) if (al !== G.player && getRel(G, me, al) < 0 && Math.random() < 0.2) breakAlliance(G, me, al);
    if (c.allies.has(G.player) && getRel(G, me, G.player) < -10 && Math.random() < 0.25) breakAlliance(G, me, G.player);

    const pr = getRel(G, me, G.player);
    const pending = type => G.offers.some(o => o.from === me && o.type === type);
    if (!atWar(G, me, G.player) && c.overlord == null) {
      if (pr >= 45 && !c.allies.has(G.player) && c.allies.size < 3 && c.dp >= 2 && !pending('alliance') && Math.random() < 0.05)
        offer(G, 'alliance', me, `${c.plName} proponuje sojusz obronny.`);
      else if (pr >= 0 && !hasNap(G, me, G.player) && !c.allies.has(G.player) && isNeighbor(G, me, G.player) && power(G, G.player) > power(G, me) * 1.2 && !pending('nap') && Math.random() < 0.05)
        offer(G, 'nap', me, `${c.plName} proponuje pakt o nieagresji na 10 lat.`);
      else if (pr >= 20 && c.wars.length && !pending('access') && isNeighbor(G, me, G.player) && !c.allies.has(G.player) && !hasAccess(G, me, G.player) && Math.random() < 0.03)
        offer(G, 'access', me, `${c.plName} prosi o prawo przejścia wojsk przez twoje ziemie.`);
    }

    if (c.overlord == null && !c.wars.length && c.exhaustion < 2 && c.gold > 60 && warsNow < 7 && Math.random() < 0.08) {
      const targets = ns.filter(o => {
        if (atWar(G, me, o) || c.allies.has(o) || hasNap(G, me, o) || isVassalPair(G, me, o) || truceLeft(G, me, o)) return false;
        if (getRel(G, me, o) > -25) return false;
        return blocPower(G, me, o) > blocPower(G, o, me) * 1.5;
      });
      if (targets.length) {
        const t = targets.sort((x, y) => getRel(G, me, x) - getRel(G, me, y))[0];
        if (declareWar(G, me, t, 'wrogie stosunki')) warsNow++;
      }
    }
  }
}

function offer(G, type, from, text, extra = {}) {
  G.offers.push({ id: G.nextOffer++, type, from, text, day: G.day, expires: G.day + (type === 'call' || type === 'peace' ? 90 : 150), ...extra });
  log(G, text, type === 'call' ? 'war' : 'info');
  if ((type === 'call' || type === 'peace') && G.speed) { G.pausedFor = G.speed; G.speed = 0; }
}
export function pushCallOffer(G, w, side) {
  const lead = side === 'att' ? w.lead.a : w.lead.d;
  const enemy = side === 'att' ? w.lead.d : w.lead.a;
  const C = G.world.countries;
  offer(G, 'call', lead, `${C[lead].plName} wzywa cię do wojny. Wróg: ${C[enemy].plName}.`, { war: w, side });
}
export function pushPeaceOffer(G, w, from) {
  if (G.offers.some(o => o.type === 'peace' && o.war === w)) return;
  offer(G, 'peace', from, `${G.world.countries[from].plName} proponuje biały pokój.`, { war: w });
}

export function answerOffer(G, id, accept) {
  const i = G.offers.findIndex(o => o.id === id); if (i < 0) return null;
  const o = G.offers[i]; G.offers.splice(i, 1);
  const C = G.world.countries, me = G.player, F = C[o.from];
  if (!accept) {
    if (o.type === 'call') {
      if (C[me].allies.has(o.from)) breakAlliance(G, me, o.from); else addRel(G, me, o.from, -20);
      return `${F.plName}: wezwanie odrzucone.`;
    }
    addRel(G, me, o.from, -5);
    return `${F.plName}: propozycja odrzucona.`;
  }
  switch (o.type) {
    case 'alliance':
      if (atWar(G, me, o.from)) return 'Nieaktualne.';
      C[me].allies.add(o.from); F.allies.add(me); addRel(G, me, o.from, 10);
      log(G, `Sojusz zawarty: ${F.plName}.`, 'good'); break;
    case 'nap':
      G.nap.set(key(me, o.from), G.day + 365 * 10); addRel(G, me, o.from, 8);
      log(G, `Pakt o nieagresji (10 lat): ${F.plName}.`, 'good'); break;
    case 'access':
      G.access.set(o.from + '>' + me, G.day + 365 * 5); addRel(G, me, o.from, 5);
      log(G, `Prawo przejścia wojsk (5 lat) udzielone: ${F.plName}.`, 'good'); break;
    case 'call':
      if (!G.wars.includes(o.war)) return 'Ta wojna już się skończyła.';
      joinWar(G, o.war, me, o.side); addRel(G, me, o.from, 10); break;
    case 'peace':
      if (!G.wars.includes(o.war)) return 'Ta wojna już się skończyła.';
      makePeace(G, o.war, {}); log(G, `Biały pokój: ${F.plName}.`, 'peace'); break;
  }
  G.version++;
  return null;
}

export function separatePeace(G, w, cid, cede, gold) {
  const C = G.world.countries, P = G.world.prov;
  const side = w.att.includes(cid) ? 'att' : 'def';
  const leaving = [cid, ...[...C[cid].vassals].filter(v => w[side].includes(v))];
  const enemies = side === 'att' ? w.def : w.att;
  for (const [pid, to] of Object.entries(cede || {})) {
    const p = P[+pid]; const from = p.owner;
    p.owner = to; p.controller = to; p.siege = null; p.cores.delete(from);
    C[from].provs = C[from].provs.filter(x => x !== +pid); C[to].provs.push(+pid);
    log(G, `${p.name} przechodzi z rąk ${C[from].plName} do ${C[to].plName}.`, 'peace');
  }
  if (gold && gold.amount > 0) {
    const amt = Math.max(0, Math.min(gold.amount, Math.floor(C[gold.from].gold)));
    C[gold.from].gold -= amt; C[gold.to].gold += amt;
  }
  const end = G.day + 365 * 5;
  for (const a of leaving) for (const b of enemies) { G.truces[a].set(b, end); G.truces[b].set(a, end); }
  w[side] = w[side].filter(x => !leaving.includes(x));
  for (const a of leaving) C[a].wars = C[a].wars.filter(x => x !== w);
  for (let id = 1; id < P.length; id++) {
    const p = P[id]; if (!p) continue;
    if (leaving.includes(p.controller) && enemies.includes(p.owner)) { p.controller = p.owner; p.siege = null; }
    if (leaving.includes(p.owner) && enemies.includes(p.controller)) { p.controller = p.owner; p.siege = null; }
  }
  for (const a of G.armies) {
    if (!leaving.includes(a.country)) continue;
    const p = P[a.prov];
    if (enemies.includes(p.owner)) { const home = C[a.country].provs[0]; if (home) { a.prov = home; a.path = null; } }
  }
  refreshCountries(G);
  for (const a of G.armies) {
    if (a.path?.some(id=>!canPass(G,a.country,id))) {a.path=null;a.orderQueue=[];a.moveLeft=0;a.moveTotal=0;}
    if (!canPass(G,a.country,a.prov)) {const home=C[a.country].provs.find(id=>P[id].controller===a.country);if(home)a.prov=home;else a.dead=true;}
    a.fighting=false;a.pinned=false;
  }
  G.battles.clear();syncFrontKnights(G);G.version++;
}

export function aiWarsResolve(G) {
  const C = G.world.countries, P = G.world.prov;
  for (const w of [...G.wars]) {
    if (w.lead.a === G.player || w.lead.d === G.player) continue;
    const yrs = (G.day - w.start) / 365;
    if (yrs < 1) continue;
    const sa = warScore(G,w,w.lead.a), sd = warScore(G,w,w.lead.d);
    const A = C[w.lead.a], D = C[w.lead.d];
    const leadAlive = A.provs.length && D.provs.length;
    let winner = null;
    if (sa - sd > 35 && (D.exhaustion > 3 || yrs > 2)) winner = 'a';
    else if (sd - sa > 35 && (A.exhaustion > 3 || yrs > 2)) winner = 'd';
    if (winner || yrs > 4 || !leadAlive || (A.exhaustion > 8 && D.exhaustion > 8)) {
      const cede = {};
      if (winner) {
        const wc = winner === 'a' ? w.lead.a : w.lead.d;
        const loserSide = winner === 'a' ? w.def : w.att;
        let budget = Math.abs(sa - sd) * 0.9;
        const occ = [];
        for (const l of loserSide) for (const pid of C[l].provs) if (P[pid].controller === wc) occ.push(pid);
        occ.sort((x, y) => provCost(G, w, x, wc) - provCost(G, w, y, wc));
        for (const pid of occ) { const c = provCost(G, w, pid, wc); if (c <= budget) { cede[pid] = wc; budget -= c; } }
      }
      const names = `${A.plName} i ${D.plName}`;
      makePeace(G, w, { cede });
      const n = Object.keys(cede).length;
      log(G, `${names} zawierają pokój${n ? ` — zmiana właściciela: ${plProv(n)}` : ' (status quo)'}.`, 'peace');
    }
  }
}
