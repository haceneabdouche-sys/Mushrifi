package dz.mushrifi.app;

import android.app.Activity;
import android.app.AlertDialog;
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
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.widget.Toast;
import android.widget.EditText;
import android.text.InputType;
import android.webkit.JsPromptResult;
import java.io.OutputStream;
import java.io.IOException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

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
    private boolean webPageReady;
    private String pendingAgendaNotificationId;
    private String pendingAgendaNotificationDate;
    private final ExecutorService licenseExecutor = Executors.newSingleThreadExecutor();
    private final ExecutorService databaseHealthExecutor = Executors.newSingleThreadExecutor();

    /**
     * The Android JavaScript bridge is intended only for the packaged Mushrifi page.
     * Keep that exact asset loaded in the WebView; send approved HTTPS navigation to
     * an external browser/app so remote documents never share the bridge context.
     */
    private boolean handleWebViewNavigation(String rawUrl) {
        if (WebViewNavigationPolicy.isTrustedAppPage(rawUrl)) return false;
        if (!WebViewNavigationPolicy.isAllowedExternalHttps(rawUrl)) return true;
        try {
            Intent external = new Intent(Intent.ACTION_VIEW, Uri.parse(rawUrl));
            external.addCategory(Intent.CATEGORY_BROWSABLE);
            startActivity(external);
        } catch (Exception error) {
            Toast.makeText(this, "تعذر فتح الرابط الخارجي. تحقق من وجود متصفح أو تطبيق مناسب.", Toast.LENGTH_LONG).show();
        }
        return true;
    }

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
        // Keep packaged assets and the Storage Access Framework working, but do not
        // let file-origin scripts read arbitrary file URLs or make universal requests.
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) settings.setSafeBrowsingEnabled(true);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setSupportMultipleWindows(false);
        web.addJavascriptInterface(new AndroidBridge(), "AndroidBridge");
        captureAgendaNotificationIntent(getIntent());
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return handleWebViewNavigation(request == null ? null : request.getUrl().toString());
            }

            @Override public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return handleWebViewNavigation(url);
            }

            @Override public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                webPageReady = true;
                dispatchPendingAgendaNotification();
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onJsPrompt(WebView view, String url, String message, String defaultValue, JsPromptResult result) {
                EditText input = new EditText(MainActivity.this);
                input.setSingleLine(true);
                input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_SENTENCES);
                if (defaultValue != null) input.setText(defaultValue);
                new AlertDialog.Builder(MainActivity.this)
                    .setTitle("تأكيد استعادة النسخة الاحتياطية")
                    .setMessage(message)
                    .setView(input)
                    .setPositiveButton("تأكيد", (dialog, which) -> result.confirm(input.getText().toString()))
                    .setNegativeButton("إلغاء", (dialog, which) -> result.cancel())
                    .setOnCancelListener(dialog -> result.cancel())
                    .show();
                return true;
            }

            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                try {
                    // Use the Storage Access Framework directly. Some Android file
                    // providers hide CSV files when WebView's inferred MIME filter is used.
                    Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                    intent.addCategory(Intent.CATEGORY_OPENABLE);
                    intent.setType("*/*");
                    intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
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
        if (Build.VERSION.SDK_INT >= 33) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT,
                () -> handleAppBack()
            );
        }
    }

    private static boolean hasDataEncryptionKey() throws Exception {
        KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
        ks.load(null);
        return ks.containsAlias("mushrifi_data_key");
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
        private final Context databaseContext;
        LocalDb(Context c) {
            super(c, "mushrifi_local.db", null, 2);
            databaseContext = c.getApplicationContext() != null ? c.getApplicationContext() : c;
        }
        @Override public void onCreate(SQLiteDatabase db) { db.execSQL("CREATE TABLE appdata (id INTEGER PRIMARY KEY CHECK(id=1), json TEXT NOT NULL)"); ensureRecoveryTable(db); }
        @Override public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) {
            // Additive migration only: preserve appdata and any existing recovery row.
            ensureRecoveryTable(db);
        }
        private void ensureRecoveryTable(SQLiteDatabase db) { db.execSQL("CREATE TABLE IF NOT EXISTS recovery_snapshot (id INTEGER PRIMARY KEY CHECK(id=1), json TEXT NOT NULL, updated_at INTEGER NOT NULL)"); }
        synchronized String read() { try (Cursor c = getReadableDatabase().rawQuery("SELECT json FROM appdata WHERE id=1", null)) { return c.moveToFirst() ? decryptData(c.getString(0)) : null; } catch (Exception e) { return "!MUSHRIFI_DB_ERROR!"; } }
        private String lastError = "";
        synchronized String getLastError() { return lastError; }
        synchronized boolean write(String json) {
            SQLiteDatabase database = null;
            boolean transactionStarted = false;
            boolean saved = false;
            try {
                if (json == null) {
                    throw new IOException("بيانات الحفظ فارغة.");
                }

                // Encrypt before opening the transaction. Any encryption/key failure
                // therefore leaves the currently stored row untouched.
                String encryptedJson = encryptData(json);
                database = getWritableDatabase();
                database.beginTransaction();
                transactionStarted = true;

                android.content.ContentValues values = new android.content.ContentValues();
                values.put("id", 1);
                values.put("json", encryptedJson);
                long result = database.insertWithOnConflict(
                    "appdata", null, values, SQLiteDatabase.CONFLICT_REPLACE
                );
                if (result == -1) {
                    throw new IOException("SQLite لم يقبل حفظ السجل (insertWithOnConflict أعاد -1).");
                }

                // Do not report success until the stored ciphertext can be read,
                // authenticated by AES-GCM decryption, and compared byte-for-byte
                // with the exact JSON submitted by the application.
                String verifiedJson = null;
                try (Cursor cursor = database.rawQuery("SELECT json FROM appdata WHERE id=1", null)) {
                    if (cursor.moveToFirst()) {
                        verifiedJson = decryptData(cursor.getString(0));
                    }
                }
                if (!json.equals(verifiedJson)) {
                    throw new IOException("فشل التحقق من قاعدة البيانات بعد الحفظ؛ أُلغيت المعاملة.");
                }

                database.setTransactionSuccessful();
                saved = true;
            } catch (Exception error) {
                lastError = error.getClass().getSimpleName() + ": " + String.valueOf(error.getMessage());
                android.util.Log.e("MushrifiDB", "Verified database write failed; transaction will roll back", error);
            } finally {
                if (transactionStarted && database != null) {
                    try {
                        // Without setTransactionSuccessful(), SQLite rolls the old row back in.
                        database.endTransaction();
                    } catch (Exception error) {
                        saved = false;
                        lastError = error.getClass().getSimpleName() + ": " + String.valueOf(error.getMessage());
                        android.util.Log.e("MushrifiDB", "Database write transaction could not finish", error);
                    }
                }
            }

            if (saved) lastError = "";
            return saved;
        }
        synchronized boolean restoreSafely(String json) {
            SQLiteDatabase database = null;
            boolean transactionStarted = false;
            boolean restored = false;
            try {
                if (json == null || json.trim().isEmpty()) {
                    throw new IOException("بيانات الاستعادة فارغة.");
                }
                // Validate the database envelope again at the native storage boundary.
                org.json.JSONObject replacement = new org.json.JSONObject(json);
                for (String key : new String[]{"students", "attendance", "documents", "violations"}) {
                    if (!(replacement.opt(key) instanceof org.json.JSONArray)) {
                        throw new IOException("قائمة البيانات غير صالحة: " + key);
                    }
                }
                for (String key : new String[]{"agenda", "followups", "auditLog"}) {
                    if (replacement.has(key) && !(replacement.opt(key) instanceof org.json.JSONArray)) {
                        throw new IOException("قائمة البيانات غير صالحة: " + key);
                    }
                }
                if (!(replacement.opt("settings") instanceof org.json.JSONObject)) {
                    throw new IOException("إعدادات قاعدة البيانات غير صالحة.");
                }
                for (String key : new String[]{"students", "attendance", "documents", "violations", "agenda", "followups", "auditLog"}) {
                    org.json.JSONArray records = replacement.optJSONArray(key);
                    if (records == null) continue;
                    for (int i = 0; i < records.length(); i++) {
                        if (!(records.opt(i) instanceof org.json.JSONObject)) {
                            throw new IOException("يوجد سجل غير صالح داخل القائمة: " + key);
                        }
                    }
                }

                database = getWritableDatabase();
                ensureRecoveryTable(database);
                database.beginTransaction();
                transactionStarted = true;

                // Keep the JS-created encrypted undo snapshot intact. It is deliberately
                // not overwritten by a raw database payload, because the app's Undo UI
                // expects the versioned snapshot envelope.
                String recoverySnapshot = null;
                try (Cursor cursor = database.rawQuery("SELECT json FROM recovery_snapshot WHERE id=1", null)) {
                    if (cursor.moveToFirst()) recoverySnapshot = decryptData(cursor.getString(0));
                }
                if (recoverySnapshot == null || recoverySnapshot.trim().isEmpty()) {
                    throw new IOException("لم يتم العثور على نقطة الاسترجاع المشفّرة قبل الاستعادة.");
                }
                org.json.JSONObject recoveryEnvelope = new org.json.JSONObject(recoverySnapshot);
                if (recoveryEnvelope.optInt("version", -1) != 1
                    || !(recoveryEnvelope.opt("database") instanceof org.json.JSONObject)) {
                    throw new IOException("نقطة الاسترجاع المشفّرة غير مكتملة؛ أُوقفت العملية دون استبدال البيانات.");
                }

                android.content.ContentValues values = new android.content.ContentValues();
                values.put("id", 1);
                values.put("json", encryptData(json));
                long row = database.insertWithOnConflict("appdata", null, values, SQLiteDatabase.CONFLICT_REPLACE);
                if (row == -1) {
                    throw new IOException("SQLite لم يقبل كتابة قاعدة البيانات المستعادة.");
                }

                String verifiedJson = null;
                try (Cursor cursor = database.rawQuery("SELECT json FROM appdata WHERE id=1", null)) {
                    if (cursor.moveToFirst()) verifiedJson = decryptData(cursor.getString(0));
                }
                if (!json.equals(verifiedJson)) {
                    throw new IOException("فشل التحقق من قراءة البيانات بعد كتابتها؛ أُلغيت المعاملة.");
                }

                database.setTransactionSuccessful();
                restored = true;
                lastError = "";
            } catch (Exception error) {
                restored = false;
                lastError = error.getClass().getSimpleName() + ": " + String.valueOf(error.getMessage());
                android.util.Log.e("MushrifiDB", "Safe restore transaction failed", error);
            } finally {
                if (transactionStarted && database != null) {
                    try {
                        database.endTransaction();
                    } catch (Exception error) {
                        restored = false;
                        lastError = error.getClass().getSimpleName() + ": " + String.valueOf(error.getMessage());
                        android.util.Log.e("MushrifiDB", "Safe restore transaction could not finish", error);
                    }
                }
            }
            return restored;
        }
        private void validateRecoverySnapshotJson(String json) throws Exception {
            if (json == null || json.trim().isEmpty()) {
                throw new IOException("نقطة التراجع فارغة.");
            }
            org.json.JSONObject envelope = new org.json.JSONObject(json);
            if (envelope.optInt("version", -1) != 1
                || !(envelope.opt("database") instanceof org.json.JSONObject)) {
                throw new IOException("صيغة نقطة التراجع أو إصدارها غير صالح.");
            }
            org.json.JSONObject snapshotDatabase = envelope.getJSONObject("database");
            for (String key : new String[]{"students", "attendance", "documents", "violations"}) {
                if (!(snapshotDatabase.opt(key) instanceof org.json.JSONArray)) {
                    throw new IOException("قائمة نقطة التراجع غير صالحة: " + key);
                }
            }
            if (!(snapshotDatabase.opt("settings") instanceof org.json.JSONObject)) {
                throw new IOException("إعدادات نقطة التراجع غير صالحة.");
            }
            for (String key : new String[]{"agenda", "followups", "auditLog"}) {
                if (snapshotDatabase.has(key) && !(snapshotDatabase.opt(key) instanceof org.json.JSONArray)) {
                    throw new IOException("قائمة نقطة التراجع غير صالحة: " + key);
                }
            }
            for (String key : new String[]{"students", "attendance", "documents", "violations", "agenda", "followups", "auditLog"}) {
                org.json.JSONArray records = snapshotDatabase.optJSONArray(key);
                if (records == null) continue;
                for (int i = 0; i < records.length(); i++) {
                    if (!(records.opt(i) instanceof org.json.JSONObject)) {
                        throw new IOException("يحتوي سجل نقطة التراجع على عنصر غير صالح: " + key);
                    }
                }
            }
        }

        synchronized boolean saveRecoverySnapshot(String json) {
            SQLiteDatabase database = null;
            boolean transactionStarted = false;
            boolean saved = false;
            try {
                // Validate and encrypt before touching the existing recovery point.
                validateRecoverySnapshotJson(json);
                String encryptedJson = encryptData(json);
                database = getWritableDatabase();
                ensureRecoveryTable(database);
                database.beginTransaction();
                transactionStarted = true;

                android.content.ContentValues values = new android.content.ContentValues();
                values.put("id", 1);
                values.put("json", encryptedJson);
                values.put("updated_at", System.currentTimeMillis());
                long row = database.insertWithOnConflict(
                    "recovery_snapshot", null, values, SQLiteDatabase.CONFLICT_REPLACE
                );
                if (row == -1) {
                    throw new IOException("SQLite لم يقبل حفظ نقطة التراجع.");
                }

                String verifiedJson = null;
                try (Cursor cursor = database.rawQuery("SELECT json FROM recovery_snapshot WHERE id=1", null)) {
                    if (cursor.moveToFirst()) verifiedJson = decryptData(cursor.getString(0));
                }
                validateRecoverySnapshotJson(verifiedJson);
                if (!json.equals(verifiedJson)) {
                    throw new IOException("فشل التحقق من نقطة التراجع بعد الحفظ؛ أُبقيت النقطة السابقة.");
                }

                database.setTransactionSuccessful();
                saved = true;
            } catch (Exception error) {
                lastError = error.getClass().getSimpleName() + ": " + String.valueOf(error.getMessage());
                android.util.Log.e("MushrifiDB", "Verified recovery snapshot write failed; transaction will roll back", error);
            } finally {
                if (transactionStarted && database != null) {
                    try {
                        // A failed save has no successful marker, so SQLite restores the previous snapshot.
                        database.endTransaction();
                    } catch (Exception error) {
                        saved = false;
                        lastError = error.getClass().getSimpleName() + ": " + String.valueOf(error.getMessage());
                        android.util.Log.e("MushrifiDB", "Recovery snapshot write transaction could not finish", error);
                    }
                }
            }
            if (saved) lastError = "";
            return saved;
        }

        synchronized String readRecoverySnapshot() {
            try {
                // Version 2 migration ensures the table exists; reading does not create or modify it.
                SQLiteDatabase database = getReadableDatabase();
                try (Cursor cursor = database.rawQuery("SELECT json FROM recovery_snapshot WHERE id=1", null)) {
                    if (!cursor.moveToFirst()) {
                        lastError = "";
                        return null;
                    }
                    String json = decryptData(cursor.getString(0));
                    validateRecoverySnapshotJson(json);
                    lastError = "";
                    return json;
                }
            } catch (Exception error) {
                lastError = error.getClass().getSimpleName() + ": " + String.valueOf(error.getMessage());
                android.util.Log.e("MushrifiDB", "Recovery snapshot read or validation failed", error);
                return null;
            }
        }

        synchronized boolean clearRecoverySnapshot() {
            SQLiteDatabase database = null;
            boolean transactionStarted = false;
            boolean cleared = false;
            try {
                database = getWritableDatabase();
                ensureRecoveryTable(database);
                database.beginTransaction();
                transactionStarted = true;

                database.delete("recovery_snapshot", "id=1", null);
                try (Cursor cursor = database.rawQuery("SELECT 1 FROM recovery_snapshot WHERE id=1", null)) {
                    if (cursor.moveToFirst()) {
                        throw new IOException("تعذر تأكيد حذف نقطة التراجع.");
                    }
                }

                database.setTransactionSuccessful();
                cleared = true;
            } catch (Exception error) {
                lastError = error.getClass().getSimpleName() + ": " + String.valueOf(error.getMessage());
                android.util.Log.e("MushrifiDB", "Recovery snapshot clear failed; transaction will roll back", error);
            } finally {
                if (transactionStarted && database != null) {
                    try {
                        database.endTransaction();
                    } catch (Exception error) {
                        cleared = false;
                        lastError = error.getClass().getSimpleName() + ": " + String.valueOf(error.getMessage());
                        android.util.Log.e("MushrifiDB", "Recovery snapshot clear transaction could not finish", error);
                    }
                }
            }
            if (cleared) lastError = "";
            return cleared;
        }

        private boolean hasExpectedColumns(SQLiteDatabase database, String table, String[] expected) {
            java.util.HashSet<String> columns = new java.util.HashSet<>();
            try (Cursor cursor = database.rawQuery("PRAGMA table_info(" + table + ")", null)) {
                int nameColumn = cursor.getColumnIndex("name");
                if (nameColumn < 0) return false;
                while (cursor.moveToNext()) columns.add(cursor.getString(nameColumn));
            }
            return columns.containsAll(java.util.Arrays.asList(expected));
        }

        private void validateApplicationDatabaseJson(String json) throws Exception {
            if (json == null || json.trim().isEmpty()) throw new IOException("سجل البيانات الرئيسي فارغ.");
            org.json.JSONObject data = new org.json.JSONObject(json);
            for (String key : new String[]{"students", "attendance", "documents", "violations"}) {
                if (!(data.opt(key) instanceof org.json.JSONArray)) {
                    throw new IOException("قائمة البيانات الأساسية غير صالحة: " + key);
                }
            }
            for (String key : new String[]{"agenda", "followups", "auditLog"}) {
                if (data.has(key) && !(data.opt(key) instanceof org.json.JSONArray)) {
                    throw new IOException("قائمة البيانات الاختيارية غير صالحة: " + key);
                }
            }
            if (!(data.opt("settings") instanceof org.json.JSONObject)) {
                throw new IOException("إعدادات قاعدة البيانات غير صالحة.");
            }
            for (String key : new String[]{"students", "attendance", "documents", "violations", "agenda", "followups", "auditLog"}) {
                org.json.JSONArray records = data.optJSONArray(key);
                if (records == null) continue;
                for (int i = 0; i < records.length(); i++) {
                    if (!(records.opt(i) instanceof org.json.JSONObject)) {
                        throw new IOException("يوجد سجل غير صالح داخل القائمة: " + key);
                    }
                }
            }
        }

        /**
         * Non-destructive health inspection. Opens the existing database directly
         * with OPEN_READONLY, so this diagnostic never creates or migrates a database.
         */
        synchronized String inspectHealth() {
            org.json.JSONObject report = new org.json.JSONObject();
            org.json.JSONObject checks = new org.json.JSONObject();
            SQLiteDatabase database = null;
            boolean warning = false;
            try {
                report.put("readOnly", true);
                report.put("checkedAt", System.currentTimeMillis());
                java.io.File databaseFile = databaseContext.getDatabasePath("mushrifi_local.db");
                if (databaseFile == null || !databaseFile.isFile() || databaseFile.length() == 0) {
                    throw new IOException("ملف قاعدة البيانات غير موجود أو فارغ؛ لم ينشئ الفحص ملفاً بديلاً.");
                }
                database = SQLiteDatabase.openDatabase(
                    databaseFile.getAbsolutePath(), null, SQLiteDatabase.OPEN_READONLY
                );

                boolean integrityResultFound = false;
                try (Cursor cursor = database.rawQuery("PRAGMA quick_check(1)", null)) {
                    while (cursor.moveToNext()) {
                        integrityResultFound = true;
                        String integrity = cursor.getString(0);
                        if (!"ok".equalsIgnoreCase(integrity)) {
                            throw new IOException("أبلغ SQLite عن خلل في سلامة الملف.");
                        }
                    }
                }
                if (!integrityResultFound) throw new IOException("لم يُرجع SQLite نتيجة لفحص سلامة الملف.");
                checks.put("sqlite", "ok");

                if (!hasExpectedColumns(database, "appdata", new String[]{"id", "json"})) {
                    throw new IOException("بنية جدول البيانات الرئيسي غير مكتملة.");
                }
                checks.put("schema", "ok");

                String dataState = "empty";
                boolean keyAvailable = hasDataEncryptionKey();
                try (Cursor cursor = database.rawQuery("SELECT id, json FROM appdata", null)) {
                    if (cursor.moveToFirst()) {
                        int rowId = cursor.getInt(0);
                        String stored = cursor.getString(1);
                        if (rowId != 1 || stored == null || stored.trim().isEmpty() || cursor.moveToNext()) {
                            throw new IOException("سجل قاعدة البيانات الرئيسي مفقود أو مكرر أو غير صالح.");
                        }
                        if (stored.startsWith("enc:") && !keyAvailable) {
                            throw new IOException("مفتاح تشفير البيانات غير متاح؛ أوقف الفحص دون إنشاء مفتاح بديل.");
                        }
                        validateApplicationDatabaseJson(decryptData(stored));
                        dataState = "valid";
                    }
                }
                checks.put("data", dataState);
                if ("empty".equals(dataState)) warning = true;

                String recoveryState = "absent";
                if (hasExpectedColumns(database, "recovery_snapshot", new String[]{"id", "json", "updated_at"})) {
                    try (Cursor cursor = database.rawQuery("SELECT id, json FROM recovery_snapshot", null)) {
                        if (cursor.moveToFirst()) {
                            int rowId = cursor.getInt(0);
                            String stored = cursor.getString(1);
                            if (rowId != 1 || stored == null || stored.trim().isEmpty() || cursor.moveToNext()) {
                                recoveryState = "invalid";
                            } else if (stored.startsWith("enc:") && !keyAvailable) {
                                recoveryState = "unreadable";
                            } else {
                                try {
                                    validateRecoverySnapshotJson(decryptData(stored));
                                    recoveryState = "valid";
                                } catch (Exception invalidSnapshot) {
                                    recoveryState = "invalid";
                                }
                            }
                        }
                    }
                } else {
                    recoveryState = "unavailable";
                    warning = true;
                }
                if ("invalid".equals(recoveryState) || "unreadable".equals(recoveryState)) warning = true;
                checks.put("recovery", recoveryState);

                report.put("checks", checks);
                report.put("status", warning ? "warning" : "healthy");
                report.put("message", warning
                    ? "اجتاز ملف SQLite الفحص الأساسي، لكن توجد ملاحظة على السجل الرئيسي أو نقطة التراجع. احتفظ بنسخة احتياطية ولا تحذف التطبيق."
                    : "اجتازت قاعدة البيانات فحص SQLite والتحقق من بنية البيانات والتشفير. لم يُعدّل الفحص أي سجل.");
            } catch (Exception error) {
                android.util.Log.e("MushrifiDB", "Read-only database health inspection failed", error);
                try {
                    report.put("checks", checks);
                    report.put("status", "error");
                    report.put("message", "تعذر إكمال فحص قاعدة البيانات. لم يُجرِ الفحص أي إصلاح أو حذف. لا تحذف التطبيق ولا تمسح بياناته واحتفظ بالنسخ الاحتياطية.");
                } catch (org.json.JSONException ignored) {}
            } finally {
                if (database != null && database.isOpen()) {
                    try { database.close(); }
                    catch (Exception closeError) {
                        android.util.Log.w("MushrifiDB", "Read-only health database close failed", closeError);
                    }
                }
            }
            return report.toString();
        }
    }
    private LocalDb localDb;
    private android.content.SharedPreferences securityPrefs;
    private static String derive(String password, byte[] salt) throws Exception { PBEKeySpec spec = new PBEKeySpec(password.toCharArray(), salt, 150000, 256); try { return Base64.encodeToString(SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).getEncoded(), Base64.NO_WRAP); } finally { spec.clearPassword(); } }
    public class AndroidBridge {
        @JavascriptInterface public boolean openGuardianWhatsApp(String phone, String message) {
            String digits = phone == null ? "" : phone.replaceAll("[^0-9]", "");
            if (digits.startsWith("00")) digits = digits.substring(2);
            if (digits.startsWith("0")) digits = "213" + digits.substring(1);
            else if (digits.length() == 9) digits = "213" + digits;
            if (!digits.matches("[0-9]{8,15}") || message == null || message.trim().isEmpty() || message.length() > 1000) {
                Toast.makeText(MainActivity.this, "رقم هاتف الولي أو نص الرسالة غير صالح.", Toast.LENGTH_LONG).show(); return false;
            }
            final String safePhone = digits, safeMessage = message;
            runOnUiThread(() -> {
                try { Uri uri = new Uri.Builder().scheme("https").authority("wa.me").appendPath(safePhone).appendQueryParameter("text", safeMessage).build();
                    startActivity(new Intent(Intent.ACTION_VIEW, uri));
                } catch (Exception e) { Toast.makeText(MainActivity.this, "تعذر فتح واتساب. تحقق من تثبيته أو افتح الرابط في المتصفح.", Toast.LENGTH_LONG).show(); }
            }); return true;
        }
        @JavascriptInterface public void openWhatsAppSupport() {
            try { Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse("https://wa.me/213699251551")); startActivity(intent); }
            catch (Exception e) { Toast.makeText(MainActivity.this, "تعذر فتح واتساب. تحقق من تثبيته أو افتح الرابط في المتصفح.", Toast.LENGTH_LONG).show(); }
        }
        @JavascriptInterface public String getLicenseStatus() {
            try { return LicenseManager.status(MainActivity.this).toString(); }
            catch (Exception e) {
                org.json.JSONObject failure = new org.json.JSONObject();
                try { failure.put("hasLicense", LicenseManager.hasStoredLicense(MainActivity.this))
                    .put("activated", false)
                    .put("message", e.getMessage() == null ? "تعذر قراءة حالة الترخيص" : e.getMessage()); }
                catch (org.json.JSONException ignored) {}
                return failure.toString();
            }
        }
        @JavascriptInterface public void activateLicense(String activationCode, String callbackId) {
            if (activationCode == null || callbackId == null) return;
            licenseExecutor.execute(() -> {
                org.json.JSONObject result;
                try { result = LicenseManager.activate(MainActivity.this, activationCode); }
                catch (Exception e) { result = new org.json.JSONObject(); try { result.put("ok", false).put("error", e.getMessage() == null ? "فشل التفعيل" : e.getMessage()); } catch (Exception ignored) {} }
                deliverLicenseResult(callbackId, result);
            });
        }
        @JavascriptInterface public void validateLicense(String callbackId) {
            if (callbackId == null) return;
            licenseExecutor.execute(() -> {
                org.json.JSONObject result;
                try { result = LicenseManager.validate(MainActivity.this); }
                catch (Exception e) { result = new org.json.JSONObject(); try { result.put("ok", false).put("error", e.getMessage() == null ? "فشل التحقق" : e.getMessage()); } catch (Exception ignored) {} }
                deliverLicenseResult(callbackId, result);
            });
        }
        private void deliverLicenseResult(String callbackId, org.json.JSONObject result) {
            String script = "window.onMushrifiLicenseResult && window.onMushrifiLicenseResult("
                + org.json.JSONObject.quote(callbackId) + "," + result.toString() + ");";
            runOnUiThread(() -> { if (web != null) web.evaluateJavascript(script, null); });
        }
        @JavascriptInterface public String sha256Utf8(String value) {
            try { return BackupIntegrity.sha256Hex(value); }
            catch (Exception error) {
                android.util.Log.e("MushrifiBackup", "SHA-256 calculation failed", error);
                return "";
            }
        }
        @JavascriptInterface public boolean restoreDatabaseSafely(String json) {
            if (json == null || !LicenseManager.canWrite(MainActivity.this)) return false;
            return localDb.restoreSafely(json);
        }
        @JavascriptInterface public String loadDatabase() { return localDb.read(); }
        @JavascriptInterface public boolean canModifyData() { return LicenseManager.canWrite(MainActivity.this); }
        @JavascriptInterface public boolean saveDatabase(String json) {
            if (json == null || !LicenseManager.canWrite(MainActivity.this)) return false;
            return localDb.write(json);
        }
        @JavascriptInterface public long getLastVerifiedBackupTime() {
            return getSharedPreferences("mushrifi_backup_status", MODE_PRIVATE).getLong("last_verified_backup", 0L);
        }
        @JavascriptInterface public String getDatabaseError() { return localDb.getLastError(); }
        @JavascriptInterface public void inspectDatabaseHealth(String callbackId) {
            if (callbackId == null || callbackId.length() > 100) return;
            databaseHealthExecutor.execute(() -> {
                String result = localDb.inspectHealth();
                String script = "window.onMushrifiDatabaseHealth && window.onMushrifiDatabaseHealth("
                    + org.json.JSONObject.quote(callbackId) + "," + result + ");";
                runOnUiThread(() -> { if (web != null) web.evaluateJavascript(script, null); });
            });
        }
        @JavascriptInterface public boolean saveRecoverySnapshot(String json) {
            if (json == null || !LicenseManager.canWrite(MainActivity.this)) return false;
            return localDb.saveRecoverySnapshot(json);
        }
        @JavascriptInterface public String loadRecoverySnapshot() { return localDb.readRecoverySnapshot(); }
        @JavascriptInterface public boolean clearRecoverySnapshot() { if (!LicenseManager.canWrite(MainActivity.this)) return false; return localDb.clearRecoverySnapshot(); }
        @JavascriptInterface public boolean hasPassword() { return securityPrefs.contains("hash") && securityPrefs.contains("salt"); }
        @JavascriptInterface public boolean setPassword(String password) { if (password == null || password.length() < 6) return false; try { byte[] salt = new byte[16]; new SecureRandom().nextBytes(salt); securityPrefs.edit().putString("salt", Base64.encodeToString(salt, Base64.NO_WRAP)).putString("hash", derive(password, salt)).commit(); return hasPassword(); } catch (Exception e) { return false; } }
        @JavascriptInterface public boolean verifyPassword(String password) { if (!hasPassword() || password == null) return false; try { byte[] salt = Base64.decode(securityPrefs.getString("salt", ""), Base64.NO_WRAP); String actual = derive(password, salt), expected = securityPrefs.getString("hash", ""); return java.security.MessageDigest.isEqual(actual.getBytes(java.nio.charset.StandardCharsets.UTF_8), expected.getBytes(java.nio.charset.StandardCharsets.UTF_8)); } catch (Exception e) { return false; } }
        @JavascriptInterface public void scheduleSummonsReminder(String id, String studentName, long appointmentMillis) {
            long reminderMillis = appointmentMillis - 24L * 60L * 60L * 1000L;
            scheduleSummonsReminderAt(id, studentName, reminderMillis, appointmentMillis);
        }
        @JavascriptInterface public void scheduleSummonsReminderAt(String id, String studentName, long reminderMillis, long appointmentMillis) {
            if (id == null || studentName == null || reminderMillis <= System.currentTimeMillis()) { cancelSummonsReminder(id); return; }
            getSharedPreferences("summons_reminders", MODE_PRIVATE).edit().putString(id, studentName + "|" + reminderMillis + "|" + appointmentMillis).apply();
            scheduleReminder(MainActivity.this, id, studentName, reminderMillis);
        }
        @JavascriptInterface public String syncAgendaReminders(String payload) {
            try {
                return AgendaReminderScheduler.sync(MainActivity.this, payload).toString();
            } catch (Exception error) {
                android.util.Log.e("MushrifiAgenda", "Agenda reminder sync failed", error);
                org.json.JSONObject result = new org.json.JSONObject();
                try { result.put("ok", false).put("error", error.getMessage() == null ? "تعذر حفظ جدول التنبيهات" : error.getMessage()); }
                catch (org.json.JSONException ignored) {}
                return result.toString();
            }
        }
        @JavascriptInterface public String syncStudentFollowupReminders(String payload) {
            try {
                return StudentFollowupReminderScheduler.sync(MainActivity.this, payload).toString();
            } catch (Exception error) {
                android.util.Log.e("MushrifiFollowup", "Educational follow-up reminder sync failed", error);
                org.json.JSONObject result = new org.json.JSONObject();
                try { result.put("ok", false).put("error", error.getMessage() == null ? "تعذر مزامنة مواعيد المراجعة التربوية" : error.getMessage()); }
                catch (org.json.JSONException ignored) {}
                return result.toString();
            }
        }
        @JavascriptInterface public void testAgendaNotification() {
            runOnUiThread(() -> {
                if (!hasNotificationPermission()) {
                    if (Build.VERSION.SDK_INT >= 33) requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, NOTIFICATION_PERMISSION);
                    Toast.makeText(MainActivity.this, "اسمح بإشعارات مُشرِفي ثم اضغط اختبار الأجندة مرة أخرى.", Toast.LENGTH_LONG).show();
                    return;
                }
                boolean posted = AgendaReminderReceiver.postTestNotification(MainActivity.this);
                Toast.makeText(MainActivity.this, posted ? "أُرسل إشعار اختبار الأجندة. تحقق من شريط الإشعارات." : "تعذر إرسال اختبار الأجندة؛ تحقق من إعدادات قناة الإشعارات.", Toast.LENGTH_LONG).show();
            });
        }
        @JavascriptInterface public boolean hasNotificationPermission() {
            return Build.VERSION.SDK_INT < 33 || checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;
        }
        @JavascriptInterface public void requestNotificationPermission() {
            runOnUiThread(() -> {
                if (hasNotificationPermission()) {
                    Toast.makeText(MainActivity.this, "صلاحية الإشعارات مفعلة بالفعل.", Toast.LENGTH_SHORT).show();
                    notifyNotificationPermissionState(true);
                } else if (Build.VERSION.SDK_INT >= 33) {
                    requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, NOTIFICATION_PERMISSION);
                }
            });
        }
        @JavascriptInterface public boolean hasAgendaNotificationChannelEnabled() {
            return AgendaReminderScheduler.areAgendaNotificationsEnabled(MainActivity.this);
        }
        @JavascriptInterface public void openAgendaNotificationSettings() {
            runOnUiThread(() -> {
                Intent intent;
                if (Build.VERSION.SDK_INT >= 26) {
                    intent = new Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS);
                    intent.putExtra(Settings.EXTRA_APP_PACKAGE, getPackageName());
                    intent.putExtra(Settings.EXTRA_CHANNEL_ID, AgendaReminderScheduler.CHANNEL_ID);
                } else {
                    intent = new Intent("android.settings.APP_NOTIFICATION_SETTINGS");
                    intent.putExtra("app_package", getPackageName());
                    intent.putExtra("app_uid", getApplicationInfo().uid);
                }
                try {
                    startActivity(intent);
                } catch (Exception unavailable) {
                    Intent fallback = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                        android.net.Uri.parse("package:" + getPackageName()));
                    startActivity(fallback);
                }
            });
        }
        @JavascriptInterface public boolean hasExactAlarmAccess() {
            return exactAlarmAccessGranted();
        }
        @JavascriptInterface public void requestExactAlarmAccess() {
            runOnUiThread(() -> {
                if (exactAlarmAccessGranted()) {
                    notifyExactAlarmPermissionState();
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
        @JavascriptInterface public void notifyAbsenceStage(String studentId, String studentName, int stage, String absenceStart) {
            if (studentId == null || studentName == null || absenceStart == null || (stage != 4 && stage != 11 && stage != 18 && stage != 32)) return;
            runOnUiThread(() -> {
                if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return;
                String key = studentId + "|" + absenceStart + "|" + stage;
                android.content.SharedPreferences prefs = getSharedPreferences("absence_stage_notifications", MODE_PRIVATE);
                if (prefs.getBoolean(key, false)) return;
                boolean posted = SummonsReminderReceiver.postAbsenceStageNotification(MainActivity.this, key, studentName, stage);
                if (posted) prefs.edit().putBoolean(key, true).apply();
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
                    intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 5);
                    intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
                    intent.putExtra(RecognizerIntent.EXTRA_PROMPT, "انطق الاسم واللقب بوضوح، ويمكنك ذكر القسم");
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
            NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "إشعارات مُشرِفي", NotificationManager.IMPORTANCE_HIGH);
            channel.setDescription("تذكيرات استدعاء الأولياء ومراحل متابعة الغياب");
            getSystemService(NotificationManager.class).createNotificationChannel(channel);
            NotificationChannel agendaChannel = new NotificationChannel(
                AgendaReminderScheduler.CHANNEL_ID, "تنبيهات أجندة المشرف", NotificationManager.IMPORTANCE_HIGH
            );
            agendaChannel.setDescription("تنبيهات الاجتماعات والمهام ومواعيد المتابعة في أجندة مُشرِفي");
            agendaChannel.setLockscreenVisibility(android.app.Notification.VISIBILITY_PRIVATE);
            getSystemService(NotificationManager.class).createNotificationChannel(agendaChannel);
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
        AgendaReminderScheduler.rescheduleAll(this);
        StudentFollowupReminderScheduler.rescheduleAll(this);
        notifyExactAlarmPermissionState();
        notifyNotificationPermissionState(Build.VERSION.SDK_INT < 33 || checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED);
        checkLicenseWhenDue();
    }

    private void checkLicenseWhenDue() {
        licenseExecutor.execute(() -> {
            org.json.JSONObject result;
            try {
                if (!LicenseManager.hasStoredLicense(MainActivity.this)) {
                    try {
                        result = LicenseManager.recover(MainActivity.this);
                    } catch (Exception recoveryError) {
                        result = LicenseManager.status(MainActivity.this);
                        result.put("validationError", recoveryError.getMessage() == null ? "لا يوجد ترخيص قابل للاستعادة لهذا الهاتف" : recoveryError.getMessage());
                    }
                } else {
                    if (!LicenseManager.shouldValidate(MainActivity.this)) return;
                    result = LicenseManager.validate(MainActivity.this);
                }
            } catch (Exception error) {
                try {
                    result = LicenseManager.status(MainActivity.this);
                    result.put("validationError", error.getMessage() == null ? "تعذر التحقق من الترخيص" : error.getMessage());
                } catch (Exception statusError) {
                    result = new org.json.JSONObject();
                    try {
                        result.put("hasLicense", LicenseManager.hasStoredLicense(MainActivity.this))
                            .put("activated", false)
                            .put("message", statusError.getMessage() == null ? "تعذر قراءة حالة الترخيص" : statusError.getMessage());
                    } catch (Exception ignored) {}
                }
            }
            String script = "window.onMushrifiLicenseAutoCheck && window.onMushrifiLicenseAutoCheck(" + result.toString() + ");";
            runOnUiThread(() -> { if (web != null) web.evaluateJavascript(script, null); });
        });
    }

    private boolean exactAlarmAccessGranted() {
        if (Build.VERSION.SDK_INT < 31) return true;
        AlarmManager alarms = (AlarmManager) getSystemService(ALARM_SERVICE);
        return alarms != null && alarms.canScheduleExactAlarms();
    }

    private void notifyExactAlarmPermissionState() {
        if (web == null) return;
        boolean granted = exactAlarmAccessGranted();
        web.evaluateJavascript("window.onMushrifiExactAlarmPermissionChanged && window.onMushrifiExactAlarmPermissionChanged(" + granted + ");", null);
    }

    private void notifyNotificationPermissionState(boolean granted) {
        if (web == null) return;
        web.evaluateJavascript("window.onMushrifiNotificationPermissionChanged && window.onMushrifiNotificationPermissionChanged(" + granted + ");", null);
    }

    @Override public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == NOTIFICATION_PERMISSION) {
            boolean granted = Build.VERSION.SDK_INT < 33 || checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;
            notifyNotificationPermissionState(granted);
            if (granted) {
                AgendaReminderScheduler.rescheduleAll(this);
                AgendaReminderScheduler.deliverDue(this, null);
                StudentFollowupReminderScheduler.rescheduleAll(this);
                StudentFollowupReminderScheduler.deliverDue(this, null);
            }
            Toast.makeText(this, granted ? "تم تفعيل صلاحية الإشعارات." : "لم تُفعّل صلاحية الإشعارات؛ لن تصل التذكيرات حتى السماح بها.", Toast.LENGTH_LONG).show();
        }
    }

    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == SPEECH_REQUEST) {
            speechPending = false;
            if (resultCode == RESULT_OK && data != null) {
                java.util.ArrayList<String> results = data.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS);
                if (results != null && !results.isEmpty()) {
                    org.json.JSONArray alternatives = new org.json.JSONArray(results);
                    web.evaluateJavascript("window.onArabicSpeechResult && window.onArabicSpeechResult(" + alternatives.toString() + ");", null);
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
                    web.evaluateJavascript("window.onNativeBackupLoaded && window.onNativeBackupLoaded(" + org.json.JSONObject.quote(json) + ");", null);
                } catch (Exception e) {
                    Toast.makeText(this, "تعذرت قراءة النسخة: " + e.getMessage(), Toast.LENGTH_LONG).show();
                }
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
                    byte[] savedBytes;
                    try (java.io.InputStream verify = getContentResolver().openInputStream(data.getData());
                         java.io.ByteArrayOutputStream verified = new java.io.ByteArrayOutputStream()) {
                        if (verify == null) throw new IOException("تعذر إعادة قراءة النسخة للتحقق من محتواها");
                        byte[] verifyBuffer = new byte[8192]; int verifyCount;
                        while ((verifyCount = verify.read(verifyBuffer)) != -1) verified.write(verifyBuffer, 0, verifyCount);
                        savedBytes = verified.toByteArray();
                    }
                    byte[] expectedDigest = java.security.MessageDigest.getInstance("SHA-256").digest(bytes);
                    byte[] actualDigest = java.security.MessageDigest.getInstance("SHA-256").digest(savedBytes);
                    if (!java.security.MessageDigest.isEqual(expectedDigest, actualDigest))
                        throw new IOException("محتوى الملف بعد الحفظ لا يطابق النسخة الأصلية؛ لم يُسجل نجاح النسخ");
                    getSharedPreferences("mushrifi_backup_status", MODE_PRIVATE).edit()
                        .putLong("last_verified_backup", System.currentTimeMillis()).commit();
                    web.evaluateJavascript("window.onMushrifiBackupVerified && window.onMushrifiBackupVerified(" + System.currentTimeMillis() + ");", null);
                    Toast.makeText(this, "تم حفظ النسخة الاحتياطية والتحقق من محتواها (" + written + " بايت)", Toast.LENGTH_LONG).show();
                } catch (Exception e) { Toast.makeText(this, "فشل حفظ النسخة الاحتياطية: " + e.getMessage(), Toast.LENGTH_LONG).show(); }
            } else if (resultCode != RESULT_OK) {
                Toast.makeText(this, "تم إلغاء حفظ النسخة الاحتياطية", Toast.LENGTH_SHORT).show();
            }
            pendingBackup = null;
        }
    }

    private void captureAgendaNotificationIntent(Intent intent) {
        if (intent == null) return;
        String id = intent.getStringExtra("agenda_notification_id");
        String date = intent.getStringExtra("agenda_notification_date");
        if (id != null && !id.trim().isEmpty()) {
            pendingAgendaNotificationId = id;
            pendingAgendaNotificationDate = date == null ? "" : date;
        }
    }

    private void dispatchPendingAgendaNotification() {
        if (!webPageReady || web == null || pendingAgendaNotificationId == null) return;
        String id = pendingAgendaNotificationId;
        String date = pendingAgendaNotificationDate == null ? "" : pendingAgendaNotificationDate;
        pendingAgendaNotificationId = null;
        pendingAgendaNotificationDate = null;
        String script = "window.openAgendaFromNotification && window.openAgendaFromNotification(" +
            org.json.JSONObject.quote(id) + "," + org.json.JSONObject.quote(date) + ");";
        web.evaluateJavascript(script, null);
    }

    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        captureAgendaNotificationIntent(intent);
        dispatchPendingAgendaNotification();
    }

    @Override protected void onStop() { super.onStop(); }

    private void handleAppBack() {
        if (web == null) { finish(); return; }
        web.evaluateJavascript(
            "(function(){try{return window.handleMushrifiAndroidBack ? window.handleMushrifiAndroidBack() : false;}catch(e){return false;}})();",
            value -> { if (!"true".equals(value)) finish(); }
        );
    }

    @Override public void onBackPressed() { handleAppBack(); }
}
