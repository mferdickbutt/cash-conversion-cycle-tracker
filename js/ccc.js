/**
 * Cash Conversion Cycle metrics.
 * Works in the browser (global CCC) and in Node (module.exports).
 *
 * Formulas (period-end balances, calendar days in the month):
 *   DSO = AR / (revenue / days)       = AR × days / revenue
 *   DIO = inventory / (COGS / days)   = inventory × days / COGS
 *   DPO = AP / (purchases / days)     = AP × days / purchases
 *   CCC = DSO + DIO − DPO
 *
 * Unsafe inputs (null/empty, non-finite, zero flow denominators) return null.
 * Never returns NaN or Infinity.
 */
(function (global, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    global.CCC = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var METRIC_DEFS = {
    dso: {
      key: "dso",
      label: "DSO",
      name: "Days Sales Outstanding",
      higherIsBetter: false,
      formula: "AR / (revenue / days)",
    },
    dio: {
      key: "dio",
      label: "DIO",
      name: "Days Inventory Outstanding",
      higherIsBetter: false,
      formula: "inventory / (COGS / days)",
    },
    dpo: {
      key: "dpo",
      label: "DPO",
      name: "Days Payable Outstanding",
      higherIsBetter: true,
      formula: "AP / (purchases / days)",
    },
    ccc: {
      key: "ccc",
      label: "CCC",
      name: "Cash Conversion Cycle",
      higherIsBetter: false,
      formula: "DSO + DIO − DPO",
    },
  };

  var METRIC_KEYS = ["dso", "dio", "dpo", "ccc"];

  function toNum(value) {
    if (value === null || value === undefined || value === "") return null;
    if (typeof value === "string" && value.trim() === "") return null;
    var n = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(n)) return null;
    return n;
  }

  /**
   * Days-on-hand: stock / (flow per day) = stock * days / flow.
   * Zero or missing flow (revenue, COGS, purchases) → null.
   */
  function daysOnHand(stock, flow, days) {
    var s = toNum(stock);
    var f = toNum(flow);
    var d = toNum(days);
    if (s === null || f === null || d === null) return null;
    if (d <= 0) return null;
    if (f === 0) return null;
    var result = (s / f) * d;
    if (!Number.isFinite(result)) return null;
    return result;
  }

  function computeDso(row) {
    if (!row) return null;
    return daysOnHand(row.ar, row.revenue, row.days);
  }

  function computeDio(row) {
    if (!row) return null;
    return daysOnHand(row.inventory, row.cogs, row.days);
  }

  function computeDpo(row) {
    if (!row) return null;
    return daysOnHand(row.ap, row.purchases, row.days);
  }

  function computeCcc(dso, dio, dpo) {
    if (dso === null || dio === null || dpo === null) return null;
    var result = dso + dio - dpo;
    if (!Number.isFinite(result)) return null;
    return result;
  }

  function computeMonth(row) {
    if (!row || typeof row !== "object") {
      return {
        month: null,
        days: null,
        ar: null,
        revenue: null,
        inventory: null,
        cogs: null,
        ap: null,
        purchases: null,
        dso: null,
        dio: null,
        dpo: null,
        ccc: null,
      };
    }
    var dso = computeDso(row);
    var dio = computeDio(row);
    var dpo = computeDpo(row);
    return {
      month: row.month == null ? null : String(row.month),
      days: toNum(row.days),
      ar: toNum(row.ar),
      revenue: toNum(row.revenue),
      inventory: toNum(row.inventory),
      cogs: toNum(row.cogs),
      ap: toNum(row.ap),
      purchases: toNum(row.purchases),
      dso: dso,
      dio: dio,
      dpo: dpo,
      ccc: computeCcc(dso, dio, dpo),
    };
  }

  function vsTarget(value, target, higherIsBetter) {
    var v = toNum(value);
    var t = toNum(target);
    if (v === null || t === null) return null;
    var delta = v - t;
    if (!Number.isFinite(delta)) return null;
    var meeting = higherIsBetter ? v >= t : v <= t;
    return { value: v, target: t, delta: delta, meeting: meeting };
  }

  function momTrend(current, previous, higherIsBetter) {
    var c = toNum(current);
    var p = toNum(previous);
    if (c === null || p === null) return null;
    var delta = c - p;
    if (!Number.isFinite(delta)) return null;
    var rounded = Math.round(delta * 10) / 10;
    var direction = rounded > 0 ? "up" : rounded < 0 ? "down" : "flat";
    var improving = direction === "flat" ? false : higherIsBetter ? rounded > 0 : rounded < 0;
    var pct = p === 0 ? null : delta / Math.abs(p);
    if (pct !== null && !Number.isFinite(pct)) pct = null;
    return { delta: delta, pct: pct, direction: direction, improving: improving, flat: direction === "flat" };
  }

  function extremaFor(months, key, higherIsBetter) {
    var valid = [];
    for (var i = 0; i < months.length; i++) {
      var row = months[i];
      var v = toNum(row[key]);
      if (v === null || !row.month) continue;
      valid.push({ month: row.month, value: v });
    }
    if (valid.length === 0) {
      return { best: null, worst: null };
    }
    valid.sort(function (a, b) {
      return a.value - b.value;
    });
    if (higherIsBetter) {
      return { best: valid[valid.length - 1], worst: valid[0] };
    }
    return { best: valid[0], worst: valid[valid.length - 1] };
  }

  function emptyResult(targets) {
    return {
      company: null,
      currency: null,
      targets: targets || { dso: null, dio: null, dpo: null, ccc: null },
      months: [],
      latest: null,
      extrema: {
        dso: { best: null, worst: null },
        dio: { best: null, worst: null },
        dpo: { best: null, worst: null },
        ccc: { best: null, worst: null },
      },
    };
  }

  function computeTracker(dataset) {
    if (!dataset || typeof dataset !== "object") {
      return emptyResult(null);
    }
    var targets = dataset.targets || {};
    var rawMonths = Array.isArray(dataset.months) ? dataset.months : [];
    if (rawMonths.length === 0) {
      var empty = emptyResult({
        dso: toNum(targets.dso),
        dio: toNum(targets.dio),
        dpo: toNum(targets.dpo),
        ccc: toNum(targets.ccc),
      });
      empty.company = dataset.company == null ? null : String(dataset.company);
      empty.currency = dataset.currency == null ? null : String(dataset.currency);
      return empty;
    }

    var computed = rawMonths.map(computeMonth);
    computed.sort(function (a, b) {
      var am = a.month || "";
      var bm = b.month || "";
      if (am < bm) return -1;
      if (am > bm) return 1;
      return 0;
    });

    var resolvedTargets = {
      dso: toNum(targets.dso),
      dio: toNum(targets.dio),
      dpo: toNum(targets.dpo),
      ccc: toNum(targets.ccc),
    };

    for (var i = 0; i < computed.length; i++) {
      var row = computed[i];
      var prev = i === 0 ? null : computed[i - 1];
      row.vsTarget = {};
      row.mom = {};
      for (var k = 0; k < METRIC_KEYS.length; k++) {
        var key = METRIC_KEYS[k];
        var def = METRIC_DEFS[key];
        row.vsTarget[key] = vsTarget(row[key], resolvedTargets[key], def.higherIsBetter);
        row.mom[key] = momTrend(row[key], prev ? prev[key] : null, def.higherIsBetter);
      }
    }

    var extrema = {};
    for (var e = 0; e < METRIC_KEYS.length; e++) {
      var mkey = METRIC_KEYS[e];
      extrema[mkey] = extremaFor(computed, mkey, METRIC_DEFS[mkey].higherIsBetter);
    }

    return {
      company: dataset.company == null ? null : String(dataset.company),
      currency: dataset.currency == null ? null : String(dataset.currency),
      targets: resolvedTargets,
      months: computed,
      latest: computed.length ? computed[computed.length - 1] : null,
      extrema: extrema,
    };
  }

  function formatDays(value, digits) {
    var n = toNum(value);
    if (n === null) return null;
    var d = digits == null ? 1 : digits;
    return n.toFixed(d);
  }

  return {
    METRIC_DEFS: METRIC_DEFS,
    METRIC_KEYS: METRIC_KEYS,
    toNum: toNum,
    daysOnHand: daysOnHand,
    computeDso: computeDso,
    computeDio: computeDio,
    computeDpo: computeDpo,
    computeCcc: computeCcc,
    computeMonth: computeMonth,
    vsTarget: vsTarget,
    momTrend: momTrend,
    computeTracker: computeTracker,
    formatDays: formatDays,
  };
});
