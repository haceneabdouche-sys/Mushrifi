package dz.mushrifi.app;

import android.Manifest;
import android.app.AlarmManager;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;

/**
 * Persistent, idempotent scheduler for date-only educational follow-up reviews.
 * It stores no student names or observation text and posts one generic reminder per review date.
 */
public final class StudentFollowupReminderScheduler {
    static final String PREFS = "student_followup_reminders";
    static final String CHANNEL_ID = "student_followup_reviews";
    static final String ACTION = "dz.mushrifi.app.ACTION_STUDENT_FOLLOWUP_REVIEW";
    private static final int MAX_REMINDERS = 2000;

    private StudentFollowupReminderScheduler() {}

    public static synchronized JSONObject sync(Context context, String payload) throws JSONException {
        if (context == null) throw new IllegalArgumentException("سياق التطبيق غير متاح");
        JSONArray input = new JSONArray(payload == null || payload.trim().isEmpty() ? "[]" : payload);
        if (input.length() > MAX_REMINDERS) {
            throw new IllegalArgumentException("عدد مواعيد المتابعة التربوية يتجاوز الحد الآمن (" + MAX_REMINDERS + ").");
        }

        long now = System.currentTimeMillis();
        LinkedHashMap<String, JSONObject> desired = new LinkedHashMap<>();
        Set<String> seen = new HashSet<>();
        int expired = 0;

        for (int i = 0; i < input.length(); i++) {
            JSONObject raw = input.optJSONObject(i);
            if (raw == null) throw new IllegalArgumentException("عنصر متابعة تربوية رقم " + (i + 1) + " غير صالح.");
            String reviewDate = safeText(raw.optString("reviewDate", ""), 10);
            int count = raw.optInt("count", 0);
            if (reviewDate.isEmpty() || count < 1) {
                throw new IllegalArgumentException("تاريخ المراجعة وعدد السجلات مطلوبان لجدولة التذكير اليومي.");
            }
            long reminderAt = StudentFollowupReminderPlanner.reviewReminderMillis(reviewDate, null);
            String id = reviewDate;
            if (!seen.add(id)) throw new IllegalArgumentException("يوجد تاريخ مراجعة مكرر؛ لم يتم تغيير جدول التنبيهات.");

            if (reminderAt <= now - StudentFollowupReminderPlanner.MAX_LATE_DELIVERY_MS) {
                expired++;
                continue;
            }

            JSONObject stored = new JSONObject();
            stored.put("id", id);
            stored.put("reviewDate", reviewDate);
            stored.put("count", count);
            stored.put("reminderAt", reminderAt);
            desired.put(id, stored);
        }

        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        Map<String, ?> current = prefs.getAll();
        Set<String> cancelKeys = new HashSet<>();
        Set<String> scheduleKeys = new HashSet<>();
        Map<String, JSONObject> nextStored = new LinkedHashMap<>();

        for (Map.Entry<String, ?> entry : current.entrySet()) {
            String id = entry.getKey();
            JSONObject next = desired.get(id);
            JSONObject old = readItem(prefs, id);
            if (next == null || old == null || !sameSchedule(old, next)) cancelKeys.add(id);
        }

        for (Map.Entry<String, JSONObject> entry : desired.entrySet()) {
            String id = entry.getKey();
            JSONObject next = entry.getValue();
            JSONObject old = readItem(prefs, id);
            if (old != null && sameSchedule(old, next)) {
                if (old.optBoolean("delivered", false)) next.put("delivered", true);
                if (old.optBoolean("waitingForPermission", false)) next.put("waitingForPermission", true);
                if (old.optBoolean("waitingForScheduling", false)) {
                    next.put("waitingForScheduling", true);
                    scheduleKeys.add(id);
                }
            } else {
                scheduleKeys.add(id);
            }
            nextStored.put(id, next);
        }

        SharedPreferences.Editor editor = prefs.edit();
        for (String id : cancelKeys) editor.remove(id);
        for (Map.Entry<String, JSONObject> entry : nextStored.entrySet()) {
            editor.putString(entry.getKey(), entry.getValue().toString());
        }
        if (!editor.commit()) throw new IllegalStateException("تعذر حفظ جدول مراجعات المتابعة التربوية في الهاتف.");

        for (String id : cancelKeys) cancel(context, id);

        int scheduled = 0;
        int failedToSchedule = 0;
        for (String id : scheduleKeys) {
            JSONObject item = nextStored.get(id);
            if (item.optLong("reminderAt", 0L) <= now) continue;
            if (schedule(context, item)) {
                scheduled++;
                if (item.optBoolean("waitingForScheduling", false)) {
                    item.remove("waitingForScheduling");
                    prefs.edit().putString(id, item.toString()).apply();
                }
            } else {
                failedToSchedule++;
                cancelAlarmOnly(context, id);
                try {
                    item.put("waitingForScheduling", true);
                    prefs.edit().putString(id, item.toString()).commit();
                } catch (JSONException error) {
                    android.util.Log.e("MushrifiFollowup", "Could not persist scheduling retry state", error);
                }
            }
        }

        deliverDue(context, null);
        JSONObject result = new JSONObject();
        result.put("ok", failedToSchedule == 0);
        result.put("active", desired.size());
        result.put("updated", scheduled);
        result.put("failedToSchedule", failedToSchedule);
        result.put("cancelled", cancelKeys.size());
        result.put("expired", expired);
        result.put("notificationPermission", hasNotificationPermission(context));
        if (failedToSchedule > 0) {
            result.put("error", "تعذر ضبط " + failedToSchedule + " منبه(ات) للمراجعة؛ ستبقى السجلات محفوظة وستُعاد المحاولة عند فتح التطبيق.");
        }
        return result;
    }

