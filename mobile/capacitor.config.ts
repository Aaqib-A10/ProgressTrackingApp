import { existsSync } from 'node:fs'
import type { CapacitorConfig } from '@capacitor/cli'

/**
 * The Metriq phone app. The app is a native shell that opens the live Metriq (the same pages,
 * the same sign-in as the browser), so a deploy of the website reaches every phone at once and
 * the app can never be a version behind the server. What the shell adds is native: push
 * notifications, downloads to the phone, a no-connection screen, the app icon and splash.
 *
 * METRIQ_APP_URL (only when building): open another address instead, e.g. a test server.
 */
const site = (process.env.METRIQ_APP_URL || 'https://pulsetrack.online').replace(/\/+$/, '')
const host = new URL(site).host
// Push notifications need the push service's settings file in the Android project (see README).
// A build without it still works; it tells the website so, and the website does not ask for a push token.
const pushReady = existsSync('android/app/google-services.json') || process.env.METRIQ_PUSH === '1'

const config: CapacitorConfig = {
  appId: 'online.pulsetrack.metriq',
  appName: 'Metriq',
  webDir: 'www',
  backgroundColor: '#FAFAFB',
  // The website sees "MetriqApp" in the user agent and knows it is inside the app ("Push": this build can receive push).
  appendUserAgent: `MetriqApp/1.0${pushReady ? ' Push' : ''}`,
  server: {
    url: `${site}/app`,
    // Only Metriq's own pages open inside the app; any other link opens in the phone's browser.
    allowNavigation: [host, `*.${host}`],
    errorPath: 'offline.html',
    androidScheme: 'https',
    cleartext: site.startsWith('http://'),
  },
  android: {
    // Shown in Chrome's inspector only for debug builds.
    webContentsDebuggingEnabled: false,
  },
  plugins: {
    SplashScreen: { launchShowDuration: 1200, launchAutoHide: true, backgroundColor: '#4338CA', showSpinner: false },
    // The website already lays itself out edge to edge (viewport-fit=cover, safe-area insets).
    SystemBars: { initialViewportFitValueHint: 'cover' },
    PushNotifications: { presentationOptions: ['badge', 'sound', 'alert'] },
  },
}

export default config
