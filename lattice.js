/**
 * lattice.js — Diamond PenTile lattice.
 *
 * Exactly how amoled-renderer.js does it:
 *  1. Draw everything into a tiny offscreen canvas (weather buffer)
 *  2. Read its RGB pixel data
 *  3. Each subpixel samples via nearest-neighbor
 *  4. Green subpixels use G, Red use R, Blue use B
 *  5. Render as circles (green) or diamonds (R/B)
 *
 * No bloom. No complex math. Just subpixel sampling.
 */

(function () {
  "use strict";

  var canvas = document.getElementById("lattice");
  if (!canvas) return;
  var ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });

  var W = 1, H = 1;
  var subpixels = [];
  var isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);

  // ── Offscreen weather buffer (like AMOLED FrameBuffer) ──────────

  var bufCanvas, bufCtx;
  var BUF_W = 120;
  var BUF_H = 70;

  // ── Weather state ───────────────────────────────────────────────

  var weather = {
    sun_altitude: 1.0,
    cloud_cover: 0,
    wind_speed: 0,
    condition: "clear",
    moon_phase: 0.5,
  };

  // Animated positions
  var raindrops = [];
  var cloudDrift = 0;
  var lastTime = 0;

  // ── Config ──────────────────────────────────────────────────────

  var PITCH = isMobile ? 16 : 11;

  // ── Geometry rebuild ────────────────────────────────────────────

  function rebuild() {
    var dpr = Math.min(window.devicePixelRatio || 1, isMobile ? 1.5 : 2);
    W = window.innerWidth;
    H = window.innerHeight;

    canvas.width = Math.floor(W * dpr);
    canvas.height = Math.floor(H * dpr);
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;

    var pitchX = PITCH;
    var pitchY = Math.round(pitchX * 1.15);
    var baseR = Math.min(pitchX, pitchY) * 0.5;
    var greenR = Math.max(0.5, baseR * 0.7);
    var diamondR = Math.max(0.5, baseR * 0.8);

    var cols = Math.ceil(W / pitchX) + 4;
    var rows = Math.ceil(H / pitchY) + 4;
    var draft = [];

    for (var row = 0; row < rows; row++) {
      var rowShift = (row & 1) * (pitchX * 0.5);
      for (var col = 0; col < cols; col++) {
        var cx = col * pitchX + rowShift;
        var cy = row * pitchY;
        var isGreen = ((row + col) & 1) === 0;
        var type = 0;
        if (!isGreen) {
          type = ((Math.floor(col / 2) + row) & 1) === 0 ? 1 : 2;
        }
        draft.push(cx, cy, type, isGreen ? greenR : diamondR);
      }
    }

    var len = draft.length / 4;
    var cx0 = draft[0], cy0 = draft[1];
    var cx1 = draft[(len - 1) * 4], cy1 = draft[(len - 1) * 4 + 1];
    var offX = (W - (cx0 + cx1)) * 0.5;
    var offY = (H - (cy0 + cy1)) * 0.5;
    var pad = Math.max(greenR, diamondR) + 2;
    var maxDist = Math.sqrt(W * W + H * H) * 0.5;

    subpixels = [];
    for (var i = 0; i < len; i++) {
      var base = i * 4;
      var sx = draft[base] + offX;
      var sy = draft[base + 1] + offY;
      if (sx < pad || sx > W - pad || sy < pad || sy > H - pad) continue;

      var dx = sx - W * 0.5;
      var dy = sy - H * 0.5;
      var dist = Math.sqrt(dx * dx + dy * dy);
      var vig = Math.max(0, 1 - Math.pow(dist / maxDist, 1.5));

      // Normalized position for FrameBuffer sampling (like AMOLED)
      var normX = sx / W;
      var normY = sy / H;

      subpixels.push(sx, sy, draft[base + 2], draft[base + 3], vig, normX, normY);
    }
    // stride=7: [x, y, type, radius, vig, normX, normY]
  }

  // ── Weather update ──────────────────────────────────────────────

  function updateWeather(data) {
    if (!data) return;
    if (data.sun_altitude != null) weather.sun_altitude = data.sun_altitude;
    if (data.cloud_cover != null) weather.cloud_cover = data.cloud_cover;
    if (data.wind_speed != null) weather.wind_speed = data.wind_speed;
    if (data.condition) weather.condition = data.condition;
    if (data.moon_phase != null) weather.moon_phase = data.moon_phase;

    // Generate raindrops
    var cond = weather.condition;
    if (cond === "rain" || cond === "drizzle" || cond === "rain_showers") {
      var target = cond === "drizzle" ? 15 : 30;
      while (raindrops.length < target) {
        raindrops.push(Math.random() * BUF_W, Math.random() * BUF_H, 0.3 + Math.random() * 0.8);
      }
      while (raindrops.length > target * 3) raindrops.pop();
    } else {
      raindrops.length = 0;
    }
  }

  // ── Draw weather into tiny buffer ───────────────────────────────
  // This is the "FrameBuffer" — everything drawn at low res

  function drawBuffer(time) {
    if (!bufCanvas) {
      bufCanvas = document.createElement("canvas");
      bufCanvas.width = BUF_W;
      bufCanvas.height = BUF_H;
      bufCtx = bufCanvas.getContext("2d");
    }

    bufCtx.fillStyle = "#000";
    bufCtx.fillRect(0, 0, BUF_W, BUF_H);

    var sunAlt = weather.sun_altitude;
    var windDrift = (weather.wind_speed / 10) * 0.3;

    // ── Sun ──
    if (sunAlt > 0.01) {
      var sx = BUF_W * 0.1 + BUF_W * 0.8 * (1 - sunAlt);
      var sy = BUF_H * 0.35 - Math.sin((1 - sunAlt) * Math.PI) * BUF_H * 0.3;
      var sunR = 3 + sunAlt * 4;

      // Glow
      var grad = bufCtx.createRadialGradient(sx, sy, 0, sx, sy, sunR * 3);
      var warm = sunAlt > 0.5 ? [255, 200, 80] : [255, 140, 60];
      grad.addColorStop(0, "rgba(" + warm[0] + "," + warm[1] + "," + warm[2] + "," + (sunAlt * 0.8).toFixed(2) + ")");
      grad.addColorStop(1, "rgba(" + warm[0] + "," + warm[1] + "," + warm[2] + ",0)");
      bufCtx.fillStyle = grad;
      bufCtx.beginPath();
      bufCtx.arc(sx, sy, sunR * 3, 0, 6.2832);
      bufCtx.fill();

      // Core
      bufCtx.fillStyle = "rgba(255,240,180," + Math.min(1, sunAlt * 1.5).toFixed(2) + ")";
      bufCtx.beginPath();
      bufCtx.arc(sx, sy, sunR, 0, 6.2832);
      bufCtx.fill();
    }

    // ── Moon ──
    var moonInt = sunAlt < 0.05 ? (1 - sunAlt / 0.05) : 0;
    if (moonInt > 0.01) {
      var mx = BUF_W * 0.7;
      var my = BUF_H * 0.1;
      var moonR = 3;

      // Glow
      var mg = bufCtx.createRadialGradient(mx, my, 0, mx, my, moonR * 4);
      mg.addColorStop(0, "rgba(180,200,255," + (moonInt * 0.2).toFixed(2) + ")");
      mg.addColorStop(1, "rgba(180,200,255,0)");
      bufCtx.fillStyle = mg;
      bufCtx.beginPath();
      bufCtx.arc(mx, my, moonR * 4, 0, 6.2832);
      bufCtx.fill();

      // Disc
      bufCtx.fillStyle = "rgba(200,215,255," + (moonInt * 0.8).toFixed(2) + ")";
      bufCtx.beginPath();
      bufCtx.arc(mx, my, moonR, 0, 6.2832);
      bufCtx.fill();

      // Phase shadow
      var shadowW = moonR * Math.cos(weather.moon_phase * Math.PI * 2) * 0.8;
      bufCtx.fillStyle = "rgba(0,0,0," + (moonInt * 0.7).toFixed(2) + ")";
      bufCtx.beginPath();
      bufCtx.ellipse(mx + shadowW * 0.3, my, Math.abs(shadowW) + 1, moonR, 0, 0, 6.2832);
      bufCtx.fill();
    }

    // ── Clouds ──
    var cover = weather.cloud_cover;
    var numClouds = Math.min(4, Math.ceil(cover / 25));
    if (numClouds > 0) {
      cloudDrift += windDrift * 0.05;
      for (var c = 0; c < numClouds; c++) {
        var cx = ((c / numClouds) * BUF_W * 1.2 + cloudDrift + Math.sin(c * 2.1) * 10) % (BUF_W + 20) - 10;
        var cy = 5 + (c % 3) * 8;
        var cw = 12 + Math.random() * 8;
        var ch = 4 + Math.random() * 3;
        var op = 0.15 + (cover / 100) * 0.3;

        bufCtx.fillStyle = "rgba(80,90,110," + op.toFixed(2) + ")";
        bufCtx.beginPath();
        bufCtx.ellipse(cx, cy, cw, ch, 0, 0, 6.2832);
        bufCtx.fill();
        // Puffs
        bufCtx.beginPath();
        bufCtx.ellipse(cx - cw * 0.4, cy - 2, cw * 0.5, ch * 0.6, 0, 0, 6.2832);
        bufCtx.fill();
        bufCtx.beginPath();
        bufCtx.ellipse(cx + cw * 0.3, cy - 1, cw * 0.6, ch * 0.5, 0, 0, 6.2832);
        bufCtx.fill();
      }
    }

    // ── Rain ──
    if (raindrops.length > 0) {
      bufCtx.strokeStyle = "rgba(100,160,255,0.6)";
      bufCtx.lineWidth = 1;
      for (var r = 0; r < raindrops.length; r += 3) {
        raindrops[r + 1] += raindrops[r + 2]; // y += speed
        raindrops[r] += windDrift * 0.03; // x += wind
        if (raindrops[r + 1] > BUF_H) {
          raindrops[r] = Math.random() * BUF_W;
          raindrops[r + 1] = -2;
        }
        if (raindrops[r] > BUF_W) raindrops[r] = 0;
        if (raindrops[r] < 0) raindrops[r] = BUF_W;
        bufCtx.beginPath();
        bufCtx.moveTo(raindrops[r], raindrops[r + 1]);
        bufCtx.lineTo(raindrops[r] + windDrift * 0.02, raindrops[r + 1] + 1.5);
        bufCtx.stroke();
      }
    }

    // ── Snow ──
    if (weather.condition === "snow" || weather.condition === "snow_showers") {
      bufCtx.fillStyle = "rgba(220,230,255,0.7)";
      for (var s = 0; s < 15; s++) {
        var snx = (Math.sin(time / 3000 + s * 1.7) * 0.5 + 0.5) * BUF_W;
        var sny = ((time / 20 + s * BUF_H / 15) % BUF_H);
        bufCtx.beginPath();
        bufCtx.arc(snx, sny, 0.8, 0, 6.2832);
        bufCtx.fill();
      }
    }

    // ── Lightning ──
    if (weather.condition === "thunderstorm" && Math.random() < 0.008) {
      bufCtx.fillStyle = "rgba(255,255,255,0.4)";
      bufCtx.fillRect(0, 0, BUF_W, BUF_H);
    }
  }

  // ── Render (AMOLED approach) ────────────────────────────────────

  function draw(time) {
    // 1. Draw weather into buffer
    drawBuffer(time);

    // 2. Read buffer pixels (like AMOLED FrameBuffer)
    var imageData = bufCtx.getImageData(0, 0, BUF_W, BUF_H);
    var buf = imageData.data; // RGBA

    // 3. Clear main canvas
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);

    var sp = subpixels;
    var len = sp.length;
    var stride = 7;
    var pulse = 0.35 + 0.04 * Math.sin(time / 2500);

    // 4. For each subpixel, sample from buffer (nearest neighbor)
    //    Green subs use G channel, Red use R, Blue use B
    //    Exactly like amoled-renderer.js render()

    for (var i = 0; i < len; i += stride) {
      var x = sp[i];
      var y = sp[i + 1];
      var type = sp[i + 2]; // 0=green, 1=red, 2=blue
      var radius = sp[i + 3];
      var vig = sp[i + 4];
      var normX = sp[i + 5];
      var normY = sp[i + 6];

      // Sample buffer (nearest neighbor, like AMOLED getPixelNearest)
      var bx = Math.min(BUF_W - 1, Math.max(0, Math.round(normX * (BUF_W - 1))));
      var by = Math.min(BUF_H - 1, Math.max(0, Math.round(normY * (BUF_H - 1))));
      var idx = (by * BUF_W + bx) * 4;
      var rPix = buf[idx];
      var gPix = buf[idx + 1];
      var bPix = buf[idx + 2];

      // Mix with base lattice pulse
      var b = pulse * vig;

      // Pick channel based on subpixel type (exactly like AMOLED)
      var ch;
      if (type === 0) ch = gPix;       // Green subpixel → G channel
      else if (type === 1) ch = rPix;   // Red subpixel → R channel
      else ch = bPix;                   // Blue subpixel → B channel

      // Mix: weather pixel + base pulse
      var brightness = Math.max(b * 120, ch * b);
      if (brightness < 3) continue;

      // Color (exactly like AMOLED _drawBatch)
      if (type === 0) {
        ctx.fillStyle = "rgb(0," + Math.round(brightness) + ",0)";
      } else if (type === 1) {
        ctx.fillStyle = "rgb(" + Math.round(brightness) + ",0,0)";
      } else {
        ctx.fillStyle = "rgb(0,0," + Math.round(brightness) + ")";
      }

      if (type === 0) {
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, 6.2832);
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.moveTo(x, y - radius);
        ctx.lineTo(x + radius, y);
        ctx.lineTo(x, y + radius);
        ctx.lineTo(x - radius, y);
        ctx.closePath();
        ctx.fill();
      }
    }
  }

  // ── RAF loop ────────────────────────────────────────────────────

  var frameSkip = isMobile ? 33 : 0;

  function frame(time) {
    requestAnimationFrame(frame);
    if (frameSkip && time - lastTime < frameSkip) return;
    lastTime = time;
    draw(time);
  }

  // ── Init ────────────────────────────────────────────────────────

  var resizeTimer;
  window.addEventListener("resize", function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(rebuild, 200);
  });

  rebuild();
  requestAnimationFrame(frame);

  window.__lattice = {
    updateWeather: updateWeather,
    weather: weather,
  };
})();
