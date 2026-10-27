/* =========================================================================
   記憶のかけら（memories.js）2026-10-27
   倒したナイトメア（ボス）は光の粒となって消え、記憶のかけらだけが残る（【確定】倒したナイトメアは消滅し、記憶の断片だけが残る）。
   かけらを集めると、そのボスの記憶がメインメニューの「記憶のかけら」で読めるようになる。
     かけら1つ：名前・姿・登場の一言・見た目
     かけら2つ：夢の由来と、今の思い
     かけら3つ：記憶の物語（【未確定】文章はこれから。今は「まだ綴られていない」と出す）
   由来と見た目の文章はユーザーの深掘り（シナリオ仕様書「ボス14体の由来と見た目」【確定】2026-10-26）。
   ========================================================================= */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const A = window.Abilities;
  const Y = () => window.__yume;
  const NEED = [1, 2, 3];
  const NO_STORY = 'この記憶の物語は、まだ綴られていない。';

  // ---- the memories (order = the tier where each boss first appears)
  const MEM = {
    boss:     { look: '大きな体の前衛。胸にはひび割れた盾形の紋章。', origin: '幼い日に誰かが憧れたヒーロー像。忘れられたことで、憧れが恨みに変わった。' },
    snowman:  { look: 'バケツの帽子、人参の鼻、小枝の腕。くすんだラベンダー色の雪がインクのように溶け、傷つくほど崩れて垂れていく。', origin: '初雪の朝に「ずっと溶けないで」と願われた雪だるま。春に溶け、次の冬には思い出されなかった。' },
    friend:   { look: 'クレヨンで描いたような半透明の丸い影。顔はなく、かすかに光る目が二つだけ。恐ろしさより、寂しさと親しみを感じる姿。', origin: '幼い子が思い描き、一緒に遊び、おしゃべりしていたイマジナリーフレンド。その子が大人になって忘れ去られた今も、もう一度あの子と遊び、話したいと願っている。' },
    astro:    { look: '丸いヘルメット、暗いバイザー、色あせたクリーム色の宇宙服。背中に推進装置、切れた命綱。飾りは輪のある惑星と三日月とロケット。', origin: '宇宙飛行士に憧れた子の夢。もう一度、空へ昇りたがっている。' },
    postman:  { look: '封筒と便箋が重なった体。切手と消印の飾り。宛名はにじんで読めない。', origin: '言えなかった「ありがとう」「ごめんね」と、出されなかった手紙が集まった存在。一人の夢から生まれたものではない。' },
    wheel:    { look: 'スポークが抜け落ち、四分の一が欠けた外側の輪が傾いている。短い2本脚の台に載った姿。', origin: '家族で出かけた、あの日の遊園地の夢。あの時間へ戻りたがっている。' },
    batter:   { look: '泥で汚れたクリーム色のユニフォーム。無地の背番号「4」。テープを巻いた木のバット。', origin: '少年野球でプロを夢見たが、けがで野球をやめた子の夢。来なかった最後の打席を、今も待っている。' },
    witch:    { look: '古びた人形。色あせたピンクのフリル、ほつれたリボン、関節の継ぎ目、取れかけたボタンの目。ステッキはハートと三日月。', origin: '魔法少女の人形と変身ごっこをしていた女の子の夢。人形は箱にしまわれ、呪文も忘れられた。正しい呪文を思い出せず、魔法がみんな裏返る。' },
    siren:    { look: '尾びれと長い髪、泡の冠。全体に色あせ、悲しげな姿。', origin: '海の底で歌う、絵本の人魚姫。' },
    throne:   { look: 'くすんだ金と、あせた深紅。肩の形だけを残した中身のないローブ。王冠の下に頭はない。', origin: '王さまになりたかった子の夢。忘れられた夢だけの国を作ろうとしているが、残っているのは玉座だけ。' },
    dancer:   { look: '色あせたチュール、インクに染まったトウシューズ。背中から破れた緞帳を引きずる。', origin: '発表会の舞台を夢見たものの、その前に教室をやめた少女の夢。観客のいない舞台で、終わらない最後の演目を踊り続ける。' },
    clock:    { look: '振り子時計を核にした時計塔。中には丸まった子ども。文字盤は数字だけ。', origin: '「大人になりたくない」と枕に顔をうずめ、時計の針を止めた子どもの夢。その願いは忘れられたが、子どもは今も時計の中に隠れている。' },
    whale:    { look: '半透明の深い藍色。ひれの先だけ色あせた空色。体の中に夜空を思わせる丸い光が漂う。', origin: '空を飛ぶことを夢見た、多くの人の願い。誰も空を見上げなくなり、海の底へ沈んで鯨になった。' },
    // 灯を喰らうものの由来は灯台の真の機能に触れるので、ゲーム内ではまだ明かさない（【確定】序盤では明かさない）
    devourer: { look: '灯台を思わせる塔の体、割れた光輪、頂の灯室。さまざまな夢の色がくすんで混ざり、ひびから光が漏れる。', origin: null, sealed: 'この記憶は、まだ読み解けない。' },
  };
  const ORDER = Object.keys(MEM);
  // 記憶の物語: written in the scenario editor, reflected into story.js as window.MEMORY_STORIES = { kind: '文章' }
  const STORIES = window.MEMORY_STORIES || {};
  const storyOf = (k) => k === 'devourer' ? '' : String(STORIES[k] || '').trim(); // (灯を喰らうもの: not shown until the truth is revealed)
  const parasHtml = (t) => t.split(/\n\s*\n|\n/).map((x) => x.trim()).filter(Boolean).map((x) => `<p>${esc(x)}</p>`).join('');
  const tierOfBoss = (k) => { const E = Y().ENEMIES[k]; return E.final ? '第100ウェーブ' : `第${E.tier}階層から`; };

  // ---- save
  function mem() { const s = A.save; if (!s.memories || typeof s.memories !== 'object') s.memories = {}; return s.memories; }
  function gain(kind, wave) {
    if (!MEM[kind]) return null;
    const M = mem(), m = M[kind] || (M[kind] = { n: 0, first: wave, seen: 0 });
    m.n++; if (!m.first) m.first = wave;
    A.persist(); refreshDot();
    return m;
  }
  const unread = () => ORDER.some((k) => { const m = mem()[k]; return m && Math.min(3, m.n) > (m.seen || 0); });
  function refreshDot() { const b = $('memoryBtn'); if (b) b.classList.toggle('notify', unread()); }

  // ---- boss portraits: draw the battle sprite onto a scratch canvas, crop to what was drawn, fit into the card
  const scratch = document.createElement('canvas'); scratch.width = 900; scratch.height = 800;
  const cache = {};
  function portrait(kind) {
    if (cache[kind]) return cache[kind];
    const g = scratch.getContext('2d'); g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, 900, 800);
    const E = Y().ENEMIES[kind];
    try {
      Art.drawUnit(g, kind, 450, 640, -1, { anim: 1.2, walk: false, atk: 0, hurt: 0, wind: 0, phase: 1, hp: 1, maxHp: 1, reveal: 1, fly: !!E.flying, stance: 0, stanceOn: false, melt: 0 }, { enemy: true, noShadow: true });
    } catch (e) { /* a sprite that needs more state just shows less */ }
    const d = g.getImageData(0, 0, 900, 800).data;
    let x0 = 900, y0 = 800, x1 = 0, y1 = 0;
    for (let y = 0; y < 800; y += 2) for (let x = 0; x < 900; x += 2) if (d[(y * 900 + x) * 4 + 3] > 16) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    const out = document.createElement('canvas'); out.width = 360; out.height = 360;
    if (x1 > x0) {
      const w = x1 - x0 + 8, h = y1 - y0 + 8, k = Math.min(320 / w, 320 / h);
      out.getContext('2d').drawImage(scratch, x0 - 4, y0 - 4, w, h, 180 - w * k / 2, 344 - h * k, w * k, h * k);
    }
    return (cache[kind] = out);
  }
  function paint(canvas, kind, locked) {
    const g = canvas.getContext('2d'); g.clearRect(0, 0, canvas.width, canvas.height);
    const p = portrait(kind);
    g.save();
    if (locked) { g.filter = 'brightness(0) opacity(.55)'; }
    g.drawImage(p, 0, 0, canvas.width, canvas.height);
    g.restore();
  }

  // ---- screen
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const pips = (n) => NEED.map((t) => `<i class="${n >= t ? 'on' : ''}"></i>`).join('');
  function renderList() {
    const list = $('memList'), M = mem();
    const got = ORDER.filter((k) => M[k] && M[k].n > 0).length;
    $('memCount').textContent = `${got} / ${ORDER.length}`;
    list.innerHTML = '';
    for (const k of ORDER) {
      const m = M[k], E = Y().ENEMIES[k], has = !!(m && m.n > 0);
      const b = document.createElement('button'); b.type = 'button'; b.className = 'mem-card' + (has ? '' : ' locked') + (has && Math.min(3, m.n) > (m.seen || 0) ? ' new' : '');
      b.innerHTML = `<canvas width="180" height="180"></canvas><b>${has ? esc(E.name) : '？？？'}</b><span class="pips">${pips(has ? m.n : 0)}</span>`;
      paint(b.querySelector('canvas'), k, !has);
      if (has) b.addEventListener('click', () => { try { Sound.play('click'); } catch (e) { /* ignore */ } openDetail(k); });
      else b.disabled = true;
      list.appendChild(b);
    }
  }
  function openDetail(k) {
    const M = mem(), m = M[k], E = Y().ENEMIES[k], D = MEM[k], n = m.n;
    const sec = (need, title, body) => n >= need ? `<section><h4>${title}</h4>${body}</section>` : `<section class="sealed"><h4>${title}</h4><p>記憶のかけらが${need}つ集まると読める（あと${need - n}つ）</p></section>`;
    const origin = D.origin ? `<p>${esc(D.origin)}</p>` : `<p class="u-none">${esc(D.sealed)}</p>`;
    const el = $('memDetail');
    el.innerHTML = `
      <div class="mem-sheet">
        <aside><canvas width="300" height="300"></canvas><h3>${esc(E.name)}</h3><div class="pips big">${pips(n)}</div><div class="mem-k">記憶のかけら ${Math.min(n, 3)} / 3${n > 3 ? `（集めた数 ${n}）` : ''}</div>
          <dl><dt>現れる場所</dt><dd>${tierOfBoss(k)}</dd><dt>初めて退けた</dt><dd>第${m.first || '?'}ウェーブ</dd><dt>退けた回数</dt><dd>${n}回</dd></dl></aside>
        <div class="mem-main">
          ${sec(1, '残された言葉', `<p class="mem-sub">${/^「/.test(E.sub) ? esc(E.sub) : '「' + esc(E.sub) + '」'}</p>`)}
          ${sec(1, '姿', `<p>${esc(D.look)}</p>`)}
          ${sec(2, '夢の由来と、今の思い', origin)}
          ${sec(3, '記憶の物語', storyOf(k) ? parasHtml(storyOf(k)) : `<p class="u-none">${esc(k === 'devourer' ? D.sealed : NO_STORY)}</p>`)}
        </div>
        <button class="btn ghost small mem-close" type="button">閉じる</button>
      </div>`;
    paint(el.querySelector('canvas'), k, false);
    el.hidden = false;
    el.querySelector('.mem-close').addEventListener('click', closeDetail);
    el.onclick = (e) => { if (e.target === el) closeDetail(); };
    m.seen = Math.min(3, n); A.persist(); refreshDot();
  }
  function closeDetail() { $('memDetail').hidden = true; renderList(); }
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('memDetail').hidden) { e.stopPropagation(); closeDetail(); } }, true);

  $('memoryBtn').addEventListener('click', () => { try { Sound.init(); Sound.play('click'); } catch (e) { /* ignore */ } window.Menu.show('memoryScreen'); $('memDetail').hidden = true; renderList(); });
  $('memBack').addEventListener('click', () => { try { Sound.play('click'); } catch (e) { /* ignore */ } window.Menu.show('titleScreen'); });
  refreshDot();

  window.Memories = { gain, MEM, ORDER, NEED, refreshDot, renderList };
})();
