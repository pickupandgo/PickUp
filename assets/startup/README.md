Original MultipleRide Partner delivery story

Six shaded 2.5D character cels were created with the built-in imagegen tool.
The supplied official Partner mascot and white delivery motorcycle were identity
references; no Porter assets were used. The official brand logo is rendered
separately from assets/branding/multipleride-partner-logo-transparent.png and
has not been regenerated, cropped or recolored.

- source/partner-delivery-cels.png: original generated RGBA sheet, unchanged.
- source/prompts.json: exact generation and refinement prompts.
- 01-arrive.png through 06-deliver.png: registered 512 × 512 RGBA runtime cels.
- scripts/prepare_startup_artwork.py: repeatable cel registration by wheel
  anchors, using uniform scale and translation without changing proportions.
- src/components/startup/startupTimeline.ts: 2,800 ms story timing and trajectories.
- src/components/startup/StartupScene.tsx: character, wheel highlights, road,
  shadow, parcel, destination and exact official brand reveal.
- src/components/startup/StartupExperience.tsx: lifecycle, image readiness,
  accessibility and account-readiness handoff.

The six runtime PNGs total 1,425,248 bytes and decode to 6 MiB before GPU layers.
The source sheet and prompts are authoring material; Metro requires only the six
runtime cels. Reanimated, Worklets and react-native-svg were already installed;
no animation runtime dependency was added. Reanimated runs the coordinated clock
and transforms on the UI thread. API 29+ uses isolated additive cel blending to
avoid see-through characters; older Android versions use clean cel changes.

Run from D:/PU/PickUp-raj_driver:

    python scripts/prepare_startup_artwork.py
    python scripts/verify_startup_artwork.py android/app/build/outputs/apk/release/app-release.apk

Device previews, build logs, verification evidence and APK paths are listed in
D:/PU/PickUp-raj_driver/artifacts/startup-animation/REPORT.md.
