import { describe, expect, it } from 'vitest';
import { inviteText, smsHref, claimKey, daysLeft, earlyPath, earlyMessage, rankOf, rulesText, tickets, windowState } from './early';

describe('early access helpers', () => {
  it('window state by date', () => {
    expect(windowState('2026-10-02', '2026-10-03', '2026-11-20')).toBe('before');
    expect(windowState('2026-10-03', '2026-10-03', '2026-11-20')).toBe('open');
    expect(windowState('2026-11-20', '2026-10-03', '2026-11-20')).toBe('open');
    expect(windowState('2026-11-21', '2026-10-03', '2026-11-20')).toBe('closed');
  });
  it('days left counts today, never negative', () => {
    expect(daysLeft('2026-11-20', '2026-11-20')).toBe(1);
    expect(daysLeft('2026-11-18', '2026-11-20')).toBe(3);
    expect(daysLeft('2026-11-22', '2026-11-20')).toBe(0);
    expect(daysLeft('bad', '2026-11-20')).toBe(0);
  });
  it('rules come from the event numbers', () => {
    const r = rulesText(3, 2).join(' ');
    expect(r).toContain('at least 3 Jewel players');
    expect(r).toContain('up to 2 a week');
  });
  it('ticket label and rank (ties share)', () => {
    expect(tickets(1)).toBe('1 ticket');
    expect(tickets(0)).toBe('0 tickets');
    const rows = [{ tickets: 9 }, { tickets: 5 }, { tickets: 5 }, { tickets: 2 }];
    expect(rankOf(rows, 9)).toBe(1);
    expect(rankOf(rows, 5)).toBe(2);
    expect(rankOf(rows, 2)).toBe(4);
  });
  it('page path: Jewel XI on its microsite, others generic', () => {
    expect(earlyPath('jewel-xi-2026')).toBe('/jewel-xi/early-access');
    expect(earlyPath('pad-open-2026')).toBe('/e/pad-open-2026/early-access');
  });
  it('claim key is per event', () => {
    expect(claimKey('jewel-xi-2026')).not.toBe(claimKey('pad-open'));
  });
  it('plain messages for every refusal', () => {
    expect(earlyMessage({ message: 'window_closed' })).toMatch(/closed/);
    expect(earlyMessage({ message: 'already_joined' })).toMatch(/already joined/);
    expect(earlyMessage({ message: 'already_declined' })).toMatch(/already answered/);
    expect(earlyMessage({ message: 'nobody_left' })).toMatch(/already won/);
    expect(earlyMessage({ code: '42501', message: 'x' })).toMatch(/isn't a TD/);
    expect(earlyMessage('weird')).toMatch(/went wrong/);
  });
});

describe('invites', () => {
  it('writes the text with the first name and the link on its own line', () => {
    const t = inviteText('  Greg Wood ', 'Jewel XI', 'https://x/tag/abc');
    expect(t.startsWith("Greg, you're in!")).toBe(true);
    expect(t).toContain('\n\nhttps://x/tag/abc\n\n');
    expect(smsHref('a b&c')).toBe('sms:?&body=a%20b%26c');
  });
});
