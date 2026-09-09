#!/usr/bin/env bash
# CCC tracker tests: metric edge cases + static first-paint HTML.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

passed=0
failed=0

pass() {
  echo "PASS: $1"
  passed=$((passed + 1))
}

fail() {
  echo "FAIL: $1"
  failed=$((failed + 1))
}

node_ok() {
  local name="$1"
  local code="$2"
  if node -e "$code"; then
    pass "$name"
  else
    fail "$name"
  fi
}

# --- Metric engine ---

node_ok "DSO formula AR * days / revenue" '
const CCC = require("./js/ccc.js");
const v = CCC.computeDso({ ar: 720000, revenue: 450000, days: 30 });
if (Math.abs(v - 48) > 1e-9) { console.error(v); process.exit(1); }
'

node_ok "DIO formula inventory * days / COGS" '
const CCC = require("./js/ccc.js");
const v = CCC.computeDio({ inventory: 540000, cogs: 270000, days: 30 });
if (Math.abs(v - 60) > 1e-9) { console.error(v); process.exit(1); }
'

node_ok "DPO formula AP * days / purchases" '
const CCC = require("./js/ccc.js");
const v = CCC.computeDpo({ ap: 300000, purchases: 285000, days: 30 });
if (Math.abs(v - (300000 * 30 / 285000)) > 1e-9) { console.error(v); process.exit(1); }
'

node_ok "CCC equals DSO + DIO - DPO" '
const CCC = require("./js/ccc.js");
const m = CCC.computeMonth({
  month: "2024-04", days: 30, ar: 720000, revenue: 450000,
  inventory: 540000, cogs: 270000, ap: 300000, purchases: 285000
});
const expected = m.dso + m.dio - m.dpo;
if (Math.abs(m.ccc - expected) > 1e-9) process.exit(1);
'

node_ok "zero revenue returns null DSO not NaN" '
const CCC = require("./js/ccc.js");
const v = CCC.computeDso({ ar: 100, revenue: 0, days: 30 });
if (v !== null) process.exit(1);
if (Number.isNaN(v)) process.exit(1);
'

node_ok "zero COGS returns null DIO not Infinity" '
const CCC = require("./js/ccc.js");
const v = CCC.computeDio({ inventory: 100, cogs: 0, days: 30 });
if (v !== null) process.exit(1);
'

node_ok "zero purchases returns null DPO" '
const CCC = require("./js/ccc.js");
const v = CCC.computeDpo({ ap: 100, purchases: 0, days: 30 });
if (v !== null) process.exit(1);
'

node_ok "zero inventory with positive COGS returns 0 DIO" '
const CCC = require("./js/ccc.js");
const v = CCC.computeDio({ inventory: 0, cogs: 200, days: 30 });
if (v !== 0) process.exit(1);
'

node_ok "zero inventory and zero COGS returns null not NaN" '
const CCC = require("./js/ccc.js");
const v = CCC.computeDio({ inventory: 0, cogs: 0, days: 30 });
if (v !== null) process.exit(1);
'

node_ok "null inputs return null metrics" '
const CCC = require("./js/ccc.js");
const m = CCC.computeMonth({ month: "x", days: null, ar: null, revenue: null, inventory: null, cogs: null, ap: null, purchases: null });
if (m.dso !== null || m.dio !== null || m.dpo !== null || m.ccc !== null) process.exit(1);
'

node_ok "empty series returns empty months and null latest" '
const CCC = require("./js/ccc.js");
const r = CCC.computeTracker({ company: "T", targets: {}, months: [] });
if (r.months.length !== 0 || r.latest !== null) process.exit(1);
if (r.extrema.ccc.best !== null || r.extrema.ccc.worst !== null) process.exit(1);
'

node_ok "null dataset is safe" '
const CCC = require("./js/ccc.js");
const r = CCC.computeTracker(null);
if (!r || r.months.length !== 0 || r.latest !== null) process.exit(1);
'

node_ok "never emits NaN or Infinity on sample data" '
const CCC = require("./js/ccc.js");
const data = require("./data/ccc.json");
const r = CCC.computeTracker(data);
for (const row of r.months) {
  for (const key of CCC.METRIC_KEYS) {
    const v = row[key];
    if (v === null) continue;
    if (!Number.isFinite(v)) process.exit(1);
  }
}
if (r.months.length < 12) process.exit(1);
'

node_ok "MoM is null on first month and signed after" '
const CCC = require("./js/ccc.js");
const data = require("./data/ccc.json");
const r = CCC.computeTracker(data);
if (r.months[0].mom.ccc !== null) process.exit(1);
const second = r.months[1];
if (!second.mom.ccc || typeof second.mom.ccc.delta !== "number") process.exit(1);
if (!Number.isFinite(second.mom.ccc.delta)) process.exit(1);
'

node_ok "best CCC is lowest and worst is highest" '
const CCC = require("./js/ccc.js");
const data = require("./data/ccc.json");
const r = CCC.computeTracker(data);
const values = r.months.map((m) => m.ccc);
if (r.extrema.ccc.best.value !== Math.min(...values)) process.exit(1);
if (r.extrema.ccc.worst.value !== Math.max(...values)) process.exit(1);
'

