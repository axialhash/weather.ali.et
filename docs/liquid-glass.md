# Liquid Glass Technique

How the AMOLED lattice gets refracted through the glass panels and fisheye cursor lens.

## Overview

Based on [this CodePen](https://codepen.io/...) technique. The core idea:

1. Generate a **displacement map** — a grayscale image where pixel values encode how much to shift the content behind the glass
2. Feed it into an **SVG `feDisplacementMap` filter**
3. Apply the filter to a **clone** of the lattice canvas sitting behind the glass panel
4. Stack CSS **blur + tint + glint** layers on top

## Why a displacement map?

CSS `backdrop-filter` can blur and tint, but it can't do **refraction** — bending light around edges. The SVG displacement map gives us per-pixel control over where each pixel gets sampled from, creating the illusion of light bending through glass.

## Displacement map encoding

| Channel | Meaning |
|---------|---------|
| R | X displacement (127.5 = no shift, >127.5 = right, <127.5 = left) |
| G | Y displacement (127.5 = no shift, >127.5 = down, <127.5 = up) |
| B | Unused (set to 128) |
| A | Always 255 |

## Two map types

### Edge bevel (glass panels)

Used on the dashboard panels. Only displaces pixels near the glass edge, creating a bevel/refraction rim.

```
SDF (signed distance field) → smooth bevel profile → displacement along surface normal
```

- `sdf()` computes distance from each pixel to the rounded-rect edge
- Surface normal computed via central differences on the SDF
- Displacement amount follows smootherstep curve, shaped by curvature parameter
- Inner side gets wider falloff than outer side (asymmetric bevel)

### Fisheye (cursor lens)

Used on the magnifying cursor. Displaces ALL pixels outward from center.

```
radial distance → barrel distortion curve → outward displacement + edge bevel
```

- `normDist = distance_from_center / maxRadius` (0 at center, 1 at edge)
- `fisheyeAmt = t² × (magnification - 1) × maxR × 0.4`
- The t² curve = barrel distortion (slow center, accelerating edges)
- Combined with edge bevel at the rim for glass-like edge refraction
- `magnification: 2.0` = content appears 2x zoomed

## Safari cache-busting

Safari caches SVG filter output by filter ID. If the ID doesn't change, Safari freezes the filter on its first frame — animated content behind the glass stops updating.

**Fix:** Inject a new `<filter>` element with a unique ID every time the map changes. The ID counter increments globally (`version++`).

```javascript
var id = "glass-f" + (++version);
housing.innerHTML = `<defs><filter id="${id}" ...>...</filter></defs>`;
element.style.filter = `url(#${id})`;
```

This forces Safari to re-render the filter each frame.

Source: [Aave team](https://aave.com/design/building-glass-for-the-web)

## Performance

- Displacement maps are **cached** by parameter key (mapCache Map)
- Glass clones update at **80ms intervals** (not every frame)
- Cursor lens uses **smooth lerp** (0.14 factor) to reduce jitter
- Mobile: cursor lens **disabled** (no mouse)
- Map cache capped at 50 entries to prevent memory growth

## Parameters

| Param | Glass Panels | Cursor Lens | Effect |
|-------|-------------|-------------|--------|
| depth | 40 | 60 | Displacement scale (px) |
| splay | 3 | 3 | Edge spread |
| feather | 20 | 14 | Edge softness |
| curve | 1.8 | 1.5 | Bevel profile shape |
| blur | 0.8 | 0.3 | CSS blur (px) |
| glint | 30 | 35 | Specular highlight intensity |
| tint | 0.03 | 0.02 | Gold color tint opacity |
| magnification | — | 2.0 | Fisheye zoom factor |
