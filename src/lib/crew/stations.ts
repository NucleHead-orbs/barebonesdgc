/**
 * Volunteer station grid: pure helpers (no Supabase).
 * Source of truth: stations (need) + station_needs (per-shift override) + station_slots (who, claimed or assigned).
 * A shift = (day, half): day 0 = first event day, half AM | PM. Always AM + PM for every event day,
 * independent of the scoring waves (volunteers work both rounds).
 */
import { addDays, fmtDay } from '../prep/prep';

export type Half = 'AM' | 'PM';
export interface Shift { day: number; half: Half; key: string; label: string; date: string }
export interface Station { id: string; name: string; need: number; notes: string | null; sort: number; needs: Array<{ day: number; half: Half; need: number }> }
export interface Slot { id: string; station_id: string; day: number; half: Half; crew_id: string; name?: string; claimed: boolean }

/** The starter stations (Spotters needs a few; everything else one per shift until changed). */
export const STARTER_STATIONS: Array<{ name: string; need: number }> = [
  { name: 'Spotters', need: 4 }, { name: 'Check In', need: 2 }, { name: 'Player Packs', need: 1 },
  { name: 'Tee Signs', need: 1 }, { name: 'Water & Ice', need: 1 },
];

export const shiftKey = (day: number, half: Half) => `${day}:${half}`;

/** Every event day × AM/PM, in order. Capped at 14 days (the database limit). */
export function shifts(startsOn: string, endsOn: string): Shift[] {
  const [a, b] = [startsOn, endsOn].map((s) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); });
  const days = Math.min(14, Math.max(1, Math.round((b - a) / 86_400_000) + 1));
  const multi = days > 1;
  const out: Shift[] = [];
  for (let day = 0; day < days; day++) {
    const date = addDays(startsOn, day);
    for (const half of ['AM', 'PM'] as Half[]) {
      out.push({ day, half, key: shiftKey(day, half), date, label: multi ? `${fmtDay(date).split(',')[0]} ${half}` : half });
    }
  }
  return out;
}

export const needFor = (s: Pick<Station, 'need' | 'needs'>, day: number, half: Half) =>
  s.needs.find((n) => n.day === day && n.half === half)?.need ?? s.need;

export interface Cell { station: Station; shift: Shift; need: number; slots: Slot[]; short: number; over: number }
export function cell(station: Station, shift: Shift, slots: Slot[]): Cell {
  const mine = slots.filter((x) => x.station_id === station.id && x.day === shift.day && x.half === shift.half);
  const need = needFor(station, shift.day, shift.half);
  return { station, shift, need, slots: mine, short: Math.max(0, need - mine.length), over: Math.max(0, mine.length - need) };
}

/** People in more than one station in the same shift: key "crewId@day:half" -> station names. */
export function doubleBooked(slots: Slot[], stations: Station[]): Map<string, string[]> {
  const name = new Map(stations.map((s) => [s.id, s.name]));
  const by = new Map<string, string[]>();
  for (const x of slots) {
    const k = `${x.crew_id}@${shiftKey(x.day, x.half)}`;
    by.set(k, [...(by.get(k) ?? []), name.get(x.station_id) ?? '?']);
  }
  return new Map([...by].filter(([, v]) => v.length > 1));
}
export const isDouble = (dbl: Map<string, string[]>, x: Pick<Slot, 'crew_id' | 'day' | 'half'>) => dbl.has(`${x.crew_id}@${shiftKey(x.day, x.half)}`);

/** Whole-grid summary for the header. */
export function gridSummary(stations: Station[], sh: Shift[], slots: Slot[]) {
  let need = 0, filled = 0, shortCells = 0;
  for (const s of stations) for (const t of sh) {
    const c = cell(s, t, slots);
    need += c.need; filled += Math.min(c.need, c.slots.length);
    if (c.short) shortCells++;
  }
  const valid = new Set(sh.map((t) => t.key));
  const people = new Set(slots.filter((x) => valid.has(shiftKey(x.day, x.half))).map((x) => x.crew_id));
  return { need, filled, open: need - filled, shortCells, conflicts: doubleBooked(slots, stations).size, people: people.size };
}

/** One person's shifts, in time order: "Sat AM · Spotters". */
export function myShifts(crewId: string, stations: Station[], sh: Shift[], slots: Slot[]) {
  const name = new Map(stations.map((s) => [s.id, s.name]));
  const order = new Map(sh.map((t, i) => [t.key, i]));
  return slots.filter((x) => x.crew_id === crewId && order.has(shiftKey(x.day, x.half)))
    .sort((a, b) => (order.get(shiftKey(a.day, a.half))! - order.get(shiftKey(b.day, b.half))!) || (name.get(a.station_id) ?? '').localeCompare(name.get(b.station_id) ?? ''))
    .map((x) => ({ slot: x, shift: sh[order.get(shiftKey(x.day, x.half))!], station: name.get(x.station_id) ?? '?' }));
}

/** Starter stations not already on the event (case/space-insensitive). */
export function starterStationsToAdd(existing: Array<Pick<Station, 'name' | 'sort'>>) {
  const have = new Set(existing.map((s) => s.name.trim().toLowerCase()));
  let sort = Math.max(-1, ...existing.map((s) => s.sort)) + 1;
  return STARTER_STATIONS.filter((s) => !have.has(s.name.toLowerCase())).map((s) => ({ ...s, sort: sort++ }));
}

/** CSV for printing / sharing: one row per station, one column per shift. */
export function gridCsv(stations: Station[], sh: Shift[], slots: Slot[], nameOf: (crewId: string) => string): string {
  const q = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const head = ['Station', ...sh.map((t) => `${fmtDay(t.date)} ${t.half}`)];
  const rows = stations.map((s) => [s.name, ...sh.map((t) => {
    const c = cell(s, t, slots);
    const names = c.slots.map((x) => nameOf(x.crew_id));
    return [...names, ...Array(c.short).fill('OPEN')].join(' / ') || (c.need ? '' : '—');
  })]);
  return [head, ...rows].map((r) => r.map(q).join(',')).join('\r\n') + '\r\n';
}
