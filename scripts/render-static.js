#!/usr/bin/env node
/**
 * Bake computed CCC metrics into index.html so first paint needs no JavaScript.
 *
 * Usage: node scripts/render-static.js
 */
"use strict";

var fs = require("fs");
var path = require("path");
var CCC = require("../js/ccc.js");

var ROOT = path.resolve(__dirname, "..");
var DATA_PATH = path.join(ROOT, "data", "ccc.json");
var OUT_PATH = path.join(ROOT, "index.html");

function esc(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function monthLabel(ym) {
  if (!ym || typeof ym !== "string" || ym.length < 7) return ym || "—";
  var parts = ym.split("-");
  var year = Number(parts[0]);
  var month = Number(parts[1]);
  if (!year || !month) return ym;
  return new Date(year, month - 1, 1).toLocaleString("en-US", {
    month: "short",
    year: "numeric",
  });
}

function money(n, currency) {
  if (n === null || n === undefined) return "—";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency || "USD",
      maximumFractionDigits: 0,
    }).format(n);
  } catch (err) {
    return String(n);
  }
}

function daysText(n) {
  var formatted = CCC.formatDays(n, 1);
  return formatted === null ? "—" : formatted;
}

function vsHtml(vs) {
  if (!vs) return '<span class="vs na">n/a</span>';
  var abs = Math.abs(vs.delta).toFixed(1);
  var rel;
  if (vs.delta === 0) rel = "at target";
  else if (vs.delta < 0) rel = abs + "d under target";
  else rel = abs + "d over target";
  var cls = vs.meeting ? "meeting" : "missing";
  return '<span class="pill ' + cls + '">' + esc(rel) + "</span>";
}

function trendHtml(mom) {
  if (!mom) return '<span class="trend na">MoM n/a</span>';
  var arrow = mom.direction === "up" ? "↑" : mom.direction === "down" ? "↓" : "→";
  var cls = mom.flat ? "flat" : mom.improving ? "improving" : "worsening";
  var delta = mom.flat ? "0.0" : (mom.delta > 0 ? "+" : "") + mom.delta.toFixed(1);
  var word = mom.flat ? "unchanged" : mom.improving ? "improving" : "worsening";
  return (
    '<span class="trend ' +
    cls +
    '">' +
    arrow +
    " " +
    esc(delta) +
    "d MoM (" +
    word +
    ")</span>"
  );
}

function sparkline(months) {
  var width = 1040;
  var height = 64;
  var values = months.map(function (m) {
    return m.ccc;
  });
  var usable = values.filter(function (v) {
    return v !== null;
  });
  if (usable.length < 2) return "";
  var min = Math.min.apply(null, usable);
  var max = Math.max.apply(null, usable);
  var span = max - min || 1;
  var coords = [];
  for (var i = 0; i < values.length; i++) {
    var v = values[i];
    if (v === null) continue;
    var x = (i / (values.length - 1)) * width;
    var y = height - ((v - min) / span) * (height - 8) - 4;
    coords.push(x.toFixed(1) + "," + y.toFixed(1));
  }
  var last = months[months.length - 1];
  var first = months[0];
  return (
    '<div class="spark" id="ccc-sparkline">' +
    "<p class=\"note\">CCC trend (" +
    esc(monthLabel(first.month)) +
    " → " +
    esc(monthLabel(last.month)) +
    ")</p>" +
    '<svg viewBox="0 0 ' +
    width +
    " " +
    height +
    '" role="img" aria-label="CCC sparkline from ' +
    esc(daysText(first.ccc)) +
    " to " +
    esc(daysText(last.ccc)) +
    ' days">' +
    '<polyline fill="none" stroke="#0f6e6e" stroke-width="3" points="' +
    coords.join(" ") +
    '" />' +
    "</svg></div>"
  );
}

function cardHtml(latest, key) {
  var def = CCC.METRIC_DEFS[key];
  var value = latest[key];
  var vs = latest.vsTarget[key];
  var mom = latest.mom[key];
  var better = def.higherIsBetter ? "higher is better" : "lower is better";
  return (
    '<article class="card" id="card-' +
    key +
    '">' +
    '<p class="label">' +
    def.label +
    "</p>" +
    '<p class="name">' +
    esc(def.name) +
    " · " +
    better +
    "</p>" +
    '<p class="metric-value" data-metric="' +
    key +
    '">' +
    esc(daysText(value)) +
    ' <span class="unit">days</span></p>' +
    '<div class="meta">' +
    vsHtml(vs) +
    trendHtml(mom) +
    "</div></article>"
  );
}

