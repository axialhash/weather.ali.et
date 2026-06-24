/**
 * liquid-glass.js — Liquid glass refraction + cursor lens for weather.ali.et
 *
 * Based on the CodePen liquid glass technique:
 *  1. Generate displacement map via SDF on offscreen canvas
 *  2. Inject SVG feDisplacementMap filter with fresh ID (Safari cache-bust)
 *  3. Clone the AMOLED lattice canvas for refraction
 *  4. Apply CSS blur + tint + glint layers
 *
 * Plus: cursor-following magnifying lens on desktop.
 */

(function () {
  "use strict";

  // ── Glass config ────────────────────────────────────────────────

  var GLASS_CONFIG = {
    depth: 40,
    splay: 3,
    feather: 20,
    curve: 1.8,
    blur: 0.8,
    glint: 30,
    tint: 0.03,
    tintColor: "#F3CA40",
    radius: 16,
    pad: 20,
  };

  // ── Cursor lens config ──────────────────────────────────────────

  var LENS_CONFIG = {
    size: 120,         // diameter
    depth: 50,         // refraction strength
    splay: 4,
    feather: 16,
    curve: 2.0,
    blur: 0.5,
    glint: 40,
    tint: 0.02,
    tintColor: "#F3CA40",
    radius: 60,        // circle
    pad: 15,
  };

  var version = 0;
  var mapCache = new Map();
  var housing = null;
  var isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);

  // ── Displacement map builder ────────────────────────────────────

  function clamp255(v) {
    return v < 0 ? 0 : v > 255 ? 255 : v;
  }

  function buildDisplacementMap(mw, mh, glassW, glassH, radius, rim, curve, feather) {
    var key = mw + ":" + glassW + ":" + radius + ":" + rim + ":" + curve + ":" + feather;
    var hit = mapCache.get(key);
    if (hit) return hit;

    var cv = document.createElement("canvas");
    cv.width = mw;
    cv.height = mh;
    var ctx = cv.getContext("2d");
    var img = ctx.createImageData(mw, mh);
    var px = img.data;

    var hx = glassW / 2;
    var hy = glassH / 2;
    var BOOST = 0.8;

    function sdf(x, y) {
      var qx = Math.abs(x - mw / 2) - (hx - radius);
      var qy = Math.abs(y - mh / 2) - (hy - radius);
      var ox = Math.max(qx, 0);
      var oy = Math.max(qy, 0);
      return Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - radius;
    }

    for (var y = 0; y < mh; y++) {
      for (var x = 0; x < mw; x++) {
        var cx = x + 0.5;
        var cy = y + 0.5;
        var s = sdf(cx, cy);
        var gx = sdf(cx + 1, cy) - sdf(cx - 1, cy);
        var gy = sdf(cx, cy + 1) - sdf(cx, cy - 1);
        var len = Math.hypot(gx, gy) || 1;
        var nx = gx / len;
        var ny = gy / len;
        var span = s < 0 ? rim + feather : rim;
        var amt = Math.max(0, 1 - Math.abs(s) / span);
        amt = amt * amt * amt * (amt * (amt * 6 - 15) + 10);
        amt = Math.pow(amt, curve);

        var i = (y * mw + x) * 4;
        px[i]     = clamp255(Math.round(127.5 - nx * amt * 127 * BOOST));
        px[i + 1] = clamp255(Math.round(127.5 - ny * amt * 127 * BOOST));
        px[i + 2] = 128;
        px[i + 3] = 255;
      }
    }

    ctx.putImageData(img, 0, 0);
    var url = cv.toDataURL("image/png");
    if (mapCache.size > 50) mapCache.delete(mapCache.keys().next().value);
    mapCache.set(key, url);
    return url;
  }

  // ── SVG filter injection ────────────────────────────────────────

  function applyFilter(mapUrl, mw, mh, depth) {
    if (!housing) {
      housing = document.createElement("svg");
      housing.id = "glass-filter-housing";
      housing.setAttribute("width", "0");
      housing.setAttribute("height", "0");
      housing.style.position = "absolute";
      document.body.appendChild(housing);
    }

    var id = "glass-f" + (++version);

    housing.innerHTML =
      '<defs>' +
      '<filter id="' + id + '" x="0" y="0" width="100%" height="100%"' +
      ' filterUnits="objectBoundingBox" color-interpolation-filters="sRGB">' +
      '<feImage href="' + mapUrl + '" x="0" y="0" width="' + mw + '" height="' + mh +
      '" preserveAspectRatio="none" result="map"/>' +
      '<feDisplacementMap in="SourceGraphic" in2="map" scale="' + depth +
      '" xChannelSelector="R" yChannelSelector="G" result="disp"/>' +
      '</filter></defs>';

    return id;
  }

  // ── Glass panel setup ───────────────────────────────────────────

  function setupGlassPanel(panelEl) {
    var rect = panelEl.getBoundingClientRect();
    var gw = Math.round(rect.width) + GLASS_CONFIG.pad * 2;
    var gh = Math.round(rect.height) + GLASS_CONFIG.pad * 2;

    var mapUrl = buildDisplacementMap(
      gw, gh,
      Math.round(rect.width),
      Math.round(rect.height),
      GLASS_CONFIG.radius,
      GLASS_CONFIG.splay,
      GLASS_CONFIG.curve,
      GLASS_CONFIG.feather
    );

    var filterId = applyFilter(mapUrl, gw, gh, GLASS_CONFIG.depth);

    var latticeCanvas = document.getElementById("lattice");
    if (!latticeCanvas) return;

    var cloneWrap = document.createElement("div");
    cloneWrap.className = "glass-refraction";
    cloneWrap.style.cssText =
      "position:absolute; top:0; left:0; width:100%; height:100%;" +
      "pointer-events:none; overflow:hidden; border-radius:inherit;";

    var cloneCanvas = document.createElement("canvas");
    cloneCanvas.width = latticeCanvas.width;
    cloneCanvas.height = latticeCanvas.height;
    cloneCanvas.style.cssText =
      "width:100%; height:100%; object-fit:cover;" +
      "filter:url(#" + filterId + ");" +
      "will-change:filter;";

    var cloneCtx = cloneCanvas.getContext("2d");
    cloneCtx.drawImage(latticeCanvas, 0, 0);
    cloneWrap.appendChild(cloneCanvas);

    var blurWrap = document.createElement("div");
    blurWrap.className = "glass-blur-wrap";
    blurWrap.style.cssText =
      "position:absolute; inset:0; border-radius:inherit;" +
      "filter:blur(" + GLASS_CONFIG.blur + "px); will-change:filter;";
    blurWrap.appendChild(cloneWrap);

    var tintLayer = document.createElement("div");
    tintLayer.className = "glass-tint";
    tintLayer.style.cssText =
      "position:absolute; inset:0; border-radius:inherit; pointer-events:none;" +
      "background:" + GLASS_CONFIG.tintColor + ";" +
      "opacity:" + GLASS_CONFIG.tint + ";" +
      "mix-blend-mode:multiply;";

    var glintLayer = document.createElement("div");
    glintLayer.className = "glass-glint";
    glintLayer.style.cssText =
      "position:absolute; inset:0; border-radius:inherit; pointer-events:none;" +
      "box-shadow: inset 1.5px 1.5px 4px rgba(255,255,255," + (GLASS_CONFIG.glint / 100 * 0.7).toFixed(2) + ")," +
      "inset -2px -2px 5px rgba(0,0,0,0.28);" +
      "opacity:" + (GLASS_CONFIG.glint / 100).toFixed(2) + ";";

    var clipWrap = document.createElement("div");
    clipWrap.className = "glass-clip";
    clipWrap.style.cssText =
      "position:absolute; inset:0;" +
      "clip-path:inset(0 round " + GLASS_CONFIG.radius + "px);";
    clipWrap.appendChild(blurWrap);
    clipWrap.appendChild(tintLayer);
    clipWrap.appendChild(glintLayer);

    panelEl.style.position = "relative";
    panelEl.style.isolation = "isolate";
    panelEl.insertBefore(clipWrap, panelEl.firstChild);

    panelEl._glassClone = cloneCanvas;
    panelEl._glassCloneCtx = cloneCtx;
  }

  // ── Cursor lens ─────────────────────────────────────────────────

  var cursorLens = null;
  var cursorClone = null;
  var cursorCloneCtx = null;
  var cursorFilterId = null;
  var cursorX = -200;
  var cursorY = -200;
  var targetX = -200;
  var targetY = -200;
  var lensVisible = false;

  function createCursorLens() {
    if (isMobile) return; // no cursor on mobile

    var S = LENS_CONFIG.size;
    var P = LENS_CONFIG.pad;
    var mw = S + P * 2;
    var mh = S + P * 2;

    var mapUrl = buildDisplacementMap(
      mw, mh, S, S,
      LENS_CONFIG.radius,
      LENS_CONFIG.splay,
      LENS_CONFIG.curve,
      LENS_CONFIG.feather
    );

    cursorFilterId = applyFilter(mapUrl, mw, mh, LENS_CONFIG.depth);

    // Lens element
    cursorLens = document.createElement("div");
    cursorLens.id = "cursor-lens";
    cursorLens.style.cssText =
      "position:fixed; width:" + S + "px; height:" + S + "px;" +
      "border-radius:" + LENS_CONFIG.radius + "px; overflow:hidden;" +
      "pointer-events:none; z-index:50; isolation:isolate;" +
      "box-shadow: 0 8px 32px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.1);" +
      "opacity:0; transition:opacity 0.3s ease;" +
      "will-change:transform; transform:translate(-50%,-50%);";

    // Clip wrapper
    var clip = document.createElement("div");
    clip.style.cssText =
      "position:absolute; inset:0;" +
      "clip-path:inset(0 round " + LENS_CONFIG.radius + "px);";

    // Blur wrap
    var blurW = document.createElement("div");
    blurW.style.cssText =
      "position:absolute; inset:0; border-radius:inherit;" +
      "filter:blur(" + LENS_CONFIG.blur + "px);";

    // Refraction clone
    var refractionWrap = document.createElement("div");
    refractionWrap.style.cssText =
      "position:absolute; top:0; left:0; width:100%; height:100%;" +
      "overflow:hidden; border-radius:inherit;";

    var latticeCanvas = document.getElementById("lattice");
    cursorClone = document.createElement("canvas");
    if (latticeCanvas) {
      cursorClone.width = latticeCanvas.width;
      cursorClone.height = latticeCanvas.height;
    }
    cursorClone.style.cssText =
      "width:100%; height:100%; object-fit:cover;" +
      "filter:url(#" + cursorFilterId + ");" +
      "will-change:filter;";
    cursorCloneCtx = cursorClone.getContext("2d");
    refractionWrap.appendChild(cursorClone);
    blurW.appendChild(refractionWrap);

    // Tint
    var tint = document.createElement("div");
    tint.style.cssText =
      "position:absolute; inset:0; border-radius:inherit; pointer-events:none;" +
      "background:" + LENS_CONFIG.tintColor + ";" +
      "opacity:" + LENS_CONFIG.tint + ";" +
      "mix-blend-mode:multiply;";

    // Glint — top-left specular highlight
    var glint = document.createElement("div");
    glint.style.cssText =
      "position:absolute; inset:0; border-radius:inherit; pointer-events:none;" +
      "box-shadow: inset 2px 2px 6px rgba(255,255,255," + (LENS_CONFIG.glint / 100 * 0.8).toFixed(2) + ")," +
      "inset -2px -2px 6px rgba(0,0,0,0.3);";

    clip.appendChild(blurW);
    clip.appendChild(tint);
    clip.appendChild(glint);
    cursorLens.appendChild(clip);
    document.body.appendChild(cursorLens);

    // Mouse tracking
    document.addEventListener("mousemove", function (e) {
      targetX = e.clientX;
      targetY = e.clientY;
      if (!lensVisible) {
        lensVisible = true;
        cursorLens.style.opacity = "1";
      }
    });

    document.addEventListener("mouseleave", function () {
      lensVisible = false;
      cursorLens.style.opacity = "0";
    });
  }

  // ── Update clones ───────────────────────────────────────────────

  function updateGlassClones() {
    var latticeCanvas = document.getElementById("lattice");
    if (!latticeCanvas) return;

    // Update panel clones
    var panels = document.querySelectorAll(".glass");
    for (var i = 0; i < panels.length; i++) {
      var p = panels[i];
      if (p._glassClone) {
        p._glassCloneCtx.drawImage(latticeCanvas, 0, 0);
      }
    }

    // Update cursor lens clone
    if (cursorClone && cursorCloneCtx) {
      cursorCloneCtx.drawImage(latticeCanvas, 0, 0);
    }
  }

  // ── Animation loop ──────────────────────────────────────────────

  var lastGlassUpdate = 0;
  var GLASS_UPDATE_INTERVAL = 100; // ms
  var LENS_SMOOTH = 0.12; // lerp factor

  function glassLoop(time) {
    requestAnimationFrame(glassLoop);

    // Smooth cursor follow
    if (cursorLens) {
      cursorX += (targetX - cursorX) * LENS_SMOOTH;
      cursorY += (targetY - cursorY) * LENS_SMOOTH;
      cursorLens.style.left = cursorX + "px";
      cursorLens.style.top = cursorY + "px";
    }

    // Update glass clones at reduced rate
    if (time - lastGlassUpdate < GLASS_UPDATE_INTERVAL) return;
    lastGlassUpdate = time;
    updateGlassClones();
  }

  // ── Init ────────────────────────────────────────────────────────

  function init() {
    var latticeCanvas = document.getElementById("lattice");
    if (!latticeCanvas) {
      requestAnimationFrame(init);
      return;
    }

    var panels = document.querySelectorAll(".glass");
    if (panels.length === 0) {
      requestAnimationFrame(init);
      return;
    }

    for (var i = 0; i < panels.length; i++) {
      setupGlassPanel(panels[i]);
    }

    createCursorLens();
    requestAnimationFrame(glassLoop);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      setTimeout(init, 100);
    });
  } else {
    setTimeout(init, 100);
  }

  window.__liquidGlass = {
    config: GLASS_CONFIG,
    lensConfig: LENS_CONFIG,
    updateClones: updateGlassClones,
    reinit: init,
  };
})();
