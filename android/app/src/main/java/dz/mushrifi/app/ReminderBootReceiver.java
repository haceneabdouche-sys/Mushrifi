package dz.mushrifi.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;

import java.util.HashSet;

public class ReminderBootReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context, Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        if (!Intent.ACTION_BOOT_COMPLETED.equals(action)
            && !Intent.ACTION_TIME_CHANGED.equals(action)
            && !Intent.ACTION_TIMEZONE_CHANGED.equals(action)
            && !Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)
            && !AlarmPermissionAction.ACTION.equals(action)) return;

        // Preserve the existing parent-summons reminder schedule.
        SharedPreferences summons = context.getSharedPreferences("summons_reminders", Context.MODE_PRIVATE);
        for (String id : new HashSet<>(summons.getAll().keySet())) {
            String value = summons.getString(id, "");
            String[] parts = value.split("\\|", 3);
            if (parts.length != 2 && parts.length != 3) {
                MainActivity.cancelReminder(context, id);
                summons.edit().remove(id).apply();
                continue;
            }
            try {
                long reminder = parts.length == 2
                    ? Long.parseLong(parts[1]) - 24L * 60L * 60L * 1000L
                    : Long.parseLong(parts[1]);
                if (reminder <= System.currentTimeMillis()) {
                    MainActivity.cancelReminder(context, id);
                    summons.edit().remove(id).apply();
                } else {
                    MainActivity.scheduleReminder(context, id, parts[0], reminder);
                }
            } catch (NumberFormatException invalid) {
                MainActivity.cancelReminder(context, id);
                summons.edit().remove(id).apply();
            }
        }

        // Agenda alarms are rebuilt from local calendar date/time so timezone and clock changes are honored.
        AgendaReminderScheduler.rescheduleAll(context);
    }

    private static final class AlarmPermissionAction {
        static final String ACTION = "android.app.action.SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED";
    }
}
