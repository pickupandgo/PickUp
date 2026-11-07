# 2.5D splash artwork

Current user-approved direction is the earlier illustrated map splash, with a
continuous solid route, green travelled trail and a bundled rider sprite following
its tangent. No 3D scene, WebView, network or GPS is used.

- journey-map.png: decorative map background generated with built-in Imagegen.
- journey-rider.png: transparent delivery rider generated with built-in Imagegen.
- Existing logo: assets/logo.png.
- Animation/layout: src/components/splash/BrandedSplash.tsx and journeyPath.ts.

Both assets are restored unchanged from the earlier approved preview. Pickup/Drop
labels have explicit widths and single-line text to prevent the previous wrapping.
A first full journey gates the existing splashComplete callback. Slow account
checks hold at Drop without fading/reversing the rider. The 3D experiment's native
package, registration and HTML scene have been removed.

Original map prompt: preserve the very pale icy-blue map, white roads, mint parks
and river from the approved splash; remove all logo/text, rider, pins and routes;
leave a nearly blank upper region and fade the lower edge to the blue background.
Original rider prompt: isolate the reference's green-uniform, green-helmet delivery
rider on a realistic motorcycle with rear green parcel box, rear-left three-quarter
view pointing northeast, full wheels visible, genuinely transparent background,
no map/route/text/frame. Generated using built-in Imagegen.

Validation: Typecheck passed. Actual phone appearance requires the next APK.
