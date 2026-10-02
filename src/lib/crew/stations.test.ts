import { describe, it, expect } from 'vitest';
import { cell, doubleBooked, gridCsv, gridSummary, isDouble, myShifts, needFor, shifts, starterStationsToAdd, type Slot, type Station } from './stations';

const st = (id: string, name: string, need: number, needs: Station['needs'] = []): Station => ({ id, name, need, notes: null, sort: 0, needs });
const sl = (id: string, station_id: string, day: number, half: 'AM' | 'PM', crew_id: string, claimed = false): Slot => ({ id, station_id, day, half, crew_id, claimed });

describe('shifts', () => {
  it('every event day gets AM and PM, labeled by weekday', () => {
    const s = shifts('2026-11-21', '2026-11-22');
    expect(s.map((x) => x.key)).toEqual(['0:AM', '0:PM', '1:AM', '1:PM']);
    expect(s.map((x) => x.label)).toEqual(['Sat AM', 'Sat PM', 'Sun AM', 'Sun PM']);
  });
  it('one-day events label just AM / PM', () => {
    expect(shifts('2026-10-05', '2026-10-05').map((x) => x.label)).toEqual(['AM', 'PM']);
  });
});

describe('cells', () => {
  const spot = st('s', 'Spotters', 2, [{ day: 1, half: 'PM', need: 0 }]);
  const water = st('w', 'Water & Ice', 1);
  const slots = [sl('1', 's', 0, 'AM', 'amy'), sl('2', 'w', 0, 'AM', 'amy'), sl('3', 's', 0, 'AM', 'bo'), sl('4', 's', 0, 'AM', 'cy'), sl('5', 's', 7, 'AM', 'dee')];
  const sh = shifts('2026-11-21', '2026-11-22');
  it('per-shift overrides beat the station default', () => {
    expect(needFor(spot, 0, 'AM')).toBe(2);
    expect(needFor(spot, 1, 'PM')).toBe(0);
  });
  it('counts short and over', () => {
    expect(cell(spot, sh[0], slots)).toMatchObject({ need: 2, short: 0, over: 1 });
    expect(cell(spot, sh[1], slots)).toMatchObject({ need: 2, short: 2, over: 0 });
  });
  it('flags someone in two stations in one shift', () => {
    const d = doubleBooked(slots, [spot, water]);
    expect([...d]).toEqual([['amy@0:AM', ['Spotters', 'Water & Ice']]]);
    expect(isDouble(d, slots[0])).toBe(true);
    expect(isDouble(d, slots[2])).toBe(false);
  });
  it('summarizes the grid, ignoring slots on days that no longer exist', () => {
    // need: spotters 2+2+2+0, water 1x4 = 10; filled: spotters AM0 2 (capped), water AM0 1 = 3
    expect(gridSummary([spot, water], sh, slots)).toEqual({ need: 10, filled: 3, open: 7, shortCells: 5, conflicts: 1, people: 3 });
  });
  it("lists one person's shifts in time order", () => {
    expect(myShifts('amy', [spot, water], sh, slots).map((x) => `${x.shift.label} · ${x.station}`)).toEqual(['Sat AM · Spotters', 'Sat AM · Water & Ice']);
    expect(myShifts('dee', [spot, water], sh, slots)).toEqual([]);
  });
  it('exports a printable CSV with OPEN spots', () => {
    const csv = gridCsv([water], sh.slice(0, 2), slots, (id) => id.toUpperCase());
    expect(csv).toBe('Station,"Sat, Nov 21 AM","Sat, Nov 21 PM"\r\nWater & Ice,AMY,OPEN\r\n');
  });
});

describe('starter stations', () => {
  it('adds only the missing ones, after the existing sort', () => {
    const add = starterStationsToAdd([{ name: 'spotters', sort: 3 }]);
    expect(add.map((s) => s.name)).toEqual(['Check In', 'Player Packs', 'Tee Signs', 'Water & Ice']);
    expect(add[0].sort).toBe(4);
    expect(starterStationsToAdd([]).length).toBe(5);
  });
});
