/**
 * app.js — weather.ali.et sensor dashboard.
 * Fetches Arduino data + real weather, renders charts, handles offline.
 */

(function () {
  "use strict";

  var hostname = window.location.hostname;
  var API = (hostname === "axialhash.github.io" || hostname === "weather.ali.et")
    ? "https://w.ali.et" : "";

  var STALE_MS = 15000;
  var lastDataTime = 0;
  var currentHours = 6;
  var chartTemp, chartHL;

  Chart.defaults.color = "rgba(255,255,255,0.3)";
  Chart.defaults.borderColor = "rgba(255,255,255,0.05)";
  Chart.defaults.font.family = "'JetBrains Mono', monospace";
  Chart.defaults.font.size = 9;
  Chart.defaults.animation = false;

  // ── DOM cache ───────────────────────────────────

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
  banner.textContent = "api unreachable \u2014 retrying";
  document.body.appendChild(banner);

  var lastState = "connecting";
  function setStatus(state) {
    if (state === lastState) return;
    lastState = state;
    $status.className = "conn-status " + state;
    $statusLabel.textContent = state === "live" ? "live" : state === "stale" ? "stale" : "offline";
    banner.classList.toggle("visible", state !== "live");
  }

  // ── Charts ──────────────────────────────────────

  function initCharts() {
    var tt = { backgroundColor: "rgba(0,0,0,0.85)", borderColor: "rgba(255,255,255,0.08)", borderWidth: 1, padding: 8, cornerRadius: 4 };

    chartTemp = new Chart(document.getElementById("chart-temp"), {
      type: "line",
      data: { labels: [], datasets: [{ data: [], borderColor: "#00ff88", backgroundColor: "rgba(0,255,136,0.06)", borderWidth: 1.5, pointRadius: 0, tension: 0.3, fill: true }] },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        interaction: { intersect: false, mode: "index" },
        plugins: { legend: { display: false }, tooltip: tt },
        scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 6, maxRotation: 0 } }, y: { grid: { color: "rgba(255,255,255,0.03)" }, ticks: { callback: function (v) { return v + "\u00B0"; } } } }
      }
    });

    chartHL = new Chart(document.getElementById("chart-hl"), {
      type: "line",
      data: {
        labels: [],
        datasets: [
          { label: "Humidity", data: [], borderColor: "#4488ff", backgroundColor: "rgba(68,136,255,0.06)", borderWidth: 1.5, pointRadius: 0, tension: 0.3, fill: true, yAxisID: "y" },
          { label: "Light", data: [], borderColor: "#ffaa33", backgroundColor: "rgba(255,170,51,0.06)", borderWidth: 1.5, pointRadius: 0, tension: 0.3, fill: true, yAxisID: "y1" }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        interaction: { intersect: false, mode: "index" },
        plugins: { legend: { display: true, position: "top", align: "end", labels: { boxWidth: 6, boxHeight: 6, usePointStyle: true, pointStyle: "circle", padding: 10, font: { size: 8 } } }, tooltip: tt },
        scales: {
          x: { grid: { display: false }, ticks: { maxTicksLimit: 6, maxRotation: 0 } },
          y: { position: "left", grid: { color: "rgba(255,255,255,0.03)" }, ticks: { callback: function (v) { return v + "%"; } }, min: 0, max: 100 },
          y1: { position: "right", grid: { display: false }, ticks: { callback: function (v) { return v + "%"; } }, min: 0, max: 100 }
        }
      }
    });
  }

  // ── Fetch with timeout ──────────────────────────

  function fetchJSON(url, ms) {
    var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    var timer;
    if (ctrl) timer = setTimeout(function () { ctrl.abort(); }, ms || 8000);
    return fetch(url, ctrl ? { signal: ctrl.signal } : undefined).then(function (res) {
      if (!res.ok) throw new Error(res.status);
      return res.json();
    }).finally(function () { if (ctrl) clearTimeout(timer); });
  }

  // ── Fetchers ────────────────────────────────────

  function fetchCurrent() {
    return fetchJSON(API + "/api/current", 6000).then(function (data) {
      var r = data.reading;
      lastDataTime = Date.now();

      // Feed weather to lattice
      if (data.weather && window.__lattice) {
        window.__lattice.updateWeather(data.weather);
      }

      requestAnimationFrame(function () {
        setStatus(data.serial_connected ? "live" : "stale");
        if (r && r.temp != null) {
          $temp.textContent = r.temp.toFixed(1);
          $temp.classList.remove("stale");
          $humidity.textContent = r.humidity != null ? r.humidity.toFixed(0) + "%" : "--";
          $light.textContent = r.light != null ? r.light + "%" : "--";
          if (r.humidity != null) {
            $dew.textContent = (r.temp - (100 - r.humidity) / 5).toFixed(1) + " C";
          }
        }
      });
    }).catch(function () {
      if (Date.now() - lastDataTime > STALE_MS) {
        requestAnimationFrame(function () {
          setStatus("offline");
          $temp.classList.add("stale");
        });
      }
    });
  }

  function fetchHistory() {
    return fetchJSON(API + "/api/history?hours=" + currentHours, 10000).then(function (data) {
      var rows = data.readings;
      if (!rows || !rows.length) return;
      var labels = [], temps = [], hums = [], lights = [];
      for (var i = 0; i < rows.length; i++) {
        var r = rows[i];
        var d = new Date(r.timestamp * 1000);
        labels.push(d.getHours().toString().padStart(2, "0") + ":" + d.getMinutes().toString().padStart(2, "0"));
        temps.push(r.temp);
        hums.push(r.humidity);
        lights.push(r.light);
      }
      chartTemp.data.labels = labels;
      chartTemp.data.datasets[0].data = temps;
      chartTemp.update("none");
      chartHL.data.labels = labels;
      chartHL.data.datasets[0].data = hums;
      chartHL.data.datasets[1].data = lights;
      chartHL.update("none");
    }).catch(function () {});
  }

  function fetchStats() {
    return fetchJSON(API + "/api/stats?hours=24", 10000).then(function (s) {
      if (s.sample_count > 0) {
        requestAnimationFrame(function () {
          $high.textContent = s.temp_max.toFixed(1) + "\u00B0";
          $low.textContent = s.temp_min.toFixed(1) + "\u00B0";
          $avg.textContent = s.temp_avg.toFixed(1) + "\u00B0";
          $count.textContent = s.sample_count.toLocaleString();
        });
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
    var n = new Date();
    $footerTime.textContent = n.getHours().toString().padStart(2, "0") + ":" +
      n.getMinutes().toString().padStart(2, "0") + ":" +
      n.getSeconds().toString().padStart(2, "0") + " EAT";
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
  setInterval(function () {
    if (lastDataTime > 0 && Date.now() - lastDataTime > STALE_MS) {
      setStatus("offline");
      $temp.classList.add("stale");
    }
  }, 3000);
})();
