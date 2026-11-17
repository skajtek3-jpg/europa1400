// UI: panele, modale, interakcje (mikro-zarządzanie + dyplomacja w lewym panelu Age of History 2 + widoczność armii)
import {
  dateOf, atWar, sameSide, warScore, peaceBudget, stepLinkDays, demandable, provCost, vassalCost, canVassalize,
  playerMoveArmy, playerIssueOrder, playerHaltArmies,
  playerSplitArmy, playerUndoSplit, playerMergeArmies,
  canSplit, MIN_SPLIT, playerRecruit, playerDeclareWar, playerPeaceDemand,
  acceptWhitePeace, countryArmies, SPEEDS, log,
  BUILDINGS, bl, recruitQuote, recruitMaxSize, playerBuild, buildInfo, MP_MAX
} from './game.mjs';
import {
  getRel, hasNap, hasAccess, guarantees, guarantorsOf, isNeighbor,
  truceLeft, evaluate, diploAction, breakAlliance, cancelGuarantee,
  releaseVassal, callToWar, answerOffer, annexCost, power, COST, DP_MAX
} from './diplo.mjs';
import { DIPLO_COLORS } from './render.mjs';

const INSTR = {
  'Zakon Krzyżacki': 'Zakonem Krzyżackim',
  'Polska i Litwa': 'Polską i Litwą',
  'Święte Cesarstwo Rzymskie': 'Świętym Cesarstwem Rzymskim',
  'Królestwo Węgier': 'Królestwem Węgier',
  Francja: 'Francją',
  Anglia: 'Anglią',
  Szkocja: 'Szkocją',
  'Unia Kalmarska': 'Unią Kalmarską',
  Kastylia: 'Kastylią',
  Aragonia: 'Aragonią',
  Nawarra: 'Nawarrą',
  Portugalia: 'Portugalią',
  'Emirat Grenady': 'Emiratem Grenady',
  'Państwo Kościelne': 'Państwem Kościelnym',
  Wenecja: 'Wenecją',
  'Neapol i Sycylia': 'Neapolem i Sycylią',
  Sardynia: 'Sardynią',
  Korsyka: 'Korsyką',
  Cypr: 'Cyprem',
  Bośnia: 'Bośnią',
  'Cesarstwo Bizantyjskie': 'Cesarstwem Bizantyjskim',
  'Imperium Osmańskie': 'Imperium Osmańskim',
  'Carstwo Bułgarskie': 'Carstwem Bułgarskim',
  Wołoszczyzna: 'Wołoszczyzną',
  Mołdawia: 'Mołdawią',
  'Republika Nowogrodzka': 'Republiką Nowogrodzką',
  'Złota Orda': 'Złotą Ordą',
  'Biała Orda': 'Białą Ordą',
  'Sułtanat Seldżucki': 'Sułtanatem Seldżuckim',
  'Bejlik Aydin': 'Bejlikiem Aydin',
  'Cesarstwo Trapezuntu': 'Cesarstwem Trapezuntu',
  Gruzja: 'Gruzją',
  'Sułtanat Mameluków': 'Sułtanatem Mameluków',
  'Kalifat Hafsydów': 'Kalifatem Hafsydów',
  Maroko: 'Marokiem',
  Sámi: 'Sámi',
  'Imperium Timurydów': 'Imperium Timurydów',
  'Syberia (plemiona)': 'Syberią (plemionami)',
  Bretania: 'Bretanią',
};
const instr = n => INSTR[n] || n;

/**
 * Widoczność armii gracza:
 * - własne jednostki są zawsze widoczne,
 * - jednostki sojuszników (sojusze / senior / wasal) są zawsze widoczne,
 * - jednostki wrogów i innych krajów są widoczne tylko przy froncie:
 *   1) w prowincji kontrolowanej przez gracza,
 *   2) w aktywnej bitwie z udziałem gracza,
 *   3) w prowincji sąsiadującej bezpośrednio z prowincją gracza lub z armią gracza.
 */
export function canSeeArmy(G, world, army) {
  if (!army || army.dead) return false;
  if (army.country === G.player) return true;

  const me = world?.countries?.[G.player];
  const other = world?.countries?.[army.country];
  if (!me || !other) return false;

  const isAlly =
    (me.allies && me.allies.has(army.country)) ||
    (other.allies && other.allies.has(G.player)) ||
    other.overlord === G.player ||
    me.overlord === army.country;
  if (isAlly && !atWar(G,G.player,army.country)) return true;

  const pid = army.prov;
  const prov = world?.prov?.[pid];
  if (!prov) return false;
  // Wieża Obserwacyjna sąsiednich prowincji widzi armie, chyba że są schowane w Twierdzy tego kraju
  const zamekHides = prov.controller === army.country && bl(prov, 'zamek') > 0;
  if (!zamekHides && prov.adj && prov.adj.some(q => world.prov[q] && world.prov[q].controller === G.player && bl(world.prov[q], 'watch') > 0)) return true;

  if (prov.controller === G.player) return true;
  if (G.battles && [...G.battles.values()].some(b => b.pid === pid && (b.s1 === G.player || b.s2 === G.player))) {
    return true;
  }

  const myArmies = countryArmies(G, G.player).filter(a => !a.dead);
  const myArmyProvs = new Set(myArmies.map(a => a.prov));
  if (myArmyProvs.has(pid)) return true;

  const neighbors = (prov.links || []).map(l => l.to);
  for (const nid of neighbors) {
    const np = world.prov[nid];
    if (!np) continue;
    if (np.controller === G.player) return true;
    if (myArmyProvs.has(nid)) return true;
  }

  return false;
}

export function buildStartScreen(world, R, onStart) {
  const majors = [
    'Poland', 'Lithuania', 'Teutonic Order', 'France', 'Holy Roman Empire',
    'Hungary', 'Ottomans', 'Byzantium', 'Castile', 'Aragon',
    'Venice', 'Novgorod', 'Kalmar Union', 'Papal States', 'Moldavia',
    'Golden Horde', 'England', 'Scotland', 'Portugal', 'Bohemia',
    'Austria', 'Burgundy', 'Muscovy'
  ];
  const known = new Set(majors);
  const rest = world.countries
    .filter(c => c && c.provs.length && !known.has(c.name))
    .map(c => c.name);
  const all = [
    ...majors.filter(n => world.countries.some(c => c && c.name === n)),
    ...rest
  ];
  const el = document.getElementById('start-countries');
  if (!el) return;
  el.innerHTML = all.map(n => {
    const c = world.countries.find(x => x && x.name === n);
    return `<button class="start-country" data-id="${c.id}">
      <span class="flag big" style="background:${c.color}"></span>
      <span class="sc-name">${c.plName}</span>
      <span class="sc-meta">${c.provs.length} prowincji</span>
    </button>`;
  }).join('');

  el.querySelectorAll('.start-country').forEach(b => {
    b.onclick = () => {
      const id = +b.dataset.id;
      document.getElementById('start-screen').classList.add('hidden');
      document.getElementById('topbar').classList.remove('hidden');
      onStart(id);
      const cap = world.prov[world.countries[id].capital];
      if (cap) {
        R.cam.x = cap.cx;
        R.cam.y = cap.cy;
        R.cam.zoom = 2.6;
      }
    };
  });
}

