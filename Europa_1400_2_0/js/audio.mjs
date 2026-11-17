// Proceduralny ambient (Web Audio) — dudy/nuty, bez plików zewnętrznych
export function createAudio() {
  let ctx = null, master = null, on = true, timer = null;
  const scale = [220, 246.94, 261.63, 293.66, 329.63, 392, 440, 493.88, 523.25];
  function pluck(freq, t, vol = 0.12) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'triangle'; o.frequency.value = freq;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, t + 1.6);
    o.connect(g).connect(master);
    o.start(t); o.stop(t + 1.7);
  }
  function drone(t) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sawtooth'; o.frequency.value = 55;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 160;
    g.gain.setValueAtTime(0.05, t);
    o.connect(f).connect(g).connect(master);
    o.start(t); o.stop(t + 8);
  }
  function schedule() {
    if (!ctx || !on) return;
    const t = ctx.currentTime + 0.1;
    if (Math.random() < 0.3) drone(t);
    const n = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      pluck(scale[Math.floor(Math.random() * scale.length)], t + i * (0.5 + Math.random() * 0.4), 0.06 + Math.random() * 0.05);
    }
    timer = setTimeout(schedule, 2600 + Math.random() * 2400);
  }
  return {
    start() {
      if (ctx) return;
      try {
        ctx = new (window.AudioContext || window.webkitAudioContext)();
        master = ctx.createGain(); master.gain.value = 0.5; master.connect(ctx.destination);
        schedule();
      } catch { /* audio niedostępne */ }
    },
    toggle() { on = !on; if (master) master.gain.value = on ? 0.5 : 0; if(timer){clearTimeout(timer);timer=null;} if(on&&ctx){ctx.resume().catch(()=>{});schedule();} return on; },
    fx(kind) {
      if (!ctx || !on) return;
      const t = ctx.currentTime;
      if (kind === 'battle') { pluck(110, t, 0.2); pluck(104, t + 0.12, 0.2); }
      if (kind === 'siege') { pluck(82, t, 0.22); }
      if (kind === 'peace') { pluck(392, t, 0.14); pluck(523.25, t + 0.15, 0.14); pluck(659.25, t + 0.3, 0.14); }
    },
  };
}
