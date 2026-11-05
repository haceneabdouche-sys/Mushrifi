package dz.mushrifi.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;

public class ReminderBootReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context, Intent intent) {
        if (!Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())) return;
        SharedPreferences prefs = context.getSharedPreferences("summons_reminders", Context.MODE_PRIVATE);
        for (String id : prefs.getAll().keySet()) {
            String value = prefs.getString(id, "");
            String[] parts = value.split("\\|", 2);
            if (parts.length != 2) continue;
            try {
                long appointment = Long.parseLong(parts[1]);
                MainActivity.scheduleReminder(context, id, parts[0], appointment - 24L * 60L * 60L * 1000L);
            } catch (NumberFormatException ignored) { }
        }
    }
}
