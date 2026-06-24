"""
weather.ali.et — Sensor Dashboard Backend
Reads Arduino serial data, stores history, serves API + frontend.
"""

import asyncio
import json
import sqlite3
import time
from datetime import datetime, timedelta
from pathlib import Path

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

# ── Config ──────────────────────────────────────────────────────────
SERIAL_PORT = "/dev/ttyUSB0"
BAUD_RATE = 9600
DB_PATH = Path(__file__).parent.parent / "data" / "sensors.db"
FRONTEND_DIR = Path(__file__).parent.parent / "frontend"

# ── App ─────────────────────────────────────────────────────────────
app = FastAPI(title="weather.ali.et")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Database ────────────────────────────────────────────────────────
DB_PATH.parent.mkdir(parents=True, exist_ok=True)


def get_db():
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = get_db()
    conn.execute("""
        CREATE TABLE IF NOT EXISTS readings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp REAL NOT NULL,
            temp REAL,
            humidity REAL,
            light INTEGER,
            raw INTEGER
        )
    """)
    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_readings_timestamp
        ON readings(timestamp DESC)
    """)
    conn.commit()
    conn.close()


init_db()

# ── Serial Reader (background) ─────────────────────────────────────
latest_reading = {}
serial_connected = False


async def read_serial():
    """Read Arduino serial data in background thread."""
    global latest_reading, serial_connected

    try:
        import serial
    except ImportError:
        print("[WARN] pyserial not installed, serial reading disabled")
        return

    while True:
        try:
            ser = serial.Serial(SERIAL_PORT, BAUD_RATE, timeout=2)
            serial_connected = True
            print(f"[OK] Connected to {SERIAL_PORT}")

            while True:
                line = ser.readline().decode("utf-8", errors="ignore").strip()
                if not line:
                    continue
                try:
                    data = json.loads(line)
                    data["timestamp"] = time.time()
                    latest_reading = data

                    # Store in DB
                    conn = get_db()
                    conn.execute(
                        "INSERT INTO readings (timestamp, temp, humidity, light, raw) VALUES (?, ?, ?, ?, ?)",
                        (data["timestamp"], data.get("temp"), data.get("humidity"),
                         data.get("light"), data.get("raw")),
                    )
                    conn.commit()
                    conn.close()
                except json.JSONDecodeError:
                    pass

        except Exception as e:
            serial_connected = False
            print(f"[WARN] Serial error: {e}, retrying in 5s...")
            await asyncio.sleep(5)


@app.on_event("startup")
async def startup():
    asyncio.create_task(read_serial())


# ── API Routes ──────────────────────────────────────────────────────
@app.get("/api/current")
async def current():
    return {
        "reading": latest_reading,
        "serial_connected": serial_connected,
        "timestamp": datetime.now().isoformat(),
    }


@app.get("/api/history")
async def history(hours: int = 24):
    """Get historical readings for the last N hours."""
    conn = get_db()
    cutoff = time.time() - (hours * 3600)
    rows = conn.execute(
        "SELECT timestamp, temp, humidity, light FROM readings WHERE timestamp > ? ORDER BY timestamp ASC",
        (cutoff,),
    ).fetchall()
    conn.close()

    return {
        "readings": [dict(r) for r in rows],
        "count": len(rows),
        "hours": hours,
    }


@app.get("/api/stats")
async def stats(hours: int = 24):
    """Get min/max/avg stats for the last N hours."""
    conn = get_db()
    cutoff = time.time() - (hours * 3600)
    row = conn.execute(
        """
        SELECT
            MIN(temp) as temp_min, MAX(temp) as temp_max, AVG(temp) as temp_avg,
            MIN(humidity) as hum_min, MAX(humidity) as hum_max, AVG(humidity) as hum_avg,
            MIN(light) as light_min, MAX(light) as light_max, AVG(light) as light_avg,
            COUNT(*) as sample_count
        FROM readings WHERE timestamp > ?
        """,
        (cutoff,),
    ).fetchone()
    conn.close()

    return dict(row) if row else {}


# ── Frontend ────────────────────────────────────────────────────────
# Serve static frontend files
app.mount("/static", StaticFiles(directory=str(FRONTEND_DIR)), name="static")


@app.get("/")
async def index():
    return FileResponse(str(FRONTEND_DIR / "index.html"))


# ── Run ─────────────────────────────────────────────────────────────
if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8080)
