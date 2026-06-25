/**
 * lattice.js — AMOLED Diamond PenTile lattice (v4)
 *
 * Direct subpixel rendering — no offscreen buffer, no getImageData.
 * Each subpixel calculates its own color from position + data.
 *
 * Bottom 40%: sensor values as lattice-colored progress bars + text overlay.
 */

(function () {
  "use strict";

  var canvas = document.getElementById("lattice");
  if (!canvas) return;
  var ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });

  var W = 1, H = 1;
  var subpixels = [];
  var isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);

  // ── Data state ──────────────────────────────────────────────────

  var sensor = { temp: null, humidity: null, light: null };
  var weather = {
    cloud_cover: 0, wind_speed: 0, wind_direction: 0,
    precipitation: 0, condition: "clear",
    temperature: 22, humidity: 50,
    sunrise: null, sunset: null,
    sun_altitude: 0,
  };

  var PITCH = isMobile ? 10 : 7;

  // ── Sun / moon ──────────────────────────────────────────────────

  function sunAlt() {
    // Use server-calculated altitude but clamp to reasonable visual range
    var alt = weather.sun_altitude || 0;
    // If within ~30 min of sunrise/sunset, smooth it a bit
    return Math.max(-0.3, Math.min(1.0, alt));
  }

  function moonPhaseCalc() {
    var knownNew = Date.UTC(2000, 0, 6, 18, 14, 0);
    var diff = (Date.now() - knownNew) / 86400000;
    return (diff % 29.53058867) / 29.53058867;
  }

  // ── Rebuild grid ────────────────────────────────────────────────

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
    var baseR = Math.min(pitchX, pitchY) * 0.42;
    var greenR = Math.max(0.5, baseR * 0.68);
    var diamondR = Math.max(0.5, baseR * 0.72);

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
        if (!isGreen) type = ((Math.floor(col / 2) + row) & 1) === 0 ? 1 : 2;
        draft.push(cx, cy, type, isGreen ? greenR : diamondR);
      }
    }
    var len = draft.length / 4;
    var cx0 = draft[0], cy0 = draft[1];
    var cx1 = draft[(len - 1) * 4], cy1 = draft[(len - 1) * 4 + 1];
    var offX = (W - (cx0 + cx1)) * 0.5;
    var offY = (H - (cy0 + cy1)) * 0.5;
    var pad = Math.max(greenR, diamondR) + 2;

    subpixels = [];
    for (var i = 0; i < len; i++) {
      var base = i * 4;
      var sx = draft[base] + offX;
      var sy = draft[base + 1] + offY;
      if (sx < -pad || sx > W + pad || sy < -pad || sy > H + pad) continue;
      subpixels.push(sx, sy, draft[base + 2], draft[base + 3], sx / W, sy / H);
    }
  }

  // ── Sky color at normalized position ────────────────────────────

  function skyRGB(nx, ny, alt, clouds) {
    // nx, ny: 0..1 across the sky area
    var r, g, b;

    if (alt < -0.05) {
      // Night / deep twilight
      var bright = Math.max(0, (alt + 0.3) / 0.25); // 0 at -0.3, 1 at -0.05
      r = 4 + bright * 12;
      g = 4 + bright * 10;
      b = 12 + bright * 30;
    } else if (alt < 0.1) {
      // Dawn / dusk — warm horizon, cool zenith
      var t = (alt + 0.05) / 0.15; // 0..1
      var horizon = Math.max(0, 1 - ny * 2.2);
      var cb = 1 + (clouds / 100) * 0.8;
      r = 10 + t * 15 + horizon * 80 * cb * Math.min(1, t + 0.3);
      g = 8 + t * 10 + horizon * 30 * cb * Math.min(1, t + 0.2);
      b = 25 + t * 20 - horizon * 10 * t;
    } else if (alt < 0.4) {
      // Golden hour → full day
      var t = (alt - 0.1) / 0.3;
      var horizon = Math.max(0, 1 - ny * 2.5);
      r = 20 + t * 20 + horizon * 30 * (1 - t);
      g = 18 + t * 25 + horizon * 12 * (1 - t);
      b = 40 + t * 45;
    } else {
      // Full day
      var cd = clouds / 100;
      r = 18 + (1 - cd) * 15 + cd * 30;
      g = 30 + (1 - cd) * 18 + cd * 25;
      b = 75 + (1 - cd) * 35 - cd * 20;
    }

    // Zenith darkening
    var zd = 1 - ny * 0.25;
    r *= zd; g *= zd; b *= zd;

    return [
      Math.max(0, Math.min(255, Math.round(r))),
      Math.max(0, Math.min(255, Math.round(g))),
      Math.max(0, Math.min(255, Math.round(b)))
    ];
  }

  // ── Sensor bar zones ────────────────────────────────────────────
  // Three horizontal bars in the bottom 40%, each occupying a band.
  // Left-to-right fill = value percentage.
  // Color of lit subpixels encodes the value.

  function sensorBarRGB(nx, ny, barNyStart, barNyEnd, value01, baseR, baseG, baseB) {
    // nx: 0..1 left to right, ny: normalized Y within entire screen
    // barNyStart/end: Y range for this bar (0..1 of screen)
    if (ny < barNyStart || ny > barNyEnd) return null;

    var barH = barNyEnd - barNyStart;
    var barNy = (ny - barNyStart) / barH; // 0..1 within bar

    // Vertical: bright in center, fade at edges
    var vFade = 1 - Math.abs(barNy - 0.5) * 2.5;
    if (vFade <= 0) return null;

    // Horizontal: fill up to value01
    if (nx > value01) return null;

    // Intensity: full at the leading edge, slight gradient
    var edge = Math.max(0, 1 - (value01 - nx) * 3);
    var intensity = 0.4 + edge * 0.6;

    return [
      Math.round(baseR * intensity * vFade),
      Math.round(baseG * intensity * vFade),
      Math.round(baseB * intensity * vFade)
    ];
  }

  // ── Main render loop ────────────────────────────────────────────

  function draw(time) {
    var alt = sunAlt();
    var phase = moonPhaseCalc();
    var clouds = weather.cloud_cover;
    var wind = weather.wind_speed;
    var windDir = weather.wind_direction || 0;
    var precip = weather.precipitation;
    var cond = weather.condition;

    var skyFrac = 0.55; // top 55% is sky
    var barTop = 0.60;  // sensor bars start at 60%
    var barGap = 0.09;  // gap between bars

    // Wind vector
    var windRad = (windDir * Math.PI) / 180;
    var windDx = Math.sin(windRad) * (wind / 15);

    // Sun position in screen coords
    var sunX = 0, sunY = 0, sunVis = false;
    if (alt > 0.01) {
      sunX = W * 0.15 + W * 0.7 * Math.max(0, 1 - alt * 2);
      sunY = skyFrac * H * (0.4 - alt * 0.35);
      sunVis = true;
    }

    // Moon
    var moonX = W * 0.8;
    var moonY = skyFrac * H * 0.12;
    var moonVis = alt < 0.05;
    var moonI = moonVis ? Math.max(0.1, Math.abs(Math.min(0, alt)) * 4) * Math.max(0.15, 1 - clouds / 140) : 0;

    // Sensor value ranges
    var temp01 = sensor.temp != null ? Math.max(0, Math.min(1, (sensor.temp + 5) / 45)) : 0; // -5°C..40°C → 0..1
    var hum01 = sensor.humidity != null ? sensor.humidity / 100 : 0;
    var light01 = sensor.light != null ? sensor.light / 100 : 0;

    // Clear
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);

    var sp = subpixels;
    var len = sp.length;
    for (var i = 0; i < len; i += 6) {
      var x = sp[i];
      var y = sp[i + 1];
      var type = sp[i + 2];
      var radius = sp[i + 3];
      var nx = sp[i + 4];
      var ny = sp[i + 5];

      var r = 0, g = 0, b = 0;

      if (ny < skyFrac) {
        // ── SKY ZONE ──
        var skyN = ny / skyFrac;
        var sky = skyRGB(nx, skyN, alt, clouds);
        r = sky[0]; g = sky[1]; b = sky[2];

        // Sun glow
        if (sunVis) {
          var sdx = x - sunX, sdy = y - sunY;
          var sDist = Math.sqrt(sdx * sdx + sdy * sdy);
          var gR = W * 0.15;
          if (sDist < gR) {
            var glow = Math.pow(1 - sDist / gR, 2);
            var sb = Math.max(0.15, alt) * (1 - clouds / 200);
            r += glow * 220 * sb;
            g += glow * 160 * sb;
            b += glow * 50 * sb;
          }
          // Core
          var cR = W * 0.012;
          if (sDist < cR) {
            var cb2 = 1 - sDist / cR;
            r += cb2 * 255 * Math.min(1, alt * 3);
            g += cb2 * 230 * Math.min(1, alt * 3);
            b += cb2 * 120 * Math.min(1, alt * 3);
          }
        }

        // Moon
        if (moonVis && moonI > 0.01) {
          var mdx = x - moonX, mdy = y - moonY;
          var mDist = Math.sqrt(mdx * mdx + mdy * mdy);
          var mGlow = W * 0.04;
          if (mDist < mGlow) {
            var mg = Math.pow(1 - mDist / mGlow, 2);
            r += mg * 100 * moonI;
            g += mg * 120 * moonI;
            b += mg * 200 * moonI;
          }
          var mCore = W * 0.007;
          if (mDist < mCore) {
            var mc = (1 - mDist / mCore) * moonI;
            // Phase mask
            var relX = (mdx + mCore) / (mCore * 2);
            var pm = 1;
            if (phase < 0.25) pm = relX < phase * 4 ? 0.15 : 1;
            else if (phase < 0.5) pm = relX > (0.5 - phase) * 2 ? 0.15 : 1;
            else if (phase < 0.75) pm = relX > (phase - 0.5) * 4 ? 1 : 0.15;
            else pm = relX < (1 - phase) * 4 ? 1 : 0.15;
            r += mc * 190 * pm;
            g += mc * 200 * pm;
            b += mc * 240 * pm;
          }
        }

        // Clouds
        if (clouds > 3) {
          var cd = 0;
          var ct = time * 0.000025 + windDx * 0.3;
          for (var c = 0; c < 8; c++) {
            var ccx = ((Math.sin(c * 1.9 + ct) * 0.35 + 0.5) * W * 1.2 - W * 0.1);
            var ccy = (0.04 + c * 0.07) * skyFrac * H;
            var cDx = x - ccx, cDy = y - ccy;
            var cw = W * (0.07 + (c % 3) * 0.035) * (0.6 + clouds / 200);
            var ch = H * 0.018 * (0.6 + clouds / 200);
            if (Math.abs(cDx) < cw && Math.abs(cDy) < ch) {
              var edge = 1 - Math.max(Math.abs(cDx) / cw, Math.abs(cDy) / ch);
              cd = Math.max(cd, edge * edge * clouds / 100);
            }
          }
          var cm = cd * 0.55;
          r = r * (1 - cm) + 60 * cm;
          g = g * (1 - cm) + 65 * cm;
          b = b * (1 - cm) + 80 * cm;
        }

        // Rain streaks
        if (precip > 0.1 && (cond === "rain" || cond === "drizzle" || cond === "rain_showers" || cond === "thunderstorm")) {
          var rPh = time * 0.004;
          for (var ri = 0; ri < 15; ri++) {
            var rx = ((Math.sin(ri * 5.7 + rPh) * 0.5 + 0.5) * W + windDx * time * 0.015) % W;
            var ry = ((time * 0.4 + ri * 83) % (skyFrac * H));
            if (Math.abs(x - rx) < 1.5 && Math.abs(y - ry) < H * 0.012) {
              var rb = Math.min(1, precip / 4) * (1 - Math.abs(x - rx) / 1.5);
              r += rb * 50; g += rb * 90; b += rb * 210;
            }
          }
        }

        // Lightning
        if (cond === "thunderstorm") {
          var flash = Math.sin(time * 0.008) * Math.sin(time * 0.011);
          if (flash > 0.93) {
            var fa = (flash - 0.93) * 14;
            r += fa * 160; g += fa * 170; b += fa * 220;
          }
        }
      } else {
        // ── SENSOR ZONE (bottom 45%) ──
        // Dark base
        r = 2; g = 2; b = 4;

        // Three sensor bars
        var bar1Top = barTop;
        var bar1Bot = barTop + barGap;
        var bar2Top = bar1Bot + 0.02;
        var bar2Bot = bar2Top + barGap;
        var bar3Top = bar2Bot + 0.02;
        var bar3Bot = bar3Top + barGap;

        // Temperature bar (warm colors: blue→orange→red)
        var tBar = sensorBarRGB(nx, ny, bar1Top, bar1Bot, temp01, 255, 140, 40);
        if (tBar) { r = tBar[0]; g = tBar[1]; b = tBar[2]; }

        // Humidity bar (blue tones)
        var hBar = sensorBarRGB(nx, ny, bar2Top, bar2Bot, hum01, 50, 120, 220);
        if (hBar) { r = hBar[0]; g = hBar[1]; b = hBar[2]; }

        // Light bar (gold/amber)
        var lBar = sensorBarRGB(nx, ny, bar3Top, bar3Bot, light01, 240, 190, 50);
        if (lBar) { r = lBar[0]; g = lBar[1]; b = lBar[2]; }
      }

      // Clamp
      r = Math.max(0, Math.min(255, Math.round(r)));
      g = Math.max(0, Math.min(255, Math.round(g)));
      b = Math.max(0, Math.min(255, Math.round(b)));

      // Diamond PenTile filter
      var fr, fg, fb;
      if (type === 0) { fr = 0; fg = g; fb = 0; }
      else if (type === 1) { fr = r; fg = 0; fb = 0; }
      else { fr = 0; fg = 0; fb = b; }

      var bright = (fr + fg + fb) / 255;
      if (bright < 0.004) continue;

      var alpha = Math.min(1, bright * 2.2 + 0.12);

      if (type === 0) {
        ctx.fillStyle = "rgba(" + fr + "," + fg + "," + fb + "," + alpha.toFixed(3) + ")";
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, 6.2832);
        ctx.fill();
      } else {
        ctx.fillStyle = "rgba(" + fr + "," + fg + "," + fb + "," + alpha.toFixed(3) + ")";
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(Math.PI / 4);
        var ds = radius * 0.72;
        ctx.fillRect(-ds, -ds, ds * 2, ds * 2);
        ctx.restore();
      }
    }

    // ── Text overlay ──
    drawTextOverlay();

    requestAnimationFrame(draw);
  }

  // ── Text overlay for sensor values ──────────────────────────────

  function drawTextOverlay() {
    if (sensor.temp == null && sensor.humidity == null && sensor.light == null) return;

    var barTop = H * 0.60;
    var barGap = H * 0.09;
    var fontSize = isMobile ? 13 : 16;
    var labelSize = isMobile ? 9 : 10;

    ctx.textBaseline = "middle";

    var bars = [
      { label: "TEMP", value: sensor.temp != null ? sensor.temp.toFixed(1) + "°C" : "--", y: barTop + barGap * 0.5, color: "rgba(255,160,60,0.9)" },
      { label: "HUMID", value: sensor.humidity != null ? sensor.humidity.toFixed(0) + "%" : "--", y: barTop + barGap + 0.02 * H + barGap * 0.5, color: "rgba(60,140,240,0.9)" },
      { label: "LIGHT", value: sensor.light != null ? sensor.light.toFixed(0) + "%" : "--", y: barTop + (barGap + 0.02 * H) * 2 + barGap * 0.5, color: "rgba(250,200,60,0.85)" },
    ];

    for (var i = 0; i < bars.length; i++) {
      var bar = bars[i];

      // Label (left)
      ctx.font = labelSize + "px 'JetBrains Mono', monospace";
      ctx.textAlign = "left";
      ctx.fillStyle = "rgba(242,244,248,0.3)";
      ctx.fillText(bar.label, W * 0.06, bar.y - fontSize * 0.6);

      // Value (left, larger)
      ctx.font = "bold " + fontSize + "px 'JetBrains Mono', monospace";
      ctx.textAlign = "left";
      ctx.fillStyle = bar.color;
      ctx.fillText(bar.value, W * 0.06, bar.y + fontSize * 0.3);

      // Percentage on the right
      var pct = "";
      if (i === 0 && sensor.temp != null) pct = Math.round(Math.max(0, Math.min(100, (sensor.temp + 5) / 45 * 100))) + "%";
      else if (i === 1 && sensor.humidity != null) pct = sensor.humidity.toFixed(0) + "%";
      else if (i === 2 && sensor.light != null) pct = sensor.light.toFixed(0) + "%";
      if (pct) {
        ctx.font = labelSize + "px 'JetBrains Mono', monospace";
        ctx.textAlign = "right";
        ctx.fillStyle = "rgba(242,244,248,0.25)";
        ctx.fillText(pct, W * 0.94, bar.y + fontSize * 0.3);
      }
    }

    // Outdoor temp from weather API (small, subtle)
    if (weather.temperature != null) {
      ctx.font = (labelSize - 1) + "px 'JetBrains Mono', monospace";
      ctx.textAlign = "center";
      ctx.fillStyle = "rgba(242,244,248,0.18)";
      ctx.fillText("outdoor " + weather.temperature.toFixed(1) + "°C", W * 0.5, H * 0.96);
    }
  }

  // ── Resize ──────────────────────────────────────────────────────

  var resizeTimer;
  window.addEventListener("resize", function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(rebuild, 100);
  });

  // ── Data API ────────────────────────────────────────────────────

  function updateSensor(data) {
    if (!data) return;
    if (data.temp != null) sensor.temp = data.temp;
    if (data.humidity != null) sensor.humidity = data.humidity;
    if (data.light != null) sensor.light = data.light;
  }

  function updateWeather(data) {
    if (!data) return;
    if (data.cloud_cover != null) weather.cloud_cover = data.cloud_cover;
    if (data.wind_speed != null) weather.wind_speed = data.wind_speed;
    if (data.wind_direction != null) weather.wind_direction = data.wind_direction;
    if (data.precipitation != null) weather.precipitation = data.precipitation;
    if (data.condition) weather.condition = data.condition;
    if (data.temperature != null) weather.temperature = data.temperature;
    if (data.humidity != null) weather.humidity = data.humidity;
    if (data.sun_altitude != null) weather.sun_altitude = data.sun_altitude;
    if (data.sunrise) {
      var sr = data.sunrise;
      if (typeof sr === "string") weather.sunrise = new Date(sr.includes("T") ? sr : sr + "T06:00");
    }
    if (data.sunset) {
      var ss = data.sunset;
      if (typeof ss === "string") weather.sunset = new Date(ss.includes("T") ? ss : ss + "T18:00");
    }
  }

  // ── Init ────────────────────────────────────────────────────────

  rebuild();
  requestAnimationFrame(draw);

  window.__lattice = { updateSensor: updateSensor, updateWeather: updateWeather };
})();
