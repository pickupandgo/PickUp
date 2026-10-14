# Pricing configuration files

A pricing version is created from one of these files, never from numbers typed on a command line:

```
node dist/cli/provision.js create-pricing-version \
  --code V1-2026-11 \
  --file ./pricing/v1-2026-11.json \
  --reason "Fares approved by Nikhil Enterprises on 2026-11-01"
```

The file is validated against its model (`LEG_DISTANCE_V1`) before anything is written, the
version currently in effect is closed at the new version's start, and the creation is audited.
Versions are never edited: a price change is a new file and a new version. Quotes and bookings
keep the version that priced them.

## `prototype-leg-distance-v1.json` — development only, **not approved**

These are the prototype's numbers (₹30 base, ₹12/km, ₹10 per extra stop, the weight steps and
the per-vehicle multipliers), converted to paise with the vehicle multiplier folded into each
category's rates. They exist so the Fare module can be exercised end to end before the real
fares are decided. **Nobody has approved them** (`docs/OPEN_DECISIONS.md`, D-14).

Create it with a `PROTOTYPE…` code, which the CLI refuses in production:

```
node dist/cli/provision.js create-pricing-version \
  --code PROTOTYPE-2026-10 \
  --file ./pricing/prototype-leg-distance-v1.json \
  --reason "Development only: prototype rates, not approved for production (D-14)"
```

## `LEG_DISTANCE_V1` in one line

Each drop pays for the leg that reaches it:

```
leg fare = round((base + perKm × km) × weight multiplier, legRounding), at least the minimum
```

`base` is `firstLegBasePaise` for the first drop and `additionalLegBasePaise` for every later
drop. `km` is that leg's straight-line distance. The weight multiplier comes from the booking's
total weight. The booking total is the sum of the drops, so per-drop amounts always add up.

| Field | Meaning |
|---|---|
| `vehicles` | Rates per vehicle category code. A category that is absent has no price, and a quote for it is refused (`VEHICLE_CATEGORY_NOT_PRICED`). Codes must match what the apps and engine send (D-28). |
| `weightBands` | Ascending `upToGrams` bands; the last one is open-ended (`null`). `multiplierBps` is in basis points: 10000 = 1×, 12000 = 1.2×. |
| `legRounding` | `incrementPaise` (100 = whole rupees) and `mode` (`UP`, `HALF_UP` or `DOWN`), applied once per leg. |
| `taxes` | Must be empty. A tax needs a CA-approved rule and a model that computes it (D-55, D-57). |

All amounts are integer paise. The calculation uses BigInt only, with one rounding step per leg.
