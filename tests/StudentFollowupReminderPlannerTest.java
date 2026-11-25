package dz.mushrifi.app;

import java.util.Calendar;
import java.util.TimeZone;

public final class StudentFollowupReminderPlannerTest {
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

            long due = StudentFollowupReminderPlanner.reviewReminderMillis("2026-11-25", null);
            Calendar dueLocal = local(due, algiers);
            check(dueLocal.get(Calendar.YEAR) == 2026
                && dueLocal.get(Calendar.MONTH) == Calendar.NOVEMBER
                && dueLocal.get(Calendar.DAY_OF_MONTH) == 25
                && dueLocal.get(Calendar.HOUR_OF_DAY) == 8
                && dueLocal.get(Calendar.MINUTE) == 0,
                "date-only follow-up review reminders use 08:00 in the phone local timezone");

            long leap = StudentFollowupReminderPlanner.reviewReminderMillis("2024-02-29", algiers);
            Calendar leapLocal = local(leap, algiers);
            check(leapLocal.get(Calendar.YEAR) == 2024
                && leapLocal.get(Calendar.MONTH) == Calendar.FEBRUARY
                && leapLocal.get(Calendar.DAY_OF_MONTH) == 29
                && leapLocal.get(Calendar.HOUR_OF_DAY) == 8,
                "leap-day review date is preserved");

            long yearBoundary = StudentFollowupReminderPlanner.reviewReminderMillis("2027-01-01", algiers);
            Calendar year = local(yearBoundary, algiers);
            check(year.get(Calendar.YEAR) == 2027
                && year.get(Calendar.MONTH) == Calendar.JANUARY
                && year.get(Calendar.DAY_OF_MONTH) == 1,
                "year-boundary review date is preserved");

            TimeZone paris = TimeZone.getTimeZone("Europe/Paris");
            long dst = StudentFollowupReminderPlanner.reviewReminderMillis("2027-03-28", paris);
            Calendar dstLocal = local(dst, paris);
            check(dstLocal.get(Calendar.HOUR_OF_DAY) == 8 && dstLocal.get(Calendar.DAY_OF_MONTH) == 28,
                "daylight-saving changes preserve the selected local review hour");

            long now = due + 6L * 24L * 60L * 60L * 1000L;
            check(StudentFollowupReminderPlanner.isWithinDeliveryWindow(due, now),
                "missed reminders are deliverable within the seven-day recovery window");
            check(!StudentFollowupReminderPlanner.isWithinDeliveryWindow(
                due, due + StudentFollowupReminderPlanner.MAX_LATE_DELIVERY_MS + 1L),
                "stale reminders older than seven days are not delivered");
            check(!StudentFollowupReminderPlanner.isWithinDeliveryWindow(due, due - 1L),
                "future reminders are not delivered early");
            check(!StudentFollowupReminderPlanner.isWithinDeliveryWindow(0L, due),
                "zero timestamps are rejected");

            expectInvalid(() -> StudentFollowupReminderPlanner.reviewReminderMillis("2026-02-29", algiers),
                "invalid non-leap date must be rejected");
            expectInvalid(() -> StudentFollowupReminderPlanner.reviewReminderMillis("2026-13-01", algiers),
                "invalid month must be rejected");
            expectInvalid(() -> StudentFollowupReminderPlanner.reviewReminderMillis("2026-11-31", algiers),
                "invalid day must be rejected");
            expectInvalid(() -> StudentFollowupReminderPlanner.reviewReminderMillis("25-11-2026", algiers),
                "non-ISO date format must be rejected");

            System.out.println("PASS: educational follow-up reminder local-time, default-hour, leap-year, year-boundary, timezone, seven-day recovery-window and invalid-input tests.");
        } finally {
            TimeZone.setDefault(original);
        }
    }
}
