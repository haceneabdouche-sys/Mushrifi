package dz.mushrifi.app;

import java.util.Calendar;
import java.util.GregorianCalendar;
import java.util.Locale;
import java.util.TimeZone;

/** Local-calendar planner for date-only educational follow-up reviews. */
public final class StudentFollowupReminderPlanner {
    public static final int DEFAULT_REVIEW_HOUR = 8;
    public static final long MAX_LATE_DELIVERY_MS = 7L * 24L * 60L * 60L * 1000L;

    private StudentFollowupReminderPlanner() {}

    public static long reviewReminderMillis(String isoDate, TimeZone zone) {
        if (isoDate == null || !isoDate.matches("\\d{4}-\\d{2}-\\d{2}")) {
            throw new IllegalArgumentException("تاريخ المراجعة التربوية غير صالح");
        }
        String[] parts = isoDate.split("-");
        int year = Integer.parseInt(parts[0]);
        int month = Integer.parseInt(parts[1]);
        int day = Integer.parseInt(parts[2]);

        GregorianCalendar calendar = new GregorianCalendar(
            zone == null ? TimeZone.getDefault() : zone, Locale.US
        );
        calendar.setLenient(false);
        calendar.clear();
        calendar.set(Calendar.YEAR, year);
        calendar.set(Calendar.MONTH, month - 1);
        calendar.set(Calendar.DAY_OF_MONTH, day);
        calendar.set(Calendar.HOUR_OF_DAY, DEFAULT_REVIEW_HOUR);
        calendar.set(Calendar.MINUTE, 0);
        calendar.set(Calendar.SECOND, 0);
        calendar.set(Calendar.MILLISECOND, 0);
        try {
            return calendar.getTimeInMillis();
        } catch (IllegalArgumentException invalidDate) {
            throw new IllegalArgumentException("تاريخ المراجعة التربوية غير موجود في التقويم المحلي", invalidDate);
        }
    }

    public static boolean isWithinDeliveryWindow(long reminderAt, long now) {
        return reminderAt > 0L && now >= reminderAt
            && now - reminderAt <= MAX_LATE_DELIVERY_MS;
    }
}
