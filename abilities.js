/* =========================================================================
   夢の境界線 — abilities.js
   能力ガチャのデータ・抽選・セーブ。数値はすべて仮の試験値（100ウェーブ到達を長期目標に、ゆっくり伸びる設計）。

   ・夢の住人（キャラ）ごとに能力枠を持つ。1枠目は最初から開放、2〜4枠目は夢の結晶で開放。
   ・ガチャはそのキャラの「ロックしていない開放済みの枠」をすべて引き直す。ロック中の枠は変わらない。
   ・ロック1つごとにガチャ代が2倍になる。
   ・各枠はレアリティを抽選 → そのレアリティで出る能力から1つ → 数値はレアリティごとの範囲内でランダム。
   ========================================================================= */
(function () {
  'use strict';

  // all dream residents (the first five are owned from the start; the rest come from the exchange)
  const KINDS = ['swordsman', 'guardian', 'archer', 'mage', 'healer', 'spearman', 'icemage', 'bard', 'golem', 'hunter', 'sniper', 'thunder', 'ninja', 'paladin', 'pyro', 'engineer', 'berserker', 'gunner', 'crossbow', 'dollmaster'];
  const STARTERS = ['swordsman', 'guardian', 'archer', 'mage', 'healer'];
  const ATTACKERS = ['swordsman', 'guardian', 'archer', 'mage', 'spearman', 'icemage', 'golem', 'hunter', 'sniper', 'thunder', 'ninja', 'paladin', 'pyro', 'engineer', 'berserker', 'gunner', 'crossbow', 'dollmaster'];

  // 交換所：到達ウェーブで並び、夢の結晶で交換する（数値は仮）
  const SHOP = {
    spearman: { wave: 3, price: 300,  role: '中衛・貫き',   desc: '前衛の後ろから長槍で突き、一直線に並んだ敵を2体まで貫く。' },
    icemage:  { wave: 5, price: 600,  role: '妨害・減速',   desc: '氷の欠片を放ち、当たった周りの敵の足と攻撃を鈍らせる。' },
    bard:     { wave: 6, price: 800,  role: '支援・歌',     desc: '自分は戦わず、周りの味方の攻撃の手数を歌で引き上げる。' },
    golem:    { wave: 8, price: 1200, role: '重装・地鳴り', desc: '重く遅いが非常に頑丈。叩きつけで周りの敵をまとめて打つ。' },
    // 第1弾（2026-10-25 承認。並ぶウェーブと価格は仮）
    hunter:   { wave: 11, price: 1000, role: '後衛・対空',   desc: '空をすべる敵を優先して射落とす。矢を受けた敵には印が付き、ほかの味方からも傷を受けやすくなる。' },
    sniper:   { wave: 15, price: 1500, role: '後衛・狙撃',   desc: '遠くから、届く中で一番手ごわい敵を狙い撃つ。重い一撃は鎧の守りを半分すり抜ける。' },
    thunder:  { wave: 20, price: 2500, role: '後衛・連鎖',   desc: '稲妻を放ち、敵から敵へ3体まで飛び移らせる。空をすべる敵にも届く。' },
    ninja:    { wave: 25, price: 3000, role: '奇襲・跳躍',   desc: '呼ばれると前線を跳び越え、後ろで仲間を支える敵や撃ってくる敵に斬りかかる。倒すと前線へ戻る。' },
    // 第2弾・第3弾（2026-10-25 実装。並ぶウェーブと価格は仮）
    paladin:   { wave: 30, price: 4000,  role: '前衛・守りの輪', desc: '白銀の重い鎧で前に立ち、周りの味方の受けるダメージを和らげる。ボスの突進も受け止める。' },
    pyro:      { wave: 35, price: 5000,  role: '後衛・投げ爆弾', desc: '前線の先へ玉を放り、地上の敵をまとめて吹き飛ばす。爆風で敵の列を少し押し戻す。' },
    engineer:  { wave: 40, price: 6000,  role: '支援・砲台',     desc: '呼ばれると小さな砲台を置く。砲台はしばらく撃ち続け、空をすべる敵にも届く。本人は後ろで砲台を直す。' },
    berserker: { wave: 45, price: 7000,  role: '前衛・背水',     desc: '傷つくほど斧が重く速くなる。敵を倒すたびに少し傷が癒える。' },
    gunner:    { wave: 50, price: 8000,  role: '後衛・連射',     desc: '近くの敵へ弾倉ぶんを一気に撃ち込み、装填する。空をすべる敵にも届く。' },
    crossbow:  { wave: 60, price: 10000, role: '後衛・貫き',     desc: '遅いが重い矢を放ち、一直線上の敵をすべて貫く。先頭の敵は少し押し戻される。' },
    dollmaster:{ wave: 70, price: 12000, role: '支援・人形',     desc: '自分は戦わず、眠り人形を呼んで前線の壁にする。人形は少しずつ弱って消える。' },
  };
  const DECK_SIZE = 5;

  const RARITY = {
    C: { name: 'コモン',     short: 'C', weight: 58, order: 0 },
    R: { name: 'レア',       short: 'R', weight: 28, order: 1 },
    E: { name: 'エピック',   short: 'E', weight: 11, order: 2 },
    L: { name: 'レジェンド', short: 'L', weight: 3,  order: 3 },
  };
  const RARITY_ORDER = ['C', 'R', 'E', 'L'];

  // r: rarity -> [min, max]. Values are % unless unit says otherwise.
  const ABIL = {
    // ---- 基本強化 ----
    atk:    { name: '攻撃力アップ',   desc: '攻撃力 +{v}%',                    for: ATTACKERS, r: { C: [4, 8], R: [8, 14], E: [14, 22], L: [22, 35] } },
    hp:     { name: '体力アップ',     desc: '最大HP +{v}%',                    for: KINDS,     r: { C: [5, 10], R: [10, 18], E: [18, 28], L: [28, 45] } },
    aspd:   { name: '手数アップ',     desc: '攻撃・回復の速さ +{v}%',          for: KINDS.filter((k) => k !== 'bard'),     r: { C: [3, 6], R: [6, 10], E: [10, 15], L: [15, 22] } },
    move:   { name: '俊足',           desc: '移動速度 +{v}%',                  for: KINDS,     r: { C: [6, 12], R: [12, 20] } },
    guard:  { name: '守りの加護',     desc: '受けるダメージ -{v}%',            for: KINDS,     r: { C: [2, 4], R: [4, 7], E: [7, 11], L: [11, 16] } },
    recast: { name: '早詠み',         desc: '召喚の再使用時間 -{v}%',          for: KINDS,     r: { C: [4, 8], R: [8, 14], E: [14, 20], L: [20, 30] } },
    crit:   { name: '会心',           desc: '会心率 +{v}%（会心は1.8倍）',     for: ATTACKERS, r: { R: [4, 8], E: [8, 14], L: [14, 22] } },
    drain:  { name: '吸精',           desc: '与えたダメージの{v}%を回復',      for: ATTACKERS, r: { R: [3, 6], E: [6, 10], L: [10, 16] } },
    heal:   { name: '癒しの力',       desc: '回復量 +{v}%',                    for: ['healer'], r: { C: [5, 10], R: [10, 18], E: [18, 28], L: [28, 45] } },
    song:   { name: '響く声',         desc: '歌の手数アップ効果 +{v}%',        for: ['bard'],   r: { C: [4, 8], R: [8, 14], E: [14, 22], L: [22, 34] } },
    // ---- 特殊能力（キャラ固有） ----
    double:  { name: '二連斬り',   desc: '{v}%の確率でもう一度斬る',              for: ['swordsman'], special: true, r: { R: [10, 16], E: [16, 26], L: [26, 40] } },
    cleave:  { name: '旋風斬り',   desc: '周りの敵にも攻撃の{v}%を与える',        for: ['swordsman'], special: true, r: { E: [30, 50], L: [50, 80] } },
    reflect: { name: '反撃の盾',   desc: '受けたダメージの{v}%を跳ね返す',        for: ['guardian'],  special: true, r: { R: [15, 25], E: [25, 40], L: [40, 60] } },
    undying: { name: '不屈',       desc: '倒れる一撃を一度だけ耐え、{v}秒無敵',   for: ['guardian'],  special: true, unit: 's', r: { E: [1, 1.6], L: [2, 3] } },
    multi:   { name: '連射',       desc: '{v}%の確率でもう一本射る',              for: ['archer'],    special: true, r: { R: [12, 20], E: [20, 32], L: [32, 50] } },
    pierce:  { name: '貫通矢',     desc: '後ろの敵1体にも{v}%のダメージ',         for: ['archer'],    special: true, r: { E: [40, 60], L: [60, 100] } },
    blast:   { name: '爆風拡大',   desc: '爆発の範囲 +{v}%',                      for: ['mage'],      special: true, r: { R: [12, 20], E: [20, 32], L: [32, 50] } },
    burn:    { name: '残り火',     desc: '3秒かけて追加で{v}%のダメージ',          for: ['mage'],      special: true, r: { R: [20, 35], E: [35, 55], L: [55, 85] } },
    ripple:  { name: '癒しの波紋', desc: '周りの味方にも回復量の{v}%',            for: ['healer'],    special: true, r: { R: [25, 40], E: [40, 60], L: [60, 90] } },
    bless:   { name: '祝福',       desc: '回復した味方の攻撃力 +{v}%（4秒）',      for: ['healer'],    special: true, r: { E: [10, 18], L: [18, 30] } },
    reach:   { name: '長柄',       desc: '槍の届く距離 +{v}%',                    for: ['spearman'],  special: true, r: { R: [12, 20], E: [20, 32], L: [32, 50] } },
    skewer:  { name: '串刺し',     desc: '{v}%の確率で3体目まで貫く',             for: ['spearman'],  special: true, r: { R: [20, 35], E: [35, 55], L: [55, 80] } },
    freeze:  { name: '凍結',       desc: '{v}%の確率で敵を1.5秒凍らせる',          for: ['icemage'],   special: true, r: { R: [6, 10], E: [10, 16], L: [16, 25] } },
    chill:   { name: '深い冷気',   desc: '減速の強さ +{v}%',                      for: ['icemage'],   special: true, r: { R: [12, 20], E: [20, 32], L: [32, 50] } },
    anthem:  { name: '高揚の歌',   desc: '歌を受けた味方の攻撃力 +{v}%',          for: ['bard'],      special: true, r: { R: [6, 10], E: [10, 16], L: [16, 24] } },
    echo:    { name: '響きの輪',   desc: '歌の届く範囲 +{v}%',                    for: ['bard'],      special: true, r: { R: [15, 25], E: [25, 40], L: [40, 60] } },
    quake:   { name: '地鳴り',     desc: '{v}%の確率で叩いた敵を1秒止める',        for: ['golem'],     special: true, r: { R: [15, 25], E: [25, 40], L: [40, 60] } },
    markUp:   { name: '印の矢',     desc: '印で増えるダメージ +{v}%',                          for: ['hunter'],    special: true, r: { R: [20, 35], E: [35, 60], L: [60, 100] } },
    twin:     { name: '二羽落とし', desc: '飛ぶ敵を倒すと{v}%の確率ですぐ次を射る',  for: ['hunter'],    special: true, r: { R: [30, 50], E: [50, 75], L: [75, 100] } },
    weak:     { name: '弱点狙い',   desc: 'エリートとボスへのダメージ +{v}%',        for: ['sniper'],    special: true, r: { R: [12, 20], E: [20, 32], L: [32, 50] } },
    breath:   { name: '息を整える', desc: '2秒狙う敵がいないと、次の一撃 +{v}%',     for: ['sniper'],    special: true, r: { R: [25, 40], E: [40, 65], L: [65, 100] } },
    chain:    { name: '連鎖',       desc: '{v}%の確率で、もう1体へ連鎖する',         for: ['thunder'],   special: true, r: { R: [25, 40], E: [40, 60], L: [60, 90] } },
    static:   { name: '帯電',       desc: '{v}%の確率で、当てた敵を0.5秒止める',      for: ['thunder'],   special: true, r: { R: [8, 14], E: [14, 22], L: [22, 32] } },
    backstab: { name: '背後討ち',   desc: '跳び込みの一撃 +{v}%',                    for: ['ninja'],     special: true, r: { R: [20, 35], E: [35, 60], L: [60, 100] } },
    smoke:    { name: '煙玉',       desc: '着地のあと{v}秒間、攻撃を受けない',        for: ['ninja'],     special: true, unit: 's', r: { R: [0.8, 1.2], E: [1.2, 1.8], L: [1.8, 2.5] } },
    ring:     { name: '守りの輪',   desc: '守りの輪の範囲と強さ +{v}%',               for: ['paladin'],    special: true, r: { R: [15, 25], E: [25, 40], L: [40, 60] } },
    cover:    { name: '身代わり',   desc: '周りの味方が倒れる一撃を{v}%の確率で代わりに受ける', for: ['paladin'], special: true, r: { R: [20, 35], E: [35, 55], L: [55, 80] } },
    bigball:  { name: '大玉',       desc: '爆発の範囲 +{v}%',                         for: ['pyro'],       special: true, r: { R: [12, 20], E: [20, 32], L: [32, 50] } },
    stall:    { name: '足止め',     desc: '爆発を受けた敵を2秒間{v}%遅くする',         for: ['pyro'],       special: true, r: { R: [10, 16], E: [16, 24], L: [24, 35] } },
    turret:   { name: '上等な砲台', desc: '砲台の攻撃力と持続時間 +{v}%',              for: ['engineer'],   special: true, r: { R: [15, 25], E: [25, 40], L: [40, 60] } },
    spare:    { name: '予備の部品', desc: '{v}%の確率で砲台をもう1基置く',             for: ['engineer'],   special: true, r: { R: [20, 35], E: [35, 55], L: [55, 80] } },
    surge:    { name: '怒涛',       desc: '傷ついたときの強まり方 +{v}%',              for: ['berserker'],  special: true, r: { R: [20, 35], E: [35, 55], L: [55, 80] } },
    blood:    { name: '血潮',       desc: '敵を倒したときの回復量 +{v}%',              for: ['berserker'],  special: true, r: { R: [30, 50], E: [50, 80], L: [80, 120] } },
    mag:      { name: '弾倉拡張',   desc: '装填までの弾数 +{v}発',                     for: ['gunner'],     special: true, unit: 'n', r: { R: [1, 2], E: [2, 3], L: [3, 4] } },
    quick:    { name: '早撃ち',     desc: '召喚直後の1弾倉の連射の速さ +{v}%',          for: ['gunner'],     special: true, r: { R: [30, 50], E: [50, 80], L: [80, 120] } },
    heavy:    { name: '強弓',       desc: '貫いたあとの威力の落ち方 -{v}%',            for: ['crossbow'],   special: true, r: { R: [20, 30], E: [30, 45], L: [45, 60] } },
    nail:     { name: '釘打ち',     desc: '{v}%の確率で先頭の敵を1秒止める',           for: ['crossbow'],   special: true, r: { R: [10, 16], E: [16, 25], L: [25, 35] } },
    dollHp:   { name: '大きな人形', desc: '人形のHP +{v}%',                            for: ['dollmaster'], special: true, r: { R: [15, 25], E: [25, 40], L: [40, 60] } },
    lullaby:  { name: '子守唄',     desc: '人形が消えるとき、周りの味方を人形の最大HPの{v}%回復', for: ['dollmaster'], special: true, r: { R: [20, 35], E: [35, 55], L: [55, 80] } },
    moss:    { name: '苔の再生',   desc: '毎秒 最大HPの{v}%を回復',               for: ['golem'],     special: true, dec: true, r: { R: [0.5, 1], E: [1, 1.6], L: [1.6, 2.5] } },
  };

  // Caps on summed values (fractions) so stacking never breaks the game
  const CAP = { guard: 0.6, recast: 0.6, crit: 0.75, drain: 0.4, double: 0.9, multi: 0.9, aspd: 1.2, freeze: 0.5, skewer: 1, quake: 1, twin: 1, chain: 1, static: 0.6, cover: 0.9, spare: 1, stall: 0.6, heavy: 0.6, nail: 0.6 };

  const ECON = {
    slots: 4,
    slotCost: [0, 300, 1200, 4000],   // price to open slot 1..4
    rollBase: 50,                      // ×2 per locked slot
    starter: 100,                      // gift on first launch so the gacha can be tried right away
  };

  // 夢の結晶の報酬（rewardFor）: ウェーブ突破 Σ(waveBase + wavePer × w)、討伐数 ÷ killDiv、ボス撃破 × boss
  const REWARD = { waveBase: 15, wavePer: 3, killDiv: 2, boss: 300 }; // was 5 / 2 / 4 / 150

  // ---------------------------------------------------------------------
  //  Save
  // ---------------------------------------------------------------------
  const KEY = 'yume-save-v1';
  function fresh() {
    const chars = {};
    for (const k of KINDS) chars[k] = { open: 1, slots: Array(ECON.slots).fill(null) };
    return { v: 2, crystals: ECON.starter, chars, owned: STARTERS.slice(), deck: STARTERS.slice(), stats: { runs: 0, wins: 0, kills: 0, best: 0, earned: 0, rolls: 0 } };
  }
  let save = null;
  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const s = JSON.parse(raw);
        const f = fresh();
        s.chars = s.chars || {};
        for (const k of KINDS) { if (!s.chars[k]) s.chars[k] = f.chars[k]; while (s.chars[k].slots.length < ECON.slots) s.chars[k].slots.push(null); }
        s.stats = Object.assign(f.stats, s.stats || {});
        // v1 saves came from the 10-wave build: a 'cleared' flag there meant wave 10, not the current final wave
        if ((s.v || 1) < 2) { if (s.stats.cleared || s.stats.bestWin) { s.stats.best = Math.max(s.stats.best || 0, 10); } s.stats.cleared = false; delete s.stats.bestWin; s.v = 2; s.migrated = true; }
        if (!Array.isArray(s.owned)) s.owned = STARTERS.slice();
        s.owned = s.owned.filter((k) => KINDS.includes(k));
        if (!Array.isArray(s.deck)) s.deck = STARTERS.slice();
        s.deck = s.deck.filter((k, i, a) => s.owned.includes(k) && a.indexOf(k) === i).slice(0, DECK_SIZE);
        for (const k of STARTERS) if (s.deck.length < DECK_SIZE && !s.deck.includes(k)) s.deck.push(k);
        save = s;
        if (s.migrated) { delete s.migrated; persist(); }
      }
    } catch (e) { save = null; }
    if (!save) {
      save = fresh();
      // carry over the best wave from the earlier prototype build
      try { const b = JSON.parse(localStorage.getItem('yume-best') || 'null'); if (b) save.stats.best = b.cleared ? 10 : b.wave; } catch (e) { /* ignore */ }
      persist();
    }
    return save;
  }
  function persist() { try { localStorage.setItem(KEY, JSON.stringify(save)); } catch (e) { /* storage unavailable: keep in memory */ } }

  // ---------------------------------------------------------------------
  //  Rolling
  // ---------------------------------------------------------------------
  function pickRarity(rng) {
    let t = rng() * 100;
    for (const id of RARITY_ORDER) { t -= RARITY[id].weight; if (t < 0) return id; }
    return 'C';
  }
  function poolFor(kind, rar) { return Object.keys(ABIL).filter((id) => ABIL[id].for.includes(kind) && ABIL[id].r[rar]); }
  function rollOne(kind, taken, rng) {
    rng = rng || Math.random;
    let rar = pickRarity(rng);
    // walk down if a rarity has nothing left for this character (e.g. a special already held)
    for (let guard = 0; guard < 4; guard++) {
      const pool = poolFor(kind, rar).filter((id) => !(ABIL[id].special && taken.includes(id)));
      if (pool.length) {
        const id = pool[Math.floor(rng() * pool.length)];
        const [lo, hi] = ABIL[id].r[rar];
        const v = ABIL[id].unit === 's' || ABIL[id].dec ? Math.round((lo + rng() * (hi - lo)) * 10) / 10 : Math.round(lo + rng() * (hi - lo));
        return { id, r: rar, v };
      }
      rar = RARITY_ORDER[Math.max(0, RARITY[rar].order - 1)];
    }
    return { id: 'hp', r: 'C', v: 5 };
  }

  function lockedCount(kind) { const c = save.chars[kind]; return c.slots.slice(0, c.open).filter((s) => s && s.lock).length; }
  function rollCost(kind) { return ECON.rollBase * Math.pow(2, lockedCount(kind)); }
  function canRoll(kind) {
    const c = save.chars[kind];
    const free = c.slots.slice(0, c.open).filter((s) => !s || !s.lock).length;
    if (free === 0) return 'alllocked';
    if (save.crystals < rollCost(kind)) return 'crystals';
    return 'ok';
  }
  // returns indices of slots that changed
  function roll(kind) {
    if (canRoll(kind) !== 'ok') return null;
    const c = save.chars[kind];
    save.crystals -= rollCost(kind);
    save.stats.rolls++;
    const changed = [];
    const taken = c.slots.slice(0, c.open).filter((s) => s && s.lock).map((s) => s.id);
    for (let i = 0; i < c.open; i++) {
      if (c.slots[i] && c.slots[i].lock) continue;
      const a = rollOne(kind, taken);
      taken.push(a.id);
      c.slots[i] = Object.assign(a, { lock: false });
      changed.push(i);
    }
    persist();
    return changed;
  }
  function toggleLock(kind, i) {
    const c = save.chars[kind], s = c.slots[i];
    if (!s || i >= c.open) return false;
    s.lock = !s.lock; persist(); return true;
  }
  function nextSlotCost(kind) { const c = save.chars[kind]; return c.open >= ECON.slots ? null : ECON.slotCost[c.open]; }
  function openSlot(kind) {
    const cost = nextSlotCost(kind);
    if (cost == null || save.crystals < cost) return false;
    save.crystals -= cost; save.chars[kind].open++; persist(); return true;
  }

  // ---------------------------------------------------------------------
  //  Effects used by the battle
  // ---------------------------------------------------------------------
  function modsFor(kind) {
    const m = {};
    const c = save.chars[kind];
    for (let i = 0; i < c.open; i++) {
      const s = c.slots[i]; if (!s || !ABIL[s.id]) continue;
      const val = ABIL[s.id].unit === 's' || ABIL[s.id].unit === 'n' ? s.v : s.v / 100;
      m[s.id] = (m[s.id] || 0) + val;
    }
    for (const k in CAP) if (m[k] > CAP[k]) m[k] = CAP[k];
    return m;
  }
  function allMods() { const o = {}; for (const k of KINDS) o[k] = modsFor(k); return o; }

  // ---------------------------------------------------------------------
  //  Rewards (夢の結晶) — grows with each wave cleared, so deeper runs pay much more
  // ---------------------------------------------------------------------
  function rewardFor(run) {
    const cleared = run.win ? run.wave : Math.max(0, run.wave - 1);
    // QA3 2026-10-25: about 2× the early income (W10 run ≈ 355 instead of 177) and ≈1.65× at W100
    let waves = 0; for (let w = 1; w <= cleared; w++) waves += REWARD.waveBase + REWARD.wavePer * w;
    const kills = Math.floor(run.kills / REWARD.killDiv);
    const boss = REWARD.boss * (run.bosses != null ? run.bosses : (run.win ? 1 : 0));
    return { cleared, waves, kills, boss, total: waves + kills + boss };
  }
  function grantRun(run) {
    const r = rewardFor(run);
    save.crystals += r.total;
    const st = save.stats;
    st.runs++; st.kills += run.kills; st.earned += r.total;
    if (run.win) st.wins++;
    const reached = run.win ? run.wave : run.wave;
    const isBest = reached > st.best || (run.win && !st.cleared);
    if (reached > st.best) st.best = reached;
    if (run.win) st.cleared = true;
    persist();
    return Object.assign(r, { isBest });
  }

  function format(slot) {
    const a = ABIL[slot.id];
    return a.desc.replace('{v}', a.unit === 's' || a.dec ? slot.v.toFixed(1) : slot.v);
  }

  // ---------------------------------------------------------------------
  //  Exchange & team
  // ---------------------------------------------------------------------
  const owns = (k) => save.owned.includes(k);
  function shopState(k) {
    const it = SHOP[k];
    if (!it || owns(k)) return 'owned';
    if ((save.stats.best || 0) < it.wave) return 'locked';
    if (save.crystals < it.price) return 'crystals';
    return 'ok';
  }
  function buy(k) {
    if (shopState(k) !== 'ok') return false;
    save.crystals -= SHOP[k].price; save.owned.push(k);
    if (save.deck.length < DECK_SIZE) save.deck.push(k);
    persist(); return true;
  }
  function setDeck(list) {
    const d = list.filter((k, i, a) => owns(k) && a.indexOf(k) === i).slice(0, DECK_SIZE);
    if (d.length !== DECK_SIZE) return false;
    save.deck = d; persist(); return true;
  }

  window.Abilities = {
    KINDS, STARTERS, SHOP, DECK_SIZE, RARITY, RARITY_ORDER, ABIL, ECON, REWARD, CAP,
    owns, shopState, buy, setDeck, get deck() { return save.deck.slice(); },
    load, persist, get save() { return save; },
    roll, rollOne, canRoll, rollCost, lockedCount, toggleLock, nextSlotCost, openSlot,
    modsFor, allMods, rewardFor, grantRun, format,
    reset() { save = fresh(); persist(); return save; },
  };
})();
