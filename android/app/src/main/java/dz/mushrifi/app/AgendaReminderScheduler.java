package dz.mushrifi.app;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.Manifest;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.LinkedHashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;

/** Persistent, idempotent Android alarm scheduler for user-enabled agenda entries. */
public final class AgendaReminderScheduler {
    static final String PREFS = "agenda_reminders";
    static final String CHANNEL_ID = "agenda_reminders";
    private static final int MAX_REMINDERS = 500;
    private static final long MAX_LATE_DELIVERY_MS = 24L * 60L * 60L * 1000L;
    private static final String ACTION = "dz.mushrifi.app.ACTION_AGENDA_REMINDER";

    private AgendaReminderScheduler() {}

    public static synchronized JSONObject sync(Context context, String payload) throws JSONException {
        if (context == null) throw new IllegalArgumentException("سياق التطبيق غير متاح");
        JSONArray input = new JSONArray(payload == null || payload.trim().isEmpty() ? "[]" : payload);
        if (input.length() > MAX_REMINDERS) throw new IllegalArgumentException("عدد تنبيهات الأجندة يتجاوز الحد الآمن (" + MAX_REMINDERS + ").");

        long now = System.currentTimeMillis();
        LinkedHashMap<String, JSONObject> desired = new LinkedHashMap<>();
        int expired = 0;
        for (int i = 0; i < input.length(); i++) {
            JSONObject raw = input.optJSONObject(i);
            if (raw == null) throw new IllegalArgumentException("عنصر تنبيه الأجندة رقم " + (i + 1) + " غير صالح.");
            String id = safeText(raw.optString("id", ""), 128);
            String title = safeText(raw.optString("title", ""), 100);
            String eventDate = raw.optString("eventDate", "");
            String eventTime = raw.optString("eventTime", "");
            int lead = raw.optInt("leadMinutes", -1);
            if (id.isEmpty() || title.isEmpty()) throw new IllegalArgumentException("معرّف الموعد وعنوانه مطلوبان لجدولة التنبيه.");
            if (!AgendaReminderPlanner.isAllowedLeadMinutes(lead)) throw new IllegalArgumentException("خيار التذكير للموعد «" + title + "» غير صالح.");
            long appointmentAt = AgendaReminderPlanner.appointmentMillis(eventDate, eventTime, null);
            long reminderAt = AgendaReminderPlanner.reminderMillis(eventDate, eventTime, lead, null);
            if (appointmentAt <= now || reminderAt <= now - MAX_LATE_DELIVERY_MS) { expired++; continue; }
            JSONObject stored = new JSONObject();
            stored.put("id", id);
            stored.put("title", title);
            stored.put("eventDate", eventDate);
            stored.put("eventTime", eventTime == null ? "" : eventTime);
            stored.put("leadMinutes", lead);
            stored.put("appointmentAt", appointmentAt);
            stored.put("reminderAt", reminderAt);
            if (desired.put(id, stored) != null) throw new IllegalArgumentException("يوجد معرّف موعد مكرر في الأجندة؛ لم يتم تغيير التنبيهات.");
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
                if (old.optBoolean("delivered", false)) {
                    // The reminder has already been posted for this exact date/time/lead.
                    // A title edit must not make it fire for a second time.
                    next.put("delivered", true);
                } else if (old.optBoolean("waitingForPermission", false)) {
                    next.put("waitingForPermission", true);
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
        if (!editor.commit()) throw new IllegalStateException("تعذر حفظ جدول تنبيهات الأجندة في الهاتف.");

        for (String id : cancelKeys) cancel(context, id);
        int scheduled = 0;
        int failedToSchedule = 0;
        for (String id : scheduleKeys) {
            JSONObject item = nextStored.get(id);
            if (item.optLong("reminderAt", 0L) <= now) {
                // The reminder time has passed but its appointment is still upcoming.
                // Keep it stored and let deliverDue post it now or wait for notification permission.
                continue;
            }
            if (schedule(context, item)) {
                scheduled++;
            } else {
                failedToSchedule++;
                cancelAlarmOnly(context, id);
                prefs.edit().remove(id).commit();
            }
        }
        deliverDue(context, null);
        JSONObject result = new JSONObject();
        result.put("ok", failedToSchedule == 0);
        result.put("active", desired.size() - failedToSchedule);
        result.put("updated", scheduled);
        result.put("failedToSchedule", failedToSchedule);
        result.put("cancelled", cancelKeys.size());
        result.put("expired", expired);
        result.put("exact", hasExactAlarmAccess(context));
        if (failedToSchedule > 0) result.put("error", "تعذر جدولة " + failedToSchedule + " تنبيه(ات)؛ أعد فتح الأجندة بعد مراجعة صلاحيات الهاتف.");
        return result;
    }

    private static boolean sameSchedule(JSONObject current, JSONObject desired) {
        return current != null && desired != null
            && current.optString("id", "").equals(desired.optString("id", ""))
            && current.optString("eventDate", "").equals(desired.optString("eventDate", ""))
            && current.optString("eventTime", "").equals(desired.optString("eventTime", ""))
            && current.optInt("leadMinutes", -1) == desired.optInt("leadMinutes", -2)
            && current.optLong("appointmentAt", -1L) == desired.optLong("appointmentAt", -2L)
            && current.optLong("reminderAt", -1L) == desired.optLong("reminderAt", -2L);
    }

    private static String safeText(String value, int maximum) {
        if (value == null) return "";
        String clean = value.replace('\n', ' ').replace('\r', ' ').trim();
        return clean.length() > maximum ? clean.substring(0, maximum) : clean;
    }

    static boolean hasExactAlarmAccess(Context context) {
        if (Build.VERSION.SDK_INT < 31) return true;
        AlarmManager manager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        return manager != null && manager.canScheduleExactAlarms();
    }

    static boolean hasNotificationPermission(Context context) {
        return Build.VERSION.SDK_INT < 33 ||
            context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;
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
        if (notifications != null) notifications.cancel(("agenda:" + id).hashCode());
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
                android.util.Log.e("MushrifiAgenda", "Could not schedule agenda reminder", unavailable);
                return false;
            }
        } catch (RuntimeException unavailable) {
            android.util.Log.e("MushrifiAgenda", "Could not schedule agenda reminder", unavailable);
            return false;
        }
    }

