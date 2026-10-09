import { describe, it, expect } from 'vitest';
import { manifestPath, myTagManifest } from './appManifest';

describe('personal My Tag manifest', () => {
  const tok = '0123456789abcdef0123456789abcdef';
  it("opens straight to the player's own page", () => {
    const m = myTagManifest(manifestPath(tok))!;
    expect(m.start_url).toBe(`/tag/${tok}`);
    expect(m.id).toBe(`/tag/${tok}`);
    expect(m.display).toBe('standalone');
  });
  it("refuses anything that isn't a token", () => {
    expect(myTagManifest('/m/../../etc.webmanifest')).toBeNull();
    expect(myTagManifest('/m/"><script>.webmanifest')).toBeNull();
    expect(myTagManifest(`/m/${tok}.json`)).toBeNull();
    expect(myTagManifest(`/m/${tok.toUpperCase()}.webmanifest`)).toBeNull();
  });
});
