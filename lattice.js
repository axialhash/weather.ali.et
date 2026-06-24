/**
 * lattice.js — Diamond PenTile subpixel lattice (weather-reactive).
 *
 * Responds to real weather data:
 *  - sun_altitude: dims at night, warms at golden hour
 *  - cloud_cover: reduces overall brightness
 *  - condition: rain streaks, snow particles
 *  - wind_speed: drifts subpixels laterally
 *  - moon_phase: renders moon glow at night
 */

(function () {
  "use strict";

  var canvas = document.getElementById("lattice");
  if (!canvas) return;
  var ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });

  // ── State ───────────────────────────────────────

  var W = 1, H = 1;
  var subpixels = [];
  var isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);

  // Weather state (updated externally)
  var weather = {
    sun_altitude: 1.0,   // -0.3 to 1.0
    cloud_cover: 0,      // 0-100
    wind_speed: 0,       // km/h
    condition: "clear",  // clear, partly_cloudy, rain, drizzle, snow, fog, thunderstorm
    moon_phase: 0.5,     // 0-1 (0=new, 0.5=full)
  };

  // Derived colors (recalculated on weather update)
  var tintColor = { r: 0, g: 255, b: 136 }; // base green
  var globalBrightness = 1.0;
  var driftX = 0;

  // Particles (rain, snow)
  var particles = [];
  var MAX_PARTICLES = isMobile ? 40 : 100;

  // Mouse
  var mouse = { x: -1, y: -1 };

  // Lattice params
  var PITCH_BASE = isMobile ? 14 : 10;
  var PITCH_RATIO = 1.15;

  // ── Geometry rebuild ────────────────────────────

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

      subpixels.push(sx, sy, draft[base + 2], draft[base + 3], vig);
    }
  }

  // ── Weather update ──────────────────────────────

  function updateWeather(data) {
    if (!data) return;

    if (data.sun_altitude != null) weather.sun_altitude = data.sun_altitude;
    if (data.cloud_cover != null) weather.cloud_cover = data.cloud_cover;
    if (data.wind_speed != null) weather.wind_speed = data.wind_speed;
    if (data.condition) weather.condition = data.condition;
    if (data.moon_phase != null) weather.moon_phase = data.moon_phase;

    // Derive brightness from sun altitude
    var sun = weather.sun_altitude;
    if (sun > 0.3) {
      // Daytime
      globalBrightness = 0.35 + sun * 0.15;
    } else if (sun > 0) {
      // Golden hour / twilight
      globalBrightness = 0.2 + sun * 0.5;
    } else {
      // Night
      globalBrightness = 0.08;
    }

    // Cloud cover dims things
    globalBrightness *= (1 - weather.cloud_cover * 0.003);

    // Condition tints
    var cond = weather.condition;
    if (cond === "clear" || cond === "partly_cloudy") {
      tintColor = sun > 0 ? { r: 255, g: 200, b: 80 } : { r: 20, g: 40, b: 80 };
    } else if (cond === "rain" || cond === "drizzle" || cond === "rain_showers") {
      tintColor = { r: 40, g: 80, b: 200 };
    } else if (cond === "snow" || cond === "snow_showers") {
      tintColor = { r: 180, g: 200, b: 255 };
      spawnParticles("snow");
    } else if (cond === "fog") {
      tintColor = { r: 120, g: 120, b: 130 };
      globalBrightness *= 0.6;
    } else if (cond === "thunderstorm") {
      tintColor = { r: 100, g: 40, b: 200 };
    } else {
      tintColor = { r: 0, g: 255, b: 136 };
    }

    // Wind drift (pixels per frame at 60fps)
    driftX = (weather.wind_speed / 60) * 0.3;

    // Rain/snow particles
    if (cond === "rain" || cond === "drizzle" || cond === "rain_showers") {
      spawnParticles("rain");
    } else if (cond === "snow" || cond === "snow_showers") {
      spawnParticles("snow");
    } else {
      particles = [];
    }
  }

  // ── Particles ───────────────────────────────────

  function spawnParticles(type) {
    // Only add if we don't have enough
    if (particles.length >= MAX_PARTICLES) return;

    var count = MAX_PARTICLES - particles.length;
    for (var i = 0; i < count; i++) {
      particles.push({
        x: Math.random() * W,
        y: Math.random() * H * -0.5,
        speed: type === "snow" ? 0.5 + Math.random() * 1 : 3 + Math.random() * 5,
        drift: (Math.random() - 0.5) * 0.5,
        size: type === "snow" ? 1 + Math.random() * 2 : 1,
        type: type,
        opacity: 0.2 + Math.random() * 0.4,
      });
    }
  }

  function updateParticles() {
    for (var i = particles.length - 1; i >= 0; i--) {
      var p = particles[i];
      p.y += p.speed;
      p.x += p.drift + driftX * 10;

      if (p.y > H + 10 || p.x > W + 10 || p.x < -10) {
        particles.splice(i, 1);
      }
    }

    // Respawn to maintain count
    if ((weather.condition === "rain" || weather.condition === "drizzle" ||
         weather.condition === "rain_showers" || weather.condition === "snow" ||
         weather.condition === "snow_showers") && particles.length < MAX_PARTICLES) {
      var type = weather.condition.includes("snow") ? "snow" : "rain";
      for (var j = particles.length; j < MAX_PARTICLES; j++) {
        particles.push({
          x: Math.random() * W,
          y: Math.random() * H * -0.2,
          speed: type === "snow" ? 0.5 + Math.random() * 1 : 3 + Math.random() * 5,
          drift: (Math.random() - 0.5) * 0.5,
          size: type === "snow" ? 1 + Math.random() * 2 : 1,
          type: type,
          opacity: 0.15 + Math.random() * 0.3,
        });
      }
    }
  }

  // ── Draw ────────────────────────────────────────

  function draw(time) {
    // Background
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, W, H);

    var pulse = 0.32 + 0.06 * Math.sin(time / 4000);
    var mx = mouse.x;
    var my = mouse.y;
    var mouseR = isMobile ? 0 : 160;

    var sp = subpixels;
    var len = sp.length;
    var stride = 5;
    var tr = tintColor.r;
    var tg = tintColor.g;
    var tb = tintColor.b;

    // Wind drift offset
    var windOff = driftX * Math.sin(time / 2000) * 3;

    for (var i = 0; i < len; i += stride) {
      var x = sp[i] + windOff;
      var y = sp[i + 1];
      var type = sp[i + 2];
      var radius = sp[i + 3];
      var vig = sp[i + 4];

      var b = pulse * vig * globalBrightness;

      // Mouse proximity
      if (mx >= 0 && mouseR > 0) {
        var mdx = x - mx;
        var mdy = y - my;
        var mDist = mdx * mdx + mdy * mdy;
        var mr2 = mouseR * mouseR;
        if (mDist < mr2) {
          b += (1 - mDist / mr2) * 0.25;
        }
      }

      if (b < 0.01) continue;

      if (type === 0) {
        // Green circle — tinted
        var gr = (tr * 0.3 * b) | 0;
        var gg = (tg * 0.7 * b) | 0;
        var gb = (tb * 0.3 * b) | 0;
        ctx.fillStyle = "rgba(" + gr + "," + gg + "," + gb + "," + (b * 0.6).toFixed(3) + ")";
        ctx.beginPath();
        ctx.arc(x, y, radius + b * 0.3, 0, 6.2832);
        ctx.fill();
      } else {
        // Diamond
        var sz = radius * (0.85 + b * 0.2);
        var dr, db;
        if (type === 1) {
          dr = (tr * b) | 0;
          db = (tb * 0.2 * b) | 0;
        } else {
          dr = (tr * 0.2 * b) | 0;
          db = (tb * b) | 0;
        }
        var dg = (tg * 0.3 * b) | 0;

        ctx.fillStyle = "rgba(" + dr + "," + dg + "," + db + "," + (b * 0.5).toFixed(3) + ")";
        ctx.beginPath();
        ctx.moveTo(x, y - sz);
        ctx.lineTo(x + sz, y);
        ctx.lineTo(x, y + sz);
        ctx.lineTo(x - sz, y);
        ctx.closePath();
        ctx.fill();
      }
    }

    // ── Moon glow (at night) ──────────────────────

    if (weather.sun_altitude < 0.05) {
      var moonBrightness = (1 - weather.sun_altitude / 0.05) * 0.3;
      var moonPhase = weather.moon_phase; // 0=new, 0.5=full

      // Moon position: arcs across top half
      var moonX = W * 0.7 + Math.sin(time / 20000) * 30;
      var moonY = H * 0.15 + Math.cos(time / 25000) * 15;
      var moonR = isMobile ? 25 : 40;

      // Glow
      var glowR = moonR * 4;
      var grad = ctx.createRadialGradient(moonX, moonY, moonR * 0.5, moonX, moonY, glowR);
      grad.addColorStop(0, "rgba(180,200,255," + (moonBrightness * 0.15).toFixed(3) + ")");
      grad.addColorStop(1, "rgba(180,200,255,0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(moonX, moonY, glowR, 0, 6.2832);
      ctx.fill();

      // Moon disc
      ctx.fillStyle = "rgba(200,215,255," + (moonBrightness * 0.7).toFixed(3) + ")";
      ctx.beginPath();
      ctx.arc(moonX, moonY, moonR, 0, 6.2832);
      ctx.fill();

      // Shadow (phase)
      if (moonPhase < 0.5) {
        // Waxing: shadow on left
        var shadowX = moonR * Math.cos(moonPhase * Math.PI * 2);
        ctx.fillStyle = "rgba(0,0,0," + (moonBrightness * 0.6).toFixed(3) + ")";
        ctx.beginPath();
        ctx.arc(moonX + shadowX * 0.3, moonY, moonR * 0.95, 0, 6.2832);
        ctx.fill();
      } else {
        // Waning: shadow on right
        var shadowX2 = moonR * Math.cos((1 - moonPhase) * Math.PI * 2);
        ctx.fillStyle = "rgba(0,0,0," + (moonBrightness * 0.6).toFixed(3) + ")";
        ctx.beginPath();
        ctx.arc(moonX - shadowX2 * 0.3, moonY, moonR * 0.95, 0, 6.2832);
        ctx.fill();
      }
    }

    // ── Particles (rain/snow) ─────────────────────

    for (var p = 0; p < particles.length; p++) {
      var pt = particles[p];
      ctx.fillStyle = pt.type === "snow"
        ? "rgba(200,220,255," + pt.opacity.toFixed(3) + ")"
        : "rgba(100,160,255," + pt.opacity.toFixed(3) + ")";
      ctx.fillRect(pt.x, pt.y, pt.size, pt.type === "snow" ? pt.size : pt.speed * 0.8);
    }

    // ── Lightning flash (thunderstorm) ────────────

    if (weather.condition === "thunderstorm" && Math.random() < 0.003) {
      ctx.fillStyle = "rgba(255,255,255,0.08)";
      ctx.fillRect(0, 0, W, H);
    }
  }

  // ── RAF loop ────────────────────────────────────

  var lastFrame = 0;
  var mobileInterval = isMobile ? 33 : 0;

  function frame(time) {
    requestAnimationFrame(frame);
    if (mobileInterval && time - lastFrame < mobileInterval) return;
    lastFrame = time;

    updateParticles();
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

  // Expose for external weather updates
  window.__lattice = {
    updateWeather: updateWeather,
    weather: weather,
    subpixels: subpixels,
    rebuild: rebuild,
  };
})();
