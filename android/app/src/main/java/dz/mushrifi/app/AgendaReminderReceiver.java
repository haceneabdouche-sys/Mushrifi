package dz.mushrifi.app;

import android.content.Context;
import android.content.Intent;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Build;

import org.json.JSONObject;

public class AgendaReminderReceiver extends android.content.BroadcastReceiver {
    private static final String ACTION = "dz.mushrifi.app.ACTION_AGENDA_REMINDER";

    @Override public void onReceive(Context context, Intent intent) {
        if (intent == null || !ACTION.equals(intent.getAction())) return;
        String id = intent.getStringExtra("agenda_id");
        if (id == null || id.trim().isEmpty()) return;
        AgendaReminderScheduler.deliverDue(context, id);
    }

    static boolean postNotification(Context context, JSONObject item) {
        if (!AgendaReminderScheduler.hasNotificationPermission(context)) return false;
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return false;

        if (Build.VERSION.SDK_INT >= 26 && manager.getNotificationChannel(AgendaReminderScheduler.CHANNEL_ID) == null) {
            NotificationChannel channel = new NotificationChannel(
                AgendaReminderScheduler.CHANNEL_ID, "تنبيهات أجندة المشرف", NotificationManager.IMPORTANCE_HIGH
            );
            channel.setDescription("تنبيهات الاجتماعات والمهام ومواعيد المتابعة في أجندة مُشرِفي");
            channel.setLockscreenVisibility(Notification.VISIBILITY_PRIVATE);
            manager.createNotificationChannel(channel);
        }
        if (!AgendaReminderScheduler.areAgendaNotificationsEnabled(context)) return false;

        String id = item.optString("id", "");
        String title = item.optString("title", "موعد في الأجندة");
        String eventDate = item.optString("eventDate", "");
        String eventTime = item.optString("eventTime", "");
        int lead = item.optInt("leadMinutes", 0);
        String leadText = lead == AgendaReminderPlanner.LEAD_ONE_DAY ? "قبل الموعد بيوم"
            : lead == AgendaReminderPlanner.LEAD_ONE_HOUR ? "قبل الموعد بساعة" : "عند وقت الموعد";
        String body = "حان وقت التذكير: " + title + " — " + leadText +
            (eventTime.trim().isEmpty() ? " · الموعد خلال اليوم" : " · " + eventTime);

        Intent launch = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
        PendingIntent content = null;
        if (launch != null) {
            launch.setFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            launch.putExtra("agenda_notification_id", id);
            launch.putExtra("agenda_notification_date", eventDate);
            int requestCode = ("agenda-open:" + id).hashCode();
            content = PendingIntent.getActivity(
                context, requestCode, launch,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
            );
        }

        Notification.Builder builder = Build.VERSION.SDK_INT >= 26
            ? new Notification.Builder(context, AgendaReminderScheduler.CHANNEL_ID)
            : new Notification.Builder(context);
        Notification.Builder configured = builder
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle("تذكير من أجندة مُشرِفي")
            .setContentText(body)
            .setStyle(new Notification.BigTextStyle().bigText(body))
            .setAutoCancel(true)
            .setCategory(Notification.CATEGORY_REMINDER)
            .setVisibility(Notification.VISIBILITY_PRIVATE);
        if (Build.VERSION.SDK_INT < 26) configured.setPriority(Notification.PRIORITY_HIGH);
        if (content != null) configured.setContentIntent(content);

        try {
            manager.notify(("agenda:" + id).hashCode(), configured.build());
            return true;
        } catch (SecurityException denied) {
            android.util.Log.w("MushrifiAgenda", "Notification permission/channel blocked agenda reminder", denied);
            return false;
        }
    }

    static boolean postTestNotification(Context context) {
        if (!AgendaReminderScheduler.hasNotificationPermission(context)) return false;
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return false;
        if (Build.VERSION.SDK_INT >= 26 && manager.getNotificationChannel(AgendaReminderScheduler.CHANNEL_ID) == null) {
            NotificationChannel channel = new NotificationChannel(
                AgendaReminderScheduler.CHANNEL_ID, "تنبيهات أجندة المشرف", NotificationManager.IMPORTANCE_HIGH
            );
            channel.setDescription("تنبيهات الاجتماعات والمهام ومواعيد المتابعة في أجندة مُشرِفي");
            channel.setLockscreenVisibility(Notification.VISIBILITY_PRIVATE);
            manager.createNotificationChannel(channel);
        }
        if (!AgendaReminderScheduler.areAgendaNotificationsEnabled(context)) return false;
        Notification.Builder builder = Build.VERSION.SDK_INT >= 26
            ? new Notification.Builder(context, AgendaReminderScheduler.CHANNEL_ID)
            : new Notification.Builder(context);
        Notification notification = builder.setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle("اختبار تنبيهات الأجندة")
            .setContentText("إشعارات مواعيد ومهام مُشرِفي تعمل على هذا الهاتف.")
            .setAutoCancel(true)
            .setVisibility(Notification.VISIBILITY_PRIVATE)
            .build();
        try {
            manager.notify("agenda-test".hashCode(), notification);
            return true;
        } catch (SecurityException denied) {
            return false;
        }
    }
}
