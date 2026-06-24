/**
 * lattice.js — Diamond PenTile subpixel lattice background.
 *
 * Ported from alikhalidsherif/AMOLED diamond-pentile-geometry.js
 * Renders the actual AMOLED subpixel arrangement: green circles, red/blue diamonds.
 */

(function () {
  var canvas = document.getElementById("lattice");
  if (!canvas) return;
  var ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });

  var viewportW = 1;
  var viewportH = 1;
  var dpr = 1;
  var pitchX = 10;
  var pitchY = 12;
  var greenRadius = 0;
  var diamondRadius = 0;
  var subpixels = [];

  var mouse = { x: -1, y: -1 };

  function rebuild() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    viewportW = Math.max(1, Math.floor(window.innerWidth));
    viewportH = Math.max(1, Math.floor(window.innerHeight));

    canvas.width = Math.floor(viewportW * dpr);
    canvas.height = Math.floor(viewportH * dpr);
    canvas.style.width = viewportW + "px";
    canvas.style.height = viewportH + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;

    var scale = Math.max(2, Math.min(12, Math.sqrt((viewportW * viewportH) / 80000)));
    pitchX = Math.max(2, Math.round(scale));
    pitchY = Math.max(2, Math.round(pitchX * 1.15));

    var baseR = Math.min(pitchX, pitchY) * 0.5;
    var blackMatrix = baseR * 0.12;
    greenRadius = Math.max(0.5, baseR * 0.8 - blackMatrix);
    diamondRadius = Math.max(0.5, baseR * 0.9 - blackMatrix);

    var roughCols = Math.ceil(viewportW / pitchX) + 4;
    var roughRows = Math.ceil(viewportH / pitchY) + 4;
    var draft = [];

    for (var row = 0; row < roughRows; row++) {
      var rowShiftX = (row & 1) * (pitchX * 0.5);
      for (var col = 0; col < roughCols; col++) {
        var cx = col * pitchX + rowShiftX;
        var cy = row * pitchY;
        var isGreen = ((row + col) & 1) === 0;
        var type = "G";
        if (!isGreen) {
          var rbPhase = (Math.floor(col / 2) + row) & 1;
          type = rbPhase === 0 ? "R" : "B";
        }
        draft.push({ cx: cx, cy: cy, type: type, size: isGreen ? greenRadius : diamondRadius });
      }
    }

    var centerX = (draft[0].cx + draft[draft.length - 1].cx) * 0.5;
    var centerY = (draft[0].cy + draft[draft.length - 1].cy) * 0.5;
    var offX = viewportW * 0.5 - centerX;
    var offY = viewportH * 0.5 - centerY;
    var edgePad = Math.max(greenRadius, diamondRadius) + 2;

    subpixels = [];
    for (var i = 0; i < draft.length; i++) {
      var sp = draft[i];
      var sx = sp.cx + offX;
      var sy = sp.cy + offY;
      if (sx < edgePad || sx > viewportW - edgePad || sy < edgePad || sy > viewportH - edgePad) continue;
      subpixels.push({ cx: sx, cy: sy, type: sp.type, size: sp.size });
    }
  }

  function draw(time) {
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, viewportW, viewportH);

    var t = time / 4000;
    var pulse = 0.35 + 0.08 * Math.sin(t);
    var mx = mouse.x;
    var my = mouse.y;
    var mouseR = 180;
    var count = subpixels.length;

    for (var i = 0; i < count; i++) {
      var s = subpixels[i];
      var dx = s.cx - viewportW * 0.5;
      var dy = s.cy - viewportH * 0.5;
      var dist = Math.sqrt(dx * dx + dy * dy);
      var maxDist = Math.sqrt(viewportW * viewportW + viewportH * viewportH) * 0.5;
      var vignette = Math.max(0, 1 - Math.pow(dist / maxDist, 1.5));

      var mb = 0;
      if (mx >= 0) {
        var mdx = s.cx - mx;
        var mdy = s.cy - my;
        var mDist = Math.sqrt(mdx * mdx + mdy * mdy);
        mb = Math.max(0, 1 - mDist / mouseR) * 0.35;
      }

      var brightness = pulse * vignette + mb;
      if (brightness < 0.015) continue;

      if (s.type === "G") {
        var g = Math.round(180 * brightness);
        ctx.fillStyle = "rgba(0," + g + ",0," + (brightness * 0.65).toFixed(3) + ")";
        ctx.beginPath();
        ctx.arc(s.cx, s.cy, s.size + brightness * 0.4, 0, Math.PI * 2);
        ctx.fill();
      } else {
        var rb = (Math.floor(i / 2)) & 1;
        var sz = s.size * (0.85 + brightness * 0.2);
        var r = 0, b = 0;
        if (s.type === "R") r = Math.round(200 * brightness);
        else b = Math.round(220 * brightness);
        var a = brightness * 0.55;

        ctx.fillStyle = "rgba(" + r + ",0," + b + "," + a.toFixed(3) + ")";
        ctx.beginPath();
        ctx.moveTo(s.cx, s.cy - sz);
        ctx.lineTo(s.cx + sz, s.cy);
        ctx.lineTo(s.cx, s.cy + sz);
        ctx.lineTo(s.cx - sz, s.cy);
        ctx.closePath();
        ctx.fill();
      }
    }
  }

  function frame(time) {
    draw(time);
    requestAnimationFrame(frame);
  }

  document.addEventListener("mousemove", function (e) {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
  });
  document.addEventListener("mouseleave", function () {
    mouse.x = -1;
    mouse.y = -1;
  });

  window.addEventListener("resize", rebuild);
  rebuild();
  requestAnimationFrame(frame);
})();
