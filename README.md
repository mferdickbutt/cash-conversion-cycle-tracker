# Cash Conversion Cycle tracker

Public working-capital dashboard for **DSO**, **DIO**, **DPO**, and **CCC**. The first paint of `index.html` already contains the full metrics summary and monthly table — no JavaScript required.

Sample series: **18 months** (Apr 2024–Sep 2025) for Northwind Components.

## Formulas

All metrics use **period-end balances** and the **calendar days in that month** (`days` on each row). Flow figures (revenue, COGS, purchases) are the amounts recognized during that same month.

| Metric | Formula | Meaning |
| --- | --- | --- |
| **DSO** | `AR / (revenue / days)` which is `AR × days / revenue` | Days to collect receivables. Lower is better. |
| **DIO** | `inventory / (COGS / days)` which is `inventory × days / COGS` | Days inventory sits before sale. Lower is better. |
| **DPO** | `AP / (purchases / days)` which is `AP × days / purchases` | Days to pay suppliers. Higher is better (cash stays longer). |
| **CCC** | `DSO + DIO − DPO` | Days of cash tied up in the cycle. Lower is better. |

**Purchases** are an explicit input (not inferred from COGS). That is the standard “inventory purchases” denominator for DPO when the books track it; we do not substitute COGS.

Unsafe math returns `null` (never `NaN` or `Infinity`):

- missing / non-finite / empty inputs
- `days <= 0`
- zero **revenue** → DSO is `null`
- zero **COGS** → DIO is `null`
- zero **purchases** → DPO is `null`
- zero inventory with positive COGS → DIO is `0`
- any of DSO/DIO/DPO is `null` → CCC is `null`
- empty month list → no latest row; best/worst are `null`

**Targets:** DSO, DIO, and CCC meet target when value ≤ target. DPO meets target when value ≥ target.

**MoM:** current month minus previous month, in days. For DSO/DIO/CCC a decrease is improving; for DPO an increase is improving. The first month has no MoM.

**Best / worst:** lowest DSO, DIO, and CCC are best; highest DPO is best.

## How to re-render

Edit `data/ccc.json`, then bake `index.html`:

```bash
node scripts/render-static.js
```

That overwrites `index.html` with computed cards, best/worst, and the monthly table. Commit both the JSON and the generated HTML so GitHub Pages first-paint stays complete.

```bash
bash scripts/test.sh
```

## Files

- `data/ccc.json` — 18 months of AR, revenue, inventory, COGS, AP, purchases, days, and targets
- `js/ccc.js` — browser + Node module for all metrics
- `js/enhance.js` — optional class flag only; does not supply numbers
- `scripts/render-static.js` — static HTML baker
- `index.html` — first-paint snapshot
- `css/style.css` — minimal layout
- `.nojekyll` — serve as plain files on GitHub Pages

## Suggested next improvements

- Pull period-end AR/AP/inventory and monthly P&L from the GL or an accounting API instead of a hand-edited JSON file
- Offer a trailing-twelve-month view next to the calendar-month view (365-day annualization)
- Derive purchases as `COGS + ending inventory − beginning inventory` when purchases are not booked separately
- Overlay industry benchmark bands and a simple what-if (e.g. collect 5 days faster)
- Average balances (start/end) instead of period-end only, which smooths lumpy month-ends
