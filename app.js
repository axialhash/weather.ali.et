1|/**
2| * app.js — weather.ali.et split-view dashboard.
3| * Left: outdoor weather (Open-Meteo). Right: server room (Arduino).
4| */
5|
6|(function () {
7|  "use strict";
8|
9|  var hostname = window.location.hostname;
10|  var API = (hostname === "axialhash.github.io" || hostname === "weather.ali.et")
11|    ? "https://w.ali.et" : "";
12|
13|  var STALE_MS = 15000;
14|  var lastDataTime = 0;
15|  var currentHours = 6;
16|  var chartTemp, chartHL;
17|
18|  Chart.defaults.color = "rgba(242,244,248,0.25)";
19|  Chart.defaults.borderColor = "rgba(242,244,248,0.05)";
20|  Chart.defaults.font.family = "'JetBrains Mono', monospace";
21|  Chart.defaults.font.size = 9;
22|  Chart.defaults.animation = false;
23|
24|  // ── DOM cache ────────────────────────────────────
25|
26|  var $oTemp = document.getElementById("outdoor-temp");
27|  var $oCondition = document.getElementById("outdoor-condition");
28|  var $oWind = document.getElementById("outdoor-wind");
29|  var $oClouds = document.getElementById("outdoor-clouds");
30|  var $oHumidity = document.getElementById("outdoor-humidity");
31|  var $oPrecip = document.getElementById("outdoor-precip");
32|  var $oSunrise = document.getElementById("outdoor-sunrise");
33|  var $oSunset = document.getElementById("outdoor-sunset");
34|
35|  var $iTemp = document.getElementById("indoor-temp");
36|  var $iStatus = document.getElementById("indoor-status");
37|  var $iHumidity = document.getElementById("indoor-humidity");
38|  var $iLight = document.getElementById("indoor-light");
39|  var $iDew = document.getElementById("indoor-dew");
40|  var $iHigh = document.getElementById("stat-high");
41|  var $iLow = document.getElementById("stat-low");
42|  var $iAvg = document.getElementById("stat-avg");
43|
44|  var $footerTime = document.getElementById("footer-time");
45|
46|  // ── Offline banner ───────────────────────────────
47|
48|  var banner = document.createElement("div");
49|  banner.className = "offline-banner";
50|  banner.textContent = "api unreachable \u2014 retrying";
51|  document.body.appendChild(banner);
52|
53|  // ── Charts ───────────────────────────────────────
54|
55|  function initCharts() {
56|    var tt = {
57|      backgroundColor: "rgba(0,0,0,0.85)",
58|      borderColor: "rgba(242,244,248,0.08)",
59|      borderWidth: 1,
60|      padding: 10,
61|      cornerRadius: 6,
62|      titleFont: { family: "'JetBrains Mono', monospace", size: 10 },
63|      bodyFont: { family: "'JetBrains Mono', monospace", size: 11 },
64|    };
65|
66|    chartTemp = new Chart(document.getElementById("chart-temp"), {
67|      type: "line",
68|      data: {
69|        labels: [],
70|        datasets: [{
71|          data: [],
72|          borderColor: "#00ff88",
73|          backgroundColor: function(ctx) {
74|            var chart = ctx.chart;
75|            var area = chart.chartArea;
76|            if (!area) return "rgba(243,202,64,0.06)";
77|            var g = chart.ctx.createLinearGradient(0, area.top, 0, area.bottom);
78|            g.addColorStop(0, "rgba(243,202,64,0.15)");
79|            g.addColorStop(1, "rgba(243,202,64,0.01)");
80|            return g;
81|          },
82|          borderWidth: 1.5,
83|          pointRadius: 0,
84|          pointHoverRadius: 4,
85|          pointHoverBackgroundColor: "#00ff88",
86|          pointHoverBorderColor: "#000",
87|          pointHoverBorderWidth: 2,
88|          tension: 0.4,
89|          fill: true,
90|        }]
91|      },
92|      options: {
93|        responsive: true,
94|        maintainAspectRatio: false,
95|        animation: false,
96|        interaction: { intersect: false, mode: "index" },
97|        plugins: {
98|          legend: { display: false },
99|          tooltip: Object.assign({}, tt, {
100|            callbacks: {
101|              label: function(ctx) { return ctx.parsed.y.toFixed(1) + "\u00B0C"; }
102|            }
103|          })
104|        },
105|        scales: {
106|          x: {
107|            grid: { display: false },
108|            ticks: { maxTicksLimit: 8, maxRotation: 0, font: { size: 8 } }
109|          },
110|          y: {
111|            grid: { color: "rgba(242,244,248,0.04)" },
112|            ticks: {
113|              callback: function(v) { return v + "\u00B0"; },
114|              font: { size: 8 },
115|              maxTicksLimit: 6,
116|            }
117|          }
118|        }
119|      }
120|    });
121|
122|    chartHL = new Chart(document.getElementById("chart-hl"), {
123|      type: "line",
124|      data: {
125|        labels: [],
126|        datasets: [
127|          {
128|            label: "Humidity",
129|            data: [],
130|            borderColor: "#4488ff",
131|            backgroundColor: function(ctx) {
132|              var chart = ctx.chart;
133|              var area = chart.chartArea;
134|              if (!area) return "rgba(87,115,153,0.06)";
135|              var g = chart.ctx.createLinearGradient(0, area.top, 0, area.bottom);
136|              g.addColorStop(0, "rgba(87,115,153,0.12)");
137|              g.addColorStop(1, "rgba(87,115,153,0.01)");
138|              return g;
139|            },
140|            borderWidth: 1.5,
141|            pointRadius: 0,
142|            pointHoverRadius: 4,
143|            pointHoverBackgroundColor: "#4488ff",
144|            tension: 0.4,
145|            fill: true,
146|            yAxisID: "y",
147|          },
148|          {
149|            label: "Light",
150|            data: [],
151|            borderColor: "#ffaa33",
152|            backgroundColor: function(ctx) {
153|              var chart = ctx.chart;
154|              var area = chart.chartArea;
155|              if (!area) return "rgba(242,244,248,0.04)";
156|              var g = chart.ctx.createLinearGradient(0, area.top, 0, area.bottom);
157|              g.addColorStop(0, "rgba(242,244,248,0.08)");
158|              g.addColorStop(1, "rgba(242,244,248,0.01)");
159|              return g;
160|            },
161|            borderWidth: 1.5,
162|            pointRadius: 0,
163|            pointHoverRadius: 4,
164|            pointHoverBackgroundColor: "#ffaa33",
165|            tension: 0.4,
166|            fill: true,
167|            yAxisID: "y1",
168|          }
169|        ]
170|      },
171|      options: {
172|        responsive: true,
173|        maintainAspectRatio: false,
174|        animation: false,
175|        interaction: { intersect: false, mode: "index" },
176|        plugins: {
177|          legend: {
178|            display: true,
179|            position: "top",
180|            align: "end",
181|            labels: {
182|              boxWidth: 6,
183|              boxHeight: 6,
184|              usePointStyle: true,
185|              pointStyle: "circle",
186|              padding: 12,
187|              font: { size: 8 },
188|            }
189|          },
190|          tooltip: Object.assign({}, tt, {
191|            callbacks: {
192|              label: function(ctx) {
193|                var unit = ctx.datasetIndex === 0 ? "%" : "%";
194|                return ctx.dataset.label + ": " + ctx.parsed.y.toFixed(0) + unit;
195|              }
196|            }
197|          })
198|        },
199|        scales: {
200|          x: {
201|            grid: { display: false },
202|            ticks: { maxTicksLimit: 8, maxRotation: 0, font: { size: 8 } }
203|          },
204|          y: {
205|            position: "left",
206|            grid: { color: "rgba(242,244,248,0.04)" },
207|            ticks: { callback: function(v) { return v + "%"; }, font: { size: 8 }, maxTicksLimit: 6 },
208|            min: 0,
209|            max: 100,
210|          },
211|          y1: {
212|            position: "right",
213|            grid: { display: false },
214|            ticks: { callback: function(v) { return v + "%"; }, font: { size: 8 }, maxTicksLimit: 6 },
215|            min: 0,
216|            max: 100,
217|          }
218|        }
219|      }
220|    });
221|  }
222|
223|  // ── Fetch ────────────────────────────────────────
224|
225|  function fetchJSON(url, ms) {
226|    var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
227|    var timer;
228|    if (ctrl) timer = setTimeout(function () { ctrl.abort(); }, ms || 8000);
229|    return fetch(url, ctrl ? { signal: ctrl.signal } : undefined).then(function (res) {
230|      if (!res.ok) throw new Error(res.status);
231|      return res.json();
232|    }).finally(function () { if (ctrl) clearTimeout(timer); });
233|  }
234|
235|  // ── Fetchers ─────────────────────────────────────
236|
237|  function fetchCurrent() {
238|    return fetchJSON(API + "/api/current", 6000).then(function (data) {
239|      var r = data.reading;
240|      var w = data.weather;
241|      lastDataTime = Date.now();
242|
243|      // Feed weather to lattice — pass sunrise/sunset for dynamic sun/moon calc
244|      if (window.__lattice) {
245|        var lw = {};
246|        if (w) {
247|          lw.cloud_cover = w.cloud_cover;
248|          lw.wind_speed = w.wind_speed;
249|          lw.condition = w.condition;
250|          lw.temperature = w.outdoor_temp;
251|          lw.humidity = w.outdoor_humidity;
252|          lw.sunrise = w.sunrise;
253|          lw.sunset = w.sunset;
254|        }
255|        if (r && r.light != null) lw.light = r.light;
256|        if (r && r.temp != null && lw.temperature == null) lw.temperature = r.temp;
257|        if (r && r.humidity != null && lw.humidity == null) lw.humidity = r.humidity;
258|        window.__lattice.updateWeather(lw);
259|      }
260|
261|      requestAnimationFrame(function () {
262|        var live = data.serial_connected;
263|        var statusEl = document.getElementById("conn-status");
264|        if (statusEl) {
265|          statusEl.className = "conn-status " + (live ? "live" : "stale");
266|          var lbl = statusEl.querySelector(".conn-label");
267|          if (lbl) lbl.textContent = live ? "live" : "stale";
268|        }
269|        banner.classList.toggle("visible", !live);
270|
271|        // Outdoor panel
272|        if (w && w.outdoor_temp != null) {
273|          $oTemp.textContent = w.outdoor_temp.toFixed(1);
274|          $oTemp.classList.remove("stale");
275|          $oCondition.textContent = (w.condition || "--").replace(/_/g, " ");
276|          $oWind.textContent = w.wind_speed != null ? w.wind_speed.toFixed(1) + " km/h" : "--";
277|          $oClouds.textContent = w.cloud_cover != null ? w.cloud_cover + "%" : "--";
278|          $oHumidity.textContent = w.outdoor_humidity != null ? w.outdoor_humidity + "%" : "--";
279|          $oPrecip.textContent = w.precipitation != null ? w.precipitation + " mm" : "--";
280|          $oSunrise.textContent = w.sunrise ? w.sunrise.split("T")[1] : "--";
281|          $oSunset.textContent = w.sunset ? w.sunset.split("T")[1] : "--";
282|        }
283|
284|        // Indoor panel
285|        if (r && r.temp != null) {
286|          $iTemp.textContent = r.temp.toFixed(1);
287|          $iTemp.classList.remove("stale");
288|          $iStatus.textContent = live ? "live" : "stale";
289|          $iHumidity.textContent = r.humidity != null ? r.humidity.toFixed(0) + "%" : "--";
290|          $iLight.textContent = r.light != null ? r.light + "%" : "--";
291|          if (r.humidity != null) {
292|            $iDew.textContent = (r.temp - (100 - r.humidity) / 5).toFixed(1) + "\u00B0";
293|          }
294|        }
295|      });
296|    }).catch(function () {
297|      if (Date.now() - lastDataTime > STALE_MS) {
298|        requestAnimationFrame(function () {
299|          banner.classList.add("visible");
300|          $oTemp.classList.add("stale");
301|          $iTemp.classList.add("stale");
302|        });
303|      }
304|    });
305|  }
306|
307|  function fetchHistory() {
308|    return fetchJSON(API + "/api/history?hours=" + currentHours, 10000).then(function (data) {
309|      var rows = data.readings;
310|      if (!rows || !rows.length) return;
311|      var labels = [], temps = [], hums = [], lights = [];
312|      for (var i = 0; i < rows.length; i++) {
313|        var r = rows[i];
314|        var d = new Date(r.timestamp * 1000);
315|        labels.push(d.getHours().toString().padStart(2, "0") + ":" + d.getMinutes().toString().padStart(2, "0"));
316|        temps.push(r.temp);
317|        hums.push(r.humidity);
318|        lights.push(r.light);
319|      }
320|      chartTemp.data.labels = labels;
321|      chartTemp.data.datasets[0].data = temps;
322|      chartTemp.update("none");
323|      chartHL.data.labels = labels;
324|      chartHL.data.datasets[0].data = hums;
325|      chartHL.data.datasets[1].data = lights;
326|      chartHL.update("none");
327|    }).catch(function () {});
328|  }
329|
330|  function fetchStats() {
331|    return fetchJSON(API + "/api/stats?hours=24", 10000).then(function (s) {
332|      if (s.sample_count > 0) {
333|        requestAnimationFrame(function () {
334|          $iHigh.textContent = s.temp_max.toFixed(1) + "\u00B0";
335|          $iLow.textContent = s.temp_min.toFixed(1) + "\u00B0";
336|          $iAvg.textContent = s.temp_avg.toFixed(1) + "\u00B0";
337|        });
338|      }
339|    }).catch(function () {});
340|  }
341|
342|  // ── Range buttons ────────────────────────────────
343|
344|  document.getElementById("range-buttons").addEventListener("click", function (e) {
345|    var btn = e.target.closest(".range-btn");
346|    if (!btn) return;
347|    document.querySelectorAll(".range-btn").forEach(function (b) { b.classList.remove("active"); });
348|    btn.classList.add("active");
349|    currentHours = parseInt(btn.dataset.hours, 10);
350|    fetchHistory();
351|  });
352|
353|  // ── Clock ────────────────────────────────────────
354|
355|  function tickClock() {
356|    var n = new Date();
357|    $footerTime.textContent = n.getHours().toString().padStart(2, "0") + ":" +
358|      n.getMinutes().toString().padStart(2, "0") + ":" +
359|      n.getSeconds().toString().padStart(2, "0") + " EAT";
360|  }
361|
362|  // ── Init ─────────────────────────────────────────
363|
364|  initCharts();
365|  fetchCurrent();
366|  fetchHistory();
367|  fetchStats();
368|  tickClock();
369|
370|  setInterval(fetchCurrent, 5000);
371|  setInterval(function () { fetchHistory(); fetchStats(); }, 30000);
372|  setInterval(tickClock, 1000);
373|  setInterval(function () {
374|    if (lastDataTime > 0 && Date.now() - lastDataTime > STALE_MS) {
375|      banner.classList.add("visible");
376|    }
377|  }, 3000);
378|})();
379|