/**
 * lattice.js — Diamond PenTile AMOLED subpixel lattice.
 *
 * Approach (matching amoled-renderer.js):
 *  1. Draw weather into tiny offscreen canvas (FrameBuffer)
 *  2. Read RGB pixel data
 *  3. Each subpixel samples via nearest-neighbor
 *  4. Green subs → G channel, Red → R, Blue → B
 *  5. Render as circles (green) or diamonds (R/B)
 *
 * Base glow: subpixels always have a faint dim level (like real OLED inactive pixels).
 * Weather elements drive brightness up from that floor.
 */

(function () {
  "use strict";

  var canvas = document.getElementById("lattice");
  if (!canvas) return;
  var ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });

  var W = 1, H = 1;
  var subpixels = [];
  var isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);

  // Offscreen weather buffer (FrameBuffer)
  var bufCanvas, bufCtx;
  var BUF_W = 160;
  var BUF_H = 100;

  // Weather state
  var weather = {
    sun_altitude: 0.5,
    cloud_cover: 0,
    wind_speed: 0,
    condition: "clear",
    moon_phase: 0.5,
    temperature: 22,
    humidity: 50,
    light: 50,
  };

  var raindrops = [];
  var cloudDrift = 0;
  var lastTime = 0;

  // Config — smaller pitch = higher resolution lattice
  var PITCH = isMobile ? 8 : 5;
  var BASE_BRIGHTNESS = 12;
  var WEATHER_MULT = 1.6;

  // Geometry rebuild
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
    var baseR = Math.min(pitchX, pitchY) * 0.45;
    var greenR = Math.max(0.4, baseR * 0.7);
    var diamondR = Math.max(0.4, baseR * 0.8);

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
      if (sx < pad || sx > W - pad || sy < pad || sy > H - pad) continue;

      var normX = sx / W;
      var normY = sy / H;

      subpixels.push(sx, sy, draft[base + 2], draft[base + 3], normX, normY);
    }
  }

  // Weather update
  function updateWeather(data) {
    if (!data) return;
    if (data.sun_altitude != null) weather.sun_altitude = data.sun_altitude;
    if (data.cloud_cover != null) weather.cloud_cover = data.cloud_cover;
    if (data.wind_speed != null) weather.wind_speed = data.wind_speed;
    if (data.condition) weather.condition = data.condition;
    if (data.moon_phase != null) weather.moon_phase = data.moon_phase;
    if (data.temperature != null) weather.temperature = data.temperature;
    if (data.humidity != null) weather.humidity = data.humidity;
    if (data.light != null) weather.light = data.light;

    var cond = weather.condition;
    if (cond === "rain" || cond === "drizzle" || cond === "rain_showers") {
      var target = cond === "drizzle" ? 20 : 40;
      while (raindrops.length < target) {
        raindrops.push(Math.random() * BUF_W, Math.random() * BUF_H, 0.4 + Math.random() * 0.8);
      }
      while (raindrops.length > target * 3) raindrops.pop();
    } else {
      raindrops.length = 0;
    }
  }

  // Draw weather into tiny buffer
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

    // Background color wash based on temperature
    var tempNorm = Math.max(0, Math.min(1, (weather.temperature - 10) / 30));
    var bgR = Math.round(tempNorm * 15);
    var bgB = Math.round((1 - tempNorm) * 15);
    bufCtx.fillStyle = "rgb(" + bgR + ",2," + bgB + ")";
    bufCtx.fillRect(0, 0, BUF_W, BUF_H);

    // Sun
    if (sunAlt > 0.01) {
      var sx = BUF_W * 0.15 + BUF_W * 0.7 * (1 - sunAlt);
      var sy = BUF_H * 0.3 - Math.sin((1 - sunAlt) * Math.PI) * BUF_H * 0.25;
      var sunR = 4 + sunAlt * 6;

      var grad = bufCtx.createRadialGradient(sx, sy, 0, sx, sy, sunR * 4);
      var warm = sunAlt > 0.5 ? [255, 200, 80] : [255, 140, 60];
      grad.addColorStop(0, "rgba(" + warm[0] + "," + warm[1] + "," + warm[2] + "," + (sunAlt * 0.6).toFixed(2) + ")");
      grad.addColorStop(0.5, "rgba(" + warm[0] + "," + warm[1] + "," + warm[2] + "," + (sunAlt * 0.15).toFixed(2) + ")");
      grad.addColorStop(1, "rgba(" + warm[0] + "," + warm[1] + "," + warm[2] + ",0)");
      bufCtx.fillStyle = grad;
      bufCtx.beginPath();
      bufCtx.arc(sx, sy, sunR * 4, 0, 6.2832);
      bufCtx.fill();

      bufCtx.fillStyle = "rgba(255,240,180," + Math.min(1, sunAlt * 1.5).toFixed(2) + ")";
      bufCtx.beginPath();
      bufCtx.arc(sx, sy, sunR, 0, 6.2832);
      bufCtx.fill();
    }

    // Moon
    var moonInt = sunAlt < 0.05 ? (1 - sunAlt / 0.05) : 0;
    if (moonInt > 0.01) {
      var mx = BUF_W * 0.75;
      var my = BUF_H * 0.15;
      var moonR = 4;

      var mg = bufCtx.createRadialGradient(mx, my, 0, mx, my, moonR * 5);
      mg.addColorStop(0, "rgba(180,200,255," + (moonInt * 0.25).toFixed(2) + ")");
      mg.addColorStop(0.5, "rgba(180,200,255," + (moonInt * 0.05).toFixed(2) + ")");
      mg.addColorStop(1, "rgba(180,200,255,0)");
      bufCtx.fillStyle = mg;
      bufCtx.beginPath();
      bufCtx.arc(mx, my, moonR * 5, 0, 6.2832);
      bufCtx.fill();

      bufCtx.fillStyle = "rgba(200,215,255," + (moonInt * 0.9).toFixed(2) + ")";
      bufCtx.beginPath();
      bufCtx.arc(mx, my, moonR, 0, 6.2832);
      bufCtx.fill();

      var shadowW = moonR * Math.cos(weather.moon_phase * Math.PI * 2) * 0.8;
      bufCtx.fillStyle = "rgba(0,0,0," + (moonInt * 0.7).toFixed(2) + ")";
      bufCtx.beginPath();
      bufCtx.ellipse(mx + shadowW * 0.3, my, Math.abs(shadowW) + 1, moonR, 0, 0, 6.2832);
      bufCtx.fill();
    }

    // Clouds
    var cover = weather.cloud_cover;
    var numClouds = Math.min(6, Math.ceil(cover / 15));
    if (numClouds > 0) {
      cloudDrift += windDrift * 0.04;
      for (var c = 0; c < numClouds; c++) {
        var cx = ((c / numClouds) * BUF_W * 1.3 + cloudDrift + Math.sin(c * 2.1) * 12) % (BUF_W + 30) - 15;
        var cy = 8 + (c % 3) * 10;
        var cw = 14 + c * 3;
        var ch = 5 + (c % 2) * 2;
        var op = 0.2 + (cover / 100) * 0.4;

        bufCtx.fillStyle = "rgba(90,100,120," + op.toFixed(2) + ")";
        bufCtx.beginPath();
        bufCtx.ellipse(cx, cy, cw, ch, 0, 0, 6.2832);
        bufCtx.fill();
        bufCtx.beginPath();
        bufCtx.ellipse(cx - cw * 0.4, cy - 3, cw * 0.5, ch * 0.6, 0, 0, 6.2832);
        bufCtx.fill();
        bufCtx.beginPath();
        bufCtx.ellipse(cx + cw * 0.35, cy - 2, cw * 0.55, ch * 0.55, 0, 0, 6.2832);
        bufCtx.fill();
      }
    }

    // Rain
    if (raindrops.length > 0) {
      bufCtx.strokeStyle = "rgba(100,160,255,0.7)";
      bufCtx.lineWidth = 1;
      for (var r = 0; r < raindrops.length; r += 3) {
        raindrops[r + 1] += raindrops[r + 2];
        raindrops[r] += windDrift * 0.03;
        if (raindrops[r + 1] > BUF_H) {
          raindrops[r] = Math.random() * BUF_W;
          raindrops[r + 1] = -2;
        }
        if (raindrops[r] > BUF_W) raindrops[r] = 0;
        if (raindrops[r] < 0) raindrops[r] = BUF_W;
        bufCtx.beginPath();
        bufCtx.moveTo(raindrops[r], raindrops[r + 1]);
        bufCtx.lineTo(raindrops[r] + windDrift * 0.02, raindrops[r + 1] + 2);
        bufCtx.stroke();
      }
    }

    // Snow
    if (weather.condition === "snow" || weather.condition === "snow_showers") {
      bufCtx.fillStyle = "rgba(220,230,255,0.8)";
      for (var s = 0; s < 20; s++) {
        var snx = (Math.sin(time / 3000 + s * 1.7) * 0.5 + 0.5) * BUF_W;
        var sny = ((time / 25 + s * BUF_H / 20) % BUF_H);
        bufCtx.beginPath();
        bufCtx.arc(snx, sny, 1, 0, 6.2832);
        bufCtx.fill();
      }
    }

    // Lightning
    if (weather.condition === "thunderstorm" && Math.random() < 0.01) {
      bufCtx.fillStyle = "rgba(255,255,255,0.5)";
      bufCtx.fillRect(0, 0, BUF_W, BUF_H);
    }

    // Humidity band at bottom
    var humidH = BUF_H * (weather.humidity / 100) * 0.3;
    if (humidH > 1) {
      var hGrad = bufCtx.createLinearGradient(0, BUF_H - humidH, 0, BUF_H);
      hGrad.addColorStop(0, "rgba(40,80,200,0)");
      hGrad.addColorStop(1, "rgba(40,80,200,0.12)");
      bufCtx.fillStyle = hGrad;
      bufCtx.fillRect(0, BUF_H - humidH, BUF_W, humidH);
    }

    // Light level glow from left
    var lightNorm = weather.light / 100;
    if (lightNorm > 0.05) {
      var lGrad = bufCtx.createLinearGradient(0, 0, BUF_W * 0.4, 0);
      var lAlpha = lightNorm * 0.15;
      lGrad.addColorStop(0, "rgba(255,200,100," + lAlpha.toFixed(3) + ")");
      lGrad.addColorStop(1, "rgba(255,200,100,0)");
      bufCtx.fillStyle = lGrad;
      bufCtx.fillRect(0, 0, BUF_W * 0.4, BUF_H);
    }
  }

  // Render — AMOLED approach: sample buffer through subpixel grid
  function draw(time) {
    drawBuffer(time);

    var imageData = bufCtx.getImageData(0, 0, BUF_W, BUF_H);
    var buf = imageData.data;

    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);

    var sp = subpixels;
    var len = sp.length;
    var stride = 6;

    for (var i = 0; i < len; i += stride) {
      var x = sp[i];
      var y = sp[i + 1];
      var type = sp[i + 2];
      var radius = sp[i + 3];
      var normX = sp[i + 4];
      var normY = sp[i + 5];

      // Sample buffer (nearest neighbor)
      var bx = Math.min(BUF_W - 1, Math.max(0, Math.round(normX * (BUF_W - 1))));
      var by = Math.min(BUF_H - 1, Math.max(0, Math.round(normY * (BUF_H - 1))));
      var idx = (by * BUF_W + bx) * 4;
      var rPix = buf[idx];
      var gPix = buf[idx + 1];
      var bPix = buf[idx + 2];

      // Pick channel based on subpixel type
      var ch;
      if (type === 0) ch = gPix;
      else if (type === 1) ch = rPix;
      else ch = bPix;

      // Mix: base glow + weather contribution
      var brightness = BASE_BRIGHTNESS + ch * WEATHER_MULT;
      if (brightness > 255) brightness = 255;
      if (brightness < 2) continue;

      var br = Math.round(brightness);

      if (type === 0) {
        ctx.fillStyle = "rgb(0," + br + ",0)";
      } else if (type === 1) {
        ctx.fillStyle = "rgb(" + br + ",0,0)";
      } else {
        ctx.fillStyle = "rgb(0,0," + br + ")";
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

  // RAF loop with throttling
  var frameSkip = isMobile ? 50 : 33;

  function frame(time) {
    requestAnimationFrame(frame);
    if (frameSkip && time - lastTime < frameSkip) return;
    lastTime = time;
    draw(time);
  }

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
