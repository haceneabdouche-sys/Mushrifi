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
        if (Build.VERSION.SDK_INT >= 33 && context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return;
        Intent launch = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
        PendingIntent content = PendingIntent.getActivity(context, 0, launch, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder builder = Build.VERSION.SDK_INT >= 26
            ? new Notification.Builder(context, "guardian_summons")
            : new Notification.Builder(context);
        Notification notification = builder.setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle("تذكير: موعد حضور ولي")
            .setContentText("غداً موعد حضور ولي التلميذ: " + student)
            .setStyle(new Notification.BigTextStyle().bigText("تذكير قبل يوم واحد: غداً موعد حضور ولي التلميذ " + student))
            .setAutoCancel(true).setContentIntent(content).build();
        ((NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE)).notify(intent.getStringExtra("id") == null ? 1 : intent.getStringExtra("id").hashCode(), notification);
    }
}
