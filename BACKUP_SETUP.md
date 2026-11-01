# Latest Vicky customer app backup
Branch: latest-vicky-customer-app. This snapshot preserves the current customer source, Android project, assets, dependency lockfile and tests. It does not contain node_modules, generated APK/build/cache files or production secrets.

To restore on another machine:
1. Clone this branch and run npm ci using the Node version supported by package.json.
2. Copy .env.example to .env and configure backend/engine URLs plus your restricted Android Maps key.
3. Download your Android Firebase configuration, or restore the local original, as android/app/google-services.json. google-services.example.json documents its shape and contains a placeholder API key.
4. Configure Android SDK/JDK paths locally; android/local.properties is not shared.
5. Rebuild the app. A standalone phone APK must bundle JavaScript; Metro alone does not update an existing release APK.

Road routing now uses authenticated POST /v1/routes/road on the backend; GOOGLE_ROUTES_API_KEY stays only on Render. The ordinary Android Maps/Places key remains separate. Secrets intentionally require separate secure recovery; keep an appropriate private backup of local environment/Firebase setup.
