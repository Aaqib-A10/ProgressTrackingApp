# Metriq phone app

The Metriq app for Android and iPhone. It is a native shell (Capacitor) that opens the live
Metriq, the same pages and the same sign-in as the browser. A deploy of the website reaches
every phone at once; the app only needs a new store release when something native changes.

What is native here:

- the app icon, splash screen and a "No connection" screen (`www/offline.html`);
- push notifications (the website asks the phone for its token and gives it to the server);
- downloads to the phone's Downloads folder, camera and microphone for calls;
- the phone's back button (handled by the website: `client/src/mobile/native.ts`).

## Build an Android test app

Needs Node 22, JDK 21 and the Android SDK (Android Studio installs it).

    cd mobile
    npm install
    npm run android:apk

The app is written to `android/app/build/outputs/apk/debug/app-debug.apk`.
`npm run android` opens the project in Android Studio instead.

To point a test build at another address (a test server):

    set METRIQ_APP_URL=https://staging.example.com
    npm run android:apk

## Push notifications

Two files, neither of them in the repository:

1. In the app: `android/app/google-services.json`, downloaded from the Firebase project
   (Project settings, Your apps, Android app `online.pulsetrack.metriq`). A build that has this
   file says so to the website ("MetriqApp/1.0 Push" in its user agent) and the website then
   offers "Turn on notifications".
2. On the server: the Firebase service account key (Project settings, Service accounts,
   Generate new private key). Put the file on the server outside the code and add to the
   server's `.env`:

       FCM_SERVICE_ACCOUNT_FILE=/home/erp/keys/metriq-fcm.json

   Restart the server. Without it nothing is sent and the app says notifications are being set up.

iPhone push needs the Apple Developer account's push key; that part is added with the iOS project.

## Never in the repository

`google-services.json`, `GoogleService-Info.plist`, signing keys (`*.keystore`, `*.jks`,
`keystore.properties`) and built apps are ignored by `.gitignore`. Keep the release signing key
safe: Google Play only accepts updates signed with the same key.

## iPhone

`npx cap add ios` on the Mac creates the Xcode project (it needs Xcode and the Apple Developer
account). The same `capacitor.config.ts` is used.
