# Customer fare charges (2026-11-01 approval)

The user explicitly approved increasing customer total by 10% of delivery fare. `FARE_CUSTOMER_PLATFORM_FEE_BPS=1000` is the default for newly issued quotes. It is independent from driver settlement commission; the existing driver commission algorithm remains based on its existing gross booking amount, which now includes this customer surcharge. This does not promise that driver net equals delivery fare.

The backend rounds the total fee HALF_UP to paise, then cumulatively allocates that rounded fee to drops so their collections add up exactly. Existing `farePaise` remains the pre-tax subtotal including customer charges; `payablePaise = farePaise + taxPaise`, preserving Engine/registration/payment/collection contracts. `deliveryFarePaise`, `customerPlatformFeePaise`, `customerPlatformFeeBps` and `surgeChargePaise` are frozen on the quote. Surge is always zero in this release; UI hides it at zero. No surge multiplier or rule was activated.

Run migration `20261101190000_customer_quote_charge_snapshot` before deploying the new backend. The migration adds nullable snapshot columns and integrity/immutability checks; it does not rewrite historical amounts. Historical quotes omit the new breakup, retain their original total and can still be redeemed normally. A rate/environment change affects only future quotes, never existing quotes or bookings. Admin preview uses the same customer-charge policy.

Rollout: deploy migration + backend, deploy compatible customer app, and verify a new quote end to end. To stage backend without charging yet, set the customer rate explicitly to zero, then enable 1000 when ready. Existing customer apps still display server total, but only the new UI displays the separate customer-fee row. No production migration, fee activation or deployment was executed in this change.

Checks: base INR 50 -> fee INR 5 -> total INR 55; base INR 48.18 -> fee INR 4.82 -> total INR 53.00; multi-drop amounts and provider maximum including the fee; zero policy and double-application guards.
