# weather.ali.et

Real-time weather dashboard showing outdoor conditions (Open-Meteo API) and indoor sensor readings (Arduino DHT11 + LDR) through an AMOLED Diamond PenTile subpixel lattice with liquid glass refraction.

## Live

**[weather.ali.et](https://weather.ali.et)**

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    weather.ali.et                        │
│                  (GitHub Pages)                          │
│                                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │  lattice.js  │  │   app.js     │  │ liquid-glass │  │
│  │  AMOLED Pen- │  │  Data fetch  │  │  SVG filter  │  │
│  │  Tile grid   │  │  Chart.js    │  │  Fisheye lens│  │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  │
│         │                 │                  │          │
│         └────────┬────────┴──────────────────┘          │
│                  │ fetch()                               │
└──────────────────┼──────────────────────────────────────┘
                   │ HTTPS
                   ▼
┌──────────────────────────────────────────────────────────┐
│  w.ali.et (Cloudflare Tunnel → MiMo laptop:8080)        │
│                                                          │
│  ┌──────────────────────────────────────────────────┐    │
│  │  FastAPI (backend/server.py)                     │    │
│  │                                                  │    │
│  │  /api/current  → Arduino reading + weather       │    │
│  │  /api/history  → SQLite time series              │    │
│  │  /api/stats    → 24h min/max/avg                 │    │
│  │  /api/weather  → Open-Meteo cache                │    │
│  │                                                  │    │
│  │  Threads:                                        │    │
│  │    ├── Serial reader (/dev/ttyUSB0, 9600 baud)   │    │
│  │    ├── Weather fetcher (Open-Meteo, 10min TTL)   │    │
│  │    └── SQLite writer                             │    │
│  └──────────────────────────────────────────────────┘    │
│                   │                                      │
│                   │ Serial (CH340 USB)                   │
│                   ▼                                      │
│  ┌──────────────────────────┐                           │
│  │  Arduino Uno (CH340)     │                           │
│  │  DHT11 → pin 2 (temp)   │                           │
│  │  LDR   → A0 (light)     │                           │
│  │  JSON @ 9600 baud / 2s   │                           │
│  └──────────────────────────┘                           │
└──────────────────────────────────────────────────────────┘
```

## Features

- **AMOLED Diamond PenTile lattice** — subpixel grid rendering weather through RGB channels
- **Liquid glass panels** — SVG feDisplacementMap refraction with displacement maps
- **Fisheye cursor lens** — real magnification physics (radial displacement outward from center)
- **Dynamic sun/moon** — calculated from sunrise/sunset times, not cached backend values
- **Correct moon phases** — clip-mask rendering, tracks actual lunar cycle
- **Split-view dashboard** — outdoor (Open-Meteo) vs indoor (Arduino) side by side
- **Chart.js graphs** — temperature, humidity, light with gradient fills
- **Mobile responsive** — single-column layout on small screens
- **Graceful offline** — status indicator, stale data flash, retry banner

## Color Palette — Tokyo Midnight

| Role | Color | Hex |
|------|-------|-----|
| Background | Pure black | `#000000` |
| Primary accent | Tritium gold | `#F3CA40` |
| Secondary | Steel blue | `#577399` |
| Text | Ice white | `#F2F4F8` |

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Vanilla HTML/CSS/JS, Chart.js 4 |
| Fonts | Inter (Google Fonts), JetBrains Mono |
| Backend | Python FastAPI + uvicorn + pyserial |
| Database | SQLite (sensor history) |
| Weather API | Open-Meteo (free, no key) |
| Hosting | GitHub Pages (frontend), Docker on MiMo laptop (backend) |
| Tunnel | Cloudflare Tunnel (`aliflared-tunnel` container on `ali-net`) |

## Local Development

### Frontend

The frontend is static HTML/CSS/JS. Open `index.html` in a browser. The API auto-detects:

- On `weather.ali.et` or `axialhash.github.io` → fetches from `https://w.ali.et`
- On `localhost` or other → fetches from same origin

### Backend

```bash
# Install deps
pip install fastapi uvicorn pyserial

# Run (reads /dev/ttyUSB0, serves on :8080)
cd backend/
python server.py
```

The backend requires:
- `/dev/ttyUSB0` — Arduino serial port (CH340)
- Internet access — Open-Meteo API

## Deployment

### Frontend (GitHub Pages)

Push to `main` → GitHub Actions builds and deploys automatically (~5-8 min).

```
git push origin main
```

### Backend (Docker)

```bash
# Rebuild
docker build -t weather-api:latest .

# Restart
docker restart weather-api-server
```

The backend runs as a Docker container (`weather-api-server`) on the host network, with a socat bridge (`weather-api`) on the `ali-net` Docker network for Cloudflare Tunnel access.

### Cloudflare Tunnel

The tunnel container (`aliflared-tunnel`) routes `w.ali.et` → `localhost:8080` via socat → `weather-api-server`.

Public hostname config in Cloudflare dashboard:
- Subdomain: `w`
- Domain: `ali.et`
- Service: `http://weather-api:8080` (Docker network)

## Coordinates

- **Latitude:** 9.005 (Nefas Silk area, Addis Ababa)
- **Longitude:** 38.785
- **Timezone:** Africa/Addis_Ababa (UTC+3)

## File Structure

```
weather.ali.et/
├── index.html          # Dashboard shell
├── style.css           # Tokyo Midnight theme + glass styles
├── lattice.js          # AMOLED Diamond PenTile renderer
├── app.js              # Data fetching, Chart.js, DOM updates
├── liquid-glass.js     # SVG displacement refraction + fisheye lens
├── CNAME               # GitHub Pages custom domain
├── backend/
│   └── server.py       # FastAPI server (serial + weather + SQLite)
└── Dockerfile          # Backend container image
```

## Arduino Sensor Node

**Sketch:** `~/arduino/sensor_node/sensor_node.ino`

| Sensor | Pin | Type |
|--------|-----|------|
| DHT11 | 2 | Temperature + Humidity |
| LDR | A0 | Light (analog, 0-1023) |

**Output:** JSON at 9600 baud, every 2 seconds:
```json
{"temp": 22.9, "humidity": 58, "light": 77, "raw": 795}
```

## License

Personal project. Not licensed for reuse.