    private static boolean sameSchedule(JSONObject current, JSONObject desired) {
        return current != null && desired != null
            && current.optString("id", "").equals(desired.optString("id", ""))
            && current.optString("reviewDate", "").equals(desired.optString("reviewDate", ""))
            && current.optLong("reminderAt", -1L) == desired.optLong("reminderAt", -2L);
    }

    private static String safeText(String value, int maximum) {
        if (value == null) return "";
        String clean = value.replace('\n', ' ').replace('\r', ' ').trim();
        return clean.length() > maximum ? clean.substring(0, maximum) : clean;
    }

    static boolean hasNotificationPermission(Context context) {
        return Build.VERSION.SDK_INT < 33
            || context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;
    }

    static boolean areNotificationsEnabled(Context context) {
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return false;
        if (Build.VERSION.SDK_INT >= 24 && !manager.areNotificationsEnabled()) return false;
        if (Build.VERSION.SDK_INT >= 26) {
            android.app.NotificationChannel channel = manager.getNotificationChannel(CHANNEL_ID);
            return channel != null && channel.getImportance() != NotificationManager.IMPORTANCE_NONE;
        }
        return true;
    }

    static synchronized void cancel(Context context, String id) {
        if (context == null || id == null || id.isEmpty()) return;
        AlarmManager manager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        PendingIntent pending = pendingIntent(context, id, PendingIntent.FLAG_NO_CREATE);
        if (pending != null) {
            if (manager != null) manager.cancel(pending);
            pending.cancel();
        }
        NotificationManager notifications = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (notifications != null) notifications.cancel(notificationId(id));
    }

    private static void cancelAlarmOnly(Context context, String id) {
        if (context == null || id == null || id.isEmpty()) return;
        AlarmManager manager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        PendingIntent pending = pendingIntent(context, id, PendingIntent.FLAG_NO_CREATE);
        if (pending != null) {
            if (manager != null) manager.cancel(pending);
            pending.cancel();
        }
    }

