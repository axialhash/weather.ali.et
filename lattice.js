/**
 * lattice.js — AMOLED Diamond PenTile lattice (v3 — direct render, no buffer)
 *
 * Weather scene rendered directly through the subpixel grid.
 * No offscreen buffer, no getImageData — each subpixel calculates its own color
 * based on position, weather data, and time.
 */

(function () {
  "use strict";

  var canvas = document.getElementById("lattice");
  if (!canvas) return;
  var ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });

  var W = 1, H = 1;
  var subpixels = [];
  var isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);

  // Sensor data (from Arduino)
  var sensor = { temp: null, humidity: null, light: null };

  // Weather data (from Open-Meteo)
  var weather = {
    cloud_cover: 0,
    wind_speed: 0,
    wind_direction: 0,
    precipitation: 0,
    condition: "clear",
    temperature: 22,
    humidity: 50,
    sunrise: null,
    sunset: null,
  };

  var PITCH = isMobile ? 10 : 7;

  // ── Sun altitude from sunrise/sunset ────────────────────────────

  function sunAlt() {
    var sr = weather.sunrise, ss = weather.sunset;
    if (!sr || !ss) return 0.3;
    var now = Date.now();
    var dl = ss.getTime() - sr.getTime();
    if (dl <= 0) return -0.3;
    var elapsed = now - sr.getTime();
    // Extend range a bit: sun rises above horizon earlier in visual
    return Math.max(-0.3, Math.min(1.0, Math.sin((elapsed / dl) * Math.PI)));
  }

  function moonPhase() {
    var knownNew = Date.UTC(2000, 0, 6, 18, 14, 0);
    var diff = (Date.now() - knownNew) / 86400000;
    return (diff % 29.53058867) / 29.53058867;
  }

  // ── Rebuild subpixel grid ───────────────────────────────────────

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
    var greenR = Math.max(0.5, baseR * 0.7);
    var diamondR = Math.max(0.5, baseR * 0.75);

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

    subpixels = [];
    for (var i = 0; i < len; i++) {
      var base = i * 4;
      var sx = draft[base] + offX;
      var sy = draft[base + 1] + offY;
      if (sx < -pad || sx > W + pad || sy < -pad || sy > H + pad) continue;
      // Store: x, y, type(0=g,1=r,2=b), radius, normalizedX, normalizedY
      subpixels.push(sx, sy, draft[base + 2], draft[base + 3], sx / W, sy / H);
    }
  }

  // ── Color calculation per subpixel ──────────────────────────────

  function skyColor(nx, ny, alt, clouds) {
    // nx: 0=left, 1=right. ny: 0=top, 1=bottom
    var r, g, b;

    if (alt < -0.08) {
      // Night
      var nightDark = Math.max(0, Math.min(1, (alt + 0.3) / 0.22));
      r = 4 + nightDark * 8;
      g = 4 + nightDark * 8;
      b = 15 + nightDark * 25;
    } else if (alt < 0.08) {
      // Dawn/dusk
      var t = (alt + 0.08) / 0.16; // 0..1
      var horizon = Math.max(0, 1 - ny * 1.8); // brighter at bottom
      var cloudBoost = 1 + (clouds / 100) * 0.6;

      r = 8 + t * 12 + horizon * 50 * cloudBoost * t;
      g = 6 + t * 8 + horizon * 20 * cloudBoost * t;
      b = 20 + t * 15 - horizon * 5 * t;
    } else if (alt < 0.35) {
      // Golden hour
      var t = (alt - 0.08) / 0.27;
      var horizon = Math.max(0, 1 - ny * 2);
      r = 15 + t * 15 + horizon * 25 * (1 - t);
      g = 12 + t * 20 + horizon * 10 * (1 - t);
      b = 30 + t * 40;
    } else {
      // Day
      var cloudDesat = clouds / 100;
      r = 15 + (1 - cloudDesat) * 10 + cloudDesat * 25;
      g = 25 + (1 - cloudDesat) * 15 + cloudDesat * 20;
      b = 65 + (1 - cloudDesat) * 30 - cloudDesat * 15;
    }

    // Darken toward top (zenith is darker)
    var zenithDark = 1 - ny * 0.3;
    r *= zenithDark;
    g *= zenithDark;
    b *= zenithDark;

    return [
      Math.max(0, Math.min(255, Math.round(r))),
      Math.max(0, Math.min(255, Math.round(g))),
      Math.max(0, Math.min(255, Math.round(b)))
    ];
  }

  function getSubpixelColor(type, skyR, skyG, skyB) {
    // Diamond PenTile: green = circle, red = diamond, blue = diamond
    if (type === 0) return [0, skyG, 0];        // Green
    if (type === 1) return [skyR, 0, 0];         // Red
    return [0, 0, skyB];                          // Blue
  }

  // ── Render ──────────────────────────────────────────────────────

  var lastFrame = 0;

  function draw(time) {
    var alt = sunAlt();
    var phase = moonPhase();
    var clouds = weather.cloud_cover;
    var wind = weather.wind_speed;
    var windDir = weather.wind_direction || 0;
    var precip = weather.precipitation;
    var cond = weather.condition;
    var sceneFrac = 0.6; // top 60% is sky, bottom 40% is sensor data area

    // Wind
    var windRad = (windDir * Math.PI) / 180;
    var windDx = Math.sin(windRad) * (wind / 15);
    var windDy = -Math.cos(windRad) * (wind / 15);

    // Clear canvas
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);

    // Sun position (in screen coordinates)
    var sunX = 0;
    var sunY = 0;
    var sunVisible = false;
    if (alt > 0.01) {
      sunX = W * 0.15 + W * 0.7 * (1 - Math.min(1, alt));
      sunY = H * sceneFrac * 0.15 + H * sceneFrac * 0.35 * (1 - alt);
      sunVisible = true;
    }

    // Moon position
    var moonX = W * 0.78;
    var moonY = H * sceneFrac * 0.15;
    var moonVisible = alt < 0.05;

    var sp = subpixels;
    var len = sp.length;
    var stride = 6;

    for (var i = 0; i < len; i += stride) {
      var x = sp[i];
      var y = sp[i + 1];
      var type = sp[i + 2];
      var radius = sp[i + 3];
      var nx = sp[i + 4];
      var ny = sp[i + 5];

      var r = 0, g = 0, b = 0;

      // Upper 60%: sky
      if (ny < sceneFrac) {
        var skyNorm = ny / sceneFrac; // 0..1 within sky area
        var sky = skyColor(nx, skyNorm, alt, clouds);
        r = sky[0]; g = sky[1]; b = sky[2];

        // Sun glow
        if (sunVisible) {
          var sdx = x - sunX;
          var sdy = y - sunY;
          var sDist = Math.sqrt(sdx * sdx + sdy * sdy);
          var sunGlowR = W * 0.12;
          if (sDist < sunGlowR) {
            var glow = 1 - sDist / sunGlowR;
            glow = glow * glow;
            var sunBright = Math.max(0.1, alt) * (1 - clouds / 180);
            r += glow * 200 * sunBright;
            g += glow * 140 * sunBright;
            b += glow * 40 * sunBright;
          }
          // Sun core
          var coreR = W * 0.012;
          if (sDist < coreR) {
            var coreBright = 1 - sDist / coreR;
            r += coreBright * 255 * alt;
            g += coreBright * 220 * alt;
            b += coreBright * 100 * alt;
          }
        }

        // Moon glow
        if (moonVisible) {
          var mdx = x - moonX;
          var mdy = y - moonY;
          var mDist = Math.sqrt(mdx * mdx + mdy * mdy);
          var moonGlowR = W * 0.04;
          if (mDist < moonGlowR) {
            var mglow = 1 - mDist / moonGlowR;
            mglow = mglow * mglow;
            var moonBright = Math.max(0.1, Math.abs(alt) * 3) * Math.max(0.15, 1 - clouds / 130);
            r += mglow * 100 * moonBright;
            g += mglow * 120 * moonBright;
            b += mglow * 180 * moonBright;
          }
          // Moon core with phase
          var mCoreR = W * 0.008;
          if (mDist < mCoreR) {
            var mCore = 1 - mDist / mCoreR;
            var mp = phase;
            // Simple phase mask: darken one side based on phase
            var phaseMask = 1;
            var moonRadius = mCoreR;
            var relX = (mdx + moonRadius) / (moonRadius * 2); // 0..1
            if (mp < 0.25) phaseMask = relX < mp * 4 ? 0.2 : 1;
            else if (mp < 0.5) phaseMask = relX > (0.5 - mp) * 2 ? 0.2 : 1;
            else if (mp < 0.75) phaseMask = relX > (mp - 0.5) * 4 ? 1 : 0.2;
            else phaseMask = relX < (1 - mp) * 4 ? 1 : 0.2;

            var moonInt = Math.max(0.15, 1 - clouds / 130);
            r += mCore * 180 * moonInt * phaseMask;
            g += mCore * 195 * moonInt * phaseMask;
            b += mCore * 230 * moonInt * phaseMask;
          }
        }

        // Clouds
        if (clouds > 5) {
          // Pseudo-random cloud density based on position
          var cloudDensity = 0;
          var t = time * 0.00003 + windDx * 0.5;
          for (var c = 0; c < 6; c++) {
            var cx = (Math.sin(c * 1.7 + t) * 0.3 + 0.5) * W;
            var cy = (0.05 + c * 0.09) * H * sceneFrac;
            var cdx = x - cx;
            var cdy = y - cy;
            var cDist = Math.sqrt(cdx * cdx + cdy * cdy);
            var cW = W * (0.08 + (c % 3) * 0.04) * (0.5 + clouds / 200);
            var cH = H * 0.015 * (0.5 + clouds / 200);
            if (Math.abs(cdx) < cW && Math.abs(cdy) < cH) {
              var edge = 1 - Math.max(Math.abs(cdx) / cW, Math.abs(cdy) / cH);
              cloudDensity = Math.max(cloudDensity, edge * clouds / 100);
            }
          }
          // Clouds darken the sky and add grey
          var cloudMix = cloudDensity * 0.5;
          r = r * (1 - cloudMix) + 55 * cloudMix;
          g = g * (1 - cloudMix) + 60 * cloudMix;
          b = b * (1 - cloudMix) + 75 * cloudMix;
        }

        // Rain
        if (precip > 0.1 && (cond === "rain" || cond === "drizzle" || cond === "rain_showers" || cond === "thunderstorm")) {
          // Pseudo-random rain streaks
          var rainPhase = time * 0.003 + wind * 0.1;
          for (var ri = 0; ri < 12; ri++) {
            var rx = ((Math.sin(ri * 7.3 + rainPhase) * 0.5 + 0.5) * W + windDx * time * 0.02) % W;
            var ry = ((time * 0.3 + ri * 97) % (H * sceneFrac));
            var rDist = Math.abs(x - rx);
            var rDistY = Math.abs(y - ry);
            if (rDist < 1.5 && rDistY < H * 0.015) {
              var rBright = Math.min(1, precip / 5) * (1 - rDist / 1.5);
              r += rBright * 60;
              g += rBright * 100;
              b += rBright * 200;
            }
          }
        }

        // Lightning
        if (cond === "thunderstorm") {
          var flash = Math.sin(time * 0.007) * Math.sin(time * 0.013);
          if (flash > 0.95) {
            var flashAmt = (flash - 0.95) * 20;
            r += flashAmt * 150;
            g += flashAmt * 160;
            b += flashAmt * 200;
          }
        }
      } else {
        // Bottom 40%: sensor data area (very subtle)
        r = 2; g = 2; b = 4;
      }

      // Clamp
      r = Math.max(0, Math.min(255, Math.round(r)));
      g = Math.max(0, Math.min(255, Math.round(g)));
      b = Math.max(0, Math.min(255, Math.round(b)));

      // Apply Diamond PenTile color filter
      var final = getSubpixelColor(type, r, g, b);
      var brightness = (final[0] + final[1] + final[2]) / 255;
      if (brightness < 0.005) continue;

      // Draw subpixel
      if (type === 0) {
        // Green: circle
        ctx.fillStyle = "rgba(" + final[0] + "," + final[1] + "," + final[2] + "," + Math.min(1, brightness * 2 + 0.15).toFixed(3) + ")";
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, 6.2832);
        ctx.fill();
      } else {
        // Red/Blue: diamond (rotated square)
        ctx.fillStyle = "rgba(" + final[0] + "," + final[1] + "," + final[2] + "," + Math.min(1, brightness * 2 + 0.15).toFixed(3) + ")";
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(Math.PI / 4);
        var dSize = radius * 0.72;
        ctx.fillRect(-dSize, -dSize, dSize * 2, dSize * 2);
        ctx.restore();
      }
    }

    // Draw sensor values as DOM-like text in the lower area
    drawSensorOverlay();

    requestAnimationFrame(draw);
  }

  // ── Sensor text overlay ─────────────────────────────────────────

  function drawSensorOverlay() {
    if (sensor.temp == null && sensor.humidity == null) return;

    var centerY = H * 0.78;
    var centerX = W / 2;

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    if (sensor.temp != null) {
      ctx.font = "bold " + (isMobile ? 32 : 48) + "px 'JetBrains Mono', monospace";
      ctx.fillStyle = "rgba(242,244,248,0.9)";
      ctx.fillText(sensor.temp.toFixed(1) + "\u00B0C", centerX, centerY);
    }

    if (sensor.humidity != null) {
      ctx.font = (isMobile ? 16 : 22) + "px 'JetBrains Mono', monospace";
      ctx.fillStyle = "rgba(87,115,153,0.7)";
      ctx.fillText(sensor.humidity.toFixed(0) + "% humid", centerX - (isMobile ? 50 : 80), centerY + (isMobile ? 35 : 50));
    }

    if (sensor.light != null) {
      ctx.fillStyle = "rgba(243,202,64,0.6)";
      ctx.fillText(sensor.light.toFixed(0) + "% light", centerX + (isMobile ? 50 : 80), centerY + (isMobile ? 35 : 50));
    }
  }

  // ── Resize ──────────────────────────────────────────────────────

  var resizeTimer;
  window.addEventListener("resize", function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(rebuild, 100);
  });

  // ── Data API for app.js ─────────────────────────────────────────

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

  window.__lattice = {
    updateSensor: updateSensor,
    updateWeather: updateWeather,
  };

})();
