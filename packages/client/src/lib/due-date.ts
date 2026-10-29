// Device locale: "2 Oct" on en-GB, "Oct 2" on en-US. A past one stays a date too, so it reads as
// when the task was due rather than as its age; another year's says so, or last November's would
// read as next month's.
const thisYearFormat = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
const otherYearFormat = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
});

/** A day as the list shows a date: "Oct 2", with the year when it isn't this year's. */
export const formatDay = (date: Temporal.PlainDate, today = Temporal.Now.plainDateISO()) =>
  // A Date, not the PlainDate: under the temporal polyfill native Intl can't format a PlainDate
  (date.year === today.year ? thisYearFormat : otherYearFormat).format(
    new Date(date.year, date.month - 1, date.day),
  );

/** A due date as the list shows it, relative to the device's today, and as a screen reader says it. */
export const formatDueDate = (dateStr: string) => {
  const date = Temporal.PlainDate.from(dateStr.slice(0, 10));
  const today = Temporal.Now.plainDateISO();
  const diffDays = date.since(today, { largestUnit: "day" }).days;

  if (diffDays === 0) return { label: "Today", spoken: "Today", overdue: false };
  if (diffDays === 1) return { label: "Tomorrow", spoken: "Tomorrow", overdue: false };
  const label = formatDay(date, today);
  const overdue = diffDays < 0;
  return { label, spoken: overdue ? `${label}, overdue` : label, overdue };
};
