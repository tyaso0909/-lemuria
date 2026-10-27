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
  window.__pick = (u) => SWORD.pick(u);   // (test hook)
})();
