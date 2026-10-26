/* =========================================================================
   夢の境界線 — art.js
   コードで描く仮グラフィック。すべての描画はこのファイルに集約している。

   ■ 画像素材への差し替え方法
     Art.useImage('swordsman', 'img/swordsman.png', { w: 72, h: 80, ax: 0.5, ay: 1 });
     ・kind はユニット種別（下の KINDS 参照）
     ・w/h は描画サイズ(px)、ax/ay は足元アンカー（0..1）
     登録された種別は、画像の読み込み完了後に自動で画像描画へ切り替わる。

   ■ 座標の約束
     drawUnit は足元(0,0)・右向きのローカル座標で描く。向き反転・拡大は呼び出し側。

   ■ パフォーマンスの約束
     ・背景／灯台の静的部分はオフスクリーンキャンバスにキャッシュ
     ・ユニットの光彩はキャッシュ済みスプライト(sglow)を drawImage するだけ
     ・グラデーションはローカル座標で一度だけ作って使い回す(lgc)
   ========================================================================= */
(function () {
  'use strict';

  const TAU = Math.PI * 2;
  const KINDS = ['swordsman', 'guardian', 'archer', 'mage', 'healer', 'spearman', 'icemage', 'bard', 'golem', 'shade', 'runner', 'armor', 'boss',
    'swarm', 'spitter', 'charger', 'bomber', 'mender', 'bell', 'flyer', 'weaver',
    'hunter', 'sniper', 'thunder', 'ninja',
    'paladin', 'pyro', 'engineer', 'berserker', 'gunner', 'crossbow', 'dollmaster', 'doll', 'turret',
    'snowman', 'snowlet', 'friend', 'friendkid', 'astro', 'wheel', 'batter', 'siren', 'throne', 'clock', 'whale', 'devourer',
    'witch', 'toy', 'dancer', 'postman', 'letter', 'express'];
  const images = {};

  // ---------- small helpers (public) ----------
  function rr(ctx, x, y, w, h, r) {
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
    else { if (typeof r !== 'number') r = r[0] || 0; ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
  }
  function ell(ctx, x, y, rx, ry, rot) { ctx.beginPath(); ctx.ellipse(x, y, Math.max(0.01, rx), Math.max(0.01, ry), rot || 0, 0, TAU); }
  function circ(ctx, x, y, r) { ctx.beginPath(); ctx.arc(x, y, Math.max(0.01, r), 0, TAU); }
  function glow(ctx, x, y, r, color, a) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color.replace('A', a)); g.addColorStop(1, color.replace('A', 0));
    ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // seeded random so the background is identical every load
  function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

  // ---------- internal helpers ----------
  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
  const ease = (t) => t * t * (3 - 2 * t);
  function mkCanvas(w, h) { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; }

  // cached soft-glow sprite (radial falloff), drawn with drawImage → no per-frame gradients
  const glowSprites = {};
  function glowSprite(rgb) {
    let c = glowSprites[rgb];
    if (c) return c;
    c = mkCanvas(64, 64);
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, `rgba(${rgb},1)`); gr.addColorStop(0.22, `rgba(${rgb},.62)`);
    gr.addColorStop(0.55, `rgba(${rgb},.18)`); gr.addColorStop(1, `rgba(${rgb},0)`);
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    glowSprites[rgb] = c; return c;
  }
  function sglow(ctx, x, y, r, rgb, a) {
    if (a <= 0.003) return;
    const pa = ctx.globalAlpha; ctx.globalAlpha = pa * Math.min(1, a);
    ctx.drawImage(glowSprite(rgb), x - r, y - r, r * 2, r * 2);
    ctx.globalAlpha = pa;
  }
  // gradients in unit-local space are identical every frame → build once
  const gradCaches = new WeakMap();
  function lgc(ctx, key, x0, y0, x1, y1, stops) {
    let m = gradCaches.get(ctx);
    if (!m) { m = {}; gradCaches.set(ctx, m); }
    let g = m[key];
    if (!g) { g = ctx.createLinearGradient(x0, y0, x1, y1); for (const s of stops) g.addColorStop(s[0], s[1]); m[key] = g; }
    return g;
  }

  const INK = '#17153a';           // ally outline
  const EINK = '#06030e';          // nightmare body edge
  const RIM_BASE = 'rgba(206,160,255,.92)', RIM_ELITE = 'rgba(255,216,150,.95)';
  let RIM = RIM_BASE;              // nightmare violet rim (drawUnit swaps in gold-violet for elites)
  function fo(ctx, fill, lw, out) { ctx.fillStyle = fill; ctx.fill(); ctx.strokeStyle = out || INK; ctx.lineWidth = lw || 1.4; ctx.stroke(); }
  // capsule limb with outline (2 strokes)
  function bone(ctx, x1, y1, x2, y2, w, col, out, ow) {
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
    ctx.strokeStyle = out || INK; ctx.lineWidth = w + (ow == null ? 2.6 : ow); ctx.stroke();
    ctx.strokeStyle = col; ctx.lineWidth = w; ctx.stroke();
    ctx.lineCap = 'butt';
  }
  // crescent moon (outer circle minus offset inner circle), opening toward +x after rotation
  function crescent(ctx, x, y, R, d, r2, rot) {
    const ix = (d * d + R * R - r2 * r2) / (2 * d), iy = Math.sqrt(Math.max(0, R * R - ix * ix));
    const th = Math.atan2(iy, ix);
    ctx.save(); ctx.translate(x, y); ctx.rotate(rot || 0);
    ctx.beginPath();
    ctx.arc(0, 0, R, th, TAU - th, false);
    ctx.arc(d, 0, r2, Math.atan2(-iy, ix - d), Math.atan2(iy, ix - d), true);
    ctx.closePath(); ctx.restore();
  }
  // attack anticipation from the unit's cooldown (0..1); 0 when moving or unknown
  function antic(u, win) {
    if (u.walk || u.atk > 0.02 || u.cool == null || !(u.cool > 0) || u.cool > win) return 0;
    return ease(1 - u.cool / win);
  }

  // =====================================================================
  //  BACKGROUND
  // =====================================================================
  let bgScale = 0, skyCache = null, islandNear = null, groundCache = null;
  const ISL_Y0 = 90, ISL_H = 330, GND_Y0 = 380, GND_H = 340;
  const stars = [];
  (function () { const r = rng(7); for (let i = 0; i < 150; i++) stars.push({ x: r() * 1280, y: r() * 420, s: r() * 1.5 + 0.4, p: r() * TAU, sp: 0.6 + r() * 2 }); })();
  const motesBG = [];
  (function () { const r = rng(11); for (let i = 0; i < 18; i++) motesBG.push({ x: 230 + r() * 1000, sp: 0.05 + r() * 0.08, p: r(), sw: r() * TAU, gold: r() < 0.3 }); })();
  let cloudSprite = null, mistSprite = null;

  function buildCloudSprite() {
    const c = mkCanvas(320, 70), g = c.getContext('2d');
    const r = rng(5);
    for (let i = 0; i < 9; i++) {
      const x = 40 + r() * 240, y = 35 + (r() - 0.5) * 16, rx = 40 + r() * 50;
      g.save(); g.translate(x, y); g.scale(1, 0.28);
      const gr = g.createRadialGradient(0, 0, 0, 0, 0, rx);
      gr.addColorStop(0, 'rgba(170,185,240,.20)'); gr.addColorStop(1, 'rgba(170,185,240,0)');
      g.fillStyle = gr; g.fillRect(-rx, -rx, rx * 2, rx * 2); g.restore();
    }
    return c;
  }
  function buildMistSprite() {
    const c = mkCanvas(256, 64), g = c.getContext('2d');
    g.translate(128, 32); g.scale(1, 0.25);
    const gr = g.createRadialGradient(0, 0, 0, 0, 0, 128);
    gr.addColorStop(0, 'rgba(170,120,230,.38)'); gr.addColorStop(0.5, 'rgba(150,100,210,.14)'); gr.addColorStop(1, 'rgba(150,100,210,0)');
    g.fillStyle = gr; g.fillRect(-128, -128, 256, 256);
    return c;
  }

  function vignette(g) {
    const vg = g.createRadialGradient(640, 330, 280, 640, 360, 860);
    vg.addColorStop(0, 'rgba(0,0,10,0)'); vg.addColorStop(1, 'rgba(0,0,12,.58)');
    g.fillStyle = vg; g.fillRect(0, 0, 1280, 720);
  }

  function buildSky(k) {
    const c = mkCanvas(1280 * k, 720 * k), g = c.getContext('2d'); g.scale(k, k);
    const r = rng(42);
    const H = 452;
    // sky
    const sky = g.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#030716'); sky.addColorStop(0.32, '#0a1338'); sky.addColorStop(0.68, '#19225c'); sky.addColorStop(1, '#35377c');
    g.fillStyle = sky; g.fillRect(0, 0, 1280, H + 2);
    // Lemuria (left) cool-blue haze, Oblivion (right) violet
    glow(g, 300, 300, 460, 'rgba(70,110,210,A)', 0.2);
    const side = g.createLinearGradient(0, 0, 1280, 0);
    side.addColorStop(0, 'rgba(60,30,100,0)'); side.addColorStop(0.5, 'rgba(70,30,110,0)'); side.addColorStop(1, 'rgba(90,30,130,.5)');
    g.fillStyle = side; g.fillRect(0, 0, 1280, H);
    // nebula wisps
    for (let i = 0; i < 16; i++) glow(g, r() * 1280, 50 + r() * 300, 70 + r() * 170, i % 3 ? 'rgba(110,90,220,A)' : 'rgba(80,130,230,A)', 0.04 + r() * 0.05);
    // milky band with dust
    g.save(); g.translate(640, 168); g.rotate(-0.17);
    const band = g.createLinearGradient(0, -80, 0, 80);
    band.addColorStop(0, 'rgba(150,180,255,0)'); band.addColorStop(0.5, 'rgba(185,200,255,.16)'); band.addColorStop(1, 'rgba(150,180,255,0)');
    g.fillStyle = band; g.fillRect(-820, -80, 1640, 160);
    for (let i = 0; i < 520; i++) {
      const x = (r() - 0.5) * 1600, y = (r() + r() + r() - 1.5) * 48;
      g.fillStyle = `rgba(225,232,255,${0.12 + r() * 0.4})`; g.fillRect(x, y, 0.9, 0.9);
    }
    g.restore();
    // static faint stars
    for (let i = 0; i < 260; i++) { g.fillStyle = `rgba(210,220,255,${0.1 + r() * 0.3})`; g.fillRect(r() * 1280, r() * 430, 1, 1); }

    // moon
    const mx = 1010, my = 118;
    glow(g, mx, my, 280, 'rgba(150,170,255,A)', 0.13);
    glow(g, mx, my, 120, 'rgba(220,230,255,A)', 0.3);
    const md = g.createRadialGradient(mx - 12, my - 12, 4, mx, my, 40);
    md.addColorStop(0, '#ffffff'); md.addColorStop(0.65, '#eaf0ff'); md.addColorStop(1, '#c4cdee');
    g.fillStyle = md; circ(g, mx, my, 40); g.fill();
    g.save(); circ(g, mx, my, 40); g.clip();
    const cr = [[-12, -9, 8], [13, 12, 6], [9, -15, 4], [-4, 17, 5], [22, -2, 3.5], [-22, 8, 4]];
    for (const q of cr) { g.fillStyle = 'rgba(150,165,215,.30)'; circ(g, mx + q[0], my + q[1], q[2]); g.fill(); g.fillStyle = 'rgba(255,255,255,.35)'; circ(g, mx + q[0] - 0.8, my + q[1] - 0.8, q[2] * 0.55); g.fill(); g.fillStyle = 'rgba(150,165,215,.22)'; circ(g, mx + q[0] + 0.6, my + q[1] + 0.6, q[2] * 0.6); g.fill(); }
    g.fillStyle = 'rgba(110,125,190,.22)'; circ(g, mx + 20, my + 16, 40); g.fill();
    g.restore();
    // thin clouds across the moon (moonlit tops)
    // long thin moonlit cloud streaks (lit upper edge, darker body)
    function cloudBank(cx, cy, w, h) {
      const parts = [];
      for (let i = 0; i < 5; i++) {
        const f = (i + 0.5) / 5;
        parts.push([cx - w / 2 + f * w + (r() - 0.5) * 10, cy + (r() - 0.5) * h * 0.6, w * (0.22 + r() * 0.14) * (1 - Math.abs(f - 0.5) * 0.6), h * (0.55 + r() * 0.5) * (1 - Math.abs(f - 0.5))]);
      }
      g.fillStyle = 'rgba(200,210,250,.42)';
      for (const q of parts) { ell(g, q[0], q[1] - 1.5, q[2], q[3]); g.fill(); }
      g.fillStyle = 'rgba(33,38,100,.96)';
      for (const q of parts) { ell(g, q[0] - 1, q[1] + 0.8, q[2], q[3]); g.fill(); }
      g.fillStyle = 'rgba(80,88,160,.35)';
      for (const q of parts) { ell(g, q[0] + q[2] * 0.15, q[1] - q[3] * 0.2, q[2] * 0.6, q[3] * 0.35); g.fill(); }
    }
    cloudBank(942, 160, 190, 7); cloudBank(1104, 96, 120, 5); cloudBank(1210, 196, 150, 6);

    // distant, faint floating isles (static far layer)
    function farIsle(cx, cy, w) {
      g.fillStyle = 'rgba(40,50,110,.55)';
      g.beginPath(); g.moveTo(cx - w / 2, cy); g.quadraticCurveTo(cx, cy + w * 0.55, cx + w / 2, cy); g.closePath(); g.fill();
      for (let i = 0; i < 3; i++) { const tx = cx - w / 3 + r() * w * 0.6, th = 4 + r() * w * 0.25; g.fillRect(tx, cy - th, 2 + r() * 3, th); }
      if (r() < 0.8) { g.fillStyle = 'rgba(255,214,150,.6)'; g.fillRect(cx + (r() - 0.5) * w * 0.5, cy - 3, 1.2, 1.2); }
    }
    farIsle(330, 372, 46); farIsle(560, 352, 30); farIsle(760, 388, 38); farIsle(180, 400, 28); farIsle(880, 365, 22);

    // horizon glow
    const hg = g.createLinearGradient(0, H - 26, 0, H + 6);
    hg.addColorStop(0, 'rgba(190,150,255,0)'); hg.addColorStop(1, 'rgba(200,160,255,.28)');
    g.fillStyle = hg; g.fillRect(0, H - 26, 1280, 32);

    // sea of Oblivion
    const sea = g.createLinearGradient(0, H, 0, 560);
    sea.addColorStop(0, '#30266a'); sea.addColorStop(0.35, '#1d1648'); sea.addColorStop(1, '#0d0926');
    g.fillStyle = sea; g.fillRect(0, H, 1280, 130);
    // violet haze over the far sea (right)
    for (let i = 0; i < 6; i++) glow(g, 700 + i * 110, H + 8, 150, 'rgba(170,110,230,A)', 0.09);
    // wave lines with perspective
    for (let row = 0; row < 34; row++) {
      const f = row / 33, y = H + 2 + f * f * 80;
      const n = 6 + row;
      for (let i = 0; i < n; i++) {
        const x = 330 + r() * 960, w = (6 + r() * 26) * (0.5 + f * 1.4);
        const near = Math.max(0, 1 - Math.abs(x - mx) / 260);
        g.fillStyle = `rgba(${190 + near * 50},${160 + near * 70},255,${0.05 + r() * 0.08 + near * 0.18})`;
        g.fillRect(x, y, w, 0.9 + f * 0.6);
      }
    }
    // moon reflection column
    for (let i = 0; i < 30; i++) {
      const y = H + 3 + i * 2.8, w = 64 - i * 1.3 + r() * 26;
      g.fillStyle = `rgba(232,236,255,${0.42 - i * 0.012})`;
      g.fillRect(mx - w / 2 + (r() - 0.5) * 22, y, w, 1.3);
    }
    vignette(g);
    return c;
  }

  // floating islands of Lemuria
  function buildIslands(k, layer) {
    const c = mkCanvas(1280 * k, ISL_H * k), g = c.getContext('2d');
    g.scale(k, k); g.translate(0, -ISL_Y0);
    const r = rng(layer ? 91 : 37);
    const pal = layer
      ? { rock: '#151d4a', rock2: '#1d2758', top: '#2a3b74', bld: '#1b2556', rim: 'rgba(170,185,255,.35)', win: 'rgba(255,212,140,.95)', a: 1 }
      : { rock: '#1c2558', rock2: '#222d62', top: '#2c3a78', bld: '#212c62', rim: 'rgba(170,185,255,.22)', win: 'rgba(255,212,150,.7)', a: 0.85 };

    function island(cx, cy, w, h, opt) {
      opt = opt || {};
      g.globalAlpha = pal.a;
      // mist beneath
      glow(g, cx, cy + h * 1.6, w * 0.9, 'rgba(120,150,235,A)', 0.09);
      // underside rock (jagged)
      g.fillStyle = pal.rock;
      g.beginPath(); g.moveTo(cx - w / 2, cy);
      const pts = 7, tipX = cx + (r() - 0.5) * w * 0.2, tipY = cy + h * 2.4;
      for (let i = 1; i <= pts; i++) { const f = i / pts; g.lineTo(lerp(cx - w / 2, tipX, f) + (r() - 0.5) * 8, lerp(cy, tipY, Math.pow(f, 0.8)) + (r() - 0.5) * 6); }
      for (let i = 1; i <= pts; i++) { const f = i / pts; g.lineTo(lerp(tipX, cx + w / 2, f) + (r() - 0.5) * 8, lerp(tipY, cy, Math.pow(f, 1.25)) + (r() - 0.5) * 6); }
      g.closePath(); g.fill();
      // strata
      g.save(); g.clip();
      g.fillStyle = pal.rock2;
      for (let i = 0; i < 4; i++) { const y = cy + 6 + i * h * 0.5; g.fillRect(cx - w / 2, y, w, h * 0.18); }
      // moonlit right face
      g.fillStyle = 'rgba(150,165,240,.10)';
      g.beginPath(); g.moveTo(cx + w * 0.1, cy); g.lineTo(cx + w / 2 + 4, cy); g.lineTo(tipX + 4, tipY); g.closePath(); g.fill();
      g.restore();
      // hanging roots with luminous tips
      for (let i = 0; i < 4 + (w / 40 | 0); i++) {
        const rx = cx - w * 0.38 + r() * w * 0.76, ry = cy + h * (0.4 + r() * 0.8), len = 8 + r() * 22;
        g.strokeStyle = 'rgba(70,90,160,.6)'; g.lineWidth = 1;
        g.beginPath(); g.moveTo(rx, ry); g.quadraticCurveTo(rx + (r() - 0.5) * 8, ry + len * 0.6, rx + (r() - 0.5) * 6, ry + len); g.stroke();
        if (r() < 0.5) { g.fillStyle = 'rgba(160,230,255,.85)'; circ(g, rx, ry + len, 1.1); g.fill(); }
      }
      // grassy cap
      g.fillStyle = pal.top;
      g.beginPath(); g.moveTo(cx - w / 2 - 3, cy + 2);
      g.quadraticCurveTo(cx, cy - 7, cx + w / 2 + 3, cy + 2); g.quadraticCurveTo(cx, cy + 6, cx - w / 2 - 3, cy + 2); g.fill();
      g.strokeStyle = pal.rim; g.lineWidth = 1; g.beginPath(); g.moveTo(cx - w / 2 - 3, cy + 1); g.quadraticCurveTo(cx, cy - 8, cx + w / 2 + 3, cy + 1); g.stroke();
      // buildings: houses, domes and slender spires
      const nb = opt.b || 5;
      const spots = [];
      for (let i = 0; i < nb; i++) spots.push(cx - w * 0.4 + (w * 0.8 * (i + 0.5)) / nb + (r() - 0.5) * 6);
      for (const bx of spots) {
        const kind = r(), baseY = cy - 1 - Math.abs(bx - cx) * 0.08;
        g.fillStyle = pal.bld;
        if (kind < 0.35) { // spire
          const bw = 5 + r() * 4, bh = 18 + r() * h * 1.5;
          g.fillRect(bx - bw / 2, baseY - bh, bw, bh);
          g.beginPath(); g.moveTo(bx - bw / 2 - 1.5, baseY - bh); g.lineTo(bx, baseY - bh - 10 - r() * 10); g.lineTo(bx + bw / 2 + 1.5, baseY - bh); g.fill();
          g.fillStyle = pal.win; g.fillRect(bx - 1, baseY - bh + 5, 2, 3);
          if (r() < 0.6) g.fillRect(bx - 1, baseY - bh * 0.5, 2, 3);
          g.strokeStyle = pal.rim; g.lineWidth = 0.8; g.beginPath(); g.moveTo(bx + bw / 2, baseY); g.lineTo(bx + bw / 2, baseY - bh); g.stroke();
        } else if (kind < 0.65) { // domed hall
          const bw = 12 + r() * 8, bh = 8 + r() * 8;
          g.fillRect(bx - bw / 2, baseY - bh, bw, bh);
          g.beginPath(); g.arc(bx, baseY - bh, bw / 2, Math.PI, 0); g.fill();
          g.fillRect(bx - 0.6, baseY - bh - bw / 2 - 5, 1.2, 5);
          g.fillStyle = pal.win; for (let j = 0; j < 2; j++) { rr(g, bx - bw / 2 + 3 + j * (bw - 8), baseY - bh + 2, 2.4, 4, 1.2); g.fill(); }
        } else { // gabled house
          const bw = 9 + r() * 6, bh = 7 + r() * 6;
          g.fillRect(bx - bw / 2, baseY - bh, bw, bh);
          g.beginPath(); g.moveTo(bx - bw / 2 - 2, baseY - bh); g.lineTo(bx, baseY - bh - 7); g.lineTo(bx + bw / 2 + 2, baseY - bh); g.fill();
          g.fillStyle = pal.win; g.fillRect(bx - 1.5, baseY - bh + 2.5, 3, 3);
        }
      }
      // round dream-trees
      for (let i = 0; i < (opt.trees || 2); i++) {
        const tx = cx - w * 0.45 + r() * w * 0.9;
        g.fillStyle = '#1f3566'; circ(g, tx, cy - 6, 5 + r() * 3); g.fill();
        g.fillStyle = 'rgba(150,200,255,.18)'; circ(g, tx + 1.5, cy - 8, 2.5); g.fill();
      }
      // window glows
      g.globalCompositeOperation = 'lighter';
      for (let i = 0; i < nb; i++) glow(g, spots[i], cy - 12, 14, 'rgba(255,200,120,A)', 0.18 * pal.a);
      g.globalCompositeOperation = 'source-over';
      // falling dream-light from the edge
      if (opt.fall) {
        const fx = cx + opt.fall, fg = g.createLinearGradient(0, cy, 0, cy + 120);
        fg.addColorStop(0, 'rgba(170,225,255,.35)'); fg.addColorStop(1, 'rgba(170,225,255,0)');
        g.fillStyle = fg; g.fillRect(fx - 1.5, cy, 3, 120);
        glow(g, fx, cy + 4, 10, 'rgba(180,230,255,A)', 0.4);
      }
      g.globalAlpha = 1;
    }
    if (layer === 0) {
      island(95, 318, 74, 13, { b: 3, trees: 1 });
      island(395, 168, 56, 11, { b: 3, trees: 1 });
      island(612, 214, 66, 12, { b: 3, trees: 2 });
      island(830, 300, 44, 9, { b: 2, trees: 0 });
    } else {
      island(250, 252, 168, 28, { b: 7, trees: 3, fall: 62 });
      island(505, 206, 96, 18, { b: 4, trees: 2 });
      island(700, 296, 120, 21, { b: 5, trees: 2, fall: -30 });
    }
    return c;
  }

  function buildGround(k) {
    const c = mkCanvas(1280 * k, GND_H * k), g = c.getContext('2d');
    g.scale(k, k); g.translate(0, -GND_Y0);
    const r = rng(77);
    // sea foam strokes along the near shore
    for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(200,180,255,${0.06 + r() * 0.1})`; g.fillRect(340 + r() * 940, 494 + r() * 12, 8 + r() * 30, 1); }
    // cliff under the lighthouse
    const cl = g.createLinearGradient(0, 392, 0, 520);
    cl.addColorStop(0, '#1c2350'); cl.addColorStop(1, '#0f1433');
    g.fillStyle = cl;
    g.beginPath(); g.moveTo(0, 408); g.quadraticCurveTo(120, 390, 210, 428); g.quadraticCurveTo(300, 468, 362, 520); g.lineTo(0, 520); g.closePath(); g.fill();
    g.strokeStyle = 'rgba(170,190,255,.32)'; g.lineWidth = 1.4;
    g.beginPath(); g.moveTo(0, 408); g.quadraticCurveTo(120, 390, 210, 428); g.quadraticCurveTo(300, 468, 362, 520); g.stroke();
    g.strokeStyle = 'rgba(5,8,30,.5)'; g.lineWidth = 1;
    for (let i = 0; i < 9; i++) { const x = 20 + r() * 300, y = 425 + r() * 70; g.beginPath(); g.moveTo(x, y); g.lineTo(x + 8 + r() * 14, y + 6 + r() * 10); g.lineTo(x + 4 + r() * 20, y + 20); g.stroke(); }

    // road / ground
    const top = (x) => 512 + Math.sin(x * 0.004) * 3 - x * 0.002;
    const gr = g.createLinearGradient(0, 500, 0, 720);
    gr.addColorStop(0, '#36407a'); gr.addColorStop(0.1, '#2a3266'); gr.addColorStop(0.45, '#181f48'); gr.addColorStop(1, '#090c22');
    g.fillStyle = gr;
    g.beginPath(); g.moveTo(0, top(0)); for (let x = 0; x <= 1280; x += 40) g.lineTo(x, top(x)); g.lineTo(1280, 720); g.lineTo(0, 720); g.closePath(); g.fill();
    // lit edge
    g.strokeStyle = 'rgba(175,205,255,.42)'; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(0, top(0)); for (let x = 0; x <= 1280; x += 40) g.lineTo(x, top(x)); g.stroke();
    // stone path with perspective rows
    const rows = [[524, 13], [539, 15], [556, 17], [575, 19], [596, 21]];
    rows.forEach(([y, h], ri) => {
      let x = -r() * 70;
      while (x < 1290) {
        const w = 46 + ri * 8 + r() * 46;
        g.fillStyle = `rgba(150,172,240,${0.05 + r() * 0.05 - ri * 0.006})`;
        rr(g, x + 1, y, w - 5, h - 3, 5); g.fill();
        g.fillStyle = `rgba(200,215,255,${0.05 - ri * 0.007})`;
        g.fillRect(x + 4, y + 1, w - 11, 1);
        x += w;
      }
    });
    // light pooling on the road (moon + lamp)
    glow(g, 1000, 560, 260, 'rgba(160,170,255,A)', 0.06);
    glow(g, 230, 560, 220, 'rgba(255,215,150,A)', 0.07);
    // grass tufts & dream flowers along the edge
    for (let i = 0; i < 120; i++) {
      const x = r() * 1280, y = top(x) + 2 + r() * 6;
      const hgt = 4 + r() * 8, col = r() < 0.5 ? 'rgba(120,160,225,.55)' : 'rgba(80,110,190,.6)';
      g.strokeStyle = col; g.lineWidth = 1;
      for (let j = -1; j <= 1; j++) { g.beginPath(); g.moveTo(x + j * 1.5, y + 3); g.quadraticCurveTo(x + j * 2, y - hgt * 0.5, x + j * 3.5 + (r() - 0.5) * 2, y - hgt); g.stroke(); }
      if (r() < 0.22) {
        const gold = r() < 0.3;
        g.fillStyle = gold ? 'rgba(255,225,150,.95)' : 'rgba(175,235,255,.95)';
        circ(g, x + 1, y - hgt, 1.4); g.fill();
        glow(g, x + 1, y - hgt, 6, gold ? 'rgba(255,215,140,A)' : 'rgba(160,225,255,A)', 0.4);
      }
    }
    // small dream crystals
    function crystal(x, y, s) {
      for (let i = -1; i <= 1; i++) {
        const h = s * (i === 0 ? 1 : 0.62), w = s * 0.28;
        g.save(); g.translate(x + i * s * 0.32, y); g.rotate(i * 0.32);
        g.fillStyle = 'rgba(120,190,245,.55)'; g.beginPath(); g.moveTo(-w, 0); g.lineTo(-w * 0.8, -h * 0.75); g.lineTo(0, -h); g.lineTo(w * 0.8, -h * 0.75); g.lineTo(w, 0); g.closePath(); g.fill();
        g.fillStyle = 'rgba(220,245,255,.5)'; g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -h); g.lineTo(w * 0.8, -h * 0.75); g.lineTo(w, 0); g.closePath(); g.fill();
        g.restore();
      }
      glow(g, x, y - s * 0.5, s * 1.6, 'rgba(140,210,255,A)', 0.25);
    }
    crystal(262, 516, 12); crystal(612, 512, 9); crystal(905, 510, 10); crystal(1190, 509, 8);
    // foreground lip (depth)
    g.fillStyle = 'rgba(4,6,18,.55)';
    g.beginPath(); g.moveTo(0, 668); for (let x = 0; x <= 1280; x += 32) g.lineTo(x, 664 + Math.sin(x * 0.02) * 4 + r() * 3); g.lineTo(1280, 720); g.lineTo(0, 720); g.closePath(); g.fill();
    g.strokeStyle = 'rgba(10,14,40,.9)'; g.lineWidth = 1.2;
    for (let i = 0; i < 70; i++) { const x = r() * 1280, y = 668 + r() * 6; g.beginPath(); g.moveTo(x, y + 6); g.quadraticCurveTo(x + 1, y - 6, x + (r() - 0.5) * 8, y - 12 - r() * 10); g.stroke(); }
    // vignette (lower part)
    vignette(g);
    return c;
  }

  function drawBackground(ctx, t, k) {
    if (!skyCache || bgScale !== k) {
      skyCache = buildSky(k); islandNear = buildIslands(k, 1); groundCache = buildGround(k);
      // far isles never move much → bake them into the sky layer (one less full-width blit per frame)
      // the road/cliff never moves either → bake it in too; only the near isles + mist are drawn live
      const far = buildIslands(k, 0), sg = skyCache.getContext('2d');
      sg.setTransform(1, 0, 0, 1, 0, 0); sg.drawImage(far, 0, ISL_Y0 * k); sg.drawImage(groundCache, 0, GND_Y0 * k);
      groundCache = null;
      cloudSprite = buildCloudSprite(); mistSprite = buildMistSprite(); bgScale = k;
    }
    ctx.drawImage(skyCache, 0, 0, 1280, 720);
    // twinkling stars
    ctx.fillStyle = '#e8f0ff';
    for (let i = 0; i < stars.length; i++) {
      const s = stars[i];
      ctx.globalAlpha = (0.3 + 0.7 * (0.5 + 0.5 * Math.sin(t * s.sp + s.p))) * 0.85;
      ctx.fillRect(s.x, s.y, s.s, s.s);
    }
    ctx.globalAlpha = 1;
    // a shooting star every ~13s
    const sp = t % 13;
    if (sp < 0.9) {
      const f = sp / 0.9, x = 520 + f * 260, y = 60 + f * 70;
      ctx.strokeStyle = `rgba(230,240,255,${Math.sin(f * Math.PI) * 0.7})`; ctx.lineWidth = 1.3;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 46, y - 12.4); ctx.stroke();
    }
    // slow cloud wisps (far parallax)
    for (let i = 0; i < 3; i++) {
      const w = 420 + i * 120, x = ((t * (4 + i * 2.5) + i * 520) % (1280 + w)) - w;
      ctx.globalAlpha = 0.55 - i * 0.1;
      ctx.drawImage(cloudSprite, x, 190 + i * 70, w, 70 + i * 10);
    }
    ctx.globalAlpha = 1;
    // floating isles bob gently at two depths
    ctx.drawImage(islandNear, 0, ISL_Y0 + Math.sin(t * 0.28 + 1.3) * 3.5, 1280, ISL_H);
    // drifting violet mist over the sea of Oblivion
    ctx.globalAlpha = 0.75;
    for (let i = 0; i < 5; i++) {
      const w = 420 + (i % 3) * 120, x = ((t * (7 + i * 2.2) + i * 300) % (1500 + w)) - w + 200;
      ctx.drawImage(mistSprite, x, 414 + i * 8, w, 64);
    }
    ctx.globalAlpha = 1;
    // sea sparkle glints (stronger near the moon path)
    for (let i = 0; i < 18; i++) {
      const ph = (t * 0.6 + i * 0.37) % 1;
      const x = i < 8 ? 985 + ((i * 37.3) % 54) - 4 : 400 + ((i * 97.3) % 860);
      const y = 458 + ((i * 31.7) % 40);
      ctx.fillStyle = `rgba(240,225,255,${(Math.sin(ph * Math.PI) * (i < 8 ? 0.85 : 0.5)).toFixed(2)})`;
      ctx.fillRect(x, y, i < 8 ? 5 : 3, 1);
    }
    // dream motes drifting up from the grass
    for (let i = 0; i < motesBG.length; i++) {
      const m = motesBG[i], ph = (t * m.sp + m.p) % 1;
      const x = m.x + Math.sin(t * 0.8 + m.sw) * 8, y = 512 - ph * 150;
      const a = Math.sin(ph * Math.PI) * 0.75;
      ctx.fillStyle = m.gold ? '#ffe1a0' : '#aae6ff';
      ctx.globalAlpha = a; ctx.fillRect(x - 1, y - 1, 2, 2);
      ctx.globalAlpha = a * 0.25; ctx.fillRect(x - 2.5, y - 2.5, 5, 5);
    }
    ctx.globalAlpha = 1;
  }

  // =====================================================================
  //  LIGHTHOUSE "追憶の灯"
  // =====================================================================
  const LH = { x: 95, base: 600, top: 168, lampY: 132 };
  const LHC = { x0: 0, y0: 40, w: 200, h: 585 };
  let lhCache = null, lhK = 0;
  const TBW = 58, TTW = 36;
  function towerPath(ctx) {
    const x = LH.x, by = LH.base - 36, ty = LH.top;
    ctx.beginPath(); ctx.moveTo(x - TBW, by); ctx.lineTo(x - TTW, ty); ctx.lineTo(x + TTW, ty); ctx.lineTo(x + TBW, by); ctx.closePath();
  }
  function buildLighthouse(k) {
    const c = mkCanvas(LHC.w * k, LHC.h * k), g = c.getContext('2d');
    g.scale(k, k); g.translate(-LHC.x0, -LHC.y0);
    g.lineJoin = 'round';
    const x = LH.x, by = LH.base - 36, ty = LH.top;
    const r = rng(3);

    // rock base (layered, moonlit tops)
    function rock(pts, col, lit) {
      g.fillStyle = col; g.beginPath(); g.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
      g.closePath(); g.fill();
      if (lit) { g.strokeStyle = lit; g.lineWidth = 1.4; g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length - 2; i++) g.lineTo(pts[i][0], pts[i][1]); g.stroke(); }
    }
    rock([[x - 92, 614], [x - 88, 576], [x - 64, 556], [x - 30, 552], [x - 6, 560], [x - 6, 614]], '#1a2148', 'rgba(160,180,250,.35)');
    rock([[x - 20, 614], [x - 14, 566], [x + 22, 552], [x + 60, 556], [x + 84, 574], [x + 94, 614]], '#1d254f', 'rgba(170,190,255,.4)');
    rock([[x - 70, 616], [x - 60, 590], [x - 30, 582], [x + 4, 590], [x + 10, 616]], '#141a3c', 'rgba(150,170,240,.25)');
    rock([[x + 30, 616], [x + 40, 594], [x + 70, 590], [x + 90, 600], [x + 96, 616]], '#161c40', 'rgba(150,170,240,.25)');
    for (let i = 0; i < 16; i++) { const gx = x - 80 + r() * 170, gy = 556 + r() * 10; g.strokeStyle = 'rgba(110,150,220,.5)'; g.lineWidth = 1; g.beginPath(); g.moveTo(gx, gy + 4); g.lineTo(gx + (r() - 0.5) * 4, gy - 3 - r() * 4); g.stroke(); }

    // tower body
    const body = g.createLinearGradient(x - TBW, 0, x + TBW, 0);
    body.addColorStop(0, '#6f779f'); body.addColorStop(0.22, '#d9d7d6'); body.addColorStop(0.42, '#f6f2e8');
    body.addColorStop(0.62, '#e9e3d6'); body.addColorStop(0.86, '#a6abc6'); body.addColorStop(1, '#6a7199');
    g.fillStyle = body; towerPath(g); g.fill();
    // warm light from the lamp washing the top
    g.save(); towerPath(g); g.clip();
    const warm = g.createLinearGradient(0, ty, 0, ty + 160);
    warm.addColorStop(0, 'rgba(255,220,150,.28)'); warm.addColorStop(1, 'rgba(255,220,150,0)');
    g.fillStyle = warm; g.fillRect(x - TBW, ty, TBW * 2, 160);
    // stone courses
    for (let y = ty + 14; y < by; y += 16) {
      const f = (y - ty) / (by - ty), hw = TTW + (TBW - TTW) * f;
      g.strokeStyle = 'rgba(110,105,130,.16)'; g.lineWidth = 1;
      g.beginPath(); g.moveTo(x - hw, y); g.lineTo(x + hw, y); g.stroke();
      const off = ((y / 16) | 0) % 2 ? 0 : 9;
      for (let sx = -hw + off; sx < hw; sx += 18) { g.beginPath(); g.moveTo(x + sx, y); g.lineTo(x + sx, y + 16); g.stroke(); }
    }
    // base plinth
    g.fillStyle = 'rgba(70,72,110,.35)'; g.fillRect(x - TBW, by - 14, TBW * 2, 14);
    g.restore();
    // outline
    g.strokeStyle = 'rgba(40,44,90,.85)'; g.lineWidth = 1.6; towerPath(g); g.stroke();
    // plinth cap
    g.fillStyle = '#b8924a'; g.fillRect(x - TBW - 3, by - 16, TBW * 2 + 6, 4); g.fillStyle = '#f1d58f'; g.fillRect(x - TBW - 3, by - 16, TBW * 2 + 6, 1.4);

    // gold bands with geometric ornament
    for (let i = 0; i < 3; i++) {
      const fy = by - (i + 1) * (by - ty) / 4, f = (fy - ty) / (by - ty), hw = TTW + (TBW - TTW) * f + 1.5;
      const bg = g.createLinearGradient(0, fy - 6, 0, fy + 6);
      bg.addColorStop(0, '#f6dd9a'); bg.addColorStop(0.45, '#d8b064'); bg.addColorStop(1, '#8a6a32');
      g.fillStyle = bg; g.fillRect(x - hw, fy - 6, hw * 2, 12);
      g.fillStyle = 'rgba(40,30,20,.35)'; g.fillRect(x - hw, fy + 5, hw * 2, 1.5);
      // diamonds and dots
      g.fillStyle = '#6e5228';
      for (let d = -hw + 7; d < hw - 4; d += 11) {
        g.beginPath(); g.moveTo(x + d, fy - 3.5); g.lineTo(x + d + 3.5, fy); g.lineTo(x + d, fy + 3.5); g.lineTo(x + d - 3.5, fy); g.closePath(); g.fill();
      }
      g.fillStyle = '#fff2c4';
      for (let d = -hw + 12.5; d < hw - 4; d += 11) { g.fillRect(x + d - 0.8, fy - 0.8, 1.6, 1.6); }
    }
    // arched windows
    function win(wx, wy, w, h) {
      glow(g, wx, wy + h * 0.5, 22, 'rgba(255,205,130,A)', 0.35);
      g.fillStyle = '#3a2f4a'; rr(g, wx - w / 2 - 2.5, wy - 2.5, w + 5, h + 5, [w / 2 + 2.5, w / 2 + 2.5, 1, 1]); g.fill();
      const wg = g.createLinearGradient(0, wy, 0, wy + h);
      wg.addColorStop(0, '#fff2c8'); wg.addColorStop(1, '#f2b660');
      g.fillStyle = wg; rr(g, wx - w / 2, wy, w, h, [w / 2, w / 2, 0, 0]); g.fill();
      g.strokeStyle = '#d8b064'; g.lineWidth = 1.2; rr(g, wx - w / 2 - 2.5, wy - 2.5, w + 5, h + 5, [w / 2 + 2.5, w / 2 + 2.5, 1, 1]); g.stroke();
      g.strokeStyle = 'rgba(90,60,40,.6)'; g.lineWidth = 0.8; g.beginPath(); g.moveTo(wx, wy + 2); g.lineTo(wx, wy + h); g.moveTo(wx - w / 2, wy + h * 0.55); g.lineTo(wx + w / 2, wy + h * 0.55); g.stroke();
      g.fillStyle = '#d8b064'; g.fillRect(wx - w / 2 - 4, wy + h + 2, w + 8, 2.5);
    }
    win(x, by - 160, 10, 18); win(x, by - 268, 9, 15); win(x, by - 362, 8, 13);
    // circular crest above the door (shared motif)
    const cy = by - 70;
    glow(g, x, cy, 20, 'rgba(255,215,140,A)', 0.25);
    g.fillStyle = '#2a2f58'; circ(g, x, cy, 12); g.fill();
    g.strokeStyle = '#e8c47a'; g.lineWidth = 2; circ(g, x, cy, 12); g.stroke();
    g.lineWidth = 1; circ(g, x, cy, 8.5); g.stroke();
    for (let i = 0; i < 12; i++) { const a = i * TAU / 12; g.beginPath(); g.moveTo(x + Math.cos(a) * 8.5, cy + Math.sin(a) * 8.5); g.lineTo(x + Math.cos(a) * 12, cy + Math.sin(a) * 12); g.stroke(); }
    g.fillStyle = '#f2d58f'; g.beginPath(); g.moveTo(x, cy - 5.5); g.lineTo(x + 4, cy); g.lineTo(x, cy + 5.5); g.lineTo(x - 4, cy); g.closePath(); g.fill();
    g.fillStyle = '#2a2f58'; circ(g, x, cy, 1.6); g.fill();
    // door
    g.fillStyle = '#d8b064'; rr(g, x - 16, by - 50, 32, 50, [16, 16, 0, 0]); g.fill();
    g.fillStyle = '#232850'; rr(g, x - 13, by - 47, 26, 47, [13, 13, 0, 0]); g.fill();
    g.strokeStyle = 'rgba(120,130,190,.35)'; g.lineWidth = 1; g.beginPath(); g.moveTo(x, by - 46); g.lineTo(x, by); g.stroke();
    for (let yy = by - 36; yy < by; yy += 9) { g.beginPath(); g.moveTo(x - 12, yy); g.lineTo(x + 12, yy); g.stroke(); }
    const dg = g.createLinearGradient(0, by - 10, 0, by);
    dg.addColorStop(0, 'rgba(255,200,120,0)'); dg.addColorStop(1, 'rgba(255,200,120,.55)');
    g.fillStyle = dg; g.fillRect(x - 13, by - 10, 26, 10);
    g.fillStyle = '#f2d58f'; circ(g, x + 7, by - 22, 1.6); g.fill();
    // steps
    g.fillStyle = '#9da2c0'; g.fillRect(x - 22, by, 44, 4); g.fillStyle = '#80869f'; g.fillRect(x - 26, by + 4, 52, 4);

    // gallery
    g.fillStyle = '#232a56'; g.beginPath(); g.moveTo(x - 50, ty - 6); g.lineTo(x + 50, ty - 6); g.lineTo(x + 40, ty + 4); g.lineTo(x - 40, ty + 4); g.closePath(); g.fill();
    g.fillStyle = '#e8c47a'; g.fillRect(x - 50, ty - 7, 100, 2.2);
    g.fillStyle = '#b8924a'; for (let i = -36; i <= 36; i += 12) { g.beginPath(); g.moveTo(x + i - 3, ty - 4.8); g.lineTo(x + i + 3, ty - 4.8); g.lineTo(x + i, ty + 2); g.closePath(); g.fill(); }
    g.strokeStyle = '#d8b064'; g.lineWidth = 1.6;
    g.beginPath(); g.moveTo(x - 48, ty - 7); g.lineTo(x - 48, ty - 22); g.lineTo(x + 48, ty - 22); g.lineTo(x + 48, ty - 7); g.stroke();
    g.lineWidth = 1.1; for (let i = -40; i <= 40; i += 8) { g.beginPath(); g.moveTo(x + i, ty - 7); g.lineTo(x + i, ty - 22); g.stroke(); }
    g.beginPath(); g.moveTo(x - 48, ty - 14); g.lineTo(x + 48, ty - 14); g.stroke();
    // lantern room frame (glass is drawn live)
    g.fillStyle = '#1c2148'; g.fillRect(x - 27, ty - 58, 54, 38);
    g.fillStyle = '#ffd890'; g.fillRect(x - 22, ty - 52, 44, 28);
    g.fillStyle = '#d8b064'; g.fillRect(x - 28, ty - 24, 56, 3); g.fillRect(x - 28, ty - 59, 56, 3);
    // roof dome
    const rf = g.createLinearGradient(x - 36, 0, x + 36, 0);
    rf.addColorStop(0, '#141838'); rf.addColorStop(0.55, '#262d60'); rf.addColorStop(0.8, '#3a4382'); rf.addColorStop(1, '#1b2048');
    g.fillStyle = rf;
    g.beginPath(); g.moveTo(x - 36, ty - 56); g.bezierCurveTo(x - 34, ty - 84, x - 10, ty - 96, x, ty - 96); g.bezierCurveTo(x + 10, ty - 96, x + 34, ty - 84, x + 36, ty - 56); g.closePath(); g.fill();
    g.strokeStyle = '#c9a457'; g.lineWidth = 1.2;
    for (let i = -2; i <= 2; i++) { g.beginPath(); g.moveTo(x + i * 14, ty - 57); g.quadraticCurveTo(x + i * 9, ty - 84, x, ty - 95); g.stroke(); }
    g.fillStyle = '#e8c47a'; g.fillRect(x - 38, ty - 59, 76, 3.5);
    g.fillStyle = '#fff0bf'; g.fillRect(x - 38, ty - 59, 76, 1);
    // finial
    g.fillStyle = '#e8c47a'; circ(g, x, ty - 99, 4.5); g.fill();
    g.fillStyle = '#fff3c8'; circ(g, x - 1.3, ty - 100.3, 1.6); g.fill();
    g.fillStyle = '#e8c47a'; g.beginPath(); g.moveTo(x - 1.6, ty - 103); g.lineTo(x, ty - 116); g.lineTo(x + 1.6, ty - 103); g.closePath(); g.fill();
    return c;
  }

  function drawLighthouse(ctx, t, hpRatio, flash, glowBoost) {
    const x = LH.x, ty = LH.top, by = LH.base - 36;
    const tf = ctx.getTransform ? ctx.getTransform() : null;
    const k = tf ? Math.max(1, Math.min(3, Math.round(Math.hypot(tf.a, tf.b) * 2) / 2)) : 2;
    if (!lhCache || lhK !== k) { lhCache = buildLighthouse(k); lhK = k; }
    const flick = hpRatio < 0.3 ? (0.55 + 0.45 * Math.abs(Math.sin(t * 13) * Math.sin(t * 5.3))) : 1;
    const gb = glowBoost || 0;
    // beam (behind the tower): soft wide cone + bright core
    const sweep = Math.sin(t * 0.6) * 0.12;
    ctx.save();
    ctx.translate(x, LH.lampY); ctx.rotate(sweep);
    ctx.globalCompositeOperation = 'lighter';
    const beam = ctx.createLinearGradient(0, 0, 950, 0);
    beam.addColorStop(0, `rgba(255,232,175,${(0.2 * flick + gb * 0.16).toFixed(3)})`);
    beam.addColorStop(0.45, `rgba(255,232,175,${(0.06 * flick + gb * 0.05).toFixed(3)})`);
    beam.addColorStop(1, 'rgba(255,232,175,0)');
    ctx.fillStyle = beam;
    ctx.beginPath(); ctx.moveTo(0, -10); ctx.lineTo(950, -105); ctx.lineTo(950, 85); ctx.lineTo(0, 10); ctx.closePath(); ctx.fill();
    const core = ctx.createLinearGradient(0, 0, 560, 0);
    core.addColorStop(0, `rgba(255,246,215,${(0.2 * flick + gb * 0.2).toFixed(3)})`); core.addColorStop(1, 'rgba(255,246,215,0)');
    ctx.fillStyle = core;
    ctx.beginPath(); ctx.moveTo(0, -4); ctx.lineTo(560, -28); ctx.lineTo(560, 18); ctx.lineTo(0, 4); ctx.closePath(); ctx.fill();
    ctx.restore();
    // wide glow behind
    sglow(ctx, x, LH.lampY, 150 + gb * 70, '255,215,140', (0.42 + gb * 0.3) * flick);

    ctx.drawImage(lhCache, LHC.x0, LHC.y0, LHC.w, LHC.h);

    // lantern glass: warm core + rotating lens band
    const gx = x - 22, gy = ty - 52, gw = 44, gh = 28;
    ctx.fillStyle = `rgba(255,${(200 + 30 * flick) | 0},130,1)`; ctx.fillRect(gx, gy, gw, gh);
    ctx.fillStyle = `rgba(255,250,230,${(0.75 * flick).toFixed(3)})`;
    ctx.fillRect(x - 9, gy + 4, 18, gh - 8);
    const lens = Math.sin(t * 2.2);
    ctx.fillStyle = `rgba(255,255,255,${(0.85 * flick).toFixed(3)})`;
    ctx.fillRect(x + lens * 16 - 3 * (1 - Math.abs(lens)) - 1.5, gy + 2, 3 + 5 * (1 - Math.abs(lens)), gh - 4);
    ctx.strokeStyle = '#1c2148'; ctx.lineWidth = 2;
    ctx.beginPath(); for (let i = -11; i <= 11; i += 11) { ctx.moveTo(x + i, gy); ctx.lineTo(x + i, gy + gh); } ctx.stroke();
    // halo over the lamp
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    sglow(ctx, x, LH.lampY, 46 + gb * 20, '255,225,160', (0.55 + gb * 0.4) * flick);
    ctx.restore();

    // damage flash
    if (flash > 0) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = flash * 0.6;
      ctx.fillStyle = '#ff6f8a'; towerPath(ctx); ctx.fill();
      ctx.restore();
    }
    // cracks as HP drops (with faint ink seeping from them)
    if (hpRatio < 0.66) {
      ctx.strokeStyle = 'rgba(40,36,70,.8)'; ctx.lineWidth = 1.6; ctx.lineJoin = 'round';
      ctx.beginPath(); ctx.moveTo(x - 34, by - 90); ctx.lineTo(x - 22, by - 108); ctx.lineTo(x - 28, by - 124); ctx.lineTo(x - 20, by - 138); ctx.moveTo(x - 22, by - 108); ctx.lineTo(x - 12, by - 112); ctx.stroke();
      if (hpRatio < 0.33) {
        ctx.beginPath(); ctx.moveTo(x + 24, by - 190); ctx.lineTo(x + 10, by - 210); ctx.lineTo(x + 18, by - 236); ctx.lineTo(x + 6, by - 258); ctx.moveTo(x + 10, by - 210); ctx.lineTo(x + 26, by - 218); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x - 10, by - 330); ctx.lineTo(x - 2, by - 346); ctx.lineTo(x - 8, by - 360); ctx.stroke();
        ctx.fillStyle = 'rgba(60,30,90,.35)'; rr(ctx, x - 29, by - 124, 2.5, 12 + Math.sin(t * 1.5) * 3, 1.2); ctx.fill();
      }
    }
  }

  // =====================================================================
  //  COMMANDER (主人公：フードの防衛人形)
  // =====================================================================
  function drawCommander(ctx, x, y, t, cast) {
    ctx.save(); ctx.translate(x, y);
    ctx.lineJoin = 'round';
    const br = Math.sin(t * 2) * 0.9;           // breathing
    const lift = cast > 0 ? ease(Math.min(1, cast * 3)) : 0;
    // shadow
    ctx.fillStyle = 'rgba(0,0,14,.4)'; ell(ctx, 0, 1, 19, 4.5); ctx.fill();
    // pale-cyan light motes (behind)
    for (let i = 0; i < 7; i++) {
      const a = t * 0.7 + i * 0.9, rad = 24 + Math.sin(t * 1.1 + i * 2) * 5;
      const mx = Math.cos(a) * rad, my = -46 + Math.sin(a) * rad * 0.55 + Math.sin(t * 2 + i) * 3;
      if (Math.sin(a) < 0) { const al = 0.35 + 0.3 * Math.sin(t * 3 + i); sglow(ctx, mx, my, 5, '160,230,255', al); ctx.fillStyle = `rgba(215,248,255,${al.toFixed(2)})`; ctx.fillRect(mx - 0.8, my - 0.8, 1.6, 1.6); }
    }
    // legs: dark slim trousers + white-silver boots
    bone(ctx, -3.5, -20, -4, -5, 4, '#1b2042', INK, 2.2);
    bone(ctx, 3.5, -20, 4, -5, 4, '#232a52', INK, 2.2);
    for (const bx of [-4, 4]) {
      ctx.beginPath(); ctx.moveTo(bx - 3, -8); ctx.lineTo(bx + 2.5, -8); ctx.quadraticCurveTo(bx + 4, -3, bx + 7, -2); ctx.quadraticCurveTo(bx + 7.5, 0.5, bx + 5, 0.5); ctx.lineTo(bx - 3.5, 0.5); ctx.closePath();
      fo(ctx, bx < 0 ? '#c9d1e2' : '#e4e9f3', 1.2);
      ctx.fillStyle = 'rgba(255,255,255,.7)'; ctx.fillRect(bx - 2, -7, 3, 1);
    }
    // back sleeve (ivory, wide)
    ctx.beginPath(); ctx.moveTo(-9, -53 + br); ctx.quadraticCurveTo(-15, -44, -16, -32); ctx.lineTo(-8, -31); ctx.quadraticCurveTo(-6, -42, -4, -50 + br); ctx.closePath();
    fo(ctx, '#d9d1c2', 1.2);
    // coat: deep navy → blue-grey, flared hem
    ctx.beginPath();
    ctx.moveTo(-10, -55 + br);
    ctx.bezierCurveTo(-14, -45, -18, -30, -20, -15);
    ctx.quadraticCurveTo(-2, -12, 17, -16);
    ctx.bezierCurveTo(15, -30, 13, -45, 10, -55 + br);
    ctx.closePath();
    fo(ctx, lgc(ctx, 'cmd-coat', 0, -56, 0, -14, [[0, '#1d295a'], [0.6, '#2f3f72'], [1, '#56678f']]), 1.4);
    // coat shading on the back half
    ctx.fillStyle = 'rgba(8,10,40,.28)';
    ctx.beginPath(); ctx.moveTo(-10, -54 + br); ctx.bezierCurveTo(-14, -45, -18, -30, -20, -15); ctx.quadraticCurveTo(-12, -13.5, -6, -13.5); ctx.bezierCurveTo(-8, -30, -7, -45, -4, -54); ctx.closePath(); ctx.fill();
    // front placket + silver geometric hem trim
    ctx.strokeStyle = '#c4cfe6'; ctx.lineWidth = 1.1;
    ctx.beginPath(); ctx.moveTo(8, -47 + br); ctx.lineTo(10, -16); ctx.stroke();
    ctx.lineWidth = 1.3; ctx.beginPath(); ctx.moveTo(-19.2, -18.2); ctx.quadraticCurveTo(-2, -15.4, 16.4, -19); ctx.stroke();
    ctx.lineWidth = 0.9; ctx.beginPath();
    for (let i = 0; i < 6; i++) { const hx = -16 + i * 5.6, hy = -16.7 - i * 0.12; ctx.moveTo(hx, hy); ctx.lineTo(hx + 2.8, hy - 2.6); ctx.lineTo(hx + 5.6, hy); }
    ctx.stroke();
    // shoulder mantle edge (silver)
    ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(-12, -47 + br); ctx.quadraticCurveTo(0, -42 + br, 12, -47 + br); ctx.stroke();
    ctx.fillStyle = '#c4cfe6'; for (let i = -1; i <= 1; i++) { ctx.beginPath(); ctx.moveTo(i * 7, -44.5 + br - Math.abs(i) * 1.2); ctx.lineTo(i * 7 + 1.4, -43 + br - Math.abs(i) * 1.2); ctx.lineTo(i * 7, -41.5 + br - Math.abs(i) * 1.2); ctx.lineTo(i * 7 - 1.4, -43 + br - Math.abs(i) * 1.2); ctx.fill(); }
    // geometric chest emblem
    const ey = -35 + br;
    ctx.strokeStyle = '#d4dcef'; ctx.lineWidth = 1.1; circ(ctx, 2, ey, 3.8); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(2, ey - 3); ctx.lineTo(4.6, ey); ctx.lineTo(2, ey + 3); ctx.lineTo(-0.6, ey); ctx.closePath(); ctx.stroke();
    ctx.fillStyle = '#bff0ff'; ctx.fillRect(1.2, ey - 0.8, 1.6, 1.6);
    sglow(ctx, 2, ey, 6, '150,225,255', 0.35 + lift * 0.4);
    // ivory high collar
    ctx.beginPath(); ctx.moveTo(-7, -57 + br); ctx.lineTo(-5, -50 + br); ctx.lineTo(2, -47 + br); ctx.lineTo(10, -51 + br); ctx.lineTo(10, -57 + br); ctx.closePath();
    fo(ctx, '#f1eadc', 1.1);
    ctx.strokeStyle = 'rgba(150,160,190,.8)'; ctx.lineWidth = 0.7; ctx.beginPath(); ctx.moveTo(2, -47 + br); ctx.lineTo(3, -55 + br); ctx.stroke();

    // hood: large & deep, eyes always hidden
    const hb = br * 1.05;
    ctx.beginPath();
    ctx.moveTo(-14, -54 + hb);
    ctx.bezierCurveTo(-21, -64 + hb, -18, -84 + hb, -5, -88 + hb);
    ctx.bezierCurveTo(5, -91 + hb, 13, -86 + hb, 15, -79 + hb);
    ctx.bezierCurveTo(17.5, -72 + hb, 17, -63 + hb, 14.5, -56 + hb);
    ctx.quadraticCurveTo(10, -51 + hb, 3, -51.5 + hb);
    ctx.closePath();
    fo(ctx, lgc(ctx, 'cmd-hood', -18, -88, 16, -56, [[0, '#18234f'], [0.7, '#2a3a70'], [1, '#34467c']]), 1.4);
    // fold line on the hood
    ctx.strokeStyle = 'rgba(8,10,36,.55)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(-12, -60 + hb); ctx.quadraticCurveTo(-11, -76 + hb, -2, -84 + hb); ctx.stroke();
    // deep opening (shadow)
    ctx.beginPath();
    ctx.moveTo(13.6, -78.5 + hb);
    ctx.bezierCurveTo(6, -78 + hb, 3, -70 + hb, 4, -60 + hb);
    ctx.quadraticCurveTo(8, -54 + hb, 13.5, -56.5 + hb);
    ctx.bezierCurveTo(16, -63 + hb, 16.3, -72 + hb, 13.6, -78.5 + hb);
    ctx.fillStyle = '#070a20'; ctx.fill();
    // lower face: nose tip, mouth, chin only
    ctx.beginPath();
    ctx.moveTo(8, -64.5 + hb); ctx.lineTo(13.3, -64.5 + hb); ctx.lineTo(15, -62.2 + hb); ctx.lineTo(13.5, -61.4 + hb);
    ctx.quadraticCurveTo(14, -59.5 + hb, 13.1, -58.4 + hb); ctx.quadraticCurveTo(12, -56 + hb, 8.8, -56.6 + hb); ctx.quadraticCurveTo(6.6, -59.5 + hb, 8, -64.5 + hb);
    ctx.fillStyle = '#eadfd5'; ctx.fill();
    // hood shadow falling over the face top
    ctx.fillStyle = 'rgba(7,10,32,.75)'; ell(ctx, 10.5, -66.5 + hb, 6.5, 3.2, -0.1); ctx.fill();
    ctx.strokeStyle = 'rgba(150,110,120,.9)'; ctx.lineWidth = 0.7; ctx.beginPath(); ctx.moveTo(11.4, -59.7 + hb); ctx.lineTo(13.4, -59.9 + hb); ctx.stroke();
    // silver-grey hair tufts peeking out
    ctx.fillStyle = '#b9c2d4';
    ctx.beginPath(); ctx.moveTo(6.5, -76 + hb); ctx.lineTo(12.6, -77.5 + hb); ctx.lineTo(11.2, -71 + hb); ctx.lineTo(9.6, -74 + hb); ctx.lineTo(8, -69.5 + hb); ctx.lineTo(7.2, -73 + hb); ctx.lineTo(5.4, -70 + hb); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#dfe5ef'; ctx.beginPath(); ctx.moveTo(9, -76.5 + hb); ctx.lineTo(11.6, -77 + hb); ctx.lineTo(10.8, -73.5 + hb); ctx.closePath(); ctx.fill();
    // silver geometric trim on the hood edge
    ctx.strokeStyle = '#c9d3ea'; ctx.lineWidth = 1.3;
    ctx.beginPath(); ctx.moveTo(15, -79 + hb); ctx.bezierCurveTo(17.5, -72 + hb, 17, -63 + hb, 14.5, -56 + hb); ctx.stroke();
    ctx.fillStyle = '#e1e8f6';
    for (let i = 0; i < 3; i++) { const py = -75 + i * 7 + hb, px = 16.6 - Math.abs(i - 1) * 0.6; ctx.beginPath(); ctx.moveTo(px, py - 1.4); ctx.lineTo(px + 1.1, py); ctx.lineTo(px, py + 1.4); ctx.lineTo(px - 1.1, py); ctx.fill(); }

    // front arm: wide ivory sleeve; raised when casting
    ctx.save(); ctx.translate(7, -51 + br); ctx.rotate(0.12 - lift * 2.25);
    ctx.beginPath(); ctx.moveTo(-3.6, 0); ctx.lineTo(3.6, 0); ctx.lineTo(7, 18); ctx.quadraticCurveTo(0, 21, -6.5, 18); ctx.closePath();
    fo(ctx, '#f2ebde', 1.2);
    ctx.strokeStyle = '#b8c4dc'; ctx.lineWidth = 1.1; ctx.beginPath(); ctx.moveTo(-6, 16.5); ctx.quadraticCurveTo(0, 19.3, 6.6, 16.5); ctx.stroke();
    // doll hand with thin joint seams
    ctx.beginPath(); rr(ctx, -2.2, 18.6, 4.4, 6.2, 2); fo(ctx, '#efe4da', 0.9);
    ctx.strokeStyle = 'rgba(110,125,160,.95)'; ctx.lineWidth = 0.55;
    ctx.beginPath(); ctx.moveTo(-2.2, 20.4); ctx.lineTo(2.2, 20.4); ctx.moveTo(-0.6, 22.4); ctx.lineTo(-0.6, 24.6); ctx.moveTo(0.9, 22.4); ctx.lineTo(0.9, 24.6); ctx.stroke();
    if (lift > 0) {
      ctx.globalCompositeOperation = 'lighter';
      sglow(ctx, 0, 27, 22, '150,225,255', 0.85 * lift);
      ctx.save(); ctx.translate(0, 29); ctx.scale(1, 0.45); ctx.rotate(t * 3);
      ctx.strokeStyle = `rgba(190,240,255,${(0.8 * lift).toFixed(2)})`; ctx.lineWidth = 1;
      circ(ctx, 0, 0, 8); ctx.stroke();
      ctx.beginPath(); for (let i = 0; i < 4; i++) { const a = i * TAU / 4; ctx.moveTo(Math.cos(a) * 8, Math.sin(a) * 8); ctx.lineTo(Math.cos(a + TAU / 4) * 8, Math.sin(a + TAU / 4) * 8); } ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
    // motes in front
    for (let i = 0; i < 7; i++) {
      const a = t * 0.7 + i * 0.9, rad = 24 + Math.sin(t * 1.1 + i * 2) * 5;
      const mx = Math.cos(a) * rad, my = -46 + Math.sin(a) * rad * 0.55 + Math.sin(t * 2 + i) * 3;
      if (Math.sin(a) >= 0) { const al = 0.45 + 0.35 * Math.sin(t * 3 + i) + lift * 0.2; sglow(ctx, mx, my, 6, '160,230,255', al); ctx.fillStyle = `rgba(225,250,255,${Math.min(1, al).toFixed(2)})`; ctx.fillRect(mx - 0.9, my - 0.9, 1.8, 1.8); }
    }
    ctx.restore();
  }

  // =====================================================================
  //  UNITS
  // =====================================================================
  // u = { anim: seconds, walk: bool, atk: 0..1 (1 = just attacked), hurt: 0..1, aim, wind, dash }
  const SKIN = '#f8e5d4';

  function face(ctx, y, r, skin, t) {
    circ(ctx, 0, y, r); fo(ctx, skin, 1.4);
    ctx.fillStyle = 'rgba(255,120,130,.34)'; ell(ctx, 7, y + 4.3, 2.4, 1.4); ctx.fill(); ell(ctx, -0.5, y + 4.3, 1.6, 1.1); ctx.fill();
    const bl = (t % 3.4) < 0.11 ? 0.18 : 1;
    ctx.fillStyle = '#231b3a';
    ell(ctx, 7.3, y + 0.9, 1.35, 2.15 * bl); ctx.fill();
    ell(ctx, 1.6, y + 0.9, 1.15, 1.95 * bl); ctx.fill();
    if (bl === 1) { ctx.fillStyle = '#ffffff'; ctx.fillRect(7.4, y - 0.5, 0.9, 0.9); ctx.fillRect(1.7, y - 0.4, 0.8, 0.8); }
    ctx.strokeStyle = 'rgba(130,60,70,.85)'; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.arc(5, y + 5, 1.2, 0.25, Math.PI - 0.25); ctx.stroke();
  }
  function legs(ctx, u, o) {
    const ph = u.walk ? u.anim * o.freq : 0;
    const s = Math.sin(ph);
    for (const side of [-1, 1]) {
      const a = u.walk ? s * side * 0.55 : 0;
      ctx.save(); ctx.translate(side * o.spread, o.hip); ctx.rotate(a);
      bone(ctx, 0, 0, 0, -o.hip - 4.5, o.w || 4.6, side < 0 ? o.back : o.pants, INK, 2.4);
      ctx.beginPath(); ctx.moveTo(-3, -o.hip - 6); ctx.lineTo(2.5, -o.hip - 6); ctx.quadraticCurveTo(6, -o.hip - 4, 6, -o.hip - 1); ctx.lineTo(6, -o.hip + 0.2); ctx.lineTo(-3.2, -o.hip + 0.2); ctx.closePath();
      fo(ctx, side < 0 ? o.bootB : o.boot, 1.2);
      ctx.restore();
    }
  }
  function walkBob(u, f, amp) { return u.walk ? Math.abs(Math.cos(u.anim * f)) * amp : Math.sin(u.anim * 2.2) * 0.6; }

  // ---- nightmare minion helpers ----
  // ink body: fill, dark edge, violet rim (RIM turns gold-violet for elites)
  function eFill(ctx, fill, lw) {
    lw = lw || 2.4;
    ctx.fillStyle = fill; ctx.fill();
    ctx.strokeStyle = EINK; ctx.lineWidth = lw; ctx.stroke();
    ctx.strokeStyle = RIM; ctx.lineWidth = lw * 0.46; ctx.stroke();
  }
  function eGlow(ctx, x, y, r, a, rgb) { ctx.globalCompositeOperation = 'lighter'; sglow(ctx, x, y, r, rgb || '255,160,235', a); ctx.globalCompositeOperation = 'source-over'; }
  function eEye(ctx, x, y, rx, ry, rot) { ctx.fillStyle = '#ffd8f6'; ell(ctx, x, y, rx, ry, rot || 0); ctx.fill(); }
  // frayed, wavering hem appended to the current path (same feel as ほつれ影)
  function eHem(ctx, x0, x1, y, n, t, amp, seed) {
    for (let i = 1; i <= n; i++) {
      const x = x0 + (x1 - x0) * i / n;
      ctx.lineTo(x + Math.sin(t * 5 + i + seed) * 1.2, y + (i % 2 ? -amp : 1) + Math.sin(t * 7 + i * 1.7 + seed) * 2);
    }
  }
  function eLimb(ctx, x1, y1, cx, cy, x2, y2, w, col) {
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.quadraticCurveTo(cx, cy, x2, y2);
    ctx.strokeStyle = EINK; ctx.lineWidth = w + 2.2; ctx.stroke();
    ctx.strokeStyle = col; ctx.lineWidth = w; ctx.stroke();
    ctx.lineCap = 'butt';
  }
  const eBlink = (t, per) => ((t % per) < 0.12 ? 0.25 : 1);

  // little rag doll held by 人形遣い (centre at x,y): yarn hair, button eyes, stitched dress
  function plush(ctx, x, y, s, t) {
    ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
    const sw = Math.sin(t * 3) * 0.6;
    bone(ctx, -3, 3, -5.4, 7.6 + sw, 2.2, '#f3e3c8', INK, 2);
    bone(ctx, 2, 3, 2.6, 8, 2.2, '#f3e3c8', INK, 2);
    ctx.beginPath(); ctx.moveTo(-4, -1); ctx.lineTo(3.6, -1); ctx.lineTo(5.4, 6.4); ctx.quadraticCurveTo(0, 8, -5.6, 6.4); ctx.closePath(); fo(ctx, '#e88aa0', 1.1);
    ctx.save(); ctx.setLineDash([1, 0.9]); ctx.strokeStyle = 'rgba(120,40,60,.8)'; ctx.lineWidth = 0.55;
    ctx.beginPath(); ctx.moveTo(-4.6, 5.2); ctx.quadraticCurveTo(0, 6.6, 4.6, 5.2); ctx.stroke(); ctx.restore();
    ctx.beginPath(); ctx.moveTo(-4.8, -6.5); ctx.quadraticCurveTo(-7.4, -2, -5.6, 1.6); ctx.lineTo(-3, -2); ctx.closePath(); fo(ctx, '#f0a050', 0.9);
    circ(ctx, 0, -5, 4.6); fo(ctx, '#f3e3c8', 1.1);
    ctx.beginPath(); ctx.moveTo(-4.8, -5); ctx.quadraticCurveTo(-4, -10.4, 0.6, -9.8); ctx.quadraticCurveTo(4.6, -9.6, 4.8, -6); ctx.quadraticCurveTo(1, -7.4, -2, -6.4); ctx.quadraticCurveTo(-3.6, -5, -4.8, -5); ctx.closePath(); fo(ctx, '#f0a050', 0.9);
    ctx.fillStyle = '#4a3450'; circ(ctx, 2.8, -4.4, 1.05); ctx.fill(); circ(ctx, -0.2, -4.4, 0.9); ctx.fill();
    ctx.fillStyle = 'rgba(255,120,130,.45)'; circ(ctx, 3.4, -2.6, 0.9); ctx.fill();
    ctx.strokeStyle = '#8a4a50'; ctx.lineWidth = 0.55; ctx.beginPath(); ctx.moveTo(0.4, -2.2); ctx.lineTo(2.4, -2.2); ctx.stroke();
    ctx.restore();
  }

  const DRAW = {
    // ---------------- 剣士 ----------------
    swordsman(ctx, u) {
      const t = u.anim, sw = u.atk, pre = antic(u, 0.22);
      const bob = walkBob(u, 11, 2.2);
      legs(ctx, u, { hip: -17, spread: 3.4, pants: '#56405e', back: '#3f2e48', boot: '#7a4a2c', bootB: '#5e3820', freq: 11 });
      ctx.translate(0, -bob);
      // scarf tails (behind)
      const fl = Math.sin(t * (u.walk ? 15 : 6)) * 2.4, trail = u.walk ? 5 : 0;
      ctx.beginPath(); ctx.moveTo(-2, -37); ctx.bezierCurveTo(-9, -37 + fl * 0.3, -16 - trail, -35 + fl, -25 - trail, -31 + fl * 1.3);
      ctx.lineTo(-25 - trail, -26 + fl * 1.2); ctx.lineTo(-21 - trail, -28.5 + fl); ctx.bezierCurveTo(-14, -31 + fl * 0.5, -8, -32, -1, -33); ctx.closePath();
      fo(ctx, '#e0564e', 1.3);
      ctx.beginPath(); ctx.moveTo(-3, -35); ctx.quadraticCurveTo(-11, -30 - fl * 0.6, -18 - trail * 0.6, -24 - fl * 0.4); ctx.lineTo(-14 - trail * 0.6, -23); ctx.quadraticCurveTo(-8, -28, -2, -32); ctx.closePath();
      fo(ctx, '#b83f3d', 1.2);
      // back arm swinging
      const swing = u.walk ? Math.sin(t * 11) * 0.6 : 0.15;
      bone(ctx, -3, -32, -3 - Math.sin(swing) * 9, -32 + Math.cos(swing) * 9, 4, '#c4813f', INK, 2.4);
      circ(ctx, -3 - Math.sin(swing) * 10.5, -32 + Math.cos(swing) * 10.5, 2.3); fo(ctx, SKIN, 1);
      // tunic (amber) with flared hem
      ctx.beginPath(); ctx.moveTo(-7.5, -36); ctx.lineTo(7.5, -36); ctx.lineTo(10, -15); ctx.quadraticCurveTo(5, -13, 3, -15.5); ctx.quadraticCurveTo(0, -13, -3, -15.5); ctx.quadraticCurveTo(-6, -13, -10, -15); ctx.closePath();
      fo(ctx, '#eaa64f', 1.4);
      ctx.fillStyle = 'rgba(150,70,20,.28)'; ctx.beginPath(); ctx.moveTo(-7.5, -36); ctx.lineTo(-3, -36); ctx.lineTo(-4, -15); ctx.quadraticCurveTo(-6, -13, -10, -15); ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(255,230,170,.55)'; ctx.fillRect(3, -34, 2, 14);
      // leather strap + belt with gold buckle
      ctx.strokeStyle = '#6b4024'; ctx.lineWidth = 2.2; ctx.beginPath(); ctx.moveTo(-6, -35); ctx.lineTo(7, -22); ctx.stroke();
      ctx.fillStyle = '#6b4024'; ctx.fillRect(-9, -22, 18.5, 3.4);
      ctx.fillStyle = '#f0cf7e'; rr(ctx, 1.5, -22.6, 4.6, 4.6, 1); ctx.fill();
      // head + spiky chestnut hair
      const hy = -46;
      face(ctx, hy, 11.5, SKIN, t);
      ctx.beginPath();
      ctx.moveTo(-11.6, hy + 2.5);
      ctx.quadraticCurveTo(-13.5, hy - 9, -5, hy - 12.5);
      ctx.lineTo(-3, hy - 16.5); ctx.lineTo(0.5, hy - 12.6);
      ctx.lineTo(5, hy - 15.5); ctx.lineTo(6.5, hy - 10.5);
      ctx.quadraticCurveTo(11.5, hy - 9, 12.4, hy - 2.5);
      ctx.lineTo(9.5, hy - 4.2); ctx.lineTo(8.3, hy - 1.2); ctx.lineTo(5.8, hy - 4.8); ctx.lineTo(3.2, hy - 1.8); ctx.lineTo(1.2, hy - 5.2);
      ctx.quadraticCurveTo(-3, hy - 3, -4.5, hy + 3); ctx.lineTo(-7.5, hy + 6.5); ctx.quadraticCurveTo(-11.5, hy + 5.5, -11.6, hy + 2.5);
      fo(ctx, '#7a4a32', 1.3);
      ctx.strokeStyle = 'rgba(255,200,150,.45)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(-7, hy - 9); ctx.quadraticCurveTo(-2, hy - 11.5, 3, hy - 10); ctx.stroke();
      // scarf wrap
      ctx.beginPath(); rr(ctx, -8.5, -38.5, 17, 5, 2.5); fo(ctx, '#e0564e', 1.2);
      ctx.fillStyle = 'rgba(255,190,170,.6)'; ctx.fillRect(-6, -37.6, 10, 1);
      // sword arm
      const REST = -1.95;
      let rot;
      if (sw > 0) rot = lerp(-0.3, REST, ease(1 - sw));
      else rot = lerp(REST, -3.05, pre);
      if (sw > 0.35) {
        // slash smear
        const a0 = -3.05 + Math.PI / 2, a1 = rot + Math.PI / 2, al = (sw - 0.35) / 0.65;
        ctx.save(); ctx.translate(4, -31);
        ctx.fillStyle = `rgba(225,245,255,${(al * 0.55).toFixed(3)})`;
        ctx.beginPath(); ctx.arc(0, 0, 37, a0, a1, false); ctx.arc(0, 0, 24, a1, a0, true); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = `rgba(255,255,255,${(al * 0.9).toFixed(3)})`; ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.arc(0, 0, 36, a0 + 0.4, a1, false); ctx.stroke();
        ctx.restore();
      }
      ctx.save(); ctx.translate(4, -31); ctx.rotate(rot);
      bone(ctx, 0, 0, 0, 8.5, 4.2, '#d38b45', INK, 2.4);
      circ(ctx, 0, 10.5, 2.6); fo(ctx, SKIN, 1);
      // blade
      ctx.beginPath(); ctx.moveTo(-2, 12); ctx.lineTo(2, 12); ctx.lineTo(1.9, 31); ctx.lineTo(0, 34.5); ctx.lineTo(-1.9, 31); ctx.closePath();
      fo(ctx, '#eef3fb', 1.1);
      ctx.strokeStyle = 'rgba(140,190,240,.8)'; ctx.lineWidth = 0.7; ctx.beginPath(); ctx.moveTo(0, 13); ctx.lineTo(0, 31); ctx.stroke();
      ctx.beginPath(); rr(ctx, -5, 10.8, 10, 2.6, 1.2); fo(ctx, '#e8c47a', 0.9);
      circ(ctx, 0, 8, 1.4); fo(ctx, '#e8c47a', 0.8);
      ctx.restore();
    },

    // ---------------- 盾兵 ----------------
    guardian(ctx, u) {
      const t = u.anim, pre = antic(u, 0.25), at = u.atk;
      const bob = walkBob(u, 9, 1.6);
      legs(ctx, u, { hip: -15, spread: 5, pants: '#2e4a5e', back: '#223848', boot: '#8aa2b2', bootB: '#6a8090', freq: 9, w: 5.4 });
      ctx.translate(0, -bob + pre * 1.5);
      // back arm
      bone(ctx, -6, -32, -9, -22, 5, '#3f7480', INK, 2.4);
      // body: teal armor
      ctx.beginPath(); ctx.moveTo(-11, -39); ctx.quadraticCurveTo(0, -42, 10, -39); ctx.lineTo(11, -17); ctx.quadraticCurveTo(0, -13, -11.5, -17); ctx.closePath();
      fo(ctx, '#4f9aa2', 1.4);
      ctx.fillStyle = 'rgba(20,50,70,.3)'; ctx.beginPath(); ctx.moveTo(-11, -39); ctx.lineTo(-5, -40); ctx.lineTo(-5, -14.5); ctx.quadraticCurveTo(-9, -15.5, -11.5, -17); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(-11, -39); ctx.quadraticCurveTo(0, -42, 10, -39); ctx.lineTo(10.5, -31); ctx.quadraticCurveTo(0, -28, -11.2, -31); ctx.closePath();
      fo(ctx, '#a6d2d4', 1.2);
      ctx.fillStyle = '#e8c47a'; ctx.fillRect(-11, -21, 22, 3);
      // helm with plume, face beneath the brim
      const hy = -48;
      face(ctx, hy + 1, 10.5, SKIN, t);
      ctx.beginPath(); ctx.arc(0.5, hy - 1, 12, Math.PI * 1.02, Math.PI * 1.98); ctx.lineTo(13.5, hy - 1.5); ctx.lineTo(12.8, hy + 1.2); ctx.lineTo(-11.5, hy + 1.2); ctx.closePath();
      fo(ctx, '#cbd9e2', 1.3);
      ctx.fillStyle = 'rgba(255,255,255,.7)'; ctx.beginPath(); ctx.arc(1, hy - 2, 9, Math.PI * 1.25, Math.PI * 1.55); ctx.lineTo(1, hy - 2); ctx.closePath(); ctx.fill();
      ctx.beginPath(); rr(ctx, -12, hy - 1.5, 26, 3.2, 1.5); fo(ctx, '#e8c47a', 1);
      // side guard
      ctx.beginPath(); ctx.moveTo(-11.5, hy + 1); ctx.lineTo(-6, hy + 1); ctx.lineTo(-7, hy + 8); ctx.lineTo(-11, hy + 7); ctx.closePath(); fo(ctx, '#aebfcc', 1.1);
      // plume (teal)
      const pf = Math.sin(t * (u.walk ? 12 : 4)) * 1.5;
      ctx.beginPath(); ctx.moveTo(0, hy - 12.5); ctx.quadraticCurveTo(-6, hy - 21 + pf, -14, hy - 16 + pf); ctx.quadraticCurveTo(-8, hy - 15, -2, hy - 11); ctx.closePath();
      fo(ctx, '#6fd0cf', 1.1);
      // tower shield with crescent moon
      const push = at > 0 ? Math.sin(at * Math.PI * 0.5) * 7 : -pre * 3;
      ctx.save(); ctx.translate(13 + push, -31);
      ctx.beginPath(); ctx.moveTo(-8.5, -21); ctx.quadraticCurveTo(0, -25, 8.5, -21); ctx.lineTo(8.5, 12); ctx.quadraticCurveTo(0, 25, -8.5, 12); ctx.closePath();
      fo(ctx, lgc(ctx, 'grd-shield', -9, 0, 9, 0, [[0, '#2f6070'], [0.45, '#5aa0ac'], [1, '#2a5262']]), 1.5);
      ctx.strokeStyle = '#efe3c0'; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(-6.3, -18.6); ctx.quadraticCurveTo(0, -21.8, 6.3, -18.6); ctx.lineTo(6.3, 11.2); ctx.quadraticCurveTo(0, 21.6, -6.3, 11.2); ctx.closePath(); ctx.stroke();
      sglow(ctx, 0, -2, 11, '230,240,255', 0.35);
      crescent(ctx, 0, -2, 6.4, 3.4, 5.6, -0.5); fo(ctx, '#f7f2dc', 0.9, '#8a6a32');
      ctx.fillStyle = '#e8c47a'; circ(ctx, 0, 12, 1.6); ctx.fill(); circ(ctx, 0, -15, 1.4); ctx.fill();
      ctx.restore();
      // front hand gripping
      circ(ctx, 8 + push * 0.6, -28, 2.6); fo(ctx, SKIN, 1);
    },

    // ---------------- 弓兵 ----------------
    archer(ctx, u) {
      const t = u.anim;
      const bob = walkBob(u, 11, 2);
      legs(ctx, u, { hip: -16, spread: 3.4, pants: '#3c4a34', back: '#2c3828', boot: '#7a5530', bootB: '#5e4024', freq: 11 });
      ctx.translate(0, -bob);
      // quiver
      ctx.save(); ctx.translate(-8, -32); ctx.rotate(-0.4);
      ctx.fillStyle = '#eef3fb'; ctx.fillRect(-2.6, -14, 1.6, 6); ctx.fillRect(0.8, -15, 1.6, 6);
      ctx.fillStyle = '#e07a6a'; ctx.beginPath(); ctx.moveTo(-3.4, -14); ctx.lineTo(-1.8, -17); ctx.lineTo(-0.2, -14); ctx.fill(); ctx.beginPath(); ctx.moveTo(0, -15); ctx.lineTo(1.6, -18); ctx.lineTo(3.2, -15); ctx.fill();
      ctx.beginPath(); rr(ctx, -3.5, -9, 7, 19, 2.5); fo(ctx, '#8a5a32', 1.2);
      ctx.fillStyle = '#e8c47a'; ctx.fillRect(-3.5, -7, 7, 1.6);
      ctx.restore();
      // tunic (green)
      ctx.beginPath(); ctx.moveTo(-7, -36); ctx.lineTo(7, -36); ctx.lineTo(9, -15); ctx.quadraticCurveTo(0, -12.5, -9, -15); ctx.closePath();
      fo(ctx, '#5fa665', 1.4);
      ctx.fillStyle = 'rgba(20,60,30,.3)'; ctx.beginPath(); ctx.moveTo(-7, -36); ctx.lineTo(-2.5, -36); ctx.lineTo(-3.5, -13.4); ctx.quadraticCurveTo(-6.5, -13.8, -9, -15); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#8a6a3c'; ctx.fillRect(-8.5, -21, 17, 3);
      // head (hood over blond hair)
      const hy = -46;
      face(ctx, hy, 11, SKIN, t);
      ctx.fillStyle = '#e9c676'; ctx.beginPath(); ctx.moveTo(2, hy - 8); ctx.quadraticCurveTo(9, hy - 8, 11, hy - 2); ctx.lineTo(8, hy - 3.5); ctx.lineTo(6, hy - 1); ctx.lineTo(4.5, hy - 4.5); ctx.lineTo(1.5, hy - 2); ctx.closePath(); ctx.fill();
      // hood
      ctx.beginPath();
      ctx.moveTo(-11.5, hy + 5);
      ctx.quadraticCurveTo(-14, hy - 8, -6, hy - 12.5);
      ctx.quadraticCurveTo(2, hy - 15.5, 9, hy - 10.5);
      ctx.quadraticCurveTo(12.5, hy - 7, 12.5, hy - 3.5);
      ctx.quadraticCurveTo(7, hy - 9, 0, hy - 7);
      ctx.quadraticCurveTo(-5, hy - 4, -5.5, hy + 4);
      ctx.lineTo(-4, hy + 11); ctx.lineTo(-12, hy + 11); ctx.closePath();
      fo(ctx, '#3f8150', 1.3);
      // hood tail
      ctx.beginPath(); ctx.moveTo(-10, hy - 8); ctx.quadraticCurveTo(-19, hy - 6 + Math.sin(t * 5) * 1.5, -20, hy + 2); ctx.quadraticCurveTo(-15, hy - 2, -11, hy + 0); ctx.closePath();
      fo(ctx, '#356f44', 1.2);
      // capelet
      ctx.beginPath(); ctx.moveTo(-9, -38); ctx.quadraticCurveTo(0, -40, 8, -38); ctx.lineTo(7, -31); ctx.quadraticCurveTo(0, -29, -10, -31); ctx.closePath();
      fo(ctx, '#3f8150', 1.2);
      // bow & draw
      const aim = u.aim || 0, rel = u.atk;
      const draw = rel > 0.05 ? 0 : aim;
      const bx = 13, by = -33;
      const pull = bx - 5 - draw * 10;
      // drawing arm
      bone(ctx, 1, -32, pull + 1, by + 0.5, 3.8, '#4e9256', INK, 2.3);
      // bow arm
      bone(ctx, 3, -33, bx - 1, by, 3.8, '#4e9256', INK, 2.3);
      ctx.save(); ctx.translate(bx, by);
      const vib = rel > 0 ? Math.sin(rel * 40) * rel * 2 : 0;
      ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(-3, -18); ctx.quadraticCurveTo(-1, -16, 2, -12); ctx.quadraticCurveTo(6, -1, 2, 12); ctx.quadraticCurveTo(-1, 16, -3, 18);
      ctx.strokeStyle = INK; ctx.lineWidth = 4.4; ctx.stroke(); ctx.strokeStyle = '#b2833f'; ctx.lineWidth = 2.4; ctx.stroke();
      ctx.lineCap = 'butt';
      ctx.fillStyle = '#e8c47a'; ctx.fillRect(1.5, -2, 4, 4);
      ctx.strokeStyle = 'rgba(245,245,255,.9)'; ctx.lineWidth = 0.8;
      const px = pull - bx;
      ctx.beginPath(); ctx.moveTo(-3, -18); ctx.lineTo(px + vib, 0); ctx.lineTo(-3, 18); ctx.stroke();
      if (draw > 0.05) { // nocked arrow
        ctx.strokeStyle = '#efe9dc'; ctx.lineWidth = 1.3; ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(8, 0); ctx.stroke();
        ctx.fillStyle = '#cfe9ff'; ctx.beginPath(); ctx.moveTo(11, 0); ctx.lineTo(7, -2.2); ctx.lineTo(7, 2.2); ctx.closePath(); ctx.fill();
        sglow(ctx, 9, 0, 6 + draw * 4, '170,230,255', 0.5 * draw);
      }
      ctx.restore();
      circ(ctx, pull, by + 0.5, 2.4); fo(ctx, SKIN, 1);
      circ(ctx, bx + 1, by, 2.4); fo(ctx, SKIN, 1);
    },

    // ---------------- 魔法使い ----------------
    mage(ctx, u) {
      const t = u.anim, at = u.atk, pre = antic(u, 0.4);
      const hov = Math.sin(t * 3) * 1.6 + 1.5;
      ctx.translate(0, -hov);
      // tiny shoes peeking
      ctx.beginPath(); ell(ctx, 3, -1.5, 3.5, 1.8); fo(ctx, '#3b2f5e', 1);
      // robe
      ctx.beginPath(); ctx.moveTo(-7, -40); ctx.lineTo(7, -40); ctx.quadraticCurveTo(10, -20, 13.5, -3); ctx.quadraticCurveTo(0, 1, -13.5, -3); ctx.quadraticCurveTo(-11, -20, -7, -40); ctx.closePath();
      fo(ctx, lgc(ctx, 'mage-robe', 0, -40, 0, 0, [[0, '#6050c4'], [1, '#2f2780']]), 1.4);
      ctx.fillStyle = 'rgba(10,6,40,.3)'; ctx.beginPath(); ctx.moveTo(-7, -40); ctx.lineTo(-2, -40); ctx.quadraticCurveTo(-3, -18, -4, -1); ctx.quadraticCurveTo(-9, -1.6, -13.5, -3); ctx.quadraticCurveTo(-11, -20, -7, -40); ctx.fill();
      // gold trim (hem + front)
      ctx.strokeStyle = '#e8c47a'; ctx.lineWidth = 1.3;
      ctx.beginPath(); ctx.moveTo(-12.5, -5); ctx.quadraticCurveTo(0, -1.2, 12.5, -5); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(4, -38); ctx.quadraticCurveTo(5, -20, 6, -2.5); ctx.stroke();
      ctx.fillStyle = '#ffe9a8'; for (let i = 0; i < 4; i++) { const dx = -9 + i * 5, dy = -9 - (i % 2) * 7; ctx.fillRect(dx - 0.7, dy - 0.7, 1.4, 1.4); }
      // back sleeve
      ctx.beginPath(); ctx.moveTo(-6, -37); ctx.quadraticCurveTo(-12, -30, -12, -22); ctx.lineTo(-5, -23); ctx.closePath(); fo(ctx, '#4a3ca6', 1.2);
      // head + lavender bob hair
      const hy = -48;
      ctx.beginPath(); ctx.moveTo(-11, hy - 2); ctx.quadraticCurveTo(-13.5, hy + 8, -8, hy + 10); ctx.lineTo(-3, hy + 6); ctx.closePath(); fo(ctx, '#ddd5f2', 1.2);
      face(ctx, hy, 10.5, SKIN, t);
      ctx.beginPath(); ctx.moveTo(-10.5, hy + 1); ctx.quadraticCurveTo(-10, hy - 8, 0, hy - 8); ctx.quadraticCurveTo(9, hy - 8, 11, hy - 1); ctx.lineTo(7, hy - 3); ctx.lineTo(5, hy); ctx.lineTo(2.5, hy - 3.5); ctx.quadraticCurveTo(-4, hy - 2, -5, hy + 5); ctx.closePath();
      fo(ctx, '#e7e1f6', 1.2);
      // hat: wide brim + bent cone, gold band, orb tip
      const sway = Math.sin(t * 2.4) * 1.5;
      ctx.beginPath(); ctx.moveTo(-8.5, hy - 6); ctx.bezierCurveTo(-5, hy - 18, 0, hy - 26, -3 + sway, hy - 33); ctx.quadraticCurveTo(-10 + sway, hy - 32, -15 + sway, hy - 27); ctx.quadraticCurveTo(-7 + sway * 0.5, hy - 26, 4, hy - 20); ctx.quadraticCurveTo(7, hy - 12, 9.5, hy - 6); ctx.closePath();
      fo(ctx, '#3d309a', 1.3);
      ctx.beginPath(); ell(ctx, 0.5, hy - 6, 15.5, 3.6); fo(ctx, '#33287f', 1.3);
      ctx.fillStyle = '#e8c47a'; ctx.beginPath(); ctx.moveTo(-8, hy - 7); ctx.lineTo(9, hy - 7); ctx.lineTo(8, hy - 10.5); ctx.lineTo(-7, hy - 10.5); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#ffeaa0'; circ(ctx, -15 + sway, hy - 27, 2.4); ctx.fill();
      sglow(ctx, -15 + sway, hy - 27, 6, '255,225,150', 0.6);
      // staff with fire orb (thrust on attack, orb charges before)
      const thrust = at > 0 ? Math.sin(at * Math.PI * 0.5) : 0;
      ctx.save(); ctx.translate(11 + thrust * 3, -28); ctx.rotate(-0.12 - thrust * 0.55 + pre * 0.12);
      bone(ctx, 0, 27, 0, -20, 2.2, '#9a733f', INK, 2.2);
      ctx.strokeStyle = INK; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(-1.5, -24, 5.5, Math.PI * 0.3, Math.PI * 1.55, true); ctx.stroke();
      ctx.strokeStyle = '#b8894a'; ctx.lineWidth = 2; ctx.stroke();
      const orbR = 4.4 + pre * 1.6 + thrust * 1.6 + Math.sin(t * 9) * 0.3;
      ctx.globalCompositeOperation = 'lighter';
      sglow(ctx, 0, -26, 14 + pre * 8 + thrust * 14, '255,140,70', 0.7 + pre * 0.2);
      ctx.globalCompositeOperation = 'source-over';
      circ(ctx, 0, -26, orbR); ctx.fillStyle = '#ff9a5a'; ctx.fill();
      circ(ctx, -0.8, -26.8, orbR * 0.55); ctx.fillStyle = '#fff1cf'; ctx.fill();
      ctx.restore();
      // front sleeve & hand
      ctx.beginPath(); ctx.moveTo(4, -38); ctx.quadraticCurveTo(10, -34, 12 + thrust * 2, -28); ctx.lineTo(8 + thrust * 2, -24); ctx.quadraticCurveTo(4, -29, 1, -33); ctx.closePath(); fo(ctx, '#5446b8', 1.2);
      circ(ctx, 11 + thrust * 3, -26, 2.4); fo(ctx, SKIN, 1);
    },

    // ---------------- ヒーラー ----------------
    healer(ctx, u) {
      const t = u.anim, at = u.atk;
      const bob = u.walk ? Math.abs(Math.cos(t * 9)) * 1.6 : Math.sin(t * 2.4) * 0.9;
      ctx.translate(0, -bob);
      ctx.beginPath(); ell(ctx, 3, -1.2, 3.4, 1.7); fo(ctx, '#c9b98a', 1);
      // back long hair
      const hy = -48;
      ctx.beginPath(); ctx.moveTo(-9, hy - 4); ctx.quadraticCurveTo(-16, hy + 10, -12, hy + 22); ctx.quadraticCurveTo(-7, hy + 20, -4, hy + 6); ctx.closePath(); fo(ctx, '#f2cf7c', 1.2);
      // robe
      ctx.beginPath(); ctx.moveTo(-7, -39); ctx.lineTo(7, -39); ctx.quadraticCurveTo(10, -20, 12.5, -2.5); ctx.quadraticCurveTo(0, 1.5, -12.5, -2.5); ctx.quadraticCurveTo(-10, -20, -7, -39); ctx.closePath();
      fo(ctx, '#f6f3ec', 1.4);
      ctx.fillStyle = 'rgba(120,120,170,.22)'; ctx.beginPath(); ctx.moveTo(-7, -39); ctx.lineTo(-2, -39); ctx.quadraticCurveTo(-3, -18, -4, -0.5); ctx.quadraticCurveTo(-9, -1, -12.5, -2.5); ctx.quadraticCurveTo(-10, -20, -7, -39); ctx.fill();
      ctx.strokeStyle = '#e0b860'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(-11.8, -5.5); ctx.quadraticCurveTo(0, -1.6, 11.8, -5.5); ctx.stroke();
      ctx.lineWidth = 0.9; ctx.beginPath(); ctx.moveTo(-11, -8.5); ctx.quadraticCurveTo(0, -4.8, 11, -8.5); ctx.stroke();
      // gold sash + geometric brooch
      ctx.fillStyle = '#e0b860'; ctx.fillRect(-8.5, -25, 17, 2.6);
      ctx.beginPath(); ctx.moveTo(1.5, -33.5); ctx.lineTo(4.5, -30.5); ctx.lineTo(1.5, -27.5); ctx.lineTo(-1.5, -30.5); ctx.closePath(); fo(ctx, '#f2d58f', 0.8, '#8a6a32');
      // capelet
      ctx.beginPath(); ctx.moveTo(-8.5, -40); ctx.quadraticCurveTo(0, -42, 8.5, -40); ctx.lineTo(9, -33); ctx.quadraticCurveTo(0, -30.5, -9.5, -33); ctx.closePath();
      fo(ctx, '#ffffff', 1.2);
      ctx.strokeStyle = '#e0b860'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(-9.2, -33.6); ctx.quadraticCurveTo(0, -31.2, 8.8, -33.6); ctx.stroke();
      // head
      face(ctx, hy, 10.5, '#f9e9da', t);
      ctx.beginPath(); ctx.moveTo(-10.6, hy + 2); ctx.quadraticCurveTo(-10.5, hy - 9, 0, hy - 9); ctx.quadraticCurveTo(9.5, hy - 9, 11, hy - 1); ctx.lineTo(7.5, hy - 3.5); ctx.lineTo(5.5, hy - 0.5); ctx.lineTo(3, hy - 4); ctx.quadraticCurveTo(-4, hy - 3, -5, hy + 4); ctx.closePath();
      fo(ctx, '#f6d585', 1.2);
      ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.fillRect(-3, hy - 7.5, 6, 1);
      // halo ring
      const hb = Math.sin(t * 3) * 1.2;
      sglow(ctx, 0, hy - 14 + hb, 12, '255,230,160', 0.35 + 0.15 * Math.sin(t * 3));
      ctx.strokeStyle = 'rgba(120,90,30,.6)'; ctx.lineWidth = 3; ell(ctx, 0, hy - 14 + hb, 9, 2.6); ctx.stroke();
      ctx.strokeStyle = '#ffe7a0'; ctx.lineWidth = 1.6; ell(ctx, 0, hy - 14 + hb, 9, 2.6); ctx.stroke();
      // lantern staff (front)
      const raise = at > 0 ? Math.sin(at * Math.PI * 0.5) : 0;
      ctx.save(); ctx.translate(10, -24 - raise * 6); ctx.rotate(-0.08 - raise * 0.25);
      bone(ctx, 0, 23, 0, -18, 2, '#b8c4da', INK, 2.2);
      ctx.strokeStyle = INK; ctx.lineWidth = 3.8; ctx.beginPath(); ctx.moveTo(0, -18); ctx.quadraticCurveTo(0, -25, 7, -24); ctx.stroke();
      ctx.strokeStyle = '#d4dceb'; ctx.lineWidth = 1.8; ctx.stroke();
      const sw = Math.sin(t * 2.6) * 0.15;
      ctx.translate(7, -23); ctx.rotate(sw);
      ctx.strokeStyle = '#8a6a32'; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, 3); ctx.stroke();
      ctx.globalCompositeOperation = 'lighter';
      sglow(ctx, 0, 8, 16 + raise * 14, '200,255,210', 0.65 + raise * 0.3);
      ctx.globalCompositeOperation = 'source-over';
      ctx.beginPath(); ctx.moveTo(-3.5, 4); ctx.lineTo(3.5, 4); ctx.lineTo(4, 12); ctx.lineTo(-4, 12); ctx.closePath(); fo(ctx, '#effff2', 1, '#8a6a32');
      ctx.fillStyle = '#e0b860'; ctx.fillRect(-4.6, 2.6, 9.2, 2); ctx.fillRect(-4.6, 11.4, 9.2, 2);
      ctx.fillStyle = '#fffbe0'; ctx.fillRect(-1, 6, 2, 4);
      ctx.restore();
      circ(ctx, 10, -22 - raise * 6, 2.4); fo(ctx, '#f9e9da', 1);
    },

    // ---------------- 槍兵 ----------------
    spearman(ctx, u) {
      const t = u.anim, at = u.atk, pre = antic(u, 0.3);
      const bob = walkBob(u, 11, 2);
      legs(ctx, u, { hip: -17, spread: 3.4, pants: '#4a3a3a', back: '#372a2c', boot: '#74502f', bootB: '#583a22', freq: 11 });
      ctx.translate(0, -bob);
      // thrust: pull back on anticipation, snap forward on atk=1, ease home as atk → 0
      const ext = at > 0 ? Math.sin(Math.min(1, at * 1.2) * Math.PI * 0.5) : 0;
      const reach = ext * 8 - pre * 6;
      const REST = u.walk ? -0.5 : -0.6;
      const tilt = at > 0 ? lerp(REST, -0.03, ext) : lerp(REST, -0.1, pre) + (u.walk ? Math.sin(t * 11) * 0.04 : Math.sin(t * 2.2) * 0.015);
      const ca = Math.cos(tilt), sa = Math.sin(tilt);
      const gx = 9 + reach, gy = -28 + pre * 1.5;            // front-hand grip
      const bx = gx - ca * 13, by = gy - sa * 13;             // back-hand grip
      // round buckler slung on the back
      ctx.save(); ctx.translate(-9.5, -30); ctx.rotate(-0.15);
      ell(ctx, 0, 0, 6, 8.2); fo(ctx, '#a0702f', 1.3);
      ell(ctx, 0.3, 0, 4.3, 6.4); fo(ctx, '#9a2f36', 0.9, '#5c2a1c');
      ctx.fillStyle = 'rgba(255,220,200,.25)'; ell(ctx, -1, -2.5, 1.6, 2.6); ctx.fill();
      ell(ctx, 0.6, 0, 1.6, 2.1); fo(ctx, '#e3b762', 0.8, '#6a4a1e');
      ctx.restore();
      // back arm (reaches across to the rear grip)
      bone(ctx, -2, -33, bx, by, 3.6, '#843832', INK, 2.3);
      // tunic (cream) under a deep-red tabard
      ctx.beginPath(); ctx.moveTo(-7.5, -36); ctx.lineTo(7.5, -36); ctx.lineTo(9.5, -15); ctx.quadraticCurveTo(0, -12.6, -9.5, -15); ctx.closePath();
      fo(ctx, '#efe4cc', 1.4);
      ctx.beginPath(); ctx.moveTo(-5.5, -37); ctx.lineTo(6.5, -37); ctx.lineTo(7, -16); ctx.lineTo(1, -11.5); ctx.lineTo(-5, -16); ctx.closePath();
      fo(ctx, '#a8323a', 1.3);
      ctx.fillStyle = 'rgba(60,8,20,.32)'; ctx.beginPath(); ctx.moveTo(-5.5, -37); ctx.lineTo(-1.5, -37); ctx.lineTo(-1.6, -13.5); ctx.lineTo(-5, -16); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#f2e6c8'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(-3.8, -35.5); ctx.lineTo(-3.4, -16.6); ctx.lineTo(1, -13.6); ctx.lineTo(5.4, -16.6); ctx.lineTo(5, -35.5); ctx.stroke();
      // cream chevron device
      ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(-2, -31); ctx.lineTo(1, -28); ctx.lineTo(4, -31); ctx.stroke();
      ctx.fillStyle = 'rgba(255,200,190,.35)'; ctx.fillRect(3.4, -34, 1.4, 10);
      // brass collar + belt
      ctx.beginPath(); rr(ctx, -7.5, -38.6, 15.5, 3.4, 1.6); fo(ctx, '#d6a24a', 1.1);
      ctx.fillStyle = '#5a3420'; ctx.fillRect(-9, -21.5, 18, 3);
      ctx.fillStyle = '#e3b762'; ctx.fillRect(-0.6, -22, 3.4, 4);
      // head + brass helm with a short red crest
      const hy = -46;
      ctx.beginPath(); ctx.moveTo(-10.5, hy + 1); ctx.quadraticCurveTo(-13, hy + 7, -8.5, hy + 9.5); ctx.lineTo(-5, hy + 4); ctx.closePath(); fo(ctx, '#4a2e24', 1.1);
      face(ctx, hy, 11, SKIN, t);
      ctx.fillStyle = '#4a2e24'; ctx.beginPath(); ctx.moveTo(2, hy - 6); ctx.quadraticCurveTo(7, hy - 6.5, 10.5, hy - 3); ctx.lineTo(7.5, hy - 3.6); ctx.lineTo(5.5, hy - 1.8); ctx.lineTo(4, hy - 4); ctx.lineTo(1, hy - 3); ctx.closePath(); ctx.fill();
      const cf = Math.sin(t * (u.walk ? 13 : 4)) * 0.8;
      ctx.beginPath(); ctx.moveTo(-8, hy - 10); ctx.quadraticCurveTo(-7, hy - 17 + cf, 1, hy - 18); ctx.quadraticCurveTo(5, hy - 18, 6.5, hy - 13.5); ctx.quadraticCurveTo(-1, hy - 15, -8, hy - 10); ctx.closePath();
      fo(ctx, '#b4363c', 1.2);
      ctx.strokeStyle = 'rgba(255,190,180,.55)'; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.moveTo(-5, hy - 13.5); ctx.quadraticCurveTo(-2, hy - 16.5, 3, hy - 16.6); ctx.stroke();
      ctx.beginPath(); ctx.arc(0.5, hy - 1.5, 12, Math.PI * 1.02, Math.PI * 1.97); ctx.lineTo(12.8, hy - 1); ctx.lineTo(-11.6, hy - 1); ctx.closePath();
      fo(ctx, lgc(ctx, 'spr-helm', 0, hy - 14, 0, hy, [[0, '#f0c870'], [1, '#b8822e']]), 1.3);
      ctx.fillStyle = 'rgba(255,245,210,.7)'; ctx.beginPath(); ctx.arc(1.5, hy - 2.5, 9, Math.PI * 1.3, Math.PI * 1.55); ctx.lineTo(1.5, hy - 2.5); ctx.closePath(); ctx.fill();
      ctx.beginPath(); rr(ctx, -12, hy - 2.6, 25.5, 3, 1.4); fo(ctx, '#c08a36', 1);
      ctx.beginPath(); ctx.moveTo(-11.8, hy); ctx.lineTo(-5.5, hy); ctx.lineTo(-6, hy + 6.5); ctx.quadraticCurveTo(-9, hy + 8, -11, hy + 5); ctx.closePath(); fo(ctx, '#c99540', 1.1);
      // spear (long ash shaft, brass fittings, leaf blade, red tassel)
      if (ext > 0.35) {
        const al = (ext - 0.35) / 0.65;
        ctx.save(); ctx.translate(gx, gy); ctx.rotate(tilt);
        ctx.fillStyle = `rgba(225,245,255,${(al * 0.5).toFixed(3)})`;
        ctx.beginPath(); ctx.moveTo(8, -1.2); ctx.lineTo(44, -3.4); ctx.lineTo(48, 0); ctx.lineTo(44, 3.4); ctx.lineTo(8, 1.2); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = `rgba(255,255,255,${(al * 0.8).toFixed(3)})`; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(14, -4.5); ctx.lineTo(36, -5.2); ctx.moveTo(18, 4.6); ctx.lineTo(38, 5); ctx.stroke();
        ctx.restore();
      }
      ctx.save(); ctx.translate(gx, gy); ctx.rotate(tilt);
      bone(ctx, -28, 0, 33, 0, 2.5, '#9a6a3c', INK, 2.3);
      ctx.strokeStyle = 'rgba(255,220,170,.45)'; ctx.lineWidth = 0.7; ctx.beginPath(); ctx.moveTo(-26, -0.6); ctx.lineTo(31, -0.6); ctx.stroke();
      ctx.beginPath(); rr(ctx, -30.5, -2, 4, 4, 1.2); fo(ctx, '#d6a24a', 0.9);
      // tassel hangs from the socket and trails on the thrust
      const tf = Math.sin(t * (u.walk ? 14 : 5)) * 1.2 - ext * 3;
      ctx.beginPath(); ctx.moveTo(32, 1); ctx.quadraticCurveTo(30 + tf * 0.5, 5, 28.5 + tf, 8.5); ctx.lineTo(31 + tf, 9); ctx.quadraticCurveTo(33, 5, 34, 1.5); ctx.closePath();
      fo(ctx, '#c23c40', 0.9);
      ctx.beginPath(); rr(ctx, 31, -2.3, 5, 4.6, 1.4); fo(ctx, '#e0ae52', 0.9);
      ctx.beginPath(); ctx.moveTo(36, -2.2); ctx.quadraticCurveTo(41, -4.4, 47.5, 0); ctx.quadraticCurveTo(41, 4.4, 36, 2.2); ctx.closePath();
      fo(ctx, '#eef3fb', 1.1);
      ctx.strokeStyle = 'rgba(140,190,240,.85)'; ctx.lineWidth = 0.7; ctx.beginPath(); ctx.moveTo(37, 0); ctx.lineTo(45.5, 0); ctx.stroke();
      ctx.restore();
      circ(ctx, bx, by, 2.4); fo(ctx, SKIN, 1);
      // front arm + hand
      bone(ctx, 3, -33, gx - 1, gy, 3.6, '#a8443e', INK, 2.3);
      circ(ctx, gx, gy, 2.6); fo(ctx, SKIN, 1);
    },

    // ---------------- 氷の魔法使い ----------------
    icemage(ctx, u) {
      const t = u.anim, at = u.atk, pre = antic(u, 0.4);
      const hov = Math.sin(t * 2.6) * 1.3 + 1.4;
      const thrust = at > 0 ? Math.sin(at * Math.PI * 0.5) : 0;
      // frost motes orbiting (back half drawn here, front half at the end)
      const motes = (front) => {
        ctx.fillStyle = 'rgba(225,250,255,.9)';
        for (let i = 0; i < 5; i++) {
          const a = t * 0.9 + i * 1.26, s = Math.sin(a);
          if ((s >= 0) !== front) continue;
          const mx = Math.cos(a) * 17, my = -30 + Math.sin(t * 1.7 + i * 2) * 10 + s * 3;
          const k = 1.1 + (front ? 0.5 : 0) + thrust * 0.6;
          ctx.globalAlpha = 0.45 + 0.4 * Math.sin(t * 3 + i) * 0.5 + (front ? 0.2 : 0);
          ctx.beginPath(); ctx.moveTo(mx, my - k * 1.6); ctx.lineTo(mx + k, my); ctx.lineTo(mx, my + k * 1.6); ctx.lineTo(mx - k, my); ctx.closePath(); ctx.fill();
        }
        ctx.globalAlpha = 1;
      };
      ctx.translate(0, -hov);
      motes(false);
      ctx.beginPath(); ell(ctx, 3, -1.5, 3.5, 1.8); fo(ctx, '#5a7fa8', 1);
      // robe: snow-white → pale ice blue
      ctx.beginPath(); ctx.moveTo(-7, -40); ctx.lineTo(7, -40); ctx.quadraticCurveTo(10.5, -20, 13.5, -3); ctx.quadraticCurveTo(0, 1, -13.5, -3); ctx.quadraticCurveTo(-11, -20, -7, -40); ctx.closePath();
      fo(ctx, lgc(ctx, 'ice-robe', 0, -40, 0, 0, [[0, '#f6fbff'], [0.6, '#d6ecfa'], [1, '#9fcdee']]), 1.4);
      ctx.fillStyle = 'rgba(50,100,170,.2)'; ctx.beginPath(); ctx.moveTo(-7, -40); ctx.lineTo(-2, -40); ctx.quadraticCurveTo(-3, -18, -4, -1); ctx.quadraticCurveTo(-9, -1.6, -13.5, -3); ctx.quadraticCurveTo(-11, -20, -7, -40); ctx.fill();
      // frost-pattern hem: deep ice band with white fern zigzag
      ctx.beginPath(); ctx.moveTo(-13.1, -4.2); ctx.quadraticCurveTo(0, -0.3, 13.1, -4.2); ctx.lineTo(12.3, -9); ctx.quadraticCurveTo(0, -5, -12.3, -9); ctx.closePath();
      ctx.fillStyle = '#6fb2e0'; ctx.fill();
      ctx.strokeStyle = '#f4fcff'; ctx.lineWidth = 0.9; ctx.beginPath();
      for (let i = 0; i <= 8; i++) { const x = -11.5 + i * 2.9, yb = -6.6 + (x * x) / 170 + 2.2; ctx.lineTo(x, yb - (i % 2 ? 3 : 0.3)); }
      ctx.stroke();
      ctx.fillStyle = '#f4fcff'; for (let i = 0; i < 4; i++) { const x = -8.6 + i * 5.8, y = -5.4 + (x * x) / 170 + 2.2; ctx.fillRect(x - 0.6, y - 0.6, 1.2, 1.2); }
      ctx.strokeStyle = '#7fbfe6'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(4, -38); ctx.quadraticCurveTo(5, -20, 6, -6.5); ctx.stroke();
      ctx.fillStyle = '#b8dcf2'; ctx.fillRect(-8.5, -26, 17, 2.4);
      // back sleeve
      ctx.beginPath(); ctx.moveTo(-6, -37); ctx.quadraticCurveTo(-12, -30, -12.5, -22); ctx.lineTo(-5, -23); ctx.closePath(); fo(ctx, '#c4e0f4', 1.2);
      // head: silver hair, rounded hood with a crystal circlet
      const hy = -48;
      ctx.beginPath(); ctx.moveTo(-10, hy - 4); ctx.quadraticCurveTo(-16.5, hy + 4, -15, hy + 13); ctx.quadraticCurveTo(-11, hy + 11, -8, hy + 7); ctx.closePath(); fo(ctx, '#cfe4f5', 1.2);
      face(ctx, hy, 10.5, '#faeee6', t);
      ctx.beginPath(); ctx.moveTo(1, hy - 6.5); ctx.quadraticCurveTo(8, hy - 7.5, 11, hy - 1.5); ctx.lineTo(8.4, hy - 3); ctx.lineTo(7, hy - 0.2); ctx.lineTo(5, hy - 3.5); ctx.lineTo(2.5, hy - 1); ctx.closePath();
      fo(ctx, '#eef4ff', 1);
      ctx.beginPath();
      ctx.moveTo(-11.5, hy + 7);
      ctx.quadraticCurveTo(-15, hy - 8, -6, hy - 13);
      ctx.quadraticCurveTo(3, hy - 16, 10, hy - 10.5);
      ctx.quadraticCurveTo(13, hy - 7, 13, hy - 3);
      ctx.quadraticCurveTo(7, hy - 9.5, 0, hy - 7.5);
      ctx.quadraticCurveTo(-5, hy - 4.5, -5.5, hy + 4);
      ctx.lineTo(-3.5, hy + 11); ctx.lineTo(-12, hy + 11); ctx.closePath();
      fo(ctx, '#e8f4fc', 1.3);
      ctx.fillStyle = 'rgba(60,110,170,.18)'; ctx.beginPath(); ctx.moveTo(-11, hy + 6); ctx.quadraticCurveTo(-14, hy - 7, -7, hy - 11); ctx.quadraticCurveTo(-9, hy - 2, -8, hy + 10); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#8cc8ea'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(12.4, hy - 4); ctx.quadraticCurveTo(7, hy - 9, 0, hy - 7.5); ctx.quadraticCurveTo(-5, hy - 4.5, -5.5, hy + 4); ctx.stroke();
      // circlet + three ice crystals rising over the hood brim
      ctx.strokeStyle = '#cfe2f4'; ctx.lineWidth = 1.3; ctx.beginPath(); ctx.moveTo(-0.5, hy - 8); ctx.quadraticCurveTo(6, hy - 10, 11.5, hy - 5.5); ctx.stroke();
      const cr = [[3, -10.5, 0.9, 3.4, -0.35], [6.8, -11.2, 1.3, 5.6, 0.05], [10.2, -9, 0.9, 3.4, 0.45]];
      for (const c of cr) {
        ctx.save(); ctx.translate(c[0], hy + c[1]); ctx.rotate(c[4]);
        ctx.beginPath(); ctx.moveTo(0, -c[3]); ctx.lineTo(c[2] * 1.4, -c[3] * 0.35); ctx.lineTo(0, 1.2); ctx.lineTo(-c[2] * 1.4, -c[3] * 0.35); ctx.closePath();
        fo(ctx, '#bff2ff', 0.9);
        ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.beginPath(); ctx.moveTo(0, -c[3]); ctx.lineTo(-c[2] * 1.4, -c[3] * 0.35); ctx.lineTo(0, 0); ctx.closePath(); ctx.fill();
        ctx.restore();
      }
      // staff topped with a floating hexagonal crystal
      ctx.save(); ctx.translate(14 + thrust * 3, -27); ctx.rotate(0.06 + thrust * 0.4 - pre * 0.14);
      bone(ctx, 0, 27, 0, -18, 2.2, '#c6d6ea', INK, 2.2);
      ctx.strokeStyle = INK; ctx.lineWidth = 3.6; ctx.beginPath(); ctx.moveTo(-4.5, -23); ctx.quadraticCurveTo(-4, -17, 0, -17); ctx.quadraticCurveTo(4, -17, 4.5, -23); ctx.stroke();
      ctx.strokeStyle = '#dbe8f6'; ctx.lineWidth = 1.7; ctx.stroke();
      const cy = -30 + Math.sin(t * 3) * 1.3 - thrust * 2, pulse = Math.max(pre, thrust);
      const k = 1 + pulse * 0.28 + Math.sin(t * 4) * 0.03;
      ctx.globalCompositeOperation = 'lighter';
      sglow(ctx, 0, cy, 13 + pulse * 13 + Math.sin(t * 4) * 1.2, '110,225,255', 0.6 + pulse * 0.35);
      ctx.globalCompositeOperation = 'source-over';
      if (thrust > 0.05) {
        const rr0 = 7 + (1 - at) * 15;
        ctx.strokeStyle = `rgba(190,245,255,${(at * 0.85).toFixed(3)})`; ctx.lineWidth = 1.3;
        circ(ctx, 0, cy, rr0); ctx.stroke();
        ctx.beginPath();
        for (let i = 0; i < 6; i++) { const a = i * TAU / 6 + 0.5; ctx.moveTo(Math.cos(a) * (rr0 + 2), cy + Math.sin(a) * (rr0 + 2)); ctx.lineTo(Math.cos(a) * (rr0 + 5), cy + Math.sin(a) * (rr0 + 5)); }
        ctx.stroke();
      }
      ctx.save(); ctx.translate(0, cy); ctx.rotate(Math.sin(t * 1.8) * 0.14); ctx.scale(k, k);
      ctx.beginPath(); ctx.moveTo(0, -7.5); ctx.lineTo(4.2, -3.6); ctx.lineTo(4.2, 3.6); ctx.lineTo(0, 7.5); ctx.lineTo(-4.2, 3.6); ctx.lineTo(-4.2, -3.6); ctx.closePath();
      fo(ctx, '#9fe6fa', 1.1, '#1d3a66');
      ctx.fillStyle = '#e6fcff'; ctx.beginPath(); ctx.moveTo(0, -7.5); ctx.lineTo(-4.2, -3.6); ctx.lineTo(-4.2, 3.6); ctx.lineTo(0, 7.5); ctx.lineTo(-1, 0); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#5cc6ea'; ctx.beginPath(); ctx.moveTo(0, 7.5); ctx.lineTo(4.2, 3.6); ctx.lineTo(4.2, -1); ctx.lineTo(1, 1.5); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = 0.6; ctx.beginPath(); ctx.moveTo(0, -7.5); ctx.lineTo(0, 7.5); ctx.stroke();
      ctx.restore();
      ctx.restore();
      // front sleeve & hand
      ctx.beginPath(); ctx.moveTo(4, -38); ctx.quadraticCurveTo(11, -34, 14 + thrust * 2, -27); ctx.lineTo(10 + thrust * 2, -23); ctx.quadraticCurveTo(5, -28, 1, -33); ctx.closePath(); fo(ctx, '#e2f0fa', 1.2);
      ctx.strokeStyle = '#7fbfe6'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(14 + thrust * 2, -27); ctx.lineTo(10 + thrust * 2, -23); ctx.stroke();
      circ(ctx, 14 + thrust * 3, -25, 2.4); fo(ctx, '#faeee6', 1);
      motes(true);
    },

    // ---------------- バード ----------------
    bard(ctx, u) {
      const t = u.anim, at = u.atk;
      const bob = walkBob(u, 10, 2);
      legs(ctx, u, { hip: -16.5, spread: 3.4, pants: '#d3a23e', back: '#a97c2a', boot: '#6e4428', bootB: '#55331d', freq: 10 });
      ctx.translate(0, -bob);
      // sway to the rhythm around the hips
      const sw = u.walk ? Math.sin(t * 10) * 0.02 : Math.sin(t * 2.8) * 0.055;
      ctx.translate(0, -16); ctx.rotate(sw); ctx.translate(0, 16);
      const song = at > 0 ? at : 0;
      // short mustard cape behind
      const fl = Math.sin(t * (u.walk ? 13 : 4)) * 1.6, trail = u.walk ? 3 : 0;
      ctx.beginPath(); ctx.moveTo(-6, -38); ctx.quadraticCurveTo(-13 - trail, -30, -15 - trail, -20 + fl * 0.4); ctx.lineTo(-11 - trail, -22 + fl); ctx.lineTo(-8 - trail * 0.5, -19.5 + fl * 0.6); ctx.quadraticCurveTo(-6, -28, -2, -35); ctx.closePath();
      fo(ctx, '#d9a63a', 1.3);
      // back arm holding the lyre's base
      bone(ctx, -3, -33, 3, -24, 4, '#e0b14a', INK, 2.4);
      // teal doublet with scalloped hem
      ctx.beginPath(); ctx.moveTo(-7.5, -36); ctx.lineTo(7.5, -36); ctx.lineTo(9.8, -15.5); ctx.quadraticCurveTo(7, -12.5, 4.8, -15); ctx.quadraticCurveTo(2.4, -12.4, 0, -15); ctx.quadraticCurveTo(-2.4, -12.4, -4.8, -15); ctx.quadraticCurveTo(-7, -12.5, -9.8, -15.5); ctx.closePath();
      fo(ctx, '#2f9c94', 1.4);
      ctx.fillStyle = 'rgba(10,50,55,.3)'; ctx.beginPath(); ctx.moveTo(-7.5, -36); ctx.lineTo(-3, -36); ctx.lineTo(-3.6, -14); ctx.quadraticCurveTo(-7, -12.5, -9.8, -15.5); ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(200,255,245,.4)'; ctx.fillRect(3.5, -34, 1.6, 13);
      // mustard sash + cream ruff collar
      ctx.strokeStyle = '#e3b448'; ctx.lineWidth = 2.6; ctx.beginPath(); ctx.moveTo(-6.5, -34); ctx.lineTo(7.5, -21); ctx.stroke();
      ctx.fillStyle = '#7a4a2a'; ctx.fillRect(-9, -21.5, 18.5, 3);
      ctx.beginPath(); ctx.moveTo(-7.5, -38.5);
      for (let i = 0; i <= 5; i++) ctx.quadraticCurveTo(-7.5 + i * 3 - 1.5, -34.6, -7.5 + i * 3, -36.3 - (i % 2) * 0.4);
      ctx.lineTo(7.5, -39.5); ctx.closePath(); fo(ctx, '#f6edd6', 1.1);
      // head: auburn waves, feathered beret
      const hy = -46;
      ctx.beginPath(); ctx.moveTo(-10, hy - 2); ctx.quadraticCurveTo(-14, hy + 6, -9, hy + 10); ctx.quadraticCurveTo(-7, hy + 6, -4, hy + 5); ctx.closePath(); fo(ctx, '#b65a36', 1.1);
      face(ctx, hy, 11, SKIN, t);
      if (song > 0.08) { ctx.fillStyle = '#7a2e3a'; ell(ctx, 5, hy + 5.4, 1.5, 1.2 + song * 0.6); ctx.fill(); }
      ctx.fillStyle = '#b65a36'; ctx.beginPath(); ctx.moveTo(1, hy - 6); ctx.quadraticCurveTo(7.5, hy - 7.5, 11, hy - 2.5); ctx.lineTo(8, hy - 3.3); ctx.quadraticCurveTo(6, hy - 1, 4.4, hy - 4); ctx.quadraticCurveTo(3, hy - 1.5, 1, hy - 2.5); ctx.closePath(); ctx.fill();
      // feather (sweeps back, bobs with the sway)
      const ff = Math.sin(t * (u.walk ? 10 : 2.8)) * 1.8;
      ctx.beginPath(); ctx.moveTo(-5, hy - 12); ctx.bezierCurveTo(-11, hy - 22 + ff, -20, hy - 23 + ff, -25, hy - 17 + ff * 1.2); ctx.bezierCurveTo(-18, hy - 16.5 + ff, -11, hy - 14, -4, hy - 9.5); ctx.closePath();
      fo(ctx, '#f6ecd4', 1.1);
      ctx.fillStyle = '#d0503e'; ctx.beginPath(); ctx.moveTo(-19, hy - 20.6 + ff); ctx.quadraticCurveTo(-23, hy - 20.5 + ff, -25, hy - 17 + ff * 1.2); ctx.quadraticCurveTo(-22, hy - 17 + ff, -19.5, hy - 17.6 + ff); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(150,110,70,.7)'; ctx.lineWidth = 0.7; ctx.beginPath(); ctx.moveTo(-5, hy - 11); ctx.quadraticCurveTo(-14, hy - 18 + ff, -24, hy - 17.4 + ff * 1.2); ctx.stroke();
      // beret: floppy disc tilted back, mustard band
      ctx.beginPath(); ctx.moveTo(-12.5, hy - 5); ctx.quadraticCurveTo(-14, hy - 15, -2, hy - 15.5); ctx.quadraticCurveTo(10, hy - 15.5, 12.5, hy - 8.5); ctx.quadraticCurveTo(13, hy - 6.5, 10, hy - 6.4); ctx.quadraticCurveTo(-1, hy - 7.5, -12.5, hy - 5); ctx.closePath();
      fo(ctx, '#1f6a70', 1.3);
      ctx.fillStyle = 'rgba(160,240,230,.35)'; ctx.beginPath(); ctx.moveTo(-6, hy - 13.4); ctx.quadraticCurveTo(2, hy - 15, 8, hy - 12.6); ctx.quadraticCurveTo(2, hy - 13, -6, hy - 12); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(-10.5, hy - 5.2); ctx.quadraticCurveTo(0, hy - 7.6, 10.5, hy - 6.4); ctx.lineTo(10.3, hy - 4.4); ctx.quadraticCurveTo(0, hy - 5.6, -10.4, hy - 3.2); ctx.closePath(); fo(ctx, '#e3b448', 0.9);
      circ(ctx, -3, hy - 11.5, 1.6); fo(ctx, '#e3b448', 0.8, '#6a4a1e');
      // lyre held at the chest
      const LX = 11, LY = -24.5;
      ctx.save(); ctx.translate(LX, LY); ctx.rotate(0.28);
      if (song > 0) { ctx.globalCompositeOperation = 'lighter'; sglow(ctx, 0, -3, 11 + song * 9, '255,215,140', song * 0.6); ctx.globalCompositeOperation = 'source-over'; }
      // strings (vibrate while singing)
      const vib = Math.sin(t * 70) * song * 1.3;
      ctx.strokeStyle = 'rgba(250,245,230,.95)'; ctx.lineWidth = 0.6; ctx.beginPath();
      for (let i = -1; i <= 1; i++) { const x = i * 1.8; ctx.moveTo(x, 5); ctx.quadraticCurveTo(x + vib * (i === 0 ? 1 : -0.7), -1.5, x, -8); }
      ctx.stroke();
      // golden frame: two curled horns + crossbar
      ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(-3.2, 5); ctx.quadraticCurveTo(-6.5, -2, -4, -9); ctx.quadraticCurveTo(-3, -11.5, -5.5, -12.5);
      ctx.moveTo(3.2, 5); ctx.quadraticCurveTo(6.5, -2, 4, -9); ctx.quadraticCurveTo(3, -11.5, 5.5, -12.5);
      ctx.moveTo(-4.8, -8); ctx.lineTo(4.8, -8);
      ctx.strokeStyle = INK; ctx.lineWidth = 3.6; ctx.stroke(); ctx.strokeStyle = '#ecc565'; ctx.lineWidth = 1.7; ctx.stroke();
      ctx.lineCap = 'butt';
      ctx.beginPath(); rr(ctx, -4.6, 3.6, 9.2, 4.6, 2); fo(ctx, '#9a5f34', 1);
      ctx.fillStyle = '#ecc565'; ctx.fillRect(-1, 4.6, 2, 2.4);
      ctx.restore();
      circ(ctx, LX - 4.4, LY + 6.6, 2.4); fo(ctx, SKIN, 1);   // back hand on the base
      // strumming arm
      const st = song > 0 ? Math.sin((1 - song) * Math.PI * 4) * 3.2 : Math.sin(t * 2.8) * 0.8;
      const hx = LX + 0.6 + st * 0.3, hyy = LY - 2 + st;
      ctx.beginPath(); ctx.moveTo(-1, -36.5); ctx.quadraticCurveTo(-5, -33, -2.5, -29.5); ctx.quadraticCurveTo(1, -31, 2.5, -34.5); ctx.closePath(); fo(ctx, '#e3b448', 1.1);
      bone(ctx, 1.5, -32.5, hx - 1.6, hyy, 3.8, '#2a8a83', INK, 2.3);
      circ(ctx, hx, hyy, 2.3); fo(ctx, SKIN, 1);
      // song notes rising from the lyre
      if (song > 0) {
        ctx.save(); ctx.rotate(-sw);
        for (let i = 0; i < 3; i++) {
          const q = (1 - song) * 0.95 + i * 0.13;
          const nx = 13 + i * 5 + Math.sin(q * 7 + i * 1.7) * 2.6, ny = -38 - q * 28 - i * 3;
          const al = Math.min(1, song * 2.6) * (1 - q * 0.35);
          ctx.globalAlpha = al;
          ctx.save(); ctx.translate(nx, ny); ctx.scale(0.9 + i * 0.08, 0.9 + i * 0.08);
          ctx.strokeStyle = INK; ctx.lineWidth = 1;
          if (i === 1) {
            // beamed pair
            ctx.beginPath(); ctx.moveTo(1.9, 0); ctx.lineTo(1.9, -7.5); ctx.lineTo(7.4, -8.6); ctx.lineTo(7.4, -1.1);
            ctx.strokeStyle = INK; ctx.lineWidth = 2.6; ctx.stroke(); ctx.strokeStyle = '#ffe6a0'; ctx.lineWidth = 1.1; ctx.stroke();
            ell(ctx, 0, 0, 2.5, 1.8, -0.35); fo(ctx, '#ffe6a0', 1);
            ell(ctx, 5.5, -1.1, 2.5, 1.8, -0.35); fo(ctx, '#ffe6a0', 1);
          } else {
            ctx.beginPath(); ctx.moveTo(1.9, 0); ctx.lineTo(1.9, -8);
            if (i === 0) ctx.quadraticCurveTo(5.5, -6.5, 4.5, -3);
            ctx.strokeStyle = INK; ctx.lineWidth = 2.6; ctx.stroke(); ctx.strokeStyle = i ? '#bff3e8' : '#ffe6a0'; ctx.lineWidth = 1.1; ctx.stroke();
            ell(ctx, 0, 0, 2.6, 1.9, -0.35); fo(ctx, i ? '#bff3e8' : '#ffe6a0', 1);
          }
          ctx.restore();
        }
        ctx.globalAlpha = 1;
        ctx.restore();
      }
    },

    // ---------------- ハンター ----------------
    hunter(ctx, u) {
      const t = u.anim;
      const bob = walkBob(u, 11, 2);
      legs(ctx, u, { hip: -16, spread: 3.4, pants: '#6e4c2c', back: '#523720', boot: '#4e3322', bootB: '#3a2518', freq: 11 });
      ctx.translate(0, -bob);
      const aim = u.aim || 0, rel = u.atk || 0;
      const draw = rel > 0.05 ? 0 : aim;
      // hip quiver slung low behind, arrows slanting back
      ctx.save(); ctx.translate(-8.5, -22); ctx.rotate(-0.8);
      ctx.fillStyle = '#efe9dc'; ctx.fillRect(-2.4, -13, 1.4, 5); ctx.fillRect(0.7, -14, 1.4, 6);
      ctx.fillStyle = '#e86a42'; ctx.beginPath(); ctx.moveTo(-3.2, -13); ctx.lineTo(-1.7, -16); ctx.lineTo(-0.2, -13); ctx.fill();
      ctx.fillStyle = '#b8dc72'; ctx.beginPath(); ctx.moveTo(-0.1, -14); ctx.lineTo(1.4, -17); ctx.lineTo(2.9, -14); ctx.fill();
      ctx.beginPath(); rr(ctx, -3.3, -8.5, 6.6, 15, 2.2); fo(ctx, '#8a5a32', 1.2);
      ctx.fillStyle = '#c99a5a'; ctx.fillRect(-3.3, -6.6, 6.6, 1.4);
      ctx.restore();
      // young-grass shirt under a leather jerkin (V-neck, fringed hem)
      ctx.beginPath(); ctx.moveTo(-7, -36); ctx.lineTo(7, -36); ctx.lineTo(8.5, -17); ctx.quadraticCurveTo(0, -15, -8.5, -17); ctx.closePath();
      fo(ctx, '#9fcf5e', 1.4);
      ctx.beginPath(); ctx.moveTo(-7.5, -36); ctx.lineTo(0.5, -36); ctx.lineTo(3, -28.5); ctx.lineTo(5.5, -36); ctx.lineTo(7.5, -36); ctx.lineTo(9.8, -15.6);
      for (let i = 0; i < 6; i++) { const x0 = 9.8 - i * 3.27; ctx.lineTo(x0 - 1.63, -12.6); ctx.lineTo(x0 - 3.27, -15.6); }
      ctx.closePath();
      fo(ctx, lgc(ctx, 'hun-vest', 0, -36, 0, -13, [[0, '#b07644'], [1, '#7e4e2a']]), 1.4);
      ctx.fillStyle = 'rgba(60,28,8,.3)'; ctx.beginPath(); ctx.moveTo(-7.5, -36); ctx.lineTo(-3, -36); ctx.lineTo(-3.6, -14); ctx.lineTo(-6.5, -15.6); ctx.lineTo(-9.8, -15.6); ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(255,220,170,.4)'; ctx.fillRect(6, -33, 1.4, 11);
      // quiver strap + belt
      ctx.strokeStyle = '#5a3820'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(6, -35.5); ctx.lineTo(-7, -23); ctx.stroke();
      ctx.fillStyle = '#4e3020'; ctx.fillRect(-9, -21.5, 18.5, 3);
      ctx.fillStyle = '#e3b762'; rr(ctx, 1.5, -22, 4, 4, 1); ctx.fill();
      // head: chestnut hair, wide-brimmed leather hat with a long feather
      const hy = -46;
      ctx.beginPath(); ctx.moveTo(-10.5, hy - 2); ctx.quadraticCurveTo(-13, hy + 6, -8.5, hy + 9); ctx.lineTo(-5, hy + 3); ctx.closePath(); fo(ctx, '#7a4a2a', 1.1);
      face(ctx, hy, 11, SKIN, t);
      ctx.fillStyle = '#7a4a2a'; ctx.beginPath(); ctx.moveTo(0, hy - 7.5); ctx.quadraticCurveTo(7, hy - 8, 11, hy - 3); ctx.lineTo(8, hy - 4); ctx.lineTo(6.5, hy - 1.5); ctx.lineTo(4.5, hy - 4.5); ctx.lineTo(1.5, hy - 3); ctx.closePath(); ctx.fill();
      const ff = Math.sin(t * (u.walk ? 11 : 3)) * 1.6;
      ctx.beginPath(); ctx.moveTo(-4, hy - 11); ctx.bezierCurveTo(-8, hy - 21 + ff, -14, hy - 28 + ff, -21, hy - 30 + ff * 1.2); ctx.bezierCurveTo(-17, hy - 22 + ff, -11, hy - 15, -2, hy - 9.5); ctx.closePath();
      fo(ctx, '#e86a42', 1.1);
      ctx.strokeStyle = 'rgba(255,232,196,.85)'; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.moveTo(-3.5, hy - 10.5); ctx.quadraticCurveTo(-12, hy - 20 + ff, -20.5, hy - 29.5 + ff * 1.2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-3, hy - 10.5); ctx.quadraticCurveTo(-9, hy - 17 + ff * 0.7, -15, hy - 20 + ff); ctx.quadraticCurveTo(-9, hy - 13, -2, hy - 9.5); ctx.closePath();
      fo(ctx, '#b8dc72', 1);
      ctx.beginPath(); ctx.moveTo(-8.5, hy - 8); ctx.quadraticCurveTo(-8.8, hy - 16, -5, hy - 18.2); ctx.quadraticCurveTo(-1.5, hy - 16, 1.5, hy - 17.6); ctx.quadraticCurveTo(7, hy - 19, 8.2, hy - 15); ctx.lineTo(9.2, hy - 8); ctx.closePath();
      fo(ctx, lgc(ctx, 'hun-hat', 0, hy - 18, 0, hy - 7, [[0, '#a06c3a'], [1, '#6e4524']]), 1.3);
      ctx.strokeStyle = 'rgba(40,20,6,.35)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(-1.5, hy - 16); ctx.quadraticCurveTo(-0.5, hy - 13, -1, hy - 11); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-8.7, hy - 8.2); ctx.lineTo(9.3, hy - 8.2); ctx.lineTo(9, hy - 11.2); ctx.lineTo(-8.7, hy - 11.2); ctx.closePath(); fo(ctx, '#9fcf5e', 0.9);
      ctx.beginPath(); ctx.moveTo(-17.5, hy - 11.8); ctx.quadraticCurveTo(-14, hy - 6.4, -2, hy - 6.2); ctx.quadraticCurveTo(12, hy - 6, 19.5, hy - 4.2); ctx.quadraticCurveTo(15, hy - 9, 1, hy - 9.8); ctx.quadraticCurveTo(-11, hy - 10, -17.5, hy - 11.8); ctx.closePath();
      fo(ctx, '#7e5028', 1.3);
      ctx.strokeStyle = 'rgba(255,215,160,.45)'; ctx.lineWidth = 0.9; ctx.beginPath(); ctx.moveTo(-13, hy - 9.8); ctx.quadraticCurveTo(0, hy - 9, 15, hy - 7); ctx.stroke();
      // short recurve bow & draw
      const bx = 12.5, by = -32;
      const pull = bx - 4 - draw * 8;
      bone(ctx, 1, -32, pull + 1, by + 0.5, 3.8, '#8fbf52', INK, 2.3);
      bone(ctx, 3, -33, bx - 1, by, 3.8, '#8fbf52', INK, 2.3);
      ctx.save(); ctx.translate(bx, by);
      const vib = rel > 0 ? Math.sin(rel * 40) * rel * 1.6 : 0;
      ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(1, -14.5); ctx.quadraticCurveTo(-3.5, -13, -2, -9.5); ctx.quadraticCurveTo(5, -4, 4.2, 0); ctx.quadraticCurveTo(5, 4, -2, 9.5); ctx.quadraticCurveTo(-3.5, 13, 1, 14.5);
      ctx.strokeStyle = INK; ctx.lineWidth = 4.4; ctx.stroke(); ctx.strokeStyle = '#9a6430'; ctx.lineWidth = 2.4; ctx.stroke();
      ctx.lineCap = 'butt';
      ctx.fillStyle = '#9fcf5e'; ctx.fillRect(2.4, -2, 3.6, 4);
      ctx.strokeStyle = 'rgba(245,245,255,.9)'; ctx.lineWidth = 0.8;
      const px = pull - bx;
      ctx.beginPath(); ctx.moveTo(0.6, -14); ctx.lineTo(px + vib, 0); ctx.lineTo(0.6, 14); ctx.stroke();
      if (draw > 0.05) {
        ctx.strokeStyle = '#efe9dc'; ctx.lineWidth = 1.3; ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(8.5, 0); ctx.stroke();
        ctx.fillStyle = '#e86a42'; ctx.beginPath(); ctx.moveTo(px - 1, 0); ctx.lineTo(px + 2.5, -1.8); ctx.lineTo(px + 2.5, 1.8); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#e8edf6'; ctx.beginPath(); ctx.moveTo(11.5, 0); ctx.lineTo(7.5, -2.2); ctx.lineTo(7.5, 2.2); ctx.closePath(); ctx.fill();
        sglow(ctx, 9.5, 0, 5 + draw * 3, '255,225,160', 0.45 * draw);
      }
      ctx.restore();
      circ(ctx, pull, by + 0.5, 2.4); fo(ctx, SKIN, 1);
      circ(ctx, bx + 1, by, 2.4); fo(ctx, SKIN, 1);
    },

    // ---------------- スナイパー ----------------
    sniper(ctx, u) {
      const t = u.anim, at = u.atk || 0, ea = ease(clamp01(u.aim || 0));
      const kick = at * at;   // sharp recoil right after the shot
      // cancel drawUnit's forward lunge and step back with the recoil instead
      ctx.translate(-(at > 0 ? Math.sin((1 - at) * Math.PI) * 5 : 0) - kick * 3, 0);
      const bob = walkBob(u, 9, 1.8);
      const fl = Math.sin(t * (u.walk ? 9 : 2.4)) * (u.walk ? 2.2 : 0.8), trail = u.walk ? 3 : 0;
      legs(ctx, u, { hip: -17, spread: 3.2, pants: '#3e3236', back: '#2c2428', boot: '#4a2e1e', bootB: '#352015', freq: 9 });
      ctx.translate(0, -bob);
      // rifle: carried upright at rest → shouldered and level while aiming → kicks up on the shot
      const rot = lerp(-1.05, -0.02, ea) - kick * 0.32 + (u.walk ? Math.sin(t * 9) * 0.03 : 0);
      const gx = lerp(6.5, 6, ea) - kick * 4, gy = lerp(-25, -36, ea) + kick * 0.5;
      const cr = Math.cos(rot), sr = Math.sin(rot);
      const fx = gx + 15 * cr - 1.5 * sr, fy = gy + 15 * sr + 1.5 * cr;   // supporting hand under the fore-end
      // back arm (behind the coat)
      bone(ctx, -2.5, -34, fx, fy, 3.8, '#5e3420', INK, 2.3);
      // long coat with a wide flared hem, turned back to show the lining
      const tx = -18 - trail + fl, ty = -7.5 - fl * 0.3;
      ctx.beginPath(); ctx.moveTo(-8, -37.5); ctx.lineTo(7.5, -37.5); ctx.lineTo(8.5, -25); ctx.quadraticCurveTo(10, -14, 12.5 + fl * 0.2, -6);
      ctx.quadraticCurveTo(4, -4.2, -4, -5); ctx.quadraticCurveTo(-12, -5.4, tx, ty); ctx.quadraticCurveTo(-12, -18, -9.5, -30); ctx.closePath();
      fo(ctx, lgc(ctx, 'snp-coat', 0, -38, 0, -5, [[0, '#8e5434'], [1, '#5c3220']]), 1.4);
      ctx.fillStyle = 'rgba(40,14,6,.3)'; ctx.beginPath(); ctx.moveTo(-8, -37.5); ctx.lineTo(-3.5, -37.5); ctx.lineTo(-4.5, -5); ctx.quadraticCurveTo(-12, -5.4, tx, ty); ctx.quadraticCurveTo(-12, -18, -9.5, -30); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(4.5, -36.5); ctx.lineTo(7.5, -37); ctx.lineTo(8.5, -25); ctx.quadraticCurveTo(10, -14, 12.5 + fl * 0.2, -6); ctx.lineTo(9, -5.3); ctx.quadraticCurveTo(7, -15, 5.5, -24); ctx.closePath();
      fo(ctx, '#d9a066', 1.1);
      ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(-10.5, -5.5); ctx.lineTo(-14.6, -13); ctx.closePath(); fo(ctx, '#c98c56', 1);
      ctx.fillStyle = '#3a2218'; ctx.fillRect(-9.3, -22, 18.5, 3);
      ctx.fillStyle = '#e3b762'; rr(ctx, -0.5, -22.5, 4, 4, 1); ctx.fill();
      circ(ctx, 2.6, -31, 0.95); ctx.fill(); circ(ctx, 3, -27, 0.95); ctx.fill();
      ctx.fillStyle = 'rgba(255,200,150,.3)'; ctx.fillRect(1.6, -35, 1.3, 11);
      // high collar behind the head
      ctx.beginPath(); ctx.moveTo(-9, -36.5); ctx.lineTo(-10.5, -45); ctx.quadraticCurveTo(-5, -41.5, -1, -38.5); ctx.closePath(); fo(ctx, '#7a4428', 1.2);
      // head (dips toward the scope when aiming): dark auburn hair, tied tail, brass monocle
      const hy = -47 + ea * 2.2, hx = ea * 1.2;
      ctx.save(); ctx.translate(hx, 0);
      const pf = Math.sin(t * (u.walk ? 9 : 2.4)) * 1.2;
      ctx.beginPath(); ctx.moveTo(-9, hy - 4); ctx.quadraticCurveTo(-17, hy - 3 + pf, -18.5, hy + 5 + pf); ctx.quadraticCurveTo(-14, hy + 2, -9.5, hy + 2); ctx.closePath(); fo(ctx, '#4a2c22', 1.1);
      ctx.beginPath(); rr(ctx, -11.6, hy - 3.6, 3.2, 3.6, 1); fo(ctx, '#d9a066', 0.8);
      face(ctx, hy, 10.5, SKIN, t);
      ctx.beginPath(); ctx.moveTo(-10.5, hy + 1.5); ctx.quadraticCurveTo(-11.5, hy - 9, 0, hy - 9.5); ctx.quadraticCurveTo(9, hy - 9.5, 11, hy - 2); ctx.lineTo(8, hy - 3.6); ctx.quadraticCurveTo(6.5, hy - 1.5, 5, hy - 4.6); ctx.quadraticCurveTo(2, hy - 3.4, 0, hy - 4); ctx.quadraticCurveTo(-4.5, hy - 3, -5, hy + 4); ctx.closePath();
      fo(ctx, '#4a2c22', 1.2);
      ctx.strokeStyle = 'rgba(255,190,150,.4)'; ctx.lineWidth = 0.9; ctx.beginPath(); ctx.moveTo(-6, hy - 6.5); ctx.quadraticCurveTo(-1, hy - 8.6, 4, hy - 7.6); ctx.stroke();
      ctx.strokeStyle = INK; ctx.lineWidth = 2.2; circ(ctx, 7.3, hy + 0.9, 2.9); ctx.stroke();
      ctx.strokeStyle = '#e3b762'; ctx.lineWidth = 1.1; ctx.stroke();
      ctx.strokeStyle = 'rgba(227,183,98,.8)'; ctx.lineWidth = 0.6; ctx.beginPath(); ctx.moveTo(7.6, hy + 3.8); ctx.quadraticCurveTo(6.5, hy + 7, 3.5, hy + 8.5); ctx.stroke();
      ctx.restore();
      // turned-up front collar framing the jaw
      ctx.beginPath(); ctx.moveTo(2.5, -38); ctx.lineTo(9, -41); ctx.lineTo(8.2, -35.2); ctx.closePath(); fo(ctx, '#d9a066', 1.1);
      // the long rifle
      ctx.save(); ctx.translate(gx, gy); ctx.rotate(rot);
      ctx.beginPath(); ctx.moveTo(-15, -1.6); ctx.lineTo(-2, -2); ctx.lineTo(1, 1.4); ctx.lineTo(-3, 2.6); ctx.lineTo(-15, 4.8); ctx.closePath(); fo(ctx, '#8a5530', 1.2);
      ctx.fillStyle = 'rgba(255,210,160,.35)'; ctx.fillRect(-13.5, -1, 10, 0.9);
      ctx.beginPath(); rr(ctx, -2, -2.4, 12, 4.2, 1); fo(ctx, '#4a4650', 1.1);
      ctx.strokeStyle = INK; ctx.lineWidth = 0.9; ctx.beginPath(); ctx.arc(2, 2.4, 1.8, 0, Math.PI); ctx.stroke();
      ctx.beginPath(); rr(ctx, 9, -1.4, 13, 3.4, 1.2); fo(ctx, '#8a5530', 1.1);
      bone(ctx, 9, -0.6, 45, -0.6, 1.8, '#5a5862', INK, 2);
      ctx.strokeStyle = 'rgba(220,220,240,.5)'; ctx.lineWidth = 0.5; ctx.beginPath(); ctx.moveTo(23, -1.1); ctx.lineTo(44, -1.1); ctx.stroke();
      ctx.beginPath(); rr(ctx, 43, -1.9, 3.4, 2.6, 0.6); fo(ctx, '#3a3840', 0.8);
      ctx.beginPath(); rr(ctx, 0, -6.4, 13, 2.8, 1.2); fo(ctx, lgc(ctx, 'snp-scope', 0, -6.4, 0, -3.6, [[0, '#f2d38a'], [1, '#b8862e']]), 1);
      ctx.fillStyle = '#3a3840'; ctx.fillRect(3, -3.7, 1.4, 1.6); ctx.fillRect(9, -3.7, 1.4, 1.6);
      ctx.fillStyle = '#ffd8b0'; ctx.fillRect(12.4, -5.9, 0.9, 1.8);
      // sight light: a thin fading line from the scope (only while holding aim)
      const sa = ea * clamp01((u.aim || 0) * 2 - 1) * (at > 0.05 ? 0 : 1);
      if (sa > 0.02) {
        ctx.save(); ctx.globalAlpha *= sa;
        ctx.strokeStyle = lgc(ctx, 'snp-sight', 14, 0, 104, 0, [[0, 'rgba(255,170,120,.85)'], [1, 'rgba(255,170,120,0)']]);
        ctx.lineWidth = 0.7; ctx.beginPath(); ctx.moveTo(14, -5); ctx.lineTo(104, -5); ctx.stroke();
        ctx.restore();
        sglow(ctx, 13.4, -5, 3.2, '255,170,120', 0.7 * sa);
      }
      // muzzle flash (stretched along the barrel) + smoke
      if (at > 0.55) {
        const q = (at - 0.55) / 0.45;
        ctx.globalCompositeOperation = 'lighter';
        sglow(ctx, 50, -0.6, 6 + q * 12, '255,180,100', q);
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = `rgba(255,240,200,${q.toFixed(3)})`; ell(ctx, 51.5, -0.6, 2.5 + q * 6, 0.8 + q * 1.6); ctx.fill();
      }
      if (at > 0.02 && at < 0.9) {
        const p = 1 - at;
        for (let i = 0; i < 3; i++) { ctx.fillStyle = `rgba(205,198,214,${(at * 0.45 * (1 - i * 0.25)).toFixed(3)})`; circ(ctx, 47 + p * 6 + i * 3, -2 - p * 7 - i * 2.2, 1.4 + p * 2.6 + i * 0.5); ctx.fill(); }
      }
      ctx.restore();
      circ(ctx, fx, fy, 2.4); fo(ctx, SKIN, 1);
      // trigger arm: shoulder → elbow → grip
      const ex = lerp(6, 0, ea) - kick * 2, ey = lerp(-26, -28.5, ea);
      bone(ctx, 2.5, -34, ex, ey, 3.8, '#7a4428', INK, 2.3);
      bone(ctx, ex, ey, gx - 0.5, gy + 1.2, 3.6, '#7a4428', INK, 2.3);
      circ(ctx, gx, gy + 1.2, 2.5); fo(ctx, SKIN, 1);
    },

    // ---------------- 雷の魔法使い ----------------
    thunder(ctx, u) {
      const t = u.anim, at = u.atk || 0, pre = antic(u, 0.4);
      const hov = Math.sin(t * 3.2) * 1.4 + 1.4;
      const thrust = at > 0 ? Math.sin(at * Math.PI * 0.5) : 0;
      const pulse = Math.max(pre, thrust);
      ctx.translate(0, -hov);
      ctx.beginPath(); ell(ctx, 3, -1.5, 3.5, 1.8); fo(ctx, '#4a4a5a', 1);
      // long robe: golden outer robe open over a slate-blue under-robe
      ctx.beginPath(); ctx.moveTo(-7, -40); ctx.lineTo(7, -40); ctx.quadraticCurveTo(10, -20, 13.5, -3); ctx.quadraticCurveTo(0, 1, -13.5, -3); ctx.quadraticCurveTo(-11, -20, -7, -40); ctx.closePath();
      fo(ctx, lgc(ctx, 'thu-robe', 0, -40, 0, 0, [[0, '#f6d466'], [0.6, '#ddac38'], [1, '#b07c22']]), 1.4);
      ctx.fillStyle = 'rgba(90,50,0,.26)'; ctx.beginPath(); ctx.moveTo(-7, -40); ctx.lineTo(-2, -40); ctx.quadraticCurveTo(-3, -18, -4, -1); ctx.quadraticCurveTo(-9, -1.6, -13.5, -3); ctx.quadraticCurveTo(-11, -20, -7, -40); ctx.fill();
      ctx.beginPath(); ctx.moveTo(2.5, -38); ctx.lineTo(6.6, -38); ctx.quadraticCurveTo(9, -20, 11.2, -3.4); ctx.quadraticCurveTo(7.5, -2.3, 3.6, -2); ctx.quadraticCurveTo(3, -20, 2.5, -38); ctx.closePath();
      fo(ctx, lgc(ctx, 'thu-under', 0, -38, 0, -2, [[0, '#7c8ca8'], [1, '#55647e']]), 1.1);
      // slate hem band with a gold zigzag
      ctx.beginPath(); ctx.moveTo(-13.1, -4.2); ctx.quadraticCurveTo(0, -0.3, 13.1, -4.2); ctx.lineTo(12.3, -9); ctx.quadraticCurveTo(0, -5, -12.3, -9); ctx.closePath();
      ctx.fillStyle = '#56667f'; ctx.fill();
      ctx.strokeStyle = '#ffd85a'; ctx.lineWidth = 1.1; ctx.beginPath();
      for (let i = 0; i <= 8; i++) { const x = -11.5 + i * 2.9, yb = -6.6 + (x * x) / 170 + 2.2; ctx.lineTo(x, yb - (i % 2 ? 3 : 0.3)); }
      ctx.stroke();
      ctx.strokeStyle = '#ffe38a'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(2.5, -38); ctx.quadraticCurveTo(3, -20, 3.6, -8); ctx.stroke();
      ctx.fillStyle = '#56667f'; ctx.fillRect(-8.5, -26, 17, 2.6);
      ctx.fillStyle = '#ffd85a'; rr(ctx, 0.8, -26.6, 3.6, 3.8, 0.8); ctx.fill();
      // back sleeve
      ctx.beginPath(); ctx.moveTo(-6, -37); ctx.quadraticCurveTo(-12, -30, -12.5, -22); ctx.lineTo(-5, -23); ctx.closePath(); fo(ctx, '#d2a236', 1.2);
      ctx.strokeStyle = '#56667f'; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(-12.2, -23.2); ctx.lineTo(-5.4, -24); ctx.stroke();
      // head: slate hair swept back by static, gold circlet
      const hy = -48, hf = Math.sin(t * 7) * 0.8;
      ctx.beginPath(); ctx.moveTo(-5, hy - 9); ctx.quadraticCurveTo(-13, hy - 12, -19.5 + hf, hy - 8.5); ctx.quadraticCurveTo(-14, hy - 6.5, -11, hy - 4); ctx.quadraticCurveTo(-15.5, hy - 1.5, -18 + hf, hy + 3.5); ctx.quadraticCurveTo(-12, hy + 4.5, -8, hy + 4); ctx.closePath();
      fo(ctx, '#55627e', 1.2);
      face(ctx, hy, 10.5, SKIN, t);
      ctx.beginPath(); ctx.moveTo(-10.5, hy + 1); ctx.quadraticCurveTo(-11, hy - 8, -4, hy - 10); ctx.quadraticCurveTo(-6, hy - 13, -10, hy - 14.5); ctx.quadraticCurveTo(-1, hy - 14.5, 5, hy - 9.5); ctx.quadraticCurveTo(10.5, hy - 7, 11, hy - 1); ctx.lineTo(8, hy - 3.5); ctx.lineTo(6, hy - 0.5); ctx.lineTo(3.5, hy - 4); ctx.quadraticCurveTo(-3, hy - 3, -5, hy + 4); ctx.closePath();
      fo(ctx, '#64728f', 1.2);
      ctx.strokeStyle = 'rgba(210,225,255,.45)'; ctx.lineWidth = 0.9; ctx.beginPath(); ctx.moveTo(-7, hy - 7); ctx.quadraticCurveTo(-2, hy - 9.5, 4, hy - 8); ctx.stroke();
      ctx.strokeStyle = INK; ctx.lineWidth = 2.8; ctx.beginPath(); ctx.moveTo(-1, hy - 6.6); ctx.quadraticCurveTo(5, hy - 7.6, 10.6, hy - 4.2); ctx.stroke();
      ctx.strokeStyle = '#ffd85a'; ctx.lineWidth = 1.4; ctx.stroke();
      // lightning-bolt staff; the tip glows yellow while casting
      ctx.save(); ctx.translate(12 + thrust * 3, -28); ctx.rotate(-0.08 + thrust * 0.32 - pre * 0.06);
      bone(ctx, 0, 27, 0, -6, 2.2, '#7d8aa4', INK, 2.2);
      ctx.beginPath(); rr(ctx, -2.2, -7.4, 4.4, 2.6, 1); fo(ctx, '#e8b840', 0.9);
      const tipY = -25;
      ctx.globalCompositeOperation = 'lighter';
      sglow(ctx, 0.5, tipY, 7 + pulse * 15 + Math.sin(t * 9) * 0.8, '255,226,90', 0.3 + pulse * 0.65);
      ctx.globalCompositeOperation = 'source-over';
      ctx.beginPath(); ctx.moveTo(0.5, tipY); ctx.lineTo(-4, -13.5); ctx.lineTo(-0.5, -14); ctx.lineTo(-1, -5.5); ctx.lineTo(4, -16); ctx.lineTo(0.4, -15.5); ctx.closePath();
      fo(ctx, lgc(ctx, 'thu-bolt', 0, tipY, 0, -5, [[0, '#fff3b0'], [1, '#e0a92c']]), 1.2);
      ctx.fillStyle = 'rgba(255,255,240,.8)'; ctx.beginPath(); ctx.moveTo(0.5, tipY + 1.5); ctx.lineTo(-2.6, -14); ctx.lineTo(-1.2, -14.2); ctx.closePath(); ctx.fill();
      if (pulse > 0.08) {
        circ(ctx, 0.5, tipY, 1.4 + pulse * 1.4); ctx.fillStyle = '#fffbe0'; ctx.fill();
        // two little crackles near the tip
        const f = Math.floor(t * 18), r1 = rng(f * 7 + 3);
        ctx.strokeStyle = `rgba(255,243,160,${(0.5 + pulse * 0.5).toFixed(3)})`; ctx.lineWidth = 0.9;
        for (let k = 0; k < 2; k++) {
          const a = -Math.PI / 2 + (r1() - 0.5) * 2.4, len = 5 + pulse * 5;
          ctx.beginPath(); ctx.moveTo(0.5 + Math.cos(a) * 3, tipY + Math.sin(a) * 3);
          for (let s = 1; s <= 3; s++) { const d = 3 + len * s / 3, j = (r1() - 0.5) * 3; ctx.lineTo(0.5 + Math.cos(a) * d - Math.sin(a) * j, tipY + Math.sin(a) * d + Math.cos(a) * j); }
          ctx.stroke();
        }
      }
      ctx.restore();
      // front sleeve & hand
      ctx.beginPath(); ctx.moveTo(4, -38); ctx.quadraticCurveTo(10, -34, 12 + thrust * 2, -28); ctx.lineTo(8 + thrust * 2, -24); ctx.quadraticCurveTo(4, -29, 1, -33); ctx.closePath(); fo(ctx, '#e6b544', 1.2);
      ctx.strokeStyle = '#56667f'; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(12 + thrust * 2, -28); ctx.lineTo(8 + thrust * 2, -24); ctx.stroke();
      circ(ctx, 11.5 + thrust * 3, -26, 2.4); fo(ctx, SKIN, 1);
    },

    // ---------------- 忍者 ----------------
    ninja(ctx, u) {
      const t = u.anim, at = u.atk || 0, pre = antic(u, 0.22);
      const air = (u.jumpH || 0) > 0, run = !!u.walk && !air;
      const SUIT = '#33313e', SUIT_B = '#25242e', SUIT_L = '#4c4958', SCARF = '#ec5a2c', SCARF_D = '#bf3f1e', SASH = '#f39040';
      // long muffler tails trailing behind (drawn first, behind the body)
      const scarf = (nx, ny, len, lift) => {
        const fast = run || air, sp = fast ? 16 : 5, amp = fast ? 2.6 : 1.4;
        const w1 = Math.sin(t * sp) * amp, w2 = Math.sin(t * sp + 1.6) * amp, w3 = Math.sin(t * sp + 3.1) * amp;
        ctx.beginPath(); ctx.moveTo(nx, ny - 2.2);
        ctx.bezierCurveTo(nx - len * 0.3, ny - 2 + lift * 0.25 + w1 * 0.4, nx - len * 0.65, ny - 1 + lift * 0.7 + w2, nx - len, ny + lift + w3);
        ctx.lineTo(nx - len + 1, ny + lift + 4.6 + w3);
        ctx.bezierCurveTo(nx - len * 0.62, ny + lift * 0.7 + 3.4 + w2, nx - len * 0.3, ny + 3 + w1 * 0.3, nx, ny + 2.6);
        ctx.closePath(); fo(ctx, SCARF, 1.3);
        const l2 = len * 0.66, lf2 = lift + 4;
        ctx.beginPath(); ctx.moveTo(nx, ny);
        ctx.bezierCurveTo(nx - l2 * 0.35, ny + lf2 * 0.3 + w2 * 0.4, nx - l2 * 0.7, ny + lf2 * 0.75 + w3, nx - l2, ny + lf2 + w1);
        ctx.lineTo(nx - l2 + 1.4, ny + lf2 + 3.8 + w1);
        ctx.bezierCurveTo(nx - l2 * 0.6, ny + lf2 * 0.75 + 3 + w3, nx - l2 * 0.3, ny + 3.6, nx, ny + 3.4);
        ctx.closePath(); fo(ctx, SCARF_D, 1.2);
      };
      const kunai = (x, y, rot) => {
        ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
        ctx.strokeStyle = INK; ctx.lineWidth = 2.4; circ(ctx, -5.2, 0, 1.9); ctx.stroke();
        ctx.strokeStyle = '#b8c0d0'; ctx.lineWidth = 1; ctx.stroke();
        ctx.beginPath(); rr(ctx, -3.6, -1.2, 7, 2.4, 0.8); fo(ctx, SCARF_D, 1);
        ctx.beginPath(); ctx.moveTo(3, -1.5); ctx.lineTo(6.5, -2.4); ctx.lineTo(13, 0); ctx.lineTo(6.5, 2.4); ctx.lineTo(3, 1.5); ctx.closePath();
        fo(ctx, '#c9d1de', 1.1);
        ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = 0.6; ctx.beginPath(); ctx.moveTo(4, 0); ctx.lineTo(11.5, 0); ctx.stroke();
        ctx.restore();
      };
      // head: hooded, cloth over mouth and nose, eyes showing, persimmon headband
      const head = (hy, tailLift) => {
        const tf = Math.sin(t * (run || air ? 15 : 4)) * 1.4;
        ctx.beginPath(); ctx.moveTo(-9, hy - 6.5); ctx.quadraticCurveTo(-15, hy - 6 + tf * 0.4, -19, hy - 2 + tailLift + tf); ctx.lineTo(-17, hy + 0.5 + tailLift + tf); ctx.quadraticCurveTo(-13, hy - 2.5, -9, hy - 3.5); ctx.closePath(); fo(ctx, SASH, 1);
        ctx.beginPath(); ctx.moveTo(-9, hy - 5); ctx.quadraticCurveTo(-13, hy - 1, -15, hy + 4 + tailLift * 0.6 + tf * 0.6); ctx.lineTo(-12.6, hy + 4.6 + tailLift * 0.6 + tf * 0.6); ctx.quadraticCurveTo(-11, hy, -8.5, hy - 3); ctx.closePath(); fo(ctx, '#d8742e', 1);
        face(ctx, hy, 10.5, SKIN, t);
        ctx.save(); circ(ctx, 0, hy, 10.5); ctx.clip();
        ctx.fillStyle = SUIT_L; ctx.beginPath(); ctx.moveTo(-12, hy + 3.4); ctx.quadraticCurveTo(3, hy + 2.6, 12, hy + 3.8); ctx.lineTo(12, hy + 12); ctx.lineTo(-12, hy + 12); ctx.closePath(); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,.12)'; ctx.fillRect(2, hy + 5.5, 8, 0.9);
        ctx.fillStyle = SUIT; ctx.beginPath(); ctx.moveTo(-12, hy - 3.4); ctx.quadraticCurveTo(3, hy - 4.6, 12, hy - 3); ctx.lineTo(12, hy - 12); ctx.lineTo(-12, hy - 12); ctx.closePath(); ctx.fill();
        ctx.beginPath(); ctx.moveTo(-12, hy - 12); ctx.lineTo(-3.5, hy - 12); ctx.quadraticCurveTo(-2.2, hy, -3.6, hy + 12); ctx.lineTo(-12, hy + 12); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = INK; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(-3, hy - 3.6); ctx.quadraticCurveTo(3, hy - 4.6, 12, hy - 3); ctx.moveTo(-3, hy + 3.2); ctx.quadraticCurveTo(3, hy + 2.6, 12, hy + 3.8); ctx.stroke();
        ctx.fillStyle = SASH; ctx.beginPath(); ctx.moveTo(-12, hy - 5.6); ctx.quadraticCurveTo(2, hy - 7.6, 12, hy - 5.4); ctx.lineTo(12, hy - 8.4); ctx.quadraticCurveTo(2, hy - 10.6, -12, hy - 8.6); ctx.closePath(); ctx.fill();
        ctx.restore();
        ctx.strokeStyle = INK; ctx.lineWidth = 1.4; circ(ctx, 0, hy, 10.5); ctx.stroke();
        ctx.strokeStyle = 'rgba(170,165,200,.35)'; ctx.lineWidth = 0.9; ctx.beginPath(); ctx.arc(0, hy, 8.6, Math.PI * 1.15, Math.PI * 1.45); ctx.stroke();
      };
      if (!air) {
        const bob = walkBob(u, 13, 2.2), crouch = run ? 1.8 : 0.6 + pre * 1.6;
        legs(ctx, u, { hip: -15, spread: 3.6, pants: SUIT, back: SUIT_B, boot: '#4a4756', bootB: '#38363f', freq: 13 });
        ctx.translate(0, -bob + crouch);
        scarf(-2, -37, run ? 32 : 22, run ? 2 : 12);
        // back arm
        const sw = run ? Math.sin(t * 13) * 0.8 : 0.25;
        const bx = -3 - Math.sin(sw) * 9, by = -32 + Math.cos(sw) * 9;
        bone(ctx, -3, -32, bx, by, 3.8, SUIT_B, INK, 2.4);
        bone(ctx, -3 - Math.sin(sw) * 6.5, -32 + Math.cos(sw) * 6.5, bx, by, 3.9, SASH, INK, 1.6);
        circ(ctx, -3 - Math.sin(sw) * 10.5, -32 + Math.cos(sw) * 10.5, 2.3); fo(ctx, SKIN, 1);
        // tunic with split hem
        ctx.beginPath(); ctx.moveTo(-7, -36); ctx.lineTo(7, -36); ctx.lineTo(8.6, -16); ctx.lineTo(2, -13.2); ctx.lineTo(0.2, -16.2); ctx.lineTo(-1.8, -13.2); ctx.lineTo(-8.6, -16); ctx.closePath();
        fo(ctx, lgc(ctx, 'nin-suit', 0, -36, 0, -13, [[0, '#3e3c4a'], [1, '#28272f']]), 1.4);
        ctx.fillStyle = 'rgba(0,0,10,.3)'; ctx.beginPath(); ctx.moveTo(-7, -36); ctx.lineTo(-2.6, -36); ctx.lineTo(-3.2, -14.2); ctx.lineTo(-8.6, -16); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = SUIT_L; ctx.lineWidth = 1.3; ctx.beginPath(); ctx.moveTo(-4.5, -35.5); ctx.lineTo(3.4, -26.5); ctx.moveTo(5.5, -35.5); ctx.lineTo(1.6, -30.5); ctx.stroke();
        ctx.fillStyle = 'rgba(220,210,255,.16)'; ctx.fillRect(4.4, -33, 1.5, 12);
        // persimmon sash with a knot at the back
        ctx.beginPath(); ctx.moveTo(-9.5, -18.6); ctx.quadraticCurveTo(-12 + Math.sin(t * 6) * 0.6, -15, -12.5, -11.5); ctx.lineTo(-10, -11.8); ctx.quadraticCurveTo(-9.6, -15, -7.6, -18.2); ctx.closePath(); fo(ctx, '#d8742e', 1);
        ctx.beginPath(); rr(ctx, -9, -22.4, 18.2, 3.8, 1.2); fo(ctx, SASH, 1.1);
        ctx.beginPath(); ell(ctx, -8.6, -20.5, 2.4, 2.1); fo(ctx, SASH, 1);
        head(-46, run ? -1 : 3);
        // muffler wrap over the neck
        ctx.beginPath(); rr(ctx, -8.5, -40, 17, 5.6, 2.6); fo(ctx, SCARF, 1.2);
        ctx.fillStyle = 'rgba(255,200,170,.55)'; ctx.fillRect(-5.5, -39, 9, 1);
        ctx.strokeStyle = SCARF_D; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(-6, -36.4); ctx.lineTo(6, -36.4); ctx.stroke();
        // kunai arm: reverse grip at rest, a straight stab on attack
        const ext = at > 0 ? Math.sin(Math.min(1, at * 1.25) * Math.PI * 0.5) : 0;
        const hx = lerp(lerp(8.5, 5, pre), 18, ext) + (run ? Math.sin(t * 13 + Math.PI) * 2.4 : 0);
        const hyy = lerp(lerp(-26, -29.5, pre), -31, ext) + (run ? Math.cos(t * 13) * 1.2 : 0);
        const kr = lerp(lerp(1.95, 2.5, pre), 0, ext);
        if (ext > 0.4) {
          const al = (ext - 0.4) / 0.6;
          ctx.fillStyle = `rgba(255,236,220,${(al * 0.45).toFixed(3)})`;
          ctx.beginPath(); ctx.moveTo(hx + 4, hyy - 1); ctx.lineTo(hx + 30, hyy - 2.2); ctx.lineTo(hx + 33, hyy); ctx.lineTo(hx + 30, hyy + 2.2); ctx.lineTo(hx + 4, hyy + 1); ctx.closePath(); ctx.fill();
          ctx.strokeStyle = `rgba(255,255,255,${(al * 0.75).toFixed(3)})`; ctx.lineWidth = 0.9;
          ctx.beginPath(); ctx.moveTo(hx + 10, hyy - 4); ctx.lineTo(hx + 26, hyy - 4.4); ctx.moveTo(hx + 12, hyy + 4); ctx.lineTo(hx + 27, hyy + 4.2); ctx.stroke();
        }
        bone(ctx, 3, -33, hx - 1, hyy, 3.8, SUIT, INK, 2.4);
        const wx = lerp(3, hx, 0.72), wy = lerp(-33, hyy, 0.72);
        bone(ctx, wx, wy, lerp(3, hx, 0.9), lerp(-33, hyy, 0.9), 3.9, SASH, INK, 1.6);
        kunai(hx, hyy, kr);
        circ(ctx, hx, hyy, 2.5); fo(ctx, SKIN, 1);
      } else {
        // airborne: curled into a tight ball, muffler streaming behind
        const tf = Math.sin(t * 16) * 1;
        ctx.translate(0, -5 + tf * 0.4);
        scarf(-2, -36, 34, -2);
        // back leg (tucked)
        bone(ctx, -3, -22, 7, -28.5, 4.8, SUIT_B, INK, 2.4);
        bone(ctx, 7, -28.5, -0.5, -17.5, 4.4, SUIT_B, INK, 2.4);
        ctx.beginPath(); ell(ctx, 0.5, -15.6, 3.6, 2.1, 0.3); fo(ctx, '#38363f', 1.1);
        // back arm hugging the knees
        bone(ctx, -3, -32, 5, -26, 3.8, SUIT_B, INK, 2.4);
        // curled torso (rounded back)
        ctx.beginPath(); ctx.moveTo(-6, -37); ctx.quadraticCurveTo(-12.5, -30, -8.5, -19.5); ctx.lineTo(3.5, -18.5); ctx.quadraticCurveTo(6, -28, 7, -36); ctx.closePath();
        fo(ctx, lgc(ctx, 'nin-suit', 0, -36, 0, -13, [[0, '#3e3c4a'], [1, '#28272f']]), 1.4);
        ctx.fillStyle = 'rgba(0,0,10,.3)'; ctx.beginPath(); ctx.moveTo(-6, -37); ctx.quadraticCurveTo(-12.5, -30, -8.5, -19.5); ctx.lineTo(-4.5, -19.4); ctx.quadraticCurveTo(-7, -28, -2, -37); ctx.closePath(); ctx.fill();
        ctx.beginPath(); ctx.moveTo(-10.4, -22.6); ctx.lineTo(4.4, -22); ctx.lineTo(4.1, -18.4); ctx.lineTo(-9.4, -18.8); ctx.closePath(); fo(ctx, SASH, 1.1);
        ctx.beginPath(); ctx.moveTo(-10, -20.5); ctx.quadraticCurveTo(-15, -19 + tf, -17, -16 + tf); ctx.lineTo(-14.6, -15.2 + tf); ctx.quadraticCurveTo(-12.5, -18, -9.6, -18.8); ctx.closePath(); fo(ctx, '#d8742e', 1);
        // front leg (tucked, in front of the chest)
        bone(ctx, -1, -21, 10.5, -26.5, 5, SUIT, INK, 2.4);
        bone(ctx, 10.5, -26.5, 4, -15.5, 4.6, SUIT, INK, 2.4);
        ctx.beginPath(); ell(ctx, 5.5, -14, 3.8, 2.2, 0.35); fo(ctx, '#4a4756', 1.1);
        // head tucked forward and down
        ctx.save(); ctx.translate(2, 1.5);
        head(-45, -4);
        ctx.beginPath(); rr(ctx, -8.5, -39.5, 17, 5.6, 2.6); fo(ctx, SCARF, 1.2);
        ctx.restore();
        // kunai hand on the knee, blade laid back along the forearm
        bone(ctx, 3, -33, 12, -27, 3.8, SUIT, INK, 2.4);
        bone(ctx, 9.3, -28.8, 11.2, -27.5, 3.9, SASH, INK, 1.6);
        kunai(12.5, -26.5, 2.7);
        circ(ctx, 12.5, -26.5, 2.5); fo(ctx, SKIN, 1);
      }
    },

    // ---------------- パラディン ----------------
    // 大柄な白銀の全身甲冑＋長い白の前掛け、羽根の大盾、戦槌。マントは着けない。
    paladin(ctx, u) {
      const t = u.anim, at = u.atk || 0, pre = antic(u, 0.3);
      const SIL = '#e2e7ef', SIL_D = '#a7b1c2', GOLD = '#e8c47a', CRIM = '#b4464a';
      const bob = walkBob(u, 8, 1.5);
      const slam = at > 0 ? ease(at) : 0;
      legs(ctx, u, { hip: -16, spread: 5.6, pants: '#c6cfdb', back: '#9aa5b8', boot: '#b7c1cf', bootB: '#8c97aa', freq: 8, w: 6.4 });
      ctx.translate(0, -bob + pre * 1.2 + slam * 1.8);
      const sway = u.walk ? Math.sin(t * 8) * 1.2 : Math.sin(t * 1.8) * 0.3;
      // big kite shield on the far arm: crimson field, silver rim, a golden feather
      ctx.save(); ctx.translate(-17 - pre * 1.2, -29 + slam * 0.6); ctx.rotate(-0.1 + pre * 0.05);
      ctx.beginPath(); ctx.moveTo(-10.5, -16); ctx.quadraticCurveTo(0, -20.5, 10.5, -16); ctx.lineTo(10.5, -2); ctx.quadraticCurveTo(9.5, 13, 0, 21.5); ctx.quadraticCurveTo(-9.5, 13, -10.5, -2); ctx.closePath();
      fo(ctx, lgc(ctx, 'pal-shield-rim', -10, 0, 10, 0, [[0, '#b9c2d0'], [0.5, '#f4f6fa'], [1, '#aeb8c8']]), 1.6);
      ctx.beginPath(); ctx.moveTo(-8, -14.2); ctx.quadraticCurveTo(0, -17.8, 8, -14.2); ctx.lineTo(8, -2); ctx.quadraticCurveTo(7.2, 11, 0, 18.2); ctx.quadraticCurveTo(-7.2, 11, -8, -2); ctx.closePath();
      fo(ctx, lgc(ctx, 'pal-shield', -8, 0, 8, 0, [[0, '#8e3238'], [0.5, CRIM], [1, '#82303a']]), 1);
      ctx.save(); ctx.translate(0, 1.5); ctx.rotate(0.42);
      ctx.beginPath(); ctx.moveTo(0, -13); ctx.bezierCurveTo(5.4, -8, 5.2, 3, 1, 9.5); ctx.lineTo(0.6, 7); ctx.lineTo(-0.6, 9.8); ctx.bezierCurveTo(-5, 3, -5.2, -8, 0, -13); ctx.closePath();
      fo(ctx, lgc(ctx, 'pal-feather', 0, -13, 0, 10, [[0, '#fff1c4'], [1, '#e2b45a']]), 1, '#6e4a1c');
      ctx.strokeStyle = '#7a5424'; ctx.lineWidth = 0.9; ctx.beginPath(); ctx.moveTo(0, -11.5); ctx.lineTo(0, 14.5); ctx.stroke();
      ctx.lineWidth = 0.55; ctx.beginPath();
      for (let i = 0; i < 5; i++) { const y = -7 + i * 3.4; ctx.moveTo(0, y); ctx.lineTo(3, y - 2.2); ctx.moveTo(0, y); ctx.lineTo(-3, y - 2.2); }
      ctx.stroke();
      ctx.restore();
      ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.beginPath(); ctx.moveTo(-6.5, -13); ctx.quadraticCurveTo(-3, -14.6, 0, -15); ctx.lineTo(-6.6, -4); ctx.closePath(); ctx.fill();
      ctx.restore();
      // far arm into the shield grip
      bone(ctx, -8, -35, -15, -28, 5.6, SIL_D, INK, 2.4);
      circ(ctx, -15.5, -27.5, 3); fo(ctx, '#b3bdcc', 1.1);
      // far pauldron
      ctx.beginPath(); ell(ctx, -8.5, -37.5, 6.5, 5); fo(ctx, '#aeb8c8', 1.3);
      // broad breastplate
      ctx.beginPath(); ctx.moveTo(-13, -40); ctx.quadraticCurveTo(0, -45, 12.5, -40); ctx.lineTo(13, -17); ctx.quadraticCurveTo(0, -13, -13, -17); ctx.closePath();
      fo(ctx, lgc(ctx, 'pal-chest', -13, 0, 13, 0, [[0, SIL_D], [0.6, SIL], [1, '#c3cbd7']]), 1.5);
      // long white tabard down to the shins, gold border, split hem
      ctx.beginPath(); ctx.moveTo(-10, -38.5); ctx.quadraticCurveTo(0, -41.5, 10, -38.5); ctx.lineTo(11, -20); ctx.lineTo(12 + sway, -6.5);
      ctx.quadraticCurveTo(7, -5.4, 3 + sway * 0.6, -6.2); ctx.lineTo(2 + sway * 0.4, -12); ctx.lineTo(1 + sway * 0.4, -6.2);
      ctx.quadraticCurveTo(-5, -5.4, -11.5 + sway, -6.5); ctx.lineTo(-10.5, -20); ctx.closePath();
      fo(ctx, lgc(ctx, 'pal-tabard', 0, -40, 0, -5, [[0, '#fbf8f0'], [1, '#e6dfd0']]), 1.4);
      ctx.fillStyle = 'rgba(120,100,70,.18)'; ctx.beginPath(); ctx.moveTo(-10, -38.5); ctx.lineTo(-5, -39.6); ctx.lineTo(-5.4, -5.6); ctx.quadraticCurveTo(-8, -5.8, -11.5 + sway, -6.5); ctx.lineTo(-10.5, -20); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = GOLD; ctx.lineWidth = 1.5; ctx.beginPath();
      ctx.moveTo(-10.6, -8.4); ctx.quadraticCurveTo(-5, -7.4, 0.9 + sway * 0.4, -8); ctx.moveTo(3.1 + sway * 0.4, -8); ctx.quadraticCurveTo(7, -7.4, 11.6 + sway, -8.4);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,.7)'; ctx.fillRect(5.5, -36, 1.6, 14);
      // a small green-gold leaf sprig on the chest of the tabard
      ctx.save(); ctx.translate(3, -30);
      ctx.beginPath(); ctx.moveTo(0, 4); ctx.quadraticCurveTo(-3.4, 0, 0, -4); ctx.quadraticCurveTo(3.4, 0, 0, 4); ctx.closePath(); fo(ctx, '#d9b25c', 0.8, '#8a6a32');
      ctx.strokeStyle = '#8a6a32'; ctx.lineWidth = 0.6; ctx.beginPath(); ctx.moveTo(0, 5); ctx.lineTo(0, -3); ctx.stroke();
      ctx.restore();
      // belt
      ctx.fillStyle = '#6a4428'; ctx.fillRect(-11.5, -21.5, 23.5, 3.4);
      ctx.fillStyle = GOLD; rr(ctx, 1.5, -22.2, 5, 4.8, 1); ctx.fill();
      // gorget
      ctx.beginPath(); rr(ctx, -7.5, -43, 15, 4.6, 2); fo(ctx, '#c9d1dd', 1.2);
      // head: round great helm with the visor raised, a kind bearded face inside
      const hy = -51;
      face(ctx, hy, 10.5, SKIN, t);
      ctx.beginPath(); ctx.moveTo(-1.8, hy + 3.2); ctx.quadraticCurveTo(-1, hy + 11.5, 4.5, hy + 12.4); ctx.quadraticCurveTo(10.4, hy + 11.2, 10.6, hy + 3.6);
      ctx.quadraticCurveTo(9, hy + 7.4, 6.5, hy + 7.4); ctx.quadraticCurveTo(5, hy + 6.2, 3.5, hy + 7.4); ctx.quadraticCurveTo(0.5, hy + 7, -1.8, hy + 3.2); ctx.closePath();
      fo(ctx, '#9a6440', 1.1);
      ctx.fillStyle = '#9a6440'; ell(ctx, 3.6, hy + 5.6, 2.4, 1.1, 0.2); ctx.fill(); ell(ctx, 6.8, hy + 5.6, 2.4, 1.1, -0.2); ctx.fill();
      ctx.beginPath(); ctx.arc(0, hy, 12.4, Math.PI * 0.6, Math.PI * 1.97); ctx.lineTo(12, hy - 2.6); ctx.lineTo(-2.2, hy - 2.6);
      ctx.quadraticCurveTo(-5.4, hy + 2.5, -4, hy + 11); ctx.closePath();
      fo(ctx, lgc(ctx, 'pal-helm', -12, 0, 12, 0, [[0, '#a3adbe'], [0.6, '#eef1f6'], [1, '#c8d0dc']]), 1.4);
      ctx.fillStyle = 'rgba(255,255,255,.75)'; ctx.beginPath(); ctx.arc(0.5, hy - 1, 9.6, Math.PI * 1.22, Math.PI * 1.5); ctx.lineTo(0.5, hy - 1); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(70,80,110,.5)'; ctx.lineWidth = 0.9; ctx.beginPath(); ctx.moveTo(-8, hy + 2); ctx.lineTo(-4.4, hy + 2); ctx.moveTo(-8.6, hy + 5); ctx.lineTo(-4.6, hy + 5); ctx.stroke();
      // raised visor across the brow
      ctx.beginPath(); ctx.moveTo(-3.5, hy - 2.4); ctx.lineTo(13.2, hy - 2.4); ctx.quadraticCurveTo(13.6, hy - 6.4, 11, hy - 8.4); ctx.lineTo(-2.5, hy - 8); ctx.closePath();
      fo(ctx, '#d3dae4', 1.2);
      ctx.strokeStyle = INK; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(1, hy - 5.2); ctx.lineTo(11.5, hy - 5.2); ctx.stroke();
      ctx.fillStyle = GOLD; circ(ctx, -1.8, hy - 4.8, 1.3); ctx.fill();
      // low gold comb along the crown
      ctx.beginPath(); ctx.moveTo(-10, hy - 7); ctx.quadraticCurveTo(-5, hy - 16.5, 3, hy - 14.6); ctx.quadraticCurveTo(1.5, hy - 12.8, -0.5, hy - 12); ctx.quadraticCurveTo(-5.5, hy - 11, -8, hy - 5.8); ctx.closePath();
      fo(ctx, GOLD, 1.1);
      // war hammer: shouldered at rest, raised overhead in the wind-up, brought straight down on the hit
      const REST = -2.45;
      const rot = at > 0 ? lerp(-0.55, REST, ease(1 - at)) : lerp(REST, -3.35, pre);
      if (at > 0.45) {
        const a0 = -3.35 + Math.PI / 2, a1 = rot + Math.PI / 2, al = (at - 0.45) / 0.55;
        ctx.save(); ctx.translate(5, -34);
        ctx.fillStyle = `rgba(255,246,222,${(al * 0.42).toFixed(3)})`;
        ctx.beginPath(); ctx.arc(0, 0, 38, a0, a1, false); ctx.arc(0, 0, 31, a1, a0, true); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = `rgba(255,255,245,${(al * 0.85).toFixed(3)})`; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(0, 0, 37.5, a0 + 0.5, a1, false); ctx.stroke();
        ctx.restore();
      }
      ctx.save(); ctx.translate(5, -34); ctx.rotate(rot);
      bone(ctx, 0, 0, 0, 8.5, 5.4, SIL, INK, 2.4);
      bone(ctx, 0, 4, 0, 30, 2.8, '#8a5a32', INK, 2.2);
      ctx.strokeStyle = '#5e3a20'; ctx.lineWidth = 0.9; ctx.beginPath();
      for (let i = 0; i < 4; i++) { ctx.moveTo(-1.4, 14 + i * 2.2); ctx.lineTo(1.4, 15.2 + i * 2.2); }
      ctx.stroke();
      circ(ctx, 0, 3.4, 2); fo(ctx, GOLD, 1);
      ctx.beginPath(); rr(ctx, -9, 28, 18, 9.6, 2.4); fo(ctx, lgc(ctx, 'pal-head', 0, 28, 0, 37.6, [[0, '#f4f6fa'], [1, '#9ea9bb']]), 1.4);
      ctx.beginPath(); rr(ctx, -11, 29.2, 3, 7.2, 1.2); fo(ctx, '#b8c1cf', 1.1);
      ctx.beginPath(); rr(ctx, 8, 29.2, 3, 7.2, 1.2); fo(ctx, '#b8c1cf', 1.1);
      ctx.fillStyle = GOLD; ctx.fillRect(-5.6, 28.6, 2, 8.4); ctx.fillRect(3.6, 28.6, 2, 8.4);
      ctx.beginPath(); rr(ctx, -2, 37, 4, 3, 1.2); fo(ctx, GOLD, 0.9);
      ctx.restore();
      circ(ctx, 5 - Math.sin(rot) * 10.5, -34 + Math.cos(rot) * 10.5, 3); fo(ctx, '#d6dde7', 1.1);
      // near pauldron, layered plates with a gold edge
      ctx.beginPath(); ctx.moveTo(-2, -36); ctx.quadraticCurveTo(-1, -44, 6, -44); ctx.quadraticCurveTo(13, -44, 13.5, -35.5); ctx.quadraticCurveTo(6, -37.5, -2, -36); ctx.closePath();
      fo(ctx, lgc(ctx, 'pal-pauld', 0, -44, 0, -35, [[0, '#f6f8fb'], [1, '#aeb8c8']]), 1.4);
      ctx.strokeStyle = GOLD; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(-1, -36.8); ctx.quadraticCurveTo(6, -38.4, 12.6, -36.3); ctx.stroke();
      ctx.strokeStyle = 'rgba(70,80,110,.45)'; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.moveTo(0.5, -40); ctx.quadraticCurveTo(6, -41.4, 12, -39.6); ctx.stroke();
      // impact: round dust puffs and a flat ring on the ground (no rays)
      if (at > 0.3) {
        const p = 1 - at, a = (at - 0.3) / 0.7, gx = 22, gy = -1 - slam * 1.8 + bob - pre * 1.2;
        ctx.globalCompositeOperation = 'lighter';
        sglow(ctx, gx, gy - 2, 12 + p * 14, '255,226,160', 0.55 * a);
        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = `rgba(255,240,205,${(a * 0.85).toFixed(3)})`; ctx.lineWidth = 1.4; ell(ctx, gx, gy + 1, 7 + p * 18, 1.8 + p * 3); ctx.stroke();
        for (let i = 0; i < 4; i++) {
          ctx.fillStyle = `rgba(225,216,200,${(a * 0.55).toFixed(3)})`;
          circ(ctx, gx + (i - 1.5) * (5 + p * 9), gy - 1.5 - p * 5 - (i % 2) * 2, 2.2 + p * 3.2); ctx.fill();
        }
      }
    },

    // ---------------- ボマー（花火師） ----------------
    pyro(ctx, u) {
      const t = u.anim, at = u.atk || 0, pre = antic(u, 0.3);
      const HAPPI = '#e0553c', HAPPI_D = '#b23c2c', NAVY = '#3a2c44';
      const bob = walkBob(u, 11, 2.2);
      legs(ctx, u, { hip: -15, spread: 3.4, pants: '#5c4238', back: '#45302a', boot: '#33303e', bootB: '#26232f', freq: 11 });
      ctx.translate(0, -bob + pre * 0.8);
      // cloth bomb bag at the back hip, round bombs peeking out
      ctx.save(); ctx.translate(-10, -19);
      circ(ctx, -1.5, -6.5, 3.2); fo(ctx, '#3a3446', 1.1); circ(ctx, 2.2, -7.2, 3); fo(ctx, '#3a3446', 1.1);
      ctx.fillStyle = 'rgba(255,255,255,.4)'; circ(ctx, -2.4, -7.6, 0.9); ctx.fill(); circ(ctx, 1.4, -8.2, 0.8); ctx.fill();
      ctx.beginPath(); ctx.moveTo(-5, -5); ctx.quadraticCurveTo(0, -3.4, 5, -5); ctx.quadraticCurveTo(6.5, 3, 0, 5); ctx.quadraticCurveTo(-6.5, 3, -5, -5); ctx.closePath();
      fo(ctx, '#d9b878', 1.2);
      ctx.strokeStyle = HAPPI_D; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(-4.6, -3.6); ctx.quadraticCurveTo(0, -2, 4.6, -3.6); ctx.stroke();
      ctx.restore();
      // back arm (wide happi sleeve)
      const swing = u.walk ? Math.sin(t * 11) * 0.6 : 0.2 - pre * 0.5;
      const bx = -3 - Math.sin(swing) * 10, by = -33 + Math.cos(swing) * 10;
      bone(ctx, -3, -33, -3 - Math.sin(swing) * 6, -33 + Math.cos(swing) * 6, 6, HAPPI_D, INK, 2.4);
      bone(ctx, -3 - Math.sin(swing) * 6, -33 + Math.cos(swing) * 6, bx, by, 3.2, SKIN, INK, 2.2);
      circ(ctx, bx, by, 2.3); fo(ctx, SKIN, 1);
      // happi coat to the hips: navy collar band, white wave line at the hem
      ctx.beginPath(); ctx.moveTo(-7.5, -36.5); ctx.lineTo(7.5, -36.5); ctx.lineTo(9.6, -15); ctx.lineTo(-9.6, -15); ctx.closePath();
      fo(ctx, lgc(ctx, 'pyr-happi', 0, -36, 0, -15, [[0, '#ec6a4c'], [1, HAPPI_D]]), 1.4);
      ctx.fillStyle = 'rgba(90,20,10,.28)'; ctx.beginPath(); ctx.moveTo(-7.5, -36.5); ctx.lineTo(-3, -36.5); ctx.lineTo(-3.6, -15); ctx.lineTo(-9.6, -15); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(-9.6, -15); ctx.lineTo(9.6, -15); ctx.lineTo(9.2, -19); ctx.lineTo(-9.2, -19); ctx.closePath(); fo(ctx, NAVY, 1.1);
      ctx.strokeStyle = '#f4ead6'; ctx.lineWidth = 0.9; ctx.beginPath(); ctx.moveTo(-8.8, -17);
      for (let i = 1; i <= 6; i++) ctx.quadraticCurveTo(-8.8 + i * 2.95 - 1.5, -18.8 + (i % 2) * 3.4, -8.8 + i * 2.95, -17);
      ctx.stroke();
      // white undershirt V and the navy collar band running down the front
      ctx.beginPath(); ctx.moveTo(1, -36.5); ctx.lineTo(6.5, -36.5); ctx.lineTo(4.2, -30); ctx.closePath(); fo(ctx, '#f4ead6', 1);
      ctx.beginPath(); ctx.moveTo(-0.5, -36.8); ctx.lineTo(2.6, -36.8); ctx.lineTo(5.4, -26.5); ctx.lineTo(6.4, -19); ctx.lineTo(3.4, -19); ctx.lineTo(2.6, -26); ctx.closePath(); fo(ctx, NAVY, 1);
      ctx.fillStyle = '#f4ead6'; for (let i = 0; i < 3; i++) ctx.fillRect(3 + i * 0.75, -33 + i * 4.4, 1.6, 1.6);
      // sash
      ctx.beginPath(); rr(ctx, -9.4, -24.6, 18.8, 3.6, 1.2); fo(ctx, '#f0c66a', 1.1);
      // head: black spiky hair under a twisted white headband (red stripes), knot at the back
      const hy = -46, kf = Math.sin(t * (u.walk ? 13 : 4)) * 1.3;
      ctx.beginPath(); ctx.moveTo(-10, hy - 6); ctx.quadraticCurveTo(-15, hy - 6 + kf * 0.5, -18, hy - 2 + kf); ctx.lineTo(-16.4, hy + 0.4 + kf); ctx.quadraticCurveTo(-13.5, hy - 2.6, -10, hy - 3.5); ctx.closePath(); fo(ctx, '#f6efe0', 1);
      ctx.beginPath(); ctx.moveTo(-10, hy - 5); ctx.quadraticCurveTo(-13, hy - 1, -14.6, hy + 4 + kf * 0.6); ctx.lineTo(-12.4, hy + 4.6 + kf * 0.6); ctx.quadraticCurveTo(-11, hy, -9.4, hy - 3); ctx.closePath(); fo(ctx, '#f6efe0', 1);
      face(ctx, hy, 11, SKIN, t);
      ctx.beginPath(); ctx.moveTo(-11.2, hy + 2); ctx.quadraticCurveTo(-13, hy - 8, -7, hy - 11); ctx.lineTo(-6.5, hy - 15.5); ctx.lineTo(-3, hy - 11.6); ctx.lineTo(0, hy - 16.5); ctx.lineTo(2.6, hy - 11.4); ctx.lineTo(6.5, hy - 14.6); ctx.lineTo(7, hy - 9.6);
      ctx.quadraticCurveTo(11, hy - 8, 11.5, hy - 3); ctx.lineTo(8.4, hy - 4.4); ctx.lineTo(6.4, hy - 2); ctx.lineTo(4.6, hy - 5); ctx.quadraticCurveTo(-3, hy - 3.6, -5, hy + 4); ctx.closePath();
      fo(ctx, '#2c2634', 1.2);
      ctx.strokeStyle = 'rgba(180,170,220,.35)'; ctx.lineWidth = 0.9; ctx.beginPath(); ctx.moveTo(-6, hy - 8); ctx.quadraticCurveTo(-1, hy - 10.5, 4, hy - 9); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-11.4, hy - 3.6); ctx.quadraticCurveTo(0, hy - 7.6, 11.6, hy - 4.2); ctx.lineTo(11.2, hy - 7.6); ctx.quadraticCurveTo(0, hy - 11, -11, hy - 7); ctx.closePath();
      fo(ctx, '#f6efe0', 1.1);
      ctx.save(); ctx.clip();
      ctx.strokeStyle = 'rgba(216,70,58,.85)'; ctx.lineWidth = 0.9; ctx.beginPath();
      for (let i = 0; i < 7; i++) { const x = -10 + i * 3.4; ctx.moveTo(x, hy - 3); ctx.lineTo(x + 2.4, hy - 11.5); }
      ctx.stroke(); ctx.restore();
      ctx.beginPath(); ell(ctx, -11, hy - 5.4, 2.6, 2.4); fo(ctx, '#f6efe0', 1);
      // throwing arm: bomb at the hip → wound back behind the head → released forward and up
      const REST = [9.5, -25.5], BACK = [-7, -47], FWD = [15.5, -45];
      let hx, hy2, hold;
      if (at > 0) { const k = ease(1 - at); hx = lerp(FWD[0], REST[0], k); hy2 = lerp(FWD[1], REST[1], k); hold = at < 0.28; }
      else { hx = lerp(REST[0], BACK[0], pre); hy2 = lerp(REST[1], BACK[1], pre); hold = true; }
      if (u.walk) { hx += Math.sin(t * 11 + Math.PI) * 2; hy2 += Math.cos(t * 11) * 1.2; }
      const sx = 3, sy = -33.5, ex = lerp(sx, hx, 0.5), ey = lerp(sy, hy2, 0.5);
      if (at > 0.7) {
        const al = (at - 0.7) / 0.3;
        ctx.strokeStyle = `rgba(255,236,200,${(al * 0.7).toFixed(3)})`; ctx.lineWidth = 2.2; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(-6, -48); ctx.quadraticCurveTo(4, -56, hx, hy2 - 2); ctx.stroke();
        ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(-3, -44); ctx.quadraticCurveTo(5, -50, hx - 1, hy2 + 1.5); ctx.stroke();
        ctx.lineCap = 'butt';
      }
      bone(ctx, sx, sy, ex, ey, 6, HAPPI, INK, 2.4);
      bone(ctx, ex, ey, hx, hy2, 3.4, SKIN, INK, 2.2);
      if (hold) {
        const bx2 = hx + 1.6, by2 = hy2 - 3.4;
        ctx.strokeStyle = INK; ctx.lineWidth = 2.4; ctx.beginPath(); ctx.moveTo(bx2 + 1, by2 - 3.8); ctx.quadraticCurveTo(bx2 + 2.5, by2 - 7, bx2 + 4.6, by2 - 7.4); ctx.stroke();
        ctx.strokeStyle = '#d9b878'; ctx.lineWidth = 1.1; ctx.stroke();
        circ(ctx, bx2, by2, 4.4); fo(ctx, lgc(ctx, 'pyr-bomb', 0, -6, 0, 6, [[0, '#4a4458'], [1, '#2a2634']]), 1.3);
        ctx.fillStyle = 'rgba(255,255,255,.55)'; ell(ctx, bx2 - 1.5, by2 - 1.8, 1.4, 1, -0.6); ctx.fill();
        ctx.beginPath(); rr(ctx, bx2 - 1.6, by2 - 5.4, 3.2, 2, 0.6); fo(ctx, '#c9a25a', 0.8);
        ctx.globalCompositeOperation = 'lighter';
        sglow(ctx, bx2 + 4.8, by2 - 7.6, 4.5 + Math.sin(t * 24) * 0.8, '255,190,90', 0.9);
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = '#fff1c0'; circ(ctx, bx2 + 4.8, by2 - 7.6, 1); ctx.fill();
      }
      circ(ctx, hx, hy2, 2.4); fo(ctx, SKIN, 1);
    },

    // ---------------- エンジニア ----------------
    engineer(ctx, u) {
      const t = u.anim, at = u.atk || 0;
      const SUIT = '#d98a3c', SUIT_D = '#a8652a', TOOL = '#c84a3a';
      const bob = walkBob(u, 10, 2);
      legs(ctx, u, { hip: -16, spread: 3.6, pants: SUIT, back: SUIT_D, boot: '#6a4630', bootB: '#4e3222', freq: 10 });
      ctx.translate(0, -bob);
      // toolbox strapped to the back, a screwdriver sticking out
      const tb = u.walk ? Math.sin(t * 20) * 0.8 : 0;
      ctx.save(); ctx.translate(-12, -30 + tb);
      ctx.strokeStyle = INK; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(-2, -9.5); ctx.lineTo(-2, -13); ctx.lineTo(3, -13); ctx.lineTo(3, -9.5); ctx.stroke();
      ctx.strokeStyle = '#8c8c98'; ctx.lineWidth = 1.4; ctx.stroke();
      ctx.save(); ctx.translate(4.6, -9); ctx.rotate(0.35);
      ctx.beginPath(); rr(ctx, -1, -9, 2, 6, 0.6); fo(ctx, '#c7ccd6', 0.8);
      ctx.beginPath(); rr(ctx, -1.8, -4, 3.6, 5, 1.2); fo(ctx, '#f0c040', 0.9);
      ctx.restore();
      ctx.beginPath(); rr(ctx, -6.5, -10, 13, 19, 2.2); fo(ctx, lgc(ctx, 'eng-box', -6, 0, 6, 0, [[0, '#a83a2e'], [0.6, TOOL], [1, '#b04034']]), 1.3);
      ctx.fillStyle = 'rgba(0,0,0,.18)'; ctx.fillRect(-6.5, -5.5, 13, 1.6);
      ctx.fillStyle = '#e8c47a'; rr(ctx, -1.8, -6.6, 3.6, 3.4, 0.8); ctx.fill();
      ctx.fillStyle = 'rgba(255,220,200,.35)'; ctx.fillRect(3.2, -8, 1.4, 15);
      ctx.restore();
      // back arm
      const swing = u.walk ? Math.sin(t * 10) * 0.55 : 0.18;
      bone(ctx, -3, -33, -3 - Math.sin(swing) * 9.5, -33 + Math.cos(swing) * 9.5, 4.2, SUIT_D, INK, 2.4);
      circ(ctx, -3 - Math.sin(swing) * 10.8, -33 + Math.cos(swing) * 10.8, 2.5); fo(ctx, '#7a5a3e', 1);
      // coverall: chest pocket, zip, knee-patch feel, tool belt
      ctx.beginPath(); ctx.moveTo(-7.5, -36.5); ctx.lineTo(7.5, -36.5); ctx.lineTo(9, -15); ctx.quadraticCurveTo(0, -13, -9, -15); ctx.closePath();
      fo(ctx, lgc(ctx, 'eng-suit', 0, -36, 0, -14, [[0, '#e69a48'], [1, SUIT_D]]), 1.4);
      ctx.fillStyle = 'rgba(100,40,10,.26)'; ctx.beginPath(); ctx.moveTo(-7.5, -36.5); ctx.lineTo(-3, -36.5); ctx.lineTo(-3.6, -13.4); ctx.quadraticCurveTo(-6.5, -13.8, -9, -15); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(90,40,10,.6)'; ctx.lineWidth = 0.9; ctx.beginPath(); ctx.moveTo(2.6, -36); ctx.lineTo(3.2, -22); ctx.stroke();
      ctx.beginPath(); rr(ctx, 3.6, -33, 4.6, 4.4, 0.8); fo(ctx, '#c97a34', 0.9);
      ctx.fillStyle = '#e8edf2'; ctx.fillRect(4.6, -35, 0.9, 3); ctx.fillStyle = '#e04a3a'; ctx.fillRect(6.2, -34.6, 0.9, 2.4);
      // shoulder strap of the toolbox
      ctx.strokeStyle = '#5a3a24'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-5, -36); ctx.quadraticCurveTo(-1, -30, -4, -22); ctx.stroke();
      ctx.beginPath(); rr(ctx, -9.4, -22, 18.8, 3.6, 1); fo(ctx, '#6a4630', 1);
      ctx.fillStyle = '#c7ccd6'; rr(ctx, 1.5, -22.4, 4.2, 4.4, 0.8); ctx.fill();
      ctx.beginPath(); rr(ctx, -7.8, -21, 4.4, 6, 1); fo(ctx, '#7a5236', 0.9);
      // head: ginger hair, brass goggles pushed up on the forehead
      const hy = -46;
      face(ctx, hy, 11, SKIN, t);
      ctx.fillStyle = 'rgba(90,60,40,.45)'; circ(ctx, 9, hy + 6.5, 0.9); ctx.fill();
      ctx.beginPath(); ctx.moveTo(-11.2, hy + 3); ctx.quadraticCurveTo(-13.5, hy - 8, -5, hy - 11.8); ctx.quadraticCurveTo(3, hy - 14, 8.5, hy - 9.6);
      ctx.quadraticCurveTo(12, hy - 6.5, 11.6, hy - 2); ctx.lineTo(9, hy - 4.2); ctx.lineTo(8, hy - 1.4); ctx.lineTo(5.6, hy - 4.6); ctx.quadraticCurveTo(-2, hy - 3.8, -4.6, hy + 3.5); ctx.lineTo(-7, hy + 7); ctx.quadraticCurveTo(-11, hy + 6, -11.2, hy + 3); ctx.closePath();
      fo(ctx, '#d0703a', 1.2);
      ctx.beginPath(); ctx.moveTo(-3, hy - 12); ctx.quadraticCurveTo(-1, hy - 17, 3, hy - 16); ctx.quadraticCurveTo(0.5, hy - 14.5, 1, hy - 12); ctx.closePath(); fo(ctx, '#d0703a', 1);
      ctx.strokeStyle = 'rgba(255,210,170,.5)'; ctx.lineWidth = 0.9; ctx.beginPath(); ctx.moveTo(-7, hy - 8.4); ctx.quadraticCurveTo(-2, hy - 11, 3, hy - 10); ctx.stroke();
      ctx.strokeStyle = INK; ctx.lineWidth = 3.4; ctx.beginPath(); ctx.moveTo(-11, hy - 5); ctx.quadraticCurveTo(0, hy - 10.5, 11.4, hy - 6.4); ctx.stroke();
      ctx.strokeStyle = '#5a4a44'; ctx.lineWidth = 2; ctx.stroke();
      for (const gx of [1.5, 7.6]) {
        circ(ctx, gx, hy - 9.4 + (gx > 4 ? 0.5 : 0), 3.2); fo(ctx, '#d7a64e', 1.2);
        circ(ctx, gx, hy - 9.4 + (gx > 4 ? 0.5 : 0), 2); ctx.fillStyle = '#8fd8e0'; ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.fillRect(gx - 1.2, hy - 10.6 + (gx > 4 ? 0.5 : 0), 1, 1);
      }
      // spanner arm: held forward, a short repair tap on u.atk
      const REST = -1.55;
      const rot = at > 0 ? lerp(-0.85, REST, ease(1 - at)) : REST + (u.walk ? Math.sin(t * 10 + Math.PI) * 0.25 : Math.sin(t * 2) * 0.04);
      ctx.save(); ctx.translate(3.5, -33); ctx.rotate(rot);
      bone(ctx, 0, 0, 0, 8.5, 4.2, SUIT, INK, 2.4);
      ctx.beginPath(); rr(ctx, -1.5, 10, 3, 13, 1.2); fo(ctx, lgc(ctx, 'eng-span', -1.5, 0, 1.5, 0, [[0, '#9aa2b0'], [0.5, '#eef1f5'], [1, '#aab2c0']]), 1.1);
      ctx.beginPath(); ctx.arc(0, 25, 4, Math.PI / 2 + 0.62, Math.PI / 2 - 0.62 + TAU);
      ctx.lineTo(1.3, 27.4); ctx.lineTo(1.3, 24.2); ctx.lineTo(-1.3, 24.2); ctx.lineTo(-1.3, 27.4); ctx.closePath();
      fo(ctx, '#d8dde5', 1.1);
      circ(ctx, 0, 10.6, 2.6); fo(ctx, '#7a5a3e', 1);
      ctx.restore();
      if (at > 0.55) {
        const p = 1 - at, al = (at - 0.55) / 0.45;
        const tx = 3.5 - Math.sin(-0.85) * 27, ty = -33 + Math.cos(-0.85) * 27;
        ctx.globalCompositeOperation = 'lighter';
        sglow(ctx, tx, ty, 6 + p * 6, '255,214,130', 0.85 * al);
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = `rgba(255,236,170,${al.toFixed(3)})`;
        for (let i = 0; i < 4; i++) { const a = -0.6 + i * 0.5; circ(ctx, tx + Math.cos(a) * (3 + p * 14), ty - Math.sin(a) * (2 + p * 9) + p * p * 10, 0.9); ctx.fill(); }
      }
    },

    // ---------------- バーサーカー ----------------
    berserker(ctx, u) {
      const t = u.anim, at = u.atk || 0, pre = antic(u, 0.3), fz = clamp01(u.frenzy || 0);
      const SKN = '#f2cba8', FUR = '#8a7462', FUR_D = '#64523f', LEATH = '#7a3e2a';
      const hit = at > 0 ? Math.pow(at, 0.6) : 0;
      // step forward into the chop (and rock back slightly in the wind-up) — a translation only, never a tilt
      ctx.translate(hit * 4.5 - pre * 2, 0);
      if (fz > 0.01) { ctx.globalCompositeOperation = 'lighter'; sglow(ctx, 0, -36, 34 + fz * 10, '255,86,54', 0.12 + fz * 0.26); ctx.globalCompositeOperation = 'source-over'; }
      const bob = walkBob(u, 10, 2.4);
      const lo = { hip: -16, spread: 5, pants: '#5a3a2c', back: '#432a20', boot: '#6e4a32', bootB: '#523624', freq: 10, w: 5.8 };
      if (!u.walk && hit > 0.02) legs(ctx, { walk: true, anim: -Math.asin(0.85 * hit) }, Object.assign({}, lo, { freq: 1 }));
      else legs(ctx, u, lo);
      ctx.translate(0, -bob + hit * 1.6);
      // back arm
      const swing = u.walk ? Math.sin(t * 10) * 0.55 : 0.25 + hit * 0.5;
      bone(ctx, -6, -34, -6 - Math.sin(swing) * 10, -34 + Math.cos(swing) * 10, 5.6, SKN, INK, 2.4);
      ctx.beginPath(); rr(ctx, -6 - Math.sin(swing) * 7 - 3, -34 + Math.cos(swing) * 7 - 2, 6, 4, 1.2); fo(ctx, LEATH, 1);
      circ(ctx, -6 - Math.sin(swing) * 11.5, -34 + Math.cos(swing) * 11.5, 3); fo(ctx, SKN, 1);
      // barrel chest: leather jerkin with a cross strap, round brass buckle
      ctx.beginPath(); ctx.moveTo(-12.5, -40); ctx.quadraticCurveTo(0, -43, 12, -40); ctx.lineTo(11, -17); ctx.quadraticCurveTo(0, -14, -11.5, -17); ctx.closePath();
      fo(ctx, lgc(ctx, 'ber-body', 0, -42, 0, -15, [[0, '#9a4e34'], [1, '#6a3222']]), 1.5);
      ctx.fillStyle = 'rgba(40,10,0,.3)'; ctx.beginPath(); ctx.moveTo(-12.5, -40); ctx.lineTo(-6, -41.5); ctx.lineTo(-6, -15); ctx.quadraticCurveTo(-9, -15.6, -11.5, -17); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(-1, -38); ctx.quadraticCurveTo(4, -33, 6.5, -28); ctx.lineTo(7.4, -20); ctx.lineTo(4.4, -20); ctx.quadraticCurveTo(2, -29, -1, -34); ctx.closePath(); fo(ctx, SKN, 1);
      ctx.strokeStyle = 'rgba(170,90,60,.5)'; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.moveTo(1.5, -33); ctx.quadraticCurveTo(4, -30, 5, -26); ctx.stroke();
      ctx.strokeStyle = '#4a2a1c'; ctx.lineWidth = 2.6; ctx.beginPath(); ctx.moveTo(8, -38); ctx.lineTo(-9, -20); ctx.stroke();
      ctx.beginPath(); rr(ctx, -11.6, -21.5, 23, 4.6, 1.4); fo(ctx, '#4a2a1c', 1.1);
      circ(ctx, 3.5, -19.2, 3); fo(ctx, '#e3b762', 1); circ(ctx, 3.5, -19.2, 1.3); ctx.fillStyle = '#4a2a1c'; ctx.fill();
      // leather kilt flaps
      ctx.beginPath(); ctx.moveTo(-11.4, -17); ctx.lineTo(11, -17); ctx.lineTo(11.6, -10.5); ctx.lineTo(6, -9.4); ctx.lineTo(4.6, -12.5); ctx.lineTo(0, -9.4); ctx.lineTo(-1.4, -12.5); ctx.lineTo(-6.4, -9.4); ctx.lineTo(-12, -10.5); ctx.closePath();
      fo(ctx, '#5e3424', 1.2);
      // head: wild red hair with a braid, short beard, heavy brows
      const hy = -50, hf = Math.sin(t * (u.walk ? 10 : 3)) * 1;
      ctx.beginPath(); ctx.moveTo(-9, hy + 2); ctx.quadraticCurveTo(-14, hy + 8, -13 + hf, hy + 15); ctx.lineTo(-10.4 + hf, hy + 15.4); ctx.quadraticCurveTo(-10.4, hy + 8, -6, hy + 4); ctx.closePath(); fo(ctx, '#c4502e', 1.1);
      ctx.fillStyle = '#e3b762'; ctx.fillRect(-13.6 + hf, hy + 11.5, 3.6, 1.6);
      face(ctx, hy, 11, SKN, t);
      ctx.beginPath(); ctx.moveTo(-1.5, hy + 3.4); ctx.quadraticCurveTo(-0.5, hy + 12.6, 5, hy + 13.4); ctx.quadraticCurveTo(10.8, hy + 12, 11, hy + 3.4);
      ctx.quadraticCurveTo(9.4, hy + 7.6, 6.6, hy + 7.4); ctx.quadraticCurveTo(5, hy + 6.4, 3.4, hy + 7.4); ctx.quadraticCurveTo(0.6, hy + 7, -1.5, hy + 3.4); ctx.closePath();
      fo(ctx, '#c4502e', 1.1);
      ctx.beginPath(); ctx.moveTo(-11.6, hy + 4); ctx.quadraticCurveTo(-15.5, hy - 4, -12, hy - 11); ctx.lineTo(-14.5, hy - 15); ctx.lineTo(-8.5, hy - 13.4); ctx.lineTo(-6, hy - 18.5); ctx.lineTo(-2, hy - 13.8); ctx.lineTo(2.5, hy - 17.6); ctx.lineTo(4.5, hy - 12);
      ctx.lineTo(9.5, hy - 13); ctx.lineTo(8.6, hy - 8.6); ctx.quadraticCurveTo(12, hy - 6, 11.8, hy - 2); ctx.lineTo(8.8, hy - 4); ctx.lineTo(6.4, hy - 1.8); ctx.lineTo(4.6, hy - 5); ctx.quadraticCurveTo(-2.6, hy - 4, -4.6, hy + 4); ctx.lineTo(-8, hy + 7.4); ctx.closePath();
      fo(ctx, '#d65a32', 1.3);
      ctx.strokeStyle = 'rgba(255,200,150,.45)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(-8, hy - 9.6); ctx.quadraticCurveTo(-2, hy - 12, 4, hy - 10.4); ctx.stroke();
      ctx.strokeStyle = '#8e3220'; ctx.lineWidth = 1.6; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(5.6, hy - 2.6); ctx.lineTo(9.4, hy - 1.6); ctx.moveTo(-0.4, hy - 1.8); ctx.lineTo(3, hy - 2.4); ctx.stroke(); ctx.lineCap = 'butt';
      // frenzy: eyes and skin take on a faint red glow
      if (fz > 0.01) {
        ctx.globalCompositeOperation = 'lighter';
        sglow(ctx, 7.3, hy + 0.9, 4 + fz * 4, '255,70,50', 0.35 + fz * 0.55);
        sglow(ctx, 1.6, hy + 0.9, 3 + fz * 3, '255,70,50', 0.25 + fz * 0.45);
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = `rgba(255,90,70,${(fz * 0.9).toFixed(3)})`; ell(ctx, 7.3, hy + 0.9, 1.1, 1.7); ctx.fill(); ell(ctx, 1.6, hy + 0.9, 0.9, 1.5); ctx.fill();
        ctx.fillStyle = `rgba(255,70,50,${(fz * 0.16).toFixed(3)})`; circ(ctx, 0, hy, 11); ctx.fill();
        for (let i = 0; i < 3; i++) {
          const q = (t * 0.7 + i / 3) % 1;
          ctx.fillStyle = `rgba(255,140,110,${(fz * 0.32 * (1 - q)).toFixed(3)})`;
          circ(ctx, -8 + i * 8 + Math.sin(t * 2 + i) * 2, -40 - q * 22, 1.6 + q * 2.4); ctx.fill();
        }
      }
      // big axe: shouldered → raised overhead → chopped straight down in front
      const REST = -2.2;
      const rot = at > 0 ? lerp(-0.45, REST, ease(1 - at)) : lerp(REST, -3.4, pre) + (u.walk ? Math.sin(t * 10 + Math.PI) * 0.08 : 0);
      if (at > 0.45) {
        const a0 = -3.4 + Math.PI / 2, a1 = rot + Math.PI / 2, al = (at - 0.45) / 0.55;
        ctx.save(); ctx.translate(6, -35);
        ctx.fillStyle = `rgba(255,232,214,${(al * 0.42).toFixed(3)})`;
        ctx.beginPath(); ctx.arc(0, 0, 40, a0, a1, false); ctx.arc(0, 0, 32, a1, a0, true); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = `rgba(255,248,240,${(al * 0.85).toFixed(3)})`; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(0, 0, 39.5, a0 + 0.5, a1, false); ctx.stroke();
        ctx.restore();
      }
      ctx.save(); ctx.translate(6, -35); ctx.rotate(rot);
      bone(ctx, 0, 0, 0, 9, 5.8, SKN, INK, 2.4);
      ctx.beginPath(); rr(ctx, -3.4, 5, 6.8, 4.6, 1.2); fo(ctx, LEATH, 1);
      bone(ctx, 0, 4, 0, 36, 2.9, '#8a5a32', INK, 2.2);
      ctx.strokeStyle = '#4a2a1c'; ctx.lineWidth = 1; ctx.beginPath();
      for (let i = 0; i < 3; i++) { ctx.moveTo(-1.5, 14 + i * 2.4); ctx.lineTo(1.5, 15.4 + i * 2.4); }
      ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-1.2, 26); ctx.quadraticCurveTo(-6.5, 25, -11, 20.5); ctx.quadraticCurveTo(-15.6, 29, -11, 38); ctx.quadraticCurveTo(-6.5, 33.5, -1.2, 33.4); ctx.closePath();
      fo(ctx, lgc(ctx, 'ber-axe', -14, 0, 0, 0, [[0, '#f4f6fa'], [0.3, '#c9d0da'], [1, '#8d96a6']]), 1.4);
      ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(-11.4, 22.4); ctx.quadraticCurveTo(-14.4, 29, -11.4, 36); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(1.2, 27); ctx.lineTo(5.5, 28.4); ctx.lineTo(5.5, 31.4); ctx.lineTo(1.2, 32.6); ctx.closePath(); fo(ctx, '#9aa3b2', 1.1);
      ctx.beginPath(); rr(ctx, -2.2, 25, 4.4, 9.4, 1); fo(ctx, '#6e4a32', 1);
      ctx.fillStyle = '#e3b762'; circ(ctx, 0, 29.7, 1.1); ctx.fill();
      ctx.restore();
      circ(ctx, 6 - Math.sin(rot) * 11, -35 + Math.cos(rot) * 11, 3.1); fo(ctx, SKN, 1);
      // fur pelt over the shoulders (short, ragged, no hanging cape)
      ctx.beginPath(); ctx.moveTo(-13.5, -36); ctx.quadraticCurveTo(-14, -44, -4, -45); ctx.quadraticCurveTo(8, -46, 13, -39.5);
      ctx.lineTo(11, -36.5); ctx.lineTo(9.6, -38.6); ctx.lineTo(7.4, -35.4); ctx.lineTo(5.2, -38.2); ctx.lineTo(2.6, -35); ctx.lineTo(0, -38); ctx.lineTo(-2.8, -34.8); ctx.lineTo(-5.4, -37.8); ctx.lineTo(-8.2, -34.4); ctx.lineTo(-10.6, -37.4); ctx.closePath();
      fo(ctx, lgc(ctx, 'ber-fur', 0, -46, 0, -34, [[0, '#a89280'], [1, FUR_D]]), 1.4);
      ctx.strokeStyle = 'rgba(255,240,220,.4)'; ctx.lineWidth = 0.8; ctx.beginPath();
      for (let i = 0; i < 5; i++) { const x = -9 + i * 4.6; ctx.moveTo(x, -42.5 + Math.abs(x) * 0.05); ctx.lineTo(x + 1.4, -39.5); }
      ctx.stroke();
      ctx.fillStyle = FUR; circ(ctx, 12.4, -38.8, 2.6); ctx.fill();
      if (at > 0.4) {
        const p = 1 - at, a = (at - 0.4) / 0.6, gx = 25, gy = -1 - hit * 1.6 + bob;
        ctx.strokeStyle = `rgba(255,232,205,${(a * 0.8).toFixed(3)})`; ctx.lineWidth = 1.3; ell(ctx, gx, gy + 1, 6 + p * 15, 1.6 + p * 2.6); ctx.stroke();
        for (let i = 0; i < 3; i++) { ctx.fillStyle = `rgba(220,206,190,${(a * 0.5).toFixed(3)})`; circ(ctx, gx + (i - 1) * (5 + p * 8), gy - 1.5 - p * 4 - (i % 2) * 2, 2 + p * 3); ctx.fill(); }
      }
    },

    // ---------------- ガンナー ----------------
    gunner(ctx, u) {
      const t = u.anim, at = u.atk || 0, ea = ease(clamp01(u.aim || 0));
      const raise = Math.max(ea, at > 0 ? 1 : 0);
      const k1 = at > 0.55 ? (at - 0.55) / 0.45 : 0;                       // front pistol shot
      const k2 = at > 0.12 && at < 0.5 ? Math.sin((0.5 - at) / 0.38 * Math.PI) : 0;  // back pistol follow-up
      const VEST = '#9a3c34', SHIRT = '#f3e2c4', HAT = '#c8925a', HAT_D = '#9a6a3a';
      const bob = walkBob(u, 11, 2);
      legs(ctx, u, { hip: -16, spread: 3.4, pants: '#6a4a36', back: '#4e3628', boot: '#7a4a2c', bootB: '#5e3820', freq: 11 });
      ctx.translate(0, -bob);
      const pistol = (x, y, rot, k, dark) => {
        ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
        ctx.beginPath(); ctx.moveTo(-1, -0.5); ctx.lineTo(2.2, -0.5); ctx.lineTo(0.6, 5.6); ctx.quadraticCurveTo(-1.6, 6.4, -3.2, 5.2); ctx.closePath();
        fo(ctx, dark ? '#6e4426' : '#8a5530', 1.1);
        ctx.beginPath(); rr(ctx, -0.5, -3.4, 5.4, 3.6, 1); fo(ctx, dark ? '#6a6672' : '#8a8694', 1.1);
        ctx.beginPath(); rr(ctx, 4.4, -3, 8.6, 2.4, 0.8); fo(ctx, dark ? '#55525e' : '#6e6a78', 1);
        ctx.fillStyle = dark ? 'rgba(255,255,255,.2)' : 'rgba(255,255,255,.45)'; ctx.fillRect(5, -2.7, 7.4, 0.6);
        ctx.strokeStyle = INK; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.moveTo(1.4, -3.2); ctx.lineTo(1.4, 0); ctx.moveTo(3, -3.2); ctx.lineTo(3, 0); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(-0.4, -3.2); ctx.lineTo(-2.2, -5); ctx.lineTo(-1, -2.6); ctx.closePath(); fo(ctx, '#55525e', 0.7);
        ctx.strokeStyle = INK; ctx.lineWidth = 0.9; ctx.beginPath(); ctx.arc(1.8, 0.6, 1.5, 0, Math.PI); ctx.stroke();
        if (k > 0.05) {
          ctx.globalCompositeOperation = 'lighter';
          sglow(ctx, 15, -1.8, 4 + k * 8, '255,190,110', k);
          ctx.globalCompositeOperation = 'source-over';
          ctx.fillStyle = `rgba(255,244,210,${k.toFixed(3)})`; ell(ctx, 15.5, -1.8, 1.8 + k * 3.4, 0.8 + k * 1.2); ctx.fill();
        }
        ctx.restore();
      };
      // back arm + pistol (behind the body)
      const brx = lerp(-4, 12 - k2 * 2, raise) + (u.walk ? Math.sin(t * 11) * -2 : 0), bry = lerp(-23, -35.5 + k2 * 0.4, raise);
      bone(ctx, -1.5, -34, brx, bry, 3.6, '#e6d2b0', INK, 2.3);
      pistol(brx, bry, lerp(1.15, 0, raise) - k2 * 0.45, k2, true);
      circ(ctx, brx, bry, 2.3); fo(ctx, SKIN, 1);
      // ponytail
      const hy = -46, pf = Math.sin(t * (u.walk ? 11 : 3)) * 1.4;
      ctx.beginPath(); ctx.moveTo(-9, hy - 3); ctx.quadraticCurveTo(-16, hy - 1 + pf, -16.5, hy + 8 + pf); ctx.quadraticCurveTo(-12.5, hy + 4, -9, hy + 2); ctx.closePath(); fo(ctx, '#e9c676', 1.1);
      // shirt + open burgundy vest with a round brass badge
      ctx.beginPath(); ctx.moveTo(-7, -36.5); ctx.lineTo(7, -36.5); ctx.lineTo(8.6, -17); ctx.quadraticCurveTo(0, -15, -8.6, -17); ctx.closePath(); fo(ctx, SHIRT, 1.4);
      ctx.beginPath(); ctx.moveTo(-7.4, -36.5); ctx.lineTo(1.5, -36.5); ctx.lineTo(3, -25); ctx.lineTo(4.5, -17.4); ctx.quadraticCurveTo(-2, -15.6, -8.8, -17); ctx.closePath();
      fo(ctx, lgc(ctx, 'gun-vest', 0, -36, 0, -16, [[0, '#ae4a3e'], [1, '#7e2e28']]), 1.3);
      ctx.beginPath(); ctx.moveTo(5.6, -36.5); ctx.lineTo(7.2, -36.5); ctx.lineTo(8.7, -17.2); ctx.lineTo(7, -17); ctx.closePath(); fo(ctx, VEST, 1.1);
      ctx.fillStyle = 'rgba(40,6,4,.3)'; ctx.beginPath(); ctx.moveTo(-7.4, -36.5); ctx.lineTo(-3, -36.5); ctx.lineTo(-3.4, -15.6); ctx.quadraticCurveTo(-6.4, -16, -8.8, -17); ctx.closePath(); ctx.fill();
      circ(ctx, -0.6, -30.5, 2.6); fo(ctx, '#e8c060', 1); circ(ctx, -0.6, -30.5, 1.4); ctx.strokeStyle = '#9a6a2a'; ctx.lineWidth = 0.7; ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,.7)'; ctx.fillRect(-1.6, -31.8, 0.8, 0.8);
      ctx.beginPath(); rr(ctx, -9, -21.5, 18.4, 3.2, 1); fo(ctx, '#5a3a24', 1);
      ctx.fillStyle = '#e3b762'; rr(ctx, 2, -21.9, 4, 4, 1); ctx.fill();
      ctx.beginPath(); ctx.moveTo(-8.6, -19); ctx.lineTo(-4.4, -19); ctx.lineTo(-5, -11.5); ctx.quadraticCurveTo(-7.2, -10.8, -8.6, -12.6); ctx.closePath(); fo(ctx, '#7a5236', 1);
      // neckerchief
      ctx.beginPath(); ctx.moveTo(-6, -37.5); ctx.lineTo(7, -37.5); ctx.lineTo(4.2, -32); ctx.closePath(); fo(ctx, '#f08a3a', 1.1);
      // head + wide-brimmed hat
      face(ctx, hy, 10.8, SKIN, t);
      ctx.fillStyle = '#e9c676'; ctx.beginPath(); ctx.moveTo(1, hy - 7.5); ctx.quadraticCurveTo(8, hy - 8, 11, hy - 2.5); ctx.lineTo(8, hy - 4); ctx.lineTo(6.4, hy - 1.4); ctx.lineTo(4.4, hy - 4.6); ctx.lineTo(1.5, hy - 3); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(-10.6, hy + 2); ctx.quadraticCurveTo(-11.5, hy - 6, -6, hy - 8); ctx.lineTo(-4, hy - 3); ctx.quadraticCurveTo(-5.6, hy, -5, hy + 4); ctx.closePath(); fo(ctx, '#e9c676', 1);
      ctx.beginPath(); ctx.moveTo(-8, hy - 8); ctx.quadraticCurveTo(-9, hy - 17, -4, hy - 18); ctx.quadraticCurveTo(-0.5, hy - 15.6, 3, hy - 18); ctx.quadraticCurveTo(8.6, hy - 17.6, 8.6, hy - 8); ctx.closePath();
      fo(ctx, lgc(ctx, 'gun-hat', 0, hy - 18, 0, hy - 8, [[0, '#d8a46a'], [1, HAT_D]]), 1.3);
      ctx.beginPath(); ctx.moveTo(-8.2, hy - 8.4); ctx.lineTo(8.8, hy - 8.4); ctx.lineTo(8.6, hy - 11); ctx.lineTo(-8.2, hy - 11); ctx.closePath(); fo(ctx, '#5a3424', 0.9);
      ctx.beginPath(); ctx.moveTo(-17, hy - 11); ctx.quadraticCurveTo(-14.5, hy - 6, 0, hy - 6.6); ctx.quadraticCurveTo(15, hy - 7, 19, hy - 11.4); ctx.quadraticCurveTo(14, hy - 9, 0, hy - 9.4); ctx.quadraticCurveTo(-12, hy - 9, -17, hy - 11); ctx.closePath();
      fo(ctx, HAT, 1.3);
      ctx.strokeStyle = 'rgba(255,225,180,.5)'; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.moveTo(-5, hy - 16); ctx.quadraticCurveTo(-6, hy - 12, -5, hy - 10); ctx.stroke();
      // front arm + pistol
      const frx = lerp(9, 15.5, raise) - k1 * 3 + (u.walk ? Math.sin(t * 11 + Math.PI) * 2 : 0), fry = lerp(-22.5, -34, raise) - k1 * 0.8;
      bone(ctx, 3, -34, frx, fry, 3.8, SHIRT, INK, 2.3);
      pistol(frx, fry, lerp(1.15, 0, raise) - k1 * 0.55, k1, false);
      circ(ctx, frx, fry, 2.4); fo(ctx, SKIN, 1);
      if (at > 0.05 && at < 0.85) {
        const p = 1 - at;
        for (let i = 0; i < 2; i++) { ctx.fillStyle = `rgba(214,206,220,${(at * 0.4 * (1 - i * 0.3)).toFixed(3)})`; circ(ctx, frx + 16 + p * 4 + i * 3, fry - 3 - p * 6 - i * 2, 1.2 + p * 2.2); ctx.fill(); }
      }
    },

    // ---------------- クロスボウ兵 ----------------
    // 木のおもちゃの兵隊：丸い頬、木目、ダボの関節、四角い帽子
    crossbow(ctx, u) {
      const t = u.anim, at = u.atk || 0, ea = ease(clamp01(u.aim || 0));
      const kick = at * at;
      ctx.translate(-(at > 0 ? Math.sin((1 - at) * Math.PI) * 5 : 0) - kick * 2.5, 0);
      const WOOD = '#e6c08e', WOOD_D = '#c09060', COAT = '#c8463c', COAT_D = '#9a3028', GOLD = '#e8c060';
      const bob = u.walk ? Math.abs(Math.cos(t * 9)) * 1.6 : 0;
      legs(ctx, u, { hip: -16, spread: 3.4, pants: '#f1ebdf', back: '#d6cdbd', boot: '#33303c', bootB: '#26232e', freq: 9, w: 5 });
      ctx.translate(0, -bob);
      // hip dowels
      circ(ctx, -3.4, -16, 2.2); fo(ctx, WOOD_D, 1); circ(ctx, 3.4, -16, 2.2); fo(ctx, WOOD, 1);
      const rot = lerp(0.62, 0, ea) - kick * 0.22 + (u.walk ? Math.sin(t * 9) * 0.04 : 0);
      const gx = lerp(4, 2, ea), gy = lerp(-24, -36, ea) + kick * 0.5;
      const cr = Math.cos(rot), sr = Math.sin(rot);
      const fx = gx + 12 * cr - 2.6 * sr, fy = gy + 12 * sr + 2.6 * cr;
      // back arm (stiff wooden limb with a round elbow)
      const bex = lerp(-4, 3, ea), bey = lerp(-26, -29, ea);
      bone(ctx, -3, -34, bex, bey, 4, COAT_D, INK, 2.3);
      bone(ctx, bex, bey, fx, fy, 3.8, COAT_D, INK, 2.3);
      circ(ctx, bex, bey, 1.9); fo(ctx, WOOD_D, 0.9);
      // body: a rounded red block coat, gold buttons, white cross strap, black belt
      ctx.beginPath(); rr(ctx, -8.5, -38, 17, 22, [5, 5, 2.5, 2.5]); fo(ctx, lgc(ctx, 'xb-coat', -8, 0, 8, 0, [[0, COAT_D], [0.55, COAT], [1, '#b43c32']]), 1.5);
      ctx.strokeStyle = '#f4efe4'; ctx.lineWidth = 2.4; ctx.beginPath(); ctx.moveTo(-7, -37); ctx.lineTo(6.5, -20); ctx.stroke();
      ctx.strokeStyle = INK; ctx.lineWidth = 0.6; ctx.beginPath(); ctx.moveTo(-7.6, -36); ctx.lineTo(5.6, -19.4); ctx.moveTo(-6.2, -37.6); ctx.lineTo(7.2, -20.8); ctx.stroke();
      ctx.fillStyle = GOLD; for (let i = 0; i < 4; i++) { circ(ctx, 5.4, -34.5 + i * 4, 1.1); ctx.fill(); }
      ctx.beginPath(); rr(ctx, -8.8, -21, 17.6, 3.4, 0.8); fo(ctx, '#2e2a36', 1);
      ctx.fillStyle = GOLD; rr(ctx, -1, -21.4, 4, 4.2, 0.6); ctx.fill();
      ctx.fillStyle = 'rgba(255,230,210,.35)'; ctx.fillRect(2.8, -36, 1.4, 13);
      // wooden neck peg + round head with painted face and big rosy cheeks
      ctx.beginPath(); rr(ctx, -3, -41, 6, 4, 1); fo(ctx, WOOD_D, 1);
      const hy = -49;
      face(ctx, hy, 10.5, WOOD, t);
      ctx.fillStyle = 'rgba(232,80,80,.75)'; circ(ctx, 7.6, hy + 4.4, 2.3); ctx.fill(); circ(ctx, -0.6, hy + 4.2, 1.6); ctx.fill();
      ctx.strokeStyle = 'rgba(150,100,60,.35)'; ctx.lineWidth = 0.7; ctx.beginPath();
      ctx.arc(-6, hy + 1, 4, Math.PI * 0.6, Math.PI * 1.4); ctx.moveTo(-3.6, hy + 7.2); ctx.arc(-6, hy + 1, 6.6, Math.PI * 0.32, Math.PI * 0.62); ctx.stroke();
      ctx.fillStyle = '#4a3020'; ctx.beginPath(); ctx.moveTo(2.6, hy + 3); ctx.quadraticCurveTo(5, hy + 2, 7.6, hy + 3.2); ctx.quadraticCurveTo(5, hy + 3.9, 2.6, hy + 3); ctx.fill();
      // tall square shako: dark brown box, gold plate, red pompom, black visor
      ctx.beginPath(); ctx.moveTo(-8.6, hy - 6.5); ctx.lineTo(-9.2, hy - 20); ctx.lineTo(8.4, hy - 20); ctx.lineTo(9, hy - 6.5); ctx.closePath();
      fo(ctx, lgc(ctx, 'xb-hat', -9, 0, 9, 0, [[0, '#2c2224'], [0.6, '#4a3a38'], [1, '#3a2c2c']]), 1.4);
      ctx.fillStyle = GOLD; ctx.fillRect(-9, hy - 20, 17.4, 1.8); ctx.fillRect(-8.6, hy - 8.4, 17.6, 1.6);
      ctx.beginPath(); rr(ctx, 1.5, hy - 17, 5.6, 6, 1); fo(ctx, GOLD, 0.9, '#8a6a32');
      ctx.fillStyle = '#8a6a32'; ctx.fillRect(3.6, hy - 15.4, 1.4, 2.8);
      ctx.beginPath(); ctx.moveTo(5, hy - 7); ctx.lineTo(13.4, hy - 5.2); ctx.lineTo(12.6, hy - 3.6); ctx.lineTo(4, hy - 5); ctx.closePath(); fo(ctx, '#2a2428', 1);
      circ(ctx, 4.4, hy - 22.2, 2.6); fo(ctx, '#e04a3a', 1);
      ctx.strokeStyle = GOLD; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.moveTo(-6.5, hy - 6.5); ctx.quadraticCurveTo(-4, hy + 7, 3, hy + 9.6); ctx.stroke();
      // the big wooden crossbow
      ctx.save(); ctx.translate(gx, gy); ctx.rotate(rot);
      ctx.beginPath(); ctx.moveTo(-11, -1.6); ctx.lineTo(-1, -2.2); ctx.lineTo(23, -2.2); ctx.lineTo(23, 1.4); ctx.lineTo(1, 1.6); ctx.lineTo(-2, 5.4); ctx.lineTo(-5, 5.4); ctx.lineTo(-4, 2); ctx.lineTo(-11, 3.4); ctx.closePath();
      fo(ctx, lgc(ctx, 'xb-stock', 0, -2.2, 0, 5.4, [[0, '#b8804a'], [1, '#7e5028']]), 1.2);
      ctx.fillStyle = 'rgba(255,220,170,.35)'; ctx.fillRect(-9, -1.4, 30, 0.8);
      ctx.fillStyle = '#9aa2b0'; ctx.fillRect(10, -2.2, 1.6, 3.6); ctx.fillRect(18.5, -2.2, 1.6, 3.6);
      // prod (bow arms) curving back from the tip
      ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(15.5, -13); ctx.quadraticCurveTo(23.5, -8, 22.5, 0); ctx.quadraticCurveTo(23.5, 8, 15.5, 13);
      ctx.strokeStyle = INK; ctx.lineWidth = 4.6; ctx.stroke(); ctx.strokeStyle = '#9a6430'; ctx.lineWidth = 2.6; ctx.stroke();
      ctx.lineCap = 'butt';
      ctx.beginPath(); ctx.moveTo(23, -1); ctx.lineTo(27, -1.8); ctx.lineTo(27, 1.4); ctx.lineTo(23, 0.8); ctx.closePath(); fo(ctx, '#9aa2b0', 0.9);
      const loaded = at < 0.3;
      const sx2 = at > 0 ? 18 + Math.sin(at * 34) * at * 1.4 : 3 - ea * 1.5;
      ctx.strokeStyle = 'rgba(245,240,230,.95)'; ctx.lineWidth = 0.9; ctx.beginPath(); ctx.moveTo(15.8, -12.6); ctx.lineTo(sx2, -1.8); ctx.lineTo(15.8, 12.6); ctx.stroke();
      if (loaded) {
        ctx.strokeStyle = '#efe0c0'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(3, -3); ctx.lineTo(25, -3); ctx.stroke();
        ctx.fillStyle = '#e04a3a'; ctx.beginPath(); ctx.moveTo(2, -3); ctx.lineTo(5.5, -5.6); ctx.lineTo(6.5, -3); ctx.closePath(); ctx.fill();
        ctx.beginPath(); ctx.moveTo(29.5, -3); ctx.lineTo(25, -5.4); ctx.lineTo(25, -0.6); ctx.closePath(); fo(ctx, '#d8dde5', 0.9);
        if (ea > 0.3) sglow(ctx, 27, -3, 5 * ea, '255,225,160', 0.4 * ea);
      }
      if (at > 0.6) {
        const q = (at - 0.6) / 0.4;
        ctx.fillStyle = `rgba(255,248,230,${(q * 0.6).toFixed(3)})`; ell(ctx, 30 + (1 - q) * 6, -3, 3 + (1 - q) * 6, 1 + q * 1.2); ctx.fill();
        ctx.strokeStyle = `rgba(255,255,255,${(q * 0.8).toFixed(3)})`; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.moveTo(30, -6); ctx.lineTo(44, -6); ctx.moveTo(32, 0); ctx.lineTo(44, 0); ctx.stroke();
      }
      ctx.restore();
      circ(ctx, fx, fy, 2.4); fo(ctx, WOOD, 1);
      // front arm to the grip, with shoulder and elbow dowels + a gold epaulette
      const gpx = gx - 3 * cr - 3.4 * sr, gpy = gy - 3 * sr + 3.4 * cr;
      const fex = lerp(5, -1, ea) - kick * 1.5, fey = lerp(-26, -29, ea);
      bone(ctx, 2.5, -34, fex, fey, 4.2, COAT, INK, 2.3);
      bone(ctx, fex, fey, gpx, gpy, 4, COAT, INK, 2.3);
      circ(ctx, fex, fey, 2); fo(ctx, WOOD, 0.9);
      circ(ctx, gpx, gpy, 2.5); fo(ctx, WOOD, 1);
      ctx.beginPath(); rr(ctx, -1, -38.6, 8, 3.6, 1.6); fo(ctx, GOLD, 1);
      ctx.fillStyle = '#c89a3a'; for (let i = 0; i < 4; i++) ctx.fillRect(-0.4 + i * 2, -35.2, 1, 1.8);
    },

    // ---------------- 人形遣い ----------------
    // 大きな布袋を背負い、縫いぐるみを抱いた夢の子ども（死の意匠は使わない）
    dollmaster(ctx, u) {
      const t = u.anim, at = u.atk || 0, pre = antic(u, 0.3);
      const SMOCK = '#f0b468', SMOCK_D = '#cc8a44', SACK = '#dcc59a', SACK_D = '#b89c6c';
      const bob = walkBob(u, 10, 2);
      legs(ctx, u, { hip: -13, spread: 3, pants: '#8a6a9a', back: '#6a5078', boot: '#c0604a', bootB: '#984a3a', freq: 10, w: 4.4 });
      ctx.translate(0, -bob);
      const raise = at > 0 ? ease(Math.min(1, at * 1.6)) : pre * 0.25;
      // big patched cloth sack on the back, tied with a red string, a plush ear peeking out
      const sw = u.walk ? Math.sin(t * 10) * 0.8 : Math.sin(t * 2) * 0.3;
      ctx.save(); ctx.translate(-12, -27 + sw * 0.5);
      ctx.beginPath(); ctx.moveTo(-6, -8); ctx.quadraticCurveTo(-11, -2, -10, 6); ctx.quadraticCurveTo(-8, 12, 0, 12.4); ctx.quadraticCurveTo(8, 12, 9.4, 5); ctx.quadraticCurveTo(10, -3, 5, -8);
      ctx.quadraticCurveTo(0, -6.4, -6, -8); ctx.closePath();
      fo(ctx, lgc(ctx, 'dm-sack', -10, 0, 10, 0, [[0, SACK_D], [0.6, SACK], [1, '#c8ae80']]), 1.4);
      ctx.beginPath(); rr(ctx, -6.5, 0, 6, 5.4, 0.8); fo(ctx, '#e8a0a0', 0.9);
      ctx.beginPath(); rr(ctx, 2, 4.5, 5, 4.4, 0.8); fo(ctx, '#a8c8e0', 0.9);
      ctx.save(); ctx.setLineDash([1.2, 1]); ctx.strokeStyle = 'rgba(80,50,30,.8)'; ctx.lineWidth = 0.6;
      rr(ctx, -5.7, 0.8, 4.4, 3.8, 0.5); ctx.stroke(); rr(ctx, 2.8, 5.3, 3.4, 2.8, 0.5); ctx.stroke(); ctx.restore();
      ctx.beginPath(); ctx.moveTo(-3, -8.5); ctx.quadraticCurveTo(-5, -14, -1.5, -14.6); ctx.quadraticCurveTo(0.5, -12, 0.5, -8); ctx.closePath(); fo(ctx, '#f3e3c8', 1);
      ctx.fillStyle = '#f0a8a8'; ell(ctx, -1.8, -11.5, 0.9, 1.8, -0.2); ctx.fill();
      ctx.beginPath(); ctx.moveTo(-6.6, -8.4); ctx.quadraticCurveTo(0, -5.4, 5.6, -8.4); ctx.lineTo(5, -6.2); ctx.quadraticCurveTo(0, -3.6, -6, -6.2); ctx.closePath(); fo(ctx, SACK_D, 1);
      ctx.strokeStyle = '#d8463a'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(-5.6, -7); ctx.quadraticCurveTo(0, -4.6, 5, -7); ctx.moveTo(4.6, -6.6); ctx.quadraticCurveTo(7.5, -5, 7, -2.4); ctx.stroke();
      ctx.restore();
      // back arm reaching toward the sack (into it while summoning)
      const bax = lerp(-6, -10, raise), bay = lerp(-21, -33, raise);
      bone(ctx, -3, -31, bax, bay, 3.6, SMOCK_D, INK, 2.3);
      circ(ctx, bax, bay, 2.2); fo(ctx, SKIN, 1);
      // smock dress with a round white collar and a patch
      ctx.beginPath(); ctx.moveTo(-6.5, -33); ctx.lineTo(6.5, -33); ctx.quadraticCurveTo(9, -22, 11, -12); ctx.quadraticCurveTo(0, -9.6, -11, -12); ctx.quadraticCurveTo(-9, -22, -6.5, -33); ctx.closePath();
      fo(ctx, lgc(ctx, 'dm-smock', 0, -33, 0, -10, [[0, '#f6c27a'], [1, SMOCK_D]]), 1.4);
      ctx.fillStyle = 'rgba(120,60,10,.22)'; ctx.beginPath(); ctx.moveTo(-6.5, -33); ctx.lineTo(-2.5, -33); ctx.lineTo(-3.4, -10.4); ctx.quadraticCurveTo(-7, -10.8, -11, -12); ctx.quadraticCurveTo(-9, -22, -6.5, -33); ctx.closePath(); ctx.fill();
      ctx.beginPath(); rr(ctx, 0.5, -18.5, 5, 4.6, 0.8); fo(ctx, '#9ac4a0', 0.9);
      ctx.save(); ctx.setLineDash([1.2, 1]); ctx.strokeStyle = '#4e7a58'; ctx.lineWidth = 0.6; rr(ctx, 1.3, -17.7, 3.4, 3, 0.5); ctx.stroke(); ctx.restore();
      ctx.beginPath(); ctx.moveTo(-6.8, -33.4); ctx.quadraticCurveTo(-4, -29, 0, -30.6); ctx.quadraticCurveTo(4, -29, 7, -33.4); ctx.quadraticCurveTo(0, -35.4, -6.8, -33.4); ctx.closePath(); fo(ctx, '#fbf6ec', 1.1);
      // sack strap over the shoulder
      ctx.strokeStyle = '#8a5a3a'; ctx.lineWidth = 1.8; ctx.beginPath(); ctx.moveTo(-5, -33); ctx.quadraticCurveTo(-2, -26, -6, -17); ctx.stroke();
      // head: cocoa bob, a floppy striped nightcap with a pompom
      const hy = -42;
      ctx.beginPath(); ctx.moveTo(-10, hy - 1); ctx.quadraticCurveTo(-12.5, hy + 8, -7.5, hy + 9.5); ctx.lineTo(-3, hy + 5); ctx.closePath(); fo(ctx, '#7a4a3a', 1.1);
      face(ctx, hy, 10, SKIN, t);
      ctx.beginPath(); ctx.moveTo(-10, hy + 1); ctx.quadraticCurveTo(-10, hy - 8, 0, hy - 8); ctx.quadraticCurveTo(9, hy - 8, 10.4, hy - 1); ctx.lineTo(7, hy - 3.4); ctx.lineTo(4.4, hy - 1); ctx.lineTo(2.4, hy - 3.8); ctx.quadraticCurveTo(-4, hy - 2.4, -4.6, hy + 5); ctx.closePath();
      fo(ctx, '#8a5644', 1.2);
      const cf = Math.sin(t * (u.walk ? 10 : 2.6)) * 1.4;
      ctx.beginPath(); ctx.moveTo(-10, hy - 4.2); ctx.quadraticCurveTo(-10, hy - 13, -1, hy - 12.6); ctx.quadraticCurveTo(7, hy - 12.4, 9.8, hy - 5.6); ctx.quadraticCurveTo(4, hy - 7.4, 0, hy - 7.2);
      ctx.quadraticCurveTo(-6, hy - 7, -10, hy - 4.2); ctx.closePath();
      fo(ctx, '#e88a7a', 1.2);
      ctx.beginPath(); ctx.moveTo(-6, hy - 11); ctx.quadraticCurveTo(-11, hy - 17 + cf * 0.3, -17 + cf, hy - 13 + cf); ctx.lineTo(-15 + cf, hy - 10 + cf); ctx.quadraticCurveTo(-11, hy - 12, -8.6, hy - 7); ctx.closePath();
      fo(ctx, '#e88a7a', 1.1);
      ctx.strokeStyle = '#fbf0e2'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(-4, hy - 12.4); ctx.quadraticCurveTo(-3, hy - 9, -4, hy - 6.8); ctx.moveTo(3, hy - 12.2); ctx.quadraticCurveTo(4, hy - 9.4, 3.6, hy - 6.8); ctx.moveTo(-10.5, hy - 14.4); ctx.lineTo(-11.4, hy - 10.4); ctx.stroke();
      circ(ctx, -16.4 + cf, hy - 11.4 + cf, 2.6); fo(ctx, '#fbf0e2', 1);
      // the plush doll: hugged at rest, lifted up high when calling one out
      const dx = lerp(9, 11, raise), dy = lerp(-22, -54, raise);
      if (raise > 0.05) {
        ctx.globalCompositeOperation = 'lighter';
        sglow(ctx, dx, dy - 4, 12 + raise * 8, '255,226,170', 0.5 * raise);
        sglow(ctx, dx, dy - 4, 20, '160,220,255', 0.25 * raise);
        ctx.globalCompositeOperation = 'source-over';
        for (let i = 0; i < 5; i++) {
          const a = t * 2.4 + i * 1.26, rad = 9 + Math.sin(t * 3 + i) * 2;
          ctx.fillStyle = `rgba(255,244,214,${(raise * (0.5 + 0.4 * Math.sin(t * 5 + i))).toFixed(3)})`;
          circ(ctx, dx + Math.cos(a) * rad, dy - 4 + Math.sin(a) * rad * 0.7, 1); ctx.fill();
        }
      }
      plush(ctx, dx, dy, 1, t);
      const hx = lerp(6, 10.5, raise), hyy = lerp(-21, -46, raise);
      bone(ctx, 2.5, -31, hx, hyy, 3.8, SMOCK, INK, 2.3);
      circ(ctx, hx, hyy, 2.3); fo(ctx, SKIN, 1);
    },

    // ---------------- 眠り人形 ----------------
    doll(ctx, u) {
      const t = u.anim, at = u.atk || 0, pre = antic(u, 0.25);
      const CLOTH = '#f3e3c8', CLOTH_D = '#d9c3a2';
      const ph = u.walk ? t * 11 : 0, s = Math.sin(ph);
      const hop = u.walk ? Math.abs(Math.cos(ph)) * 2.2 : Math.sin(t * 2.2) * 0.5;
      const punch = at > 0 ? Math.sin(Math.min(1, at * 1.3) * Math.PI * 0.5) : 0;
      // little round feet
      ctx.beginPath(); ell(ctx, -3.5 - s * 3, -2.2, 4.2, 2.6); fo(ctx, '#c88a6a', 1.2);
      ctx.beginPath(); ell(ctx, 4 + s * 3, -2.2, 4.2, 2.6); fo(ctx, '#e0a07c', 1.2);
      ctx.translate(punch * 1.5 - pre * 1, -hop);
      // back stub arm
      ctx.beginPath(); ell(ctx, -8.5, -14 + (u.walk ? s * 1.5 : 0), 3, 4.6, 0.4); fo(ctx, CLOTH_D, 1.2);
      // round body with a centre seam and a patch
      ctx.beginPath(); ell(ctx, 0, -13, 10, 9.6 - punch * 0.6); fo(ctx, lgc(ctx, 'dol-body', -10, 0, 10, 0, [[0, CLOTH_D], [0.6, CLOTH], [1, '#e8d6b8']]), 1.4);
      ctx.save(); ctx.setLineDash([1.4, 1.2]); ctx.strokeStyle = 'rgba(120,80,60,.75)'; ctx.lineWidth = 0.7;
      ctx.beginPath(); ctx.moveTo(4.5, -21.6); ctx.quadraticCurveTo(7, -13, 4.5, -4.2); ctx.stroke();
      ctx.restore();
      ctx.beginPath(); rr(ctx, -6.5, -15, 6, 5.6, 1); fo(ctx, '#9ac4e0', 0.9);
      ctx.save(); ctx.setLineDash([1.1, 0.9]); ctx.strokeStyle = 'rgba(40,70,110,.8)'; ctx.lineWidth = 0.6; rr(ctx, -5.8, -14.3, 4.6, 4.2, 0.6); ctx.stroke(); ctx.restore();
      ctx.fillStyle = '#e88a7a'; circ(ctx, 6.8, -16, 1.2); ctx.fill(); circ(ctx, 7.2, -11.5, 1.2); ctx.fill();
      // head: button eyes, stitched smile, a seam over the top
      const hy = -29;
      ctx.beginPath(); circ(ctx, 1, hy, 10); fo(ctx, CLOTH, 1.4);
      ctx.fillStyle = 'rgba(160,110,80,.16)'; ctx.beginPath(); ctx.arc(1, hy, 10, Math.PI * 0.55, Math.PI * 1.45); ctx.closePath(); ctx.fill();
      ctx.save(); ctx.setLineDash([1.4, 1.2]); ctx.strokeStyle = 'rgba(120,80,60,.7)'; ctx.lineWidth = 0.7;
      ctx.beginPath(); ctx.arc(-2, hy, 9.4, Math.PI * 1.15, Math.PI * 1.75); ctx.stroke(); ctx.restore();
      ctx.fillStyle = 'rgba(255,120,130,.38)'; ell(ctx, 8.6, hy + 4, 2.2, 1.3); ctx.fill();
      for (const [bx, r] of [[7.6, 2.3], [2, 1.9]]) {
        circ(ctx, bx, hy + 0.2, r); fo(ctx, '#4a3450', 0.9);
        ctx.fillStyle = '#c8b0d8'; circ(ctx, bx - r * 0.3, hy + 0.2 - r * 0.25, 0.42); ctx.fill(); circ(ctx, bx + r * 0.3, hy + 0.2 + r * 0.25, 0.42); ctx.fill();
      }
      ctx.strokeStyle = '#8a4a50'; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.moveTo(3.2, hy + 5); ctx.quadraticCurveTo(5.4, hy + 6.8, 7.8, hy + 5); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(4.2, hy + 5.2); ctx.lineTo(4, hy + 6.6); ctx.moveTo(6.8, hy + 5.4); ctx.lineTo(7, hy + 6.7); ctx.stroke();
      // floppy nightcap with a pompom
      const cf = Math.sin(t * (u.walk ? 11 : 2.6)) * 1.4;
      ctx.beginPath(); ctx.moveTo(-8.6, hy - 3); ctx.quadraticCurveTo(-8, hy - 11.5, 1, hy - 11.6); ctx.quadraticCurveTo(9, hy - 11.4, 10.4, hy - 4.4);
      ctx.quadraticCurveTo(5, hy - 6.6, 1, hy - 6.4); ctx.quadraticCurveTo(-5, hy - 6, -8.6, hy - 3); ctx.closePath();
      fo(ctx, '#7a9ad0', 1.2);
      ctx.beginPath(); ctx.moveTo(-4, hy - 10.6); ctx.quadraticCurveTo(-10, hy - 17 + cf * 0.3, -16 + cf, hy - 12 + cf); ctx.lineTo(-13.8 + cf, hy - 9.4 + cf); ctx.quadraticCurveTo(-9, hy - 11, -7, hy - 6); ctx.closePath();
      fo(ctx, '#7a9ad0', 1.1);
      ctx.strokeStyle = '#f6edd8'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(-2.4, hy - 11.4); ctx.quadraticCurveTo(-1.6, hy - 8.6, -2.4, hy - 6.2); ctx.moveTo(4.6, hy - 11); ctx.quadraticCurveTo(5.4, hy - 8.6, 5, hy - 6); ctx.moveTo(-9.6, hy - 13.6); ctx.lineTo(-10.4, hy - 9.8); ctx.stroke();
      circ(ctx, -15.4 + cf, hy - 10.6 + cf, 2.6); fo(ctx, '#ffe6a0', 1);
      // front stub arm: a short bop forward
      const ax = lerp(7.5, 14.5, punch), ay = lerp(-13, -17, punch) + (u.walk ? -s * 1.5 : 0);
      ctx.beginPath(); ell(ctx, ax, ay, 3.2 + punch * 0.8, 4.6 - punch * 1.2, lerp(-0.4, -1.45, punch)); fo(ctx, CLOTH, 1.2);
      if (punch > 0.6 && at > 0.4) {
        const q = (at - 0.4) / 0.6;
        ctx.strokeStyle = `rgba(255,246,226,${(q * 0.8).toFixed(3)})`; ctx.lineWidth = 1; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.arc(ax + 2, ay, 6 + (1 - q) * 3, -0.7, 0.7); ctx.stroke(); ctx.lineCap = 'butt';
      }
    },

    // ---------------- 砲台 ----------------
    // 真鍮の小さな据え置き砲台。動かない。u.life < 5 で少し点滅。
    turret(ctx, u) {
      const t = u.anim, at = u.atk || 0;
      ctx.translate(-(at > 0 ? Math.sin((1 - at) * Math.PI) * 5 : 0), 0);
      const life = u.life;
      let lowOn = false;
      if (life != null && life < 5) {
        const sp = 5 + (5 - Math.max(0, life)) * 2.2;
        lowOn = Math.sin(t * sp) > 0;
        if (!lowOn) ctx.globalAlpha *= 0.58;
      }
      const BR = '#d9a94e', BR_D = '#a87a2c', BR_L = '#f6dc96';
      // tripod: far leg, then the two near legs
      bone(ctx, 0, -11, -6, -0.5, 2.6, BR_D, INK, 2.2);
      ctx.beginPath(); ell(ctx, -6.4, -0.8, 2.6, 1.3); fo(ctx, '#6a5a50', 1);
      bone(ctx, 0, -11, -10.5, -0.5, 2.8, '#c0903c', INK, 2.2);
      bone(ctx, 0, -11, 10, -0.5, 2.8, '#c0903c', INK, 2.2);
      ctx.beginPath(); ell(ctx, -10.8, -0.8, 2.8, 1.4); fo(ctx, '#7a6a5e', 1); ctx.beginPath(); ell(ctx, 10.4, -0.8, 2.8, 1.4); fo(ctx, '#7a6a5e', 1);
      ctx.beginPath(); rr(ctx, -5, -14, 10, 4.4, 1.6); fo(ctx, '#8a7a6e', 1.2);
      // barrel (behind the dome's front), recoils back on the shot, slow idle tracking
      const rc = at * at * 4.5, tilt = Math.sin(t * 1.4) * 0.035 - at * 0.08;
      ctx.save(); ctx.translate(2, -21); ctx.rotate(tilt); ctx.translate(-rc, 0);
      ctx.beginPath(); rr(ctx, 0, -3.4, 17, 6.8, 3.2); fo(ctx, lgc(ctx, 'tur-barrel', 0, -3.4, 0, 3.4, [[0, BR_L], [0.5, BR], [1, BR_D]]), 1.3);
      ctx.fillStyle = 'rgba(120,70,10,.35)'; ctx.fillRect(7, -3.4, 1.4, 6.8);
      ctx.beginPath(); rr(ctx, 15, -4.4, 4.2, 8.8, 2); fo(ctx, BR_D, 1.2);
      ctx.beginPath(); ell(ctx, 19.2, 0, 1.4, 2.8); ctx.fillStyle = '#2e2420'; ctx.fill();
      if (at > 0.6) {
        const q = (at - 0.6) / 0.4;
        ctx.globalCompositeOperation = 'lighter';
        sglow(ctx, 22, 0, 6 + q * 9, '255,190,100', q);
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = `rgba(255,244,210,${q.toFixed(3)})`; ell(ctx, 22.5, 0, 2 + q * 3.5, 1 + q * 1.4); ctx.fill();
      }
      ctx.restore();
      if (at > 0.05 && at < 0.9) {
        const p = 1 - at;
        for (let i = 0; i < 3; i++) { ctx.fillStyle = `rgba(214,206,220,${(at * 0.45 * (1 - i * 0.25)).toFixed(3)})`; circ(ctx, 24 + p * 5 + i * 3, -22 - p * 7 - i * 2.2, 1.4 + p * 2.6 + i * 0.5); ctx.fill(); }
      }
      // round brass body with a band, rivets and a little lamp
      ctx.beginPath(); ell(ctx, 0, -20.5, 9.6, 8.8); fo(ctx, lgc(ctx, 'tur-body', -9, -28, 6, -12, [[0, BR_L], [0.5, BR], [1, BR_D]]), 1.4);
      ctx.fillStyle = 'rgba(255,255,255,.55)'; ell(ctx, -3.2, -25, 3, 1.8, -0.5); ctx.fill();
      ctx.beginPath(); ctx.moveTo(-9.4, -18.5); ctx.quadraticCurveTo(0, -15.6, 9.4, -18.5); ctx.lineTo(9.2, -15.6); ctx.quadraticCurveTo(0, -12.8, -9, -15.6); ctx.closePath(); fo(ctx, BR_D, 1);
      ctx.fillStyle = BR_L; for (let i = 0; i < 4; i++) { circ(ctx, -6 + i * 4, -16.2 + Math.abs(i - 1.5) * -0.4, 0.7); ctx.fill(); }
      ctx.beginPath(); rr(ctx, -12.6, -23, 4, 5, 1.2); fo(ctx, '#9a7a3a', 1);
      bone(ctx, -11, -21, -14, -25, 1.4, '#8a7a6e', INK, 1.6); circ(ctx, -14.2, -25.6, 1.4); fo(ctx, '#e04a3a', 0.8);
      const lampRGB = lowOn ? '255,110,80' : '255,214,130';
      const la = 0.55 + Math.sin(t * 3) * 0.2 + (lowOn ? 0.3 : 0);
      ctx.globalCompositeOperation = 'lighter'; sglow(ctx, 3.6, -24.6, 4.6, lampRGB, la); ctx.globalCompositeOperation = 'source-over';
      circ(ctx, 3.6, -24.6, 1.8); fo(ctx, lowOn ? '#ff8a6a' : '#ffe4a0', 0.9);
      ctx.beginPath(); rr(ctx, -3, -31, 6, 2.6, 1.2); fo(ctx, BR_D, 1);
    },

    // ---------------- ゴーレム ----------------
    golem(ctx, u) {
      const t = u.anim, at = u.atk, pre = antic(u, 0.45);
      const ph = t * 5.2;
      // arm angle measured from straight down, positive = forward/up (rest → raised overhead → slammed forward)
      const REST = 0.12, UP = 2.75, SLAM = 0.62;
      const p = at > 0 ? 1 - at : 0;
      let a, lean, squash = 0;
      if (at > 0) {
        if (p < 0.2) { const k = ease(p / 0.2); a = lerp(UP, SLAM, k); lean = lerp(-0.07, 0.14, k); }
        else if (p < 0.45) { a = SLAM; lean = 0.14; squash = 1 - (p - 0.2) / 0.25; }
        else { const k = ease((p - 0.45) / 0.55); a = lerp(SLAM, REST, k); lean = lerp(0.14, 0, k); }
      } else { a = lerp(REST, UP, pre); lean = -0.07 * pre; }
      if (u.walk && !(at > 0)) a += Math.sin(ph) * 0.12;
      const bob = u.walk ? Math.abs(Math.cos(ph)) * 2.6 : Math.sin(t * 1.6) * 0.9;
      const rock = u.walk ? Math.sin(ph) * 0.045 : Math.sin(t * 1.6) * 0.012;
      // dust puff on the slam
      if (at > 0 && p > 0.1 && p < 0.75) {
        const dp = (p - 0.1) / 0.65, da = (1 - dp) * 0.75;
        ctx.fillStyle = `rgba(214,210,232,${da.toFixed(3)})`;
        for (let i = 0; i < 5; i++) {
          const dx = 20 + i * 5 + dp * (6 + i * 3), dy = -2 - (i % 2) * 2.5 - dp * 4, r = 2.6 + dp * (5 + (i % 3));
          circ(ctx, dx, dy, r); ctx.fill();
          circ(ctx, -14 - i * 3 - dp * (4 + i * 2), dy + 0.5, r * 0.7); ctx.fill();
        }
        ctx.fillStyle = `rgba(150,145,175,${(da * 1.2).toFixed(3)})`;
        for (let i = 0; i < 4; i++) { const q = dp + i * 0.1; ctx.fillRect(24 + i * 6 + q * 8, -3 - Math.sin(q * Math.PI) * (8 + i * 3), 2, 2); }
      }
      // stumpy legs
      for (const side of [-1, 1]) {
        const lift = u.walk ? Math.max(0, Math.cos(ph) * side) * 3.6 : 0;
        const fx = side * 8 + (u.walk ? Math.sin(ph) * side * 3 : 0);
        ctx.beginPath(); rr(ctx, fx - 7, -19 - lift, 14, 19, [5, 5, 4, 4]);
        fo(ctx, side < 0 ? '#6f7390' : '#8c90aa', 1.4);
        ctx.fillStyle = 'rgba(255,255,255,.18)'; ctx.fillRect(fx - 4, -16 - lift, 3, 10);
        ctx.fillStyle = 'rgba(20,20,50,.25)'; ctx.fillRect(fx - 7, -4 - lift, 14, 3);
      }
      ctx.translate(0, -bob + squash * 1.5);
      ctx.translate(0, -14); ctx.rotate(rock + lean); ctx.translate(0, 14);
      if (squash > 0) { ctx.translate(0, -14); ctx.scale(1 + squash * 0.04, 1 - squash * 0.04); ctx.translate(0, 14); }
      const arm = (sx, sy, ang, col, dark) => {
        ctx.save(); ctx.translate(sx, sy); ctx.rotate(-ang);
        bone(ctx, 0, 0, 0, 17, 10, col, INK, 2.8);
        ctx.fillStyle = 'rgba(20,20,50,.22)'; ctx.fillRect(-5, 4, 3, 11);
        ctx.beginPath(); rr(ctx, -8.5, 15, 17, 15, 6.5); fo(ctx, col, 1.5);
        ctx.fillStyle = dark; ctx.fillRect(-7.5, 24, 15, 1.2);
        ctx.strokeStyle = 'rgba(30,30,60,.55)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(-2.8, 25); ctx.lineTo(-2.8, 29); ctx.moveTo(2.6, 25); ctx.lineTo(2.6, 29); ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,.22)'; ctx.fillRect(-6, 17, 4, 5);
        ctx.restore();
      };
      // back arm (behind the body)
      arm(-15, -55, a - 0.08, '#7a7f9b', 'rgba(20,20,50,.3)');
      // boulder body
      ctx.beginPath();
      ctx.moveTo(-22, -16);
      ctx.bezierCurveTo(-30, -32, -29, -60, -10, -67);
      ctx.bezierCurveTo(6, -72, 25, -64, 27, -46);
      ctx.bezierCurveTo(29, -30, 24, -17, 14, -13);
      ctx.quadraticCurveTo(-4, -9, -22, -16);
      ctx.closePath();
      fo(ctx, lgc(ctx, 'golem-body', 0, -70, 0, -12, [[0, '#bcc0d6'], [0.55, '#9ca1ba'], [1, '#7c8099']]), 1.6);
      ctx.fillStyle = 'rgba(30,30,70,.22)'; ctx.beginPath(); ctx.moveTo(-22, -16); ctx.bezierCurveTo(-30, -32, -29, -60, -10, -67); ctx.bezierCurveTo(-18, -54, -18, -30, -10, -12); ctx.quadraticCurveTo(-16, -12.5, -22, -16); ctx.closePath(); ctx.fill();
      // cracks + pebble flecks
      ctx.strokeStyle = 'rgba(40,40,80,.5)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(19, -24); ctx.lineTo(15, -21); ctx.lineTo(16, -17); ctx.moveTo(-17, -46); ctx.lineTo(-13, -43); ctx.lineTo(-14, -39); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,.28)'; ctx.fillRect(16, -55, 3, 3); ctx.fillRect(-6, -22, 2.4, 2.4); ctx.fillRect(21, -36, 2, 2);
      ctx.fillStyle = 'rgba(255,255,255,.2)'; ell(ctx, 10, -58, 9, 3.4, -0.25); ctx.fill();
      // glowing rune lines on the chest (pulse slowly, flare on the slam)
      const rp = 0.55 + 0.25 * Math.sin(t * 2) + (at > 0 ? at * 0.3 : pre * 0.25);
      ctx.globalCompositeOperation = 'lighter';
      sglow(ctx, 6, -38, 14 + rp * 6, '140,235,255', 0.28 + rp * 0.25);
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = `rgba(180,245,255,${Math.min(1, 0.5 + rp * 0.5).toFixed(3)})`; ctx.lineWidth = 1.5; ctx.lineCap = 'round';
      ctx.beginPath();
      circ(ctx, 6, -38, 5.5); ctx.moveTo(6, -41.5); ctx.lineTo(9.5, -38); ctx.lineTo(6, -34.5); ctx.lineTo(2.5, -38); ctx.closePath();
      ctx.moveTo(6, -32.5); ctx.lineTo(6, -27); ctx.lineTo(10, -23);
      ctx.moveTo(11.5, -38); ctx.lineTo(18, -38); ctx.lineTo(20, -42);
      ctx.moveTo(0.5, -38); ctx.lineTo(-5, -38); ctx.lineTo(-7, -33);
      ctx.stroke(); ctx.lineCap = 'butt';
      // moss on the shoulders
      ctx.beginPath(); ctx.moveTo(-23, -52); ctx.quadraticCurveTo(-16, -66, -2, -68.5); ctx.quadraticCurveTo(12, -70, 21, -60);
      ctx.quadraticCurveTo(18, -57, 16, -59); ctx.quadraticCurveTo(13, -55, 10, -59); ctx.quadraticCurveTo(6, -56, 3, -60); ctx.quadraticCurveTo(-1, -57, -4, -61);
      ctx.quadraticCurveTo(-9, -57, -12, -60); ctx.quadraticCurveTo(-16, -55, -18, -57); ctx.quadraticCurveTo(-21, -50, -23, -52); ctx.closePath();
      fo(ctx, '#78ae68', 1.2, '#2a3a40');
      ctx.fillStyle = '#a8d48a'; ell(ctx, -6, -65, 5, 1.4, -0.1); ctx.fill(); ell(ctx, 10, -65.5, 3.5, 1.1, 0.2); ctx.fill();
      // head stone, set forward on the shoulders
      const hx = 6, hy = -67;
      ctx.beginPath(); ctx.moveTo(hx - 15, hy + 6); ctx.bezierCurveTo(hx - 17, hy - 6, hx - 8, hy - 12.5, hx + 1, hy - 12.5); ctx.bezierCurveTo(hx + 12, hy - 12.5, hx + 17, hy - 5, hx + 16, hy + 4); ctx.quadraticCurveTo(hx + 14, hy + 10, hx, hy + 10); ctx.quadraticCurveTo(hx - 13, hy + 10, hx - 15, hy + 6); ctx.closePath();
      fo(ctx, lgc(ctx, 'golem-head', 0, hy - 13, 0, hy + 10, [[0, '#c6cadf'], [1, '#959ab4']]), 1.5);
      ctx.fillStyle = 'rgba(30,30,70,.2)'; ctx.beginPath(); ctx.moveTo(hx - 15, hy + 6); ctx.bezierCurveTo(hx - 17, hy - 6, hx - 8, hy - 12.5, hx + 1, hy - 12.5); ctx.quadraticCurveTo(hx - 8, hy - 6, hx - 6, hy + 10); ctx.quadraticCurveTo(hx - 12, hy + 9.5, hx - 15, hy + 6); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(hx - 12, hy - 7); ctx.quadraticCurveTo(hx - 4, hy - 14, hx + 7, hy - 12); ctx.quadraticCurveTo(hx + 12, hy - 10, hx + 13, hy - 7.5);
      ctx.quadraticCurveTo(hx + 9, hy - 8.5, hx + 7, hy - 7); ctx.quadraticCurveTo(hx + 3, hy - 9, hx, hy - 7.5); ctx.quadraticCurveTo(hx - 4, hy - 9, hx - 7, hy - 6.5); ctx.quadraticCurveTo(hx - 10, hy - 7.5, hx - 12, hy - 7); ctx.closePath();
      fo(ctx, '#78ae68', 1.1, '#2a3a40');
      // soft glowing eyes (blink), cheek blush, tiny smile
      const bl = (t % 4.3) < 0.14 ? 0.2 : 1;
      ctx.globalCompositeOperation = 'lighter';
      sglow(ctx, hx + 6.5, hy + 0.5, 11, '150,240,255', 0.5 + 0.12 * Math.sin(t * 2.2) + (at > 0 ? at * 0.25 : 0));
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = '#e4fdff';
      ell(ctx, hx + 10.5, hy + 0.5, 1.9, 2.7 * bl); ctx.fill();
      ell(ctx, hx + 2.6, hy + 0.5, 1.7, 2.5 * bl); ctx.fill();
      ctx.fillStyle = 'rgba(255,160,180,.32)'; ell(ctx, hx + 11, hy + 5, 2.4, 1.3); ctx.fill();
      ctx.strokeStyle = 'rgba(40,40,80,.7)'; ctx.lineWidth = 0.9; ctx.beginPath(); ctx.arc(hx + 7, hy + 5.2, 1.4, 0.3, Math.PI - 0.3); ctx.stroke();
      // sprout with a tiny flower
      const ss = Math.sin(t * 2.6) * 0.12 + (u.walk ? Math.sin(ph) * 0.1 : 0);
      ctx.save(); ctx.translate(hx - 1, hy - 12); ctx.rotate(ss);
      ctx.strokeStyle = INK; ctx.lineWidth = 2.6; ctx.beginPath(); ctx.moveTo(0, 1); ctx.quadraticCurveTo(-1, -4, 0.5, -8); ctx.stroke();
      ctx.strokeStyle = '#7fc46a'; ctx.lineWidth = 1.2; ctx.stroke();
      ell(ctx, -3.6, -4.5, 3.4, 1.6, 0.45); fo(ctx, '#8fd47a', 0.9);
      ell(ctx, 3.6, -5.5, 3, 1.5, -0.5); fo(ctx, '#8fd47a', 0.9);
      ctx.fillStyle = '#ffd6ea'; ctx.strokeStyle = INK; ctx.lineWidth = 0.8;
      for (let i = 0; i < 5; i++) { const an = i * TAU / 5 + t * 0.3; ell(ctx, 0.5 + Math.cos(an) * 1.9, -9 + Math.sin(an) * 1.9, 1.5, 1.5); ctx.fill(); ctx.stroke(); }
      for (let i = 0; i < 5; i++) { const an = i * TAU / 5 + t * 0.3; ell(ctx, 0.5 + Math.cos(an) * 1.9, -9 + Math.sin(an) * 1.9, 1.2, 1.2); ctx.fill(); }
      circ(ctx, 0.5, -9, 1); ctx.fillStyle = '#ffd56a'; ctx.fill();
      ctx.restore();
      // front arm
      arm(16, -53, a, '#9ea3bd', 'rgba(20,20,50,.25)');
    },

    // ---------------- Nightmares ----------------
    shade(ctx, u) {
      const t = u.anim, at = u.atk, pre = antic(u, 0.3);
      const sway = Math.sin(t * 3.2) * 1.6, hov = Math.sin(t * 2.4) * 1.5 + 2;
      ctx.translate(0, -hov);
      // loose threads trailing
      ctx.strokeStyle = 'rgba(120,70,190,.55)'; ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (let i = 0; i < 3; i++) {
        const y0 = -12 - i * 9, w = Math.sin(t * 6 + i * 2) * 3;
        ctx.moveTo(-11, y0); ctx.quadraticCurveTo(-19, y0 + w, -26 - i * 2, y0 - 2 + w * 1.5);
      }
      ctx.stroke();
      // body
      ctx.beginPath();
      ctx.moveTo(-13, -8);
      ctx.bezierCurveTo(-17 + sway, -26, -14, -47, -2, -52);
      ctx.bezierCurveTo(8, -56, 17, -46, 16, -32);
      ctx.bezierCurveTo(16 + sway * 0.4, -20, 15, -12, 14, -6);
      const n = 8;
      for (let i = 1; i <= n; i++) {
        const x = 14 - i * (27 / n), y = -2 + (i % 2 ? -7 : 1) + Math.sin(t * 7 + i * 1.7) * 2.2;
        ctx.lineTo(x + Math.sin(t * 5 + i) * 1.2, y);
      }
      ctx.closePath();
      ctx.fillStyle = lgc(ctx, 'shade-body', 0, -54, 0, 0, [[0, '#3c2668'], [0.45, '#170d30'], [1, '#07040f']]);
      ctx.fill();
      ctx.strokeStyle = EINK; ctx.lineWidth = 2.6; ctx.stroke();
      ctx.strokeStyle = RIM; ctx.lineWidth = 1.2; ctx.stroke();
      // inner folds
      ctx.strokeStyle = 'rgba(160,110,230,.35)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(-8, -40); ctx.quadraticCurveTo(-10 + sway, -24, -6, -10); ctx.moveTo(4, -22); ctx.quadraticCurveTo(2, -14, 5, -8); ctx.stroke();
      // eyes
      ctx.globalCompositeOperation = 'lighter';
      sglow(ctx, 8, -38, 15, '255,160,235', 0.45 + pre * 0.3);
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = '#ffd8f6';
      ell(ctx, 4.6, -39, 2.2, 3.3, -0.25); ctx.fill(); ell(ctx, 11, -38, 1.9, 2.9, -0.25); ctx.fill();
      // wobbly mouth
      ctx.strokeStyle = 'rgba(255,190,240,.55)'; ctx.lineWidth = 0.9;
      ctx.beginPath(); ctx.moveTo(4, -31); ctx.lineTo(6, -32.2); ctx.lineTo(8, -31); ctx.lineTo(10, -32.2); ctx.stroke();
      // reaching arm with claws
      const reach = at > 0 ? at * 11 : -pre * 6;
      const hx = 22 + reach, hy2 = -24 + Math.sin(t * 5) * 2 - at * 2;
      ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(9, -29); ctx.quadraticCurveTo(15 + reach * 0.5, -32, hx, hy2);
      ctx.strokeStyle = EINK; ctx.lineWidth = 6.4; ctx.stroke();
      ctx.strokeStyle = '#24143f'; ctx.lineWidth = 4; ctx.stroke();
      ctx.strokeStyle = RIM; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(10, -31.5); ctx.quadraticCurveTo(15 + reach * 0.5, -34.5, hx, hy2 - 2.4); ctx.stroke();
      ctx.strokeStyle = '#2c1850'; ctx.lineWidth = 1.6;
      ctx.beginPath(); for (let i = -1; i <= 1; i++) { ctx.moveTo(hx, hy2); ctx.quadraticCurveTo(hx + 3, hy2 + i * 2.5, hx + 5, hy2 + i * 3.5 + 1.5); } ctx.stroke();
      ctx.lineCap = 'butt';
    },

    runner(ctx, u) {
      const t = u.anim, at = u.atk, run = u.walk ? 1 : 0;
      const gal = Math.sin(t * 20);
      const by = -16 - (run ? Math.abs(gal) * 2.2 : Math.sin(t * 3) * 0.8) + at * 2;
      const lunge = at > 0 ? Math.sin(at * Math.PI) * 4 : 0;
      ctx.translate(lunge, 0);
      // body silhouette path (reused for afterimages)
      function bodyPath(yy, stretch) {
        ctx.beginPath();
        ctx.moveTo(-22 - stretch, yy + 3);
        ctx.bezierCurveTo(-18 - stretch, yy - 9, -6, yy - 12, 6, yy - 11);
        ctx.quadraticCurveTo(14, yy - 12, 18, yy - 8);
        ctx.lineTo(26, yy - 3); ctx.quadraticCurveTo(26, yy + 1, 21, yy + 1.5);
        ctx.quadraticCurveTo(16, yy + 5, 8, yy + 4);
        ctx.quadraticCurveTo(-6, yy + 7, -22 - stretch, yy + 3);
        ctx.closePath();
      }
      const st = run ? 4 : 0;
      if (run) {
        for (let k2 = 2; k2 >= 1; k2--) {
          ctx.save(); ctx.globalAlpha *= 0.2 * (3 - k2) * 0.6; ctx.translate(-k2 * 14, 0);
          bodyPath(by + k2 * 0.5, st); ctx.fillStyle = '#6a34a8'; ctx.fill(); ctx.restore();
        }
        ctx.strokeStyle = 'rgba(196,139,240,.35)'; ctx.lineWidth = 1;
        ctx.beginPath(); for (let i = 0; i < 3; i++) { const yy = by - 6 + i * 5, x0 = -30 - ((t * 140 + i * 17) % 30); ctx.moveTo(x0, yy); ctx.lineTo(x0 - 16, yy); } ctx.stroke();
      }
      // tail (flame-like)
      const tw = Math.sin(t * 12) * 3;
      ctx.beginPath(); ctx.moveTo(-18, by - 3); ctx.quadraticCurveTo(-30, by - 10 + tw, -42 - st * 2, by - 6 + tw * 1.4); ctx.quadraticCurveTo(-32, by - 2 + tw * 0.5, -20, by + 2); ctx.closePath();
      ctx.fillStyle = '#1e0f38'; ctx.fill(); ctx.strokeStyle = RIM; ctx.lineWidth = 1; ctx.stroke();
      // legs (far pair then near pair)
      const legA = run ? gal : 0, legB = run ? Math.sin(t * 20 + 1.6) : 0;
      function leg(x, ph, col) {
        const fx = x + ph * 7, fy = -0.5 - Math.max(0, -ph) * 3;
        ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(x, by + 2); ctx.quadraticCurveTo(x + ph * 2 - 2, by + 9, fx, fy);
        ctx.strokeStyle = EINK; ctx.lineWidth = 4.2; ctx.stroke(); ctx.strokeStyle = col; ctx.lineWidth = 2.4; ctx.stroke();
        ctx.lineCap = 'butt';
      }
      leg(-13, -legA, '#160a2a'); leg(9, -legB, '#160a2a');
      // body
      bodyPath(by, st);
      ctx.fillStyle = lgc(ctx, 'runner-body', -24, 0, 26, 0, [[0, '#120822'], [0.6, '#24123f'], [1, '#331a55']]);
      ctx.fill(); ctx.strokeStyle = EINK; ctx.lineWidth = 2.4; ctx.stroke(); ctx.strokeStyle = RIM; ctx.lineWidth = 1.1; ctx.stroke();
      // mane spikes streaming back
      ctx.beginPath();
      for (let i = 0; i < 4; i++) {
        const x = 10 - i * 7, f = Math.sin(t * 14 + i) * 2;
        ctx.moveTo(x + 3, by - 10.5); ctx.lineTo(x - 7 - st, by - 17 - i * 0.4 + f); ctx.lineTo(x - 3, by - 10);
      }
      ctx.fillStyle = '#2a1648'; ctx.fill(); ctx.strokeStyle = RIM; ctx.lineWidth = 0.9; ctx.stroke();
      // ear
      ctx.beginPath(); ctx.moveTo(13, by - 10); ctx.lineTo(9, by - 21); ctx.lineTo(18, by - 9.5); ctx.closePath();
      ctx.fillStyle = '#1e0f38'; ctx.fill(); ctx.strokeStyle = RIM; ctx.lineWidth = 1; ctx.stroke();
      leg(-9, legA, '#24123f'); leg(13, legB, '#24123f');
      // eye streak
      ctx.globalCompositeOperation = 'lighter';
      sglow(ctx, 18, by - 5, 10, '255,160,235', 0.55);
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = '#ffd6f6'; ell(ctx, 18.5, by - 5.2, 2.6, 1.3, -0.15); ctx.fill();
      if (run) { ctx.strokeStyle = 'rgba(255,190,240,.5)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(16, by - 5); ctx.lineTo(4, by - 6.5); ctx.stroke(); }
      // fangs
      ctx.fillStyle = '#f3dcff'; ctx.beginPath(); ctx.moveTo(21, by + 1.3); ctx.lineTo(22, by + 4 + at * 1.5); ctx.lineTo(23, by + 1.2); ctx.closePath(); ctx.fill();
    },

    armor(ctx, u) {
      const t = u.anim, at = u.atk, pre = antic(u, 0.35);
      const f = (i) => Math.sin(t * 2.2 + i * 1.3) * 1.8;
      const step = u.walk ? Math.abs(Math.sin(t * 6)) * 2 : 0;
      ctx.translate(0, -step);
      const RUST = '#93603f', RUST2 = '#6c4330', RUSTD = '#4a2c20';
      function plate(fill) { ctx.fillStyle = fill; ctx.fill(); ctx.strokeStyle = EINK; ctx.lineWidth = 2; ctx.stroke(); }
      // void core
      ctx.globalCompositeOperation = 'lighter';
      sglow(ctx, 0, -46, 34, '130,60,200', 0.5 + pre * 0.2);
      ctx.globalCompositeOperation = 'source-over';
      ell(ctx, 0, -44, 13, 25); ctx.fillStyle = '#0b0618'; ctx.fill(); ctx.strokeStyle = 'rgba(190,130,255,.6)'; ctx.lineWidth = 1.2; ctx.stroke();
      ctx.strokeStyle = 'rgba(170,110,240,.5)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.ellipse(0, -44, 7, 16, t * 1.5, 0, Math.PI * 1.3); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(0, -44, 4, 10, -t * 2, 0, Math.PI * 1.2); ctx.stroke();
      ctx.fillStyle = '#ffc6f0'; circ(ctx, 0, -44, 1.6 + Math.sin(t * 5) * 0.4); ctx.fill();
      // ink drips from the gaps
      ctx.fillStyle = '#120a24';
      for (let i = 0; i < 3; i++) { const dx = -6 + i * 6, l = 4 + (Math.sin(t * 1.4 + i * 2) + 1) * 4; rr(ctx, dx - 1, -22, 2, l, 1); ctx.fill(); circ(ctx, dx, -22 + l, 1.6); ctx.fill(); }
      // back pauldron
      ell(ctx, -17, -58 + f(4), 9, 6.5, -0.2); plate(RUST2);
      // greaves (separate, floating)
      ctx.beginPath(); rr(ctx, -12, -19 + f(1), 9, 17, [3, 3, 2, 2]); plate(RUST2);
      ctx.beginPath(); rr(ctx, 3, -19 + f(2), 9, 17, [3, 3, 2, 2]); plate(RUST);
      ctx.beginPath(); ctx.moveTo(-13, -2 + f(1)); ctx.lineTo(-2, -2 + f(1)); ctx.lineTo(0, 0); ctx.lineTo(-13, 0); ctx.closePath(); plate(RUSTD);
      ctx.beginPath(); ctx.moveTo(2, -2 + f(2)); ctx.lineTo(13, -2 + f(2)); ctx.lineTo(15, 0); ctx.lineTo(2, 0); ctx.closePath(); plate(RUSTD);
      // chest plate (cracked)
      const cy = f(3);
      ctx.beginPath(); ctx.moveTo(-15, -61 + cy); ctx.quadraticCurveTo(0, -65 + cy, 15, -61 + cy); ctx.lineTo(13, -36 + cy); ctx.quadraticCurveTo(0, -30 + cy, -13, -36 + cy); ctx.closePath();
      plate(lgc(ctx, 'armor-chest', -16, -62, 16, -32, [[0, '#a87050'], [0.55, '#7e5038'], [1, '#4c2e22']]));
      ctx.strokeStyle = 'rgba(255,210,170,.35)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(-12, -60 + cy); ctx.quadraticCurveTo(0, -63.5 + cy, 12, -60 + cy); ctx.stroke();
      ctx.strokeStyle = 'rgba(25,10,10,.8)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, -63 + cy); ctx.lineTo(0, -33 + cy); ctx.moveTo(-8, -56 + cy); ctx.lineTo(-4, -49 + cy); ctx.lineTo(-7, -44 + cy); ctx.stroke();
      ctx.fillStyle = 'rgba(160,90,50,.7)'; circ(ctx, 7, -47 + cy, 2.5); ctx.fill(); circ(ctx, -9, -40 + cy, 1.8); ctx.fill();
      ctx.fillStyle = '#c69070'; for (const rx of [-10, 10]) { circ(ctx, rx, -55 + cy, 1.3); ctx.fill(); }
      ctx.fillStyle = 'rgba(190,130,255,.75)'; ctx.fillRect(-0.5, -50 + cy, 1, 8);
      // helm (floating apart), slit eye glow
      const hy = f(6);
      ctx.beginPath(); ctx.moveTo(-10, -66 + hy); ctx.lineTo(-10, -80 + hy); ctx.quadraticCurveTo(0, -90 + hy, 11, -80 + hy); ctx.lineTo(11, -66 + hy); ctx.quadraticCurveTo(0, -63 + hy, -10, -66 + hy); ctx.closePath();
      plate(lgc(ctx, 'armor-helm', -10, 0, 11, 0, [[0, '#5a3626'], [0.6, '#8d5c40'], [1, '#6a4230']]));
      ctx.strokeStyle = 'rgba(206,160,255,.7)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(-8, -82 + hy); ctx.quadraticCurveTo(0, -89.5 + hy, 9, -82 + hy); ctx.stroke();
      // broken crest
      ctx.beginPath(); ctx.moveTo(-2, -86 + hy); ctx.lineTo(-6, -95 + hy); ctx.lineTo(-1, -92 + hy); ctx.lineTo(1, -87 + hy); ctx.closePath(); plate(RUST2);
      ctx.fillStyle = '#0b0618'; ctx.fillRect(-5, -76 + hy, 15, 3.6);
      ctx.globalCompositeOperation = 'lighter';
      sglow(ctx, 6, -74.2 + hy, 10, '255,150,230', 0.55 + pre * 0.35);
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = '#ffc6f0'; ctx.fillRect(3, -75.6 + hy, 6, 2);
      ctx.strokeStyle = 'rgba(25,10,10,.6)'; ctx.lineWidth = 0.8; for (let i = -6; i <= 8; i += 3.5) { ctx.beginPath(); ctx.moveTo(i, -71 + hy); ctx.lineTo(i, -67.5 + hy); ctx.stroke(); }
      // halberd (raised in anticipation, chops on attack)
      let hr = 0.25;
      if (at > 0) hr = lerp(0.25, 1.15, Math.sin(at * Math.PI * 0.5)); else hr = lerp(0.25, -0.65, pre);
      ctx.save(); ctx.translate(16, -46 + f(5)); ctx.rotate(hr);
      bone(ctx, 0, 40, 0, -38, 3, '#4a3426', EINK, 2.2);
      ctx.beginPath(); ctx.moveTo(0, -38); ctx.lineTo(3, -48); ctx.lineTo(-2, -40); ctx.closePath(); plate('#a9988e');
      ctx.beginPath(); ctx.moveTo(1, -36); ctx.quadraticCurveTo(15, -38, 16, -24); ctx.quadraticCurveTo(10, -27, 1, -22); ctx.closePath(); plate('#a9988e');
      ctx.strokeStyle = 'rgba(120,60,40,.7)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(6, -33); ctx.lineTo(9, -29); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-1, -33); ctx.lineTo(-8, -30); ctx.lineTo(-1, -28); ctx.closePath(); plate('#8a7a72');
      ctx.restore();
      // front gauntlet + pauldron
      ctx.beginPath(); rr(ctx, 12, -48 + f(5), 9, 8, 3); plate(RUST);
      ell(ctx, 17, -59 + f(5), 10, 7, 0.2); plate(RUST);
      ctx.strokeStyle = 'rgba(206,160,255,.7)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.ellipse(17, -59 + f(5), 9, 6, 0.2, Math.PI * 1.1, Math.PI * 1.85); ctx.stroke();
      // rim light on the back edges
      ctx.strokeStyle = RIM; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(-15, -59 + cy); ctx.lineTo(-13, -37 + cy); ctx.stroke();
    },

    // ---------------- 群体型「ささやく群れ」 ----------------
    swarm(ctx, u) {
      const t = u.anim + (u.id || 0) * 0.73, at = u.atk || 0;
      const bob = Math.sin(t * 5.5) * 2 + (u.walk ? Math.sin(t * 11) * 1.2 : 0);
      ctx.save(); ctx.translate(0, -12 - bob); ctx.rotate((u.walk ? 0.12 : 0) + at * 0.4);
      // trailing wisp
      const tw = Math.sin(t * 9) * 2;
      ctx.beginPath(); ctx.moveTo(-4, -2); ctx.quadraticCurveTo(-10, 1 + tw, -16, tw * 1.4); ctx.quadraticCurveTo(-10, 5 + tw * 0.5, -3, 4); ctx.closePath();
      ctx.fillStyle = '#1c0f36'; ctx.fill(); ctx.strokeStyle = RIM; ctx.lineWidth = 0.8; ctx.stroke();
      function wing(ph, col) {
        const f = 0.3 + 0.7 * (0.5 + 0.5 * Math.sin(t * 24 + ph));
        ctx.save(); ctx.translate(-1, -4); ctx.scale(1.25, f * 1.25);
        ctx.beginPath(); ctx.moveTo(1, 0); ctx.quadraticCurveTo(-1, -9, -8, -11); ctx.lineTo(-7, -8); ctx.lineTo(-11, -7.5); ctx.lineTo(-7.5, -5); ctx.lineTo(-10, -2.5); ctx.lineTo(-4, -1); ctx.closePath();
        eFill(ctx, col, 1.6); ctx.restore();
      }
      wing(1.4, '#1d0f36');
      // body
      ctx.beginPath(); ctx.moveTo(-6, 2); ctx.bezierCurveTo(-8, -5, -2, -9, 3, -8); ctx.bezierCurveTo(8, -7, 10, -2, 8, 2);
      eHem(ctx, 8, -6, 3.5, 4, t, 2.4, 0); ctx.closePath();
      eFill(ctx, lgc(ctx, 'swarm-body', 0, -9, 0, 6, [[0, '#3c2668'], [0.5, '#170d30'], [1, '#07040f']]), 1.9);
      // feelers
      ctx.strokeStyle = RIM; ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.moveTo(3, -7.5); ctx.quadraticCurveTo(5, -12, 8.5, -12.5 + Math.sin(t * 6)); ctx.moveTo(5.5, -7); ctx.quadraticCurveTo(8.5, -10, 11.5, -9.5 + Math.sin(t * 6 + 1)); ctx.stroke();
      // eyes
      eGlow(ctx, 6, -3, 8, 0.5 + at * 0.4);
      const bl = eBlink(t, 3.1);
      eEye(ctx, 4.2, -3.2, 1.3, 1.8 * bl); eEye(ctx, 7.4, -2.8, 1.1, 1.6 * bl);
      wing(0, '#2e1a52');
      ctx.restore();
    },

    // ---------------- 遠距離型「にじむ射手」 ----------------
    spitter(ctx, u) {
      const t = u.anim, at = u.atk || 0, pre = antic(u, 0.45);
      const ln = at > 0 ? Math.sin((1 - at) * Math.PI) * 5 : 0;
      ctx.translate(-ln - at * at * 6, 0); // ranged: cancel the melee lunge, recoil instead
      const step = u.walk ? Math.sin(t * 7) : 0;
      const bob = u.walk ? Math.abs(Math.cos(t * 7)) * 1.6 : Math.sin(t * 2.2) * 0.8;
      // crooked legs
      eLimb(ctx, -6, -12, -9 - step * 2, -6, -8 - step * 4, -0.5, 3, '#160a2a');
      eLimb(ctx, 4, -12, 6 + step * 2, -6, 5 + step * 4, -0.5, 3, '#24123f');
      ctx.translate(0, -bob);
      // hunched trunk
      ctx.beginPath(); ctx.moveTo(-15, -10);
      ctx.bezierCurveTo(-20, -24, -14, -42, 0, -45);
      ctx.bezierCurveTo(9, -46, 14, -38, 13, -28);
      ctx.bezierCurveTo(13, -20, 12, -14, 11, -10);
      eHem(ctx, 11, -15, -8, 6, t, 4, 2); ctx.closePath();
      eFill(ctx, lgc(ctx, 'spit-body', 0, -46, 0, -6, [[0, '#3c2668'], [0.5, '#170d30'], [1, '#07040f']]), 2.5);
      ctx.strokeStyle = 'rgba(160,110,230,.35)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(-8, -36); ctx.quadraticCurveTo(-11, -24, -7, -12); ctx.moveTo(2, -24); ctx.quadraticCurveTo(0, -17, 3, -11); ctx.stroke();
      // ink drips off the back
      ctx.fillStyle = '#120a24';
      for (let i = 0; i < 2; i++) { const l = 3 + (Math.sin(t * 1.3 + i * 2.4) + 1) * 3; rr(ctx, -13 + i * 5, -12, 1.8, l, 0.9); ctx.fill(); circ(ctx, -12.1 + i * 5, -12 + l, 1.4); ctx.fill(); }
      // thin clawed arm
      eLimb(ctx, 7, -30, 14, -24, 11, -16, 2.2, '#24123f');
      // long drooping neck (swells as a bolt travels up, kinks back on the shot)
      const hx = 27 - at * 7 + pre * 2, hy = -38 - at * 6 + Math.sin(t * 2.4) * 1.2 + pre * 2;
      const cx = 17 - at * 3, cy = -60 + at * 2;
      eLimb(ctx, 6, -38, cx, cy, hx, hy, 6, '#1e1038');
      ctx.strokeStyle = RIM; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(5.5, -41.5); ctx.quadraticCurveTo(cx, cy - 3.6, hx - 1.5, hy - 3.4); ctx.stroke();
      if (pre > 0.05) {
        const p = 0.15 + pre * 0.8, q = 1 - p;
        const bx = q * q * 6 + 2 * q * p * cx + p * p * hx, by = q * q * -38 + 2 * q * p * cy + p * p * hy;
        circ(ctx, bx, by, 3 + pre * 2.4); eFill(ctx, '#2a1748', 1.8);
      }
      // head + spout
      ctx.save(); ctx.translate(hx, hy); ctx.rotate(0.5 - at * 0.55 - pre * 0.25);
      ctx.beginPath(); ctx.moveTo(-6, -1); ctx.bezierCurveTo(-6, -9, 4, -10, 7, -5);
      ctx.lineTo(13, -3); ctx.lineTo(13.5, 3.4); ctx.lineTo(6, 4.5); ctx.bezierCurveTo(1, 8, -6, 6, -6, -1); ctx.closePath();
      eFill(ctx, '#26143f', 2.2);
      // ragged frill behind the head
      ctx.beginPath(); ctx.moveTo(-5, -5); ctx.lineTo(-11, -9 + Math.sin(t * 6) * 1.5); ctx.lineTo(-7, -3); ctx.lineTo(-12, -2 + Math.sin(t * 6 + 1) * 1.5); ctx.lineTo(-6, 1); ctx.closePath();
      ctx.fillStyle = '#1a0d31'; ctx.fill(); ctx.strokeStyle = RIM; ctx.lineWidth = 0.8; ctx.stroke();
      const hot = Math.min(1, pre * 0.7 + at);
      eGlow(ctx, 8, -1.5, 13 + at * 9, 0.42 + hot * 0.55);
      ell(ctx, 13.4, 0.2, 1.9, 3.5); ctx.fillStyle = '#0b0618'; ctx.fill(); ctx.strokeStyle = RIM; ctx.lineWidth = 0.9; ctx.stroke();
      if (hot > 0.02) { ctx.fillStyle = `rgba(255,214,246,${hot.toFixed(3)})`; ell(ctx, 13.4, 0.2, 1.2, 2.4); ctx.fill(); }
      const bl = eBlink(t + 1, 3.7);
      eEye(ctx, 0.5, -4, 1.8, 2.4 * bl, -0.3); eEye(ctx, 4.8, -4.6, 1.5, 2 * bl, -0.3);
      // idle ink dribble from the spout
      if (!at) { const p = (t * 0.7) % 1; ctx.fillStyle = `rgba(30,16,56,${(1 - p).toFixed(3)})`; circ(ctx, 13 - p * 2, 4 + p * 8, 1.3 * (1 - p * 0.4)); ctx.fill(); }
      ctx.restore();
    },

    // ---------------- 突進型「くずれ角」 ----------------
    charger(ctx, u) {
      const t = u.anim, at = u.atk || 0, dash = clamp01(u.dash || 0), w = ease(clamp01(u.wind || 0));
      const run = !!u.walk || dash > 0;
      const g = run ? t * (dash > 0 ? 17 : 7) : 0;
      const hit = at > 0 ? Math.sin(at * Math.PI) : 0;
      ctx.translate(w * Math.sin(t * 60) * 0.8, 0);
      // speed streaks behind while charging
      if (dash > 0) {
        ctx.strokeStyle = `rgba(196,139,240,${(0.42 * dash).toFixed(3)})`; ctx.lineWidth = 1.3; ctx.beginPath();
        for (let i = 0; i < 4; i++) { const yy = -42 + i * 9, x0 = -40 - ((t * 160 + i * 23) % 24); ctx.moveTo(x0, yy); ctx.lineTo(x0 - 18 - i * 3, yy); }
        ctx.stroke();
      }
      ctx.save();
      ctx.scale((1 + dash * 0.1) * (1 + hit * 0.04), (1 - dash * 0.07) * (1 - hit * 0.05));
      ctx.translate(0, w * 2);
      const amp = dash > 0 ? 9 : 5;
      function leg(x, ph, col, paw) {
        let fx = x + Math.sin(ph) * amp, fy = -Math.max(0, Math.cos(ph)) * (dash > 0 ? 5 : 2.5);
        if (paw > 0) { const s2 = 0.5 + 0.5 * Math.sin(t * 10); fx = x + 5 - s2 * 10 * paw; fy = -(1 - s2) * 4 * paw; }
        eLimb(ctx, x, -18, x + (fx - x) * 0.3 + 1.5, -9, fx, fy - 2, 6, col);
        ctx.beginPath(); ctx.moveTo(fx - 3.5, fy - 2.6); ctx.lineTo(fx + 4, fy - 2.6); ctx.lineTo(fx + 4.5, fy); ctx.lineTo(fx - 4, fy); ctx.closePath();
        ctx.fillStyle = '#0b0618'; ctx.fill();
      }
      leg(-23, g + 1.6, '#140a26', 0); leg(12, g + Math.PI + 1.6, '#140a26', 0);
      // pawing dust
      if (w > 0.05) {
        ctx.fillStyle = 'rgba(150,110,200,.35)';
        for (let i = 0; i < 3; i++) { const p = (t * 1.8 + i / 3) % 1; circ(ctx, 16 - p * 18, -1.5 - p * 4, (0.8 + p * 1.6) * w); ctx.fill(); }
      }
      // body (heavy, hump at the shoulders, crumbling hem)
      ctx.save(); ctx.translate(20, 0); ctx.rotate(dash * 0.05 + w * 0.06); ctx.translate(-20, 0);
      ctx.beginPath(); ctx.moveTo(-32, -16);
      ctx.bezierCurveTo(-38, -26, -31, -35, -18, -35);
      ctx.bezierCurveTo(-8, -44, 8, -48, 18, -40);
      ctx.bezierCurveTo(26, -34, 27, -24, 24, -16);
      eHem(ctx, 24, -32, -13, 8, t, 3.5, 4); ctx.closePath();
      eFill(ctx, lgc(ctx, 'charger-body', 0, -48, 0, -10, [[0, '#3c2668'], [0.5, '#170d30'], [1, '#07040f']]), 2.6);
      // cracks / crumbling plates
      ctx.strokeStyle = 'rgba(206,160,255,.42)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(-4, -43); ctx.lineTo(-1, -37); ctx.lineTo(-5, -31); ctx.moveTo(8, -44); ctx.lineTo(10, -39); ctx.moveTo(-22, -32); ctx.lineTo(-19, -27); ctx.lineTo(-22, -22); ctx.stroke();
      ctx.strokeStyle = 'rgba(160,110,230,.3)'; ctx.beginPath(); ctx.moveTo(-26, -20); ctx.quadraticCurveTo(-10, -26, 10, -22); ctx.stroke();
      // chunks flaking off the hump
      ctx.fillStyle = '#2a1648';
      for (let i = 0; i < 5; i++) {
        const p = (t * 0.45 + i / 5) % 1, sz = 2.6 * (1 - p);
        const x = -14 + i * 6 - p * (12 + dash * 18), y = -42 + Math.abs(i - 2) * 1.5 - p * 16;
        const pa = ctx.globalAlpha; ctx.globalAlpha = pa * (1 - p);
        ctx.beginPath(); ctx.moveTo(x, y - sz); ctx.lineTo(x + sz, y); ctx.lineTo(x + sz * 0.3, y + sz); ctx.lineTo(x - sz, y + sz * 0.2); ctx.closePath(); ctx.fill();
        ctx.globalAlpha = pa;
      }
      // head: lowers when winding, thrust forward on the dash, tosses up on impact
      ctx.save(); ctx.translate(20, -30); ctx.rotate(0.12 + w * 0.5 + dash * 0.32 - hit * 0.7);
      function horn(ox, oy, s, broken) {
        ctx.beginPath(); ctx.moveTo(ox, oy);
        ctx.bezierCurveTo(ox - 7 * s, oy - 12 * s, ox + 5 * s, oy - 22 * s, ox + (broken ? 12 : 19) * s, oy - (broken ? 21 : 19) * s);
        if (broken) { ctx.lineTo(ox + 10.5 * s, oy - 17.5 * s); ctx.lineTo(ox + 12.5 * s, oy - 16 * s); }
        ctx.bezierCurveTo(ox + 7 * s, oy - 15 * s, ox + 3 * s, oy - 8 * s, ox + 6 * s, oy + 1);
        ctx.closePath();
        ctx.fillStyle = lgc(ctx, 'charger-horn', 0, -24, 0, 0, [[0, '#cbbbe0'], [0.55, '#8a76aa'], [1, '#3e2c5c']]); ctx.fill();
        ctx.strokeStyle = EINK; ctx.lineWidth = 2; ctx.stroke();
      }
      horn(-2, -6, 0.82, true);
      ctx.beginPath(); ctx.moveTo(-5, -8); ctx.bezierCurveTo(4, -12, 14, -8, 17, -1); ctx.quadraticCurveTo(19, 5, 15, 9); ctx.lineTo(4, 9); ctx.quadraticCurveTo(-5, 6, -5, -8); ctx.closePath();
      eFill(ctx, lgc(ctx, 'charger-head', 0, -10, 0, 9, [[0, '#33205c'], [1, '#0e0820']]), 2.4);
      horn(3, -7, 1, false);
      ctx.strokeStyle = 'rgba(40,20,60,.8)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(4, -15); ctx.lineTo(7, -17); ctx.lineTo(6, -20); ctx.stroke();
      eGlow(ctx, 9.5, -1.5, 11, 0.5 + w * 0.4 + dash * 0.3);
      ctx.fillStyle = '#ffd8f6'; ctx.beginPath(); ctx.moveTo(6.5, -2.4); ctx.quadraticCurveTo(10, -4.4, 13, -1.6); ctx.quadraticCurveTo(10, -0.4, 6.5, -2.4); ctx.fill();
      // snort puffs while pawing
      if (w > 0.1) { ctx.fillStyle = 'rgba(180,140,230,.35)'; const p = (t * 2.2) % 1; circ(ctx, 18 + p * 6, 6 + p * 2, (1 + p * 3) * w); ctx.fill(); }
      ctx.restore();
      ctx.restore();
      leg(-16, g, '#24123f', 0); leg(18, g + Math.PI, '#24123f', w);
      ctx.restore();
    },

    // ---------------- 自爆型「はじける泡夢」 ----------------
    bomber(ctx, u) {
      const t = u.anim, at = u.atk || 0, fz = clamp01(u.fuse || 0);
      const pulse = 0.5 + 0.5 * Math.sin(t * (3 + fz * 24));
      const R = 15 * (1 + fz * 0.3 + fz * pulse * 0.07);
      const hop = u.walk ? Math.abs(Math.sin(t * 9)) * 2.4 : 0;
      const shiver = fz > 0.3 ? Math.sin(t * 70) * fz * 0.8 : 0;
      // little legs
      const st = u.walk ? Math.sin(t * 9) : 0;
      eLimb(ctx, -4, -9 - hop, -5 - st * 2, -4, -5 - st * 3, -0.5, 2.6, '#160a2a');
      eLimb(ctx, 4, -9 - hop, 5 + st * 2, -4, 5 + st * 3, -0.5, 2.6, '#24123f');
      ctx.save(); ctx.translate(shiver, -8 - R * 0.95 - hop);
      ctx.scale(1 + at * 0.1 + Math.sin(t * 5.5) * 0.03, 1 - at * 0.08 - Math.sin(t * 5.5) * 0.03);
      // wobbling bubble outline
      function blob() {
        ctx.beginPath();
        for (let i = 0; i <= 18; i++) {
          const a = i * TAU / 18, r = R * (1 + 0.035 * Math.sin(a * 3 + t * 6) + (a > 0.6 && a < 2.5 ? 0.05 * Math.sin(a * 7 + t * 4) : 0));
          if (i) ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); else ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
        }
        ctx.closePath();
      }
      eGlow(ctx, fz > 0 ? 0 : 6, fz > 0 ? 0 : -2, R * 0.9 + fz * 18, 0.4 + fz * (0.3 + 0.5 * pulse), fz > 0 ? '255,205,240' : '255,160,235');
      // drips hanging off the bottom
      ctx.fillStyle = '#0d0719';
      for (let i = 0; i < 3; i++) { const l = 2 + (Math.sin(t * 2 + i * 2.1) + 1) * 2.2; rr(ctx, -8 + i * 7 - 1, R * 0.8, 2.2, l, 1.1); ctx.fill(); circ(ctx, -8 + i * 7 + 0.1, R * 0.8 + l, 1.6); ctx.fill(); }
      blob();
      eFill(ctx, lgc(ctx, 'bomb-body', -10, -18, 8, 18, [[0, '#4a2e80'], [0.45, '#1c1038'], [1, '#07040f']]), 2.4);
      if (fz > 0) { blob(); ctx.fillStyle = `rgba(255,170,225,${(fz * (0.2 + 0.45 * pulse)).toFixed(3)})`; ctx.fill(); }
      // inner swirl of dream-liquid
      ctx.strokeStyle = 'rgba(170,110,240,.42)'; ctx.lineWidth = 1.1;
      ctx.beginPath(); ctx.arc(-1, 2, R * 0.55, t * 1.4, t * 1.4 + 2.2); ctx.moveTo(Math.cos(-t) * R * 0.32 - 2, 4 + Math.sin(-t) * R * 0.32); ctx.arc(-2, 4, R * 0.32, -t, -t + 2); ctx.stroke();
      ctx.fillStyle = 'rgba(200,160,255,.45)';
      for (let i = 0; i < 3; i++) { const p = (t * 0.5 + i / 3) % 1; circ(ctx, -7 + i * 5, R * 0.6 - p * R * 1.2, 1 + i * 0.3); ctx.fill(); }
      // glossy highlight
      ctx.strokeStyle = 'rgba(235,210,255,.6)'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.arc(0, 0, R * 0.78, Math.PI * 1.08, Math.PI * 1.42); ctx.stroke();
      ctx.fillStyle = 'rgba(240,225,255,.7)'; circ(ctx, -R * 0.3, -R * 0.68, 1.4); ctx.fill();
      // glowing seams as it is about to pop
      if (fz > 0.4) {
        const k = (fz - 0.4) / 0.6;
        ctx.strokeStyle = `rgba(255,228,248,${(k * (0.5 + 0.5 * pulse)).toFixed(3)})`; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(-R * 0.2, -R * 0.95); ctx.lineTo(-R * 0.05, -R * 0.6); ctx.lineTo(-R * 0.25, -R * 0.35);
        ctx.moveTo(-R * 0.85, R * 0.2); ctx.lineTo(-R * 0.55, R * 0.12); ctx.lineTo(-R * 0.45, R * 0.35);
        ctx.moveTo(R * 0.6, R * 0.65); ctx.lineTo(R * 0.4, R * 0.45); ctx.stroke();
      }
      // top knot
      ctx.beginPath(); ctx.moveTo(-2.5, -R + 1); ctx.quadraticCurveTo(-1, -R - 5, 2, -R - 5.5); ctx.quadraticCurveTo(4, -R - 3, 2.5, -R + 1); ctx.closePath();
      eFill(ctx, '#2c1a4e', 1.6);
      // eyes (go wide when the fuse is lit)
      const bl = fz > 0 ? 1 : eBlink(t + 0.5, 2.9), ew = 1 + fz * 0.35;
      eEye(ctx, 5, -2, 2.3 * ew, 3.2 * ew * bl); eEye(ctx, 11, -1.5, 2 * ew, 2.8 * ew * bl);
      if (fz > 0.15) { ctx.fillStyle = '#0b0618'; ell(ctx, 8.5, 4.5, 1.4 + fz, 1.6 + fz * 1.2); ctx.fill(); }
      else { ctx.strokeStyle = 'rgba(255,190,240,.55)'; ctx.lineWidth = 0.9; ctx.beginPath(); ctx.arc(8.4, 3.6, 1.6, 0.3, Math.PI - 0.3); ctx.stroke(); }
      ctx.restore();
    },

    // ---------------- 支援型「子守りの影」 ----------------
    mender(ctx, u) {
      const t = u.anim, at = u.atk || 0;
      const ln = at > 0 ? Math.sin((1 - at) * Math.PI) * 5 : 0;
      ctx.translate(-ln, 0);
      const f = ease(at);
      const hov = Math.sin(t * 2) * 1.5 + 3, sway = Math.sin(t * 1.6) * 1.4;
      ctx.translate(0, -hov);
      ctx.save(); ctx.translate(0, -2); ctx.rotate(u.walk ? 0.06 : 0); ctx.translate(0, 2);
      // trailing hem wisps
      ctx.strokeStyle = 'rgba(120,70,190,.5)'; ctx.lineWidth = 1.1; ctx.beginPath();
      for (let i = 0; i < 2; i++) { const y0 = -6 - i * 8, ww = Math.sin(t * 5 + i * 2) * 2.5; ctx.moveTo(-9, y0); ctx.quadraticCurveTo(-16, y0 + ww, -22 - i * 3, y0 - 1 + ww * 1.4); }
      ctx.stroke();
      // slender shroud with a deep hood
      ctx.beginPath(); ctx.moveTo(-10, -5);
      ctx.bezierCurveTo(-14 + sway, -24, -12, -44, -5, -52);
      ctx.bezierCurveTo(1, -60, 12, -59, 14, -49);
      ctx.bezierCurveTo(15.5, -43, 12, -39, 10, -36);
      ctx.bezierCurveTo(12, -26, 12 + sway * 0.3, -14, 11, -4);
      eHem(ctx, 11, -10, -1, 7, t, 4, 1); ctx.closePath();
      eFill(ctx, lgc(ctx, 'mender-body', 0, -58, 0, 0, [[0, '#3c2668'], [0.45, '#170d30'], [1, '#07040f']]), 2.5);
      ctx.strokeStyle = 'rgba(160,110,230,.35)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(-6, -42); ctx.quadraticCurveTo(-8 + sway, -24, -4, -8); ctx.moveTo(3, -30); ctx.quadraticCurveTo(1, -18, 4, -6); ctx.stroke();
      // hood opening + sleepy eyes
      ell(ctx, 9.2, -46, 4.3, 5.8, -0.15); ctx.fillStyle = '#05020c'; ctx.fill();
      ctx.strokeStyle = RIM; ctx.lineWidth = 0.9; ctx.beginPath(); ctx.ellipse(9.2, -46, 4.3, 5.8, -0.15, Math.PI * 1.15, Math.PI * 1.9); ctx.stroke();
      const lid = 0.7 + f * 0.5;
      eEye(ctx, 8, -46.5, 1.4, 1.1 * lid); eEye(ctx, 11.2, -46, 1.2, 1 * lid);
      // far sleeve
      eLimb(ctx, 3, -38, 10, -30, 14, -27, 4, '#1a0d31');
      // lantern (dim; flares soft violet when it heals)
      const lx = 17, ly = -18 - f * 3 + Math.sin(t * 2.6) * 0.8;
      eGlow(ctx, lx, ly, 15 + f * 22, 0.38 + f * 0.55, '200,150,255');
      if (f > 0.02) {
        ctx.strokeStyle = `rgba(220,185,255,${(at * 0.7).toFixed(3)})`; ctx.lineWidth = 1.2;
        ell(ctx, lx, ly, 7 + (1 - at) * 24, (7 + (1 - at) * 24) * 0.55); ctx.stroke();
      }
      ctx.strokeStyle = EINK; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(lx, ly - 9); ctx.lineTo(lx, ly - 6); ctx.stroke();
      ell(ctx, lx, ly, 4.6, 5.6); ctx.fillStyle = `rgba(150,105,215,${(0.55 + f * 0.35).toFixed(3)})`; ctx.fill(); ctx.strokeStyle = EINK; ctx.lineWidth = 1.6; ctx.stroke();
      ctx.strokeStyle = 'rgba(40,20,70,.6)'; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.moveTo(lx - 4.4, ly - 1.8); ctx.lineTo(lx + 4.4, ly - 1.8); ctx.moveTo(lx - 4.4, ly + 1.8); ctx.lineTo(lx + 4.4, ly + 1.8); ctx.stroke();
      ctx.fillStyle = `rgba(255,226,250,${(0.55 + f * 0.45).toFixed(3)})`; ell(ctx, lx, ly + 0.5, 1.5 + f * 0.8, 2.3 + f * 1.2 + Math.sin(t * 9) * 0.3); ctx.fill();
      ctx.fillStyle = '#1a0d31'; ctx.strokeStyle = EINK; ctx.lineWidth = 1.2;
      ctx.beginPath(); rr(ctx, lx - 3.4, ly - 6.8, 6.8, 2, 1); ctx.fill(); ctx.stroke();
      ctx.beginPath(); rr(ctx, lx - 3, ly + 5, 6, 1.8, 0.9); ctx.fill(); ctx.stroke();
      // near sleeve, hands cradling the lantern's ring
      eLimb(ctx, 6, -36, 18, -34, 16 + f, ly - 8, 4.4, '#24123f');
      ctx.strokeStyle = RIM; ctx.lineWidth = 0.9; ctx.beginPath(); ctx.moveTo(6, -38.6); ctx.quadraticCurveTo(18, -36.8, 18.4 + f, ly - 9.5); ctx.stroke();
      ctx.restore();
    },

    // ---------------- 妨害型「眠りを乱す鈴」 ----------------
    bell(ctx, u) {
      const t = u.anim, at = u.atk || 0;
      const ln = at > 0 ? Math.sin((1 - at) * Math.PI) * 5 : 0;
      ctx.translate(-ln, 0);
      const hs = Math.abs(Math.sin(t * 6));
      const hop = u.walk ? hs * 7 : Math.sin(t * 2.2) * 1.5 + 1.5;
      const land = u.walk ? Math.max(0, 1 - hs * 4) : 0;
      const sw = at > 0 ? Math.sin((1 - at) * Math.PI * 3) * at * 0.5 : Math.sin(t * 2.2) * 0.05;
      ctx.scale(1 + land * 0.08, 1 - land * 0.08);
      ctx.translate(0, -hop);
      // sound-wave arcs (front side only)
      if (at > 0.02) {
        ctx.lineWidth = 1.6; ctx.lineCap = 'round';
        for (let k = 0; k < 3; k++) {
          const r = 21 + k * 6 + (1 - at) * 9, a = at * (1 - k * 0.25);
          ctx.strokeStyle = `rgba(255,200,240,${a.toFixed(3)})`;
          ctx.beginPath(); ctx.arc(2, -40, r, -0.55, 0.55); ctx.stroke();
        }
        ctx.lineCap = 'butt';
      }
      ctx.save(); ctx.translate(0, -56); ctx.rotate(sw);
      // shadow body hanging inside (lags behind the swing)
      ctx.save(); ctx.rotate(-sw * 1.4);
      ctx.beginPath(); ctx.moveTo(-12, 26);
      ctx.bezierCurveTo(-13, 36, -9, 44, -6, 46);
      eHem(ctx, -6, 8, 48, 5, t, 3, 3);
      ctx.bezierCurveTo(11, 42, 13, 34, 12, 26); ctx.closePath();
      eFill(ctx, lgc(ctx, 'bell-shadow', 0, 24, 0, 50, [[0, '#170d30'], [1, '#07040f']]), 2.2);
      ctx.strokeStyle = 'rgba(120,70,190,.6)'; ctx.lineWidth = 1.2; ctx.lineCap = 'round';
      ctx.beginPath(); for (let i = 0; i < 3; i++) { const x = -4 + i * 4, ww = Math.sin(t * 8 + i * 1.7) * 2; ctx.moveTo(x, 47); ctx.quadraticCurveTo(x + ww, 51, x - ww * 0.5 - 1, 54 + (u.walk ? hs * 2 : 0)); } ctx.stroke();
      ctx.lineCap = 'butt';
      eGlow(ctx, 6, 33, 12, 0.5 + at * 0.4);
      const bl = eBlink(t + 2, 3.3);
      eEye(ctx, 3.6, 33, 1.9, 2.6 * bl, -0.2); eEye(ctx, 9, 33.4, 1.6, 2.3 * bl, -0.2);
      ctx.restore();
      // the cracked bell
      ctx.beginPath(); ctx.ellipse(0, -2.5, 3.5, 3.5, 0, 0, TAU); ctx.strokeStyle = EINK; ctx.lineWidth = 3.4; ctx.stroke(); ctx.strokeStyle = '#7c7092'; ctx.lineWidth = 1.6; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-8, 3);
      ctx.bezierCurveTo(-9, 0, -4, -0.5, 0, -0.5); ctx.bezierCurveTo(4, -0.5, 9, 0, 8, 3);
      ctx.bezierCurveTo(10, 12, 11, 20, 17, 27);
      ctx.quadraticCurveTo(0, 32, -17, 27);
      ctx.bezierCurveTo(-11, 20, -10, 12, -8, 3); ctx.closePath();
      ctx.fillStyle = lgc(ctx, 'bell-metal', -17, 0, 17, 0, [[0, '#2e2644'], [0.35, '#7a6e96'], [0.6, '#564c70'], [1, '#221c36']]); ctx.fill();
      ctx.strokeStyle = EINK; ctx.lineWidth = 2.4; ctx.stroke();
      ctx.strokeStyle = 'rgba(30,20,50,.55)'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(-9.5, 8); ctx.quadraticCurveTo(0, 10, 9.5, 8); ctx.moveTo(-13, 21); ctx.quadraticCurveTo(0, 24.5, 13, 21); ctx.stroke();
      ctx.strokeStyle = RIM; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(-6.5, 2); ctx.bezierCurveTo(-8, 10, -9.5, 19, -14, 25.5); ctx.stroke();
      ctx.fillStyle = '#0b0618'; ctx.beginPath(); ctx.ellipse(0, 27.6, 15.5, 2.6, 0, 0, Math.PI); ctx.fill();
      // crack leaking pink light
      ctx.strokeStyle = EINK; ctx.lineWidth = 2.2;
      ctx.beginPath(); ctx.moveTo(6, 29); ctx.lineTo(4, 22); ctx.lineTo(7, 16); ctx.lineTo(4.5, 9); ctx.stroke();
      ctx.strokeStyle = `rgba(255,190,240,${(0.6 + at * 0.4).toFixed(3)})`; ctx.lineWidth = 0.9; ctx.stroke();
      ctx.restore();
    },

    // ---------------- 飛行型「夜をすべる翼」 ----------------
    flyer(ctx, u) {
      const t = u.anim, at = u.atk || 0, dive = ease(at);
      const k = lerp(Math.sin(t * (u.walk ? 9 : 7)), 1.1, dive);
      if (dive > 0.1) {
        ctx.strokeStyle = `rgba(196,139,240,${(0.4 * dive).toFixed(3)})`; ctx.lineWidth = 1.2; ctx.beginPath();
        for (let i = 0; i < 3; i++) { const x0 = -10 - i * 6, y0 = -34 + i * 6; ctx.moveTo(x0, y0); ctx.lineTo(x0 - 14, y0 - 10); }
        ctx.stroke();
      }
      ctx.save(); ctx.translate(0, -20 + k * 1.6 * (1 - dive)); ctx.rotate(dive * 0.6);
      function wing(s, col) {
        const tx = s * (31 - dive * 13), ty = -2 - 16 * k;
        ctx.beginPath(); ctx.moveTo(s * 4, -4);
        ctx.quadraticCurveTo(s * 12, -8 - 12 * k, s * 18, -6 - 10 * k);
        ctx.lineTo(tx, ty);
        ctx.lineTo(s * (24 - dive * 9), ty * 0.55 + 4); ctx.lineTo(s * (21 - dive * 7), ty * 0.6 + 1.5);
        ctx.lineTo(s * (16 - dive * 5), ty * 0.35 + 6); ctx.lineTo(s * (13 - dive * 4), ty * 0.4 + 3);
        ctx.lineTo(s * 8, 6); ctx.lineTo(s * 3, 3); ctx.closePath();
        eFill(ctx, col, 2.2);
        ctx.strokeStyle = 'rgba(160,110,230,.45)'; ctx.lineWidth = 0.9; ctx.beginPath();
        ctx.moveTo(s * 18, -6 - 10 * k); ctx.lineTo(s * (24 - dive * 9), ty * 0.55 + 4);
        ctx.moveTo(s * 18, -6 - 10 * k); ctx.lineTo(s * (16 - dive * 5), ty * 0.35 + 6); ctx.stroke();
      }
      wing(-1, '#170d2e');
      wing(1, lgc(ctx, 'fly-wing', 0, -24, 0, 8, [[0, '#3a2464'], [1, '#120a24']]));
      // tail wisp streaming back
      const tw = Math.sin(t * 6) * 2;
      ctx.beginPath(); ctx.moveTo(-3, 6); ctx.quadraticCurveTo(-8, 11 + tw, -15, 10 + tw * 1.5); ctx.quadraticCurveTo(-8, 14 + tw * 0.5, 1, 8); ctx.closePath();
      ctx.fillStyle = '#1c0f36'; ctx.fill(); ctx.strokeStyle = RIM; ctx.lineWidth = 0.9; ctx.stroke();
      // body with ear nubs
      ctx.beginPath(); ctx.moveTo(-6, -5);
      ctx.lineTo(-6, -14); ctx.lineTo(-1.5, -8.5);
      ctx.quadraticCurveTo(2, -9.5, 5, -9); ctx.lineTo(9, -14.5); ctx.lineTo(9.5, -5);
      ctx.bezierCurveTo(11, 2, 6, 9, 1, 9); ctx.bezierCurveTo(-5, 9, -8, 2, -6, -5); ctx.closePath();
      eFill(ctx, lgc(ctx, 'fly-body', 0, -12, 0, 9, [[0, '#3c2668'], [0.55, '#170d30'], [1, '#07040f']]), 2.3);
      eGlow(ctx, 5.5, -2, 11, 0.5 + dive * 0.4);
      const bl = eBlink(t + 1.3, 3.4);
      eEye(ctx, 3, -2, 1.7, 2.2 * bl, -0.2); eEye(ctx, 7.8, -1.6, 1.5, 2 * bl, -0.2);
      ctx.fillStyle = '#f3dcff'; ctx.beginPath(); ctx.moveTo(4.5, 3.5); ctx.lineTo(5.3, 5.6 + dive); ctx.lineTo(6.1, 3.5); ctx.closePath(); ctx.fill();
      ctx.restore();
    },

    // ---------------- 召喚型「夢を縫う繭」 ----------------
    weaver(ctx, u) {
      const t = u.anim, at = u.atk || 0;
      const ln = at > 0 ? Math.sin((1 - at) * Math.PI) * 5 : 0;
      ctx.translate(-ln, 0);
      const split = at > 0 ? ease(Math.min(1, at * 1.6)) : 0;
      const step = u.walk ? t * 3.2 : 0;
      // spindly legs
      function leg(s, i, col) {
        const ph = step + i * 2.1 + (s > 0 ? Math.PI : 0), lift = u.walk ? Math.max(0, Math.sin(ph)) * 4 : 0;
        const hx = s * (6 + i * 3), hy = -24 + i * 2;
        const fx = s * (19 + i * 6) + (u.walk ? Math.cos(ph) * 3 : 0), fy = -lift;
        const kx = s * (15 + i * 5) + (fx - s * (19 + i * 6)) * 0.4, ky = -41 + i * 5 - lift;
        ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(kx, ky); ctx.lineTo(fx, fy);
        ctx.strokeStyle = EINK; ctx.lineWidth = 3.4; ctx.stroke(); ctx.strokeStyle = col; ctx.lineWidth = 1.6; ctx.stroke();
        ctx.lineCap = 'butt';
      }
      for (let i = 0; i < 3; i++) leg(-1, i, '#160a2a');
      ctx.save(); ctx.translate(0, -72); ctx.rotate(Math.sin(t * 1.3) * 0.04); ctx.translate(0, 72);
      // hanging thread
      ctx.strokeStyle = 'rgba(170,120,230,.6)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, -71); ctx.bezierCurveTo(2 + Math.sin(t * 2) * 2, -78, -3, -82, 1 + Math.sin(t * 1.7) * 3, -90); ctx.stroke();
      const sc = 1 + split * 0.06 + Math.sin(t * 1.8) * 0.01;
      ctx.translate(0, -44); ctx.scale(sc, sc); ctx.translate(0, 44);
      function shell() {
        ctx.beginPath(); ctx.moveTo(0, -72);
        ctx.bezierCurveTo(14, -70, 20, -54, 18, -40); ctx.bezierCurveTo(16, -26, 8, -18, 0, -18);
        ctx.bezierCurveTo(-8, -18, -16, -26, -18, -40); ctx.bezierCurveTo(-20, -54, -14, -70, 0, -72); ctx.closePath();
      }
      eGlow(ctx, 6, -44, 18 + split * 16, 0.38 + split * 0.5);
      shell();
      eFill(ctx, lgc(ctx, 'weaver-body', -18, -70, 16, -20, [[0, '#3c2668'], [0.5, '#1a0f34'], [1, '#07040f']]), 2.6);
      // woven wraps
      ctx.save(); shell(); ctx.clip();
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = 'rgba(5,2,12,.55)'; ctx.beginPath();
      for (let i = 0; i < 7; i++) { const y = -70 + i * 8; ctx.moveTo(-20, y); ctx.quadraticCurveTo(0, y + 9, 20, y + 3); }
      ctx.stroke();
      ctx.strokeStyle = 'rgba(150,100,220,.32)'; ctx.beginPath();
      for (let i = 0; i < 7; i++) { const y = -68 + i * 8; ctx.moveTo(-20, y + 4); ctx.quadraticCurveTo(0, y - 3, 20, y + 7); }
      ctx.stroke();
      ctx.restore();
      ctx.strokeStyle = RIM; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(-6, -69); ctx.bezierCurveTo(-15, -64, -19, -50, -17, -38); ctx.stroke();
      // loose fraying thread ends
      ctx.strokeStyle = 'rgba(140,90,210,.6)'; ctx.lineWidth = 1; ctx.beginPath();
      ctx.moveTo(-17, -48); ctx.quadraticCurveTo(-23, -47 + Math.sin(t * 3) * 2, -25, -42);
      ctx.moveTo(15, -28); ctx.quadraticCurveTo(21, -26, 22 + Math.sin(t * 2.6) * 2, -21);
      ctx.moveTo(-10, -21); ctx.quadraticCurveTo(-13, -15, -11 + Math.sin(t * 3.3), -11); ctx.stroke();
      // glowing seams (main one splits open when it births wisps)
      const op = 1.2 + split * 6;
      ctx.beginPath(); ctx.moveTo(7, -63); ctx.quadraticCurveTo(7 + op, -45, 6, -27); ctx.quadraticCurveTo(7 - op * 0.6, -45, 7, -63); ctx.closePath();
      ctx.fillStyle = split > 0 ? `rgba(255,214,246,${(0.35 + split * 0.6).toFixed(3)})` : '#0b0618'; ctx.fill();
      ctx.strokeStyle = 'rgba(255,170,235,.85)'; ctx.lineWidth = 1.2; ctx.stroke();
      ctx.strokeStyle = 'rgba(255,170,235,.6)'; ctx.lineWidth = 0.9; ctx.beginPath();
      ctx.moveTo(-9, -60); ctx.quadraticCurveTo(-12, -48, -8, -36);
      for (let i = 0; i < 4; i++) { const y = -58 + i * 9; ctx.moveTo(6 + op * 0.3 - 2.2, y); ctx.lineTo(6 + op * 0.3 + 2.2, y + 1.5); }
      ctx.stroke();
      // eyes in the seam
      const bl = eBlink(t + 0.7, 4.1);
      eEye(ctx, 7.6, -48, 1.6 + split * 0.4, 2.3 * bl); eEye(ctx, 7.2, -41, 1.3 + split * 0.3, 1.9 * bl);
      // newborn wisps fluttering out
      if (at > 0.02) {
        const p = 1 - at;
        for (let i = 0; i < 3; i++) {
          const wx = 9 + p * (18 + i * 6), wy = -50 + i * 7 - p * (14 - i * 8);
          const pa = ctx.globalAlpha; ctx.globalAlpha = pa * Math.min(1, at * 2);
          const f2 = 0.35 + 0.65 * Math.abs(Math.sin(t * 22 + i * 1.3));
          ctx.beginPath(); ctx.moveTo(wx, wy - 1); ctx.quadraticCurveTo(wx - 2, wy - 6 * f2, wx - 6, wy - 7 * f2); ctx.lineTo(wx - 5, wy - 2 * f2); ctx.closePath();
          ctx.fillStyle = '#3a2266'; ctx.fill(); ctx.strokeStyle = RIM; ctx.lineWidth = 0.6; ctx.stroke();
          ell(ctx, wx, wy, 3.2, 2.4); ctx.fillStyle = '#1a0d31'; ctx.fill(); ctx.strokeStyle = RIM; ctx.lineWidth = 0.7; ctx.stroke();
          ctx.fillStyle = '#ffd8f6'; circ(ctx, wx + 1.4, wy - 0.4, 0.8); ctx.fill();
          ctx.globalAlpha = pa;
        }
      }
      ctx.restore();
      for (let i = 0; i < 3; i++) leg(1, i, '#24123f');
    },

    boss(ctx, u) {
      // 捨てられた英雄 — a forgotten childhood hero, faded like an old crayon drawing / toy
      const t = u.anim, at = u.atk || 0, dash = u.dash || 0;
      const wind = clamp01(u.wind || 0), w = ease(wind);
      const charge = u.windKind === 'charge' && wind > 0;
      const slamW = charge ? 0 : w, chW = charge ? w : 0;
      const run = Math.max(chW * 0.6, dash);
      const walk = u.walk && !dash;
      const ph = t * 3.2, st = walk ? Math.sin(ph) : 0;
      const br = Math.sin(t * 1.6) * 2;
      const BINK = '#1f0e28';
      const lean = -slamW * 0.16 + (wind > 0 ? 0 : at * 0.42) + dash * 0.5 + chW * 0.36;
      const crouch = slamW * 9 + chW * 16 + (wind > 0 ? 0 : at * 12) + dash * 8;
      const shake = (slamW + chW) * Math.sin(t * 55) * 1.6;
      ctx.lineJoin = 'round';

      // ink puddle under the feet
      ctx.fillStyle = 'rgba(12,6,24,.85)'; ell(ctx, 4, -1, 58, 7); ctx.fill();
      for (let i = 0; i < 5; i++) { const px = -48 + i * 24 + Math.sin(i * 3) * 6, pr = 4 + ((Math.sin(t * 1.3 + i) + 1) * 2.5); ell(ctx, px, -1, pr * 1.6, pr * 0.4); ctx.fill(); }
      // aura
      ctx.globalCompositeOperation = 'lighter';
      sglow(ctx, 0, -110, 160, '150,60,200', 0.28 + w * 0.32 + dash * 0.2);
      ctx.globalCompositeOperation = 'source-over';
      // speed lines when dashing
      if (dash > 0 || chW > 0.3) {
        const sl = Math.max(dash, chW);
        ctx.strokeStyle = `rgba(220,170,255,${(0.45 * sl).toFixed(2)})`; ctx.lineWidth = 2;
        ctx.beginPath();
        for (let i = 0; i < 6; i++) { const yy = -30 - i * 30, x0 = -70 - ((t * 400 + i * 47) % 90); ctx.moveTo(x0, yy); ctx.lineTo(x0 - 50 - i * 6, yy); }
        ctx.stroke();
      }

      // ---- cape (behind), torn & streaming
      const hipY = -80 + crouch;
      ctx.save(); ctx.translate(shake, crouch); ctx.translate(0, -80); ctx.rotate(lean); ctx.translate(0, 80);
      const stream = Math.max(dash, chW * 0.7);
      const cw = (i) => Math.sin(t * 3 + i * 1.3) * 7;
      const bx = (x, yy, i) => [lerp(x, -95 - i * 10, stream) + cw(i) * (1 - stream * 0.6), lerp(yy, -150 + i * 16 + cw(i + 2) * 0.6, stream)];
      const pts = [bx(-96, -26, 0), bx(-82, -44, 1), bx(-74, -12, 2), bx(-58, -36, 3), bx(-46, -6, 4), bx(-32, -30, 5)];
      const capePath = () => {
        ctx.beginPath(); ctx.moveTo(-26, -170 + br);
        ctx.quadraticCurveTo(lerp(-80, -120, stream) + cw(0) * 0.5, lerp(-120, -175, stream), pts[0][0], pts[0][1]);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
        ctx.lineTo(-20, -96); ctx.lineTo(22, -160 + br); ctx.closePath();
      };
      capePath();
      ctx.fillStyle = lgc(ctx, 'boss-cape', 0, -170, 0, -10, [[0, '#7b3448'], [1, '#4a1f36']]);
      ctx.fill();
      ctx.save(); ctx.clip();
      ctx.strokeStyle = 'rgba(240,170,170,.13)'; ctx.lineWidth = 2.5;
      ctx.beginPath(); for (let i = -160; i < 40; i += 8) { ctx.moveTo(i, -190); ctx.lineTo(i - 60, 0); } ctx.stroke();
      // stitched patch (toy-like)
      ctx.strokeStyle = 'rgba(230,200,170,.45)'; ctx.lineWidth = 1.2; ctx.setLineDash([3, 3]);
      ctx.strokeRect(-62, -118, 16, 14); ctx.setLineDash([]);
      ctx.restore();
      capePath();
      ctx.strokeStyle = BINK; ctx.lineWidth = 3; ctx.stroke();
      ctx.strokeStyle = 'rgba(206,160,255,.5)'; ctx.lineWidth = 1.2; ctx.stroke();
      ctx.restore();

      // ---- legs (IK-lite with knee bend)
      function legDraw(hx, fx, lift, col, boot) {
        const hy = hipY, fy = -6 - lift;
        const dx = fx - hx, dy = fy - hy, d = Math.hypot(dx, dy), L = 84;
        const off = Math.sqrt(Math.max(0, (L / 2) * (L / 2) - (d / 2) * (d / 2)));
        let px = -dy / d, py = dx / d;            // perpendicular; make it point forward (+x)
        if (px < 0) { px = -px; py = -py; }
        const kneeX = (hx + fx) / 2 + px * off, ky = (hy + fy) / 2 + py * off;
        bone(ctx, hx, hy, kneeX, ky, 19, col, BINK, 3.4);
        bone(ctx, kneeX, ky, fx, fy - 4, 18, col, BINK, 3.4);
        // boot
        ctx.beginPath(); ctx.moveTo(fx - 12, fy - 22); ctx.lineTo(fx + 9, fy - 22); ctx.lineTo(fx + 11, fy - 6); ctx.quadraticCurveTo(fx + 22, fy - 4, fx + 22, fy + 3); ctx.lineTo(fx - 13, fy + 3); ctx.closePath();
        fo(ctx, boot, 3, BINK);
        ctx.strokeStyle = 'rgba(255,240,210,.35)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(fx - 10, fy - 19); ctx.lineTo(fx + 7, fy - 19); ctx.stroke();
      }
      let ffx = 18 + st * 15, bfx = -14 - st * 15, fl = walk ? Math.max(0, Math.cos(ph)) * 7 : 0, bl = walk ? Math.max(0, -Math.cos(ph)) * 7 : 0;
      if (run > 0) { const rs = Math.sin(t * 12); ffx = lerp(ffx, 34 + rs * 10, run); bfx = lerp(bfx, -38 - rs * 6, run); fl = lerp(fl, Math.max(0, rs) * 10, run); bl = lerp(bl, Math.max(0, -rs) * 8, run); }
      if (slamW > 0) { ffx = lerp(ffx, 24, slamW); bfx = lerp(bfx, -22, slamW); fl *= 1 - slamW; bl *= 1 - slamW; }
      legDraw(-12 + shake, bfx, bl, '#5a3a58', '#b7a58e');
      legDraw(14 + shake, ffx, fl, '#6c4666', '#d4c4aa');

      // ---- upper body (leans around the hips)
      ctx.save(); ctx.translate(shake, crouch); ctx.translate(0, -80); ctx.rotate(lean); ctx.translate(0, 80);
      // arm pose angles (0 = forward, π/2 = down)
      const swing = walk ? st * 0.28 : 0;
      let fa1 = 1.42 - swing, fa2 = 1.2 - swing, ba1 = 1.72 + swing, ba2 = 1.58 + swing;
      function toward(a, b, k) { return lerp(a, b, k); }
      if (slamW > 0) { fa1 = toward(fa1, -1.95, slamW); fa2 = toward(fa2, -2.45, slamW); ba1 = toward(ba1, -1.75, slamW); ba2 = toward(ba2, -2.3, slamW); }
      if (at > 0 && wind <= 0) { const k = ease(at); fa1 = toward(fa1, 0.95, k); fa2 = toward(fa2, 1.3, k); ba1 = toward(ba1, 1.08, k); ba2 = toward(ba2, 1.4, k); }
      const cg = Math.max(chW, dash);
      if (cg > 0) { fa1 = toward(fa1, 0.65, cg); fa2 = toward(fa2, -0.55, cg); ba1 = toward(ba1, 2.5, cg); ba2 = toward(ba2, 2.05, cg); }
      function arm(sx, sy, a1, a2, col, glove, glowA) {
        const ex = sx + Math.cos(a1) * 44, ey = sy + Math.sin(a1) * 44;
        const hx = ex + Math.cos(a2) * 40, hy = ey + Math.sin(a2) * 40;
        bone(ctx, sx, sy, ex, ey, 19, col, BINK, 3.4);
        bone(ctx, ex, ey, hx - Math.cos(a2) * 8, hy - Math.sin(a2) * 8, 17, col, BINK, 3.4);
        bone(ctx, ex + Math.cos(a2) * 22, ey + Math.sin(a2) * 22, hx - Math.cos(a2) * 6, hy - Math.sin(a2) * 6, 20, glove, BINK, 3.2);
        if (glowA > 0) { ctx.globalCompositeOperation = 'lighter'; sglow(ctx, hx, hy, 34, '255,120,200', glowA); ctx.globalCompositeOperation = 'source-over'; }
        circ(ctx, hx, hy, 13.5); fo(ctx, glove, 3, BINK);
        ctx.strokeStyle = 'rgba(80,50,50,.55)'; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.arc(hx, hy, 8, a2 - 0.9, a2 + 0.9); ctx.stroke();
      }
      arm(-30, -160 + br, ba1, ba2, '#7c4650', '#c2b29a', slamW * 0.6);
      // torso (faded suit)
      const torsoPath = () => {
        ctx.beginPath();
        ctx.moveTo(-38, -166 + br);
        ctx.quadraticCurveTo(0, -182 + br, 40, -166 + br);
        ctx.bezierCurveTo(46, -140, 32, -110, 25, -84);
        ctx.lineTo(-24, -84);
        ctx.bezierCurveTo(-31, -112, -44, -140, -38, -166 + br);
        ctx.closePath();
      };
      torsoPath();
      ctx.fillStyle = lgc(ctx, 'boss-suit', 0, -180, 0, -84, [[0, '#a85a60'], [1, '#6e3a52']]); ctx.fill();
      ctx.save(); ctx.clip();
      ctx.strokeStyle = 'rgba(255,215,195,.13)'; ctx.lineWidth = 2.6;
      ctx.beginPath(); for (let i = -70; i < 90; i += 7) { ctx.moveTo(i, -186); ctx.lineTo(i - 42, -80); } ctx.stroke();
      ctx.strokeStyle = 'rgba(40,10,30,.12)'; ctx.lineWidth = 2;
      ctx.beginPath(); for (let i = -70; i < 90; i += 11) { ctx.moveTo(i, -186); ctx.lineTo(i + 30, -80); } ctx.stroke();
      ctx.fillStyle = 'rgba(40,10,40,.22)'; ctx.fillRect(-60, -190, 40, 120);
      ctx.restore();
      torsoPath();
      ctx.strokeStyle = BINK; ctx.lineWidth = 3.4; ctx.stroke();
      // crayon double-line wobble
      ctx.strokeStyle = 'rgba(255,220,200,.22)'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(-35, -163 + br); ctx.quadraticCurveTo(0, -177 + br, 37, -163 + br); ctx.stroke();
      // trunks + belt
      ctx.beginPath(); rr(ctx, -25, -90, 51, 16, [3, 3, 8, 8]); fo(ctx, '#4e2e50', 3, BINK);
      ctx.beginPath(); rr(ctx, -27, -96, 55, 10, 3); fo(ctx, '#bfa055', 3, BINK);
      ctx.beginPath(); rr(ctx, -2, -98, 14, 14, 3); fo(ctx, '#dcc070', 2.4, BINK);
      ctx.strokeStyle = BINK; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(3, -98); ctx.lineTo(6, -91); ctx.lineTo(4, -84); ctx.stroke();
      // cracked heraldic shield badge (heater shape, plain diagonal band — deliberately non-radial)
      ctx.save(); ctx.translate(2, -136 + br);
      const shieldPath = (k) => {
        ctx.beginPath();
        ctx.moveTo(-21 * k, -22 * k);
        ctx.quadraticCurveTo(0, -18 * k, 21 * k, -22 * k);
        ctx.lineTo(21 * k, -2 * k);
        ctx.quadraticCurveTo(20 * k, 16 * k, 0, 27 * k);
        ctx.quadraticCurveTo(-20 * k, 16 * k, -21 * k, -2 * k);
        ctx.closePath();
      };
      shieldPath(1);
      ctx.fillStyle = '#dcc070'; ctx.fill();
      ctx.save(); ctx.clip();
      // bold diagonal band in faded cape-red
      ctx.fillStyle = '#9a4a56';
      ctx.beginPath(); ctx.moveTo(-30, -16); ctx.lineTo(-18, -28); ctx.lineTo(30, 18); ctx.lineTo(18, 30); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(40,14,30,.55)'; ctx.lineWidth = 1.4; ctx.stroke();
      // faded highlight on the upper-left field
      ctx.fillStyle = 'rgba(255,250,210,.4)';
      ctx.beginPath(); ctx.moveTo(-17, -18); ctx.lineTo(-8, -18.6); ctx.lineTo(-17, -9); ctx.closePath(); ctx.fill();
      // crayon scuffs (faded)
      ctx.strokeStyle = 'rgba(255,240,200,.22)'; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(8, -16); ctx.lineTo(16, -10); ctx.moveTo(-14, 6); ctx.lineTo(-6, 14); ctx.stroke();
      ctx.restore();
      // inner border + outline
      shieldPath(0.78); ctx.strokeStyle = 'rgba(120,80,30,.6)'; ctx.lineWidth = 1.3; ctx.stroke();
      shieldPath(1); ctx.strokeStyle = BINK; ctx.lineWidth = 2.6; ctx.stroke();
      // missing chunk (top-right corner broken off) + crack with ink seeping out
      ctx.fillStyle = '#2a1430'; ctx.beginPath(); ctx.moveTo(11, -20.6); ctx.lineTo(21, -22); ctx.lineTo(21, -12); ctx.lineTo(15, -14); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = BINK; ctx.lineWidth = 1.6; ctx.stroke();
      ctx.strokeStyle = '#140a20'; ctx.lineWidth = 3; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(-6, -19.5); ctx.lineTo(1, -7); ctx.lineTo(-4, 3); ctx.lineTo(5, 13); ctx.lineTo(3, 22); ctx.stroke();
      ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(-4, 3); ctx.lineTo(-12, 8); ctx.stroke();
      ctx.lineCap = 'butt';
      const dl = 14 + (Math.sin(t * 1.1) + 1) * 8;
      ctx.fillStyle = '#140a20'; rr(ctx, 1.4, 21, 4, dl, 2); ctx.fill(); circ(ctx, 3.4, 21 + dl, 3.2); ctx.fill();
      ctx.restore();
      // ink drips from the belt
      ctx.fillStyle = '#140a24';
      for (let i = 0; i < 5; i++) { const x = -20 + i * 11, l = 6 + ((Math.sin(t * 1.2 + i * 2) + 1) * 8); rr(ctx, x, -76, 3.4, l, 1.7); ctx.fill(); circ(ctx, x + 1.7, -76 + l, 2.6); ctx.fill(); }
      // head
      const hx = 6, hy = -194 + br;
      ctx.beginPath(); rr(ctx, hx - 9, hy + 14, 18, 12, 4); fo(ctx, '#d9c8ba', 3, BINK);
      ctx.beginPath();
      ctx.moveTo(hx - 19, hy - 2); ctx.quadraticCurveTo(hx - 20, hy - 25, hx + 2, hy - 25); ctx.quadraticCurveTo(hx + 22, hy - 25, hx + 22, hy - 4);
      ctx.lineTo(hx + 21, hy + 10); ctx.quadraticCurveTo(hx + 19, hy + 22, hx + 6, hy + 22); ctx.quadraticCurveTo(hx - 10, hy + 22, hx - 16, hy + 12); ctx.closePath();
      fo(ctx, '#e3d3c4', 3, BINK);
      // crayon hair with a big swoop
      ctx.beginPath(); ctx.moveTo(hx - 21, hy + 2); ctx.quadraticCurveTo(hx - 24, hy - 26, hx + 2, hy - 28); ctx.quadraticCurveTo(hx + 26, hy - 28, hx + 23, hy - 8);
      ctx.quadraticCurveTo(hx + 18, hy - 18, hx + 8, hy - 16); ctx.quadraticCurveTo(hx + 14, hy - 10, hx + 10, hy - 6); ctx.quadraticCurveTo(hx + 4, hy - 14, hx - 8, hy - 13); ctx.quadraticCurveTo(hx - 13, hy - 8, hx - 14, hy + 4); ctx.closePath();
      fo(ctx, '#3c2440', 3, BINK);
      ctx.strokeStyle = 'rgba(200,170,220,.3)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(hx - 12, hy - 22); ctx.quadraticCurveTo(hx, hy - 27, hx + 12, hy - 22); ctx.moveTo(hx - 16, hy - 12); ctx.quadraticCurveTo(hx - 12, hy - 20, hx - 2, hy - 22); ctx.stroke();
      // domino mask with glowing eyes
      ctx.beginPath(); ctx.moveTo(hx - 18, hy - 1); ctx.quadraticCurveTo(hx - 12, hy - 9, hx + 2, hy - 7); ctx.quadraticCurveTo(hx + 6, hy - 4, hx + 10, hy - 7); ctx.quadraticCurveTo(hx + 22, hy - 9, hx + 26, hy - 3); ctx.quadraticCurveTo(hx + 22, hy + 6, hx + 11, hy + 4); ctx.quadraticCurveTo(hx + 6, hy + 2, hx + 1, hy + 4); ctx.quadraticCurveTo(hx - 12, hy + 7, hx - 18, hy - 1); ctx.closePath();
      fo(ctx, '#2b1838', 2.4, BINK);
      ctx.globalCompositeOperation = 'lighter';
      sglow(ctx, hx + 9, hy - 1, 30 + w * 14, '255,160,235', 0.5 + w * 0.45 + dash * 0.3);
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = '#ffd8f4'; ell(ctx, hx - 4, hy - 1, 4.4, 2.6 - w * 0.8, -0.1); ctx.fill(); ell(ctx, hx + 17, hy - 1, 4.4, 2.6 - w * 0.8, 0.1); ctx.fill();
      // ink tear from under the mask
      const tl = 6 + (Math.sin(t * 0.9 + 1) + 1) * 4;
      ctx.fillStyle = '#1a0c28'; rr(ctx, hx - 5, hy + 4, 2.6, tl, 1.3); ctx.fill(); circ(ctx, hx - 3.7, hy + 4 + tl, 2); ctx.fill();
      // flat, faded smile
      ctx.strokeStyle = BINK; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(hx + 4, hy + 13); ctx.quadraticCurveTo(hx + 11, hy + 14 - (1 - w) * 1.5, hx + 17, hy + 12); ctx.stroke();
      // crack across the face (forgotten)
      ctx.strokeStyle = 'rgba(30,10,30,.85)'; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(hx - 12, hy - 22); ctx.lineTo(hx - 8, hy - 14); ctx.moveTo(hx - 12, hy + 8); ctx.lineTo(hx - 6, hy + 12); ctx.lineTo(hx - 9, hy + 18); ctx.stroke();
      // front arm (on top)
      arm(32, -158 + br, fa1, fa2, '#8e5058', '#d8c8b0', slamW * 0.8);
      ctx.restore();
      // ink motes rising
      ctx.fillStyle = 'rgba(200,140,255,.7)';
      for (let i = 0; i < 6; i++) { const p = (t * 0.35 + i / 6) % 1, mx = -40 + i * 18 + Math.sin(t + i) * 8; ctx.globalAlpha *= 1; ctx.fillRect(mx, -20 - p * 200, 2.4, 2.4); }
    },
    // ---------------- 溶けない雪だるま (boss) ----------------
    // A child's first snowman ("please never melt"), forgotten. Dusky lavender snow slowly melting into ink;
    // melt = 1 - hp/maxHp makes it saggier and drippier. Cold mist = ROUND motes only (no flakes/crystals).
    snowman(ctx, u) {
      const t = u.anim || 0, at = u.atk || 0;
      const wind = clamp01(u.wind || 0), w = ease(wind);
      const bumpW = u.windKind === 'bump' ? w : 0, throwW = u.windKind === 'throw' ? w : 0;
      const rel = wind > 0 ? 0 : ease(clamp01(at));
      const p2 = (u.phase || 1) >= 2 ? 1 : 0;
      const melt = u.maxHp > 0 ? clamp01(1 - (u.hp || 0) / u.maxHp) : 0;
      const hop = u.walk ? Math.abs(Math.sin(t * 3.2)) : 0;
      const sag = 0.3 + melt * 0.85;
      const hsh = (n) => { const s = Math.sin(n * 127.1 + 31.7) * 43758.5453; return s - Math.floor(s); };
      const SN = p2 ? ['#aebcd6', '#7586ac', '#3e4878'] : ['#a39cb8', '#746d92', '#433c64'];
      const OUTW = p2 ? 4.2 : 3;
      const RIMC = p2 ? 'rgba(210,236,255,.95)' : RIM;
      const BINK = '#160c26';

      // ink puddle (melt water turned to ink); frost ring in phase 2
      ctx.fillStyle = 'rgba(12,6,24,.85)'; ell(ctx, 2, -1, 76 + melt * 18, 8 + melt * 2.5); ctx.fill();
      for (let i = 0; i < 5; i++) { const px = -64 + i * 32 + Math.sin(i * 2.3) * 6, pr = 4 + (Math.sin(t * 1.1 + i) + 1) * 2 + melt * 3; ell(ctx, px, -1, pr * 1.7, pr * 0.42); ctx.fill(); }
      if (p2) { ctx.strokeStyle = 'rgba(190,222,255,.32)'; ctx.lineWidth = 2; ell(ctx, 2, -1, 100, 12); ctx.stroke(); ctx.strokeStyle = 'rgba(190,222,255,.16)'; ell(ctx, 2, -1, 114, 15); ctx.stroke(); }
      // cold glow behind
      ctx.globalCompositeOperation = 'lighter';
      sglow(ctx, 0, -112, 128, '120,140,235', 0.2 + p2 * 0.16 + w * 0.1);
      ctx.globalCompositeOperation = 'source-over';
      // cold mist — round soft motes rising
      const mist = (front) => {
        const n = 10 + p2 * 8;
        for (let i = 0; i < n; i++) {
          if ((i % 2 === 0) !== front) continue;
          const ph = (t * (0.05 + hsh(i) * 0.06) + hsh(i + 7)) % 1;
          const mx = -108 + hsh(i + 3) * 216 + Math.sin(t * 0.7 + i) * 10;
          const my = -10 - ph * (140 + hsh(i + 5) * 90);
          const r = 7 + hsh(i + 9) * 12 + ph * 6;
          const a = Math.sin(ph * Math.PI) * (0.28 + p2 * 0.2 + w * 0.1);
          sglow(ctx, mx, my, r * 1.6, '198,210,255', a);
        }
      };
      mist(false);

      // wobbly melting ball outline (lower edge sags out and down into lobes)
      const ballPath = (cx, cy, r, sg, seed) => {
        const N = 26, P = [];
        for (let i = 0; i < N; i++) {
          const a = (i / N) * TAU, s = Math.sin(a), c = Math.cos(a), low = Math.max(0, s);
          const rx = r * (1 + sg * 0.26 * low * low), ry = r * (1 - sg * 0.14 * low);
          const wob = 1 + (hsh(seed + i) - 0.5) * 0.035;
          const lobe = low > 0.5 ? Math.max(0, Math.sin(i * 2.7 + seed)) * sg * 0.07 * r : 0;
          P.push([cx + c * rx * wob, cy + s * ry * wob + lobe]);
        }
        ctx.beginPath();
        ctx.moveTo((P[N - 1][0] + P[0][0]) / 2, (P[N - 1][1] + P[0][1]) / 2);
        for (let i = 0; i < N; i++) { const p = P[i], q = P[(i + 1) % N]; ctx.quadraticCurveTo(p[0], p[1], (p[0] + q[0]) / 2, (p[1] + q[1]) / 2); }
        ctx.closePath();
      };
      const snowBall = (cx, cy, r, sg, seed, key, gy) => {
        ballPath(cx, cy, r, sg, seed);
        ctx.fillStyle = lgc(ctx, key + (p2 ? '-ice' : ''), 0, gy - r, 0, gy + r, [[0, SN[0]], [0.55, SN[1]], [1, SN[2]]]);
        ctx.fill();
        ctx.save(); ctx.clip();
        sglow(ctx, cx + r * 0.28, cy - r * 0.38, r * 0.95, p2 ? '236,246,255' : '226,220,255', 0.26);
        sglow(ctx, cx - r * 0.75, cy + r * 0.55, r * 1.1, '18,8,40', 0.55);
        // ink stains seeping through the snow
        ctx.fillStyle = 'rgba(30,12,50,.42)';
        for (let k = 0; k < 3; k++) {
          const sx = cx + (hsh(seed * 3 + k) - 0.5) * r * 1.3, sy = cy + (hsh(seed * 5 + k) - 0.4) * r * 1.1, sr = r * (0.08 + hsh(seed + k * 9) * 0.1);
          ell(ctx, sx, sy, sr * 1.4, sr * 0.8, hsh(k + seed) * 3); ctx.fill();
          ell(ctx, sx + sr * 0.9, sy - sr * 0.5, sr * 0.6, sr * 0.45, 0.6); ctx.fill();
          ell(ctx, sx - sr * 1.2, sy + sr * 0.4, sr * 0.45, sr * 0.35); ctx.fill();
          const dl = sr * 1.2 + (Math.sin(t * 0.9 + k + seed) + 1) * sr * 0.5 + melt * r * 0.16;
          rr(ctx, sx + sr * 0.5 - 1, sy, 2, dl, 1); ctx.fill();
        }
        // packed-snow speckle
        ctx.fillStyle = 'rgba(255,255,255,.16)';
        for (let k = 0; k < 7; k++) { circ(ctx, cx + (hsh(seed + k * 4.1) - 0.5) * r * 1.5, cy + (hsh(seed + k * 6.3) - 0.5) * r * 1.5, 1.4); ctx.fill(); }
        if (p2) { // glassy ice glaze
          ctx.strokeStyle = 'rgba(232,246,255,.62)'; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(cx, cy, r * 0.8, -1.25, -0.35); ctx.stroke();
          ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(cx, cy, r * 0.66, -1.05, -0.6); ctx.stroke();
        }
        ctx.restore();
        ballPath(cx, cy, r, sg, seed);
        ctx.strokeStyle = EINK; ctx.lineWidth = OUTW; ctx.stroke();
        ctx.strokeStyle = RIMC; ctx.lineWidth = OUTW * 0.42; ctx.stroke();
      };
      // ink/melt drips hanging from a ball's lower edge
      const drips = (cx, by, half, n, seed) => {
        ctx.fillStyle = '#150a26';
        for (let i = 0; i < n; i++) {
          const x = cx + (hsh(seed + i * 1.7) - 0.5) * half * 2, l = 4 + (Math.sin(t * (1 + hsh(i + seed)) + i * 2) + 1) * 5 + melt * 9;
          const yy = by - 5 - Math.abs(x - cx) / half * 9;
          rr(ctx, x - 1.4, yy, 2.8, l, 1.4); ctx.fill(); circ(ctx, x, yy + l, 2.3); ctx.fill();
        }
      };
      const icicles = (cx, by, half, n, seed) => {
        if (!p2) return;
        for (let i = 0; i < n; i++) {
          const x = cx + (hsh(seed + i * 2.3) - 0.5) * half * 2, yy = by - 3 - Math.abs(x - cx) / half * 9, l = 7 + hsh(seed + i) * 9;
          ctx.beginPath(); ctx.moveTo(x - 3, yy); ctx.lineTo(x + 3, yy); ctx.lineTo(x + 0.4, yy + l); ctx.closePath();
          ctx.fillStyle = 'rgba(214,236,255,.85)'; ctx.fill(); ctx.strokeStyle = 'rgba(40,50,110,.7)'; ctx.lineWidth = 1; ctx.stroke();
        }
      };
      // twig arm (angle a: 0 = forward, -π/2 = up)
      const twig = (sx, sy, a, len, front) => {
        const col = front ? '#76594a' : '#57412f';
        const ex = sx + Math.cos(a) * len, ey = sy + Math.sin(a) * len;
        const mx = sx + Math.cos(a) * len * 0.55, my = sy + Math.sin(a) * len * 0.55;
        eLimb(ctx, sx, sy, mx + Math.sin(a) * 5, my - Math.cos(a) * 5, ex, ey, 5.5, col);
        const b1 = a - 0.75;
        eLimb(ctx, mx, my, mx + Math.cos(b1) * 9, my + Math.sin(b1) * 9 - 2, mx + Math.cos(b1) * 19, my + Math.sin(b1) * 19, 3.2, col);
        for (const off of [-0.6, 0.5]) { const fa = a + off; eLimb(ctx, ex, ey, ex + Math.cos(fa) * 6, ey + Math.sin(fa) * 6, ex + Math.cos(fa) * 12, ey + Math.sin(fa) * 12, 2.6, col); }
        if (p2) { ctx.fillStyle = 'rgba(214,236,255,.85)'; ctx.beginPath(); ctx.moveTo(mx - 3, my + 2); ctx.lineTo(mx + 3, my + 2); ctx.lineTo(mx, my + 10); ctx.closePath(); ctx.fill(); }
        return [ex, ey];
      };

      ctx.save();
      // body motion: shifts + squash only (never a forward lean)
      const shiftX = -bumpW * 12 + rel * 5;
      const sy = (1 - melt * 0.05) * (1 + bumpW * 0.05 + Math.sin(t * 1.5) * 0.006) * (u.walk ? 1 - (1 - hop) * 0.035 : 1);
      ctx.translate(shiftX, -hop * 6);
      ctx.scale(1 / Math.sqrt(sy), sy);
      const r1 = 62, r2 = 44, r3 = 29;
      const sag1 = sag, sag2 = sag * 0.55, sag3 = sag * 0.35;
      const c1x = -bumpW * 7 + rel * 13, c1y = -(r1 * (1 - 0.14 * sag1)) + 3;
      const c2x = 2 - bumpW * 3 + rel * 6, c2y = c1y - r1 * 0.78 - r2 * 0.82 + 6;
      const c3x = 6 - bumpW * 1 + rel * 3, c3y = c2y - r2 * 0.8 - r3 * 0.78 + 3;
      // belly-bump puff of snow in front
      if (rel > 0.05) {
        for (let i = 0; i < 5; i++) { const pr = 6 + i * 2 + (1 - rel) * 10; ctx.fillStyle = `rgba(200,206,240,${(0.42 * rel).toFixed(3)})`; circ(ctx, c1x + r1 + 6 + (1 - rel) * (14 + i * 6), c1y + 14 - i * 10 + Math.sin(i * 2) * 4, pr); ctx.fill(); }
      }
      // bottom ball
      snowBall(c1x, c1y, r1 * (1 + rel * 0.06), sag1, 11, 'snowman-b1', -56);
      // back twig arm
      let ba = Math.PI + 0.55 + Math.sin(t * 1.3) * 0.05;
      ba = lerp(ba, Math.PI + 1.15, bumpW); ba = lerp(ba, -2.05, throwW); ba = lerp(ba, Math.PI + 0.15, rel);
      const bhand = twig(c2x - r2 * 0.8, c2y - 4, ba, 60 + throwW * 8, false);
      if (throwW > 0.02) {
        const sbx = bhand[0] + Math.cos(ba) * 9, sby = bhand[1] + Math.sin(ba) * 9;
        ctx.globalCompositeOperation = 'lighter'; sglow(ctx, sbx, sby, 30, '170,190,255', 0.55 * throwW); ctx.globalCompositeOperation = 'source-over';
        circ(ctx, sbx, sby, 13 * Math.min(1, throwW * 1.5)); ctx.fillStyle = SN[0]; ctx.fill(); ctx.strokeStyle = EINK; ctx.lineWidth = 2.6; ctx.stroke(); ctx.strokeStyle = RIMC; ctx.lineWidth = 1; ctx.stroke();
        ctx.fillStyle = 'rgba(30,12,50,.45)'; circ(ctx, sbx - 3, sby + 3, 3); ctx.fill(); circ(ctx, sbx + 4, sby - 2, 1.8); ctx.fill();
      }
      // bucket handle peeking from behind the head
      ctx.strokeStyle = BINK; ctx.lineWidth = 3.4;
      ctx.beginPath(); ctx.ellipse(c3x - 2, c3y - 24, 28, 22, 0, 0.05, Math.PI - 0.05); ctx.stroke();
      ctx.strokeStyle = '#8c8a9c'; ctx.lineWidth = 1.6; ctx.stroke();
      // middle ball + drips onto the bottom ball
      snowBall(c2x, c2y, r2, sag2, 23, 'snowman-b2', -146);
      drips(c2x, c2y + r2 * (1 - 0.14 * sag2), r2 * 0.8, 3 + Math.round(melt * 4), 5);
      icicles(c2x, c2y + r2 * (1 - 0.14 * sag2), r2 * 0.8, 4, 17);
      // coal buttons
      for (let i = 0; i < 3; i++) { const bx = c2x + 18 + i * 2 - (i === 2 ? 3 : 0), by = c2y - 16 + i * 15; circ(ctx, bx, by, 4.2 - i * 0.3); ctx.fillStyle = '#16101f'; ctx.fill(); ctx.strokeStyle = 'rgba(190,160,255,.5)'; ctx.lineWidth = 1; ctx.stroke(); }
      // head
      snowBall(c3x, c3y, r3, sag3, 41, 'snowman-b3', -204);
      drips(c3x, c3y + r3 * (1 - 0.14 * sag3), r3 * 0.7, 2 + Math.round(melt * 3), 9);
      // faded knitted scarf around the neck
      const ny = (c2y - r2 * 0.92 + c3y + r3 * 0.9) / 2;
      const scarfC = p2 ? '#9a8496' : '#a0707e', scarfS = p2 ? '#cfd4e0' : '#cbb9a6';
      const tf = Math.sin(t * 2.1) * 3;
      // tail hanging down the back
      ctx.beginPath(); ctx.moveTo(c2x - 22, ny + 2); ctx.quadraticCurveTo(c2x - 34 + tf * 0.4, ny + 26, c2x - 30 + tf, ny + 52);
      ctx.lineTo(c2x - 16 + tf, ny + 52); ctx.quadraticCurveTo(c2x - 20 + tf * 0.4, ny + 24, c2x - 8, ny + 4); ctx.closePath();
      ctx.fillStyle = scarfC; ctx.fill(); ctx.strokeStyle = EINK; ctx.lineWidth = 2.6; ctx.stroke();
      ctx.save(); ctx.clip(); ctx.fillStyle = scarfS;
      for (let i = 0; i < 3; i++) { ctx.fillRect(c2x - 44, ny + 14 + i * 13, 50, 5); }
      ctx.restore();
      ctx.strokeStyle = scarfS; ctx.lineWidth = 1.6; ctx.beginPath();
      for (let i = 0; i < 5; i++) { const fx = c2x - 29 + i * 3 + tf; ctx.moveTo(fx, ny + 53); ctx.lineTo(fx - 0.5, ny + 60 + (i % 2) * 2); }
      ctx.stroke();
      // band
      ctx.beginPath(); ctx.moveTo(c3x - 30, ny - 7); ctx.quadraticCurveTo(c3x, ny - 2, c3x + 30, ny - 8);
      ctx.lineTo(c3x + 31, ny + 6); ctx.quadraticCurveTo(c3x, ny + 13, c3x - 31, ny + 7); ctx.closePath();
      ctx.fillStyle = scarfC; ctx.fill();
      ctx.save(); ctx.clip();
      ctx.fillStyle = scarfS; for (let i = 0; i < 4; i++) ctx.fillRect(c3x - 26 + i * 16, ny - 12, 6, 28);
      ctx.strokeStyle = 'rgba(40,16,40,.35)'; ctx.lineWidth = 1; ctx.beginPath();
      for (let i = 0; i < 13; i++) { const kx = c3x - 30 + i * 5; ctx.moveTo(kx, ny - 3); ctx.lineTo(kx + 2.5, ny); ctx.lineTo(kx + 5, ny - 3); ctx.moveTo(kx, ny + 3); ctx.lineTo(kx + 2.5, ny + 6); ctx.lineTo(kx + 5, ny + 3); }
      ctx.stroke();
      ctx.restore();
      ctx.beginPath(); ctx.moveTo(c3x - 30, ny - 7); ctx.quadraticCurveTo(c3x, ny - 2, c3x + 30, ny - 8); ctx.lineTo(c3x + 31, ny + 6); ctx.quadraticCurveTo(c3x, ny + 13, c3x - 31, ny + 7); ctx.closePath();
      ctx.strokeStyle = EINK; ctx.lineWidth = 2.8; ctx.stroke(); ctx.strokeStyle = 'rgba(206,160,255,.45)'; ctx.lineWidth = 1; ctx.stroke();
      // face: glowing coal eyes, sad coal mouth
      const hx = c3x, hy = c3y;
      ctx.globalCompositeOperation = 'lighter';
      sglow(ctx, hx + 7, hy - 7, 9 + w * 3, '210,180,255', 0.8 + w * 0.2); sglow(ctx, hx + 20, hy - 6, 8 + w * 3, '210,180,255', 0.7 + w * 0.2);
      sglow(ctx, hx + 13, hy - 7, 20 + w * 10, '170,150,255', 0.22 + w * 0.3 + p2 * 0.15);
      ctx.globalCompositeOperation = 'source-over';
      const bl = eBlink(t, 4.6);
      for (const e of [[hx + 7, hy - 7, 4.4], [hx + 20, hy - 6, 3.7]]) {
        ctx.fillStyle = '#120b1c'; ell(ctx, e[0], e[1], e[2], e[2] * bl); ctx.fill();
        ctx.fillStyle = p2 ? '#dfeaff' : '#d9c6ff'; ell(ctx, e[0] + 0.5, e[1] + 0.3, e[2] * 0.58, e[2] * 0.62 * bl); ctx.fill();
        ctx.fillStyle = '#fff4ff'; circ(ctx, e[0] + 0.8, e[1], e[2] * 0.22 * bl); ctx.fill();
      }
      ctx.fillStyle = '#16101f';
      for (let i = 0; i < 5; i++) { const mx = hx + 3 + i * 4.4, my = hy + 9 + Math.sin(i / 4 * Math.PI) * -2.2 + 2.2; circ(ctx, mx, my, 1.9); ctx.fill(); }
      // carrot nose (droops as it melts)
      const nd = melt * 0.22;
      ctx.save(); ctx.translate(hx + 25, hy + 1); ctx.rotate(0.06 + nd);
      ctx.beginPath(); ctx.moveTo(0, -5); ctx.quadraticCurveTo(14, -3.6, 31, 0); ctx.quadraticCurveTo(14, 4.4, 0, 5); ctx.quadraticCurveTo(-3, 0, 0, -5); ctx.closePath();
      ctx.fillStyle = '#c48a60'; ctx.fill(); ctx.strokeStyle = EINK; ctx.lineWidth = 2.4; ctx.stroke();
      ctx.strokeStyle = 'rgba(90,50,30,.55)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(8, -3.8); ctx.lineTo(9.5, -1); ctx.moveTo(15, 2.8); ctx.lineTo(16.5, 0.6); ctx.moveTo(21, -1.8); ctx.lineTo(22, 0); ctx.stroke();
      ctx.restore();
      // faded tin bucket hat
      const bx0 = hx - 3, byb = hy - r3 * 0.72;
      ctx.beginPath(); ctx.moveTo(bx0 - 27, byb); ctx.lineTo(bx0 - 19, byb - 32); ctx.quadraticCurveTo(bx0, byb - 35, bx0 + 19, byb - 32); ctx.lineTo(bx0 + 27, byb); ctx.quadraticCurveTo(bx0, byb + 5, bx0 - 27, byb); ctx.closePath();
      ctx.fillStyle = lgc(ctx, 'snowman-bucket' + (p2 ? '-ice' : ''), bx0 - 27, 0, bx0 + 27, 0, p2 ? [[0, '#5e4a5e'], [0.6, '#8e6a76'], [1, '#6e5464']] : [[0, '#6a3a46'], [0.6, '#9e5c62'], [1, '#7a4450']]);
      ctx.fill();
      ctx.save(); ctx.clip();
      ctx.fillStyle = 'rgba(20,8,24,.35)'; ell(ctx, bx0 + 8, byb - 18, 5, 3.4, 0.4); ctx.fill(); ell(ctx, bx0 - 12, byb - 8, 3, 2); ctx.fill();
      ctx.strokeStyle = 'rgba(255,220,210,.25)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(bx0 + 10, byb - 30); ctx.lineTo(bx0 + 15, byb - 4); ctx.stroke();
      ctx.restore();
      ctx.strokeStyle = EINK; ctx.lineWidth = 3; ctx.stroke(); ctx.strokeStyle = RIMC; ctx.lineWidth = 1.1; ctx.beginPath(); ctx.moveTo(bx0 - 26, byb - 2); ctx.lineTo(bx0 - 18.5, byb - 31); ctx.stroke();
      // tin rim band + dent + top
      ctx.beginPath(); ctx.moveTo(bx0 - 29, byb - 7); ctx.quadraticCurveTo(bx0, byb - 3, bx0 + 29, byb - 7); ctx.lineTo(bx0 + 29, byb + 1); ctx.quadraticCurveTo(bx0, byb + 6, bx0 - 29, byb + 1); ctx.closePath();
      ctx.fillStyle = p2 ? '#a4adc0' : '#8f8c9e'; ctx.fill(); ctx.strokeStyle = EINK; ctx.lineWidth = 2.4; ctx.stroke();
      ctx.beginPath(); ell(ctx, bx0, byb - 32.5, 19, 4); ctx.fillStyle = p2 ? '#8a8ea4' : '#7a6a7a'; ctx.fill(); ctx.strokeStyle = EINK; ctx.lineWidth = 2.2; ctx.stroke();
      icicles(bx0, byb + 7, 26, 4, 31);
      // front twig arm (throw: raised back holding a snowball; follow-through forward)
      let fa = -0.45 + Math.sin(t * 1.4) * 0.05;
      fa = lerp(fa, 1.35, bumpW); fa = lerp(fa, 0.25, throwW); fa = lerp(fa, 0.5, rel);
      twig(c2x + r2 * 0.82, c2y - 6, fa, 62, true);
      ctx.restore();
      mist(true);
    },

    // ---------------- 小さな雪だるま (minion of the snowman) ----------------
    snowlet(ctx, u) {
      const t = (u.anim || 0) + (u.id || 0) * 0.61, at = u.atk || 0;
      const hop = at > 0 ? Math.sin(at * Math.PI) * 10 : 0;
      const wk = u.walk ? Math.sin(t * 10) : 0;
      const bob = u.walk ? Math.abs(wk) * 2.6 : Math.sin(t * 2.2) * 0.5;
      ctx.fillStyle = 'rgba(12,6,24,.8)'; ell(ctx, 1, -0.5, 17, 3.2); ctx.fill();
      ctx.save(); ctx.translate(wk * 1.2, -bob - hop); ctx.rotate(wk * 0.05);
      const sq = at > 0.8 ? (at - 0.8) * 0.5 : 0;
      ctx.scale(1 + sq, 1 - sq);
      const twig = (sx, sy, a, len, col) => {
        const ex = sx + Math.cos(a) * len, ey = sy + Math.sin(a) * len;
        eLimb(ctx, sx, sy, (sx + ex) / 2 + Math.sin(a) * 1.5, (sy + ey) / 2 - Math.cos(a) * 1.5, ex, ey, 2.2, col);
        const fa = a - 0.7; eLimb(ctx, ex, ey, ex + Math.cos(fa) * 2, ey + Math.sin(fa) * 2, ex + Math.cos(fa) * 5, ey + Math.sin(fa) * 5, 1.4, col);
      };
      twig(-10, -27, Math.PI + 0.5 + wk * 0.2, 13, '#57412f');
      // bottom ball
      ctx.beginPath(); ctx.ellipse(0, -13.5, 14.5, 13.5, 0, 0, TAU);
      ctx.fillStyle = lgc(ctx, 'snowlet-b', 0, -27, 0, 0, [[0, '#a39cb8'], [0.55, '#746d92'], [1, '#433c64']]); ctx.fill();
      ctx.strokeStyle = EINK; ctx.lineWidth = 2.2; ctx.stroke(); ctx.strokeStyle = RIM; ctx.lineWidth = 0.9; ctx.stroke();
      ctx.fillStyle = 'rgba(30,12,50,.42)'; ell(ctx, -5, -10, 3.4, 2, 0.4); ctx.fill(); ell(ctx, -2.6, -11.4, 1.4, 1); ctx.fill(); ell(ctx, 3, -5, 1.8, 1.2); ctx.fill();
      ctx.fillStyle = '#16101f'; circ(ctx, 8, -18, 1.6); ctx.fill(); circ(ctx, 9, -12, 1.5); ctx.fill();
      // head
      circ(ctx, 1.5, -33, 9.5);
      ctx.fillStyle = lgc(ctx, 'snowlet-h', 0, -43, 0, -23, [[0, '#a39cb8'], [1, '#625b80']]); ctx.fill();
      ctx.strokeStyle = EINK; ctx.lineWidth = 2.2; ctx.stroke(); ctx.strokeStyle = RIM; ctx.lineWidth = 0.9; ctx.stroke();
      // drip
      ctx.fillStyle = '#150a26'; const dl = 2 + (Math.sin(t * 1.7) + 1) * 2; rr(ctx, -3, -25, 1.8, dl, 0.9); ctx.fill(); circ(ctx, -2.1, -25 + dl, 1.3); ctx.fill();
      // tiny scarf
      ctx.beginPath(); rr(ctx, -8, -26, 18, 4, 2); ctx.fillStyle = '#a0707e'; ctx.fill(); ctx.strokeStyle = EINK; ctx.lineWidth = 1.4; ctx.stroke();
      ctx.beginPath(); rr(ctx, -9, -24, 4, 8, 1.5); ctx.fillStyle = '#a0707e'; ctx.fill(); ctx.stroke();
      // eyes + carrot
      ctx.globalCompositeOperation = 'lighter'; sglow(ctx, 4, -35, 4, '210,180,255', 0.7); sglow(ctx, 8.6, -34.6, 3.6, '210,180,255', 0.6); ctx.globalCompositeOperation = 'source-over';
      const bl = eBlink(t, 3.7);
      ctx.fillStyle = '#120b1c'; ell(ctx, 4, -35, 1.9, 2.1 * bl); ctx.fill(); ell(ctx, 8.6, -34.6, 1.6, 1.9 * bl); ctx.fill();
      ctx.fillStyle = '#d9c6ff'; ell(ctx, 4.2, -35, 1, 1.1 * bl); ctx.fill(); ell(ctx, 8.8, -34.6, 0.85, 1 * bl); ctx.fill();
      ctx.beginPath(); ctx.moveTo(9.5, -32.8); ctx.lineTo(17, -31.2); ctx.lineTo(9.5, -30.2); ctx.closePath(); ctx.fillStyle = '#c48a60'; ctx.fill(); ctx.strokeStyle = EINK; ctx.lineWidth = 1.2; ctx.stroke();
      // tiny bucket
      ctx.beginPath(); ctx.moveTo(-8, -39.5); ctx.lineTo(-5.5, -48); ctx.lineTo(5.5, -48); ctx.lineTo(8, -39.5); ctx.closePath();
      ctx.fillStyle = '#8e5560'; ctx.fill(); ctx.strokeStyle = EINK; ctx.lineWidth = 1.6; ctx.stroke();
      ctx.beginPath(); rr(ctx, -9, -41, 18, 3, 1.2); ctx.fillStyle = '#8f8c9e'; ctx.fill(); ctx.strokeStyle = EINK; ctx.lineWidth = 1.2; ctx.stroke();
      twig(11, -21, -0.15 + (u.walk ? -wk * 0.2 : 0) + (at > 0 ? Math.sin(at * Math.PI) * 0.5 : 0), 13, '#76594a');
      ctx.restore();
    },

    // ---------------- 顔のない友人 (boss) — also draws もう一人 when called with small=true ----------------
    // An only child's imaginary friend: a translucent, crayon-drawn round shadow. No face but two faint eyes.
    // u.reveal 0 = hidden (faint shimmer + eyes ~15%), 1 = fully visible.
    friend(ctx, u, small) {
      const t = (u.anim || 0) + (small ? (u.id || 0) * 0.9 : 0), at = u.atk || 0;
      const wind = clamp01(u.wind || 0), w = ease(wind);
      const p2 = (u.phase || 1) >= 2 ? 1 : 0;
      const rv = small ? 1 : clamp01(u.reveal || 0);
      const k = small ? 0.36 : 1, lk = small ? 1.9 : 1;
      const hsh = (n) => { const s = Math.sin(n * 127.1 + 31.7) * 43758.5453; return s - Math.floor(s); };
      const pa = ctx.globalAlpha;
      const walk = !!u.walk, st = walk ? Math.sin(t * 4) : 0;
      const bob = walk ? Math.abs(Math.cos(t * 4)) * 4 : Math.sin(t * 1.6) * 2;
      const reach = at > 0 ? ease(clamp01(at * 1.4)) : 0;
      const lift = w * 0.3;
      const jit = small ? 0.05 : 0.045 + p2 * 0.03;
      ctx.save(); ctx.scale(k, k);
      // faint shadow on the floor
      ctx.globalAlpha = pa * (0.1 + 0.7 * rv);
      ctx.fillStyle = 'rgba(12,6,24,.8)'; ell(ctx, 0, -1, 50, 6); ctx.fill();
      // crayon blob path (line "boils" slowly)
      const blob = (cx, cy, rx, ry, rot, seed, cont) => {
        const N = 18, P = [], cr = Math.cos(rot), sr = Math.sin(rot);
        for (let i = 0; i < N; i++) {
          const a = (i / N) * TAU, j = 1 + (hsh(seed + i) - 0.5) * jit * 2 + Math.sin(t * 2.3 + i * 1.7 + seed) * jit * 0.5;
          const lx = Math.cos(a) * rx * j, ly = Math.sin(a) * ry * j;
          P.push([cx + lx * cr - ly * sr, cy + lx * sr + ly * cr]);
        }
        if (!cont) ctx.beginPath();
        ctx.moveTo((P[N - 1][0] + P[0][0]) / 2, (P[N - 1][1] + P[0][1]) / 2);
        for (let i = 0; i < N; i++) { const p = P[i], q = P[(i + 1) % N]; ctx.quadraticCurveTo(p[0], p[1], (p[0] + q[0]) / 2, (p[1] + q[1]) / 2); }
        ctx.closePath();
      };
      const hx = 4, hy = -150 + bob;
      const by = -80 + bob * 0.7;
      // arm geometry
      const shF = [24, by - 22], shB = [-24, by - 22];
      const handF = [lerp(lerp(40, 46, lift), 26 + 92, reach), lerp(lerp(by + 14, by - 6, lift), by - 34, reach)];
      const handB = [-40 + st * 4, by + 14 - st * 2];
      const limb = (a, b, th) => { const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2, len = Math.hypot(b[0] - a[0], b[1] - a[1]); return [mx, my, len / 2 + 6, th || 8.5, Math.atan2(b[1] - a[1], b[0] - a[0])]; };
      const parts = [
        [hx, hy, 50, 47, 0, 1],
        [0, by, 35, 41, 0, 7],
        [-13 - st * 6, -26 + bob * 0.3, 9.5, 21, st * 0.25, 13],
        [13 + st * 6, -26 + bob * 0.3, 9.5, 21, -st * 0.25, 19],
        [-11 - st * 9, -6, 14, 7, 0, 23],
        [17 + st * 9, -6, 14, 7, 0, 29],
        limb(shB, handB).concat(37), [handB[0], handB[1], 9, 8.5, 0, 41],
        limb(shF, handF, 8.5 + reach * 1.5).concat(47), [handF[0], handF[1], 10 + reach * 2, 9 + reach * 2, 0, 53],
      ];
      if (reach > 0.12) parts.push([handF[0] + 13 * reach, handF[1] - 5, 4 + 6 * reach, 3.6, -0.25, 61]);
      // phase 2: lonely echoes drifting beside it
      if (p2 && rv > 0.05) {
        for (const ex of [-1, 1]) {
          ctx.save(); ctx.translate(ex * (14 + Math.sin(t * 1.3 + ex) * 6), 0);
          ctx.globalAlpha = pa * 0.22 * rv; ctx.beginPath();
          for (const p of parts) blob(p[0], p[1], p[2], p[3], p[4], p[5] + 100, true);
          ctx.strokeStyle = '#9aa4dc'; ctx.lineWidth = 1.6 * lk; ctx.stroke();
          ctx.restore();
        }
      }
      // translucent body (one union path → no darker overlaps)
      ctx.beginPath();
      for (const p of parts) blob(p[0], p[1], p[2], p[3], p[4], p[5], true);
      ctx.globalAlpha = pa * (0.01 + 0.8 * Math.pow(rv, 1.3));
      ctx.fillStyle = lgc(ctx, 'friend-body', 0, -200, 0, 0, [[0, '#3a3466'], [0.6, '#2a2450'], [1, '#191433']]); ctx.fill();
      // crayon hatching inside
      ctx.save(); ctx.clip();
      ctx.globalAlpha = pa * 0.5 * rv;
      ctx.strokeStyle = 'rgba(150,160,220,.35)'; ctx.lineWidth = 2.2 * lk; ctx.beginPath();
      for (let i = -12; i < 18; i++) { const x0 = -70 + i * 9; ctx.moveTo(x0 + hsh(i) * 3, -210); ctx.lineTo(x0 + 70 + hsh(i + 3) * 4, 0); }
      ctx.stroke();
      ctx.restore();
      // crayon heart scribbled on the chest (the child drew it)
      ctx.globalAlpha = pa * 0.55 * rv;
      ctx.save(); ctx.translate(8, by - 6);
      ctx.beginPath(); ctx.moveTo(0, 9); ctx.bezierCurveTo(-14, 0, -10, -11, 0, -4); ctx.bezierCurveTo(10, -11, 14, 0, 0, 9); ctx.closePath();
      ctx.strokeStyle = '#d896b4'; ctx.lineWidth = 2 * lk; ctx.stroke();
      ctx.save(); ctx.clip(); ctx.lineWidth = 1.4 * lk; ctx.beginPath(); for (let i = -12; i < 12; i += 3) { ctx.moveTo(i, -10); ctx.lineTo(i + 6, 10); } ctx.stroke(); ctx.restore();
      ctx.restore();
      // outlines: ink edge + two wobbly crayon passes; hidden → faint shimmer only
      const shim = 0.55 + 0.45 * Math.sin(t * 2.6);
      const oa = lerp(0.075 * shim, 0.9, rv);
      ctx.globalAlpha = pa * 0.75 * rv;
      ctx.beginPath(); for (const p of parts) blob(p[0], p[1], p[2], p[3], p[4], p[5], true);
      ctx.strokeStyle = EINK; ctx.lineWidth = 4.2 * lk; ctx.stroke();
      ctx.globalAlpha = pa * oa;
      ctx.strokeStyle = '#8f93cc'; ctx.lineWidth = 2.2 * lk; ctx.stroke();
      ctx.globalAlpha = pa * oa * 0.5;
      ctx.beginPath(); for (const p of parts) blob(p[0] + 1.2, p[1] - 0.8, p[2] * 1.02, p[3] * 0.99, p[4], p[5] + 60, true);
      ctx.strokeStyle = '#b4b6e6'; ctx.lineWidth = 1.1 * lk; ctx.stroke();
      // violet rim on the back of the head
      ctx.globalAlpha = pa * 0.8 * rv;
      ctx.strokeStyle = RIM; ctx.lineWidth = 1.3 * lk; ctx.beginPath(); ctx.arc(hx, hy, 48, Math.PI * 0.95, Math.PI * 1.45); ctx.stroke();
      // hidden shimmer: a soft glint sliding along the outline
      if (rv < 0.6) {
        const ga = (1 - rv / 0.6) * 0.3, gt = t * 0.9;
        ctx.globalAlpha = pa * ga;
        ctx.globalCompositeOperation = 'lighter';
        sglow(ctx, hx + Math.cos(gt) * 50, hy + Math.sin(gt) * 47, 14, '190,190,255', 0.6);
        sglow(ctx, Math.cos(gt * 0.7 + 2) * 35, by + Math.sin(gt * 0.7 + 2) * 41, 12, '190,190,255', 0.5);
        ctx.globalCompositeOperation = 'source-over';
      }
      // a single crayon curl of hair
      ctx.globalAlpha = pa * oa;
      ctx.strokeStyle = '#8f93cc'; ctx.lineWidth = 2.2 * lk; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(hx - 6, hy - 46); ctx.bezierCurveTo(hx - 10, hy - 64, hx + 10, hy - 68, hx + 8, hy - 56); ctx.bezierCurveTo(hx + 6, hy - 50, hx - 2, hy - 54, hx + 2, hy - 60); ctx.stroke();
      ctx.lineCap = 'butt';
      // eyes: the only thing you can (barely) always see
      const ea = lerp(0.15, 1, rv), bl = eBlink(t + 1.3, 5.2);
      ctx.globalAlpha = pa * ea;
      ctx.globalCompositeOperation = 'lighter';
      sglow(ctx, hx + 22, hy + 2, 30 + w * 10 + p2 * 6, '255,170,235', 0.5 + w * 0.3 + p2 * 0.2);
      ctx.globalCompositeOperation = 'source-over';
      eEye(ctx, hx + 13, hy + 3, 4.6, 6.4 * bl, 0.1); eEye(ctx, hx + 31, hy + 4, 3.8, 5.6 * bl, -0.1);
      // faint mouth line
      ctx.globalAlpha = pa * 0.45 * rv;
      ctx.strokeStyle = 'rgba(255,200,240,.9)'; ctx.lineWidth = 1.4 * lk;
      ctx.beginPath(); ctx.moveTo(hx + 17, hy + 23); ctx.quadraticCurveTo(hx + 23, hy + 21.8, hx + 29, hy + 23.2); ctx.stroke();
      // phase 2: ink dripping off the feet
      if (p2) {
        ctx.globalAlpha = pa * rv; ctx.fillStyle = '#150a26';
        for (let i = 0; i < 4; i++) { const x = -24 + i * 15, l = 4 + (Math.sin(t * 1.4 + i * 2) + 1) * 4; ell(ctx, x, -1, 6 + l * 0.5, 2); ctx.fill(); }
      }
      ctx.restore();
      ctx.globalAlpha = pa;
    },
    // ---------------- もう一人 (decoy minion of the friend) ----------------
    friendkid(ctx, u) { DRAW.friend(ctx, u, true); },

    // ---------------- 星を目指した者 (boss) ----------------
    // A child who dreamed of space: round helmet + dark visor, puffy faded-cream suit, jet backpack, broken tether.
    // Decorations: ringed planet, crescent moon, little rocket. (No star shapes.)
    astro(ctx, u) {
      const t = u.anim || 0, at = u.atk || 0;
      const wind = clamp01(u.wind || 0), w = ease(wind);
      const metW = u.windKind === 'meteor' ? w : 0, stW = u.windKind === 'stomp' ? w : 0;
      const rel = wind > 0 ? 0 : ease(clamp01(at));
      const fly = !!u.fly, p2 = (u.phase || 1) >= 2 ? 1 : 0;
      const thr = fly ? clamp01(u.thrust || 0) : 0;
      const landT = clamp01(u.landT || 0);
      const cracked = !fly && p2;
      const SUIT = '#bdb29c', SUITD = '#6e6458', ACC = '#a8805f', BINK = '#1a0f26';
      const dg = Math.sin(t * 1.8);
      const walk = !!u.walk && !fly, ph = t * 3, stp = walk ? Math.sin(ph) : 0;
      const cr = fly ? 0 : 6 + landT * 10 + (stW > 0 ? 0 : rel * 6) + (walk ? Math.abs(Math.cos(ph)) * 2 : 0);
      const br = Math.sin(t * 1.5) * 1.5;
      const hipY = -76 + cr;

      // ink puddle (only when standing)
      if (!fly) { ctx.fillStyle = 'rgba(12,6,24,.8)'; ell(ctx, 2, -1, 60, 7); ctx.fill(); }
      // landing dust ring (round puffs along an ellipse)
      if (landT > 0) {
        const e = 1 - landT, rx = 44 + e * 84, ry = 7 + e * 9;
        ctx.strokeStyle = `rgba(196,176,226,${(landT * 0.7).toFixed(3)})`; ctx.lineWidth = 3; ell(ctx, 0, -1, rx, ry); ctx.stroke();
        ctx.fillStyle = `rgba(170,150,200,${(landT * 0.5).toFixed(3)})`;
        for (let i = 0; i < 10; i++) { const a = i / 10 * TAU + 0.3; circ(ctx, Math.cos(a) * rx, -4 + Math.sin(a) * ry - landT * 4, 7 + e * 6); ctx.fill(); }
      }
      // aura
      ctx.globalCompositeOperation = 'lighter';
      sglow(ctx, 0, -120, 130, '150,70,210', 0.22 + w * 0.25 + p2 * 0.08);
      ctx.globalCompositeOperation = 'source-over';

      // ---- tether hose trailing behind, broken & dripping ink
      const hs = Math.sin(t * 1.2) * 8;
      const hoseP = () => { ctx.beginPath(); ctx.moveTo(-50, -112 + cr); ctx.bezierCurveTo(-96, -86 + cr + hs * 0.3, -150, -120 + hs, -118, -158 + hs); ctx.quadraticCurveTo(-104, -174 + hs, -126, -186 + hs * 1.2); };
      ctx.lineCap = 'round';
      hoseP(); ctx.strokeStyle = EINK; ctx.lineWidth = 9; ctx.stroke(); ctx.strokeStyle = '#9d968a'; ctx.lineWidth = 5.6; ctx.stroke();
      ctx.setLineDash([2, 4]); ctx.strokeStyle = 'rgba(60,46,64,.55)'; ctx.lineWidth = 5.6; ctx.stroke(); ctx.setLineDash([]);
      ctx.lineCap = 'butt';
      // frayed end
      ctx.fillStyle = '#150a26'; const hl = 6 + (Math.sin(t * 1.4) + 1) * 6; rr(ctx, -128, -186 + hs * 1.2, 3.4, hl, 1.7); ctx.fill(); circ(ctx, -126.3, -186 + hs * 1.2 + hl, 2.6); ctx.fill();
      ctx.strokeStyle = '#cfc8b8'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(-126, -186 + hs * 1.2); ctx.lineTo(-131, -191 + hs * 1.2); ctx.moveTo(-126, -186 + hs * 1.2); ctx.lineTo(-122, -192 + hs * 1.2); ctx.stroke();

      // ---- jet flames (flying) / sputtering smoke (landed)
      const noz = [[-54, -76 + cr], [-36, -76 + cr]];
      if (fly) {
        for (const n of noz) {
          const L = (16 + thr * 52) * (0.86 + 0.14 * Math.sin(t * 31 + n[0]));
          ctx.globalCompositeOperation = 'lighter';
          sglow(ctx, n[0], n[1] + L * 0.45, 16 + L * 0.5, '200,120,255', 0.35 + thr * 0.35);
          ctx.globalCompositeOperation = 'source-over';
          ctx.beginPath(); ctx.moveTo(n[0] - 6.5, n[1]); ctx.quadraticCurveTo(n[0] - 8, n[1] + L * 0.5, n[0], n[1] + L); ctx.quadraticCurveTo(n[0] + 8, n[1] + L * 0.5, n[0] + 6.5, n[1]); ctx.closePath();
          ctx.fillStyle = 'rgba(196,130,255,.78)'; ctx.fill();
          ctx.beginPath(); ctx.moveTo(n[0] - 3.5, n[1]); ctx.quadraticCurveTo(n[0] - 4, n[1] + L * 0.35, n[0], n[1] + L * 0.62); ctx.quadraticCurveTo(n[0] + 4, n[1] + L * 0.35, n[0] + 3.5, n[1]); ctx.closePath();
          ctx.fillStyle = '#ffe6f2'; ctx.fill();
        }
      } else {
        for (let i = 0; i < 4; i++) { const p = (t * 0.45 + i / 4) % 1; ctx.fillStyle = `rgba(120,100,150,${(0.35 * (1 - p)).toFixed(3)})`; circ(ctx, -46 + Math.sin(p * 5 + i) * 6 - p * 10, -80 + cr - p * 70, 5 + p * 10); ctx.fill(); }
      }

      // ---- legs
      const legDraw = (hx, fx, fy, kneeOut, col, bootRot) => {
        const hy = hipY, kx = (hx + fx) / 2 + kneeOut, ky = (hy + fy) / 2 - 2;
        bone(ctx, hx, hy, kx, ky, 21, col, BINK, 3.2);
        bone(ctx, kx, ky, fx, fy - 10, 19, col, BINK, 3.2);
        // puffy rings
        ctx.strokeStyle = 'rgba(70,56,60,.45)'; ctx.lineWidth = 1.4;
        for (const f of [0.35, 0.7]) { const x = lerp(hx, kx, f), y = lerp(hy, ky, f); ctx.beginPath(); ctx.moveTo(x - 9, y + 1); ctx.quadraticCurveTo(x, y + 4, x + 9, y + 1); ctx.stroke(); }
        circ(ctx, kx, ky, 8); fo(ctx, ACC, 2.4, BINK);
        ctx.save(); ctx.translate(fx, fy); ctx.rotate(bootRot);
        ctx.beginPath(); rr(ctx, -11, -18, 27, 16, [7, 9, 3, 3]); fo(ctx, '#aaa294', 2.8, BINK);
        ctx.beginPath(); rr(ctx, -12, -4, 29, 5.5, 2.5); fo(ctx, '#9a7058', 2.4, BINK);
        ctx.restore();
      };
      if (fly) {
        legDraw(-12, -14 + dg * 3, -2, 6, '#958b7a', 0.75 + dg * 0.08);
        legDraw(14, 10 - dg * 3, 0, 7, SUIT, 0.65 - dg * 0.08);
      } else {
        let ffx = 24 + stp * 12, ffy = walk ? -Math.max(0, Math.cos(ph)) * 6 : 0, bfx = -22 - stp * 12, bfy = walk ? -Math.max(0, -Math.cos(ph)) * 6 : 0;
        if (stW > 0) { ffx = lerp(ffx, 34, stW); ffy = lerp(ffy, -46, stW); }
        legDraw(-12, bfx, bfy, 9, '#958b7a', 0);
        legDraw(14, ffx, ffy, 12 + stW * 10, SUIT, -stW * 0.25);
        if (rel > 0.05 && u.windKind !== 'meteor') { ctx.fillStyle = `rgba(170,150,200,${(rel * 0.5).toFixed(3)})`; for (let i = 0; i < 4; i++) { circ(ctx, ffx + 22 + (1 - rel) * (8 + i * 9), -6 - i * 2, 5 + (1 - rel) * 6); ctx.fill(); circ(ctx, ffx - 16 - (1 - rel) * (6 + i * 7), -5 - i * 2, 4 + (1 - rel) * 5); ctx.fill(); } }
      }

      ctx.save(); ctx.translate(0, cr * 0.4);
      // ---- arms (angles: 0 = forward, π/2 = down)
      let fa1 = 1.2, fa2 = 0.85, ba1 = 1.8, ba2 = 1.55;
      if (fly) { fa1 = 0.95 + dg * 0.12; fa2 = 0.6 + dg * 0.1; ba1 = 2.2 - dg * 0.1; ba2 = 2.0; }
      if (walk) { fa1 -= stp * 0.25; ba1 += stp * 0.25; }
      fa1 = lerp(fa1, -0.75, metW); fa2 = lerp(fa2, -1.45, metW); ba1 = lerp(ba1, -2.3, metW); ba2 = lerp(ba2, -1.75, metW);
      fa1 = lerp(fa1, -0.5, stW * 0.6); ba1 = lerp(ba1, 2.6, stW * 0.6);
      if (rel > 0) { fa1 = lerp(fa1, 0.25, rel); fa2 = lerp(fa2, 0.05, rel); }
      const arm = (sx, sy, a1, a2, col) => {
        const ex = sx + Math.cos(a1) * 32, ey = sy + Math.sin(a1) * 32, hx = ex + Math.cos(a2) * 30, hy = ey + Math.sin(a2) * 30;
        bone(ctx, sx, sy, ex, ey, 18, col, BINK, 3.2);
        bone(ctx, ex, ey, hx, hy, 16, col, BINK, 3.2);
        ctx.strokeStyle = 'rgba(70,56,60,.45)'; ctx.lineWidth = 1.3; ctx.beginPath(); const mx = lerp(ex, hx, 0.5), my = lerp(ey, hy, 0.5); ctx.arc(mx, my, 7, a2 + 1.2, a2 + 1.9); ctx.stroke();
        circ(ctx, hx, hy, 10); fo(ctx, ACC, 2.8, BINK);
        return [hx, hy];
      };
      // backpack (behind)
      ctx.beginPath(); rr(ctx, -64, -170 + br, 38, 84, 9);
      ctx.fillStyle = lgc(ctx, 'astro-pack', -64, 0, -26, 0, [[0, '#6e6760'], [1, '#a39c8e']]); ctx.fill(); ctx.strokeStyle = BINK; ctx.lineWidth = 3; ctx.stroke(); ctx.strokeStyle = RIM; ctx.lineWidth = 1.1; ctx.beginPath(); ctx.moveTo(-62, -160 + br); ctx.lineTo(-62, -96 + br); ctx.stroke();
      // thrusters
      for (const n of noz) {
        ctx.beginPath(); rr(ctx, n[0] - 6, n[1] - 20 + br * 0.3, 12, 14, 3); fo(ctx, '#7c7480', 2.2, BINK);
        ctx.beginPath(); ctx.moveTo(n[0] - 5, n[1] - 7); ctx.lineTo(n[0] + 5, n[1] - 7); ctx.lineTo(n[0] + 7.5, n[1]); ctx.lineTo(n[0] - 7.5, n[1]); ctx.closePath(); fo(ctx, '#5a5262', 2, BINK);
      }
      // little rocket patch on the pack
      ctx.save(); ctx.translate(-46, -142 + br);
      ctx.beginPath(); rr(ctx, -10, -13, 20, 26, 4); fo(ctx, '#7a6e86', 1.6, BINK);
      ctx.beginPath(); ctx.moveTo(0, -10); ctx.quadraticCurveTo(5, -5, 4, 5); ctx.lineTo(-4, 5); ctx.quadraticCurveTo(-5, -5, 0, -10); ctx.closePath(); ctx.fillStyle = '#d8cfc0'; ctx.fill();
      ctx.fillStyle = '#c07a6e'; ctx.beginPath(); ctx.moveTo(-4, 1); ctx.lineTo(-7, 8); ctx.lineTo(-3.5, 5); ctx.closePath(); ctx.fill(); ctx.beginPath(); ctx.moveTo(4, 1); ctx.lineTo(7, 8); ctx.lineTo(3.5, 5); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#7fa0b8'; circ(ctx, 0, -3, 1.8); ctx.fill();
      ctx.restore();
      const bh = arm(-22, -142 + br, ba1, ba2, '#958b7a');
      // torso (puffy)
      const torso = () => {
        ctx.beginPath(); ctx.moveTo(-32, -150 + br);
        ctx.quadraticCurveTo(2, -162 + br, 36, -150 + br);
        ctx.bezierCurveTo(46, -126, 42, -96, 32, -74);
        ctx.quadraticCurveTo(0, -66, -30, -74);
        ctx.bezierCurveTo(-40, -98, -42, -128, -32, -150 + br); ctx.closePath();
      };
      torso();
      ctx.fillStyle = lgc(ctx, 'astro-suit', 0, -160, 0, -70, [[0, SUIT], [1, SUITD]]); ctx.fill();
      ctx.save(); ctx.clip();
      sglow(ctx, 18, -132, 46, '250,240,220', 0.22);
      sglow(ctx, -36, -84, 62, '24,12,40', 0.7);
      // puffy creases
      ctx.strokeStyle = 'rgba(80,64,64,.4)'; ctx.lineWidth = 1.6; ctx.beginPath();
      ctx.moveTo(-36, -118); ctx.quadraticCurveTo(0, -110, 42, -120); ctx.moveTo(-36, -94); ctx.quadraticCurveTo(0, -86, 40, -96); ctx.stroke();
      // ink stains
      ctx.fillStyle = 'rgba(28,12,44,.55)'; ell(ctx, -18, -104, 7, 5, 0.4); ctx.fill(); ell(ctx, 26, -84, 5, 4); ctx.fill(); ell(ctx, 30, -142, 6, 3.5, -0.3); ctx.fill(); ell(ctx, -8, -86, 9, 4); ctx.fill();
      const sl = 8 + (Math.sin(t * 1.1) + 1) * 6; rr(ctx, -20, -104, 3, sl, 1.5); ctx.fill(); circ(ctx, -18.5, -104 + sl, 2.4); ctx.fill();
      ctx.restore();
      torso(); ctx.strokeStyle = BINK; ctx.lineWidth = 3.2; ctx.stroke();
      ctx.strokeStyle = RIM; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(-30, -148 + br); ctx.bezierCurveTo(-39, -126, -38, -100, -29, -76); ctx.stroke();
      // belt
      ctx.beginPath(); rr(ctx, -32, -84, 66, 9, 4); fo(ctx, ACC, 2.4, BINK);
      ctx.fillStyle = '#150a26';
      for (let i = 0; i < 4; i++) { const x = -22 + i * 15, l = 5 + (Math.sin(t * 1.2 + i * 2) + 1) * 6; rr(ctx, x, -76, 3, l, 1.5); ctx.fill(); circ(ctx, x + 1.5, -76 + l, 2.4); ctx.fill(); }
      // chest control box
      ctx.beginPath(); rr(ctx, 6, -142 + br, 24, 17, 3); fo(ctx, '#9c96a2', 2.2, BINK);
      ctx.fillStyle = '#b06a6a'; circ(ctx, 12, -134 + br, 2.4); ctx.fill(); ctx.fillStyle = '#6a9a96'; circ(ctx, 19, -134 + br, 2.4); ctx.fill(); ctx.fillStyle = '#c8b070'; rr(ctx, 23, -137 + br, 4, 6, 1); ctx.fill();
      // ringed planet patch (rounded square patch)
      ctx.save(); ctx.translate(-6, -112 + br);
      ctx.beginPath(); rr(ctx, -12, -11, 24, 22, 5); fo(ctx, '#4a4266', 1.8, BINK);
      ctx.strokeStyle = 'rgba(220,210,190,.6)'; ctx.lineWidth = 0.9; ctx.setLineDash([2, 2]); rr(ctx, -10, -9, 20, 18, 4); ctx.stroke(); ctx.setLineDash([]);
      circ(ctx, 0, 0, 5.6); ctx.fillStyle = '#d0a08a'; ctx.fill();
      ctx.strokeStyle = '#9cc0b6'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.ellipse(0, 0, 10, 3, -0.35, -0.2, Math.PI + 0.2); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(0, 0, 10, 3, -0.35, Math.PI + 0.75, TAU - 0.75); ctx.stroke();
      ctx.restore();
      // crescent moon patch on the shoulder
      crescent(ctx, -18, -138 + br, 7, 4.5, 6, -0.6); ctx.fillStyle = '#d6c88c'; ctx.fill(); ctx.strokeStyle = BINK; ctx.lineWidth = 1.4; ctx.stroke();
      // collar ring
      ell(ctx, 6, -152 + br, 31, 8); fo(ctx, '#a39ca4', 2.6, BINK);
      // ---- helmet
      const hx = 8, hy = -190 + br;
      circ(ctx, hx, hy, 41); ctx.fillStyle = lgc(ctx, 'astro-helm', 0, -232, 0, -150, [[0, '#cdc6b8'], [1, '#7c7570']]); ctx.fill();
      ctx.strokeStyle = BINK; ctx.lineWidth = 3.2; ctx.stroke();
      ctx.strokeStyle = RIM; ctx.lineWidth = 1.3; ctx.beginPath(); ctx.arc(hx, hy, 39.5, Math.PI * 0.75, Math.PI * 1.35); ctx.stroke();
      // faded stripe + side bolt
      ctx.strokeStyle = 'rgba(185,138,102,.8)'; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(hx, hy, 35, Math.PI * 1.15, Math.PI * 1.45); ctx.stroke();
      circ(ctx, hx - 26, hy + 6, 6); fo(ctx, '#8e8794', 2, BINK);
      // visor
      const visor = () => { ell(ctx, hx + 13, hy + 1, 26, 25); };
      visor(); ctx.fillStyle = lgc(ctx, 'astro-visor', 0, hy - 26, 0, hy + 26, [[0, '#2e2050'], [0.6, '#160e2c'], [1, '#0a0618']]); ctx.fill();
      ctx.strokeStyle = BINK; ctx.lineWidth = 3; ctx.stroke(); ctx.strokeStyle = '#8a8296'; ctx.lineWidth = 1.4; ctx.stroke();
      // eyes behind the visor
      const bl = eBlink(t + 0.4, 4.4);
      ctx.globalCompositeOperation = 'lighter';
      sglow(ctx, hx + 18, hy + 2, 26 + w * 8, '255,160,235', 0.45 + w * 0.35 + p2 * 0.2);
      ctx.globalCompositeOperation = 'source-over';
      eEye(ctx, hx + 10, hy + 3, 3.4, 4.6 * bl); eEye(ctx, hx + 25, hy + 3, 3, 4.2 * bl);
      // visor reflection (faded)
      ctx.save(); visor(); ctx.clip();
      ctx.strokeStyle = 'rgba(210,200,255,.32)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(hx + 13, hy + 1, 20, Math.PI * 1.1, Math.PI * 1.45); ctx.stroke();
      ctx.fillStyle = 'rgba(230,220,255,.4)'; ell(ctx, hx + 28, hy - 13, 4, 2.4, -0.6); ctx.fill();
      if (cracked) { // ink leaking down from the crack
        ctx.fillStyle = '#150a26'; const cl = 8 + (Math.sin(t * 1.2) + 1) * 5; rr(ctx, hx + 18, hy - 2, 2.8, cl, 1.4); ctx.fill(); circ(ctx, hx + 19.4, hy - 2 + cl, 2.2); ctx.fill();
      }
      ctx.restore();
      if (cracked) {
        ctx.strokeStyle = 'rgba(240,232,255,.85)'; ctx.lineWidth = 1.5; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(hx + 4, hy - 24); ctx.lineTo(hx + 12, hy - 15); ctx.lineTo(hx + 9, hy - 8); ctx.lineTo(hx + 19, hy - 2); ctx.lineTo(hx + 17, hy + 6); ctx.moveTo(hx + 9, hy - 8); ctx.lineTo(hx + 2, hy - 4); ctx.stroke();
        ctx.strokeStyle = BINK; ctx.lineWidth = 1.8;
        ctx.beginPath(); ctx.moveTo(hx - 22, hy - 30); ctx.lineTo(hx - 14, hy - 22); ctx.lineTo(hx - 18, hy - 14); ctx.lineTo(hx - 10, hy - 8); ctx.stroke();
        ctx.lineCap = 'butt';
      }
      // ---- front arm + meteor call
      const fh = arm(26, -140 + br, fa1, fa2, SUIT);
      if (metW > 0.02) {
        const mx = (fh[0] + bh[0]) / 2, my = Math.min(fh[1], bh[1]) - 18;
        ctx.globalCompositeOperation = 'lighter'; sglow(ctx, mx, my, 40, '255,140,220', metW * 0.6); ctx.globalCompositeOperation = 'source-over';
        for (let i = 0; i < 3; i++) {
          const rx = mx - 22 + i * 22, ry = my - 12 - i % 2 * 12 - metW * 10 + Math.sin(t * 3 + i) * 3, rs = (5 + i % 2 * 2) * metW;
          ctx.beginPath(); ctx.moveTo(rx - rs, ry); ctx.quadraticCurveTo(rx - rs, ry - rs, rx, ry - rs * 1.1); ctx.quadraticCurveTo(rx + rs * 1.2, ry - rs * 0.6, rx + rs, ry + rs * 0.3); ctx.quadraticCurveTo(rx, ry + rs * 1.1, rx - rs, ry); ctx.closePath();
          ctx.fillStyle = '#2a1840'; ctx.fill(); ctx.strokeStyle = RIM; ctx.lineWidth = 1.2; ctx.stroke();
        }
      }
      ctx.restore();
    },

    // ---------------- 壊れた観覧車 (boss) ----------------
    // A family's day at the amusement park. BROKEN: the spokes are gone; only a tilted double-rim ring
    // (zigzag truss) with a missing quarter rests on a sawhorse A-frame on two stubby walking legs.
    wheel(ctx, u) {
      const t = u.anim || 0, at = u.atk || 0;
      const wind = clamp01(u.wind || 0), w = ease(wind);
      const dropW = u.windKind === 'drop' ? w : 0;
      const rel = wind > 0 ? 0 : clamp01(at);
      const p2 = (u.phase || 1) >= 2 ? 1 : 0;
      const anc = u.anchored ? 1 : 0;
      const spin = u.spin || 0;
      const walk = !!u.walk && !anc;
      const ph = t * 2.6, st = walk ? Math.sin(ph) : 0;
      const bob = walk ? Math.abs(Math.cos(ph)) * 4 : Math.sin(t * 1.2) * 0.8;
      const hsh = (n) => { const s = Math.sin(n * 127.1 + 31.7) * 43758.5453; return s - Math.floor(s); };
      const BINK = '#1a0f26', PAINT = '#7d9488', PAINTD = '#536a62';
      const RINGC = lgc(ctx, 'wheel-ring' + (p2 ? '-p2' : ''), 0, -320, 0, -60, p2 ? [[0, '#d2a2b8'], [0.55, '#9a7290'], [1, '#4a3050']] : [[0, '#c8afba'], [0.55, '#937c92'], [1, '#4a3a52']]);
      const lower = anc * 7 + bob;
      const CX = 0, CY = -198 + lower, RX = 100, RY = 112, IN = 0.8;
      const G0 = -1.5, G1 = 0.12;             // missing arc (upper front), in ring space
      const A0 = G1 + spin, A1 = G0 + TAU + spin;

      // ink puddle
      ctx.fillStyle = 'rgba(12,6,24,.85)'; ell(ctx, 0, -1, 96, 9); ctx.fill();
      for (let i = 0; i < 5; i++) { const px = -80 + i * 40 + Math.sin(i * 3) * 8, pr = 4 + (Math.sin(t * 1.3 + i) + 1) * 2.4; ell(ctx, px, -1, pr * 1.7, pr * 0.42); ctx.fill(); }
      ctx.globalCompositeOperation = 'lighter';
      sglow(ctx, CX, CY + 20, 125, p2 ? '220,90,200' : '160,70,220', 0.22 + p2 * 0.12 + w * 0.15);
      ctx.globalCompositeOperation = 'source-over';
      // rider launch puff at the base
      if (rel > 0.03) {
        for (let i = 0; i < 5; i++) { const e = 1 - rel; ctx.fillStyle = `rgba(190,160,230,${(0.5 * rel).toFixed(3)})`; circ(ctx, 64 + e * (18 + i * 10), -8 - i * 6 - e * 12, 6 + e * 9); ctx.fill(); }
      }

      // ---- stubby walking legs
      const leg = (side, col) => {
        const hx = side * 58, hy = -36 + lower;
        let fx = side * 62 + (walk ? side * st * 0 + st * 12 * side : 0) + anc * side * 14, fy = 0;
        if (walk) fy = -Math.max(0, side * Math.cos(ph)) * 8;
        const kx = (hx + fx) / 2 + 8, ky = (hy + fy) / 2;
        bone(ctx, hx, hy, kx, ky, 15, col, BINK, 3.2);
        bone(ctx, kx, ky, fx, fy - 8, 14, col, BINK, 3.2);
        circ(ctx, kx, ky, 6.5); fo(ctx, '#7a7484', 2.2, BINK);
        ctx.beginPath(); ctx.moveTo(fx - 15, fy); ctx.lineTo(fx - 12, fy - 13); ctx.lineTo(fx + 12, fy - 13); ctx.quadraticCurveTo(fx + 20, fy - 10, fx + 21, fy); ctx.closePath(); fo(ctx, '#5a5266', 2.6, BINK);
        if (anc) { ctx.fillStyle = '#3a3248'; for (const sx of [-10, 12]) { ctx.beginPath(); ctx.moveTo(fx + sx - 3, fy - 1); ctx.lineTo(fx + sx + 3, fy - 1); ctx.lineTo(fx + sx, fy + 7); ctx.closePath(); ctx.fill(); } }
      };
      leg(-1, '#4c4258'); leg(1, '#5c5268');

      // ---- sawhorse A-frame cradle
      const fy0 = -36 + lower, fy1 = CY + RY + 8;
      const beam = (x1, y1, x2, y2, wd, col) => bone(ctx, x1, y1, x2, y2, wd, col, BINK, 3);
      beam(-62, fy0, -20, fy1, 10, PAINTD); beam(62, fy0, 20, fy1, 10, PAINT);
      beam(-44, (fy0 + fy1) / 2 + 2, 44, (fy0 + fy1) / 2 + 2, 7, PAINTD);
      beam(-40, fy1, 40, fy1, 9, PAINT);
      // chipped paint + rivets
      ctx.fillStyle = 'rgba(30,20,40,.55)'; circ(ctx, 34, fy1 + 15, 2.4); ctx.fill(); circ(ctx, -40, fy1 + 20, 2); ctx.fill();
      ctx.fillStyle = '#c8c0c4'; for (const rx of [-30, -10, 10, 30]) { circ(ctx, rx, fy1, 1.6); ctx.fill(); }
      // ink drips off the crossbar
      ctx.fillStyle = '#150a26';
      for (let i = 0; i < 4; i++) { const x = -30 + i * 19, l = 6 + (Math.sin(t * 1.2 + i * 2) + 1) * 7; rr(ctx, x - 1.6, fy1 + 3, 3.2, l, 1.6); ctx.fill(); circ(ctx, x, fy1 + 3 + l, 2.6); ctx.fill(); }

      // ---- ring geometry (rotates with spin around its centre)
      const pt = (a, s) => [CX + Math.cos(a) * RX * s, CY + Math.sin(a) * RY * s];
      const arcPath = (s, a0, a1) => { const n = Math.max(2, Math.ceil((a1 - a0) / 0.08)); ctx.beginPath(); for (let i = 0; i <= n; i++) { const p = pt(a0 + (a1 - a0) * i / n, s); if (i) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]); } };
      // gondolas: base angle in ring space; index 2 is the broken one
      const GD = [[0.5, '#b88e9c'], [2.2, '#8eaa9e'], [2.95, '#b8ad84'], [3.7, '#8e9fb8'], [4.45, '#a191b6']];
      const gond = (i) => {
        const a = GD[i][0] + spin, p = pt(a, 1.02), col = GD[i][1];
        const broken = i === 2;
        let sw = Math.sin(t * 1.4 + i * 1.9) * (0.07 + (walk ? 0.12 : 0) + p2 * 0.05);
        if (i === 0) sw += dropW * 0.95 + Math.sin(t * 9) * dropW * 0.05;   // swings back on wind-up only (no forward tilt after release)
        if (broken) sw = 0.62 + Math.sin(t * 1.1) * 0.07;
        ctx.save(); ctx.translate(p[0], p[1]); ctx.rotate(sw); ctx.scale(1.25, 1.25);
        // hanger + chains
        ctx.strokeStyle = BINK; ctx.lineWidth = 3.2; ctx.beginPath();
        if (broken) { ctx.moveTo(0, 0); ctx.lineTo(11, 16); } else { ctx.moveTo(0, 0); ctx.lineTo(-10, 16); ctx.moveTo(0, 0); ctx.lineTo(10, 16); }
        ctx.stroke();
        ctx.strokeStyle = '#9a94a2'; ctx.lineWidth = 1.4; ctx.setLineDash([2.2, 1.6]); ctx.stroke(); ctx.setLineDash([]);
        circ(ctx, 0, 0, 3.2); fo(ctx, '#7a7484', 1.6, BINK);
        if (broken) { ctx.strokeStyle = '#9a94a2'; ctx.lineWidth = 1.4; ctx.setLineDash([2.2, 1.6]); ctx.beginPath(); ctx.moveTo(-11, 16); ctx.lineTo(-14 + Math.sin(t * 2) * 2, 8); ctx.stroke(); ctx.setLineDash([]); }
        // cabin
        ctx.beginPath(); ctx.moveTo(-16, 20); ctx.quadraticCurveTo(0, 8, 16, 20); ctx.closePath(); fo(ctx, col, 2.4, BINK);
        ctx.beginPath(); rr(ctx, -15, 19, 30, 26, [3, 3, 8, 8]); fo(ctx, col, 2.6, BINK);
        ctx.fillStyle = 'rgba(30,16,40,.3)'; ctx.fillRect(-14, 37, 28, 3); ell(ctx, -6, 41, 6, 3); ctx.fill();
        ctx.fillStyle = 'rgba(255,240,220,.18)'; ctx.fillRect(-13, 20, 26, 2);
        ctx.beginPath(); rr(ctx, -10, 23, 20, 11, 3); ctx.fillStyle = '#1a1230'; ctx.fill(); ctx.strokeStyle = 'rgba(255,240,230,.35)'; ctx.lineWidth = 1; ctx.stroke();
        if (!broken) {
          // a dim little rider glow in the window
          ctx.globalCompositeOperation = 'lighter'; sglow(ctx, 2, 29, 9, '255,170,235', 0.35 + (i === 0 ? dropW * 0.5 : 0)); ctx.globalCompositeOperation = 'source-over';
          ctx.fillStyle = '#ffd8f6'; circ(ctx, -1, 29, 1.3); ctx.fill(); circ(ctx, 4, 29, 1.3); ctx.fill();
        } else {
          // door hanging open + ink pouring out
          ctx.save(); ctx.translate(15, 22); ctx.rotate(0.9 + Math.sin(t * 1.7) * 0.1); ctx.beginPath(); rr(ctx, 0, 0, 5, 18, 1.5); fo(ctx, col, 1.8, BINK); ctx.restore();
          ctx.fillStyle = '#150a26'; const dl = 8 + (Math.sin(t * 1.3) + 1) * 6; rr(ctx, -8, 44, 3.4, dl, 1.7); ctx.fill(); circ(ctx, -6.3, 44 + dl, 2.8); ctx.fill();
        }
        ctx.strokeStyle = 'rgba(206,160,255,.6)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(-14, 42); ctx.lineTo(-14, 22); ctx.stroke();
        ctx.restore();
      };
      // gondolas whose pivots are on the upper half hang inside the ring → draw them behind the truss
      const upper = (i) => Math.sin(GD[i][0] + spin) < -0.2;
      for (let i = 0; i < GD.length; i++) if (upper(i)) gond(i);

      // ---- the broken ring: double rim + zigzag truss
      // rollers holding the ring
      for (const sx of [-1, 1]) { const rxp = sx * 30; circ(ctx, rxp, fy1 - 8, 8); fo(ctx, '#7a7484', 2.4, BINK); ctx.fillStyle = BINK; circ(ctx, rxp, fy1 - 8, 2); ctx.fill(); }
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      // truss zigzag between the rims
      const n = Math.ceil((A1 - A0) / 0.11);
      ctx.beginPath();
      for (let i = 0; i <= n; i++) { const p = pt(A0 + (A1 - A0) * i / n, i % 2 ? IN : 1); if (i) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]); }
      ctx.strokeStyle = BINK; ctx.lineWidth = 4.6; ctx.stroke(); ctx.strokeStyle = RINGC; ctx.lineWidth = 2.2; ctx.stroke();
      for (const s of [IN, 1]) {
        arcPath(s, A0, A1);
        ctx.strokeStyle = BINK; ctx.lineWidth = s === 1 ? 10 : 8.5; ctx.stroke();
        ctx.strokeStyle = RINGC; ctx.lineWidth = s === 1 ? 5.8 : 4.6; ctx.stroke();
      }
      // violet rim light along the upper-left of the outer rim
      arcPath(1.0, Math.max(A0, Math.PI + 0.3 + spin * 0), Math.min(A1, Math.PI * 1.45 + spin * 0));
      ctx.strokeStyle = RIM; ctx.lineWidth = 1.3; ctx.stroke();
      // broken ends: snapped stubs, a dangling bent strut, ink drips
      for (const [ea, dir] of [[A0, -1], [A1, 1]]) {
        const po = pt(ea, 1), pi = pt(ea, IN), pj = pt(ea + dir * 0.09, 1.07);
        ctx.strokeStyle = BINK; ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(po[0], po[1]); ctx.lineTo(pj[0], pj[1]); ctx.stroke();
        ctx.strokeStyle = RINGC; ctx.lineWidth = 2.6; ctx.stroke();
        const sw = Math.sin(t * 1.6 + dir) * 4;
        ctx.strokeStyle = BINK; ctx.lineWidth = 4.4; ctx.beginPath(); ctx.moveTo(pi[0], pi[1]); ctx.lineTo(pi[0] + 4 * dir + sw * 0.3, pi[1] + 14); ctx.lineTo(pi[0] + sw, pi[1] + 26); ctx.stroke();
        ctx.strokeStyle = '#a8939e'; ctx.lineWidth = 2; ctx.stroke();
        ctx.fillStyle = '#150a26'; const dl = 6 + (Math.sin(t * 1.2 + dir * 2) + 1) * 6; rr(ctx, po[0] - 1.7, po[1], 3.4, dl, 1.7); ctx.fill(); circ(ctx, po[0], po[1] + dl, 2.6); ctx.fill();
      }
      // ink drips off the underside of the ring
      ctx.fillStyle = '#150a26';
      for (let i = 0; i < 4 + p2 * 3; i++) {
        const a = A0 + (A1 - A0) * hsh(i + 3);
        if (Math.sin(a) < 0.25) continue;
        const p = pt(a, 1), l = 5 + (Math.sin(t * 1.1 + i * 2.2) + 1) * 6;
        rr(ctx, p[0] - 1.5, p[1], 3, l, 1.5); ctx.fill(); circ(ctx, p[0], p[1] + l, 2.3); ctx.fill();
      }
      // dim bulbs on the outer rim, some flickering, some dead
      const nb = Math.floor((A1 - A0) / 0.24);
      for (let i = 0; i <= nb; i++) {
        const a = A0 + (A1 - A0) * i / nb, p = pt(a, 1);
        const dead = hsh(i * 7.3) < 0.22;
        const fl = hsh(i * 13 + Math.floor(t * (3 + p2 * 6) + hsh(i) * 5));
        const lit = !dead && fl > (0.25 + p2 * 0.1);
        if (lit) { ctx.globalCompositeOperation = 'lighter'; sglow(ctx, p[0], p[1], 10, p2 ? '255,140,200' : '255,206,150', 0.45); ctx.globalCompositeOperation = 'source-over'; }
        circ(ctx, p[0], p[1], 3.4); ctx.fillStyle = lit ? (p2 ? '#ffc6e2' : '#ffe2b8') : '#3a2e44'; ctx.fill(); ctx.strokeStyle = BINK; ctx.lineWidth = 1.4; ctx.stroke();
      }
      ctx.lineCap = 'butt';
      // gondolas hanging below the ring line (in front)
      for (let i = 0; i < GD.length; i++) if (!upper(i)) gond(i);
      // wind-up: creak glow on the front gondola's pivot
      if (dropW > 0.02) { const p = pt(GD[0][0] + spin, 1.02); ctx.globalCompositeOperation = 'lighter'; sglow(ctx, p[0], p[1] + 24, 34, '255,120,190', dropW * 0.55); ctx.globalCompositeOperation = 'source-over'; }
    },
    // ---------------- ボス「最後の打者」 ----------------
    batter(ctx, u) {
      // 最後の打者 — the boy who quit little league after an injury; now a tall, faded cleanup hitter
      // waiting forever for the last at-bat. Mud-stained cream uniform, plain "4", taped wooden bat.
      const t = u.anim || 0, at = u.atk || 0, dash = clamp01(u.dash || 0), P2 = (u.phase || 1) >= 2;
      const wind = clamp01(u.wind || 0), w = ease(wind), wk = u.windKind;
      const swW = wind > 0 && wk === 'swing' ? w : 0, chW = wind > 0 && wk === 'charge' ? w : 0;
      const rel = wind <= 0 && at > 0 && dash <= 0 && (wk !== 'charge' || (u.stance || 0) > 0);   // swing release + follow-through (also the hit-back)
      const sp = rel ? 1 - at : 0;                                       // swing progress 0..1
      const sk = rel ? 1 - Math.pow(1 - clamp01(sp * 1.55), 2.2) : 0;   // eased bat sweep
      const rec = rel ? ease(clamp01((sp - 0.74) / 0.26)) : 0;           // settle back at the very end
      const m = rel ? 1 - rec : 0;                                       // weight of the swing pose
      const stc = (wind > 0 || dash > 0) ? 0 : ease(clamp01(u.stance || 0));
      const ready = Math.max(stc, swW);
      const drag = Math.max(chW, dash);
      const walk = !!u.walk && !dash && ready < 0.5 && !rel;
      const ph = t * 3.4, ws = walk ? Math.sin(ph) : 0;
      const br = Math.sin(t * 1.7) * 1.6;
      const CREAM = '#b4a68a', CREAM_D = '#7f7262', MAROON = '#6c3842', MAROON_D = '#4a2430', BINK = '#1c0f26', SKN = '#2a1c3a';
      ctx.lineJoin = 'round';
      const ik = (ax, ay, bx, by, l1, l2, px, py) => {
        let dx = bx - ax, dy = by - ay, d = Math.hypot(dx, dy) || 1;
        const mx = l1 + l2 - 0.5;
        if (d > mx) { bx = ax + dx / d * mx; by = ay + dy / d * mx; dx = bx - ax; dy = by - ay; d = mx; }
        const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
        let nx = -dy / d, ny = dx / d; if (nx * px + ny * py < 0) { nx = -nx; ny = -ny; }
        return [ax + dx / d * a + nx * h, ay + dy / d * a + ny * h, bx, by];
      };

      // ---- base pose (rest / walk / stance / wind-ups / dash) ----
      let bodyX = -swW * 6 + drag * 6;
      let crouch = ready * 11 + chW * 22 + dash * 9 - (walk ? Math.abs(Math.cos(ph)) * 3 : 0);
      let ff = 18 + ws * 18, bf = -16 - ws * 18, heel = 0;
      let fl = walk ? Math.max(0, Math.cos(ph)) * 8 : 0, bl = walk ? Math.max(0, -Math.cos(ph)) * 8 : 0;
      ff = lerp(ff, 34, ready); bf = lerp(bf, -32, ready); fl *= 1 - ready; bl *= 1 - ready;
      fl += swW * 13; ff -= swW * 10;                                    // leg kick while loading the swing
      if (chW > 0) { ff = lerp(ff, 30, chW); bf = lerp(bf, -42, chW); fl *= 1 - chW; bl *= 1 - chW; heel = chW * 6; }
      if (dash > 0) { const rs = Math.sin(t * 13); ff = lerp(ff, 38 + rs * 18, dash); bf = lerp(bf, -36 - rs * 14, dash); fl = lerp(fl, Math.max(0, rs) * 15, dash); bl = lerp(bl, Math.max(0, -rs) * 13, dash); }
      // bat: grip point (bottom hand) + 2D angle
      let gx = 12, gy = -38, ba = -2.2 + (walk ? Math.sin(ph) * 0.05 : Math.sin(t * 1.7) * 0.03);
      gx = lerp(gx, -12, ready); gy = lerp(gy, -74, ready); ba = lerp(ba, -1.95 + Math.sin(t * 4.2) * 0.07 * stc, ready);
      gx -= swW * 16; gy += swW * 6; ba = lerp(ba, -2.8, swW);
      gx = lerp(gx, -24, drag); gy = lerp(gy, -8, drag); ba = lerp(ba, -3.62, drag);
      let bdx = Math.cos(ba), bdy = Math.sin(ba), bz = -1;
      // ---- swing pose (release → contact → follow-through, which steps FORWARD) ----
      if (rel) {
        const th = Math.PI - sk * (2 * Math.PI - 0.5);
        const phi = sk < 0.5 ? lerp(-0.36, 0.12, sk / 0.5) : lerp(0.12, -1.0, (sk - 0.5) / 0.5);
        const k1 = ease(clamp01(sk / 0.5)), k2 = ease(clamp01((sk - 0.5) / 0.5));
        const sgx = sk < 0.5 ? lerp(-28, 28, k1) : lerp(28, 12, k2);
        const sgy = sk < 0.5 ? lerp(-66, -42, k1) : lerp(-42, -80, k2);
        const step = 18 * ease(clamp01(sp * 1.8));
        const kf = ease(clamp01(sp * 2));
        bodyX = lerp(bodyX, step, m); crouch = lerp(crouch, 8 + 6 * Math.sin(clamp01(sp * 1.6) * Math.PI), m);
        ff = lerp(ff, lerp(24, 56, kf), m); fl = lerp(fl, Math.sin(clamp01(sp * 2) * Math.PI) * 7, m);
        bf = lerp(bf, lerp(-32, -10, ease(clamp01(sp * 1.4 - 0.15))), m); bl *= 1 - m;
        heel = lerp(heel, ease(clamp01(sp * 2 - 0.35)) * 9, m);
        gx = lerp(gx, sgx, m); gy = lerp(gy, sgy, m);
        bdx = lerp(bdx, Math.cos(phi) * Math.cos(th), m); bdy = lerp(bdy, Math.sin(phi), m);
        bz = rec > 0.5 ? -1 : Math.sin(th);
      }
      const hy = -112 + crouch;
      gx += bodyX; gy += hy;
      const lean = chW * 0.32 + dash * 0.38;                             // forward crouch only for base-running
      const shake = (swW + chW) * Math.sin(t * 50) * 1.3;
      const glowK = P2 ? 1.5 : 1;

      // ---- ground: ink puddle, chalk batter's box, stance ring ----
      ctx.fillStyle = 'rgba(12,6,24,.85)'; ell(ctx, 4 + bodyX * 0.5, -1, 56, 7); ctx.fill();
      for (let i = 0; i < 5; i++) { const px = -46 + i * 24 + Math.sin(i * 3) * 6, pr = 4 + (Math.sin(t * 1.3 + i) + 1) * 2.5; ell(ctx, px, -1, pr * 1.6, pr * 0.4); ctx.fill(); }
      if (ready > 0.02) {
        ctx.strokeStyle = `rgba(235,226,210,${(0.34 * ready).toFixed(3)})`; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(-58, -6); ctx.lineTo(70, -6); ctx.lineTo(78, 6); ctx.lineTo(-50, 6); ctx.closePath(); ctx.stroke();
      }
      const ringA = stc * (0.82 + Math.sin(t * 3.1) * 0.18);
      if (ringA > 0.02) {
        // pale "I will hit it back" arc in front of him — one smooth band, no ticks
        const cx = bodyX + 14, cy = hy - 46, R = 120 + Math.sin(t * 3.1) * 3;
        ctx.globalCompositeOperation = 'lighter';
        sglow(ctx, cx + 56, cy, 104, '210,170,255', 0.2 * ringA * glowK);
        ctx.lineCap = 'round';
        for (const L of [[18, 0.08], [8, 0.2], [2.6, 0.85]]) {
          ctx.strokeStyle = `rgba(250,234,255,${(L[1] * ringA).toFixed(3)})`; ctx.lineWidth = L[0];
          ctx.beginPath(); ctx.arc(cx, cy, R, -1.22, 1.12); ctx.stroke();
        }
        ctx.strokeStyle = `rgba(236,200,255,${(0.32 * ringA).toFixed(3)})`; ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.arc(cx, cy, R + 15, -0.95, 0.88); ctx.stroke();
        ctx.lineCap = 'butt';
        ctx.globalCompositeOperation = 'source-over';
      }
      ctx.globalCompositeOperation = 'lighter';
      sglow(ctx, bodyX, -124, 138, '150,60,200', (P2 ? 0.3 : 0.18) + w * 0.2 + dash * 0.15);
      ctx.globalCompositeOperation = 'source-over';
      if (dash > 0 || chW > 0.3) {
        const sl = Math.max(dash, chW * 0.6);
        ctx.strokeStyle = `rgba(220,170,255,${(0.45 * sl).toFixed(2)})`; ctx.lineWidth = 2;
        ctx.beginPath();
        for (let i = 0; i < 6; i++) { const yy = -24 - i * 32, x0 = -52 - ((t * 420 + i * 47) % 50); ctx.moveTo(x0, yy); ctx.lineTo(x0 - 34 - i * 4, yy); }
        ctx.stroke();
        ctx.fillStyle = `rgba(150,120,110,${(0.35 * dash).toFixed(3)})`;
        for (let i = 0; i < 3; i++) { const p = (t * 2.2 + i / 3) % 1; ell(ctx, bf - 10 - p * 50, -4 - p * 10, 6 + p * 10, 4 + p * 6); ctx.fill(); }
      }

      // ---- swing trail: a flat crescent around the body (curved, never radial) ----
      if (rel && sk > 0.06 && sk < 0.9) {
        const th = Math.PI - sk * (2 * Math.PI - 0.5), cx = bodyX + 4, cy = hy - 40, rx = 112, ry = 30;
        const fade = Math.sin(clamp01((sk - 0.06) / 0.84) * Math.PI);
        ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round';
        for (let i = 0; i < 9; i++) {
          const a0 = th + i * 0.17, a1 = th + (i + 1) * 0.17;
          ctx.strokeStyle = `rgba(255,232,250,${(0.55 * fade * (1 - i / 9)).toFixed(3)})`; ctx.lineWidth = 12 * (1 - i / 10);
          ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, Math.min(a0, a1), Math.max(a0, a1)); ctx.stroke();
        }
        ctx.lineCap = 'butt'; ctx.globalCompositeOperation = 'source-over';
      }

      // ---- pieces ----
      function bat() {
        const f = Math.min(1, Math.hypot(bdx, bdy)) || 0.001, nl = Math.hypot(bdx, bdy) || 1;
        const ux = bdx / nl, uy = bdy / nl, nx = -uy, ny = ux;
        const P = (s, o) => [gx + ux * s * f + nx * o, gy + uy * s * f + ny * o];
        const prof = [[-4, 3.6], [34, 4.2], [52, 6.6], [92, 7.8]];
        ctx.beginPath();
        let q = P(prof[0][0], prof[0][1]); ctx.moveTo(q[0], q[1]);
        for (const p of prof) { q = P(p[0], p[1]); ctx.lineTo(q[0], q[1]); }
        for (let i = prof.length - 1; i >= 0; i--) { q = P(prof[i][0], -prof[i][1]); ctx.lineTo(q[0], q[1]); }
        ctx.closePath();
        ctx.fillStyle = '#a7845c'; ctx.fill(); ctx.strokeStyle = BINK; ctx.lineWidth = 3; ctx.stroke();
        // grain highlight
        const h0 = P(40, -2.4), h1 = P(88, -4.2);
        ctx.strokeStyle = 'rgba(240,215,170,.4)'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(h0[0], h0[1]); ctx.lineTo(h1[0], h1[1]); ctx.stroke();
        const g0 = P(58, 2.6), g1 = P(86, 3.4);
        ctx.strokeStyle = 'rgba(60,30,30,.45)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(g0[0], g0[1]); ctx.lineTo(g1[0], g1[1]); ctx.stroke();
        // barrel end cap (foreshortens into an oval when the bat points at us)
        const e = P(92, 0);
        ctx.beginPath(); ctx.ellipse(e[0], e[1], Math.max(1.8, 7.8 * Math.sqrt(Math.max(0, 1 - f * f))), 7.8, Math.atan2(uy, ux), 0, TAU);
        ctx.fillStyle = '#8c6c48'; ctx.fill(); ctx.strokeStyle = BINK; ctx.lineWidth = 2.4; ctx.stroke();
        // taped grip (faded cloth tape, diagonal wraps)
        ctx.beginPath(); q = P(-3, 4.6); ctx.moveTo(q[0], q[1]); q = P(24, 4.8); ctx.lineTo(q[0], q[1]); q = P(24, -4.8); ctx.lineTo(q[0], q[1]); q = P(-3, -4.6); ctx.lineTo(q[0], q[1]); ctx.closePath();
        ctx.fillStyle = '#d6cdb8'; ctx.fill(); ctx.strokeStyle = BINK; ctx.lineWidth = 2; ctx.stroke();
        ctx.strokeStyle = 'rgba(110,90,80,.7)'; ctx.lineWidth = 1.1; ctx.beginPath();
        for (let s = 1; s < 24; s += 4.2) { const a = P(s, 4.6), b = P(s + 3.4, -4.6); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); }
        ctx.stroke();
        q = P(-6, 0); circ(ctx, q[0], q[1], 5.6); fo(ctx, '#8c6c48', 2.4, BINK);
        // ink drip off the barrel when it hangs still
        if (!rel && drag < 0.5) {
          const dl = 6 + (Math.sin(t * 1.3) + 1) * (P2 ? 7 : 4);
          ctx.fillStyle = '#140a20'; rr(ctx, e[0] - 1.6, e[1] + 2, 3.2, dl, 1.6); ctx.fill(); circ(ctx, e[0], e[1] + 2 + dl, 2.4); ctx.fill();
        }
      }
      function leg(hx, fx, lift, near, hl) {
        const fy = -10 - lift - hl;
        const k = ik(hx, hy + 4, fx, fy, 55, 52, 1, 0), kx = k[0], ky = k[1], ax = k[2], ay = k[3];
        const pc = near ? CREAM : CREAM_D, sc = near ? MAROON : MAROON_D;
        bone(ctx, kx, ky, ax, ay, 14, sc, BINK, 3.2);
        // faded stirrup stripe
        ctx.strokeStyle = near ? 'rgba(220,200,180,.4)' : 'rgba(200,180,170,.25)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(lerp(kx, ax, 0.55) - 6, lerp(ky, ay, 0.55)); ctx.lineTo(lerp(kx, ax, 0.55) + 6, lerp(ky, ay, 0.55)); ctx.stroke();
        bone(ctx, hx, hy + 2, kx, ky, 24, pc, BINK, 3.2);
        ell(ctx, kx + 1, ky + 5, 13, 9.5, Math.atan2(ky - hy, kx - hx) - Math.PI / 2); fo(ctx, pc, 3, BINK);
        ctx.strokeStyle = near ? 'rgba(206,160,255,.5)' : 'rgba(206,160,255,.25)'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(hx - 11, hy + 6); ctx.lineTo(kx - 11, ky); ctx.stroke();
        ctx.fillStyle = 'rgba(96,64,44,.38)'; ell(ctx, kx + 3, ky + 3, 7, 5, 0.4); ctx.fill(); ell(ctx, lerp(hx, kx, 0.6) - 3, lerp(hy, ky, 0.6), 4, 3); ctx.fill();
        // cleat (heel can lift by rotating around the toe)
        ctx.save(); ctx.translate(ax + 18, ay + 10); ctx.rotate(hl * 0.05); ctx.translate(-(ax + 18), -(ay + 10));
        ctx.beginPath(); ctx.moveTo(ax - 10, ay - 4); ctx.lineTo(ax + 7, ay - 5); ctx.quadraticCurveTo(ax + 20, ay + 1, ax + 21, ay + 7); ctx.lineTo(ax + 21, ay + 10); ctx.lineTo(ax - 12, ay + 10); ctx.closePath();
        fo(ctx, near ? '#2e2232' : '#221a28', 3, BINK);
        ctx.strokeStyle = 'rgba(220,210,200,.35)'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(ax - 6, ay + 2); ctx.lineTo(ax + 10, ay + 1); ctx.stroke();
        ctx.restore();
      }
      function arm(sx, sy, hx2, hy2, near) {
        const k = ik(sx, sy, hx2, hy2, 38, 36, 0.2, 1), ex = k[0], ey = k[1], hx = k[2], hy3 = k[3];
        bone(ctx, sx, sy, ex, ey, 15, near ? MAROON : MAROON_D, BINK, 3.2);
        bone(ctx, sx, sy, lerp(sx, ex, 0.42), lerp(sy, ey, 0.42), 18, near ? CREAM : CREAM_D, BINK, 3);
        bone(ctx, ex, ey, hx, hy3, 12, SKN, BINK, 3);
        ctx.strokeStyle = RIM; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(ex, ey - 5); ctx.lineTo(lerp(ex, hx, 0.7), lerp(ey, hy3, 0.7) - 5); ctx.stroke();
        circ(ctx, hx, hy3, 8.4); fo(ctx, near ? '#b4a286' : '#8e7e6a', 2.6, BINK);
        ctx.strokeStyle = near ? MAROON : MAROON_D; ctx.lineWidth = 2.2; ctx.beginPath(); ctx.arc(hx, hy3, 5, 0.4, 2.2); ctx.stroke();
      }

      // ---- assemble ----
      const sB = [bodyX - 12 + shake, hy - 66 + br * 0.4], sF = [bodyX + 8 - swW * 4 + shake, hy - 64 + br * 0.4];
      const nl = Math.hypot(bdx, bdy) || 1;
      const topH = [gx + bdx * 9, gy + bdy * 9];
      const pump = [bodyX + 30 + Math.sin(t * 13) * 18 * dash, hy - 34 - Math.cos(t * 13) * 10 * dash];
      const fH = [lerp(topH[0], pump[0], drag), lerp(topH[1], pump[1], drag)];
      void nl;
      ctx.save();
      ctx.translate(bodyX, hy); ctx.rotate(lean); ctx.translate(-bodyX, -hy);
      if (bz <= 0) bat();
      arm(sB[0], sB[1], gx, gy, false);
      ctx.restore();
      leg(bodyX - 10 + shake, bf, bl, false, heel);
      leg(bodyX + 10 + shake, ff, fl, true, 0);
      ctx.save();
      ctx.translate(bodyX, hy); ctx.rotate(lean); ctx.translate(-bodyX, -hy);
      const bx = bodyX + shake, sh = hy - 70 + br * 0.4;
      // seat of the knickers
      ell(ctx, bx, hy + 2, 25, 15); fo(ctx, CREAM, 3, BINK);
      // jersey
      const torso = () => {
        ctx.beginPath();
        ctx.moveTo(bx - 28, sh + 6);
        ctx.quadraticCurveTo(bx - 4, sh - 7, bx + 22, sh + 2);
        ctx.bezierCurveTo(bx + 35, sh + 18, bx + 33, sh + 48, bx + 25, hy);
        ctx.lineTo(bx - 23, hy);
        ctx.bezierCurveTo(bx - 33, sh + 48, bx - 37, sh + 22, bx - 28, sh + 6);
        ctx.closePath();
      };
      torso();
      ctx.fillStyle = lgc(ctx, 'batter-jersey', 0, -190, 0, -100, [[0, '#c2b496'], [0.6, '#978a76'], [1, '#5e5260']]); ctx.fill();
      ctx.save(); ctx.clip();
      ctx.strokeStyle = 'rgba(110,60,70,.16)'; ctx.lineWidth = 1.2;
      ctx.beginPath(); for (let i = -40; i < 44; i += 7) { ctx.moveTo(bx + i, sh - 10); ctx.lineTo(bx + i + 3, hy + 4); } ctx.stroke();
      ctx.fillStyle = 'rgba(30,14,40,.28)'; ctx.fillRect(bx - 50, sh - 10, 22, 90);
      ctx.fillStyle = 'rgba(96,64,44,.34)'; ell(ctx, bx + 18, hy - 14, 12, 8, 0.3); ctx.fill(); ell(ctx, bx - 6, hy - 6, 9, 5); ctx.fill(); ell(ctx, bx + 26, sh + 26, 4, 6); ctx.fill();
      // plain faded number 4 (on the back half)
      const nx0 = bx - 22, ny0 = sh + 16, nfl = ctx.getTransform().a < 0 ? -1 : 1;
      ctx.save(); ctx.translate(nx0 + 7, 0); ctx.scale(nfl, 1); ctx.translate(-(nx0 + 7), 0);   // keep the 4 readable when flipped
      ctx.lineCap = 'round'; ctx.strokeStyle = 'rgba(112,52,66,.72)'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(nx0 + 10, ny0); ctx.lineTo(nx0, ny0 + 14); ctx.lineTo(nx0 + 14, ny0 + 14); ctx.moveTo(nx0 + 10, ny0); ctx.lineTo(nx0 + 10, ny0 + 22); ctx.stroke();
      ctx.lineCap = 'butt'; ctx.restore();
      ctx.restore();
      torso(); ctx.strokeStyle = BINK; ctx.lineWidth = 3.4; ctx.stroke();
      ctx.strokeStyle = 'rgba(206,160,255,.55)'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(bx - 27, sh + 9); ctx.bezierCurveTo(bx - 35, sh + 24, bx - 31, sh + 48, bx - 22, hy - 2); ctx.stroke();
      // placket + buttons
      ctx.strokeStyle = 'rgba(80,50,50,.5)'; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(bx + 20, sh + 2); ctx.quadraticCurveTo(bx + 26, sh + 34, bx + 20, hy); ctx.stroke();
      ctx.fillStyle = 'rgba(80,50,50,.6)'; for (let i = 0; i < 3; i++) { circ(ctx, bx + 23 + (i === 1 ? 1 : 0), sh + 14 + i * 16, 1.5); ctx.fill(); }
      // belt
      ctx.beginPath(); rr(ctx, bx - 25, hy - 7, 51, 9, 3); fo(ctx, MAROON_D, 2.6, BINK);
      ctx.beginPath(); rr(ctx, bx + 12, hy - 8, 9, 11, 2); fo(ctx, '#8e7e6a', 2, BINK);
      // ink drips from under the belt
      ctx.fillStyle = '#140a24';
      for (let i = 0; i < 4; i++) { const x = bx - 18 + i * 11, l = 5 + (Math.sin(t * 1.2 + i * 2) + 1) * 6; rr(ctx, x, hy + 10, 3.2, l, 1.6); ctx.fill(); circ(ctx, x + 1.6, hy + 10 + l, 2.4); ctx.fill(); }
      // neck + head
      const hc = [bx + 10, hy - 94 + br * 0.5];
      bone(ctx, bx + 6, sh + 4, hc[0] - 1, hc[1] + 12, 13, SKN, BINK, 3);
      // tuft of hair at the nape
      ctx.beginPath(); ctx.moveTo(hc[0] - 19, hc[1] - 2); ctx.quadraticCurveTo(hc[0] - 24, hc[1] + 10, hc[0] - 14, hc[1] + 14); ctx.lineTo(hc[0] - 8, hc[1] + 4); ctx.closePath(); fo(ctx, '#20142c', 2.4, BINK);
      circ(ctx, hc[0], hc[1], 19); ctx.fillStyle = SKN; ctx.fill();
      ctx.save(); ctx.clip();
      ctx.fillStyle = '#0c0614'; ell(ctx, hc[0] + 8, hc[1] - 2, 24, 13); ctx.fill();      // shadow under the brim
      ctx.restore();
      circ(ctx, hc[0], hc[1], 19); ctx.strokeStyle = BINK; ctx.lineWidth = 3; ctx.stroke();
      ctx.strokeStyle = RIM; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(hc[0], hc[1], 18, Math.PI * 0.6, Math.PI * 1.1); ctx.stroke();
      // glowing eyes in the shadow
      ctx.globalCompositeOperation = 'lighter';
      sglow(ctx, hc[0] + 15, hc[1] + 2, (26 + w * 12) * (P2 ? 1.25 : 1), '255,160,235', (0.5 + w * 0.4 + dash * 0.2) * glowK);
      ctx.globalCompositeOperation = 'source-over';
      if (P2) {
        ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round';
        ctx.strokeStyle = 'rgba(255,170,236,.5)'; ctx.lineWidth = 2.6; ctx.beginPath(); ctx.moveTo(hc[0] + 6, hc[1] + 2); ctx.quadraticCurveTo(hc[0] - 8, hc[1] + 1 + Math.sin(t * 6) * 2, hc[0] - 26, hc[1] - 3 + Math.sin(t * 5) * 3); ctx.stroke();
        ctx.lineCap = 'butt'; ctx.globalCompositeOperation = 'source-over';
      }
      ctx.fillStyle = '#ffd8f4';
      ell(ctx, hc[0] + 9, hc[1] + 2, 3.4, 2.3 - w * 0.7, -0.15); ctx.fill(); ell(ctx, hc[0] + 20, hc[1] + 1.6, 3.6, 2.3 - w * 0.7, 0.1); ctx.fill();
      // ink tear
      const tl = 5 + (Math.sin(t * 0.9 + 1) + 1) * 4;
      ctx.fillStyle = '#0c0614'; rr(ctx, hc[0] + 8, hc[1] + 4, 2.4, tl, 1.2); ctx.fill(); circ(ctx, hc[0] + 9.2, hc[1] + 4 + tl, 1.9); ctx.fill();
      // cap crown
      ctx.beginPath(); ctx.moveTo(hc[0] - 20, hc[1] - 1);
      ctx.bezierCurveTo(hc[0] - 21, hc[1] - 27, hc[0] + 18, hc[1] - 31, hc[0] + 21, hc[1] - 5);
      ctx.lineTo(hc[0] + 20, hc[1] - 1); ctx.closePath();
      fo(ctx, '#74404a', 3, BINK);
      ctx.strokeStyle = 'rgba(230,190,190,.25)'; ctx.lineWidth = 1.3;
      ctx.beginPath(); ctx.moveTo(hc[0] - 2, hc[1] - 22); ctx.quadraticCurveTo(hc[0] + 6, hc[1] - 12, hc[0] + 4, hc[1] - 1); ctx.stroke();
      ctx.fillStyle = 'rgba(30,10,30,.3)'; ell(ctx, hc[0] - 12, hc[1] - 10, 6, 9, 0.3); ctx.fill();
      circ(ctx, hc[0] + 1, hc[1] - 21, 2.6); fo(ctx, '#74404a', 2, BINK);
      // brim (phase 2: a chunk broken off + crack)
      ctx.beginPath(); ctx.moveTo(hc[0] + 14, hc[1] - 3);
      if (P2) { ctx.quadraticCurveTo(hc[0] + 24, hc[1] - 7, hc[0] + 29, hc[1] - 5); ctx.lineTo(hc[0] + 33, hc[1] + 1); ctx.lineTo(hc[0] + 38, hc[1] - 3); ctx.lineTo(hc[0] + 43, hc[1] + 2); }
      else { ctx.quadraticCurveTo(hc[0] + 30, hc[1] - 7, hc[0] + 43, hc[1] + 1); }
      ctx.quadraticCurveTo(hc[0] + 32, hc[1] + 4.5, hc[0] + 16, hc[1] + 2); ctx.closePath();
      fo(ctx, '#5c3038', 2.6, BINK);
      if (P2) {
        ctx.strokeStyle = BINK; ctx.lineWidth = 1.6; ctx.beginPath();
        ctx.moveTo(hc[0] + 33, hc[1] + 1); ctx.lineTo(hc[0] + 27, hc[1] + 2); ctx.lineTo(hc[0] + 21, hc[1] - 0.5);
        ctx.moveTo(hc[0] + 8, hc[1] - 26); ctx.lineTo(hc[0] + 12, hc[1] - 16); ctx.lineTo(hc[0] + 9, hc[1] - 9); ctx.stroke();
        const dl = 6 + (Math.sin(t * 1.4) + 1) * 6;
        ctx.fillStyle = '#140a20'; rr(ctx, hc[0] + 29, hc[1] + 2, 2.6, dl, 1.3); ctx.fill(); circ(ctx, hc[0] + 30.3, hc[1] + 2 + dl, 2); ctx.fill();
      }
      if (bz > 0) bat();
      arm(sF[0], sF[1], fH[0], fH[1], true);
      ctx.restore();
      // ink motes rising
      ctx.fillStyle = 'rgba(200,140,255,.7)';
      for (let i = 0; i < 5; i++) { const p = (t * 0.35 + i / 5) % 1, mx = -40 + i * 20 + Math.sin(t + i) * 8; ctx.fillRect(mx, -20 - p * 190, 2.4, 2.4); }
    },

    // ---------------- ボス「深海の歌姫」 ----------------
    siren(ctx, u) {
      // 深海の歌姫 — a picture-book mermaid princess who sang at the bottom of the sea, now faded and sad.
      const t = u.anim || 0, at = u.atk || 0, P2 = (u.phase || 1) >= 2;
      const wind = clamp01(u.wind || 0), w = ease(wind);
      const song = wind > 0 && (u.windKind === 'song' || !u.windKind) ? w : 0;
      const blow = wind <= 0 && at > 0 ? at : 0;
      const bp = blow > 0 ? 1 - blow : 0;                    // bubble flight progress
      const bArm = blow > 0 ? ease(clamp01(blow * 1.6)) : 0;  // arm stays out while the bubble leaves
      const walk = !!u.walk;
      const sw = t * (walk ? 3.4 : 1.6);
      const hov = 7 + Math.sin(t * 1.6) * 4 + (P2 ? 4 : 0);
      const TEAL = '#4f7a78', TEAL_D = '#2c3f4e', CORAL = '#b47c7a', HAIR = '#94566a', HAIR_D = '#5a2c48', SKN = '#2e2442', SINK = '#120a1e';
      const wild = P2 ? 1 : 0;
      ctx.lineJoin = 'round';
      const ik = (ax, ay, bx, by, l1, l2, px, py) => {
        let dx = bx - ax, dy = by - ay, d = Math.hypot(dx, dy) || 1;
        const mx = l1 + l2 - 0.5;
        if (d > mx) { bx = ax + dx / d * mx; by = ay + dy / d * mx; dx = bx - ax; dy = by - ay; d = mx; }
        const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
        let nx = -dy / d, ny = dx / d; if (nx * px + ny * py < 0) { nx = -nx; ny = -ny; }
        return [ax + dx / d * a + nx * h, ay + dy / d * a + ny * h, bx, by];
      };
      const bz3 = (p0, p1, p2, p3, s) => { const r = 1 - s; return [r * r * r * p0[0] + 3 * r * r * s * p1[0] + 3 * r * s * s * p2[0] + s * s * s * p3[0], r * r * r * p0[1] + 3 * r * r * s * p1[1] + 3 * r * s * s * p2[1] + s * s * s * p3[1]]; };
      // tapered ribbon along a centreline (hair locks, tail)
      function ribbon(P, wf) {
        const L = [], R = [], n = P.length;
        for (let i = 0; i < n; i++) {
          const a = P[Math.max(0, i - 1)], b = P[Math.min(n - 1, i + 1)];
          let tx = b[0] - a[0], ty = b[1] - a[1]; const d = Math.hypot(tx, ty) || 1; tx /= d; ty /= d;
          const ww = wf(i / (n - 1));
          L.push([P[i][0] - ty * ww, P[i][1] + tx * ww]); R.push([P[i][0] + ty * ww, P[i][1] - tx * ww]);
        }
        ctx.beginPath(); ctx.moveTo(L[0][0], L[0][1]);
        for (let i = 1; i < n; i++) ctx.lineTo(L[i][0], L[i][1]);
        for (let i = n - 1; i >= 0; i--) ctx.lineTo(R[i][0], R[i][1]);
        ctx.closePath();
      }
      const curve = (p0, p1, p2, p3, n) => { const o = []; for (let i = 0; i <= n; i++) o.push(bz3(p0, p1, p2, p3, i / n)); return o; };
      function bubble(x, y, r, a) {
        const pa = ctx.globalAlpha; ctx.globalAlpha = pa * a;
        circ(ctx, x, y, r); ctx.fillStyle = 'rgba(150,200,210,.18)'; ctx.fill();
        ctx.strokeStyle = 'rgba(10,6,24,.7)'; ctx.lineWidth = 2; ctx.stroke();
        ctx.strokeStyle = 'rgba(210,240,245,.85)'; ctx.lineWidth = 1.1; ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,.8)'; circ(ctx, x - r * 0.35, y - r * 0.38, Math.max(0.6, r * 0.22)); ctx.fill();
        ctx.globalAlpha = pa;
      }

      // ---- ground: ink puddle (stays on the floor while she hovers) ----
      ctx.fillStyle = 'rgba(12,6,24,.8)'; ell(ctx, -10, -1, 54, 6.5); ctx.fill();
      for (let i = 0; i < 4; i++) { const px = -52 + i * 28 + Math.sin(i * 2.3) * 6, pr = 4 + (Math.sin(t * 1.2 + i) + 1) * 2.4; ell(ctx, px, -1, pr * 1.7, pr * 0.42); ctx.fill(); }
      ctx.globalCompositeOperation = 'lighter';
      sglow(ctx, 0, -124, 136, '120,70,210', (P2 ? 0.3 : 0.2) + song * 0.25);
      ctx.globalCompositeOperation = 'source-over';

      ctx.save();
      ctx.translate(0, -hov);
      const hc = [6, -186 + Math.sin(t * 1.6 + 0.6) * 1.2];
      // ---- hair (back locks) — drifts like underwater; phase 2 floats wildly upward ----
      const locks = [], LW = [13, 12, 11, 9.5, 8.5];
      for (let k = 0; k < 5; k++) {
        const s0 = [hc[0] - 2 - k * 3, hc[1] - 12 + k * 5];
        const amp = 7 + k * 1.6 + wild * 7 + (walk ? 3 : 0);
        const wv = (o) => Math.sin(sw * 1.25 + k * 1.1 + o);
        const calm = [hc[0] - 22 - k * 7 + wv(2) * amp * 0.6 - (walk ? 16 : 0), hc[1] + 64 + k * 9 - (walk ? 8 : 0)];
        const fly = [hc[0] - 52 - k * 13 + wv(2) * 8, hc[1] - 40 + k * 19 + wv(1) * 10];
        const e = [lerp(calm[0], fly[0], wild), lerp(calm[1], fly[1], wild)];
        const c1 = [s0[0] - 20, s0[1] + lerp(14, -6, wild) + wv(0) * 3];
        const c2 = [lerp(s0[0], e[0], 0.55) + wv(1) * amp + lerp(10, 0, wild), lerp(s0[1], e[1], 0.62) + lerp(0, -16 - k * 4, wild) + wv(1.6) * amp * wild];
        const P = curve(s0, c1, c2, e, 16);
        // curl at the tip
        const pe = P[P.length - 1], pp = P[P.length - 2], ca = Math.atan2(pe[1] - pp[1], pe[0] - pp[0]);
        for (let i = 1; i <= 3; i++) { const a = ca + i * 0.42 * (k % 2 ? 1 : -1); P.push([pe[0] + Math.cos(a) * i * 1.8, pe[1] + Math.sin(a) * i * 1.8]); }
        locks.push(P);
      }
      for (let k = locks.length - 1; k >= 0; k--) {
        ribbon(locks[k], (s) => (1 - s * 0.9) * LW[k] * (1 - wild * 0.15) + 1);
        ctx.fillStyle = k % 2 ? HAIR : '#86495e'; ctx.fill();
        ctx.strokeStyle = SINK; ctx.lineWidth = 2.2; ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(230,170,200,.28)'; ctx.lineWidth = 1.2;
      for (let k = 0; k < 5; k += 2) { const L = locks[k]; ctx.beginPath(); ctx.moveTo(L[2][0] + 2, L[2][1]); for (let i = 3; i < 11; i++) ctx.lineTo(L[i][0] + 2, L[i][1] - 1); ctx.stroke(); }

      // ---- arms (pose targets) ----
      const sB = [-6, -158], sF = [7, -157];
      let fh = [15, -134 + Math.sin(t * 1.6) * 1.5], bh = [10, -128];
      fh = [lerp(fh[0], 46, song), lerp(fh[1], -188, song)]; bh = [lerp(bh[0], -42, song), lerp(bh[1], -186, song)];
      fh = [lerp(fh[0], 40, bArm), lerp(fh[1], -170, bArm)];
      if (walk && song <= 0 && bArm <= 0) { bh = [-10, -124]; }
      function arm(s, h, near) {
        const k = ik(s[0], s[1], h[0], h[1], 26, 25, 0, 1);
        eLimb(ctx, s[0], s[1], (s[0] + k[0]) / 2, (s[1] + k[1]) / 2, k[0], k[1], 6.6, near ? SKN : '#221a34');
        eLimb(ctx, k[0], k[1], (k[0] + k[2]) / 2, (k[1] + k[3]) / 2, k[2], k[3], 5.8, near ? SKN : '#221a34');
        circ(ctx, k[2], k[3], 3.8); ctx.fillStyle = near ? SKN : '#221a34'; ctx.fill(); ctx.strokeStyle = EINK; ctx.lineWidth = 1.6; ctx.stroke();
        if (near) { ctx.strokeStyle = RIM; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(s[0], s[1] - 3); ctx.quadraticCurveTo((s[0] + k[0]) / 2, (s[1] + k[1]) / 2 - 3, k[0], k[1] - 3); ctx.stroke(); }
        // coral bangle
        ctx.strokeStyle = SINK; ctx.lineWidth = 4.4; ctx.beginPath(); ctx.moveTo(lerp(k[0], k[2], 0.72) - 2, lerp(k[1], k[3], 0.72) - 2); ctx.lineTo(lerp(k[0], k[2], 0.72) + 2, lerp(k[1], k[3], 0.72) + 2); ctx.stroke();
        ctx.strokeStyle = CORAL; ctx.lineWidth = 2.4; ctx.stroke();
      }
      arm(sB, bh, false);

      // ---- tail, curled under her ----
      const sy = Math.sin(sw), sy2 = Math.sin(sw + 1.1);
      const T0 = [2, -112], T1 = [26, -66], T2 = [10 + sy * 5, -20], T3 = [-36 + sy2 * 7, -20 + Math.cos(sw + 1.1) * 3];
      const tail = curve(T0, T1, T2, T3, 22);
      const tw = (s) => lerp(22, 7, Math.pow(s, 1.1)) + Math.sin(s * Math.PI) * 4;
      // fin (behind the tail end)
      const tn = tail[tail.length - 1], tp = tail[tail.length - 3], fa = Math.atan2(tn[1] - tp[1], tn[0] - tp[0]);
      ctx.save(); ctx.translate(tn[0], tn[1]); ctx.rotate(fa);
      const fw = Math.sin(sw * 1.4) * 4;
      const finPath = () => {
        ctx.beginPath(); ctx.moveTo(-4, -5);
        ctx.bezierCurveTo(10, -12, 22, -30 + fw, 34, -28 + fw);
        ctx.quadraticCurveTo(26, -12, 22, 0);
        ctx.quadraticCurveTo(28, 14, 32, 26 - fw);
        ctx.bezierCurveTo(20, 26 - fw, 8, 12, -4, 5);
        ctx.closePath();
      };
      finPath(); ctx.fillStyle = 'rgba(176,118,120,.82)'; ctx.fill();
      ctx.save(); ctx.clip();
      ctx.strokeStyle = 'rgba(255,214,210,.3)'; ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (let i = 0; i < 3; i++) { ctx.moveTo(0, -2 - i); ctx.bezierCurveTo(12, -8 - i * 3, 20, -18 - i * 3 + fw, 30, -22 - i * 2 + fw); ctx.moveTo(0, 2 + i); ctx.bezierCurveTo(12, 8 + i * 3, 20, 14 + i * 3 - fw, 28, 20 + i * 2 - fw); }
      ctx.stroke();
      ctx.fillStyle = 'rgba(20,8,30,.3)'; ctx.fillRect(-6, -40, 14, 80);
      ctx.restore();
      finPath(); ctx.strokeStyle = SINK; ctx.lineWidth = 2.4; ctx.stroke(); ctx.strokeStyle = RIM; ctx.lineWidth = 1; ctx.stroke();
      ctx.restore();
      // tail body
      ribbon(tail, tw);
      ctx.fillStyle = lgc(ctx, 'siren-tail', 0, -112, 0, -10, [[0, '#5d8886'], [0.55, TEAL], [1, TEAL_D]]); ctx.fill();
      ctx.save(); ctx.clip();
      ctx.strokeStyle = 'rgba(170,220,210,.2)'; ctx.lineWidth = 1.1;
      ctx.beginPath();
      for (let r = 0; r < 16; r++) { const yy = -116 + r * 7; for (let c = 0; c < 12; c++) { const xx = -66 + c * 8 + (r % 2) * 4; ctx.moveTo(xx + 4, yy); ctx.arc(xx, yy, 4, 0, Math.PI); } }
      ctx.stroke();
      ctx.fillStyle = 'rgba(14,6,30,.32)'; ribbon(tail.map(p => [p[0] - 6, p[1] + 2]), (s) => tw(s) * 0.6); ctx.fill();
      ctx.restore();
      ribbon(tail, tw); ctx.strokeStyle = SINK; ctx.lineWidth = 2.8; ctx.stroke();
      // belly highlight along the front edge + violet rim along the back
      ctx.strokeStyle = 'rgba(190,230,215,.35)'; ctx.lineWidth = 1.6;
      ctx.beginPath(); for (let i = 1; i < tail.length - 3; i++) { const p = tail[i]; const ww = tw(i / (tail.length - 1)) - 3; if (i === 1) ctx.moveTo(p[0] + ww, p[1]); else ctx.lineTo(p[0] + ww * 0.95, p[1] + (i > 12 ? ww * 0.5 : 0)); } ctx.stroke();
      ctx.strokeStyle = RIM; ctx.lineWidth = 1.1;
      ctx.beginPath(); for (let i = 0; i < 12; i++) { const p = tail[i]; const ww = tw(i / (tail.length - 1)) - 1; if (!i) ctx.moveTo(p[0] - ww, p[1]); else ctx.lineTo(p[0] - ww, p[1]); } ctx.stroke();
      // ---- torso ----
      const torso = () => {
        ctx.beginPath(); ctx.moveTo(-16, -108);
        ctx.bezierCurveTo(-12, -118, -9, -126, -10, -138);
        ctx.bezierCurveTo(-11, -148, -14, -156, -9, -161);
        ctx.quadraticCurveTo(1, -166, 10, -161);
        ctx.bezierCurveTo(16, -152, 17, -140, 11, -128);
        ctx.bezierCurveTo(10, -120, 14, -113, 19, -108); ctx.closePath();
      };
      torso(); eFill(ctx, SKN, 2.6);
      // scalloped hip band where skin meets scales
      ctx.beginPath(); ctx.moveTo(-17, -110);
      for (let i = 0; i < 5; i++) { const x0 = -17 + i * 7.4; ctx.arc(x0 + 3.7, -110, 3.7, Math.PI, 0, true); }
      ctx.lineTo(19, -104); ctx.lineTo(-17, -104); ctx.closePath(); fo(ctx, '#9c6a6c', 2, SINK);
      // shell bodice
      ctx.beginPath(); ctx.moveTo(-14, -150); ctx.quadraticCurveTo(2, -154, 17, -150);
      ctx.quadraticCurveTo(19, -142, 15, -136);
      for (let i = 0; i < 4; i++) { const x0 = 15 - i * 7.2; ctx.quadraticCurveTo(x0 - 3.6, -131, x0 - 7.2, -136); }
      ctx.closePath(); fo(ctx, CORAL, 2.2, SINK);
      ctx.strokeStyle = 'rgba(255,220,210,.3)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(-10, -146); ctx.quadraticCurveTo(4, -150, 14, -146); ctx.stroke();
      // pearl string
      ctx.fillStyle = '#c9c0c8'; for (let i = 0; i < 6; i++) { const a = 0.35 + i * 0.36; circ(ctx, 4 + Math.cos(a) * 10, -166 + Math.sin(a) * 7, 1.6); ctx.fill(); }
      // neck + head
      eLimb(ctx, 2, -160, 3, -166, 5, -174, 8, SKN);
      // face (slight profile chin toward +x)
      ctx.beginPath(); ctx.arc(hc[0], hc[1], 14.5, -Math.PI * 0.95, Math.PI * 0.1);
      ctx.quadraticCurveTo(hc[0] + 15, hc[1] + 12, hc[0] + 7, hc[1] + 14.5);
      ctx.arc(hc[0], hc[1], 14.5, Math.PI * 0.35, Math.PI * 1.05); ctx.closePath();
      eFill(ctx, SKN, 2.4);
      // song: mouth open; blow: puckered; idle: small sad line
      const mx = hc[0] + 11, my = hc[1] + 8;
      if (song > 0.1) { ctx.fillStyle = '#0a0614'; ell(ctx, mx, my, 2 + song * 1.2, 1.2 + song * 2.4); ctx.fill(); }
      else if (blow > 0) { ctx.fillStyle = '#0a0614'; circ(ctx, mx + 1, my - 0.5, 1.8); ctx.fill(); }
      else { ctx.strokeStyle = 'rgba(255,190,240,.55)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(mx, my + 2.4, 2.6, -Math.PI * 0.85, -Math.PI * 0.15); ctx.stroke(); }
      // sad glowing eyes (lids droop outward)
      ctx.globalCompositeOperation = 'lighter';
      sglow(ctx, hc[0] + 8, hc[1] + 1, 20 + song * 10, '255,170,240', 0.5 + song * 0.35 + (P2 ? 0.15 : 0));
      ctx.globalCompositeOperation = 'source-over';
      for (const e of [[hc[0] + 4.2, hc[1] + 1.2, 2.4], [hc[0] + 11, hc[1] + 0.8, 2.1]]) {
        eEye(ctx, e[0], e[1], e[2], 1.5 + song * 0.6, 0);
        ctx.strokeStyle = SINK; ctx.lineWidth = 1.3; ctx.beginPath(); ctx.moveTo(e[0] - e[2] - 0.6, e[1] - 0.6); ctx.quadraticCurveTo(e[0], e[1] - 2.6, e[0] + e[2] + 0.6, e[1] + 0.6); ctx.stroke();
        ctx.strokeStyle = 'rgba(255,200,240,.5)'; ctx.lineWidth = 0.9; ctx.beginPath(); ctx.moveTo(e[0] - 2, e[1] - 4.6); ctx.lineTo(e[0] + 2, e[1] - 3.4); ctx.stroke();
      }
      // ink tear
      const tl = 4 + (Math.sin(t * 0.8) + 1) * 3.5;
      ctx.fillStyle = '#0a0614'; rr(ctx, hc[0] + 3.4, hc[1] + 3, 2, tl, 1); ctx.fill(); circ(ctx, hc[0] + 4.4, hc[1] + 3 + tl, 1.6); ctx.fill();
      // hair cap + bangs
      ctx.beginPath(); ctx.moveTo(hc[0] + 12, hc[1] - 7);
      ctx.bezierCurveTo(hc[0] + 10, hc[1] - 21, hc[0] - 12, hc[1] - 22, hc[0] - 16, hc[1] - 4);
      ctx.quadraticCurveTo(hc[0] - 18, hc[1] + 8, hc[0] - 12, hc[1] + 16);
      ctx.quadraticCurveTo(hc[0] - 9, hc[1] + 4, hc[0] - 6, hc[1] - 4);
      ctx.quadraticCurveTo(hc[0] + 2, hc[1] - 10, hc[0] + 6, hc[1] - 8);
      ctx.quadraticCurveTo(hc[0] + 10, hc[1] - 10, hc[0] + 12, hc[1] - 7); ctx.closePath();
      fo(ctx, HAIR, 2.2, SINK);
      ctx.strokeStyle = 'rgba(240,180,210,.3)'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(hc[0] - 8, hc[1] - 15); ctx.quadraticCurveTo(hc[0] + 2, hc[1] - 19, hc[0] + 10, hc[1] - 12); ctx.stroke();
      // crown of round bubbles on an arc over the head
      const cr = [[-2.55, 3], [-2.2, 4.2], [-1.85, 5.6], [-1.5, 6.6], [-1.15, 5.4], [-0.82, 4], [-0.5, 2.8]];
      for (let i = 0; i < cr.length; i++) {
        const a = cr[i][0], R = 19 + cr[i][1] * 0.9 + Math.sin(t * 2 + i) * 0.6;
        bubble(hc[0] + Math.cos(a) * R, hc[1] + Math.sin(a) * R, cr[i][1], 0.95);
      }
      // a front lock falling over the shoulder
      const fl = curve([hc[0] - 11, hc[1] + 4], [hc[0] - 16, hc[1] + 22], [hc[0] - 10 + Math.sin(sw * 1.3) * 3, hc[1] + 40], [hc[0] - 16 + Math.sin(sw * 1.3 + 1) * 5 - wild * 18, hc[1] + 60 - wild * 26], 10);
      ribbon(fl, (s) => (1 - s * 0.8) * 4.6 + 0.8); fo(ctx, HAIR, 2, SINK);
      arm(sF, fh, true);
      // blown bubble leaving the palm
      if (blow > 0) {
        const r = 6 + Math.min(1, bp * 3) * 7, bx = fh[0] + 10 + bp * 70, by = fh[1] - 8 - bp * 12;
        ctx.globalCompositeOperation = 'lighter'; sglow(ctx, bx, by, r * 2.4, '170,220,240', 0.35 * (1 - bp)); ctx.globalCompositeOperation = 'source-over';
        bubble(bx, by, r, 1 - bp * 0.6);
        bubble(fh[0] + 6 + bp * 30, fh[1] - 14 - bp * 20, 2.4, 1 - bp);
      }
      // song: soft concentric arcs around the head (arcs only)
      if (song > 0.02) {
        const ox = hc[0] + 10, oy = hc[1] + 4;
        ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round';
        sglow(ctx, ox + 10, oy, 60, '220,180,255', 0.35 * song);
        for (let i = 0; i < 4; i++) {
          const p = ((t * 0.9 + i / 4) % 1), R = 20 + p * 70, a = song * Math.sin(p * Math.PI) * 0.75;
          ctx.strokeStyle = `rgba(236,214,255,${a.toFixed(3)})`; ctx.lineWidth = 2.6 - p * 1.4;
          ctx.beginPath(); ctx.arc(ox, oy, R, -0.7, 0.7); ctx.stroke();
          ctx.strokeStyle = `rgba(236,214,255,${(a * 0.45).toFixed(3)})`;
          ctx.beginPath(); ctx.arc(ox - 14, oy, R * 0.9, Math.PI - 0.55, Math.PI + 0.55); ctx.stroke();
        }
        ctx.lineCap = 'butt'; ctx.globalCompositeOperation = 'source-over';
      }
      ctx.restore();

      // ---- phase 2: the tide rises (translucent dark swell around the lower body) ----
      if (P2) {
        const top = (x) => { const e = 1 - (x / 104) * (x / 104); return 2 - e * (76 + Math.sin(x * 0.05 + t * 2.2) * 6 + Math.sin(x * 0.12 - t * 1.4) * 2.5); };
        ctx.beginPath(); ctx.moveTo(-104, 2);
        for (let x = -104; x <= 104; x += 8) ctx.lineTo(x, top(x));
        ctx.lineTo(104, 2); ctx.closePath();
        ctx.fillStyle = lgc(ctx, 'siren-tide', 0, -90, 0, 4, [[0, 'rgba(80,56,150,.38)'], [1, 'rgba(14,8,40,.7)']]); ctx.fill();
        ctx.strokeStyle = 'rgba(200,180,255,.55)'; ctx.lineWidth = 1.6;
        ctx.beginPath(); for (let x = -88; x <= 88; x += 8) { const y = top(x); if (x === -88) ctx.moveTo(x, y); else ctx.lineTo(x, y); } ctx.stroke();
        ctx.strokeStyle = 'rgba(180,160,255,.22)'; ctx.lineWidth = 1.2;
        ctx.beginPath(); for (let x = -64; x <= 64; x += 8) { const y = top(x) + 16 + Math.sin(x * 0.07 + t * 1.7) * 3; if (x === -64) ctx.moveTo(x, y); else ctx.lineTo(x, y); } ctx.stroke();
      }
      // small bubbles drifting up
      for (let i = 0; i < 7; i++) {
        const p = (t * 0.28 + i / 7) % 1, bx = -40 + i * 13 + Math.sin(t * 1.5 + i * 2) * 6, by = -30 - p * 210;
        bubble(bx, by, 1.6 + (i % 3) * 0.9, Math.sin(p * Math.PI) * 0.9);
      }
    },

    // ---------------- ボス「空っぽの玉座」 ----------------
    throne(ctx, u) {
      // 空っぽの玉座 — a child who wanted to be king of the forgotten dreams. Only the throne remains:
      // tarnished gold, faded crimson, an empty robe that keeps the shape of shoulders, a crown with no head.
      const t = u.anim || 0, at = u.atk || 0, P2 = (u.phase || 1) >= 2;
      const wind = clamp01(u.wind || 0), w = ease(wind), wk = u.windKind;
      const swW = wind > 0 && wk === 'sweep' ? w : 0, scW = wind > 0 && wk === 'scepter' ? w : 0;
      const relSw = wind <= 0 && at > 0 && wk === 'sweep' ? at : 0;
      const relSc = wind <= 0 && at > 0 && wk !== 'sweep' && wk !== 'absorb' ? at : 0;   // default attack = scepter slam
      const ab = Math.max(clamp01(u.absorb || 0), wind > 0 && wk === 'absorb' ? w : 0);
      const pw = clamp01(u.power || 0);
      const walk = !!u.walk;
      const ph = t * 2.3;
      const bob = walk ? -Math.abs(Math.sin(ph)) * 3.5 : Math.sin(t * 1.4) * 0.8;
      const GOLD = '#8a7248', GOLD_D = '#5c4832', GOLD_L = '#b5a06e', CRIM = '#6c2636', CRIM_D = '#441424', ERM = '#c9c0ae', TINK = '#160910';
      const shake = (swW + scW) * Math.sin(t * 46) * 1.2;
      ctx.lineJoin = 'round';
      const bz3 = (p0, p1, p2, p3, s) => { const r = 1 - s; return [r * r * r * p0[0] + 3 * r * r * s * p1[0] + 3 * r * s * s * p2[0] + s * s * s * p3[0], r * r * r * p0[1] + 3 * r * r * s * p1[1] + 3 * r * s * s * p2[1] + s * s * s * p3[1]]; };
      const curve = (p0, p1, p2, p3, n) => { const o = []; for (let i = 0; i <= n; i++) o.push(bz3(p0, p1, p2, p3, i / n)); return o; };
      function ribbon(P, wf) {
        const L = [], R = [], n = P.length;
        for (let i = 0; i < n; i++) {
          const a = P[Math.max(0, i - 1)], b = P[Math.min(n - 1, i + 1)];
          let tx = b[0] - a[0], ty = b[1] - a[1]; const d = Math.hypot(tx, ty) || 1; tx /= d; ty /= d;
          const ww = wf(i / (n - 1));
          L.push([P[i][0] - ty * ww, P[i][1] + tx * ww]); R.push([P[i][0] + ty * ww, P[i][1] - tx * ww]);
        }
        ctx.beginPath(); ctx.moveTo(L[0][0], L[0][1]);
        for (let i = 1; i < n; i++) ctx.lineTo(L[i][0], L[i][1]);
        for (let i = n - 1; i >= 0; i--) ctx.lineTo(R[i][0], R[i][1]);
        ctx.closePath();
      }
      const gold = (fill, lw) => { ctx.fillStyle = fill || GOLD; ctx.fill(); ctx.strokeStyle = TINK; ctx.lineWidth = lw || 2.6; ctx.stroke(); };
      const crack = (pts) => { ctx.strokeStyle = 'rgba(255,220,170,.35)'; ctx.lineWidth = 3.6; ctx.beginPath(); ctx.moveTo(pts[0] + 0.8, pts[1] + 0.8); for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i] + 0.8, pts[i + 1] + 0.8); ctx.stroke(); ctx.strokeStyle = '#120610'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(pts[0], pts[1]); for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]); ctx.stroke(); };

      // ---- ground: ink puddle + aura ----
      ctx.fillStyle = 'rgba(12,6,24,.85)'; ell(ctx, 0, -1, 74, 8); ctx.fill();
      for (let i = 0; i < 5; i++) { const px = -62 + i * 30 + Math.sin(i * 2.7) * 7, pr = 4 + (Math.sin(t * 1.1 + i) + 1) * 2.6; ell(ctx, px, -1, pr * 1.7, pr * 0.42); ctx.fill(); }
      ctx.globalCompositeOperation = 'lighter';
      sglow(ctx, -6, -150, 150, '150,50,120', 0.22 + pw * 0.18 + ab * 0.2 + (P2 ? 0.1 : 0));
      ctx.globalCompositeOperation = 'source-over';

      // ---- legs (carved cabriole legs with claw-and-ball feet) ----
      function leg(x, o, near, front) {
        const s = walk ? Math.sin(ph + o) : 0, lift = walk ? Math.max(0, Math.cos(ph + o)) * 9 : 0;
        const dir = front ? 1 : -1, hx = x + shake, hy = -80 + bob, fx = x + s * 13, fy = -14 - lift;
        const P = curve([hx, hy], [hx + dir * 17, hy + 22], [fx - dir * 8, fy - 26], [fx, fy], 14);
        ribbon(P, (k) => lerp(10.5, 4.6, k) + Math.sin(k * Math.PI) * 2.4);
        gold(near ? GOLD : GOLD_D, 2.6);
        if (near) { ctx.strokeStyle = 'rgba(240,220,160,.35)'; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(P[2][0] + dir * 4, P[2][1]); for (let i = 3; i < 9; i++) ctx.lineTo(P[i][0] + dir * 4, P[i][1]); ctx.stroke(); }
        // carved knee leaf (a simple rounded cartouche)
        ell(ctx, P[3][0] + dir * 2, P[3][1], 7, 9, dir * 0.3); gold(near ? GOLD_L : GOLD, 2);
        if (P2 && near) crack([P[4][0] - 3, P[4][1], P[6][0] + 2, P[6][1] + 2, P[8][0] - 2, P[8][1]]);
        // ball + claws
        circ(ctx, fx + dir * 2, fy + 6.5, 7.5); gold(near ? '#5a3a40' : '#3e2830', 2.2);
        ctx.lineCap = 'round';
        for (let i = -1; i <= 1; i++) {
          const cx0 = fx + dir * 2 + i * 5.5;
          ctx.beginPath(); ctx.moveTo(cx0, fy - 1); ctx.quadraticCurveTo(cx0 + dir * 4 + i * 3, fy + 3, cx0 + dir * 2 + i * 3.5, fy + 11);
          ctx.strokeStyle = TINK; ctx.lineWidth = 5.4; ctx.stroke(); ctx.strokeStyle = near ? GOLD : GOLD_D; ctx.lineWidth = 3; ctx.stroke();
        }
        ctx.lineCap = 'butt';
      }
      leg(-28, Math.PI, false, false); leg(44, 0, false, true);

      // ---- robe train (behind on the floor; whips forward along the ground on 'sweep') ----
      const trW = (P0) => {
        const wv = Math.sin(t * 2 + 1) * 4;
        const rest = [[-38, -100], [-62, -40], [-84, -3], [-152 + wv, -3]];
        const back = [[-38, -100], [-80, -70], [-140, -60], [-170, -96]];
        const fwd = [[-38, -100], [-34, -18], [40, -3], [176, -4]];
        let k = swW, f = relSw > 0 ? ease(clamp01((1 - relSw) * 2.4)) * (relSw > 0.15 ? 1 : relSw / 0.15) : 0;
        return P0.map((_, i) => { const a = rest[i], b = back[i], c = fwd[i]; const x = lerp(lerp(a[0], b[0], k), c[0], f), y = lerp(lerp(a[1], b[1], k), c[1], f); return [x + shake, y + (i ? 0 : bob)]; });
      };
      const TP = trW([0, 0, 0, 0]);
      const trainFwd = relSw > 0;
      function train() {
        const P = curve(TP[0], TP[1], TP[2], TP[3], 20);
        // wavy hem: thickness peaks in the middle, curl at the end
        ribbon(P, (k) => (k < 0.22 ? lerp(8, 16, k / 0.22) : lerp(16, 7, (k - 0.22) / 0.78)) + Math.sin(k * 9 - t * 6) * 1.6);
        ctx.fillStyle = lgc(ctx, 'throne-train', 0, -110, 0, 0, [[0, CRIM], [1, CRIM_D]]); ctx.fill();
        ctx.strokeStyle = TINK; ctx.lineWidth = 2.6; ctx.stroke(); ctx.strokeStyle = RIM; ctx.lineWidth = 1; ctx.stroke();
        // ermine edging along the outer side
        ctx.strokeStyle = ERM; ctx.lineWidth = 4; ctx.beginPath();
        for (let i = 4; i < P.length; i++) { const p = P[i], q = P[i - 1], d = Math.hypot(p[0] - q[0], p[1] - q[1]) || 1, ww = lerp(18, 7, i / 20) - 2; const x = p[0] + (p[1] - q[1]) / d * ww, y = p[1] - (p[0] - q[0]) / d * ww; if (i === 4) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
        ctx.stroke();
        ctx.fillStyle = '#2a1820';
        ctx.beginPath(); for (let i = 6; i < P.length; i += 3) { const p = P[i], q = P[i - 1], d = Math.hypot(p[0] - q[0], p[1] - q[1]) || 1, ww = lerp(18, 7, i / 20) - 2, x = p[0] + (p[1] - q[1]) / d * ww, y = p[1] - (p[0] - q[0]) / d * ww; ctx.moveTo(x + 1.1, y); ctx.ellipse(x, y, 1.1, 1.8, 0, 0, TAU); } ctx.fill();
        if (trainFwd && TP[3][0] > 30) {
          // curved drag trail along the floor
          const a = clamp01(relSw * 1.4);
          ctx.strokeStyle = `rgba(230,180,220,${(0.5 * a).toFixed(3)})`; ctx.lineWidth = 2; ctx.lineCap = 'round';
          ctx.beginPath();
          for (let i = 0; i < 2; i++) { ctx.moveTo(TP[3][0] - 10, -18 - i * 10); ctx.quadraticCurveTo(TP[3][0] - 60, -30 - i * 14, TP[3][0] - 120, -22 - i * 8); }
          ctx.stroke(); ctx.lineCap = 'butt';
        }
      }
      if (!trainFwd) train();

      ctx.save(); ctx.translate(shake, bob);
      // ---- backrest (tarnished gold frame, faded crimson tufted panel) ----
      const back = (i) => {
        ctx.beginPath();
        ctx.moveTo(-60 + i, -98); ctx.lineTo(-60 + i, -222);
        ctx.bezierCurveTo(-58 + i, -242 + i, -36, -258 + i, -22, -258 + i);
        ctx.bezierCurveTo(-8, -258 + i, 14 - i, -242 + i, 16 - i, -222);
        ctx.lineTo(16 - i, -98); ctx.closePath();
      };
      back(0); gold(lgc(ctx, 'throne-gold', -60, -260, 20, -100, [[0, GOLD_L], [0.45, GOLD], [1, GOLD_D]]), 3);
      back(9); ctx.fillStyle = lgc(ctx, 'throne-panel', 0, -250, 0, -100, [[0, '#82303f'], [1, CRIM_D]]); ctx.fill();
      ctx.save(); ctx.clip();
      // tufting: diagonal lattice + buttons
      ctx.strokeStyle = 'rgba(20,4,12,.35)'; ctx.lineWidth = 1.2; ctx.beginPath();
      for (let i = -120; i < 120; i += 16) { ctx.moveTo(-60 + i, -260); ctx.lineTo(20 + i, -100); ctx.moveTo(20 + i, -260); ctx.lineTo(-60 + i, -100); }
      ctx.stroke();
      ctx.fillStyle = 'rgba(210,170,130,.55)';
      ctx.beginPath(); for (let r = 0; r < 10; r++) for (let c = 0; c < 6; c++) { const x = -52 + c * 16 + (r % 2) * 8 - 4, y = -244 + r * 16; ctx.moveTo(x + 1.6, y); ctx.arc(x, y, 1.6, 0, TAU); } ctx.fill();
      ctx.fillStyle = 'rgba(255,220,200,.08)'; ctx.fillRect(-52, -260, 20, 170);
      ctx.restore();
      back(9); ctx.strokeStyle = 'rgba(60,40,20,.8)'; ctx.lineWidth = 1.6; ctx.stroke();
      back(4.5); ctx.strokeStyle = 'rgba(230,205,150,.3)'; ctx.lineWidth = 1.2; ctx.stroke();
      back(0); ctx.strokeStyle = RIM; ctx.lineWidth = 1.1; ctx.beginPath(); ctx.moveTo(-60, -110); ctx.lineTo(-60, -222); ctx.bezierCurveTo(-58, -242, -36, -258, -22, -258); ctx.stroke();
      // round finials (knobs, not points)
      for (const k of [[-60, -226, 7.5], [16, -226, 7.5], [-22, -264, 7]]) { circ(ctx, k[0], k[1], k[2]); gold(GOLD_L, 2.4); ctx.fillStyle = 'rgba(255,240,200,.35)'; circ(ctx, k[0] - 2, k[1] - 2.4, k[2] * 0.35); ctx.fill(); }
      if (P2) { crack([-60, -184, -52, -174, -56, -162, -50, -150]); crack([16, -210, 8, -200, 12, -188, 9, -178]); crack([-34, -256, -28, -247, -34, -240]); crack([-60, -120, -54, -112, -58, -104]); }
      // far armrest
      ctx.beginPath(); rr(ctx, -50, -150, 86, 9, 4); gold(GOLD_D, 2.4);
      circ(ctx, 38, -146, 7); gold(GOLD_D, 2.2);
      // limp far sleeve hanging over it
      const ls = curve([-30, -170], [-40, -160], [-44, -146], [-40, -132], 8);
      ribbon(ls, (k) => 7 + k * 3); ctx.fillStyle = CRIM_D; ctx.fill(); ctx.strokeStyle = TINK; ctx.lineWidth = 2.2; ctx.stroke();
      ell(ctx, -40, -131, 9, 3.6, 0.2); ctx.fillStyle = ERM; ctx.fill(); ctx.strokeStyle = TINK; ctx.lineWidth = 1.6; ctx.stroke();
      // seat cushion + carved apron
      ctx.beginPath(); rr(ctx, -50, -96, 102, 18, [2, 2, 6, 6]); gold(GOLD, 2.6);
      ctx.fillStyle = GOLD_D; for (let i = 0; i < 6; i++) { ell(ctx, -40 + i * 17, -82, 5, 3.2); ctx.fill(); }
      ctx.strokeStyle = 'rgba(240,215,160,.35)'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(-46, -92); ctx.lineTo(48, -92); ctx.stroke();
      ctx.beginPath(); rr(ctx, -48, -112, 98, 17, 7); fo(ctx, CRIM, 2.6, TINK);
      ctx.restore();

      // ---- empty robe keeping the shape of shoulders ----
      ctx.save(); ctx.translate(shake, bob);
      const sway = Math.sin(t * 1.6) * 2;
      const robe = () => {
        ctx.beginPath(); ctx.moveTo(-38, -166);
        ctx.quadraticCurveTo(-36, -186, -14, -186);
        ctx.lineTo(6, -186);
        ctx.quadraticCurveTo(24, -186, 26, -166);
        ctx.bezierCurveTo(30, -140, 32, -122, 38, -112);
        ctx.lineTo(52, -108);
        ctx.bezierCurveTo(58 + sway * 0.5, -90, 60 + sway, -70, 62 + sway, -50);
        ctx.quadraticCurveTo(55, -46 + sway, 48, -50); ctx.quadraticCurveTo(40, -45, 32, -50); ctx.quadraticCurveTo(28, -47, 25, -52);
        ctx.bezierCurveTo(26, -72, 22, -92, 10, -100);
        ctx.lineTo(-44, -100);
        ctx.bezierCurveTo(-48, -122, -44, -150, -38, -166); ctx.closePath();
      };
      robe(); ctx.fillStyle = lgc(ctx, 'throne-robe', 0, -186, 0, -50, [[0, '#7e2c3e'], [0.6, CRIM], [1, '#3a1220']]); ctx.fill();
      ctx.save(); ctx.clip();
      ctx.strokeStyle = 'rgba(20,4,14,.45)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(-24, -176); ctx.quadraticCurveTo(-30, -140, -26, -104); ctx.moveTo(-6, -170); ctx.quadraticCurveTo(-2, -136, -8, -104); ctx.moveTo(44, -100); ctx.quadraticCurveTo(50, -80, 46, -54); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,200,200,.12)'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(10, -176); ctx.quadraticCurveTo(14, -140, 18, -110); ctx.stroke();
      ctx.fillStyle = 'rgba(20,4,20,.3)'; ctx.fillRect(-50, -190, 18, 100);
      ctx.restore();
      robe(); ctx.strokeStyle = TINK; ctx.lineWidth = 3; ctx.stroke();
      ctx.strokeStyle = RIM; ctx.lineWidth = 1.1; ctx.beginPath(); ctx.moveTo(-44, -104); ctx.bezierCurveTo(-48, -122, -44, -150, -38, -166); ctx.quadraticCurveTo(-36, -186, -14, -186); ctx.stroke();
      // ermine front edge
      ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(14, -184); ctx.bezierCurveTo(26, -152, 30, -124, 40, -110); ctx.lineTo(52, -106); ctx.bezierCurveTo(57 + sway * 0.5, -88, 59 + sway, -70, 60 + sway, -54);
      ctx.strokeStyle = TINK; ctx.lineWidth = 9; ctx.stroke(); ctx.strokeStyle = ERM; ctx.lineWidth = 6.4; ctx.stroke();
      ctx.lineCap = 'butt';
      ctx.fillStyle = '#2a1820';
      for (const p of [[18, -170], [24, -150], [29, -130], [44, -108], [56, -90], [59, -70]]) { ell(ctx, p[0], p[1], 1.1, 2); ctx.fill(); }
      // ink drips from the hem
      ctx.fillStyle = '#140818';
      for (let i = 0; i < 3; i++) { const x = 30 + i * 12, l = 6 + (Math.sin(t * 1.2 + i * 2) + 1) * 7; rr(ctx, x, -52, 3.2, l, 1.6); ctx.fill(); circ(ctx, x + 1.6, -52 + l, 2.4); ctx.fill(); }

      // ---- absorb: a dark vortex in the hollow of the robe, wisps curving in ----
      const vx = -6, vy = -150;
      if (ab > 0.02) {
        ctx.globalCompositeOperation = 'lighter';
        sglow(ctx, vx, vy, 120 * ab + 30, '170,70,220', 0.45 * ab);
        ctx.globalCompositeOperation = 'source-over';
        ctx.lineCap = 'round';
        for (let i = 0; i < 5; i++) {
          const a0 = i * 1.27 + t * 1.5, len = 0.75 + (i % 3) * 0.12;
          ctx.beginPath();
          for (let j = 0; j <= 18; j++) {
            const k = j / 18, r = lerp(150 * len, 10, k) * (0.55 + ab * 0.45), a = a0 + k * 2.6;
            const x = vx + Math.cos(a) * r, y = vy + Math.sin(a) * r * 0.82;
            if (!j) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          }
          ctx.strokeStyle = `rgba(12,4,24,${(0.65 * ab).toFixed(3)})`; ctx.lineWidth = 7; ctx.stroke();
          ctx.strokeStyle = `rgba(200,140,255,${(0.55 * ab).toFixed(3)})`; ctx.lineWidth = 1.8; ctx.stroke();
          // a mote being pulled in along the wisp
          const k = (t * 0.7 + i * 0.2) % 1, r = lerp(150 * len, 10, k) * (0.55 + ab * 0.45), a = a0 + k * 2.6;
          ctx.fillStyle = `rgba(10,4,20,${(0.9 * ab).toFixed(3)})`; circ(ctx, vx + Math.cos(a) * r, vy + Math.sin(a) * r * 0.82, 5 * (1 - k) + 1.5); ctx.fill();
          ctx.fillStyle = `rgba(255,200,245,${(0.8 * ab).toFixed(3)})`; circ(ctx, vx + Math.cos(a) * r + 1, vy + Math.sin(a) * r * 0.82 - 1, 1.2 * (1 - k) + 0.5); ctx.fill();
        }
        ctx.lineCap = 'butt';
        ell(ctx, vx, vy, 22 * ab + 6, 26 * ab + 7); ctx.fillStyle = '#05020a'; ctx.fill();
        ctx.strokeStyle = `rgba(210,150,255,${(0.7 * ab).toFixed(3)})`; ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.ellipse(vx, vy, 22 * ab + 9, 26 * ab + 10, 0, t * 3, t * 3 + 4); ctx.stroke();
      }
      // hollow collar (no one inside)
      ell(ctx, -4, -186, 18, 6.5); ctx.fillStyle = '#06030c'; ctx.fill();
      ctx.globalCompositeOperation = 'lighter'; sglow(ctx, -4, -188, 22, '160,80,220', 0.3 + ab * 0.4); ctx.globalCompositeOperation = 'source-over';
      ctx.beginPath(); ctx.ellipse(-4, -186, 20, 8, 0, 0, TAU); ctx.strokeStyle = TINK; ctx.lineWidth = 7.4; ctx.stroke(); ctx.strokeStyle = ERM; ctx.lineWidth = 4.6; ctx.stroke();
      ctx.fillStyle = '#2a1820'; for (let i = 0; i < 6; i++) { const a = 0.3 + i * 0.5; ell(ctx, -4 + Math.cos(a) * 20, -186 + Math.sin(a) * 8, 0.9, 1.5); ctx.fill(); }
      ctx.restore();

      // middle layer: near-front/back legs over the robe
      if (trainFwd) train();
      leg(-36, 0, true, false); leg(34, Math.PI, true, true);

      ctx.save(); ctx.translate(shake, bob);
      // near armrest over the robe
      ctx.beginPath(); rr(ctx, -46, -144, 84, 10, 4); gold(GOLD, 2.6);
      ctx.strokeStyle = 'rgba(240,215,160,.4)'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(-42, -141); ctx.lineTo(34, -141); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(32, -134); ctx.quadraticCurveTo(38, -124, 33, -112); ctx.lineTo(27, -112); ctx.quadraticCurveTo(24, -124, 28, -134); ctx.closePath(); gold(GOLD, 2.2);
      circ(ctx, 40, -139, 9); gold(GOLD_L, 2.4);
      ctx.strokeStyle = GOLD_D; ctx.lineWidth = 1.8; ctx.beginPath(); ctx.arc(40, -139, 4.6, 0.6, 5.2); ctx.stroke();
      if (P2) crack([-30, -144, -26, -139, -31, -135]);

      // ---- empty sleeve + floating scepter ----
      let cx = 58 + Math.sin(t * 1.5) * 2, cy = -128 + Math.sin(t * 1.8) * 3, sa = -Math.PI / 2 + Math.sin(t * 1.2) * 0.06;
      cx = lerp(cx, 34, scW); cy = lerp(cy, -244, scW); sa = lerp(sa, -Math.PI / 2 - 0.35, scW);
      let slam = 0;
      if (relSc > 0) {
        const k = ease(clamp01((1 - relSc) * 3.2)), back2 = ease(clamp01((0.45 - relSc) / 0.45));
        slam = k * (1 - back2);
        cx = lerp(lerp(34, 82, k), cx, back2); cy = lerp(lerp(-244, -84, k), cy, back2); sa = lerp(lerp(-Math.PI / 2 - 0.35, 0.95, k), sa, back2);
      }
      const shp = [18, -170];
      const sl = curve(shp, [shp[0] + 18, shp[1] + 6 - scW * 30], [cx - 16 - scW * 4, cy + 4 + scW * 30], [cx - 4, cy], 12);
      ribbon(sl, (k) => 7 + k * 2.6); ctx.fillStyle = lgc(ctx, 'throne-sleeve', 0, -250, 0, -80, [[0, '#7e2c3e'], [1, CRIM_D]]); ctx.fill();
      ctx.strokeStyle = TINK; ctx.lineWidth = 2.6; ctx.stroke(); ctx.strokeStyle = RIM; ctx.lineWidth = 0.9; ctx.stroke();
      // hollow cuff
      const ca = Math.atan2(sl[12][1] - sl[10][1], sl[12][0] - sl[10][0]);
      ctx.save(); ctx.translate(cx - 3, cy); ctx.rotate(ca);
      ell(ctx, 0, 0, 4.6, 11); ctx.fillStyle = ERM; ctx.fill(); ctx.strokeStyle = TINK; ctx.lineWidth = 2; ctx.stroke();
      ell(ctx, 2, 0, 2.6, 7.4); ctx.fillStyle = '#06030c'; ctx.fill();
      ctx.restore();
      // scepter (rod + round orb with a plain band)
      ctx.save(); ctx.translate(cx + 9 * Math.cos(sa + Math.PI / 2) * 0 + 8, cy); ctx.rotate(sa + Math.PI / 2);
      bone(ctx, 0, 46, 0, -46, 5, GOLD, TINK, 2.6);
      for (const yy of [-30, 0, 30]) { ctx.beginPath(); rr(ctx, -5, yy - 2.5, 10, 5, 2); gold(GOLD_L, 1.8); }
      circ(ctx, 0, 49, 4); gold(GOLD_D, 2);
      ctx.globalCompositeOperation = 'lighter'; sglow(ctx, 0, -56, 26, '255,140,200', 0.35 + pw * 0.5 + slam * 0.4); ctx.globalCompositeOperation = 'source-over';
      circ(ctx, 0, -57, 10.5); gold('#8c3a4c', 2.6);
      ctx.beginPath(); ctx.ellipse(0, -57, 10.5, 3.2, 0, 0, Math.PI); ctx.strokeStyle = GOLD_L; ctx.lineWidth = 2.4; ctx.stroke();
      ctx.fillStyle = 'rgba(255,220,230,.5)'; circ(ctx, -3.5, -61, 2.6); ctx.fill();
      circ(ctx, 0, -70, 3.4); gold(GOLD_L, 1.8);
      ctx.restore();
      ctx.restore();
      if (slam > 0.2 && relSc > 0) {
        // impact on the floor: soft expanding ellipse rings (no spokes)
        const ix = cx + 8 + Math.cos(sa) * 60 + shake, k = clamp01((0.75 - relSc) / 0.5);
        ctx.strokeStyle = `rgba(240,190,255,${(0.7 * (1 - k)).toFixed(3)})`; ctx.lineWidth = 3;
        ell(ctx, ix, -2, 20 + k * 60, 5 + k * 9); ctx.stroke();
        ctx.lineWidth = 1.5; ell(ctx, ix, -2, 10 + k * 34, 3 + k * 5); ctx.stroke();
        ctx.fillStyle = `rgba(140,110,120,${(0.4 * (1 - k)).toFixed(3)})`;
        for (let i = 0; i < 4; i++) { ell(ctx, ix - 30 + i * 20, -6 - k * 14 - (i % 2) * 6, 7 + k * 6, 5 + k * 4); ctx.fill(); }
      }

      // ---- crown floating above the empty seat ----
      ctx.save();
      const crY = -216 + bob + Math.sin(t * 1.7) * 3 - pw * 4;
      ctx.translate(-4 + shake, crY); ctx.rotate(P2 ? 0.3 : Math.sin(t * 1.1) * 0.04);
      const gemA = 0.35 + pw * 0.65;
      ctx.globalCompositeOperation = 'lighter'; sglow(ctx, 0, -8, 40 + pw * 26, '255,150,210', 0.25 + pw * 0.45); ctx.globalCompositeOperation = 'source-over';
      const crownPath = () => {
        ctx.beginPath(); ctx.moveTo(-21, 6);
        ctx.lineTo(-22, -6);
        ctx.quadraticCurveTo(-20, -18, -13, -14);
        ctx.quadraticCurveTo(-9, -8, -6, -12);
        ctx.quadraticCurveTo(0, -26, 6, -12);
        ctx.quadraticCurveTo(9, -8, 13, -14);
        ctx.quadraticCurveTo(20, -18, 22, -6);
        ctx.lineTo(21, 6);
        ctx.quadraticCurveTo(0, 10, -21, 6); ctx.closePath();
      };
      crownPath(); gold(lgc(ctx, 'throne-crown', 0, -24, 0, 8, [[0, GOLD_L], [1, GOLD_D]]), 2.6);
      ctx.strokeStyle = 'rgba(60,40,20,.6)'; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(-21, -1); ctx.quadraticCurveTo(0, 3, 21, -1); ctx.stroke();
      if (P2) crack([-6, -12, -3, -5, -7, 2, -4, 7]);
      const gems = [[-16.5, -18, 3.4], [0, -27, 4.4], [16.5, -18, 3.4], [0, 2, 3.2], [-12, 1.5, 2.2], [12, 1.5, 2.2]];
      for (const g of gems) {
        ctx.globalCompositeOperation = 'lighter'; sglow(ctx, g[0], g[1], g[2] * 4, '255,130,200', gemA * 0.7); ctx.globalCompositeOperation = 'source-over';
        circ(ctx, g[0], g[1], g[2]); ctx.fillStyle = `rgb(${Math.round(150 + pw * 100)},${Math.round(70 + pw * 90)},${Math.round(100 + pw * 90)})`; ctx.fill();
        ctx.strokeStyle = TINK; ctx.lineWidth = 1.6; ctx.stroke();
        ctx.fillStyle = 'rgba(255,240,245,.7)'; circ(ctx, g[0] - g[2] * 0.35, g[1] - g[2] * 0.35, g[2] * 0.3); ctx.fill();
      }
      ctx.restore();
      // ink motes rising
      ctx.fillStyle = 'rgba(200,140,255,.7)';
      for (let i = 0; i < 6; i++) { const p = (t * 0.3 + i / 6) % 1, mx = -60 + i * 24 + Math.sin(t + i) * 8; ctx.fillRect(mx, -20 - p * 220, 2.4, 2.4); }
    },

    // ---------------- ボス「刻喰らいの時計塔」 ----------------
    clock(ctx, u) {
      // 刻喰らいの時計塔 — a child pressed their face into the pillow and held the clock hands still: "I don't want
      // to grow up". The wish was forgotten; the clock walks on, the child still curled up inside the pendulum case.
      const t = u.anim || 0, at = u.atk || 0, P2 = (u.phase || 1) >= 2;
      const wind = clamp01(u.wind || 0), w = ease(wind), wk = u.windKind;
      const thW = wind > 0 && wk === 'thrust' ? w : 0, rwW = wind > 0 && wk === 'rewind' ? w : 0;
      const relTh = wind <= 0 && at > 0 && wk !== 'rewind' ? at : 0;
      const rwd = clamp01(u.rewind || 0);
      const walk = !!u.walk;
      const ph = t * 4.2;
      const bob = walk ? -Math.abs(Math.sin(ph)) * 4 : Math.sin(t * 1.5) * 0.7;
      const shake = (thW * 0.6 + rwW) * Math.sin(t * 48) * 1.1;
      const WOOD = '#3e2834', WOOD_D = '#26161f', SIDE = '#1e1018', PAINT = '#8a5c68', CREAMP = '#b4a888', BRASS = '#9a8656', CINK = '#120814';
      const DCX = 0, DCY = -207, DR = 26;
      ctx.lineJoin = 'round';
      const box = (x0, y0, x1, y1, sd, r) => {
        // front face + a darker side panel on the back (-x) side, so it reads as facing right
        ctx.beginPath(); ctx.moveTo(x0, y0 + 3); ctx.lineTo(x0 - sd, y0 + 3 - sd * 0.35); ctx.lineTo(x0 - sd, y1 - sd * 0.35); ctx.lineTo(x0, y1); ctx.closePath();
        ctx.fillStyle = SIDE; ctx.fill(); ctx.strokeStyle = CINK; ctx.lineWidth = 2.4; ctx.stroke();
        ctx.strokeStyle = RIM; ctx.lineWidth = 1.1; ctx.beginPath(); ctx.moveTo(x0 - sd, y0 + 4 - sd * 0.35); ctx.lineTo(x0 - sd, y1 - sd * 0.35); ctx.stroke();
        ctx.beginPath(); rr(ctx, x0, y0, x1 - x0, y1 - y0, r || 3);
      };
      const crackLine = (pts) => {
        ctx.strokeStyle = 'rgba(235,225,255,.55)'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(pts[0], pts[1]); for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]); ctx.stroke();
      };

      // ---- ground: ink puddle, phase-2 slowed-time ring ----
      ctx.fillStyle = 'rgba(12,6,24,.85)'; ell(ctx, -2, -1, 62, 7.5); ctx.fill();
      for (let i = 0; i < 5; i++) { const px = -52 + i * 26 + Math.sin(i * 2.1) * 6, pr = 4 + (Math.sin(t * 1.2 + i) + 1) * 2.4; ell(ctx, px, -1, pr * 1.7, pr * 0.42); ctx.fill(); }
      if (P2) {
        const pu = 0.5 + Math.sin(t * 1.3) * 0.5;
        ctx.globalCompositeOperation = 'lighter';
        ctx.save(); ctx.scale(1, 0.14); sglow(ctx, 0, -10, 130, '170,140,255', 0.22 + pu * 0.08); ctx.restore();
        ctx.strokeStyle = `rgba(210,190,255,${(0.42 + pu * 0.2).toFixed(3)})`; ctx.lineWidth = 2;
        ell(ctx, 0, -1, 112 + pu * 4, 15 + pu * 0.6); ctx.stroke();
        ctx.strokeStyle = 'rgba(210,190,255,.22)'; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.ellipse(0, -1, 92, 12, 0, -t * 0.4, -t * 0.4 + 4.4); ctx.stroke();
        ctx.globalCompositeOperation = 'source-over';
      }
      ctx.globalCompositeOperation = 'lighter';
      sglow(ctx, 0, -150, 140, '140,70,210', 0.2 + rwW * 0.25 + rwd * 0.2 + (P2 ? 0.08 : 0));
      ctx.globalCompositeOperation = 'source-over';

      // ---- stubby legs ----
      function leg(x, o, near) {
        const s = walk ? Math.sin(ph + o) : 0, lift = walk ? Math.max(0, Math.cos(ph + o)) * 7 : 0;
        const fx = x + s * 9;
        ctx.beginPath(); rr(ctx, lerp(x, fx, 0.5) - 7 + shake, -38 + bob, 14, 30 - lift + (-bob), 4); fo(ctx, near ? WOOD : WOOD_D, 2.4, CINK);
        ell(ctx, fx + 2, -6 - lift, 12, 7); fo(ctx, near ? '#4c3040' : '#301c28', 2.4, CINK);
        ctx.strokeStyle = 'rgba(200,170,190,.25)'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.ellipse(fx + 2, -6 - lift, 9, 4, 0, Math.PI * 1.1, Math.PI * 1.7); ctx.stroke();
      }
      leg(-17, Math.PI, false);
      leg(15, 0, true);

      ctx.save(); ctx.translate(shake, bob);
      // ---- base (plinth) with a faded painted crescent moon and clouds ----
      box(-36, -76, 36, -32, 9, 4);
      ctx.fillStyle = lgc(ctx, 'clock-base', 0, -76, 0, -32, [[0, WOOD], [1, WOOD_D]]); ctx.fill(); ctx.strokeStyle = CINK; ctx.lineWidth = 2.8; ctx.stroke();
      ctx.beginPath(); rr(ctx, -28, -70, 56, 32, 3); ctx.strokeStyle = 'rgba(180,150,140,.35)'; ctx.lineWidth = 1.4; ctx.stroke();
      crescent(ctx, -12, -55, 8, 4.4, 7, -0.6); ctx.fillStyle = 'rgba(200,180,120,.42)'; ctx.fill();
      ctx.fillStyle = 'rgba(190,170,190,.3)';
      ell(ctx, 10, -58, 9, 4); ctx.fill(); ell(ctx, 17, -55, 7, 3.4); ctx.fill(); ell(ctx, 4, -48, 6, 3); ctx.fill();
      // ink drips from the base
      ctx.fillStyle = '#120a20';
      for (let i = 0; i < 4; i++) { const x = -26 + i * 16, l = 5 + (Math.sin(t * 1.3 + i * 2) + 1) * 6; rr(ctx, x, -34, 3.2, l, 1.6); ctx.fill(); circ(ctx, x + 1.6, -34 + l, 2.4); ctx.fill(); }

      // ---- trunk (pendulum case) ----
      box(-27, -180, 27, -74, 7, 3);
      ctx.fillStyle = lgc(ctx, 'clock-trunk', -27, 0, 27, 0, [[0, WOOD_D], [0.4, WOOD], [1, '#33202b']]); ctx.fill(); ctx.strokeStyle = CINK; ctx.lineWidth = 2.8; ctx.stroke();
      // arched glass window
      const win = (i) => { ctx.beginPath(); ctx.moveTo(-18 + i, -86 - i * 0.2); ctx.lineTo(-18 + i, -158); ctx.arc(0, -158, 18 - i, Math.PI, 0); ctx.lineTo(18 - i, -86 - i * 0.2); ctx.closePath(); };
      win(0); ctx.fillStyle = '#0a0612'; ctx.fill();
      ctx.save(); win(0); ctx.clip();
      ctx.globalCompositeOperation = 'lighter'; sglow(ctx, 0, -104, 34, '150,90,210', 0.3 + rwW * 0.2); ctx.globalCompositeOperation = 'source-over';
      // the child, curled up hugging the knees (faded lilac pajamas with dots)
      const cb = Math.sin(t * 1.1) * 0.8;
      ctx.save(); ctx.translate(-1, -87 + cb * 0.3); ctx.scale(1.12, 1.12);
      ctx.beginPath(); ctx.moveTo(-14, 0); ctx.bezierCurveTo(-17, -12, -13, -26, -2, -28); ctx.bezierCurveTo(8, -29, 14, -22, 15, -12); ctx.quadraticCurveTo(16, -4, 13, 0); ctx.closePath();
      fo(ctx, '#5e5072', 1.8, CINK);
      ctx.fillStyle = 'rgba(210,190,220,.35)'; for (const d of [[-8, -8], [-3, -18], [4, -6], [9, -16], [-10, -20]]) { circ(ctx, d[0], d[1], 1.2); ctx.fill(); }
      // knees + arms wrapped around them
      ell(ctx, 9, -14, 7, 9, -0.2); fo(ctx, '#6a5c80', 1.6, CINK);
      ctx.strokeStyle = CINK; ctx.lineWidth = 4.6; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(-2, -20); ctx.quadraticCurveTo(8, -24, 13, -12); ctx.stroke();
      ctx.strokeStyle = '#2c2238'; ctx.lineWidth = 3; ctx.stroke(); ctx.lineCap = 'butt';
      // head bowed onto the knees, eyes peeking
      circ(ctx, 3, -30, 8.4); fo(ctx, '#2c2238', 1.8, CINK);
      ctx.beginPath(); ctx.moveTo(-5, -31); ctx.quadraticCurveTo(-4, -40, 4, -39); ctx.quadraticCurveTo(11, -38, 11, -31); ctx.quadraticCurveTo(5, -34, -5, -31); ctx.closePath(); ctx.fillStyle = '#1a1220'; ctx.fill();
      ctx.globalCompositeOperation = 'lighter'; sglow(ctx, 6, -28, 10, '255,170,240', 0.55); ctx.globalCompositeOperation = 'source-over';
      const bl = eBlink(t + 0.7, 4.1);
      ctx.fillStyle = '#ffd8f6'; ell(ctx, 4.2, -28, 1.4, 1 * bl); ctx.fill(); ell(ctx, 8.6, -28.2, 1.2, 0.9 * bl); ctx.fill();
      ctx.restore();
      // pendulum (in front of the child) — swings backwards while rewinding
      const pa = rwW > 0 ? Math.sin(-t * 7) * (0.34 + rwW * 0.16) : Math.sin(t * 2.6) * 0.3 * (P2 ? 0.75 : 1);
      ctx.save(); ctx.translate(0, -174); ctx.rotate(pa);
      ctx.strokeStyle = CINK; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, 58); ctx.stroke();
      ctx.strokeStyle = BRASS; ctx.lineWidth = 2; ctx.stroke();
      circ(ctx, 0, 62, 10); fo(ctx, BRASS, 2.4, CINK);
      ctx.strokeStyle = 'rgba(255,240,200,.45)'; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.arc(0, 62, 6.4, Math.PI * 1.1, Math.PI * 1.6); ctx.stroke();
      ctx.restore();
      // glass reflection + phase-2 cracks
      ctx.fillStyle = 'rgba(220,220,255,.09)'; ctx.beginPath(); ctx.moveTo(-18, -128); ctx.lineTo(-4, -176); ctx.lineTo(4, -176); ctx.lineTo(-18, -112); ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(220,220,255,.06)'; ctx.beginPath(); ctx.moveTo(4, -86); ctx.lineTo(18, -130); ctx.lineTo(18, -118); ctx.lineTo(10, -86); ctx.closePath(); ctx.fill();
      if (P2) { crackLine([6, -150, 0, -138, 4, -126, -3, -112]); crackLine([0, -138, -10, -132]); crackLine([4, -126, 14, -120, 18, -112]); }
      ctx.restore();
      win(0); ctx.strokeStyle = CINK; ctx.lineWidth = 3; ctx.stroke();
      win(-3); ctx.strokeStyle = 'rgba(180,150,120,.45)'; ctx.lineWidth = 1.6; ctx.stroke();
      ctx.strokeStyle = 'rgba(10,4,14,.35)'; ctx.lineWidth = 1; ctx.beginPath(); for (const x of [-23, 21]) { ctx.moveTo(x, -176); ctx.quadraticCurveTo(x + 1.5, -130, x - 0.5, -88); } ctx.stroke();
      // painted trim (faded)
      ctx.strokeStyle = PAINT; ctx.lineWidth = 2.4; ctx.beginPath(); ctx.moveTo(-24, -84); ctx.lineTo(24, -84); ctx.stroke();
      ctx.fillStyle = 'rgba(190,140,150,.45)'; for (const y of [-172, -82]) { circ(ctx, -22, y, 2); ctx.fill(); circ(ctx, 22, y, 2); ctx.fill(); }

      // ---- hood with the dial ----
      box(-36, -242, 36, -176, 9, 5);
      ctx.fillStyle = lgc(ctx, 'clock-hood', 0, -242, 0, -176, [[0, '#4a3040'], [1, WOOD_D]]); ctx.fill(); ctx.strokeStyle = CINK; ctx.lineWidth = 2.8; ctx.stroke();
      ctx.beginPath(); rr(ctx, -40, -182, 80, 8, 3); fo(ctx, PAINT, 2.4, CINK);
      // little roof
      ctx.beginPath(); ctx.moveTo(-46, -240); ctx.lineTo(-48, -243); ctx.quadraticCurveTo(-24, -258, -2, -268); ctx.quadraticCurveTo(22, -258, 44, -243); ctx.lineTo(42, -240); ctx.closePath();
      fo(ctx, '#5a3442', 2.8, CINK);
      ctx.strokeStyle = 'rgba(220,170,190,.3)'; ctx.lineWidth = 1.3; ctx.beginPath(); ctx.moveTo(-40, -244); ctx.quadraticCurveTo(-22, -255, -2, -263); ctx.stroke();
      ctx.strokeStyle = RIM; ctx.lineWidth = 1.1; ctx.beginPath(); ctx.moveTo(-47, -242); ctx.quadraticCurveTo(-24, -257, -2, -267); ctx.stroke();
      circ(ctx, -2, -271, 5); fo(ctx, BRASS, 2.2, CINK);
      // dial glow (pale violet while rewinding)
      const glowA = 0.25 + rwW * 0.9 + rwd * 0.6 + thW * 0.2;
      ctx.globalCompositeOperation = 'lighter'; sglow(ctx, DCX, DCY, 44 + rwW * 26, '200,170,255', glowA); ctx.globalCompositeOperation = 'source-over';
      circ(ctx, DCX, DCY, DR + 4); fo(ctx, BRASS, 2.6, CINK);
      circ(ctx, DCX, DCY, DR); ctx.fillStyle = lgc(ctx, 'clock-dial', 0, DCY - DR, 0, DCY + DR, [[0, '#d6ccb4'], [1, '#a59a86']]); ctx.fill();
      if (rwW > 0 || rwd > 0) { ctx.fillStyle = `rgba(190,160,255,${(0.5 * Math.max(rwW, rwd)).toFixed(3)})`; circ(ctx, DCX, DCY, DR); ctx.fill(); }
      ctx.strokeStyle = CINK; ctx.lineWidth = 1.6; ctx.stroke();
      // the dial is drawn un-mirrored on screen (enemies are flipped): numerals read correctly and "backwards" is counter-clockwise
      const fl = ctx.getTransform().a < 0 ? -1 : 1;
      ctx.save(); ctx.translate(DCX, DCY); ctx.scale(fl, 1); ctx.translate(-DCX, -DCY);
      // numerals only (no tick marks)
      ctx.fillStyle = '#3a2634'; ctx.font = 'bold 7px Georgia, serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (let i = 1; i <= 12; i++) { const a = i / 12 * TAU - Math.PI / 2; ctx.fillText(String(i), DCX + Math.cos(a) * (DR - 6.5), DCY + Math.sin(a) * (DR - 6.5) + 0.4); }
      ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic';
      // hands: stuck just before twelve, trembling under a small finger; spin backwards on rewind
      let ha = -Math.PI / 2 - 0.08, ma = -Math.PI / 2 - 0.035 + Math.sin(t * 22) * 0.025;
      if (rwW > 0) { ha -= t * 1.6 * rwW; ma -= t * 11 * rwW; }
      const hand = (a, L, wd) => { ctx.save(); ctx.translate(DCX, DCY); ctx.rotate(a); ctx.beginPath(); ctx.moveTo(-4, -wd); ctx.lineTo(L - 3, -wd * 0.5); ctx.lineTo(L, 0); ctx.lineTo(L - 3, wd * 0.5); ctx.lineTo(-4, wd); ctx.closePath(); ctx.fillStyle = '#20141e'; ctx.fill(); ctx.restore(); };
      hand(ha, 13, 2);
      const thrustOut = thW > 0 || relTh > 0;
      if (!thrustOut) hand(ma, 20, 1.4);
      circ(ctx, DCX, DCY, 2.6); ctx.fillStyle = BRASS; ctx.fill(); ctx.strokeStyle = CINK; ctx.lineWidth = 1; ctx.stroke();
      // dial glass sheen + phase-2 crack
      ctx.fillStyle = 'rgba(255,255,255,.12)'; ctx.beginPath(); ctx.ellipse(DCX - 8, DCY - 10, 12, 5, -0.6, 0, TAU); ctx.fill();
      ctx.restore(); ctx.save();
      ctx.fillStyle = '#120818'; for (let i = 0; i < 2; i++) { const x = DCX - 14 + i * 26, l = 6 + (Math.sin(t * 1.1 + i * 2.4) + 1) * 5; rr(ctx, x, DCY + DR + 2, 3, l, 1.5); ctx.fill(); circ(ctx, x + 1.5, DCY + DR + 2 + l, 2.2); ctx.fill(); }
      ctx.translate(DCX, DCY); ctx.scale(fl, 1); ctx.translate(-DCX, -DCY);
      if (P2) { crackLine([DCX + 4, DCY - DR + 2, DCX + 2, DCY - 10, DCX + 10, DCY - 2, DCX + 6, DCY + 12]); crackLine([DCX + 2, DCY - 10, DCX - 9, DCY - 6]); }
      // ---- rewind: backwards-swirling glow — soft arcs circling counter-clockwise ----
      const sw = Math.max(rwW, rwd);
      if (sw > 0.02) {
        ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round';
        sglow(ctx, DCX, DCY, 70, '190,150,255', 0.35 * sw);
        for (let r = 0; r < 3; r++) {
          const R = 35 + r * 10 + rwd * r * 4, a0 = -t * (3.4 - r * 0.7) + r * 2.1;
          ctx.strokeStyle = `rgba(210,180,255,${(0.12 * sw).toFixed(3)})`; ctx.lineWidth = 7; circ(ctx, DCX, DCY, R); ctx.stroke();
          for (let c = 0; c < 2; c++) {
            for (let i = 0; i < 10; i++) {
              const aa = a0 + c * Math.PI + i * 0.13;       // head at a0, tail trailing clockwise → it travels counter-clockwise
              ctx.strokeStyle = `rgba(232,210,255,${(sw * 0.95 * (1 - i / 10) * (1 - r * 0.2)).toFixed(3)})`; ctx.lineWidth = Math.max(0.8, 4 - r * 0.8 - i * 0.3);
              ctx.beginPath(); ctx.arc(DCX, DCY, R, aa, aa + 0.14); ctx.stroke();
            }
          }
        }
        ctx.lineCap = 'butt'; ctx.globalCompositeOperation = 'source-over';
      }
      ctx.restore();
      ctx.restore();

      // ---- thrust: the minute hand grows into a long needle and stabs forward ----
      if (thrustOut) {
        const ext = relTh > 0 ? (relTh > 0.35 ? 1 : relTh / 0.35) : 0;
        const L = lerp(20 + thW * 10, 176, ease(ext)), back = thW * 8 * (1 - ext);
        const ox = DCX + shake - back, oy = DCY + bob, aa = lerp(fl < 0 ? -Math.PI - ma : ma, 0, relTh > 0 ? 1 : clamp01(thW * 2));
        ctx.save(); ctx.translate(ox, oy); ctx.rotate(aa);
        ctx.globalCompositeOperation = 'lighter';
        sglow(ctx, L, 0, 18 + thW * 10, '230,190,255', 0.45 + thW * 0.4);
        if (ext > 0) { ctx.strokeStyle = `rgba(230,200,255,${(0.35 * ext).toFixed(3)})`; ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(20, 0); ctx.lineTo(L - 10, 0); ctx.stroke(); }
        ctx.globalCompositeOperation = 'source-over';
        ctx.beginPath(); ctx.moveTo(-6, -3.4); ctx.lineTo(L - 14, -2); ctx.lineTo(L - 15, -5.6); ctx.lineTo(L + 5, 0); ctx.lineTo(L - 15, 5.6); ctx.lineTo(L - 14, 2); ctx.lineTo(-6, 3.4); ctx.closePath();
        ctx.strokeStyle = 'rgba(220,190,255,.45)'; ctx.lineWidth = 4; ctx.stroke();
        ctx.fillStyle = '#2a1c2c'; ctx.fill(); ctx.strokeStyle = CINK; ctx.lineWidth = 1.6; ctx.stroke();
        ctx.strokeStyle = 'rgba(225,200,255,.8)'; ctx.lineWidth = 1.1; ctx.beginPath(); ctx.moveTo(0, -2.2); ctx.lineTo(L - 14, -1.2); ctx.stroke();
        ctx.restore();
        circ(ctx, DCX + shake, DCY + bob, 3); ctx.fillStyle = BRASS; ctx.fill();
      }
      // ink motes rising
      ctx.fillStyle = 'rgba(200,140,255,.7)';
      for (let i = 0; i < 5; i++) { const p = (t * 0.3 + i / 5) % 1, mx = -44 + i * 22 + Math.sin(t + i) * 8; ctx.fillRect(mx, -30 - p * 220, 2.4, 2.4); }
    },

    // ---------------- ボス「深海の夢鯨」 ----------------
    whale(ctx, u) {
      // 深海の夢鯨 — not one person's dream: the wishes of many who dreamed of flying, sunk into the sea of
      // forgetting and grown into a whale. A night sky drifts inside its translucent body (round lights only).
      const t = u.anim || 0, at = u.atk || 0, P2 = (u.phase || 1) >= 2;
      const wind = clamp01(u.wind || 0), w = ease(wind), wk = u.windKind;
      const swW = wind > 0 && wk === 'swallow' ? w : 0;
      const swR = wind <= 0 && at > 0 && wk === 'swallow' ? at : 0;
      const spW = wind > 0 && wk === 'spout' ? w : 0;
      const spR = wind <= 0 && at > 0 && wk === 'spout' ? at : 0;
      const dvW = wind > 0 && wk === 'dive' ? w : 0;
      const rev = u.reveal == null ? 1 : clamp01(u.reveal);
      const surf = u.fly === false;
      const nB = Math.max(0, Math.min(3, u.bellyN | 0));
      const walk = !!u.walk;
      const hsh = (n) => { const s = Math.sin(n * 127.1 + 31.7) * 43758.5453; return s - Math.floor(s); };
      const WINK = '#07051a', BODY_T = '#1d1c4c', BODY_B = '#2c3a72', SKY = '134,170,214';
      ctx.lineJoin = 'round';
      const bz3 = (p0, p1, p2, p3, s) => { const r = 1 - s; return [r * r * r * p0[0] + 3 * r * r * s * p1[0] + 3 * r * s * s * p2[0] + s * s * s * p3[0], r * r * r * p0[1] + 3 * r * r * s * p1[1] + 3 * r * s * s * p2[1] + s * s * s * p3[1]]; };
      const curve = (p0, p1, p2, p3, n) => { const o = []; for (let i = 0; i <= n; i++) o.push(bz3(p0, p1, p2, p3, i / n)); return o; };
      function ribbon(P, wf) {
        const L = [], R = [], n = P.length;
        for (let i = 0; i < n; i++) {
          const a = P[Math.max(0, i - 1)], b = P[Math.min(n - 1, i + 1)];
          let tx = b[0] - a[0], ty = b[1] - a[1]; const d = Math.hypot(tx, ty) || 1; tx /= d; ty /= d;
          const ww = wf(i / (n - 1));
          L.push([P[i][0] - ty * ww, P[i][1] + tx * ww]); R.push([P[i][0] + ty * ww, P[i][1] - tx * ww]);
        }
        ctx.beginPath(); ctx.moveTo(L[0][0], L[0][1]);
        for (let i = 1; i < n; i++) ctx.lineTo(L[i][0], L[i][1]);
        for (let i = n - 1; i >= 0; i--) ctx.lineTo(R[i][0], R[i][1]);
        ctx.closePath();
      }
      const drip = (x, y, l, r) => { rr(ctx, x - r * 0.62, y, r * 1.24, l, r * 0.62); ctx.fill(); circ(ctx, x, y + l, r); ctx.fill(); };

      // ---- pose ----
      const sink = (1 - rev) * 96 + dvW * 8;
      const bob = Math.sin(t * 0.9) * 4 + sink;
      const tf = walk ? 2.4 : 1.25;                                   // tail beat speed
      const tw = Math.sin(t * tf) * 7;                                 // tail-stock vertical wave
      const ta = Math.sin(t * tf - 0.7) * 0.16 - dvW * 0.25;           // fluke angle
      const fa = Math.sin(t * 1.1 + 0.4) * 0.13 + (walk ? Math.sin(t * 2.4) * 0.08 : 0);
      const ja = swW * 0.62 + (swR > 0 ? clamp01((swR - 0.55) / 0.45) * 0.62 : 0);   // jaw opening (rad)
      const H = [62, -62];                                             // jaw hinge (mouth corner)
      const J = (x, y, k) => { const a = ja * k, c = Math.cos(a), s = Math.sin(a), dx = x - H[0], dy = y - H[1]; return [H[0] + dx * c - dy * s, H[1] + dx * s + dy * c]; };
      const U = [162, -73];
      const j0 = J(72, -14, 0.35), j1 = J(116, -20, 0.7), j2 = J(152, -40, 0.9), C = J(161, -64, 1);
      const bodyPath = () => {
        ctx.beginPath(); ctx.moveTo(U[0], U[1]);
        ctx.bezierCurveTo(168, -90, 142, -118, 96, -132);
        ctx.bezierCurveTo(56, -146, 4, -158, -46, -150);
        ctx.bezierCurveTo(-96, -140, -136, -114 + tw * 0.5, -170, -100 + tw);
        ctx.lineTo(-172, -86 + tw);
        ctx.bezierCurveTo(-130, -64 + tw * 0.5, -80, -14, -20, -11);
        ctx.bezierCurveTo(14, -9, 40, -8, j0[0], j0[1]);
        ctx.bezierCurveTo(j1[0], j1[1], j2[0], j2[1], C[0], C[1]);
        ctx.lineTo(H[0], H[1]); ctx.closePath();
      };
      // top contour only (for the rim light)
      const backPath = () => {
        ctx.beginPath(); ctx.moveTo(136, -118);
        ctx.bezierCurveTo(122, -126, 108, -129, 96, -132);
        ctx.bezierCurveTo(56, -146, 4, -158, -46, -150);
        ctx.bezierCurveTo(-96, -140, -136, -114 + tw * 0.5, -170, -100 + tw);
      };

      // ---- surfaced: dark water pool on the ground (behind) ----
      if (surf) {
        ctx.fillStyle = 'rgba(8,6,26,.85)'; ell(ctx, -6, -1, 210, 14); ctx.fill();
        ctx.globalCompositeOperation = 'lighter'; ctx.save(); ctx.scale(1, 0.16); sglow(ctx, 0, -40, 220, '110,120,230', 0.3); ctx.restore(); ctx.globalCompositeOperation = 'source-over';
      }
      // ---- dive: a pool of dark dream-water opening under it ----
      const dv = Math.max(1 - rev, dvW * 0.5);
      if (dv > 0.02) {
        ctx.fillStyle = `rgba(6,4,22,${(0.8 * dv).toFixed(3)})`; ell(ctx, -4, -4, 120 + dv * 110, 10 + dv * 12); ctx.fill();
      }
      // soft aura
      ctx.globalCompositeOperation = 'lighter';
      sglow(ctx, -10, -84 + bob, 190, P2 ? '150,90,230' : '90,90,220', (0.2 + (P2 ? 0.1 : 0) + swW * 0.12) * (0.35 + rev * 0.65));
      ctx.globalCompositeOperation = 'source-over';

      const bodyA = ease(clamp01((rev - 0.12) / 0.88));
      ctx.save();
      if (dv > 0.02) { ctx.beginPath(); ctx.rect(-400, -600, 900, 596 + Math.sin(t * 2.4) * 1.5); ctx.clip(); }
      ctx.translate(0, bob);
      const pa0 = ctx.globalAlpha;
      if (bodyA > 0.01) {
        ctx.globalAlpha = pa0 * bodyA;
        // ---- flukes ----
        ctx.save(); ctx.translate(-168, -93 + tw); ctx.rotate(ta - 0.12);
        const fluke = (sy) => {
          if (sy > 0) {   // near fluke: broad, sweeping up and back
            ctx.beginPath(); ctx.moveTo(6, -6);
            ctx.bezierCurveTo(-10, -10, -30, -26, -54, -42);
            if (P2) {      // ragged, bitten trailing edge
              const e = [[-54, -42], [-50, -31], [-45, -20], [-38, -10], [-30, -2]];
              for (let i = 1; i < e.length; i++) ctx.quadraticCurveTo((e[i - 1][0] + e[i][0]) / 2 + 4.5, (e[i - 1][1] + e[i][1]) / 2 + 1, e[i][0], e[i][1]);
            } else ctx.bezierCurveTo(-50, -28, -42, -12, -30, -2);
            ctx.quadraticCurveTo(-14, 3, 6, 4); ctx.closePath();
          } else {        // far fluke: foreshortened, darker
            ctx.beginPath(); ctx.moveTo(4, 0);
            ctx.bezierCurveTo(-10, 4, -24, 12, -42, 22);
            ctx.bezierCurveTo(-40, 12, -34, 5, -26, 1); ctx.closePath();
          }
        };
        for (const sy of [-1, 1]) {
          fluke(sy);
          ctx.fillStyle = lgc(ctx, 'whale-fluke', 0, 0, -46, 0, [[0, BODY_T], [0.5, '#2c3a6e'], [1, '#7f9fc0']]); ctx.fill();
          ctx.fillStyle = sy < 0 ? 'rgba(6,4,24,.38)' : 'rgba(0,0,0,0)'; ctx.fill();
          ctx.strokeStyle = WINK; ctx.lineWidth = 2.6; ctx.stroke();
          ctx.strokeStyle = sy > 0 ? RIM : 'rgba(150,170,230,.35)'; ctx.lineWidth = 1; ctx.stroke();
        }
        // torn trailing edge in phase 2
        ctx.restore();

        // ---- mouth interior (visible when the jaw opens) ----
        if (ja > 0.02) {
          ctx.beginPath(); ctx.moveTo(H[0], H[1]); ctx.lineTo(U[0], U[1]);
          ctx.quadraticCurveTo(U[0] + 10 + ja * 20, (U[1] + C[1]) / 2, C[0], C[1]); ctx.closePath();
          ctx.fillStyle = '#06030f'; ctx.fill();
          ctx.save(); ctx.clip();
          ctx.globalCompositeOperation = 'lighter'; sglow(ctx, H[0] + 30, H[1] + 6, 60, '170,140,255', 0.45 * ja / 0.62); ctx.globalCompositeOperation = 'source-over';
          ctx.restore();
        }

        // ---- body: translucent ink with a night sky inside ----
        bodyPath();
        ctx.fillStyle = lgc(ctx, 'whale-body', 0, -160, 0, -10, [[0, BODY_T], [0.55, '#232a5e'], [1, BODY_B]]);
        const pa1 = ctx.globalAlpha; ctx.globalAlpha = pa1 * 0.9; ctx.fill(); ctx.globalAlpha = pa1;
        ctx.save(); bodyPath(); ctx.clip();
        // the deep inside: a darker, softer core you look into
        ctx.save(); ctx.scale(1, 0.42); sglow(ctx, -6, -84 / 0.42, 150, '5,6,26', 0.85); ctx.restore();
        // nebula glows
        const neb = P2 ? 1.55 : 1;
        ctx.globalCompositeOperation = 'lighter';
        sglow(ctx, -60 + Math.sin(t * 0.2) * 6, -96, 58, '120,80,210', 0.3 * neb);
        sglow(ctx, 28, -110, 46, '80,130,220', 0.26 * neb);
        sglow(ctx, -112, -98, 34, '200,110,190', 0.2 * neb);
        sglow(ctx, 70, -52, 30, '120,170,230', 0.16 * neb);
        // a faint milky band drifting along the body
        for (let i = 0; i < 9; i++) { const k = i / 8; sglow(ctx, lerp(-130, 110, k), -70 - Math.sin(k * 3.1) * 40, 22, '190,180,255', 0.1 * neb); }
        ctx.globalCompositeOperation = 'source-over';
        // drifting round lights (no star shapes)
        for (let i = 0; i < 54; i++) {
          const x = -168 + (((hsh(i) * 330 - t * (2 + hsh(i + 9) * 3)) % 330) + 330) % 330;
          const y = -152 + hsh(i + 50) * 138;
          const tw2 = 0.55 + 0.45 * Math.sin(t * (1 + hsh(i + 3) * 2.2) + i);
          const r = 0.6 + hsh(i + 20) * (i % 9 === 0 ? 1.8 : 1.0);
          const col = i % 7 === 0 ? '255,214,236' : i % 5 === 0 ? '200,226,255' : '238,236,255';
          const a = (0.35 + 0.55 * tw2) * (P2 ? 1 : 0.8);
          if (r > 1.4) { ctx.globalCompositeOperation = 'lighter'; sglow(ctx, x, y, r * 5, col, a * 0.5); ctx.globalCompositeOperation = 'source-over'; }
          ctx.fillStyle = `rgba(${col},${a.toFixed(3)})`; circ(ctx, x, y, r); ctx.fill();
        }
        // ---- swallowed residents: tiny warm silhouettes on a soft hill inside, looking up ----
        if (nB > 0) {
          ctx.globalCompositeOperation = 'lighter'; sglow(ctx, -12, -34, 48, '255,190,120', 0.16 + nB * 0.05); ctx.globalCompositeOperation = 'source-over';
          ctx.beginPath(); ctx.moveTo(-70, -16); ctx.quadraticCurveTo(-14, -44, 46, -20); ctx.lineTo(46, -6); ctx.lineTo(-70, -6); ctx.closePath();
          ctx.fillStyle = 'rgba(10,10,36,.75)'; ctx.fill();
          ctx.strokeStyle = 'rgba(255,214,170,.25)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(-64, -19); ctx.quadraticCurveTo(-14, -45, 42, -22); ctx.stroke();
          const WARM = '#f0c27e';
          const res = [[-14, -31.5, 0], [-40, -25, 1], [14, -27.5, 2]];
          for (let i = 0; i < nB; i++) {
            const [x, y, kind] = res[i], br = Math.sin(t * 1.3 + i * 2) * 0.4;
            ctx.save(); ctx.translate(x, y);
            ctx.globalCompositeOperation = 'lighter'; sglow(ctx, 0, -6, 13, '255,200,130', 0.4); ctx.globalCompositeOperation = 'source-over';
            ctx.fillStyle = WARM;
            if (kind === 0) {        // hugging the knees, head tipped back
              ctx.beginPath(); ctx.moveTo(-4.5, 0); ctx.quadraticCurveTo(-5.5, -7, -2, -8.5); ctx.quadraticCurveTo(3, -8, 5, -3); ctx.quadraticCurveTo(5.5, 0, 3, 0); ctx.closePath(); ctx.fill();
              circ(ctx, -2.6, -11.2 + br, 3.1); ctx.fill();
            } else if (kind === 1) { // leaning back on the hands
              ctx.beginPath(); ctx.moveTo(-5, 0); ctx.lineTo(-4.5, -3); ctx.quadraticCurveTo(-3, -8.5, 0, -8); ctx.quadraticCurveTo(2, -4, 6, -2); ctx.lineTo(7, 0); ctx.closePath(); ctx.fill();
              ctx.strokeStyle = WARM; ctx.lineWidth = 1.4; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(-2, -6.5); ctx.lineTo(-5.5, -0.5); ctx.stroke(); ctx.lineCap = 'butt';
              circ(ctx, -1.6, -11 + br, 3); ctx.fill();
            } else {                 // pointing up at the inner sky
              ctx.beginPath(); ctx.moveTo(-4, 0); ctx.quadraticCurveTo(-4.5, -7, -1, -8.5); ctx.quadraticCurveTo(3, -7.5, 4, -2); ctx.lineTo(4.5, 0); ctx.closePath(); ctx.fill();
              ctx.strokeStyle = WARM; ctx.lineWidth = 1.3; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(1.5, -6.5); ctx.lineTo(3.5 + br, -14); ctx.stroke(); ctx.lineCap = 'butt';
              circ(ctx, -0.4, -11.4, 3); ctx.fill();
            }
            ctx.restore();
          }
        }
        // ventral pleats along the throat (parallel, follow the jaw)
        ctx.strokeStyle = 'rgba(150,170,235,.2)'; ctx.lineWidth = 1.3;
        ctx.beginPath();
        for (let k = 0; k < 4; k++) {
          const a = J(154 - k * 3, -56 + k * 6, 0.9), b = J(116, -32 + k * 4.4, 0.65), c = J(72, -22 + k * 3.6, 0.3);
          ctx.moveTo(a[0], a[1]); ctx.quadraticCurveTo(b[0], b[1], c[0], c[1]); ctx.quadraticCurveTo(30, -19 + k * 3, -16, -19 + k * 2.6);
        }
        ctx.stroke();
        // shading on the back half and lower belly
        ctx.fillStyle = 'rgba(4,2,18,.32)'; ell(ctx, -150, -90, 60, 70); ctx.fill();
        ctx.fillStyle = 'rgba(150,170,240,.08)'; ell(ctx, 40, -128, 90, 14, -0.08); ctx.fill();
        // phase 2: ink seeping in from torn edges
        if (P2) {
          bodyPath(); ctx.strokeStyle = 'rgba(6,3,18,.5)'; ctx.lineWidth = 16; ctx.stroke();
          ctx.strokeStyle = 'rgba(6,3,18,.5)'; ctx.lineWidth = 7; ctx.stroke();
        }
        ctx.restore();
        // outline + violet rim along the back
        bodyPath(); ctx.strokeStyle = WINK; ctx.lineWidth = 3.2; ctx.stroke();
        backPath(); ctx.strokeStyle = RIM; ctx.lineWidth = 1.3; ctx.stroke();
        ctx.strokeStyle = 'rgba(140,170,230,.3)'; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(-120, -64); ctx.bezierCurveTo(-80, -26, -40, -12, -10, -13); ctx.stroke();
        // mouth line
        ctx.strokeStyle = WINK; ctx.lineWidth = 2.2; ctx.beginPath(); ctx.moveTo(C[0] - 1, C[1]); ctx.quadraticCurveTo(116, ja > 0.02 ? (H[1] + C[1]) / 2 + 4 : -50, H[0], H[1]); ctx.stroke();
        if (ja <= 0.02) { ctx.strokeStyle = 'rgba(160,170,240,.3)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(156, -69); ctx.quadraticCurveTo(116, -56, 64, -66); ctx.stroke(); }

        // ---- dorsal fin ----
        ctx.beginPath(); ctx.moveTo(-104, -139); ctx.quadraticCurveTo(-92, -150, -84, -162); ctx.quadraticCurveTo(-80, -154, -66, -146); ctx.closePath();
        ctx.fillStyle = '#1c1b48'; ctx.fill(); ctx.strokeStyle = WINK; ctx.lineWidth = 2.4; ctx.stroke();
        ctx.strokeStyle = RIM; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(-102, -140); ctx.quadraticCurveTo(-92, -150, -84, -161); ctx.stroke();
        // blowhole
        ell(ctx, 44, -146, 6, 2, -0.2); ctx.fillStyle = '#05030f'; ctx.fill();

        // ---- barnacle-like ink spots (clusters on the head and back) ----
        const spot = (x, y, r) => { circ(ctx, x, y, r); ctx.fillStyle = '#0b0820'; ctx.fill(); ctx.strokeStyle = 'rgba(180,160,240,.45)'; ctx.lineWidth = 0.8; ctx.stroke(); ctx.fillStyle = 'rgba(200,190,250,.35)'; circ(ctx, x - r * 0.25, y - r * 0.3, r * 0.35); ctx.fill(); };
        for (const s of [[120, -116, 3.2], [128, -110, 2.4], [112, -121, 2], [136, -102, 2.6], [128, -98, 1.6], [144, -92, 1.8], [-18, -152, 2.4], [-28, -148, 1.8], [-10, -150, 1.5], [-132, -102, 2], [-124, -106, 1.4]]) spot(s[0], s[1], s[2]);
        for (const s of [[144, -46, 2.2], [134, -38, 1.6], [150, -52, 1.4]]) { const p = J(s[0], s[1], 0.9); spot(p[0], p[1], s[2]); }

        // ---- the eye: gentle, sad, glowing ----
        const E = [76, -78], bl = eBlink(t + 1.3, 5.2);
        ctx.globalCompositeOperation = 'lighter'; sglow(ctx, E[0] + 2, E[1], 26, '255,180,240', 0.5 + (P2 ? 0.15 : 0) + swW * 0.2); ctx.globalCompositeOperation = 'source-over';
        ell(ctx, E[0], E[1], 8, 5.6); ctx.fillStyle = '#0a0618'; ctx.fill();
        eEye(ctx, E[0] + 0.6, E[1] + 0.8, 5.8, 3.6 * bl, 0);
        ctx.fillStyle = 'rgba(120,60,140,.75)'; circ(ctx, E[0] + 2.2, E[1] + 1.2, 1.9 * bl); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,.85)'; circ(ctx, E[0] + 2.8, E[1] - 0.4, 0.8); ctx.fill();
        // drooping lid + soft brow fold
        ctx.strokeStyle = WINK; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(E[0] - 7.5, E[1] - 3.4); ctx.quadraticCurveTo(E[0] + 1, E[1] - 6.6, E[0] + 7.6, E[1] - 1.6); ctx.stroke();
        ctx.strokeStyle = 'rgba(170,160,240,.35)'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(E[0] - 9, E[1] - 9); ctx.quadraticCurveTo(E[0], E[1] - 13, E[0] + 9, E[1] - 7); ctx.stroke();

        // ---- ink drips from the belly (more and longer in phase 2) ----
        ctx.fillStyle = '#08051c';
        for (let i = 0; i < 4 + (P2 ? 4 : 0); i++) {
          const x = -96 + i * (P2 ? 24 : 40) + Math.sin(i * 3.1) * 6;
          const y = x < -10 ? lerp(-36, -12, (x + 96) / 86) : -10;
          drip(x, y - 2, 4 + (Math.sin(t * 1.1 + i * 2.1) + 1) * (P2 ? 9 : 5), 2.2);
        }
        if (P2) {
          // torn, inky tatters along the belly
          ctx.fillStyle = 'rgba(6,3,18,.92)';
          for (let i = 0; i < 9; i++) {
            const x = -128 + i * 21 + Math.sin(i * 1.7) * 4, y = (x < -20 ? lerp(-60, -12, (x + 128) / 108) : -11) - 1;
            const l = 9 + (i % 3) * 6 + Math.sin(t * 2.4 + i) * 2.5, sw = Math.sin(t * 2 + i * 1.3) * 3;
            ribbon(curve([x, y - 3], [x - 2, y + l * 0.35], [x + 3 + sw, y + l * 0.7], [x - 1 + sw, y + l], 6), (k) => (1 - k) * 3.4 + 0.8); ctx.fill();
            circ(ctx, x - 1 + sw, y + l, 1.7); ctx.fill();
          }
          // ink smoke curling off the back
          for (let i = 0; i < 5; i++) { const p = (t * 0.35 + i / 5) % 1, x = -120 + i * 44 - p * 30, y = -146 - p * 46 + Math.sin(x * 0.05) * 6; sglow(ctx, x, y, 10 + p * 16, '10,6,28', 0.75 * (1 - p)); }
        }
        // ---- near pectoral fin: long, scalloped leading edge, sky-faded tip ----
        ctx.save(); ctx.translate(44, -32); ctx.rotate(Math.PI - 0.4 + fa);
        const FP = curve([-16, -1], [26, -7], [76, -2], [112, 10], 14);
        const fw = (k) => (k < 0.24 ? lerp(5, 15, Math.sqrt(k / 0.24)) : lerp(15, 2.4, (k - 0.24) / 0.76));
        ribbon(FP, fw);
        ctx.fillStyle = lgc(ctx, 'whale-pec', 0, 0, 112, 0, [[0, '#20225a'], [0.55, '#34457a'], [1, '#8aaac8']]); ctx.fill();
        ctx.strokeStyle = WINK; ctx.lineWidth = 2.6; ctx.stroke();
        // knobbly leading edge (round bumps)
        for (let i = 4; i < 13; i += 2) {
          const p = FP[i], q = FP[i + 1], d = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1, ww = fw(i / 14);
          const x = p[0] + (q[1] - p[1]) / d * ww, y = p[1] - (q[0] - p[0]) / d * ww;
          circ(ctx, x, y, 2.9 - i * 0.14); ctx.fillStyle = i < 8 ? '#2c3468' : '#5c78a2'; ctx.fill(); ctx.strokeStyle = WINK; ctx.lineWidth = 1.4; ctx.stroke();
        }
        ctx.strokeStyle = 'rgba(190,210,255,.35)'; ctx.lineWidth = 1.1; ctx.beginPath(); ctx.moveTo(10, -4); ctx.quadraticCurveTo(50, -9, 96, 2); ctx.stroke();
        if (P2) {        // ink strands trailing from the fin's back edge
          ctx.strokeStyle = 'rgba(6,3,18,.85)'; ctx.lineWidth = 2; ctx.lineCap = 'round';
          ctx.beginPath(); for (let i = 0; i < 3; i++) { const p = FP[6 + i * 3], o = fw((6 + i * 3) / 14); ctx.moveTo(p[0], p[1] + o - 1); ctx.quadraticCurveTo(p[0] - 4, p[1] + o + 6, p[0] - 2 + Math.sin(t * 3 + i) * 2, p[1] + o + 11); } ctx.stroke(); ctx.lineCap = 'butt';
        }
        ctx.restore();

      }
      ctx.globalAlpha = pa0;

      // ---- dive: faint outline + the eye left in the dark ----
      if (rev < 0.98) {
        const oa = (1 - rev * 0.7) * 0.8 * (0.7 + 0.3 * Math.sin(t * 2));
        bodyPath(); ctx.strokeStyle = `rgba(190,170,255,${(oa * 0.7).toFixed(3)})`; ctx.lineWidth = 1.4; ctx.setLineDash([6, 5]); ctx.stroke(); ctx.setLineDash([]);
        ctx.globalCompositeOperation = 'lighter'; sglow(ctx, 78, -84, 18, '255,180,240', (1 - rev) * 0.6); ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = `rgba(255,216,246,${((1 - rev) * 0.8).toFixed(3)})`; circ(ctx, 77, -84, 2); ctx.fill();
      }

      // ---- swallow: a gentle inward current of round motes ----
      const sA = Math.max(swW, swR > 0 ? clamp01((swR - 0.4) / 0.6) : 0);
      if (sA > 0.02) {
        const mx = 150, my = (U[1] + C[1]) / 2 + 2;
        ctx.globalCompositeOperation = 'lighter';
        sglow(ctx, mx + 10, my, 70, '170,150,255', 0.3 * sA);
        for (let i = 0; i < 16; i++) {
          const p = (t * 0.55 + hsh(i + 70)) % 1;
          const sx = 330 - hsh(i + 1) * 90, sy = -150 + hsh(i + 30) * 170;
          const k = ease(p);
          const curl = Math.sin(p * Math.PI) * (hsh(i + 5) - 0.5) * 70;
          for (let j = 0; j < 3; j++) {
            const kk = Math.max(0, k - j * 0.05);
            const x = lerp(sx, mx, kk), y = lerp(sy, my, kk) + curl * (1 - kk);
            const r = (2.6 - j * 0.7) * (1 - kk * 0.55);
            const a = sA * Math.sin(p * Math.PI) * (1 - j * 0.3);
            ctx.fillStyle = `rgba(${i % 3 ? '220,214,255' : '255,214,240'},${a.toFixed(3)})`; circ(ctx, x, y, r); ctx.fill();
            if (!j) sglow(ctx, x, y, r * 4, '190,170,255', a * 0.4);
          }
        }
        ctx.globalCompositeOperation = 'source-over';
      }

      // ---- spout: a water column from the blowhole, droplets falling back ----
      const sp = Math.max(spW * 0.75, spR > 0 ? 1 - Math.pow(1 - spR, 3) * 0.2 : 0);
      if (sp > 0.02) {
        const bx = 38, by = -152, h = 30 + sp * 170 + Math.sin(t * 9) * 4 * sp;
        const top = by - h;
        // column (wobbling, widening upward)
        ctx.beginPath(); ctx.moveTo(bx - 5, by);
        for (let i = 1; i <= 10; i++) { const k = i / 10, y = by - h * k; ctx.lineTo(bx - 5 - k * 12 + Math.sin(t * 11 + i * 1.3) * 1.6 * k, y); }
        for (let i = 10; i >= 1; i--) { const k = i / 10, y = by - h * k; ctx.lineTo(bx + 5 + k * 12 + Math.sin(t * 12 + i * 1.7) * 1.6 * k, y); }
        ctx.lineTo(bx + 5, by); ctx.closePath();
        ctx.fillStyle = `rgba(150,180,235,${(0.5 * sp).toFixed(3)})`; ctx.fill();
        ctx.strokeStyle = `rgba(6,4,24,${(0.55 * sp).toFixed(3)})`; ctx.lineWidth = 2; ctx.stroke();
        ctx.strokeStyle = `rgba(225,236,255,${(0.6 * sp).toFixed(3)})`; ctx.lineWidth = 1.4;
        ctx.beginPath(); for (let s = -1; s <= 1; s += 2) { ctx.moveTo(bx + s * 2, by - 6); ctx.quadraticCurveTo(bx + s * 4, by - h * 0.5, bx + s * 6 + Math.sin(t * 8 + s) * 2, top + 10); } ctx.stroke();
        ctx.globalCompositeOperation = 'lighter'; sglow(ctx, bx, top + 6, 40 + sp * 20, '170,200,255', 0.45 * sp); ctx.globalCompositeOperation = 'source-over';
        // spray cloud at the top (soft round puffs)
        for (let i = 0; i < 7; i++) {
          const a = hsh(i + 40) * 6.28, r = 9 + hsh(i + 41) * 9;
          const x = bx + Math.cos(a) * (8 + hsh(i) * 14) + Math.sin(t * 3 + i) * 2, y = top + 4 + Math.sin(a) * 7;
          ctx.fillStyle = `rgba(200,220,255,${(0.28 * sp).toFixed(3)})`; circ(ctx, x, y, r * (0.6 + sp * 0.4)); ctx.fill();
        }
        // droplets arcing down on irregular paths
        for (let i = 0; i < 14; i++) {
          const p = (t * 0.8 + hsh(i + 90)) % 1;
          const vx = (hsh(i + 7) - 0.5) * 150, vy = -40 - hsh(i + 8) * 60;
          const x = bx + vx * p, y = top + 8 + vy * p + 260 * p * p;
          if (y > by + 40) continue;
          const r = 1.6 + hsh(i + 11) * 2;
          ctx.fillStyle = `rgba(205,225,255,${(0.85 * sp * (1 - p * 0.6)).toFixed(3)})`; circ(ctx, x, y, r); ctx.fill();
          ctx.strokeStyle = `rgba(6,4,24,${(0.4 * sp).toFixed(3)})`; ctx.lineWidth = 0.8; ctx.stroke();
        }
      }
      ctx.restore();

      // ---- dive ripples on the dark water ----
      if (dv > 0.02) {
        ctx.lineWidth = 1.6;
        for (let i = 0; i < 3; i++) {
          const p = (t * 0.45 + i / 3) % 1;
          ctx.strokeStyle = `rgba(190,170,255,${(0.6 * dv * (1 - p)).toFixed(3)})`;
          ell(ctx, -4, -4, 60 + p * (150 + dv * 60), 6 + p * 14); ctx.stroke();
        }
        ctx.strokeStyle = `rgba(150,130,240,${(0.5 * dv).toFixed(3)})`; ctx.lineWidth = 1.2;
        ctx.beginPath(); for (let x = -200; x <= 190; x += 10) { const y = -4 + Math.sin(x * 0.06 + t * 2.4) * 2.4; if (x === -200) ctx.moveTo(x, y); else ctx.lineTo(x, y); } ctx.stroke();
      }

      // ---- surfaced: water sheet around the lower body + splash ring ----
      if (surf) {
        const top = (x) => -44 - Math.cos(x / 200 * 1.4) * 12 + Math.sin(x * 0.045 + t * 2.6) * 4 + Math.sin(x * 0.11 - t * 1.7) * 2;
        ctx.beginPath(); ctx.moveTo(-214, 4);
        for (let x = -214; x <= 200; x += 8) ctx.lineTo(x, top(x) * (1 - Math.pow(Math.abs(x) / 214, 6)));
        ctx.lineTo(200, 4); ctx.closePath();
        ctx.fillStyle = lgc(ctx, 'whale-sheet', 0, -52, 0, 4, [[0, 'rgba(70,90,170,.6)'], [0.5, 'rgba(30,34,96,.85)'], [1, 'rgba(10,8,40,.95)']]); ctx.fill();
        ctx.strokeStyle = 'rgba(200,215,255,.65)'; ctx.lineWidth = 1.8;
        ctx.beginPath(); for (let x = -200; x <= 188; x += 8) { const y = top(x) * (1 - Math.pow(Math.abs(x) / 214, 6)); if (x === -200) ctx.moveTo(x, y); else ctx.lineTo(x, y); } ctx.stroke();
        ctx.strokeStyle = 'rgba(180,190,255,.25)'; ctx.lineWidth = 1.2;
        ctx.beginPath(); for (let x = -150; x <= 140; x += 8) { const y = top(x) + 16 + Math.sin(x * 0.07 + t * 1.9) * 3; if (x === -150) ctx.moveTo(x, y); else ctx.lineTo(x, y); } ctx.stroke();
        // foam dots on the surface line
        ctx.fillStyle = 'rgba(220,230,255,.7)';
        for (let i = 0; i < 12; i++) { const x = -190 + i * 33 + Math.sin(t + i) * 6; circ(ctx, x, top(x) - 1, 1.6 + (i % 3) * 0.6); ctx.fill(); }
        // splash ring + droplets thrown from the head and tail
        const p = (t * 0.7) % 1;
        ctx.strokeStyle = `rgba(200,210,255,${(0.6 * (1 - p)).toFixed(3)})`; ctx.lineWidth = 2;
        ell(ctx, -6, 0, 180 + p * 40, 14 + p * 6); ctx.stroke();
        ctx.lineWidth = 1.2; ell(ctx, -6, 0, 216 + p * 26, 18 + p * 4); ctx.stroke();
        for (let i = 0; i < 12; i++) {
          const q = (t * 0.9 + hsh(i + 60)) % 1, side = i % 2 ? 1 : -1;
          const x0 = side > 0 ? 150 : -170, vx = side * (30 + hsh(i + 61) * 70), vy = -90 - hsh(i + 62) * 70;
          const x = x0 + vx * q, y = -34 + vy * q + 200 * q * q;
          if (y > 0) continue;
          ctx.fillStyle = `rgba(210,225,255,${(0.8 * (1 - q)).toFixed(3)})`; circ(ctx, x, y, 1.6 + hsh(i + 63) * 2); ctx.fill();
        }
      }
    },


    // ---------------- 最終ボス「灯を喰らうもの」 ----------------
    devourer(ctx, u) {
      // 灯を喰らうもの — born from the dream-light a lighthouse gathered for years, fused with the distortion of
      // the sea of forgetting. A warped, dark echo of the tower: bands of many faded dream colours, a hungry
      // lantern for a head, a broken halo, long shadow arms. It wants to devour the light itself.
      const t = u.anim || 0, at = u.atk || 0, P2 = (u.phase || 1) >= 2;
      const wind = clamp01(u.wind || 0), w = ease(wind), wk = u.windKind;
      const slW = wind > 0 && wk === 'slam' ? w : 0;
      const slR = wind <= 0 && at > 0 && wk !== 'drain' && wk !== 'beam' ? at : 0;     // default attack = slam
      const drA = Math.max(wind > 0 && wk === 'drain' ? w : 0, wind <= 0 && at > 0 && wk === 'drain' ? at : 0);
      const bmW = wind > 0 && wk === 'beam' ? w : 0;
      const bmR = wind <= 0 && at > 0 && wk === 'beam' ? at : 0;
      const sh = clamp01(u.shield || 0), sv = clamp01(u.starve || 0);
      const walk = !!u.walk;
      const hsh = (n) => { const s = Math.sin(n * 127.1 + 31.7) * 43758.5453; return s - Math.floor(s); };
      const DINK = '#0c0616', DARK = '#140b20';
      ctx.lineJoin = 'round';
      const bz3 = (p0, p1, p2, p3, s) => { const r = 1 - s; return [r * r * r * p0[0] + 3 * r * r * s * p1[0] + 3 * r * s * s * p2[0] + s * s * s * p3[0], r * r * r * p0[1] + 3 * r * r * s * p1[1] + 3 * r * s * s * p2[1] + s * s * s * p3[1]]; };
      const curve = (p0, p1, p2, p3, n) => { const o = []; for (let i = 0; i <= n; i++) o.push(bz3(p0, p1, p2, p3, i / n)); return o; };
      function ribbon(P, wf) {
        const L = [], R = [], n = P.length;
        for (let i = 0; i < n; i++) {
          const a = P[Math.max(0, i - 1)], b = P[Math.min(n - 1, i + 1)];
          let tx = b[0] - a[0], ty = b[1] - a[1]; const d = Math.hypot(tx, ty) || 1; tx /= d; ty /= d;
          const ww = wf(i / (n - 1));
          L.push([P[i][0] - ty * ww, P[i][1] + tx * ww]); R.push([P[i][0] + ty * ww, P[i][1] - tx * ww]);
        }
        ctx.beginPath(); ctx.moveTo(L[0][0], L[0][1]);
        for (let i = 1; i < n; i++) ctx.lineTo(L[i][0], L[i][1]);
        for (let i = n - 1; i >= 0; i--) ctx.lineTo(R[i][0], R[i][1]);
        ctx.closePath();
      }
      const ik = (ax, ay, bx, by, l1, l2, px, py) => {
        let dx = bx - ax, dy = by - ay, d = Math.hypot(dx, dy) || 1;
        const mx = l1 + l2 - 0.5;
        if (d > mx) { bx = ax + dx / d * mx; by = ay + dy / d * mx; dx = bx - ax; dy = by - ay; d = mx; }
        const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
        let nx = -dy / d, ny = dx / d; if (nx * px + ny * py < 0) { nx = -nx; ny = -ny; }
        return [ax + dx / d * a + nx * h, ay + dy / d * a + ny * h, bx, by];
      };
      const drip = (x, y, l, r) => { rr(ctx, x - r * 0.62, y, r * 1.24, l, r * 0.62); ctx.fill(); circ(ctx, x, y + l, r); ctx.fill(); };
      const add = (fn) => { ctx.globalCompositeOperation = 'lighter'; fn(); ctx.globalCompositeOperation = 'source-over'; };

      // ---- pose ----
      const lean = (P2 ? 0.13 + Math.sin(t * 0.8) * 0.015 : 0) + (walk ? Math.sin(t * 2.2) * 0.012 : Math.sin(t * 0.9) * 0.006);
      // slam timing: k = how far the claw has travelled down, back = recovery to rest (no tilt after)
      let slK = 0, slBack = 0;
      if (slR > 0) { slK = ease(clamp01((1 - slR) * 3.4)); slBack = ease(clamp01((0.42 - slR) / 0.42)); }
      const slHit = slK * (1 - slBack);
      const hunch = slW * 0.4 + slHit;                         // shoulders dip into the slam, then recover
      const lamp = clamp01(0.42 + drA * 0.5 + Math.max(bmW, bmR) * 0.6 + (P2 ? 0.12 : 0)) * (1 - sv * 0.82);
      const flick = 0.85 + 0.15 * Math.sin(t * 7.3) * Math.sin(t * 3.1);
      const LX = 0, LY = -308;                                  // lantern centre (leaned frame)

      // ---- ground: the sea it rose from ----
      ctx.fillStyle = 'rgba(8,4,20,.9)'; ell(ctx, 4, -1, 168, 13); ctx.fill();
      for (let i = 0; i < 7; i++) { const px = -150 + i * 50 + Math.sin(i * 2.1) * 8, pr = 5 + (Math.sin(t * 1.1 + i) + 1) * 3; ell(ctx, px, -1, pr * 1.8, pr * 0.42); ctx.fill(); }
      ctx.strokeStyle = 'rgba(150,120,230,.28)'; ctx.lineWidth = 1.3;
      for (let i = 0; i < 2; i++) { const p = (t * 0.3 + i / 2) % 1; ell(ctx, 4, -1, 120 + p * 60, 9 + p * 5); ctx.stroke(); }
      add(() => sglow(ctx, 0, -200, 230, P2 ? '190,70,170' : '130,70,210', 0.22 + drA * 0.12 + (P2 ? 0.1 : 0) - sv * 0.08));

      // ---- roots / ink tendrils ----
      const roots = [[-46, -168, 0.9, 1], [-30, -112, 1.4, 0], [-8, -60, 2.2, 1], [14, 70, 2.9, 0], [34, 128, 3.7, 1], [52, 166, 4.4, 0], [-56, -146, 5.1, 0], [44, 102, 5.9, 1]];
      const root = (r, near) => {
        const [bx, tx, seed, curl] = r;
        const cw = walk ? Math.sin(t * 2.6 + seed) * 10 : Math.sin(t * 0.9 + seed) * 4;
        const tip = [tx + cw, -3 - (curl ? 4 : 0)];
        const P = curve([bx, -40], [bx + (tx - bx) * 0.15, -8], [bx + (tx - bx) * 0.6, 2 + Math.sin(t + seed) * 2], tip, 12);
        const pe = P[P.length - 1], s = tx > 0 ? 1 : -1;
        for (let i = 1; i <= 4; i++) { const a = (s > 0 ? 0 : Math.PI) - s * i * (curl ? 0.75 : 0.35); P.push([pe[0] + Math.cos(a) * i * 2.4 * s * s, pe[1] + Math.sin(a) * i * 2.4]); }
        ribbon(P, (k) => (1 - k) * (near ? 12 : 10) + 1);
        ctx.fillStyle = near ? '#1a0f28' : '#0e0818'; ctx.fill();
        ctx.strokeStyle = DINK; ctx.lineWidth = 2; ctx.stroke();
        if (near) { ctx.strokeStyle = RIM; ctx.lineWidth = 0.9; ctx.beginPath(); for (let i = 1; i < 9; i++) { const p = P[i]; if (i === 1) ctx.moveTo(p[0], p[1] - (1 - i / 16) * 11); else ctx.lineTo(p[0], p[1] - (1 - i / 16) * 11); } ctx.stroke(); }
      };
      for (let i = 0; i < roots.length; i++) if (!roots[i][3]) root(roots[i], false);

      // ===== leaned frame (tower, head, halo, arms) =====
      ctx.save();
      ctx.translate(0, -36); ctx.rotate(lean); ctx.scale(1 + sv * 0.05, 1 - sv * 0.1); ctx.translate(0, 36);
      // head frame (lantern sinks and droops forward when starving)
      const headT = () => { ctx.translate(LX, -270); ctx.rotate(sv * 0.1); ctx.translate(-LX, 270 + sv * 7); };

      // ---- broken halo behind the lantern ----
      const HC = [-4, -326], HR = [100, 92];
      const halA = 1 - sv * 0.65;
      ctx.save(); headT();
      if (!P2) {
        const frags = [[-2.62, -1.86, 0], [-1.52, -0.62, 1], [-0.28, 0.5, 2]];
        for (const [a0, a1, i] of frags) {
          const ox = Math.sin(t * 1.1 + i * 2) * 3, oy = Math.cos(t * 0.9 + i * 1.3) * 2.4 + sv * 10 + i * sv * 4;
          const arcP = (s) => { ctx.beginPath(); ctx.ellipse(HC[0] + ox, HC[1] + oy, HR[0] * s, HR[1] * s, -0.12, a0, a1); };
          const am = (a0 + a1) / 2;
          add(() => sglow(ctx, HC[0] + ox + Math.cos(am) * HR[0], HC[1] + oy + Math.sin(am) * HR[1], 46, '255,226,190', 0.22 * halA));
          ctx.lineCap = 'butt';
          arcP(1); ctx.strokeStyle = DINK; ctx.lineWidth = 11; ctx.stroke();
          ctx.strokeStyle = `rgba(196,182,150,${(0.85 * halA).toFixed(3)})`; ctx.lineWidth = 6.4; ctx.stroke();
          arcP(1.012); ctx.strokeStyle = `rgba(255,244,214,${(0.6 * halA).toFixed(3)})`; ctx.lineWidth = 1.4; ctx.stroke();
          arcP(0.985); ctx.strokeStyle = 'rgba(40,24,40,.5)'; ctx.lineWidth = 1.6; ctx.stroke();
        }
      }
      ctx.restore();

      // ---- arm geometry ----
      const shN = [34 + hunch * 14, -234 + hunch * 26 + sv * 12], shF = [-18 + hunch * 8, -244 + hunch * 18 + sv * 12];
      const sway = Math.sin(t * 1.3) * 5, swayF = Math.sin(t * 1.3 + 1.2) * 4;
      const restN = [154 + sway + (walk ? Math.sin(t * 2.2) * 10 : 0) - sv * 40, -126 + Math.cos(t * 1.3) * 4 + sv * 70];
      let hN = restN.slice();
      let hF = [118 + swayF - sv * 36, -164 + sv * 66 + Math.cos(t * 1.3 + 1) * 3];
      hN = [lerp(hN[0], 58, slW), lerp(hN[1], -404, slW)];
      if (slR > 0) { const up = [58, -404], dn = [184, -24]; const k = slK; hN = [lerp(lerp(up[0], dn[0], k), restN[0], slBack), lerp(lerp(up[1], dn[1], k), restN[1], slBack)]; }
      if (drA > 0) { hN = [lerp(hN[0], 96, drA * 0.6), lerp(hN[1], -262, drA * 0.6)]; hF = [lerp(hF[0], 70, drA * 0.6), lerp(hF[1], -286, drA * 0.6)]; }
      const L1 = 82, L2 = 96;
      function arm(sp, hp, near, slamming) {
        const k = ik(sp[0], sp[1], hp[0], hp[1], L1, L2, 0.3, 1);
        const el = [k[0], k[1]], wr = [k[2], k[3]];
        const col = near ? '#1b1029' : '#100919';
        // two gently bowed segments (sinewy, not stick-straight)
        const seg = (a, b, bow) => { const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2, dx = b[0] - a[0], dy = b[1] - a[1], d = Math.hypot(dx, dy) || 1; const c = [mx - dy / d * bow, my + dx / d * bow]; const o = []; for (let i = 0; i <= 8; i++) { const q = i / 8; o.push([(1 - q) * (1 - q) * a[0] + 2 * (1 - q) * q * c[0] + q * q * b[0], (1 - q) * (1 - q) * a[1] + 2 * (1 - q) * q * c[1] + q * q * b[1]]); } return o; };
        const P = seg(sp, el, -9).concat(seg(el, wr, -7).slice(1));
        // tattered shadow strands hanging off the forearm
        ctx.strokeStyle = near ? 'rgba(18,10,30,.85)' : 'rgba(12,6,22,.8)'; ctx.lineWidth = 2.6; ctx.lineCap = 'round';
        ctx.beginPath();
        for (let i = 0; i < 4; i++) {
          const p = P[5 + i * 3], l = 16 + (i % 2) * 10 + Math.sin(t * 2 + i) * 3, sw2 = Math.sin(t * 1.7 + i * 1.4) * 4;
          ctx.moveTo(p[0], p[1] + 6); ctx.quadraticCurveTo(p[0] - 4 + sw2, p[1] + l * 0.6, p[0] - 2 + sw2 * 1.4, p[1] + l + 6);
        }
        ctx.stroke(); ctx.lineCap = 'butt';
        const aw = (s) => (s < 0.5 ? lerp(near ? 19 : 16, 11, s / 0.5) : lerp(11, 7.5, (s - 0.5) / 0.5)) + Math.sin(s * Math.PI * 2) * 1.6;
        ribbon(P, aw);
        ctx.fillStyle = col; ctx.fill(); ctx.strokeStyle = DINK; ctx.lineWidth = 2.6; ctx.stroke();
        if (near) { ctx.strokeStyle = RIM; ctx.lineWidth = 1.1; ctx.beginPath(); for (let i = 1; i < P.length - 1; i++) { const p = P[i], wv = aw(i / 16) - 1.5; if (i === 1) ctx.moveTo(p[0], p[1] - wv); else ctx.lineTo(p[0], p[1] - wv); } ctx.stroke(); }
        // bony elbow spur (rounded) + a sinew highlight
        ell(ctx, el[0] - 2, el[1] + 3, near ? 9 : 7.5, near ? 7 : 6, 0.6); ctx.fillStyle = col; ctx.fill(); ctx.strokeStyle = DINK; ctx.lineWidth = 2; ctx.stroke();
        if (near) { ctx.strokeStyle = 'rgba(200,170,240,.18)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(P[10][0], P[10][1]); for (let i = 11; i < 15; i++) ctx.lineTo(P[i][0], P[i][1]); ctx.stroke(); }
        // hand + four long claws, curling downward-forward
        const fa = Math.atan2(wr[1] - el[1], wr[0] - el[0]);
        ctx.save(); ctx.translate(wr[0], wr[1]); ctx.rotate(fa);
        ell(ctx, 6, 0, 13, 10); ctx.fillStyle = col; ctx.fill(); ctx.strokeStyle = DINK; ctx.lineWidth = 2.4; ctx.stroke();
        const spread = slamming ? 0.5 : 0.3 + Math.sin(t * 1.6) * 0.05 + drA * 0.2;
        for (let i = 0; i < 4; i++) {
          const a = (i - 1.5) * spread, len = 44 - Math.abs(i - 1.5) * 6 + (near ? 4 : 0);
          const c = Math.cos(a), s = Math.sin(a);
          const crl = 0.5 + (slamming ? -0.2 : 0);
          const C = curve([10 * c, 10 * s], [10 * c + len * 0.45 * c, 10 * s + len * 0.45 * s], [10 * c + len * 0.85 * Math.cos(a + crl * 0.6), 10 * s + len * 0.85 * Math.sin(a + crl * 0.6)], [10 * c + len * Math.cos(a + crl), 10 * s + len * Math.sin(a + crl)], 8);
          ribbon(C, (q) => (1 - q) * 5.4 + 0.5);
          ctx.fillStyle = near ? '#24162e' : '#150c1e'; ctx.fill(); ctx.strokeStyle = DINK; ctx.lineWidth = 1.8; ctx.stroke();
          if (near) { const q = C[6], q2 = C[8]; ctx.strokeStyle = 'rgba(220,200,240,.55)'; ctx.lineWidth = 1.1; ctx.beginPath(); ctx.moveTo(q[0], q[1]); ctx.lineTo(q2[0], q2[1]); ctx.stroke(); }
        }
        ctx.restore();
        return wr;
      }
      // tattered ink mantle over the tower's shoulders (the arms grow out from under it)
      const mantle = () => {
        const y0 = -264, hb = hunch * 10 + sv * 8;
        ctx.beginPath(); ctx.moveTo(-50, y0);
        ctx.quadraticCurveTo(-70, y0 + 6, -72, y0 + 30 + hb);
        eHem(ctx, -72, 70, y0 + 44 + hb, 12, t, 9, 2);
        ctx.quadraticCurveTo(74, y0 + 10 + hb, 50, y0); ctx.closePath();
        ctx.fillStyle = lgc(ctx, 'dev-mantle', -72, 0, 72, 0, [[0, '#0c0716'], [0.6, '#1e1230'], [1, '#140b20']]); ctx.fill();
        ctx.strokeStyle = DINK; ctx.lineWidth = 2.6; ctx.stroke();
        ctx.strokeStyle = RIM; ctx.lineWidth = 1.1; ctx.beginPath(); ctx.moveTo(-50, y0 + 1); ctx.quadraticCurveTo(-69, y0 + 7, -71, y0 + 28 + hb); ctx.stroke();
        // folds + a few round night-lights caught in the cloth
        ctx.strokeStyle = 'rgba(8,4,16,.6)'; ctx.lineWidth = 1.6; ctx.beginPath();
        for (const fx of [-40, -14, 14, 42]) { ctx.moveTo(fx, y0 + 4); ctx.quadraticCurveTo(fx - 3, y0 + 22, fx + 1, y0 + 38 + hb); } ctx.stroke();
        ctx.fillStyle = 'rgba(225,215,255,.45)'; for (let i = 0; i < 6; i++) { circ(ctx, -50 + hsh(i + 61) * 104, y0 + 8 + hsh(i + 62) * 24 + hb * 0.5, 1.2); ctx.fill(); }
        ctx.fillStyle = '#0a0414'; for (let i = 0; i < 3; i++) drip(-46 + i * 40, y0 + 40 + hb, 4 + (Math.sin(t * 1.5 + i * 2) + 1) * 4, 2);
      };
      // far arm (behind the tower)
      arm(shF, hF, false, false);

      // ---- tower body: stacked, warped bands of faded dream colours ----
      const TB = -34, TT = -262;
      const hw = (y) => { const k = (y - TB) / (TT - TB); return lerp(64, 40, k) + Math.sin(k * 7 + 1) * 2.2; };
      const cxo = (y) => { const k = (y - TB) / (TT - TB); return -Math.sin(k * Math.PI) * 6 + Math.sin(k * 11 + 2) * 1.2; };
      const towerPath = () => {
        ctx.beginPath();
        for (let i = 0; i <= 20; i++) { const y = lerp(TB, TT, i / 20), x = cxo(y) - hw(y); if (!i) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
        for (let i = 20; i >= 0; i--) { const y = lerp(TB, TT, i / 20); ctx.lineTo(cxo(y) + hw(y), y); }
        ctx.closePath();
      };
      towerPath(); ctx.fillStyle = DARK; ctx.fill();
      ctx.save(); towerPath(); ctx.clip();
      const bands = [[-34, -64, '#2a2038', 0], [-64, -100, '#3e6462', 1], [-100, -112, '#160d22', 0], [-112, -152, '#8a4844', 2],
        [-152, -188, '#a39880', 3], [-188, -199, '#160d22', 0], [-199, -234, '#8e6276', 4], [-234, -262, '#4c5a84', 5]];
      const edge = (y, i) => (x) => y + Math.sin(x * 0.08 + i * 1.7) * 2.6 + Math.sin(x * 0.21 + i) * 1;
      for (let b = 0; b < bands.length; b++) {
        const [y0, y1, col, pat] = bands[b], e0 = edge(y0, b), e1 = edge(y1, b + 1);
        ctx.beginPath(); ctx.moveTo(-80, b ? e0(-80) : 10);
        for (let x = -80; x <= 80; x += 8) ctx.lineTo(x, b ? e0(x) : 10);
        for (let x = 80; x >= -80; x -= 8) ctx.lineTo(x, b === bands.length - 1 ? TT - 10 : e1(x));
        ctx.closePath(); ctx.fillStyle = col; ctx.fill();
        // seam between bands (ink line)
        if (b) { ctx.strokeStyle = 'rgba(10,4,16,.75)'; ctx.lineWidth = 2.2; ctx.beginPath(); for (let x = -80; x <= 80; x += 8) { if (x === -80) ctx.moveTo(x, e0(x)); else ctx.lineTo(x, e0(x)); } ctx.stroke(); }
        const cy = (y0 + y1) / 2;
        if (pat === 1) {          // sea teal: little wave arcs
          ctx.strokeStyle = 'rgba(160,220,210,.3)'; ctx.lineWidth = 1.4; ctx.beginPath();
          for (let r = 0; r < 2; r++) for (let x = -60 + r * 9; x < 60; x += 18) { ctx.moveTo(x, cy - 6 + r * 12); ctx.quadraticCurveTo(x + 4.5, cy - 11 + r * 12, x + 9, cy - 6 + r * 12); }
          ctx.stroke();
        } else if (pat === 2) {   // crayon red: loose scribbles
          ctx.strokeStyle = 'rgba(220,140,120,.28)'; ctx.lineWidth = 2; ctx.beginPath();
          ctx.moveTo(-50, cy - 10); for (let i = 0; i < 14; i++) ctx.lineTo(-50 + i * 7.5, cy + (i % 2 ? 9 : -10) + Math.sin(i * 2.3) * 2);
          ctx.stroke();
        } else if (pat === 3) {   // baseball cream: two curved stitch seams (dashed)
          ctx.save(); ctx.setLineDash([3, 3]); ctx.strokeStyle = 'rgba(170,60,60,.65)'; ctx.lineWidth = 1.8; ctx.beginPath();
          ctx.moveTo(-40, y0 - 2); ctx.quadraticCurveTo(-18, cy, -40, y1 + 2); ctx.moveTo(-34, y0 - 2); ctx.quadraticCurveTo(-12, cy, -34, y1 + 2);
          ctx.moveTo(36, y0 - 2); ctx.quadraticCurveTo(14, cy, 36, y1 + 2); ctx.moveTo(30, y0 - 2); ctx.quadraticCurveTo(8, cy, 30, y1 + 2);
          ctx.stroke(); ctx.restore();
        } else if (pat === 4) {   // toy pink: polka dots
          ctx.fillStyle = 'rgba(240,190,210,.35)'; ctx.beginPath();
          for (let r = 0; r < 2; r++) for (let x = -54 + r * 10; x < 56; x += 20) { const y = cy - 7 + r * 14; ctx.moveTo(x + 3.2, y); ctx.arc(x, y, 3.2, 0, TAU); }
          ctx.fill();
        } else if (pat === 5) {   // faded night blue: tiny round night-lights
          ctx.fillStyle = 'rgba(220,226,255,.4)'; ctx.beginPath();
          for (let i = 0; i < 9; i++) { const x = -38 + hsh(i + 3) * 76, y = y0 - 4 - hsh(i + 13) * (y0 - y1 - 8); ctx.moveTo(x + 1.3, y); ctx.arc(x, y, 1.3, 0, TAU); }
          ctx.fill();
        }
      }
      // ink haze over everything (faded colours) + cylinder shading
      ctx.fillStyle = 'rgba(16,8,30,.3)'; ctx.fillRect(-90, TT - 10, 180, 240);
      ctx.fillStyle = lgc(ctx, 'dev-shade', -66, 0, 66, 0, [[0, 'rgba(6,2,14,.82)'], [0.3, 'rgba(6,2,14,.3)'], [0.62, 'rgba(6,2,14,0)'], [0.82, 'rgba(6,2,14,.12)'], [1, 'rgba(6,2,14,.6)']]);
      ctx.fillRect(-90, TT - 10, 180, 240);
      ctx.fillStyle = lgc(ctx, 'dev-shadeV', 0, TB, 0, TB - 70, [[0, 'rgba(6,2,14,.75)'], [1, 'rgba(6,2,14,0)']]); ctx.fillRect(-90, TB - 70, 180, 72);
      // hollow arched windows (dark, a faint stolen glow) and a doorway pouring ink
      const winA = (x, y, wd, h) => {
        ctx.beginPath(); ctx.moveTo(x - wd / 2, y + h); ctx.lineTo(x - wd / 2, y + wd / 2); ctx.arc(x, y + wd / 2, wd / 2, Math.PI, 0); ctx.lineTo(x + wd / 2, y + h); ctx.closePath();
        ctx.fillStyle = '#05020a'; ctx.fill(); ctx.strokeStyle = 'rgba(120,90,140,.5)'; ctx.lineWidth = 1.4; ctx.stroke();
        add(() => sglow(ctx, x, y + h * 0.6, wd * 1.6, '200,160,255', 0.25 * (0.4 + lamp)));
      };
      winA(8, -138, 11, 18); winA(4, -224, 10, 15);
      winA(6, -96, 26, 62);
      ctx.fillStyle = '#05020a';
      for (let i = 0; i < 3; i++) drip(-2 + i * 8, -40, 4 + (Math.sin(t * 1.3 + i * 2) + 1) * 4, 2.6);
      // cracks leaking pale light
      const cracks = [[-26, -46, -18, -70, -24, -92, -12, -118, -16, -140], [24, -160, 14, -184, 20, -206, 8, -232, 12, -256], [-36, -190, -28, -206, -34, -222, -26, -240]];
      if (P2) cracks.push([40, -60, 30, -84, 36, -104, 26, -124], [-6, -150, 2, -170, -4, -192], [-44, -110, -36, -128, -42, -148]);
      const cg = P2 ? 1 : 0.55 + lamp * 0.3;
      for (const c of cracks) {
        add(() => { for (let i = 0; i < c.length; i += 4) sglow(ctx, c[i], c[i + 1], P2 ? 22 : 15, P2 ? '255,214,190' : '235,220,255', 0.35 * cg); });
        const path = () => { ctx.beginPath(); ctx.moveTo(c[0], c[1]); for (let i = 2; i < c.length; i += 2) ctx.lineTo(c[i], c[i + 1]); };
        path(); ctx.strokeStyle = DINK; ctx.lineWidth = P2 ? 5 : 4; ctx.stroke();
        path(); ctx.strokeStyle = `rgba(255,240,225,${(0.85 * cg).toFixed(3)})`; ctx.lineWidth = P2 ? 2.2 : 1.4; ctx.stroke();
      }
      ctx.restore();
      towerPath(); ctx.strokeStyle = DINK; ctx.lineWidth = 3.2; ctx.stroke();
      ctx.strokeStyle = RIM; ctx.lineWidth = 1.3; ctx.beginPath();
      for (let i = 1; i <= 19; i++) { const y = lerp(TB, TT, i / 20), x = cxo(y) - hw(y) + 1; if (i === 1) ctx.moveTo(x, y); else ctx.lineTo(x, y); } ctx.stroke();
      // ink running down the outside of the tower
      ctx.fillStyle = '#0a0414';
      for (let i = 0; i < 4; i++) { const y = [-112, -188, -199, -64][i], x = [-34, 22, -20, 44][i]; drip(x, y, 6 + (Math.sin(t * 1.2 + i * 1.9) + 1) * 6, 2.4); }
      // near roots overlap the base
      for (let i = 0; i < roots.length; i++) if (roots[i][3]) root(roots[i], true);

      // ===== head: gallery, lantern room, dome =====
      ctx.save(); headT();
      // gallery ledge + bent, broken railing (parallel bars only)
      ctx.beginPath(); rr(ctx, -58, -272, 116, 10, 4); ctx.fillStyle = '#1e1430'; ctx.fill(); ctx.strokeStyle = DINK; ctx.lineWidth = 2.6; ctx.stroke();
      ctx.strokeStyle = 'rgba(190,170,210,.3)'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(-54, -270); ctx.lineTo(54, -270); ctx.stroke();
      ctx.lineCap = 'round';
      for (let i = 0; i < 11; i++) {
        const x = -50 + i * 10, br = hsh(i + 4) < 0.25, lnx = (hsh(i + 9) - 0.5) * 6, h = br ? 8 + hsh(i) * 6 : 20 + hsh(i + 1) * 3;
        ctx.strokeStyle = DINK; ctx.lineWidth = 3.4; ctx.beginPath(); ctx.moveTo(x, -272); ctx.lineTo(x + lnx * h / 22, -272 - h); ctx.stroke();
        ctx.strokeStyle = '#5a4a62'; ctx.lineWidth = 1.4; ctx.stroke();
      }
      ctx.strokeStyle = DINK; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(-52, -293); ctx.quadraticCurveTo(-30, -290, -12, -294); ctx.moveTo(8, -290); ctx.quadraticCurveTo(30, -296, 52, -292); ctx.stroke();
      ctx.strokeStyle = '#6a5870'; ctx.lineWidth = 1.8; ctx.stroke();
      ctx.lineCap = 'butt';
      // lantern room frame
      const GX0 = -27, GX1 = 27, GY0 = -330, GY1 = -286;
      ctx.beginPath(); rr(ctx, -33, -336, 66, 58, 3); ctx.fillStyle = '#150c22'; ctx.fill(); ctx.strokeStyle = DINK; ctx.lineWidth = 2.8; ctx.stroke();
      // glass: dim, hungry glow
      ctx.save(); ctx.beginPath(); ctx.rect(GX0, GY0, GX1 - GX0, GY1 - GY0); ctx.clip();
      ctx.fillStyle = '#231636'; ctx.fillRect(GX0, GY0, GX1 - GX0, GY1 - GY0);
      add(() => {
        sglow(ctx, LX + 4, LY, 44, '230,200,255', 0.55 * lamp * flick);
        sglow(ctx, LX + 4, LY + 4, 26, '255,214,170', 0.5 * lamp * flick);
      });
      // the lens turning forward for the beam: a bright disc on the front pane
      const bmA = Math.max(bmW, bmR > 0 ? 1 : 0);
      if (bmA > 0.02) add(() => { sglow(ctx, 20, LY, 30, '255,250,235', 0.9 * bmA); });
      // the mouth opening while it drains
      if (drA > 0.05) {
        ctx.beginPath(); ctx.moveTo(-4, -298);
        for (let i = 0; i <= 6; i++) ctx.lineTo(-4 + i * 4.4, -298 - (i % 2 ? 3 : 0) - drA * 2);
        ctx.quadraticCurveTo(26, -298 + drA * 10, 10, -294 + drA * 11); ctx.quadraticCurveTo(-4, -294 + drA * 9, -4, -298); ctx.closePath();
        ctx.fillStyle = '#05020a'; ctx.fill();
      }
      // two eyes inside the glass (look forward; narrow when starving)
      const ey = -312 + sv * 3, eo = bmA * 3;
      add(() => sglow(ctx, 12 + eo, ey, 22, '255,170,240', (0.45 + lamp * 0.4) * (1 - sv * 0.5)));
      for (const [x, r] of [[4 + eo, 3.6], [19 + eo, 3.2]]) {
        ctx.fillStyle = '#ffd8f6'; ell(ctx, x, ey, r, (1.8 - sv * 0.9) * eBlink(t + 2.1, 4.6), -0.25); ctx.fill();
        ctx.strokeStyle = '#120818'; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(x - r - 1, ey - 3.4); ctx.lineTo(x + r + 1, ey - 0.8); ctx.stroke();
      }
      ctx.restore();
      // mullions + sill
      ctx.fillStyle = '#150c22'; ctx.fillRect(-10, GY0, 3.4, GY1 - GY0); ctx.fillRect(7, GY0, 3.4, GY1 - GY0);
      ctx.strokeStyle = 'rgba(220,200,240,.12)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(GX0 + 3, GY0 + 3); ctx.lineTo(GX0 + 12, GY0 + 3); ctx.stroke();
      ctx.beginPath(); rr(ctx, -36, -286, 72, 6, 2); ctx.fillStyle = '#3e3044'; ctx.fill(); ctx.strokeStyle = DINK; ctx.lineWidth = 2; ctx.stroke();
      // phase 2: the glass is cracked
      if (P2) { ctx.strokeStyle = 'rgba(255,236,220,.6)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(-22, -328); ctx.lineTo(-16, -316); ctx.lineTo(-20, -304); ctx.moveTo(-16, -316); ctx.lineTo(-12, -312); ctx.moveTo(24, -290); ctx.lineTo(18, -300); ctx.stroke(); }
      // dome: warped, slumping back, cracked
      ctx.beginPath(); rr(ctx, -38, -341, 76, 7, 2); ctx.fillStyle = '#4a3a52'; ctx.fill(); ctx.strokeStyle = DINK; ctx.lineWidth = 2.2; ctx.stroke();
      const dome = () => { ctx.beginPath(); ctx.moveTo(-37, -340); ctx.bezierCurveTo(-38, -366, -24, -382, -10, -382); ctx.bezierCurveTo(6, -381, 30, -366, 36, -340); ctx.closePath(); };
      dome(); ctx.fillStyle = lgc(ctx, 'dev-dome', -38, 0, 38, 0, [[0, '#0e0818'], [0.6, '#2a1c3a'], [1, '#160d22']]); ctx.fill();
      ctx.strokeStyle = DINK; ctx.lineWidth = 2.8; ctx.stroke();
      ctx.strokeStyle = RIM; ctx.lineWidth = 1.1; ctx.beginPath(); ctx.moveTo(-36, -344); ctx.bezierCurveTo(-37, -366, -24, -381, -10, -381); ctx.stroke();
      ctx.strokeStyle = 'rgba(180,150,200,.25)'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(-14, -342); ctx.quadraticCurveTo(-14, -366, -10, -380); ctx.moveTo(14, -342); ctx.quadraticCurveTo(8, -364, -4, -380); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,236,220,.45)'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(18, -346); ctx.lineTo(12, -356); ctx.lineTo(16, -364); ctx.stroke();
      // bent finial with a tarnished knob
      ctx.strokeStyle = DINK; ctx.lineWidth = 4; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(-10, -382); ctx.quadraticCurveTo(-12, -392, -22, -396); ctx.stroke();
      ctx.strokeStyle = '#6a5a62'; ctx.lineWidth = 1.8; ctx.stroke(); ctx.lineCap = 'butt';
      circ(ctx, -24, -397, 4.4); ctx.fillStyle = '#7a6a6a'; ctx.fill(); ctx.strokeStyle = DINK; ctx.lineWidth = 1.8; ctx.stroke();
      // ink dripping from the eaves
      ctx.fillStyle = '#0a0414';
      for (let i = 0; i < 3; i++) drip(-28 + i * 26, -334, 5 + (Math.sin(t * 1.4 + i * 2.2) + 1) * 4, 2.2);
      ctx.restore();

      // ---- near arm (in front) ----
      const slamming = slW > 0 || slR > 0;
      const wrN = arm(shN, hN, true, slamming);
      mantle();
      // curved swoosh behind the claw while it comes down (an arc, not a ray)
      if (slR > 0 && slK < 0.98 && slK > 0.05) {
        ctx.strokeStyle = `rgba(230,200,255,${(0.5 * (1 - slK)).toFixed(3)})`; ctx.lineWidth = 6; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.arc(shN[0], shN[1], 170, -1.25, lerp(-1.25, 0.95, slK)); ctx.stroke(); ctx.lineCap = 'butt';
      }

      // ---- drain: curved streams of round motes spiralling INTO the lantern ----
      if (drA > 0.02) {
        ctx.save(); headT();
        add(() => sglow(ctx, LX + 2, LY, 90 + drA * 40, '235,210,255', 0.35 * drA));
        const COLS = ['255,214,160', '255,190,220', '190,226,255', '214,255,214', '235,214,255'];
        for (let i = 0; i < 6; i++) {
          const a0 = i * 1.047 + t * 0.6;
          for (let j = 0; j < 7; j++) {
            const k = (t * 0.42 + j / 7 + i * 0.11) % 1, kk = k * k * (1.6 - 0.6 * k);
            const r = lerp(240, 8, kk) * (0.6 + drA * 0.4), a = a0 + kk * 2.7;
            const x = LX + 2 + Math.cos(a) * r, y = LY + Math.sin(a) * r * 0.78;
            const al = drA * Math.min(1, k * 5) * (1 - Math.pow(k, 6));
            const rad = 3.6 * (1 - kk * 0.6);
            add(() => sglow(ctx, x, y, rad * 4, COLS[(i + j) % 5], al * 0.45));
            ctx.fillStyle = `rgba(${COLS[(i + j) % 5]},${al.toFixed(3)})`; circ(ctx, x, y, rad); ctx.fill();
            // a faint trail of tiny dots along the spiral
            for (let q = 1; q <= 3; q++) {
              const k2 = Math.max(0, kk - q * 0.03), r2 = lerp(240, 8, k2) * (0.6 + drA * 0.4), a2 = a0 + k2 * 2.7;
              ctx.fillStyle = `rgba(${COLS[(i + j) % 5]},${(al * (0.5 - q * 0.12)).toFixed(3)})`; circ(ctx, LX + 2 + Math.cos(a2) * r2, LY + Math.sin(a2) * r2 * 0.78, rad * (1 - q * 0.22)); ctx.fill();
            }
          }
        }
        ctx.restore();
      }

      // ---- beam: ONE cone of pale light, forward (+x), angled down toward the lane ----
      const bA = bmR > 0 ? (bmR > 0.15 ? 1 : bmR / 0.15) : bmW * 0.35;
      if (bA > 0.01) {
        ctx.save(); headT();
        ctx.translate(30, LY); ctx.rotate(0.62 - lean - sv * 0.1); // (steep enough to land on the lane where the beam hazard is)
        const spread = bmR > 0 ? 1 : 0.35 + bmW * 0.25;
        const pa = ctx.globalAlpha;
        add(() => {
          ctx.globalAlpha = pa * bA * (bmR > 0 ? 1 : 0.6 + 0.4 * Math.sin(t * 20));
          ctx.fillStyle = lgc(ctx, 'dev-beam', 0, 0, 600, 0, [[0, 'rgba(240,232,255,.62)'], [0.45, 'rgba(225,212,255,.2)'], [1, 'rgba(225,212,255,0)']]);
          ctx.beginPath(); ctx.moveTo(0, -11); ctx.lineTo(600, -104 * spread); ctx.lineTo(600, 104 * spread); ctx.lineTo(0, 11); ctx.closePath(); ctx.fill();
          ctx.fillStyle = lgc(ctx, 'dev-beam-core', 0, 0, 420, 0, [[0, 'rgba(255,250,240,.75)'], [1, 'rgba(255,250,240,0)']]);
          ctx.beginPath(); ctx.moveTo(0, -5); ctx.lineTo(420, -30 * spread); ctx.lineTo(420, 30 * spread); ctx.lineTo(0, 5); ctx.closePath(); ctx.fill();
          ctx.globalAlpha = pa;
          sglow(ctx, 0, 0, 40, '255,246,230', 0.8 * bA);
        });
        // round motes drifting along the cone
        if (bmR > 0) for (let i = 0; i < 8; i++) { const p = (t * 0.9 + hsh(i + 3)) % 1, x = 30 + p * 520, y = (hsh(i + 7) - 0.5) * 160 * p; ctx.fillStyle = `rgba(255,248,236,${(0.7 * (1 - p) * bA).toFixed(3)})`; circ(ctx, x, y, 2 + hsh(i) * 2); ctx.fill(); }
        ctx.restore();
      }

      // ---- shield: a translucent membrane around the whole body ----
      if (sh > 0.01) {
        const mPath = (g) => { ctx.beginPath(); for (let i = 0; i <= 48; i++) { const a = i / 48 * TAU, r = 1 + Math.sin(a * 5 + t * 2.2) * 0.012 + Math.sin(a * 3 - t * 1.4) * 0.01; const x = 10 + Math.cos(a) * (172 + g) * r, y = -205 + Math.sin(a) * (222 + g) * r; if (!i) ctx.moveTo(x, y); else ctx.lineTo(x, y); } ctx.closePath(); };
        mPath(0); ctx.fillStyle = `rgba(150,120,240,${(0.08 * sh).toFixed(3)})`; ctx.fill();
        ctx.strokeStyle = `rgba(200,170,255,${(0.16 * sh).toFixed(3)})`; ctx.lineWidth = 12; ctx.stroke();
        ctx.strokeStyle = `rgba(225,205,255,${(0.7 * sh).toFixed(3)})`; ctx.lineWidth = 2.2; ctx.stroke();
        mPath(-6); ctx.strokeStyle = `rgba(255,190,230,${(0.28 * sh).toFixed(3)})`; ctx.lineWidth = 1.2; ctx.stroke();
        mPath(5); ctx.strokeStyle = `rgba(160,230,230,${(0.22 * sh).toFixed(3)})`; ctx.lineWidth = 1.2; ctx.stroke();
        ctx.strokeStyle = `rgba(255,255,255,${(0.45 * sh).toFixed(3)})`; ctx.lineWidth = 3; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.ellipse(10, -205, 156, 206, 0, Math.PI * 1.08, Math.PI * 1.3); ctx.stroke();
        ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(10, -205, 156, 206, 0, Math.PI * 1.36, Math.PI * 1.42); ctx.stroke(); ctx.lineCap = 'butt';
        for (let i = 0; i < 6; i++) { const a = t * 0.3 + i * 1.05, x = 10 + Math.cos(a) * 172, y = -205 + Math.sin(a) * 222; ctx.fillStyle = `rgba(235,220,255,${(0.6 * sh).toFixed(3)})`; circ(ctx, x, y, 2.2); ctx.fill(); }
      }
      ctx.restore();
      // ===== end leaned frame =====

      // ---- phase 2: the halo shattered into small falling fragments ----
      if (P2) {
        for (let i = 0; i < 11; i++) {
          const p = (t * 0.22 + hsh(i + 30)) % 1;
          const a = -Math.PI + hsh(i + 31) * Math.PI * 1.1;
          const x0 = 36 + Math.cos(a) * 100 * (0.8 + hsh(i) * 0.4), y0 = -330 + Math.sin(a) * 92;
          const x = x0 + (hsh(i + 32) - 0.5) * 40 * p, y = y0 + p * p * 260 + p * 30;
          const al = Math.min(1, p * 6) * (1 - p);
          ctx.save(); ctx.translate(x, y); ctx.rotate(hsh(i + 33) * 6 + t * (hsh(i + 34) - 0.5) * 3);
          add(() => sglow(ctx, 0, 0, 22, '255,226,190', 0.4 * al));
          const ln = 0.22 + hsh(i + 35) * 0.26;
          ctx.beginPath(); ctx.arc(0, 34, 34, -Math.PI / 2 - ln, -Math.PI / 2 + ln);
          ctx.strokeStyle = `rgba(12,6,22,${al.toFixed(3)})`; ctx.lineWidth = 8.5; ctx.stroke();
          ctx.strokeStyle = `rgba(206,192,158,${al.toFixed(3)})`; ctx.lineWidth = 4.8; ctx.stroke();
          ctx.beginPath(); ctx.arc(0, 34, 35.2, -Math.PI / 2 - ln + 0.04, -Math.PI / 2 + ln - 0.04);
          ctx.strokeStyle = `rgba(255,244,214,${(0.7 * al).toFixed(3)})`; ctx.lineWidth = 1.2; ctx.stroke();
          ctx.restore();
        }
      }

      // ---- slam impact on the floor: expanding ellipse rings + ink splashes ----
      if (slR > 0 && slK > 0.9) {
        const k = clamp01((0.72 - slR) / 0.5), ix = 186;
        ctx.strokeStyle = `rgba(230,190,255,${(0.75 * (1 - k)).toFixed(3)})`; ctx.lineWidth = 3.4;
        ell(ctx, ix, -2, 24 + k * 80, 6 + k * 11); ctx.stroke();
        ctx.lineWidth = 1.6; ell(ctx, ix, -2, 12 + k * 46, 3 + k * 6); ctx.stroke();
        ctx.fillStyle = `rgba(14,6,26,${(0.85 * (1 - k)).toFixed(3)})`;
        for (let i = 0; i < 6; i++) { const sx = ix - 50 + i * 20 + Math.sin(i * 2.7) * 6, sy = -8 - k * (20 + (i % 3) * 14) + k * k * 30; circ(ctx, sx, sy, 4 + (i % 2) * 2); ctx.fill(); }
      }
      // ink motes rising
      ctx.fillStyle = 'rgba(200,140,255,.7)';
      for (let i = 0; i < 7; i++) { const p = (t * 0.28 + i / 7) % 1, mx = -80 + i * 26 + Math.sin(t + i) * 8; circ(ctx, mx, -30 - p * 300, 1.4); ctx.fill(); }
    },

    // ---------------- ボス「異端の魔女」 ----------------
    // A girl's old magical-girl doll come to life: faded pink frills, doll joints, one button eye hanging
    // on its thread, heart-and-crescent wand. Her spells come out backwards and turn people into toys.
    // u.windKind 'toy' (wand raised, sparkle swirl) · u.atk (wand flick, heart shot) · u.transform 0..1
    // (ribbon spiral) · u.barrier 0..6 (1-3 ribbon bands around her) · phase 2: dusky magenta/black, ribbon wings.
    witch(ctx, u) {
      const t = u.anim || 0, at = u.atk || 0, P2 = (u.phase || 1) >= 2;
      const wind = clamp01(u.wind || 0), w = ease(wind);
      const toyW = wind > 0 && u.windKind === 'toy' ? w : 0;
      const flick = wind <= 0 && at > 0 ? at : 0;
      const fp = flick > 0 ? 1 - flick : 0;                         // heart-shot flight progress
      const fArm = flick > 0 ? ease(clamp01(flick * 1.7)) : 0;       // arm stays out while the heart leaves
      const tr = clamp01(u.transform || 0), trE = Math.sin(tr * Math.PI * 0.5);
      const bar = Math.max(0, Math.min(6, u.barrier || 0));
      const walk = !!u.walk && tr < 0.2;
      const ph = t * 4.4, ws = walk ? Math.sin(ph) : 0;
      const bob = (walk ? Math.abs(Math.cos(ph)) * 3 : Math.sin(t * 1.8) * 1.5) + Math.sin(tr * Math.PI) * 16 + toyW * 3;
      const DR = P2 ? '#6c2c52' : '#b48a9c', DR_L = P2 ? '#8a3a6a' : '#cfa6b5', DR_D = P2 ? '#3c1830' : '#7c5468';
      const FR = P2 ? '#2a1428' : '#d6c6ca', RIB = P2 ? '#8e2c5e' : '#c27c94', RIB_D = P2 ? '#5a1a3e' : '#8c5068';
      const HAIR = P2 ? '#7c4a5e' : '#c09488', HAIR_D = P2 ? '#4a2638' : '#86605e';
      const SKN = '#4a3a58', SKN_D = '#32263e', SOCK = P2 ? '#8a7884' : '#cbbfc6', WINK = '#140a1c';
      const glowK = P2 ? 1.35 : 1;
      ctx.lineJoin = 'round';
      const ik = (ax, ay, bx, by, l1, l2, px, py) => {
        let dx = bx - ax, dy = by - ay, d = Math.hypot(dx, dy) || 1;
        const mx = l1 + l2 - 0.5;
        if (d > mx) { bx = ax + dx / d * mx; by = ay + dy / d * mx; dx = bx - ax; dy = by - ay; d = mx; }
        const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
        let nx = -dy / d, ny = dx / d; if (nx * px + ny * py < 0) { nx = -nx; ny = -ny; }
        return [ax + dx / d * a + nx * h, ay + dy / d * a + ny * h, bx, by];
      };
      const heart = (x, y, s) => {
        ctx.beginPath(); ctx.moveTo(x, y + s * 0.9);
        ctx.bezierCurveTo(x - s * 1.35, y + s * 0.05, x - s * 0.95, y - s * 1.05, x, y - s * 0.38);
        ctx.bezierCurveTo(x + s * 0.95, y - s * 1.05, x + s * 1.35, y + s * 0.05, x, y + s * 0.9); ctx.closePath();
      };
      // ribbon bow: two loops, a knot and two frayed (notched) tails
      const bow = (x, y, s, rot, col, dark) => {
        ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.scale(s, s);
        const fl = Math.sin(t * 2.3 + x) * 1.2;
        for (const sd of [-1, 1]) {
          ctx.beginPath(); ctx.moveTo(sd * 1.5, 2); ctx.quadraticCurveTo(sd * 4, 10, sd * (7 + fl * 0.4), 17 + fl);
          ctx.lineTo(sd * 4.5, 14.5 + fl); ctx.lineTo(sd * (3 + fl * 0.2), 18 + fl); ctx.quadraticCurveTo(sd * 1.5, 9, -sd * 0.5, 2); ctx.closePath();
          fo(ctx, dark, 1.6, WINK);
        }
        for (const sd of [-1, 1]) {
          ctx.beginPath(); ctx.moveTo(0, 0); ctx.bezierCurveTo(sd * 6, -9, sd * 15, -8, sd * 14, -1); ctx.bezierCurveTo(sd * 13, 5, sd * 6, 4, 0, 0); ctx.closePath();
          fo(ctx, col, 1.8, WINK);
          ctx.strokeStyle = 'rgba(255,220,235,.3)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(sd * 3, -2.5); ctx.quadraticCurveTo(sd * 8, -6.5, sd * 12, -3); ctx.stroke();
        }
        rr(ctx, -3, -3.2, 6, 6.4, 2); fo(ctx, dark, 1.6, WINK);
        ctx.restore();
      };

      // ---- ground: ink puddle ----
      ctx.fillStyle = 'rgba(12,6,24,.82)'; ell(ctx, -4, -1, 52, 6.5); ctx.fill();
      for (let i = 0; i < 4; i++) { const px = -46 + i * 28 + Math.sin(i * 2.7) * 6, pr = 4 + (Math.sin(t * 1.25 + i) + 1) * 2.3; ell(ctx, px, -1, pr * 1.7, pr * 0.42); ctx.fill(); }
      ctx.globalCompositeOperation = 'lighter';
      sglow(ctx, 0, -118 - bob, 130, P2 ? '170,50,150' : '190,90,190', (P2 ? 0.28 : 0.18) + toyW * 0.22 + tr * 0.3);
      ctx.globalCompositeOperation = 'source-over';

      // ---- ribbon helpers for barrier bands / transformation spiral (back half drawn before the body) ----
      const bands = bar > 0 ? Math.min(3, Math.ceil(bar / 2)) : 0;
      const bandA = 0.45 + bar * 0.07;
      function barrierBands(front) {
        for (let i = 0; i < bands; i++) {
          const cy = [-70, -128, -186][i] - bob * 0.5, rx = [64, 58, 52][i], ry = 15, rot = [0.12, -0.16, 0.1][i];
          const sp = t * (1.4 + i * 0.35) * (i % 2 ? -1 : 1);
          ctx.save(); ctx.translate(0, cy); ctx.rotate(rot);
          ctx.lineCap = 'round';
          const N = 26;
          for (let j = 0; j < N; j++) {
            const a0 = j / N * TAU, a1 = (j + 1) / N * TAU, am = (a0 + a1) / 2;
            if ((Math.sin(am + sp) > 0) !== front) continue;
            const tw = Math.abs(Math.cos(am * 2 + sp * 2)) * 7 + 2.5;
            const A = bandA * (front ? 1 : 0.55);
            ctx.strokeStyle = P2 ? `rgba(210,90,170,${(A * 0.5).toFixed(3)})` : `rgba(255,170,215,${(A * 0.5).toFixed(3)})`; ctx.lineWidth = tw + 4;
            ctx.beginPath(); ctx.ellipse(0, 0, rx, ry, 0, a0 + sp, a1 + sp + 0.02); ctx.stroke();
            ctx.strokeStyle = `rgba(255,226,244,${(A * 0.7).toFixed(3)})`; ctx.lineWidth = 1.1;
            ctx.beginPath(); ctx.ellipse(0, 0, rx, ry - tw * 0.35, 0, a0 + sp, a1 + sp + 0.02); ctx.stroke();
          }
          ctx.lineCap = 'butt';
          ctx.restore();
        }
      }
      function spiral(front) {
        if (tr <= 0.01) return;
        const top = Math.min(1, tr * 1.35), N = 70;
        ctx.lineCap = 'round';
        for (let j = 0; j < N; j++) {
          const s0 = j / N, s1 = (j + 1) / N;
          if (s1 > top) break;
          const am = (s0 + s1) / 2 * TAU * 3.2 + t * 7;
          if ((Math.sin(am) > 0) !== front) continue;
          const R = (s) => 52 - s * 22, Y = (s) => -6 - s * 226 - bob * s;
          const a0 = s0 * TAU * 3.2 + t * 7, a1 = s1 * TAU * 3.2 + t * 7;
          const x0 = Math.cos(a0) * R(s0), y0 = Y(s0) + Math.sin(a0) * 9, x1 = Math.cos(a1) * R(s1), y1 = Y(s1) + Math.sin(a1) * 9;
          const tw = 5 + Math.abs(Math.sin(am * 1.5)) * 5;
          ctx.strokeStyle = `rgba(255,150,210,${((front ? 0.75 : 0.4) * tr).toFixed(3)})`; ctx.lineWidth = tw + 2.5;
          ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
          ctx.strokeStyle = `rgba(255,236,248,${((front ? 0.85 : 0.35) * tr).toFixed(3)})`; ctx.lineWidth = Math.max(1, tw * 0.35);
          ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
        }
        ctx.lineCap = 'butt';
      }
      barrierBands(false);
      spiral(false);

      ctx.save();
      ctx.translate(0, -bob);
      const hc = [6, -172 + Math.sin(t * 1.8 + 0.5) * 0.8];

      // ---- phase 2: torn ribbon wings (two big frayed bow loops + hanging tattered tails, behind) ----
      if (P2) {
        const flap = Math.sin(t * 2.4);
        const O = [-12, -140];
        // hanging tails first
        for (let k = 0; k < 3; k++) {
          const P = [];
          for (let i = 0; i <= 8; i++) {
            const s = i / 8, wv = Math.sin(t * 3 + k * 1.7 + s * 3.5) * 7 * s;
            P.push([O[0] - 10 - s * (34 + k * 16) + wv, O[1] + 4 + s * (58 + k * 10) + Math.abs(wv) * 0.3]);
          }
          const Lp = [], Rp = [];
          for (let i = 0; i < P.length; i++) {
            const a0 = P[Math.max(0, i - 1)], b0 = P[Math.min(P.length - 1, i + 1)];
            let tx = b0[0] - a0[0], ty = b0[1] - a0[1]; const d = Math.hypot(tx, ty) || 1; tx /= d; ty /= d;
            const ww = 5.5 - i * 0.25;
            Lp.push([P[i][0] - ty * ww, P[i][1] + tx * ww]); Rp.push([P[i][0] + ty * ww, P[i][1] - tx * ww]);
          }
          const e = P[P.length - 1];
          ctx.beginPath(); ctx.moveTo(Lp[0][0], Lp[0][1]);
          for (let i = 1; i < Lp.length; i++) ctx.lineTo(Lp[i][0], Lp[i][1]);
          ctx.lineTo(e[0] - 2, e[1] + 6); ctx.lineTo(e[0] + 1, e[1] + 1); ctx.lineTo(e[0] + 4, e[1] + 5);
          for (let i = Rp.length - 1; i >= 0; i--) ctx.lineTo(Rp[i][0], Rp[i][1]);
          ctx.closePath();
          ctx.fillStyle = k % 2 ? 'rgba(96,28,74,.9)' : 'rgba(120,38,92,.88)'; ctx.fill(); ctx.strokeStyle = WINK; ctx.lineWidth = 1.8; ctx.stroke();
        }
        // two loops: upper (big) and lower
        for (const L of [[-78, -224 + flap * 6, 1], [-86, -150 + flap * 4, 0.72]]) {
          const T = [L[0], L[1]], s = L[2];
          const loop = (k) => {
            ctx.beginPath(); ctx.moveTo(O[0], O[1]);
            ctx.bezierCurveTo(O[0] - 4 * k, O[1] - 46 * s * k, T[0] + 26 * k, T[1] - 14 * s * k, T[0], T[1]);
            // torn, notched tip
            ctx.lineTo(T[0] - 5 * k, T[1] + 7 * k); ctx.lineTo(T[0] + 1, T[1] + 10 * k); ctx.lineTo(T[0] - 6 * k, T[1] + 16 * k);
            ctx.bezierCurveTo(T[0] - 6 * k, T[1] + 40 * s * k, O[0] - 40 * k, O[1] + 8 * k, O[0], O[1]);
            ctx.closePath();
          };
          loop(1);
          ctx.fillStyle = lgc(ctx, 'witch-wing' + s, -80, -230, -10, -140, [[0, 'rgba(150,50,110,.9)'], [1, 'rgba(84,24,66,.95)']]); ctx.fill();
          ctx.strokeStyle = WINK; ctx.lineWidth = 2.2; ctx.stroke();
          ctx.strokeStyle = 'rgba(206,160,255,.5)'; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(O[0] - 2, O[1] - 6); ctx.bezierCurveTo(O[0] - 6, O[1] - 44 * s, T[0] + 24, T[1] - 12 * s, T[0] + 2, T[1] + 2); ctx.stroke();
          // hollow of the loop
          ctx.save(); ctx.translate(lerp(O[0], T[0], 0.55), lerp(O[1], T[1], 0.5)); ctx.scale(0.42, 0.42); ctx.translate(-lerp(O[0], T[0], 0.55), -lerp(O[1], T[1], 0.5));
          loop(1); ctx.fillStyle = 'rgba(16,6,22,.85)'; ctx.fill(); ctx.restore();
          // moth holes + a frayed fold
          ctx.fillStyle = 'rgba(10,4,18,.85)';
          circ(ctx, lerp(O[0], T[0], 0.3) - 6, lerp(O[1], T[1], 0.3) - 8 * s, 2.4); ctx.fill();
          circ(ctx, lerp(O[0], T[0], 0.82) + 4, lerp(O[1], T[1], 0.82) + 4, 1.8); ctx.fill();
          ctx.strokeStyle = 'rgba(230,140,200,.3)'; ctx.lineWidth = 0.9;
          ctx.beginPath(); ctx.moveTo(lerp(O[0], T[0], 0.2), lerp(O[1], T[1], 0.2) + 6); ctx.quadraticCurveTo(lerp(O[0], T[0], 0.5), lerp(O[1], T[1], 0.5) + 16 * s, lerp(O[0], T[0], 0.9) - 4, lerp(O[1], T[1], 0.9) + 10); ctx.stroke();
        }
      }

      // ---- back pigtail ----
      function pigtail(x0, y0, side, col) {
        const sw = Math.sin(t * (walk ? 4.4 : 1.7) + side) * (walk ? 6 : 3);
        const P = [];
        for (let i = 0; i <= 10; i++) {
          const s = i / 10;
          P.push([x0 + side * (6 + Math.sin(s * 2.4) * 10) + sw * s * s - (walk ? 8 : 0) * s * s, y0 + s * 84]);
        }
        const L = [], R = [];
        for (let i = 0; i < P.length; i++) {
          const a0 = P[Math.max(0, i - 1)], b0 = P[Math.min(P.length - 1, i + 1)];
          let tx = b0[0] - a0[0], ty = b0[1] - a0[1]; const d = Math.hypot(tx, ty) || 1; tx /= d; ty /= d;
          const s = i / 10, ww = (Math.sin(Math.min(1, s * 1.4 + 0.15) * Math.PI) * 9 + 2.5) * (1 - s * 0.35);
          L.push([P[i][0] - ty * ww, P[i][1] + tx * ww]); R.push([P[i][0] + ty * ww, P[i][1] - tx * ww]);
        }
        ctx.beginPath(); ctx.moveTo(L[0][0], L[0][1]);
        for (let i = 1; i < L.length; i++) ctx.lineTo(L[i][0], L[i][1]);
        // frizzy, faded ends
        const e = P[P.length - 1];
        ctx.lineTo(e[0] - 3, e[1] + 6); ctx.lineTo(e[0], e[1] + 2); ctx.lineTo(e[0] + 2, e[1] + 7); ctx.lineTo(e[0] + 3, e[1] + 1);
        for (let i = R.length - 1; i >= 0; i--) ctx.lineTo(R[i][0], R[i][1]);
        ctx.closePath();
        ctx.fillStyle = col; ctx.fill(); ctx.strokeStyle = WINK; ctx.lineWidth = 2.2; ctx.stroke();
        ctx.strokeStyle = 'rgba(255,220,220,.22)'; ctx.lineWidth = 1.1;
        ctx.beginPath(); ctx.moveTo(P[1][0] + 2, P[1][1]); for (let i = 2; i < 9; i++) ctx.lineTo(P[i][0] + 2, P[i][1]); ctx.stroke();
        // strand lines (doll hair)
        ctx.strokeStyle = 'rgba(20,8,24,.35)'; ctx.lineWidth = 0.9;
        ctx.beginPath(); ctx.moveTo(P[2][0] - 3, P[2][1]); for (let i = 3; i < 10; i++) ctx.lineTo(P[i][0] - 3, P[i][1]); ctx.stroke();
        bow(x0 + side * 2, y0 + 2, 0.8, side * 0.3, RIB, RIB_D);
      }
      pigtail(hc[0] - 22, hc[1] - 12, -1, HAIR_D);

      // ---- arms (pose targets) ----
      const sB = [-11, -139], sF = [12, -138];
      let fh = [26, -104 + Math.sin(t * 1.8) * 1.5], bh = [-20, -102];
      let wa = -1.15 + Math.sin(t * 1.8) * 0.05;                          // wand angle
      fh = [lerp(fh[0], 34, toyW), lerp(fh[1], -180, toyW)]; wa = lerp(wa, -1.38, toyW);
      bh = [lerp(bh[0], -36, toyW), lerp(bh[1], -150, toyW)];
      fh = [lerp(fh[0], 46, fArm), lerp(fh[1], -146, fArm)]; wa = lerp(wa, -0.32, fArm);
      fh = [lerp(fh[0], 20, trE), lerp(fh[1], -134, trE)]; wa = lerp(wa, -1.57, trE);
      bh = [lerp(bh[0], -34, trE), lerp(bh[1], -168, trE)];
      if (walk && toyW <= 0 && fArm <= 0) bh = [-22 - ws * 6, -104];
      function arm(s, h, near) {
        const k = ik(s[0], s[1], h[0], h[1], 25, 24, 0, 1);
        const col = near ? SKN : SKN_D;
        eLimb(ctx, s[0], s[1], (s[0] + k[0]) / 2, (s[1] + k[1]) / 2, k[0], k[1], 7.4, col);
        eLimb(ctx, k[0], k[1], (k[0] + k[2]) / 2, (k[1] + k[3]) / 2, k[2], k[3], 6.6, col);
        // elbow ball joint
        circ(ctx, k[0], k[1], 4.6); ctx.fillStyle = col; ctx.fill(); ctx.strokeStyle = WINK; ctx.lineWidth = 1.6; ctx.stroke();
        ctx.strokeStyle = near ? 'rgba(236,200,236,.55)' : 'rgba(236,200,236,.3)'; ctx.lineWidth = 0.9; circ(ctx, k[0], k[1], 3); ctx.stroke();
        // wrist seam + hand
        const wx = lerp(k[0], k[2], 0.8), wy = lerp(k[1], k[3], 0.8);
        ctx.strokeStyle = 'rgba(236,200,236,.45)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(wx, wy, 3.6, 0, TAU); ctx.stroke();
        circ(ctx, k[2], k[3], 4.4); ctx.fillStyle = col; ctx.fill(); ctx.strokeStyle = WINK; ctx.lineWidth = 1.6; ctx.stroke();
        if (near) { ctx.strokeStyle = RIM; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(s[0], s[1] - 3.5); ctx.quadraticCurveTo((s[0] + k[0]) / 2, (s[1] + k[1]) / 2 - 3.5, k[0], k[1] - 3.5); ctx.stroke(); }
      }
      arm(sB, bh, false);

      // ---- legs: stiff doll legs, ball-joint knees, faded knee socks, Mary Janes ----
      function leg(hx, fx, lift, near) {
        const hy = -72, fy = -8 - lift;
        const k = ik(hx, hy, fx, fy, 34, 31, 1, 0);
        const col = near ? SKN : SKN_D;
        eLimb(ctx, hx, hy, (hx + k[0]) / 2, (hy + k[1]) / 2, k[0], k[1], 10, col);
        // sock (shin)
        bone(ctx, k[0], k[1] + 4, k[2], k[3], 9, near ? SOCK : '#9a8e98', WINK, 2.4);
        ctx.strokeStyle = 'rgba(30,14,36,.4)'; ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.moveTo(k[0] - 5, k[1] + 7); ctx.lineTo(k[0] + 5, k[1] + 7); ctx.stroke();
        // ink stain soaking up the sock
        ctx.fillStyle = 'rgba(20,8,30,.55)'; ell(ctx, k[2] - 1, k[3] - 6, 5.4, 8); ctx.fill();
        // knee ball joint
        circ(ctx, k[0], k[1], 6.2); ctx.fillStyle = col; ctx.fill(); ctx.strokeStyle = WINK; ctx.lineWidth = 1.8; ctx.stroke();
        ctx.strokeStyle = near ? 'rgba(236,200,236,.6)' : 'rgba(236,200,236,.3)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(k[0], k[1], 4, -2.6, 0.6); ctx.stroke();
        // Mary Jane shoe
        const ax = k[2], ay = k[3];
        ctx.beginPath(); ctx.moveTo(ax - 7, ay - 2); ctx.quadraticCurveTo(ax + 2, ay - 6, ax + 9, ay - 2); ctx.quadraticCurveTo(ax + 14, ay + 2, ax + 13, ay + 7); ctx.lineTo(ax - 8, ay + 7); ctx.closePath();
        fo(ctx, near ? (P2 ? '#3a1630' : '#8a5266') : (P2 ? '#2a1024' : '#5e3448'), 2, WINK);
        ctx.strokeStyle = WINK; ctx.lineWidth = 1.8; ctx.beginPath(); ctx.moveTo(ax - 3, ay - 4); ctx.lineTo(ax + 3, ay - 3); ctx.stroke();
        ctx.strokeStyle = 'rgba(255,220,235,.3)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(ax + 3, ay - 2); ctx.quadraticCurveTo(ax + 9, ay - 1, ax + 11, ay + 3); ctx.stroke();
      }
      const lift1 = walk ? Math.max(0, Math.cos(ph)) * 7 : 0, lift2 = walk ? Math.max(0, -Math.cos(ph)) * 7 : 0;
      leg(-7, -8 - ws * 13 - trE * 2, lift2 + trE * 6, false);
      leg(8, 9 + ws * 13 + trE * 2, lift1 + trE * 10, true);

      // ---- skirt: two scalloped tiers + petticoat lace, ink at the hem ----
      const sway = walk ? Math.sin(ph) * 2.5 : Math.sin(t * 1.8) * 1;
      const hemY = -62, tier1 = -84;
      function scallopPath(x0, x1, y, n, dep, top, wTop) {
        ctx.beginPath(); ctx.moveTo(-wTop + 2, top);
        ctx.bezierCurveTo(-wTop - 6, top + 14, x0 + 4, y - 18, x0, y);
        const step = (x1 - x0) / n;
        for (let i = 0; i < n; i++) ctx.quadraticCurveTo(x0 + step * (i + 0.5), y + dep + Math.sin(i * 1.7 + t * 2) * 1.2, x0 + step * (i + 1), y);
        ctx.bezierCurveTo(x1 - 4, y - 18, wTop + 6, top + 14, wTop + 2, top);
        ctx.closePath();
      }
      // petticoat lace
      scallopPath(-50 + sway, 54 + sway, hemY + 4, 10, 4, -100, 20); fo(ctx, FR, 1.8, WINK);
      ctx.strokeStyle = P2 ? 'rgba(160,90,140,.3)' : 'rgba(150,110,130,.45)'; ctx.lineWidth = 0.9;
      ctx.beginPath(); for (let i = 0; i < 10; i++) { const x = -46 + sway + i * 10.2; ctx.moveTo(x + 2, hemY + 3); ctx.arc(x + 4, hemY + 3, 2, Math.PI, 0); } ctx.stroke();
      // lower tier
      scallopPath(-48 + sway, 52 + sway, hemY, 7, 5, -108, 21);
      ctx.fillStyle = lgc(ctx, P2 ? 'witch-sk2' : 'witch-sk', 0, -112, 0, -56, [[0, DR_L], [0.6, DR], [1, DR_D]]); ctx.fill();
      ctx.save(); ctx.clip();
      ctx.fillStyle = 'rgba(24,10,32,.3)'; ctx.fillRect(-60, -120, 30, 70);
      ctx.fillStyle = 'rgba(14,6,22,.5)'; for (let i = 0; i < 5; i++) { const x = -40 + i * 20 + Math.sin(i * 3.1) * 5; ell(ctx, x, hemY - 1, 7, 6 + (i % 2) * 4); ctx.fill(); }
      ctx.strokeStyle = 'rgba(40,16,40,.25)'; ctx.lineWidth = 1.2;
      ctx.beginPath(); for (let i = 0; i < 6; i++) { const x = -34 + i * 15; ctx.moveTo(x * 0.45, -104); ctx.quadraticCurveTo(x * 0.8, -84, x + sway, hemY + 2); } ctx.stroke();
      ctx.restore();
      scallopPath(-48 + sway, 52 + sway, hemY, 7, 5, -108, 21); ctx.strokeStyle = WINK; ctx.lineWidth = 2.6; ctx.stroke();
      ctx.strokeStyle = RIM; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(-20, -106); ctx.bezierCurveTo(-28, -94, -44 + sway, -78, -48 + sway, hemY); ctx.stroke();
      // upper tier (overskirt)
      scallopPath(-38 + sway * 0.6, 40 + sway * 0.6, tier1, 6, 5, -110, 19);
      ctx.fillStyle = lgc(ctx, P2 ? 'witch-ov2' : 'witch-ov', 0, -112, 0, -78, [[0, DR_L], [1, DR]]); ctx.fill();
      ctx.save(); ctx.clip(); ctx.fillStyle = 'rgba(24,10,32,.28)'; ctx.fillRect(-60, -120, 26, 50); ctx.restore();
      scallopPath(-38 + sway * 0.6, 40 + sway * 0.6, tier1, 6, 5, -110, 19); ctx.strokeStyle = WINK; ctx.lineWidth = 2.2; ctx.stroke();
      // trim of ribbon at the overskirt hem
      ctx.strokeStyle = RIB; ctx.lineWidth = 2; ctx.beginPath();
      for (let i = 0; i <= 12; i++) { const x = -34 + sway * 0.6 + i * 6.2; const y = tier1 - 3 + Math.sin(i * 1.3) * 0.8; if (!i) ctx.moveTo(x, y); else ctx.lineTo(x, y); } ctx.stroke();
      // frayed threads + ink drips from the hem
      ctx.strokeStyle = P2 ? 'rgba(140,60,110,.6)' : 'rgba(200,160,175,.55)'; ctx.lineWidth = 0.9;
      ctx.beginPath(); for (let i = 0; i < 6; i++) { const x = -42 + i * 17 + sway; ctx.moveTo(x, hemY + 5); ctx.quadraticCurveTo(x + 2, hemY + 10, x - 1 + Math.sin(t * 3 + i) * 2, hemY + 14); } ctx.stroke();
      ctx.fillStyle = WINK;
      for (let i = 0; i < 4; i++) { const x = -32 + i * 21 + sway, l = 5 + (Math.sin(t * 1.3 + i * 2.1) + 1) * (P2 ? 7 : 4.5); rr(ctx, x, hemY + 4, 2.8, l, 1.4); ctx.fill(); circ(ctx, x + 1.4, hemY + 4 + l, 2.1); ctx.fill(); }

      // ---- bodice + sleeves + chest bow ----
      const body = () => {
        ctx.beginPath(); ctx.moveTo(-17, -110);
        ctx.bezierCurveTo(-19, -122, -18, -134, -15, -143);
        ctx.quadraticCurveTo(0, -149, 16, -143);
        ctx.bezierCurveTo(20, -132, 19, -120, 18, -110); ctx.closePath();
      };
      body(); ctx.fillStyle = lgc(ctx, P2 ? 'witch-bd2' : 'witch-bd', 0, -148, 0, -108, [[0, DR_L], [1, DR_D]]); ctx.fill();
      ctx.save(); ctx.clip(); ctx.fillStyle = 'rgba(24,10,32,.3)'; ctx.fillRect(-26, -150, 12, 44);
      // stitched seams (doll clothes)
      ctx.save(); ctx.setLineDash([2, 2]); ctx.strokeStyle = P2 ? 'rgba(220,140,190,.4)' : 'rgba(255,230,240,.45)'; ctx.lineWidth = 0.9;
      ctx.beginPath(); ctx.moveTo(-9, -144); ctx.quadraticCurveTo(-11, -126, -9, -110); ctx.moveTo(13, -143); ctx.quadraticCurveTo(15, -126, 13, -110); ctx.stroke(); ctx.restore();
      ctx.restore();
      body(); ctx.strokeStyle = WINK; ctx.lineWidth = 2.4; ctx.stroke();
      // waist ribbon sash
      ctx.beginPath(); ctx.moveTo(-19, -116); ctx.quadraticCurveTo(0, -112, 20, -116); ctx.lineTo(20, -108); ctx.quadraticCurveTo(0, -104, -19, -108); ctx.closePath(); fo(ctx, RIB, 1.8, WINK);
      // sash tails at the back
      ctx.beginPath(); ctx.moveTo(-18, -112); ctx.quadraticCurveTo(-30, -96 + sway, -32 + sway, -78); ctx.lineTo(-27 + sway, -82); ctx.lineTo(-26 + sway, -76); ctx.quadraticCurveTo(-22, -96, -14, -110); ctx.closePath(); fo(ctx, RIB_D, 1.6, WINK);
      // white collar
      ctx.beginPath(); ctx.moveTo(-12, -144); ctx.quadraticCurveTo(0, -136, 15, -144); ctx.quadraticCurveTo(12, -136, 4, -134); ctx.quadraticCurveTo(-6, -135, -12, -144); ctx.closePath(); fo(ctx, FR, 1.6, WINK);
      // chest bow with a heart brooch
      bow(6, -132, 0.95, 0.05, RIB, RIB_D);
      heart(6, -132, 4.2); fo(ctx, P2 ? '#c03a7a' : '#e88aa8', 1.4, WINK);
      ctx.globalCompositeOperation = 'lighter'; sglow(ctx, 6, -132, 12, '255,150,210', 0.45 * glowK); ctx.globalCompositeOperation = 'source-over';
      // shoulder ball joint (back) + puff sleeves
      circ(ctx, sB[0], sB[1] + 4, 5); ctx.fillStyle = SKN_D; ctx.fill(); ctx.strokeStyle = WINK; ctx.lineWidth = 1.6; ctx.stroke();
      ell(ctx, sB[0] + 1, sB[1] - 1, 10, 8, -0.2); fo(ctx, DR_D, 2, WINK);

      // ---- head ----
      pigtail(hc[0] + 16, hc[1] - 18, 1, HAIR);   // near pigtail, hanging behind the face
      eLimb(ctx, 3, -144, 4, -148, 5, -152, 9, SKN);
      ctx.strokeStyle = 'rgba(236,200,236,.5)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, -150); ctx.lineTo(10, -150); ctx.stroke();
      // face (a big doll head, chin toward +x)
      ctx.beginPath(); ctx.arc(hc[0], hc[1], 26, -Math.PI * 0.95, Math.PI * 0.05);
      ctx.quadraticCurveTo(hc[0] + 26, hc[1] + 18, hc[0] + 12, hc[1] + 24);
      ctx.quadraticCurveTo(hc[0], hc[1] + 28, hc[0] - 12, hc[1] + 22);
      ctx.arc(hc[0], hc[1], 26, Math.PI * 0.62, Math.PI * 1.05); ctx.closePath();
      ctx.fillStyle = lgc(ctx, 'witch-face', 0, -198, 0, -146, [[0, '#5c4a6a'], [1, SKN_D]]); ctx.fill();
      ctx.strokeStyle = WINK; ctx.lineWidth = 2.6; ctx.stroke();
      ctx.strokeStyle = RIM; ctx.lineWidth = 1.1; ctx.beginPath(); ctx.arc(hc[0], hc[1], 25, Math.PI * 0.62, Math.PI * 0.98); ctx.stroke();
      // porcelain crack
      ctx.strokeStyle = 'rgba(12,4,20,.75)'; ctx.lineWidth = 1.1;
      ctx.beginPath(); ctx.moveTo(hc[0] - 6, hc[1] - 22); ctx.lineTo(hc[0] - 3, hc[1] - 14); ctx.lineTo(hc[0] - 7, hc[1] - 8); ctx.lineTo(hc[0] - 4, hc[1] - 2); ctx.stroke();
      // cheek blush (faded)
      ctx.fillStyle = P2 ? 'rgba(200,60,140,.25)' : 'rgba(230,140,170,.25)'; ell(ctx, hc[0] + 16, hc[1] + 12, 4.5, 2.6); ctx.fill();
      // the glowing eye (big doll eye, inner)
      const ex = hc[0] + 5, ey = hc[1] + 3;
      ctx.globalCompositeOperation = 'lighter';
      sglow(ctx, ex, ey, 22 + toyW * 10 + tr * 12, '255,160,230', (0.55 + toyW * 0.3 + fArm * 0.2) * glowK);
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = '#0c0614'; ell(ctx, ex, ey, 6, 7.4); ctx.fill();
      const bl = eBlink(t, 4.1);
      eEye(ctx, ex + 0.4, ey + 0.4, 4.4, 5.6 * bl);
      if (bl === 1) { ctx.fillStyle = P2 ? '#c03a90' : '#d77ab8'; ell(ctx, ex + 0.8, ey + 1.2, 2.3, 3); ctx.fill(); ctx.fillStyle = '#fff2fb'; circ(ctx, ex - 1.2, ey - 1.6, 1.2); ctx.fill(); }
      ctx.strokeStyle = WINK; ctx.lineWidth = 1.6; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(ex - 6, ey - 6); ctx.quadraticCurveTo(ex, ey - 9.5, ex + 6.5, ey - 6.5); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(ex - 6, ey - 6); ctx.lineTo(ex - 9, ey - 8.5); ctx.moveTo(ex - 3, ey - 8); ctx.lineTo(ex - 5, ey - 11); ctx.stroke();
      ctx.lineCap = 'butt';
      // empty socket + the button eye hanging on its thread
      const sx = hc[0] + 18, sy = hc[1] + 2;
      ctx.fillStyle = '#0a0412'; ell(ctx, sx, sy, 3.6, 4.4); ctx.fill();
      const sa = Math.sin(t * 2.1) * 0.35 + (walk ? Math.sin(ph) * 0.3 : 0) + 0.15;
      const bx = sx + Math.sin(sa) * 13, by = sy + Math.cos(sa) * 13;
      ctx.strokeStyle = P2 ? 'rgba(200,120,170,.85)' : 'rgba(230,200,210,.9)'; ctx.lineWidth = 0.9;
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.quadraticCurveTo(sx + Math.sin(sa) * 4 + 2, sy + 7, bx, by - 4); ctx.stroke();
      circ(ctx, bx, by, 4.6); fo(ctx, P2 ? '#6a2a50' : '#c07890', 1.6, WINK);
      ctx.fillStyle = WINK; circ(ctx, bx - 1.4, by - 0.6, 0.85); ctx.fill(); circ(ctx, bx + 1.4, by + 0.6, 0.85); ctx.fill();
      ctx.strokeStyle = 'rgba(255,230,240,.35)'; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.arc(bx, by, 3.2, -2.6, -1.2); ctx.stroke();
      // stitched mouth (cross stitches)
      const mx = hc[0] + 13, my = hc[1] + 16;
      ctx.strokeStyle = 'rgba(16,6,22,.9)'; ctx.lineWidth = 1.1;
      ctx.beginPath(); ctx.moveTo(mx - 5, my); ctx.quadraticCurveTo(mx, my + 1.6 - toyW * 2, mx + 5, my - 0.6); ctx.stroke();
      ctx.strokeStyle = 'rgba(230,190,215,.55)'; ctx.lineWidth = 0.8; ctx.beginPath();
      for (let i = 0; i < 3; i++) { const x = mx - 3.4 + i * 3.4; ctx.moveTo(x - 1, my - 1.6); ctx.lineTo(x + 1, my + 1.8); } ctx.stroke();
      // ink tear from the glowing eye
      const tl = 4 + (Math.sin(t * 0.85) + 1) * 3.5;
      ctx.fillStyle = '#0a0614'; rr(ctx, ex - 1, ey + 6, 2.2, tl, 1.1); ctx.fill(); circ(ctx, ex + 0.1, ey + 6 + tl, 1.7); ctx.fill();
      // hair cap + bangs (doll hair with a stitched part)
      ctx.beginPath(); ctx.moveTo(hc[0] + 25, hc[1] - 6);
      ctx.bezierCurveTo(hc[0] + 24, hc[1] - 36, hc[0] - 26, hc[1] - 38, hc[0] - 28, hc[1] - 4);
      ctx.quadraticCurveTo(hc[0] - 29, hc[1] + 12, hc[0] - 22, hc[1] + 20);
      ctx.quadraticCurveTo(hc[0] - 18, hc[1] + 2, hc[0] - 12, hc[1] - 8);
      ctx.quadraticCurveTo(hc[0] - 6, hc[1] - 4, hc[0] - 2, hc[1] - 12);
      ctx.quadraticCurveTo(hc[0] + 4, hc[1] - 6, hc[0] + 10, hc[1] - 13);
      ctx.quadraticCurveTo(hc[0] + 16, hc[1] - 6, hc[0] + 25, hc[1] - 6); ctx.closePath();
      ctx.fillStyle = HAIR; ctx.fill();
      ctx.save(); ctx.clip(); ctx.fillStyle = 'rgba(30,10,30,.28)'; ell(ctx, hc[0] - 22, hc[1] - 4, 14, 24); ctx.fill(); ctx.restore();
      ctx.beginPath(); ctx.moveTo(hc[0] + 25, hc[1] - 6);
      ctx.bezierCurveTo(hc[0] + 24, hc[1] - 36, hc[0] - 26, hc[1] - 38, hc[0] - 28, hc[1] - 4);
      ctx.quadraticCurveTo(hc[0] - 29, hc[1] + 12, hc[0] - 22, hc[1] + 20);
      ctx.strokeStyle = WINK; ctx.lineWidth = 2.4; ctx.stroke();
      ctx.strokeStyle = 'rgba(255,225,220,.28)'; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(hc[0] - 14, hc[1] - 25); ctx.quadraticCurveTo(hc[0] + 2, hc[1] - 31, hc[0] + 16, hc[1] - 21); ctx.stroke();
      ctx.save(); ctx.setLineDash([1.8, 1.8]); ctx.strokeStyle = 'rgba(30,10,30,.55)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(hc[0] - 4, hc[1] - 31); ctx.quadraticCurveTo(hc[0] - 2, hc[1] - 20, hc[0] - 2, hc[1] - 12); ctx.stroke(); ctx.restore();
      // big head bow
      bow(hc[0] - 6, hc[1] - 30, 1.35, -0.25, RIB, RIB_D);

      // ---- wand: twisted ribbon stick, heart topper with a small crescent moon ----
      const wdx = Math.cos(wa), wdy = Math.sin(wa);
      const wtx = fh[0] + wdx * 62, wty = fh[1] + wdy * 62;
      function wand() {
        bone(ctx, fh[0] - wdx * 10, fh[1] - wdy * 10, fh[0] + wdx * 54, fh[1] + wdy * 54, 3.6, P2 ? '#8a6a7a' : '#d8c8b8', WINK, 2.4);
        ctx.strokeStyle = RIB; ctx.lineWidth = 1.6; ctx.beginPath();
        for (let i = 0; i < 6; i++) { const s0 = -6 + i * 9.5; ctx.moveTo(fh[0] + wdx * s0 - wdy * 2.2, fh[1] + wdy * s0 + wdx * 2.2); ctx.lineTo(fh[0] + wdx * (s0 + 5) + wdy * 2.2, fh[1] + wdy * (s0 + 5) - wdx * 2.2); }
        ctx.stroke();
        // ribbon streamers under the topper
        const stx = fh[0] + wdx * 52, sty = fh[1] + wdy * 52;
        for (const k of [0, 1]) {
          const fl2 = Math.sin(t * 4 + k * 2) * 4;
          ctx.beginPath(); ctx.moveTo(stx, sty);
          ctx.bezierCurveTo(stx - 10 - k * 4, sty + 6 + fl2, stx - 14 - k * 6, sty + 16 - fl2, stx - 22 - k * 6, sty + 22 + fl2);
          ctx.lineTo(stx - 18 - k * 6, sty + 18 + fl2);
          ctx.bezierCurveTo(stx - 10 - k * 4, sty + 12 - fl2, stx - 6, sty + 6, stx + 2, sty + 2); ctx.closePath();
          fo(ctx, k ? RIB_D : RIB, 1.4, WINK);
        }
        // crescent moon behind the heart (faded gold)
        crescent(ctx, wtx - wdy * 9 - wdx * 2, wty + wdx * 9 - wdy * 2, 8, 4.2, 7, wa - 0.6);
        fo(ctx, P2 ? '#a88a6a' : '#d8c08a', 1.6, WINK);
        ctx.globalCompositeOperation = 'lighter';
        sglow(ctx, wtx, wty, 26 + toyW * 16 + fArm * 8, '255,150,215', (0.5 + toyW * 0.4 + fArm * 0.3 + tr * 0.3) * glowK);
        ctx.globalCompositeOperation = 'source-over';
        ctx.save(); ctx.translate(wtx, wty); ctx.rotate(wa + Math.PI / 2);
        heart(0, 0, 9.5); fo(ctx, P2 ? '#b8306e' : '#e892b0', 2.2, WINK);
        ctx.fillStyle = 'rgba(255,235,245,.55)'; ell(ctx, -3.6, -3.4, 2.4, 1.6, -0.6); ctx.fill();
        ctx.strokeStyle = 'rgba(20,6,24,.5)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(1, -3); ctx.lineTo(-1, 1); ctx.lineTo(2, 4); ctx.stroke();   // chipped
        ctx.restore();
      }
      wand();
      arm(sF, fh, true);
      // front shoulder joint + puff sleeve
      circ(ctx, sF[0], sF[1] + 4, 5); ctx.fillStyle = SKN; ctx.fill(); ctx.strokeStyle = WINK; ctx.lineWidth = 1.6; ctx.stroke();
      ctx.strokeStyle = 'rgba(236,200,236,.55)'; ctx.lineWidth = 0.9; ctx.beginPath(); ctx.arc(sF[0], sF[1] + 4, 3.2, 0, TAU); ctx.stroke();
      ell(ctx, sF[0] - 1, sF[1] - 1, 10.5, 8.5, 0.2); fo(ctx, DR_L, 2, WINK);
      ctx.strokeStyle = 'rgba(255,230,240,.3)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(sF[0] - 1, sF[1] - 2, 6.5, -2.6, -0.6); ctx.stroke();
      ctx.strokeStyle = FR; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.ellipse(sF[0] - 1, sF[1] + 5, 8, 2.4, 0.2, 0.2, Math.PI - 0.2); ctx.stroke();

      // ---- toy spell: a swirl of round sparkles and little hearts around the raised wand ----
      if (toyW > 0.02) {
        ctx.globalCompositeOperation = 'lighter';
        sglow(ctx, wtx, wty, 70, '255,140,210', 0.35 * toyW);
        for (let i = 0; i < 14; i++) {
          const a = t * 3.2 + i * 0.75, R = (10 + i * 3.4) * (0.4 + toyW * 0.6);
          const x = wtx + Math.cos(a) * R, y = wty + Math.sin(a) * R * 0.55 + 6;
          const r = 1.2 + (i % 3) * 0.6;
          ctx.fillStyle = `rgba(255,${200 + (i % 3) * 18},240,${(toyW * (0.95 - i * 0.04)).toFixed(3)})`;
          circ(ctx, x, y, r); ctx.fill();
        }
        ctx.globalCompositeOperation = 'source-over';
        for (let i = 0; i < 3; i++) {
          const a = -t * 2.4 + i * TAU / 3, R = 30 * toyW;
          const x = wtx + Math.cos(a) * R, y = wty + Math.sin(a) * R * 0.6 + 4;
          const pa = ctx.globalAlpha; ctx.globalAlpha = pa * toyW;
          heart(x, y, 3.6); fo(ctx, P2 ? '#e05a9a' : '#ffb0cc', 1.2, WINK);
          ctx.globalAlpha = pa;
        }
      }
      // ---- heart shot leaving the wand ----
      if (flick > 0) {
        const hx = wtx + 6 + fp * 92, hy = wty - 4 + Math.sin(fp * 3) * 4, s = 5 + Math.min(1, fp * 4) * 4;
        const pa = ctx.globalAlpha; ctx.globalAlpha = pa * (1 - fp * 0.7);
        ctx.globalCompositeOperation = 'lighter';
        sglow(ctx, hx, hy, s * 3.2, '255,140,210', 0.6);
        ctx.fillStyle = 'rgba(255,210,240,.8)';
        for (let i = 1; i <= 4; i++) { circ(ctx, hx - i * 9, hy + Math.sin(fp * 9 + i) * 3, 2.2 - i * 0.35); ctx.fill(); }
        ctx.globalCompositeOperation = 'source-over';
        ctx.save(); ctx.translate(hx, hy); ctx.rotate(Math.PI / 2 + Math.sin(fp * 6) * 0.2);
        heart(0, 0, s); fo(ctx, P2 ? '#d0407e' : '#ff9cc0', 1.8, WINK);
        ctx.fillStyle = 'rgba(255,240,250,.7)'; ell(ctx, -s * 0.38, -s * 0.36, s * 0.24, s * 0.16, -0.6); ctx.fill();
        ctx.restore();
        ctx.globalAlpha = pa;
      }
      ctx.restore();

      spiral(true);
      if (tr > 0.01) {
        // transformation glow washing over her + rising sparkles
        ctx.globalCompositeOperation = 'lighter';
        sglow(ctx, 0, -120 - bob, 120, '255,170,225', 0.45 * trE);
        ctx.fillStyle = `rgba(255,220,245,${(0.85 * trE).toFixed(3)})`;
        for (let i = 0; i < 10; i++) { const p = (t * 0.6 + i / 10) % 1, x = Math.sin(i * 2.4 + t) * (44 - p * 20), y = -10 - p * 240; circ(ctx, x, y, 1.4 + (i % 3) * 0.6); ctx.fill(); }
        ctx.globalCompositeOperation = 'source-over';
      }
      barrierBands(true);
      // ink motes rising
      ctx.fillStyle = P2 ? 'rgba(230,120,200,.7)' : 'rgba(200,140,255,.7)';
      for (let i = 0; i < 5; i++) { const p = (t * 0.32 + i / 5) % 1, mx = -42 + i * 21 + Math.sin(t + i) * 8; ctx.fillRect(mx, -24 - p * 200, 2.4, 2.4); }
    },

    // ---------------- おもちゃにされた住人 (ally under the witch's spell, ~4 s) ----------------
    // A little wind-up cloth doll: round body, button eyes, a brass key turning in its back, a worried
    // stitched mouth and a pale pink heart of the spell bobbing above. Warm colours: still one of ours.
    toy(ctx, u) {
      const t = u.anim || 0, tick = Math.floor(t * 6) % 2;
      const CL = '#f4e4ca', CL_D = '#dcc4a4', COAT = '#f2a77e', COAT_D = '#d98462';
      const wob = Math.sin(t * 7) * 0.09 + (u.walk ? Math.sin(t * 12) * 0.05 : 0);
      const hop = Math.abs(Math.sin(t * 7)) * 1.6;
      // feet shuffle in place
      const fs = Math.sin(t * 7) * 2;
      ell(ctx, -4 - fs, -2.2, 4.4, 2.6); fo(ctx, '#b07a5c', 1.2);
      ell(ctx, 5 + fs, -2.2, 4.4, 2.6); fo(ctx, '#c88a68', 1.2);
      ctx.save(); ctx.translate(0, -4 - hop); ctx.rotate(wob); ctx.translate(0, 4);
      // wind-up key in the back (turns: the bow foreshortens as it spins)
      const ka = t * 5, kc = Math.cos(ka);
      bone(ctx, -9, -16, -15, -16, 2.4, '#c9a25a', INK, 2.2);
      ctx.save(); ctx.translate(-17, -16);
      for (const sd of [-1, 1]) {
        ell(ctx, 0, sd * 4.2 * Math.abs(kc) + sd * 0.6, 2.4, Math.max(0.6, 3.6 * Math.abs(kc)));
        fo(ctx, kc > 0 ? '#e6c070' : '#b8904a', 1.2);
      }
      ctx.fillStyle = 'rgba(255,240,200,.6)'; circ(ctx, 0.4, -1.5 * kc, 0.8); ctx.fill();
      ctx.restore();
      // back stub arm
      ell(ctx, -8.5, -15 + Math.sin(t * 7) * 1.2, 2.8, 4.4, 0.5); fo(ctx, COAT_D, 1.2);
      // round body: little coat with a cream belly patch and stitches
      ell(ctx, 0, -14, 10.5, 10); fo(ctx, lgc(ctx, 'toy-body', -10, 0, 10, 0, [[0, COAT_D], [0.6, COAT], [1, '#f6bc96']]), 1.4);
      ell(ctx, 3, -12, 5.6, 6); fo(ctx, CL, 1);
      ctx.save(); ctx.setLineDash([1.3, 1.1]); ctx.strokeStyle = 'rgba(130,70,50,.8)'; ctx.lineWidth = 0.7;
      ell(ctx, 3, -12, 4.4, 4.8); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-6, -22); ctx.quadraticCurveTo(-8.5, -14, -6, -5.5); ctx.stroke();
      ctx.restore();
      // two coat buttons
      ctx.fillStyle = '#8a5a8a'; circ(ctx, 8.6, -17.5, 1.1); ctx.fill(); circ(ctx, 9.2, -12.5, 1.1); ctx.fill();
      // head
      const hy = -30;
      circ(ctx, 1, hy, 9.6); fo(ctx, CL, 1.4);
      ctx.fillStyle = 'rgba(160,110,80,.16)'; ctx.beginPath(); ctx.arc(1, hy, 9.6, Math.PI * 0.55, Math.PI * 1.45); ctx.closePath(); ctx.fill();
      // yarn hair tuft + seam
      ctx.beginPath(); ctx.moveTo(-8, hy - 3); ctx.quadraticCurveTo(-6, hy - 11, 1, hy - 10.4); ctx.quadraticCurveTo(7, hy - 10.6, 9.4, hy - 5);
      ctx.quadraticCurveTo(6, hy - 7, 3, hy - 6); ctx.quadraticCurveTo(0, hy - 8, -2, hy - 5.6); ctx.quadraticCurveTo(-5, hy - 6, -8, hy - 3); ctx.closePath();
      fo(ctx, '#b0703e', 1.1);
      ctx.strokeStyle = '#b0703e'; ctx.lineWidth = 1.3; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(0, hy - 10); ctx.quadraticCurveTo(-1, hy - 14, 2.5, hy - 14.5 + Math.sin(t * 7) * 0.6); ctx.stroke();
      ctx.lineCap = 'butt';
      ctx.fillStyle = 'rgba(255,120,130,.42)'; ell(ctx, 8.4, hy + 3.6, 2.1, 1.3); ctx.fill(); ell(ctx, 0.2, hy + 3.8, 1.6, 1.1); ctx.fill();
      // button eyes (a little dizzy: the highlight circles)
      for (const [bx, r] of [[7.2, 2.2], [2, 1.9]]) {
        circ(ctx, bx, hy + 0.2, r); fo(ctx, '#4a3450', 0.9);
        const ha = t * 3 + bx;
        ctx.fillStyle = '#d6c0e4'; circ(ctx, bx + Math.cos(ha) * r * 0.4, hy + 0.2 + Math.sin(ha) * r * 0.4, 0.5); ctx.fill();
      }
      // worried stitched mouth
      ctx.strokeStyle = '#8a4a50'; ctx.lineWidth = 0.8; ctx.beginPath();
      ctx.moveTo(2.6, hy + 5.8); ctx.quadraticCurveTo(3.8, hy + 4.8, 5, hy + 5.8); ctx.quadraticCurveTo(6.2, hy + 6.8, 7.4, hy + 5.6); ctx.stroke();
      // front stub arm, waving stiffly with each tick of the key
      const aa = tick ? -0.9 : -0.5;
      ell(ctx, 9 + Math.cos(aa) * 2, -16 + Math.sin(aa) * 3, 2.9, 4.4, aa + 1.2); fo(ctx, COAT, 1.2);
      ctx.restore();
      // the spell: a pale pink heart bobbing above, two round sparkles
      const sy = -48 + Math.sin(t * 3) * 1.6;
      ctx.globalCompositeOperation = 'lighter'; sglow(ctx, 1, sy, 9, '255,160,215', 0.55); ctx.globalCompositeOperation = 'source-over';
      ctx.beginPath(); ctx.moveTo(1, sy + 2.6);
      ctx.bezierCurveTo(-3, sy + 0.2, -1.8, sy - 3, 1, sy - 1.1); ctx.bezierCurveTo(3.8, sy - 3, 5, sy + 0.2, 1, sy + 2.6); ctx.closePath();
      ctx.fillStyle = 'rgba(255,190,220,.9)'; ctx.fill();
      ctx.fillStyle = 'rgba(255,225,245,.85)';
      for (let i = 0; i < 2; i++) { const a = t * 2.6 + i * Math.PI; circ(ctx, 1 + Math.cos(a) * 9, sy + 2 + Math.sin(a) * 2.6, 0.9); ctx.fill(); }
    },

    // ---------------- ボス「終幕の踊り子」 ----------------
    // The girl who quit before her recital, dancing an endless final act on an empty stage: faded tulle
    // tutu, ink-stained pointe shoes, a porcelain mask with glowing eyes, and a long torn crimson stage
    // curtain dragging from her back like a train.
    // u.windKind 'waltz' (arabesque, arm sweep) · 'spin' + u.dash (pirouette) · u.curtain 0..1 (deep bow,
    // the curtain wraps around her) · u.act 1..3 (3 = 終幕: curtain shredded, eyes brightest).
    dancer(ctx, u) {
      const t = u.anim || 0, at = u.atk || 0, act = Math.max(1, Math.min(3, u.act || 1));
      const P2 = (u.phase || 1) >= 2 || act >= 2, A3 = act >= 3;
      const wind = clamp01(u.wind || 0), w = ease(wind), wk = u.windKind;
      const dash = clamp01(u.dash || 0);
      const waltzW = wind > 0 && wk === 'waltz' ? w : 0;
      const wRel = wind <= 0 && at > 0 && wk === 'waltz' && dash <= 0;
      const sp = wRel ? 1 - at : 0;                                       // arm-sweep progress
      const sweep = wRel ? 1 - Math.pow(1 - clamp01(sp * 1.6), 2) : 0;
      const wPose = wRel ? 1 - ease(clamp01((sp - 0.55) / 0.45)) : 0;      // arabesque fades back out
      const spinW = wind > 0 && wk === 'spin' && dash <= 0 ? w : 0;
      const spin = dash;
      const flick = wind <= 0 && at > 0 && !wRel && dash <= 0 ? at : 0;
      const bowC = ease(clamp01(u.curtain || 0));
      const walk = !!u.walk && !spin && bowC < 0.3 && waltzW <= 0;
      const eyeK = A3 ? 1 : P2 ? 0.8 : 0.62;
      const PI = Math.PI;
      const CUR = A3 ? '#5a1626' : P2 ? '#641a2a' : '#6e1f2e', CUR_D = '#3a0c18', CUR_L = '#8a3040';
      const TUL = P2 ? '#958390' : '#b4a0ae', TUL_L = P2 ? '#ab9ba6' : '#cbbac6', BOD = P2 ? '#6c4458' : '#9a6e80', BOD_D = '#3e2436';
      const SKN = '#2e2442', SKN_F = '#231a34', TIGHT = '#3a2e4a', TIGHT_F = '#2a2038', SAT = P2 ? '#a88490' : '#c49aa6', DINK = '#100818';
      ctx.lineJoin = 'round';
      const ik = (ax, ay, bx, by, l1, l2, px, py) => {
        let dx = bx - ax, dy = by - ay, d = Math.hypot(dx, dy) || 1;
        const mx = l1 + l2 - 0.5;
        if (d > mx) { bx = ax + dx / d * mx; by = ay + dy / d * mx; dx = bx - ax; dy = by - ay; d = mx; }
        const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
        let nx = -dy / d, ny = dx / d; if (nx * px + ny * py < 0) { nx = -nx; ny = -ny; }
        return [ax + dx / d * a + nx * h, ay + dy / d * a + ny * h, bx, by];
      };
      const L2 = (a, b, k) => [lerp(a[0], b[0], k), lerp(a[1], b[1], k)];
      const bz3 = (p0, p1, p2, p3, s) => { const r = 1 - s; return [r * r * r * p0[0] + 3 * r * r * s * p1[0] + 3 * r * s * s * p2[0] + s * s * s * p3[0], r * r * r * p0[1] + 3 * r * r * s * p1[1] + 3 * r * s * s * p2[1] + s * s * s * p3[1]]; };

      // ---------- pose ----------
      const q = (Math.sin(t * 0.8) + 1) / 2;
      let hip = [0, -114 + Math.sin(t * 1.6) * 1.2], tilt = 0;
      let t1 = [7, 0], a1 = PI / 2, t2 = [-5, 0], a2 = PI / 2;              // toes + foot angles (near / far)
      let hF = L2([28, -34], [42, -60], q), hB = L2([-36, -46], [-46, -66], q);   // hands, torso-local
      if (walk) {                                                          // bourrée: tiny quick steps on pointe
        const b = t * 14;
        t1 = [6 + Math.sin(b) * 3, -Math.max(0, Math.sin(b)) * 3]; t2 = [-4 - Math.sin(b) * 3, -Math.max(0, -Math.sin(b)) * 3];
        hip[1] += Math.abs(Math.cos(b)) * 1.2;
        hF = [36, -52]; hB = [-46, -60];
      }
      // waltz: arabesque (back leg extended, front arm reaching forward-up)
      const arab = Math.max(waltzW, wPose);
      if (arab > 0) {
        t1 = L2(t1, [8, 0], arab); a1 = PI / 2;
        t2 = L2(t2, [-110, -112], arab); a2 = lerp(a2, PI + 0.08, arab);
        hF = L2(hF, [52, -108], arab); hB = L2(hB, [-60, -66], arab);
      }
      if (wRel) hF = L2(hF, [62, -38], sweep);
      // spin preparation: fourth-position plié, arms opening
      if (spinW > 0) {
        t1 = L2(t1, [28, 0], spinW); a1 = lerp(a1, 1.25, spinW); t2 = L2(t2, [-24, 0], spinW); a2 = lerp(a2, 1.9, spinW);
        hip[1] += spinW * 12;
        hF = L2(hF, [40, -40], spinW); hB = L2(hB, [-50, -58], spinW);
      }
      // pirouette: passé, arms rounded in first
      if (spin > 0) {
        t1 = L2(t1, [2, 0], spin); a1 = PI / 2;
        t2 = L2(t2, [6, -66], spin); a2 = lerp(a2, PI / 2 + 0.5, spin);
        hip[1] -= spin * 3;
        hF = L2(hF, [24, -40], spin); hB = L2(hB, [14, -36], spin);
      }
      if (flick > 0) { const f = Math.sin(clamp01(flick * 1.4) * PI * 0.5); hF = L2(hF, [56, -60], f); }
      // the bow (révérence) as the curtain falls
      if (bowC > 0) {
        t1 = L2(t1, [24, 0], bowC); a1 = lerp(a1, 1.35, bowC);
        t2 = L2(t2, [-34, 0], bowC); a2 = lerp(a2, 2.25, bowC);
        hip = [lerp(hip[0], -4, bowC), hip[1] + bowC * 30];
        tilt = lerp(tilt, 0.62, bowC);
        hF = L2(hF, [40, 4], bowC); hB = L2(hB, [-62, -24], bowC);
      }
      const ct = Math.cos(tilt), st2 = Math.sin(tilt);
      const TS = 1.1, toW = (p) => [hip[0] + (p[0] * ct - p[1] * st2) * TS, hip[1] + (p[0] * st2 + p[1] * ct) * TS];
      let sx = 1;
      if (spin > 0) { const c = Math.cos(t * 15); sx = lerp(1, (c < 0 ? -1 : 1) * Math.max(0.5, Math.abs(c)), spin); }

      // ---------- ground: ink puddle + a faint stage-light pool ----------
      ctx.fillStyle = 'rgba(12,6,24,.8)'; ell(ctx, -18, -1, 58, 6.5); ctx.fill();
      for (let i = 0; i < 4; i++) { const px = -66 + i * 30 + Math.sin(i * 2.1) * 6, pr = 4 + (Math.sin(t * 1.1 + i) + 1) * 2.4; ell(ctx, px, -1, pr * 1.7, pr * 0.42); ctx.fill(); }
      ctx.globalCompositeOperation = 'lighter';
      ctx.save(); ctx.scale(1, 0.18); sglow(ctx, 0, -8, 96, '255,220,240', 0.12 + act * 0.05); ctx.restore();
      sglow(ctx, 0, -124, 138, A3 ? '190,40,110' : '140,60,190', (P2 ? 0.26 : 0.18) + (A3 ? 0.12 : 0) + w * 0.18 + spin * 0.12);
      ctx.globalCompositeOperation = 'source-over';

      // ---------- spin: motion arcs (horizontal ellipses), back half ----------
      function spinArcs(front) {
        if (spin <= 0.02) return;
        ctx.lineCap = 'round';
        for (const [cy, rx, ry, ph] of [[-34, 40, 8, 0], [hip[1] + 4, 70, 14, 1.4], [-184, 46, 9, 2.7]]) {
          const a0 = t * 15 + ph;
          for (let i = 0; i < 10; i++) {
            const s0 = a0 - i * 0.22, s1 = s0 - 0.24;
            if ((Math.sin((s0 + s1) / 2) > 0) !== front) continue;
            ctx.strokeStyle = `rgba(255,226,240,${(spin * 0.8 * (1 - i / 10)).toFixed(3)})`; ctx.lineWidth = 4.4 * (1 - i / 12);
            ctx.beginPath(); ctx.ellipse(0, cy, rx, ry, 0, Math.min(s0, s1), Math.max(s0, s1)); ctx.stroke();
          }
        }
        ctx.lineCap = 'butt';
      }
      spinArcs(false);

      ctx.save();
      if (sx !== 1) ctx.scale(sx, 1);

      // ---------- the curtain train ----------
      const fl = Math.sin(t * 1.3), fl2 = Math.sin(t * 2.1 + 1);
      const trainEnd = lerp(walk ? -178 : -166, -76, bowC) + fl * 4 - spin * 30;
      const A = toW([-12, -58]), B = toW([0, -66]);
      const inner = [A, [A[0] - 4, A[1] + 50], [-22 + fl2 * 2, -40], [-24, 0]];
      const outer = [B, [B[0] - 30 - fl * 5 - (walk ? 12 : 0), B[1] + 70 + fl2 * 5], [-62 + fl * 6 - (walk ? 14 : 0), -18 - (walk ? 8 : 0) + fl2 * 3], [trainEnd, -4]];
      const CP = (uu, v) => { const a = bz3(inner[0], inner[1], inner[2], inner[3], v), b = bz3(outer[0], outer[1], outer[2], outer[3], v); return [lerp(a[0], b[0], uu), lerp(a[1], b[1], uu) - (v > 0.85 ? Math.sin(uu * 9 + t * 2) * 1.5 * (v - 0.85) / 0.15 : 0)]; };
      const nStrip = A3 ? 6 : P2 ? 4 : 1, gap = A3 ? 0.03 : 0.01;
      function stripPath(u0, u1, vEnd, k, cp) {
        const N = 12;
        ctx.beginPath();
        let p = cp(u0, 0); ctx.moveTo(p[0], p[1]);
        for (let i = 1; i <= N; i++) { p = cp(u0, vEnd * i / N); ctx.lineTo(p[0], p[1]); }
        const M = 6;
        for (let j = 1; j <= M; j++) {                                     // torn, ragged end
          const uu = lerp(u0, u1, j / M), jag = (j % 2 ? 1 : -1) * (3 + ((k * 7 + j * 3) % 4)) * 0.004;
          const vv = Math.min(1, vEnd - Math.abs(jag) * (vEnd < 1 ? 4 : 1.5) + (A3 ? Math.sin(t * 4 + k + j) * 0.01 : 0));
          p = cp(uu, vv); ctx.lineTo(p[0] + jag * 300 * 0.2, p[1]);
        }
        for (let i = N; i >= 0; i--) { p = cp(u1, vEnd * i / N); ctx.lineTo(p[0], p[1]); }
        for (let j = 1; j < 6; j++) { p = cp(lerp(u1, u0, j / 6), 0); ctx.lineTo(p[0], p[1]); }
        ctx.closePath();
      }
      function curtainCloth(cp, keyG, gy0, gy1, vMul) {
        for (let k = 0; k < nStrip; k++) {
          const u0 = k / nStrip + (k ? gap : 0), u1 = (k + 1) / nStrip - (k < nStrip - 1 ? gap : 0);
          const vEnd = (nStrip === 1 ? 1 : A3 ? [0.92, 0.7, 0.84, 0.58, 0.76, 0.66][k] : [1, 0.9, 0.97, 0.86][k]) * vMul;
          stripPath(u0, u1, vEnd, k, cp);
          ctx.fillStyle = lgc(ctx, keyG + act, 0, gy0, 0, gy1, [[0, CUR_L], [0.35, CUR], [1, CUR_D]]); ctx.fill();
          ctx.save(); ctx.clip();
          // folds: soft dark/light bands that follow the fall of the cloth
          for (let f = 0; f < 5; f++) {
            const uu = (f + 0.5) / 5;
            ctx.strokeStyle = 'rgba(14,2,10,.42)'; ctx.lineWidth = 5;
            ctx.beginPath(); for (let i = 3; i <= 12; i++) { const p = cp(uu + Math.sin(i * 0.7 + f) * 0.02, i / 12); if (i === 3) ctx.moveTo(p[0], p[1]); else ctx.lineTo(p[0], p[1]); } ctx.stroke();
            ctx.strokeStyle = 'rgba(220,120,140,.16)'; ctx.lineWidth = 2;
            ctx.beginPath(); for (let i = 3; i <= 12; i++) { const p = cp(uu + 0.07 + Math.sin(i * 0.7 + f) * 0.02, i / 12); if (i === 3) ctx.moveTo(p[0], p[1]); else ctx.lineTo(p[0], p[1]); } ctx.stroke();
          }
          // ink soaking up from the floor
          ctx.fillStyle = 'rgba(10,2,10,.45)'; ctx.fillRect(-260, -26, 360, 30);
          ctx.restore();
          stripPath(u0, u1, vEnd, k, cp); ctx.strokeStyle = DINK; ctx.lineWidth = 2.2; ctx.stroke();
        }
      }
      curtainCloth(CP, 'dan-cur', -190, 0, 1);
      // faded gold trim along the outer edge + violet rim
      ctx.strokeStyle = 'rgba(196,150,96,.5)'; ctx.lineWidth = 2;
      ctx.beginPath(); for (let i = 1; i <= 10; i++) { const p = CP(0.985, i / 12 * (A3 ? 0.88 : 1)); if (i === 1) ctx.moveTo(p[0], p[1]); else ctx.lineTo(p[0], p[1]); } ctx.stroke();
      ctx.strokeStyle = RIM; ctx.lineWidth = 1;
      ctx.beginPath(); for (let i = 1; i <= 10; i++) { const p = CP(1, i / 12 * (A3 ? 0.88 : 1)); if (i === 1) ctx.moveTo(p[0] - 1, p[1] - 1); else ctx.lineTo(p[0] - 1, p[1] - 1); } ctx.stroke();
      // gathered heading where it hangs from her shoulders
      ctx.beginPath(); ctx.moveTo(A[0] - 3, A[1] + 2); ctx.quadraticCurveTo((A[0] + B[0]) / 2 - 4, (A[1] + B[1]) / 2 - 6, B[0] + 2, B[1] - 2);
      ctx.strokeStyle = DINK; ctx.lineWidth = 6; ctx.stroke(); ctx.strokeStyle = 'rgba(196,150,96,.55)'; ctx.lineWidth = 3; ctx.stroke();

      // ---------- limbs ----------
      function arm(sh, hand, near) {
        const k = ik(sh[0], sh[1], hand[0], hand[1], 36, 33, 0, 1);
        const col = near ? SKN : SKN_F;
        eLimb(ctx, sh[0], sh[1], (sh[0] + k[0]) / 2 + 1, (sh[1] + k[1]) / 2 + 1.5, k[0], k[1], 7, col);
        eLimb(ctx, k[0], k[1], (k[0] + k[2]) / 2 + 1, (k[1] + k[3]) / 2 + 1.5, k[2], k[3], 5.4, col);
        // long tapered hand
        const ha = Math.atan2(k[3] - k[1], k[2] - k[0]) + 0.25;
        ctx.beginPath(); ctx.moveTo(k[2] - Math.sin(ha) * 2.6, k[3] + Math.cos(ha) * 2.6);
        ctx.quadraticCurveTo(k[2] + Math.cos(ha) * 8, k[3] + Math.sin(ha) * 8, k[2] + Math.cos(ha) * 11, k[3] + Math.sin(ha) * 11);
        ctx.quadraticCurveTo(k[2] + Math.cos(ha) * 5 + Math.sin(ha) * 3, k[3] + Math.sin(ha) * 5 - Math.cos(ha) * 3, k[2] + Math.sin(ha) * 2.6, k[3] - Math.cos(ha) * 2.6);
        ctx.closePath(); fo(ctx, col, 1.6, DINK);
        if (near) { ctx.strokeStyle = RIM; ctx.lineWidth = 0.9; ctx.beginPath(); ctx.moveTo(sh[0], sh[1] - 3); ctx.quadraticCurveTo((sh[0] + k[0]) / 2, (sh[1] + k[1]) / 2 - 3, k[0], k[1] - 2.6); ctx.stroke(); }
      }
      function leg(toe, fa, near, kneeDir) {
        const fx = Math.cos(fa), fy = Math.sin(fa);
        const an = [toe[0] - fx * 17, toe[1] - fy * 17];
        const k = ik(hip[0] + (near ? 4 : -4), hip[1] + 2, an[0], an[1], 50, 46, kneeDir[0], kneeDir[1]);
        const col = near ? TIGHT : TIGHT_F;
        // one tapered silhouette: thigh → knee → calf → ankle
        const H0 = [hip[0] + (near ? 4 : -4), hip[1] + 2];
        const pts = [H0, L2(H0, k, 0.5), k, L2(k, an, 0.3), an], wd = [7, 5.6, 4, 4.6, 2.6];
        const Lp = [], Rp = [];
        for (let i = 0; i < pts.length; i++) {
          const a0 = pts[Math.max(0, i - 1)], b0 = pts[Math.min(pts.length - 1, i + 1)];
          let tx = b0[0] - a0[0], ty = b0[1] - a0[1]; const d = Math.hypot(tx, ty) || 1; tx /= d; ty /= d;
          Lp.push([pts[i][0] - ty * wd[i], pts[i][1] + tx * wd[i]]); Rp.push([pts[i][0] + ty * wd[i], pts[i][1] - tx * wd[i]]);
        }
        ctx.beginPath(); ctx.moveTo(Lp[0][0], Lp[0][1]);
        for (let i = 1; i < Lp.length; i++) { const m = L2(Lp[i - 1], Lp[i], 0.5); ctx.quadraticCurveTo(Lp[i - 1][0], Lp[i - 1][1], m[0], m[1]); }
        ctx.lineTo(Lp[Lp.length - 1][0], Lp[Lp.length - 1][1]); ctx.lineTo(Rp[Rp.length - 1][0], Rp[Rp.length - 1][1]);
        for (let i = Rp.length - 2; i >= 0; i--) { const m = L2(Rp[i + 1], Rp[i], 0.5); ctx.quadraticCurveTo(Rp[i + 1][0], Rp[i + 1][1], m[0], m[1]); }
        ctx.lineTo(Rp[0][0], Rp[0][1]); ctx.closePath();
        ctx.fillStyle = col; ctx.fill(); ctx.strokeStyle = DINK; ctx.lineWidth = 2.2; ctx.stroke();
        if (near) { ctx.strokeStyle = 'rgba(230,170,210,.35)'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(hip[0] + 9, hip[1] + 6); ctx.quadraticCurveTo((hip[0] + k[0]) / 2 + 6, (hip[1] + k[1]) / 2, k[0] + 4, k[1]); ctx.stroke(); }
        // pointe shoe (satin, ink soaking up from the toe box)
        const nx = -fy, ny = fx;
        ctx.beginPath();
        ctx.moveTo(an[0] + nx * 4.4 - fx * 2, an[1] + ny * 4.4 - fy * 2);
        ctx.quadraticCurveTo(an[0] + nx * 4 + fx * 9, an[1] + ny * 4 + fy * 9, toe[0] + nx * 2.6, toe[1] + ny * 2.6);
        ctx.lineTo(toe[0] - nx * 2.6, toe[1] - ny * 2.6);
        ctx.quadraticCurveTo(an[0] - nx * 4 + fx * 9, an[1] - ny * 4 + fy * 9, an[0] - nx * 4.4 - fx * 2, an[1] - ny * 4.4 - fy * 2);
        ctx.closePath();
        ctx.fillStyle = near ? SAT : '#8a6a76'; ctx.fill();
        ctx.save(); ctx.clip();
        ctx.fillStyle = 'rgba(16,6,22,.85)'; circ(ctx, toe[0] + fx * 1.5, toe[1] + fy * 1.5, 5); ctx.fill();
        ctx.fillStyle = 'rgba(16,6,22,.38)'; circ(ctx, toe[0] - fx * 5 + nx * 2, toe[1] - fy * 5 + ny * 2, 4.2); ctx.fill();
        ctx.strokeStyle = 'rgba(255,230,238,.35)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(an[0] + nx * 2, an[1] + ny * 2); ctx.lineTo(toe[0] - fx * 6 + nx * 1.4, toe[1] - fy * 6 + ny * 1.4); ctx.stroke();
        ctx.restore();
        ctx.strokeStyle = DINK; ctx.lineWidth = 1.8; ctx.stroke();
        // ribbons criss-crossing the ankle
        ctx.strokeStyle = near ? 'rgba(220,170,186,.85)' : 'rgba(170,130,146,.7)'; ctx.lineWidth = 1.2;
        const sx2 = k[2] - fx * 9, sy2 = k[3] - fy * 9;
        ctx.beginPath(); ctx.moveTo(an[0] + nx * 4, an[1] + ny * 4); ctx.lineTo(sx2 - nx * 4, sy2 - ny * 4); ctx.moveTo(an[0] - nx * 4, an[1] - ny * 4); ctx.lineTo(sx2 + nx * 4, sy2 + ny * 4); ctx.stroke();
      }
      // back arm (torso space)
      ctx.save(); ctx.translate(hip[0], hip[1]); ctx.rotate(tilt); ctx.scale(TS, TS);
      arm([-6, -63], hB, false);
      ctx.restore();
      // legs (far then near)
      const k2 = arab > 0.3 ? [0, -1] : bowC > 0.3 ? [1, 0.3] : spin > 0.3 ? [1, 0] : [1, 0];
      leg(t2, a2, false, k2);
      leg(t1, a1, true, [1, 0]);

      // ---------- tutu (flat, layered, ragged faded tulle) ----------
      ctx.save(); if (sx !== 1) ctx.scale(1 / sx, 1); ctx.translate(hip[0] * sx, hip[1]); ctx.rotate(tilt);
      const flare = spin;
      const rx = 54 + flare * 10 + spinW * 3, ry = 8.5 + flare * 5;
      const tTilt = spin > 0 ? Math.sin(t * 15) * 0.08 * spin : 0;
      ctx.rotate(tTilt);
      function tutuLayer(yo, sc, col, seed) {
        ctx.beginPath();
        const N = 28;
        for (let i = 0; i <= N; i++) {
          const a = i / N * TAU, jag = (i % 2 ? 1 : 0.9) + Math.sin(a * 5 + seed) * 0.04 + (P2 && (i === 9 || i === 10) ? -0.18 : 0);
          const x = Math.cos(a) * rx * sc * jag, y = yo + Math.sin(a) * ry * sc * jag + (spin > 0 ? 0 : Math.sin(t * 2 + a * 3) * 0.6);
          if (!i) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.fillStyle = col; ctx.fill(); ctx.strokeStyle = DINK; ctx.lineWidth = 1.8; ctx.stroke();
      }
      tutuLayer(4, 0.96, P2 ? 'rgba(120,100,112,.95)' : 'rgba(150,128,140,.95)', 1);
      tutuLayer(1, 1, TUL, 2.3);
      tutuLayer(-2, 0.9, TUL_L, 4.1);
      // ink stains along the rim + tulle texture
      ctx.fillStyle = 'rgba(30,14,36,.32)';
      for (let i = 0; i < 5; i++) { const a = 0.5 + i * 0.55; ell(ctx, Math.cos(a) * rx * 0.86, 1 + Math.sin(a) * ry * 0.8, 5, 1.6, 0); ctx.fill(); }
      // tulle frills along the rim
      ctx.strokeStyle = 'rgba(70,50,70,.35)'; ctx.lineWidth = 0.9; ctx.beginPath();
      for (let i = 0; i < 12; i++) { const a = 0.15 + i * 0.24; const x = Math.cos(a) * rx * 0.94, y = Math.sin(a) * ry * 0.9 + 1; ctx.moveTo(x - 3, y - 1); ctx.quadraticCurveTo(x, y + 2, x + 3, y - 1); } ctx.stroke();
      ctx.strokeStyle = 'rgba(255,240,248,.28)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.ellipse(0, -2, rx * 0.62, ry * 0.5, 0, PI * 1.1, PI * 1.9); ctx.stroke();
      if (A3) {
        ctx.fillStyle = DINK;
        for (let i = 0; i < 3; i++) { const x = -30 + i * 26, l = 6 + (Math.sin(t * 1.4 + i * 2) + 1) * 6; rr(ctx, x, 5 + ry * 0.6, 2.6, l, 1.3); ctx.fill(); circ(ctx, x + 1.3, 5 + ry * 0.6 + l, 2); ctx.fill(); }
      }
      ctx.restore();

      // ---------- torso, head, front arm (torso space) ----------
      ctx.save(); ctx.translate(hip[0], hip[1]); ctx.rotate(tilt); ctx.scale(TS, TS);
      const body = () => {
        ctx.beginPath(); ctx.moveTo(-12, -2);
        ctx.quadraticCurveTo(0, 6, 13, -2);                                 // pointed basque
        ctx.bezierCurveTo(10, -16, 9, -26, 12, -40);
        ctx.bezierCurveTo(14, -50, 12, -58, 8, -63);
        ctx.quadraticCurveTo(0, -66, -8, -63);
        ctx.bezierCurveTo(-13, -54, -12, -44, -10, -34);
        ctx.bezierCurveTo(-8, -24, -12, -12, -12, -2); ctx.closePath();
      };
      body(); ctx.fillStyle = SKN; ctx.fill();
      // bodice
      ctx.save(); body(); ctx.clip();
      ctx.beginPath(); ctx.moveTo(-16, 8); ctx.lineTo(18, 8); ctx.lineTo(18, -46); ctx.quadraticCurveTo(14, -50, 10, -46); ctx.quadraticCurveTo(6, -52, 1, -47); ctx.lineTo(-16, -50); ctx.closePath();
      ctx.fillStyle = lgc(ctx, 'dan-bod' + (P2 ? 2 : 1), 0, -50, 0, 6, [[0, BOD], [1, BOD_D]]); ctx.fill();
      ctx.strokeStyle = 'rgba(255,220,235,.22)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(4, -44); ctx.quadraticCurveTo(6, -22, 2, 2); ctx.moveTo(-6, -46); ctx.quadraticCurveTo(-4, -22, -6, 0); ctx.stroke();
      ctx.fillStyle = 'rgba(20,8,26,.35)'; ctx.fillRect(-16, -70, 7, 80);
      ctx.restore();
      body(); ctx.strokeStyle = DINK; ctx.lineWidth = 2.4; ctx.stroke();
      ctx.strokeStyle = RIM; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(-10, -36); ctx.bezierCurveTo(-12, -46, -12, -56, -8, -62); ctx.stroke();
      // neck + head
      eLimb(ctx, 2, -62, 4, -70, 6, -78, 6.4, SKN);
      const hc = [7, -92];
      // hair: sleek cap + bun with a faded ribbon
      circ(ctx, hc[0] - 9, hc[1] - 11, 8.6); fo(ctx, '#2a1e3a', 2, DINK);
      ctx.strokeStyle = P2 ? 'rgba(170,110,130,.8)' : 'rgba(210,150,170,.85)'; ctx.lineWidth = 2.2; ctx.beginPath(); ctx.arc(hc[0] - 9, hc[1] - 11, 8.6, 0.2, 1.4); ctx.stroke();
      ctx.beginPath(); ctx.arc(hc[0], hc[1], 14, 0, TAU); ctx.fillStyle = SKN; ctx.fill(); ctx.strokeStyle = DINK; ctx.lineWidth = 2.2; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(hc[0] + 12, hc[1] - 7); ctx.bezierCurveTo(hc[0] + 8, hc[1] - 18, hc[0] - 12, hc[1] - 18, hc[0] - 14, hc[1] - 2);
      ctx.quadraticCurveTo(hc[0] - 14, hc[1] + 6, hc[0] - 9, hc[1] + 10); ctx.quadraticCurveTo(hc[0] - 6, hc[1] - 4, hc[0] + 2, hc[1] - 8); ctx.quadraticCurveTo(hc[0] + 8, hc[1] - 10, hc[0] + 12, hc[1] - 7); ctx.closePath();
      fo(ctx, '#2a1e3a', 1.8, DINK);
      ctx.strokeStyle = 'rgba(200,170,230,.3)'; ctx.lineWidth = 1.1; ctx.beginPath(); ctx.moveTo(hc[0] - 9, hc[1] - 12); ctx.quadraticCurveTo(hc[0] + 1, hc[1] - 17, hc[0] + 8, hc[1] - 11); ctx.stroke();
      // porcelain mask over the face (profile toward +x), cracked
      const mask = () => {
        ctx.beginPath(); ctx.moveTo(hc[0] + 1, hc[1] - 9);
        ctx.quadraticCurveTo(hc[0] + 14, hc[1] - 12, hc[0] + 16, hc[1] - 1);
        ctx.quadraticCurveTo(hc[0] + 18, hc[1] + 6, hc[0] + 15, hc[1] + 10);
        ctx.quadraticCurveTo(hc[0] + 10, hc[1] + 15, hc[0] + 3, hc[1] + 13);
        ctx.quadraticCurveTo(hc[0] - 1, hc[1] + 2, hc[0] + 1, hc[1] - 9); ctx.closePath();
      };
      mask(); ctx.fillStyle = lgc(ctx, 'dan-mask', 0, -104, 0, -78, [[0, '#e2dad6'], [1, '#a89aa4']]); ctx.fill();
      ctx.save(); mask(); ctx.clip(); ctx.fillStyle = 'rgba(60,40,70,.3)'; ell(ctx, hc[0] + 2, hc[1] + 2, 5, 14); ctx.fill(); ctx.restore();
      mask(); ctx.strokeStyle = DINK; ctx.lineWidth = 1.8; ctx.stroke();
      // eyes through the mask
      ctx.globalCompositeOperation = 'lighter';
      sglow(ctx, hc[0] + 10, hc[1], 16 + eyeK * 14 + spin * 6, A3 ? '255,150,200' : '255,170,236', eyeK * 0.75 + waltzW * 0.2);
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = '#0c0614'; ell(ctx, hc[0] + 7.5, hc[1] - 0.5, 2.8, 1.9, -0.15); ctx.fill(); ell(ctx, hc[0] + 14, hc[1] - 0.8, 2.1, 1.8, 0.1); ctx.fill();
      const bl = eBlink(t + 0.7, 4.3);
      eEye(ctx, hc[0] + 7.6, hc[1] - 0.4, 1.9, 1.15 * bl, -0.15); eEye(ctx, hc[0] + 14, hc[1] - 0.7, 1.3, 1.05 * bl, 0.1);
      // painted brows + lips on the porcelain, a crack and an ink tear
      ctx.strokeStyle = 'rgba(60,30,60,.7)'; ctx.lineWidth = 0.9;
      ctx.beginPath(); ctx.moveTo(hc[0] + 5, hc[1] - 4.5); ctx.quadraticCurveTo(hc[0] + 8, hc[1] - 6, hc[0] + 10.5, hc[1] - 5); ctx.stroke();
      ctx.fillStyle = P2 ? 'rgba(120,30,50,.8)' : 'rgba(170,70,90,.75)'; ell(ctx, hc[0] + 13, hc[1] + 8.6, 2, 1, 0.1); ctx.fill();
      ctx.strokeStyle = 'rgba(20,8,24,.8)'; ctx.lineWidth = 0.9;
      ctx.beginPath(); ctx.moveTo(hc[0] + 4, hc[1] - 9); ctx.lineTo(hc[0] + 6, hc[1] - 5); ctx.lineTo(hc[0] + 4.5, hc[1] - 2.5);
      if (P2) { ctx.moveTo(hc[0] + 15, hc[1] + 3); ctx.lineTo(hc[0] + 11, hc[1] + 5); ctx.lineTo(hc[0] + 12, hc[1] + 9); }
      ctx.stroke();
      const tl = 4 + (Math.sin(t * 0.9) + 1) * (A3 ? 5 : 3.2);
      ctx.fillStyle = '#0c0614'; rr(ctx, hc[0] + 7, hc[1] + 1.4, 1.8, tl, 0.9); ctx.fill(); circ(ctx, hc[0] + 7.9, hc[1] + 1.4 + tl, 1.4); ctx.fill();
      // front arm
      arm([6, -62], hF, true);
      // little sleeve ruffle at the shoulder
      ell(ctx, 6, -60, 7, 4.2, 0.3); fo(ctx, TUL, 1.4, DINK);
      ctx.restore();

      // ---------- the curtain wraps around her as she bows ----------
      if (bowC > 0.02) {
        const Ht = bowC * 150;
        const FW = (uu, v) => {
          // u: back (0) → front (1) across her; v: top (0) → floor (1)
          const top = [lerp(-40, 46, uu), lerp(-Ht, -Ht * 0.5, uu) + Math.sin(uu * PI) * Ht * 0.16 + Math.sin(uu * 5 + t * 1.6) * 2.5];
          const bot = [lerp(-46, 60, uu) + Math.sin(uu * 7) * 3, 0];
          const bulge = Math.sin(v * PI) * 18 * uu * uu;
          return [lerp(top[0], bot[0], v) + bulge, lerp(top[1], bot[1], v)];
        };
        const pa = ctx.globalAlpha; ctx.globalAlpha = pa * Math.min(1, bowC * 2.2);
        curtainCloth(FW, 'dan-wrap', -196, 0, 1);
        ctx.strokeStyle = 'rgba(196,150,96,.55)'; ctx.lineWidth = 2.2;
        ctx.beginPath(); for (let i = 0; i <= 12; i++) { const p = FW(i / 12, 0.02); if (!i) ctx.moveTo(p[0], p[1]); else ctx.lineTo(p[0], p[1]); } ctx.stroke();
        ctx.strokeStyle = RIM; ctx.lineWidth = 1.1;
        ctx.beginPath(); for (let i = 0; i <= 10; i++) { const p = FW(0.995, i / 10); if (!i) ctx.moveTo(p[0], p[1]); else ctx.lineTo(p[0], p[1]); } ctx.stroke();
        ctx.globalAlpha = pa;
      }
      ctx.restore();   // spin scale

      spinArcs(true);
      // waltz: a soft crescent trail where the arm sweeps (curved band, not rays)
      const trailK = Math.max(waltzW * 0.7, wRel ? Math.sin(clamp01(sp * 1.3) * PI) : 0);
      if (trailK > 0.02) {
        const sh = toW([6, -62]), R = 70;
        const aEnd = wRel ? lerp(-1.05, 0.35, sweep) : -1.05 * waltzW - 1.9 * (1 - waltzW);
        ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round';
        for (let i = 0; i < 9; i++) {
          const a1x = aEnd - i * 0.16, a0x = a1x - 0.17;
          ctx.strokeStyle = `rgba(255,214,236,${(0.5 * trailK * (1 - i / 9)).toFixed(3)})`; ctx.lineWidth = 9 * (1 - i / 11);
          ctx.lineCap = i ? 'butt' : 'round';
          ctx.beginPath(); ctx.arc(sh[0], sh[1], R, a0x, a1x + 0.01); ctx.stroke();
        }
        ctx.lineCap = 'butt'; ctx.globalCompositeOperation = 'source-over';
      }
      // drifting motes; act 3 adds crimson petals of torn curtain
      ctx.fillStyle = 'rgba(200,140,255,.7)';
      for (let i = 0; i < 5; i++) { const p = (t * 0.3 + i / 5) % 1, mx = -60 + i * 26 + Math.sin(t + i) * 8; ctx.fillRect(mx, -24 - p * 210, 2.4, 2.4); }
      if (A3) {
        ctx.fillStyle = 'rgba(150,40,60,.85)';
        for (let i = 0; i < 6; i++) { const p = (t * 0.22 + i / 6) % 1, x = -150 + p * 90 + Math.sin(t * 2 + i * 2) * 14, y = -30 - i * 24 - p * 40; ell(ctx, x, y, 3.4, 1.6, t * 3 + i); ctx.fill(); }
      }
    },

    // ---------------- ボス「忘却を運ぶ郵便屋」 ----------------
    // Not one person's dream: all the words that were never delivered. A body of stacked, overlapping
    // envelopes and letter paper (faded cream / blue-grey / pink), stamps and round postmarks with wavy
    // cancel lines, a postman's cap, a satchel overflowing with letters, small letters orbiting around it.
    // Addresses are only blurred scribbles. u.windKind 'seal' (a loose fan of 3 letters thrown forward)
    // · u.atk (small hand flick) · phase 2: the envelope body unravels, letters peel off and flutter away.
    postman(ctx, u) {
      const t = u.anim || 0, at = u.atk || 0, P2 = (u.phase || 1) >= 2;
      const wind = clamp01(u.wind || 0), w = ease(wind), wk = u.windKind;
      const sealW = wind > 0 && wk === 'seal' ? w : 0;
      const sRel = wind <= 0 && at > 0 && wk === 'seal';
      const sp = sRel ? 1 - at : 0;
      const flick = wind <= 0 && at > 0 && !sRel ? at : 0;
      const walk = !!u.walk;
      const ph = t * 3.6, ws = walk ? Math.sin(ph) : 0;
      const bob = walk ? Math.abs(Math.cos(ph)) * 3 : Math.sin(t * 1.5) * 1.4;
      const PINK = '#ad8a92', CREAM = '#b6ac94', BLUE = '#7d879a', PALE = '#c0b8a6', LILAC = '#968aa0';
      const PAL = [CREAM, BLUE, PINK, PALE, LILAC, CREAM, BLUE];
      const PINKK = '#120a1c';
      ctx.lineJoin = 'round';
      let sd = 917;
      const rnd = () => ((sd = (sd * 1664525 + 1013904223) >>> 0) / 4294967296);
      const ik = (ax, ay, bx, by, l1, l2, px, py) => {
        let dx = bx - ax, dy = by - ay, d = Math.hypot(dx, dy) || 1;
        const mx = l1 + l2 - 0.5;
        if (d > mx) { bx = ax + dx / d * mx; by = ay + dy / d * mx; dx = bx - ax; dy = by - ay; d = mx; }
        const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
        let nx = -dy / d, ny = dx / d; if (nx * px + ny * py < 0) { nx = -nx; ny = -ny; }
        return [ax + dx / d * a + nx * h, ay + dy / d * a + ny * h, bx, by];
      };
      // one envelope / sheet in local space (centre x,y). kind: 0 flap side, 1 address side, 2 letter paper
      function env(x, y, ew, eh, rot, col, kind, dark, lw) {
        ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
        ctx.beginPath(); ctx.rect(-ew / 2, -eh / 2, ew, eh);
        ctx.fillStyle = col; ctx.fill();
        if (kind === 2) {
          ctx.strokeStyle = 'rgba(90,110,150,.35)'; ctx.lineWidth = 0.8; ctx.beginPath();
          for (let yy = -eh / 2 + 4; yy < eh / 2 - 1; yy += 3.6) { ctx.moveTo(-ew / 2 + 2, yy); ctx.lineTo(ew / 2 - 2, yy); }
          ctx.stroke();
          ctx.strokeStyle = 'rgba(40,30,60,.5)'; ctx.lineWidth = 0.9; ctx.beginPath();
          for (let yy = -eh / 2 + 4; yy < eh / 2 - 4; yy += 3.6) { let xx = -ew / 2 + 4; ctx.moveTo(xx, yy - 0.6); while (xx < ew / 2 - 6) { xx += 3; ctx.quadraticCurveTo(xx - 1.5, yy - 2.2, xx, yy - 0.6); } }
          ctx.stroke();
          ctx.beginPath(); ctx.moveTo(ew / 2 - 6, -eh / 2); ctx.lineTo(ew / 2, -eh / 2 + 6); ctx.lineTo(ew / 2 - 6, -eh / 2 + 6); ctx.closePath(); ctx.fillStyle = 'rgba(20,10,30,.25)'; ctx.fill();
        } else if (kind === 0) {
          ctx.strokeStyle = 'rgba(30,20,40,.55)'; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(-ew / 2, -eh / 2); ctx.lineTo(0, eh * 0.12); ctx.lineTo(ew / 2, -eh / 2);
          ctx.moveTo(-ew / 2, eh / 2); ctx.lineTo(-ew * 0.12, 0); ctx.moveTo(ew / 2, eh / 2); ctx.lineTo(ew * 0.12, 0); ctx.stroke();
        } else {
          // blurred, illegible address scribbles
          ctx.strokeStyle = 'rgba(40,30,60,.55)'; ctx.lineWidth = 1; ctx.beginPath();
          for (let r = 0; r < 3; r++) { const yy = -eh * 0.05 + r * 3.6, x1 = -ew * 0.28 + (r === 2 ? -2 : 0), x2 = ew * (0.22 - r * 0.08); let xx = x1; ctx.moveTo(xx, yy); while (xx < x2) { xx += 2.6; ctx.quadraticCurveTo(xx - 1.3, yy - 1.8, xx, yy + (r % 2 ? 0.4 : -0.3)); } }
          ctx.stroke();
          // stamp with a perforated edge
          const sx = ew / 2 - 7.5, sy = -eh / 2 + 6;
          ctx.beginPath(); ctx.rect(sx - 4, sy - 4.6, 8, 9.2); ctx.fillStyle = kind === 1 && (ew | 0) % 2 ? '#8e5a64' : '#5e7a74'; ctx.fill();
          ctx.fillStyle = col; for (let i = 0; i < 4; i++) { circ(ctx, sx - 4, sy - 3.4 + i * 2.3, 0.7); ctx.fill(); circ(ctx, sx + 4, sy - 3.4 + i * 2.3, 0.7); ctx.fill(); }
          ctx.fillStyle = 'rgba(255,240,230,.35)'; circ(ctx, sx, sy, 1.8); ctx.fill();
          // round postmark + wavy cancel lines running sideways
          const px = sx - 10, py = sy + 1;
          ctx.strokeStyle = 'rgba(40,24,60,.6)'; ctx.lineWidth = 0.9;
          circ(ctx, px, py, 4.2); ctx.stroke(); circ(ctx, px, py, 2.2); ctx.stroke();
          ctx.beginPath();
          for (let r = 0; r < 3; r++) { const yy = py - 2.6 + r * 2.6; let xx = px + 5; ctx.moveTo(xx, yy); while (xx < sx + 6) { xx += 2.4; ctx.quadraticCurveTo(xx - 1.2, yy + (r % 2 ? 1.4 : -1.4), xx, yy); } }
          ctx.stroke();
        }
        if (dark > 0) { ctx.fillStyle = `rgba(14,6,26,${dark.toFixed(3)})`; ctx.fillRect(-ew / 2, -eh / 2, ew, eh); }
        ctx.beginPath(); ctx.rect(-ew / 2, -eh / 2, ew, eh); ctx.strokeStyle = EINK; ctx.lineWidth = lw || 1.8; ctx.stroke();
        ctx.restore();
      }
      // small flying letter (flap side), fluttering
      function flyer(x, y, s, rot, flut, col, a) {
        if (a <= 0.02) return;
        const pa = ctx.globalAlpha; ctx.globalAlpha = pa * a;
        ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.scale(s, s * (0.35 + 0.65 * Math.abs(flut)));
        ctx.beginPath(); ctx.rect(-7, -4.6, 14, 9.2); ctx.fillStyle = col; ctx.fill(); ctx.strokeStyle = EINK; ctx.lineWidth = 1.5; ctx.stroke();
        ctx.strokeStyle = 'rgba(30,20,40,.6)'; ctx.lineWidth = 0.9; ctx.beginPath(); ctx.moveTo(-7, -4.6); ctx.lineTo(0, 1); ctx.lineTo(7, -4.6); ctx.stroke();
        ctx.restore();
        ctx.globalAlpha = pa;
      }

      // ---- ground: ink puddle with two soggy letters ----
      ctx.fillStyle = 'rgba(12,6,24,.82)'; ell(ctx, 0, -1, 58, 7); ctx.fill();
      for (let i = 0; i < 4; i++) { const px = -50 + i * 32 + Math.sin(i * 2.9) * 6, pr = 4 + (Math.sin(t * 1.2 + i) + 1) * 2.4; ell(ctx, px, -1, pr * 1.7, pr * 0.42); ctx.fill(); }
      ctx.save(); ctx.scale(1, 0.4);
      env(-40, -6, 18, 12, 0.3, '#6e6878', 0, 0.35, 1.4); env(44, -4, 16, 11, -0.4, '#7a6a72', 1, 0.45, 1.4);
      ctx.restore();
      ctx.globalCompositeOperation = 'lighter';
      sglow(ctx, 0, -126, 136, '140,80,210', (P2 ? 0.28 : 0.18) + w * 0.2);
      ctx.globalCompositeOperation = 'source-over';

      // ---- orbiting letters (back half) ----
      const ORB = 7;
      function orbit(front) {
        for (let i = 0; i < ORB; i++) {
          const a = t * 0.9 + i * TAU / ORB, sn = Math.sin(a);
          if ((sn > 0) !== front) continue;
          const R = (P2 ? 90 : 76) + (i % 3) * 6, x = Math.cos(a) * R, y = -132 + sn * 16 + Math.sin(t * 2.2 + i * 1.9) * 10 - (i % 2) * 40 + 18;
          flyer(x, y, front ? 1.2 : 1, Math.sin(t * 2 + i) * 0.35 + Math.cos(a) * 0.2, Math.cos(t * 7 + i * 1.3), PAL[i % PAL.length], front ? 0.95 : 0.6);
        }
      }
      orbit(false);
      // phase 2: letters peeling away, fluttering up and back
      if (P2) {
        for (let i = 0; i < 9; i++) {
          const p = (t * 0.22 + i / 9) % 1, x0 = -24 + (i % 5) * 12, y0 = -80 - (i % 4) * 28;
          const x = x0 - p * (70 + (i % 3) * 30) + Math.sin(t * 3 + i * 2) * 8, y = y0 - p * (90 + (i % 2) * 40);
          flyer(x, y, 0.9 + (i % 2) * 0.3, Math.sin(t * 2.6 + i) * 0.8 - p, Math.cos(t * 8 + i), PAL[(i + 2) % PAL.length], Math.sin(p * Math.PI) * 0.9);
        }
      }

      ctx.save();
      ctx.translate(0, -bob);
      // ---- poses ----
      const sB = [-18, -162], sF = [16, -160];
      let fh = [30, -104 + Math.sin(t * 1.5) * 1.5], bh = [-26, -106];
      const reach = sealW > 0 ? ease(clamp01(sealW / 0.35)) * (1 - ease(clamp01((sealW - 0.35) / 0.5))) : 0;
      const raise = sealW > 0 ? ease(clamp01((sealW - 0.35) / 0.6)) : 0;
      fh = L2p(fh, [26, -112], reach); fh = L2p(fh, [-42, -150], raise);
      if (sRel) { const k = 1 - Math.pow(1 - clamp01(sp * 2.2), 2), back = ease(clamp01((sp - 0.6) / 0.4)); fh = L2p(L2p([-42, -150], [64, -138], k), [30, -104], back); }
      if (flick > 0) { const f = Math.sin(clamp01(flick * 1.4) * Math.PI * 0.5); fh = L2p(fh, [50, -122], f); }
      if (walk && !sealW && !sRel && !flick) { fh = [30 + ws * 6, -104]; }
      bh = walk ? [-24 - ws * 8, -104] : bh;
      function L2p(a, b, k) { return [lerp(a[0], b[0], k), lerp(a[1], b[1], k)]; }
      function arm(s, h, near) {
        const k = ik(s[0], s[1], h[0], h[1], 34, 32, 0, 1);
        const col = near ? '#3a3448' : '#2a2638';
        eLimb(ctx, s[0], s[1], (s[0] + k[0]) / 2, (s[1] + k[1]) / 2, k[0], k[1], 13, col);
        eLimb(ctx, k[0], k[1], (k[0] + k[2]) / 2, (k[1] + k[3]) / 2, k[2], k[3], 11, col);
        // envelope patches stuck on the sleeve
        env(lerp(s[0], k[0], 0.55), lerp(s[1], k[1], 0.55), 12, 9, Math.atan2(k[1] - s[1], k[0] - s[0]) + 0.3, near ? PALE : '#8a8478', 0, near ? 0.25 : 0.5, 1.4);
        if (near) env(lerp(k[0], k[2], 0.5), lerp(k[1], k[3], 0.5), 11, 8, Math.atan2(k[3] - k[1], k[2] - k[0]) - 0.2, PINK, 0, 0.2, 1.4);
        // cuff + folded-paper mitten
        ctx.save(); ctx.translate(k[2], k[3]); ctx.rotate(Math.atan2(k[3] - k[1], k[2] - k[0]));
        ctx.beginPath(); ctx.moveTo(-3, -7); ctx.lineTo(8, -6); ctx.lineTo(12, -1); ctx.lineTo(9, 6); ctx.lineTo(-3, 7); ctx.closePath();
        fo(ctx, near ? '#bdb4a2' : '#8c8476', 1.8, EINK);
        ctx.strokeStyle = 'rgba(40,30,50,.45)'; ctx.lineWidth = 0.9; ctx.beginPath(); ctx.moveTo(2, -6.5); ctx.lineTo(6, 6.5); ctx.moveTo(8, -6); ctx.lineTo(9, 6); ctx.stroke();
        ctx.restore();
        if (near) { ctx.strokeStyle = RIM; ctx.lineWidth = 1.1; ctx.beginPath(); ctx.moveTo(s[0], s[1] - 6); ctx.quadraticCurveTo((s[0] + k[0]) / 2, (s[1] + k[1]) / 2 - 6, k[0], k[1] - 5); ctx.stroke(); }
        return k;
      }
      // ---- legs: stiff rolled-paper legs, worn boots ----
      function leg(hx, fx, lift, near) {
        const hy = -66, fy = -9 - lift;
        const k = ik(hx, hy, fx, fy, 32, 30, 1, 0);
        const col = near ? '#3a3448' : '#2a2638';
        eLimb(ctx, hx, hy, (hx + k[0]) / 2, (hy + k[1]) / 2, k[0], k[1], 14, col);
        eLimb(ctx, k[0], k[1], (k[0] + k[2]) / 2, (k[1] + k[3]) / 2, k[2], k[3], 12, col);
        ctx.strokeStyle = 'rgba(190,180,210,.22)'; ctx.lineWidth = 1; ctx.beginPath();
        for (let i = 1; i < 4; i++) { const p = L2p([k[0], k[1]], [k[2], k[3]], i / 4); ctx.moveTo(p[0] - 5, p[1] - 1); ctx.lineTo(p[0] + 5, p[1] + 1); } ctx.stroke();
        const ax = k[2], ay = k[3];
        ctx.beginPath(); ctx.moveTo(ax - 9, ay - 5); ctx.lineTo(ax + 6, ay - 6); ctx.quadraticCurveTo(ax + 18, ay - 1, ax + 19, ay + 6); ctx.lineTo(ax + 19, ay + 9); ctx.lineTo(ax - 10, ay + 9); ctx.closePath();
        fo(ctx, near ? '#2e2232' : '#201828', 2.6, EINK);
        ctx.strokeStyle = 'rgba(220,210,200,.3)'; ctx.lineWidth = 1.3; ctx.beginPath(); ctx.moveTo(ax - 4, ay + 1); ctx.lineTo(ax + 12, ay); ctx.stroke();
      }
      arm(sB, bh, false);
      leg(-10, -10 - ws * 16, walk ? Math.max(0, -Math.cos(ph)) * 8 : 0, false);
      leg(10, 12 + ws * 16, walk ? Math.max(0, Math.cos(ph)) * 8 : 0, true);

      // ---- strap (behind the heap, crossing to the satchel) ----
      ctx.strokeStyle = EINK; ctx.lineWidth = 8; ctx.beginPath(); ctx.moveTo(-20, -164); ctx.lineTo(26, -102); ctx.stroke();
      ctx.strokeStyle = '#5a3c38'; ctx.lineWidth = 5; ctx.stroke();

      // ---- the envelope body ----
      const wid = P2 ? 0.8 : 1;
      const silh = () => {
        ctx.beginPath(); ctx.moveTo(-40 * wid, -56);
        ctx.bezierCurveTo(-46 * wid, -96, -40 * wid, -140, -30 * wid, -166);
        ctx.quadraticCurveTo(0, -178, 30 * wid, -166);
        ctx.bezierCurveTo(42 * wid, -140, 46 * wid, -96, 42 * wid, -56);
        ctx.quadraticCurveTo(0, -48, -40 * wid, -56); ctx.closePath();
      };
      silh(); ctx.fillStyle = '#140c22'; ctx.fill(); ctx.strokeStyle = EINK; ctx.lineWidth = 2.6; ctx.stroke();
      if (P2) { ctx.globalCompositeOperation = 'lighter'; sglow(ctx, 2, -112, 44, '190,130,255', 0.4 + Math.sin(t * 2) * 0.08); ctx.globalCompositeOperation = 'source-over'; }
      // rows of overlapping envelopes, bottom (darkest) to top
      let n = 0;
      for (let row = 0; row < 8; row++) {
        const y = -62 - row * 14.5, half = (row < 5 ? 40 - row * 0.6 : 38 - (row - 4) * 3) * wid;
        const cnt = row % 2 ? 3 : 4;
        for (let c = 0; c < cnt; c++) {
          const r1 = rnd(), r2 = rnd(), r3 = rnd(), r4 = rnd();
          n++;
          let x = -half + (c + 0.5) * (2 * half / cnt) + (r1 - 0.5) * 8, yy = y + (r2 - 0.5) * 6;
          let rot = (r3 - 0.5) * 0.6;
          const ew = 24 + r4 * 10, eh = 16 + r2 * 6;
          const kind = n % 5 === 0 ? 2 : (n % 3 === 0 ? 1 : 0);
          let dark = clamp01(0.62 - row * 0.09);
          if (P2 && n % 3 === 1) {
            // peeling: hinged away from the edge, half lifted
            const pl = 0.5 + Math.sin(t * 2.2 + n) * 0.25, side = x < 0 ? -1 : 1;
            x += side * 10 * pl; yy -= 6 * pl; rot += side * -0.6 * pl;
            if (n % 2) continue;                                            // and some are simply gone
          }
          env(x, yy, ew, eh, rot, PAL[(n * 3) % PAL.length], kind, dark, 1.8);
        }
      }
      // envelopes jutting out of the silhouette (a collar at the shoulders, a ragged coat hem);
      // in phase 2 they have come loose and hang by a corner, swinging
      const jut = [[-44, -150, -0.9, 0], [42, -146, 0.8, 1], [-48, -94, -0.5, 2], [48, -82, 0.6, 3], [-30, -172, -0.45, 4], [28, -174, 0.5, 5], [-30, -54, 0.2, 6], [26, -52, -0.25, 0]];
      for (const j of jut) {
        const sw = P2 ? Math.sin(t * 2.4 + j[3]) * 0.35 + (j[0] < 0 ? -0.7 : 0.7) : 0;
        env(j[0] * wid + (P2 ? (j[0] < 0 ? -8 : 8) : 0), j[1] + (P2 ? 6 : 0), 22, 15, j[2] + sw, PAL[j[3]], j[3] % 3 === 1 ? 1 : 0, clamp01(0.5 + (j[1] + 100) / 140), 1.8);
      }
      if (P2) {
        // long strips of letter paper unrolling off the body and trailing back
        for (let i = 0; i < 3; i++) {
          const x0 = -30 * wid, y0 = -150 + i * 34;
          ctx.beginPath();
          const pts = [];
          for (let k2 = 0; k2 <= 8; k2++) { const s2 = k2 / 8; pts.push([x0 - s2 * (60 + i * 16), y0 - s2 * 30 + Math.sin(t * 3 + i * 2 + s2 * 5) * 8 * s2]); }
          ctx.moveTo(pts[0][0], pts[0][1] - 4); for (const p of pts) ctx.lineTo(p[0], p[1] - 4 + (p[0] - x0) * -0.02);
          for (let k2 = pts.length - 1; k2 >= 0; k2--) ctx.lineTo(pts[k2][0], pts[k2][1] + 4);
          ctx.closePath(); ctx.fillStyle = PAL[i + 2]; ctx.fill(); ctx.strokeStyle = EINK; ctx.lineWidth = 1.5; ctx.stroke();
          ctx.strokeStyle = 'rgba(40,30,60,.45)'; ctx.lineWidth = 0.8; ctx.beginPath();
          for (let k2 = 1; k2 < 7; k2 += 2) { ctx.moveTo(pts[k2][0], pts[k2][1]); ctx.lineTo(pts[k2 + 1][0], pts[k2 + 1][1]); } ctx.stroke();
        }
      }
      // violet rim down the back edge
      ctx.strokeStyle = RIM; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(-31 * wid, -164); ctx.bezierCurveTo(-41 * wid, -140, -47 * wid, -96, -41 * wid, -60); ctx.stroke();
      // ink drips from the hem
      ctx.fillStyle = PINKK;
      for (let i = 0; i < 5; i++) { const x = -32 + i * 16, l = 5 + (Math.sin(t * 1.2 + i * 2) + 1) * (P2 ? 7 : 5); rr(ctx, x, -56, 3, l, 1.5); ctx.fill(); circ(ctx, x + 1.5, -56 + l, 2.3); ctx.fill(); }

      // ---- head: a knot of envelopes with a dark gap where the eyes glow ----
      const hc = [6, -192 + Math.sin(t * 1.5 + 0.4) * 1];
      circ(ctx, hc[0], hc[1], 22); ctx.fillStyle = '#100a1c'; ctx.fill(); ctx.strokeStyle = EINK; ctx.lineWidth = 2.4; ctx.stroke();
      env(hc[0] - 12, hc[1] - 4, 26, 18, -0.5, BLUE, 0, 0.3, 1.8);
      env(hc[0] - 6, hc[1] + 12, 28, 16, 0.18, PINK, 0, 0.35, 1.8);
      env(hc[0] + 14, hc[1] + 12, 20, 14, -0.3, PALE, 2, 0.3, 1.8);
      // the gap
      ctx.beginPath(); ctx.moveTo(hc[0] - 2, hc[1] - 2); ctx.quadraticCurveTo(hc[0] + 12, hc[1] - 7, hc[0] + 27, hc[1] - 2); ctx.quadraticCurveTo(hc[0] + 14, hc[1] + 6, hc[0] - 2, hc[1] + 3); ctx.closePath();
      ctx.fillStyle = '#06030c'; ctx.fill();
      ctx.globalCompositeOperation = 'lighter';
      sglow(ctx, hc[0] + 14, hc[1], 24 + w * 10, '255,170,236', (0.55 + w * 0.3 + (P2 ? 0.15 : 0)));
      ctx.globalCompositeOperation = 'source-over';
      const bl = eBlink(t + 0.4, 3.7);
      eEye(ctx, hc[0] + 8, hc[1] + 0.2, 2.6, 1.7 * bl, -0.1); eEye(ctx, hc[0] + 19, hc[1] - 0.2, 2.3, 1.6 * bl, 0.1);
      env(hc[0] + 10, hc[1] - 13, 30, 15, 0.12, CREAM, 1, 0.12, 1.8);
      // ink tear running from the gap
      const tl = 4 + (Math.sin(t * 0.85) + 1) * 4;
      ctx.fillStyle = '#0a0614'; rr(ctx, hc[0] + 7, hc[1] + 3, 2.2, tl, 1.1); ctx.fill(); circ(ctx, hc[0] + 8.1, hc[1] + 3 + tl, 1.7); ctx.fill();
      // ---- postman's cap (crown, band, visor forward, a small envelope badge) ----
      const cy = hc[1] - 18;
      ctx.beginPath(); ctx.moveTo(hc[0] - 22, cy + 2); ctx.bezierCurveTo(hc[0] - 30, cy - 16, hc[0] + 30, cy - 22, hc[0] + 26, cy - 2); ctx.lineTo(hc[0] + 22, cy + 3); ctx.closePath();
      fo(ctx, '#34304a', 2.6, EINK);
      ctx.strokeStyle = 'rgba(220,210,240,.2)'; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(hc[0] - 16, cy - 8); ctx.quadraticCurveTo(hc[0], cy - 16, hc[0] + 18, cy - 11); ctx.stroke();
      ctx.beginPath(); rr(ctx, hc[0] - 22, cy - 1, 44, 8, 2); fo(ctx, '#262238', 2.2, EINK);
      ctx.beginPath(); ctx.moveTo(hc[0] + 16, cy + 6); ctx.quadraticCurveTo(hc[0] + 32, cy + 4, hc[0] + 40, cy + 10); ctx.quadraticCurveTo(hc[0] + 30, cy + 12, hc[0] + 16, cy + 10); ctx.closePath();
      fo(ctx, '#1c1828', 2.2, EINK);
      ctx.save(); ctx.translate(hc[0] + 14, cy - 6); ctx.beginPath(); ctx.rect(-5, -3.4, 10, 6.8); fo(ctx, '#a8946a', 1.2, EINK);
      ctx.strokeStyle = 'rgba(40,30,20,.7)'; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.moveTo(-5, -3.4); ctx.lineTo(0, 0.6); ctx.lineTo(5, -3.4); ctx.stroke(); ctx.restore();

      // ---- satchel overflowing with letters ----
      const bx = 24, by = -104;
      env(bx - 8, by - 20, 22, 15, -0.35, PALE, 1, 0.1, 1.6);
      env(bx + 6, by - 22, 20, 14, 0.25, PINK, 0, 0.1, 1.6);
      env(bx + 16, by - 16, 18, 12, 0.6, BLUE, 2, 0.15, 1.6);
      ctx.beginPath(); rr(ctx, bx - 20, by - 14, 44, 36, [4, 4, 10, 10]);
      ctx.fillStyle = lgc(ctx, 'pm-bag', 0, by - 14, 0, by + 22, [[0, '#6a4a42'], [1, '#3a2630']]); ctx.fill(); ctx.strokeStyle = EINK; ctx.lineWidth = 2.6; ctx.stroke();
      ctx.strokeStyle = 'rgba(230,200,180,.25)'; ctx.lineWidth = 1; ctx.save(); ctx.setLineDash([2, 2]); rr(ctx, bx - 17, by - 11, 38, 30, 3); ctx.stroke(); ctx.restore();
      ctx.beginPath(); ctx.moveTo(bx - 21, by - 15); ctx.lineTo(bx + 25, by - 15); ctx.lineTo(bx + 24, by + 2); ctx.quadraticCurveTo(bx + 2, by + 8, bx - 20, by + 2); ctx.closePath();
      fo(ctx, '#5a3c38', 2.4, EINK);
      ctx.beginPath(); rr(ctx, bx, by - 2, 7, 9, 1.5); fo(ctx, '#a08a62', 1.6, EINK);
      ctx.fillStyle = 'rgba(14,6,26,.4)'; ell(ctx, bx - 6, by + 16, 10, 4); ctx.fill();
      // a letter slipping out of the side
      env(bx + 26, by + 4 + Math.sin(t * 1.7) * 1.5, 16, 11, 1.1 + Math.sin(t * 1.7) * 0.06, CREAM, 0, 0.15, 1.6);

      // letters held / thrown
      const k = arm(sF, fh, true);
      if (reach > 0.4 || raise > 0) {
        // a loose fan of three letters in the raised hand
        for (let i = 0; i < 3; i++) {
          const a = Math.atan2(k[3] - k[1], k[2] - k[0]) + (i - 1) * 0.42 * raise;
          env(k[2] + Math.cos(a) * 10, k[3] + Math.sin(a) * 10, 17, 11, a + Math.PI / 2, PAL[i + 1], i === 1 ? 1 : 0, 0.05, 1.6);
        }
        if (raise > 0.3) { ctx.globalCompositeOperation = 'lighter'; sglow(ctx, k[2], k[3] - 8, 30, '255,190,240', 0.3 * raise); ctx.globalCompositeOperation = 'source-over'; }
      }
      if (sRel) {
        // the fan leaves the hand in a loose forward arc
        for (let i = 0; i < 3; i++) {
          const a = -0.3 + i * 0.26 + Math.sin(i * 2.1) * 0.05, d = 14 + sp * (110 + i * 14);
          const x = k[2] + Math.cos(a) * d, y = k[3] - 6 + Math.sin(a) * d + sp * sp * 20 + (i - 1) * 4;
          const al = 1 - clamp01((sp - 0.75) / 0.25);
          const pa = ctx.globalAlpha; ctx.globalAlpha = pa * al;
          ctx.globalCompositeOperation = 'lighter'; sglow(ctx, x, y, 16, '255,180,236', 0.35); ctx.globalCompositeOperation = 'source-over';
          env(x, y, 17, 11, a + Math.sin(sp * 9 + i) * 0.4, PAL[i + 1], i === 1 ? 1 : 0, 0, 1.6);
          ctx.globalAlpha = pa;
        }
      }
      if (flick > 0) {
        const fp = 1 - flick, x = k[2] + 8 + fp * 60, y = k[3] - 4 - fp * 6;
        flyer(x, y, 1.1, Math.sin(fp * 10) * 0.4, Math.cos(fp * 14), CREAM, 1 - fp * 0.6);
      }
      ctx.restore();
      orbit(true);
      // ink motes rising
      ctx.fillStyle = 'rgba(200,140,255,.7)';
      for (let i = 0; i < 5; i++) { const p = (t * 0.32 + i / 5) % 1, mx = -44 + i * 22 + Math.sin(t + i) * 8; ctx.fillRect(mx, -24 - p * 210, 2.4, 2.4); }
    },

    // ---------------- 飛行型「漂う手紙」 (the game lifts it) ----------------
    // A small faded envelope whose flap opens and shuts like a mouth/wing, two paper wings, and one
    // glowing dot of an eye peeking out of the dark inside.
    letter(ctx, u) {
      const t = u.anim + (u.id || 0) * 0.61, at = u.atk || 0, dive = ease(at);
      const k = Math.sin(t * (u.walk ? 9 : 7));
      ctx.save(); ctx.translate(0, -20 + k * 1.5 * (1 - dive)); ctx.rotate(dive * 0.5 + Math.sin(t * 2.3) * 0.06);
      // paper wings (folded triangles at the top corners)
      function wing(s, col) {
        // swept-back folded paper wing; s = -1 far, 1 near
        const lift = 8 + 10 * k, ox = s < 0 ? 2 : -1;
        ctx.beginPath(); ctx.moveTo(ox + 5, -6);
        ctx.lineTo(ox - 15, -8 - lift); ctx.lineTo(ox - 9, -6 - lift * 0.35); ctx.lineTo(ox - 5, -5); ctx.closePath();
        eFill(ctx, col, 1.6);
        ctx.strokeStyle = 'rgba(40,24,60,.5)'; ctx.lineWidth = 0.7; ctx.beginPath(); ctx.moveTo(ox + 2, -6); ctx.lineTo(ox - 14, -8 - lift * 0.95); ctx.stroke();
      }
      wing(-1, '#6c6476');
      // body
      ctx.beginPath(); ctx.rect(-11, -7, 22, 14);
      eFill(ctx, lgc(ctx, 'let-body', 0, -7, 0, 8, [[0, '#b2a892'], [0.6, '#857c7c'], [1, '#3a3044']]), 1.9);
      // the dark inside, visible as the flap lifts
      const open = clamp01(0.45 + 0.55 * k);
      ctx.fillStyle = '#07040f'; ctx.beginPath(); ctx.moveTo(-10, -6); ctx.lineTo(10, -6); ctx.lineTo(0, -6 + 5 * open); ctx.closePath(); ctx.fill();
      eGlow(ctx, 3, -4, 9, 0.5 + dive * 0.4);
      const bl = eBlink(t + 0.9, 3.3);
      ctx.fillStyle = '#ffd8f6'; circ(ctx, 2.6, -4.2 + open, 1.5 * bl); ctx.fill();
      // flap (folds down over the face → flips up)
      const fy = lerp(6, -9, open);
      ctx.beginPath(); ctx.moveTo(-11, -7); ctx.lineTo(0, -7 + fy); ctx.lineTo(11, -7); ctx.closePath();
      eFill(ctx, open > 0.55 ? '#5a5264' : '#a39a88', 1.5);
      // lower fold lines + a smudged scribble, ink drip
      ctx.strokeStyle = 'rgba(30,20,40,.55)'; ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.moveTo(-11, 7); ctx.lineTo(-3, 1); ctx.moveTo(11, 7); ctx.lineTo(3, 1); ctx.stroke();
      ctx.fillStyle = '#0c0614'; const dl = 2 + (Math.sin(t * 1.4) + 1) * 1.8; rr(ctx, -6, 7, 1.8, dl, 0.9); ctx.fill(); circ(ctx, -5.1, 7 + dl, 1.2); ctx.fill();
      wing(1, lgc(ctx, 'let-wing', 0, -24, 0, -4, [[0, '#a69c8a'], [1, '#5c5466']]));
      ctx.restore();
    },

    // ---------------- 飛行型「速達」 (must be shot down; the game lifts it) ----------------
    // A larger sealed envelope with a faded red diagonal band and a wax seal, folded paper wings like a
    // paper plane, and a faint glowing trail streaming behind it. No writing on it.
    express(ctx, u) {
      const t = u.anim + (u.id || 0) * 0.47, at = u.atk || 0, dive = ease(at);
      const bob = Math.sin(t * 5) * 1.6, pitch = Math.sin(t * 2.6) * 0.05 + dive * 0.35;
      // trail (three soft streaks fading backwards, parallel — not a burst)
      ctx.globalCompositeOperation = 'lighter';
      ctx.save(); ctx.translate(-30, -22 + bob * 0.5); ctx.scale(1.8, 0.55); sglow(ctx, -14, 0, 26, '230,150,255', 0.35 + dive * 0.2); ctx.restore();
      ctx.lineCap = 'round';
      for (let i = 0; i < 3; i++) {
        const y = -28 + i * 7 + bob * 0.6, x0 = -28, len = 34 + i * 8 + Math.sin(t * 9 + i) * 5;
        for (let j = 0; j < 4; j++) {
          ctx.strokeStyle = `rgba(240,200,255,${(0.32 * (1 - j / 4)).toFixed(3)})`; ctx.lineWidth = 2.6 - j * 0.5;
          ctx.beginPath(); ctx.moveTo(x0 - len * j / 4, y + Math.sin(t * 6 + i + j) * 1.2); ctx.lineTo(x0 - len * (j + 1) / 4, y + Math.sin(t * 6 + i + j + 1) * 1.2); ctx.stroke();
        }
      }
      ctx.lineCap = 'butt';
      ctx.globalCompositeOperation = 'source-over';
      ctx.save(); ctx.translate(0, -22 + bob); ctx.rotate(pitch);
      const flap = Math.sin(t * 8) * 0.5 + 0.5;
      // far wing (folded paper, peeks above the body)
      ctx.beginPath(); ctx.moveTo(-14, -12); ctx.lineTo(-30, -26 - flap * 6); ctx.lineTo(8, -12); ctx.closePath();
      eFill(ctx, '#5e5668', 1.8);
      // body: sealed envelope
      ctx.beginPath(); ctx.moveTo(-26, -14); ctx.lineTo(24, -14); ctx.lineTo(30, 0); ctx.lineTo(24, 14); ctx.lineTo(-26, 14); ctx.closePath();
      eFill(ctx, lgc(ctx, 'exp-body', 0, -14, 0, 15, [[0, '#bcb29c'], [0.55, '#8c8282'], [1, '#3c3246']]), 2.2);
      ctx.save(); ctx.clip();
      // red diagonal band
      ctx.beginPath(); ctx.moveTo(-10, -16); ctx.lineTo(2, -16); ctx.lineTo(-8, 16); ctx.lineTo(-20, 16); ctx.closePath(); ctx.fillStyle = '#a2464c'; ctx.fill();
      ctx.beginPath(); ctx.moveTo(6, -16); ctx.lineTo(10, -16); ctx.lineTo(0, 16); ctx.lineTo(-4, 16); ctx.closePath(); ctx.fillStyle = '#a2464c'; ctx.fill();
      // flap fold + shading
      ctx.strokeStyle = 'rgba(30,20,40,.55)'; ctx.lineWidth = 1.1;
      ctx.beginPath(); ctx.moveTo(-26, -14); ctx.lineTo(4, 3); ctx.lineTo(24, -14); ctx.moveTo(-26, 14); ctx.lineTo(-8, 2); ctx.stroke();
      ctx.fillStyle = 'rgba(14,6,26,.35)'; ctx.fillRect(-30, 6, 64, 10);
      ctx.restore();
      // wax seal on the flap point
      circ(ctx, 4, 3, 6.2); fo(ctx, '#7a1e2a', 2, EINK);
      ctx.strokeStyle = 'rgba(255,180,180,.35)'; ctx.lineWidth = 1; circ(ctx, 4, 3, 3.6); ctx.stroke();
      ctx.fillStyle = '#7a1e2a'; ell(ctx, 1, 9, 2, 2.6, 0.3); ctx.fill();
      ctx.fillStyle = 'rgba(255,210,210,.45)'; circ(ctx, 2.2, 1.2, 1.2); ctx.fill();
      // eye glinting out of the nose seam
      eGlow(ctx, 23, -2, 12, 0.55 + dive * 0.4);
      ctx.fillStyle = '#07040f'; ctx.beginPath(); ctx.moveTo(17, -4.5); ctx.quadraticCurveTo(23, -6.5, 28, -1.5); ctx.quadraticCurveTo(22, 0, 17, -1.5); ctx.closePath(); ctx.fill();
      const bl = eBlink(t + 0.2, 3.1);
      eEye(ctx, 22.5, -2.8, 2.6, 1.2 * bl, 0.15);
      // near wing (folded paper-plane wing with a crease)
      ctx.beginPath(); ctx.moveTo(-18, 0); ctx.lineTo(-38, -18 - flap * 10); ctx.lineTo(-22, -8 - flap * 4); ctx.lineTo(10, -2); ctx.closePath();
      eFill(ctx, lgc(ctx, 'exp-wing', 0, -26, 0, 0, [[0, '#c4bba6'], [1, '#6e6676']]), 1.9);
      ctx.strokeStyle = 'rgba(40,24,60,.55)'; ctx.lineWidth = 0.9; ctx.beginPath(); ctx.moveTo(-20, -1); ctx.lineTo(-36, -17 - flap * 10); ctx.stroke();
      // ink drip
      ctx.fillStyle = '#0c0614'; const dl = 3 + (Math.sin(t * 1.3) + 1) * 2.4; rr(ctx, -16, 14, 2.2, dl, 1.1); ctx.fill(); circ(ctx, -14.9, 14 + dl, 1.5); ctx.fill();
      ctx.restore();
    },
  };

  const SIZE = { swordsman: 1.25, guardian: 1.3, archer: 1.25, mage: 1.25, healer: 1.25, spearman: 1.25, icemage: 1.25, bard: 1.25, golem: 1.35, shade: 1.3, runner: 1.25, armor: 1.36, boss: 1.12,
    swarm: 1.05, spitter: 1.25, charger: 1.3, bomber: 1.25, mender: 1.25, bell: 1.25, flyer: 1.2, weaver: 1.3,
    hunter: 1.25, sniper: 1.25, thunder: 1.25, ninja: 1.25,
    paladin: 1.38, pyro: 1.25, engineer: 1.25, berserker: 1.34, gunner: 1.25, crossbow: 1.25, dollmaster: 1.18, doll: 0.8, turret: 1.05,
    snowman: 1.04, snowlet: 1.1, friend: 1.05, friendkid: 1.05, astro: 1.06, wheel: 1.0, batter: 1.1, siren: 1.1, throne: 1.08, clock: 1.06,
    whale: 1.0, devourer: 1.05,
    witch: 1.08, toy: 1, dancer: 1.06, postman: 1.06, letter: 1, express: 1 };
  const SHADOW = { swordsman: 14, guardian: 17, archer: 14, mage: 15, healer: 14, spearman: 14, icemage: 15, bard: 14, golem: 24, shade: 15, runner: 20, armor: 21, boss: 0,
    swarm: 8, spitter: 15, charger: 26, bomber: 13, mender: 13, bell: 13, flyer: 16, weaver: 22,
    hunter: 14, sniper: 15, thunder: 15, ninja: 14,
    paladin: 18, pyro: 14, engineer: 15, berserker: 18, gunner: 14, crossbow: 15, dollmaster: 15, doll: 13, turret: 15,
    snowman: 0, snowlet: 14, friend: 0, friendkid: 13, astro: 0, wheel: 0, batter: 0, siren: 0, throne: 0, clock: 0,
    whale: 0, devourer: 0,
    witch: 0, toy: 11, dancer: 0, postman: 0, letter: 10, express: 18 };

  // local-space bounds per kind (before SIZE scale) for the hurt-flash offscreen pass
  const BOUNDS = {
    swordsman: [-34, -84, 48, 6], guardian: [-30, -78, 36, 6], archer: [-30, -76, 40, 6], mage: [-30, -94, 36, 6], healer: [-28, -84, 30, 6],
    spearman: [-40, -72, 78, 6], icemage: [-32, -82, 36, 6], bard: [-30, -94, 46, 6], golem: [-52, -104, 72, 6],
    shade: [-36, -66, 40, 6], runner: [-80, -46, 34, 6], armor: [-34, -112, 54, 6], boss: [-150, -262, 150, 14],
    swarm: [-22, -36, 18, 4], spitter: [-26, -74, 48, 6], charger: [-98, -80, 56, 6], bomber: [-28, -66, 30, 6],
    mender: [-34, -72, 60, 6], bell: [-28, -82, 54, 6], flyer: [-50, -56, 44, 4], weaver: [-44, -100, 52, 6],
    hunter: [-32, -84, 32, 6], sniper: [-34, -80, 64, 6], thunder: [-32, -86, 44, 6], ninja: [-44, -72, 44, 6],
    paladin: [-36, -82, 54, 6], pyro: [-26, -70, 30, 6], engineer: [-26, -66, 40, 6], berserker: [-28, -86, 56, 6], gunner: [-24, -70, 46, 6],
    crossbow: [-26, -78, 56, 6], dollmaster: [-28, -76, 32, 6], doll: [-24, -48, 34, 4], turret: [-20, -36, 40, 4],
    snowman: [-142, -284, 146, 18], snowlet: [-32, -68, 40, 6], friend: [-82, -236, 168, 12], friendkid: [-30, -88, 62, 6], astro: [-156, -272, 150, 16], wheel: [-168, -340, 168, 18],
    batter: [-162, -282, 180, 16], siren: [-146, -272, 146, 18], throne: [-188, -334, 228, 18], clock: [-150, -300, 204, 20],
    whale: [-262, -410, 340, 108], devourer: [-256, -514, 652, 40],
    witch: [-140, -324, 196, 14], toy: [-26, -64, 22, 4], dancer: [-196, -268, 146, 18], postman: [-172, -296, 200, 14], letter: [-26, -60, 20, 4], express: [-110, -72, 42, 6],
  };
  // enemy aura centre / radius (local), and elite marker height
  const AURA = { runner: [-16, 34], armor: [-32, 46], swarm: [-13, 16], charger: [-26, 44], bomber: [-24, 30], flyer: [-20, 36], weaver: [-44, 46], bell: [-36, 36], mender: [-32, 36], snowlet: [-22, 26], friendkid: [-30, 30], letter: [-20, 22], express: [-22, 40] };
  const TALL = { swarm: 28, runner: 30, charger: 50, bomber: 44, flyer: 30, armor: 96, weaver: 78, snowlet: 50, friendkid: 76, letter: 34, express: 36 };
  let flashCv = null, flashCtx = null;
  function drawFlashed(ctx, kind, u, img, hurt) {
    const b = BOUNDS[kind] || [-40, -90, 40, 6];
    const m = ctx.getTransform();
    const D = Math.min(4, Math.hypot(m.a, m.b) || 1);
    const w = Math.ceil((b[2] - b[0]) * D) + 2, h = Math.ceil((b[3] - b[1]) * D) + 2;
    if (!flashCv) { flashCv = mkCanvas(256, 256); flashCtx = flashCv.getContext('2d'); }
    if (flashCv.width < w || flashCv.height < h) { flashCv.width = Math.max(flashCv.width, w); flashCv.height = Math.max(flashCv.height, h); flashCtx = flashCv.getContext('2d'); }
    const o = flashCtx;
    o.setTransform(1, 0, 0, 1, 0, 0); o.globalAlpha = 1; o.globalCompositeOperation = 'source-over';
    o.clearRect(0, 0, w, h);
    o.setTransform(D, 0, 0, D, -b[0] * D, -b[1] * D);
    o.lineJoin = 'round';
    if (img && img.ready) o.drawImage(img.el, -img.w * img.ax, -img.h * img.ay, img.w, img.h); else DRAW[kind](o, u);
    o.setTransform(1, 0, 0, 1, 0, 0); o.globalAlpha = 1;
    o.globalCompositeOperation = 'source-atop';
    o.fillStyle = `rgba(255,255,255,${Math.min(0.85, hurt * 0.8).toFixed(3)})`; o.fillRect(0, 0, w, h);
    o.globalCompositeOperation = 'source-over';
    ctx.drawImage(flashCv, 0, 0, w, h, b[0], b[1], w / D, h / D);
  }

  const BIG = { boss: 1, snowman: 1, friend: 1, astro: 1, wheel: 1, batter: 1, siren: 1, throne: 1, clock: 1, whale: 1, devourer: 1, witch: 1, dancer: 1, postman: 1 };
  function drawUnit(ctx, kind, x, y, dir, u, opts) {
    opts = opts || {};
    const s = (opts.scale || 1) * (SIZE[kind] || 1);
    const isEnemy = !!opts.enemy;
    ctx.save();
    ctx.translate(x, y);
    if (opts.alpha != null) ctx.globalAlpha = opts.alpha;
    // ground shadow
    if (!opts.noShadow && kind !== 'boss') { ctx.fillStyle = 'rgba(0,0,14,.42)'; ell(ctx, 0, 0, (SHADOW[kind] || 15) * s, 3.8 * s); ctx.fill(); }
    if (kind === 'boss' && !opts.noShadow) { ctx.fillStyle = 'rgba(0,0,12,.4)'; ell(ctx, 0, 0, 74 * s, 12 * s); ctx.fill(); }
    ctx.scale(dir * s, s);
    const lunge = u.atk > 0 ? Math.sin((1 - u.atk) * Math.PI) * (BIG[kind] ? 10 : 5) : 0;
    ctx.translate(lunge, 0);
    // hurt squash
    if (u.hurt > 0) { const q = u.hurt * 0.07; ctx.scale(1 + q, 1 - q); }
    // aura: allies get a soft dream-blue halo, nightmares a violet one (cached sprite)
    RIM = RIM_BASE;
    const elite = isEnemy && !!opts.elite && !BIG[kind];
    if (!opts.noAura && !BIG[kind]) {
      ctx.globalCompositeOperation = 'lighter';
      const au = AURA[kind] || [-32, 34];
      if (elite) {
        // elite: gold-violet aura + one gold underglow at the feet (one extra cached glow)
        sglow(ctx, 0, au[0], au[1] * 1.12, '215,120,235', 0.36);
        ctx.save(); ctx.translate(0, kind === 'flyer' ? -6 : 0); ctx.scale(1, 0.3); sglow(ctx, 0, -2, au[1] * 0.95 + 6, '255,200,110', 0.42); ctx.restore();
      } else if (isEnemy) sglow(ctx, 0, au[0], au[1], '170,80,230', 0.32);
      else sglow(ctx, 0, -32, 36, '143,214,255', 0.26);
      ctx.globalCompositeOperation = 'source-over';
    }
    let ringFront = null;
    if (elite) {
      // gold underline arc at the feet + two thin gold rings orbiting the body
      const tt = u.anim || 0, H = TALL[kind] || 64, W = (SHADOW[kind] || 15) + 5;
      const oy = kind === 'flyer' ? -20 : -H * 0.55, orx = W * 0.95 + 4, ory = 4 + W * 0.12, fy = kind === 'flyer' ? -6 : 0.5;
      ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(255,214,140,.85)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.ellipse(0, fy, W, W * 0.24, 0, 0.18, Math.PI - 0.18); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,236,190,.5)'; ctx.lineWidth = 0.9;
      ctx.beginPath(); ctx.ellipse(0, fy, W + 4, W * 0.24 + 1.4, 0, 0.5, Math.PI - 0.5); ctx.stroke();
      ctx.lineCap = 'butt';
      const ring = (k, front) => {
        const a = tt * 1.8 + k * Math.PI, sn = Math.sin(a);
        if ((sn > 0) !== front) return;
        const rx = Math.cos(a) * orx, ry = oy + sn * ory + Math.sin(tt * 2.4 + k) * 1.5;
        const sz = 2.6 + sn * 0.5;
        ctx.strokeStyle = EINK; ctx.lineWidth = 2.4; ell(ctx, rx, ry, sz, sz * 0.62); ctx.stroke();
        ctx.strokeStyle = front ? '#ffd890' : 'rgba(230,180,110,.75)'; ctx.lineWidth = 1.2; ell(ctx, rx, ry, sz, sz * 0.62); ctx.stroke();
      };
      ring(0, false); ring(1, false);
      ringFront = () => { ring(0, true); ring(1, true); };
      RIM = RIM_ELITE;
    }
    ctx.lineJoin = 'round';
    const img = images[kind];
    if (u.hurt > 0.02 && !opts.noFlash) {
      // hurt flash: draw once into a shared offscreen, tint white with source-atop (no ctx.filter)
      drawFlashed(ctx, kind, u, img, u.hurt);
    } else if (img && img.ready) {
      ctx.drawImage(img.el, -img.w * img.ax, -img.h * img.ay, img.w, img.h);
    } else {
      DRAW[kind](ctx, u);
    }
    if (elite) { RIM = RIM_BASE; ringFront(); }
    ctx.restore();
  }

  // card portrait
  const CARD_THEME = {
    swordsman: { glow: '255,170,90', ring: 'rgba(255,200,140,.28)', floor: '255,190,120' },
    guardian: { glow: '110,225,215', ring: 'rgba(160,240,235,.26)', floor: '140,230,220' },
    archer: { glow: '140,230,150', ring: 'rgba(180,245,180,.26)', floor: '160,235,170' },
    mage: { glow: '170,130,255', ring: 'rgba(255,190,140,.28)', floor: '255,160,110' },
    healer: { glow: '255,228,160', ring: 'rgba(255,235,180,.32)', floor: '200,255,215' },
    spearman: { glow: '235,110,90', ring: 'rgba(240,200,130,.3)', floor: '240,170,110' },
    icemage: { glow: '120,220,255', ring: 'rgba(190,240,255,.32)', floor: '160,230,255' },
    bard: { glow: '90,215,190', ring: 'rgba(240,210,120,.3)', floor: '250,215,130' },
    golem: { glow: '140,200,170', ring: 'rgba(170,240,255,.26)', floor: '150,230,200' },
    hunter: { glow: '175,225,110', ring: 'rgba(225,240,170,.28)', floor: '205,232,140' },
    sniper: { glow: '235,145,90', ring: 'rgba(240,195,140,.28)', floor: '238,165,110' },
    thunder: { glow: '255,214,90', ring: 'rgba(255,230,140,.32)', floor: '255,222,120' },
    ninja: { glow: '255,122,72', ring: 'rgba(255,175,125,.28)', floor: '255,145,95' },
    paladin: { glow: '255,226,160', ring: 'rgba(255,240,205,.32)', floor: '250,228,180' },
    pyro: { glow: '255,110,70', ring: 'rgba(255,190,140,.3)', floor: '255,150,100' },
    engineer: { glow: '240,170,80', ring: 'rgba(250,210,140,.3)', floor: '240,185,110' },
    berserker: { glow: '235,95,70', ring: 'rgba(245,170,130,.28)', floor: '235,130,95' },
    gunner: { glow: '220,130,90', ring: 'rgba(240,200,150,.28)', floor: '230,160,115' },
    crossbow: { glow: '230,120,95', ring: 'rgba(245,215,160,.3)', floor: '235,170,120' },
    dollmaster: { glow: '255,180,150', ring: 'rgba(255,220,195,.3)', floor: '255,200,170' },
    doll: { glow: '255,205,170', ring: 'rgba(255,230,205,.3)', floor: '255,215,185' },
    turret: { glow: '240,195,100', ring: 'rgba(250,225,160,.3)', floor: '240,205,120' },
  };
  // cssSize: displayed size in stage px (defaults to the 112px battle card); drawing stays in 112-unit space
  function drawCardArt(canvas, kind, cssSize) {
    const dpr = Math.min(3, window.devicePixelRatio || 1) * 1.5 * ((cssSize || 112) / 112);
    canvas.width = 112 * dpr; canvas.height = 112 * dpr;
    const c = canvas.getContext('2d');
    c.scale(dpr, dpr);
    const th = CARD_THEME[kind] || { glow: '143,214,255', ring: 'rgba(143,214,255,.25)', floor: '143,214,255' };
    // base night gradient
    const bg = c.createLinearGradient(0, 0, 0, 112);
    bg.addColorStop(0, '#1d2a5e'); bg.addColorStop(0.6, '#121a42'); bg.addColorStop(1, '#080d24');
    c.fillStyle = bg; c.fillRect(0, 0, 112, 112);
    // themed light behind the character
    glow(c, 60, 46, 62, `rgba(${th.glow},A)`, 0.42);
    glow(c, 60, 40, 26, 'rgba(255,255,255,A)', 0.12);
    // geometric ring motif (shared with the lighthouse crest)
    c.save(); c.translate(60, 50);
    c.strokeStyle = th.ring; c.lineWidth = 1.2; circ(c, 0, 0, 40); c.stroke();
    c.lineWidth = 0.8; circ(c, 0, 0, 33); c.stroke();
    c.beginPath(); for (let i = 0; i < 24; i++) { const a = i * TAU / 24, r0 = i % 2 ? 35 : 34, r1 = i % 2 ? 38 : 40; c.moveTo(Math.cos(a) * r0, Math.sin(a) * r0); c.lineTo(Math.cos(a) * r1, Math.sin(a) * r1); } c.stroke();
    c.beginPath(); c.moveTo(0, -33); c.lineTo(33, 0); c.lineTo(0, 33); c.lineTo(-33, 0); c.closePath(); c.globalAlpha = 0.5; c.stroke(); c.globalAlpha = 1;
    c.restore();
    // sparkles
    const r = rng(kind.length * 31 + kind.charCodeAt(0));
    for (let i = 0; i < 16; i++) {
      const sx = 6 + r() * 100, sy = 8 + r() * 74, a = 0.3 + r() * 0.6, sz = r() < 0.2 ? 1.8 : 1;
      c.fillStyle = `rgba(230,245,255,${a.toFixed(2)})`; c.fillRect(sx, sy, sz, sz);
      if (sz > 1) { c.fillRect(sx - 1.5, sy + 0.4, 4.8, 0.8); c.fillRect(sx + 0.4, sy - 1.5, 0.8, 4.8); }
    }
    // floor glow
    c.save(); c.translate(60, 93); c.scale(1, 0.25);
    const fg = c.createRadialGradient(0, 0, 0, 0, 0, 44);
    fg.addColorStop(0, `rgba(${th.floor},.55)`); fg.addColorStop(1, `rgba(${th.floor},0)`);
    c.fillStyle = fg; c.fillRect(-44, -44, 88, 88); c.restore();
    // the character, posed
    const pose = {
      swordsman: { anim: 0.4, walk: false, atk: 0, hurt: 0, aim: 0, cool: 0.05 },
      guardian: { anim: 0.9, walk: false, atk: 0, hurt: 0, aim: 0 },
      archer: { anim: 0.3, walk: false, atk: 0, hurt: 0, aim: 1 },
      mage: { anim: 0.5, walk: false, atk: 0, hurt: 0, aim: 0, cool: 0.08 },
      healer: { anim: 0.2, walk: false, atk: 0.55, hurt: 0, aim: 0 },
      spearman: { anim: 0.6, walk: false, atk: 0, hurt: 0, aim: 0 },
      icemage: { anim: 0.7, walk: false, atk: 0, hurt: 0, aim: 0, cool: 0.12 },
      bard: { anim: 0.4, walk: false, atk: 0.62, hurt: 0, aim: 0 },
      golem: { anim: 0.5, walk: false, atk: 0, hurt: 0, aim: 0 },
      hunter: { anim: 0.3, walk: false, atk: 0, hurt: 0, aim: 1 },
      sniper: { anim: 0.5, walk: false, atk: 0, hurt: 0, aim: 0 },
      thunder: { anim: 0.5, walk: false, atk: 0, hurt: 0, aim: 0, cool: 0.1 },
      ninja: { anim: 0.4, walk: false, atk: 0, hurt: 0, aim: 0, cool: 0.06 },
      paladin: { anim: 0.6, walk: false, atk: 0, hurt: 0, aim: 0 },
      pyro: { anim: 0.5, walk: false, atk: 0, hurt: 0, aim: 0 },
      engineer: { anim: 0.4, walk: false, atk: 0, hurt: 0, aim: 0 },
      berserker: { anim: 0.5, walk: false, atk: 0, hurt: 0, aim: 0, frenzy: 0.35 },
      gunner: { anim: 0.4, walk: false, atk: 0, hurt: 0, aim: 1 },
      crossbow: { anim: 0.5, walk: false, atk: 0, hurt: 0, aim: 1 },
      dollmaster: { anim: 0.5, walk: false, atk: 0, hurt: 0, aim: 0 },
      doll: { anim: 0.7, walk: false, atk: 0, hurt: 0, aim: 0 },
      turret: { anim: 0.3, walk: false, atk: 0, hurt: 0, aim: 0 },
    }[kind] || { anim: 0.3, walk: false, atk: 0, hurt: 0, aim: 0.6 };
    const sc = (kind === 'mage' ? 1.02 : kind === 'golem' ? 0.9 : kind === 'spearman' ? 1.12 : kind === 'bard' ? 1.18 : kind === 'icemage' ? 1.15
      : kind === 'hunter' ? 1.06 : kind === 'sniper' ? 1.16 : kind === 'thunder' ? 1.18 : kind === 'ninja' ? 1.26
      : kind === 'paladin' ? 1.04 : kind === 'pyro' ? 1.2 : kind === 'engineer' ? 1.2 : kind === 'berserker' ? 1.06 : kind === 'gunner' ? 1.14
      : kind === 'crossbow' ? 1.1 : kind === 'dollmaster' ? 1.3 : kind === 'doll' ? 1.5 : kind === 'turret' ? 1.7 : 1.3) / (SIZE[kind] || 1);
    const cx = kind === 'archer' ? 54 : kind === 'spearman' ? 48 : kind === 'golem' ? 56 : kind === 'bard' ? 54
      : kind === 'hunter' ? 55 : kind === 'sniper' ? 53 : kind === 'thunder' ? 55 : kind === 'ninja' ? 62
      : kind === 'paladin' ? 58 : kind === 'pyro' ? 58 : kind === 'engineer' ? 56 : kind === 'berserker' ? 54 : kind === 'gunner' ? 54
      : kind === 'crossbow' ? 50 : kind === 'dollmaster' ? 60 : kind === 'doll' ? 58 : kind === 'turret' ? 54 : 58;
    drawUnit(c, kind, cx, kind === 'mage' || kind === 'golem' ? 97 : 94, 1, pose, { scale: sc });
    // bottom fade for the name label
    const bf = c.createLinearGradient(0, 74, 0, 112);
    bf.addColorStop(0, 'rgba(5,8,26,0)'); bf.addColorStop(1, 'rgba(5,8,26,.88)');
    c.fillStyle = bf; c.fillRect(0, 74, 112, 38);
    // inner frame highlight
    c.strokeStyle = 'rgba(255,255,255,.10)'; c.lineWidth = 1; rr(c, 2.5, 2.5, 107, 107, 10); c.stroke();
    c.strokeStyle = 'rgba(232,196,122,.35)'; c.beginPath(); c.moveTo(30, 108.5); c.lineTo(82, 108.5); c.stroke();
  }

  // =====================================================================
  //  EFFECTS
  // =====================================================================
  function drawSummonCircle(ctx, x, y, t, life) {
    // life: 1 -> 0
    const p = 1 - life;
    const a = Math.min(1, life * 2.2) * Math.min(1, 0.25 + p * 6);
    const R = 30 + ease(Math.min(1, p * 3)) * 10;
    ctx.save(); ctx.translate(x, y); ctx.globalCompositeOperation = 'lighter';
    // ground sigil (squashed into perspective)
    ctx.save(); ctx.scale(1, 0.32); ctx.globalAlpha = a;
    sglow(ctx, 0, 0, R * 1.7, '120,200,255', 0.55);
    ctx.strokeStyle = 'rgba(175,232,255,.95)'; ctx.lineWidth = 2.4; circ(ctx, 0, 0, R); ctx.stroke();
    ctx.lineWidth = 1.1; circ(ctx, 0, 0, R * 0.8); ctx.stroke(); circ(ctx, 0, 0, R * 0.42); ctx.stroke();
    ctx.save(); ctx.rotate(t * 1.4);
    ctx.beginPath(); for (let i = 0; i < 24; i++) { const an = i * TAU / 24, r1 = i % 3 ? R * 0.86 : R * 0.93; ctx.moveTo(Math.cos(an) * R * 0.8, Math.sin(an) * R * 0.8); ctx.lineTo(Math.cos(an) * r1, Math.sin(an) * r1); } ctx.stroke();
    ctx.restore();
    ctx.save(); ctx.rotate(-t * 2.6);
    ctx.lineWidth = 1.4; ctx.beginPath();
    for (let i = 0; i < 4; i++) { const an = i * TAU / 4; ctx.lineTo(Math.cos(an) * R * 0.8, Math.sin(an) * R * 0.8); }
    ctx.closePath(); ctx.stroke();
    ctx.beginPath();
    for (let i = 0; i < 3; i++) { const an = i * TAU / 3 + 0.5; ctx.lineTo(Math.cos(an) * R * 0.42, Math.sin(an) * R * 0.42); }
    ctx.closePath(); ctx.stroke();
    ctx.fillStyle = 'rgba(220,248,255,.95)';
    for (let i = 0; i < 4; i++) { const an = i * TAU / 4; circ(ctx, Math.cos(an) * R * 0.8, Math.sin(an) * R * 0.8, 2.6); ctx.fill(); }
    ctx.restore();
    ctx.restore();
    // rising pillar of light (cached local gradient)
    const pa = a * (life > 0.45 ? 1 : life / 0.45);
    ctx.globalAlpha = pa;
    const pw = 24 * (0.35 + life * 0.65);
    ctx.fillStyle = lgc(ctx, 'summon-pillar', 0, -110, 0, 0, [[0, 'rgba(150,220,255,0)'], [0.6, 'rgba(150,220,255,.28)'], [1, 'rgba(170,230,255,.6)']]);
    ctx.fillRect(-pw, -110, pw * 2, 110);
    ctx.fillStyle = lgc(ctx, 'summon-core', 0, -90, 0, 0, [[0, 'rgba(240,252,255,0)'], [1, 'rgba(240,252,255,.75)']]);
    ctx.fillRect(-pw * 0.3, -90, pw * 0.6, 90);
    // sparkles spiralling up
    ctx.globalAlpha = a;
    for (let i = 0; i < 10; i++) {
      const q = (p * 1.3 + i * 0.1) % 1, an = i * 2.4 + t * 3;
      const sx = Math.cos(an) * R * (0.9 - q * 0.5), sy = -q * 100 + Math.sin(an) * R * 0.3;
      ctx.fillStyle = `rgba(220,248,255,${(1 - q).toFixed(2)})`;
      ctx.fillRect(sx - 1.2, sy - 1.2, 2.4, 2.4);
    }
    // burst flash at the start
    if (p < 0.25) sglow(ctx, 0, -30, 50, '200,240,255', (0.25 - p) * 3);
    ctx.restore();
  }

  function drawTelegraph(ctx, x, y, r, p) {
    ctx.save(); ctx.translate(x, y); ctx.scale(1, 0.28);
    const pulse = 0.5 + 0.5 * Math.sin(p * 28);
    ctx.fillStyle = `rgba(255,70,130,${(0.1 + p * 0.18).toFixed(3)})`; circ(ctx, 0, 0, r); ctx.fill();
    ctx.fillStyle = `rgba(255,120,170,${(0.12 + p * 0.22).toFixed(3)})`; circ(ctx, 0, 0, r * p); ctx.fill();
    ctx.strokeStyle = `rgba(255,170,205,${(0.55 + 0.45 * pulse * p).toFixed(3)})`; ctx.lineWidth = 3.2; circ(ctx, 0, 0, r); ctx.stroke();
    ctx.lineWidth = 2.2; circ(ctx, 0, 0, Math.max(1, r * p)); ctx.stroke();
    ctx.setLineDash([12, 9]); ctx.lineDashOffset = -p * 80; ctx.lineWidth = 1.6;
    ctx.strokeStyle = `rgba(255,190,220,${(0.35 + p * 0.4).toFixed(3)})`; circ(ctx, 0, 0, r * 0.82); ctx.stroke();
    ctx.setLineDash([]);
    // radial warning ticks
    ctx.beginPath();
    for (let i = 0; i < 12; i++) { const a = i * TAU / 12; ctx.moveTo(Math.cos(a) * r * 1.02, Math.sin(a) * r * 1.02); ctx.lineTo(Math.cos(a) * r * (1.08 + p * 0.06), Math.sin(a) * r * (1.08 + p * 0.06)); }
    ctx.lineWidth = 2.4; ctx.stroke();
    ctx.restore();
  }

  function useImage(kind, url, o) {
    const el = new Image();
    const rec = { el, ready: false, w: o.w, h: o.h, ax: o.ax == null ? 0.5 : o.ax, ay: o.ay == null ? 1 : o.ay };
    el.onload = () => { rec.ready = true; };
    el.src = url; images[kind] = rec;
  }

  window.Art = { SIZE, KINDS, drawBackground, drawLighthouse, drawCommander, drawUnit, drawCardArt, drawSummonCircle, drawTelegraph, useImage, LH, glow, circ, ell, rr };
})();
