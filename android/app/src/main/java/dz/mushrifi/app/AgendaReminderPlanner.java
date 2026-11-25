package dz.mushrifi.app;

import java.util.Calendar;
import java.util.GregorianCalendar;
import java.util.Locale;
import java.util.TimeZone;

/** Pure local-time planner shared by agenda reminder scheduling and JVM regression tests. */
public final class AgendaReminderPlanner {
    public static final int DEFAULT_ALL_DAY_HOUR = 8;
    public static final int LEAD_AT_TIME = 0;
    public static final int LEAD_ONE_HOUR = 60;
    public static final int LEAD_ONE_DAY = 1440;

    private AgendaReminderPlanner() {}

    public static boolean isAllowedLeadMinutes(int leadMinutes) {
        return leadMinutes == LEAD_AT_TIME || leadMinutes == LEAD_ONE_HOUR || leadMinutes == LEAD_ONE_DAY;
    }

    public static long appointmentMillis(String isoDate, String eventTime, TimeZone zone) {
        if (isoDate == null || !isoDate.matches("\\d{4}-\\d{2}-\\d{2}")) {
            throw new IllegalArgumentException("تاريخ الموعد غير صالح");
        }
        String time = eventTime == null || eventTime.trim().isEmpty()
            ? String.format(Locale.US, "%02d:00", DEFAULT_ALL_DAY_HOUR)
            : eventTime.trim();
        if (!time.matches("(?:[01]\\d|2[0-3]):[0-5]\\d")) {
            throw new IllegalArgumentException("وقت الموعد غير صالح");
        }
        String[] dateParts = isoDate.split("-");
        String[] timeParts = time.split(":");
        int year = Integer.parseInt(dateParts[0]);
        int month = Integer.parseInt(dateParts[1]);
        int day = Integer.parseInt(dateParts[2]);
        int hour = Integer.parseInt(timeParts[0]);
        int minute = Integer.parseInt(timeParts[1]);

        GregorianCalendar calendar = new GregorianCalendar(
            zone == null ? TimeZone.getDefault() : zone, Locale.US
        );
        calendar.setLenient(false);
        calendar.clear();
        calendar.set(Calendar.YEAR, year);
        calendar.set(Calendar.MONTH, month - 1);
        calendar.set(Calendar.DAY_OF_MONTH, day);
        calendar.set(Calendar.HOUR_OF_DAY, hour);
        calendar.set(Calendar.MINUTE, minute);
        calendar.set(Calendar.SECOND, 0);
        calendar.set(Calendar.MILLISECOND, 0);
        try {
            return calendar.getTimeInMillis();
        } catch (IllegalArgumentException invalidDate) {
            throw new IllegalArgumentException("تاريخ أو وقت الموعد غير موجود في التقويم المحلي", invalidDate);
        }
    }

    public static long reminderMillis(String isoDate, String eventTime, int leadMinutes, TimeZone zone) {
        if (!isAllowedLeadMinutes(leadMinutes)) {
            throw new IllegalArgumentException("مدة التنبيه قبل الموعد غير مدعومة");
        }
        long appointment = appointmentMillis(isoDate, eventTime, zone);
        GregorianCalendar calendar = new GregorianCalendar(
            zone == null ? TimeZone.getDefault() : zone, Locale.US
        );
        calendar.setTimeInMillis(appointment);
        if (leadMinutes == LEAD_ONE_DAY) {
            calendar.add(Calendar.DAY_OF_MONTH, -1);
        } else if (leadMinutes == LEAD_ONE_HOUR) {
            calendar.add(Calendar.HOUR_OF_DAY, -1);
        }
        return calendar.getTimeInMillis();
    }
}