    private static boolean schedule(Context context, JSONObject item) {
        String id = item.optString("id", "");
        long reminderAt = item.optLong("reminderAt", 0L);
        if (id.isEmpty() || reminderAt <= System.currentTimeMillis()) return false;
        AlarmManager manager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (manager == null) return false;
        PendingIntent pending = pendingIntent(context, id, PendingIntent.FLAG_UPDATE_CURRENT);
        try {
            if (Build.VERSION.SDK_INT >= 31 && manager.canScheduleExactAlarms()) {
                try {
                    manager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, reminderAt, pending);
                } catch (SecurityException exactDenied) {
                    manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, reminderAt, pending);
                }
            } else {
                manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, reminderAt, pending);
            }
            return true;
        } catch (SecurityException denied) {
            try {
                manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, reminderAt, pending);
                return true;
            } catch (RuntimeException unavailable) {
                android.util.Log.e("MushrifiFollowup", "Could not schedule educational follow-up reminder", unavailable);
                return false;
            }
        } catch (RuntimeException unavailable) {
            android.util.Log.e("MushrifiFollowup", "Could not schedule educational follow-up reminder", unavailable);
            return false;
        }
    }

    private static PendingIntent pendingIntent(Context context, String id, int extraFlags) {
        Intent intent = new Intent(context, StudentFollowupReminderReceiver.class);
        intent.setAction(ACTION);
        intent.setData(Uri.parse("mushrifi://student-followup-review/" + Uri.encode(id)));
        intent.putExtra("followup_date", id);
        int flags = PendingIntent.FLAG_IMMUTABLE | extraFlags;
        if ((extraFlags & PendingIntent.FLAG_NO_CREATE) == 0) flags |= PendingIntent.FLAG_UPDATE_CURRENT;
        return PendingIntent.getBroadcast(context, id.hashCode(), intent, flags);
    }

    private static int notificationId(String id) {
        return ("student-followup:" + id).hashCode();
    }

    /** Rebuild alarms after boot, timezone/clock changes, app replacement or permission changes. */
    public static synchronized void rescheduleAll(Context context) {
        if (context == null) return;
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        long now = System.currentTimeMillis();
        for (String id : new HashSet<>(prefs.getAll().keySet())) {
            JSONObject item = readItem(prefs, id);
            if (item == null) {
                cancel(context, id);
                prefs.edit().remove(id).apply();
                continue;
            }
            try {
                long reminderAt = StudentFollowupReminderPlanner.reviewReminderMillis(
                    item.getString("reviewDate"), null
                );
                if (now - reminderAt > StudentFollowupReminderPlanner.MAX_LATE_DELIVERY_MS) {
                    cancel(context, id);
                    prefs.edit().remove(id).apply();
                    continue;
                }
                item.put("reminderAt", reminderAt);
                prefs.edit().putString(id, item.toString()).apply();
                if (!item.optBoolean("delivered", false) && reminderAt > now) {
                    if (!schedule(context, item)) {
                        try { item.put("waitingForScheduling", true); } catch (JSONException ignored) {}
                        prefs.edit().putString(id, item.toString()).apply();
                    } else if (item.optBoolean("waitingForScheduling", false)) {
                        item.remove("waitingForScheduling");
                        prefs.edit().putString(id, item.toString()).apply();
                    }
                }
            } catch (Exception invalid) {
                cancel(context, id);
                prefs.edit().remove(id).apply();
                android.util.Log.w("MushrifiFollowup", "Removed invalid stored follow-up reminder " + id, invalid);
            }
        }
        deliverDue(context, null);
    }

    static synchronized void deliverDue(Context context, String onlyId) {
        if (context == null) return;
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        long now = System.currentTimeMillis();
        for (String id : new HashSet<>(prefs.getAll().keySet())) {
            if (onlyId != null && !onlyId.equals(id)) continue;
            JSONObject item = readItem(prefs, id);
            if (item == null) {
                prefs.edit().remove(id).apply();
                continue;
            }
            long reminderAt = item.optLong("reminderAt", 0L);
            if (item.optBoolean("delivered", false) || reminderAt > now) continue;
            if (!StudentFollowupReminderPlanner.isWithinDeliveryWindow(reminderAt, now)) {
                cancel(context, id);
                prefs.edit().remove(id).apply();
                continue;
            }

            StudentFollowupReminderReceiver.ensureChannel(context);
            if (!hasNotificationPermission(context) || !areNotificationsEnabled(context)) {
                try {
                    item.put("waitingForPermission", true);
                    prefs.edit().putString(id, item.toString()).apply();
                } catch (JSONException error) {
                    android.util.Log.e("MushrifiFollowup", "Could not persist permission-waiting reminder", error);
                }
                continue;
            }

            boolean posted = StudentFollowupReminderReceiver.postNotification(context, item);
            if (posted) {
                try {
                    item.put("delivered", true);
                    item.remove("waitingForPermission");
                    item.remove("waitingForScheduling");
                    if (prefs.edit().putString(id, item.toString()).commit()) {
                        cancelAlarmOnly(context, id);
                    } else {
                        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
                        if (manager != null) manager.cancel(notificationId(id));
                        android.util.Log.e("MushrifiFollowup", "Notification withdrawn because delivered state could not be committed");
                    }
                } catch (JSONException error) {
                    android.util.Log.e("MushrifiFollowup", "Could not mark follow-up reminder as delivered", error);
                }
            }
        }
    }

    private static JSONObject readItem(SharedPreferences prefs, String id) {
        try {
            String raw = prefs.getString(id, null);
            if (raw == null) return null;
            JSONObject item = new JSONObject(raw);
            if (!id.equals(item.optString("id", "")) ||
                !id.equals(item.optString("reviewDate", "")) ||
                item.optInt("count", 0) < 1 ||
                item.optLong("reminderAt", 0L) <= 0L) return null;
            return item;
        } catch (Exception invalid) {
            return null;
        }
    }
}
