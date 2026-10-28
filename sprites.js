/* 手描きのコマ絵（スプライト）。ユーザーが用意した絵を切り抜いて1枚にまとめたもの（sprites/）。
   ここに登録した住人は、コードで描いた絵の代わりにコマ絵で動く。読み込めないときは今までの絵のまま。
   frames: コマ名 → [画像内のx, y, 幅, 高さ, 足元のx, 足元のy]（px: 1ユニットあたりの画像のpx） */
(() => {
  'use strict';
  if (!window.Art || !Art.useSprite) return;
  // 歩いているか（立ち位置を細かく直すときに歩き・待機が毎フレーム入れかわらないよう、少しだけ余韻を持たせる）
  const walking = (u) => { const t = u.anim || 0; if (u.walk) u.sprWalkT = t; return u.sprWalkT != null && t - u.sprWalkT < 0.2; };

  // 剣士（2026-10-27 ユーザー提供のコマ絵 3枚：待機・歩き／攻撃／固有能力「一歩前へ」）
  //   idle1〜4: 待機（4がずり落ちたバケツを直す）、idle5〜8: 歩き
  //   atk1〜4: 振りかぶり、atk5〜8: 振り下ろし→戻り、skill1〜8: 5回目の一撃（ページが舞う）
  const SWORD_SKILL_EVERY = 5;           // 固有能力の5回目（game.js の INNATE.swordsman.every と同じ）
  const SWORD = {
    src: 'sprites/swordsman.webp',
    px: 2.5,
    frames: {"idle1":[0,0,132,178,84.5,176.2],"idle2":[134,0,132,164,83.0,162.8],"idle3":[268,0,126,177,79.4,175.4],"idle4":[396,0,129,178,81.6,176.6],"idle5":[527,0,140,166,64.6,164.8],"idle6":[669,0,138,156,65.2,154.7],"idle7":[809,0,142,164,66.6,162.8],"idle8":[953,0,140,165,72.1,163.2],"atk1":[1095,0,133,175,58.3,173.1],"atk2":[1230,0,144,165,59.5,162.9],"atk3":[0,180,108,193,59.2,191.6],"atk4":[110,180,152,164,97.4,162.0],"atk5":[264,180,181,174,103.9,169.4],"atk6":[447,180,182,167,97.4,163.4],"atk7":[631,180,194,147,97.2,141.6],"atk8":[827,180,133,171,59.0,169.4],"skill1":[962,180,168,162,64.1,160.6],"skill2":[1132,180,168,171,69.9,168.0],"skill3":[0,375,163,196,81.7,193.9],"skill4":[165,375,176,179,113.4,177.3],"skill5":[343,375,190,163,97.0,160.6],"skill6":[535,375,197,177,96.5,170.3],"skill7":[734,375,194,133,95.6,131.0],"skill8":[930,375,161,163,63.0,160.6]},
    pick(u) {
      const mv = walking(u), t = u.anim || 0, at = u.atk || 0;
      // 振り下ろし（u.atk が 1 → 0 へ約0.33秒）: 5回目の一撃のときは u.innC が 0 に戻っている
      if (at > 0.01) {
        u.sprFight = t;
        const set = u.innC === 0 ? 'skill' : 'atk';
        return set + (at > 0.75 ? 5 : at > 0.5 ? 6 : at > 0.25 ? 7 : 8);
      }
      const fighting = !mv && u.sprFight != null && t - u.sprFight < 1.6;
      if (fighting) {
        // 振りかぶり: 次の攻撃までの残り時間（u.cool）で1〜4コマ目
        const skill = u.innC === SWORD_SKILL_EVERY - 1, W = skill ? 0.5 : 0.36;
        if (u.cool > 0 && u.cool <= W) return (skill ? 'skill' : 'atk') + Math.min(4, 1 + Math.floor((1 - u.cool / W) * 4));
        return skill ? 'skill1' : 'atk1';      // 構え（次が5回目なら剣が光っている）
      }
      if (mv) return 'idle' + (5 + Math.floor(t * 8) % 4);
      // 待機: ときどきバケツがずり落ちて、押し上げる
      const ph = (t + (u.id || 0) * 1.37) % 7;
      if (ph > 5.6) return 'idle' + [2, 2, 3, 3, 4, 4, 4][Math.min(6, Math.floor((ph - 5.6) / 0.2))];
      return 'idle1';
    },
  };
  Art.useSprite('swordsman', SWORD);

  // 盾兵（2026-10-27 ユーザー提供のコマ絵 3枚：待機・歩き／攻撃／固有能力「かばう背中」）
  //   idle1〜4: 待機（3でまばたき）、idle5〜8: 歩き
  //   atk1: 構え、atk2〜5: 木づちを振りかぶって振る、atk6: 当たる、atk7〜8: 戻る
  //   skill1〜4: 盾を地面に据えて踏ん張る、skill5〜8: 守っている間（窓の明かりが強い）
  const GUARD_HALF_T = 2.5;              // かばう背中の長さ（game.js の INNATE.guardian.t と同じ）
  const GUARD = {
    src: 'sprites/guardian.webp',
    px: 2.5,
    frames: {"skill1":[0,0,118,153,53.9,151.8],"skill2":[120,0,122,129,43.8,127.7],"skill3":[244,0,119,127,49.1,124.9],"skill4":[365,0,127,135,44.2,132.7],"skill5":[494,0,128,128,45.8,127.0],"skill6":[624,0,129,128,45.2,126.7],"skill7":[755,0,128,129,45.6,126.7],"skill8":[885,0,129,128,44.7,126.7],"idle1":[1016,0,120,164,56.9,161.8],"idle2":[1138,0,121,165,56.6,162.8],"idle3":[1261,0,120,160,55.2,157.2],"idle4":[0,167,120,164,56.9,162.1],"idle5":[122,167,123,158,49.8,154.7],"idle6":[247,167,122,155,58.2,152.9],"idle7":[371,167,123,158,49.7,155.0],"idle8":[496,167,119,157,49.0,154.0],"atk1":[617,167,117,148,55.3,146.9],"atk2":[736,167,126,134,53.7,132.0],"atk3":[864,167,118,155,48.4,152.9],"atk4":[984,167,118,159,48.6,156.5],"atk5":[1104,167,129,151,45.2,147.9],"atk6":[1235,167,126,138,47.0,135.9],"atk7":[0,333,119,156,48.2,153.6],"atk8":[121,333,117,149,55.3,146.9]},
    pick(u) {
      const mv = walking(u), t = u.anim || 0, at = u.atk || 0;
      // かばう背中: u.halfT が新しくなった瞬間から2.5秒
      if (u.halfT !== u.sprHalfK) {
        u.sprHalfK = u.halfT;
        // (again while still braced: stay braced instead of crouching once more)
        if (u.halfT) u.sprHalfS = u.sprHalfS != null && t - u.sprHalfS < GUARD_HALF_T ? t - 0.4 : t;
      }
      const e = u.sprHalfS != null ? t - u.sprHalfS : 99;
      if (e < GUARD_HALF_T) {
        u.sprFight = t;
        if (e < 0.4) return 'skill' + (1 + Math.floor(e / 0.1));
        return 'skill' + (5 + Math.floor((e - 0.4) * 6) % 4);
      }
      if (at > 0.01) { u.sprFight = t; return 'atk' + (at > 0.66 ? 6 : at > 0.33 ? 7 : 8); }
      if (!mv && u.sprFight != null && t - u.sprFight < 1.8) {
        const W = 0.45;
        if (u.cool > 0 && u.cool <= W) return 'atk' + Math.min(5, 2 + Math.floor((1 - u.cool / W) * 4));
        return 'atk1';
      }
      if (mv) return 'idle' + (5 + Math.floor(t * 6) % 4);   // 重い足取り
      const ph = (t + (u.id || 0) * 1.37) % 4.5;
      if (ph > 4.0) return 'idle' + [2, 3, 3, 4][Math.min(3, Math.floor((ph - 4.0) / 0.125))];
      return 'idle1';
    },
    // 守っている間: 背中から暖かい光（窓の明かりの色）
    under(ctx, u, name) {
      if (!/^skill[2-8]$/.test(name)) return;
      const e = (u.anim || 0) - (u.sprHalfS || 0), k = Math.min(1, e / 0.4) * Math.min(1, (GUARD_HALF_T - e) / 0.3);
      if (!(k > 0)) return;
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      Art.glow(ctx, 2, -30, 44 + Math.sin(e * 6) * 3, 'rgba(255,205,120,A)', 0.55 * k);
      Art.glow(ctx, 10, -24, 18, 'rgba(255,235,170,A)', 0.5 * k);
      ctx.restore();
    },
  };
  Art.useSprite('guardian', GUARD);

  // 槍兵（2026-10-27 ユーザー提供のコマ絵 3枚：待機・歩き／攻撃／固有能力「旗のもとに」）
  //   idle1〜4: 待機（2でまばたき、旗がなびく）、idle5〜8: 行進のような歩き
  //   atk1: 構え、atk2〜3: 引いて狙う、atk4〜5: 突く、atk6〜8: 戻る
  //   skill1〜8: すぐ前に近接の仲間がいるとき（u.rallyV）の突き。1〜4と5〜8で2回分、旗をはためかせて突く
  const SPEAR = {
    src: 'sprites/spearman.webp',
    px: 2.5,
    frames: {"skill1":[0,0,140,193,47.7,190.1],"skill2":[142,0,171,187,48.4,184.2],"skill3":[315,0,207,146,50.2,143.7],"skill4":[524,0,162,206,72.7,203.1],"skill5":[688,0,148,190,51.6,186.5],"skill6":[838,0,170,178,50.4,174.8],"skill7":[1010,0,207,157,53.6,154.5],"skill8":[1219,0,164,197,74.1,194.6],"idle1":[0,208,115,211,81.8,208.2],"idle2":[117,208,114,211,82.9,208.6],"idle3":[233,208,111,210,80.5,207.7],"idle4":[346,208,110,209,79.8,207.3],"idle5":[458,208,130,196,80.0,192.9],"idle6":[590,208,115,197,76.5,194.2],"idle7":[707,208,129,195,81.1,192.9],"idle8":[838,208,113,196,76.3,193.7],"atk1":[953,208,144,200,54.7,197.0],"atk2":[1099,208,167,140,51.5,136.3],"atk3":[0,421,171,136,53.5,133.5],"atk4":[173,421,172,134,43.6,131.2],"atk5":[347,421,178,132,42.4,128.9],"atk6":[527,421,172,156,51.7,153.4],"atk7":[701,421,163,148,45.9,145.6],"atk8":[866,421,144,202,54.0,198.4]},
    pick(u) {
      const mv = walking(u), t = u.anim || 0, at = u.atk || 0, rally = (u.rallyV || 0) > 0;
      if (at > 0.01) {
        if (!u.sprHit) { u.sprHit = true; u.sprAlt = !u.sprAlt; }   // 1回ごとに前半・後半を入れかえる
        u.sprFight = t;
        if (rally) return 'skill' + ((u.sprAlt ? 4 : 0) + (at > 0.5 ? 3 : 4));
        return 'atk' + (at > 0.8 ? 4 : at > 0.6 ? 5 : at > 0.4 ? 6 : at > 0.2 ? 7 : 8);
      }
      u.sprHit = false;
      if (!mv && u.sprFight != null && t - u.sprFight < 1.8) {
        const next = u.sprAlt ? 0 : 4;               // 次の突きが使う側
        if (rally) {
          const W = 0.3;
          if (u.cool > 0 && u.cool <= W) return 'skill' + (next + (u.cool > W / 2 ? 1 : 2));
          return 'skill' + (next + 1);
        }
        const W = 0.4;
        if (u.cool > 0 && u.cool <= W) return 'atk' + (u.cool > W / 2 ? 2 : 3);
        return 'atk1';
      }
      if (mv) return 'idle' + (5 + Math.floor(t * 7) % 4);
      const ph = (t + (u.id || 0) * 1.37) % 5;
      if (ph > 4.6) return 'idle2';                   // まばたき
      return 'idle' + [1, 3, 4, 3][Math.floor(t * 2.2) % 4];   // 旗がゆっくりなびく
    },
  };
  Art.useSprite('spearman', SPEAR);

  // ゴーレム（2026-10-27 ユーザー提供のコマ絵 2枚：待機・歩き／攻撃）
  //   idle1〜4: 待機（砂がこぼれる）、idle5〜8: 歩き（砂が舞う）
  //   atk1: 構え、atk2〜5: かがむ→両腕を振り上げる→叩きつける、atk6: 砂しぶき、atk7〜8: 戻る
  //   固有能力「育つ城」は、コマ絵ではなく体が少しずつ大きくなるだけ（game.js の growView）
  const GOLEM = {
    src: 'sprites/golem.webp',
    px: 2.5,
    frames: {"idle1":[0,0,217,288,107.1,283.0],"idle2":[219,0,217,288,108.3,284.2],"idle3":[438,0,218,290,115.6,286.0],"idle4":[658,0,218,288,110.1,283.6],"idle5":[878,0,220,282,97.5,270.9],"idle6":[1100,0,220,279,80.6,265.5],"idle7":[0,292,220,281,100.8,269.7],"idle8":[222,292,220,278,89.0,264.3],"atk1":[444,292,223,287,102.9,282.8],"atk2":[669,292,223,267,106.0,262.9],"atk3":[894,292,227,275,102.9,271.0],"atk4":[1123,292,221,287,105.4,282.8],"atk5":[0,581,224,255,97.9,251.1],"atk6":[226,581,227,246,106.3,230.0],"atk7":[455,581,227,269,104.7,258.6],"atk8":[684,581,223,280,103.2,274.1]},
    pick(u) {
      const mv = walking(u), t = u.anim || 0, at = u.atk || 0;
      if (at > 0.01) { u.sprFight = t; return 'atk' + (at > 0.6 ? 6 : at > 0.25 ? 7 : 8); }
      if (!mv && u.sprFight != null && t - u.sprFight < 3) {
        const W = 0.6;
        if (u.cool > 0 && u.cool <= W) return 'atk' + Math.min(5, 2 + Math.floor((1 - u.cool / W) * 4));
        return 'atk1';
      }
      if (mv) return 'idle' + (5 + Math.floor(t * 5) % 4);      // ずしん、ずしん
      return 'idle' + (1 + Math.floor((t + (u.id || 0) * 0.7) * 2.5) % 4);
    },
  };
  Art.useSprite('golem', GOLEM);

  // 忍者（2026-10-27 ユーザー提供のコマ絵 4枚：待機・走り／攻撃／跳び込み／もう一度びっくり）
  //   idle1〜4: つま先で軽く跳ねて待つ、idle5〜8: 走る
  //   atk1: クナイを逆手に構える、atk2〜3: 振りかぶる、atk4〜5: 突く、atk6〜8: 戻る
  //   leap1〜8: 呼ばれたときの跳び込み（しゃがむ→跳ぶ→前線を越える→敵の後ろに着地→「ばあ」）
  //   boo1〜8: 固有能力「もう一度びっくり」の跳び込み（2回目から）
  const NINJA = {
    src: 'sprites/ninja.webp',
    px: 2.5,
    frames: {"idle1":[0,0,148,177,83.0,174.6],"idle2":[150,0,144,150,69.3,148.4],"idle3":[296,0,153,176,73.8,190.5],"idle4":[451,0,154,155,83.7,151.9],"idle5":[607,0,154,154,83.0,158.3],"idle6":[763,0,148,157,82.2,154.4],"idle7":[913,0,150,154,76.8,151.9],"idle8":[1065,0,154,157,58.1,154.0],"atk1":[1221,0,136,166,62.6,163.2],"atk2":[0,179,139,166,69.0,162.8],"atk3":[141,179,132,162,64.2,158.4],"atk4":[275,179,144,164,67.0,160.8],"atk5":[421,179,146,163,73.0,160.0],"atk6":[569,179,138,156,71.6,153.6],"atk7":[709,179,141,170,68.2,166.8],"atk8":[852,179,138,162,68.8,159.2],"leap1":[992,179,175,144,59.6,142.0],"leap2":[1169,179,171,152,49.9,149.8],"leap3":[0,351,174,134,87.0,127.5],"leap4":[176,351,124,128,74.4,124.6],"leap5":[302,351,161,118,120.0,114.4],"leap6":[465,351,155,117,131.6,112.5],"leap7":[622,351,166,143,98.9,142.0],"leap8":[790,351,159,146,105.7,142.5],"boo1":[951,351,157,115,48.3,112.0],"boo2":[1110,351,121,141,43.3,137.3],"boo3":[1233,351,119,125,28.1,122.4],"boo4":[0,499,121,122,56.7,119.9],"boo5":[123,499,138,176,115.2,173.7],"boo6":[263,499,101,126,55.7,123.9],"boo7":[366,499,168,174,103.5,171.7],"boo8":[536,499,136,175,67.7,172.7]},
    pick(u) {
      const mv = walking(u), t = u.anim || 0, at = u.atk || 0;
      // 跳び込み中: 進み具合（u.leapT / u.leapDur）でコマを選ぶ
      if (u.leapT != null) {
        if (!u.sprLeap) { u.sprLeap = true; u.sprBoo = (u.leapN || 1) > 1; }
        const p = u.leapDur ? u.leapT / u.leapDur : 0;
        if (u.sprBoo) return 'boo' + (p < 0.12 ? 1 : p < 0.3 ? 2 : p < 0.5 ? 3 : p < 0.7 ? 4 : 5);
        return 'leap' + (p < 0.15 ? 2 : p < 0.35 ? 3 : p < 0.65 ? 4 : 5);
      }
      if (u.sprLeap) { u.sprLeap = false; u.sprLandT = t; }
      // 着地: しゃがんで着地 → 「ばあ」と驚かせる
      const e = u.sprLandT != null ? t - u.sprLandT : 99;
      if (e < 0.55) {
        u.sprFight = t;
        if (u.sprBoo) return 'boo' + (e < 0.12 ? 6 : e < 0.3 ? 7 : 8);
        return 'leap' + (e < 0.12 ? 6 : e < 0.45 ? 7 : 8);
      }
      if (at > 0.01) { u.sprFight = t; return 'atk' + (at > 0.8 ? 4 : at > 0.6 ? 5 : at > 0.4 ? 6 : at > 0.2 ? 7 : 8); }
      if (!mv && u.sprFight != null && t - u.sprFight < 1.6) {
        const W = 0.25;
        if (u.cool > 0 && u.cool <= W) return 'atk' + (u.cool > W / 2 ? 2 : 3);
        return 'atk1';
      }
      if (mv) return 'idle' + (5 + Math.floor(t * 11) % 4);     // 足が速い
      // 待機: 立つ → しゃがむ → ぴょんと跳ねる → 着地、をくり返す
      const ph = ((t + (u.id || 0) * 0.9) % 1.6) / 1.6;
      return 'idle' + (ph < 0.45 ? 1 : ph < 0.6 ? 2 : ph < 0.8 ? 3 : 4);
    },
  };
  Art.useSprite('ninja', NINJA);

  // パラディン（2026-10-27 ユーザー提供のコマ絵 3枚：待機・歩き／攻撃／固有能力「病室の約束」）
  //   idle1〜4: 待機、idle5〜8: 一歩ずつ確かめるような歩き
  //   atk1: 盾を構える、atk2〜3: 盾の陰で剣を引く、atk4: 突く、atk5: 斬る、atk6〜8: 戻る
  //   skill1〜3: 約束を思い出す、skill4: 光が広がる、skill5〜8: 守っている間（3秒）
  //   後ろの光（病室の窓の光）は、元の絵から外してゲームで描いている
  const PAL_T = 3;                        // 病室の約束の長さ（game.js の INNATE.paladin.t と同じ）
  const PALADIN = {
    src: 'sprites/paladin.webp',
    px: 2.5,
    frames: {"skill1":[0,0,101,173,47.1,171.2],"skill2":[103,0,101,165,50.0,162.7],"skill3":[206,0,100,172,47.1,169.9],"skill4":[308,0,106,172,48.2,169.9],"skill5":[416,0,109,169,50.0,167.6],"skill6":[527,0,106,170,50.9,168.1],"skill7":[635,0,105,208,47.8,205.9],"skill8":[742,0,106,169,48.2,167.6],"idle1":[850,0,134,167,60.1,166.8],"idle2":[986,0,132,168,66.5,166.4],"idle3":[1120,0,134,167,60.9,166.1],"idle4":[1256,0,133,167,66.5,166.4],"idle5":[0,210,136,163,68.5,162.2],"idle6":[138,210,132,164,59.1,161.5],"idle7":[272,210,133,162,67.2,161.5],"idle8":[407,210,134,164,64.8,160.4],"atk1":[543,210,126,169,62.1,168.2],"atk2":[671,210,132,155,70.2,153.5],"atk3":[805,210,146,157,65.8,155.9],"atk4":[953,210,147,158,59.6,156.6],"atk5":[1102,210,144,161,58.4,159.7],"atk6":[1248,210,128,158,65.9,156.3],"atk7":[0,381,125,169,61.5,168.2],"atk8":[127,381,125,169,60.5,167.9]},
    pick(u) {
      const mv = walking(u), t = u.anim || 0, at = u.atk || 0;
      if (u.vowed && !u.sprVow) { u.sprVow = true; u.sprVowS = t; }
      const e = u.sprVowS != null ? t - u.sprVowS : 99;
      if (e < PAL_T) {
        u.sprFight = t;
        if (e < 0.45) return 'skill' + (1 + Math.floor(e / 0.15));
        if (e < 0.65) return 'skill4';
        return 'skill' + (5 + Math.floor((e - 0.65) * 5) % 4);
      }
      if (at > 0.01) { u.sprFight = t; return 'atk' + (at > 0.75 ? 4 : at > 0.5 ? 5 : at > 0.33 ? 6 : at > 0.15 ? 7 : 8); }
      if (!mv && u.sprFight != null && t - u.sprFight < 1.8) {
        const W = 0.4;
        if (u.cool > 0 && u.cool <= W) return 'atk' + (u.cool > W / 2 ? 2 : 3);
        return 'atk1';
      }
      if (mv) return 'idle' + (5 + Math.floor(t * 6) % 4);
      return 'idle' + (1 + Math.floor((t + (u.id || 0) * 0.8) * 1.6) % 4);
    },
    // 約束の光: 背中から暖かい光が広がり、守っている間ゆっくり脈打つ
    under(ctx, u, name) {
      if (!/^skill/.test(name)) return;
      const e = (u.anim || 0) - (u.sprVowS || 0);
      const k = Math.min(1, Math.max(0, (e - 0.3) / 0.35)) * Math.min(1, (PAL_T - e) / 0.4);
      if (!(k > 0)) return;
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      Art.glow(ctx, -6, -34, 58 + Math.sin(e * 5) * 4, 'rgba(255,214,140,A)', 0.5 * k);
      Art.glow(ctx, -10, -40, 26, 'rgba(255,240,200,A)', 0.45 * k);
      if (e > 0.45 && e < 1.3) {   // 広がる光の輪（周りの味方を包む）
        const q = (e - 0.45) / 0.85;
        ctx.strokeStyle = `rgba(255,226,160,${(0.6 * (1 - q)).toFixed(3)})`; ctx.lineWidth = 3;
        ctx.save(); ctx.scale(1, 0.3); ctx.beginPath(); ctx.arc(0, -4, 20 + q * 100, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
      }
      ctx.restore();
    },
  };
  Art.useSprite('paladin', PALADIN);

  // バーサーカー（2026-10-28 ユーザー提供のコマ絵 4枚：待機・歩き／攻撃／怒りの攻撃／固有能力「もう一度立つ」）
  //   idle1〜4: 板の剣を担いで待つ、idle5〜8: ずんずん歩く
  //   atk1: 構え、atk2〜4: 振り上げる、atk5〜7: 叩きつける、atk8: 担ぎ直す
  //   rage1〜8: HPが半分を切ったあとの攻撃（赤い火の粉をまとい、振りが荒い）
  //   rise1〜8: 倒れる一撃を受けて膝をつき、はちまきを締め直して立ち上がる
  const RISE = [0.12, 0.32, 0.5, 0.7, 0.9, 1.05, 1.2, 1.4];   // 各コマが終わる時間（秒）
  const BERSERK = {
    src: 'sprites/berserker.webp',
    px: 2.5,
    frames: {"idle1":[0,0,131,164,75.6,161.9],"idle2":[133,0,134,165,75.4,162.2],"idle3":[269,0,131,159,72.6,156.3],"idle4":[402,0,132,165,73.7,162.6],"idle5":[536,0,135,156,81.3,153.0],"idle6":[673,0,132,152,75.6,149.3],"idle7":[807,0,133,152,78.5,149.3],"idle8":[942,0,131,151,79.8,148.5],"atk1":[1075,0,137,171,70.0,168.4],"atk2":[1214,0,146,172,67.8,168.4],"atk3":[0,174,141,197,70.6,193.6],"atk4":[143,174,141,181,72.6,178.0],"atk5":[286,174,150,138,67.2,134.0],"atk6":[438,174,151,145,64.8,140.4],"atk7":[591,174,147,134,57.8,129.6],"atk8":[740,174,157,172,94.4,169.2],"rage1":[899,174,129,150,61.9,147.8],"rage2":[1030,174,119,169,59.1,166.8],"rage3":[1151,174,126,171,63.5,168.9],"rage4":[0,373,133,169,59.8,166.1],"rage5":[135,373,133,134,68.3,129.8],"rage6":[270,373,143,107,78.8,104.1],"rage7":[415,373,127,159,64.4,156.6],"rage8":[544,373,127,149,61.2,146.4],"rise1":[673,373,140,159,65.8,155.3],"rise2":[815,373,140,122,64.9,117.9],"rise3":[957,373,136,133,61.0,128.2],"rise4":[1095,373,136,164,64.9,159.8],"rise5":[1233,373,137,162,112.2,157.6],"rise6":[0,544,140,148,99.2,143.4],"rise7":[142,544,140,163,62.4,160.6],"rise8":[284,544,133,171,74.0,168.6]},
    pick(u) {
      const mv = walking(u), t = u.anim || 0, at = u.atk || 0, rage = (u.frenzy || 0) >= 0.7;   // HP 50%以下
      if (u.rose && !u.sprRose) { u.sprRose = true; u.sprRoseS = t; }
      const e = u.sprRoseS != null ? t - u.sprRoseS : 99;
      if (e < RISE[7]) { u.sprFight = t; let i = 0; while (e >= RISE[i]) i++; return 'rise' + (i + 1); }
      const set = rage ? 'rage' : 'atk';
      if (at > 0.01) {
        u.sprFight = t;
        if (rage) return 'rage' + (at > 0.8 ? 4 : at > 0.55 ? 5 : at > 0.3 ? 6 : 7);
        return 'atk' + (at > 0.75 ? 5 : at > 0.5 ? 6 : at > 0.25 ? 7 : 8);
      }
      if (!mv && u.sprFight != null && t - u.sprFight < 1.8) {
        const W = 0.36;
        if (u.cool > 0 && u.cool <= W) {
          const q = 1 - u.cool / W;
          return rage ? 'rage' + (q < 0.5 ? 2 : 3) : 'atk' + (q < 0.34 ? 2 : q < 0.67 ? 3 : 4);
        }
        return set + '1';
      }
      if (mv) return 'idle' + (5 + Math.floor(t * 9) % 4);
      return 'idle' + (1 + Math.floor((t + (u.id || 0) * 0.8) * 1.8) % 4);
    },
    // 怒り: HPが減るほど、体のまわりに赤い光がうっすら脈打つ
    under(ctx, u) {
      const f = u.frenzy || 0;
      if (!(f > 0.3)) return;
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      Art.glow(ctx, 0, -30, 40 + Math.sin((u.anim || 0) * 7) * 3, 'rgba(255,70,50,A)', 0.35 * (f - 0.3) / 0.7);
      ctx.restore();
    },
  };
  Art.useSprite('berserker', BERSERK);

  // 弓兵（2026-10-28 ユーザー提供のコマ絵 3枚：待機・歩き／攻撃／固有能力「届けたい言葉」）
  //   idle1〜4: 手紙を抱いて待つ（3でまばたき）、idle5〜8: 歩き
  //   atk1: 手紙を持つ、atk2: つがえる、atk3〜4: 引く、atk5: 放つ、atk6〜8: 見送る
  //   skill1〜8: 4本目（必ず会心）。光る手紙をつがえて放ち、届いたのを見て微笑む
  //   飛んでいく紙飛行機は、コマ絵からは外してゲームの弾（紙飛行機）で描く
  const ARCHER = {
    src: 'sprites/archer.webp',
    px: 2.5,
    frames: {"idle1":[0,0,106,158,51.9,156.7],"idle2":[108,0,106,160,50.4,158.7],"idle3":[216,0,108,159,51.8,157.7],"idle4":[326,0,110,156,54.9,154.0],"idle5":[438,0,116,150,61.7,148.7],"idle6":[556,0,115,150,65.7,148.4],"idle7":[673,0,114,150,57.8,149.0],"idle8":[789,0,115,148,61.9,146.0],"atk1":[906,0,105,158,42.2,158.3],"atk2":[1013,0,105,157,48.6,157.3],"atk3":[1120,0,109,160,48.1,160.0],"atk4":[1231,0,117,158,52.1,158.0],"atk5":[0,162,102,146,48.1,144.4],"atk6":[104,162,92,141,45.0,139.7],"atk7":[198,162,98,138,41.5,136.7],"atk8":[298,162,88,142,39.7,140.4],"skill1":[388,162,123,167,46.9,164.7],"skill2":[513,162,121,164,47.3,162.1],"skill3":[636,162,128,163,46.2,160.6],"skill4":[766,162,130,157,39.1,154.8],"skill5":[898,162,94,158,37.8,156.6],"skill6":[994,162,109,165,34.9,162.8],"skill7":[1105,162,90,162,39.2,160.3],"skill8":[1197,162,88,150,38.0,148.6]},
    pick(u) {
      const mv = walking(u), t = u.anim || 0, at = u.atk || 0;
      if (at > 0.01) {
        u.sprFight = t;
        if (u.innC === 0) return 'skill' + (at > 0.8 ? 4 : at > 0.6 ? 5 : at > 0.35 ? 6 : 7);
        return 'atk' + (at > 0.75 ? 5 : at > 0.5 ? 6 : at > 0.25 ? 7 : 8);
      }
      if (!mv && u.sprFight != null && t - u.sprFight < 1.8) {
        const skill = u.innC === 3, W = 0.45;   // 次が4本目なら光る手紙
        if (u.cool > 0 && u.cool <= W) {
          const q = 1 - u.cool / W;
          return skill ? 'skill' + (q < 0.4 ? 2 : 3) : 'atk' + (q < 0.3 ? 2 : q < 0.65 ? 3 : 4);
        }
        if (u.innC === 0 && t - u.sprFight < 0.9) return 'skill8';   // 届いた手紙を見て、もう1通取り出す
        return skill ? 'skill1' : 'atk1';
      }
      if (mv) return 'idle' + (5 + Math.floor(t * 8) % 4);
      const ph = (t + (u.id || 0) * 1.37) % 5;
      if (ph > 4.6) return 'idle3';                       // まばたき
      return 'idle' + [1, 2, 4, 2][Math.floor(t * 1.5) % 4];   // 小鳥が羽ばたく
    },
  };
  Art.useSprite('archer', ARCHER);

  // ハンター（2026-10-28 ユーザー提供のコマ絵 3枚：待機・歩き／攻撃／固有能力「図鑑の新しいページ」）
  //   idle1: 空を見上げる、idle2: 双眼鏡、idle3〜4: 図鑑を読む、idle5〜8: 図鑑を読みながら歩く（元の絵は逆向きに歩いているので左右反転）
  //   atk1: 構え、atk2: 矢を取る、atk3〜5: 空へ向けて引く、atk6: 放つ、atk7〜8: 見送って下ろす
  //   skill1〜8: 飛ぶ敵を倒してエネルギーが戻ったとき。図鑑に印をつけ、抱きしめて跳ねる
  const PAGE = [0.15, 0.32, 0.5, 0.68, 0.9, 1.1, 1.35, 1.6];
  const HUNTER = {
    src: 'sprites/hunter.webp',
    px: 2.5,
    frames: {"idle1":[0,0,97,166,39.9,161.7],"idle2":[99,0,97,167,37.1,163.1],"idle3":[198,0,106,171,54.2,167.3],"idle4":[306,0,105,171,48.8,167.0],"idle5":[413,0,113,157,61.1,154.4],"idle6":[528,0,108,158,59.2,154.4],"idle7":[638,0,110,157,58.1,153.7],"idle8":[750,0,107,159,54.5,155.5],"atk1":[859,0,117,167,45.5,163.1],"atk2":[978,0,131,161,47.1,157.6],"atk3":[1111,0,136,167,61.8,163.9],"atk4":[1249,0,146,167,63.4,163.1],"atk5":[0,173,137,166,66.4,161.9],"atk6":[139,173,126,161,61.3,157.6],"atk7":[267,173,137,166,65.8,161.9],"atk8":[406,173,138,156,55.3,152.0],"skill1":[546,173,102,168,38.1,165.3],"skill2":[650,173,102,173,49.8,171.5],"skill3":[754,173,112,172,55.5,168.2],"skill4":[868,173,109,173,56.7,169.3],"skill5":[979,173,105,170,47.9,166.4],"skill6":[1086,173,91,151,34.3,150.1],"skill7":[1179,173,110,135,54.7,167.1],"skill8":[1291,173,101,165,44.8,162.4]},
    pick(u) {
      const mv = walking(u), t = u.anim || 0, at = u.atk || 0;
      if ((u.pageN || 0) !== (u.sprPageN || 0)) { u.sprPageN = u.pageN; u.sprPageS = t; }
      const e = u.sprPageS != null ? t - u.sprPageS : 99;
      if (e < PAGE[7] && at < 0.5) { u.sprFight = t; let i = 0; while (e >= PAGE[i]) i++; return 'skill' + (i + 1); }
      if (at > 0.01) { u.sprFight = t; return 'atk' + (at > 0.66 ? 6 : at > 0.33 ? 7 : 8); }
      if (!mv && u.sprFight != null && t - u.sprFight < 1.8) {
        const W = 0.5;
        if (u.cool > 0 && u.cool <= W) { const q = 1 - u.cool / W; return 'atk' + (q < 0.25 ? 2 : q < 0.5 ? 3 : q < 0.75 ? 4 : 5); }
        return 'atk1';
      }
      if (mv) return 'idle' + (5 + Math.floor(t * 7) % 4);
      // 待機: 空を見上げる → 双眼鏡でのぞく → 図鑑をめくる、をゆっくりくり返す
      const ph = (t + (u.id || 0) * 1.9) % 9;
      return ph < 3 ? 'idle1' : ph < 4.6 ? 'idle2' : ph < 9 ? (Math.floor(ph * 0.8) % 2 ? 'idle3' : 'idle4') : 'idle1';
    },
  };
  Art.useSprite('hunter', HUNTER);
  window.__pick = (u, k) => ({ guardian: GUARD, spearman: SPEAR, golem: GOLEM, ninja: NINJA, paladin: PALADIN, berserker: BERSERK, archer: ARCHER, hunter: HUNTER }[k] || SWORD).pick(u);   // (test hook)
})();
