# Vehicle selection map update

- No navbar/title/Help: floating Back control over map.
- Larger responsive map; compact scrollable pickup/drop summary; View All above card.
- Selected category shows matching bundled 3D vehicle icons, not a driver count. Movement interpolates only real updated coordinates.
- New customer hook/API use Engine GET /drivers/preview; no driver identity or client-side assignment.
- Updated Engine must be deployed before live preview works. No Backend/Driver change or new migration. Existing GPS/presence contract must be operational.
- Full contract/limits: engine/docs/CUSTOMER_VEHICLE_PREVIEW.md in the workspace.
- Live eligible-driver map and animation checks pending; local controlled tests do not certify production deployment.