node_ok "best DPO is highest (higher is better)" '
const CCC = require("./js/ccc.js");
const data = require("./data/ccc.json");
const r = CCC.computeTracker(data);
const values = r.months.map((m) => m.dpo);
if (r.extrema.dpo.best.value !== Math.max(...values)) process.exit(1);
if (r.extrema.dpo.worst.value !== Math.min(...values)) process.exit(1);
'

node_ok "target comparison meeting flag for latest CCC" '
const CCC = require("./js/ccc.js");
const data = require("./data/ccc.json");
const r = CCC.computeTracker(data);
const vs = r.latest.vsTarget.ccc;
if (!vs || typeof vs.meeting !== "boolean") process.exit(1);
const expectMeet = r.latest.ccc <= r.targets.ccc;
if (vs.meeting !== expectMeet) process.exit(1);
'

# --- Sample data shape ---

node_ok "sample data has at least 12 months and required inputs" '
const data = require("./data/ccc.json");
if (!Array.isArray(data.months) || data.months.length < 12) process.exit(1);
const need = ["month","days","ar","revenue","inventory","cogs","ap","purchases"];
for (const row of data.months) {
  for (const k of need) if (row[k] == null) process.exit(1);
}
const t = data.targets;
if (t.dso == null || t.dio == null || t.dpo == null || t.ccc == null) process.exit(1);
'

# --- Static HTML first paint ---

if [[ ! -f index.html ]]; then
  fail "index.html exists"
else
  pass "index.html exists"
fi

if grep -qi "Loading" index.html; then
  fail "static HTML has no Loading shell"
else
  pass "static HTML has no Loading shell"
fi

if grep -q "DSO" index.html && grep -q "DIO" index.html && grep -q "DPO" index.html && grep -q "CCC" index.html; then
  pass "static HTML contains DSO DIO DPO CCC labels"
else
  fail "static HTML contains DSO DIO DPO CCC labels"
fi

node_ok "static HTML contains computed latest metric numbers" '
const fs = require("fs");
const CCC = require("./js/ccc.js");
const data = require("./data/ccc.json");
const html = fs.readFileSync("index.html", "utf8");
const r = CCC.computeTracker(data);
for (const key of CCC.METRIC_KEYS) {
  const n = CCC.formatDays(r.latest[key], 1);
  if (!n || !html.includes(n)) {
    console.error("missing latest", key, n);
    process.exit(1);
  }
}
if (!html.includes("data-metric=\"dso\"")) process.exit(1);
if (!html.includes("<table")) process.exit(1);
'

node_ok "static HTML has a row for every sample month with metric values" '
const fs = require("fs");
const CCC = require("./js/ccc.js");
const data = require("./data/ccc.json");
const html = fs.readFileSync("index.html", "utf8");
const r = CCC.computeTracker(data);
if (r.months.length < 12) process.exit(1);
for (const row of r.months) {
  if (!html.includes(row.month)) { console.error("missing month", row.month); process.exit(1); }
  const dso = CCC.formatDays(row.dso, 1);
  if (!html.includes(dso)) { console.error("missing dso", row.month, dso); process.exit(1); }
}
'

# curl first-paint (no JS execution)
PORT=8765
python3 -m http.server "$PORT" --bind 127.0.0.1 >/tmp/ccc-http.log 2>&1 &
HTTP_PID=$!
cleanup() { kill "$HTTP_PID" 2>/dev/null || true; }
trap cleanup EXIT

ready=0
for _ in 1 2 3 4 5 6 7 8 9 10; do
  if curl -sf "http://127.0.0.1:${PORT}/" >/dev/null; then
    ready=1
    break
  fi
  sleep 0.2
done

if [[ "$ready" -ne 1 ]]; then
  fail "local HTTP server started for curl"
else
  pass "local HTTP server started for curl"
  HTML="$(curl -sL "http://127.0.0.1:${PORT}/")"
  if echo "$HTML" | grep -q "DSO" && echo "$HTML" | grep -q "DIO" && echo "$HTML" | grep -q "DPO" && echo "$HTML" | grep -q "CCC"; then
    pass "curl first-paint contains DSO DIO DPO CCC labels"
  else
    fail "curl first-paint contains DSO DIO DPO CCC labels"
  fi
  if echo "$HTML" | grep -Eq "[0-9]+\.[0-9]"; then
    pass "curl first-paint contains metric numbers"
  else
    fail "curl first-paint contains metric numbers"
  fi
  if echo "$HTML" | grep -q "data-month="; then
    pass "curl first-paint contains monthly table rows"
  else
    fail "curl first-paint contains monthly table rows"
  fi
  if echo "$HTML" | grep -qi "Loading"; then
    fail "curl first-paint has no Loading shell"
  else
    pass "curl first-paint has no Loading shell"
  fi
fi

echo "Summary: ${passed} passed, ${failed} failed"
if [[ "$failed" -ne 0 ]]; then
  exit 1
fi
exit 0
