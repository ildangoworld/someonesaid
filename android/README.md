# 하루한문장 for Android

This Android project has its own application ID, `app.haru.quote`, and can be installed alongside MyON Memory. It uses Android SDK 36 and requires Android 8.0 or later. Use JDK 17 or later and the repository’s Gradle wrapper.

## Build and run

From the repository root with the Android SDK configured:

```bash
./android/gradlew -p android :app:assembleDebug :app:lintDebug
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

Open the app to read the primary bundled quote. Use **문장 더 읽기** to reveal the extra daily quotes. Use **연결 설정** to enter the HTTPS origin of the Haru server (scheme, host, and optional port). With a server configured, the app opens the shared community site and keeps its first-party session. Clearing the address returns to the bundled reader.

For development, run the local server on the host and enter `http://10.0.2.2:8000` in the standard Android Emulator, replacing the port as needed. Debug builds also accept `http://localhost` or `http://127.0.0.1` for an adb-reversed port. Release builds require HTTPS. A clean install uses the production Haru service. To override it, add `-PharuServer=https://quotes.example.com` to the Gradle command or set `HARU_ANDROID_SERVER`. Users can still change or clear it through **연결 설정**.

## Widget

Add **하루한문장** from the home-screen widget picker. The widget also appears in the lock-screen widget picker on Android devices with a compatible lock-screen host. A host may require unlocking before opening the app.

The widget shows the first daily quote for Asia/Seoul and opens that exact quote by ID. It uses a cached daily response when available and otherwise uses the shared bundled selection. When connected, it refreshes from the configured server. Android schedules an inexact alarm for the next midnight in Seoul and supplies periodic updates. Device power management may delay the redraw. Boot, clock changes, and app upgrades reschedule updates.

On a device or emulator, verify that:

- With no server set, the app and widget agree on the primary daily quote. Airplane mode still allows reading, copying, and sharing the bundled quote.
- With the server configured, the app retains its session across process restarts. The widget uses the first quote from the server’s daily response and opens the corresponding detail.
- When a cached widget quote is tapped offline or after a date rollover, the app shows the tapped quote.
- An installed widget refreshes after reboot and a clock change across midnight in Seoul. Check home and lock-screen placement where the device supports both.
