package dz.mushrifi.app;

import java.net.URI;
import java.net.URISyntaxException;

/**
 * Strict navigation boundary for the local Mushrifi WebView.
 *
 * The app is loaded from one packaged asset. Only that exact page may remain
 * inside the WebView; secure external web links are handed to Android instead.
 */
final class WebViewNavigationPolicy {
    private static final String APP_SCHEME = "file";
    private static final String APP_PATH = "/android_asset/index.html";

    private WebViewNavigationPolicy() {}

    static boolean isTrustedAppPage(String rawUrl) {
        URI uri = parse(rawUrl);
        if (uri == null) return false;
        return APP_SCHEME.equalsIgnoreCase(uri.getScheme())
                && uri.getRawAuthority() == null
                && uri.getUserInfo() == null
                && uri.getPort() == -1
                && APP_PATH.equals(uri.getRawPath())
                && uri.getRawQuery() == null;
    }

    static boolean isAllowedExternalHttps(String rawUrl) {
        URI uri = parse(rawUrl);
        if (uri == null || uri.isOpaque()) return false;
        if (!"https".equalsIgnoreCase(uri.getScheme())) return false;
        if (uri.getHost() == null || uri.getHost().trim().isEmpty()) return false;
        if (uri.getUserInfo() != null) return false;
        int port = uri.getPort();
        return port == -1 || (port >= 1 && port <= 65535);
    }

    private static URI parse(String rawUrl) {
        if (rawUrl == null || rawUrl.trim().isEmpty()) return null;
        try {
            return new URI(rawUrl);
        } catch (URISyntaxException | IllegalArgumentException error) {
            return null;
        }
    }
}
