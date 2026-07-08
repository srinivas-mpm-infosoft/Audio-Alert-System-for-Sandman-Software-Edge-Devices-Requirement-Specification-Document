const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const WORKING_DAYS = [0, 1, 2, 3, 4];

function to12h(hhmm) {
  if (!hhmm) return "—";
  const [h, m] = hhmm.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, "0")} ${period}`;
}

function minuteOfHour(timeOfDay) {
  const mm = Number((timeOfDay || "00:00").split(":")[1]);
  return Number.isNaN(mm) ? 0 : mm;
}

function joinDayNames(days) {
  const names = [...days].sort((a, b) => a - b).map((d) => DAY_NAMES[d]);
  if (names.length <= 1) return names[0] || "—";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

function whereText(s) {
  return s.plant_wide ? "on all Edge Nodes" : (s.zone_ids?.length ? `on ${s.zone_ids.join(", ")}` : "(no location chosen yet)");
}

function relativeOrAbsolute(iso) {
  if (!iso) return "at an unset time";
  const target = new Date(iso);
  const minutesAway = Math.round((target - new Date()) / 60000);
  if (minutesAway > 0 && minutesAway <= 90) {
    return `in about ${minutesAway} minute${minutesAway === 1 ? "" : "s"}`;
  }
  const datePart = target.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  const timePart = target.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
  return `on ${datePart} at ${timePart}`;
}

/** Resolve a "shift" schedule into a plain HH:MM using the same math as the
 * backend's compute_next_run, so the preview always matches what will
 * actually be scheduled. Returns null if the shift isn't configured. */
function resolveShiftTime(shiftsConfig, shiftName, shiftEvent, offsetMin) {
  const shift = shiftsConfig?.[shiftName];
  if (!shift) return null;
  const toMin = (hhmm) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };
  const startMin = toMin(shift.start);
  const endMin = toMin(shift.end);
  const targetMin = shiftEvent === "end" ? endMin : (((startMin + (offsetMin || 0)) % 1440) + 1440) % 1440;
  const hh = String(Math.floor(targetMin / 60)).padStart(2, "0");
  const mm = String(targetMin % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}

/** Human-readable one-sentence summary of a schedule. Shared by the
 * Scheduled Announcements list and the create/edit form's review step, so
 * operators always see the exact same sentence in both places. */
export function scheduleSummary(s, shiftsConfig) {
  const where = whereText(s);

  if (s.schedule_type === "once") {
    return `This will play ${relativeOrAbsolute(s.scheduled_at)}, ${where}.`;
  }

  if (s.schedule_type === "hourly") {
    const n = s.interval_hours || 1;
    const freq = n === 1 ? "every hour" : `every ${n} hours`;
    const minute = minuteOfHour(s.time_of_day);
    const minuteText = minute === 0 ? "on the hour" : `at ${minute} minutes past the hour`;
    return `This will play ${freq}, ${minuteText}, ${where}.`;
  }

  if (s.schedule_type === "daily") {
    return `This will play every day at ${to12h(s.time_of_day)}, ${where}.`;
  }

  if (s.schedule_type === "weekly") {
    const days = s.days_of_week || [];
    const label = WORKING_DAYS.every((d) => days.includes(d)) && days.length === 5
      ? "every working day (Monday to Friday)"
      : `every ${joinDayNames(days)}`;
    return `This will play ${label} at ${to12h(s.time_of_day)}, ${where}.`;
  }

  if (s.schedule_type === "shift") {
    const shiftLabel = s.shift_name || "the shift";
    if (s.shift_event === "start") return `This will play at the start of ${shiftLabel} shift, ${where}.`;
    if (s.shift_event === "end") return `This will play at the end of ${shiftLabel} shift, ${where}.`;
    const resolved = shiftsConfig ? resolveShiftTime(shiftsConfig, s.shift_name, s.shift_event, s.shift_offset_min) : null;
    const offset = s.shift_offset_min || 0;
    const whenPhrase = offset === 0
      ? "at the start of"
      : offset < 0
        ? `${Math.abs(offset)} minute${Math.abs(offset) === 1 ? "" : "s"} before`
        : `${offset} minute${offset === 1 ? "" : "s"} after`;
    const timeSuffix = resolved ? ` (${to12h(resolved)})` : "";
    return `This will play ${whenPhrase} ${shiftLabel} shift starts${timeSuffix}, ${where}.`;
  }

  return `Schedule: ${s.schedule_type}, ${where}.`;
}
