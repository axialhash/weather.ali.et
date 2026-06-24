/**
 * app.js — Pure lattice data feed. No dashboard UI.
 * Fetches Arduino sensor data + Open-Meteo weather,
 * feeds both to the lattice renderer.
 */

(function () {
  "use strict";

  var hostname = window.location.hostname;
  var API = (hostname === "axialhash.github.io" || hostname === "weather.ali.et")
    ? "https://w.ali.et" : "";

  var lastDataTime = 0;
  var STALE_MS = 20000;

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

  function fetchCurrent() {
    return fetchJSON(API + "/api/current", 8000).then(function (data) {
      lastDataTime = Date.now();
      var r = data.reading;
      var w = data.weather;

      // Feed sensor data to lattice
      if (window.__lattice && r) {
        window.__lattice.updateSensor(r);
      }

      // Feed weather simulation data to lattice
      if (window.__lattice && w) {
        window.__lattice.updateWeather(w);
      }
    }).catch(function () {});
  }

  // ── Clock ────────────────────────────────────────

  function tickClock() {
    var el = document.getElementById("clock");
    if (!el) return;
    var n = new Date();
    el.textContent = n.getHours().toString().padStart(2, "0") + ":" +
      n.getMinutes().toString().padStart(2, "0") + ":" +
      n.getSeconds().toString().padStart(2, "0") + " EAT";
  }

  // ── Init ─────────────────────────────────────────

  fetchCurrent();
  tickClock();
  setInterval(fetchCurrent, 5000);
  setInterval(tickClock, 1000);
})();
