/**
 * app.js — weather.ali.et sensor dashboard.
 * Fetches live Arduino data, renders charts, handles offline gracefully.
 */

(function () {
  "use strict";

  // Auto-detect API location
  var hostname = window.location.hostname;
  var API = (hostname === "axialhash.github.io" || hostname === "weather.ali.et")
    ? "https://w.ali.et"
    : "";

  var OFFLINE_THRESHOLD_MS = 15000;
  var lastDataTime = 0;
  var currentHours = 6;
  var chartTemp, chartHL;

  // ── Chart.js defaults ───────────────────────────

  Chart.defaults.color = "rgba(255,255,255,0.3)";
  Chart.defaults.borderColor = "rgba(255,255,255,0.05)";
  Chart.defaults.font.family = "'JetBrains Mono', monospace";
  Chart.defaults.font.size = 9;

  // ── Elements ────────────────────────────────────

  var $temp = document.getElementById("hero-temp");
  var $humidity = document.getElementById("val-humidity");
  var $light = document.getElementById("val-light");
  var $dew = document.getElementById("val-dew");
  var $status = document.getElementById("conn-status");
  var $statusLabel = $status.querySelector(".conn-label");
  var $high = document.getElementById("stat-high");
  var $low = document.getElementById("stat-low");
  var $avg = document.getElementById("stat-avg");
  var $count = document.getElementById("stat-count");
  var $footerTime = document.getElementById("footer-time");

  // ── Offline banner ──────────────────────────────

  var banner = document.createElement("div");
  banner.className = "offline-banner";
  banner.textContent = "api unreachable — retrying";
  document.body.appendChild(banner);

  function setStatus(state) {
    $status.className = "conn-status " + state;
    if (state === "live") {
      $statusLabel.textContent = "live";
      banner.classList.remove("visible");
    } else if (state === "stale") {
      $statusLabel.textContent = "stale";
      banner.classList.add("visible");
    } else {
      $statusLabel.textContent = "offline";
      banner.classList.add("visible");
    }
  }

  // ── Charts ──────────────────────────────────────

  function initCharts() {
    chartTemp = new Chart(document.getElementById("chart-temp"), {
      type: "line",
      data: { labels: [], datasets: [{ label: "Temperature", data: [], borderColor: "#00ff88", backgroundColor: "rgba(0,255,136,0.06)", borderWidth: 1.5, pointRadius: 0, pointHoverRadius: 3, tension: 0.3, fill: true }] },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { intersect: false, mode: "index" },
        plugins: { legend: { display: false }, tooltip: { backgroundColor: "rgba(0,0,0,0.85)", borderColor: "rgba(255,255,255,0.08)", borderWidth: 1, padding: 8, cornerRadius: 4, titleFont: { size: 9 }, bodyFont: { size: 11 }, callbacks: { label: function (c) { return c.parsed.y.toFixed(1) + " C"; } } } },
        scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 7, maxRotation: 0 } }, y: { grid: { color: "rgba(255,255,255,0.03)" }, ticks: { callback: function (v) { return v + "\u00B0"; } } } },
      }
    });

    chartHL = new Chart(document.getElementById("chart-hl"), {
      type: "line",
      data: {
        labels: [],
        datasets: [
          { label: "Humidity", data: [], borderColor: "#4488ff", backgroundColor: "rgba(68,136,255,0.06)", borderWidth: 1.5, pointRadius: 0, pointHoverRadius: 3, tension: 0.3, fill: true, yAxisID: "y" },
          { label: "Light", data: [], borderColor: "#ffaa33", backgroundColor: "rgba(255,170,51,0.06)", borderWidth: 1.5, pointRadius: 0, pointHoverRadius: 3, tension: 0.3, fill: true, yAxisID: "y1" }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { intersect: false, mode: "index" },
        plugins: {
          legend: { display: true, position: "top", align: "end", labels: { boxWidth: 6, boxHeight: 6, usePointStyle: true, pointStyle: "circle", padding: 10, font: { size: 8 } } },
          tooltip: { backgroundColor: "rgba(0,0,0,0.85)", borderColor: "rgba(255,255,255,0.08)", borderWidth: 1, padding: 8, cornerRadius: 4 }
        },
        scales: {
          x: { grid: { display: false }, ticks: { maxTicksLimit: 7, maxRotation: 0 } },
          y: { position: "left", grid: { color: "rgba(255,255,255,0.03)" }, ticks: { callback: function (v) { return v + "%"; } }, min: 0, max: 100 },
          y1: { position: "right", grid: { display: false }, ticks: { callback: function (v) { return v + "%"; } }, min: 0, max: 100 }
        },
      }
    });
  }

  // ── Fetchers ────────────────────────────────────

  function fetchCurrent() {
    return fetch(API + "/api/current").then(function (res) {
      if (!res.ok) throw new Error(res.status);
      return res.json();
    }).then(function (data) {
      var r = data.reading;
      lastDataTime = Date.now();

      if (data.serial_connected) {
        setStatus("live");
      } else {
        setStatus("stale");
      }

      if (r && r.temp != null) {
        $temp.textContent = r.temp.toFixed(1);
        $temp.classList.remove("stale");
        $humidity.textContent = r.humidity != null ? r.humidity.toFixed(0) + "%" : "--";
        $light.textContent = r.light != null ? r.light + "%" : "--";
        if (r.temp != null && r.humidity != null) {
          var dp = r.temp - ((100 - r.humidity) / 5);
          $dew.textContent = dp.toFixed(1) + " C";
        }
      }
    }).catch(function () {
      if (Date.now() - lastDataTime > OFFLINE_THRESHOLD_MS) {
        setStatus("offline");
        $temp.classList.add("stale");
      }
    });
  }

  function fetchHistory() {
    return fetch(API + "/api/history?hours=" + currentHours).then(function (res) {
      if (!res.ok) throw new Error(res.status);
      return res.json();
    }).then(function (data) {
      var rows = data.readings;
      if (!rows || !rows.length) return;

      var labels = rows.map(function (r) {
        var d = new Date(r.timestamp * 1000);
        return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
      });

      chartTemp.data.labels = labels;
      chartTemp.data.datasets[0].data = rows.map(function (r) { return r.temp; });
      chartTemp.update("none");

      chartHL.data.labels = labels;
      chartHL.data.datasets[0].data = rows.map(function (r) { return r.humidity; });
      chartHL.data.datasets[1].data = rows.map(function (r) { return r.light; });
      chartHL.update("none");
    }).catch(function () {});
  }

  function fetchStats() {
    return fetch(API + "/api/stats?hours=24").then(function (res) {
      if (!res.ok) throw new Error(res.status);
      return res.json();
    }).then(function (s) {
      if (s.sample_count > 0) {
        $high.textContent = s.temp_max.toFixed(1) + "\u00B0";
        $low.textContent = s.temp_min.toFixed(1) + "\u00B0";
        $avg.textContent = s.temp_avg.toFixed(1) + "\u00B0";
        $count.textContent = s.sample_count.toLocaleString();
      }
    }).catch(function () {});
  }

  // ── Range buttons ───────────────────────────────

  document.getElementById("range-buttons").addEventListener("click", function (e) {
    var btn = e.target.closest(".range-btn");
    if (!btn) return;
    document.querySelectorAll(".range-btn").forEach(function (b) { b.classList.remove("active"); });
    btn.classList.add("active");
    currentHours = parseInt(btn.dataset.hours, 10);
    fetchHistory();
  });

  // ── Clock ───────────────────────────────────────

  function tickClock() {
    $footerTime.textContent = new Date().toLocaleTimeString("en-US", {
      hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false
    }) + " EAT";
  }

  // ── Init ────────────────────────────────────────

  initCharts();
  fetchCurrent();
  fetchHistory();
  fetchStats();
  tickClock();

  setInterval(fetchCurrent, 5000);
  setInterval(function () { fetchHistory(); fetchStats(); }, 30000);
  setInterval(tickClock, 1000);

  // Check staleness every 3s
  setInterval(function () {
    if (lastDataTime > 0 && Date.now() - lastDataTime > OFFLINE_THRESHOLD_MS) {
      setStatus("offline");
      $temp.classList.add("stale");
    }
  }, 3000);
})();
