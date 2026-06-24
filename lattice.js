/**
 * lattice.js — Diamond PenTile subpixel lattice (optimized).
 *
 * Performance targets:
 *  - 60fps on mid-range laptop
 *  - 30fps on mobile
 *  - <5000 subpixels at 1080p
 *  - Pre-computed vignette, no per-frame sqrt
 */

(function () {
  "use strict";

  var canvas = document.getElementById("lattice");
  if (!canvas) return;
  var ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });

  // ── State ───────────────────────────────────────

  var W = 1, H = 1, dpr = 1;
  var subpixels = [];
  var vignetteLUT = null; // pre-computed per-subpixel vignette
  var mouse = { x: -1, y: -1 };
  var isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
  var frameCount = 0;

  // Lattice parameters — tuned for density vs perf
  var PITCH_BASE = isMobile ? 14 : 10;   // bigger = fewer subpixels
  var PITCH_RATIO = 1.15;

  // ── Geometry ────────────────────────────────────

  function rebuild() {
    dpr = Math.min(window.devicePixelRatio || 1, isMobile ? 1.5 : 2);
    W = window.innerWidth;
    H = window.innerHeight;

    canvas.width = Math.floor(W * dpr);
    canvas.height = Math.floor(H * dpr);
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;

    var pitchX = PITCH_BASE;
    var pitchY = Math.round(pitchX * PITCH_RATIO);
    var baseR = Math.min(pitchX, pitchY) * 0.5;
    var trim = baseR * 0.12;
    var greenR = Math.max(0.5, baseR * 0.8 - trim);
    var diamondR = Math.max(0.5, baseR * 0.9 - trim);

    var cols = Math.ceil(W / pitchX) + 4;
    var rows = Math.ceil(H / pitchY) + 4;
    var draft = [];

    for (var row = 0; row < rows; row++) {
      var rowShift = (row & 1) * (pitchX * 0.5);
      for (var col = 0; col < cols; col++) {
        var cx = col * pitchX + rowShift;
        var cy = row * pitchY;
        var isGreen = ((row + col) & 1) === 0;
        var type = 0; // G=0, R=1, B=2
        if (!isGreen) {
          type = ((Math.floor(col / 2) + row) & 1) === 0 ? 1 : 2;
        }
        draft.push(cx, cy, type, isGreen ? greenR : diamondR);
      }
    }

    // Center and cull off-screen
    var len = draft.length / 4;
    var cx0 = draft[0], cy0 = draft[1];
    var cx1 = draft[(len - 1) * 4], cy1 = draft[(len - 1) * 4 + 1];
    var offX = (W - (cx0 + cx1)) * 0.5;
    var offY = (H - (cy0 + cy1)) * 0.5;
    var pad = Math.max(greenR, diamondR) + 2;

    subpixels = [];
    var edge = pad;
    var maxDist = Math.sqrt(W * W + H * H) * 0.5;

    for (var i = 0; i < len; i++) {
      var base = i * 4;
      var sx = draft[base] + offX;
      var sy = draft[base + 1] + offY;
      if (sx < edge || sx > W - edge || sy < edge || sy > H - edge) continue;

      var dx = sx - W * 0.5;
      var dy = sy - H * 0.5;
      var dist = Math.sqrt(dx * dx + dy * dy);
      var vig = Math.max(0, 1 - Math.pow(dist / maxDist, 1.5));

      subpixels.push(sx, sy, draft[base + 2], draft[base + 3], vig);
    }

    // Per-subpixel: [x, y, type, radius, vignette]
    // stride = 5
  }

  // ── Render ──────────────────────────────────────

  function draw(time) {
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, W, H);

    var pulse = 0.32 + 0.06 * Math.sin(time / 4000);
    var mx = mouse.x;
    var my = mouse.y;
    var mouseR = isMobile ? 0 : 160; // disable mouse glow on mobile

    var sp = subpixels;
    var len = sp.length;
    var stride = 5;

    for (var i = 0; i < len; i += stride) {
      var x = sp[i];
      var y = sp[i + 1];
      var type = sp[i + 2];
      var radius = sp[i + 3];
      var vig = sp[i + 4];

      var b = pulse * vig;

      // Mouse proximity (skip if <0.01 to save math)
      if (mx >= 0 && mouseR > 0) {
        var mdx = x - mx;
        var mdy = y - my;
        var mDist = mdx * mdx + mdy * mdy;
        var mr2 = mouseR * mouseR;
        if (mDist < mr2) {
          b += (1 - mDist / mr2) * 0.3;
        }
      }

      if (b < 0.015) continue;

      if (type === 0) {
        // Green circle
        var g = (180 * b) | 0;
        ctx.fillStyle = "rgba(0," + g + ",0," + (b * 0.6).toFixed(3) + ")";
        ctx.beginPath();
        ctx.arc(x, y, radius + b * 0.3, 0, 6.2832);
        ctx.fill();
      } else {
        // Red or blue diamond
        var rb = (i * 7) & 1;
        var sz = radius * (0.85 + b * 0.2);
        var r = 0, bl = 0;
        if (type === 1) r = (200 * b) | 0;
        else bl = (220 * b) | 0;

        ctx.fillStyle = "rgba(" + r + ",0," + bl + "," + (b * 0.5).toFixed(3) + ")";
        ctx.beginPath();
        ctx.moveTo(x, y - sz);
        ctx.lineTo(x + sz, y);
        ctx.lineTo(x, y + sz);
        ctx.lineTo(x - sz, y);
        ctx.closePath();
        ctx.fill();
      }
    }
  }

  // ── RAF loop with adaptive throttle on mobile ───

  var lastFrame = 0;
  var mobileInterval = isMobile ? 33 : 0; // ~30fps on mobile

  function frame(time) {
    requestAnimationFrame(frame);

    // Throttle on mobile
    if (mobileInterval && time - lastFrame < mobileInterval) return;
    lastFrame = time;

    draw(time);
  }

  // ── Events ──────────────────────────────────────

  document.addEventListener("mousemove", function (e) {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
  });
  document.addEventListener("mouseleave", function () {
    mouse.x = -1;
    mouse.y = -1;
  });

  var resizeTimer;
  window.addEventListener("resize", function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(rebuild, 150);
  });

  // ── Init ────────────────────────────────────────

  rebuild();
  requestAnimationFrame(frame);

  // Expose for debugging
  window.__lattice = { subpixels: subpixels, rebuild: rebuild };
})();