function extremaHtml(report) {
  var blocks = CCC.METRIC_KEYS.map(function (key) {
    var def = CCC.METRIC_DEFS[key];
    var ex = report.extrema[key];
    var best = ex && ex.best;
    var worst = ex && ex.worst;
    var bestText = best
      ? monthLabel(best.month) + " · " + daysText(best.value) + " days"
      : "—";
    var worstText = worst
      ? monthLabel(worst.month) + " · " + daysText(worst.value) + " days"
      : "—";
    return (
      '<article class="card" id="extrema-' +
      key +
      '">' +
      "<h3>" +
      def.label +
      "</h3>" +
      "<dl>" +
      "<dt>Best</dt><dd data-best=\"" +
      key +
      '">' +
      esc(bestText) +
      "</dd>" +
      "<dt>Worst</dt><dd data-worst=\"" +
      key +
      '">' +
      esc(worstText) +
      "</dd>" +
      "</dl></article>"
    );
  });
  return blocks.join("");
}

function tableHtml(report) {
  var currency = report.currency || "USD";
  var head =
    "<thead><tr>" +
    "<th>Month</th><th>Days</th>" +
    "<th>DSO</th><th>DSO vs target</th><th>DSO MoM</th>" +
    "<th>DIO</th><th>DIO vs target</th><th>DIO MoM</th>" +
    "<th>DPO</th><th>DPO vs target</th><th>DPO MoM</th>" +
    "<th>CCC</th><th>CCC vs target</th><th>CCC MoM</th>" +
    "</tr></thead>";

  var rows = report.months.map(function (row) {
    function metricCells(key) {
      var mom = row.mom[key];
      var momShort;
      if (!mom) momShort = '<span class="trend na">n/a</span>';
      else {
        var arrow = mom.direction === "up" ? "↑" : mom.direction === "down" ? "↓" : "→";
        var cls = mom.flat ? "flat" : mom.improving ? "improving" : "worsening";
        var delta = mom.flat ? "0.0" : (mom.delta > 0 ? "+" : "") + mom.delta.toFixed(1);
        momShort = '<span class="trend ' + cls + '">' + arrow + " " + esc(delta) + "d</span>";
      }
      return (
        "<td data-" +
        key +
        '="' +
        esc(daysText(row[key])) +
        '">' +
        esc(daysText(row[key])) +
        "</td>" +
        "<td>" +
        vsHtml(row.vsTarget[key]) +
        "</td>" +
        "<td>" +
        momShort +
        "</td>"
      );
    }
    return (
      '<tr data-month="' +
      esc(row.month) +
      '">' +
      "<td>" +
      esc(monthLabel(row.month)) +
      " <span class=\"note\">(" +
      esc(row.month) +
      ")</span></td>" +
      "<td>" +
      (row.days == null ? "—" : String(row.days)) +
      "</td>" +
      metricCells("dso") +
      metricCells("dio") +
      metricCells("dpo") +
      metricCells("ccc") +
      "</tr>"
    );
  });

  var inputsNote =
    "<p class=\"note\">Inputs used (period-end, " +
    esc(currency) +
    "): the sample series includes AR, revenue, inventory, COGS, AP, and purchases for every month. " +
    "Latest month " +
    esc(monthLabel(report.latest.month)) +
    " — AR " +
    esc(money(report.latest.ar, currency)) +
    ", revenue " +
    esc(money(report.latest.revenue, currency)) +
    ", inventory " +
    esc(money(report.latest.inventory, currency)) +
    ", COGS " +
    esc(money(report.latest.cogs, currency)) +
    ", AP " +
    esc(money(report.latest.ap, currency)) +
    ", purchases " +
    esc(money(report.latest.purchases, currency)) +
    ".</p>";

  return (
    inputsNote +
    '<div class="table-wrap"><table id="monthly-ccc">' +
    head +
    "<tbody>" +
    rows.join("") +
    "</tbody></table></div>"
  );
}

