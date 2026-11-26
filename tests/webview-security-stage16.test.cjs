const assert = require('node:assert/strict');
const fs = require('node:fs');

const activity = fs.readFileSync('android/app/src/main/java/dz/mushrifi/app/MainActivity.java', 'utf8');
const policy = fs.readFileSync('android/app/src/main/java/dz/mushrifi/app/WebViewNavigationPolicy.java', 'utf8');
const html = fs.readFileSync('android/app/src/main/assets/index.html', 'utf8');

assert.match(activity, /import android\.webkit\.WebResourceRequest;/,
  'native request-based navigation interception is available');
assert.match(activity, /settings\.setJavaScriptEnabled\(true\)/,
  'the app retains JavaScript required by its UI');
assert.match(activity, /settings\.setDomStorageEnabled\(true\)/,
  'the app retains DOM storage');
assert.match(activity, /settings\.setAllowFileAccess\(true\)/,
  'packaged local assets remain accessible');
assert.match(activity, /settings\.setAllowContentAccess\(true\)/,
  'Storage Access Framework file selection remains supported');
assert.match(activity, /settings\.setAllowFileAccessFromFileURLs\(false\)/,
  'file-origin scripts cannot read arbitrary file URLs');
assert.match(activity, /settings\.setAllowUniversalAccessFromFileURLs\(false\)/,
  'file-origin scripts cannot make universal cross-origin requests');
assert.match(activity, /settings\.setMixedContentMode\(WebSettings\.MIXED_CONTENT_NEVER_ALLOW\)/,
  'mixed content is disabled');
assert.match(activity, /setSafeBrowsingEnabled\(true\)/,
  'Safe Browsing is enabled on supported Android versions');
assert.match(activity, /setJavaScriptCanOpenWindowsAutomatically\(false\)/,
  'scripts cannot create unsolicited windows');
assert.match(activity, /setSupportMultipleWindows\(false\)/,
  'the WebView does not create secondary browsing contexts');

const clientStart = activity.indexOf('web.setWebViewClient(new WebViewClient()');
const clientEnd = activity.indexOf('web.setWebChromeClient(', clientStart);
assert.ok(clientStart >= 0 && clientEnd > clientStart, 'the app uses a dedicated WebViewClient');
const client = activity.slice(clientStart, clientEnd);
assert.match(client, /shouldOverrideUrlLoading\(WebView view, WebResourceRequest request\)/,
  'modern URL navigation is intercepted');
assert.match(client, /shouldOverrideUrlLoading\(WebView view, String url\)/,
  'legacy URL navigation is intercepted');
assert.match(client, /handleWebViewNavigation\(/,
  'both navigation callbacks use one policy-enforcing handler');
assert.doesNotMatch(client, /return false;\s*\}\s*@Override public void onPageFinished/,
  'there is no blanket allow-all navigation callback');

assert.match(activity, /WebViewNavigationPolicy\.isTrustedAppPage\(rawUrl\)/,
  'only the exact packaged app page is trusted in the WebView');
assert.match(activity, /WebViewNavigationPolicy\.isAllowedExternalHttps\(rawUrl\)/,
  'external handoff is restricted to validated HTTPS URLs');
assert.match(activity, /Intent\.ACTION_VIEW[\s\S]*?Intent\.CATEGORY_BROWSABLE/,
  'validated external URLs are handed to Android outside the WebView');
assert.match(activity, /web\.addJavascriptInterface\(new AndroidBridge\(\), "AndroidBridge"\)/,
  'the native bridge required by existing app features remains registered');

for (const method of ['openGuardianWhatsApp', 'openWhatsAppSupport', 'saveDatabase', 'loadDatabase', 'restoreDatabaseSafely']) {
  assert.ok(activity.includes(method), 'existing native bridge capability remains intact: ' + method);
}
assert.match(activity, /onShowFileChooser[\s\S]*?ACTION_OPEN_DOCUMENT/,
  'native file selection workflow remains available');
assert.match(activity, /onJsPrompt[\s\S]*?تأكيد استعادة النسخة الاحتياطية/,
  'backup restore confirmation remains available');

assert.match(policy, /APP_PATH = "\/android_asset\/index\.html"/,
  'the navigation policy pins trust to the packaged entry page');
assert.match(policy, /"https"\.equalsIgnoreCase/,
  'only HTTPS is considered for external handoff');
assert.doesNotMatch(html, /<iframe\b/i,
  'the current application page has no third-party frame that could inherit the bridge');

console.log('PASS: Stage 16 WebView settings, navigation interception, native bridge compatibility and file/restore workflows.');
