/* 手描きのコマ絵（スプライト）。ユーザーが用意した絵を切り抜いて1枚にまとめたもの（sprites/）。
   ここに登録した住人は、コードで描いた絵の代わりにコマ絵で動く。読み込めないときは今までの絵のまま。
   frames: コマ名 → [画像内のx, y, 幅, 高さ, 足元のx, 足元のy]（px: 1ユニットあたりの画像のpx） */
(() => {
  'use strict';
  if (!window.Art || !Art.useSprite) return;

  // 剣士（2026-10-27 ユーザー提供のコマ絵 3枚：待機・歩き／攻撃／固有能力「一歩前へ」）
  //   idle1〜4: 待機（4がずり落ちたバケツを直す）、idle5〜8: 歩き
  //   atk1〜4: 振りかぶり、atk5〜8: 振り下ろし→戻り、skill1〜8: 5回目の一撃（ページが舞う）
  const SWORD_SKILL_EVERY = 5;           // 固有能力の5回目（game.js の INNATE.swordsman.every と同じ）
  const SWORD = {
    src: 'sprites/swordsman.webp',
    px: 2.5,
    frames: {"idle1":[0,0,132,178,84.5,176.2],"idle2":[134,0,132,164,83.0,162.8],"idle3":[268,0,126,177,79.4,175.4],"idle4":[396,0,129,178,81.6,176.6],"idle5":[527,0,140,166,64.6,164.8],"idle6":[669,0,138,156,65.2,154.7],"idle7":[809,0,142,164,66.6,162.8],"idle8":[953,0,140,165,72.1,163.2],"atk1":[1095,0,133,175,58.3,173.1],"atk2":[1230,0,144,165,59.5,162.9],"atk3":[0,180,108,193,59.2,191.6],"atk4":[110,180,152,164,97.4,162.0],"atk5":[264,180,181,174,103.9,169.4],"atk6":[447,180,182,167,97.4,163.4],"atk7":[631,180,194,147,97.2,141.6],"atk8":[827,180,133,171,59.0,169.4],"skill1":[962,180,168,162,64.1,160.6],"skill2":[1132,180,168,171,69.9,168.0],"skill3":[0,375,163,196,81.7,193.9],"skill4":[165,375,176,179,113.4,177.3],"skill5":[343,375,190,163,97.0,160.6],"skill6":[535,375,197,177,96.5,170.3],"skill7":[734,375,194,133,95.6,131.0],"skill8":[930,375,161,163,63.0,160.6]},
    pick(u) {
      const t = u.anim || 0, at = u.atk || 0;
      // 振り下ろし（u.atk が 1 → 0 へ約0.33秒）: 5回目の一撃のときは u.innC が 0 に戻っている
      if (at > 0.01) {
        u.sprFight = t;
        const set = u.innC === 0 ? 'skill' : 'atk';
        return set + (at > 0.75 ? 5 : at > 0.5 ? 6 : at > 0.25 ? 7 : 8);
      }
      const fighting = !u.walk && u.sprFight != null && t - u.sprFight < 1.6;
      if (fighting) {
        // 振りかぶり: 次の攻撃までの残り時間（u.cool）で1〜4コマ目
        const skill = u.innC === SWORD_SKILL_EVERY - 1, W = skill ? 0.5 : 0.36;
        if (u.cool > 0 && u.cool <= W) return (skill ? 'skill' : 'atk') + Math.min(4, 1 + Math.floor((1 - u.cool / W) * 4));
        return skill ? 'skill1' : 'atk1';      // 構え（次が5回目なら剣が光っている）
      }
      if (u.walk) return 'idle' + (5 + Math.floor(t * 8) % 4);
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
      const t = u.anim || 0, at = u.atk || 0;
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
      if (!u.walk && u.sprFight != null && t - u.sprFight < 1.8) {
        const W = 0.45;
        if (u.cool > 0 && u.cool <= W) return 'atk' + Math.min(5, 2 + Math.floor((1 - u.cool / W) * 4));
        return 'atk1';
      }
      if (u.walk) return 'idle' + (5 + Math.floor(t * 6) % 4);   // 重い足取り
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
  window.__pick = (u, k) => (k === 'guardian' ? GUARD : SWORD).pick(u);   // (test hook)
})();
