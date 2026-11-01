# M11 - Optional customer actions and truthful launch scope
2026-11-01. Customer-only change for CA-24 / CA-28. Local implementation verified; native OS chooser/device acceptance remains pending.

## Working or preserved
- Trip-reference sharing opens React Native's real OS share chooser for the selected engine trip. It shares reference and status only, without addresses, phone numbers, OTPs, payment data or a fabricated live-tracking URL. Cancellation/opening is not described as delivery success. Duplicate taps are blocked, native failures are explicit and late failures after signout/unmount are ignored.
- Historical trip A stays selected while B is active; missing explicit A never falls back to B. Completed summary passes selected identity to sharing.
- Local saved-address CRUD remains functional, with visible device-only/no-cloud-sync disclosure and relevant Help text.
- Declared goods value remains editable and continues without insurance. Existing explicit no-policy/no-premium message is preserved; header now identifies declared value rather than implying an insurance purchase.
- Existing receipt/payment viewing remains; unsupported document sharing is labelled unavailable.

## Explicitly unavailable without backend/provider contracts
- Driver calling: no simulated call/ringing/mute/speaker/driver/rating screen. A clear notice may open chat for the exact booking; no phone number is guessed or exposed.
- Public live-tracking links/copy: no sample URL or timer-driven Copied status. Only reference sharing is enabled.
- Custom profile photo changes: no camera/gallery/remove actions that just dismiss the page. Existing photo display is unchanged.
- Driver ratings/written reviews: no fake timer submit, local-only success, or review-driven clearing/reset of an unrelated active booking. Entry labels and compatibility routes disclose unavailability. No feedback is collected or claimed saved.
- Scheduled bookings: scheduled empty state states unavailability. Default CTA is explicitly Book now, opening the existing immediate booking flow. An explicitly supplied scheduling callback remains supported for future integration; no such callback is supplied in the production navigator.

These are release-safe defaults, not implementations of telephony, public tracking, photo upload, rating persistence, insurance, cloud addresses or future scheduling. Enabling those later requires real server/provider contracts and acceptance tests, not a UI flag alone.

## Validation
Customer TypeScript passed. Four focused suites / 44 tests passed: optional actions, trip history, local address management and selected-trip/payment presentation. New coverage includes native-share dismissal/failure, duplicate taps, A/B isolation, sensitive-field exclusion, call fallback, absent submission and active-trip preservation. Native OS/device behavior is still pending in M12. Static wiring checker still exits nonzero for ten unreachable names, including intentionally unsupported written-review and existing nested/alternate routes; no full clean-wiring claim. No backend/engine/driver/admin/database changes, no migration, no new native dependency and no APK build for this step.
