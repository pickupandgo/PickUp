# Initial rate card chosen under owner delegation
2026-10-31. These are starting business rates selected by the assistant at the owner's explicit request, not competitor quotes or a validated profitability claim. Activated on the supplied Render database after explicit owner instruction to fix the missing fare configuration. Before: no pricing in effect. After: INITIAL-20261031-V1 active for all four categories, through the existing audited pricing-version helper. A live authenticated MINI_TRUCK two-drop quote succeeded from the emulator.

| Category | First-leg base INR | Each additional-leg base INR | Per km INR | Minimum per leg INR |
|---|---:|---:|---:|---:|
| TWO_WHEELER | 35 | 15 | 8 | 50 |
| THREE_WHEELER | 100 | 40 | 18 | 150 |
| MINI_TRUCK | 180 | 60 | 25 | 250 |
| PICKUP_TRUCK | 250 | 80 | 30 | 350 |

No included/free kilometres. Each leg costs max(minimum, base + kilometres * per-km rate), rounded up to the next rupee. The first base applies pickup-to-first-drop; additional base applies each subsequent leg. Minimum applies independently to EVERY leg, including zero-distance drops. Weight multiplier is 1; this does not enforce vehicle load capacity. Taxes, tolls, parking, waiting, cancellation and surge are not introduced by this config. Tax treatment needs business review before launch; taxes=[] is current model support, not a tax-exemption claim.

The JSON matches the EXISTING LEG_DISTANCE_V1/HAVERSINE model. It cannot represent road distance: do not claim production road pricing or silently apply it as such. Road-routing integration, real admin persistence, applicable tax treatment and controlled live quotes remain launch gates.

## Existing provisioning path
After the appropriate deployment and business/launch review, use the existing audited CLI with the protected owner/migrator DATABASE_URL already configured in the environment:

```sh
node dist/cli/provision.js create-pricing-version --code INITIAL-20261031-V1 --file ./pricing/initial-owner-delegated-v1.json --reason "Initial rate card selected under explicit owner delegation"
```

Do not rerun blindly. Inspect the current version first; CLI refuses duplicate codes/overlaps and closes an earlier open-ended version. Existing quotes retain their original pricing version. Admin API supports versioned rate changes; pickup-admin vehicleCategoryService currently stores mock data in memory, so the current web pricing form does NOT update this rate card. Connect it to /v1/admin/pricing-versions before promising web edits.