    private static PendingIntent pendingIntent(Context context, String id, int extraFlags) {
        Intent intent = new Intent(context, AgendaReminderReceiver.class);
        intent.setAction(ACTION);
        intent.setData(Uri.parse("mushrifi://agenda-reminder/" + Uri.encode(id)));
        intent.putExtra("agenda_id", id);
        int flags = PendingIntent.FLAG_IMMUTABLE | extraFlags;
        if ((extraFlags & PendingIntent.FLAG_NO_CREATE) == 0) flags |= PendingIntent.FLAG_UPDATE_CURRENT;
        return PendingIntent.getBroadcast(context, id.hashCode(), intent, flags);
    }

    public static synchronized void cancelAll(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        for (String id : new HashSet<>(prefs.getAll().keySet())) cancel(context, id);
        prefs.edit().clear().commit();
    }

    /** Rebuild wall-clock alarms after boot, time-zone changes, app replacement or permission changes. */
    public static synchronized void rescheduleAll(Context context) {
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
                long appointmentAt = AgendaReminderPlanner.appointmentMillis(
                    item.getString("eventDate"), item.optString("eventTime", ""), null
                );
                long reminderAt = AgendaReminderPlanner.reminderMillis(
                    item.getString("eventDate"), item.optString("eventTime", ""),
                    item.getInt("leadMinutes"), null
                );
                if (appointmentAt <= now || reminderAt <= now - MAX_LATE_DELIVERY_MS) {
                    cancelAlarmOnly(context, id);
                    prefs.edit().remove(id).apply();
                    continue;
                }
                item.put("appointmentAt", appointmentAt);
                item.put("reminderAt", reminderAt);
                prefs.edit().putString(id, item.toString()).apply();
                if (!item.optBoolean("delivered", false) && reminderAt > now) schedule(context, item);
            } catch (Exception invalid) {
                cancel(context, id);
                prefs.edit().remove(id).apply();
                android.util.Log.w("MushrifiAgenda", "Removed invalid stored reminder " + id, invalid);
            }
        }
        deliverDue(context, null);
    }

    static synchronized void deliverDue(Context context, String onlyId) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        long now = System.currentTimeMillis();
        for (String id : new HashSet<>(prefs.getAll().keySet())) {
            if (onlyId != null && !onlyId.equals(id)) continue;
            JSONObject item = readItem(prefs, id);
            if (item == null) {
                prefs.edit().remove(id).apply();
                continue;
            }
            long appointmentAt = item.optLong("appointmentAt", 0L);
            long reminderAt = item.optLong("reminderAt", 0L);
            if (item.optBoolean("delivered", false) || appointmentAt <= now || reminderAt > now) continue;
            if (now - reminderAt > MAX_LATE_DELIVERY_MS) {
                prefs.edit().remove(id).apply();
                continue;
            }
            if (!hasNotificationPermission(context)) {
                try {
                    item.put("waitingForPermission", true);
                    prefs.edit().putString(id, item.toString()).apply();
                } catch (JSONException error) {
                    android.util.Log.e("MushrifiAgenda", "Could not persist permission-waiting agenda reminder", error);
                }
                continue;
            }
            boolean posted = AgendaReminderReceiver.postNotification(context, item);
            if (posted) {
                try {
                    item.put("delivered", true);
                    item.remove("waitingForPermission");
                    if (prefs.edit().putString(id, item.toString()).commit()) {
                        cancelAlarmOnly(context, id);
                    } else {
                        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
                        if (manager != null) manager.cancel(("agenda:" + id).hashCode());
                        android.util.Log.e("MushrifiAgenda", "Could not persist delivered state; notification withdrawn to avoid duplicates");
                    }
                } catch (JSONException error) {
                    android.util.Log.e("MushrifiAgenda", "Could not mark agenda reminder as delivered", error);
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
                !AgendaReminderPlanner.isAllowedLeadMinutes(item.optInt("leadMinutes", -1)) ||
                item.optLong("appointmentAt", 0L) <= 0 ||
                item.optLong("reminderAt", 0L) <= 0 ||
                item.optString("title", "").trim().isEmpty()) return null;
            return item;
        } catch (Exception invalid) {
            return null;
        }
    }
}
