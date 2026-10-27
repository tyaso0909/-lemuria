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
  window.__pick = (u, k) => ({ guardian: GUARD, spearman: SPEAR, golem: GOLEM }[k] || SWORD).pick(u);   // (test hook)
})();
