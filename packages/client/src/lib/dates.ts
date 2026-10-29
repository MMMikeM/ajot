// Device locale throughout: "2 Oct" on en-GB, "Oct 2" on en-US
const thisYearFormat = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
const otherYearFormat = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
});
const timeFormat = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });

/** The day `at` falls on in the device's time zone. */
const localDay = (at: Date) =>
  Temporal.PlainDate.from({ year: at.getFullYear(), month: at.getMonth() + 1, day: at.getDate() });

/** How many days `day` is after the device's today: 1 for tomorrow, -1 for yesterday. */
const daysFromToday = (day: Temporal.PlainDate) =>
  day.since(Temporal.Now.plainDateISO(), { largestUnit: "day" }).days;

/** "Oct 2", with the year when it isn't this year's, or last November's would read as next month's. */
const formatDay = (day: Temporal.PlainDate) =>
  // A Date, not the PlainDate: under the temporal polyfill native Intl can't format a PlainDate
  (day.year === Temporal.Now.plainDateISO().year ? thisYearFormat : otherYearFormat).format(
    new Date(day.year, day.month - 1, day.day),
  );

/**
 * A due date as the list shows it, and as a screen reader says it. A past one stays a date, so it
 * reads as when the task was due rather than as its age.
 */
export const formatDueDate = (due: string) => {
  const day = Temporal.PlainDate.from(due.slice(0, 10));
  const days = daysFromToday(day);
  if (days === 0) return { label: "Today", spoken: "Today", overdue: false };
  if (days === 1) return { label: "Tomorrow", spoken: "Tomorrow", overdue: false };
  const label = formatDay(day);
  const overdue = days < 0;
  return { label, spoken: overdue ? `${label}, overdue` : label, overdue };
};

/** A due date in full, as the task sheet shows it: the time and year only when they say something. */
export const formatDueDateTime = (due: string) => {
  const dt = Temporal.PlainDateTime.from(due);
  return dt.toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    ...(dt.year !== Temporal.Now.plainDateISO().year && { year: "numeric" }),
    ...(due.length > 10 && { hour: "numeric", minute: "2-digit" }),
  });
};

const writtenDay = (day: Temporal.PlainDate) => {
  const days = daysFromToday(day);
  if (days === 0) return "Today";
  if (days === -1) return "Yesterday";
  return formatDay(day);
};

/** When something was written, in the device's zone: "Today, 18:02", "Yesterday, 21:40", "Oct 25, 09:14". */
export const formatWritten = (createdAt: string) => {
  const at = new Date(createdAt);
  const day = localDay(at);
  return `${writtenDay(day)}, ${timeFormat.format(at)}`;
};