export function initUI(G, R, world, { onRestart } = {}) {
  const $ = s => document.querySelector(s);
  const topbar = $('#topbar');
  const warbar = $('#warbar');
  const side = $('#sidepanel');
  const logEl = $('#log');
  const tip = $('#tooltip');
  const cv = R.canvas;
  let modalOpen = false;
  let resumeSpeed = null;
  let aohDiploTarget = null;
  let aohDiploMsg = '';
  let aohDiploMsgOk = true;
  let aohCountrySearch = '';

  if (!Array.isArray(R.selectedArmies)) R.selectedArmies = [];
  R.canSeeArmy = army => canSeeArmy(G, world, army);

  function syncSelectedArmies() {
    R.selectedArmies = R.selectedArmies.filter(a => a && !a.dead && a.country === G.player);
    if (R.selectedArmy && (R.selectedArmy.dead || R.selectedArmy.country !== G.player)) {
      R.selectedArmy = R.selectedArmies[0] || null;
    } else if (!R.selectedArmy && R.selectedArmies.length) {
      R.selectedArmy = R.selectedArmies[0];
    } else if (R.selectedArmy && !R.selectedArmies.includes(R.selectedArmy)) {
      R.selectedArmies.unshift(R.selectedArmy);
    }
  }

  function setSelectedArmies(list, primary = null) {
    const clean = (list || []).filter(a => a && !a.dead && a.country === G.player);
    const unique = [...new Set(clean)];
    R.selectedArmies = unique;
    R.selectedArmy = (primary && unique.includes(primary)) ? primary : (unique[0] || null);
    if (R.selectedArmy) R.selected = R.selectedArmy.prov;
    R.pendingSplit = null;
    R.drawHighlight(G);
    refreshAll();
  }

  function toggleSelectedArmy(a) {
    if (!a || a.dead || a.country !== G.player) return;
    syncSelectedArmies();
    const exists = R.selectedArmies.includes(a);
    if (exists) {
      const next = R.selectedArmies.filter(x => x !== a);
      setSelectedArmies(next, next[0] || null);
    } else {
      setSelectedArmies([...R.selectedArmies, a], a);
    }
  }

  function activeArmies() {
    syncSelectedArmies();
    return R.selectedArmies.length ? R.selectedArmies : (R.selectedArmy ? [R.selectedArmy] : []);
  }

  const speedBtns = [];
  const tbSpeed = $('#tb-speed');
  if (tbSpeed) {
    tbSpeed.innerHTML = '';
    for (let i = 0; i <= 5; i++) {
      const b = document.createElement('button');
      b.className = 'btn btn-sp' + (i === 0 ? ' sp-pause' : '');
      b.textContent = i === 0 ? '❙❙' : String(i);
      b.title = i === 0 ? 'Pauza (spacja)' : `Tempo ${i}`;
      b.onclick = () => { G.speed = i; refreshTop(); };
      tbSpeed.appendChild(b);
      speedBtns.push(b);
    }
  }

  let armyBar = $('#hoi-army-bar');
  if (!armyBar && topbar) {
    armyBar = document.createElement('div');
    armyBar.id = 'hoi-army-bar';
    armyBar.className = 'hoi-armies';
    document.getElementById('hud').appendChild(armyBar);
  }

  // Pasek prowincji (dolny lewy): Przenieś · Rekrutuj · Więcej · Przenieś do. Pokazuje się po kliknięciu własnej prowincji.
  let provTab = null;   // null | 'recruit' | 'more'
  function setProvTab(t) { provTab = t; refreshAll(); }
  function refreshProvBar() {
    let bar = document.getElementById('prov-bar');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'prov-bar';
      document.getElementById('hud').appendChild(bar);
      bar.addEventListener('click', e => {
        const b = e.target.closest && e.target.closest('[data-pb]');
        if (!b || b.disabled) return;
        const pid = R.selected, p = world.prov[pid], c = world.countries[G.player];
        if (!p || p.owner !== G.player) return;
        if (b.dataset.pb === 'move') {
          const here = countryArmies(G, G.player).filter(a => !a.dead && a.prov === pid);
          if (here.length) setSelectedArmies(here, here[0]); else log(G, 'Brak twoich armii w tej prowincji.', 'bad');
          refreshAll();
        } else if (b.dataset.pb === 'recruit') setProvTab(provTab === 'recruit' ? null : 'recruit');
        else if (b.dataset.pb === 'more') setProvTab(provTab === 'more' ? null : 'more');
        else if (b.dataset.pb === 'capital') {
          if (c.capital === pid) return;
          if (c.gold < 500) { log(G, 'Za mało złota na przeniesienie stolicy (500 dukatów).', 'bad'); refreshLog(); return; }
          c.gold -= 500; c.capital = pid;
          log(G, `Stolica przeniesiona do ${p.name} (500 dukatów).`);
          refreshAll();
        }
      });
    }
    const pid = R.selected, p = world.prov[pid], c = world.countries[G.player];
    const own = !!p && p.owner === G.player && p.controller === G.player && !!c;
    bar.style.display = own ? 'flex' : 'none';
    if (!own) return;
    const cap = c.capital === pid;
    bar.innerHTML = `
      <button class="pb-btn" data-pb="move" data-tip="Zaznacza twoje armie w tej prowincji. Potem prawym kliknięciem wyślij je na inną prowincję.">Przenieś</button>
      <button class="pb-btn ${provTab === 'recruit' ? 'on' : ''}" data-pb="recruit" data-tip="Otwiera rekrutację: suwak liczby ludzi, koszt i czas.">Rekrutuj</button>
      <button class="pb-btn ${provTab === 'more' ? 'on' : ''}" data-pb="more" data-tip="Otwiera listę budynków tej prowincji.">Więcej</button>
      <button class="pb-btn" data-pb="capital" ${cap ? 'disabled' : ''} data-tip="${cap ? 'To już jest stolica.' : 'Przenosi stolicę do tej prowincji. Koszt: 500 dukatów.'}">Przenieś do</button>`;
  }

  function refreshArmyBar() {
    if (!armyBar) return;
    syncSelectedArmies();
    const list = countryArmies(G, G.player).filter(a => !a.dead && canSeeArmy(G, world, a));
    const c = world.countries[G.player];
    armyBar.innerHTML = list.map((a, idx) => {
      const sel = R.selectedArmies.includes(a);
      const hpPct = Math.max(0, Math.min(100, Math.round((a.size / Math.max(1, a.maxSize || a.size)) * 100)));
      const morPct = Math.max(0, Math.min(100, Math.round((a.morale ?? 1) * 100)));
      const pName = world.prov[a.prov]?.name || '';
      const qLen = a.orderQueue ? a.orderQueue.length : 0;
      const status = a.recruitDays > 0
        ? `mobilizacja ${a.recruitDays}d`
        : a.pinned
          ? 'walka'
          : a.supportAttack
            ? 'wsparcie ataku'
            : a.path
              ? `marsz${qLen ? ` (+${qLen})` : ''}`
              : 'postoju';
      return `<button type="button" class="hoi-unit-card${sel ? ' sel' : ''}" data-army-id="${a.id}" title="Armia #${idx + 1} · ${pName} (${Math.round(a.size)} ludzi, ${status})">
        <span class="flag" style="background:${c?.color || '#888'}"></span>
        <span class="hoi-unit-num">${idx + 1}</span>
        <span class="hoi-unit-bars">
          <span class="hoi-bar hp"><i style="width:${hpPct}%"></i></span>
          <span class="hoi-bar mor"><i style="width:${morPct}%"></i></span>
        </span>
        <b class="hoi-unit-size">${Math.round(a.size)}</b>
      </button>`;
    }).join('');
  }

  armyBar?.addEventListener('click', e => {
    const btn = e.target.closest('[data-army-id]');
    if (!btn) return;
    const a = G.armies.find(x => x.id === +btn.dataset.armyId && !x.dead && x.country === G.player);
    if (!a) return;
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      toggleSelectedArmy(a);
    } else {
      setSelectedArmies([a], a);
    }
  });

  $('#btn-diplo')?.addEventListener('click', () => {
    const pid = R.selected;
    const p = pid && world.prov[pid];
    aohDiploTarget = (p && p.owner !== G.player) ? p.owner : null;
    aohDiploMsg = '';
    R.diploCountry = aohDiploTarget;
    if (!R.selected && world.countries[G.player]?.capital) {
      R.selected = world.countries[G.player].capital;
    }
    refreshAll();
  });
  $('#btn-mapmode')?.addEventListener('click', () => {
    const modes=['political','terrain','diplo'];
    const next=modes[(modes.indexOf(R.mapMode)+1)%modes.length];
    R.setMapMode(next);
    const btn = $('#btn-mapmode');
    if (btn) btn.textContent = ({political:'Mapa: polityczna',terrain:'Mapa: terenowa',diplo:'Mapa: dyplomatyczna'})[next];
    const leg = $('#legend');
    if (leg) {
      leg.classList.toggle('hidden', next !== 'diplo');
      if (next === 'diplo' && DIPLO_COLORS) {
        leg.innerHTML = Object.entries(DIPLO_COLORS)
          .map(([k, col]) => `<div><i style="background:rgb(${col.join(',')})"></i>${k}</div>`)
          .join('');
      }
    }
  });
  $('#btn-peace')?.addEventListener('click', () => openPeace());
  $('#btn-help')?.addEventListener('click', () => openHelp());
  $('#btn-sound')?.addEventListener('click', () => {
    const on = G.sound && G.sound.toggle();
    if ($('#btn-sound')) $('#btn-sound').style.opacity = on ? 1 : 0.45;
  });

  function fmtRel(v) { v = Math.round(v); return (v > 0 ? '+' : '') + v; }
  function relCls(v) { return v >= 40 ? 'rel-good' : v <= -25 ? 'rel-bad' : 'rel-mid'; }
  function relWord(v) {
    return v >= 75 ? 'przyjacielskie' : v >= 40 ? 'dobre' : v >= 10 ? 'poprawne'
      : v > -10 ? 'neutralne' : v > -40 ? 'chłodne' : v > -75 ? 'wrogie' : 'nienawiść';
  }
  const flag = c => `<span class="flag" style="background:${c.color}"></span>`;

  function require_terrain(t) {
    return {
      plain: { name: 'Równina' },
      hills: { name: 'Wzgórza' },
      forest: { name: 'Lasy' },
      mountain: { name: 'Góry' },
      marsh: { name: 'Bagna' },
    }[t] || { name: t };
  }

  function refreshTop() {
    const c = world.countries[G.player];
    if (!c) return;
    $('#tb-country').innerHTML = `${flag(c)}<b>${c.plName}</b>`;
    const d = dateOf(G.day);
    $('#tb-date').innerHTML = `<span class="date">${d.str}</span>`;
    speedBtns.forEach((b, i) => b.classList.toggle('active', G.speed === i));
    const dp = typeof c.dp === 'number' ? c.dp : 0;
    $('#tb-economy').innerHTML = `
      <span class="res" title="Skarbiec (dukaty)">⚜ <b>${Math.floor(c.gold)}</b> <i>(${c.income >= 0 ? '+' : ''}${c.income ? c.income.toFixed(1) : '0'}/mies.)</i></span>
      <span class="res" title="Rekruci">⚔ <b>${Math.floor(c.manpower)}</b><i>/${c.manpowerMax}</i></span>
      <span class="res" title="Armie">🏳 <b>${Math.round(countryArmies(G, G.player).reduce((s, a) => s + a.size, 0))}</b></span>
      <span class="res" title="Punkty dyplomacji (+1,5 na miesiąc, maks. ${DP_MAX || 10})">✉ <b>${dp.toFixed(1)}</b><i>/${DP_MAX || 10}</i></span>`;
  }

  function refreshWarbar() {
    const myWars = world.countries[G.player].wars;
    const btnPeace = $('#btn-peace');
    if (btnPeace) btnPeace.style.display = myWars.length ? '' : 'none';
    if (!myWars.length) { warbar.classList.add('hidden'); return; }
    warbar.classList.remove('hidden');
    const w = myWars[0];
    const enemy = w.att.includes(G.player) ? w.lead.d : w.lead.a;
    const my = Math.round(warScore(G, w, G.player));
    const their = Math.round(warScore(G, w, enemy));
    const yv = (G.day - w.start) / 365;
    const years = yv.toFixed(1);
    if (!warbar.querySelector('#wb-peace')) {
      warbar.innerHTML = `
      <div class="wb-main">
        <b class="wb-title"></b> <span class="wb-years"></span>
        <div class="wsbar"><div class="wsbar-fill"></div><span class="wb-score"></span></div>
        <span class="wb-sub"></span>
        <button class="btn btn-gold" id="wb-peace">Negocjuj pokój</button>
      </div>`;
      warbar.querySelector('#wb-peace').addEventListener('click', () => openPeace());
    }
    const setT = (sel, t) => { const e = warbar.querySelector(sel); if (e && e.textContent !== t) e.textContent = t; };
    setT('.wb-title', `Wojna z ${instr(world.countries[enemy].plName)}`);
    setT('.wb-years', `(${years} ${yv < 2 ? 'roku' : 'lat'})`);
    setT('.wb-score', `${my > 0 ? '+' : ''}${my}`);
    setT('.wb-sub', `twoje punkty: ${my} · przeciwnika: ${their} · wyczerpanie wroga: ${world.countries[enemy].exhaustion.toFixed(1)}`);
    const fill = warbar.querySelector('.wsbar-fill');
    if (fill) {
      fill.className = 'wsbar-fill ' + (my >= 0 ? 'pos' : 'neg');
      fill.style.width = `${Math.max(0, Math.min(100, (my + 100) / 2))}%`;
    }
  }

  // Wiersze relacji jak w Age of History 2: 🔥 wojny, ⚔ wrogowie, ❤ sojusznicy, 👑 wasale, 🤝 pakty i przyjaciele.
  // Najazd myszą na flagę: kategoria, nazwa, ich opinia oraz twoja opinia o tym państwie.
  function diploRows(cid, attr = 'data-select-country') {
    const C = world.countries, c = C[cid];
    if (!c) return '';
    const uniq = a => [...new Set(a)].filter(id => id !== cid && C[id] && C[id].alive);
    const napWith = [...G.nap].filter(([k, end]) => end > G.day && k.split(':').map(Number).includes(cid)).map(([k]) => k.split(':').map(Number).find(x => x !== cid));
    const wars = uniq(c.wars.flatMap(w => w.att.includes(cid) ? w.def : w.att));
    const foes = uniq(C.filter(Boolean).map(o => o.id)).filter(id => getRel(G, cid, id) <= -25).sort((a, b) => getRel(G, cid, a) - getRel(G, cid, b)).slice(0, 8);
    const allies = uniq([...c.allies]);
    const lords = uniq([...(c.overlord != null ? [c.overlord] : []), ...c.vassals]);
    const friends = uniq([...napWith, ...C.filter(Boolean).map(o => o.id).filter(id => getRel(G, cid, id) >= 40)]).filter(id => !c.allies.has(id) && !wars.includes(id)).slice(0, 10);
    const chip = (id, title) => {
      const o = C[id], theirs = Math.round(getRel(G, cid, id)), mine = Math.round(getRel(G, G.player, id));
      const tip = `${title} · ${o.plName}: ${fmtRel(theirs)}` + (cid !== G.player && id !== G.player ? ` · twoja opinia: ${fmtRel(mine)}` : '');
      return `<span class="rf" ${attr}="${id}" data-tip="${tip}"><span class="flag" style="background:${o.color}"></span></span>`;
    };
    const rows = [
      ['🔥', 'Na wojnie z', wars.map(id => chip(id, 'Na wojnie z'))],
      ['⚔', 'Wrogowie', foes.map(id => chip(id, 'Wróg'))],
      ['❤', 'Sojusznicy', allies.map(id => chip(id, 'Sojusznik'))],
      ['👑', 'Wasalizacja', lords.map(id => chip(id, c.overlord === id ? 'Suweren' : 'Wasal'))],
      ['🤝', 'Pakty i przyjaciele', friends.map(id => chip(id, 'Pakt / przyjaciel'))],
    ].filter(r => r[2].length);
    const rel = Math.round(getRel(G, cid, G.player)), mineRel = Math.round(getRel(G, G.player, cid));
    const head = cid === G.player ? '<span class="dr-op">Ty</span>'
      : atWar(G, G.player, cid) ? '<span class="dr-war">🔥 W stanie wojny!</span>'
      : `<span class="dr-op ${relCls(rel)}" data-tip="Opinia o tobie: ${fmtRel(rel)} · twoja opinia o nich: ${fmtRel(mineRel)}">🤝 ${fmtRel(rel)}</span>`;
    return `<div class="dr-box"><div class="dr-head">${flag(c)}<b>${c.plName}</b>${head}</div>` +
      (rows.length ? rows.map(([ico, t, chips]) => `<div class="dr-row"><span class="dr-ico" data-tip="${t}">${ico}</span><span class="dr-chips">${chips.join('')}</span></div>`).join('') : '<div class="dr-none">Brak powiązań dyplomatycznych.</div>') + '</div>';
  }

  let recruitSize = 3000;
  function buildAoHDiploPanel(targetId) {
    const me = world.countries[G.player];
    if (!me) return '';

    if (targetId && targetId !== G.player && world.countries[targetId]) {
      const T = world.countries[targetId];
      const rel = Math.round(getRel(G, G.player, targetId));
      const war = atWar(G, G.player, targetId);
      const allied = me.allies && me.allies.has(targetId);
      const nap = hasNap(G, G.player, targetId);
      const access = hasAccess(G, G.player, targetId);
      const guar = guarantees(G, G.player, targetId);
      const vassal = T.overlord === G.player;

      const actionDefs = [
        { key: 'war', label: 'Wypowiedz Wojnę', icon: '⚔', disabled: war || truceLeft(G, G.player, targetId) > 0 || hasNap(G,G.player,targetId) || me.overlord===targetId || T.overlord===G.player, danger: true },
        { key: 'improve', label: 'Popraw Relacje', icon: '📈', disabled: war || (me.dp || 0) < (COST?.improve ?? 1) },
        { key: 'insult', label: 'Wyślij Zniewagę', icon: '💢', disabled: war || (me.dp || 0) < (COST?.insult ?? 1), danger: true },
        { key: 'alliance', label: allied ? 'Zerwij Sojusz' : 'Zaproponuj Sojusz', icon: '🤝', disabled: war || (me.dp || 0) < (COST?.alliance ?? 2) },
        { key: 'nap', label: 'Pakt o Nieagresji', icon: '📜', disabled: war || nap || (me.dp || 0) < (COST?.nap ?? 1) },
        { key: 'access', label: 'Prawo Przemarszu', icon: '🚪', disabled: war || access || (me.dp || 0) < (COST?.access ?? 1) },
        { key: 'guarantee', label: guar ? 'Cofnij Gwarancję' : 'Gwarancja Niepodległości', icon: '🛡', disabled: war || (me.dp || 0) < (COST?.guarantee ?? 1) },
        { key: 'vassal', label: vassal ? 'Uwolnij Wasala' : 'Żądaj Wasalizacji', icon: '👑', disabled: war || (me.dp || 0) < (COST?.vassal ?? 3) },
      ];

      return `
        <div class="aoh-diplo-box">
          <div class="aoh-diplo-title">Dyplomacja</div>
          ${diploRows(targetId)}
          <div class="dr-sub">Twoje relacje</div>
          ${diploRows(G.player)}
          <div class="aoh-tabs">
            <button type="button" class="aoh-tab active">Dyplomacja</button>
            <button type="button" class="aoh-tab" data-open-diplo-full="1">Lista państw</button>
          </div>
          <div class="aoh-actions-list">
            ${actionDefs.map(act => `
              <button type="button" class="aoh-act-btn${act.danger ? ' danger' : ''}" data-aoh-act="${act.key}" data-aoh-target="${targetId}" ${act.disabled ? 'disabled' : ''}>
                <span class="aoh-act-ico">${act.icon}</span>
                <span class="aoh-act-lbl">${act.label}</span>
              </button>
            `).join('')}
          </div>
          ${aohDiploMsg ? `<div class="aoh-diplo-msg ${aohDiploMsgOk ? 'ok' : 'bad'}">${aohDiploMsg}</div>` : ''}
        </div>
      `;
    }

    const others = world.countries
      .filter(c => c && c.alive && c.id !== G.player)
      .filter(c => !aohCountrySearch || c.plName.toLowerCase().includes(aohCountrySearch.toLowerCase()))
      .slice(0, 12);

    return `
      <div class="aoh-diplo-box">
        <div class="aoh-diplo-title">Dyplomacja</div>
        ${diploRows(G.player)}
        <input type="text" class="aoh-search" id="aoh-country-search" placeholder="Szukaj państwa..." value="${aohCountrySearch.replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;')}">
        <div class="aoh-rel-list">
          ${others.map(rc => {
            const rel = Math.round(getRel(G, G.player, rc.id));
            const war = atWar(G, G.player, rc.id);
            const allied = me.allies && me.allies.has(rc.id);
            const tag = war ? '⚔' : allied ? '🤝' : hasNap(G, G.player, rc.id) ? '📜' : '';
            return `<div class="aoh-rel-item ${war ? 'foe' : allied ? 'ally' : ''}" data-select-country="${rc.id}">
              ${flag(rc)}
              <span class="aoh-rel-name">${rc.plName}</span>
              <span class="aoh-rel-ico">${tag}</span>
              <b class="aoh-rel-num ${relCls(rel)}">${fmtRel(rel)}</b>
            </div>`;
          }).join('')}
        </div>
        <div class="aoh-tabs">
          <button type="button" class="aoh-tab active">Dyplomacja</button>
          <button type="button" class="aoh-tab" data-open-diplo-full="1">Lista państw</button>
        </div>
        ${aohDiploMsg ? `<div class="aoh-diplo-msg ${aohDiploMsgOk ? 'ok' : 'bad'}">${aohDiploMsg}</div>` : ''}
      </div>
    `;
  }

  function refreshSide() {
    const P = world.prov;
    const pid = R.selected;
    if (!pid || !P[pid]) { side.classList.add('hidden'); return; }
    side.classList.remove('hidden');
    syncSelectedArmies();
    const p = P[pid];
    const own = world.countries[p.owner], ctr = world.countries[p.controller];
    const terr = require_terrain(p.terrain);
    const isForeign = p.owner !== G.player;
    const targetCountryId = isForeign ? p.owner : null;
    R.diploCountry = targetCountryId;

    let html = `
      <button class="panel-close" data-close-side="1" title="Zamknij panel">×</button>
      <div class="aoh-card-head">
        ${flag(own)}
        <div>
          <h3>${own.plName}</h3>
          <div class="aoh-sub">${p.name} · Prowincji: ${own.provs.length}</div>
        </div>
      </div>
      <div class="rows">
        <div class="row"><span>Właściciel</span><b style="color:${own.color}">${own.plName}</b></div>`;
    if (isForeign) {
      const relVal = Math.round(getRel(G, G.player, p.owner));
      html += `<div class="row"><span>Opinia</span><b class="${relCls(relVal)}">${fmtRel(relVal)} (${relWord(relVal)})</b></div>`;
    }
    if (p.controller !== p.owner) {
      html += `<div class="row"><span>Pod kontrolą</span><b style="color:${ctr.color}">${ctr.plName} (okupacja)</b></div>`;
    }
    html += `
        <div class="row"><span>Rozwój</span><b>${p.dev}</b></div>
        <div class="row"><span>Twierdza</span><b>${p.fort ? 'poziom ' + p.fort : 'brak'}</b></div>
        <div class="row"><span>Rezerwa twierdzy</span><b>${p.garrison}/${p.garrisonMax ?? '?'}</b></div>
        <div class="row"><span>Teren</span><b>${terr.name}</b></div>
        ${p.coastal ? `<div class="row"><span>Wybrzeże</span><b>${p.links.some(l=>l.sea)?'Przeprawa morska':'Brak przeprawy'}</b></div>` : ''}
        ${p.devast > 0.05 ? `<div class="row"><span>Dewastacja</span><b>${Math.round(p.devast * 100)}%</b></div>` : ''}
      </div>`;

    html += buildAoHDiploPanel(targetCountryId);

    if (p.siege) {
      const el = G.day - (p.siege.start || G.day);
      const left = p.siege.progress > 1 && el > 0 ? Math.round((100 - p.siege.progress) / (p.siege.progress / el)) : null;
      html += `<div class="siege"><div class="siege-label">Oblężenie: ${world.countries[p.siege.side].plName} — ${Math.round(p.siege.progress)}%${left != null ? ` (jeszcze ok. ${left} dni)` : ''}</div>
        <div class="bar"><div class="bar-fill" style="width:${Math.min(100, p.siege.progress)}%"></div></div></div>`;
    }
    if (p.owner === G.player && p.controller === G.player) {
      const c = world.countries[G.player];
      const maxR = recruitMaxSize(G, pid);
      recruitSize = Math.min(Math.max(100, recruitSize), Math.max(100, maxR));
      const q = recruitQuote(G, recruitSize, pid);
      const rows = Object.keys(BUILDINGS).map(k => {
        const i = buildInfo(G, pid, k), d = i.def;
        const job = p.build && p.build.kind === k;
        let act;
        if (job) act = `<small>budowa: ${Math.max(0, p.build.end - G.day)} dni</small>`;
        else if (i.lvl >= d.max) act = '<small>maks.</small>';
        else act = `<button class="btn" data-build="${k}" ${i.ok ? '' : `disabled title="${i.why}"`}>${i.lvl ? 'Ulepsz' : 'Buduj'} · ${Math.round(i.gold)} duk. · ${i.mp.toFixed(1)} pkt. ruchu · ${i.days} dni</button>`;
        const tip = `${d.desc}. Koszt: ${Math.round(i.gold)} dukatów. Punkty ruchu: ${i.mp.toFixed(1)}. Czas: ${i.days} dni. Wymaga technologii ${d.tech} (masz ${i.tech.toFixed(2)}).`;
        return `<div class="bld-row" data-tip="${tip}"><span>${d.name} <small>poz. ${i.lvl}/${d.max}</small></span>${act}</div>`;
      }).join('');
      if (provTab === 'more') html += `<div class="bld-list"><div class="rec-title">Budynki <small>punkty ruchu: ${Math.floor(c.mp ?? MP_MAX)}/${MP_MAX}</small></div>${rows}</div>`;
      if (provTab === 'recruit') html += `<div class="rec-box"><div class="rec-title">Rekrutacja</div>
        <input type="range" id="recruit-size" min="100" max="${Math.max(100, maxR)}" step="100" value="${recruitSize}" ${maxR < 100 ? 'disabled' : ''}>
        <div class="rec-info"><span id="recruit-label">${recruitSize}</span> ludzi · <span id="recruit-cost">${Math.round(q.gold)} dukatów · ${q.days} dni</span></div>
        <button class="btn" id="act-recruit" ${maxR < 100 || c.gold < q.gold ? 'disabled' : ''}>Rekrutuj ${recruitSize}</button></div>`;
    }

    const visibleHere = (G.armies || []).filter(a => a && !a.dead && a.prov === pid && canSeeArmy(G, world, a));
    const alliedHere = visibleHere.filter(a => a.country !== G.player);
    if (alliedHere.length) {
      html += `<div class="rows">${alliedHere.map(a => {
        const ac = world.countries[a.country];
        return `<div class="row"><span>${flag(ac)} ${ac?.plName || ''}</span><b>${Math.round(a.size)}</b></div>`;
      }).join('')}</div>`;
    }

    const armies = countryArmies(G, G.player).filter(a => a.prov === pid && !a.dead);
    const movingHere = countryArmies(G, G.player).filter(a => !a.dead && a.path && a.path[a.path.length - 1] === pid);
    if (movingHere.length) {
      const eta = Math.max(1, Math.min(...movingHere.map(a => (a.moveLeft||0) + a.path.slice(1).reduce((sum,pid,i)=>sum+stepLinkDays(G,a,a.path[i],pid),0))));
      html += `<div class="hint">Maszeruje tu: ${movingHere.length} ${movingHere.length === 1 ? 'armia' : 'armie'} · dotrze za ok. ${eta} dn.</div>`;
    }
    const infoHtml = html;
    let actHtml = '';
    const bt = G.battles && [...G.battles.values()].find(b => b.pid === pid);
    if (bt) {
      const C = G.world.countries, pct = Math.round(bt.share1 * 100);
      actHtml += `<div class="battle-info"><b>⚔ Bitwa trwa (${G.day - bt.start + 1}. dzień)</b>
        <div class="hint">${C[bt.s1].plName} ${pct}% : ${100 - pct}% ${C[bt.s2].plName}</div>
        <div class="hint">Obrońca utrzymuje prowincję do przegranej bitwy. Wsparcie nie zajmuje terenu.</div></div>`;
    }
    const ps = R.pendingSplit;
    if (ps && (ps.half.dead || ps.half.path || R.selectedArmy !== ps.half)) R.pendingSplit = null;
    if (R.pendingSplit) {
      actHtml += `<div class="split-pending"><b>Wybrano połowę armii (${Math.round(ps.half.size)} ludzi)</b>
        <div class="hint">Kliknij prawym przyciskiem na mapie, aby wysłać ją tam.</div>
        <div class="actions"><button class="btn" data-split-keep="1">Zostaw tutaj</button><button class="btn" data-split-undo="1">Anuluj podział (Esc)</button></div></div>`;
    }
    if (armies.length) {
      const idle = armies.filter(a => a.recruitDays <= 0 && !a.path).length;
      const c = world.countries[G.player];
      actHtml += `<div class="side-armies hoi-armies">${armies.map((a, idx) => {
        const sel = R.selectedArmies.includes(a);
        const hpPct = Math.max(0, Math.min(100, Math.round((a.size / Math.max(1, a.maxSize || a.size)) * 100)));
        const morPct = Math.max(0, Math.min(100, Math.round((a.morale ?? 1) * 100)));
        return `<div class="army-row${sel ? ' sel' : ''}">
          <button type="button" class="hoi-unit-card${sel ? ' sel' : ''}" data-army="${a.id}">
            <span class="flag" style="background:${c?.color || '#888'}"></span>
            <span class="hoi-unit-num">${idx + 1}</span>
            <span class="hoi-unit-bars">
              <span class="hoi-bar hp"><i style="width:${hpPct}%"></i></span>
              <span class="hoi-bar mor"><i style="width:${morPct}%"></i></span>
            </span>
            <b class="hoi-unit-size">${Math.round(a.size)}</b>
            ${a.recruitDays > 0 ? `<small>(${a.recruitDays}d)</small>` : a.pinned ? `<small>(przypięta)</small>` : ''}
          </button>
          <button type="button" class="army-chip army-split" data-split="${a.id}" ${canSplit(a) ? '' : 'disabled'}>½</button>
        </div>`;
      }).join('')}${idle >= 2 ? '<button type="button" class="army-chip" data-merge="1">Połącz stojące armie (C)</button>' : ''}</div>`;
    }
    const am = infoHtml.indexOf('<div class="actions">');
    const info = am >= 0 ? infoHtml.slice(0, am) : infoHtml;
    const actions = (am >= 0 ? infoHtml.slice(am) : '') + actHtml;
    if (!side.querySelector('.side-info')) {
      side.innerHTML = '<div class="side-info"></div><div class="side-act"></div>';
      side.addEventListener('input', e => {
        if (e.target && e.target.id === 'recruit-size') {
          recruitSize = +e.target.value;
          const q = recruitQuote(G, recruitSize, R.selected), c = world.countries[G.player];
          side.querySelector('#recruit-label').textContent = recruitSize;
          side.querySelector('#recruit-cost').textContent = `${Math.round(q.gold)} dukatów · ${q.days} dni`;
          const btn = side.querySelector('#act-recruit');
          btn.textContent = `Rekrutuj ${recruitSize}`;
          btn.disabled = c.gold < q.gold || c.manpower < recruitSize;
          return;
        }
        if (e.target && e.target.id === 'aoh-country-search') {
          aohCountrySearch = e.target.value;
          const cursor=e.target.selectionStart;refreshSide();
          const input=side.querySelector('#aoh-country-search');if(input){input.focus();input.setSelectionRange(cursor,cursor);}
        }
      });
      side.addEventListener('click', e => {
        const t = e.target.closest('button, [data-select-country], [data-focus-country]');
        if (!t || t.disabled) return;
        if(t.dataset.closeSide){R.selected=0;refreshSide();return;}
        if (t.id === 'act-recruit') { if (playerRecruit(G, recruitSize, R.selected)) { refreshTop(); refreshSide(); refreshArmyBar(); } }
        else if (t.dataset.build) { if (playerBuild(G, R.selected, t.dataset.build)) { refreshTop(); refreshSide(); } }
        else if (t.dataset.openDiploFull) openDiplo(aohDiploTarget || undefined);
        else if (t.dataset.selectCountry || t.dataset.focusCountry) {
          const cid = +(t.dataset.selectCountry || t.dataset.focusCountry);
          const cnt = world.countries[cid];
          if (cnt && cnt.provs && cnt.provs.length) {
            R.selected = cnt.capital || cnt.provs[0];
            R.diploCountry = cid;
            aohDiploTarget = cid;
            aohDiploMsg = '';
            refreshAll();
          }
        }
        else if (t.dataset.aohAct) {
          const act = t.dataset.aohAct;
          const targetId = +t.dataset.aohTarget;
          handleAoHDiploAction(act, targetId);
        }
        else if (t.dataset.splitKeep) { R.pendingSplit = null; refreshSide(); refreshArmyBar(); }
        else if (t.dataset.splitUndo) cancelSplit();
        else if (t.dataset.split) splitArmy(G.armies.find(x => x.id === +t.dataset.split && !x.dead));
        else if (t.dataset.merge) mergeHere();
        else if (t.dataset.army) {
          const a = G.armies.find(x => x.id === +t.dataset.army && !x.dead && x.country === G.player);
          if (a) {
            if (e.shiftKey || e.ctrlKey || e.metaKey) toggleSelectedArmy(a);
            else setSelectedArmies([a], a);
          }
        }
      });
    }
    const si = side.querySelector('.side-info'), sa = side.querySelector('.side-act');
    if (si.innerHTML !== info) si.innerHTML = info;
    if (sa._html !== actions) { sa._html = actions; sa.innerHTML = actions; }
  }

  function handleAoHDiploAction(act, targetId) {
    const T = world.countries[targetId];
    if (!T) return;
    if (act === 'war') {
      const ok = playerDeclareWar(G, targetId);
      aohDiploMsg = ok ? `Wypowiedziano wojnę: ${T.plName}.` : `Nie można wypowiedzieć wojny: ${T.plName}.`;
      aohDiploMsgOk = ok;
      refreshAll();
      return;
    }
    if (act === 'alliance' && world.countries[G.player]?.allies?.has(targetId)) {
      const ok = breakAlliance(G, G.player, targetId).ok;
      aohDiploMsg = ok ? `Zerwano sojusz z ${T.plName}.` : 'Nie udało się zerwać sojuszu.';
      aohDiploMsgOk = ok;
      refreshAll();
      return;
    }
    if (act === 'guarantee' && guarantees(G, G.player, targetId)) {
      const ok = cancelGuarantee(G, G.player, targetId).ok;
      aohDiploMsg = ok ? `Cofnięto gwarancję dla ${T.plName}.` : 'Nie udało się cofnąć gwarancji.';
      aohDiploMsgOk = ok;
      refreshAll();
      return;
    }
    if (act === 'vassal' && T.overlord === G.player) {
      const ok = releaseVassal(G, G.player, targetId).ok;
      aohDiploMsg = ok ? `Uwolniono wasala: ${T.plName}.` : 'Nie udało się uwolnić wasala.';
      aohDiploMsgOk = ok;
      refreshAll();
      return;
    }
    const res = diploAction(G, G.player, targetId, act);
    if (res && typeof res === 'object') {
      aohDiploMsg = res.msg || (res.ok ? 'Wykonano akcję dyplomatyczną.' : 'Akcja odrzucona.');
      aohDiploMsgOk = !!res.ok;
    } else {
      aohDiploMsg = res ? 'Wykonano akcję dyplomatyczną.' : 'Nie można wykonać akcji.';
      aohDiploMsgOk = !!res;
    }
    refreshAll();
  }

  function splitArmy(a) {
    const n = playerSplitArmy(G, a);
    if (!n) return false;
    setSelectedArmies([n], n);
    R.pendingSplit = { orig: a, half: n };
    R.drawHighlight(G); refreshAll();
    return true;
  }
  function cancelSplit() {
    const ps = R.pendingSplit; R.pendingSplit = null;
    if (ps && playerUndoSplit(G, ps.orig, ps.half)) {
      setSelectedArmies([ps.orig], ps.orig);
    }
    R.drawHighlight(G); refreshAll();
  }
  function mergeHere() {
    const pid = R.selectedArmy ? R.selectedArmy.prov : R.selected;
    const m = pid && playerMergeArmies(G, pid);
    if (!m) return false;
    setSelectedArmies([m], m);
    R.drawHighlight(G); refreshAll();
    return true;
  }

  function refreshLog() {
    if (!logEl) return;
    const evs = G.events.slice(-7).reverse();
    logEl.innerHTML = evs.map(e => `<div class="ev ${e.kind}">${e.text}</div>`).join('');
  }

  function openModal(title, bodyHTML, footHTML = '') {
    closeModal();
    const root = $('#modal-root');
    root.innerHTML = `<div class="modal-backdrop"><div class="modal">
      <div class="modal-head"><h2>${title}</h2><button class="btn btn-icon" id="modal-x">✕</button></div>
      <div class="modal-body">${bodyHTML}</div>${footHTML ? `<div class="modal-foot">${footHTML}</div>` : ''}</div></div>`;
    root.querySelector('#modal-x').onclick = closeModal;
    modalOpen = true;
    resumeSpeed=G.speed;G.speed=0;refreshTop();
    return root.querySelector('.modal');
  }
  function closeModal() {
    const root = $('#modal-root');
    if (root) root.innerHTML = '';
    modalOpen = false;
    if (resumeSpeed != null) { G.speed = resumeSpeed; resumeSpeed = null; refreshTop(); }
  }

  function openHelp() {
    openModal('Rozkazy i kontrola terenu', `
      <p><b>Wybór:</b> kliknij znacznik lub kartę armii. Shift + klik dodaje do zaznaczenia; Shift + przeciągnięcie zaznacza grupę. A wybiera wszystkie armie.</p>
      <p><b>PPM:</b> rozkaz marszu lub ataku. Shift + PPM dodaje cel do kolejki. H zatrzymuje; F centruje widok na wybranej armii.</p>
      <p><b>Zajmowanie:</b> niebroniona prowincja przechodzi pod kontrolę wojska po jego wejściu. Atak na obrońcę trwa z sąsiedniej prowincji. Po zwycięstwie trzeba jeszcze wkroczyć.</p>
      <p><b>Ctrl + Alt + PPM:</b> wsparcie ataku na sąsiednią, bronioną prowincję. Jednostka walczy z miejsca i nie zajmuje celu.</p>
      <p><b>Forty:</b> dają premię broniącej się armii. Bez armii nie zatrzymują zajęcia. Kontrola trwa do odbicia prowincji lub pokoju; własność zmienia dopiero traktat.</p>
      <p><b>Zaopatrzenie:</b> potrzebna jest droga przez przyjazne prowincje do własnej stolicy lub zastępczego zaplecza. Przeprawy morskie są uproszczone. Odcięte wojska tracą ludzi i morale.</p>
      <p><b>Odwrót:</b> obrońcy mogą wycofać się PPM do dostępnej, przyjaznej prowincji. Okrążona armia bez wyjścia kapituluje. Po odwrocie reorganizacja trwa 4 dni.</p>
      <p><b>Znaczniki:</b> zielony pasek — morale; złoty — stan osobowy. ! oznacza brak zaopatrzenia, ◷ mobilizację. Liczba w kółku przy bitwie oznacza udział twojej strony w sile walczących.</p>
      <p><b>Skróty:</b> Spacja — pauza; 1–9 / Tab — wybór; S — podział stojącej armii; C — połączenie; M — tryb mapy; D — dyplomacja; Esc — zamknięcie panelu; kółko / + / − — zoom; 0 — cała mapa.</p>`);
  }

  // Rozmowy pokojowe (jak w Age of History 2): panele po bokach, żądania klikane na mapie.
  let peace = null; // {w, sel:Set(pid), vas:Set(cid), gold, ver, resume, enemyGold}
  function openPeace(wSel) {
    const myWars = world.countries[G.player].wars;
    if (!myWars.length) return;
    closeModal();
    peace = { w: myWars.includes(wSel) ? wSel : myWars[0], sel: new Set(), vas: new Set(), gold: 0, ver: 0, resume: G.speed };
    G.speed = 0;
    document.body?.classList?.add('peace-mode');
    R.selected = 0;
    pushPeaceMap(); renderPeace(); refreshTop();
  }
  function closePeace() {
    if (!peace) return;
    G.speed = peace.resume; peace = null;
    document.body?.classList?.remove('peace-mode');
    $('#peace-ui').innerHTML = '';
    R.setPeace?.(null);
    refreshAll();
  }
  function peaceCost() {
    let n = peace.gold / 4;
    for (const cid of peace.vas) n += vassalCost(G, peace.w, cid);
    for (const pid of peace.sel) n += provCost(G, peace.w, pid, G.player);
    return n;
  }
  function pushPeaceMap() {
    const dem = new Set(demandable(G, peace.w, G.player)), cost = new Map(), sel = new Set(peace.sel);
    for (const pid of dem) cost.set(pid, provCost(G, peace.w, pid, G.player));
    for (const cid of peace.vas) for (const pid of world.countries[cid].provs) sel.add(pid);
    peace.ver++;
    R.setPeace?.({ dem, sel, cost, ver: peace.ver });
  }
  function togglePeaceProv(pid) {
    const p = world.prov[pid];
    if (!peace || !p || peace.vas.has(p.owner) || !demandable(G, peace.w, G.player).includes(pid)) return;
    if (!peace.sel.delete(pid)) peace.sel.add(pid);
    renderPeace(); pushPeaceMap();
  }
  function updatePeaceTotals() {
    const budget = peaceBudget(G, peace.w, G.player), cost = peaceCost(), over = cost > budget + 0.001;
    $('#pz-total').textContent = `${Math.round(cost)} / ${Math.round(budget)} ★`;
    $('#pz-total').style.color = over ? '#e07a66' : '';
    $('#pz-fill').style.width = Math.min(100, budget ? cost / budget * 100 : 0) + '%';
    $('#pz-fill').style.background = over ? '#c0392b' : '';
    const gt = $('#pz-gold-txt'); if (gt) gt.textContent = `${peace.gold} dukatów · skarbiec ${peace.enemyGold}`;
    const gc = $('#pz-gold-cost'); if (gc) gc.textContent = `${Math.round(peace.gold / 4)} ★`;
    $('#peace-send').disabled = over || (!peace.sel.size && !peace.vas.size && !peace.gold);
  }
  function renderPeace() {
    const { w } = peace, C = world.countries, me = C[G.player], myWars = me.wars;
    const enemies = (w.att.includes(G.player) ? w.def : w.att).map(id => C[id]).filter(c => c && c.alive);
    const lead = C[w.att.includes(G.player) ? w.lead.d : w.lead.a];
    peace.enemyGold = Math.max(0, Math.floor(lead.gold));
    peace.gold = Math.min(peace.gold, peace.enemyGold);
    const mine = Math.round(Math.max(0, warScore(G, w, G.player))), theirs = Math.round(Math.max(0, warScore(G, w, lead.id)));
    const share = mine + theirs ? Math.round(100 * Math.max(mine, theirs) / (mine + theirs)) : 50;
    const winner = mine >= theirs ? G.player : lead.id;
    const dem = demandable(G, w, G.player);
    const groups = enemies.map(e => {
      const provs = dem.filter(pid => world.prov[pid].owner === e.id && !peace.vas.has(e.id)).sort((a, b) => provCost(G, w, a, G.player) - provCost(G, w, b, G.player));
      const vas = canVassalize(G, w, e.id) ? `<button class="pz-item ${peace.vas.has(e.id) ? 'on' : ''}" data-pz-vas="${e.id}"><span>♛ Zażądaj wasalizacji</span><b>${vassalCost(G, w, e.id)} ★</b></button>` : '';
      const gold = e === lead ? `<div class="pz-item"><span>● Reparacje wojenne<small id="pz-gold-txt"></small></span><b id="pz-gold-cost"></b></div><input type="range" id="pz-gold" min="0" max="${peace.enemyGold}" value="${peace.gold}">` : '';
      const rows = provs.map(pid => { const p = world.prov[pid]; return `<button class="pz-item ${peace.sel.has(pid) ? 'on' : ''}" data-pz-prov="${pid}"><span>⚑ ${p.name}<small>${sameSide(G, G.player, p.controller) ? 'okupowana' : 'nieokupowana'} · rozwój ${p.dev}</small></span><b>${provCost(G, w, pid, G.player)} ★</b></button>`; }).join('');
      return `<div class="pz-country">${flag(e)}<b>${e.plName}</b></div>${vas}${gold}${rows}`;
    }).join('');
    const warSel = myWars.length > 1 ? `<select id="pz-war">${myWars.map((x, i) => `<option value="${i}" ${x === w ? 'selected' : ''}>Wojna: ${C[x.att.includes(G.player) ? x.lead.d : x.lead.a].plName}</option>`).join('')}</select>` : '';
    const ui = $('#peace-ui');
    ui.innerHTML = `
      <div class="pz-banner">${flag(me)}<div><b>Rozmowy pokojowe</b><small>${share}% na korzyść ${w.att.includes(winner) ? 'Agresorów' : 'Obrońców'}</small></div>${flag(lead)}</div>
      <div class="pz-score"><h3>Wynik</h3>
        <div class="pz-row">${flag(me)}<b>${me.plName}</b><span>${mine} ★</span></div>
        <div class="pz-row">${flag(lead)}<span>${lead.plName}</span><span>${theirs} ★</span></div>
        <div class="pz-demand"><span>Żądania</span><b id="pz-total"></b></div><div class="pz-bar"><i id="pz-fill"></i></div></div>
      <div class="pz-list"><h3>Stwórz żądania</h3><p class="pz-hint">Klikaj prowincje na mapie albo pozycje poniżej.</p>${warSel}${groups || '<p class="pz-hint">Brak prowincji do żądania. Zajmij teren przeciwnika.</p>'}<div id="peace-msg" role="status"></div></div>
      <div class="pz-bottom"><button class="btn" id="peace-back">Wróć</button><button class="btn" id="peace-white">Biały pokój</button><button class="btn btn-gold" id="peace-send">Wyślij żądania</button></div>`;
    ui.querySelectorAll('[data-pz-prov]').forEach(b => b.onclick = () => togglePeaceProv(+b.dataset.pzProv));
    ui.querySelectorAll('[data-pz-vas]').forEach(b => b.onclick = () => {
      const cid = +b.dataset.pzVas;
      if (!peace.vas.delete(cid)) { peace.vas.add(cid); for (const pid of [...peace.sel]) if (world.prov[pid].owner === cid) peace.sel.delete(pid); }
      renderPeace(); pushPeaceMap();
    });
    const slider = ui.querySelector('#pz-gold'); if (slider) slider.oninput = e => { peace.gold = Math.max(0, Math.floor(+e.target.value) || 0); updatePeaceTotals(); };
    const war = ui.querySelector('#pz-war'); if (war) war.onchange = e => { peace.w = myWars[+e.target.value]; peace.sel.clear(); peace.vas.clear(); peace.gold = 0; renderPeace(); pushPeaceMap(); };
    $('#peace-back').onclick = closePeace;
    $('#peace-white').onclick = () => { acceptWhitePeace(G, peace.w); closePeace(); };
    $('#peace-send').onclick = () => {
      const r = playerPeaceDemand(G, peace.w, [...peace.sel].map(pid => ({ pid, to: G.player })), peace.gold, [...peace.vas]);
      if (r.ok) closePeace(); else $('#peace-msg').textContent = r.msg;
    };
    updatePeaceTotals();
  }

  // Pełna dyplomacja: jedno okno z relacjami, sojuszami/paktami, wasalizacjami i wojnami świata.
  let fdTab = 'over', fdPick = null;
  function fdHTML(msg = '') {
    const C = world.countries, me = C[G.player], alive = C.filter(c => c && c.alive && c.id !== G.player);
    const tag = (t, k) => `<i class="fd-tag ${k}">${t}</i>`;
    const who = c => `<button class="fd-link" data-modal-country="${c.id}">${flag(c)} ${c.plName}</button>`;
    const sec = (title, list) => `<h4 class="fd-h">${title} <small>(${list.length})</small></h4><div class="fd-list">${list.length ? list.join('') : '<span class="fd-none">brak</span>'}</div>`;
    const tabs = [['over', 'Przegląd'], ['rel', 'Relacje'], ['pakt', 'Sojusze i pakty'], ['vas', 'Wasalizacje'], ['war', 'Wojny']]
      .map(([k, t]) => `<button class="btn fd-tab ${fdTab === k ? 'on' : ''}" data-fd-tab="${k}">${t}</button>`).join('');
    let body = '';
    if (fdTab === 'over') {
      const foeOf = alive.find(c => atWar(G, G.player, c.id));
      if (!(C[fdPick] && C[fdPick].alive && fdPick !== G.player)) fdPick = (foeOf || C[aohDiploTarget] || alive[0] || {}).id;
      const opts = [...alive].sort((a, b) => a.plName.localeCompare(b.plName, 'pl')).map(c => `<option value="${c.id}" ${c.id === fdPick ? 'selected' : ''}>${c.plName}</option>`).join('');
      body = `<p class="fd-hint">🔥 wojny · ⚔ wrogowie · ❤ sojusznicy · 👑 wasale · 🤝 pakty i przyjaciele. Najedź na flagę, aby zobaczyć opinie. Kliknij flagę, aby przełączyć państwo po prawej.</p>
        <div class="fd-cols"><div><h4 class="fd-h">Ty</h4>${diploRows(G.player, 'data-fd-pick')}</div>
        <div><h4 class="fd-h">Wybrane państwo <select id="fd-pick">${opts}</select></h4>${diploRows(fdPick, 'data-fd-pick')}</div></div>`;
    } else if (fdTab === 'rel') {
      body = `<p class="fd-hint">Kliknij państwo, aby otworzyć jego panel dyplomacji. Zielone tło: sojusznik lub wasalizacja. Czerwone tło: wojna z tobą.</p><div class="fd-table">` +
        alive.map(c => ({ c, rel: Math.round(getRel(G, G.player, c.id)) })).sort((a, b) => b.rel - a.rel).map(({ c, rel }) => {
          const t = [];
          if (atWar(G, G.player, c.id)) t.push(tag('Wojna', 'bad'));
          if (me.allies.has(c.id)) t.push(tag('Sojusznik', 'good'));
          if (me.overlord === c.id) t.push(tag('Suweren', 'vas'));
          if (c.overlord === G.player) t.push(tag('Wasal', 'vas'));
          if (hasNap(G, G.player, c.id)) t.push(tag('Pakt', 'good'));
          if (hasAccess(G, G.player, c.id)) t.push(tag('Twoje przejście', ''));
          if (hasAccess(G, c.id, G.player)) t.push(tag('Ich przejście', ''));
          if (guarantees(G, G.player, c.id)) t.push(tag('Gwarantujesz', ''));
          if (guarantees(G, c.id, G.player)) t.push(tag('Gwarantuje ciebie', ''));
          const tr = truceLeft(G, G.player, c.id); if (tr) t.push(tag(`Rozejm ${tr} dni`, ''));
          return `<button class="fd-row ${atWar(G, G.player, c.id) ? 'foe' : me.allies.has(c.id) || c.overlord === G.player || me.overlord === c.id ? 'ally' : ''}" data-modal-country="${c.id}"><span>${flag(c)} ${c.plName}</span><b class="${rel >= 40 ? 'fd-pos' : rel <= -40 ? 'fd-neg' : ''}">${rel >= 0 ? '+' : ''}${rel}</b><span class="fd-tags">${t.join('')}</span><small>${c.provs.length} pr. · moc ${Math.round(power(G, c.id))}</small></button>`;
        }).join('') + '</div>';
    } else if (fdTab === 'pakt') {
      const naps = [...G.nap].filter(([k, end]) => end > G.day && k.split(':').map(Number).includes(G.player))
        .map(([k, end]) => { const o = C[k.split(':').map(Number).find(x => x !== G.player)]; return `<span class="fd-item">${who(o)} <small>do końca: ${Math.round((end - G.day) / 365 * 10) / 10} r.</small></span>`; });
      const pass = (a, b) => alive.filter(c => hasAccess(G, a(c), b(c)));
      body = sec('Sojusznicy', [...me.allies].map(id => C[id]).filter(c => c && c.alive).map(c => `<span class="fd-item">${who(c)}</span>`)) +
        sec('Pakty o nieagresji', naps) +
        sec('Gwarantujesz niepodległość', alive.filter(c => guarantees(G, G.player, c.id)).map(c => `<span class="fd-item">${who(c)}</span>`)) +
        sec('Gwarantują ciebie', guarantorsOf(G, G.player).map(id => C[id]).filter(Boolean).map(c => `<span class="fd-item">${who(c)}</span>`)) +
        sec('Mogą przechodzić przez twoje ziemie', pass(c => c.id, () => G.player).map(c => `<span class="fd-item">${who(c)}</span>`)) +
        sec('Ty możesz przechodzić przez ich ziemie', pass(() => G.player, c => c.id).map(c => `<span class="fd-item">${who(c)}</span>`));
    } else if (fdTab === 'vas') {
      const mine = [...me.vassals].map(id => C[id]).filter(c => c && c.alive);
      const pairs = C.filter(c => c && c.alive && c.overlord != null && C[c.overlord]);
      body = (me.overlord != null ? `<p>Twój suweren: ${who(C[me.overlord])}</p>` : '<p class="fd-hint">Nie jesteś niczyim wasalem.</p>') +
        sec('Twoi wasale', mine.map(c => `<span class="fd-item">${who(c)} <small>od ${Math.max(0, Math.floor((G.day - c.vassalSince) / 30))} mies.</small> <button class="btn" data-fd-release="${c.id}">Uwolnij</button></span>`)) +
        sec('Wszystkie wasalizacje na świecie', pairs.map(c => `<span class="fd-item">${who(c)} <small>→ suweren:</small> ${who(C[c.overlord])}</span>`)) +
        '<p class="fd-hint">Nowego wasala zażądasz w traktacie pokojowym albo w panelu dyplomacji danego państwa.</p>';
    } else {
      const wars = G.wars.map((w, i) => ({ w, i })), mineWars = new Set(me.wars);
      body = wars.length ? wars.sort((a, b) => mineWars.has(b.w) - mineWars.has(a.w)).map(({ w, i }) => {
        const side = ids => ids.map(id => C[id]).filter(Boolean).map(who).join(', ');
        const mine = mineWars.has(w);
        return `<div class="fd-war ${mine ? 'mine' : ''}"><div><b>Atakujący:</b> ${side(w.att)}</div><div><b>Obrońcy:</b> ${side(w.def)}</div><div class="fd-war-foot"><small>trwa ${G.day - w.start} dni · bitwy: ${w.battles || 0}${mine ? ` · twój wynik: ${Math.round(warScore(G, w, G.player))} ★` : ''}</small>${mine ? `<button class="btn btn-gold" data-fd-peace="${i}">Negocjuj pokój</button>` : ''}</div></div>`;
      }).join('') : '<p class="fd-hint">Na świecie nie toczy się żadna wojna.</p>';
    }
    return `<div class="fd-tabs">${tabs}</div>${msg ? `<p class="fd-msg">${msg}</p>` : ''}${body}`;
  }
  function fdBind(body) {
    if (!body) return;
    body.querySelectorAll('[data-fd-tab]').forEach(b => b.onclick = () => { fdTab = b.dataset.fdTab; fdRefresh(); });
    body.querySelectorAll('[data-fd-pick]').forEach(b => b.onclick = () => { fdPick = +b.dataset.fdPick; if (fdPick === G.player) return; fdRefresh(); });
    const pick = body.querySelector('#fd-pick'); if (pick) pick.onchange = e => { fdPick = +e.target.value; fdRefresh(); };
    body.querySelectorAll('[data-fd-release]').forEach(b => b.onclick = () => { const r = releaseVassal(G, G.player, +b.dataset.fdRelease); if (r.ok) refreshAll(); fdRefresh(r.ok ? '' : r.msg); });
    body.querySelectorAll('[data-fd-peace]').forEach(b => b.onclick = () => { const w = G.wars[+b.dataset.fdPeace]; closeModal(); if (w) openPeace(w); });
  }
  function fdRefresh(msg = '') {
    const body = $('#modal-root').querySelector('.modal-body');
    if (!body) return;
    body.innerHTML = fdHTML(msg); fdBind(body);
  }
  function openFullDiplo(tab) {
    if (peace) return;
    if (tab) fdTab = tab;
    const m = openModal('Pełna dyplomacja', fdHTML());
    if (m.style) { m.style.width = 'min(1000px,96vw)'; m.style.maxWidth = '1000px'; }
    fdBind(m.querySelector('.modal-body'));
  }
  $('#btn-fulldiplo')?.addEventListener('click', () => openFullDiplo());

  function openDiplo(target) {
    const targets = world.countries.filter(c => c && c.alive && c.id !== G.player);
    openModal('Dyplomacja — pełna lista państw', `
      <div class="rows">
        ${targets.map(c => {
          const rel = Math.round(getRel(G, G.player, c.id));
          return `<button class="btn row" data-modal-country="${c.id}" style="width:100%;margin-bottom:4px"><span>${flag(c)} ${c.plName}</span><b>${rel >= 0 ? '+' : ''}${rel}</b></button>`;
        }).join('')}
      </div>
    `);
  }

  $('#modal-root').addEventListener('click',e=>{const b=e.target.closest('[data-modal-country]');if(!b)return;const cid=+b.dataset.modalCountry;closeModal();R.selected=world.countries[cid].capital;R.diploCountry=cid;aohDiploTarget=cid;refreshAll();});

  let boxEl = $('#box-select');
  if (!boxEl && $('#hud')) {
    boxEl = document.createElement('div');
    boxEl.id = 'box-select';
    boxEl.className = 'box-select hidden';
    $('#hud').appendChild(boxEl);
  }
  function updateBoxSelect(x0, y0, x1, y1) {
    if (!boxEl) return;
    const left = Math.min(x0, x1), top = Math.min(y0, y1);
    const width = Math.abs(x1 - x0), height = Math.abs(y1 - y0);
    boxEl.style.left = left + 'px';
    boxEl.style.top = top + 'px';
    boxEl.style.width = width + 'px';
    boxEl.style.height = height + 'px';
    boxEl.classList.remove('hidden');
  }
  function hideBoxSelect() {
    boxEl?.classList.add('hidden');
  }

  let dragging = false, boxSelecting = false, moved = false;
  let dragX = 0, dragY = 0, startX = 0, startY = 0;

  cv.addEventListener('contextmenu', e => e.preventDefault());

  cv.addEventListener('mousedown', e => {
    if (modalOpen) return;
    startX = e.clientX; startY = e.clientY;
    dragX = e.clientX; dragY = e.clientY;
    moved = false;
    if (e.button === 2) {
      dragging = true;
      boxSelecting = false;
      return;
    }
    if (e.button === 0) {
      if (e.shiftKey && !peace) {
        boxSelecting = true;
        dragging = false;
        updateBoxSelect(startX, startY, e.clientX, e.clientY);
      } else {
        dragging = true;
        boxSelecting = false;
      }
    }
  });

  window.addEventListener('mousemove', e => {
    if (boxSelecting) {
      const dist = Math.hypot(e.clientX - startX, e.clientY - startY);
      if (dist > 4) moved = true;
      updateBoxSelect(startX, startY, e.clientX, e.clientY);
      return;
    }
    if (dragging) {
      const dx = e.clientX - dragX, dy = e.clientY - dragY;
      if (Math.hypot(e.clientX - startX, e.clientY - startY) > 5) moved = true;
      dragX = e.clientX; dragY = e.clientY;
      R.cam.x -= dx / R.cam.zoom;
      R.cam.y -= dy / R.cam.zoom;
      R.cam.x=Math.max(0,Math.min(R.W,R.cam.x));R.cam.y=Math.max(0,Math.min(R.H,R.cam.y));
    }
    if (!modalOpen && tip && e.target === cv) {
      const pid = R.provAt(e.clientX, e.clientY);
      R.hover = pid;
      const p = pid && world.prov[pid];
      if (p) {
        tip.style.display = 'block';
        tip.style.left = Math.max(4,Math.min(window.innerWidth-285,e.clientX+14))+'px';
        tip.style.top = Math.min(window.innerHeight-90,e.clientY+14)+'px';
        const own = world.countries[p.owner];
        if (p.owner !== G.player && own) {
          const rel = Math.round(getRel(G, G.player, p.owner));
          tip.innerHTML = `<b>${own.plName}</b><br>Opinia: ${rel >= 0 ? '+' : ''}${rel} · ${p.name}`;
        } else {
          tip.textContent = `${p.name} (${own ? own.plName : ''})`;
        }
      } else {
        tip.style.display = 'none';
      }
    }
  });

  window.addEventListener('mouseup', e => {
    if (boxSelecting) {
      if(!moved){boxSelecting=false;hideBoxSelect();const hit=R.armyAt(e.clientX,e.clientY);if(hit?.country===G.player)toggleSelectedArmy(hit);return;}
      boxSelecting = false;
      hideBoxSelect();
      if (modalOpen) return;
      const minX = Math.min(startX, e.clientX), maxX = Math.max(startX, e.clientX);
      const minY = Math.min(startY, e.clientY), maxY = Math.max(startY, e.clientY);
      const myArmies = countryArmies(G, G.player).filter(a => !a.dead);
      const picked = myArmies.filter(a => {
        const pos = R.armyScreenPos ? R.armyScreenPos(G, a) : null;
        if (!pos) return false;
        return pos[0] >= minX && pos[0] <= maxX && pos[1] >= minY && pos[1] <= maxY;
      });
      if (picked.length) {
        setSelectedArmies(picked, picked[0]);
      }
      return;
    }

    if (!dragging) return;
    dragging = false;
    if (moved || modalOpen) return;
    if (peace) { if (e.button === 0) { const q = R.provAt(e.clientX, e.clientY); if (q) togglePeaceProv(q); } return; }

    if(e.button===0){const hit=R.armyAt(e.clientX,e.clientY);if(hit?.country===G.player){if(e.ctrlKey||e.metaKey)toggleSelectedArmy(hit);else setSelectedArmies([hit],hit);return;}}
    const pid = R.provAt(e.clientX, e.clientY);
    if (!pid) {if(e.button===0){R.selected=0;setSelectedArmies([]);}return;}

    if (e.button === 2) {
      const targets = activeArmies();
      if (!targets.length) return;
      const supportAttack = !!(e.ctrlKey && e.altKey);
      const queue = !!e.shiftKey;
      if (playerIssueOrder(G, targets, pid, { queue, supportAttack })) {
        R.pendingSplit = null;
        R.drawHighlight(G);
        refreshAll();
      } else {log(G,'Nie można wykonać rozkazu: sprawdź wojnę, dostęp wojskowy i stan jednostki.','bad');refreshLog();}
      return;
    }

    R.selected = pid;
    provTab = null;
    const p = world.prov[pid];
    R.diploCountry = (p && p.owner !== G.player) ? p.owner : null;
    aohDiploTarget = R.diploCountry;
    aohDiploMsg = '';
    const hereArmies = countryArmies(G, G.player).filter(a => a.prov === pid && !a.dead);
    if (hereArmies.length) {
      const curIdx = R.selectedArmy && !R.selectedArmy.dead
        ? hereArmies.findIndex(a => a.id === R.selectedArmy.id)
        : -1;
      const next = curIdx >= 0 ? hereArmies[(curIdx + 1) % hereArmies.length] : hereArmies[0];
      setSelectedArmies([next], next);
    } else {
      setSelectedArmies([], null);
    }
  });

  // HOI4-style map navigation: zoom toward the pointer, so the province
  // under the cursor stays in place while the map scales.
  function zoomAt(factor, clientX, clientY) {
    const rect = cv.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    const oldZoom = R.cam.zoom;
    const nextZoom = Math.max(0.3, Math.min(12, oldZoom * factor));
    if (Math.abs(nextZoom - oldZoom) < 0.0001) return;
    const worldX = (px - cv.clientWidth / 2) / oldZoom + R.cam.x;
    const worldY = (py - cv.clientHeight / 2) / oldZoom + R.cam.y;
    R.cam.zoom = nextZoom;
    R.cam.x = worldX - (px - cv.clientWidth / 2) / nextZoom;
    R.cam.y = worldY - (py - cv.clientHeight / 2) / nextZoom;
  }

  cv.addEventListener('wheel', e => {
    if (modalOpen) return;
    e.preventDefault();
    // Exponential scaling behaves well for both mouse wheels and trackpads.
    const factor = Math.exp(-e.deltaY * 0.0015);
    zoomAt(factor, e.clientX, e.clientY);
  }, { passive: false });

  // Visible zoom controls for mouse users; the keyboard shortcuts are also
  // useful when the pointer is over another interface element.
  document.getElementById('map-zoom-in')?.addEventListener('click', () => {
    const r = cv.getBoundingClientRect();
    zoomAt(1.35, r.left + r.width / 2, r.top + r.height / 2);
  });
  document.getElementById('map-zoom-out')?.addEventListener('click', () => {
    const r = cv.getBoundingClientRect();
    zoomAt(1 / 1.35, r.left + r.width / 2, r.top + r.height / 2);
  });
  document.getElementById('map-zoom-reset')?.addEventListener('click', () => {
    R.cam.x = R.W / 2;
    R.cam.y = R.H / 2;
    R.cam.zoom = Math.max(.3,Math.min(cv.clientWidth/R.W,(cv.clientHeight-140)/R.H)*.95);
  });

  window.addEventListener('keydown', e => {
    const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
    if(typing && e.key!=='Escape')return;
    if(peace&&!['Escape','+','=','-','_','0'].includes(e.key))return;
    if(!modalOpen&&e.key.toLowerCase()==='m'){$('#btn-mapmode').click();return;}
    if(!modalOpen&&e.key.toLowerCase()==='d'){$('#btn-diplo').click();return;}
    if(!modalOpen&&e.key.toLowerCase()==='a'){e.preventDefault();setSelectedArmies(countryArmies(G,G.player));return;}
    if(!modalOpen&&e.key.toLowerCase()==='f'&&R.selectedArmy){const p=world.prov[R.selectedArmy.prov];R.cam.x=p.ax;R.cam.y=p.ay;return;}
    if (!modalOpen && !typing && (e.key === '+' || e.key === '=')) {
      e.preventDefault();
      const r = cv.getBoundingClientRect();
      zoomAt(1.25, r.left + r.width / 2, r.top + r.height / 2);
    } else if (!modalOpen && !typing && (e.key === '-' || e.key === '_')) {
      e.preventDefault();
      const r = cv.getBoundingClientRect();
      zoomAt(1 / 1.25, r.left + r.width / 2, r.top + r.height / 2);
    } else if (!modalOpen && !typing && e.key === '0') {
      R.cam.x = R.W / 2; R.cam.y = R.H / 2; R.cam.zoom = Math.max(.3,Math.min(cv.clientWidth/R.W,(cv.clientHeight-140)/R.H)*.95);
    } else if (e.code === 'Space' && !modalOpen && !peace && document.activeElement?.tagName !== 'INPUT') {
      e.preventDefault();
      G.speed = G.speed ? 0 : 2;
      refreshTop();
    } else if (e.key === 'Escape') {
      if (peace) closePeace();
      else if (modalOpen) closeModal();
      else if (R.pendingSplit) cancelSplit();
      else {R.selected=0;setSelectedArmies([]);}
    } else if ((e.key === 'h' || e.key === 'H') && !modalOpen) {
      const targets = activeArmies();
      if (targets.length && playerHaltArmies(G, targets)) {
        R.drawHighlight(G);
        refreshAll();
      }
    } else if (/^[1-9]$/.test(e.key) && !modalOpen) {
      const list = countryArmies(G, G.player).filter(a => !a.dead);
      const target = list[+e.key - 1];
      if (target) {
        if (e.shiftKey) toggleSelectedArmy(target);
        else setSelectedArmies([target], target);
      }
    } else if (e.key === 'Tab' && !modalOpen) {
      e.preventDefault();
      const list = countryArmies(G, G.player).filter(a => !a.dead);
      if (list.length) {
        const idx = R.selectedArmy && !R.selectedArmy.dead
          ? list.findIndex(a => a.id === R.selectedArmy.id)
          : -1;
        const next = list[(idx + 1) % list.length];
        setSelectedArmies([next], next);
      }
    } else if ((e.key === 's' || e.key === 'S') && R.selectedArmy && !modalOpen) {
      splitArmy(R.selectedArmy);
    } else if ((e.key === 'c' || e.key === 'C') && !modalOpen) {
      mergeHere();
    }
  });

  function refreshAll() {
    refreshTop();
    refreshProvBar();
    refreshArmyBar();
    refreshWarbar();
    refreshSide();
    refreshLog();
    const h=topbar.getBoundingClientRect().height;
    document.documentElement.style.setProperty('--hud-height',h+'px');
    document.documentElement.style.setProperty('--war-height',warbar.classList.contains('hidden')?'0px':warbar.getBoundingClientRect().height+'px');
    refreshOffers();
    const status=document.getElementById('command-status');
    if(status)status.textContent=activeArmies().length?`Wybrano: ${activeArmies().length} · PPM: rozkaz · Shift + PPM: kolejka · H: zatrzymaj`:'LPM: jednostka / prowincja · Shift + przeciągnięcie: grupa · Spacja: pauza';
  }
  function refreshOffers(){
    const root=$('#offers');if(!root)return;
    const offers=G.offers.filter(o=>!o.dead && o.expires>G.day && (!o.war||G.wars.includes(o.war)));
    const html=offers.map(o=>`<div class="offer"><b>${world.countries[o.from]?.plName||'Dyplomacja'}</b><p>${o.text}</p><div class="offer-btns"><button class="btn" data-offer-id="${o.id}" data-answer="yes">Przyjmij</button><button class="btn" data-offer-id="${o.id}" data-answer="no">Odrzuć</button></div></div>`).join('');
    if(root.innerHTML!==html)root.innerHTML=html;
  }
  $('#offers').onclick=e=>{const b=e.target.closest('[data-offer-id]');if(!b)return;const msg=answerOffer(G,+b.dataset.offerId,b.dataset.answer==='yes');if(msg)log(G,msg);refreshAll();};
  cv.addEventListener('mouseleave',()=>{if(tip)tip.style.display='none';});

  let lastDay = -1, lastVer = -1;
  function frame() {
    if (G.day !== lastDay || G.version !== lastVer) {
      lastDay = G.day;
      lastVer = G.version;
      refreshAll();
    }
  }

  return { refreshAll, frame, openFullDiplo, setProvTab };
}
