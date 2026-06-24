/**
 * app.js — weather.ali.et split-view dashboard.
 * Left: outdoor weather (Open-Meteo). Right: server room (Arduino).
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

  // ── DOM cache ────────────────────────────────────

  var $oTemp = document.getElementById("outdoor-temp");
  var $oCondition = document.getElementById("outdoor-condition");
  var $oWind = document.getElementById("outdoor-wind");
  var $oClouds = document.getElementById("outdoor-clouds");
  var $oHumidity = document.getElementById("outdoor-humidity");
  var $oPrecip = document.getElementById("outdoor-precip");
  var $oSunrise = document.getElementById("outdoor-sunrise");
  var $oSunset = document.getElementById("outdoor-sunset");

  var $iTemp = document.getElementById("indoor-temp");
  var $iStatus = document.getElementById("indoor-status");
  var $iHumidity = document.getElementById("indoor-humidity");
  var $iLight = document.getElementById("indoor-light");
  var $iDew = document.getElementById("indoor-dew");
  var $iHigh = document.getElementById("stat-high");
  var $iLow = document.getElementById("stat-low");
  var $iAvg = document.getElementById("stat-avg");

  var $footerTime = document.getElementById("footer-time");

  // ── Offline banner ───────────────────────────────

  var banner = document.createElement("div");
  banner.className = "offline-banner";
  banner.textContent = "api unreachable \u2014 retrying";
  document.body.appendChild(banner);

  // ── Charts ───────────────────────────────────────

  function initCharts() {
    var tt = {
      backgroundColor: "rgba(0,0,0,0.85)",
      borderColor: "rgba(255,255,255,0.08)",
      borderWidth: 1,
      padding: 10,
      cornerRadius: 6,
      titleFont: { family: "'JetBrains Mono', monospace", size: 10 },
      bodyFont: { family: "'JetBrains Mono', monospace", size: 11 },
    };

    chartTemp = new Chart(document.getElementById("chart-temp"), {
      type: "line",
      data: {
        labels: [],
        datasets: [{
          data: [],
          borderColor: "#00ff88",
          backgroundColor: function(ctx) {
            var chart = ctx.chart;
            var area = chart.chartArea;
            if (!area) return "rgba(0,255,136,0.06)";
            var g = chart.ctx.createLinearGradient(0, area.top, 0, area.bottom);
            g.addColorStop(0, "rgba(0,255,136,0.15)");
            g.addColorStop(1, "rgba(0,255,136,0.01)");
            return g;
          },
          borderWidth: 1.5,
          pointRadius: 0,
          pointHoverRadius: 4,
          pointHoverBackgroundColor: "#00ff88",
          pointHoverBorderColor: "#000",
          pointHoverBorderWidth: 2,
          tension: 0.4,
          fill: true,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        interaction: { intersect: false, mode: "index" },
        plugins: {
          legend: { display: false },
          tooltip: Object.assign({}, tt, {
            callbacks: {
              label: function(ctx) { return ctx.parsed.y.toFixed(1) + "\u00B0C"; }
            }
          })
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { maxTicksLimit: 8, maxRotation: 0, font: { size: 8 } }
          },
          y: {
            grid: { color: "rgba(255,255,255,0.03)" },
            ticks: {
              callback: function(v) { return v + "\u00B0"; },
              font: { size: 8 },
              maxTicksLimit: 6,
            }
          }
        }
      }
    });

    chartHL = new Chart(document.getElementById("chart-hl"), {
      type: "line",
      data: {
        labels: [],
        datasets: [
          {
            label: "Humidity",
            data: [],
            borderColor: "#4488ff",
            backgroundColor: function(ctx) {
              var chart = ctx.chart;
              var area = chart.chartArea;
              if (!area) return "rgba(68,136,255,0.06)";
              var g = chart.ctx.createLinearGradient(0, area.top, 0, area.bottom);
              g.addColorStop(0, "rgba(68,136,255,0.12)");
              g.addColorStop(1, "rgba(68,136,255,0.01)");
              return g;
            },
            borderWidth: 1.5,
            pointRadius: 0,
            pointHoverRadius: 4,
            pointHoverBackgroundColor: "#4488ff",
            tension: 0.4,
            fill: true,
            yAxisID: "y",
          },
          {
            label: "Light",
            data: [],
            borderColor: "#ffaa33",
            backgroundColor: function(ctx) {
              var chart = ctx.chart;
              var area = chart.chartArea;
              if (!area) return "rgba(255,170,51,0.06)";
              var g = chart.ctx.createLinearGradient(0, area.top, 0, area.bottom);
              g.addColorStop(0, "rgba(255,170,51,0.12)");
              g.addColorStop(1, "rgba(255,170,51,0.01)");
              return g;
            },
            borderWidth: 1.5,
            pointRadius: 0,
            pointHoverRadius: 4,
            pointHoverBackgroundColor: "#ffaa33",
            tension: 0.4,
            fill: true,
            yAxisID: "y1",
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        interaction: { intersect: false, mode: "index" },
        plugins: {
          legend: {
            display: true,
            position: "top",
            align: "end",
            labels: {
              boxWidth: 6,
              boxHeight: 6,
              usePointStyle: true,
              pointStyle: "circle",
              padding: 12,
              font: { size: 8 },
            }
          },
          tooltip: Object.assign({}, tt, {
            callbacks: {
              label: function(ctx) {
                var unit = ctx.datasetIndex === 0 ? "%" : "%";
                return ctx.dataset.label + ": " + ctx.parsed.y.toFixed(0) + unit;
              }
            }
          })
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { maxTicksLimit: 8, maxRotation: 0, font: { size: 8 } }
          },
          y: {
            position: "left",
            grid: { color: "rgba(255,255,255,0.03)" },
            ticks: { callback: function(v) { return v + "%"; }, font: { size: 8 }, maxTicksLimit: 6 },
            min: 0,
            max: 100,
          },
          y1: {
            position: "right",
            grid: { display: false },
            ticks: { callback: function(v) { return v + "%"; }, font: { size: 8 }, maxTicksLimit: 6 },
            min: 0,
            max: 100,
          }
        }
      }
    });
  }

  // ── Fetch ────────────────────────────────────────

  function fetchJSON(url, ms) {
    var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    var timer;
    if (ctrl) timer = setTimeout(function () { ctrl.abort(); }, ms || 8000);
    return fetch(url, ctrl ? { signal: ctrl.signal } : undefined).then(function (res) {
      if (!res.ok) throw new Error(res.status);
      return res.json();
    }).finally(function () { if (ctrl) clearTimeout(timer); });
  }

  // ── Fetchers ─────────────────────────────────────

  function fetchCurrent() {
    return fetchJSON(API + "/api/current", 6000).then(function (data) {
      var r = data.reading;
      var w = data.weather;
      lastDataTime = Date.now();

      // Feed weather to lattice — pass sunrise/sunset for dynamic sun/moon calc
      if (window.__lattice) {
        var lw = {};
        if (w) {
          lw.cloud_cover = w.cloud_cover;
          lw.wind_speed = w.wind_speed;
          lw.condition = w.condition;
          lw.temperature = w.outdoor_temp;
          lw.humidity = w.outdoor_humidity;
          lw.sunrise = w.sunrise;
          lw.sunset = w.sunset;
        }
        if (r && r.light != null) lw.light = r.light;
        if (r && r.temp != null && lw.temperature == null) lw.temperature = r.temp;
        if (r && r.humidity != null && lw.humidity == null) lw.humidity = r.humidity;
        window.__lattice.updateWeather(lw);
      }

      requestAnimationFrame(function () {
        var live = data.serial_connected;
        var statusEl = document.getElementById("conn-status");
        if (statusEl) {
          statusEl.className = "conn-status " + (live ? "live" : "stale");
          var lbl = statusEl.querySelector(".conn-label");
          if (lbl) lbl.textContent = live ? "live" : "stale";
        }
        banner.classList.toggle("visible", !live);

        // Outdoor panel
        if (w && w.outdoor_temp != null) {
          $oTemp.textContent = w.outdoor_temp.toFixed(1);
          $oTemp.classList.remove("stale");
          $oCondition.textContent = (w.condition || "--").replace(/_/g, " ");
          $oWind.textContent = w.wind_speed != null ? w.wind_speed.toFixed(1) + " km/h" : "--";
          $oClouds.textContent = w.cloud_cover != null ? w.cloud_cover + "%" : "--";
          $oHumidity.textContent = w.outdoor_humidity != null ? w.outdoor_humidity + "%" : "--";
          $oPrecip.textContent = w.precipitation != null ? w.precipitation + " mm" : "--";
          $oSunrise.textContent = w.sunrise ? w.sunrise.split("T")[1] : "--";
          $oSunset.textContent = w.sunset ? w.sunset.split("T")[1] : "--";
        }

        // Indoor panel
        if (r && r.temp != null) {
          $iTemp.textContent = r.temp.toFixed(1);
          $iTemp.classList.remove("stale");
          $iStatus.textContent = live ? "live" : "stale";
          $iHumidity.textContent = r.humidity != null ? r.humidity.toFixed(0) + "%" : "--";
          $iLight.textContent = r.light != null ? r.light + "%" : "--";
          if (r.humidity != null) {
            $iDew.textContent = (r.temp - (100 - r.humidity) / 5).toFixed(1) + "\u00B0";
          }
        }
      });
    }).catch(function () {
      if (Date.now() - lastDataTime > STALE_MS) {
        requestAnimationFrame(function () {
          banner.classList.add("visible");
          $oTemp.classList.add("stale");
          $iTemp.classList.add("stale");
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
          $iHigh.textContent = s.temp_max.toFixed(1) + "\u00B0";
          $iLow.textContent = s.temp_min.toFixed(1) + "\u00B0";
          $iAvg.textContent = s.temp_avg.toFixed(1) + "\u00B0";
        });
      }
    }).catch(function () {});
  }

  // ── Range buttons ────────────────────────────────

  document.getElementById("range-buttons").addEventListener("click", function (e) {
    var btn = e.target.closest(".range-btn");
    if (!btn) return;
    document.querySelectorAll(".range-btn").forEach(function (b) { b.classList.remove("active"); });
    btn.classList.add("active");
    currentHours = parseInt(btn.dataset.hours, 10);
    fetchHistory();
  });

  // ── Clock ────────────────────────────────────────

  function tickClock() {
    var n = new Date();
    $footerTime.textContent = n.getHours().toString().padStart(2, "0") + ":" +
      n.getMinutes().toString().padStart(2, "0") + ":" +
      n.getSeconds().toString().padStart(2, "0") + " EAT";
  }

  // ── Init ─────────────────────────────────────────

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
      banner.classList.add("visible");
    }
  }, 3000);
})();
