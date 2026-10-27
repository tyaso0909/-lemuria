/* =========================================================================
   夢の境界線 — game.js  (Ver.0.7 戦闘＋メニュー＋能力ガチャ＋交換所＋編成＋ボス13体の抽選＋最後のボス)
   1レーン・リアルタイム・カード召喚ウェーブ防衛。
   数値はすべて CONFIG / UNITS / ENEMIES / WAVES にまとめた仮の試験値。
   ========================================================================= */
(function () {
  'use strict';

  // ---------------------------------------------------------------------
  //  CONFIG 難易度の目標（2026-10-26 ユーザー指定【確定】。能力は5人×4枠＝20枠の平均、開いていない枠はコモンより下。灯の祝福込み）
  //   平均コモン：第10ウェーブ突破、第20〜30ウェーブ到達 / 平均レア：第40〜50 / 平均エピック：第60〜70 / エピック＋レジェンド少し：第80〜90突破、第100到達
  //   第11ウェーブ以降は lateCurve の折れ線（第65まで急、その先はなだらか）。ボスも同じ線で伸びる（bossFollow）
  // ---------------------------------------------------------------------
  const CONFIG = {
    energyMax: 10,
    energyRegen: 0.75,       // per second (was 1.0)
    energyStart: 4,
    waveInterval: 30,        // seconds per wave (next wave starts early if field is cleared)
    earlyClearDelay: 4,      // seconds after a cleared wave before the next begins
    prepTime: 4,             // before wave 1
    lighthouseHP: 1200,
    allyCap: 12,             // was 16 — keeps the standing army from snowballing
    summonCap: 16,           // turrets and dolls on the field at once (they do not count toward allyCap)
    totalWaves: 100,         // 10 tiers of 10 waves; a boss closes each tier (long-term goal: wave 100)
    tierSize: 10,            // 階層 = 10 waves; new minion types join the draw per tier
    budgetPerWave: 6.0,      // (2026-10-26 6.5→6.0: a Common team should clear W10) wave budget = max(budgetMin, budgetPerWave × n + budgetOffset)
    budgetOffset: -2,
    budgetMin: 5,
    bossEscort: 10,          // budget of the minions that come with a boss (grows per tier)
    bossEscortPerTier: 2,    // QA3: was 8
    maxShare: 0.25,          // one draw may use at most this share of the wave budget (keeps heavies out of tiny waves; was 0.4)
    eliteChance: 0.12,       // from the tier where elites unlock, each non-swarm draw may become elite (+eliteChancePerTier per tier after 3)
    eliteCost: 2.5, eliteHp: 2.5, eliteAtk: 1.5,
    bossTierHp: 0.2, bossTierAtk: 0, // boss stats × (1 + k × (tier − 1)) (QA3: was 1.5 / 0.6 — ATK stays flat: 2 slams at 42 must not kill a mage/archer)
    hpGrowth: 0.29,          // enemy HP per wave in tier 1 (linear; 2026-10-26 0.32→0.29 so a Common team clears W10; was 0.25)
    atkGrowth: 0.17,         // enemy ATK per wave in tier 1 (was 0.12)
    lateBudgetPerWave: 0.1,  // budget growth per wave after tier 1 (QA3: was 3 — budget 36 at W11 → 45 at W100)
    lateHpGrowth: 0.035,     // HP growth per wave after tier 1 (2026-10-25 灯の祝福に合わせて 0.0065→0.035; QA3: was 0.15)
    lateAtkGrowth: 0.014,    // ATK growth per wave after tier 1 (2026-10-25 灯の祝福に合わせて 0.004→0.014; QA3: was 0.06)
    maxLive: 50,             // spawns wait while this many enemies are alive (phones); the boss never waits
    // ---- waves 11-100 (QA3) ----
    preBossWait: 60,         // the wave before a boss lasts up to this long (the boss wave starts early once the field is clear)
    lateBudgetStart: 36,     // budget of wave 11 (null = continue the tier-1 line; W9 is 56.5)
    lateHpStart: 2.74,       // enemy HP / ATK multiplier at wave 11 (null = continue the tier-1 line; W9 is 3.56 / 2.36)
    lateAtkStart: 2.0,
    lateBudgetCap: 48,       // reserve setting: the current curve peaks at ~45, so it does not trigger yet. 0 = off. Budget above this is not spent on more enemies; it multiplies minion HP instead (count stays bounded)
    eliteChancePerTier: 0.02, // eliteChance + this × (tier − 3): 12% at tier 3 → 26% at tier 10
    eliteChanceMax: 0.5,
    carryMax: 0,             // 0 = off. Unspawned leftovers carried into the next wave are capped at this many
    tierHeal: 0.25,           // share of the lighthouse's max HP restored when a tier boss is defeated
    finalBossHp: 1.6, finalBossAtk: 1, // extra multipliers for the W100 boss only
    // ---- 2026-10-26 能力の平均レア度ごとの到達目標に合わせた後半の線（数値は仮）----
    // set: enemy HP / ATK after wave 11 grow by this factor per wave (compounding) instead of the linear late*Growth
    // lateCurve: [wave, HP×, ATK×] waypoints after tier 1, joined log-linearly (steep to ~W65, then a flat tail where small upgrades buy many waves)
    lateCurve: [[11, 2.74, 2.0], [27, 5.25, 3.05], [45, 5.85, 3.25], [65, 7.29, 3.84], [100, 7.29, 3.84]],
    lateHpMul: 0, lateAtkMul: 0,
    bossFollow: true,        // tier bosses (from tier 2) scale with the same late HP curve as the minions (relative to wave 11); bossTierHp is then not added on top
    bossFollowAtk: 0.5,      // …and with this power of the late ATK curve (bosses already hit hard; full scaling made W60+ bosses walls)
  };

  // Lane geometry (stage px)
  const LANE = {
    front: 168,              // lighthouse front edge; enemies here hit the tower
    allySpawn: 214,
    enemySpawn: 1330,
    allyMaxX: 700,           // 待機の立ち位置: idle allies stop here (minus a small per-unit spread)（ユーザー指定 2026-10-25）
    engageMaxX: 800,         // 戦闘の最前線: with an enemy on screen, allies may walk this far right（ユーザー指定 2026-10-25）
    yMin: 548, yMax: 584,
    commanderX: 176, commanderY: 596,
  };

  // 味方（夢の住人） — cost は資料の仮値。cd = 個別クールダウン(秒)
  const UNITS = {
    swordsman: { name: '剣士',     cost: 2, cd: 2.6, hp: 140, atk: 22, rate: 0.85, range: 40,  speed: 64, melee: true },
    guardian:  { name: '盾兵',     cost: 3, cd: 4.0, hp: 440, atk: 9,  rate: 1.2,  range: 38,  speed: 42, melee: true, armor: 0.35 },
    archer:    { name: '弓兵',     cost: 3, cd: 3.0, hp: 80,  atk: 17, rate: 1.05, range: 270, speed: 54, shot: 'arrow' },
    mage:      { name: '炎の魔法使い', short: '炎の魔法', cost: 5, cd: 6.0, hp: 90,  atk: 34, rate: 1.9,  range: 230, speed: 46, shot: 'orb', aoe: 78 },
    healer:    { name: 'ヒーラー', cost: 4, cd: 6.0, hp: 100, heal: 18, rate: 1.4,  range: 220, speed: 48, support: true },
    // 交換所のキャラ
    spearman:  { name: '槍兵',     cost: 3, cd: 3.2, hp: 170, atk: 21, rate: 1.15, range: 120,  speed: 58, melee: true, line: 2, mid: 60 }, // 中衛: waits mid px behind the front melee and thrusts past it
    icemage:   { name: '氷の魔法使い', short: '氷の魔法', cost: 4, cd: 5.0, hp: 85, atk: 10, rate: 1.6, range: 240, speed: 46, shot: 'ice', aoe: 58, slow: 0.25, slowTime: 2.0 },
    bard:      { name: 'バード',   cost: 4, cd: 7.0, hp: 110, rate: 1.6, range: 170, speed: 48, support: true, song: 0.25 },
    golem:     { name: 'ゴーレム', cost: 6, cd: 12,  hp: 950, atk: 28, rate: 2.1, range: 44,  speed: 24, melee: true, armor: 0.3, pound: 62 },
    // 交換所 第1弾（2026-10-25 承認、数値は仮。QA 2026-10-25：雷 atk26→30・減衰0.75→0.85、スナイパー atk72→96・間隔3.0→2.5・コスト5→4、忍者 コスト4→3・HP110→140）
    // ハンター: prefers flyers (×antiAir), every hit marks the enemy (all allies deal +mark.v for mark.t s)
    hunter:    { name: 'ハンター', cost: 3, cd: 3.2, hp: 85,  atk: 15, rate: 1.0,  range: 240, speed: 56, shot: 'arrow', antiAir: 2, mark: { t: 3, v: 0.15 } },
    // スナイパー: one heavy shot at the toughest enemy in reach (highest max HP); ignores pen of the target's armor
    sniper:    { name: 'スナイパー', cost: 4, cd: 6.0, hp: 80, atk: 96, rate: 2.5, range: 420, speed: 44, shot: 'snipe', pen: 0.5, pickTough: true, hold: 200 },
    // 雷の魔法使い: an instant bolt that jumps to up to chain targets in total (each jump × chainFall, within chainR)
    thunder:   { name: '雷の魔法使い', short: '雷の魔法', cost: 5, cd: 6.0, hp: 85, atk: 30, rate: 1.7, range: 220, speed: 46, shot: 'bolt', chain: 3, chainFall: 0.85, chainR: 120 },
    // 忍者: on summon, leaps over the front onto an enemy support/disruptor/shooter/summoner (×leapMul), then walks back to the line
    ninja:     { name: '忍者', cost: 3, cd: 6.0, hp: 140, atk: 26, rate: 0.85, range: 40, speed: 72, melee: true, leap: { mul: 3, time: 0.5, maxX: 1180 } },
  };
  // 交換所 第2弾・第3弾（2026-10-25 ユーザー依頼で実装、数値は仮）
  Object.assign(UNITS, {
    // パラディン: heavy front line; allies within aura.r take aura.v less damage. Blocks the boss charge (armor)
    paladin:   { name: 'パラディン', cost: 5, cd: 8.0, hp: 520, atk: 16, rate: 1.2, range: 40, speed: 40, melee: true, armor: 0.3, aura: { r: 120, v: 0.15 } },
    // 花火師: lobs a bomb over the front (ground only): splash + small push back
    pyro:      { name: '花火師', cost: 4, cd: 5.0, hp: 90, atk: 28, rate: 2.0, range: 260, speed: 48, shot: 'bomb', aoe: 90, knock: 14, noAir: true },
    // エンジニア: places a turret on summon and repairs turrets nearby (does not attack)
    engineer:  { name: 'エンジニア', cost: 4, cd: 8.0, hp: 95, atk: 9, rate: 0.6, range: 200, speed: 48, support: true, turret: { hp: 120, life: 20, repair: 15, every: 1.2, rebuild: 6 }, atkLabel: '砲台の攻撃力', rateLabel: '砲台の攻撃間隔', fact: ['砲台', '20秒'] },
    // バーサーカー: the lower its HP, the harder and faster it hits (×(1+frenzy) at ≤30% HP); heals on a kill
    berserker: { name: 'バーサーカー', cost: 3, cd: 3.5, hp: 200, atk: 20, rate: 0.9, range: 42, speed: 66, melee: true, frenzy: 0.6, killHeal: 0.06 },
    // ガンナー: empties a magazine of mag shots quickly, then reloads
    gunner:    { name: 'ガンナー', cost: 3, cd: 3.5, hp: 85, atk: 9, rate: 0.18, range: 150, speed: 54, shot: 'bullet', mag: 6, reload: 1.8, rateLabel: '連射の間隔' },
    // クロスボウ兵: a heavy bolt that pierces every enemy in line (×pierceFall per enemy) and pushes the first back
    crossbow:  { name: 'クロスボウ兵', short: 'クロスボウ', cost: 4, cd: 5.0, hp: 95, atk: 40, rate: 2.2, range: 300, speed: 50, shot: 'quarrel', pierceFall: 0.85, pierceMax: 8, knock: 12 },
    // 人形遣い: stays back and calls 眠り人形 (max dolls at once), which form a wall and slowly fade
    dollmaster:{ name: '人形遣い', cost: 5, cd: 8.0, hp: 90, atk: 8, rate: 7.0, range: 200, speed: 46, support: true, dolls: { n: 2, max: 4, first: 0.6 }, atkLabel: '人形の攻撃力', rateLabel: '人形を呼ぶ間隔', fact: ['人形', '2体ずつ'] },
  });
  // 固有能力（2026-10-26 ユーザー依頼で仮実装【仮採用】。全員が最初から持つ。能力ガチャの4枠とは別。数値は仮）
  // pips: how many dots the counter shows over the resident in battle
  const INNATE = {
    swordsman: { name: '一歩前へ',         desc: '4回斬ると、5回目の一撃が2倍になり、敵を少し押し返す（ボスは押し返さない）', every: 5, mul: 2, knock: 18, pips: 4 },
    guardian:  { name: 'かばう背中',         desc: '攻撃を10回受けるたびに、2.5秒間 受けるダメージが半分になる', every: 10, t: 2.5, v: 0.5, pips: 9 },
    archer:    { name: '届けたい言葉',     desc: '同じ敵に3本射ると、4本目は必ず会心になる', every: 4, pips: 3 },
    mage:      { name: '待ち続けた火',         desc: '攻撃を受けずに撃ち続けると、1発ごとに威力+5%（最大+25%）。攻撃を受けると元に戻る', step: 0.05, max: 5, pips: 5 },
    healer:    { name: '手のぬくもり',       desc: 'HPが30%を切った味方への回復量が1.6倍', below: 0.3, mul: 1.6 },
    spearman:  { name: '旗のもとに',         desc: 'すぐ前に近接の味方がいる間、攻撃の速さ+15%', v: 0.15, near: 170 },
    icemage:   { name: 'かき氷のしぶき',     desc: '氷で遅くなった敵が倒れると冷気がはじけ、周りの敵を2秒遅くする', r: 80, v: 0.25, t: 2 },
    bard:      { name: 'ふえていく歌',       desc: '場にいる10秒ごとに、歌で上がる手数が+2%（最大+10%）', every: 10, step: 0.02, max: 5, pips: 5 },
    golem:     { name: '育つ城',             desc: '場にいる8秒ごとに最大HP+4%（最大+24%）。少しずつ大きくなる', every: 8, step: 0.04, max: 6, pips: 6 },
    hunter:    { name: '図鑑の新しいページ', desc: '飛ぶ敵を倒すと、召喚エネルギーが0.5回復（1ウェーブに3回まで）', energy: 0.5, perWave: 3 },
    sniper:    { name: '遠くの景色',         desc: '遠い敵ほど強く当たる（距離に応じて最大+30%）', from: 150, to: 420, max: 0.3 },
    thunder:   { name: '雷の夜のたのしみ',   desc: '4回目の雷は大きな雷：連鎖が2体増え、連鎖しても威力が落ちない', every: 4, add: 2, pips: 3 },
    ninja:     { name: 'もう一度びっくり',   desc: '跳び込んだあと10秒ごとに、もう一度前線を跳び越えて跳び込む', every: 10 },
    paladin:   { name: '病室の約束',         desc: 'HPが半分を切ると一度だけ、周りの味方を最大HPの15%回復し、自分は3秒間 受けるダメージが半分になる', at: 0.5, heal: 0.15, t: 3, v: 0.5 },
    pyro:      { name: '三連発',             desc: '5発目ごとに、前方へ小さな花火を3つ上げる（1つ60%の威力）', every: 5, n: 3, mul: 0.6, gap: 70, pips: 4 },
    engineer:  { name: '放っておけない',     desc: '砲台が壊されると、すぐ次を建て始める（建て直し6秒→2秒）', rebuild: 2 },
    berserker: { name: 'もう一度立つ',       desc: '倒れる一撃を受けても、一度だけHP30%で立ち上がる', hp: 0.3 },
    gunner:    { name: 'とっておきの一発',   desc: '弾倉の最後の1発は水風船：小さな範囲に1.5倍のダメージ', mul: 1.5, r: 46 },
    crossbow:  { name: '工夫を重ねる',       desc: '1本の矢が当たった敵1体につき、次の装填が8%速くなる（最大40%）', step: 0.08, max: 0.4 },
    dollmaster:{ name: 'みんないっしょ',     desc: '人形が多く並ぶほど人形が強い（1体につき人形の攻撃力+10%・受けるダメージ-5%）', atk: 0.1, guard: 0.05 },
  };
  const innOf = (u) => INNATE[u.kind];
  const innText = (u, v) => G.texts.push({ x: u.x, y: u.y - 92, v, life: 1.1, skill: true });
  // allies that are called by other allies (not cards): they do not count toward the ally cap
  const SUMMONS = {
    turret: { name: '砲台', hp: 120, atk: 9, rate: 0.6, range: 220, speed: 0, shot: 'gear', summoned: true },
    doll:   { name: '眠り人形', hp: 90, atk: 8, rate: 1.0, range: 34, speed: 60, melee: true, summoned: true, decay: 0.02 },
  };

  // 灯の祝福: after each tier boss, pick 1 of 3 boosts for one unit in the team (this run only; picks stack). 仮採用・ディレクター判断 2026-10-25
  const BLESS = {
    atk:     { w: 2, v: 0.25, ok: (d) => !!d.atk,              label: (d) => d.atkLabel || '攻撃力', fmt: '+25%' },
    hp:      { w: 2, v: 0.35, ok: () => true,                  label: () => '最大HP', fmt: '+35%' },
    aspd:    { w: 1, v: 0.20, ok: (d) => !d.song,              label: (d) => d.heal ? '回復の速さ' : d.dolls ? '人形を呼ぶ速さ' : d.turret ? '砲台の攻撃の速さ' : '攻撃の速さ', fmt: '+20%' },
    song:    { w: 2, v: 0.25, ok: (d) => !!d.song,             label: () => '歌の効果', fmt: '+25%' },
    heal:    { w: 2, v: 0.30, ok: (d) => !!d.heal,             label: () => '回復量', fmt: '+30%' },
    recast:  { w: 1, v: 0.25, ok: () => true,                  label: () => '再使用時間', fmt: '-25%' },
    cost:    { w: 1, v: 1,    ok: (d, k) => costOf(k) >= 3,    label: () => '召喚コスト', fmt: '-1' },
    reach:   { w: 1, v: 0.20, ok: (d) => !!(d.shot || d.line), label: () => '射程', fmt: '+20%' },
    guard:   { w: 1, v: 0.15, ok: () => true,                  label: () => '受けるダメージ', fmt: '-15%' },
    crit:    { w: 1, v: 0.15, ok: (d) => !!d.atk,              label: () => '会心率', fmt: '+15%' },
    special: { w: 3, ok: (d, k) => specialsOf(k).length > 0 },
  };
  const specialsOf = (k) => Object.keys(Abilities.ABIL).filter((id) => Abilities.ABIL[id].special && Abilities.ABIL[id].for.includes(k));

  // enemy roles the 忍者 leaps for (back-line threats)
  const LEAP_ROLES = ['支援型', '妨害型', '遠距離型', '召喚型'];
  // the 5 cards in battle come from the player's team (編成); filled from the save before each battle
  const DECK = ['swordsman', 'guardian', 'archer', 'mage', 'healer'];
  function loadDeck() { const d = Abilities.deck; if (d.length === 5) { DECK.length = 0; DECK.push(...d); } }

  // 敵（ナイトメア）
  // cost = budget used by one draw (a pack counts once); weight = draw weight; tier = first tier it can appear in
  const ENEMIES = {
    shade:  { name: 'ほつれ影',     role: '通常型', hp: 72,  atk: 11, rate: 1.0, range: 36, speed: 44, dream: 3, radius: 12, cost: 1, weight: 5, tier: 1 },
    // slip: from wave slipFromWave on, each runner dashes past the first ally it meets once (slipDist px)
    runner: { name: '駆ける残響',   role: '高速型', hp: 46,  atk: 9,  rate: 0.7, range: 34, speed: 104, dream: 3, radius: 14, slip: 1, slipDist: 300, slipFromWave: 4, cost: 1, weight: 3, tier: 1 },
    armor:  { name: '錆びた守り手', role: '重装型', hp: 380, atk: 30, rate: 1.6, range: 42, speed: 26, dream: 8, radius: 16, armor: 0.35, cost: 4, weight: 2, tier: 1 },
    // ---- 第1階層から ----
    swarm:   { name: 'ささやく群れ', role: '群体型', hp: 22,  atk: 5,  rate: 0.8, range: 30, speed: 58, dream: 1, radius: 9,  cost: 3, weight: 3, tier: 1, pack: 4 },
    spitter: { name: 'にじむ射手',   role: '遠距離型', hp: 55, atk: 12, rate: 1.7, range: 200, speed: 40, dream: 4, radius: 12, cost: 2, weight: 2, tier: 1, shooter: true },
    charger: { name: 'くずれ角',     role: '突進型', hp: 120, atk: 24, rate: 1.4, range: 38, speed: 36, dream: 5, radius: 16, cost: 3, weight: 2, tier: 1, charge: { trigger: 240, speed: 250, mul: 2, knock: 36, wind: 0.6 } },
    // ---- 第2階層から ----
    bomber:  { name: 'はじける泡夢', role: '自爆型', hp: 40,  atk: 48, rate: 1.0, range: 28, speed: 66, dream: 3, radius: 12, cost: 2, weight: 2, tier: 2, blast: 72 },
    mender:  { name: '子守りの影',   role: '支援型', hp: 80,  atk: 6,  rate: 1.2, range: 34, speed: 34, dream: 5, radius: 12, cost: 3, weight: 1.5, tier: 2, mend: { every: 1.6, share: 0.04, r: 130 } },
    flyer:   { name: '夜をすべる翼', role: '飛行型', hp: 50,  atk: 10, rate: 1.1, range: 36, speed: 62, dream: 4, radius: 12, cost: 2, weight: 2, tier: 2, flying: true },
    // ---- 第3階層から（エリートもここから） ----
    bell:    { name: '眠りを乱す鈴', role: '妨害型', hp: 70,  atk: 6,  rate: 1.2, range: 34, speed: 40, dream: 5, radius: 12, cost: 3, weight: 1.5, tier: 3, ring: { every: 6, trigger: 300, cdAdd: 1.2, daze: 2.5, r: 160 } },
    weaver:  { name: '夢を縫う繭',   role: '召喚型', hp: 180, atk: 8,  rate: 1.5, range: 34, speed: 22, dream: 8, radius: 16, cost: 5, weight: 1, tier: 3, spawn: { every: 7, kind: 'swarm', n: 2, max: 6 } },
    // ---- ボス（2026-10-25 ユーザー指定の9体。tier = 抽選に加わる階層、数値は仮。QA 2026-10-25：雪だるま atk30→36、友人 hp2200→2700・ワープ9→13秒、
    //      宇宙飛行士の落石 ×1.1→0.85、観覧車 hp3000→2700、玉座 hp3000→2700、時計塔 hp3200→2800、歌姫の待ち位置 905→895）----
    // QA 2026-10-25（2回目）：灯を喰らうもの 膜0.03→0.015・エネルギー回復×0.7→0.85・吸い上げの予兆1.5→2.5秒・出撃上限のときは1だけ、魔女 hp2500→2700、速達は低く飛ぶ
    boss:    { name: '捨てられた英雄',   role: 'ボス', boss: true, ai: 'hero',   tier: 1, hp: 2500, atk: 42, rate: 2.6, range: 96,  speed: 17, dream: 120, radius: 40, armor: 0.1,  sub: 'かつて誰かが憧れた、幼い日のヒーロー像', sub2: 'また別の誰かが憧れた、幼い日のヒーロー像', p2: ['英雄は、まだ立ち上がる', '突進に注意'] },
    snowman: { name: '溶けない雪だるま', role: 'ボス', boss: true, ai: 'snow',   tier: 1, hp: 2300, atk: 36, rate: 2.4, range: 80,  speed: 15, dream: 120, radius: 44, armor: 0.1,  sub: '「ずっと溶けないで」と願われた、初雪の朝の雪だるま', p2: ['雪だるまは、溶けまいと凍てつく', '小さな雪だるまを本体に戻すな'],
      chill: { r: 160, r2: 200, v: 0.25 }, ball: { every: 5, every2: 4, reach: 520, r: 60, mul: 0.8 }, bump: { off: 60, r: 90, knock: 30 }, split: 3, absorb: { every: 10, r: 260, heal: 0.03 } },
    friend:  { name: '顔のない友人',     role: 'ボス', boss: true, ai: 'friend', tier: 2, hp: 2700, atk: 32, rate: 1.6, range: 60,  speed: 30, dream: 120, radius: 36,              sub: '食卓の隣の席にいた、誰にも見えない友だち', p2: ['「もう一人」が現れた', '後衛のそばに注意'],
      tap: { every: 5, every2: 4, mul: 1.4, show: 2.5 }, hitShow: 2, warp: { every: 13, mul: 1.6 }, kids: { every: 12, n: 2 } },
    astro:   { name: '星を目指した者',   role: 'ボス', boss: true, ai: 'astro',  tier: 3, hp: 2000, atk: 34, rate: 2.4, range: 90,  speed: 22, dream: 120, radius: 40, flying: true, hover: 820, fallAfter: 45, sub: '宇宙飛行士に憧れた子の、遠い空の夢', p2: ['推進力が尽きた', '地上に落ちてくる'],
      rock: { every: 6, first: 3, n: 2, r: 70, mul: 0.85, every2: 7, n2: 1 }, sats: { every: 10, n: 2 }, land: { r: 150, knock: 60 }, stomp: { off: 40, r: 120, mul: 1.2, knock: 30 } },
    wheel:   { name: '壊れた観覧車',     role: 'ボス', boss: true, ai: 'wheel',  tier: 4, hp: 2700, atk: 38, rate: 3.0, range: 120, speed: 14, dream: 120, radius: 70, armor: 0.2,  anchor: 870, sub: '家族で出かけた、あの日の遊園地', p2: ['観覧車が、軋みながら回り始めた', '送り出されるナイトメアが増える'],
      ride: { every: 5, every2: 3.5, first: 2 }, drop: { off: 90, r: 100, mul: 1.1 }, haste: { r: 320, v: 0.3 } },
    batter:  { name: '最後の打者',       role: 'ボス', boss: true, ai: 'batter', tier: 5, hp: 2600, atk: 44, rate: 2.2, range: 90,  speed: 24, dream: 120, radius: 40,              sub: '来なかった最後の打席を、いまも待っている', p2: ['最後の打席が、近づいている', '打ち返した球が後衛まで飛ぶ'],
      stance: { every: 7, every2: 6, time: 3, time2: 4.5, back: 0.5, back2: 0.7 }, swing: { off: 70, r: 100, knock: 40 }, run: { len: 260, mul: 1.2, knock: 40, each: 3 } },
    siren:   { name: '深海の歌姫',       role: 'ボス', boss: true, ai: 'siren',  tier: 6, hp: 2400, atk: 30, rate: 2.2, range: 420, speed: 20, dream: 120, radius: 40, anchor: 895, anchor2: 840, tideAfter: 45, leapable: true, sub: '海の底で歌う、絵本の人魚姫', p2: ['潮が満ちる', '歌姫が前へ出てくる'],
      song: { every: 9, every2: 6, first: 5, r: 380, daze: 3 }, bubble: 0.9, heal: { every: 3, r: 260, v: 0.02 }, jelly: { every: 10, n: 2 } },
    throne:  { name: '空っぽの玉座',     role: 'ボス', boss: true, ai: 'throne', tier: 7, hp: 2700, atk: 46, rate: 2.6, range: 110, speed: 14, dream: 120, radius: 46, armor: 0.15, sub: '王さまになりたかった子の、誰も座らない玉座', p2: ['空っぽの王笏が振り上げられた', '地を這う衝撃に注意'],
      call: { every: 12, n: 2, n2: 3 }, absorb: { every: 10, first: 7, r: 200, heal: 0.02, healMax: 0.1, healTotal: 0.3, pow: 0.04, powMax: 0.5 }, sweep: { off: 80, r: 130 }, quake: { every: 7, speed: 340, mul: 0.9 } },
    clock:   { name: '刻喰らいの時計塔', role: 'ボス', boss: true, ai: 'clock',  tier: 8, hp: 2800, atk: 44, rate: 2.4, range: 150, speed: 16, dream: 120, radius: 44, armor: 0.1,  sub: '「大人になりたくない」と、時計の針を止めた子ども', p2: ['時計塔の時が、ゆっくりと淀む', '周りの住人の動きが遅くなる'],
      rewind: { every: 12, every2: 10, first: 10, wind: 1.6, back: 5, stop: 0.06 }, thrust: { len: 200, mul: 1.1 }, chill: { r: 220, v: 0.4 } },
    // ---- 2026-10-25 追加（ユーザー承認）：新しい4体と第100ウェーブ専用の最後のボス（数値は仮）----
    postman: { name: '忘却を運ぶ郵便屋', role: 'ボス', boss: true, ai: 'postman', tier: 3, hp: 2300, atk: 30, rate: 2.2, range: 80, speed: 18, dream: 120, radius: 42, sub: '伝えられなかった言葉が集まった、宛先のない郵便屋', p2: ['封筒の体がほどけていく', '手紙の群れと速達に注意'],
      seal: { every: 6, first: 3, n: 2, reach: 300, time: 3, mul: 0.3 }, express: { every: 12, first: 6, n: 1, n2: 2, hit: 2.5, heal: 0.08, r: 130 }, flock: { every: 8, n: 4 }, slap: { off: 60, r: 80 } },
    witch:   { name: '異端の魔女', role: 'ボス', boss: true, ai: 'witch', tier: 5, hp: 2700, atk: 34, rate: 2.4, range: 80, speed: 20, dream: 120, radius: 38, sub: '魔法少女に憧れた女の子の、箱にしまわれた人形', p2: ['変身できなかった魔法少女', 'リボンの結界は近接の攻撃で破れる'],
      heart: { every: 2.4, reach: 420, mul: 0.8 }, toy: { every: 9, first: 5, time: 4, wind: 1.0 }, change: 2, barrier: { hits: 6, every: 12, cut: 0.5 }, bonk: { off: 50, r: 80 } },
    dancer:  { name: '終幕の踊り子', role: 'ボス', boss: true, ai: 'dancer', tier: 7, hp: 2900, atk: 42, rate: 2.4, range: 90, speed: 26, dream: 120, radius: 38, sub: '発表会の舞台を夢見た少女の、終わらない最後の演目', p2: ['第二幕', 'くるくると前線を抜けてくる'],
      waltz: { off: 70, r: 120 }, curtain: { time: 3, push: 150, r: 320 }, spin: { every: 8, first: 3, mul: 0.9 }, spot: { every: 7, first: 2, n: 3, r: 45, time: 2.0, mul: 1.6 } },
    whale:   { name: '深海の夢鯨', role: 'ボス', boss: true, ai: 'whale', tier: 9, hp: 3600, atk: 46, rate: 3.0, range: 120, speed: 16, dream: 120, radius: 80, flying: true, hover: 860, diveAfter: 30, sub: '空を飛ぶことを夢見た人たちの願いが、海の底で鯨になった', p2: ['夢鯨が深く潜った', '浮かび上がる場所に注意'],
      swallow: { every: 10, first: 6, wind: 1.0, time: 8, hit: 0.6, heal: 0.2, max: 3, reach: 420 }, spout: { every: 9, r: 300, v: 0.03 }, dive: { every: 10, first: 2, time: 2.5, r: 140, mul: 1.5, knock: 50, up: 6 } },
    devourer: { name: '灯を喰らうもの', role: 'ボス', boss: true, ai: 'devourer', final: true, tier: 10, hp: 3200, atk: 50, rate: 2.6, range: 110, speed: 12, dream: 200, radius: 70, armor: 0.15, sub: '夜の底から、灯よりも大きな影がせり上がる', p2: ['光輪が砕けた', '光の帯に注意'],
      regen: 0.85, drain: { every: 15, first: 8, wind: 2.5, take: 3, takeCapped: 1, shield: 0.015, starve: 5, weak: 0.2 }, hand: { chance: 0.25, cd: 6, stun: 3 }, forms: [0.8, 0.6, 0.4], formTime: 20, slam: { off: 80, r: 130 }, beam: { every: 8, len: 700, wind: 1.4, mul: 1.4 }, p2At: 0.2 },
    // ボスが呼ぶ雑魚（通常のウェーブには出ない）
    letter:    { name: '漂う手紙', role: '飛行型', hp: 30, atk: 6, rate: 1.0, range: 30, speed: 60, dream: 1, radius: 10, flying: true, bossOnly: true },
    express:   { name: '速達', role: '飛行型', hp: 100, atk: 10, rate: 1.0, range: 20, speed: 55, dream: 3, radius: 14, flying: true, courier: true, bossOnly: true }, // (flies low: melee in the line can hit it as it passes)
    snowlet:   { name: '小さな雪だるま', role: '群体型', hp: 70, atk: 8,  rate: 1.0, range: 30, speed: 34, dream: 2, radius: 12, bossOnly: true },
    friendkid: { name: 'もう一人',       role: '通常型', hp: 60, atk: 10, rate: 1.0, range: 34, speed: 50, dream: 2, radius: 12, bossOnly: true },
  };

  const ELITE_TIER = 3;
  const MINIONS = Object.keys(ENEMIES).filter((k) => !ENEMIES[k].boss && !ENEMIES[k].bossOnly);
  // ボスの抽選：その階層までに加わったボスから1体。同じ出撃では一巡するまで重ならない。その階層で新しく加わったボスは出やすさ2倍（仮採用・ディレクター判断 2026-10-25）
  const BOSSES = Object.keys(ENEMIES).filter((k) => ENEMIES[k].boss);
  function pickBoss(n) {
    if (window.__yume && window.__yume.forceBoss && ENEMIES[window.__yume.forceBoss]) return window.__yume.forceBoss;
    // 第100ウェーブは専用の最後のボス（【確定】2026-10-25）
    const fin = BOSSES.find((k) => ENEMIES[k].final);
    if (n >= CONFIG.totalWaves && fin) return fin;
    const tier = Math.min(tierOf(n), CONFIG.totalWaves / CONFIG.tierSize);
    const pool = BOSSES.filter((k) => !ENEMIES[k].final && (ENEMIES[k].tier || 1) <= tier);
    let cand = pool.filter((k) => !G.bossSeen.includes(k));
    if (!cand.length) { G.bossSeen = []; cand = pool.slice(); }
    if (cand.length > 1 && G.lastBoss) cand = cand.filter((k) => k !== G.lastBoss);
    const w = (k) => ENEMIES[k].tier === tier ? 2 : 1;
    let tw = 0; for (const k of cand) tw += w(k);
    let r = Math.random() * tw, pick = cand[0];
    for (const k of cand) { r -= w(k); if (r < 0) { pick = k; break; } }
    G.bossSeen.push(pick); G.lastBoss = pick;
    return pick;
  }

  // (旧) fixed wave composition — kept only for reference; waves are now drawn from a budget (buildWave)
  const WAVES = [
    { shade: 5,                         span: 14 },
    { shade: 7,  runner: 2,             span: 16 },
    { shade: 8,  runner: 4,  armor: 1,  span: 17 },
    { shade: 9,  runner: 4,  armor: 2,  span: 18 },
    { shade: 11, runner: 6,  armor: 3,  span: 19 },
    { shade: 12, runner: 8,  armor: 4,  span: 20 },
    { shade: 14, runner: 9,  armor: 5,  span: 21 },
    { shade: 15, runner: 10, armor: 7,  span: 22 },
    { shade: 15, runner: 11, armor: 7,  span: 23 },
    { boss: 1, shade: 6, runner: 4,     span: 20 },
  ];

  // Boss behaviour numbers (read by updateBoss)
  const BOSS = {
    contact: 60,            // boss keeps walking until an ally is this close (melee reach on boss ≈ 78–80)
    slamWind: 0.75, slamOffset: 60, slamRadius: 140, slamMul: 1.0,
    phase2At: 0.5,
    chargeCd: 9, chargeFirst: 1.5, chargeWind: 0.9, chargeTime: 1.0, chargeSpeed: 300, chargeMul: 0.8, chargeKnock: 46,
    summonCd1: 12, summonCd2: 9, summon1: 2, summon2: 3, summonFirst: 11,
    chargeBlock: true,      // true: a standing 盾兵/ゴーレム stops the phase-2 charge (otherwise it runs through the whole line)
  };


  // ---------------------------------------------------------------------
  //  DOM
  // ---------------------------------------------------------------------
  const $ = (id) => document.getElementById(id);
  const stage = $('stage'), cv = $('cv'), ctx = cv.getContext('2d');
  const ui = {
    hud: $('hud'), hpText: $('hpText'), hpFill: $('hpFill'), hpBar: $('hpBar'),
    waveText: $('waveText'), leftText: $('leftText'), waveFill: $('waveFill'), killText: $('killText'),
    enNum: $('enNum'), pips: $('pips'), cards: $('cards'),
    banner: $('banner'), bannerBig: $('bannerBig'), bannerSub: $('bannerSub'),
    title: $('titleScreen'), pause: $('pauseScreen'), result: $('resultScreen'),
    best: $('bestText'), speedSeg: $('speedSeg'), soundBtn: $('soundBtn'),
  };

  // ---------------------------------------------------------------------
  //  Scaling (16:9 stage fit) & canvas resolution
  // ---------------------------------------------------------------------
  let renderK = 1;
  const TOUCH = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  function fit() {
    const vp = document.getElementById('viewport'); const vw = vp.clientWidth || window.innerWidth, vh = vp.clientHeight || window.innerHeight;
    // スマートフォンを縦に持っているときは、ゲーム画面を90°回して横向きで表示する（ユーザー指定 2026-10-26）
    const rot = TOUCH && vh > vw;
    document.documentElement.classList.toggle('rot', rot && vw <= 520); // (the enlarged phone layout only for phone-sized screens, as with the landscape media query)
    const s = rot ? Math.min(vh / 1280, vw / 720) : Math.min(vw / 1280, vh / 720);
    stage.style.transform = `translate(-50%,-50%)${rot ? ' rotate(90deg)' : ''} scale(${s})`;
    const k = Math.max(1, Math.min(2.5, s * (window.devicePixelRatio || 1)));
    if (Math.abs(k - renderK) > 0.05 || cv.width !== Math.round(1280 * k)) {
      renderK = k; cv.width = Math.round(1280 * k); cv.height = Math.round(720 * k);
    }
    $('rotate').hidden = true;
  }
  window.addEventListener('resize', fit);
  window.addEventListener('orientationchange', () => setTimeout(fit, 200));
  // where the browser allows it (e.g. Chrome on Android), the first tap also goes full screen and locks the screen to landscape;
  // elsewhere (e.g. iPhone Safari) the sideways view above is used
  function tryLandscape() {
    if (!TOUCH) return;
    const lock = () => { try { const o = screen.orientation; if (o && o.lock) o.lock('landscape').catch(() => {}); } catch (e) { /* not supported */ } };
    try {
      const el = document.documentElement;
      if (!document.fullscreenElement && el.requestFullscreen) el.requestFullscreen({ navigationUI: 'hide' }).then(lock, () => {});
      else lock();
    } catch (e) { /* not allowed here */ }
  }
  window.addEventListener('pointerdown', tryLandscape, { once: true, capture: true });

  // ---------------------------------------------------------------------
  //  Storage (best record)
  // ---------------------------------------------------------------------
  function loadBest() { try { return JSON.parse(localStorage.getItem('yume-best') || 'null'); } catch (e) { return null; } }
  function saveBest(b) { try { localStorage.setItem('yume-best', JSON.stringify(b)); } catch (e) { /* ignore */ } }
  function loadSetting(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : v === '1'; } catch (e) { return d; } }
  function saveSetting(k, v) { try { localStorage.setItem(k, v ? '1' : '0'); } catch (e) { /* ignore */ } }

  // ---------------------------------------------------------------------
  //  State
  // ---------------------------------------------------------------------
  let G = null;
  let uid = 1;
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

  function newGame() {
    G = {
      mode: 'play', paused: false, speed: 1, time: 0,
      energy: CONFIG.energyStart,
      hp: CONFIG.lighthouseHP, hpMax: CONFIG.lighthouseHP, towerFlash: 0, lampBoost: 0,
      wave: 0, waveTime: 0, spawnQueue: [], waveCleared: false, clearTimer: 0, prep: CONFIG.prepTime,
      allies: [], enemies: [], shots: [], fx: [], motes: [], texts: [],
      cd: Object.fromEntries(DECK.map((k) => [k, 0])),
      mods: Abilities.allMods(), cdMax: {}, seen: {}, bosses: 0, costAdj: {}, blessings: [], picking: false, offer: null,
      kills: 0, dream: 0, summoned: 0, lost: 0,
      cast: 0, shake: 0, bossRef: null, bossDown: false, endTimer: -1, outcome: null,
      hazards: [], quakes: [], bossSeen: [], lastBoss: null, bossLog: [], shards: [], memRun: 0,
    };
    for (const k of DECK) G.cdMax[k] = UNITS[k].cd * (1 - (G.mods[k].recast || 0));
    showBanner('準備', '夢の住人を召喚して、追憶の灯を守れ', 2.6);
  }

  // ---------------------------------------------------------------------
  //  Spawning
  // ---------------------------------------------------------------------
  function makeAlly(kind) {
    const d = UNITS[kind] || SUMMONS[kind];
    const m = (G && G.mods && G.mods[kind]) || {};
    const hp = Math.round(d.hp * (1 + (m.hp || 0)));
    return {
      id: uid++, side: 'ally', kind, x: LANE.allySpawn + rand(-6, 6), y: rand(LANE.yMin, LANE.yMax),
      hp, maxHp: hp, slot: rand(0, 36), cool: rand(0.1, 0.4), anim: rand(0, 6), walk: true, atk: 0, hurt: 0, aim: 0, dead: 0, def: d,
      // ability-adjusted stats (abilities.js)
      m, speed: d.speed * (1 + (m.move || 0)), spd0: d.speed * (1 + (m.move || 0)), chill: 0, rate: d.rate / (1 + (m.aspd || 0)),
      atkV: (d.atk || 0) * (1 + (m.atk || 0)), healV: (d.heal || 0) * (1 + (m.heal || 0)),
      reachV: d.range * (1 + (m.reach || 0)), songV: 0, anthemV: 0,
      invul: 0, blessT: 0, blessV: 0,
      leapReady: !!d.leap, jumpH: 0, summoned: !!d.summoned, auraV: 0, frenzyV: 0,
      mag: 0, summonT: d.dolls ? d.dolls.first : 0,
    };
  }
  const summonRoom = () => CONFIG.summonCap - G.allies.filter((o) => !o.dead && o.summoned).length;
  // re-derive a living ally's stats after its abilities changed (灯の祝福); HP keeps its share of the new maximum
  function deriveStats(a) {
    const d = a.def, m = a.m || {};
    a.spd0 = d.speed * (1 + (m.move || 0)); a.speed = a.spd0 * (1 - (a.chill || 0)); a.rate = d.rate / (1 + (m.aspd || 0));
    a.atkV = (d.atk || 0) * (1 + (m.atk || 0)); a.healV = (d.heal || 0) * (1 + (m.heal || 0)); a.reachV = d.range * (1 + (m.reach || 0));
    const mx = Math.round(d.hp * (1 + (m.hp || 0)) * growOf(a));
    if (mx !== a.maxHp) { a.hp = a.hp * mx / a.maxHp; a.maxHp = mx; }
  }
  const growOf = (a) => a.kind === 'golem' ? 1 + INNATE.golem.step * (a.innS || 0) : 1; // 固有能力 育つ城
  // a turret / doll called by an owner: stats come from SUMMONS, scaled by the owner's abilities
  function makeSummon(kind, owner, x) {
    const d = SUMMONS[kind], om = owner.m || {};
    const u = makeAlly(kind);
    u.m = {}; u.owner = owner.id; u.x = x; u.y = clamp(owner.y + rand(-14, 14), LANE.yMin, LANE.yMax);
    if (kind === 'turret') {
      const up = 1 + (om.turret || 0);
      u.maxHp = u.hp = Math.round(owner.def.turret.hp * (1 + (om.hp || 0)));
      u.atkV = owner.def.atk * (1 + (om.atk || 0)) * up; u.rate = owner.def.rate / (1 + (om.aspd || 0));
      u.life = owner.def.turret.life * up; u.lifeMax = u.life;
      u.m = { crit: om.crit || 0, drain: om.drain || 0 };
    } else {
      u.maxHp = u.hp = Math.round(d.hp * (1 + (om.dollHp || 0)) * (1 + (om.hp || 0) * 0.5));
      u.atkV = owner.def.atk * (1 + (om.atk || 0)); u.lullaby = om.lullaby || 0;
      u.m = { crit: om.crit || 0, drain: om.drain || 0 };
    }
    G.fx.push({ type: 'summon', x: u.x, y: u.y, life: 0.8, dur: 0.6 });
    return u;
  }
  const tierOf = (wave) => Math.max(1, Math.ceil(wave / CONFIG.tierSize));
  const waveLen = (wave) => isBossWave(wave + 1) && CONFIG.preBossWait ? CONFIG.preBossWait : CONFIG.waveInterval;
  const isBossWave = (wave) => wave > 0 && wave % CONFIG.tierSize === 0;
  function makeEnemy(kind, wave, elite) {
    const d = ENEMIES[kind];
    const { hpMul, atkMul } = growth(wave);
    const isBoss = !!d.boss;
    const tier = tierOf(wave);
    const fin = isBoss && wave >= CONFIG.totalWaves; // the last boss (W100) is a notch above the tier line
    // bossFollow: from tier 2 the boss grows along the minions' late curve (relative to wave 11)
    const lw = CONFIG.bossFollow && tier > 1 ? lateAt(wave) : null, l11 = lw && lateAt(CONFIG.tierSize + 1);
    const fH = lw ? lw[0] / l11[0] : CONFIG.bossFollow && tier > 1 && CONFIG.lateHpMul ? Math.pow(CONFIG.lateHpMul, wave - CONFIG.tierSize - 1) : 1;
    const fA = lw ? lw[1] / l11[1] : CONFIG.bossFollow && tier > 1 && CONFIG.lateAtkMul ? Math.pow(CONFIG.lateAtkMul, wave - CONFIG.tierSize - 1) : 1;
    const tierHp = lw ? 1 : 1 + CONFIG.bossTierHp * (tier - 1), fA2 = lw ? Math.pow(fA, CONFIG.bossFollowAtk != null ? CONFIG.bossFollowAtk : 1) : fA;
    const bHp = tierHp * fH * (fin ? CONFIG.finalBossHp || 1 : 1), bAtk = (1 + CONFIG.bossTierAtk * (tier - 1)) * fA2 * (fin ? CONFIG.finalBossAtk || 1 : 1);
    const eHp = elite ? CONFIG.eliteHp : 1, eAtk = elite ? CONFIG.eliteAtk : 1;
    const hp = isBoss ? d.hp * bHp : d.hp * hpMul * eHp;
    const e = {
      id: uid++, side: 'enemy', kind, elite: !!elite, fly: !!d.flying, x: LANE.enemySpawn + rand(0, 30), y: isBoss ? (LANE.yMin + LANE.yMax) / 2 + 6 : rand(LANE.yMin, LANE.yMax),
      hp, maxHp: hp, atkV: isBoss ? d.atk * bAtk : d.atk * atkMul * eAtk,
      timer: rand(0.5, 2), charged: false, fuse: 0,
      cool: rand(0.2, 0.6), anim: rand(0, 6), walk: true, atk: 0, hurt: 0, dead: 0, def: d,
      // boss state (T = per-boss timers)
      boss: isBoss, wind: 0, windT: 0, dash: 0, dashT: 0, chargeCd: 6, summonCd: BOSS.summonFirst, phase: 1, T: {}, baseAtk: 0,
      reveal: 1, hidden: false, stance: 0, spin: 0, absorb: 0, power: 0, rewind: 0, thrust: 0, landT: 0,
      speedJitter: isBoss ? 1 : rand(0.9, 1.12),
    };
    e.baseAtk = e.atkV;
    if (d.ai === 'friend') { e.hidden = true; e.reveal = 0; }
    if (d.ai === 'astro') e.thrust = 1;
    return e;
  }

  // enemy HP / ATK multipliers for a wave. Tier 1: linear per wave. From wave 11: own start + slower growth,
  // and (lateBudgetCap) the part of the budget above the cap becomes extra minion HP instead of extra enemies.
  function growth(wave) {
    const T = CONFIG.tierSize, w1 = Math.min(wave, T) - 1, wl = Math.max(0, wave - T);
    const lh = CONFIG.lateHpGrowth != null ? CONFIG.lateHpGrowth : CONFIG.hpGrowth, la = CONFIG.lateAtkGrowth != null ? CONFIG.lateAtkGrowth : CONFIG.atkGrowth;
    let hpMul = 1 + CONFIG.hpGrowth * w1 + lh * wl, atkMul = 1 + CONFIG.atkGrowth * w1 + la * wl;
    const lc = wl > 0 && lateAt(wave);
    if (lc) { hpMul = lc[0]; atkMul = lc[1]; }
    else if (wl > 0 && CONFIG.lateHpStart != null) hpMul = CONFIG.lateHpMul ? CONFIG.lateHpStart * Math.pow(CONFIG.lateHpMul, wl - 1) : CONFIG.lateHpStart + lh * (wl - 1);
    if (!lc && wl > 0 && CONFIG.lateAtkStart != null) atkMul = CONFIG.lateAtkMul ? CONFIG.lateAtkStart * Math.pow(CONFIG.lateAtkMul, wl - 1) : CONFIG.lateAtkStart + la * (wl - 1);
    const raw = rawBudget(wave), cap = CONFIG.lateBudgetCap;
    if (wl > 0 && cap > 0 && raw > cap) hpMul *= raw / cap;
    return { hpMul, atkMul };
  }
  // the late HP / ATK multipliers from CONFIG.lateCurve (null when no curve is set)
  function lateAt(wave) {
    const C = CONFIG.lateCurve; if (!C || !C.length) return null;
    if (wave <= C[0][0]) return [C[0][1], C[0][2]];
    for (let i = 1; i < C.length; i++) if (wave <= C[i][0]) {
      const a = C[i - 1], b = C[i], t = (wave - a[0]) / (b[0] - a[0]);
      return [a[1] * Math.pow(b[1] / a[1], t), a[2] * Math.pow(b[2] / a[2], t)];
    }
    const z = C[C.length - 1]; return [z[1], z[2]];
  }
  // budget the wave would have without the cap (boss waves use the last regular wave's line for the HP conversion)
  function rawBudget(n) {
    const T = CONFIG.tierSize, late = Math.max(0, n - T); // KNOB-H: per-wave growth after tier 1 (lateBudgetPerWave defaults to budgetPerWave)
    const lb = CONFIG.lateBudgetPerWave != null ? CONFIG.lateBudgetPerWave : CONFIG.budgetPerWave;
    if (late > 0 && CONFIG.lateBudgetStart != null) return CONFIG.lateBudgetStart + lb * (late - 1);
    return Math.max(CONFIG.budgetMin, CONFIG.budgetPerWave * Math.min(n, T) + lb * late + CONFIG.budgetOffset);
  }
  // ---- 予算抽選: every wave has a budget; types unlocked for the tier are drawn by weight until it is spent ----
  function waveBudget(n) {
    if (isBossWave(n)) return CONFIG.bossEscort + CONFIG.bossEscortPerTier * (tierOf(n) - 1);
    const raw = rawBudget(n), cap = CONFIG.lateBudgetCap;
    return n > CONFIG.tierSize && cap > 0 ? Math.min(raw, cap) : raw;
  }
  function buildWave(n, rng) {
    rng = rng || Math.random;
    const tier = tierOf(n), budget = waveBudget(n);
    const pool = MINIONS.filter((k) => (ENEMIES[k].tier || 1) <= tier);
    const cap = Math.max(1, budget * CONFIG.maxShare);
    const out = [];
    let left = budget, guard = 0;
    while (guard++ < 400) {
      const cand = pool.filter((k) => ENEMIES[k].cost <= left && ENEMIES[k].cost <= cap);
      if (!cand.length) break;
      let tw = 0; for (const k of cand) tw += ENEMIES[k].weight;
      let r = rng() * tw, pick = cand[0];
      for (const k of cand) { r -= ENEMIES[k].weight; if (r < 0) { pick = k; break; } }
      const d = ENEMIES[pick];
      let elite = false, cost = d.cost;
      if (tier >= ELITE_TIER && !d.pack && !d.armor && rng() < Math.min(CONFIG.eliteChanceMax, CONFIG.eliteChance + (CONFIG.eliteChancePerTier || 0) * (tier - ELITE_TIER)) && d.cost * CONFIG.eliteCost <= left && d.cost * CONFIG.eliteCost <= cap) { elite = true; cost = d.cost * CONFIG.eliteCost; }
      left -= cost;
      for (let i = 0; i < (d.pack || 1); i++) out.push({ k: pick, elite });
    }
    return out;
  }
  function startWave(n) {
    G.wave = n; G.waveTime = 0; G.waveCleared = false; G.clearTimer = 0;
    G.bossDown = false; G.bossRef = null;
    const raw = buildWave(n);
    // FIX-B: group pack members, shuffle groups, then let costly ones come later; packs arrive together
    const groups = [];
    for (let i = 0; i < raw.length;) { const p = ENEMIES[raw[i].k].pack || 1; groups.push(raw.slice(i, i + p)); i += p; }
    for (let i = groups.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [groups[i], groups[j]] = [groups[j], groups[i]]; }
    const heavy = (g) => ENEMIES[g[0].k].cost + (g[0].elite ? 3 : 0) > 3;
    groups.sort((a, b) => heavy(a) - heavy(b));
    groups.forEach((g, gi) => g.forEach((s) => { s.g = gi; }));
    const list = [].concat(...groups);
    const span = Math.min(26, 12 + 0.3 * list.length);
    let t = 0;
    let carry = (G.spawnQueue || []).filter((s) => !ENEMIES[s.k].boss).map((s) => ({ k: s.k, elite: s.elite, t: 0 }));
    if (CONFIG.carryMax > 0 && carry.length > CONFIG.carryMax) carry = carry.slice(carry.length - CONFIG.carryMax); // drop the oldest leftovers
    G.carried = carry.length;
    G.spawnQueue = [];
    list.forEach((s, i) => {
      const prev = list[i - 1];
      t = prev && prev.k === s.k && ENEMIES[s.k].pack && s.g === prev.g ? t + 0.25 : (i / Math.max(1, list.length)) * span + rand(-0.6, 0.6);
      G.spawnQueue.push({ k: s.k, elite: s.elite, t });
    });
    const boss = isBossWave(n);
    const bk = boss ? pickBoss(n) : null;
    if (boss) { G.spawnQueue.push({ k: bk, t: 3 }); G.bossKind = bk; G.bossLog.push(bk); }
    G.spawnQueue.push(...carry);
    G.spawnQueue.sort((a, b) => a.t - b.t);
    const tier = tierOf(n);
    if (boss) { const bd = ENEMIES[bk]; const sub = tier > 1 ? bd.sub2 || bd.sub : bd.sub; showBanner(bd.name, n >= CONFIG.totalWaves ? `最後の主 — ${sub}` : tier > 1 ? `第${tier}階層の主 — ${sub}` : sub, 3.2, true); Sound.play('boss'); G.shake = 0.6; }
    else if ((n - 1) % CONFIG.tierSize === 0 && n > 1) {
      const fresh = MINIONS.some((k) => ENEMIES[k].tier === tier) || tier === ELITE_TIER;
      showBanner(`第${tier}階層`, fresh ? '見たことのないナイトメアが現れ始める' : '夜はさらに深く、ナイトメアは強さを増していく', 2.6, true); Sound.play('wave');
    }
    else { showBanner(`WAVE ${n}`, isBossWave(n + 1) ? '次のウェーブで、大きな気配が来る' : waveHint(list), 2.0); Sound.play('wave'); }
  }
  function waveHint(list) {
    const fresh = [...new Set(list.map((s) => s.k))].filter((k) => !G.seen[k]);
    if (fresh.length) return '初めて見る影：' + fresh.slice(0, 3).map((k) => ENEMIES[k].name).join('、') + (fresh.length > 3 ? ' ほか' : '');
    if (list.some((s) => s.elite)) return '強い気配をまとった個体が混ざっている';
    return list.length > 30 ? 'ナイトメアの群れが濃くなっている' : 'ナイトメアが灯へ向かってくる';
  }

  // ---------------------------------------------------------------------
  //  Player action: summon
  // ---------------------------------------------------------------------
  // residents on the field (+ those inside the 夢鯨); turrets and dolls do not count
  const armyN = () => G.allies.filter((a) => !a.dead && !a.summoned).length + G.enemies.reduce((n, e) => n + (e.belly ? e.belly.filter((b) => !b.u.dead).length : 0), 0);
  const costOf = (kind) => Math.max(1, UNITS[kind].cost + ((G && G.costAdj && G.costAdj[kind]) || 0));
  function canSummon(kind) {
    const d = UNITS[kind];
    if (!G || G.mode !== 'play' || G.paused || G.picking || G.endTimer >= 0) return 'no';
    if (G.cd[kind] > 0) return 'cd';
    if (G.energy < costOf(kind)) return 'energy';
    if (armyN() >= CONFIG.allyCap) return 'cap';
    if (d.turret && summonRoom() <= 0) return 'cap'; // no room for its turret
    return 'ok';
  }
  function summon(kind) {
    const r = canSummon(kind);
    if (r !== 'ok') { if (r !== 'no') { Sound.play('deny'); flashCard(kind); } return false; }
    const d = UNITS[kind];
    G.energy -= costOf(kind); G.cd[kind] = G.cdMax[kind]; G.summoned++;
    const a = makeAlly(kind);
    G.allies.push(a);
    // 灯を喰らうもの「影の手」: sometimes a shadow hand grabs the summoning circle and numbs the new resident
    const bb = G.bossRef;
    if (bb && !bb.dead && bb.def.ai === 'devourer' && G.time > (G.handCd || 0) && Math.random() < bb.def.hand.chance) {
      G.handCd = G.time + bb.def.hand.cd; a.sealT = bb.def.hand.stun;
      G.texts.push({ x: a.x, y: a.y - 84, v: '影の手', life: 1.2, skill: true }); G.fx.push({ type: 'smoke', x: a.x, y: a.y, life: 1, dur: 0.8 });
    }
    G.fx.push({ type: 'summon', x: a.x, y: a.y, life: 1, dur: 0.8 });
    if (d.turret) placeTurret(a);
    for (let i = 0; i < 14; i++) G.motes.push({ x: a.x + rand(-18, 18), y: a.y - rand(0, 10), vx: rand(-20, 20), vy: rand(-90, -30), life: rand(0.5, 1), max: 1, color: '150,225,255', kind: 'spark' });
    G.cast = 0.6;
    Sound.play('summon');
    return true;
  }

  // ---- 灯の祝福 ----
  function rollBlessing(kind) {
    const d = UNITS[kind];
    const types = Object.keys(BLESS).filter((t) => BLESS[t].ok(d, kind));
    let tw = 0; for (const t of types) tw += BLESS[t].w;
    let r = Math.random() * tw, type = types[0];
    for (const t of types) { r -= BLESS[t].w; if (r < 0) { type = t; break; } }
    if (type === 'special') {
      const ids = specialsOf(kind), id = ids[(Math.random() * ids.length) | 0], A = Abilities.ABIL[id];
      const rr = A.r.E || A.r.L || A.r.R, mid = (rr[0] + rr[1]) / 2;
      const v = A.unit === 'n' ? Math.round(mid) : A.unit === 's' || A.dec ? Math.round(mid * 10) / 10 : Math.round(mid);
      return { kind, type, key: id, v: A.unit === 's' || A.unit === 'n' ? v : v / 100, label: `特殊能力「${A.name}」`, fmt: Abilities.format({ id, v }) };
    }
    const B = BLESS[type];
    return { kind, type, key: type, v: B.v, label: B.label(d), fmt: B.fmt };
  }
  function offerBlessing() {
    const pool = DECK.slice();
    for (let i = pool.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [pool[i], pool[j]] = [pool[j], pool[i]]; }
    G.offer = pool.slice(0, 3).map(rollBlessing);
    G.picking = true;
    if (window.__yume && window.__yume.autoPick) { pickBlessing(window.__yume.autoPick(G.offer, G) | 0); return; }
    showBlessScreen();
  }
  function pickBlessing(i) {
    if (!G || !G.picking || !G.offer) return;
    const o = G.offer[clamp(i, 0, G.offer.length - 1)];
    const m = G.mods[o.kind];
    if (o.type === 'cost') G.costAdj[o.kind] = (G.costAdj[o.kind] || 0) - o.v;
    else { m[o.key] = (m[o.key] || 0) + o.v; const cap = Abilities.CAP[o.key]; if (cap != null && m[o.key] > cap) m[o.key] = cap; }
    if (o.key === 'recast') G.cdMax[o.kind] = UNITS[o.kind].cd * (1 - (m.recast || 0));
    for (const a of G.allies) if (!a.dead && a.kind === o.kind) deriveStats(a);
    G.blessings.push(o); G.offer = null; G.picking = false;
    $('blessScreen').hidden = true;
    showBanner(`${UNITS[o.kind].name}に灯の祝福`, `${o.label} ${o.fmt}`, 2.2); Sound.play('epic');
    refreshCardBless();
  }
  function showBlessScreen() {
    const root = $('blessCards'); root.innerHTML = '';
    $('blessTitle').textContent = `第${tierOf(G.wave)}階層を突破`;
    G.offer.forEach((o, i) => {
      const d = UNITS[o.kind], b = document.createElement('button');
      const have = G.blessings.filter((x) => x.kind === o.kind).length;
      b.type = 'button'; b.className = 'bless-card' + (o.type === 'special' ? ' special' : '');
      b.innerHTML = `<span class="key">${i + 1}</span><canvas></canvas><b class="nm">${d.name}</b><span class="eff">${o.label}<em>${o.fmt}</em></span>${have ? `<span class="have">祝福 ${have}つ目→${have + 1}つ目</span>` : ''}`;
      Art.drawCardArt(b.querySelector('canvas'), o.kind, 120);
      b.addEventListener('click', () => pickBlessing(i));
      root.appendChild(b);
    });
    ui.banner.classList.remove('show');
    $('blessScreen').hidden = false; Sound.play('legend');
  }
  function refreshCardBless() {
    for (const k of DECK) { const c = cardEls[k]; if (!c) continue; const n = G ? G.blessings.filter((x) => x.kind === k).length : 0; c.bl.textContent = n ? `祝${n}` : ''; }
  }

  // ---------------------------------------------------------------------
  //  Combat helpers
  // ---------------------------------------------------------------------
  // returns the damage actually dealt
  // pen = share of the target's armor ignored (スナイパー)
  function damage(target, amount, from, crit, pen) {
    if (target.dead) return 0;
    if (target.invul > 0) return 0;
    const ally = target.side === 'ally';
    // 最後の打者: in his batting stance, shots from ranged allies are hit back (the batter takes nothing)
    if (!ally && (target.def.ai === 'batter' || target.form === 'batter') && target.stanceOn && from && from.side === 'ally' && from.def && from.def.shot && !from.dead) { batBack(target, from, amount); return 0; }
    // 異端の魔女のリボンの結界: shots and spells deal half; each melee hit cuts one ribbon
    if (!ally && target.barrier > 0 && from && from.side === 'ally' && from.def) {
      if (from.def.shot) amount *= 1 - target.def.barrier.cut;
      else if (from.def.melee) { target.barrier--; if (target.barrier <= 0) { target.T.rib = target.def.barrier.every; G.texts.push({ x: target.x, y: target.y - 220, v: 'リボンが切れた', life: 1.2, skill: true }); } }
    }
    // 灯を喰らうもの「飢え」: takes more damage for a while
    if (!ally && target.starveT > 0 && target.def.drain) amount *= 1 + target.def.drain.weak;
    // ハンターの印: a marked enemy takes more from every ally
    if (!ally && from && from.side === 'ally' && target.markT > G.time) amount *= 1 + target.markV;
    // 固有能力 かばう背中（盾兵）/ 病室の約束（パラディン）: half damage for a while
    const raw = amount;
    if (ally && target.halfT > G.time) amount *= 1 - (target.halfV || 0.5);
    const guard = ally && target.m ? (target.m.guard || 0) : 0;
    const armor = (target.def.armor || 0) * (1 - (pen || 0));
    const aura = ally ? (target.auraV || 0) : 0; // パラディンの守りの輪
    const team = ally && target.kind === 'doll' ? INNATE.dollmaster.guard * (target.teamN || 0) : 0; // 固有能力 みんないっしょ
    let dmg = Math.max(1, Math.round(amount * (1 - armor) * (1 - guard) * (1 - aura) * (1 - team)));
    // 灯を喰らうもの: the membrane made from drained energy takes the hit first
    if (!ally && target.shieldHp > 0) { const sh = Math.min(target.shieldHp, dmg); target.shieldHp -= sh; dmg -= sh; if (dmg <= 0) { target.hurt = 1; return 0; } }
    // 固有能力 もう一度立つ（バーサーカー）: survives one lethal hit at 30% HP
    if (ally && target.kind === 'berserker' && !target.rose && target.hp - dmg <= 0) {
      target.rose = true; target.hp = Math.max(1, Math.round(target.maxHp * INNATE.berserker.hp)); target.invul = 0.6; target.hurt = 1;
      innText(target, 'もう一度立つ'); G.fx.push({ type: 'heal', x: target.x, y: target.y, life: 1, dur: 0.8 });
      return 0;
    }
    // 身代わり: a paladin nearby may take a hit that would fell another ally
    if (ally && target.hp - dmg <= 0 && !target.def.aura && !target.summoned && !(target.m && target.m.undying && !target.usedUndying)) {
      const p = G.allies.find((o) => !o.dead && o.def.aura && o.m && o.m.cover && o.hp > o.maxHp * 0.3 && Math.abs(o.x - target.x) <= o.def.aura.r * (1 + (o.m.ring || 0)) && Math.random() < o.m.cover);
      if (p) { G.texts.push({ x: target.x, y: target.y - 84, v: '身代わり', life: 1.1, skill: true }); return damage(p, raw, from, crit, pen); }
    }
    // 不屈: survive one lethal hit, then a short invulnerability
    if (ally && target.m && target.m.undying && !target.usedUndying && target.hp - dmg <= 0) {
      target.usedUndying = true; target.hp = 1; target.invul = target.m.undying; target.hurt = 1;
      G.texts.push({ x: target.x, y: target.y - 80, v: '不屈', life: 1.1, skill: true });
      G.fx.push({ type: 'heal', x: target.x, y: target.y, life: 1, dur: 0.7 });
      return 0;
    }
    target.hp -= dmg; target.hurt = 1;
    G.texts.push({ x: target.x + rand(-8, 8), y: target.y - (target.boss ? 220 : 70) - flyH(target), v: crit ? dmg + '!' : dmg, life: 0.8, enemy: !ally, crit: !!crit });
    if (ally) innHurt(target, from);
    // 反撃の盾
    if (ally && target.m && target.m.reflect && from && from.side === 'enemy' && !from.dead) damage(from, dmg * target.m.reflect, null);
    if (!ally && target.def.ai === 'friend') target.revealT = Math.max(target.revealT || 0, target.def.hitShow); // 顔のない友人: a hit makes it show itself
    if (target.hp <= 0) kill(target, from);
    return dmg;
  }
  // 固有能力 that react to a resident being hurt
  function innHurt(a, from) {
    if (a.kind === 'guardian' && from && from.side === 'enemy') {
      const I = INNATE.guardian;
      a.innC = (a.innC || 0) + 1;
      if (a.innC >= I.every) { a.innC = 0; a.halfT = G.time + I.t; a.halfV = I.v; innText(a, 'かばう背中'); G.fx.push({ type: 'aura', x: a.x, y: a.y, life: 1, dur: 0.8, r: 46 }); }
      a.pipN = a.innC;
    } else if (a.kind === 'mage') { a.innS = 0; a.pipN = 0; }
    else if (a.kind === 'paladin' && !a.vowed && a.hp > 0 && a.hp < a.maxHp * INNATE.paladin.at) {
      const I = INNATE.paladin, r = a.def.aura.r * (1 + ((a.m && a.m.ring) || 0));
      a.vowed = true; a.halfT = G.time + I.t; a.halfV = I.v; innText(a, '病室の約束');
      for (const o of G.allies) if (!o.dead && o !== a && !o.summoned && Math.abs(o.x - a.x) <= r && o.hp < o.maxHp) { o.hp = Math.min(o.maxHp, o.hp + o.maxHp * I.heal); G.fx.push({ type: 'heal', x: o.x, y: o.y, life: 0.9, dur: 0.7 }); }
      G.fx.push({ type: 'aura', x: a.x, y: a.y, life: 1, dur: 1.2, r });
    }
  }
  // an ally's hit value (crit + 祝福 buff)
  function allyHit(a, base) {
    const m = a.m || {};
    const crit = m.crit && Math.random() < m.crit;
    const team = a.kind === 'doll' ? 1 + INNATE.dollmaster.atk * (a.teamN || 0) : 1; // 固有能力 みんないっしょ
    const buff = (a.blessT > 0 ? 1 + a.blessV : 1) * (1 + (a.anthemV || 0)) * (1 + (a.frenzyV || 0)) * team;
    return { dmg: base * buff * (crit ? 1.8 : 1), crit };
  }
  function drainTo(a, dealt) {
    if (!a || a.dead || !a.m || !a.m.drain || dealt <= 0) return;
    a.hp = Math.min(a.maxHp, a.hp + dealt * a.m.drain);
  }
  function stun(e, sec) {
    if (e.dead) return;
    const s = e.boss ? sec * 0.3 : sec;
    e.frozenT = Math.max(e.frozenT || 0, s);
  }
  function meleeStrike(a, t, follow) {
    // 固有能力 一歩前へ（剣士）: every 5th swing (二連斬り's extra cut does not count) hits ×2.5 and pushes back
    let base = a.atkV, page = false;
    if (a.kind === 'swordsman' && !follow) {
      const I = INNATE.swordsman;
      a.innC = (a.innC || 0) + 1;
      if (a.innC >= I.every) { a.innC = 0; page = true; base *= I.mul; }
      a.pipN = a.innC;
    }
    const h = allyHit(a, base);
    const m = a.m || {}, d = a.def;
    if (d.line) {
      // 槍兵: thrust through the first enemies in line within reach
      const reach = a.reachV + 14;
      const n = d.line + (m.skewer && Math.random() < m.skewer ? 1 : 0);
      const line = G.enemies.filter((e) => !e.dead && e.x - a.x > -24 && e.x - a.x <= reach + (e.def.radius || 12)).sort((p, q) => p.x - q.x).slice(0, n);
      if (!line.includes(t)) line.unshift(t);
      let dealt = 0;
      line.slice(0, n).forEach((e, i) => { dealt += damage(e, h.dmg * (i === 0 ? 1 : 0.8), a, i === 0 && h.crit); });
      G.fx.push({ type: 'thrust', x: a.x + 10, x2: a.x + reach, y: a.y - 32, life: 1, dur: 0.22 });
      drainTo(a, dealt); Sound.play('hit');
      return;
    }
    if (d.pound) {
      // ゴーレム: ground pound around the target
      let dealt = 0;
      for (const e of G.enemies) if (!e.dead && (!e.fly || e === t) && Math.abs(e.x - t.x) <= d.pound + (e.def.radius || 0)) {
        dealt += damage(e, e === t ? h.dmg : h.dmg * 0.7, a, e === t && h.crit);
        if (m.quake && Math.random() < m.quake) stun(e, 1);
      }
      G.fx.push({ type: 'shock', x: t.x - 10, y: a.y, life: 1, dur: 0.4, r: d.pound, ally: true });
      G.shake = Math.max(G.shake, 0.12);
      drainTo(a, dealt); Sound.play('slam');
      return;
    }
    drainTo(a, damage(t, h.dmg, a, h.crit));
    if (page) {
      if (!t.dead && !t.boss) t.x += INNATE.swordsman.knock;
      G.fx.push({ type: 'slash', x: t.x, y: t.y - 34, life: 1, dur: 0.4, big: true }); G.shake = Math.max(G.shake, 0.1);
    }
    // 旋風斬り
    if (m.cleave) for (const e of G.enemies) if (e !== t && !e.dead && !e.fly && Math.abs(e.x - t.x) <= 50) drainTo(a, damage(e, h.dmg * m.cleave, a));
    // 二連斬り
    if (!follow && m.double && Math.random() < m.double) a.pending = { t: 0.16, target: t };
    Sound.play('hit');
  }
  function kill(u, killer) {
    u.dead = 0.0001; u.hp = 0;
    // バーサーカー: heals a little on every kill (血潮 raises it)
    if (u.side === 'enemy' && killer && !killer.dead && killer.def && killer.def.killHeal) {
      const h = killer.maxHp * killer.def.killHeal * (1 + ((killer.m && killer.m.blood) || 0));
      killer.hp = Math.min(killer.maxHp, killer.hp + h);
    }
    if (u.side === 'enemy') {
      G.kills++;
      // 固有能力 図鑑の新しいページ（ハンター）: a flyer shot down gives back a little energy (a few times per wave)
      if (u.fly && killer && killer.kind === 'hunter') {
        const I = INNATE.hunter;
        if (G.huntW !== G.wave) { G.huntW = G.wave; G.huntN = 0; }
        if (G.huntN < I.perWave) { G.huntN++; G.energy = Math.min(CONFIG.energyMax, G.energy + I.energy); G.texts.push({ x: killer.x, y: killer.y - 92, v: '+' + I.energy + ' エネルギー', life: 1.2, heal: true }); }
      }
      // 固有能力 かき氷のしぶき（氷の魔法使い）: an enemy slowed by ice bursts into cold when it falls
      if (u.iceT > G.time && G.allies.some((o) => !o.dead && o.kind === 'icemage')) {
        const I = INNATE.icemage;
        for (const e of G.enemies) if (!e.dead && e !== u && !e.stanceOn && Math.abs(e.x - u.x) <= I.r + (e.def.radius || 0)) {
          const v = e.boss ? I.v * 0.35 : I.v;
          if (v >= (e.slowV || 0) || !(e.slowT > 0)) e.slowV = v;
          e.slowT = Math.max(e.slowT || 0, I.t); e.iceT = Math.max(e.iceT || 0, G.time + I.t);
        }
        G.fx.push({ type: 'frost', x: u.x, y: u.y, life: 1, dur: 0.5, r: I.r });
      }
      // 速達: a letter shot down is opened — the undelivered words reach the residents around it
      if (u.def.courier) {
        const X = ENEMIES.postman.express, words = ['ありがとう', 'ごめんね', 'またね', 'だいすき', 'げんきでね'];
        for (const o of G.allies) if (!o.dead && Math.abs(o.x - u.x) <= X.r + 60) { o.hp = Math.min(o.maxHp, o.hp + o.maxHp * X.heal); G.fx.push({ type: 'heal', x: o.x, y: o.y, life: 0.8, dur: 0.6 }); }
        G.texts.push({ x: u.x, y: u.y - 110, v: words[(Math.random() * words.length) | 0], life: 1.6, heal: true });
      }
      const n = u.boss ? 40 : u.kind === 'armor' || u.elite ? 8 : u.kind === 'swarm' ? 2 : 5;
      const per = u.def.dream * (u.elite ? 3 : 1) / n;
      for (let i = 0; i < n; i++) G.motes.push({ x: u.x + rand(-14, 14), y: u.y - flyH(u) - rand(10, u.boss ? 180 : 50), vx: rand(-60, 60), vy: rand(-120, -20), life: 0, kind: 'dream', value: per, delay: rand(0, 0.35) });
      Sound.play('kill');
      if (u.boss) {
        G.bossDown = true; G.bosses++; G.spawnQueue.length = 0; G.hazards.length = 0; G.quakes.length = 0; G.lastBossName = u.def.name; G.curtain = 0; G.drainWarn = 0;
        (G.bossKilled = G.bossKilled || []).push(u.kind);
        if (u.belly) for (const b of u.belly.slice()) releaseBelly(u, b); // 夢鯨: everyone inside comes back out
        // 記憶のかけら: the nightmare is gone; only a fragment of its memory remains (memories.js)
        const mm = !G.scripted && window.Memories ? window.Memories.gain(u.kind, G.wave) : null;
        if (mm) { G.memRun++; G.shards.push({ x: u.x, y: u.y - 110 - flyH(u), t: 0 }); }
        showBanner(`${u.def.name}は光の粒となって消えた`, (mm ? `記憶のかけらが残った（${Math.min(3, mm.n)} / 3）` : '') + (alive(G.enemies).length > 1 ? (mm ? '　' : '') + '残るナイトメアを退けろ' : ''), 2.6);
        for (const a of G.allies) { a.hitByRun = false; a.hitByDash = false; }
        G.shake = 0.8; G.fx.push({ type: 'burst', x: u.x, y: u.y - 110 - flyH(u), life: 1, dur: 1.6 }); }
    } else {
      if (u.summoned) {
        // 固有能力 放っておけない（エンジニア）: a turret that was destroyed is rebuilt quickly
        if (u.kind === 'turret') { const o = G.allies.find((x) => x.id === u.owner && !x.dead); if (o) o.fastBuild = true; }
        expire(u, true); return;
      }
      G.lost++;
      for (let i = 0; i < 10; i++) G.motes.push({ x: u.x + rand(-10, 10), y: u.y - rand(10, 50), vx: rand(-30, 30), vy: rand(-70, -20), life: rand(0.6, 1.2), max: 1.2, color: '200,230,255', kind: 'spark' });
      Sound.play('allyDown');
    }
  }
  const alive = (arr) => arr.filter((u) => !u.dead);
  // a turret runs out / a doll fades or falls (no 'lost' count). 子守唄: a fading doll heals allies around it
  function expire(u, already) {
    if (!already) { u.dead = 0.0001; u.hp = 0; }
    if (u.lullaby > 0) {
      const amt = u.maxHp * u.lullaby;
      for (const o of G.allies) if (!o.dead && o !== u && !o.summoned && Math.abs(o.x - u.x) <= 90 && o.hp < o.maxHp) { o.hp = Math.min(o.maxHp, o.hp + amt); G.fx.push({ type: 'heal', x: o.x, y: o.y, life: 0.7, dur: 0.6 }); }
    }
    for (let i = 0; i < 8; i++) G.motes.push({ x: u.x + rand(-10, 10), y: u.y - rand(5, 35), vx: rand(-30, 30), vy: rand(-60, -20), life: rand(0.4, 0.9), max: 0.9, color: u.kind === 'turret' ? '255,210,140' : '230,210,255', kind: 'spark' });
  }

  // ---------------------------------------------------------------------
  //  Update
  // ---------------------------------------------------------------------
  function update(dt) {
    G.time += dt;
    // energy
    const dv = G.bossRef && !G.bossRef.dead && G.bossRef.def.regen ? G.bossRef.def.regen : 1; // 灯喰い: slower energy while the last boss is alive
    G.energy = Math.min(CONFIG.energyMax, G.energy + CONFIG.energyRegen * dt * dv);
    G.curtain = Math.max(0, (G.curtain || 0) - dt); G.drainWarn = Math.max(0, (G.drainWarn || 0) - dt);
    for (const k of DECK) G.cd[k] = Math.max(0, G.cd[k] - dt);
    G.cast = Math.max(0, G.cast - dt);
    G.towerFlash = Math.max(0, G.towerFlash - dt * 3);
    G.lampBoost = Math.max(0, G.lampBoost - dt * 1.5);
    G.shake = Math.max(0, G.shake - dt);

    // waves
    if (G.scripted) {
      // チュートリアル: no wave progression; tutorial.js queues enemies with spawn(); the lighthouse cannot fall
      G.waveTime += dt;
      while (G.spawnQueue.length && G.spawnQueue[0].t <= G.waveTime) { const s = G.spawnQueue.shift(); G.enemies.push(makeEnemy(s.k, 1, false)); G.seen[s.k] = true; }
      if (G.hp < G.hpMax * 0.35) G.hp = G.hpMax * 0.35;
    } else if (G.wave === 0) {
      G.prep -= dt;
      if (G.prep <= 0) startWave(1);
    } else if (G.endTimer < 0) {
      G.waveTime += dt;
      let liveN = CONFIG.maxLive ? alive(G.enemies).length : 0; // KNOB-I: hold spawns while the field is full (phones)
      while (G.spawnQueue.length && G.spawnQueue[0].t <= G.waveTime && !(CONFIG.maxLive && liveN >= CONFIG.maxLive && !ENEMIES[G.spawnQueue[0].k].boss)) { liveN++;
        const s = G.spawnQueue.shift();
        const e = makeEnemy(s.k, G.wave, s.elite);
        G.enemies.push(e); G.seen[s.k] = true;
        if (e.boss) G.bossRef = e;
      }
      if (CONFIG.maxLive && liveN >= CONFIG.maxLive) { // the boss never waits behind queued minions
        const bi = G.spawnQueue.findIndex((s) => ENEMIES[s.k].boss && s.t <= G.waveTime);
        if (bi >= 0) { const s = G.spawnQueue.splice(bi, 1)[0]; const e = makeEnemy(s.k, G.wave); G.enemies.push(e); G.seen[s.k] = true; G.bossRef = e; }
      }
      const iv = waveLen(G.wave);
      if (isBossWave(G.wave + 1) && G.bossWarned !== G.wave && (G.waveTime >= iv - 6 || (G.spawnQueue.length === 0 && alive(G.enemies).length === 0))) { G.bossWarned = G.wave; showBanner('大きな気配が近づいている', 'エネルギーを溜めて備えよう', 2.4, true); }
      const fieldEmpty = G.spawnQueue.length === 0 && alive(G.enemies).length === 0;
      if (!isBossWave(G.wave)) {
        if (fieldEmpty) { G.clearTimer += dt; }
        if (G.waveTime >= iv || (fieldEmpty && G.clearTimer >= CONFIG.earlyClearDelay)) startWave(G.wave + 1);
      } else if (G.bossDown && fieldEmpty) {
        if (G.wave >= CONFIG.totalWaves) { G.endTimer = 2.2; G.outcome = 'win'; }
        else {
          G.clearTimer += dt;
          if (G.clearTimer >= CONFIG.earlyClearDelay) startWave(G.wave + 1);
          else if (G.clearTimer >= 1.6 && (!G.tierBanner || G.tierBanner !== G.wave)) {
            G.tierBanner = G.wave; showBanner(`第${tierOf(G.wave)}階層を突破`, '灯はまだ消えない。さらに深い夜へ', 2.6); Sound.play('win');
            // 灯の回復: clearing a tier restores part of the lighthouse (long runs should not be decided by chip damage alone); max HP stays 1200
            if (CONFIG.tierHeal > 0 && G.hp > 0) { const h = Math.min(G.hpMax - G.hp, G.hpMax * CONFIG.tierHeal); if (h > 0) { G.hp += h; G.texts.push({ x: Art.LH.x + 40, y: 400, v: '+' + Math.round(h), life: 1.4, heal: true }); } }
            offerBlessing();
            return;
          }
        }
      }
    }
    if (G.endTimer >= 0) { G.endTimer -= dt; if (G.endTimer <= 0) { finish(G.outcome); return; } }

    const A = alive(G.allies), E0 = alive(G.enemies);
    // 顔のない友人: a hidden enemy cannot be picked as a target by allies (area attacks still reach it)
    const E = E0.filter((e) => !e.hidden);
    // a 忍者 that leapt behind the enemy (a.away) does not count as the front line
    const frontAlly = A.reduce((m, a) => a.away ? m : Math.max(m, a.x), LANE.allySpawn);
    // 冷気 / 淀む時: some bosses slow the allies around them (move and attack)
    for (const a of A) a.chill = 0;
    for (const b of E0) {
      const bd = b.def, c = bd.ai === 'snow' ? bd.chill : bd.ai === 'clock' && b.phase === 2 ? bd.chill : b.form === 'snowman' ? ENEMIES.snowman.chill : b.form === 'clock' ? ENEMIES.clock.chill : null;
      if (!c) continue;
      const r = b.phase === 2 && c.r2 ? c.r2 : c.r;
      for (const a of A) if (Math.abs(a.x - b.x) <= r) a.chill = Math.max(a.chill, c.v);
    }
    for (const a of A) a.speed = a.spd0 * (1 - a.chill);
    // 固有能力: 旗のもとに（槍兵）/ ふえていく歌（バード）/ 育つ城（ゴーレム）/ みんないっしょ（人形）
    const vanX = A.reduce((m, o) => o.def.melee && !o.def.mid && !o.away && !(o.toyT > 0) ? Math.max(m, o.x) : m, 0);
    for (const a of A) {
      a.age = (a.age || 0) + dt;
      if (a.kind === 'spearman') a.rallyV = vanX > a.x && vanX - a.x <= INNATE.spearman.near ? INNATE.spearman.v : 0;
      else if (a.kind === 'bard') { const I = INNATE.bard; a.innS = Math.min(I.max, Math.floor(a.age / I.every)); a.pipN = a.innS; }
      else if (a.kind === 'golem') {
        const I = INNATE.golem, n = Math.min(I.max, Math.floor(a.age / I.every));
        if (n > (a.innS || 0)) {
          a.innS = n; a.pipN = n;
          const mx = Math.round(a.def.hp * (1 + ((a.m && a.m.hp) || 0)) * growOf(a));
          a.hp += mx - a.maxHp; a.maxHp = mx;
          G.fx.push({ type: 'heal', x: a.x, y: a.y, life: 0.9, dur: 0.7 });
        }
      } else if (a.kind === 'doll') a.teamN = A.filter((o) => o.kind === 'doll' && o.owner === a.owner).length;
    }
    // バードの歌: allies inside any bard's ring get faster attacks (and more attack with 高揚の歌)
    for (const a of A) { a.songV = 0; a.anthemV = 0; a.auraV = 0; }
    // パラディンの守りの輪: allies within the ring take less damage (守りの輪 widens and strengthens it)
    for (const p of A) if (p.def.aura) {
      const k = 1 + ((p.m && p.m.ring) || 0), r = p.def.aura.r * k, v = Math.min(0.4, p.def.aura.v * k);
      for (const a of A) if (Math.abs(a.x - p.x) <= r) a.auraV = Math.max(a.auraV, v);
      p.auraPulse = (p.auraPulse || 0) - dt;
      if (p.auraPulse <= 0) { p.auraPulse = 2.2; G.fx.push({ type: 'aura', x: p.x, y: p.y, life: 1, dur: 1.2, r }); }
    }
    for (const b of A) if (b.kind === 'bard') {
      const m = b.m || {}, r = b.def.range * (1 + (m.echo || 0));
      const sv = b.def.song * (1 + (m.song || 0)) + INNATE.bard.step * (b.innS || 0);
      for (const a of A) if (a !== b && Math.abs(a.x - b.x) <= r) { a.songV = Math.max(a.songV, sv); a.anthemV = Math.max(a.anthemV, m.anthem || 0); }
    }

    // ---- allies ----
    // 後ろに抜けた敵：近接の前線より後ろへ入り込んだ敵は、後衛（射撃キャラ）が優先して倒しに行く。前線は持ち場を守る
    const lineX = A.reduce((m, o) => o.def.melee && !o.away && !(o.toyT > 0) ? Math.max(m, o.x) : m, 0);
    const leakers = lineX > 0 ? E.filter((e) => e.x < lineX - 30) : [];
    // (the スナイパー keeps aiming at the toughest enemy, so it is not counted as leaker cover)
    const shooters = A.filter((o) => o.def.shot && !o.def.pickTough && o.speed > 0); // a turret cannot go after leakers
    for (const a of A) {
      const d = a.def;
      if (a.dazeT > 0) a.dazeT -= dt;
      // 封（郵便屋の手紙・影の手）: cannot attack for a while. おもちゃ（魔女）: cannot act at all, and nightmares walk past it
      if (a.sealT > 0) { a.sealT -= dt; a.cool = Math.max(a.cool, 0.1); }
      if (a.toyT > 0) { if (a.invul > 0) a.invul -= dt; a.toyT -= dt; a.anim += dt; a.walk = false; a.atk = 0; a.hurt = Math.max(0, a.hurt - dt * 4); continue; }
      a.anim += dt; a.atk = Math.max(0, a.atk - dt * 3); a.hurt = Math.max(0, a.hurt - dt * 4); a.cool -= dt * (1 + a.songV + (a.frenzyV || 0) * 0.5 + (a.rallyV || 0)) * (a.dazeT > 0 ? 0.5 : 1) * (1 - a.chill) * (a.sealT > 0 ? 0 : 1);
      if (a.invul > 0) a.invul -= dt;
      // 砲台 runs out after its life; 眠り人形 slowly fades
      if (a.life != null) { a.life -= dt; if (a.life <= 0) { expire(a); continue; } }
      if (d.decay) { a.hp -= a.maxHp * d.decay * dt; if (a.hp <= 0) { expire(a); continue; } }
      // バーサーカー: frenzy grows as HP falls (full at 30% HP or less); it also speeds up the swing by half as much
      if (d.frenzy) { a.frenzy = clamp((1 - a.hp / a.maxHp) / 0.7, 0, 1); a.frenzyV = d.frenzy * (1 + ((a.m && a.m.surge) || 0)) * a.frenzy; } // a.frenzy (0–1) drives the sprite's glow
      if (a.m && a.m.moss && a.hp < a.maxHp) a.hp = Math.min(a.maxHp, a.hp + a.maxHp * a.m.moss * dt);
      if (a.blessT > 0) a.blessT -= dt;
      if (a.pending) { a.pending.t -= dt; if (a.pending.t <= 0) { const t = a.pending.target; a.pending = null; if (!t.dead) { a.atk = 1; meleeStrike(a, t, true); } } }
      if (d.support) { if (a.kind === 'bard') updateBard(a, A, E, frontAlly, dt); else if (d.turret) updateEngineer(a, A, E, frontAlly, dt); else if (d.dolls) updateDollmaster(a, A, E, frontAlly, dt); else updateHealer(a, A, E, frontAlly, dt); continue; }
      if (d.leap && ninjaStep(a, E, lineX, frontAlly, dt)) continue;
      // nearest enemy at or ahead; also track the nearest one that got BEHIND us (boss charge, spawn-behind)
      // 飛行型 can only be hit by shooters and the spearman's reach
      const air = !!((d.shot && !d.noAir) || d.line);
      // ハンター: a flyer in reach comes first (but a ground enemy behind the line is still the back line's job)
      if (d.antiAir && !leakers.some((e) => !e.fly)) {
        let fb = null;
        for (const e of E) if (e.fly && Math.abs(e.x - a.x) <= a.reachV + (e.def.radius || 12) && (!fb || e.x < fb.x)) fb = e;
        if (fb) {
          a.face = fb.x < a.x ? -1 : 1; a.walk = false; a.aim = Math.min(1, a.aim + dt * 2);
          if (a.cool <= 0) { a.cool = a.rate; a.atk = 1; fire(a, fb); }
          continue;
        }
      }
      // スナイパー: the enemy with the highest max HP in reach (ties: the nearest)
      if (d.pickTough) {
        let t = null;
        for (const e of E) {
          if (Math.abs(e.x - a.x) > a.reachV + (e.def.radius || 12)) continue;
          if (!t || e.maxHp > t.maxHp + 1 || (Math.abs(e.maxHp - t.maxHp) <= 1 && Math.abs(e.x - a.x) < Math.abs(t.x - a.x))) t = e;
        }
        if (t) {
          a.face = t.x < a.x ? -1 : 1; a.walk = false; a.aim = Math.min(1, a.aim + dt * 2);
          if (a.cool <= 0) { a.cool = a.rate; a.atk = 1; fire(a, t); a.idleT = 0; }
          continue;
        }
        a.idleT = (a.idleT || 0) + dt; // 息を整える
      }
      const myLeakers = d.noAir ? leakers.filter((e) => !e.fly) : leakers;
      let lk = null;
      if (d.shot && !d.pickTough && myLeakers.length) {
        // the leaker closest to the lighthouse first
        for (const e of myLeakers) if (!lk || e.x < lk.x) lk = e;
        const gap = lk.x - a.x, inReach = Math.abs(gap) <= a.reachV + (lk.def.radius || 12);
        if (!inReach && a.speed <= 0) lk = null; // 砲台: a leaker out of reach is someone else's job; keep shooting what it can reach
      }
      if (d.shot && !d.pickTough && myLeakers.length && lk) {
        const gap = lk.x - a.x, inReach = Math.abs(gap) <= a.reachV + (lk.def.radius || 12);
        a.face = gap < 0 ? -1 : 1;
        if (inReach) {
          a.walk = false; a.aim = Math.min(1, a.aim + dt * 2);
          if (a.cool <= 0) { a.cool = a.rate; a.atk = 1; fire(a, lk); }
        } else {
          a.aim = 0; a.walk = true;
          a.x = gap < 0 ? Math.max(LANE.allySpawn - 20, a.x - a.speed * dt) : a.x + a.speed * dt;
        }
        continue;
      }
      let tgt = null, best = 1e9, back = null, backD = 1e9;
      for (const e of E) {
        if (e.fly && (d.noAir || (!air && !e.lowFly && e.x > LANE.front + 90 && !(e.swoop > G.time)))) continue; // FIX-D + a flyer swooping to attack is in melee reach; 花火師 never targets flyers
        const dx = e.x - a.x;
        if (dx > -24) { if (dx < best) { best = dx; tgt = e; } }
        else if (-dx < backD) { backD = -dx; back = e; }
      }
      const reach = tgt ? a.reachV + (tgt.def.radius || 12) : 0;
      const backReach = back ? a.reachV + (back.def.radius || 12) : 0;
      const hit = tgt && best <= reach ? tgt : back && backD <= backReach ? back : null;
      a.face = hit === back && back ? -1 : 1;
      if (hit) {
        a.walk = false; a.aim = Math.min(1, a.aim + dt * 2);
        if (a.cool <= 0) {
          a.cool = a.rate; a.atk = 1;
          if (d.shot) fire(a, hit);
          else meleeStrike(a, hit, false);
        }
      } else if (back && a.speed > 0 && (!d.melee || !shooters.length || back.boss)) {
        // an enemy slipped past the line and no back-line shooter can take it: turn around and chase it
        // (the boss is always chased: after a phase-2 charge it stands behind the line and the back line alone cannot hold it)
        a.aim = 0; a.face = -1; a.x = Math.max(LANE.allySpawn - 20, a.x - a.speed * dt); a.walk = true;
      } else {
        a.aim = 0;
        // ranged units hold behind the melee front
        const meleeFront = lineX;
        // 中衛 (d.mid) stays a little behind the front-most non-midline melee
        const vanX = d.mid ? A.reduce((m, o) => o.def.melee && !o.def.mid && !o.away ? Math.max(m, o.x) : m, 0) : 0;
        const hold = d.mid ? vanX > 0 && a.x > vanX - d.mid : !d.melee && meleeFront > 0 && a.x > meleeFront - (d.hold || Math.min(170, d.range - 60));
        // idle allies wait at allyMaxX; once an enemy is on screen they may advance to the battle line engageMaxX
        const capX = tgt && tgt.x <= 1280 ? LANE.engageMaxX : LANE.allyMaxX - a.slot;
        if (a.x < capX && !hold) { a.x += a.speed * dt; a.walk = true; } else a.walk = false;
      }
    }

    // ---- enemies ----
    const AT = A.filter((a) => !(a.toyT > 0) && G.allies.includes(a)); // (a toy resident is ignored; a swallowed one is gone for now)
    for (const e of E0) {
      const d = e.def;
      e.anim += dt; e.atk = Math.max(0, e.atk - dt * 2.5); e.hurt = Math.max(0, e.hurt - dt * 4); e.cool -= dt;
      // 残り火 (burn) ticks twice a second
      if (e.burnT > 0) {
        e.burnT -= dt; e.burnAcc = (e.burnAcc || 0) + e.burnDps * dt; e.burnTick = (e.burnTick || 0.5) - dt;
        if (e.burnTick <= 0 || e.burnT <= 0) { e.burnTick = 0.5; if (e.burnAcc >= 1) damage(e, e.burnAcc, null); e.burnAcc = 0; }
        if (e.dead) continue;
      }
      if (e.belly && e.belly.length) { bellyTick(e, dt); if (e.dead) continue; }
      if (e.slowT > 0) e.slowT -= dt; else e.slowV = 0;
      if (e.frozenT > 0) { e.frozenT -= dt; e.anim -= dt; e.walk = false; continue; }
      const slow = e.slowT > 0 ? e.slowV : 0;
      if (slow) e.cool += dt * slow * 0.5;
      if (e.boss) { updateBoss(e, AT, dt * (1 - slow * 0.5)); continue; }
      // 速達: flies straight for the lighthouse; it must be shot down
      if (d.courier) { e.walk = true; e.x -= d.speed * (1 - slow) * dt; if (e.x <= LANE.front + 260) e.lowFly = true; /* it dips low before the lighthouse, so melee can still stop it */ if (e.x <= LANE.front + 20) { hitTower(e.atkV); e.dead = 0.0001; e.hp = 0; e.popped = true; G.fx.push({ type: 'blast', x: e.x, y: e.y - FLY_H, life: 1, dur: 0.5, r: 50 }); } continue; }
      // 飛行型 ignores the melee line and goes for the back line or the lighthouse
      const targets = e.fly && !e.lowFly ? AT.filter((a) => !a.def.melee) : AT;
      let tgt = null, best = 1e9;
      for (const a of targets) { const dx = e.x - a.x; if (dx > -24 && dx < best) { best = dx; tgt = a; } }
      // also fight back against an ally standing right behind (e.g. one summoned behind an enemy at the tower)
      if (!tgt || best > d.range + 10) for (const a of targets) { const dx = a.x - e.x; if (dx >= 24 && dx <= d.range + 10) { tgt = a; best = 0; break; } }
      let reachAlly = tgt && best <= d.range + 10;
      if (d.shooter && reachAlly && e.x > LANE.engageMaxX + 60) reachAlly = false; // FIX-A: enemy shooters must come within reach of the battle line before they fire
      if (e.fly && reachAlly) e.swoop = G.time + 0.8;
      // ---- special behaviours ----
      e.timer -= dt;
      if (d.mend && e.timer <= 0) {
        e.timer = d.mend.every; e.atk = 1;
        let healed = false;
        for (const o of E0) if (!o.dead && !o.boss && o.hp < o.maxHp && Math.abs(o.x - e.x) <= d.mend.r && !(o.mendT > G.time)) { o.mendT = G.time + d.mend.every * 0.95; o.hp = Math.min(o.maxHp, o.hp + o.maxHp * d.mend.share); healed = true; } // FIX-E
        if (healed) G.fx.push({ type: 'mend', x: e.x, y: e.y, life: 1, dur: 0.8, r: d.mend.r });
      }
      if (d.ring && e.timer <= 0 && tgt && best <= d.ring.trigger) {
        e.timer = d.ring.every; e.atk = 1;
        for (const a of A) if (Math.abs(a.x - e.x) <= d.ring.r) a.dazeT = Math.max(a.dazeT || 0, d.ring.daze);
        for (const k of DECK) G.cd[k] = Math.min(G.cd[k] + d.ring.cdAdd, Math.max(G.cd[k], G.cdMax[k])); // FIX-F
        G.fx.push({ type: 'ring', x: e.x, y: e.y, life: 1, dur: 0.9, r: d.ring.r });
        G.texts.push({ x: e.x, y: e.y - 82, v: '鈴の音', life: 1.1, skill: true });
        Sound.play('bell');
      }
      if (d.spawn && e.timer <= 0) {
        e.timer = d.spawn.every; e.atk = 1;
        const kids = E0.filter((o) => o.parent === e.id && !o.dead).length; // FIX-G
        const room = CONFIG.maxLive ? Math.max(0, CONFIG.maxLive - E0.length) : 99;
        for (let i = 0; i < Math.min(d.spawn.n, (d.spawn.max || 6) - kids, room); i++) { const s = makeEnemy(d.spawn.kind, G.wave); s.parent = e.id; s.x = e.x - 18 - i * 14; s.y = clamp(e.y + rand(-10, 10), LANE.yMin, LANE.yMax); G.enemies.push(s); }
        G.fx.push({ type: 'rift', x: e.x - 20, y: e.y, life: 1, dur: 0.7 });
      }
      if (d.blast) {
        e.fuse = tgt ? clamp(1 - (best - d.range) / 90, 0, 1) : 0;
        if (reachAlly || e.x <= LANE.front + d.range) { explode(e); continue; }
      }
      if (d.charge) {
        const c = d.charge;
        if (e.dashT > 0) {
          e.dash = 1; e.walk = true;
          e.x -= c.speed * (1 - slow) * dt;
          if (reachAlly) {
            damage(tgt, e.atkV * c.mul, e); tgt.x = Math.max(LANE.allySpawn - 20, tgt.x - c.knock);
            e.dashT = 0; e.dash = 0; e.charged = true; e.atk = 1; e.cool = d.rate; G.shake = Math.max(G.shake, 0.18); Sound.play('slam');
          } else if (e.x <= LANE.front + d.range * 0.6) {
            hitTower(e.atkV * c.mul); e.dashT = 0; e.dash = 0; e.charged = true; e.cool = d.rate;
          } else { e.dashT -= dt; if (e.dashT <= 0) { e.dash = 0; e.charged = true; } }
          continue;
        }
        if (e.wind > 0) {
          e.wind = Math.min(1, e.wind + dt / c.wind); e.walk = false;
          if (e.wind >= 1) { e.wind = 0; e.dashT = 1.4; }
          continue;
        }
        if (!e.charged && tgt && best < c.trigger && best > d.range + 30) { e.wind = 0.0001; continue; }
      }
      // optional 高速型 trait: d.slip = number of times it dashes past the ally it meets (0/undefined = off)
      if (reachAlly && d.slip && (e.slips || 0) < d.slip && G.wave >= (d.slipFromWave || 1) && e.x - d.slipDist > LANE.front + 40) {
        e.slips = (e.slips || 0) + 1; e.x -= d.slipDist; reachAlly = false;
        G.fx.push({ type: 'dash', x: e.x, x2: e.x + d.slipDist, y: e.y, life: 1, dur: 0.45 }); Sound.play('dash');
        continue;
      }
      const atTower = e.x <= LANE.front + d.range * 0.6;
      if (reachAlly || atTower) {
        e.walk = false;
        if (e.cool <= 0) {
          e.cool = d.rate; e.atk = 1;
          if (d.shooter) enemyFire(e, reachAlly ? tgt : null);
          else if (reachAlly) { damage(tgt, e.atkV, e); Sound.play('hit'); }
          else hitTower(e.atkV);
        }
      } else {
        const hang = d.mend && E0.some((o) => o !== e && !o.dead && o.x < e.x && e.x - o.x < 70);
        // 壊れた観覧車 (phase 2): nightmares near it walk faster
        const haste = e.hasteT > G.time ? 1 + e.hasteV : 1;
        if (hang) e.walk = false; else { e.x -= d.speed * e.speedJitter * (1 - slow) * haste * dt; e.walk = true; }
      }
    }

    // separation: keep same-side units from perfectly stacking
    separate(A, 10); separate(E0.filter((e) => !e.boss), 9);

    // ---- boss hazards: telegraphed areas that land after their wind-up, and travelling ground quakes ----
    updateHazards(A, dt);

    // ---- projectiles ----
    for (const s of G.shots) {
      s.t += dt;
      if (s.t < 0) continue; // delayed follow-up arrow (連射)
      const tx = s.target && !s.target.dead ? s.target.x : s.tx;
      const ty = s.target && !s.target.dead ? hitY(s.target) : s.ty;
      s.tx = tx; s.ty = ty;
      const p = Math.min(1, s.t / s.dur);
      s.px = s.x; s.py = s.y;
      s.x = s.x0 + (tx - s.x0) * p; s.y = s.y0 + (ty - s.y0) * p - Math.sin(p * Math.PI) * s.arc;
      if (s.visual) { if (p >= 1) s.done = true; continue; }
      if (p >= 1 && s.enemy) {
        s.done = true;
        if (s.tower) hitTower(s.dmg);
        else if (s.target && !s.target.dead) {
          damage(s.target, s.dmg, s.from); Sound.play('hit');
          if (s.seal && !s.target.dead) { s.target.sealT = Math.max(s.target.sealT || 0, s.seal); G.texts.push({ x: s.target.x, y: s.target.y - 84, v: '封', life: 1.1, skill: true }); }
        }
        G.fx.push({ type: 'splat', x: tx, y: ty, life: 1, dur: 0.35 });
        continue;
      }
      if (p >= 1) {
        s.done = true;
        const m = (s.from && s.from.m) || {};
        if (s.kind === 'ice') {
          G.fx.push({ type: 'frost', x: tx, y: ty + 30, life: 1, dur: 0.5, r: s.aoe });
          let dealt = 0;
          const slowV = Math.min(0.75, s.slow * (1 + (m.chill || 0)));
          for (const e of alive(G.enemies)) if (Math.abs(e.x - tx) <= s.aoe + (e.def.radius || 0)) {
            dealt += damage(e, s.dmg, s.from, s.crit);
            if (e.dead || e.stanceOn) continue;
            const v = e.boss ? slowV * 0.35 : slowV;
            if (v >= (e.slowV || 0) || e.slowT <= 0) { e.slowV = v; }
            e.slowT = Math.max(e.slowT || 0, s.slowTime); e.iceT = Math.max(e.iceT || 0, G.time + s.slowTime);
            if (m.freeze && Math.random() < m.freeze) stun(e, 1.5);
          }
          drainTo(s.from, dealt);
          Sound.play('magic');
        } else if (s.kind === 'bomb') {
          // 花火師: ground splash, small push back (not the boss), 足止め slows
          G.fx.push({ type: 'boom', x: tx, y: ty + 30, life: 1, dur: 0.5, r: s.aoe, color: '255,190,110' });
          G.fx.push({ type: 'smoke', x: tx, y: ty + 36, life: 0.8, dur: 0.7 });
          let dealt = 0;
          for (const e of alive(G.enemies)) if (!e.fly && Math.abs(e.x - tx) <= s.aoe + (e.def.radius || 0)) {
            dealt += damage(e, s.dmg, s.from, s.crit);
            if (e.dead) continue;
            if (!e.boss) e.x += s.knock;
            if (s.stall) { const v = e.boss ? s.stall * 0.35 : s.stall; if (v >= (e.slowV || 0) || e.slowT <= 0) e.slowV = v; e.slowT = Math.max(e.slowT || 0, 2); }
          }
          drainTo(s.from, dealt); G.shake = Math.max(G.shake, 0.08);
          Sound.play('blast');
        } else if (s.kind === 'orb') {
          G.fx.push({ type: 'boom', x: tx, y: ty + 30, life: 1, dur: 0.45, r: s.aoe });
          let dealt = 0;
          for (const e of alive(G.enemies)) if (Math.abs(e.x - tx) <= s.aoe + (e.def.radius || 0)) {
            dealt += damage(e, s.dmg, s.from, s.crit);
            if (m.burn && !e.dead) { e.burnDps = Math.max(e.burnT > 0 ? e.burnDps : 0, s.dmg * m.burn / 3); e.burnT = 3; }
          }
          drainTo(s.from, dealt);
          Sound.play('magic');
        } else if (s.balloon) {
          // 固有能力 とっておきの一発（ガンナー）: the last shot of a magazine is a water balloon that splashes
          G.fx.push({ type: 'boom', x: tx, y: ty + 30, life: 1, dur: 0.4, r: s.balloon, color: '140,205,255' });
          let dealt = 0;
          for (const e of alive(G.enemies)) if (Math.abs(e.x - tx) <= s.balloon + (e.def.radius || 0) && Math.abs(hitY(e) - ty) <= 90) dealt += damage(e, s.dmg, s.from, s.crit);
          drainTo(s.from, dealt);
          Sound.play('hit');
        } else if (s.target && !s.target.dead) {
          const t = s.target, fd = s.from && s.from.def;
          drainTo(s.from, damage(t, s.dmg, s.from, s.crit, s.pen)); Sound.play('hit');
          if (s.kind === 'snipe') G.fx.push({ type: 'slash', x: t.x, y: hitY(t) + 30, life: 1, dur: 0.25, snipe: true });
          // ハンターの印 / 二羽落とし
          if (fd && fd.mark && !t.dead && !t.stanceOn) { const v = fd.mark.v * (1 + (m.markUp || 0)); t.markV = t.markT > G.time ? Math.max(t.markV, v) : v; t.markT = G.time + fd.mark.t; }
          if (fd && fd.antiAir && t.dead && t.fly && m.twin && Math.random() < m.twin && !s.from.dead) { s.from.cool = 0; G.texts.push({ x: s.from.x, y: s.from.y - 84, v: '二羽落とし', life: 0.9, skill: true }); }
          // 貫通矢: the nearest enemy behind the target also takes a share
          if (m.pierce) {
            let nb = null, nd = 141;
            for (const e of G.enemies) { if (e === t || e.dead) continue; const dx = e.x - t.x; if (dx > 0 && dx < nd) { nd = dx; nb = e; } }
            if (nb) drainTo(s.from, damage(nb, s.dmg * m.pierce, s.from));
          }
        }
      }
    }
    G.shots = G.shots.filter((s) => !s.done);

    // ---- death fade & cleanup ----
    for (const u of G.allies) if (u.dead) u.dead += dt;
    for (const u of G.enemies) if (u.dead) u.dead += dt;
    G.allies = G.allies.filter((u) => !u.dead || u.dead < 0.6);
    G.enemies = G.enemies.filter((u) => !u.dead || u.dead < (u.boss ? 1.6 : 0.6));

    // ---- particles ----
    const lampX = Art.LH.x, lampY = Art.LH.lampY;
    for (const m of G.motes) {
      if (m.kind === 'dream') {
        if (m.delay > 0) { m.delay -= dt; m.x += m.vx * dt; m.y += m.vy * dt; m.vy += 160 * dt; continue; }
        m.life += dt;
        const dx = lampX - m.x, dy = lampY - m.y, dist = Math.hypot(dx, dy);
        const sp = 260 + m.life * 700;
        m.vx += (dx / dist * sp - m.vx) * Math.min(1, dt * 3); m.vy += (dy / dist * sp - m.vy) * Math.min(1, dt * 3);
        m.x += m.vx * dt; m.y += m.vy * dt;
        if (dist < 18) { m.done = true; G.dream += m.value; G.lampBoost = Math.min(1, G.lampBoost + 0.08); }
      } else {
        m.life -= dt; m.x += m.vx * dt; m.y += m.vy * dt; m.vy *= 0.97;
        if (m.life <= 0) m.done = true;
      }
    }
    G.motes = G.motes.filter((m) => !m.done);
    for (const sh of G.shards) sh.t += dt;
    G.shards = G.shards.filter((sh) => sh.t < 2.6);
    for (const f of G.fx) f.life -= dt / f.dur;
    G.fx = G.fx.filter((f) => f.life > 0);
    for (const t of G.texts) { t.life -= dt; t.y -= 34 * dt; }
    G.texts = G.texts.filter((t) => t.life > 0);

    if (G.hp <= 0 && G.endTimer < 0) { G.hp = 0; G.endTimer = 1.6; G.outcome = 'lose'; G.shake = 0.8; }
  }

  const FLY_H = 80;
  // sprite heights for the HP bar and the hunter's mark (× Art.SIZE)
  const TALL = { armor: 90, golem: 92, mage: 86, icemage: 86, thunder: 86, sniper: 76, hunter: 76, ninja: 70, paladin: 92, pyro: 74, engineer: 74, berserker: 84, gunner: 76, crossbow: 78, dollmaster: 74, doll: 46, turret: 46, weaver: 84, charger: 62, swarm: 40, flyer: 48, bomber: 56, bell: 72, mender: 74, spitter: 70 };
  const flyH = (u) => u.fly ? (u.lowFly ? 34 : FLY_H) : 0;
  const growView = (u) => u.kind === 'golem' ? 1 + 0.03 * (u.innS || 0) : 1; // 育つ城: the golem grows a little
  const hitY = (u) => u.y - 30 - flyH(u);
  function enemyFire(e, tgt, kind, mul, y0off) {
    const x0 = e.x - 14, y0 = e.y - (y0off || 34);
    const tx = tgt ? tgt.x : LANE.front - 30, ty = tgt ? hitY(tgt) : 470;
    const dist = Math.abs(tx - x0);
    G.shots.push({ enemy: true, kind: kind || 'ink', from: e, x0, y0, x: x0, y: y0, tx, ty, target: tgt, tower: !tgt, t: 0, dur: Math.max(0.25, dist / (kind === 'bubble' ? 380 : 520)), arc: 14 + dist * 0.04, dmg: e.atkV * (mul || 1) });
    Sound.play('spit');
  }
  function explode(e) {
    e.dead = 0.0001; e.hp = 0; e.popped = true; // self-destruct: no kill credit, no dream (set first so reflected damage can't 'kill' it)
    const r = e.def.blast;
    for (const a of alive(G.allies)) if (Math.abs(a.x - e.x) <= r) damage(a, e.atkV, e);
    if (e.x - r <= LANE.front) hitTower(e.atkV * 0.6);
    G.fx.push({ type: 'blast', x: e.x, y: e.y, life: 1, dur: 0.5, r });
    G.shake = Math.max(G.shake, 0.2);
    Sound.play('blast');
  }

  function separate(list, minGap) {
    const s = list.slice().sort((a, b) => a.x - b.x);
    for (let i = 1; i < s.length; i++) {
      const a = s[i - 1], b = s[i];
      if (Math.abs(a.y - b.y) < 10 && b.x - a.x < minGap * 0.5) {
        // nudge depth instead of x so lines stay readable
        b.y = clamp(b.y + (b.y >= a.y ? 4 : -4), LANE.yMin, LANE.yMax);
      }
    }
  }

  function fire(a, tgt, delay) {
    const d = a.def, m = a.m || {};
    const x0 = a.x + 14 * (a.face || 1), y0 = a.y - 34;
    const dist = Math.abs(tgt.x - x0);
    const h = allyHit(a, a.atkV);
    if (d.shot === 'bolt') { chainBolt(a, tgt, h); return; }
    if (d.shot === 'quarrel') { quarrel(a, tgt, h); return; }
    // ガンナー: count the magazine down; an empty magazine means a reload (早撃ち speeds up the first magazine)
    let balloon = 0;
    if (d.mag) {
      const size = d.mag + Math.round(m.mag || 0);
      a.mag = (a.mag > 0 ? a.mag : size) - 1;
      if (a.mag <= 0) { a.mag = size; a.cool = d.reload / (1 + (m.aspd || 0)); a.firstMag = true; balloon = INNATE.gunner.r; h.dmg *= INNATE.gunner.mul; } // 固有能力 とっておきの一発
      else if (!a.firstMag && m.quick) a.cool = a.rate / (1 + m.quick);
    }
    if (d.antiAir && tgt.fly) h.dmg *= d.antiAir;
    if (d.pickTough) {
      if (m.weak && (tgt.elite || tgt.boss)) h.dmg *= 1 + m.weak; // 弱点狙い
      if (m.breath && (a.idleT || 0) >= 2) { h.dmg *= 1 + m.breath; G.texts.push({ x: a.x, y: a.y - 84, v: '構え', life: 0.9, skill: true }); }
      const I = INNATE.sniper; h.dmg *= 1 + I.max * clamp((Math.abs(tgt.x - a.x) - I.from) / (I.to - I.from), 0, 1); // 固有能力 遠くの景色
    }
    // 固有能力 届けたい言葉（弓兵）: the 4th arrow in a row at the same enemy is always a critical hit
    if (a.kind === 'archer' && !delay) {
      if (a.aimId === tgt.id) a.innC = (a.innC || 0) + 1; else { a.aimId = tgt.id; a.innC = 1; }
      if (a.innC >= INNATE.archer.every) { a.innC = 0; if (!h.crit) { h.dmg *= 1.8; h.crit = true; } }
      a.pipN = a.innC;
    }
    // 固有能力 待ち続けた火（炎の魔法使い）: each shot without being hurt is stronger
    if (a.kind === 'mage') { const I = INNATE.mage; h.dmg *= 1 + I.step * (a.innS || 0); a.innS = Math.min(I.max, (a.innS || 0) + 1); a.pipN = a.innS; }
    const lob = d.shot === 'orb' || d.shot === 'ice' || d.shot === 'bomb', snipe = d.shot === 'snipe', fast = d.shot === 'bullet';
    const dur = d.shot === 'bomb' ? 0.7 : lob ? (d.shot === 'ice' ? 0.42 : 0.55) : snipe ? Math.max(0.08, dist / 3200) : fast ? Math.max(0.06, dist / 1800) : Math.max(0.18, dist / 700);
    const arc = d.shot === 'bomb' ? 70 : d.shot === 'orb' ? 40 : d.shot === 'ice' ? 22 : snipe || fast ? 0 : 18 + dist * 0.05;
    G.shots.push({ kind: d.shot, from: a, x0, y0, x: x0, y: y0, tx: tgt.x, ty: hitY(tgt), target: tgt, t: -(delay || 0), dur, arc, dmg: h.dmg, crit: h.crit, pen: d.pen || 0, aoe: (d.aoe || 0) * (1 + (m.blast || 0) + (m.bigball || 0)), slow: d.slow || 0, slowTime: d.slowTime || 0, knock: d.knock || 0, stall: m.stall || 0, balloon });
    Sound.play(snipe ? 'snipe' : d.shot === 'bomb' ? 'toss' : fast ? 'pop' : 'shoot');
    // 固有能力 三連発（花火師）: every 5th bomb also sends up three small fireworks further ahead
    if (a.kind === 'pyro' && !delay) {
      const I = INNATE.pyro, sh = G.shots[G.shots.length - 1];
      a.innC = (a.innC || 0) + 1;
      if (a.innC >= I.every) {
        a.innC = 0;
        for (let i = 1; i <= I.n; i++) {
          const tx = Math.min(LANE.enemySpawn - 20, tgt.x + I.gap * (i - 0.5)), ty = hitY(tgt) + rand(-8, 8);
          G.shots.push(Object.assign({}, sh, { target: null, tx, ty, t: -0.16 * i, dur: 0.6, arc: 90 + i * 13, dmg: (h.crit ? h.dmg / 1.8 : h.dmg) * I.mul, crit: false, aoe: sh.aoe * 0.65, knock: 0, small: true }));
        }
      }
      a.pipN = a.innC;
    }
    // 連射
    if (!delay && m.multi && Math.random() < m.multi) fire(a, tgt, 0.14);
  }

  // 雷の魔法使い: instant bolt that jumps from enemy to enemy (flyers included)
  function chainBolt(a, first, h) {
    const d = a.def, m = a.m || {};
    let n = d.chain + (m.chain && Math.random() < m.chain ? 1 : 0), fall = d.chainFall;
    // 固有能力 雷の夜のたのしみ: every 4th cast is a big bolt (+2 jumps, no fall-off)
    const I = INNATE.thunder;
    a.innC = (a.innC || 0) + 1;
    const big = a.innC >= I.every;
    if (big) { a.innC = 0; n += I.add; fall = 1; }
    a.pipN = a.innC;
    const hit = [first], pts = [{ x: a.x + 16 * (a.face || 1), y: a.y - 74 }];
    let cur = first;
    while (hit.length < n) {
      let nx = null, nd = d.chainR + 1;
      for (const e of G.enemies) { if (e.dead || hit.includes(e)) continue; const dx = Math.abs(e.x - cur.x); if (dx < nd) { nd = dx; nx = e; } }
      if (!nx) break;
      hit.push(nx); cur = nx;
    }
    let dealt = 0;
    hit.forEach((e, i) => {
      pts.push({ x: e.x, y: hitY(e) });
      dealt += damage(e, h.dmg * Math.pow(fall, i), a, i === 0 && h.crit);
      if (m.static && !e.dead && Math.random() < m.static) stun(e, 0.5); // 帯電
    });
    drainTo(a, dealt);
    G.fx.push({ type: 'bolt', pts, life: 1, dur: big ? 0.45 : 0.28, seed: Math.random() * 1000 });
    if (big) { G.fx.push({ type: 'bolt', pts, life: 1, dur: 0.45, seed: Math.random() * 1000 }); G.shake = Math.max(G.shake, 0.12); }
    Sound.play('zap');
  }

  // クロスボウ兵: a heavy bolt through every enemy in line within reach (each one after the first × pierceFall; 強弓 softens the drop)
  function quarrel(a, first, h) {
    const d = a.def, m = a.m || {}, dir = first.x < a.x ? -1 : 1, reach = a.reachV + 20;
    const fall = 1 - (1 - d.pierceFall) * (1 - Math.min(1, m.heavy || 0));
    const line = G.enemies.filter((e) => !e.dead && (e.x - a.x) * dir > -10 && Math.abs(e.x - a.x) <= reach + (e.def.radius || 12)).sort((p, q) => Math.abs(p.x - a.x) - Math.abs(q.x - a.x));
    if (!line.includes(first)) line.unshift(first);
    line.length = Math.min(line.length, d.pierceMax || 99);
    let dealt = 0, landed = 0;
    line.forEach((e, i) => {
      const got = damage(e, h.dmg * Math.pow(fall, i), a, i === 0 && h.crit); dealt += got; if (got > 0) landed++;
      if (i === 0 && !e.dead && !e.boss) { e.x += d.knock; if (m.nail && Math.random() < m.nail) stun(e, 1); } // 釘打ち
    });
    drainTo(a, dealt);
    // 固有能力 工夫を重ねる: the more enemies one bolt hit, the sooner the next one is loaded
    const I = INNATE.crossbow; a.cool *= 1 - Math.min(I.max, I.step * landed);
    const x0 = a.x + 16 * dir, y0 = a.y - 36, x1 = a.x + reach * dir;
    G.shots.push({ kind: 'quarrel', visual: true, from: a, x0, y0, x: x0, y: y0, tx: x1, ty: y0 + 4, target: null, t: 0, dur: Math.max(0.12, reach / 2200), arc: 0 });
    Sound.play('snipe');
  }

  // the turret goes up a little behind the current front line (or mid-lane when there is none); 予備の部品 may add a second
  function placeTurret(a) {
    const front = G.allies.reduce((mx, o) => !o.dead && o.def.melee && !o.away ? Math.max(mx, o.x) : mx, 0);
    const tx = clamp(front > 0 ? front - 70 : 560, LANE.allySpawn + 80, LANE.engageMaxX - 60);
    if (summonRoom() > 0) G.allies.push(makeSummon('turret', a, tx));
    if (a.m.spare && Math.random() < a.m.spare && summonRoom() > 0) G.allies.push(makeSummon('turret', a, tx - 46));
  }
  // エンジニア: stands back where its repair reach covers the battle line and repairs its turrets
  function updateEngineer(a, A, E, frontAlly, dt) {
    const d = a.def, T = d.turret, m = a.m || {};
    // builds a new turret rebuild s after its last one is gone
    if (!A.some((t) => t.kind === 'turret' && t.owner === a.id)) { a.buildT = (a.buildT == null ? (a.fastBuild ? INNATE.engineer.rebuild : T.rebuild) : a.buildT) - dt; if (a.buildT <= 0) { a.buildT = null; a.fastBuild = false; placeTurret(a); a.atk = 1; Sound.play('tick'); } }
    else { a.buildT = null; a.fastBuild = false; }
    if (a.cool <= 0) {
      a.cool = T.every / (1 + (m.aspd || 0));
      let fixed = false;
      for (const t of A) if (t.kind === 'turret' && t.hp < t.maxHp && Math.abs(t.x - a.x) <= d.range) { t.hp = Math.min(t.maxHp, t.hp + T.repair); fixed = true; G.fx.push({ type: 'heal', x: t.x, y: t.y, life: 0.6, dur: 0.5 }); }
      if (fixed) { a.atk = 1; Sound.play('tick'); }
    }
    supportWalk(a, E, frontAlly, dt, 150);
  }
  // 人形遣い: calls 眠り人形 in front of itself every few seconds (up to dolls.max of its own at once)
  function updateDollmaster(a, A, E, frontAlly, dt) {
    const d = a.def, m = a.m || {};
    a.summonT -= dt * (1 + (m.aspd || 0)) * (a.dazeT > 0 ? 0.5 : 1) * (a.sealT > 0 ? 0 : 1);
    if (a.summonT <= 0) {
      a.summonT = d.rate;
      const mine = A.filter((o) => o.kind === 'doll' && o.owner === a.id).length;
      const room = Math.min(d.dolls.n, d.dolls.max - mine, summonRoom());
      for (let i = 0; i < room; i++) G.allies.push(makeSummon('doll', a, a.x + 24 + i * 14));
      if (room > 0) { a.atk = 1; Sound.play('summon'); }
    }
    supportWalk(a, E, frontAlly, dt, 150);
  }
  // shared positioning for the back-line helpers: walk up behind the front until the base range reaches the battle line
  function supportWalk(a, E, frontAlly, dt, keep) {
    const enemyNear = E.some((e) => e.x - a.x < 170 && e.x - a.x > -30);
    const wantX = frontAlly - keep;
    if (!enemyNear && a.x < wantX && a.x < LANE.engageMaxX + 20 - a.def.range) { a.x += a.speed * dt; a.walk = true; } else a.walk = false;
  }

  // 忍者: leap over the front onto a back-line threat, fight it until it falls, then run back to the line.
  // returns true while the ninja is busy with this (the normal melee logic is skipped)
  function ninjaStep(a, E, lineX, frontAlly, dt) {
    const L = a.def.leap, m = a.m || {};
    if (a.leapT != null) {
      a.leapT += dt;
      const p = Math.min(1, a.leapT / a.leapDur);
      a.x = a.leapFrom + (a.leapTo - a.leapFrom) * p;
      a.jumpH = Math.sin(p * Math.PI) * (70 + Math.abs(a.leapTo - a.leapFrom) * 0.08);
      a.walk = false; a.face = 1;
      G.motes.push({ x: a.x + rand(-8, 8), y: a.y - a.jumpH - rand(20, 50), vx: rand(-30, 10), vy: rand(-20, 20), life: rand(0.3, 0.6), max: 0.6, color: '255,170,120', kind: 'spark' });
      if (p >= 1) {
        a.leapT = null; a.jumpH = 0; a.hunt = a.leapTgt; a.leapTgt = null;
        let t = a.hunt && !a.hunt.dead && Math.abs(a.hunt.x - a.x) < 90 ? a.hunt : null;
        if (!t) for (const e of E) if (!e.dead && !e.fly && Math.abs(e.x - a.x) < 80 && (!t || Math.abs(e.x - a.x) < Math.abs(t.x - a.x))) t = e;
        if (t) {
          const h = allyHit(a, a.atkV * L.mul * (1 + (m.backstab || 0)));
          drainTo(a, damage(t, h.dmg, a, h.crit));
          G.fx.push({ type: 'slash', x: t.x, y: t.y - 30, life: 1, dur: 0.35 });
          G.shake = Math.max(G.shake, 0.12); Sound.play('hit');
        }
        if (m.smoke) { a.invul = Math.max(a.invul, m.smoke); G.fx.push({ type: 'smoke', x: a.x, y: a.y, life: 1, dur: 0.9 }); } // 煙玉
        a.cool = a.rate; a.atk = 1; a.face = -1;
        a.reLeapAt = G.time + INNATE.ninja.every; // 固有能力 もう一度びっくり
      }
      return true;
    }
    if (a.hunt) {
      const t = a.hunt;
      if (t.dead) { a.hunt = null; a.returning = true; }
      else {
        const gap = t.x - a.x, r = a.reachV + (t.def.radius || 12);
        a.face = gap < 0 ? -1 : 1;
        if (Math.abs(gap) <= r) { a.walk = false; if (a.cool <= 0) { a.cool = a.rate; a.atk = 1; meleeStrike(a, t, false); } }
        else if (Math.abs(gap) > 400) { a.hunt = null; a.returning = true; }
        else { a.walk = true; a.x += Math.sign(gap) * a.speed * dt; }
        if (a.hunt) return true;
      }
    }
    if (a.returning) {
      const home = lineX > 0 ? lineX : frontAlly;
      // an enemy within reach on the way back (or nobody to fall back to): stop and fight it with the normal melee logic
      const meet = E.some((e) => !e.dead && (!e.fly || e.swoop > G.time) && Math.abs(e.x - a.x) <= a.reachV + (e.def.radius || 12));
      if (!meet && home > LANE.allySpawn + 1 && a.x > home + 10) { a.x -= a.speed * 1.3 * dt; a.walk = true; a.face = -1; return true; }
      a.returning = false; a.away = false;
      return false;
    }
    if (!a.leapReady && a.reLeapAt && G.time >= a.reLeapAt) { a.leapReady = true; a.reLeapAt = 0; }
    if (a.leapReady && !(a.sealT > 0)) {
      let t = null;
      const from = Math.max(a.x, lineX) + 60;
      for (const e of E) if (!e.dead && !e.fly && (LEAP_ROLES.includes(e.def.role) || e.def.leapable) && e.x > from && e.x <= L.maxX && (!t || e.x < t.x)) t = e;
      if (t) {
        a.leapReady = false; a.away = true; a.leapT = 0; a.leapFrom = a.x;
        if (a.leapN = (a.leapN || 0) + 1, a.leapN > 1) innText(a, 'もう一度びっくり');
        a.leapTo = Math.min(L.maxX + 40, t.x + 30 + rand(-12, 12)); a.leapTgt = t;
        a.leapDur = L.time + Math.abs(a.leapTo - a.x) / 2400;
        a.invul = Math.max(a.invul, a.leapDur);
        Sound.play('leap');
        return true;
      }
    }
    return false;
  }

  function updateHealer(a, A, E, frontAlly, dt) {
    const d = a.def;
    let tgt = null, worst = 0.999;
    for (const o of A) { if ((o === a && A.length > 1) || o.summoned) continue; const r = o.hp / o.maxHp - (o.hp < o.maxHp && frontAlly - o.x < 60 ? 0.12 : 0); if (o.hp < o.maxHp && r < worst && Math.abs(o.x - a.x) <= d.range) { worst = r; tgt = o; } }
    const enemyNear = E.some((e) => e.x - a.x < 170 && e.x - a.x > -30);
    if (tgt && a.cool <= 0) {
      const m = a.m || {}, base = Math.round(a.healV), amt = Math.round(a.healV * (tgt.hp / tgt.maxHp < INNATE.healer.below ? INNATE.healer.mul : 1)); // 固有能力 手のぬくもり（波紋には乗せない）
      a.cool = a.rate; a.atk = 1;
      tgt.hp = Math.min(tgt.maxHp, tgt.hp + amt);
      G.fx.push({ type: 'heal', x: tgt.x, y: tgt.y, life: 1, dur: 0.7 });
      G.texts.push({ x: tgt.x, y: tgt.y - 70, v: '+' + amt, life: 0.8, heal: true });
      // 祝福
      if (m.bless) { tgt.blessV = Math.max(tgt.blessT > 0 ? tgt.blessV : 0, m.bless); tgt.blessT = 4; }
      // 癒しの波紋
      if (m.ripple) for (const o of A) if (o !== tgt && !o.summoned && o.hp < o.maxHp && Math.abs(o.x - tgt.x) <= 70) {
        o.hp = Math.min(o.maxHp, o.hp + base * m.ripple);
        G.fx.push({ type: 'heal', x: o.x, y: o.y, life: 0.7, dur: 0.6 });
      }
      Sound.play('heal');
    }
    const wantX = frontAlly - 150;
    // stand where the base heal range just reaches the battle line (engageMaxX + 20)
    if (!enemyNear && a.x < wantX && a.x < LANE.engageMaxX + 20 - d.range) { a.x += a.speed * dt; a.walk = true; } else a.walk = false;
  }

  // バード: stays behind the front, singing; pulses are visual (the buff itself is continuous)
  function updateBard(a, A, E, frontAlly, dt) {
    const d = a.def, m = a.m || {};
    if (a.cool <= 0) {
      a.cool = d.rate; a.atk = 1;
      const r = d.range * (1 + (m.echo || 0));
      G.fx.push({ type: 'song', x: a.x, y: a.y, life: 1, dur: 0.9, r });
      if (A.some((o) => o !== a && Math.abs(o.x - a.x) <= r)) Sound.play('song');
    }
    const enemyNear = E.some((e) => e.x - a.x < 160 && e.x - a.x > -30);
    const wantX = frontAlly - 120;
    // stand where the base song range just reaches the battle line (engageMaxX + 20)
    if (!enemyNear && a.x < wantX && a.x < LANE.engageMaxX + 20 - d.range) { a.x += a.speed * dt; a.walk = true; } else a.walk = false;
  }

  // =====================================================================
  //  BOSSES（2026-10-25 9体。どれも予兆→技、HP半分で行動が変わる。数値は ENEMIES の各ボスの行に）
  // =====================================================================
  const MID_Y = (LANE.yMin + LANE.yMax) / 2;
  function updateBoss(e, A, dt) {
    e.rewind = Math.max(0, e.rewind - dt); e.landT = Math.max(0, e.landT - dt * 1.5);
    if (e.invul > 0) e.invul -= dt;
    switch (e.def.ai) {
      case 'snow': return aiSnow(e, A, dt);
      case 'friend': return aiFriend(e, A, dt);
      case 'astro': return aiAstro(e, A, dt);
      case 'wheel': return aiWheel(e, A, dt);
      case 'batter': return aiBatter(e, A, dt);
      case 'siren': return aiSiren(e, A, dt);
      case 'throne': return aiThrone(e, A, dt);
      case 'clock': return aiClock(e, A, dt);
      case 'postman': return aiPostman(e, A, dt);
      case 'witch': return aiWitch(e, A, dt);
      case 'dancer': return aiDancer(e, A, dt);
      case 'whale': return aiWhale(e, A, dt);
      case 'devourer': return aiDevourer(e, A, dt);
      default: return aiHero(e, A, dt);
    }
  }
  // ---- shared helpers ----
  function bossPhase(e) {
    if (e.phase !== 1 || e.hp >= e.maxHp * 0.5) return false;
    e.phase = 2; const l = e.def.p2 || ['', ''];
    showBanner(l[0], l[1], 1.8, true); Sound.play('boss'); G.shake = Math.max(G.shake, 0.4);
    return true;
  }
  const timer = (e, key, dt, first) => { if (e.T[key] == null) e.T[key] = first; e.T[key] -= dt; return e.T[key] <= 0; };
  function startWind(e, kind, time) { e.wind = 0.0001; e.windT = time; e.windDur = time; e.windKind = kind; }
  // returns the finished move's name on the frame it completes, 'busy' while winding, null when idle
  function tickWind(e, dt) {
    if (!(e.wind > 0)) return null;
    e.windT -= dt; e.wind = clamp(1 - e.windT / e.windDur, 0.0001, 1); e.walk = false;
    if (e.windT <= 0) { e.wind = 0; e.atk = 1; return e.windKind; }
    return 'busy';
  }
  function bossSummon(e, kind, n, dx) {
    const room = CONFIG.maxLive ? Math.max(0, CONFIG.maxLive - alive(G.enemies).length) : 99;
    const out = [];
    for (let i = 0; i < Math.min(n, room); i++) {
      const s = makeEnemy(kind, G.wave); s.x = e.x + (dx || 0) + i * 20 + rand(-6, 6); s.y = rand(LANE.yMin, LANE.yMax);
      if (s.fly && !s.def.highFly) s.lowFly = true; // boss-called flyers glide low: melee can reach them and they do not skip the melee line
      if ((e.def.ai === 'wheel' || e.form === 'wheel') && s.def.slip) s.slips = 99; // the wheel's riders do not slip past the line
      G.enemies.push(s); G.seen[kind] = true; out.push(s);
    }
    if (out.length) G.fx.push({ type: 'rift', x: e.x + (dx || 0), y: e.y, life: 1, dur: 0.8 });
    return out;
  }
  // the rearmost back-liner (non-melee, not a turret) within reach of the boss; falls back to the rearmost ally
  function backAlly(e, A, reach) {
    let t = null;
    for (const a of A) if (!a.def.melee && !a.summoned && Math.abs(a.x - e.x) <= reach && (!t || a.x < t.x)) t = a;
    if (!t) for (const a of A) if (!a.summoned && Math.abs(a.x - e.x) <= reach && (!t || a.x < t.x)) t = a;
    if (!t) for (const a of A) if (Math.abs(a.x - e.x) <= reach && (!t || a.x < t.x)) t = a;
    return t;
  }
  // walk left until touching an ally / the tower / stopX. Returns what is in front
  function bossWalk(e, A, dt, stopX) {
    const d = e.def;
    let near = false, touching = false;
    for (const a of A) { const dx = e.x - a.x; if (dx > -40) { if (dx <= d.range + 30) near = true; if (dx <= (d.radius || 40) + 24) touching = true; } }
    if (e.x > 1180) { near = false; touching = false; } // keep walking until it is on screen (a 忍者 may stand in front of it out there)
    const atTower = e.x - d.range <= LANE.front + 20;
    const stop = stopX != null && e.x <= stopX;
    if (!touching && !atTower && !stop) { e.x -= d.speed * dt; e.walk = true; } else e.walk = false;
    return { near, touching, atTower, stop };
  }
  // a telegraphed area: circle (x, r) or line [x2, x]; lands after dur
  function addHazard(h) { G.hazards.push(Object.assign({ t: 0, y: MID_Y + 6, mul: 1, tower: true }, h)); }
  function updateHazards(A, dt) {
    for (const h of G.hazards) {
      if (h.from && h.from.dead) { h.done = true; continue; }
      h.t += dt;
      if (h.follow && !h.follow.dead && h.t < h.dur - (h.lock || 0)) h.x = h.follow.x; // (spotlights / spells track their target until shortly before they land)
      if (h.t < h.dur) continue;
      h.done = true;
      if (h.visualOnly) { if (h.then) h.then(h); continue; }
      const lo = h.line ? h.x2 : h.x - h.r, hi = h.line ? h.x : h.x + h.r;
      let hitAny = false;
      for (const a of alive(G.allies)) if (a.x >= lo - 6 && a.x <= hi + 6) {
        hitAny = true;
        damage(a, h.dmg, h.from);
        if (h.knock && !a.dead && !(h.block && a.def.armor)) a.x = Math.max(LANE.allySpawn - 20, a.x - h.knock);
        if (h.slow && !a.dead) { a.dazeT = Math.max(a.dazeT || 0, h.slow); }
      }
      if (h.tower && lo <= LANE.front + 10) hitTower(h.dmg * (h.towerMul || 0.8));
      G.fx.push(h.line ? { type: 'dash', x: h.x2, x2: h.x, y: h.y, life: 1, dur: 0.4 } : { type: 'shock', x: h.x, y: h.y, life: 1, dur: 0.45, r: h.r });
      if (h.visual === 'snow') G.fx.push({ type: 'frost', x: h.x, y: h.y, life: 1, dur: 0.6, r: h.r });
      G.shake = Math.max(G.shake, h.r > 90 || h.line ? 0.25 : 0.12);
      Sound.play(hitAny || h.r > 90 ? 'slam' : 'hit');
      if (h.then) h.then(h);
    }
    G.hazards = G.hazards.filter((h) => !h.done);
    // 空っぽの玉座: ground quakes travel toward the lighthouse and hit each ally once
    for (const q of G.quakes) {
      if (q.from && q.from.dead) { q.done = true; continue; }
      q.x -= q.speed * dt;
      for (const a of alive(G.allies)) if (!q.hit.has(a.id) && Math.abs(a.x - q.x) <= 26) { q.hit.add(a.id); damage(a, q.dmg, q.from); }
      if (q.x <= LANE.front + 10) { hitTower(q.dmg * 0.6); q.done = true; G.fx.push({ type: 'shock', x: LANE.front + 20, y: MID_Y + 6, life: 1, dur: 0.4, r: 60 }); }
    }
    G.quakes = G.quakes.filter((q) => !q.done);
  }
  function drawHazards() {
    for (const h of G.hazards) {
      const p = clamp(h.t / h.dur, 0, 1);
      if (h.line) { ctx.save(); ctx.fillStyle = `rgba(255,90,140,${0.12 + p * 0.28})`; ctx.fillRect(h.x2, h.y - 12, h.x - h.x2, 24); ctx.strokeStyle = `rgba(255,170,205,${0.4 + p * 0.5})`; ctx.lineWidth = 2; ctx.strokeRect(h.x2, h.y - 12, (h.x - h.x2) * p, 24); ctx.restore(); }
      else Art.drawTelegraph(ctx, h.x, h.y, h.r, p);
    }
    for (const q of G.quakes) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      Art.glow(ctx, q.x, q.y - 16, 46, 'rgba(230,120,200,A)', 0.55);
      ctx.strokeStyle = 'rgba(255,190,230,.8)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.ellipse(q.x, q.y, 18, 30, 0, Math.PI * 0.6, Math.PI * 1.4); ctx.stroke();
      ctx.restore();
    }
  }
  // falling things (rocks, snowballs, gondolas) are drawn over the units
  function drawFalling() {
    for (const h of G.hazards) {
      if (h.spot) { // 終幕の踊り子: a spotlight cone from above
        const p = clamp(h.t / h.dur, 0, 1);
        ctx.save(); ctx.globalCompositeOperation = 'lighter';
        const gr = ctx.createLinearGradient(0, 0, 0, h.y); gr.addColorStop(0, 'rgba(255,240,210,0)'); gr.addColorStop(1, `rgba(255,236,200,${(0.12 + p * 0.28).toFixed(3)})`);
        ctx.fillStyle = gr; ctx.beginPath(); ctx.moveTo(h.x - 10, 0); ctx.lineTo(h.x + 10, 0); ctx.lineTo(h.x + h.r, h.y); ctx.lineTo(h.x - h.r, h.y); ctx.closePath(); ctx.fill();
        ctx.restore();
      }
      if (!h.visual) continue;
      const p = clamp(h.t / h.dur, 0, 1);
      if (h.visual === 'snow' && h.sx != null) { // thrown in an arc from the snowman's hand
        const x = h.sx + (h.x - h.sx) * p, y = h.sy + (h.y - 20 - h.sy) * p - Math.sin(p * Math.PI) * 120;
        Art.glow(ctx, x, y, 18, 'rgba(200,220,255,A)', 0.5); ctx.fillStyle = '#e6e2f2'; Art.circ(ctx, x, y, 9); ctx.fill(); ctx.strokeStyle = 'rgba(40,20,60,.8)'; ctx.lineWidth = 1.5; ctx.stroke();
        continue;
      }
      if (p < 0.45) continue;
      const q = (p - 0.45) / 0.55, y = h.y - 20 - (1 - q) * 380;
      if (h.visual === 'rock') {
        ctx.save(); ctx.globalCompositeOperation = 'lighter'; Art.glow(ctx, h.x, y - 10, 34, 'rgba(255,170,120,A)', 0.5); ctx.restore();
        ctx.fillStyle = '#4a3a52'; Art.circ(ctx, h.x, y, 16); ctx.fill(); ctx.strokeStyle = '#140a20'; ctx.lineWidth = 2.5; ctx.stroke();
        ctx.fillStyle = 'rgba(30,18,40,.8)'; Art.circ(ctx, h.x - 5, y - 4, 4); ctx.fill(); Art.circ(ctx, h.x + 6, y + 5, 3); ctx.fill();
      } else if (h.visual === 'gondola') {
        ctx.fillStyle = '#5c4466'; Art.rr(ctx, h.x - 16, y - 18, 32, 26, 6); ctx.fill(); ctx.strokeStyle = '#140a20'; ctx.lineWidth = 2.5; ctx.stroke();
        ctx.fillStyle = 'rgba(255,210,240,.35)'; ctx.fillRect(h.x - 10, y - 12, 20, 9);
      }
    }
  }

  // 溶けない雪だるま: cold aura (slows allies near it), snowballs at the back line, belly bump; sheds small snowmen at 2/3 and 1/3 HP;
  // phase 2: small snowmen that are still alive near it are taken back in and heal it
  function aiSnow(e, A, dt) {
    const d = e.def;
    bossPhase(e);
    for (const th of [2 / 3, 1 / 3]) if (!e.T['split' + th] && e.hp < e.maxHp * th) {
      e.T['split' + th] = 1; bossSummon(e, 'snowlet', d.split, -30);
      G.texts.push({ x: e.x, y: e.y - 200, v: '雪がこぼれた', life: 1.2, skill: true });
    }
    if (e.phase === 2 && timer(e, 'absorb', dt, d.absorb.every)) {
      e.T.absorb = d.absorb.every; let n = 0;
      for (const o of G.enemies) if (!o.dead && o.kind === 'snowlet' && Math.abs(o.x - e.x) <= d.absorb.r) { o.dead = 0.0001; o.hp = 0; o.popped = true; n++; G.fx.push({ type: 'frost', x: o.x, y: o.y, life: 1, dur: 0.6, r: 40 }); }
      if (n) { const h = e.maxHp * d.absorb.heal * n; e.hp = Math.min(e.maxHp, e.hp + h); G.texts.push({ x: e.x, y: e.y - 220, v: '+' + Math.round(h), life: 1.2, heal: true }); }
    }
    const w = tickWind(e, dt);
    if (w) return;
    const b = d.ball;
    if (timer(e, 'ball', dt, 2.5)) {
      e.T.ball = e.phase === 2 ? b.every2 : b.every;
      const t = backAlly(e, A, b.reach);
      const tx = t ? t.x : e.x - LANE.front <= b.reach ? LANE.front + 30 : null;
      if (tx != null) { startWind(e, 'throw', 0.5); addHazard({ x: tx + rand(-14, 14), r: b.r, dur: 1.2, dmg: e.atkV * b.mul, from: e, slow: 1.5, visual: 'snow', sx: e.x - 30, sy: e.y - 170 }); Sound.play('toss'); return; }
    }
    const s = bossWalk(e, A, dt);
    if ((s.near || s.atTower) && e.cool <= 0) {
      e.cool = d.rate; startWind(e, 'bump', 0.7);
      addHazard({ x: e.x - d.bump.off, r: d.bump.r, dur: 0.7, dmg: e.atkV, knock: d.bump.knock, from: e });
    }
  }

  // 顔のない友人: hidden (cannot be targeted) while it walks through the line; shows itself for a moment when it taps someone,
  // when hit by an area attack, or while marked. Phase 2: appears right behind the back line, and calls smaller "もう一人"
  function aiFriend(e, A, dt) {
    const d = e.def;
    if (bossPhase(e)) e.T.warp = 1.5;
    e.revealT = Math.max(0, (e.revealT || 0) - dt);
    e.hidden = !(e.revealT > 0 || e.markT > G.time);
    e.reveal += ((e.hidden ? 0 : 1) - e.reveal) * Math.min(1, dt * 5);
    if (e.warping) { e.walk = false; return; }
    if (e.phase === 2) {
      if (timer(e, 'kids', dt, 2)) { e.T.kids = d.kids.every; bossSummon(e, 'friendkid', d.kids.n, 30); }
      if (timer(e, 'warp', dt, 1.5)) {
        e.T.warp = d.warp.every;
        const t = backAlly(e, A, 2000);
        if (t) {
          // a small circle shows where it will appear; 0.7 s later it is there and strikes
          e.warping = true;
          addHazard({ x: t.x, r: 50, dur: 0.7, dmg: e.atkV * d.warp.mul, from: e, tower: false, then: () => {
            G.fx.push({ type: 'smoke', x: e.x, y: e.y, life: 1, dur: 0.6 });
            e.x = Math.max(LANE.front + 50, t.x - 46); e.atk = 1; e.revealT = d.tap.show; e.warping = false; e.cool = d.rate;
            G.fx.push({ type: 'smoke', x: e.x, y: e.y, life: 1, dur: 0.6 });
            G.texts.push({ x: e.x, y: e.y - 190, v: 'みつけた', life: 1.2, skill: true });
          } });
          return;
        }
      }
    }
    // nearest ally in reach (either side, it walks through the line)
    let t = null, bd = 1e9;
    for (const a of A) { const dx = Math.abs(e.x - a.x); if (dx <= d.range + 14 && dx < bd) { bd = dx; t = a; } }
    const atTower = e.x <= LANE.front + d.range * 0.6;
    const tapReady = timer(e, 'tap', dt, 1);
    if (t && (tapReady || !e.hidden)) {
      e.walk = false;
      if (e.cool <= 0) {
        e.cool = d.rate; e.atk = 1;
        damage(t, e.atkV * (tapReady ? d.tap.mul : 1), e); Sound.play('hit');
        if (tapReady) { e.T.tap = e.phase === 2 ? d.tap.every2 : d.tap.every; e.revealT = Math.max(e.revealT, d.tap.show); G.texts.push({ x: e.x, y: e.y - 190, v: 'とんとん', life: 1, skill: true }); }
      }
      return;
    }
    if (atTower) { e.walk = false; if (e.cool <= 0) { e.cool = d.rate; e.atk = 1; e.revealT = Math.max(e.revealT, 1.2); hitTower(e.atkV); } return; }
    e.x -= d.speed * dt; e.walk = true;
  }

  // 星を目指した者: floats above the battle line (only shooters / spears reach it) dropping rocks on allies and calling satellites;
  // phase 2: falls to the ground (shockwave on landing) and fights on foot with a stomp
  function aiAstro(e, A, dt) {
    const d = e.def;
    e.T.age = (e.T.age || 0) + dt;
    // (it also falls after fallAfter s, so a team without shooters is never stuck under it)
    if (e.phase === 1 && (e.hp < e.maxHp * 0.5 || e.T.age > d.fallAfter)) {
      e.phase = 2; showBanner(d.p2[0], d.p2[1], 1.8, true); Sound.play('boss');
      e.wind = 0; e.cool = 1.6; e.T.rock = 3.5; e.falling = true;
      // the landing spot is shown first; it lands 0.9 s later with a shockwave
      addHazard({ x: e.x, r: d.land.r, dur: 0.9, dmg: e.atkV, knock: d.land.knock, from: e, then: () => { e.fly = false; e.thrust = 0; e.landT = 1; e.falling = false; G.shake = 0.6; } });
    }
    if (e.falling) { e.thrust = 0.15; e.walk = false; return; }
    e.thrust = e.fly ? 0.7 + Math.sin(e.anim * 6) * 0.3 : 0;
    const w = tickWind(e, dt);
    if (w === 'busy') return;
    if (w === 'meteor') return;
    const R = d.rock;
    if (timer(e, 'rock', dt, R.first)) {
      e.T.rock = e.phase === 2 ? R.every2 : R.every;
      const n = e.phase === 2 ? R.n2 : R.n;
      const pool = A.filter((a) => !a.summoned).sort(() => Math.random() - 0.5).sort((p, q) => (p.def.melee ? 1 : 0) - (q.def.melee ? 1 : 0));
      startWind(e, 'meteor', 0.7);
      for (let i = 0; i < n; i++) {
        const t = pool[i];
        addHazard({ x: t ? t.x + rand(-18, 18) : LANE.front + 40 + i * 60, r: R.r, dur: 1.3, dmg: e.atkV * R.mul, from: e, visual: 'rock' });
      }
      return;
    }
    if (e.fly) {
      if (timer(e, 'sats', dt, 5)) { e.T.sats = d.sats.every; bossSummon(e, 'flyer', d.sats.n, 20); }
      if (e.x > d.hover) { e.x -= d.speed * dt; e.walk = true; } else e.walk = false;
      return;
    }
    const s = bossWalk(e, A, dt);
    if ((s.near || s.atTower) && e.cool <= 0) {
      e.cool = d.rate; startWind(e, 'stomp', 0.8);
      addHazard({ x: e.x - d.stomp.off, r: d.stomp.r, dur: 0.8, dmg: e.atkV * d.stomp.mul, knock: d.stomp.knock, from: e });
    }
  }

  // 壊れた観覧車: walks to the far edge of the battle line and plants itself, sending riders out; drops a gondola on allies in front.
  // phase 2: the ring turns, riders come faster and nightmares near it walk faster
  function aiWheel(e, A, dt) {
    const d = e.def;
    bossPhase(e);
    if (e.phase === 2) {
      e.spin += dt * 0.6;
      for (const o of G.enemies) if (!o.dead && !o.boss && Math.abs(o.x - e.x) <= d.haste.r) { o.hasteT = G.time + 0.3; o.hasteV = d.haste.v; }
    }
    if (timer(e, 'ride', dt, d.ride.first)) {
      e.T.ride = e.phase === 2 ? d.ride.every2 : d.ride.every;
      const k = (e.T.n = (e.T.n || 0) + 1) % 3;
      if (k === 1) bossSummon(e, 'charger', 1, -50); else if (k === 2) bossSummon(e, 'swarm', 3, -50); else bossSummon(e, 'runner', 2, -50);
      e.atk = 1;
    }
    if (tickWind(e, dt)) return;
    const s = bossWalk(e, A, dt, d.anchor);
    e.anchored = s.stop;
    const front = A.some((a) => e.x - a.x >= -30 && e.x - a.x <= d.drop.off + d.drop.r);
    if ((front || s.atTower) && e.cool <= 0) {
      e.cool = d.rate; startWind(e, 'drop', 0.8);
      addHazard({ x: e.x - d.drop.off, r: d.drop.r, dur: 0.8, dmg: e.atkV * d.drop.mul, from: e, visual: 'gondola' });
    }
  }

  // 最後の打者: every few seconds takes his batting stance and hits back every shot from a ranged ally (the batter takes nothing);
  // otherwise walks in and swings, and every third move runs the bases (a line charge a standing heavy can stop).
  // phase 2: longer stance, and the hit-back ball flies to the back line instead
  function batBack(e, from, amount) {
    const P = ENEMIES.batter.stance, p2 = e.phase === 2 && e.def.ai === 'batter';
    e.atk = 1; e.T.lastBat = G.time;
    const tgt = p2 ? backAlly(e, alive(G.allies), 2000) || from : from;
    G.shots.push({ enemy: true, kind: 'ball', from: e, x0: e.x - 30, y0: e.y - 110, x: e.x - 30, y: e.y - 110, tx: tgt.x, ty: hitY(tgt), target: tgt, t: 0, dur: Math.max(0.2, Math.abs(tgt.x - e.x) / 900), arc: 30, dmg: amount * (p2 ? P.back2 : P.back) });
    if (!(e.T.batTxt > G.time)) { e.T.batTxt = G.time + 0.6; G.texts.push({ x: e.x, y: e.y - 210, v: 'カキーン', life: 0.9, skill: true }); Sound.play('pop'); }
  }
  function aiBatter(e, A, dt) {
    const d = e.def, P = d.stance;
    bossPhase(e);
    if (e.dashT > 0) { // running the bases
      e.dashT -= dt; e.dash = 1; e.walk = true;
      const nx = Math.max(LANE.front + 60, e.x - 420 * dt);
      let stopX = null;
      for (const a of A) if (a.x <= e.x && a.x >= nx - 30 && !a.hitByRun) {
        a.hitByRun = true; damage(a, e.atkV * d.run.mul, e);
        if (a.def.armor && !a.dead) stopX = Math.max(stopX == null ? -1e9 : stopX, a.x + 50); else if (!a.dead) a.x = Math.max(LANE.allySpawn - 20, a.x - d.run.knock);
      }
      if (stopX != null) { e.x = Math.min(e.x, Math.max(nx, stopX)); e.dashT = 0; G.texts.push({ x: e.x - 60, y: e.y - 150, v: '受け止めた', life: 1.1, skill: true }); } else e.x = nx;
      if (e.x <= LANE.front + 70) { hitTower(e.atkV * d.run.mul * 0.8); e.dashT = 0; }
      if (e.dashT <= 0) { e.dash = 0; for (const a of A) a.hitByRun = false; G.shake = 0.3; }
      return;
    }
    // stance cycle
    if (e.stanceOn) {
      e.stanceT -= dt; e.walk = false; e.stance = Math.min(1, e.stance + dt * 4);
      if (e.stanceT <= 0) { e.stanceOn = false; e.T.stance = e.phase === 2 ? P.every2 : P.every; }
      return;
    }
    e.stance = Math.max(0, e.stance - dt * 4);
    if (e.wind > 0) {
      const w = tickWind(e, dt);
      if (w === 'charge') { e.dashT = d.run.len / 420; Sound.play('dash'); }
      return;
    }
    if (timer(e, 'stance', dt, 3)) { e.stanceOn = true; e.stanceT = e.phase === 2 ? P.time2 : P.time; G.texts.push({ x: e.x, y: e.y - 220, v: '構え', life: 1, skill: true }); Sound.play('deny'); return; }
    const s = bossWalk(e, A, dt);
    if ((s.near || s.atTower) && e.cool <= 0) {
      e.cool = d.rate; e.T.moves = (e.T.moves || 0) + 1;
      if (e.T.moves % d.run.each === 0 && !s.atTower) {
        startWind(e, 'charge', 0.8);
        G.hazards.push({ line: true, x: e.x - 20, x2: e.x - 20 - d.run.len, t: 0, dur: 0.8, y: MID_Y + 6, dmg: 0, from: e, tower: false, visualOnly: true });
      } else {
        startWind(e, 'swing', 0.6);
        addHazard({ x: e.x - d.swing.off, r: d.swing.r, dur: 0.6, dmg: e.atkV, knock: d.swing.knock, from: e });
      }
    }
  }

  // 深海の歌姫: stays just past the battle line (melee cannot reach her; the 忍者 can leap to her), sings a lullaby that halves the
  // allies' attack speed, shoots bubbles at the back line and slowly heals nightmares near her. phase 2: comes forward, sings more often, calls jellyfish
  function aiSiren(e, A, dt) {
    const d = e.def;
    e.T.age = (e.T.age || 0) + dt;
    // the tide also rises after tideAfter s (so a team that cannot reach her is not stuck)
    if (e.phase === 1 && e.T.age > d.tideAfter) { e.phase = 2; showBanner(d.p2[0], d.p2[1], 1.8, true); Sound.play('boss'); }
    bossPhase(e);
    const S = d.song;
    if (timer(e, 'heal', dt, d.heal.every)) {
      e.T.heal = d.heal.every; let healed = false;
      for (const o of G.enemies) if (!o.dead && !o.boss && o.hp < o.maxHp && Math.abs(o.x - e.x) <= d.heal.r) { o.hp = Math.min(o.maxHp, o.hp + o.maxHp * d.heal.v); healed = true; }
      if (healed) G.fx.push({ type: 'mend', x: e.x, y: e.y, life: 1, dur: 0.8, r: d.heal.r });
    }
    if (e.phase === 2 && timer(e, 'jelly', dt, 1)) { e.T.jelly = d.jelly.every; bossSummon(e, 'flyer', d.jelly.n, 10); }
    const w = tickWind(e, dt);
    if (w === 'song') {
      for (const a of A) if (Math.abs(a.x - e.x) <= S.r) a.dazeT = Math.max(a.dazeT || 0, S.daze);
      G.fx.push({ type: 'ring', x: e.x, y: e.y - 60, life: 1, dur: 1.2, r: S.r });
      G.texts.push({ x: e.x, y: e.y - 220, v: '眠りの歌', life: 1.3, skill: true }); Sound.play('bell');
      return;
    }
    if (w) return;
    if (timer(e, 'song', dt, S.first)) { e.T.song = e.phase === 2 ? S.every2 : S.every; startWind(e, 'song', 1.0); G.fx.push({ type: 'ring', x: e.x, y: e.y - 60, life: 1, dur: 1.0, r: 120 }); return; }
    const stopX = e.phase === 2 ? d.anchor2 : d.anchor;
    // a melee ally right next to her (a 忍者 that leapt in): tail slap
    const close = A.find((a) => Math.abs(a.x - e.x) <= 70);
    if (close) { e.walk = false; if (e.cool <= 0) { e.cool = d.rate; e.atk = 1; damage(close, e.atkV, e); Sound.play('hit'); } return; }
    if (e.x > stopX) { e.x -= d.speed * dt; e.walk = true; } else e.walk = false;
    if (e.cool <= 0) {
      const t = backAlly(e, A, d.range);
      if (t) { e.cool = d.rate; e.atk = 1; enemyFire(e, t, 'bubble', d.bubble, 120); }
      else if (e.x - LANE.front <= d.range) { e.cool = d.rate; e.atk = 1; enemyFire(e, null, 'bubble', d.bubble, 120); }
    }
  }

  // 空っぽの玉座: calls retainers and then inhales the nightmares around it (heals, and hits harder for each one); sweeps with its robe.
  // phase 2: the scepter sends ground quakes that travel all the way to the lighthouse
  function aiThrone(e, A, dt) {
    const d = e.def, Ab = d.absorb;
    if (bossPhase(e)) e.T.quake = 1.5;
    e.atkV = e.baseAtk * (1 + (e.powerV || 0)); e.power = (e.powerV || 0) / Ab.powMax; // power (0..1) drives the crown glow
    if (timer(e, 'call', dt, 2)) { e.T.call = d.call.every; bossSummon(e, 'shade', e.phase === 2 ? d.call.n2 : d.call.n, 40); }
    const w = tickWind(e, dt);
    e.absorb = e.wind > 0 && e.windKind === 'absorb' ? e.wind : Math.max(0, e.absorb - dt * 2);
    if (w === 'absorb') {
      let n = 0;
      for (const o of G.enemies) if (!o.dead && !o.boss && Math.abs(o.x - e.x) <= Ab.r) { o.dead = 0.0001; o.hp = 0; o.popped = true; n++; G.motes.push({ x: o.x, y: o.y - 30, vx: (e.x - o.x) * 2, vy: -40, life: 0.6, max: 0.6, color: '200,120,230', kind: 'spark' }); }
      if (n) {
        const h = Math.min(Ab.healMax * e.maxHp, Ab.heal * n * e.maxHp, Math.max(0, Ab.healTotal * e.maxHp - (e.T.healed || 0))); e.T.healed = (e.T.healed || 0) + h; e.hp = Math.min(e.maxHp, e.hp + h);
        e.powerV = Math.min(Ab.powMax, (e.powerV || 0) + Ab.pow * n);
        G.texts.push({ x: e.x, y: e.y - 220, v: `吸い込んだ +${Math.round(h)}`, life: 1.3, heal: true });
      }
      return;
    }
    if (w === 'scepter') { G.quakes.push({ x: e.x - 40, y: MID_Y + 6, speed: d.quake.speed, dmg: e.atkV * d.quake.mul, from: e, hit: new Set() }); G.shake = 0.35; Sound.play('slam'); return; }
    if (w) return;
    if (timer(e, 'absorb', dt, Ab.first)) {
      e.T.absorb = Ab.every;
      if (G.enemies.some((o) => !o.dead && !o.boss && Math.abs(o.x - e.x) <= Ab.r)) { startWind(e, 'absorb', 1.2); return; }
    }
    if (e.phase === 2 && timer(e, 'quake', dt, 1.5)) { e.T.quake = d.quake.every; startWind(e, 'scepter', 0.9); return; }
    const s = bossWalk(e, A, dt);
    if ((s.near || s.atTower) && e.cool <= 0) {
      e.cool = d.rate; startWind(e, 'sweep', 0.7);
      addHazard({ x: e.x - d.sweep.off, r: d.sweep.r, dur: 0.7, dmg: e.atkV, from: e });
    }
  }

  // 刻喰らいの時計塔: every few seconds winds its hands back and returns to the HP it had a few seconds ago —
  // heavy damage during the wind-up stops the rewind. Thrusts its long hand forward. phase 2: time slows around it
  function aiClock(e, A, dt) {
    const d = e.def, R = d.rewind;
    bossPhase(e);
    if (timer(e, 'hist', dt, 0)) { e.T.hist = 0.25; (e.hist = e.hist || []).push({ t: G.time, hp: e.hp }); while (e.hist.length && e.hist[0].t < G.time - R.back - R.wind - 0.5) e.hist.shift(); }
    if (e.wind > 0 && e.windKind === 'rewind' && e.rwHp - e.hp >= e.maxHp * R.stop) {
      e.wind = 0; e.frozenT = 0.8; e.T.rw = e.phase === 2 ? R.every2 : R.every;
      G.texts.push({ x: e.x, y: e.y - 220, v: '針が止まった', life: 1.3, skill: true }); Sound.play('epic');
      return;
    }
    const w = tickWind(e, dt);
    if (w === 'rewind') {
      const past = (e.hist || []).find((p) => p.t >= G.time - R.back - R.wind);
      if (past && past.hp > e.hp) { const h = past.hp - e.hp; e.hp = past.hp; G.texts.push({ x: e.x, y: e.y - 220, v: `巻き戻し +${Math.round(h)}`, life: 1.3, heal: true }); }
      e.rewind = 1; Sound.play('song');
      return;
    }
    if (w) return;
    if (timer(e, 'rw', dt, R.first)) { e.T.rw = e.phase === 2 ? R.every2 : R.every; e.rwHp = e.hp; startWind(e, 'rewind', R.wind); G.texts.push({ x: e.x, y: e.y - 220, v: 'チクタク…', life: 1.2, skill: true }); return; }
    const s = bossWalk(e, A, dt);
    if ((s.near || s.atTower) && e.cool <= 0) {
      e.cool = d.rate; startWind(e, 'thrust', 0.6);
      G.hazards.push({ line: true, x: e.x - 20, x2: e.x - 20 - d.thrust.len, t: 0, dur: 0.6, y: MID_Y + 6, dmg: e.atkV * d.thrust.mul, from: e, tower: true, mul: 1 });
    }
  }

  // 忘却を運ぶ郵便屋: sticks letters on nearby residents (封: no attacks for a few seconds) and sends 速達 that fly for the lighthouse
  // (shot down, they open and heal the residents around them). phase 2: the envelope body unravels into a flock of letters
  function aiPostman(e, A, dt) {
    const d = e.def, X = d.express, S = d.seal;
    bossPhase(e);
    if (timer(e, 'exp', dt, X.first)) {
      e.T.exp = X.every;
      for (const s of bossSummon(e, 'express', e.phase === 2 ? X.n2 : X.n, -20)) s.atkV = e.baseAtk * X.hit;
      G.texts.push({ x: e.x, y: e.y - 220, v: '速達', life: 1.1, skill: true });
    }
    if (e.phase === 2 && timer(e, 'flock', dt, 1)) { e.T.flock = d.flock.every; bossSummon(e, 'letter', d.flock.n, 0); }
    const w = tickWind(e, dt);
    if (w === 'seal') {
      const ts = A.filter((a) => Math.abs(a.x - e.x) <= S.reach).sort((p, q) => Math.abs(p.x - e.x) - Math.abs(q.x - e.x)).slice(0, S.n);
      for (const t of ts) G.shots.push({ enemy: true, kind: 'letter', from: e, x0: e.x - 20, y0: e.y - 120, x: e.x - 20, y: e.y - 120, tx: t.x, ty: hitY(t), target: t, t: 0, dur: Math.max(0.3, Math.abs(t.x - e.x) / 500), arc: 40, dmg: e.atkV * S.mul, seal: S.time });
      Sound.play('toss');
      return;
    }
    if (w) return;
    if (timer(e, 'seal', dt, S.first) && A.some((a) => Math.abs(a.x - e.x) <= S.reach)) { e.T.seal = S.every; startWind(e, 'seal', 0.6); return; }
    const s = bossWalk(e, A, dt);
    if ((s.near || s.atTower) && e.cool <= 0) { e.cool = d.rate; startWind(e, 'slap', 0.6); addHazard({ x: e.x - d.slap.off, r: d.slap.r, dur: 0.6, dmg: e.atkV, from: e }); }
  }

  // 異端の魔女: heart shots at the back line; おもちゃの魔法 turns the resident with the most HP into a toy for a few seconds.
  // phase 2: transforms (invulnerable for a moment), then wears a ribbon barrier — shots/spells deal half, melee hits cut it; it re-forms
  function aiWitch(e, A, dt) {
    const d = e.def;
    if (bossPhase(e)) { e.invul = d.change; e.transformT = d.change; e.wind = 0; }
    if (e.transformT > 0) {
      e.transformT -= dt; e.transform = 1 - Math.max(0, e.transformT) / d.change; e.walk = false;
      if (e.transformT <= 0) { e.transform = 0; e.barrier = d.barrier.hits; G.texts.push({ x: e.x, y: e.y - 220, v: 'リボンの結界', life: 1.2, skill: true }); }
      return;
    }
    if (e.phase === 2 && !(e.barrier > 0) && timer(e, 'rib', dt, d.barrier.every)) { e.barrier = d.barrier.hits; e.T.rib = d.barrier.every; G.texts.push({ x: e.x, y: e.y - 220, v: 'リボンの結界', life: 1.2, skill: true }); }
    const w = tickWind(e, dt);
    if (w === 'toy') return; // (the spell itself lands through its telegraph)
    if (w) return;
    if (timer(e, 'toy', dt, d.toy.first)) {
      let t = null;
      for (const a of A) if (!a.summoned && !(a.toyT > 0) && (!t || a.maxHp > t.maxHp)) t = a;
      if (t) {
        e.T.toy = d.toy.every; startWind(e, 'toy', d.toy.wind);
        addHazard({ x: t.x, r: 34, dur: d.toy.wind, dmg: 0, from: e, tower: false, visualOnly: true, follow: t, then: () => {
          if (t.dead || !G.allies.includes(t)) return;
          t.toyT = d.toy.time; G.texts.push({ x: t.x, y: t.y - 84, v: 'おもちゃの魔法', life: 1.3, skill: true }); G.fx.push({ type: 'smoke', x: t.x, y: t.y, life: 1, dur: 0.6 }); Sound.play('magic');
        } });
        return;
      }
    }
    if (timer(e, 'heart', dt, 1.5)) { const t = backAlly(e, A, d.heart.reach); if (t) { e.T.heart = d.heart.every; e.atk = 1; enemyFire(e, t, 'heart', d.heart.mul, 130); } }
    const s = bossWalk(e, A, dt);
    if ((s.near || s.atTower) && e.cool <= 0) { e.cool = d.rate; startWind(e, 'bonk', 0.6); addHazard({ x: e.x - d.bonk.off, r: d.bonk.r, dur: 0.6, dmg: e.atkV, from: e }); }
  }

  // 終幕の踊り子: three acts. Act 1 waltz; at 2/3 and 1/3 HP the curtain falls (3 s, invulnerable) pushing the line back.
  // Act 2 adds a pirouette through the line to the back and back again; act 3 (終幕) adds spotlights that track residents and strike
  function aiDancer(e, A, dt) {
    const d = e.def, C = d.curtain;
    e.act = e.act || 1;
    const want = e.hp < e.maxHp / 3 ? 3 : e.hp < e.maxHp * 2 / 3 ? 2 : 1;
    if (want > e.act && !(e.curtainT > 0) && !(e.spinT > 0)) {
      e.act = want; e.phase = 2; e.curtainT = C.time; e.invul = C.time; e.wind = 0;
      for (const a of A) if (a.x <= e.x && e.x - a.x <= C.r) a.x = Math.max(LANE.allySpawn - 20, a.x - C.push);
      G.curtain = C.time;
      showBanner(want === 2 ? '第二幕' : '終幕', want === 2 ? 'くるくると前線を抜けてくる' : 'スポットライトが住人を追う', 2, true); Sound.play('boss');
    }
    if (e.curtainT > 0) { e.curtainT -= dt; G.curtain = Math.max(0, e.curtainT); e.curtain = Math.min(1, (e.curtain || 0) + dt * 3); e.walk = false; return; }
    e.curtain = Math.max(0, (e.curtain || 0) - dt * 3);
    if (e.spinT > 0) { // pirouette: out through the line, then back
      e.spinT -= dt; e.dash = 1; e.walk = true;
      if (e.spinOut) {
        const nx = Math.max(e.spinTo, e.x - 520 * dt);
        for (const a of A) if (a.x <= e.x && a.x >= nx - 20 && !e.spinHit.has(a.id)) { e.spinHit.add(a.id); damage(a, e.atkV * d.spin.mul, e); }
        e.x = nx; if (e.x <= e.spinTo + 1) e.spinOut = false;
      } else { e.x = Math.min(e.spinFrom, e.x + 360 * dt); if (e.x >= e.spinFrom - 1) e.spinT = 0; }
      if (e.spinT <= 0) e.dash = 0;
      return;
    }
    const w = tickWind(e, dt);
    if (w === 'spin') {
      let rear = null; for (const a of A) if (!a.summoned && (!rear || a.x < rear.x)) rear = a;
      e.spinFrom = e.x; e.spinTo = Math.min(e.x, Math.max(LANE.front + 80, (rear ? rear.x : e.x - 300) - 40)); e.spinOut = true; e.spinHit = new Set(); e.spinT = 6; Sound.play('dash');
      return;
    }
    if (w) return;
    if (e.act >= 2 && A.length && timer(e, 'spin', dt, d.spin.first)) {
      e.T.spin = d.spin.every; startWind(e, 'spin', 0.7);
      let rear = null; for (const a of A) if (!a.summoned && (!rear || a.x < rear.x)) rear = a;
      G.hazards.push({ line: true, x: e.x - 20, x2: Math.max(LANE.front + 60, (rear ? rear.x : e.x - 300) - 40), t: 0, dur: 0.7, y: MID_Y + 6, dmg: 0, from: e, tower: false, visualOnly: true });
      return;
    }
    if (e.act >= 3 && timer(e, 'spot', dt, d.spot.first)) {
      e.T.spot = d.spot.every;
      const pool = A.slice().sort(() => Math.random() - 0.5).slice(0, d.spot.n);
      for (const t of pool) addHazard({ x: t.x, r: d.spot.r, dur: d.spot.time, dmg: e.atkV * d.spot.mul, from: e, follow: t, lock: 0.5, tower: false, spot: true });
      if (pool.length) G.texts.push({ x: e.x, y: e.y - 220, v: 'スポットライト', life: 1.2, skill: true });
    }
    const s = bossWalk(e, A, dt);
    if ((s.near || s.atTower) && e.cool <= 0) { e.cool = d.rate; startWind(e, 'waltz', 0.8); addHazard({ x: e.x - d.waltz.off, r: d.waltz.r, dur: 0.8, dmg: e.atkV, from: e }); }
  }

  // 深海の夢鯨: swims in the sky (shooters / spears / turrets reach it). Swallows a front-line resident for a while — it keeps hitting from
  // inside and comes out a little healed. Spouts to heal nightmares. phase 2 (half HP or after diveAfter s): dives out of reach and breaches
  // where the warning circle is, then stays low for a few seconds so melee can hit it
  function releaseBelly(e, b) {
    const i = e.belly.indexOf(b); if (i >= 0) e.belly.splice(i, 1);
    const u = b.u; if (u.dead) return;
    u.x = clamp(e.x - 60, LANE.allySpawn, LANE.engageMaxX); u.hp = Math.min(u.maxHp, u.hp + u.maxHp * e.def.swallow.heal);
    G.allies.push(u); G.fx.push({ type: 'heal', x: u.x, y: u.y, life: 1, dur: 0.7 });
  }
  // the residents inside keep fighting and come out on time — this runs every frame, even while the whale is frozen or slowed
  function bellyTick(e, dt) {
    for (const b of e.belly.slice()) {
      if (b.u.dead) { e.belly.splice(e.belly.indexOf(b), 1); continue; }
      b.bellyT -= dt; b.hitT -= dt;
      if (b.hitT <= 0) { b.hitT = 1; if (b.u.atkV > 0) damage(e, b.u.atkV * e.def.swallow.hit, b.u); if (e.dead) return; }
      if (b.bellyT <= 0) releaseBelly(e, b);
    }
    e.bellyN = e.belly.length;
  }
  function aiWhale(e, A, dt) {
    const d = e.def, Sw = d.swallow, Dv = d.dive;
    e.T.age = (e.T.age || 0) + dt;
    if (e.phase === 1 && (e.hp < e.maxHp * 0.5 || e.T.age > d.diveAfter)) { e.phase = 2; showBanner(d.p2[0], d.p2[1], 1.8, true); Sound.play('boss'); e.T.dive = Dv.first; }
    e.belly = e.belly || [];
    e.bellyN = e.belly.length;
    if (e.upT > 0) { e.upT -= dt; e.walk = false; if (e.upT <= 0) e.fly = true; return; }
    if (e.diveT > 0) { e.diveT -= dt; e.hidden = true; e.reveal = Math.max(0, e.reveal - dt * 2); e.walk = false; return; }
    e.hidden = false; e.reveal = Math.min(1, e.reveal + dt * 2);
    const w = tickWind(e, dt);
    if (w === 'spout') {
      let healed = false;
      for (const o of G.enemies) if (!o.dead && !o.boss && o.hp < o.maxHp && Math.abs(o.x - e.x) <= d.spout.r) { o.hp = Math.min(o.maxHp, o.hp + o.maxHp * d.spout.v); healed = true; }
      if (healed) G.fx.push({ type: 'mend', x: e.x, y: e.y, life: 1, dur: 0.8, r: d.spout.r });
      return;
    }
    if (w) return;
    if (e.phase === 2 && timer(e, 'dive', dt, Dv.first)) {
      e.T.dive = Dv.every;
      let t = null; for (const a of A) if (!a.summoned && !a.away && (!t || a.x > t.x)) t = a;
      const tx = Math.min(d.hover - 50, t ? t.x : LANE.front + 200);
      e.diveT = Dv.time; e.hidden = true; G.fx.push({ type: 'smoke', x: e.x, y: e.y - FLY_H, life: 1, dur: 0.8 }); Sound.play('slam');
      addHazard({ x: tx, r: Dv.r, dur: Dv.time, dmg: e.atkV * Dv.mul, knock: Dv.knock, from: e, then: () => { e.x = Math.max(LANE.front + 140, tx + 50); e.diveT = 0; e.hidden = false; e.reveal = 1; e.fly = false; e.upT = Dv.up; G.shake = 0.6; } });
      return;
    }
    if (e.belly.length < Sw.max && timer(e, 'sw', dt, Sw.first)) {
      let t = null;
      for (const a of A) if (!a.summoned && a.def.melee && Math.abs(a.x - e.x) <= Sw.reach && (!t || a.x > t.x)) t = a;
      if (!t) for (const a of A) if (!a.summoned && Math.abs(a.x - e.x) <= Sw.reach && (!t || a.x > t.x)) t = a;
      if (t) {
        e.T.sw = Sw.every; startWind(e, 'swallow', Sw.wind);
        addHazard({ x: t.x, r: 36, dur: Sw.wind, dmg: 0, from: e, tower: false, visualOnly: true, follow: t, then: () => {
          const i = G.allies.indexOf(t);
          if (t.dead || i < 0 || e.belly.length >= Sw.max) return;
          G.allies.splice(i, 1); e.belly.push({ u: t, bellyT: Sw.time, hitT: 1 });
          for (const sh of G.shots) if (sh.target === t) sh.done = true; // shots aimed at it now miss
          G.texts.push({ x: t.x, y: t.y - 84, v: '呑み込まれた', life: 1.3, skill: true }); Sound.play('slam');
        } });
        return;
      }
    }
    if (timer(e, 'spout', dt, d.spout.every)) { e.T.spout = d.spout.every; startWind(e, 'spout', 0.8); return; }
    if (e.x > d.hover + 4) { e.x -= d.speed * dt; e.walk = true; } else if (e.x < d.hover - 4) { e.x += d.speed * dt; e.walk = true; } else e.walk = false;
  }

  // 灯を喰らうもの（第100ウェーブ専用）: slows energy while alive; every few seconds drains held energy into a membrane — if nothing is
  // held it starves and takes more damage; a shadow hand sometimes numbs a new resident; at 80/60/40% it wears the memory of a boss
  // defeated in this run and uses its move; below 20% the halo shatters and the lantern sweeps the lane with a beam
  function pickForm(e) {
    const all = BOSSES.filter((k) => !ENEMIES[k].final);
    const won = (G.bossKilled || []).filter((k) => all.includes(k));
    const src = won.length ? won : all;
    const used = e.usedForms || (e.usedForms = []);
    let c = src.filter((k) => !used.includes(k)); if (!c.length) c = src;
    const k = c[(Math.random() * c.length) | 0]; used.push(k); return k;
  }
  function formMove(e, A, dt) {
    const k = e.form, F = ENEMIES[k];
    if (!timer(e, 'f1', dt, 1.5)) return false;
    const say = (v) => G.texts.push({ x: e.x, y: e.y - 260, v, life: 1.2, skill: true });
    switch (k) {
      case 'boss': e.T.f1 = 6; startWind(e, 'slam', 0.75); addHazard({ x: e.x - 60, r: 140, dur: 0.75, dmg: e.atkV, knock: 28, from: e }); return true;
      case 'snowman': { e.T.f1 = 5; const t = backAlly(e, A, 700); if (t) addHazard({ x: t.x, r: 60, dur: 1.2, dmg: e.atkV * 0.8, slow: 1.5, from: e, visual: 'snow', sx: e.x - 40, sy: e.y - 260 }); return false; }
      case 'friend': { e.T.f1 = 9; const t = backAlly(e, A, 2000); if (t) { addHazard({ x: t.x, r: 50, dur: 0.7, dmg: e.atkV * 1.4, from: e, tower: false }); say('みつけた'); } return false; }
      case 'astro': { e.T.f1 = 6; const pool = A.filter((a) => !a.summoned).sort(() => Math.random() - 0.5).slice(0, 2); for (const t of pool) addHazard({ x: t.x + rand(-18, 18), r: 70, dur: 1.3, dmg: e.atkV * F.rock.mul, from: e, visual: 'rock' }); return false; }
      case 'wheel': { e.T.f1 = 5; const n = (e.T.rn = (e.T.rn || 0) + 1) % 3; if (n === 1) bossSummon(e, 'charger', 1, -60); else if (n === 2) bossSummon(e, 'swarm', 3, -60); else bossSummon(e, 'runner', 2, -60); return false; }
      case 'batter': e.T.f1 = 7; e.stanceOn = true; e.stanceT = F.stance.time; say('構え'); return false;
      case 'siren': e.T.f1 = 9; G.hazards.push({ x: e.x, r: F.song.r, t: 0, dur: 1.0, y: MID_Y + 6, dmg: 0, from: e, tower: false, visualOnly: true, then: () => { for (const a of alive(G.allies)) if (Math.abs(a.x - e.x) <= F.song.r) a.dazeT = Math.max(a.dazeT || 0, F.song.daze); say('眠りの歌'); Sound.play('bell'); } }); return false;
      case 'throne': e.T.f1 = 7; G.quakes.push({ x: e.x - 40, y: MID_Y + 6, speed: F.quake.speed, dmg: e.atkV * F.quake.mul, from: e, hit: new Set() }); G.shake = 0.35; Sound.play('slam'); return false;
      case 'clock': e.T.f1 = 99; e.rwHp = e.hp; e.rwPending = true; startWind(e, 'drain', F.rewind.wind); say('チクタク…'); return true;
      case 'postman': { e.T.f1 = 10; for (const s of bossSummon(e, 'express', 1, -40)) s.atkV = e.baseAtk * ENEMIES.postman.express.hit; say('速達'); return false; }
      case 'witch': {
        e.T.f1 = 9; let t = null; for (const a of A) if (!a.summoned && !(a.toyT > 0) && (!t || a.maxHp > t.maxHp)) t = a;
        if (t) addHazard({ x: t.x, r: 34, dur: 1.0, dmg: 0, from: e, tower: false, visualOnly: true, follow: t, then: () => { if (!t.dead && G.allies.includes(t)) { t.toyT = F.toy.time; G.texts.push({ x: t.x, y: t.y - 84, v: 'おもちゃの魔法', life: 1.3, skill: true }); } } });
        return false;
      }
      case 'dancer': { e.T.f1 = 7; for (const t of A.slice().sort(() => Math.random() - 0.5).slice(0, 3)) addHazard({ x: t.x, r: F.spot.r, dur: F.spot.time, dmg: e.atkV * F.spot.mul, from: e, follow: t, lock: 0.5, tower: false, spot: true }); return false; }
      case 'whale': { e.T.f1 = 9; for (const o of G.enemies) if (!o.dead && !o.boss && Math.abs(o.x - e.x) <= F.spout.r) o.hp = Math.min(o.maxHp, o.hp + o.maxHp * F.spout.v); G.fx.push({ type: 'mend', x: e.x, y: e.y, life: 1, dur: 0.8, r: F.spout.r }); return false; }
    }
    e.T.f1 = 8; return false;
  }
  function aiDevourer(e, A, dt) {
    const d = e.def, Dr = d.drain;
    if (e.starveT > 0) e.starveT -= dt;
    e.starve = e.starveT > 0 ? 1 : Math.max(0, (e.starve || 0) - dt);
    e.shield = e.shieldHp > 0 ? Math.min(1, e.shieldHp / (e.maxHp * Dr.shield * Dr.take)) : 0;
    if (timer(e, 'hist', dt, 0)) { e.T.hist = 0.25; (e.hist = e.hist || []).push({ t: G.time, hp: e.hp }); while (e.hist.length && e.hist[0].t < G.time - 7) e.hist.shift(); }
    if (e.phase === 1 && e.hp < e.maxHp * d.p2At) { e.phase = 2; e.form = null; e.stanceOn = false; if (e.rwPending) { e.wind = 0; e.rwPending = false; } e.T.beam = 1.5; showBanner(d.p2[0], d.p2[1], 1.8, true); Sound.play('boss'); G.shake = 0.6; }
    // wear the memory of a boss defeated in this run
    e.formN = e.formN || 0;
    if (e.phase === 1 && e.formN < d.forms.length && e.hp < e.maxHp * d.forms[e.formN]) {
      e.formN++; e.form = pickForm(e); e.formT = d.formTime; e.T.f1 = 1.5; e.stanceOn = false;
      showBanner(`「${ENEMIES[e.form].name}」の記憶をまとった`, d.name, 2.2, true); Sound.play('boss');
    }
    if (e.form) { e.formT -= dt; if (e.formT <= 0) { e.form = null; e.stanceOn = false; if (e.rwPending) { e.wind = 0; e.rwPending = false; } } }
    if (e.stanceOn) { e.stanceT -= dt; e.stance = Math.min(1, e.stance + dt * 4); if (e.stanceT <= 0) e.stanceOn = false; } else e.stance = Math.max(0, e.stance - dt * 4);
    // the borrowed rewind can be stopped like the clock tower's
    if (e.wind > 0 && e.rwPending && e.rwHp - e.hp >= e.maxHp * ENEMIES.clock.rewind.stop) { e.wind = 0; e.rwPending = false; e.frozenT = 0.8; G.texts.push({ x: e.x, y: e.y - 260, v: '針が止まった', life: 1.3, skill: true }); return; }
    const w = tickWind(e, dt);
    if (w === 'drain') {
      if (e.rwPending) {
        e.rwPending = false;
        const past = (e.hist || []).find((p) => p.t >= G.time - 6.6);
        if (past && past.hp > e.hp) { const h = past.hp - e.hp; e.hp = past.hp; G.texts.push({ x: e.x, y: e.y - 260, v: `巻き戻し +${Math.round(h)}`, life: 1.3, heal: true }); }
        return;
      }
      G.drainWarn = 0;
      // (with the army already full the player cannot spend energy in time, so then it takes less)
      const take = Math.min(armyN() >= CONFIG.allyCap ? Dr.takeCapped : Dr.take, Math.floor(G.energy));
      if (take > 0) { G.energy -= take; e.shieldHp = (e.shieldHp || 0) + take * Dr.shield * e.maxHp; G.texts.push({ x: e.x, y: e.y - 260, v: `灯を吸い上げた −${take}`, life: 1.4, skill: true }); Sound.play('deny'); }
      else { e.starveT = Dr.starve; G.texts.push({ x: e.x, y: e.y - 260, v: '飢え', life: 1.4, skill: true }); Sound.play('epic'); }
      return;
    }
    if (w) return;
    if (e.form && formMove(e, A, dt)) return;
    if (timer(e, 'drain', dt, Dr.first)) { e.T.drain = Dr.every; startWind(e, 'drain', Dr.wind); G.drainWarn = Dr.wind; G.texts.push({ x: e.x, y: e.y - 260, v: '灯が揺らぐ…', life: 1.4, skill: true }); return; }
    if (e.phase === 2 && timer(e, 'beam', dt, 1.5)) {
      e.T.beam = d.beam.every; startWind(e, 'beam', d.beam.wind);
      G.hazards.push({ line: true, x: e.x - 30, x2: Math.max(LANE.front + 20, e.x - 30 - d.beam.len), t: 0, dur: d.beam.wind, y: MID_Y + 6, dmg: e.atkV * d.beam.mul, from: e, tower: false });
      return;
    }
    const s = bossWalk(e, A, dt);
    if ((s.near || s.atTower) && e.cool <= 0) { e.cool = d.rate; startWind(e, 'slam', 0.8); addHazard({ x: e.x - d.slam.off, r: d.slam.r, dur: 0.8, dmg: e.atkV, knock: 30, from: e }); }
  }

  // 捨てられた英雄: slam (telegraphed AoE), charge in phase 2, summons shades
  function aiHero(e, A, dt) {
    const d = e.def;
    if (e.phase === 1 && e.hp < e.maxHp * BOSS.phase2At) { e.phase = 2; e.chargeCd = BOSS.chargeFirst; showBanner(d.p2[0], d.p2[1], 1.8, true); Sound.play('boss'); }
    e.summonCd -= dt; e.chargeCd -= dt;
    if (e.summonCd <= 0 && e.dash <= 0 && e.wind <= 0) {
      e.summonCd = e.phase === 2 ? BOSS.summonCd2 : BOSS.summonCd1;
      const room = CONFIG.maxLive ? Math.max(0, CONFIG.maxLive - alive(G.enemies).length) : 99;
      for (let i = 0; i < Math.min(room, e.phase === 2 ? BOSS.summon2 : BOSS.summon1); i++) { const s = makeEnemy('shade', G.wave); s.x = e.x + 40 + i * 22; G.enemies.push(s); }
      G.fx.push({ type: 'rift', x: e.x + 50, y: e.y, life: 1, dur: 0.9 });
    }
    // charging
    if (e.dashT > 0) {
      e.dashT -= dt; e.dash = 1; e.walk = true;
      const nx = Math.max(LANE.front + 60, e.x - BOSS.chargeSpeed * dt);
      let stopX = null;
      for (const a of A) if (a.x <= e.x && a.x >= nx - 30 && !a.hitByDash) {
        a.hitByDash = true; damage(a, e.atkV * BOSS.chargeMul, e);
        // chargeBlock: a standing heavy (盾兵・ゴーレム) takes the charge, holds its ground and stops it in front of itself
        const blocks = BOSS.chargeBlock && a.def.armor && !a.dead && a.hp > 0;
        if (blocks) stopX = Math.max(stopX == null ? -1e9 : stopX, a.x + 50);
        else a.x = Math.max(LANE.allySpawn - 20, a.x - BOSS.chargeKnock);
      }
      if (stopX != null) { e.x = Math.min(e.x, Math.max(nx, stopX)); e.dashT = 0; G.texts.push({ x: e.x - 60, y: e.y - 150, v: '受け止めた', life: 1.1, skill: true }); }
      else e.x = nx;
      if (e.dashT <= 0) { e.dash = 0; for (const a of A) a.hitByDash = false; G.shake = 0.3; }
      return;
    }
    if (e.phase === 2 && e.chargeCd <= 0 && e.wind <= 0) {
      e.chargeCd = BOSS.chargeCd; e.windT = BOSS.chargeWind; e.wind = 0.0001; e.windKind = 'charge';
    }
    // windup
    if (e.wind > 0) {
      e.windT -= dt; e.wind = Math.min(1, e.wind + dt / 0.8); e.walk = false;
      if (e.windT <= 0) {
        e.wind = 0;
        if (e.windKind === 'charge') { e.dashT = BOSS.chargeTime; Sound.play('boss'); }
        else {
          // slam
          e.atk = 1; G.shake = 0.35; Sound.play('slam');
          const sx = e.x - BOSS.slamOffset, sr = BOSS.slamRadius;
          G.fx.push({ type: 'shock', x: sx, y: e.y, life: 1, dur: 0.5, r: sr });
          for (const a of alive(G.allies)) if (Math.abs(a.x - sx) <= sr) { damage(a, e.atkV * BOSS.slamMul, e); a.x = Math.max(LANE.allySpawn - 20, a.x - 28); }
          if (sx - sr <= LANE.front) hitTower(e.atkV * BOSS.slamMul);
        }
      }
      return;
    }
    // approach / slam trigger
    // slam when anything is inside the slam zone, but keep walking until body contact so melee can reach it
    let near = false, touching = false;
    for (const a of A) { const dx = e.x - a.x; if (dx > -40) { if (dx <= d.range + 30) near = true; if (dx <= BOSS.contact) touching = true; } }
    const atTower = e.x - d.range <= LANE.front + 20;
    if ((near || atTower) && e.cool <= 0) { e.cool = d.rate; e.wind = 0.0001; e.windT = BOSS.slamWind; e.windKind = 'slam'; Sound.play('deny'); }
    else if (!touching && !atTower) { e.x -= d.speed * dt; e.walk = true; }
    else e.walk = false;
  }

  function hitTower(v) {
    G.hp -= v; G.towerFlash = 1; G.shake = Math.max(G.shake, 0.15);
    Sound.play('tower');
    G.texts.push({ x: Art.LH.x + 40 + rand(-10, 10), y: 420, v: Math.round(v), life: 0.9, tower: true });
  }

  // ---------------------------------------------------------------------
  //  Render
  // ---------------------------------------------------------------------
  let realT = 0;
  const PHONE_MQ = window.matchMedia('(max-height: 520px)');
  const PHONE = { get matches() { return PHONE_MQ.matches || document.documentElement.classList.contains('rot'); } };
  function render() {
    const k = renderK;
    ctx.setTransform(k, 0, 0, k, 0, 0);
    const shake = G && G.shake > 0 ? G.shake * 8 : 0;
    if (shake) ctx.translate(rand(-shake, shake), rand(-shake, shake) * 0.6);
    const t = G ? G.time : realT;
    Art.drawBackground(ctx, realT, k);
    const hpR = G ? G.hp / G.hpMax : 1;
    Art.drawLighthouse(ctx, realT, hpR, G ? G.towerFlash : 0, G ? G.lampBoost : 0);

    if (!G) { Art.drawCommander(ctx, LANE.commanderX, LANE.commanderY, realT, 0); return; }

    // ground effects (under units)
    for (const f of G.fx) {
      if (f.type === 'summon') Art.drawSummonCircle(ctx, f.x, f.y, t, f.life);
      if (f.type === 'mend') { ctx.save(); ctx.translate(f.x, f.y); ctx.scale(1, 0.26); ctx.strokeStyle = `rgba(200,140,240,${0.6 * f.life})`; ctx.lineWidth = 3; Art.circ(ctx, 0, 0, f.r * (1 - f.life * 0.6)); ctx.stroke(); ctx.restore(); }
      if (f.type === 'ring') { ctx.save(); ctx.translate(f.x, f.y - 50); ctx.strokeStyle = `rgba(230,200,255,${0.7 * f.life})`; ctx.lineWidth = 2; for (let i = 0; i < 3; i++) { const rr = (1 - f.life) * f.r * 0.7 + i * 14; ctx.beginPath(); ctx.arc(0, 0, rr, Math.PI * 0.75, Math.PI * 1.25); ctx.stroke(); ctx.beginPath(); ctx.arc(0, 0, rr, -Math.PI * 0.25, Math.PI * 0.25); ctx.stroke(); } ctx.restore(); }
      if (f.type === 'blast') { ctx.save(); ctx.globalCompositeOperation = 'lighter'; Art.glow(ctx, f.x, f.y - 24, f.r * (1.3 - f.life * 0.5), 'rgba(255,140,210,A)', f.life * 0.9); ctx.restore(); ctx.save(); ctx.translate(f.x, f.y); ctx.scale(1, 0.28); ctx.strokeStyle = `rgba(255,170,220,${f.life})`; ctx.lineWidth = 4; Art.circ(ctx, 0, 0, f.r * (1.1 - f.life * 0.5)); ctx.stroke(); ctx.restore(); }
      if (f.type === 'splat') { ctx.save(); ctx.globalAlpha = f.life; ctx.fillStyle = '#2a1448'; Art.circ(ctx, f.x, f.y, 7 * (1.4 - f.life * 0.4)); ctx.fill(); ctx.restore(); }
      if (f.type === 'aura') { ctx.save(); ctx.translate(f.x, f.y); ctx.scale(1, 0.26); ctx.strokeStyle = `rgba(255,240,200,${0.4 * f.life})`; ctx.lineWidth = 3; Art.circ(ctx, 0, 0, f.r * (1 - f.life * 0.3)); ctx.stroke(); ctx.restore(); }
      if (f.type === 'song') { ctx.save(); ctx.translate(f.x, f.y); ctx.scale(1, 0.26); ctx.strokeStyle = `rgba(255,226,150,${0.55 * f.life})`; ctx.lineWidth = 3; Art.circ(ctx, 0, 0, f.r * (1 - f.life * 0.55)); ctx.stroke(); ctx.restore(); }
      if (f.type === 'frost') { ctx.save(); ctx.translate(f.x, f.y); ctx.scale(1, 0.3); ctx.fillStyle = `rgba(170,235,255,${0.28 * f.life})`; Art.circ(ctx, 0, 0, f.r * (1.15 - f.life * 0.25)); ctx.fill(); ctx.restore(); }
      if (f.type === 'shock') { ctx.save(); ctx.translate(f.x, f.y); ctx.scale(1, 0.28); ctx.strokeStyle = f.ally ? `rgba(180,230,200,${f.life})` : `rgba(255,150,190,${f.life})`; ctx.lineWidth = 6; Art.circ(ctx, 0, 0, f.r * (1.2 - f.life * 0.6)); ctx.stroke(); ctx.restore(); }
      if (f.type === 'dash') { ctx.save(); ctx.globalCompositeOperation = 'lighter'; const gr = ctx.createLinearGradient(f.x, 0, f.x2, 0); gr.addColorStop(0, `rgba(255,170,240,${0.7 * f.life})`); gr.addColorStop(1, 'rgba(196,139,240,0)'); ctx.fillStyle = gr; for (let i = 0; i < 3; i++) ctx.fillRect(f.x, f.y - 14 - i * 9, (f.x2 - f.x) * (0.6 + i * 0.2), 2.5); ctx.restore(); }
      if (f.type === 'rift') { ctx.save(); ctx.globalAlpha = f.life; Art.glow(ctx, f.x, f.y - 30, 60, 'rgba(160,60,220,A)', 0.7); ctx.restore(); }
    }
    // boss telegraph
    const b = G.bossRef;
    drawHazards();
    if (b && !b.dead && b.wind > 0 && b.def.ai === 'hero') {
      if (b.windKind === 'slam') Art.drawTelegraph(ctx, b.x - BOSS.slamOffset, b.y, BOSS.slamRadius, b.wind);
      else { ctx.save(); ctx.fillStyle = `rgba(255,90,140,${0.15 + b.wind * 0.25})`; ctx.fillRect(b.x - 340, b.y - 12, 340, 24); ctx.restore(); }
    }

    // units sorted by depth
    const all = G.allies.concat(G.enemies).sort((a, b2) => a.y - b2.y);
    Art.drawCommander(ctx, LANE.commanderX, LANE.commanderY, realT, G.cast);
    for (const u of all) {
      const alpha = u.dead ? Math.max(0, 1 - u.dead / (u.boss ? 1.6 : 0.6)) : 1;
      const lift = u.dead ? u.dead * 30 : 0;
      // flyers glide FLY_H above the lane with a soft bob; their shadow stays on the ground
      const air = u.fly ? flyH(u) + Math.sin(u.anim * 2.2 + u.id) * 6 : (u.jumpH || 0);
      const uy = u.y - lift - air;
      if (u.fly && !u.dead) { ctx.save(); ctx.globalAlpha = 0.35; ctx.fillStyle = '#05081a'; Art.ell(ctx, u.x, u.y, 18, 4); ctx.fill(); ctx.restore(); }
      if (!u.dead && u.halfT > G.time) Art.glow(ctx, u.x, uy - 40, 46, 'rgba(160,205,255,A)', 0.5); // かばう背中 / 病室の約束
      if (!u.dead && (u.invul > 0 || u.blessT > 0)) Art.glow(ctx, u.x, uy - 34, 40, u.invul > 0 ? 'rgba(200,235,255,A)' : 'rgba(255,220,140,A)', 0.45);
      if (!u.dead && u.burnT > 0 && !u.hidden) Art.glow(ctx, u.x, uy - 30, 26, 'rgba(255,130,60,A)', 0.35);
      if (!u.dead && !u.hidden && (u.frozenT > 0 || u.slowT > 0)) Art.glow(ctx, u.x, uy - 30, u.frozenT > 0 ? 40 : 30, 'rgba(160,230,255,A)', u.frozenT > 0 ? 0.6 : 0.3);
      if (!u.dead && u.dazeT > 0) Art.glow(ctx, u.x, uy - 60, 18, 'rgba(200,160,255,A)', 0.5);
      if (u.jumpH > 0 && !u.dead) { ctx.save(); ctx.globalAlpha = 0.3; ctx.fillStyle = '#05081a'; Art.ell(ctx, u.x, u.y, 14, 3.5); ctx.fill(); ctx.restore(); }
      // (a kind without its own sprite yet falls back to a stand-in so the game never breaks)
      const want = u.toyT > 0 ? 'toy' : u.kind; // 異端の魔女のおもちゃの魔法: the resident is drawn as a little toy
      const dk = Art.KINDS.includes(want) ? want : u.toyT > 0 ? 'doll' : u.boss ? 'boss' : 'shade';
      Art.drawUnit(ctx, dk, u.x, uy, u.side === 'ally' ? (u.face || 1) : -1, u, { alpha: dk !== u.kind && u.hidden ? alpha * 0.15 : alpha, enemy: u.side === 'enemy', elite: u.elite, scale: (u.elite ? 1.2 : 1) * (dk !== u.kind && !u.boss ? 0.7 : 1) * growView(u), noShadow: !!u.fly || u.jumpH > 0 || u.hidden });
      // 灯を喰らうもの: a translucent ghost of the boss whose memory it wears
      if (u.form && !u.dead && Art.KINDS.includes(u.form)) Art.drawUnit(ctx, u.form, u.x - 40, uy - (ENEMIES[u.form].flying ? 40 : 0), -1, { anim: u.anim, walk: false, atk: 0, hurt: 0, wind: 0, phase: 2, hp: 1, maxHp: 1, reveal: 1, fly: !!ENEMIES[u.form].flying, stance: u.stance }, { alpha: alpha * 0.42, enemy: true, noShadow: true });
      // ハンターの印: a small amber diamond over a marked enemy
      if (!u.dead && u.markT > G.time) {
        const my = u.boss ? uy - 250 : uy - (TALL[u.kind] || 70) * (Art.SIZE[u.kind] || 1) * (u.elite ? 1.2 : 1) - 12, ma = Math.min(1, (u.markT - G.time) * 2);
        ctx.save(); ctx.globalAlpha = 0.9 * ma; ctx.fillStyle = '#ffcf6e'; ctx.strokeStyle = 'rgba(5,8,26,.8)'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(u.x, my - 6); ctx.lineTo(u.x + 5, my); ctx.lineTo(u.x, my + 6); ctx.lineTo(u.x - 5, my); ctx.closePath(); ctx.stroke(); ctx.fill(); ctx.restore();
      }
      if (!u.dead && u.frozenT > 0 && !u.hidden) { ctx.save(); ctx.globalAlpha = 0.35; ctx.fillStyle = '#d9f6ff'; Art.rr(ctx, u.x - 18, uy - 62 * (Art.SIZE[u.kind] || 1), 36, 60 * (Art.SIZE[u.kind] || 1), 8); ctx.fill(); ctx.restore(); }
      if (!u.dead && !G.paused && u.songV > 0 && ((realT * 2 + u.id * 0.37) % 1) < 0.08) G.fx.push({ type: 'note', x: u.x + rand(-8, 8), y: u.y - 70, life: 1, dur: 0.9 });
      if (!u.dead && u.hp < u.maxHp && !u.boss && !u.hidden) {
        const w = u.kind === 'armor' || u.elite ? 40 : u.kind === 'swarm' ? 20 : 30, top = uy - (TALL[u.kind] || 70) * (Art.SIZE[u.kind] || 1) * (u.elite ? 1.2 : 1) * growView(u);
        ctx.fillStyle = 'rgba(5,8,26,.75)'; ctx.fillRect(u.x - w / 2, top, w, 4);
        ctx.fillStyle = u.side === 'ally' ? '#8fd6ff' : '#e58cf0';
        ctx.fillRect(u.x - w / 2, top, w * (u.hp / u.maxHp), 4);
      }
      // 固有能力の数え: small dots over the resident; all lit = the next one is the special one
      const I = u.side === 'ally' && !u.dead && !(u.toyT > 0) && INNATE[u.kind];
      if (I && I.pips) {
        const n = Math.min(I.pips, u.pipN || 0), full = n >= I.pips, gap = I.pips > 5 ? 5 : 6;
        const py = uy - (TALL[u.kind] || 70) * (Art.SIZE[u.kind] || 1) * growView(u) - 9, px = u.x - (I.pips - 1) * gap / 2;
        if (full) Art.glow(ctx, u.x, py, 14 + I.pips * 2, 'rgba(255,220,140,A)', 0.55 + 0.25 * Math.sin(realT * 8));
        ctx.save();
        for (let i = 0; i < I.pips; i++) {
          ctx.fillStyle = i < n ? (full ? '#fff1c4' : '#ffd27a') : 'rgba(10,14,34,.55)';
          ctx.strokeStyle = 'rgba(5,8,26,.7)'; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.arc(px + i * gap, py, 2, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        }
        ctx.restore();
      }
    }

    drawFalling();
    // 記憶のかけら: rises from where the boss vanished, then drifts to the commander
    for (const sh of G.shards) {
      const t = sh.t, up = Math.min(1, t / 0.9), fly = Math.max(0, Math.min(1, (t - 1.1) / 1.2)), e = fly * fly * (3 - 2 * fly);
      const x0 = sh.x, y0 = sh.y - 60 * up, tx = LANE.commanderX + 6, ty = LANE.commanderY - 70;
      const x = x0 + (tx - x0) * e, y = y0 + (ty - y0) * e - Math.sin(e * Math.PI) * 120, a = t > 2.3 ? Math.max(0, (2.6 - t) / 0.3) : Math.min(1, t * 3);
      Art.glow(ctx, x, y, 34, 'rgba(190,225,255,A)', 0.7 * a);
      ctx.save(); ctx.translate(x, y); ctx.rotate(t * 1.8); ctx.globalAlpha = a;
      ctx.fillStyle = '#eaf6ff'; ctx.strokeStyle = 'rgba(120,180,255,.9)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(0, -13); ctx.lineTo(7, -2); ctx.lineTo(3, 12); ctx.lineTo(-6, 4); ctx.lineTo(-5, -6); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.restore();
    }
    // projectiles
    for (const s of G.shots) {
      if (s.t < 0) continue;
      if (s.kind === 'arrow') {
        const ang = Math.atan2(s.y - (s.py == null ? s.y : s.py), s.x - (s.px == null ? s.x - 1 : s.px));
        ctx.save(); ctx.translate(s.x, s.y); ctx.rotate(ang);
        ctx.strokeStyle = '#f2f6ff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-12, 0); ctx.lineTo(6, 0); ctx.stroke();
        ctx.fillStyle = '#cfe9ff'; ctx.beginPath(); ctx.moveTo(8, 0); ctx.lineTo(3, -3); ctx.lineTo(3, 3); ctx.fill();
        ctx.restore();
      } else if (s.kind === 'bomb' && s.small) { // 三連発: a small firework shell with a coloured trail
        const col = ['255,150,200', '150,220,255', '200,255,150'][Math.floor(s.arc) % 3];
        ctx.save(); ctx.fillStyle = '#2a2236'; Art.circ(ctx, s.x, s.y, 4); ctx.fill(); ctx.restore(); Art.glow(ctx, s.x, s.y, 12, `rgba(${col},A)`, 0.9);
      } else if (s.kind === 'bomb') {
        ctx.save(); ctx.translate(s.x, s.y); ctx.rotate(s.t * 8);
        ctx.fillStyle = '#2a2236'; Art.circ(ctx, 0, 0, 6.5); ctx.fill(); ctx.strokeStyle = '#e8b06a'; ctx.lineWidth = 1.5; Art.circ(ctx, 0, 0, 6.5); ctx.stroke();
        ctx.restore(); Art.glow(ctx, s.x + 4, s.y - 7, 10, 'rgba(255,200,110,A)', 0.9);
      } else if (s.kind === 'bullet' && s.balloon) { // とっておきの一発: a water balloon
        ctx.save(); ctx.fillStyle = 'rgba(120,190,255,.9)'; Art.ell(ctx, s.x, s.y, 6, 5); ctx.fill(); ctx.fillStyle = 'rgba(230,245,255,.9)'; Art.circ(ctx, s.x - 2, s.y - 2, 1.6); ctx.fill(); ctx.restore();
      } else if (s.kind === 'bullet') {
        ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.strokeStyle = 'rgba(255,236,190,.95)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(s.x - 9 * Math.sign(s.tx - s.x0 || 1), s.y); ctx.lineTo(s.x, s.y); ctx.stroke(); ctx.restore();
      } else if (s.kind === 'quarrel') {
        const dir = Math.sign(s.tx - s.x0) || 1;
        ctx.save(); ctx.strokeStyle = '#f4ead8'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(s.x - 22 * dir, s.y); ctx.lineTo(s.x, s.y); ctx.stroke();
        ctx.fillStyle = '#d9e4f2'; ctx.beginPath(); ctx.moveTo(s.x + 6 * dir, s.y); ctx.lineTo(s.x, s.y - 4); ctx.lineTo(s.x, s.y + 4); ctx.fill();
        ctx.globalCompositeOperation = 'lighter'; ctx.strokeStyle = 'rgba(255,240,210,.35)'; ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(s.x0, s.y0); ctx.lineTo(s.x, s.y); ctx.stroke(); ctx.restore();
      } else if (s.kind === 'gear') {
        Art.glow(ctx, s.x, s.y, 10, 'rgba(255,210,130,A)', 0.7); ctx.fillStyle = '#ffe2a8'; Art.circ(ctx, s.x, s.y, 3); ctx.fill();
      } else if (s.kind === 'snipe') {
        ctx.save(); ctx.globalCompositeOperation = 'lighter';
        const gr = ctx.createLinearGradient(s.x0, s.y0, s.x, s.y); gr.addColorStop(0, 'rgba(255,230,170,0)'); gr.addColorStop(1, 'rgba(255,240,200,.95)');
        ctx.strokeStyle = gr; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(s.x0, s.y0); ctx.lineTo(s.x, s.y); ctx.stroke();
        ctx.fillStyle = '#fff6e0'; Art.circ(ctx, s.x, s.y, 3); ctx.fill();
        ctx.restore();
      } else if (s.kind === 'ball') {
        // 最後の打者: a hit-back ball
        Art.glow(ctx, s.x, s.y, 16, 'rgba(255,200,230,A)', 0.6);
        ctx.fillStyle = '#efe6dc'; Art.circ(ctx, s.x, s.y, 5); ctx.fill();
        ctx.strokeStyle = '#b04a5a'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(s.x - 2, s.y, 3.6, -1, 1); ctx.stroke(); ctx.beginPath(); ctx.arc(s.x + 2, s.y, 3.6, Math.PI - 1, Math.PI + 1); ctx.stroke();
      } else if (s.kind === 'heart') {
        // 異端の魔女: a heart-shaped shot
        Art.glow(ctx, s.x, s.y, 16, 'rgba(255,150,210,A)', 0.55);
        ctx.fillStyle = '#ffb3d9'; ctx.strokeStyle = 'rgba(60,10,40,.8)'; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(s.x, s.y + 6); ctx.bezierCurveTo(s.x - 9, s.y - 1, s.x - 5, s.y - 8, s.x, s.y - 3); ctx.bezierCurveTo(s.x + 5, s.y - 8, s.x + 9, s.y - 1, s.x, s.y + 6); ctx.fill(); ctx.stroke();
      } else if (s.kind === 'letter') {
        // 忘却を運ぶ郵便屋: a letter that seals
        ctx.save(); ctx.translate(s.x, s.y); ctx.rotate(Math.sin(s.t * 14) * 0.4);
        ctx.fillStyle = '#efe4d2'; ctx.fillRect(-7, -5, 14, 10); ctx.strokeStyle = 'rgba(40,20,50,.9)'; ctx.lineWidth = 1.2; ctx.strokeRect(-7, -5, 14, 10);
        ctx.beginPath(); ctx.moveTo(-7, -5); ctx.lineTo(0, 1); ctx.lineTo(7, -5); ctx.stroke(); ctx.fillStyle = '#b8505e'; Art.circ(ctx, 0, 1, 1.8); ctx.fill();
        ctx.restore();
      } else if (s.kind === 'bubble') {
        // 深海の歌姫: a sleepy bubble
        Art.glow(ctx, s.x, s.y, 16, 'rgba(150,220,230,A)', 0.45);
        ctx.strokeStyle = 'rgba(200,245,250,.85)'; ctx.lineWidth = 1.5; Art.circ(ctx, s.x, s.y, 7); ctx.stroke();
        ctx.fillStyle = 'rgba(230,255,255,.8)'; Art.circ(ctx, s.x - 2.5, s.y - 2.5, 1.6); ctx.fill();
      } else if (s.kind === 'ink') {
        Art.glow(ctx, s.x, s.y, 14, 'rgba(196,139,240,A)', 0.6);
        ctx.fillStyle = '#1a0c30'; Art.circ(ctx, s.x, s.y, 4.5); ctx.fill();
        ctx.strokeStyle = 'rgba(229,140,240,.8)'; ctx.lineWidth = 1.2; Art.circ(ctx, s.x, s.y, 4.5); ctx.stroke();
      } else if (s.kind === 'ice') {
        Art.glow(ctx, s.x, s.y, 18, 'rgba(150,230,255,A)', 0.8);
        ctx.save(); ctx.translate(s.x, s.y); ctx.rotate(realT * 9);
        ctx.fillStyle = '#eafcff'; ctx.beginPath(); ctx.moveTo(0, -7); ctx.lineTo(4, 0); ctx.lineTo(0, 7); ctx.lineTo(-4, 0); ctx.closePath(); ctx.fill();
        ctx.restore();
      } else {
        Art.glow(ctx, s.x, s.y, 22, 'rgba(255,160,90,A)', 0.8);
        ctx.fillStyle = '#fff1d6'; Art.circ(ctx, s.x, s.y, 5); ctx.fill();
      }
    }
    // explosions / heals
    for (const f of G.fx) {
      if (f.type === 'boom') {
        ctx.save(); ctx.globalCompositeOperation = 'lighter';
        Art.glow(ctx, f.x, f.y - 20, f.r * (1.3 - f.life * 0.5), f.color ? `rgba(${f.color},A)` : 'rgba(255,150,80,A)', f.life * 0.8);
        ctx.restore();
      } else if (f.type === 'heal') {
        ctx.save(); ctx.globalCompositeOperation = 'lighter';
        Art.glow(ctx, f.x, f.y - 30, 34, 'rgba(150,255,200,A)', f.life * 0.6);
        ctx.strokeStyle = `rgba(190,255,220,${f.life})`; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(f.x, f.y - 50 - (1 - f.life) * 20); ctx.lineTo(f.x, f.y - 40 - (1 - f.life) * 20); ctx.moveTo(f.x - 5, f.y - 45 - (1 - f.life) * 20); ctx.lineTo(f.x + 5, f.y - 45 - (1 - f.life) * 20); ctx.stroke();
        ctx.restore();
      } else if (f.type === 'thrust') {
        ctx.save(); ctx.globalCompositeOperation = 'lighter';
        const gr = ctx.createLinearGradient(f.x, 0, f.x2, 0); gr.addColorStop(0, 'rgba(255,240,210,0)'); gr.addColorStop(1, `rgba(255,240,210,${0.8 * f.life})`);
        ctx.fillStyle = gr; ctx.fillRect(f.x, f.y - 1.5, f.x2 - f.x, 3);
        ctx.restore();
      } else if (f.type === 'note') {
        ctx.save(); ctx.globalAlpha = Math.min(1, f.life * 1.5); ctx.fillStyle = '#ffe6a0';
        const ny = f.y - (1 - f.life) * 24;
        Art.ell(ctx, f.x, ny, 3.4, 2.6, -0.4); ctx.fill(); ctx.fillRect(f.x + 2.4, ny - 10, 1.4, 10);
        ctx.restore();
      } else if (f.type === 'bolt') {
        // jagged lightning through every chained enemy (re-jittered a few times while it fades)
        ctx.save(); ctx.globalCompositeOperation = 'lighter';
        let sd = f.seed + Math.floor((1 - f.life) * 4) * 17;
        const rnd = () => { sd = (sd * 9301 + 49297) % 233280; return sd / 233280; };
        for (let pass = 0; pass < 2; pass++) {
          ctx.strokeStyle = pass ? `rgba(255,250,220,${f.life})` : `rgba(255,214,90,${0.55 * f.life})`;
          ctx.lineWidth = pass ? 1.6 : 5; ctx.beginPath();
          for (let i = 0; i < f.pts.length - 1; i++) {
            const p = f.pts[i], q = f.pts[i + 1];
            if (i === 0) ctx.moveTo(p.x, p.y);
            const segs = 5;
            for (let j = 1; j <= segs; j++) { const tt = j / segs; ctx.lineTo(p.x + (q.x - p.x) * tt + (j < segs ? (rnd() - 0.5) * 18 : 0), p.y + (q.y - p.y) * tt + (j < segs ? (rnd() - 0.5) * 18 : 0)); }
          }
          ctx.stroke();
        }
        for (let i = 1; i < f.pts.length; i++) Art.glow(ctx, f.pts[i].x, f.pts[i].y, 22, 'rgba(255,220,110,A)', 0.6 * f.life);
        ctx.restore();
      } else if (f.type === 'slash') {
        ctx.save(); ctx.globalCompositeOperation = 'lighter';
        if (f.snipe) { Art.glow(ctx, f.x, f.y - 30, 26, 'rgba(255,230,170,A)', f.life * 0.8); }
        else {
          if (f.big) { Art.glow(ctx, f.x, f.y, 40, 'rgba(255,236,170,A)', f.life * 0.8); ctx.strokeStyle = `rgba(255,240,200,${f.life})`; ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(f.x, f.y, 34 + (1 - f.life) * 10, Math.PI * 0.8, Math.PI * 1.6); ctx.stroke(); }
          ctx.strokeStyle = `rgba(255,190,140,${f.life})`; ctx.lineWidth = 3;
          ctx.beginPath(); ctx.arc(f.x, f.y, 26 + (1 - f.life) * 8, Math.PI * 0.85, Math.PI * 1.55); ctx.stroke();
          ctx.strokeStyle = `rgba(255,245,230,${f.life})`; ctx.lineWidth = 1.4;
          ctx.beginPath(); ctx.arc(f.x + 4, f.y - 2, 22 + (1 - f.life) * 8, Math.PI * 0.9, Math.PI * 1.5); ctx.stroke();
        }
        ctx.restore();
      } else if (f.type === 'smoke') {
        ctx.save(); ctx.globalAlpha = 0.5 * f.life; ctx.fillStyle = '#c9c4d6';
        for (let i = 0; i < 5; i++) { const ang = i * 1.26 + f.x; Art.circ(ctx, f.x + Math.cos(ang) * (14 + (1 - f.life) * 20), f.y - 24 + Math.sin(ang) * 8 - (1 - f.life) * 16, 12 + (1 - f.life) * 10); ctx.fill(); }
        ctx.restore();
      } else if (f.type === 'burst') {
        ctx.save(); ctx.globalCompositeOperation = 'lighter';
        Art.glow(ctx, f.x, f.y, 260 * (1.2 - f.life * 0.4), 'rgba(220,180,255,A)', f.life * 0.9);
        ctx.restore();
      }
    }
    // particles
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (const m of G.motes) {
      if (m.kind === 'dream') { if (m.delay > 0 && m.delay > 0.3) continue; Art.glow(ctx, m.x, m.y, 9, 'rgba(150,220,255,A)', 0.8); ctx.fillStyle = '#e6f7ff'; ctx.fillRect(m.x - 1, m.y - 1, 2, 2); }
      else { ctx.fillStyle = `rgba(${m.color},${clamp(m.life / m.max, 0, 1)})`; ctx.fillRect(m.x - 1.2, m.y - 1.2, 2.4, 2.4); }
    }
    ctx.restore();
    // 終幕の踊り子: the curtain falls between acts
    if (G.curtain > 0) {
      const C = ENEMIES.dancer.curtain.time, c = G.curtain, close = clamp(Math.min(C - c, c) / 0.6, 0, 1), w = 660 * close;
      ctx.save(); ctx.globalAlpha = 0.78;
      for (const side of [0, 1]) {
        const x0 = side ? 1280 - w : 0;
        const gr = ctx.createLinearGradient(x0, 0, x0 + w, 0); gr.addColorStop(0, '#3a0c1e'); gr.addColorStop(0.5, '#6e1a32'); gr.addColorStop(1, '#3a0c1e');
        ctx.fillStyle = gr; ctx.fillRect(x0, 0, w, 720);
        ctx.strokeStyle = 'rgba(20,4,12,.5)'; ctx.lineWidth = 3; ctx.beginPath(); for (let x = x0 + 24; x < x0 + w; x += 48) { ctx.moveTo(x, 0); ctx.lineTo(x, 720); } ctx.stroke();
      }
      ctx.restore();
    }
    // floating numbers
    ctx.textAlign = 'center';
    for (const tx of G.texts) {
      ctx.globalAlpha = clamp(tx.life / 0.5, 0, 1);
      ctx.font = `700 ${tx.tower ? 20 : tx.crit || tx.skill ? 19 : 15}px "Zen Kaku Gothic New", sans-serif`;
      ctx.fillStyle = tx.heal ? '#a8ffd2' : tx.tower ? '#ff8aa2' : tx.crit ? '#ffe08a' : tx.skill ? '#cfeaff' : tx.enemy ? '#fff2f8' : '#ffc4cf';
      ctx.strokeStyle = 'rgba(5,8,26,.85)'; ctx.lineWidth = 3;
      ctx.strokeText(tx.v, tx.x, tx.y); ctx.fillText(tx.v, tx.x, tx.y);
    }
    ctx.globalAlpha = 1;

    // boss HP bar (canvas, top-center under the wave label)
    if (b && !b.dead) {
      const w = 520, x = 640 - w / 2, y = PHONE.matches ? 112 : 84; // phones: below the larger wave label
      ctx.fillStyle = 'rgba(5,8,26,.78)'; Art.rr(ctx, x - 4, y - 4, w + 8, 20, 6); ctx.fill();
      const gr = ctx.createLinearGradient(x, 0, x + w, 0); gr.addColorStop(0, '#7a3fb0'); gr.addColorStop(1, '#e58cf0');
      ctx.fillStyle = gr; ctx.fillRect(x, y, w * (b.hp / b.maxHp), 12);
      ctx.strokeStyle = 'rgba(229,140,240,.6)'; ctx.lineWidth = 1; ctx.strokeRect(x, y, w, 12);
      ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.beginPath(); ctx.moveTo(x + w / 2, y); ctx.lineTo(x + w / 2, y + 12); ctx.stroke();
      ctx.font = '700 15px "Shippori Mincho B1", serif'; ctx.fillStyle = '#f3dcff'; ctx.textAlign = 'center';
      ctx.fillText(tierOf(G.wave) > 1 ? `${b.def.name}（第${tierOf(G.wave)}階層）` : b.def.name, 640, y + 34);
    }
  }

  // ---------------------------------------------------------------------
  //  HUD
  // ---------------------------------------------------------------------
  const cardEls = {};
  function buildCards() {
    ui.cards.innerHTML = '';
    for (const k in cardEls) delete cardEls[k];
    DECK.forEach((k, i) => {
      const d = UNITS[k];
      const b = document.createElement('button');
      b.className = 'card'; b.id = 'card-' + k; b.setAttribute('aria-label', `${d.name} 召喚 コスト${d.cost}`);
      b.innerHTML = `<canvas></canvas><canvas class="cd"></canvas><span class="cost">${d.cost}</span><span class="key">${i + 1}</span><span class="why"></span><span class="nm${(d.short || d.name).length >= 6 ? ' long' : ''}">${d.short || d.name}</span>`;
      const [art, cd] = b.querySelectorAll('canvas');
      Art.drawCardArt(art, k);
      cd.width = 112; cd.height = 112;
      b.addEventListener('pointerdown', (ev) => { ev.preventDefault(); summon(k); });
      b.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); summon(k); } });
      ui.cards.appendChild(b);
      const ab = document.createElement('span'); ab.className = 'abil'; b.appendChild(ab);
      const bl = document.createElement('span'); bl.className = 'bl'; b.appendChild(bl);
      cardEls[k] = { el: b, cd: cd.getContext('2d'), why: b.querySelector('.why'), abil: ab, bl, cost: b.querySelector('.cost'), last: '' };
    });
    ui.pips.innerHTML = '';
    for (let i = 0; i < CONFIG.energyMax; i++) { const p = document.createElement('div'); p.className = 'pip'; p.innerHTML = '<i></i>'; ui.pips.appendChild(p); }
    builtDeck = DECK.join();
  }
  let builtDeck = '';
  function flashCard(k) { const c = cardEls[k]; if (!c) return; c.el.animate([{ transform: 'translateX(-4px)' }, { transform: 'translateX(4px)' }, { transform: 'translateX(0)' }], { duration: 160 }); }

  let hudLast = {};
  function updateHUD() {
    if (!G) return;
    const hp = Math.max(0, Math.ceil(G.hp));
    if (hudLast.hp !== hp) { ui.hpText.textContent = `${hp} / ${G.hpMax}`; ui.hpFill.style.width = (hp / G.hpMax * 100) + '%'; ui.hpBar.classList.toggle('low', hp / G.hpMax < 0.3); hudLast.hp = hp; }
    const wv = Math.max(1, G.wave);
    if (G.scripted) {
      const n = G.spawnQueue.length + G.enemies.filter((e) => !e.dead).length, lt = n > 0 ? `残りのナイトメア ${n}` : '';
      if (hudLast.wave !== 'tut') { ui.waveText.innerHTML = 'チュートリアル'; hudLast.wave = 'tut'; }
      if (hudLast.left !== lt) { ui.leftText.textContent = lt; hudLast.left = lt; }
      ui.waveFill.style.width = ((G.tutStep || 0) * 100).toFixed(1) + '%';
    } else {
    if (hudLast.wave !== wv) { ui.waveText.innerHTML = `WAVE ${wv} <small>/ ${CONFIG.totalWaves}</small>`; hudLast.wave = wv; }
    const left = G.wave === 0 ? 0 : G.spawnQueue.length + G.enemies.filter((e) => !e.dead).length;
    const leftTxt = `第${tierOf(wv)}階層・` + (G.wave === 0 ? '準備中' : left > 0 ? `残りのナイトメア ${left}` : (G.wave < CONFIG.totalWaves ? '次のウェーブまで小休止' : ''));
    if (hudLast.left !== leftTxt) { ui.leftText.textContent = leftTxt; hudLast.left = leftTxt; }
    const wp = G.wave === 0 ? 1 - G.prep / CONFIG.prepTime : isBossWave(G.wave) ? 1 : Math.min(1, G.waveTime / waveLen(G.wave));
    ui.waveFill.style.width = (wp * 100).toFixed(1) + '%';
    }
    if (hudLast.kills !== G.kills) { ui.killText.textContent = G.kills; hudLast.kills = G.kills; }
    const army = armyN(); // 出撃中の住人（砲台・人形は数えない。夢鯨に呑まれている住人は数える）
    if (hudLast.army !== army) { const el = $('armyText'); el.innerHTML = `出撃 <b>${army}</b> / ${CONFIG.allyCap}`; el.classList.toggle('full', army >= CONFIG.allyCap); hudLast.army = army; }
    const en = Math.floor(G.energy); if (hudLast.en !== en) { ui.enNum.textContent = en; hudLast.en = en; }
    const dw = G.drainWarn > 0; if (hudLast.dw !== dw) { ui.pips.classList.toggle('drain', dw); hudLast.dw = dw; } // 灯を喰らうもの: the energy is about to be drained
    const pips = ui.pips.children;
    for (let i = 0; i < pips.length; i++) {
      const f = clamp(G.energy - i, 0, 1);
      pips[i].classList.toggle('full', f >= 1);
      pips[i].firstChild.style.width = (f * 100) + '%';
    }
    for (const k of DECK) {
      const c = cardEls[k], r = canSummon(k);
      const state = r === 'ok' || r === 'no' ? '' : r;
      const dis = r !== 'ok';
      const key = state + (dis ? 1 : 0) + (r === 'energy' ? Math.ceil(costOf(k) - G.energy) : '') + '|' + costOf(k);
      if (c.last !== key) {
        c.el.classList.toggle('disabled', dis);
        c.why.textContent = r === 'energy' ? `あと ${Math.ceil(costOf(k) - G.energy)}` : r === 'cap' ? '上限' : '';
        c.cost.textContent = costOf(k); c.cost.classList.toggle('down', costOf(k) < UNITS[k].cost);
        c.last = key;
      }
      // cooldown sweep
      const g = c.cd; g.clearRect(0, 0, 112, 112);
      const p = Math.min(1, G.cd[k] / (G.cdMax[k] || UNITS[k].cd));
      if (p > 0) {
        g.fillStyle = 'rgba(5,8,26,.62)'; g.beginPath(); g.moveTo(56, 56); g.arc(56, 56, 90, -Math.PI / 2, -Math.PI / 2 + p * Math.PI * 2); g.closePath(); g.fill();
        g.fillStyle = '#e9eefc'; g.font = '800 26px "Shippori Mincho B1", serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(G.cd[k].toFixed(1), 56, 54);
      }
    }
  }

  let bannerTimer = 0;
  function showBanner(big, sub, dur, boss) {
    ui.bannerBig.textContent = big; ui.bannerSub.textContent = sub || '';
    ui.bannerBig.classList.toggle('long', String(big).length > 15); // a long line (a boss's name + 「は光の粒となって消えた」) stays on one line
    ui.banner.classList.toggle('boss', !!boss); ui.banner.classList.add('show');
    bannerTimer = dur;
  }

  // ---------------------------------------------------------------------
  //  Flow: title / pause / result
  // ---------------------------------------------------------------------
  function show(el, v) { el.hidden = !v; }
  function refreshBest() { if (window.Menu) window.Menu.refresh(); }
  // small rarity dots on each battle card showing that character's abilities
  function refreshCardAbilities() {
    const s = Abilities.save;
    for (const k of DECK) {
      const c = cardEls[k]; if (!c) continue;
      const ch = s.chars[k];
      c.abil.innerHTML = ch.slots.slice(0, ch.open).filter(Boolean).map((x) => `<i class="dot r${x.r}"></i>`).join('');
    }
  }
  function fmtTime(s) { s = Math.floor(s); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }

  function startGame() {
    Sound.init(); Sound.play('click'); Sound.startMusic();
    loadDeck(); if (builtDeck !== DECK.join()) buildCards();
    newGame(); hudLast = {};
    show(ui.title, false); show(ui.result, false); show(ui.pause, false); show(ui.hud, true);
    show($('gachaScreen'), false); show($('recordScreen'), false);
    refreshCardAbilities(); refreshCardBless(); $('blessScreen').hidden = true;
    setSpeed(1);
  }
  // チュートリアル（tutorial.js が使う）: a scripted battle with a fixed deck; ends back at the title
  function startTutorialGame(deck) {
    Sound.init(); Sound.startMusic();
    if (deck && deck.length) { DECK.length = 0; DECK.push(...deck); }
    if (builtDeck !== DECK.join()) buildCards();
    newGame(); hudLast = {};
    G.scripted = true; G.wave = 1; G.prep = 0; G.energy = CONFIG.energyMax; G.tutStep = 0;
    ui.banner.classList.remove('show'); bannerTimer = 0;
    show(ui.title, false); show(ui.result, false); show(ui.pause, false); show(ui.hud, true);
    for (const id of ['gachaScreen', 'recordScreen', 'teamScreen', 'shopScreen']) show($(id), false);
    refreshCardAbilities(); refreshCardBless(); $('blessScreen').hidden = true;
    setSpeed(1);
    return G;
  }
  function tutSpawn(kind, n, gap) { for (let i = 0; i < (n || 1); i++) G.spawnQueue.push({ k: kind, t: G.waveTime + 0.2 + i * (gap || 1) }); G.spawnQueue.sort((a, b) => a.t - b.t); }
  function setPaused(v) {
    if (!G || G.mode !== 'play') return;
    G.paused = v; show(ui.pause, v);
    if (v) Sound.stopMusic(); else Sound.startMusic();
  }
  // battle speed ×1 / ×2 / ×3 (each battle starts at ×1)
  function setSpeed(v) {
    v = clamp(v | 0, 1, 3); if (G) G.speed = v;
    for (const b of ui.speedSeg.querySelectorAll('button')) { const on = +b.dataset.s === v; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); }
  }
  function toTitle(screen) {
    if (G && G.scripted && window.Tutorial) window.Tutorial.abort();
    G = null; show(ui.hud, false); show(ui.pause, false); show(ui.result, false); $('blessScreen').hidden = true;
    ui.banner.classList.remove('show'); Sound.stopMusic();
    window.Menu.show(typeof screen === 'string' ? screen : 'titleScreen');
  }
  function finish(outcome) {
    G.mode = 'over';
    Sound.stopMusic(); Sound.play(outcome === 'win' ? 'win' : 'lose');
    const win = outcome === 'win';
    const prevBest = Abilities.save.stats.best, prevWin = !!Abilities.save.stats.cleared;
    const rw = Abilities.grantRun({ wave: G.wave, kills: G.kills, win, bosses: G.bosses });
    const better = (win && !prevWin) || G.wave > prevBest;
    const tierLine = G.bosses > 0 && !win ? `第${G.bosses}階層までを突破した。` : '';
    $('resReward').innerHTML = `<div class="big"><i class="gem"></i>夢の結晶 +${rw.total.toLocaleString('ja-JP')}</div>` +
      `<div class="br">ウェーブ突破 ${rw.waves}　討伐 ${rw.kills}${rw.boss ? `　ボス撃破 ${rw.boss}` : ''}　／　所持 ${Math.floor(Abilities.save.crystals).toLocaleString('ja-JP')}</div>`;
    $('resultPanel').className = 'panel ' + (win ? 'win' : 'lose');
    $('resTitle').textContent = win ? '防衛成功' : '灯が消えた';
    $('resLead').textContent = win ? `第${CONFIG.totalWaves}ウェーブまで灯を守り抜いた。最後の主「${G.lastBossName || ENEMIES.boss.name}」は光の粒となって消え、その光は灯台へ吸い込まれていった。` : tierLine + 'ナイトメアが追憶の灯へ届いた。';
    const rows = [
      ['到達ウェーブ', `${G.wave} / ${CONFIG.totalWaves}`],
      ['討伐数', G.kills],
      ['召喚した住人', G.summoned],
      ['灯の祝福', G.blessings.length ? `${G.blessings.length}つ` : '―'],
      ['記憶のかけら', G.memRun ? `${G.memRun}つ` : '―'],
      ['経過時間', fmtTime(G.time)],
    ];
    $('resList').innerHTML = rows.map(([a, b], i) => `<dt>${a}</dt><dd>${b}${i === 0 && better ? '<span class="new">ベスト更新</span>' : ''}</dd>`).join('');
    show(ui.result, true);
    ui.banner.classList.remove('show');
  }

  $('startBtn').addEventListener('click', startGame);
  $('retryBtn').addEventListener('click', startGame);
  $('toTitleBtn').addEventListener('click', () => toTitle('titleScreen'));
  $('toGachaBtn').addEventListener('click', () => toTitle('gachaScreen'));
  $('resumeBtn').addEventListener('click', () => setPaused(false));
  $('quitBtn').addEventListener('click', () => toTitle('titleScreen'));
  $('pauseBtn').addEventListener('click', () => setPaused(!G.paused));
  for (const b of ui.speedSeg.querySelectorAll('button')) b.addEventListener('click', () => { if (G) { setSpeed(+b.dataset.s); Sound.play('click'); } });
  function applySound(v) { Sound.setEnabled(v); ui.soundBtn.classList.toggle('off', !v); ui.soundBtn.setAttribute('aria-pressed', String(v)); saveSetting('yume-sound', v); }
  ui.soundBtn.addEventListener('click', () => { Sound.init(); applySound(!Sound.enabled); });
  applySound(loadSetting('yume-sound', true));

  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    if (!G) { if ((e.key === 'Enter' || e.key === ' ') && !ui.title.hidden && document.activeElement === document.body) startGame(); return; }
    if (G.mode !== 'play') return;
    if (G.picking) { const n = parseInt(e.key, 10); if (n >= 1 && n <= 3) pickBlessing(n - 1); return; }
    if (e.key === 'Escape' || e.key === 'p' || e.key === 'P') { setPaused(!G.paused); return; }
    if (G.paused) return;
    const n = parseInt(e.key, 10);
    if (n >= 1 && n <= 5) summon(DECK[n - 1]);
    if (e.key === 'f' || e.key === 'F') setSpeed(G.speed % 3 + 1); // ×1 → ×2 → ×3 → ×1
    if (e.key === 'm' || e.key === 'M') { Sound.init(); applySound(!Sound.enabled); }
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden && G && G.mode === 'play' && !G.paused && !G.picking) setPaused(true); });

  // ---------------------------------------------------------------------
  //  Main loop
  // ---------------------------------------------------------------------
  let lastTs = 0;
  function frame(ts) {
    const dtReal = Math.min(0.05, (ts - (lastTs || ts)) / 1000);
    lastTs = ts; realT += dtReal;
    if (G && G.mode === 'play' && !G.paused && !G.picking) {
      const steps = G.hold ? 0 : G.speed; // (G.hold: the tutorial is explaining — time stands still, the HUD still updates)
      for (let i = 0; i < steps && G.mode === 'play'; i++) update(dtReal);
      if (G) updateHUD();
    }
    if (bannerTimer > 0 && !(G && G.paused)) { bannerTimer -= dtReal; if (bannerTimer <= 0) ui.banner.classList.remove('show'); }
    render();
    requestAnimationFrame(frame);
  }

  // test / QA hook (used by automated playtests; harmless in normal play)
  window.__yume = {
    INNATE,
    tutorial: { start: startTutorialGame, spawn: tutSpawn, banner: (a, b, d) => showBanner(a, b, d || 2.2), end: () => toTitle('titleScreen'), get renderK() { return renderK; } },
    get state() { return G; }, CONFIG, UNITS, ENEMIES, WAVES, DECK, BOSS, BOSSES, LANE, buildWave, waveBudget, tierOf, growth, rawBudget, forceBoss: null,
    start: startGame, startWave: (n) => startWave(n), summon, canSummon, toMenu: toTitle, BLESS, costOf, pick: (i) => pickBlessing(i), autoPick: null,
    step(dt) { if (!G || G.mode !== 'play') return; if (G.picking) pickBlessing(0); update(dt); },
  };

  Abilities.load(); loadDeck();
  buildCards(); fit();
  requestAnimationFrame(frame);
})();
