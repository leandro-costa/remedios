const LOCALE = "pt-BR";

export function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

export function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** "08:05" */
export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(LOCALE, { hour: "2-digit", minute: "2-digit" });
}

/** "Qui, 22 out." */
export function formatDay(date: Date): string {
  const text = date.toLocaleDateString(LOCALE, { weekday: "short", day: "numeric", month: "short" });
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** "Hoje · 08:05", "Ontem · 20:10", "20/10 · 08:00" */
export function formatWhen(iso: string, now = new Date()): string {
  const date = new Date(iso);
  const day = sameDay(date, now) ? "Hoje" : sameDay(date, addDays(now, -1)) ? "Ontem"
    : sameDay(date, addDays(now, 1)) ? "Amanhã"
    : date.toLocaleDateString(LOCALE, { day: "2-digit", month: "2-digit" });
  return `${day} · ${formatTime(iso)}`;
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(LOCALE, { day: "2-digit", month: "2-digit", year: "numeric" });
}

/** "há 5 min" */
export function formatAgo(ms: number, now = Date.now()): string {
  const minutes = Math.round((now - ms) / 60_000);
  if (minutes < 1) return "agora";
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `há ${hours} h`;
  return `há ${Math.round(hours / 24)} dias`;
}

/** Valor para <input type="datetime-local"> no fuso do aparelho. */
export function toLocalInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Converte o valor de <input type="datetime-local"> para ISO (UTC). */
export function fromLocalInput(value: string): string {
  return new Date(value).toISOString();
}

export function deviceTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}
