/**
 * app.js — Weather.ali.et Sensor Dashboard
 * Fetches Arduino data, renders charts, auto-refreshes.
 */

// Auto-detect: if on GitHub Pages, fetch from w.ali.et; otherwise same origin
const API = window.location.hostname === 'axialhash.github.io' || window.location.hostname === 'weather.ali.et'
  ? 'https://w.ali.et'
  : '';
let chartTemp, chartHL;
let currentHours = 6;

// ── Chart.js Config ──────────────────────────────────────────────
Chart.defaults.color = 'rgba(255,255,255,0.35)';
Chart.defaults.borderColor = 'rgba(255,255,255,0.06)';
Chart.defaults.font.family = "'JetBrains Mono', monospace";
Chart.defaults.font.size = 10;

const CHART_COLORS = {
  temp: '#00ff88',
  tempFill: 'rgba(0, 255, 136, 0.08)',
  humidity: '#4488ff',
  humidityFill: 'rgba(68, 136, 255, 0.08)',
  light: '#ff8844',
  lightFill: 'rgba(255, 136, 68, 0.08)',
};

function createCharts() {
  const tempCtx = document.getElementById('chart-temp').getContext('2d');
  const hlCtx = document.getElementById('chart-humidity-light').getContext('2d');

  chartTemp = new Chart(tempCtx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [{
        label: 'Temperature (°C)',
        data: [],
        borderColor: CHART_COLORS.temp,
        backgroundColor: CHART_COLORS.tempFill,
        borderWidth: 1.5,
        pointRadius: 0,
        pointHoverRadius: 4,
        tension: 0.3,
        fill: true,
      }]
    },
    options: chartOptions('°C'),
  });

  chartHL = new Chart(hlCtx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        {
          label: 'Humidity (%)',
          data: [],
          borderColor: CHART_COLORS.humidity,
          backgroundColor: CHART_COLORS.humidityFill,
          borderWidth: 1.5,
          pointRadius: 0,
          pointHoverRadius: 4,
          tension: 0.3,
          fill: true,
          yAxisID: 'y',
        },
        {
          label: 'Light (%)',
          data: [],
          borderColor: CHART_COLORS.light,
          backgroundColor: CHART_COLORS.lightFill,
          borderWidth: 1.5,
          pointRadius: 0,
          pointHoverRadius: 4,
          tension: 0.3,
          fill: true,
          yAxisID: 'y1',
        }
      ]
    },
    options: chartOptionsHL(),
  });
}

function chartOptions(unit) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { intersect: false, mode: 'index' },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: 'rgba(0,0,0,0.8)',
        borderColor: 'rgba(255,255,255,0.1)',
        borderWidth: 1,
        titleFont: { family: "'JetBrains Mono', monospace", size: 10 },
        bodyFont: { family: "'Inter', sans-serif", size: 12 },
        padding: 10,
        cornerRadius: 6,
        callbacks: {
          label: (ctx) => `${ctx.parsed.y.toFixed(1)}${unit}`
        }
      },
    },
    scales: {
      x: {
        grid: { display: false },
        ticks: { maxTicksLimit: 8, maxRotation: 0 },
      },
      y: {
        grid: { color: 'rgba(255,255,255,0.04)' },
        ticks: { callback: (v) => v + '°' },
      },
    },
  };
}

function chartOptionsHL() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { intersect: false, mode: 'index' },
    plugins: {
      legend: {
        display: true,
        position: 'top',
        align: 'end',
        labels: {
          boxWidth: 8,
          boxHeight: 8,
          usePointStyle: true,
          pointStyle: 'circle',
          padding: 12,
          font: { size: 9 },
        }
      },
      tooltip: {
        backgroundColor: 'rgba(0,0,0,0.8)',
        borderColor: 'rgba(255,255,255,0.1)',
        borderWidth: 1,
        padding: 10,
        cornerRadius: 6,
      },
    },
    scales: {
      x: {
        grid: { display: false },
        ticks: { maxTicksLimit: 8, maxRotation: 0 },
      },
      y: {
        position: 'left',
        grid: { color: 'rgba(255,255,255,0.04)' },
        ticks: { callback: (v) => v + '%' },
        min: 0,
        max: 100,
      },
      y1: {
        position: 'right',
        grid: { display: false },
        ticks: { callback: (v) => v + '%' },
        min: 0,
        max: 100,
      },
    },
  };
}

// ── Data Fetching ────────────────────────────────────────────────
async function fetchCurrent() {
  try {
    const res = await fetch(`${API}/api/current`);
    const data = await res.json();
    const r = data.reading;

    // Status indicator
    const statusEl = document.getElementById('status');
    if (data.serial_connected) {
      statusEl.classList.add('connected');
      statusEl.querySelector('.status-text').textContent = 'live';
    } else {
      statusEl.classList.remove('connected');
      statusEl.querySelector('.status-text').textContent = 'disconnected';
    }

    // Hero values
    if (r && r.temp != null) {
      document.getElementById('hero-temp').textContent = r.temp.toFixed(1);
      document.getElementById('card-humidity').textContent = r.humidity != null ? `${r.humidity.toFixed(0)}%` : '--';
      document.getElementById('card-light').textContent = r.light != null ? `${r.light}%` : '--';

      // Dew point approximation
      if (r.temp != null && r.humidity != null) {
        const dp = r.temp - ((100 - r.humidity) / 5);
        document.getElementById('card-feels').textContent = `${dp.toFixed(1)}°`;
      }
    }
  } catch (e) {
    console.error('Current fetch failed:', e);
  }
}

async function fetchHistory() {
  try {
    const res = await fetch(`${API}/api/history?hours=${currentHours}`);
    const data = await res.json();
    const readings = data.readings;

    if (!readings.length) return;

    const labels = readings.map(r => {
      const d = new Date(r.timestamp * 1000);
      return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
    });

    const temps = readings.map(r => r.temp);
    const hums = readings.map(r => r.humidity);
    const lights = readings.map(r => r.light);

    // Update temp chart
    chartTemp.data.labels = labels;
    chartTemp.data.datasets[0].data = temps;
    chartTemp.update('none');

    // Update humidity+light chart
    chartHL.data.labels = labels;
    chartHL.data.datasets[0].data = hums;
    chartHL.data.datasets[1].data = lights;
    chartHL.update('none');

  } catch (e) {
    console.error('History fetch failed:', e);
  }
}

async function fetchStats() {
  try {
    const res = await fetch(`${API}/api/stats?hours=24`);
    const s = await res.json();

    if (s.sample_count > 0) {
      document.getElementById('stat-high').textContent = `${s.temp_max.toFixed(1)}°`;
      document.getElementById('stat-low').textContent = `${s.temp_min.toFixed(1)}°`;
      document.getElementById('stat-avg').textContent = `${s.temp_avg.toFixed(1)}°`;
      document.getElementById('stat-count').textContent = s.sample_count.toLocaleString();
    }
  } catch (e) {
    console.error('Stats fetch failed:', e);
  }
}

// ── Time Range Buttons ───────────────────────────────────────────
document.querySelectorAll('.range-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.range-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentHours = parseInt(btn.dataset.hours);
    fetchHistory();
  });
});

// ── Init ─────────────────────────────────────────────────────────
createCharts();
fetchCurrent();
fetchHistory();
fetchStats();

// Auto-refresh every 5 seconds (current) / 30 seconds (history)
setInterval(fetchCurrent, 5000);
setInterval(() => { fetchHistory(); fetchStats(); }, 30000);

// Update timestamp
setInterval(() => {
  document.getElementById('last-update').textContent =
    new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) + ' EAT';
}, 1000);
