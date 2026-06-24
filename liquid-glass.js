/**
 * liquid-glass.js — Liquid glass refraction + fisheye cursor lens
 *
 * Liquid glass panels: SDF displacement map + SVG filter refraction.
 * Cursor lens: REAL fisheye magnification (radial displacement outward from center)
 *             + edge bevel refraction + CSS blur/tint/glint.
 *
 * The fisheye works by displacing each pixel OUTWARD from the lens center,
 * proportional to its distance. This creates the magnifying glass effect:
 * center content stays put, surrounding content gets pushed outward,
 * making the center appear zoomed in.
 */

(function () {
  "use strict";

  // ── Glass panel config ──────────────────────────────────────────

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
    size: 140,          // diameter
    magnification: 2.0, // zoom factor (1.5 = 150% zoom)
    depth: 60,          // refraction strength for edge bevel
    splay: 3,
    feather: 14,
    curve: 1.5,
    blur: 0.3,
    glint: 35,
    tint: 0.02,
    tintColor: "#F3CA40",
    radius: 70,         // circle
    pad: 20,
  };

  var version = 0;
  var mapCache = new Map();
  var housing = null;
  var isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);

  // ── Displacement map: edge bevel only (for glass panels) ────────

  function clamp255(v) {
    return v < 0 ? 0 : v > 255 ? 255 : v;
  }

  function buildEdgeMap(mw, mh, glassW, glassH, radius, rim, curve, feather) {
    var key = "edge:" + mw + ":" + glassW + ":" + radius + ":" + rim + ":" + curve + ":" + feather;
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

        var i = (y * mh + x) * 4;
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

  // ── Displacement map: fisheye + edge (for cursor lens) ──────────

  function buildFisheyeMap(mw, mh, lensR, mag, edgeRim, edgeCurve, edgeFeather) {
    var key = "fish:" + mw + ":" + lensR + ":" + mag + ":" + edgeRim;
    var hit = mapCache.get(key);
    if (hit) return hit;

    var cv = document.createElement("canvas");
    cv.width = mw;
    cv.height = mh;
    var ctx = cv.getContext("2d");
    var img = ctx.createImageData(mw, mh);
    var px = img.data;

    var cx = mw / 2;
    var cy = mh / 2;
    var maxR = lensR; // radius where fisheye effect reaches full strength

    // Edge bevel SDF
    var hx = lensR;
    var hy = lensR;
    function edgeSdf(x, y) {
      var qx = Math.abs(x - mw / 2) - (hx - lensR * 0.15);
      var qy = Math.abs(y - mh / 2) - (hy - lensR * 0.15);
      var ox = Math.max(qx, 0);
      var oy = Math.max(qy, 0);
      return Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - lensR * 0.15;
    }

    for (var y = 0; y < mh; y++) {
      for (var x = 0; x < mw; x++) {
        var px_x = x + 0.5;
        var px_y = y + 0.5;

        // Distance from center (normalized 0-1 where 1 = edge)
        var dx = px_x - cx;
        var dy = px_y - cy;
        var dist = Math.hypot(dx, dy);
        var normDist = dist / maxR; // 0 at center, 1 at edge

        // ── Fisheye displacement ──
        // Push pixels OUTWARD from center. The displacement amount increases
        // with distance, creating the magnifying glass effect.
        // At center: no displacement. At edge: max displacement.
        // The curve controls the magnification profile (barrel distortion).
        var fisheyeAmt = 0;
        if (normDist < 1.0 && dist > 0.1) {
          // Barrel distortion: displace outward, stronger at edges
          // mag 1.0 = no zoom, mag 2.0 = 2x zoom (stronger outward push)
          var t = normDist;
          // Smooth curve: starts slow, accelerates toward edge
          fisheyeAmt = t * t * (mag - 1.0) * maxR * 0.4;
          // Normalize direction
          fisheyeAmt = fisheyeAmt / dist; // per-pixel displacement scale
        }

        // ── Edge bevel displacement ──
        var es = edgeSdf(px_x, px_y);
        var egx = edgeSdf(px_x + 1, px_y) - edgeSdf(px_x - 1, px_y);
        var egy = edgeSdf(px_x, px_y + 1) - edgeSdf(px_x, px_y - 1);
        var eLen = Math.hypot(egx, egy) || 1;
        var enx = egx / eLen;
        var eny = egy / eLen;
        var edgeAmt = 0;
        var edgeSpan = edgeRim + edgeFeather;
        var eAmt = Math.max(0, 1 - Math.abs(es) / edgeSpan);
        eAmt = eAmt * eAmt * eAmt * (eAmt * (eAmt * 6 - 15) + 10);
        edgeAmt = Math.pow(eAmt, edgeCurve) * edgeRim;

        // ── Combine: fisheye + edge bevel ──
        // Fisheye pushes outward radially, edge bevel pushes along surface normal
        var totalDx, totalDy;
        if (dist > 0.1) {
          var ndx = dx / dist;
          var ndy = dy / dist;
          totalDx = ndx * fisheyeAmt + enx * edgeAmt;
          totalDy = ndy * fisheyeAmt + eny * edgeAmt;
        } else {
          totalDx = enx * edgeAmt;
          totalDy = eny * edgeAmt;
        }

        // Encode: 127.5 = zero displacement, more = positive direction
        var i = (y * mw + x) * 4;
        px[i]     = clamp255(Math.round(127.5 + totalDx * 127));
        px[i + 1] = clamp255(Math.round(127.5 + totalDy * 127));
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

    var mapUrl = buildEdgeMap(
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
    tintLayer.style.cssText =
      "position:absolute; inset:0; border-radius:inherit; pointer-events:none;" +
      "background:" + GLASS_CONFIG.tintColor + ";" +
      "opacity:" + GLASS_CONFIG.tint + ";" +
      "mix-blend-mode:multiply;";

    var glintLayer = document.createElement("div");
    glintLayer.style.cssText =
      "position:absolute; inset:0; border-radius:inherit; pointer-events:none;" +
      "box-shadow: inset 1.5px 1.5px 4px rgba(255,255,255," + (GLASS_CONFIG.glint / 100 * 0.7).toFixed(2) + ")," +
      "inset -2px -2px 5px rgba(0,0,0,0.28);";

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
  var cursorX = -300;
  var cursorY = -300;
  var targetX = -300;
  var targetY = -300;
  var lensVisible = false;

  function createCursorLens() {
    if (isMobile) return;

    var S = LENS_CONFIG.size;
    var P = LENS_CONFIG.pad;
    var mw = S + P * 2;
    var mh = S + P * 2;
    var lensR = S / 2;

    // Build fisheye displacement map
    var mapUrl = buildFisheyeMap(
      mw, mh, lensR,
      LENS_CONFIG.magnification,
      LENS_CONFIG.splay,
      LENS_CONFIG.curve,
      LENS_CONFIG.feather
    );

    var filterId = applyFilter(mapUrl, mw, mh, LENS_CONFIG.depth);

    // Lens element
    cursorLens = document.createElement("div");
    cursorLens.id = "cursor-lens";
    cursorLens.style.cssText =
      "position:fixed; width:" + S + "px; height:" + S + "px;" +
      "border-radius:" + LENS_CONFIG.radius + "px; overflow:hidden;" +
      "pointer-events:none; z-index:50; isolation:isolate;" +
      "box-shadow: 0 8px 32px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.06), " +
      "inset 0 1px 0 rgba(255,255,255,0.08);" +
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
      "filter:url(#" + filterId + ");" +
      "will-change:filter;";
    cursorCloneCtx = cursorClone.getContext("2d");
    refractionWrap.appendChild(cursorClone);
    blurW.appendChild(refractionWrap);

    // Tint — subtle gold
    var tint = document.createElement("div");
    tint.style.cssText =
      "position:absolute; inset:0; border-radius:inherit; pointer-events:none;" +
      "background:" + LENS_CONFIG.tintColor + ";" +
      "opacity:" + LENS_CONFIG.tint + ";" +
      "mix-blend-mode:multiply;";

    // Glint — specular highlight (top-left light source)
    var glint = document.createElement("div");
    glint.style.cssText =
      "position:absolute; inset:0; border-radius:inherit; pointer-events:none;" +
      "box-shadow: inset 2px 2px 8px rgba(255,255,255," + (LENS_CONFIG.glint / 100 * 0.8).toFixed(2) + ")," +
      "inset -2px -2px 6px rgba(0,0,0,0.35);";

    // Outer ring glow
    var ring = document.createElement("div");
    ring.style.cssText =
      "position:absolute; inset:-1px; border-radius:inherit; pointer-events:none;" +
      "border: 1px solid rgba(255,255,255,0.08);";

    clip.appendChild(blurW);
    clip.appendChild(tint);
    clip.appendChild(glint);
    cursorLens.appendChild(clip);
    cursorLens.appendChild(ring);
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

    var panels = document.querySelectorAll(".glass");
    for (var i = 0; i < panels.length; i++) {
      var p = panels[i];
      if (p._glassClone) {
        p._glassCloneCtx.drawImage(latticeCanvas, 0, 0);
      }
    }

    if (cursorClone && cursorCloneCtx) {
      cursorCloneCtx.drawImage(latticeCanvas, 0, 0);
    }
  }

  // ── Animation loop ──────────────────────────────────────────────

  var lastGlassUpdate = 0;
  var GLASS_UPDATE_INTERVAL = 80;
  var LENS_SMOOTH = 0.14;

  function glassLoop(time) {
    requestAnimationFrame(glassLoop);

    if (cursorLens) {
      cursorX += (targetX - cursorX) * LENS_SMOOTH;
      cursorY += (targetY - cursorY) * LENS_SMOOTH;
      cursorLens.style.left = cursorX + "px";
      cursorLens.style.top = cursorY + "px";
    }

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
