package dz.mushrifi.app;

import android.app.Activity;
import android.app.AlarmManager;
import android.app.PendingIntent;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;
import android.util.Base64;
import java.security.SecureRandom;
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.PBEKeySpec;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import java.security.KeyStore;
import android.os.Build;
import android.Manifest;
import android.content.pm.PackageManager;
import android.content.Intent;
import android.speech.RecognizerIntent;
import android.net.Uri;
import android.os.Bundle;
import android.provider.DocumentsContract;
import android.provider.Settings;
import android.provider.MediaStore;
import android.content.ContentValues;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebSettings;
import android.widget.Toast;
import java.io.OutputStream;
import java.io.IOException;

public class MainActivity extends Activity {
    private static final int PICK_FILE = 4101;
    private static final int SAVE_FILE = 4102;
    private static final int NOTIFICATION_PERMISSION = 4103;
    private static final int SPEECH_REQUEST = 4104;
    private static final int PICK_BACKUP_NATIVE = 4105;
    private static final String CHANNEL_ID = "guardian_summons";
    private ValueCallback<Uri[]> fileCallback;
    private String pendingBackup;
    private boolean speechPending;
    private WebView web;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        localDb = new LocalDb(this);
        securityPrefs = getSharedPreferences("mushrifi_security", MODE_PRIVATE);
        createNotificationChannel();
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, NOTIFICATION_PERMISSION);
        web = new WebView(this);
        setContentView(web);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        web.addJavascriptInterface(new AndroidBridge(), "AndroidBridge");
        web.setWebViewClient(new WebViewClient());
        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                try {
                    Intent intent = params.createIntent();
                    startActivityForResult(intent, PICK_FILE);
                } catch (Exception e) {
                    fileCallback = null;
                    callback.onReceiveValue(null);
                    Toast.makeText(MainActivity.this, "تعذر فتح الكاميرا أو اختيار الملف", Toast.LENGTH_LONG).show();
                }
                return true;
            }
        });
        web.loadUrl("file:///android_asset/index.html");
    }

    private static SecretKey dataKey() throws Exception {
        KeyStore ks = KeyStore.getInstance("AndroidKeyStore"); ks.load(null);
        if (ks.containsAlias("mushrifi_data_key")) return ((KeyStore.SecretKeyEntry) ks.getEntry("mushrifi_data_key", null)).getSecretKey();
        KeyGenerator kg = KeyGenerator.getInstance("AES", "AndroidKeyStore");
        kg.init(new android.security.keystore.KeyGenParameterSpec.Builder("mushrifi_data_key", android.security.keystore.KeyProperties.PURPOSE_ENCRYPT | android.security.keystore.KeyProperties.PURPOSE_DECRYPT).setBlockModes("GCM").setEncryptionPaddings("NoPadding").setRandomizedEncryptionRequired(true).build());
        return kg.generateKey();
    }
    private static String encryptData(String plain) throws Exception {
        Cipher c = Cipher.getInstance("AES/GCM/NoPadding"); c.init(Cipher.ENCRYPT_MODE, dataKey());
        byte[] iv = c.getIV(), encrypted = c.doFinal(plain.getBytes(java.nio.charset.StandardCharsets.UTF_8));
        byte[] packed = new byte[iv.length + encrypted.length]; System.arraycopy(iv,0,packed,0,iv.length); System.arraycopy(encrypted,0,packed,iv.length,encrypted.length);
        return "enc:" + Base64.encodeToString(packed, Base64.NO_WRAP);
    }
    private static String decryptData(String stored) throws Exception {
        if (stored == null || !stored.startsWith("enc:")) return stored;
        byte[] packed = Base64.decode(stored.substring(4), Base64.NO_WRAP); byte[] iv = java.util.Arrays.copyOfRange(packed,0,12); byte[] ciphertext = java.util.Arrays.copyOfRange(packed,12,packed.length);
        Cipher c = Cipher.getInstance("AES/GCM/NoPadding"); c.init(Cipher.DECRYPT_MODE, dataKey(), new GCMParameterSpec(128,iv));
        return new String(c.doFinal(ciphertext), java.nio.charset.StandardCharsets.UTF_8);
    }
    private static class LocalDb extends SQLiteOpenHelper {
        LocalDb(Context c) { super(c, "mushrifi_local.db", null, 1); }
        @Override public void onCreate(SQLiteDatabase db) { db.execSQL("CREATE TABLE appdata (id INTEGER PRIMARY KEY CHECK(id=1), json TEXT NOT NULL)"); }
        @Override public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) { }
        synchronized String read() { try (Cursor c = getReadableDatabase().rawQuery("SELECT json FROM appdata WHERE id=1", null)) { return c.moveToFirst() ? decryptData(c.getString(0)) : null; } catch (Exception e) { return "!MUSHRIFI_DB_ERROR!"; } }
        synchronized boolean write(String json) { try { android.content.ContentValues v = new android.content.ContentValues(); v.put("id", 1); v.put("json", encryptData(json)); return getWritableDatabase().insertWithOnConflict("appdata", null, v, SQLiteDatabase.CONFLICT_REPLACE) != -1; } catch (Exception e) { return false; } }
    }
    private LocalDb localDb;
    private android.content.SharedPreferences securityPrefs;
    private static String derive(String password, byte[] salt) throws Exception { PBEKeySpec spec = new PBEKeySpec(password.toCharArray(), salt, 150000, 256); try { return Base64.encodeToString(SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).getEncoded(), Base64.NO_WRAP); } finally { spec.clearPassword(); } }
    public class AndroidBridge {
        @JavascriptInterface public String loadDatabase() { return localDb.read(); }
        @JavascriptInterface public boolean saveDatabase(String json) { return json != null && localDb.write(json); }
        @JavascriptInterface public boolean hasPassword() { return securityPrefs.contains("hash") && securityPrefs.contains("salt"); }
        @JavascriptInterface public boolean setPassword(String password) { if (password == null || password.length() < 6) return false; try { byte[] salt = new byte[16]; new SecureRandom().nextBytes(salt); securityPrefs.edit().putString("salt", Base64.encodeToString(salt, Base64.NO_WRAP)).putString("hash", derive(password, salt)).commit(); return hasPassword(); } catch (Exception e) { return false; } }
        @JavascriptInterface public boolean verifyPassword(String password) { if (!hasPassword() || password == null) return false; try { byte[] salt = Base64.decode(securityPrefs.getString("salt", ""), Base64.NO_WRAP); String actual = derive(password, salt), expected = securityPrefs.getString("hash", ""); return java.security.MessageDigest.isEqual(actual.getBytes(java.nio.charset.StandardCharsets.UTF_8), expected.getBytes(java.nio.charset.StandardCharsets.UTF_8)); } catch (Exception e) { return false; } }
        @JavascriptInterface public void scheduleSummonsReminder(String id, String studentName, long appointmentMillis) {
            long reminderMillis = appointmentMillis - 24L * 60L * 60L * 1000L;
            scheduleSummonsReminderAt(id, studentName, reminderMillis, appointmentMillis);
        }
        @JavascriptInterface public void scheduleSummonsReminderAt(String id, String studentName, long reminderMillis, long appointmentMillis) {
            if (id == null || studentName == null || reminderMillis <= System.currentTimeMillis() || appointmentMillis <= reminderMillis) { cancelSummonsReminder(id); return; }
            getSharedPreferences("summons_reminders", MODE_PRIVATE).edit().putString(id, studentName + "|" + reminderMillis + "|" + appointmentMillis).apply();
            scheduleReminder(MainActivity.this, id, studentName, reminderMillis);
        }
        @JavascriptInterface public boolean hasExactAlarmAccess() {
            if (Build.VERSION.SDK_INT < 31) return true;
            AlarmManager alarms = (AlarmManager) getSystemService(ALARM_SERVICE);
            return alarms != null && alarms.canScheduleExactAlarms();
        }
        @JavascriptInterface public void requestNotificationPermission() {
            runOnUiThread(() -> {
                if (Build.VERSION.SDK_INT < 33) {
                    Toast.makeText(MainActivity.this, "إذن الإشعارات لا يحتاج طلباً منفصلاً على هذا الإصدار.", Toast.LENGTH_LONG).show();
                    return;
                }
                if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) {
                    Toast.makeText(MainActivity.this, "إذن الإشعارات ممنوح بالفعل.", Toast.LENGTH_SHORT).show();
                    return;
                }
                requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, NOTIFICATION_PERMISSION);
            });
        }
        @JavascriptInterface public void requestExactAlarmAccess() {
            runOnUiThread(() -> {
                if (Build.VERSION.SDK_INT < 31 || hasExactAlarmAccess()) {
                    Toast.makeText(MainActivity.this, "التنبيهات الدقيقة متاحة بالفعل.", Toast.LENGTH_SHORT).show();
                    return;
                }
                try {
                    Intent intent = new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM);
                    intent.setData(Uri.parse("package:" + getPackageName()));
                    startActivity(intent);
                } catch (Exception e) {
                    Toast.makeText(MainActivity.this, "تعذر فتح إعداد التنبيهات الدقيقة. افتح وصول خاص للتطبيقات يدوياً.", Toast.LENGTH_LONG).show();
                }
            });
        }
        @JavascriptInterface public void testSummonsNotification() {
            runOnUiThread(() -> {
                if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                    requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, NOTIFICATION_PERMISSION);
                    Toast.makeText(MainActivity.this, "اسمح بالإشعارات ثم اضغط اختبار التنبيه مرة أخرى.", Toast.LENGTH_LONG).show();
                    return;
                }
                boolean posted = SummonsReminderReceiver.postNotification(MainActivity.this, "mushrifi-test", "اختبار");
                Toast.makeText(MainActivity.this, posted ? "أُرسل الإشعار التجريبي. تحقق من شريط الإشعارات." : "تعذر إرسال الإشعار. تحقق من صلاحية الإشعارات.", Toast.LENGTH_LONG).show();
            });
        }
        @JavascriptInterface public void cancelSummonsReminder(String id) {
            if (id == null) return;
            getSharedPreferences("summons_reminders", MODE_PRIVATE).edit().remove(id).apply();
            cancelReminder(MainActivity.this, id);
        }
        @JavascriptInterface public void clearSummonsReminders() {
            android.content.SharedPreferences prefs = getSharedPreferences("summons_reminders", MODE_PRIVATE);
            for (String id : prefs.getAll().keySet()) cancelReminder(MainActivity.this, id);
            prefs.edit().clear().apply();
        }
        @JavascriptInterface public void pickBackupFile() {
            runOnUiThread(() -> {
                try {
                    Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                    intent.addCategory(Intent.CATEGORY_OPENABLE);
                    intent.setType("*/*");
                    intent.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"application/json", "text/plain", "application/octet-stream"});
                    startActivityForResult(intent, PICK_BACKUP_NATIVE);
                } catch (Exception e) {
                    Toast.makeText(MainActivity.this, "تعذر فتح مدير الملفات", Toast.LENGTH_LONG).show();
                }
            });
        }
        @JavascriptInterface public void saveBackup(String json) {
            runOnUiThread(() -> {
                pendingBackup = json;
                Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("application/json");
                intent.putExtra(Intent.EXTRA_TITLE, "mushrifi-backup.json");
                startActivityForResult(intent, SAVE_FILE);
            });
        }
        @JavascriptInterface public void startArabicSpeech() {
            runOnUiThread(() -> {
                if (speechPending) return;
                try {
                    Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
                    intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
                    intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, "ar-DZ");
                    intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, "ar-DZ");
                    intent.putExtra(RecognizerIntent.EXTRA_PROMPT, "تحدث الآن بالعربية");
                    speechPending = true;
                    startActivityForResult(intent, SPEECH_REQUEST);
                } catch (Exception e) {
                    speechPending = false;
                    Toast.makeText(MainActivity.this, "خدمة التعرف على الصوت غير متاحة. تحقق من تثبيت خدمة Google للتحدث.", Toast.LENGTH_LONG).show();
                }
            });
        }
    }


    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "تذكير استدعاء ولي", NotificationManager.IMPORTANCE_HIGH);
            channel.setDescription("تنبيه قبل موعد حضور ولي التلميذ بيوم واحد");
            getSystemService(NotificationManager.class).createNotificationChannel(channel);
        }
    }

    static void cancelReminder(Context context, String id) {
        if (id == null) return;
        Intent intent = new Intent(context, SummonsReminderReceiver.class);
        PendingIntent pending = PendingIntent.getBroadcast(context, id.hashCode(), intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        AlarmManager alarms = (AlarmManager) context.getSystemService(ALARM_SERVICE);
        if (alarms != null) alarms.cancel(pending);
        pending.cancel();
    }

    static void scheduleReminder(Context context, String id, String studentName, long reminderMillis) {
        if (reminderMillis <= System.currentTimeMillis()) { cancelReminder(context, id); return; }
        Intent intent = new Intent(context, SummonsReminderReceiver.class);
        intent.putExtra("student", studentName);
        intent.putExtra("id", id);
        PendingIntent pending = PendingIntent.getBroadcast(context, id.hashCode(), intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        AlarmManager alarms = (AlarmManager) context.getSystemService(ALARM_SERVICE);
        if (alarms != null) {
            if (Build.VERSION.SDK_INT >= 31 && alarms.canScheduleExactAlarms()) {
                try {
                    alarms.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, reminderMillis, pending);
                } catch (SecurityException e) {
                    alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, reminderMillis, pending);
                }
            } else {
                alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, reminderMillis, pending);
            }
        }
    }

    private void rescheduleStoredReminders() {
        android.content.SharedPreferences prefs = getSharedPreferences("summons_reminders", MODE_PRIVATE);
        for (String id : new java.util.HashSet<>(prefs.getAll().keySet())) {
            String value = prefs.getString(id, "");
            String[] parts = value.split("\\|", 3);
            if (parts.length != 2 && parts.length != 3) { prefs.edit().remove(id).apply(); continue; }
            try {
                long reminder = parts.length == 2 ? Long.parseLong(parts[1]) - 24L * 60L * 60L * 1000L : Long.parseLong(parts[1]);
                if (reminder <= System.currentTimeMillis()) {
                    cancelReminder(this, id);
                    prefs.edit().remove(id).apply();
                } else {
                    scheduleReminder(this, id, parts[0], reminder);
                }
            } catch (NumberFormatException ignored) { prefs.edit().remove(id).apply(); }
        }
    }

    @Override protected void onResume() {
        super.onResume();
        rescheduleStoredReminders();
    }

    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == SPEECH_REQUEST) {
            speechPending = false;
            if (resultCode == RESULT_OK && data != null) {
                java.util.ArrayList<String> results = data.getStringArrayListExtra("android.speech.extra.RESULTS");
                if (results != null && !results.isEmpty()) {
                    String spoken = results.get(0);
                    web.evaluateJavascript("window.onArabicSpeechResult && window.onArabicSpeechResult(" + org.json.JSONObject.quote(spoken) + ");", null);
                } else web.evaluateJavascript("document.getElementById('voiceStatus').textContent='لم يتم التقاط الكلام. حاول مرة أخرى.';", null);
            } else web.evaluateJavascript("document.getElementById('voiceStatus').textContent='تم إلغاء التحدث.';", null);
        } else if (requestCode == PICK_BACKUP_NATIVE) {
            if (resultCode == RESULT_OK && data != null && data.getData() != null) {
                try (java.io.InputStream in = getContentResolver().openInputStream(data.getData());
                     java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream()) {
                    if (in == null) throw new IOException("تعذر فتح الملف المحدد");
                    byte[] buffer = new byte[8192]; int n;
                    while ((n = in.read(buffer)) != -1) out.write(buffer, 0, n);
                    byte[] bytes = out.toByteArray();
                    if (bytes.length == 0) throw new IOException("الملف المحدد فارغ فعلياً");
                    String json = new String(bytes, java.nio.charset.StandardCharsets.UTF_8);
                    String quoted = org.json.JSONObject.quote(json);
                    web.evaluateJavascript("(function(){if(typeof window.onNativeBackupLoaded!=='function'){if(window.onNativeBackupLoadStatus)window.onNativeBackupLoadStatus('تم اختيار الملف لكن صفحة الاستيراد لم تجهز بعد. أعد فتح التطبيق وحاول مجدداً.');return;}window.onNativeBackupLoaded(" + quoted + ");})()", null);
                } catch (Exception e) {
                    String message = "تعذرت قراءة ملف النسخة: " + e.getMessage();
                    web.evaluateJavascript("if(window.onNativeBackupLoadStatus)window.onNativeBackupLoadStatus(" + org.json.JSONObject.quote(message) + ");", null);
                    Toast.makeText(this, message, Toast.LENGTH_LONG).show();
                }
            } else {
                web.evaluateJavascript("if(window.onNativeBackupLoadStatus)window.onNativeBackupLoadStatus('لم يتم اختيار ملف؛ لم تتغير البيانات.');", null);
            }
        } else if (requestCode == PICK_FILE && fileCallback != null) {
            Uri[] result = resultCode == RESULT_OK ? WebChromeClient.FileChooserParams.parseResult(resultCode, data) : null;
            fileCallback.onReceiveValue(result);
            fileCallback = null;
        } else if (requestCode == SAVE_FILE) {
            if (resultCode == RESULT_OK && data != null && data.getData() != null && pendingBackup != null) {
                try {
                    byte[] bytes = pendingBackup.getBytes(java.nio.charset.StandardCharsets.UTF_8);
                    if (bytes.length < 2 || pendingBackup.trim().isEmpty()) throw new IOException("بيانات النسخة فارغة");
                    try (OutputStream out = getContentResolver().openOutputStream(data.getData(), "wt")) {
                        if (out == null) throw new IOException("تعذر فتح الملف للكتابة");
                        out.write(bytes);
                        out.flush();
                    }
                    long written = 0;
                    try (java.io.InputStream in = getContentResolver().openInputStream(data.getData())) {
                        if (in == null) throw new IOException("تعذر التحقق من الملف بعد الحفظ");
                        byte[] buffer = new byte[8192]; int n;
                        while ((n = in.read(buffer)) != -1) written += n;
                    }
                    if (written != bytes.length) throw new IOException("حجم الملف المحفوظ لا يطابق البيانات المصدّرة");
                    Toast.makeText(this, "تم حفظ النسخة الاحتياطية والتحقق منها (" + written + " بايت)", Toast.LENGTH_LONG).show();
                } catch (Exception e) { Toast.makeText(this, "فشل حفظ النسخة الاحتياطية: " + e.getMessage(), Toast.LENGTH_LONG).show(); }
            } else if (resultCode != RESULT_OK) {
                Toast.makeText(this, "تم إلغاء حفظ النسخة الاحتياطية", Toast.LENGTH_SHORT).show();
            }
            pendingBackup = null;
        }
    }

    @Override protected void onStop() { super.onStop(); }

    @Override public void onBackPressed() {
        if (web != null && web.canGoBack()) web.goBack(); else super.onBackPressed();
    }
}
