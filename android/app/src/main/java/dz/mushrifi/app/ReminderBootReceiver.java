package dz.mushrifi.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;

public class ReminderBootReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context, Intent intent) {
        if (!Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())) return;
        SharedPreferences prefs = context.getSharedPreferences("summons_reminders", Context.MODE_PRIVATE);
        for (String id : new java.util.HashSet<>(prefs.getAll().keySet())) {
            String value = prefs.getString(id, "");
            String[] parts = value.split("\\|", 3);
            if (parts.length != 2 && parts.length != 3) { prefs.edit().remove(id).apply(); continue; }
            try {
                long reminder = parts.length == 2 ? Long.parseLong(parts[1]) - 24L * 60L * 60L * 1000L : Long.parseLong(parts[1]);
                if (reminder <= System.currentTimeMillis()) {
                    MainActivity.cancelReminder(context, id);
                    prefs.edit().remove(id).apply();
                } else {
                    MainActivity.scheduleReminder(context, id, parts[0], reminder);
                }
            } catch (NumberFormatException ignored) { prefs.edit().remove(id).apply(); }
        }
    }
}
