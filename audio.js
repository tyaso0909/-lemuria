/* 夢の境界線 — audio.js : WebAudioで合成する仮の効果音とオルゴール風BGM */
(function () {
  'use strict';
  let ac = null, master = null, sfxBus = null, musicBus = null, enabled = true, musicTimer = null, musicStep = 0;

  function init() {
    if (ac) { if (ac.state === 'suspended') ac.resume(); return; }
    try {
      ac = new (window.AudioContext || window.webkitAudioContext)();
      master = ac.createGain(); master.gain.value = enabled ? 0.8 : 0; master.connect(ac.destination);
      sfxBus = ac.createGain(); sfxBus.gain.value = 0.55; sfxBus.connect(master);
      musicBus = ac.createGain(); musicBus.gain.value = 0.16; musicBus.connect(master);
    } catch (e) { ac = null; }
  }
  function tone(freq, dur, type, vol, when, bus, slideTo) {
    if (!ac) return;
    const t = ac.currentTime + (when || 0);
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type || 'sine'; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(bus || sfxBus); o.start(t); o.stop(t + dur + 0.05);
  }
  let noiseBuf = null;
  function noise(dur, vol, freq, when) {
    if (!ac) return;
    if (!noiseBuf) { noiseBuf = ac.createBuffer(1, ac.sampleRate * 0.5, ac.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
    const t = ac.currentTime + (when || 0);
    const s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
    s.buffer = noiseBuf; f.type = 'bandpass'; f.frequency.value = freq || 1200; f.Q.value = 0.8;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(sfxBus); s.start(t); s.stop(t + dur + 0.02);
  }
  // rate-limit frequent sounds
  const last = {};
  function gate(k, ms) { const n = performance.now(); if (last[k] && n - last[k] < ms) return false; last[k] = n; return true; }

  const S = {
    summon() { tone(660, 0.25, 'triangle', 0.25); tone(990, 0.35, 'sine', 0.18, 0.06); tone(1320, 0.4, 'sine', 0.08, 0.12); },
    hit() { if (gate('hit', 45)) noise(0.08, 0.22, 1800); },
    shoot() { if (gate('shoot', 60)) tone(880, 0.08, 'triangle', 0.08, 0, null, 1400); },
    magic() { if (gate('magic', 80)) { tone(300, 0.3, 'sawtooth', 0.06, 0, null, 900); noise(0.25, 0.12, 600, 0.05); } },
    heal() { if (gate('heal', 120)) { tone(1046, 0.25, 'sine', 0.08); tone(1318, 0.3, 'sine', 0.06, 0.05); } },
    kill() { if (gate('kill', 50)) tone(1568, 0.5, 'sine', 0.07); },
    allyDown() { tone(392, 0.4, 'triangle', 0.1, 0, null, 220); },
    tower() { if (gate('tower', 220)) { tone(110, 0.3, 'sine', 0.35, 0, null, 70); noise(0.15, 0.15, 400); } },
    wave() { tone(392, 0.6, 'triangle', 0.18); tone(523, 0.8, 'triangle', 0.16, 0.18); },
    boss() { tone(73, 1.4, 'sawtooth', 0.22, 0, null, 55); tone(110, 1.4, 'square', 0.06, 0.1); noise(0.8, 0.25, 200, 0.05); },
    slam() { tone(80, 0.5, 'sine', 0.45, 0, null, 40); noise(0.4, 0.35, 300); },
    dash() { if (gate('dash', 120)) { noise(0.18, 0.18, 2600); tone(1200, 0.15, 'triangle', 0.06, 0, null, 500); } },
    deny() { if (gate('deny', 150)) tone(180, 0.12, 'square', 0.06); },
    win() { [523, 659, 784, 1046, 1318].forEach((f, i) => tone(f, 0.9, 'triangle', 0.14, i * 0.14)); },
    lose() { [440, 392, 349, 262].forEach((f, i) => tone(f, 0.9, 'triangle', 0.12, i * 0.25)); },
    blast() { if (gate('blast', 90)) { tone(150, 0.35, 'sine', 0.3, 0, null, 60); noise(0.3, 0.3, 700); } },
    bell() { if (gate('bell', 300)) { tone(1480, 1.1, 'sine', 0.12); tone(2220, 0.8, 'sine', 0.06, 0.01); tone(990, 1.3, 'triangle', 0.05); } },
    spit() { if (gate('spit', 90)) { noise(0.08, 0.12, 900); tone(320, 0.1, 'triangle', 0.05, 0, null, 180); } },
    song() { if (gate('song', 400)) { const b = [523, 659, 784, 880][(Math.random() * 4) | 0]; tone(b, 0.35, 'triangle', 0.06); tone(b * 1.5, 0.4, 'sine', 0.035, 0.08); } },
    tick() { if (gate('tick', 50)) tone(1700 + Math.random() * 500, 0.04, 'square', 0.025); },
    reveal() { tone(880, 0.3, 'triangle', 0.14); tone(1320, 0.35, 'sine', 0.08, 0.05); },
    epic() { [784, 988, 1318].forEach((f, i) => tone(f, 0.5, 'triangle', 0.13, i * 0.07)); },
    legend() { [659, 880, 1046, 1318, 1760].forEach((f, i) => tone(f, 0.9, 'triangle', 0.13, i * 0.08)); noise(0.6, 0.08, 6000, 0.1); },
    zap() { if (gate('zap', 90)) { noise(0.12, 0.2, 3800); tone(1800, 0.12, 'square', 0.04, 0, null, 600); } },
    snipe() { if (gate('snipe', 120)) { noise(0.16, 0.32, 1500); tone(220, 0.25, 'sine', 0.18, 0, null, 90); } },
    leap() { if (gate('leap', 200)) { noise(0.22, 0.12, 2200); tone(500, 0.22, 'triangle', 0.06, 0, null, 1200); } },
    toss() { if (gate('toss', 120)) { tone(420, 0.18, 'triangle', 0.06, 0, null, 760); noise(0.1, 0.06, 3000); } },
    pop() { if (gate('pop', 55)) { noise(0.05, 0.16, 2400); tone(900, 0.04, 'square', 0.03); } },
    click() { tone(1200, 0.06, 'sine', 0.08); },
  };

  // music box loop — quiet pentatonic phrase over a slow bass
  const MEL = [76, 79, 81, 84, 81, 79, 76, 74, 72, 74, 76, 79, 76, 74, 72, 69];
  const BASS = [45, 45, 41, 41, 43, 43, 40, 40];
  const midi = (m) => 440 * Math.pow(2, (m - 69) / 12);
  function musicTick() {
    if (!ac || !enabled) return;
    const i = musicStep++;
    const m = MEL[i % MEL.length];
    if (i % 4 !== 3 || Math.random() < 0.5) tone(midi(m), 1.2, 'sine', 0.22, 0, musicBus);
    if (i % 2 === 0) tone(midi(BASS[(i >> 1) % BASS.length]), 2.2, 'triangle', 0.18, 0, musicBus);
  }
  function startMusic() { stopMusic(); musicTimer = setInterval(musicTick, 460); }
  function stopMusic() { if (musicTimer) clearInterval(musicTimer); musicTimer = null; }

  function setEnabled(v) { enabled = v; if (master) master.gain.value = v ? 0.8 : 0; }

  window.Sound = { init, play: (k) => { if (ac && enabled && S[k]) S[k](); }, startMusic, stopMusic, setEnabled, get enabled() { return enabled; } };
})();
