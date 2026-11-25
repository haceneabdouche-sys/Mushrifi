package dz.mushrifi.app;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

import org.json.JSONObject;

public final class StudentFollowupReminderReceiver extends android.content.BroadcastReceiver {
    @Override public void onReceive(Context context, Intent intent) {
        if (intent == null || !StudentFollowupReminderScheduler.ACTION.equals(intent.getAction())) return;
        String id = intent.getStringExtra("followup_date");
        if (id == null || id.trim().isEmpty()) return;
        StudentFollowupReminderScheduler.deliverDue(context, id);
    }

    static void ensureChannel(Context context) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null || manager.getNotificationChannel(StudentFollowupReminderScheduler.CHANNEL_ID) != null) return;
        NotificationChannel channel = new NotificationChannel(
            StudentFollowupReminderScheduler.CHANNEL_ID,
            "مراجعات المتابعة التربوية",
            NotificationManager.IMPORTANCE_DEFAULT
        );
        channel.setDescription("تذكير عام بمواعيد مراجعة المتابعات التربوية المحفوظة في تطبيق مُشرِفي.");
        channel.setLockscreenVisibility(Notification.VISIBILITY_PRIVATE);
        manager.createNotificationChannel(channel);
    }

    static boolean postNotification(Context context, JSONObject item) {
        if (!StudentFollowupReminderScheduler.hasNotificationPermission(context)) return false;
        ensureChannel(context);
        if (!StudentFollowupReminderScheduler.areNotificationsEnabled(context)) return false;

        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return false;

        // Keep lock-screen text generic: never expose student names, observations or actions.
        String title = "موعد مراجعة تربوية مستحق";
        String body = "يوجد سجل متابعة تربوية يحتاج إلى المراجعة داخل تطبيق مُشرِفي.";

        Intent launch = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
        PendingIntent content = null;
        if (launch != null) {
            launch.setFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            launch.putExtra("student_followup_review_notification", true);
            content = PendingIntent.getActivity(
                context, "student-followup-open".hashCode(), launch,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
            );
        }

        Notification.Builder builder = Build.VERSION.SDK_INT >= 26
            ? new Notification.Builder(context, StudentFollowupReminderScheduler.CHANNEL_ID)
            : new Notification.Builder(context);
        Notification.Builder configured = builder
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(new Notification.BigTextStyle().bigText(body))
            .setAutoCancel(true)
            .setOnlyAlertOnce(true)
            .setCategory(Notification.CATEGORY_REMINDER)
            .setVisibility(Notification.VISIBILITY_PRIVATE);
        if (Build.VERSION.SDK_INT < 26) configured.setPriority(Notification.PRIORITY_DEFAULT);
        if (content != null) configured.setContentIntent(content);

        try {
            manager.notify(("student-followup:" + item.optString("id", "")).hashCode(), configured.build());
            return true;
        } catch (SecurityException denied) {
            android.util.Log.w("MushrifiFollowup", "Notification permission/channel blocked reminder", denied);
            return false;
        }
    }
}
