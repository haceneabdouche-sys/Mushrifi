package dz.mushrifi.app;

import android.app.Activity;
import android.app.AlarmManager;
import android.app.PendingIntent;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.os.Build;
import android.Manifest;
import android.content.pm.PackageManager;
import android.content.Intent;
import android.speech.RecognizerIntent;
import android.net.Uri;
import android.os.Bundle;
import android.provider.DocumentsContract;
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
    private static final String CHANNEL_ID = "guardian_summons";
    private ValueCallback<Uri[]> fileCallback;
    private String pendingBackup;
    private boolean speechPending;
    private WebView web;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
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
        web.loadUrl("https://haceneabdouche-sys.github.io/Mushrifi/index.html");
    }

    public class AndroidBridge {
        @JavascriptInterface public void scheduleSummonsReminder(String id, String studentName, long appointmentMillis) {
            long reminderMillis = appointmentMillis - 24L * 60L * 60L * 1000L;
            getSharedPreferences("summons_reminders", MODE_PRIVATE).edit().putString(id, studentName + "|" + appointmentMillis).apply();
            scheduleReminder(MainActivity.this, id, studentName, reminderMillis);
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

    static void scheduleReminder(Context context, String id, String studentName, long reminderMillis) {
        if (reminderMillis <= System.currentTimeMillis()) return;
        Intent intent = new Intent(context, SummonsReminderReceiver.class);
        intent.putExtra("student", studentName);
        intent.putExtra("id", id);
        PendingIntent pending = PendingIntent.getBroadcast(context, id.hashCode(), intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        AlarmManager alarms = (AlarmManager) context.getSystemService(ALARM_SERVICE);
        alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, reminderMillis, pending);
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
        } else if (requestCode == PICK_FILE && fileCallback != null) {
            Uri[] result = resultCode == RESULT_OK ? WebChromeClient.FileChooserParams.parseResult(resultCode, data) : null;
            fileCallback.onReceiveValue(result);
            fileCallback = null;
        } else if (requestCode == SAVE_FILE) {
            if (resultCode == RESULT_OK && data != null && data.getData() != null && pendingBackup != null) {
                try (OutputStream out = getContentResolver().openOutputStream(data.getData())) {
                    out.write(pendingBackup.getBytes(java.nio.charset.StandardCharsets.UTF_8));
                    Toast.makeText(this, "تم حفظ النسخة الاحتياطية", Toast.LENGTH_LONG).show();
                } catch (Exception e) { Toast.makeText(this, "تعذر حفظ النسخة: " + e.getMessage(), Toast.LENGTH_LONG).show(); }
            }
            pendingBackup = null;
        }
    }

    @Override public void onBackPressed() {
        if (web != null && web.canGoBack()) web.goBack(); else super.onBackPressed();
    }
}
