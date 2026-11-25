package dz.mushrifi.app;

import java.util.Calendar;
import java.util.TimeZone;

public final class AgendaReminderPlannerTest {
    private static void check(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
    }

    private static Calendar local(long millis, TimeZone zone) {
        Calendar calendar = Calendar.getInstance(zone);
        calendar.setTimeInMillis(millis);
        return calendar;
    }

    private static void expectInvalid(Runnable action, String message) {
        boolean failed = false;
        try { action.run(); } catch (IllegalArgumentException expected) { failed = true; }
        check(failed, message);
    }

    public static void main(String[] args) {
        TimeZone original = TimeZone.getDefault();
        try {
            TimeZone algiers = TimeZone.getTimeZone("Africa/Algiers");
            TimeZone.setDefault(algiers);

            long meeting = AgendaReminderPlanner.appointmentMillis("2026-11-27", "09:30", null);
            Calendar c = local(meeting, algiers);
            check(c.get(Calendar.YEAR) == 2026 && c.get(Calendar.MONTH) == Calendar.NOVEMBER
                && c.get(Calendar.DAY_OF_MONTH) == 27 && c.get(Calendar.HOUR_OF_DAY) == 9
                && c.get(Calendar.MINUTE) == 30, "meeting appointment uses phone local time");

            long atTime = AgendaReminderPlanner.reminderMillis("2026-11-27", "09:30", 0, null);
            check(atTime == meeting, "at-time reminder is exactly at appointment time");

            long oneHour = AgendaReminderPlanner.reminderMillis("2026-11-27", "09:30", 60, null);
            Calendar hour = local(oneHour, algiers);
            check(hour.get(Calendar.DAY_OF_MONTH) == 27 && hour.get(Calendar.HOUR_OF_DAY) == 8
                && hour.get(Calendar.MINUTE) == 30, "one-hour reminder retains local minute");

            long oneDay = AgendaReminderPlanner.reminderMillis("2026-11-27", "09:30", 1440, null);
            Calendar day = local(oneDay, algiers);
            check(day.get(Calendar.DAY_OF_MONTH) == 26 && day.get(Calendar.HOUR_OF_DAY) == 9
                && day.get(Calendar.MINUTE) == 30, "one-day reminder uses same local clock time on previous day");

            long yearBoundary = AgendaReminderPlanner.reminderMillis("2027-01-01", "08:00", 1440, null);
            Calendar year = local(yearBoundary, algiers);
            check(year.get(Calendar.YEAR) == 2026 && year.get(Calendar.MONTH) == Calendar.DECEMBER
                && year.get(Calendar.DAY_OF_MONTH) == 31 && year.get(Calendar.HOUR_OF_DAY) == 8,
                "one-day reminder crosses year boundary");

            long leapDay = AgendaReminderPlanner.reminderMillis("2024-03-01", "08:00", 1440, null);
            Calendar leap = local(leapDay, algiers);
            check(leap.get(Calendar.YEAR) == 2024 && leap.get(Calendar.MONTH) == Calendar.FEBRUARY
                && leap.get(Calendar.DAY_OF_MONTH) == 29, "one-day reminder respects leap day");

            long allDay = AgendaReminderPlanner.appointmentMillis("2026-11-27", "", null);
            Calendar allDayCalendar = local(allDay, algiers);
            check(allDayCalendar.get(Calendar.HOUR_OF_DAY) == 8 && allDayCalendar.get(Calendar.MINUTE) == 0,
                "events without a clock use 08:00 local time");

            TimeZone paris = TimeZone.getTimeZone("Europe/Paris");
            long dstAppointment = AgendaReminderPlanner.appointmentMillis("2027-03-28", "10:00", paris);
            long dstReminder = AgendaReminderPlanner.reminderMillis("2027-03-28", "10:00", 1440, paris);
            Calendar dst = local(dstReminder, paris);
            check(dst.get(Calendar.YEAR) == 2027 && dst.get(Calendar.MONTH) == Calendar.MARCH
                && dst.get(Calendar.DAY_OF_MONTH) == 27 && dst.get(Calendar.HOUR_OF_DAY) == 10,
                "one-day reminder preserves local clock on the day before daylight-saving transition");
            check(dstAppointment - dstReminder == 23L * 60L * 60L * 1000L,
                "DST transition produces the correct 23-hour local-day interval rather than a fixed 24-hour shift");

            expectInvalid(() -> AgendaReminderPlanner.appointmentMillis("2026-02-29", "09:00", algiers),
                "invalid non-leap date must be rejected");
            expectInvalid(() -> AgendaReminderPlanner.appointmentMillis("2026-11-27", "25:00", algiers),
                "invalid clock time must be rejected");
            expectInvalid(() -> AgendaReminderPlanner.reminderMillis("2026-11-27", "09:00", 30, algiers),
                "unsupported lead time must be rejected");
            expectInvalid(() -> AgendaReminderPlanner.appointmentMillis("2027-03-28", "02:30", paris),
                "nonexistent local time during DST gap must be rejected");

            System.out.println("PASS: Java agenda planner local-time, all-day, one-hour, one-day, year-boundary, leap-year, DST and invalid-input tests.");
        } finally {
            TimeZone.setDefault(original);
        }
    }
}
