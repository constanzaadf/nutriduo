/** Fechas como texto YYYY-MM-DD, siempre en la zona horaria del hogar. */

export function todayIn(timeZone: string, now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  return parts; // en-CA → YYYY-MM-DD
}

function toUtc(d: string): Date {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, day!));
}

function fmt(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(d: string, n: number): string {
  const x = toUtc(d);
  x.setUTCDate(x.getUTCDate() + n);
  return fmt(x);
}

/** Semana ISO "YYYY-Www" (lunes a domingo), igual que public.iso_week_of en la base. */
export function isoWeekOf(d: string): string {
  const x = toUtc(d);
  const dow = (x.getUTCDay() + 6) % 7; // 0 = lunes
  x.setUTCDate(x.getUTCDate() - dow + 3); // jueves de esa semana
  const year = x.getUTCFullYear();
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const week = 1 + Math.round(((x.getTime() - jan4.getTime()) / 864e5 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

export function mondayOf(isoWeek: string): string {
  const m = /^(\d{4})-W(\d{2})$/.exec(isoWeek);
  if (!m) throw new RangeError(`Semana inválida: ${isoWeek}`);
  const year = Number(m[1]);
  const week = Number(m[2]);
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4dow = (jan4.getUTCDay() + 6) % 7;
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - jan4dow + (week - 1) * 7);
  return fmt(monday);
}

export function weekDays(isoWeek: string): string[] {
  const mon = mondayOf(isoWeek);
  return Array.from({ length: 7 }, (_, i) => addDays(mon, i));
}

export function shiftWeek(isoWeek: string, n: number): string {
  return isoWeekOf(addDays(mondayOf(isoWeek), n * 7));
}

/** 0 = domingo … 6 = sábado (convención del motor de metas). */
export function weekdayIndex(d: string): number {
  return toUtc(d).getUTCDay();
}

const DAY_SHORT = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
const MONTH_SHORT = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

export function dayLabel(d: string): string {
  const x = toUtc(d);
  return `${DAY_SHORT[x.getUTCDay()]} ${x.getUTCDate()}`;
}

export function longDate(d: string): string {
  const x = toUtc(d);
  const days = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
  return `${days[x.getUTCDay()]} ${x.getUTCDate()} de ${MONTH_SHORT[x.getUTCMonth()]}`;
}

export function weekRangeLabel(isoWeek: string): string {
  const days = weekDays(isoWeek);
  const a = toUtc(days[0]!);
  const b = toUtc(days[6]!);
  return a.getUTCMonth() === b.getUTCMonth()
    ? `${a.getUTCDate()} al ${b.getUTCDate()} de ${MONTH_SHORT[b.getUTCMonth()]}`
    : `${a.getUTCDate()} de ${MONTH_SHORT[a.getUTCMonth()]} al ${b.getUTCDate()} de ${MONTH_SHORT[b.getUTCMonth()]}`;
}
