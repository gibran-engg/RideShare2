# Building and installing the Android app

The app in `mobile/` is an Expo (React Native) project. It is built into a normal Android **APK**
on this PC with the Android SDK. No Expo account or Android Studio is needed.

## What is installed (once)

Everything lives on D: because C: is nearly full:

| Path | What |
|---|---|
| `D:\Android\jdk-17` | Java 17 (Eclipse Temurin). React Native's Gradle build needs 17; the system Java 23 is left alone |
| `D:\Android\sdk` | Android SDK: platform 36, build-tools 36, platform-tools (`adb`), NDK 27.1, CMake 3.22 |
| `D:\Android\gradle-home` | Gradle and its download cache (created by the first build, a few GB) |

Nothing is added to `PATH` or the system environment variables; the build script sets them for
itself.

## Build

1. Find the PC's Wi-Fi address: `ipconfig` → *Wireless LAN adapter Wi-Fi* → *IPv4 Address*, e.g.
   `192.168.1.37`. (`npm run dev` prints it too.)
2. Build with the API address the phone should use:

   ```bash
   cd mobile
   bash scripts/build-android.sh http://192.168.1.37:3000
   ```

   The first build downloads Gradle and the Android libraries and takes 15–30 minutes; later builds
   take a few minutes. The APK ends up at
   `mobile/android/app/build/outputs/apk/release/app-release.apk` (about 60 MB).

What the script does:

- `npx expo prebuild --platform android` generates the native project in `mobile/android/` from
  `app.json`. The folder is generated, so it isn't in git; delete it whenever you like.
- `gradlew assembleRelease` compiles the app and bundles the JavaScript into the APK, so the phone
  doesn't need the Expo dev server. The release build is signed with the debug key, which is fine
  for installing on your own phones; the Play Store would need a real upload key.
- The build is for `arm64-v8a`, which covers practically all phones from the last ~8 years.

Rebuild when the PC's IP changes, or after changing the app's code. Changing the Auth0 settings in
`.env` doesn't need a rebuild, because the app reads them from the API (`/api/config`).

## Install on a phone

Any one of these:

- **USB**: on the phone, enable *Developer options → USB debugging*, connect it, then
  ```bash
  D:/Android/sdk/platform-tools/adb.exe install -r mobile/android/app/build/outputs/apk/release/app-release.apk
  ```
- **Copy the file**: send `app-release.apk` to the phone (USB, Drive, WhatsApp to yourself...), open
  it and allow *Install unknown apps* for that app when Android asks.

## Run

1. On the PC: `npm run dev` (API on port 3000, plus Dev sign-in on 4000 until Auth0 is configured).
2. Phone and PC on the **same Wi-Fi**. If Windows Firewall asks about Node.js, allow it on
   **private** networks. Check from the phone's browser: `http://192.168.1.37:3000/api/health`.
3. Open **RideShare** → *Sign in or sign up*. A browser tab opens Auth0's login page (or Dev
   sign-in), then returns to the app via `rideshare://auth`.

## Troubleshooting

| Symptom | Fix |
|---|---|
| "Can't reach the RideShare server at http://…" | Wrong IP built in, phone on another network, or the firewall blocks port 3000. Rebuild with the right IP. |
| Dev sign-in page doesn't open | The phone must also reach port 4000 on the PC (same firewall rule). |
| Auth0: "Callback URL mismatch" | Add `rideshare://auth` to the *RideShare App* application's Allowed Callback URLs. |
| Map stays black | The phone needs internet for the map tiles (MapTiler/CARTO). |
| Build: `SDK location not found` | The script writes `android/local.properties`; run it from `mobile/` with bash (Git Bash). |
| Build fails with "file name too long" | Windows path limit: keep the project at a short path such as `D:\RideShare`. |
