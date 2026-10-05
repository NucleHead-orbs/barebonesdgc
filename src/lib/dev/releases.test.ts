import { describe, it, expect } from 'vitest';
import { deviceLabel, draftBody, groupBlocks, draftTitle, isUnseen, nextVersion, releaseBlocks, reporterLabel, sortReleases, teaser, type DraftItem, type Release } from './releases';

const rel = (version: string): Release => ({ id: version, version, title: version, body: '', published_at: '2026-10-05T00:00:00Z' });

describe('versions', () => {
  it('bumps like the database', () => {
    expect(nextVersion(null, 'patch')).toBe('1.0.0');
    expect(nextVersion('1.0.0', 'patch')).toBe('1.0.1');
    expect(nextVersion('1.0.9', 'minor')).toBe('1.1.0');
    expect(nextVersion('1.4.2', 'major')).toBe('2.0.0');
  });
  it('sorts newest first by semver, not text', () => {
    expect(sortReleases([rel('1.2.0'), rel('1.10.0'), rel('1.9.3'), rel('2.0.0')]).map((r) => r.version)).toEqual(['2.0.0', '1.10.0', '1.9.3', '1.2.0']);
  });
  it('unseen until the newest is dismissed', () => {
    expect(isUnseen(null, null)).toBe(false);
    expect(isUnseen(rel('1.1.0'), null)).toBe(true);
    expect(isUnseen(rel('1.1.0'), '1.0.0')).toBe(true);
    expect(isUnseen(rel('1.1.0'), '1.1.0')).toBe(false);
  });
});

describe('draft', () => {
  const items: DraftItem[] = [
    { id: '1', kind: 'bug', body: 'Scorecard ate my birdie', squash_note: 'Birdies stay put after a reload' },
    { id: '2', kind: 'idea', body: 'Make the skull   dance', squash_note: null },
    { id: '3', kind: 'bug', body: 'x'.repeat(300), squash_note: '' },
  ];
  it('groups bugs, ideas, feedback; note wins; long text clipped', () => {
    const b = draftBody(items);
    expect(b.split('\n')[0]).toBe('# Squashed');
    expect(b).toContain('- Birdies stay put after a reload');
    expect(b).toContain('# New\n- Make the skull dance');
    expect(b).not.toContain('Tweaked');
    expect(b.split('\n').every((l) => l.length <= 142)).toBe(true);
    expect(draftBody([])).toBe('');
  });
  it('titles itself', () => {
    expect(draftTitle(items)).toBe('2 bugs squashed, 1 new thing');
    expect(draftTitle([])).toBe('Under the hood');
  });
  it('renders headings, bullets, paragraphs', () => {
    expect(releaseBlocks('Intro\n\n# New\n- one\n* two')).toEqual([{ kind: 'p', text: 'Intro' }, { kind: 'h', text: 'New' }, { kind: 'li', text: 'one' }, { kind: 'li', text: 'two' }]);
    expect(groupBlocks(releaseBlocks('# A\n- 1\n- 2\nmid\n- 3'))).toEqual([{ kind: 'h', text: 'A' }, { kind: 'ul', items: ['1', '2'] }, { kind: 'p', text: 'mid' }, { kind: 'ul', items: ['3'] }]);
    expect(teaser('Intro\n- a\n- b\n- c\n- d')).toEqual(['a', 'b', 'c']);
    expect(teaser('Just words.\nMore words.', 1)).toEqual(['Just words.']);
  });
});

describe('labels', () => {
  it('device and reporter', () => {
    expect(deviceLabel('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit Version/17.0 Mobile Safari/604.1')).toBe('iPhone · Safari');
    expect(deviceLabel('Mozilla/5.0 (Linux; Android 14) Chrome/120 Mobile Safari/537.36')).toBe('Android · Chrome');
    expect(deviceLabel(null)).toBe('');
    expect(reporterLabel({ member: 'Finder', reporter_name: 'Bug Finder', reporter_email: null })).toBe('Finder');
    expect(reporterLabel({ member: null, reporter_name: null, reporter_email: 'td@x.com' })).toBe('td@x.com');
    expect(reporterLabel({ member: null, reporter_name: null, reporter_email: null })).toBe('Anonymous');
  });
});
