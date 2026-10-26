/* =========================================================================
   夢の境界線 — menu.js
   メインメニュー・能力ガチャ画面・記録画面。
   ========================================================================= */
(function () {
  'use strict';
  const A = window.Abilities;
  const $ = (id) => document.getElementById(id);
  const UNITS = () => window.__yume.UNITS;
  const KINDS = A.KINDS;
  const fmtN = (n) => Math.floor(n).toLocaleString('ja-JP');
  const gem = '<i class="gem" aria-hidden="true"></i>';

  // ---------------------------------------------------------------------
  //  Main menu
  // ---------------------------------------------------------------------
  function refreshMenu() {
    const s = A.save;
    $('menuCrystals').innerHTML = `${gem}<span>夢の結晶</span><b>${fmtN(s.crystals)}</b>`;
    const st = s.stats;
    $('bestText').textContent = st.runs === 0 ? '' : st.cleared ? `最高記録：第${window.__yume.CONFIG.totalWaves}ウェーブ防衛成功` : `最高記録：第${st.best}ウェーブ到達`;
    // hint dot on the gacha button when a roll is affordable
    const can = A.save.owned.some((k) => A.canRoll(k) === 'ok');
    $('gachaBtn').classList.toggle('notify', can);
    $('shopBtn').classList.toggle('notify', Object.keys(A.SHOP).some((k) => A.shopState(k) === 'ok'));
  }

  function showScreen(id) {
    for (const s of ['titleScreen', 'gachaScreen', 'recordScreen', 'teamScreen', 'shopScreen']) $(s).hidden = s !== id;
    if (id === 'titleScreen') refreshMenu();
    if (id === 'gachaScreen') { if (!A.owns(sel)) sel = A.save.owned[0]; renderGacha(true); }
    if (id === 'recordScreen') renderRecords();
    if (id === 'teamScreen') renderTeam();
    if (id === 'shopScreen') renderShop();
  }

  // ---------------------------------------------------------------------
  //  Gacha
  // ---------------------------------------------------------------------
  let sel = 'swordsman';
  let confirmUntil = 0;
  let rolling = false;
  const g = {};

  function buildGacha() {
    const root = $('gachaScreen');
    root.innerHTML = `
      <div class="gacha">
        <header class="g-head">
          <div>
            <h2>能力ガチャ</h2>
            <p>夢の結晶を捧げて、夢の住人に能力を宿す。気に入った能力はロックで残せる。</p>
          </div>
          <div class="g-head-r">
            <div class="crystal-pill" id="gCrystals"></div>
            <button class="btn ghost small" id="gBack">戻る</button>
          </div>
        </header>
        <div class="g-body">
          <nav class="g-chars" id="gChars" aria-label="夢の住人"></nav>
          <section class="g-hero">
            <div class="g-portrait"><canvas id="gPortrait"></canvas></div>
            <h3 id="gName"></h3>
            <dl class="g-stats" id="gStats"></dl>
          </section>
          <section class="g-slots">
            <div class="g-slot-list" id="gSlots"></div>
            <div class="g-roll">
              <div class="g-rates">排出率　<span class="rC">C 58%</span>　<span class="rR">R 28%</span>　<span class="rE">E 11%</span>　<span class="rL">L 3%</span></div>
              <button class="btn roll" id="gRoll"></button>
              <div class="g-note" id="gNote"></div>
            </div>
          </section>
        </div>
      </div>`;
    $('gBack').addEventListener('click', () => { Sound.play('click'); showScreen('titleScreen'); });
    $('gRoll').addEventListener('click', onRoll);
    g.built = true;
  }
  function buildGachaNav() {
    const nav = $('gChars');
    const list = KINDS.filter((k) => A.owns(k));
    if (g.nav === list.join()) return;
    nav.innerHTML = '';
    for (const k of list) {
      const b = document.createElement('button');
      b.className = 'g-char'; b.id = 'gc-' + k; b.type = 'button';
      b.innerHTML = `<canvas></canvas><span class="nm">${UNITS()[k].short || UNITS()[k].name}</span><span class="dots"></span>`;
      Art.drawCardArt(b.querySelector('canvas'), k, 64);
      b.addEventListener('click', () => { if (rolling) return; sel = k; confirmUntil = 0; Sound.play('click'); renderGacha(true); });
      nav.appendChild(b);
    }
    nav.classList.toggle('many', list.length > 5);
    g.nav = list.join();
  }

  function dotsHTML(kind) {
    const c = A.save.chars[kind];
    let h = '';
    for (let i = 0; i < A.ECON.slots; i++) {
      const s = c.slots[i];
      if (i >= c.open) h += '<i class="dot closed"></i>';
      else if (!s) h += '<i class="dot empty"></i>';
      else h += `<i class="dot r${s.r}${s.lock ? ' lock' : ''}"></i>`;
    }
    return h;
  }

  function statRows(kind) {
    const d = UNITS()[kind];
    const m = A.modsFor(kind);
    const pct = (x) => Math.round(x * 100);
    const rows = [];
    const hp = Math.round(d.hp * (1 + (m.hp || 0)));
    rows.push(['最大HP', hp, m.hp]);
    if (d.heal) rows.push(['回復量', Math.round(d.heal * (1 + (m.heal || 0))), m.heal]);
    else if (d.song) rows.push(['歌の手数アップ', '+' + Math.round(d.song * (1 + (m.song || 0)) * 100) + '%', m.song]);
    else rows.push([d.atkLabel || '攻撃力', Math.round(d.atk * (1 + (m.atk || 0)) * (d.turret ? 1 + (m.turret || 0) : 1)), (m.atk || 0) + (d.turret ? m.turret || 0 : 0)]);
    if (d.song) rows.push(['歌の範囲', Math.round(d.range * (1 + (m.echo || 0))), m.echo]);
    else rows.push([d.rateLabel || (d.heal ? '回復の間隔' : '攻撃の間隔'), (d.rate / (1 + (m.aspd || 0))).toFixed(2) + '秒', m.aspd]);
    rows.push(['召喚コスト', d.cost, 0]);
    rows.push(['再使用時間', (d.cd * (1 - (m.recast || 0))).toFixed(1) + '秒', m.recast]);
    const extra = [];
    if (m.guard) extra.push(`被ダメージ -${pct(m.guard)}%`);
    if (m.crit) extra.push(`会心 ${pct(m.crit)}%`);
    if (m.drain) extra.push(`吸精 ${pct(m.drain)}%`);
    if (m.move) extra.push(`移動 +${pct(m.move)}%`);
    return rows.map(([a, v, up]) => `<dt>${a}</dt><dd${up ? ' class="up"' : ''}>${v}</dd>`).join('') +
      (extra.length ? `<dt>その他</dt><dd class="up small">${extra.join('　')}</dd>` : '');
  }

  function slotHTML(kind, i) {
    const c = A.save.chars[kind], s = c.slots[i];
    if (i >= c.open) {
      const cost = A.nextSlotCost(kind);
      const isNext = i === c.open;
      if (!isNext) return `<div class="g-slot closed"><span class="lbl">枠 ${i + 1}</span><span class="txt">前の枠を開放すると開放できる</span></div>`;
      const ok = A.save.crystals >= cost;
      return `<div class="g-slot closed next"><span class="lbl">枠 ${i + 1}</span><span class="txt">未開放の能力枠</span>
        <button class="btn ghost small open-slot" data-i="${i}" ${ok ? '' : 'disabled'}>${gem}${fmtN(cost)} で開放</button></div>`;
    }
    if (!s) return `<div class="g-slot empty" data-i="${i}"><span class="badge">―</span><div class="info"><b>まだ能力がない</b><span>ガチャを引くと能力が宿る</span></div></div>`;
    const ab = A.ABIL[s.id];
    return `<div class="g-slot r${s.r}${s.lock ? ' locked' : ''}" data-i="${i}">
      <span class="badge">${s.r}</span>
      <div class="info"><b>${ab.name}${ab.special ? '<em>特殊</em>' : ''}</b><span>${A.format(s)}</span></div>
      <button class="lock" data-i="${i}" aria-pressed="${s.lock}" aria-label="${s.lock ? 'ロック解除' : 'ロック'}">
        <svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2"/>${s.lock ? '<path d="M8 11V8a4 4 0 0 1 8 0v3"/>' : '<path d="M8 11V8a4 4 0 0 1 7.5-2"/>'}</svg>
        <span>${s.lock ? 'ロック中' : 'ロック'}</span>
      </button>
    </div>`;
  }

  function renderGacha(redrawPortrait) {
    if (!g.built) buildGacha();
    buildGachaNav();
    const s = A.save, d = UNITS()[sel];
    $('gCrystals').innerHTML = `${gem}<span>夢の結晶</span><b>${fmtN(s.crystals)}</b>`;
    for (const k of KINDS.filter((x) => A.owns(x))) {
      const b = $('gc-' + k);
      b.classList.toggle('on', k === sel); b.setAttribute('aria-current', k === sel ? 'true' : 'false');
      b.querySelector('.dots').innerHTML = dotsHTML(k);
    }
    if (redrawPortrait) Art.drawCardArt($('gPortrait'), sel, 220);
    $('gName').textContent = d.name;
    $('gStats').innerHTML = statRows(sel);
    const list = $('gSlots');
    list.innerHTML = Array.from({ length: A.ECON.slots }, (_, i) => slotHTML(sel, i)).join('');
    list.querySelectorAll('.lock').forEach((btn) => btn.addEventListener('click', () => {
      if (rolling) return;
      A.toggleLock(sel, +btn.dataset.i); confirmUntil = 0; Sound.play('click'); renderGacha(false);
    }));
    list.querySelectorAll('.open-slot').forEach((btn) => btn.addEventListener('click', () => {
      if (rolling) return;
      if (A.openSlot(sel)) { Sound.play('summon'); renderGacha(false); }
    }));
    renderRollButton();
  }

  function riskyRoll() {
    const c = A.save.chars[sel];
    return c.slots.slice(0, c.open).some((s) => s && !s.lock && (s.r === 'E' || s.r === 'L'));
  }
  function renderRollButton() {
    const btn = $('gRoll'), note = $('gNote');
    const st = A.canRoll(sel), cost = A.rollCost(sel), locks = A.lockedCount(sel);
    const confirming = performance.now() < confirmUntil;
    btn.innerHTML = confirming ? `それでも引く　${gem}${fmtN(cost)}` : `能力を引く　${gem}${fmtN(cost)}`;
    btn.disabled = st !== 'ok' || rolling;
    btn.classList.toggle('warn', confirming);
    if (st === 'alllocked') note.textContent = 'すべての枠がロック中。引き直す枠のロックを外してください。';
    else if (confirming) note.textContent = 'ロックしていないエピック以上の能力が消えます。もう一度押すと引き直します。';
    else if (st === 'crystals') note.textContent = `夢の結晶が ${fmtN(cost - A.save.crystals)} 足りない。戦って集めよう。`;
    else note.textContent = locks ? `ロック中 ${locks}枠：ロックしていない枠だけを引き直す（費用 ×${Math.pow(2, locks)}）` : '開放済みの枠をすべて引き直す';
  }

  const FAKE = Object.keys(A.ABIL).map((id) => A.ABIL[id].name);
  function onRoll() {
    if (rolling) return;
    if (A.canRoll(sel) !== 'ok') { Sound.play('deny'); return; }
    if (riskyRoll() && performance.now() >= confirmUntil) { confirmUntil = performance.now() + 4000; Sound.play('deny'); renderRollButton(); setTimeout(renderRollButton, 4050); return; }
    confirmUntil = 0;
    const changed = A.roll(sel);
    if (!changed) return;
    rolling = true;
    renderGacha(false);
    $('gRoll').disabled = true;
    const rows = changed.map((i) => $('gSlots').querySelector(`.g-slot[data-i="${i}"]`)).filter(Boolean);
    const finals = rows.map((r) => ({ cls: r.className, html: r.innerHTML }));
    // spin: cycle fake names, then reveal one by one
    rows.forEach((r) => { r.className = 'g-slot spinning'; r.innerHTML = '<span class="badge">?</span><div class="info"><b></b><span>　</span></div>'; });
    let tick = 0;
    const iv = setInterval(() => {
      tick++;
      rows.forEach((r) => { if (r.classList.contains('spinning')) r.querySelector('b').textContent = FAKE[(Math.random() * FAKE.length) | 0]; });
      if (tick % 2 === 0) Sound.play('tick');
    }, 70);
    let best = 'C';
    rows.forEach((r, n) => {
      setTimeout(() => {
        r.className = finals[n].cls + ' reveal'; r.innerHTML = finals[n].html;
        const rar = (finals[n].cls.match(/r([CREL])/) || [])[1] || 'C';
        if (A.RARITY[rar].order > A.RARITY[best].order) best = rar;
        Sound.play(rar === 'L' ? 'legend' : rar === 'E' ? 'epic' : 'reveal');
        if (n === rows.length - 1) {
          clearInterval(iv);
          setTimeout(() => {
            rolling = false; renderGacha(false);
            if (best === 'L') flashScreen('L'); else if (best === 'E') flashScreen('E');
          }, 260);
        }
      }, 520 + n * 300);
    });
  }
  function flashScreen(r) {
    const f = document.createElement('div');
    f.className = 'g-flash f' + r;
    $('gachaScreen').appendChild(f);
    setTimeout(() => f.remove(), 1200);
  }


  // ---------------------------------------------------------------------
  //  Shared bits for the roster screens
  // ---------------------------------------------------------------------
  const ROLE = {
    swordsman: '前衛・近接', guardian: '前衛・盾', archer: '後衛・射撃', mage: '後衛・炎の範囲攻撃', healer: '支援・回復',
  };
  const roleOf = (k) => (A.SHOP[k] && A.SHOP[k].role) || ROLE[k] || '';
  function unitFacts(k) {
    const d = UNITS()[k];
    const main = d.fact ? d.fact : d.heal ? ['回復', d.heal] : d.song ? ['歌', `手数+${Math.round(d.song * 100)}%`] : ['攻撃', d.atk];
    return [['コスト', d.cost], ['HP', d.hp], main, ['再使用', d.cd + '秒']];
  }
  function factsHTML(k) { return unitFacts(k).map(([a, b]) => `<span><i>${a}</i>${b}</span>`).join(''); }

  // ---------------------------------------------------------------------
  //  Team (編成)
  // ---------------------------------------------------------------------
  let teamSel = 0;
  function renderTeam(keep) {
    const deck = A.deck;
    const root = $('teamScreen');
    const prevScroll = keep && $('tPool') ? $('tPool').scrollTop : 0; // (same as the shop: picking someone low in the list keeps the list where it was)
    root.innerHTML = `
      <div class="roster">
        <header class="g-head">
          <div><h2>編成</h2><p>戦闘で使う5枚のカードを選ぶ。枠を選んでから、下の住人を選んで入れ替える。</p></div>
          <div class="g-head-r"><button class="btn ghost small" id="tBack">戻る</button></div>
        </header>
        <div class="t-deck" id="tDeck"></div>
        <div class="t-sub"><b>所持している夢の住人</b><span>${A.save.owned.length} / ${KINDS.length}　まだいない住人は交換所で迎えられる</span></div>
        <div class="t-pool" id="tPool"></div>
      </div>`;
    const dk = $('tDeck');
    deck.forEach((k, i) => {
      const d = UNITS()[k];
      const b = document.createElement('button');
      b.type = 'button'; b.className = 't-slot' + (i === teamSel ? ' on' : '');
      b.innerHTML = `<span class="num">${i + 1}</span><canvas></canvas><span class="nm">${d.short || d.name}</span><span class="cost">${d.cost}</span>`;
      Art.drawCardArt(b.querySelector('canvas'), k, 132);
      b.addEventListener('click', () => { teamSel = i; Sound.play('click'); renderTeam(true); });
      dk.appendChild(b);
    });
    const pool = $('tPool');
    for (const k of KINDS) {
      const d = UNITS()[k], owned = A.owns(k), inDeck = deck.indexOf(k);
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 't-unit' + (owned ? '' : ' missing') + (inDeck >= 0 ? ' indeck' : '');
      b.disabled = !owned;
      b.innerHTML = `<canvas></canvas><div class="tx"><b>${d.name}${inDeck >= 0 ? `<em>${inDeck + 1}番</em>` : ''}</b><span class="role">${owned ? roleOf(k) : '交換所で迎えられる'}</span><span class="facts">${owned ? factsHTML(k) : ''}</span></div>`;
      Art.drawCardArt(b.querySelector('canvas'), k, 72);
      if (owned) b.addEventListener('click', () => {
        const nd = A.deck; const j = nd.indexOf(k);
        if (j === teamSel) return;
        if (j >= 0) [nd[teamSel], nd[j]] = [nd[j], nd[teamSel]]; else nd[teamSel] = k;
        A.setDeck(nd); Sound.play('summon');
        teamSel = Math.min(teamSel + 1, A.DECK_SIZE - 1);
        renderTeam(true);
      });
      pool.appendChild(b);
    }
    $('tBack').addEventListener('click', () => { Sound.play('click'); showScreen('titleScreen'); });
    if (prevScroll) pool.scrollTop = prevScroll;
  }

  // ---------------------------------------------------------------------
  //  Exchange (交換所)
  // ---------------------------------------------------------------------
  let buyArm = { k: null, until: 0 };
  // keep: re-render in place (after a button press) and keep the list where it was scrolled to
  function renderShop(justBought, keep) {
    const root = $('shopScreen');
    const prevScroll = keep && $('sList') ? $('sList').scrollTop : 0;
    const best = A.save.stats.best || 0;
    root.innerHTML = `
      <div class="roster">
        <header class="g-head">
          <div><h2>交換所</h2><p>夢の結晶と引き換えに、新しい夢の住人を迎える。深いウェーブに届くほど、並ぶ住人が増える。</p></div>
          <div class="g-head-r"><div class="crystal-pill">${gem}<span>夢の結晶</span><b>${fmtN(A.save.crystals)}</b></div><button class="btn ghost small" id="sBack">戻る</button></div>
        </header>
        <div class="s-list" id="sList"></div>
        <div class="s-foot" id="sFoot">${justBought ? `${UNITS()[justBought].name}を迎えた。編成画面でデッキに入れよう。` : `最高到達：第${best}ウェーブ`}</div>
      </div>`;
    const list = $('sList');
    for (const k of Object.keys(A.SHOP)) {
      const it = A.SHOP[k], d = UNITS()[k], st = A.shopState(k);
      const el = document.createElement('article');
      el.className = 's-item ' + st;
      const armed = buyArm.k === k && performance.now() < buyArm.until;
      let action;
      if (st === 'owned') action = `<button class="btn ghost small go-team">交換済み・編成へ</button>`;
      else if (st === 'locked') action = `<div class="s-lock">第${it.wave}ウェーブ到達で並ぶ</div>`;
      else action = `<button class="btn small buy${armed ? ' armed' : ''}" ${st === 'crystals' ? 'disabled' : ''}>${armed ? 'もう一度押して交換' : `${gem}${fmtN(it.price)} で交換`}</button>
        ${st === 'crystals' ? `<div class="s-need">あと ${fmtN(it.price - A.save.crystals)}</div>` : ''}`;
      el.innerHTML = `
        <div class="s-port"><canvas></canvas>${st === 'locked' ? '<span class="q">？</span>' : ''}</div>
        <div class="s-tx">
          <b>${st === 'locked' ? '？？？' : d.name}</b>
          <span class="role">${it.role}</span>
          <p>${st === 'locked' ? 'まだ見ぬ夢の住人。もっと深いウェーブまで灯を守れば姿を現す。' : it.desc}</p>
          <span class="facts">${st === 'locked' ? '' : factsHTML(k)}</span>
        </div>
        <div class="s-act">${action}</div>`;
      Art.drawCardArt(el.querySelector('canvas'), k, 120);
      const buy = el.querySelector('.buy');
      if (buy) buy.addEventListener('click', () => {
        if (A.shopState(k) !== 'ok') return;
        if (!(buyArm.k === k && performance.now() < buyArm.until)) { buyArm = { k, until: performance.now() + 4000 }; Sound.play('click'); renderShop(null, true); setTimeout(() => { if (!$('shopScreen').hidden) renderShop(null, true); }, 4050); return; }
        buyArm = { k: null, until: 0 };
        if (A.buy(k)) { Sound.play('legend'); renderShop(k, true); }
      });
      const go = el.querySelector('.go-team');
      if (go) go.addEventListener('click', () => { Sound.play('click'); showScreen('teamScreen'); });
      list.appendChild(el);
    }
    $('sBack').addEventListener('click', () => { Sound.play('click'); showScreen('titleScreen'); });
    if (prevScroll) list.scrollTop = prevScroll;
  }

  // ---------------------------------------------------------------------
  //  Records
  // ---------------------------------------------------------------------
  let resetArmed = 0;
  function renderRecords() {
    const st = A.save.stats;
    $('recList').innerHTML = [
      ['出撃回数', `${fmtN(st.runs)} 回`],
      ['防衛成功', `${fmtN(st.wins)} 回`],
      ['最高到達ウェーブ', st.best ? `第 ${st.best} ウェーブ` : '―'],
      ['累計討伐数', fmtN(st.kills)],
      ['これまでに得た夢の結晶', fmtN(st.earned)],
      ['能力ガチャを引いた回数', `${fmtN(st.rolls)} 回`],
    ].map(([a, b]) => `<dt>${a}</dt><dd>${b}</dd>`).join('');
    resetArmed = 0; $('resetBtn').textContent = 'セーブデータを消去';
  }
  $('recBack').addEventListener('click', () => { Sound.play('click'); showScreen('titleScreen'); });
  $('resetBtn').addEventListener('click', () => {
    if (performance.now() > resetArmed) { resetArmed = performance.now() + 4000; $('resetBtn').textContent = 'もう一度押すと消去'; return; }
    A.reset(); Sound.play('deny'); renderRecords();
  });

  // menu buttons
  $('gachaBtn').addEventListener('click', () => { Sound.init(); Sound.play('click'); showScreen('gachaScreen'); });
  $('recordBtn').addEventListener('click', () => { Sound.init(); Sound.play('click'); showScreen('recordScreen'); });
  $('teamBtn').addEventListener('click', () => { Sound.init(); Sound.play('click'); showScreen('teamScreen'); });
  $('shopBtn').addEventListener('click', () => { Sound.init(); Sound.play('click'); showScreen('shopScreen'); });

  window.Menu = { show: showScreen, refresh: refreshMenu };
  showScreen('titleScreen');
})();
