/**
 * lattice.js — Diamond PenTile lattice with weather rendered AT lattice resolution.
 *
 * Approach (like px.ali.et):
 *  1. Tiny offscreen canvas (~100x60) = the "weather buffer"
 *  2. Draw weather elements into it at low res (sun, clouds, rain, moon)
 *  3. Each subpixel samples from the buffer via nearest-neighbor
 *  4. Result: weather looks pixelated/lattice-native, not smooth overlay
 *
 * The lattice IS the display. Weather is rendered THROUGH it.
 */

(function () {
  "use strict";

  var canvas = document.getElementById("lattice");
  if (!canvas) return;
  var ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });

  var W = 1, H = 1;
  var subpixels = [];
  var isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);

  // ── Weather buffer (offscreen) ───────────────────

  var bw, bh;
  var bloomCanvas, bloomCtx;

  // ── Weather state ────────────────────────────────

  var weather = {
    sun_altitude: 1.0,
    cloud_cover: 0,
    wind_speed: 0,
    wind_direction: 0,
    condition: "clear",
    moon_phase: 0.5,
  };

  // Animated positions
  var sunAngle = 0; // radians, animates slowly
  var moonAngle = 0;
  var cloudOffset = 0;
  var rainOffset = 0;

  // ── Config ───────────────────────────────────────

  var PITCH_BASE = isMobile ? 14 : 10;
  var PITCH_RATIO = 1.15;
  var MAX_RAIN = isMobile ? 15 : 30;
  var MAX_CLOUDS = 5;

  // Pre-allocated rain positions
  var rainX = new Float32Array(MAX_RAIN);
  var rainY = new Float32Array(MAX_RAIN);
  var rainSpd = new Float32Array(MAX_RAIN);
  var rainCount = 0;

  // Pre-allocated cloud positions
  var cloudX = new Float32Array(MAX_CLOUDS);
  var cloudY = new Float32Array(MAX_CLOUDS);
  var cloudRx = new Float32Array(MAX_CLOUDS);
  var cloudRy = new Float32Array(MAX_CLOUDS);
  var cloudOp = new Float32Array(MAX_CLOUDS);
  var cloudCount = 0;

  // Mouse
  var mouse = { x: -1, y: -1 };

  // ── Geometry rebuild ─────────────────────────────

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

    // Bloom canvas (low-res for glow)
    var bScale = isMobile ? 5 : 4;
    bw = Math.max(1, Math.floor(W / bScale));
    bh = Math.max(1, Math.floor(H / bScale));
    if (!bloomCanvas) {
      bloomCanvas = document.createElement("canvas");
      bloomCtx = bloomCanvas.getContext("2d");
    }
    bloomCanvas.width = bw;
    bloomCanvas.height = bh;

    // Subpixel grid
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

      // Normalized position for buffer sampling
      var normX = sx / W;
      var normY = sy / H;

      subpixels.push(sx, sy, draft[base + 2], draft[base + 3], vig, sx, normX, normY);
    }
    // stride=8: [x, y, type, radius, vig, baseX, normX, normY]
  }

  // ── Weather update ───────────────────────────────

  function updateWeather(data) {
    if (!data) return;
    if (data.sun_altitude != null) weather.sun_altitude = data.sun_altitude;
    if (data.cloud_cover != null) weather.cloud_cover = data.cloud_cover;
    if (data.wind_speed != null) weather.wind_speed = data.wind_speed;
    if (data.wind_direction != null) weather.wind_direction = data.wind_direction;
    if (data.condition) weather.condition = data.condition;
    if (data.moon_phase != null) weather.moon_phase = data.moon_phase;

    // Generate cloud blobs
    var cover = weather.cloud_cover;
    cloudCount = Math.min(MAX_CLOUDS, Math.ceil(cover / 20));
    for (var i = 0; i < cloudCount; i++) {
      // Distribute clouds across the upper portion
      cloudX[i] = (i / cloudCount) * bw + Math.sin(i * 2.7) * bw * 0.1;
      cloudY[i] = bh * (0.08 + (i % 3) * 0.12);
      cloudRx[i] = bw * (0.08 + Math.random() * 0.12);
      cloudRy[i] = bh * (0.04 + Math.random() * 0.06);
      cloudOp[i] = 0.4 + (cover / 100) * 0.5;
    }

    // Generate rain
    var cond = weather.condition;
    if (cond === "rain" || cond === "drizzle" || cond === "rain_showers") {
      var rate = cond === "drizzle" ? 0.5 : 1.0;
      rainCount = Math.min(MAX_RAIN, Math.ceil(MAX_RAIN * rate));
      for (var j = 0; j < rainCount; j++) {
        rainX[j] = Math.random() * bw;
        rainY[j] = Math.random() * bh;
        rainSpd[j] = 0.5 + Math.random() * 1.5;
      }
    } else {
      rainCount = 0;
    }
  }

  // ── Draw weather buffer ──────────────────────────

  function drawWeatherBuffer(time) {
    var t = time / 1000;
    bloomCtx.fillStyle = "#000";
    bloomCtx.fillRect(0, 0, bw, bh);

    var sunAlt = weather.sun_altitude;
    var windDrift = (weather.wind_speed / 10) * 0.3;

    // ── Sun ────────────────────────────────────────

    if (sunAlt > 0.01) {
      // Sun arc: rises left, peaks center, sets right
      sunAngle = (1 - sunAlt) * Math.PI;
      var sx = bw * 0.1 + (bw * 0.8) * (sunAngle / Math.PI);
      var sy = bh * 0.4 - Math.sin(sunAngle) * bh * 0.35;
      var sunR = bw * 0.06 * sunAlt + bw * 0.02;

      // Glow (soft circle)
      var glowR = sunR * 4;
      var grad = bloomCtx.createRadialGradient(sx, sy, sunR * 0.5, sx, sy, glowR);
      var warmth = sunAlt > 0.5 ? "255,200,80" : "255,140,60";
      grad.addColorStop(0, "rgba(" + warmth + "," + (sunAlt * 0.9).toFixed(2) + ")");
      grad.addColorStop(0.4, "rgba(" + warmth + "," + (sunAlt * 0.3).toFixed(2) + ")");
      grad.addColorStop(1, "rgba(" + warmth + ",0)");
      bloomCtx.fillStyle = grad;
      bloomCtx.beginPath();
      bloomCtx.arc(sx, sy, glowR, 0, 6.2832);
      bloomCtx.fill();

      // Core
      bloomCtx.fillStyle = "rgba(255,240,180," + Math.min(1, sunAlt * 1.2).toFixed(2) + ")";
      bloomCtx.beginPath();
      bloomCtx.arc(sx, sy, sunR, 0, 6.2832);
      bloomCtx.fill();
    }

    // ── Moon ───────────────────────────────────────

    var moonInt = sunAlt < 0.05 ? (1 - sunAlt / 0.05) : 0;
    if (moonInt > 0.01) {
      moonAngle = t * 0.01;
      var mx = bw * 0.65 + Math.sin(moonAngle) * bw * 0.1;
      var my = bh * 0.1;
      var moonR = bw * 0.04;

      // Glow
      var mGlowR = moonR * 5;
      var mGrad = bloomCtx.createRadialGradient(mx, my, moonR * 0.3, mx, my, mGlowR);
      mGrad.addColorStop(0, "rgba(180,200,255," + (moonInt * 0.25).toFixed(2) + ")");
      mGrad.addColorStop(1, "rgba(180,200,255,0)");
      bloomCtx.fillStyle = mGrad;
      bloomCtx.beginPath();
      bloomCtx.arc(mx, my, mGlowR, 0, 6.2832);
      bloomCtx.fill();

      // Disc
      bloomCtx.fillStyle = "rgba(200,215,255," + (moonInt * 0.8).toFixed(2) + ")";
      bloomCtx.beginPath();
      bloomCtx.arc(mx, my, moonR, 0, 6.2832);
      bloomCtx.fill();

      // Phase shadow
      var phase = weather.moon_phase;
      var shadowW = moonR * Math.cos(phase * Math.PI * 2) * 0.9;
      bloomCtx.fillStyle = "rgba(0,0,0," + (moonInt * 0.7).toFixed(2) + ")";
      bloomCtx.beginPath();
      bloomCtx.ellipse(mx + shadowW * 0.3, my, Math.abs(shadowW) + 1, moonR * 0.95, 0, 0, 6.2832);
      bloomCtx.fill();
    }

    // ── Clouds ─────────────────────────────────────

    cloudOffset += windDrift * 0.1;
    for (var c = 0; c < cloudCount; c++) {
      var cx = ((cloudX[c] + cloudOffset) % (bw + cloudRx[c] * 4)) - cloudRx[c] * 2;
      var cy = cloudY[c] + Math.sin(t * 0.2 + c * 1.5) * bh * 0.02;

      bloomCtx.fillStyle = "rgba(80,90,110," + cloudOp[c].toFixed(2) + ")";
      bloomCtx.beginPath();
      bloomCtx.ellipse(cx, cy, cloudRx[c], cloudRy[c], 0, 0, 6.2832);
      bloomCtx.fill();

      // Cloud puffs (smaller overlapping ellipses)
      bloomCtx.fillStyle = "rgba(90,100,120," + (cloudOp[c] * 0.7).toFixed(2) + ")";
      bloomCtx.beginPath();
      bloomCtx.ellipse(cx - cloudRx[c] * 0.4, cy - cloudRy[c] * 0.3, cloudRx[c] * 0.5, cloudRy[c] * 0.6, 0, 0, 6.2832);
      bloomCtx.fill();
      bloomCtx.beginPath();
      bloomCtx.ellipse(cx + cloudRx[c] * 0.3, cy - cloudRy[c] * 0.2, cloudRx[c] * 0.6, cloudRy[c] * 0.5, 0, 0, 6.2832);
      bloomCtx.fill();
    }

    // ── Rain ───────────────────────────────────────

    if (rainCount > 0) {
      rainOffset += windDrift * 0.5;
      for (var r = 0; r < rainCount; r++) {
        rainY[r] += rainSpd[r];
        rainX[r] += rainOffset * 0.1;
        if (rainY[r] > bh + 3) {
          rainY[r] = -2;
          rainX[r] = Math.random() * bw;
        }
        if (rainX[r] > bw) rainX[r] = 0;
        if (rainX[r] < 0) rainX[r] = bw;

        // Draw raindrop as a short vertical line
        var dropLen = 1.5 + rainSpd[r] * 0.8;
        bloomCtx.strokeStyle = "rgba(100,160,255,0.6)";
        bloomCtx.lineWidth = 1;
        bloomCtx.beginPath();
        bloomCtx.moveTo(rainX[r], rainY[r]);
        bloomCtx.lineTo(rainX[r] + rainOffset * 0.05, rainY[r] + dropLen);
        bloomCtx.stroke();
      }
    }

    // ── Snow ───────────────────────────────────────

    if (weather.condition === "snow" || weather.condition === "snow_showers") {
      for (var s = 0; s < 20; s++) {
        var sx2 = (Math.sin(t * 0.3 + s * 1.7) * 0.5 + 0.5) * bw;
        var sy2 = ((t * 0.15 + s * bh / 20) % bh);
        bloomCtx.fillStyle = "rgba(220,230,255,0.7)";
        bloomCtx.beginPath();
        bloomCtx.arc(sx2, sy2, 1, 0, 6.2832);
        bloomCtx.fill();
      }
    }

    // ── Lightning flash ────────────────────────────

    if (weather.condition === "thunderstorm" && Math.random() < 0.005) {
      bloomCtx.fillStyle = "rgba(255,255,255,0.5)";
      bloomCtx.fillRect(0, 0, bw, bh);
    }
  }

  // ── Render lattice ───────────────────────────────

  function draw(time) {
    // Step 1: Draw weather into low-res buffer
    drawWeatherBuffer(time);

    // Step 2: Read buffer pixels
    var imageData = bloomCtx.getImageData(0, 0, bw, bh);
    var buf = imageData.data;

    // Step 3: Clear main canvas
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, W, H);

    var t = time / 1000;
    var sp = subpixels;
    var len = sp.length;
    var stride = 8;

    var pulse = 0.35 + 0.04 * Math.sin(t * 0.4);
    var mx = mouse.x;
    var my = mouse.y;
    var mouseR = isMobile ? 0 : 150;
    var mouseR2 = mouseR * mouseR;
    var windDrift = (weather.wind_speed / 10) * 0.3;

    for (var i = 0; i < len; i += stride) {
      var x = sp[i];
      var y = sp[i + 1];
      var type = sp[i + 2];
      var radius = sp[i + 3];
      var vig = sp[i + 4];
      var baseX = sp[i + 5];
      var normX = sp[i + 6];
      var normY = sp[i + 7];

      // Wind drift
      x = baseX + windDrift * Math.sin(t * 0.5 + y * 0.01) * 3;
      sp[i] = x;

      // Sample weather buffer (nearest neighbor)
      var bx = Math.min(bw - 1, Math.max(0, Math.floor(normX * bw)));
      var by = Math.min(bh - 1, Math.max(0, Math.floor(normY * bh)));
      var bIdx = (by * bw + bx) * 4;
      var bR = buf[bIdx];
      var bG = buf[bIdx + 1];
      var bB = buf[bIdx + 2];

      // Base lattice brightness
      var b = pulse * vig;

      // Mouse proximity
      if (mx >= 0 && mouseR > 0) {
        var mdx = x - mx;
        var mdy = y - my;
        var mDist2 = mdx * mdx + mdy * mdy;
        if (mDist2 < mouseR2) {
          b += (1 - mDist2 / mouseR2) * 0.2;
        }
      }

      if (b < 0.008) continue;

      // Combine base lattice with weather buffer
      // Weather buffer adds color, base lattice adds green pulse
      var finalR, finalG, finalB;

      if (type === 0) {
        // Green subpixel: uses G channel from buffer + base green pulse
        finalR = (bR * b * 0.3) | 0;
        finalG = (bG * b * 0.5 + b * 120) | 0;
        finalB = (bB * b * 0.3) | 0;
      } else if (type === 1) {
        // Red subpixel: uses R channel from buffer
        finalR = (bR * b * 0.6 + b * 60) | 0;
        finalG = (bG * b * 0.2) | 0;
        finalB = (bB * b * 0.2) | 0;
      } else {
        // Blue subpixel: uses B channel from buffer
        finalR = (bR * b * 0.2) | 0;
        finalG = (bG * b * 0.2) | 0;
        finalB = (bB * b * 0.6 + b * 50) | 0;
      }

      var alpha = Math.min(1, b * 0.7);
      ctx.fillStyle = "rgba(" + Math.min(255, finalR) + "," + Math.min(255, finalG) + "," + Math.min(255, finalB) + "," + alpha.toFixed(3) + ")";

      if (type === 0) {
        ctx.beginPath();
        ctx.arc(x, y, radius + b * 0.3, 0, 6.2832);
        ctx.fill();
      } else {
        var sz = radius * (0.85 + b * 0.2);
        ctx.beginPath();
        ctx.moveTo(x, y - sz);
        ctx.lineTo(x + sz, y);
        ctx.lineTo(x, y + sz);
        ctx.lineTo(x - sz, y);
        ctx.closePath();
        ctx.fill();
      }
    }

    // ── Bloom pass ─────────────────────────────────

    var bloomInt = 0.3;
    if (bloomInt > 0.01) {
      var scaleX = bw / W;
      var scaleY = bh / H;

      ctx.save();
      ctx.filter = "blur(" + Math.round(3 + bloomInt * 8) + "px)";
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = bloomInt * 0.5;

      for (var j = 0; j < len; j += stride) {
        var bx2 = sp[j];
        var by2 = sp[j + 1];
        var btype = sp[j + 2];
        var bval = sp[j + 4] * pulse;
        if (bval < 0.05) continue;

        var bpx = bx2 * scaleX;
        var bpy = by2 * scaleY;
        var bsz = sp[j + 3] * scaleX * 2;

        if (btype === 0) {
          ctx.fillStyle = "rgba(0," + Math.round(bval * 200) + ",0," + (bval * 0.3).toFixed(3) + ")";
        } else if (btype === 1) {
          ctx.fillStyle = "rgba(" + Math.round(bval * 180) + ",0,0," + (bval * 0.3).toFixed(3) + ")";
        } else {
          ctx.fillStyle = "rgba(0,0," + Math.round(bval * 200) + "," + (bval * 0.3).toFixed(3) + ")";
        }
        ctx.beginPath();
        ctx.arc(bpx, bpy, bsz, 0, 6.2832);
        ctx.fill();
      }

      ctx.restore();
    }
  }

  // ── RAF loop ─────────────────────────────────────

  var lastFrame = 0;
  var mobileInterval = isMobile ? 33 : 0;

  function frame(time) {
    requestAnimationFrame(frame);
    if (mobileInterval && time - lastFrame < mobileInterval) return;
    lastFrame = time;
    draw(time);
  }

  // ── Events ───────────────────────────────────────

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

  // ── Init ─────────────────────────────────────────

  rebuild();
  requestAnimationFrame(frame);

  window.__lattice = {
    updateWeather: updateWeather,
    weather: weather,
    rebuild: rebuild,
  };
})();
