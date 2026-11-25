# 하루한문장 for iOS

The standalone SwiftUI app and WidgetKit extension run on iOS 17 and later. They use the same Korean daily quote schedule as the web app. Offline reading starts immediately with the shared seed quotes. To join the community, tap the gear and save the HTTPS address of your Haru server. The community opens inside the app using WebKit’s persistent website data store, which keeps sign-in state across launches.

## Build on a Mac

Open the checked-in project with Xcode 15 or later. Run from the repository root.

```sh
cd ios
open Haru.xcodeproj
```

Select the **Haru** scheme and an iPhone simulator. To build from the same directory without running the app, use:

```sh
xcodebuild -project Haru.xcodeproj -scheme Haru \
  -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build
```

For a signed device build, set your development team on **Haru** and **HaruWidget**. Set the project’s `HARU_BUNDLE_ID` and `HARU_APP_GROUP` build settings to identifiers your Apple Developer team owns. The widget derives its bundle ID by appending `.widget` to the app’s bundle ID. Enable the same App Group for both identifiers and provision both targets. The group shares the server address and recent daily quotes with the widget.

## Default community server for releases

A clean install uses the production Haru service. To use a different deployment, change `HARU_DEFAULT_SERVER` in the **Haru project’s** Build Settings. Both targets inherit this value. A clean install opens that server automatically. An address saved in Settings takes precedence, including a blank address to use offline mode. Tap **기본 서버 사용** to remove a saved override. Leave the build setting blank to ship the app in offline mode until a user configures a server.

You can also provide the value when building from the command line, for example:

```sh
xcodebuild -project Haru.xcodeproj -scheme Haru -configuration Release \
  -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO \
  HARU_DEFAULT_SERVER=https://haru.example.org build
```

## Smoke test

1. Build and launch without a default or saved address. Confirm the primary quote and two extra quotes display. Change the device time zone and check that daily selection still uses the date in Asia/Seoul.
2. Start the [Haru server](../server/README.md) on the Mac. In the simulator, set the server address to `http://localhost:8000`. A physical iPhone needs a reachable HTTPS server with a trusted certificate. Open the community, sign in, interact with a quote, and relaunch to confirm the session persists.
3. Add the **하루한문장** widget to the Home Screen in small and medium sizes. Add the inline and rectangular versions to the Lock Screen. Confirm the primary quote matches the online daily list and tapping a widget opens that quote.
4. Stop the server and retry the community screen. Confirm the app shows locally available quotes. Tap the widget with the server stopped and confirm the selected quote opens from the local cache when available. Clear the server address and confirm both surfaces return to the seed schedule. For a build with a default server, restore it in Settings and confirm the community reconnects.
5. Leave the app open or background it across Korean midnight. Confirm the refreshed reading and widget entries belong to the new Korean date. Offline mode queues the next bundled quote at midnight. Connected widgets request a refresh by midnight, hourly for moderation changes, and after 15 minutes on connection failure. WidgetKit controls the actual refresh time. Until refresh, tapping the widget opens its displayed quote.
6. With a test server, hide all public quotes. Confirm the native daily reading and widget show the empty state after refreshing. Tapping the empty widget should open the app without choosing a quote.
7. Check VoiceOver, larger Dynamic Type, dark mode, and the signed-device App Group. Reading and settings controls use system text sizing and the native screens add no custom motion.

Swift syntax and the checked-in project configuration were checked in the cloud workspace. The Xcode build and simulator/device smoke tests require a Mac.
