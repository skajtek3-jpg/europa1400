// Punkt wejścia: pętla gry, test hooks
import { loadWorld } from './data.mjs';
import { createGame, tick, dateOf, countryArmies, warScore } from './game.mjs';
import { createRenderer } from './render.mjs';
import { initUI, buildStartScreen } from './ui.mjs';
import { createAudio } from './audio.mjs';
import * as gameApi from './game.mjs';

const world = await loadWorld().catch(error => {
  document.getElementById('start-countries').textContent = 'Nie udało się wczytać mapy. Otwórz GRA.html lub uruchom serve.py. ' + error.message;
  throw error;
});
const R = createRenderer(world);
let G = null, UI = null;
const sound = createAudio();

function start(countryId) {
  G = createGame(world, countryId);
  G.sound = sound;
  UI = initUI(G, R, world, {});
  G.ui = UI;
  if (sound) sound.start();
  UI.refreshAll();
}

buildStartScreen(world, R, start);

let last = performance.now(), acc = 0;
const FRAME = 1 / 30;
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.25, (now - last) / 1000);
  last = now;
  acc += dt;
  while (acc >= FRAME) {
    if (G) tick(G, FRAME * 1000);
    acc -= FRAME;
  }
  if (G) {
    R.render(G);
    UI.frame();
    for (const ev of G.events) {
      if (!ev.played) {
        ev.played = true;
        if (G.sound) {
          if (ev.kind === 'peace') G.sound.fx('peace');
          else if (ev.text && ev.text.includes('zajęcie')) G.sound.fx('siege');
          else if (ev.kind === 'war' || (ev.text && ev.text.startsWith('Bitwa pod'))) G.sound.fx('battle');
        }
      }
    }
  } else {
    R.render({ version: -1, armies: [], day: 0, player: -1, truces: [] });
  }
}
requestAnimationFrame(loop);

window.advanceTime = ms => {
  const steps = Math.max(1, Math.round(ms / 33));
  for (let i = 0; i < steps; i++) if (G) tick(G, 33);
  if (G) { R.render(G); UI.frame(); }
};
window.render_game_to_text = () => {
  if (!G) return JSON.stringify({ phase: 'start-screen' });
  const c = world.countries[G.player];
  return JSON.stringify({
    phase: 'game',
    player: c.plName,
    date: dateOf(G.day).str,
    speed: G.speed,
    gold: Math.round(c.gold),
    manpower: Math.round(c.manpower),
    provinces: c.provs.length,
    armies: countryArmies(G, G.player).map(a => ({
      id: a.id, prov: world.prov[a.prov].name, size: Math.round(a.size),
      morale: +a.morale.toFixed(2), moving: a.path ? a.path.map(p => world.prov[p].name) : null,
    })),
    wars: G.wars.filter(w => w.att.includes(G.player) || w.def.includes(G.player)).map(w => ({
      enemy: world.countries[w.att.includes(G.player) ? w.lead.d : w.lead.a].plName,
      score: Math.round(warScore(G, w, G.player)),
    })),
    occupations: world.prov.filter(p=>p && p.owner!==p.controller).map(p=>({prov:p.name,owner:world.countries[p.owner].plName,controller:world.countries[p.controller].plName})),
    selected: R.selected ? world.prov[R.selected].name : null,
    note: 'współrzędne: siatka 1200x799; (0,0)=lewy górny (płn-zach); x→wschód, y→południe; 1 komórka≈5-7 km',
  });
};
window.__setSpeed = s => { if (G) G.speed = s; };
window.__game = () => G;
window.__world = world;
window.__R = R;
window.__test = {
  move(armyId, provName) {
    if (!G) return 'no game';
    const a = G.armies.find(x => x.id === armyId);
    const p = world.prov.find(q => q && q.name === provName);
    if (!a || !p) return 'brak armii/prowincji';
    return gameApi.playerMoveArmy(G, a, p.id) ? 'ok' : 'brak drogi';
  },
  armyAt(provName) {
    if (!G) return [];
    const p = world.prov.find(q => q && q.name === provName);
    if (!p) return [];
    return G.armies.filter(a => a.prov === p.id).map(a => ({ id: a.id, size: Math.round(a.size), country: world.countries[a.country].plName, moving: !!a.path }));
  },
  split(armyId) {
    if (!G) return 'no game';
    const a = G.armies.find(x => x.id === armyId);
    const n = gameApi.playerSplitArmy(G, a);
    return n ? { a: Math.round(a.size), b: Math.round(n.size), newId: n.id } : 'nie można';
  },
  merge(provName) {
    if (!G) return 'no game';
    const p = world.prov.find(q => q && q.name === provName);
    const m = p && gameApi.playerMergeArmies(G, p.id);
    return m ? { id: m.id, size: Math.round(m.size) } : 'nie można';
  },
  peace(provinces, gold) {
    if (!G) return 'no game';
    const w = G.wars[0]; if (!w) return 'brak wojny';
    return gameApi.playerPeaceDemand(G, w, provinces.map(n => ({ pid: world.prov.find(q => q && q.name === n).id, to: G.player })), gold || 0);
  },
};
