/**
 * lattice.js — AMOLED Diamond PenTile Subpixel Lattice
 *
 * Renders the actual AMOLED subpixel geometry as a living background.
 * Green circles, red/blue diamonds — the real PenTile arrangement.
 */

(function initLattice() {
  const canvas = document.getElementById('lattice');
  const ctx = canvas.getContext('2d', { alpha: false });

  let W, H, dpr;
  let frame;

  // Lattice config
  const PITCH_X = 12;
  const PITCH_Y = 14;
  const GREEN_RADIUS = 2.5;
  const DIAMOND_RADIUS = 2.8;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function draw(time) {
    // Clear to true black
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, W, H);

    const cols = Math.ceil(W / PITCH_X) + 3;
    const rows = Math.ceil(H / PITCH_Y) + 3;

    // Slow breathing pulse
    const t = time / 3000;
    const pulse = 0.45 + 0.12 * Math.sin(t);

    // Mouse interaction — subtle brightness boost near cursor
    const mx = mouse.x;
    const my = mouse.y;
    const mouseRadius = 200;

    for (let row = 0; row < rows; row++) {
      const rowShiftX = (row & 1) * (PITCH_X * 0.5);

      for (let col = 0; col < cols; col++) {
        const cx = col * PITCH_X + rowShiftX;
        const cy = row * PITCH_Y;

        // Vignette from edges
        const dx = cx - W * 0.5;
        const dy = cy - H * 0.5;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const maxDist = Math.sqrt(W * W + H * H) * 0.5;
        const vignette = Math.max(0, 1 - Math.pow(dist / maxDist, 1.6));

        // Mouse proximity boost
        let mouseBoost = 0;
        if (mx >= 0 && my >= 0) {
          const mdx = cx - mx;
          const mdy = cy - my;
          const mDist = Math.sqrt(mdx * mdx + mdy * mdy);
          mouseBoost = Math.max(0, 1 - mDist / mouseRadius) * 0.3;
        }

        const brightness = pulse * vignette + mouseBoost;
        if (brightness < 0.02) continue;

        const isGreen = ((row + col) & 1) === 0;

        if (isGreen) {
          const g = Math.round(200 * brightness);
          const a = brightness * 0.7;
          ctx.fillStyle = `rgba(0,${g},0,${a.toFixed(3)})`;
          ctx.beginPath();
          ctx.arc(cx, cy, GREEN_RADIUS + brightness * 0.5, 0, Math.PI * 2);
          ctx.fill();
        } else {
          const rbPhase = (Math.floor(col / 2) + row) & 1;
          const size = DIAMOND_RADIUS * (0.8 + brightness * 0.3);

          let r = 0, b = 0;
          if (rbPhase === 0) {
            r = Math.round(220 * brightness);
          } else {
            b = Math.round(240 * brightness);
          }
          const a = brightness * 0.6;

          ctx.fillStyle = `rgba(${r},0,${b},${a.toFixed(3)})`;
          ctx.beginPath();
          ctx.moveTo(cx, cy - size);
          ctx.lineTo(cx + size, cy);
          ctx.lineTo(cx, cy + size);
          ctx.lineTo(cx - size, cy);
          ctx.closePath();
          ctx.fill();
        }
      }
    }
  }

  // Mouse tracking for interactive brightness
  const mouse = { x: -1, y: -1 };
  document.addEventListener('mousemove', (e) => {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
  });
  document.addEventListener('mouseleave', () => {
    mouse.x = -1;
    mouse.y = -1;
  });

  function animate(time) {
    draw(time);
    frame = requestAnimationFrame(animate);
  }

  window.addEventListener('resize', resize);
  resize();
  animate(0);
})();