function render(dataset) {
  var report = CCC.computeTracker(dataset);
  if (!report.latest) {
    throw new Error("No months to render");
  }
  var latest = report.latest;
  var cards = CCC.METRIC_KEYS.map(function (key) {
    return cardHtml(latest, key);
  }).join("");

  var targets = report.targets;
  var targetLine =
    "Targets — DSO ≤ " +
    daysText(targets.dso) +
    "d, DIO ≤ " +
    daysText(targets.dio) +
    "d, DPO ≥ " +
    daysText(targets.dpo) +
    "d, CCC ≤ " +
    daysText(targets.ccc) +
    "d.";

  return (
    "<!DOCTYPE html>\n" +
    '<html lang="en">\n' +
    "<head>\n" +
    '  <meta charset="utf-8" />\n' +
    '  <meta name="viewport" content="width=device-width, initial-scale=1" />\n' +
    "  <title>Cash Conversion Cycle — " +
    esc(report.company || "Tracker") +
    "</title>\n" +
    '  <link rel="stylesheet" href="css/style.css" />\n' +
    "</head>\n" +
    "<body>\n" +
    '  <header class="hero">\n' +
    '    <div class="wrap">\n' +
    '      <p class="kicker">Working capital</p>\n' +
    "      <h1>Cash Conversion Cycle tracker</h1>\n" +
    '      <p class="sub">' +
    esc(report.company || "Sample company") +
    " · " +
    String(report.months.length) +
    " months of DSO, DIO, DPO, and CCC. Metrics below are baked into this HTML for first paint without JavaScript.</p>\n" +
    '      <div class="formula-strip" aria-label="Formulas">\n' +
    "        <code>DSO = AR / (revenue / days)</code>\n" +
    "        <code>DIO = inventory / (COGS / days)</code>\n" +
    "        <code>DPO = AP / (purchases / days)</code>\n" +
    "        <code>CCC = DSO + DIO − DPO</code>\n" +
    "      </div>\n" +
    "    </div>\n" +
    "  </header>\n" +
    '  <main class="wrap">\n' +
    '    <section class="section" id="latest">\n' +
    "      <h2>Latest month · " +
    esc(monthLabel(latest.month)) +
    " (" +
    esc(latest.month) +
    ")</h2>\n" +
    '      <p class="note">' +
    esc(targetLine) +
    " DSO/DIO/CCC: lower is better. DPO: higher is better.</p>\n" +
    '      <div class="cards">' +
    cards +
    "</div>\n" +
    sparkline(report.months) +
    "    </section>\n" +
    '    <section class="section" id="best-worst">\n' +
    "      <h2>Best and worst months</h2>\n" +
    '      <p class="note">Best DSO/DIO/CCC = lowest days. Best DPO = highest days (longer to pay suppliers).</p>\n' +
    '      <div class="extrema">' +
    extremaHtml(report) +
    "</div>\n" +
    "    </section>\n" +
    '    <section class="section" id="monthly">\n' +
    "      <h2>Monthly DSO, DIO, DPO, and CCC</h2>\n" +
    tableHtml(report) +
    "    </section>\n" +
    "  </main>\n" +
    "  <footer class=\"wrap\">\n" +
    "    <p>Static snapshot generated from <code>data/ccc.json</code> via <code>node scripts/render-static.js</code>. JavaScript only enhances; it does not supply these numbers.</p>\n" +
    "  </footer>\n" +
    '  <script src="js/ccc.js" defer></script>\n' +
    '  <script src="js/enhance.js" defer></script>\n' +
    "</body>\n" +
    "</html>\n"
  );
}

function main() {
  var raw = fs.readFileSync(DATA_PATH, "utf8");
  var dataset = JSON.parse(raw);
  var html = render(dataset);
  fs.writeFileSync(OUT_PATH, html);
  var report = CCC.computeTracker(dataset);
  process.stdout.write(
    "Wrote " +
      path.relative(ROOT, OUT_PATH) +
      " (" +
      report.months.length +
      " months, latest CCC " +
      CCC.formatDays(report.latest.ccc, 1) +
      "d)\n"
  );
}

main();
