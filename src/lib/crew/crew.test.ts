import { describe, it, expect } from 'vitest';
import {
  ROLES, ROLE_GUIDE, audienceLabel, contactRollup, crewLink, crewMessage, crewNextStatuses, forCrew, raffleTotals, readiness, receipts,
  saleProblem, type Announcement, type CrewMember, type RaffleSale,
} from './crew';

const crew: CrewMember[] = [
  { id: 's', name: 'Sally', roles: ['checkin', 'raffle'] },
  { id: 'r', name: 'Rex', roles: ['contacts'] },
  { id: 'x', name: 'Gone', roles: ['raffle'], revoked_at: '2026-09-29' },
];
const ann = (id: string, roles: Announcement['roles']): Announcement => ({ id, title: id, body: '', roles, pinned: false, created_at: '', updated_at: '' });

describe('crew announcements', () => {
  it('empty roles = everyone; otherwise any matching role', () => {
    expect(forCrew(ann('a', []), crew[1])).toBe(true);
    expect(forCrew(ann('a', ['raffle']), crew[0])).toBe(true);
    expect(forCrew(ann('a', ['raffle']), crew[1])).toBe(false);
  });
  it('receipts count only the live audience', () => {
    const reads = [{ announcement_id: 'a', crew_id: 's' }, { announcement_id: 'b', crew_id: 'r' }];
    expect(receipts(ann('a', ['raffle']), crew, reads)).toEqual({ audience: 1, read: ['Sally'], missing: [] });
    expect(receipts(ann('a', []), crew, reads)).toEqual({ audience: 2, read: ['Sally'], missing: ['Rex'] });
  });
  it('readiness = acknowledged / meant for them', () => {
    const anns = [ann('a', []), ann('b', ['raffle']), ann('c', ['contacts'])];
    expect(readiness(crew[0], anns, [{ announcement_id: 'a', crew_id: 's' }])).toEqual({ total: 2, read: 1 });
    expect(readiness(crew[1], anns, [])).toEqual({ total: 2, read: 0 });
  });
  it('labels audiences and builds links', () => {
    expect(audienceLabel([])).toBe('Everyone');
    expect(audienceLabel(['checkin', 'raffle'])).toBe('Check-in + Raffle');
    expect(crewLink('https://barebonesdiscgolf.club/', 'abc')).toBe('https://barebonesdiscgolf.club/crew/abc');
  });
  it('every role has a guide, and so does everyone', () => {
    for (const r of [...ROLES, 'general' as const]) expect(ROLE_GUIDE[r].steps.length).toBeGreaterThan(1);
  });
});

describe('raffle', () => {
  const s = (p: Partial<RaffleSale>): RaffleSale => ({ id: 'x', buyer: null, tickets: 1, amount: 5, method: 'cash', created_at: '', voided_at: null, ...p });
  it('totals skip voided sales and split by method', () => {
    expect(raffleTotals([s({ tickets: 5, amount: 20 }), s({ tickets: 25, amount: 50.5, method: 'card' }), s({ amount: 99, voided_at: 'x' })]))
      .toEqual({ total: 70.5, tickets: 30, cash: 20, card: 50.5, other: 0, sales: 2, voided: 1 });
  });
  it('validates the sale form', () => {
    expect(saleProblem('5', '20')).toBeNull();
    expect(saleProblem('0', '20')).toMatch(/Tickets/);
    expect(saleProblem('2.5', '20')).toMatch(/Tickets/);
    expect(saleProblem('5', '')).toMatch(/Amount/);
    expect(saleProblem('5', '-1')).toMatch(/Amount/);
  });
});

describe('contacts', () => {
  it('a lead waits for the TD; owners move the rest', () => {
    expect(crewNextStatuses('lead')).toEqual([]);
    expect(crewNextStatuses('asked')).toContain('paid');
  });
  it('rolls up leads, yeses and money', () => {
    expect(contactRollup([
      { kind: 'sponsor', status: 'lead', amount: 100 }, { kind: 'sponsor', status: 'yes', amount: 250 },
      { kind: 'sponsor', status: 'paid', amount: 100 }, { kind: 'vendor', status: 'asked', amount: null }, { kind: 'sponsor', status: 'to_ask', amount: null },
    ])).toEqual({ leads: 1, sponsorsYes: 2, pledged: 350, paid: 100, open: 2 });
  });
});

describe('crew messages', () => {
  it('turns server errors into plain instructions', () => {
    expect(crewMessage({ message: 'invalid_link' })).toMatch(/Ask the TD for a new one/);
    expect(crewMessage({ message: 'not_your_role' })).toMatch(/isn't one of your jobs/);
    expect(crewMessage(new Error('Failed to fetch'))).toMatch(/No signal/);
    expect(crewMessage({ message: 'weird' })).toMatch(/weird/);
  });
});
