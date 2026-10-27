/* =========================================================================
   ストーリーの再生（vn.js）2026-10-27
   - story.js の window.STORY_TEXT を読み、章ごとに再生する（書き方は story.js の先頭に）
   - タイトル「TAP TO START」→ 初回はプロローグ →（[チュートリアル] の行で）チュートリアル → 続き → メニュー
   - ふりかえり画面：読んだ章とチュートリアルをもう一度
   ========================================================================= */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const A = window.Abilities;

  // ---------------------------------------------------------------- parse
  const BG_NAMES = { 灯台: 'tower', 海: 'sea', 工房: 'shop', 夜空: 'sky', 黒: 'black', 暗闇: 'black' };
  const SFX = { 警報: 'boss', 鐘: 'bell', 召喚: 'summon', 決定: 'click', 波: 'wave' };
  // images registered in the scenario editor (story.js: window.STORY_IMAGES = { 名前: { kind: 'bg'|'char', src, who } })
  const IMG = window.STORY_IMAGES || {};
  const POS = ['左', '中央', '右'], POSX = { 左: 25, 中央: 50, 右: 75 };
  function parse(text) {
    const chapters = [];
    let ch = null;
    const lines = String(text || '').replace(/\r/g, '').split('\n');
    for (let raw of lines) {
      const line = raw.trim();
      if (!line || line.startsWith('//')) continue;
      const h = line.match(/^[#＃]\s*(.+)$/);
      if (h) { ch = { title: h[1].trim(), unlock: null, lines: [] }; chapters.push(ch); continue; }
      if (!ch) { ch = { title: 'プロローグ', unlock: null, lines: [] }; chapters.push(ch); }
      const d = line.match(/^[\[［]\s*(.+?)\s*[\]］]$/);
      if (d) {
        const [key, ...rest] = d[1].split(/[\s　：:]+/); const arg = rest.join(' ');
        if (key === '背景') { if (BG_NAMES[arg]) ch.lines.push({ t: 'bg', bg: BG_NAMES[arg] }); else if (IMG[arg]) ch.lines.push({ t: 'bg', bg: 'img', src: IMG[arg].src }); }
        else if (key === '人物') { const m = IMG[rest[0]]; if (m) ch.lines.push({ t: 'char', src: m.src, who: m.who || '', pos: POS.includes(rest[1]) ? rest[1] : '中央' }); }
        else if (key === '人物を消す') ch.lines.push({ t: 'charoff', pos: POS.includes(rest[0]) ? rest[0] : '全員' });
        else if (key === '暗転') ch.lines.push({ t: 'fade' });
        else if (key === '揺れ') ch.lines.push({ t: 'shake' });
        else if (key === '音') { if (SFX[arg]) ch.lines.push({ t: 'sfx', name: SFX[arg] }); }
        else if (key === '待つ') ch.lines.push({ t: 'wait', sec: Math.min(10, parseFloat(arg.replace(/[^\d.]/g, '')) || 1) });
        else if (key === 'チュートリアル') ch.lines.push({ t: 'tutorial' });
        else if (key === '解放') { const n = parseInt(arg.replace(/[^\d]/g, ''), 10); if (n > 0) ch.unlock = n; }
        continue;
      }
      const text2 = (s) => s.replace(/\\n/g, '\n');
      let m = line.match(/^([^\s「」『』：:（）()]{1,12})([「『].*)$/);
      if (m) { ch.lines.push({ t: 'say', name: m[1], text: text2(m[2]) }); continue; }
      m = line.match(/^([^\s「」『』：:（）()]{1,12})[：:]\s*(.+)$/);
      if (m) { ch.lines.push({ t: 'say', name: m[1], text: text2(m[2]) }); continue; }
      ch.lines.push({ t: 'narr', text: text2(line) });
    }
    return chapters.filter((c) => c.lines.length);
  }
  const CHAPTERS = parse(window.STORY_TEXT);
  const nameClass = (n) => n === 'オルド' ? 'ordo' : /^[?？]+$/.test(n) ? 'who' : '';

  // ---------------------------------------------------------------- save
  function st() {
    const s = A.save;
    if (!s.story || typeof s.story !== 'object') s.story = { seen: {}, tut: false };
    if (!s.story.seen) s.story.seen = {};
    return s.story;
  }
  const best = () => (A.save.stats && A.save.stats.best) || 0;

  // ---------------------------------------------------------------- backgrounds
  const cv = $('vnCv'), ctx = cv.getContext('2d'), photo = $('vnPhoto'), fadeEl = $('vnFade');
  let bg = 'black', raf = 0, t0 = 0;
  const dust = Array.from({ length: 40 }, () => ({ x: Math.random() * 1280, y: Math.random() * 720, r: 1 + Math.random() * 2.2, s: 6 + Math.random() * 14, p: Math.random() * 6 }));
  const dots = Array.from({ length: 120 }, () => ({ x: Math.random() * 1280, y: Math.random() * 470, r: 0.6 + Math.random() * 1.6, p: Math.random() * 6 }));
  function drawShop(g, t) {
    let gr = g.createLinearGradient(0, 0, 0, 720); gr.addColorStop(0, '#120f22'); gr.addColorStop(1, '#07060f'); g.fillStyle = gr; g.fillRect(0, 0, 1280, 720);
    // round window with the moon
    g.save(); g.beginPath(); g.arc(980, 210, 120, 0, Math.PI * 2); g.clip();
    gr = g.createLinearGradient(0, 90, 0, 330); gr.addColorStop(0, '#1d2a5c'); gr.addColorStop(1, '#0b1233'); g.fillStyle = gr; g.fillRect(860, 90, 240, 240);
    g.fillStyle = '#f4ecd2'; g.beginPath(); g.arc(1020, 180, 34, 0, Math.PI * 2); g.fill();
    g.restore();
    g.strokeStyle = '#3a2c22'; g.lineWidth = 14; g.beginPath(); g.arc(980, 210, 120, 0, Math.PI * 2); g.stroke();
    g.lineWidth = 8; g.beginPath(); g.moveTo(860, 210); g.lineTo(1100, 210); g.moveTo(980, 90); g.lineTo(980, 330); g.stroke();
    // moonlight on the floor
    g.save(); g.globalAlpha = 0.10; g.fillStyle = '#c8d6ff'; g.beginPath(); g.moveTo(880, 300); g.lineTo(1080, 300); g.lineTo(900, 720); g.lineTo(520, 720); g.fill(); g.restore();
    // shelves and gears (silhouettes)
    g.fillStyle = '#0c0a16'; g.fillRect(80, 150, 360, 14); g.fillRect(80, 290, 360, 14); g.fillRect(70, 120, 16, 420); g.fillRect(434, 120, 16, 420);
    for (const [x, y, r] of [[150, 120, 26], [240, 130, 16], [340, 262, 22], [180, 262, 14]]) { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); }
    // workbench
    g.fillRect(560, 520, 600, 22); g.fillRect(590, 540, 18, 180); g.fillRect(1110, 540, 18, 180);
    // warm lamp
    const fl = 0.85 + Math.sin(t * 7) * 0.04 + Math.sin(t * 13) * 0.03;
    gr = g.createRadialGradient(300, 470, 10, 300, 470, 420); gr.addColorStop(0, `rgba(255,190,110,${0.42 * fl})`); gr.addColorStop(1, 'rgba(255,190,110,0)'); g.fillStyle = gr; g.fillRect(0, 0, 1280, 720);
    g.fillStyle = '#ffd89a'; g.beginPath(); g.arc(300, 470, 7, 0, Math.PI * 2); g.fill();
    for (const d of dust) { const y = (d.y - t * d.s) % 720; g.globalAlpha = 0.25 + 0.2 * Math.sin(t + d.p); g.fillStyle = '#ffe2b5'; g.beginPath(); g.arc(d.x, y < 0 ? y + 720 : y, d.r, 0, Math.PI * 2); g.fill(); }
    g.globalAlpha = 1;
    gr = g.createRadialGradient(640, 360, 300, 640, 360, 820); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,.65)'); g.fillStyle = gr; g.fillRect(0, 0, 1280, 720);
  }
  function drawSky(g, t) {
    const gr = g.createLinearGradient(0, 0, 0, 720); gr.addColorStop(0, '#070b24'); gr.addColorStop(0.7, '#141c4a'); gr.addColorStop(1, '#232a5e'); g.fillStyle = gr; g.fillRect(0, 0, 1280, 720);
    for (const d of dots) { g.globalAlpha = 0.35 + 0.45 * (0.5 + 0.5 * Math.sin(t * 1.3 + d.p)); g.fillStyle = '#e8eeff'; g.beginPath(); g.arc(d.x, d.y, d.r, 0, Math.PI * 2); g.fill(); }
    g.globalAlpha = 1; g.fillStyle = '#05081a'; g.fillRect(0, 600, 1280, 120);
  }
  function tick(ts) {
    if (!open) { raf = 0; return; }
    const t = (ts - t0) / 1000;
    if (bg === 'sea' && window.Art) {
      const k = (window.__yume && window.__yume.tutorial && window.__yume.tutorial.renderK) || 1;
      if (cv.width !== Math.round(1280 * k)) { cv.width = Math.round(1280 * k); cv.height = Math.round(720 * k); }
      ctx.setTransform(k, 0, 0, k, 0, 0);
      Art.drawBackground(ctx, t, k); Art.drawLighthouse(ctx, t, 1, 0, 0);
    } else {
      if (cv.width !== 1280) { cv.width = 1280; cv.height = 720; }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      if (bg === 'shop') drawShop(ctx, t);
      else if (bg === 'sky') drawSky(ctx, t);
      else { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 1280, 720); }
    }
    stepText(t);
    raf = requestAnimationFrame(tick);
  }
  const bgImg = $('vnBgImg'), charsEl = $('vnChars');
  function setBg(name, src) {
    bg = name; photo.classList.toggle('on', name === 'tower');
    if (name === 'img' && src) { bgImg.style.backgroundImage = `url("${src}")`; bgImg.classList.add('on'); } else bgImg.classList.remove('on');
  }
  function setChar(pos, src, who) {
    let img = charsEl.querySelector(`img[data-pos="${pos}"]`);
    if (!img) { img = document.createElement('img'); img.alt = ''; img.dataset.pos = pos; img.style.left = POSX[pos] + '%'; charsEl.appendChild(img); }
    img.dataset.who = who || ''; img.src = src; requestAnimationFrame(() => img.classList.add('on'));
  }
  function clearChar(pos) { for (const img of charsEl.querySelectorAll('img')) if (pos === '全員' || img.dataset.pos === pos) { img.classList.remove('on'); setTimeout(() => img.remove(), 360); } }
  function focusSpeaker(name) {
    const imgs = [...charsEl.querySelectorAll('img')], any = imgs.some((i) => i.dataset.who && i.dataset.who === name);
    for (const i of imgs) i.classList.toggle('dim', !!name && any && i.dataset.who !== name);
  }

  // ---------------------------------------------------------------- player
  const scr = $('vnScreen'), box = $('vnBox'), nameEl = $('vnName'), textEl = $('vnText'), logEl = $('vnLog'), logList = $('vnLogList');
  let open = false, cur = null, idx = 0, opts = {}, shown = 0, full = '', lastT = 0, autoOn = false, autoAt = 0, waitUntil = 0, busy = false;
  const CPS = 42; // characters per second
  function play(chapter, o) {
    cur = chapter; idx = 0; opts = o || {}; open = true; busy = false;
    logList.innerHTML = ''; logEl.hidden = true; autoOn = false; $('vnAutoBtn').classList.remove('on');
    $('vnChap').textContent = chapter.title; setBg('black'); charsEl.innerHTML = ''; fadeEl.classList.remove('on');
    nameEl.textContent = ''; textEl.textContent = ''; box.classList.remove('done');
    scr.hidden = false;
    if (!raf) { t0 = performance.now(); raf = requestAnimationFrame(tick); }
    next();
  }
  function resume() { scr.hidden = false; open = true; busy = false; if (!raf) { t0 = performance.now(); raf = requestAnimationFrame(tick); } next(); }
  function close(done) {
    open = false; scr.hidden = true; scr.classList.remove('shake');
    const cb = opts.onDone; opts = {}; cur = null;
    if (done && cb) cb();
  }
  function next() {
    if (!cur || busy) return;
    while (idx < cur.lines.length) {
      const L = cur.lines[idx++];
      if (L.t === 'bg') { setBg(L.bg, L.src); continue; }
      if (L.t === 'char') { setChar(L.pos, L.src, L.who); continue; }
      if (L.t === 'charoff') { clearChar(L.pos); continue; }
      if (L.t === 'sfx') { try { Sound.play(L.name); } catch (e) { /* ignore */ } continue; }
      if (L.t === 'shake') { scr.classList.remove('shake'); void scr.offsetWidth; scr.classList.add('shake'); continue; }
      if (L.t === 'fade') { busy = true; fadeEl.classList.add('on'); setTimeout(() => { fadeEl.classList.remove('on'); busy = false; next(); }, 650); return; }
      if (L.t === 'wait') { show('', '', false); waitUntil = performance.now() + L.sec * 1000; return; }
      if (L.t === 'tutorial') {
        if (opts.first && opts.onTutorial) { scr.hidden = true; open = false; opts.onTutorial(resume); return; }
        continue; // (in ふりかえり the battle is skipped)
      }
      show(L.t === 'say' ? L.name : '', L.text, L.t === 'narr');
      return;
    }
    close(true);
  }
  function show(name, text, narr) {
    waitUntil = 0;
    nameEl.textContent = name || ''; nameEl.className = 'vn-name ' + nameClass(name || ''); focusSpeaker(name || '');
    textEl.classList.toggle('narr', !!narr); full = text; shown = 0; textEl.textContent = ''; box.classList.remove('done');
    if (text) { const p = document.createElement('p'); p.className = narr ? 'narr' : nameClass(name || ''); p.innerHTML = (name ? `<b>${esc(name)}</b>` : '') + esc(text); logList.appendChild(p); }
  }
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function stepText(t) {
    const dt = Math.min(0.1, t - lastT); lastT = t;
    if (waitUntil) { if (performance.now() >= waitUntil) { waitUntil = 0; next(); } return; }
    if (shown < full.length) {
      shown = Math.min(full.length, shown + dt * CPS);
      textEl.textContent = full.slice(0, Math.floor(shown));
      if (shown >= full.length) { box.classList.add('done'); autoAt = performance.now() + 1100 + full.length * 45; }
    } else if (autoOn && full && performance.now() >= autoAt && logEl.hidden) { next(); }
  }
  function advance() {
    if (!open || busy || !logEl.hidden) return;
    if (waitUntil) { waitUntil = 0; next(); return; }
    if (shown < full.length) { shown = full.length; textEl.textContent = full; box.classList.add('done'); autoAt = performance.now() + 1100 + full.length * 45; return; }
    try { Sound.play('click'); } catch (e) { /* ignore */ }
    next();
  }
  function skip() {
    if (!cur) return;
    // the first time through, the tutorial marker is not skipped (it is the first battle)
    if (opts.first) { const ti = cur.lines.findIndex((L, i) => i >= idx && L.t === 'tutorial'); if (ti >= 0) { idx = ti; full = ''; shown = 0; next(); return; } }
    idx = cur.lines.length; full = ''; next();
  }
  scr.addEventListener('click', (e) => { if (e.target.closest('.vn-bar') || e.target.closest('.vn-log')) return; advance(); });
  $('vnSkipBtn').addEventListener('click', (e) => { e.stopPropagation(); skip(); });
  $('vnAutoBtn').addEventListener('click', (e) => { e.stopPropagation(); autoOn = !autoOn; e.currentTarget.classList.toggle('on', autoOn); autoAt = performance.now() + 600; });
  $('vnLogBtn').addEventListener('click', (e) => { e.stopPropagation(); logEl.hidden = false; logList.scrollTop = logList.scrollHeight; });
  $('vnLogClose').addEventListener('click', (e) => { e.stopPropagation(); logEl.hidden = true; });
  window.addEventListener('keydown', (e) => {
    if (!open) return;
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowRight') { e.preventDefault(); e.stopImmediatePropagation(); advance(); }
    else if (e.key === 'Escape') { e.stopImmediatePropagation(); if (!logEl.hidden) logEl.hidden = true; }
  }, true);

  // ---------------------------------------------------------------- flow
  const title = $('titleScreen');
  let flowBusy = false;
  function runTutorial(after) {
    if (!window.Tutorial) { after && after(); return; }
    window.Tutorial.start({
      onDone() { st().tut = true; A.persist(); after && after(); },
    });
  }
  function firstRun() {
    const first = CHAPTERS[0], S = st();
    if (first && !S.seen[first.title]) {
      flowBusy = true;
      play(first, {
        first: true,
        onTutorial(resumeStory) { runTutorial(() => { resumeStory(); }); },
        onDone() {
          S.seen[first.title] = true; A.persist(); flowBusy = false;
          if (!S.tut) runTutorial(() => checkUnlocks()); else checkUnlocks();
        },
      });
      return;
    }
    if (!S.tut) { runTutorial(() => checkUnlocks()); return; }
    checkUnlocks();
  }
  // a chapter with [解放 N] plays once, the first time the player comes back to the menu after reaching wave N
  function checkUnlocks() {
    if (open || flowBusy || (window.__yume && window.__yume.state) || title.hidden || title.classList.contains('tap-mode')) return;
    const S = st();
    const ch = CHAPTERS.find((c, i) => i > 0 && c.unlock && best() >= c.unlock && !S.seen[c.title]);
    if (!ch) return;
    play(ch, { onDone() { S.seen[ch.title] = true; A.persist(); } });
  }
  function startTap() {
    if (!title.classList.contains('tap-mode')) return;
    try { Sound.init(); Sound.play('click'); } catch (e) { /* ignore */ }
    title.classList.remove('tap-mode');
    if (window.Menu) window.Menu.refresh();
    firstRun();
  }
  $('tapStart').addEventListener('click', startTap);
  window.addEventListener('keydown', (e) => { if (title.classList.contains('tap-mode') && !title.hidden && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); startTap(); } });
  // returning to the menu checks for newly unlocked chapters
  if (window.Menu) {
    const show0 = window.Menu.show;
    window.Menu.show = function (id) { show0(id); if (id === 'titleScreen') setTimeout(checkUnlocks, 300); };
  }

  // ---------------------------------------------------------------- ふりかえり
  function renderReplay() {
    const S = st(), list = $('rpList');
    list.innerHTML = '';
    CHAPTERS.forEach((c, i) => {
      const ok = S.seen[c.title] || (i > 0 && (!c.unlock || best() >= c.unlock));
      const b = document.createElement('button'); b.type = 'button'; b.className = 'rp-item'; b.disabled = !ok;
      b.innerHTML = `<i></i><b>${esc(c.title)}</b><span>${ok ? (S.seen[c.title] ? '読んだ物語' : 'まだ読んでいない') : c.unlock ? `第${c.unlock}ウェーブ到達で解放` : 'まだ見ていない'}</span>`;
      if (ok) b.addEventListener('click', () => { try { Sound.play('click'); } catch (e) { /* ignore */ } play(c, { onDone() { S.seen[c.title] = true; A.persist(); renderReplay(); } }); });
      list.appendChild(b);
    });
    const t = document.createElement('button'); t.type = 'button'; t.className = 'rp-item tut';
    t.innerHTML = '<i></i><b>チュートリアル</b><span>最初の防衛戦をもう一度</span>';
    t.addEventListener('click', () => { try { Sound.play('click'); } catch (e) { /* ignore */ } runTutorial(() => window.Menu.show('replayScreen')); });
    list.appendChild(t);
  }
  $('replayBtn').addEventListener('click', () => { try { Sound.init(); Sound.play('click'); } catch (e) { /* ignore */ } window.Menu.show('replayScreen'); renderReplay(); });
  $('rpBack').addEventListener('click', () => { try { Sound.play('click'); } catch (e) { /* ignore */ } window.Menu.show('titleScreen'); });

  window.Story = { chapters: CHAPTERS, parse, play, get open() { return open; }, firstRun, renderReplay };
})();
