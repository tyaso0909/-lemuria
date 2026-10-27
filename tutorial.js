/* =========================================================================
   チュートリアル（tutorial.js）2026-10-27 【仮採用・ディレクター案】
   本物の戦闘画面を使い、台本どおりに敵を出しながら、吹き出しで操作を案内する。
   - 説明を読んでいる間は時間が止まる（G.hold）。灯台は倒れない（game.js の scripted）。
   - 最初の5人（剣士・盾兵・弓兵・炎の魔法使い・ヒーラー）で行う。
   - Tutorial.start({ onDone }) で開始。とばしても onDone を呼ぶ（もう一度はふりかえりから）。
   ========================================================================= */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const Y = () => window.__yume;
  const DECK = ['swordsman', 'guardian', 'archer', 'mage', 'healer'];
  const LIGHTHOUSE = { x: 40, y: 96, w: 112, h: 520 }; // stage px

  // wait: 'tap' = tap to continue (time stops) / 'summon:<kind>' = summon it (time stops) / 'clear' = defeat every nightmare (time runs)
  const STEPS = [
    { wait: 'tap', target: LIGHTHOUSE, text: 'ここは灯台「追憶の灯」の前。夜の海から、<b>ナイトメア</b>がやってくる。' },
    { wait: 'tap', target: '.hp-box', text: '左上は<b>灯の耐久</b>。ナイトメアが灯台に届くと減っていき、0になると灯が消えて負けになる。' },
    { wait: 'tap', spawn: [['shade', 2, 1.8]], text: 'ナイトメアが近づいてくる。<b>夢の住人</b>を呼んで、迎え撃とう。' },
    { wait: 'summon:swordsman', target: '#card-swordsman', text: '画面下の<b>カード</b>をタップすると、エネルギーを使って夢の住人を召喚できる。<b>剣士</b>を呼んでみよう。' },
    { wait: 'clear', text: '住人は自分で前に出て、ナイトメアと戦う。見守ろう。' },
    { wait: 'tap', target: '.energy', text: '<b>エネルギー</b>は時間とともにたまっていく。カードの左上の数字が、召喚に必要なエネルギー。' },
    { wait: 'summon:archer', target: '#card-archer', spawn: [['shade', 3, 1.4], ['runner', 1, 1]], text: '次は<b>弓兵</b>。前衛の後ろから矢を射って、離れた敵を倒す。呼んでみよう。' },
    { wait: 'clear', text: '一度呼んだカードは、しばらく使えない（<b>再使用時間</b>）。エネルギーが足りないときは、たまるのを待とう。' },
    { wait: 'tap', target: ['#speedSeg', '#pauseBtn'], low: true, text: '右上では、ゲームの<b>速さ</b>（×1・×2・×3）を変えたり、<b>一時停止</b>したりできる。' },
    { wait: 'clear', spawn: [['shade', 4, 1.2], ['swarm', 4, 0.4], ['runner', 2, 2]], text: '最後の練習。カードを自由に使って、灯を守ろう。' },
    { wait: 'tap', text: '本番では、10ウェーブごとに大きなナイトメア（<b>ボス</b>）が現れる。ボスを倒して階層を越えると、<b>灯の祝福</b>を1つ選べる。' },
    { wait: 'tap', text: '戦いのあとに手に入る<b>夢の結晶</b>で、能力ガチャ・交換所・編成を使える。編成画面では、住人を<b>長押し</b>すると詳しく見られる。' },
    { wait: 'tap', text: 'これでチュートリアルはおしまい。灯を頼んだ。' },
  ];

  const coach = $('coach'), ring = $('coachRing'), bubble = $('coachBubble'), textEl = $('coachText'), foot = $('coachFoot');
  let active = false, ending = false, i = 0, opts = {}, base = 0, raf = 0, armed = 0, stepT = 0;

  // an element's box in stage coordinates (works while the stage is scaled / rotated)
  function boxOf(el) {
    let x = 0, y = 0, n = el; const stage = $('stage');
    while (n && n !== stage) { x += n.offsetLeft; y += n.offsetTop; n = n.offsetParent; }
    return { x, y, w: el.offsetWidth, h: el.offsetHeight };
  }
  function targetBox(t) {
    if (!t) return null;
    if (typeof t === 'object' && !Array.isArray(t)) return t;
    const list = (Array.isArray(t) ? t : [t]).map((s) => document.querySelector(s)).filter(Boolean).map(boxOf);
    if (!list.length) return null;
    const x = Math.min(...list.map((b) => b.x)), y = Math.min(...list.map((b) => b.y));
    return { x, y, w: Math.max(...list.map((b) => b.x + b.w)) - x, h: Math.max(...list.map((b) => b.y + b.h)) - y };
  }
  const count = (k) => Y().state.allies.filter((a) => !a.dead && a.kind === k).length;
  const cleared = (G) => G.spawnQueue.length === 0 && G.enemies.every((e) => e.dead);

  function enter(n) {
    const G = Y().state; if (!G) return;
    i = n; const S = STEPS[i]; stepT = G.waveTime;
    G.tutStep = i / (STEPS.length - 1);
    for (const [k, num, gap] of S.spawn || []) Y().tutorial.spawn(k, num, gap);
    const wait = S.wait, summonK = wait.startsWith('summon:') ? wait.slice(7) : null;
    G.hold = wait === 'tap' || !!summonK;
    if (summonK) { G.energy = Math.max(G.energy, Y().costOf(summonK)); G.cd[summonK] = 0; base = count(summonK); }
    textEl.innerHTML = S.text;
    foot.textContent = wait === 'tap' ? 'タップで次へ' : summonK ? 'カードをタップ' : 'ナイトメアを退けよう';
    foot.className = 'coach-foot' + (wait === 'tap' ? '' : ' wait');
    const b = targetBox(S.target);
    ring.className = 'coach-ring' + (b ? ' pulse' : ' none') + (wait === 'clear' ? ' clear' : '');
    if (b) Object.assign(ring.style, { left: (b.x - 8) + 'px', top: (b.y - 8) + 'px', width: (b.w + 16) + 'px', height: (b.h + 16) + 'px' });
    bubble.classList.toggle('low', !!S.low);
    coach.classList.toggle('block', wait === 'tap');
    armed = performance.now() + 350; // a quick double tap does not skip two steps
  }
  function poll() {
    if (!active) { raf = 0; return; }
    const G = Y().state;
    if (G && G.scripted) {
      const w = STEPS[i].wait;
      if (w.startsWith('summon:') && count(w.slice(7)) > base) enter(i + 1);
      else if (w === 'clear') {
        if (cleared(G)) { if (!G.clearAt) G.clearAt = performance.now() + 900; else if (performance.now() >= G.clearAt) { G.clearAt = 0; enter(i + 1); } }
        else {
          // nobody on the field for a while: point at the cards. A step that drags on ends by itself (the rest fade away)
          const t = G.waveTime - stepT, none = !G.allies.some((a) => !a.dead && !a.summoned);
          const hint = none && t > 5 ? 'カードをタップして、住人を呼ぼう' : 'ナイトメアを退けよう';
          if (foot.textContent !== hint) foot.textContent = hint;
          if (t > 40) { for (const e of G.enemies) if (!e.dead) { e.dead = 0.0001; e.hp = 0; e.popped = true; } G.spawnQueue.length = 0; }
        }
      }
    }
    raf = requestAnimationFrame(poll);
  }
  coach.addEventListener('click', (e) => {
    if (!active || e.target === $('coachSkip') || STEPS[i].wait !== 'tap' || performance.now() < armed) return;
    try { Sound.play('click'); } catch (er) { /* ignore */ }
    if (i >= STEPS.length - 1) finish(); else enter(i + 1);
  });
  $('coachSkip').addEventListener('click', (e) => { e.stopPropagation(); if (active) finish(); });

  function start(o) {
    opts = o || {}; active = true; ending = false;
    Y().tutorial.start(DECK);
    coach.hidden = false;
    enter(0);
    if (!raf) raf = requestAnimationFrame(poll);
  }
  function hide() { active = false; coach.hidden = true; coach.classList.remove('block'); }
  function finish() {
    ending = true; hide();
    Y().tutorial.end();
    ending = false;
    const cb = opts.onDone; opts = {};
    if (cb) cb();
  }
  // leaving from the pause menu: the tutorial stops (it is not counted as done)
  function abort() { if (ending || !active) return; hide(); opts = {}; }

  window.Tutorial = { start, abort, get active() { return active; }, STEPS };
})();
