/**
 * lattice.js — AMOLED Diamond PenTile lattice.
 *
 * The lattice IS the interface. No cards, no chrome.
 * Weather scene (sun, moon, clouds, rain, snow, fog, lightning) in upper 60%.
 * Sensor values (temp, humidity, light) rendered as text in lower 40%.
 * Open-Meteo drives the weather simulation but isn't shown as text.
 *
 * Weather animation scaling:
 *  - Cloud density scales with cloud_cover (0-100%)
 *  - Rain particle count + speed scales with precipitation (mm)
 *  - Rain angle tilts with wind_speed
 *  - Snow particle count scales with precipitation
 *  - Thunderstorm = rain + periodic lightning flash
 *  - Fog = white haze overlay scaling with condition
 *  - Wind drift scales with wind_speed
 */

(function () {
  "use strict";

  var canvas = document.getElementById("lattice");
  if (!canvas) return;
  var ctx = canvas.getContext("2d", { alpha: false, desynchronized: true, willReadFrequently: true });

  var W = 1, H = 1;
  var subpixels = [];
  var isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);

  // Offscreen buffer
  var bufCanvas, bufCtx;
  var BUF_W = 200;
  var BUF_H = 120;

  // Sensor data (from Arduino via API)
  var sensor = { temp: null, humidity: null, light: null };

  // Weather simulation data (from Open-Meteo, used for visual only)
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

  var raindrops = [];
  var snowflakes = [];
  var cloudDriftX = 0;
  var cloudDriftY = 0;
  var lastTime = 0;
  var lightningTimer = 0;

  // Config
  var PITCH = isMobile ? 9 : 6;
  var BASE_BRIGHTNESS = 10;
  var WEATHER_MULT = 1.8;

  // ── Dynamic sun/moon ────────────────────────────────────────────

  function calcSunAltitude() {
    var sr = weather.sunrise;
    var ss = weather.sunset;
    if (!sr || !ss) return 0.5;
    var now = Date.now();
    var dl = ss.getTime() - sr.getTime();
    if (dl <= 0) return -0.3;
    var elapsed = now - sr.getTime();
    return Math.max(-0.3, Math.sin((elapsed / dl) * Math.PI));
  }

  function calcMoonPhase() {
    var knownNew = Date.UTC(2000, 0, 6, 18, 14, 0);
    var diff = (Date.now() - knownNew) / 86400000;
    return (diff % 29.53058867) / 29.53058867;
  }

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
      subpixels.push(sx, sy, draft[base + 2], draft[base + 3], sx / W, sy / H);
    }
  }

  // ── Update data ─────────────────────────────────────────────────

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

  // ── Manage particles based on actual data ───────────────────────

  function manageParticles() {
    var cond = weather.condition;
    var precip = weather.precipitation;
    var wind = weather.wind_speed;
    var isRaining = cond === "rain" || cond === "drizzle" || cond === "rain_showers" || precip > 0.1;
    var isSnowing = cond === "snow" || cond === "snow_showers";
    var isStorm = cond === "thunderstorm";

    // Rain: scale count with precipitation amount
    if (isRaining || isStorm) {
      // Base: 20 particles for drizzle, up to 80 for heavy rain
      var rainTarget = Math.round(20 + precip * 15);
      if (isStorm) rainTarget = Math.max(rainTarget, 60);
      rainTarget = Math.min(rainTarget, 100);

      while (raindrops.length < rainTarget) {
        raindrops.push(
          Math.random() * BUF_W,
          Math.random() * BUF_H * 0.6,
          0.3 + Math.random() * 0.7
        );
      }
      while (raindrops.length > rainTarget * 1.5) raindrops.pop();
    } else {
      raindrops.length = 0;
    }

    // Snow: scale count with precipitation
    if (isSnowing) {
      var snowTarget = Math.round(15 + precip * 10);
      snowTarget = Math.min(snowTarget, 60);

      while (snowflakes.length < snowTarget) {
        snowflakes.push(
          Math.random() * BUF_W,
          Math.random() * BUF_H * 0.6,
          0.2 + Math.random() * 0.4
        );
      }
      while (snowflakes.length > snowTarget * 1.5) snowflakes.pop();
    } else {
      snowflakes.length = 0;
    }
  }

  // ── Draw weather scene (upper 60% of buffer) ────────────────────

  function drawWeatherScene(time) {
    var sunAlt = calcSunAltitude();
    var moonPhase = calcMoonPhase();
    var wind = weather.wind_speed;
    var windDir = weather.wind_direction || 0;
    var cloudCover = weather.cloud_cover;
    var precip = weather.precipitation;
    var cond = weather.condition;
    var sceneH = BUF_H * 0.6;

    // Wind drift: speed + direction
    // Meteorological degrees: 0=N, 90=E, 180=S, 270=W
    // Clouds move IN the direction wind blows (not from)
    var windRad = (windDir * Math.PI) / 180;
    var windMag = (wind / 10) * 0.4;
    var windDx = Math.sin(windRad) * windMag;
    var windDy = -Math.cos(windRad) * windMag;
    var rainAngle = Math.min(wind / 30, 0.8);

    // ── Sky gradient ──
    // Based on sun altitude: night → dawn → day → dusk → night
    drawSky(sceneH, sunAlt, cloudCover);

    // ── Sun ──
    if (sunAlt > 0.01) {
      var sunOpacity = Math.max(0.08, sunAlt * (1 - cloudCover / 150));
      var sx = BUF_W * 0.12 + BUF_W * 0.76 * (1 - sunAlt);
      var sy = sceneH * 0.35 - Math.sin((1 - sunAlt) * Math.PI) * sceneH * 0.3;
      var sunR = 3 + sunAlt * 5;

      // Sun glow
      var grad = bufCtx.createRadialGradient(sx, sy, 0, sx, sy, sunR * 4);
      var warm = sunAlt > 0.5 ? [255, 200, 80] : [255, 140, 60];
      grad.addColorStop(0, "rgba(" + warm[0] + "," + warm[1] + "," + warm[2] + "," + (sunOpacity * 0.6).toFixed(2) + ")");
      grad.addColorStop(0.5, "rgba(" + warm[0] + "," + warm[1] + "," + warm[2] + "," + (sunOpacity * 0.12).toFixed(2) + ")");
      grad.addColorStop(1, "rgba(" + warm[0] + "," + warm[1] + "," + warm[2] + ",0)");
      bufCtx.fillStyle = grad;
      bufCtx.beginPath();
      bufCtx.arc(sx, sy, sunR * 4, 0, 6.2832);
      bufCtx.fill();

      // Sun core
      bufCtx.fillStyle = "rgba(255,240,180," + Math.min(1, sunOpacity * 1.5).toFixed(2) + ")";
      bufCtx.beginPath();
      bufCtx.arc(sx, sy, sunR, 0, 6.2832);
      bufCtx.fill();

      // ── Crepuscular rays through clouds ──
      if (cloudCover > 10 && sunAlt > 0.05) {
        drawSunRays(sx, sy, sceneH, sunAlt, cloudCover, windDx);
      }
    }

    // ── Moon ──
    var moonInt = sunAlt < 0.05 ? Math.min(1, Math.abs(sunAlt) * 3 + 0.1) : 0;
    moonInt *= Math.max(0.15, 1 - cloudCover / 130);
    if (moonInt > 0.01) {
      var mx = BUF_W * 0.78;
      var my = sceneH * 0.15;
      var moonR = 3.5;

      var mg = bufCtx.createRadialGradient(mx, my, 0, mx, my, moonR * 5);
      mg.addColorStop(0, "rgba(180,200,255," + (moonInt * 0.25).toFixed(2) + ")");
      mg.addColorStop(0.5, "rgba(180,200,255," + (moonInt * 0.05).toFixed(2) + ")");
      mg.addColorStop(1, "rgba(180,200,255,0)");
      bufCtx.fillStyle = mg;
      bufCtx.beginPath();
      bufCtx.arc(mx, my, moonR * 5, 0, 6.2832);
      bufCtx.fill();

      bufCtx.save();
      bufCtx.beginPath();
      bufCtx.arc(mx, my, moonR, 0, 6.2832);
      bufCtx.clip();
      bufCtx.fillStyle = "rgba(200,215,255," + (moonInt * 0.9).toFixed(2) + ")";
      if (moonPhase < 0.25) {
        var litEdge = mx + moonR * (1 - moonPhase * 4);
        bufCtx.fillRect(litEdge, my - moonR, mx + moonR - litEdge, moonR * 2);
      } else if (moonPhase < 0.5) {
        var darkEdge = mx + moonR * (1 - moonPhase * 4);
        bufCtx.fillRect(darkEdge, my - moonR, mx + moonR - darkEdge, moonR * 2);
      } else if (moonPhase < 0.75) {
        var darkEdge = mx - moonR * (moonPhase * 4 - 2);
        bufCtx.fillRect(mx - moonR, my - moonR, darkEdge - (mx - moonR), moonR * 2);
      } else {
        var litEdge = mx - moonR * (4 - moonPhase * 4);
        bufCtx.fillRect(mx - moonR, my - moonR, litEdge - (mx - moonR), moonR * 2);
      }
      bufCtx.restore();
    }

    // ── Clouds ──
    // Density: at 100% cover, clouds fill the entire sky
    var numClouds = Math.min(14, Math.ceil(cloudCover / 7));
    if (numClouds > 0) {
      cloudDriftX += windDx * 0.04;
      cloudDriftY += windDy * 0.01;
      for (var c = 0; c < numClouds; c++) {
        var progress = c / numClouds;
        var cx = ((progress * BUF_W * 1.5 + cloudDriftX + Math.sin(c * 2.1) * 10) % (BUF_W + 40)) - 20;
        var cy = 4 + (progress * sceneH * 0.85 + cloudDriftY * 0.5 + (c % 3) * 4) % sceneH;
        var cw = 14 + (c % 3) * 6 + (cloudCover / 100) * 8;
        var ch = 4 + (c % 2) * 2;
        var op = 0.12 + (cloudCover / 100) * 0.4;

        bufCtx.fillStyle = "rgba(60,70,90," + op.toFixed(2) + ")";
        bufCtx.beginPath();
        bufCtx.ellipse(cx, cy, cw, ch, 0, 0, 6.2832);
        bufCtx.fill();
        bufCtx.beginPath();
        bufCtx.ellipse(cx - cw * 0.4, cy - 2.5, cw * 0.5, ch * 0.6, 0, 0, 6.2832);
        bufCtx.fill();
        bufCtx.beginPath();
        bufCtx.ellipse(cx + cw * 0.35, cy - 1.5, cw * 0.55, ch * 0.55, 0, 0, 6.2832);
        bufCtx.fill();

        if (cloudCover > 60) {
          bufCtx.beginPath();
          bufCtx.ellipse(cx + cw * 0.1, cy + 2, cw * 0.4, ch * 0.4, 0, 0, 6.2832);
          bufCtx.fill();
        }
      }
    }

    // ── Rain ──
    if (raindrops.length > 0) {
      var rainAlpha = 0.4 + Math.min(precip / 10, 0.4);
      var rainWidth = 0.6 + Math.min(precip / 5, 0.8);
      bufCtx.strokeStyle = "rgba(80,140,255," + rainAlpha.toFixed(2) + ")";
      bufCtx.lineWidth = rainWidth;

      for (var r = 0; r < raindrops.length; r += 3) {
        var speed = raindrops[r + 2] * (1 + precip * 0.3);
        raindrops[r + 1] += speed;
        raindrops[r] += windDx * 0.05 + Math.sin(rainAngle) * speed * 0.3;

        if (raindrops[r + 1] > sceneH) {
          raindrops[r] = Math.random() * BUF_W;
          raindrops[r + 1] = -2 - Math.random() * 5;
        }
        if (raindrops[r] > BUF_W + 10) raindrops[r] = -10;
        if (raindrops[r] < -10) raindrops[r] = BUF_W + 10;

        var dropLen = 1.2 + speed * 0.5;
        bufCtx.beginPath();
        bufCtx.moveTo(raindrops[r], raindrops[r + 1]);
        bufCtx.lineTo(
          raindrops[r] + Math.sin(rainAngle) * dropLen,
          raindrops[r + 1] + dropLen
        );
        bufCtx.stroke();
      }
    }

    // ── Snow ──
    if (snowflakes.length > 0) {
      bufCtx.fillStyle = "rgba(210,220,240,0.7)";
      for (var s = 0; s < snowflakes.length; s += 3) {
        var sSpeed = snowflakes[s + 2];
        snowflakes[s + 1] += sSpeed;
        snowflakes[s] += Math.sin(time / 2000 + s * 1.3) * 0.15 + windDx * 0.03;

        if (snowflakes[s + 1] > sceneH) {
          snowflakes[s] = Math.random() * BUF_W;
          snowflakes[s + 1] = -3;
        }
        if (snowflakes[s] > BUF_W) snowflakes[s] = 0;
        if (snowflakes[s] < 0) snowflakes[s] = BUF_W;

        var size = 0.6 + sSpeed * 0.8;
        bufCtx.beginPath();
        bufCtx.arc(snowflakes[s], snowflakes[s + 1], size, 0, 6.2832);
        bufCtx.fill();
      }
    }

    // ── Thunderstorm lightning ──
    if (cond === "thunderstorm") {
      lightningTimer -= 16;
      if (lightningTimer <= 0) {
        lightningTimer = 2000 + Math.random() * 4000;
      }
      var flashProgress = 1 - (lightningTimer / 6000);
      if (flashProgress < 0.05) {
        var flashAlpha = flashProgress < 0.02 ? 0.5 : 0;
        bufCtx.fillStyle = "rgba(200,210,255," + flashAlpha.toFixed(2) + ")";
        bufCtx.fillRect(0, 0, BUF_W, sceneH);
      }
    }

    // ── Fog / Mist ──
    if (cond === "fog" || cond === "mist") {
      var fogDensity = 0.15 + (weather.humidity / 100) * 0.2;
      var fogGrad = bufCtx.createLinearGradient(0, 0, 0, sceneH);
      fogGrad.addColorStop(0, "rgba(150,160,180," + (fogDensity * 0.3).toFixed(2) + ")");
      fogGrad.addColorStop(0.5, "rgba(150,160,180," + fogDensity.toFixed(2) + ")");
      fogGrad.addColorStop(1, "rgba(150,160,180," + (fogDensity * 0.6).toFixed(2) + ")");
      bufCtx.fillStyle = fogGrad;
      bufCtx.fillRect(0, 0, BUF_W, sceneH);
    }

    // ── Humidity band at bottom of scene ──
    var humidH = sceneH * (weather.humidity / 100) * 0.15;
    if (humidH > 1) {
      var hGrad = bufCtx.createLinearGradient(0, sceneH - humidH, 0, sceneH);
      hGrad.addColorStop(0, "rgba(40,80,200,0)");
      hGrad.addColorStop(1, "rgba(40,80,200,0.08)");
      bufCtx.fillStyle = hGrad;
      bufCtx.fillRect(0, sceneH - humidH, BUF_W, humidH);
    }
  }

  // ── Sky gradient based on sun altitude ───────────────────────────

  function drawSky(sceneH, sunAlt, cloudCover) {
    var grad = bufCtx.createLinearGradient(0, 0, 0, sceneH);

    if (sunAlt < -0.1) {
      // Night: dark blue-black
      grad.addColorStop(0, "rgb(2,2,8)");
      grad.addColorStop(1, "rgb(5,5,15)");
    } else if (sunAlt < 0.05) {
      // Dawn/dusk: deep blue → orange/pink horizon
      var t = (sunAlt + 0.1) / 0.15;
      var nightR = Math.round(2 + t * 15);
      var nightG = Math.round(2 + t * 5);
      var nightB = Math.round(8 + t * 10);
      grad.addColorStop(0, "rgb(" + nightR + "," + nightG + "," + nightB + ")");
      // Horizon: warm orange/pink, intensified by clouds
      var cloudBoost = 1 + (cloudCover / 100) * 0.8;
      var horizonR = Math.round(40 * cloudBoost + t * 60);
      var horizonG = Math.round(15 * cloudBoost + t * 15);
      var horizonB = Math.round(10 + t * 20);
      grad.addColorStop(0.7, "rgb(" + Math.min(255, horizonR) + "," + Math.min(255, horizonG) + "," + horizonB + ")");
      grad.addColorStop(1, "rgb(" + Math.min(255, Math.round(horizonR * 0.6)) + "," + Math.min(255, Math.round(horizonG * 0.5)) + "," + Math.round(horizonB * 0.4) + ")");
    } else if (sunAlt < 0.3) {
      // Early morning / late afternoon: warm blue
      var t = (sunAlt - 0.05) / 0.25;
      var topR = Math.round(5 + t * 10);
      var topG = Math.round(8 + t * 20);
      var topB = Math.round(25 + t * 50);
      grad.addColorStop(0, "rgb(" + topR + "," + topG + "," + topB + ")");
      // Warm horizon
      var hR = Math.round(30 + (1 - t) * 30);
      var hG = Math.round(15 + (1 - t) * 10);
      grad.addColorStop(0.8, "rgb(" + hR + "," + hG + ",20)");
      grad.addColorStop(1, "rgb(" + Math.round(hR * 0.5) + "," + Math.round(hG * 0.4) + ",10)");
    } else {
      // Day: blue sky, desaturated by clouds
      var cloudDesat = cloudCover / 100;
      var topR = Math.round(8 + cloudDesat * 30);
      var topG = Math.round(15 + cloudDesat * 25);
      var topB = Math.round(50 + (1 - cloudDesat) * 40);
      grad.addColorStop(0, "rgb(" + topR + "," + topG + "," + topB + ")");
      var midR = Math.round(5 + cloudDesat * 25);
      var midG = Math.round(12 + cloudDesat * 20);
      var midB = Math.round(35 + (1 - cloudDesat) * 30);
      grad.addColorStop(0.6, "rgb(" + midR + "," + midG + "," + midB + ")");
      grad.addColorStop(1, "rgb(" + Math.round(midR * 0.7) + "," + Math.round(midG * 0.7) + "," + Math.round(midB * 0.6) + ")");
    }

    bufCtx.fillStyle = grad;
    bufCtx.fillRect(0, 0, BUF_W, sceneH);
  }

  // ── Crepuscular sun rays through clouds ──────────────────────────

  function drawSunRays(sx, sy, sceneH, sunAlt, cloudCover, windDx) {
    var numRays = 3 + Math.floor(sunAlt * 4);
    var rayLength = sceneH * (0.4 + sunAlt * 0.3);
    var rayWidth = 1.5 + sunAlt * 2;
    var baseAlpha = 0.04 + sunAlt * 0.06;
    // Rays more visible with some clouds (gaps for light to pass through)
    var cloudFactor = Math.min(1, cloudCover / 50) * Math.max(0, 1 - cloudCover / 120);
    var alpha = baseAlpha * cloudFactor;

    if (alpha < 0.005) return;

    bufCtx.save();
    for (var i = 0; i < numRays; i++) {
      var angle = -Math.PI / 2 + (i - numRays / 2) * 0.12 + Math.sin(Date.now() / 3000 + i) * 0.03;
      var len = rayLength * (0.7 + Math.sin(i * 1.7) * 0.3);
      var w = rayWidth * (0.8 + Math.sin(i * 2.3) * 0.2);

      var ex = sx + Math.cos(angle) * len;
      var ey = sy + Math.sin(angle) * len;

      var rayGrad = bufCtx.createLinearGradient(sx, sy, ex, ey);
      rayGrad.addColorStop(0, "rgba(255,220,120," + (alpha * 1.5).toFixed(3) + ")");
      rayGrad.addColorStop(0.3, "rgba(255,200,100," + alpha.toFixed(3) + ")");
      rayGrad.addColorStop(1, "rgba(255,180,80,0)");

      bufCtx.beginPath();
      bufCtx.moveTo(sx - w * 0.3, sy);
      bufCtx.lineTo(ex - w, ey);
      bufCtx.lineTo(ex + w, ey);
      bufCtx.lineTo(sx + w * 0.3, sy);
      bufCtx.closePath();
      bufCtx.fillStyle = rayGrad;
      bufCtx.fill();
    }
    bufCtx.restore();
  }

  // ── Draw sensor values (lower 40% of buffer) ────────────────────

  function drawSensorValues() {
    var startY = BUF_H * 0.64;
    var centerX = BUF_W / 2;

    bufCtx.textAlign = "center";
    bufCtx.textBaseline = "middle";

    if (sensor.temp != null) {
      bufCtx.font = "bold 18px monospace";
      bufCtx.fillStyle = "rgba(242,244,248,0.9)";
      var tempStr = sensor.temp.toFixed(1) + "\u00B0";
      bufCtx.fillText(tempStr, centerX, startY + 8);

      bufCtx.font = "6px monospace";
      bufCtx.fillStyle = "rgba(242,244,248,0.25)";
      bufCtx.fillText("C", centerX + bufCtx.measureText(tempStr).width / 2 + 8, startY + 5);
    }

    if (sensor.humidity != null) {
      bufCtx.font = "11px monospace";
      bufCtx.fillStyle = "rgba(87,115,153,0.8)";
      bufCtx.fillText(sensor.humidity.toFixed(0) + "%", centerX - 22, startY + 28);
    }

    if (sensor.light != null) {
      bufCtx.font = "11px monospace";
      bufCtx.fillStyle = "rgba(243,202,64,0.7)";
      bufCtx.fillText(sensor.light.toFixed(0) + "%", centerX + 22, startY + 28);
    }

    bufCtx.font = "5px monospace";
    bufCtx.fillStyle = "rgba(242,244,248,0.15)";
    if (sensor.humidity != null) bufCtx.fillText("hum", centerX - 22, startY + 36);
    if (sensor.light != null) bufCtx.fillText("light", centerX + 22, startY + 36);
  }

  // ── Render ──────────────────────────────────────────────────────

  function draw(time) {
    if (!bufCanvas) {
      bufCanvas = document.createElement("canvas");
      bufCanvas.width = BUF_W;
      bufCanvas.height = BUF_H;
      bufCtx = bufCanvas.getContext("2d");
    }

    manageParticles();

    bufCtx.fillStyle = "#000";
    bufCtx.fillRect(0, 0, BUF_W, BUF_H);

    drawWeatherScene(time);
    drawSensorValues();

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

      var bx = Math.min(BUF_W - 1, Math.max(0, Math.round(normX * (BUF_W - 1))));
      var by = Math.min(BUF_H - 1, Math.max(0, Math.round(normY * (BUF_H - 1))));
