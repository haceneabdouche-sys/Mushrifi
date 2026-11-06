package dz.mushrifi.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.app.Notification;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.os.Build;
import android.Manifest;
import android.content.pm.PackageManager;

public class SummonsReminderReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context, Intent intent) {
        String student = intent.getStringExtra("student");
        if (student == null) student = "التلميذ";
        String id = intent.getStringExtra("id");
        postNotification(context, id == null ? "summons" : id, student);
    }

    public static boolean postNotification(Context context, String id, String student) {
        if (Build.VERSION.SDK_INT >= 33 && context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return false;
        Intent launch = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
        PendingIntent content = launch == null ? null : PendingIntent.getActivity(context, 0, launch, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder builder = Build.VERSION.SDK_INT >= 26
            ? new Notification.Builder(context, "guardian_summons")
            : new Notification.Builder(context);
        boolean test = "mushrifi-test".equals(id);
        String title = test ? "اختبار إشعارات مُشرِفي" : "تذكير: موعد حضور ولي";
        String body = test ? "هذا إشعار تجريبي من تطبيق مُشرِفي. نظام الإشعارات يعمل." : "تذكير بموعد حضور ولي التلميذ: " + student;
        Notification.Builder configured = builder.setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(new Notification.BigTextStyle().bigText(body))
            .setAutoCancel(true);
        if (content != null) configured.setContentIntent(content);
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return false;
        manager.notify(id == null ? 1 : id.hashCode(), configured.build());
        return true;
    }
}
