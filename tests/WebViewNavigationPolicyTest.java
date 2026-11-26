package dz.mushrifi.app;

/** Standalone regression tests; intentionally requires no Android runtime. */
public final class WebViewNavigationPolicyTest {
    private static void expect(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
    }

    public static void main(String[] args) {
        expect(WebViewNavigationPolicy.isTrustedAppPage("file:///android_asset/index.html"),
                "the packaged app page must remain in the WebView");
        expect(WebViewNavigationPolicy.isTrustedAppPage("file:///android_asset/index.html#students"),
                "in-page fragments must remain supported");
        expect(!WebViewNavigationPolicy.isTrustedAppPage("file:///android_asset/index.html?redirect=https://evil.example"),
                "query-bearing app URLs are not accepted as the trusted entry page");
        expect(!WebViewNavigationPolicy.isTrustedAppPage("file:///android_asset/other.html"),
                "other packaged files are not trusted top-level documents");
        expect(!WebViewNavigationPolicy.isTrustedAppPage("file:///sdcard/Download/fake.html"),
                "external file documents must never inherit the app bridge");
        expect(!WebViewNavigationPolicy.isTrustedAppPage("file://localhost/android_asset/index.html"),
                "authority-bearing file URLs are not trusted");

        expect(WebViewNavigationPolicy.isAllowedExternalHttps("https://wa.me/213699251551"),
                "WhatsApp HTTPS fallback must continue to work externally");
        expect(WebViewNavigationPolicy.isAllowedExternalHttps("HTTPS://example.com/path?q=1#section"),
                "valid HTTPS links must be accepted case-insensitively");
        expect(!WebViewNavigationPolicy.isAllowedExternalHttps("http://example.com"),
                "unencrypted HTTP navigation must not be opened from the bridge context");
        expect(!WebViewNavigationPolicy.isAllowedExternalHttps("javascript:alert(1)"),
                "javascript URLs must be blocked");
        expect(!WebViewNavigationPolicy.isAllowedExternalHttps("data:text/html,<script>alert(1)</script>"),
                "data URLs must be blocked");
        expect(!WebViewNavigationPolicy.isAllowedExternalHttps("content://provider/item"),
                "content URLs must be blocked as navigation");
        expect(!WebViewNavigationPolicy.isAllowedExternalHttps("intent://scan/#Intent;scheme=zxing;end"),
                "intent URLs must be blocked");
        expect(!WebViewNavigationPolicy.isAllowedExternalHttps("https://user:pass@example.com"),
                "credential-bearing URLs must be blocked");
        expect(!WebViewNavigationPolicy.isAllowedExternalHttps("https:///missing-host"),
                "HTTPS URLs without a host must be blocked");
        expect(!WebViewNavigationPolicy.isAllowedExternalHttps("https://example.com:0"),
                "invalid ports must be blocked");
        expect(!WebViewNavigationPolicy.isAllowedExternalHttps("https://example.com:65536"),
                "out-of-range ports must be blocked");
        expect(!WebViewNavigationPolicy.isAllowedExternalHttps(null),
                "null URLs must be blocked");
        expect(!WebViewNavigationPolicy.isAllowedExternalHttps("  https://example.com"),
                "malformed URLs must be blocked");

        System.out.println("PASS: trusted local page, HTTPS external handoff, and unsafe navigation rejection.");
    }
}
