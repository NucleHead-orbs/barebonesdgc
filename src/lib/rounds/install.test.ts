import { describe, expect, it } from 'vitest';
import { hiddenUntil, hideFor, platformOf, showInstall, tagLinkFor } from './install';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const PIXEL = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36';
const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';

describe('platformOf', () => {
  it('spots iPhone, iPad-as-Mac, Android and the rest', () => {
    expect(platformOf(IPHONE)).toBe('ios');
    expect(platformOf(MAC, 5, 'MacIntel')).toBe('ios');
    expect(platformOf(MAC, 0, 'MacIntel')).toBe('other');
    expect(platformOf(PIXEL)).toBe('android');
  });
});

describe('showInstall', () => {
  const base = { standalone: false, platform: 'ios' as const, canPrompt: false, hiddenUntil: 0, now: 1000 };
  it('shows on phones, never inside the app', () => {
    expect(showInstall(base)).toBe(true);
    expect(showInstall({ ...base, standalone: true })).toBe(false);
    expect(showInstall({ ...base, standalone: true, force: true })).toBe(false);
  });
  it('desktop only when the browser can really install', () => {
    expect(showInstall({ ...base, platform: 'other' })).toBe(false);
    expect(showInstall({ ...base, platform: 'other', canPrompt: true })).toBe(true);
  });
  it('Not now hides it for a while; ?install=1 brings it back', () => {
    const until = hideFor(1000);
    expect(until - 1000).toBe(14 * 864e5);
    expect(showInstall({ ...base, hiddenUntil: until })).toBe(false);
    expect(showInstall({ ...base, hiddenUntil: until, now: until + 1 })).toBe(true);
    expect(showInstall({ ...base, hiddenUntil: until, force: true })).toBe(true);
  });
  it('reads storage safely', () => {
    expect(hiddenUntil(null)).toBe(0);
    expect(hiddenUntil('junk')).toBe(0);
    expect(hiddenUntil('123')).toBe(123);
  });
  it('builds the My Tag link', () => {
    expect(tagLinkFor('https://barebonesdiscgolf.club/', 'abc')).toBe('https://barebonesdiscgolf.club/tag/abc');
  });
});
