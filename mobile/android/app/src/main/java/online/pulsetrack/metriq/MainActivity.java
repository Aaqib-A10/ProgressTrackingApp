package online.pulsetrack.metriq;

import android.app.DownloadManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.webkit.CookieManager;
import android.webkit.URLUtil;
import android.webkit.WebView;
import android.widget.Toast;

import com.getcapacitor.BridgeActivity;

/**
 * The Metriq app is the live Metriq inside a native shell (see capacitor.config.ts).
 * The only native code of our own is here:
 *  - a notification channel for Metriq's alerts (Android 8+ needs one),
 *  - downloads: a CSV or file link in Metriq is saved to the phone's Downloads, signed in as the person,
 *  - the sign-in cookie is written to disk when the app goes to the background.
 */
public class MainActivity extends BridgeActivity {

    public static final String ALERTS_CHANNEL = "metriq_alerts";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        createAlertsChannel();
        if (getBridge() == null) return;
        WebView webView = getBridge().getWebView();
        webView.setDownloadListener((url, userAgent, contentDisposition, mimeType, contentLength) -> download(url, userAgent, contentDisposition, mimeType));
    }

    @Override
    public void onPause() {
        super.onPause();
        // Keep the person signed in if Android closes the app while it is in the background.
        CookieManager.getInstance().flush();
    }

    private void createAlertsChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager == null) return;
        NotificationChannel channel = new NotificationChannel(ALERTS_CHANNEL, "Metriq alerts", NotificationManager.IMPORTANCE_HIGH);
        channel.setDescription("Tasks, leads, messages, calls and attendance alerts from Metriq");
        manager.createNotificationChannel(channel);
    }

    private void download(String url, String userAgent, String contentDisposition, String mimeType) {
        if (url == null || !(url.startsWith("https://") || url.startsWith("http://"))) {
            // A file the page made itself (blob:) cannot be handed to Android's downloader.
            Toast.makeText(this, "This download is not available in the app yet. Open Metriq in a browser for it.", Toast.LENGTH_LONG).show();
            return;
        }
        try {
            String name = URLUtil.guessFileName(url, contentDisposition, mimeType);
            DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
            String cookies = CookieManager.getInstance().getCookie(url);
            if (cookies != null) request.addRequestHeader("Cookie", cookies);
            if (userAgent != null) request.addRequestHeader("User-Agent", userAgent);
            if (mimeType != null && !mimeType.isEmpty()) request.setMimeType(mimeType);
            request.setTitle(name);
            request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            try {
                request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name);
            } catch (Exception noPublicFolder) {
                request.setDestinationInExternalFilesDir(this, Environment.DIRECTORY_DOWNLOADS, name);
            }
            DownloadManager manager = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
            if (manager == null) throw new IllegalStateException("no download service");
            manager.enqueue(request);
            Toast.makeText(this, "Downloading " + name, Toast.LENGTH_SHORT).show();
        } catch (Exception e) {
            Toast.makeText(this, "Could not start the download.", Toast.LENGTH_LONG).show();
        }
    }
}
