/**
 * Jewel XI design proofs (pure). Source of truth for the picks: design_assets.proof + proof_opts
 * (supabase/migrations/20261005000000_design_proofs.sql). Art ships in public/assets/jewel-xi/proofs/.
 * Tee sign maps, quotes and rules come from the Jewel XI tee sign design (Design Claude, 2026-09-29);
 * par and feet always come from the event's holes table, never from here.
 */
export type ProofKind = 'disc' | 'shirt' | 'screen_print' | 'tee_signs';
export const PROOF_KINDS: ProofKind[] = ['disc', 'shirt', 'screen_print', 'tee_signs'];
export const PROOF_LABEL: Record<ProofKind, string> = { disc: 'Tour disc · stamp proof', shirt: 'Tour shirt · print proof', screen_print: 'Tour shirt · 3-color screen print', tee_signs: 'Tee signs · 20 holes' };
export const PROOF_CATEGORY: Record<ProofKind, string> = { disc: 'disc', shirt: 'shirts', screen_print: 'shirts', tee_signs: 'tee_signs' };

const ART = '/assets/jewel-xi/proofs/';
export const art = (f: string) => ART + f;

export const FOILS: Record<string, string> = {
  Electric: 'linear-gradient(135deg,#29e1ff 0%,#7b5cff 50%,#ff3ad1 100%)',
  Sunset: 'linear-gradient(135deg,#ffd23f 0%,#ff7a1a 50%,#ff2e88 100%)',
  Toxic: 'linear-gradient(135deg,#c6ff3d 0%,#29d69a 50%,#1b8fd9 100%)',
  Blood: 'linear-gradient(135deg,#ff8a7a 0%,#ff4b3e 45%,#b0102d 100%)',
  Silver: 'linear-gradient(135deg,#f4f4f8 0%,#9ea3ae 30%,#ffffff 50%,#8a8f99 70%,#e6e8ee 100%)',
  Gold: 'linear-gradient(135deg,#fff1b0 0%,#c9962b 35%,#ffe27a 55%,#a8741a 80%,#f5d67a 100%)',
};
export const PLASTICS: Record<string, string> = {
  Black: 'radial-gradient(circle at 40% 35%,#2a2a30,#121216 70%,#050507)',
  Navy: 'radial-gradient(circle at 40% 35%,#26345a,#141c2e 70%,#0b1020)',
  White: 'radial-gradient(circle at 40% 35%,#ffffff,#e4e2ea 70%,#c9c6d2)',
  Clear: 'radial-gradient(circle at 40% 35%,rgba(210,225,255,.35),rgba(120,140,190,.18) 60%,rgba(80,90,130,.3))',
};
export const DISC_COMBOS: Array<{ name: string; foil: string; plastic: string; note: string }> = [
  { name: 'ELECTRIC', foil: 'Electric', plastic: 'Black', note: 'Holo rainbow foil · black plastic' },
  { name: 'SUNSET', foil: 'Sunset', plastic: 'Navy', note: 'Holo sunset foil · navy plastic' },
  { name: 'TOXIC', foil: 'Toxic', plastic: 'Clear', note: 'Lime/mint foil · clear plastic' },
  { name: 'BLOOD', foil: 'Blood', plastic: 'White', note: 'Red foil · white plastic' },
];
export interface Pal { a: string; b: string; c: string }
export const PALETTES: Record<string, Pal> = {
  Electric: { a: '#29e1ff', b: '#7b5cff', c: '#ff3ad1' },
  Sunset: { a: '#ff2e88', b: '#ff7a1a', c: '#ffd23f' },
  Toxic: { a: '#c6ff3d', b: '#29d69a', c: '#1b8fd9' },
  Blood: { a: '#ff4b3e', b: '#b0102d', c: '#ff8a7a' },
};
export interface InkSet { a: string; b: string; na: string; nb: string; sfx: string }
export const INKS: Record<string, InkSet> = {
  Electric: { a: '#29d4ff', b: '#ff2e9a', na: 'Cyan', nb: 'Hot Pink', sfx: '' },
  Sunset: { a: '#ffd23f', b: '#ff2e88', na: 'Yellow', nb: 'Hot Pink', sfx: '-sunset' },
  Toxic: { a: '#29d69a', b: '#c6ff3d', na: 'Mint', nb: 'Lime', sfx: '-toxic' },
  Blood: { a: '#ff8a7a', b: '#ff4b3e', na: 'Salmon', nb: 'Blood Red', sfx: '-blood' },
};
export const SHIRTS: Record<string, string> = { Black: '#000000', Charcoal: '#2e2e30', Navy: '#141c2e' };
export const SIGN_BGS: Record<string, string> = { Navy: '#141c2e', Black: '#0d0d0d', Charcoal: '#2e2e30' };

export type Opts = Record<string, string>;
const DEFAULTS: Record<ProofKind, Opts> = {
  disc: { foil: 'Electric', plastic: 'Black' },
  shirt: { palette: 'Electric' },
  screen_print: { inks: 'Electric', shirt: 'Black' },
  tee_signs: { palette: 'Electric', bg: 'Navy' },
};
const ALLOWED: Record<ProofKind, Record<string, Record<string, unknown>>> = {
  disc: { foil: FOILS, plastic: PLASTICS },
  shirt: { palette: PALETTES },
  screen_print: { inks: INKS, shirt: SHIRTS },
  tee_signs: { palette: PALETTES, bg: SIGN_BGS },
};
/** Saved picks -> a complete, valid set (unknown keys dropped, bad values fall back to the default). */
export function cleanOpts(kind: ProofKind, raw: unknown): Opts {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out: Opts = { ...DEFAULTS[kind] };
  for (const [k, allowed] of Object.entries(ALLOWED[kind])) {
    const v = src[k];
    if (typeof v === 'string' && Object.prototype.hasOwnProperty.call(allowed, v)) out[k] = v;
  }
  return out;
}
export const sameOpts = (a: Opts, b: Opts) => Object.keys({ ...a, ...b }).every((k) => a[k] === b[k]);
export function optsLabel(kind: ProofKind, o: Opts): string {
  if (kind === 'disc') return `${o.foil} foil on ${o.plastic}`;
  if (kind === 'shirt') return `${o.palette} on black`;
  if (kind === 'screen_print') return `${o.inks} inks on ${o.shirt.toLowerCase()}`;
  return `${o.palette} on ${o.bg.toLowerCase()}`;
}

/** Back-print amp knobs: value 0..11 -> needle angle. */
export const KNOBS: Array<[string, number]> = [['HYZER', 7], ['ANHYZER', 4], ['CHAINS', 10], ['BEER', 10], ['BONER', 11]];
export const knobAngle = (v: number) => -150 + (v * 300) / 11;

// ---------- tee signs ----------
export interface MapEl { x: number; y: number; w: number | 'auto'; h: number | 'auto'; r: string; bg: string; border: string; color: string; label: string; fs: number; ls: number; rot: number; wm: 'horizontal-tb' | 'vertical-rl' }
interface RawSign { n: number; basket: [number, number]; tee: [number, number, number]; els: MapEl[]; quote: string; rules: string[] }
export interface Sign { n: number; basket: { x: number; y: number }; tee: { x: number; y: number; rot: number }; line: { x: number; y: number; len: number; ang: number }; els: MapEl[]; quote: string; rules: string[]; qfs: number }
export const MAP_W = 532, MAP_H = 620;

export function signs(pal: Pal): Sign[] {
  const W = MAP_W, H = MAP_H, px = (x: number, y: number) => ({ x: x / 100 * W, y: y / 100 * H });
  const hz = 'horizontal-tb' as const;
  const ob = (x: number, y: number, w: number, h: number, label: string): MapEl => ({ ...px(x, y), w: w / 100 * W, h: h / 100 * H, r: '50%', bg: 'rgba(255,58,209,0.22)', border: '4px solid ' + pal.c, color: '#fff', label, fs: 30, ls: 2, rot: 0, wm: hz });
  const pond = (x: number, y: number, w: number, h: number): MapEl => ({ ...px(x, y), w: w / 100 * W, h: h / 100 * H, r: '50%', bg: 'rgba(41,225,255,0.3)', border: '4px solid #29e1ff', color: '#fff', label: 'POND · OB', fs: 22, ls: 2, rot: 0, wm: hz });
  const tree = (x: number, y: number): MapEl => ({ ...px(x, y), w: 70, h: 70, r: '50%', bg: 'radial-gradient(circle at 40% 35%,#6fdc6f,#1f7a3a)', border: '3px solid #0a2a14', color: 'transparent', label: '', fs: 1, ls: 0, rot: 0, wm: hz });
  const tag = (x: number, y: number, label: string, color: string, fs = 20, rot = 0): MapEl => ({ ...px(x, y), w: 'auto', h: 'auto', r: '6px', bg: '#000', border: '3px solid ' + color, color, label, fs, ls: 1, rot, wm: hz });
  const strip = (x: number, y: number, w: number, h: number, label: string, vertical?: boolean): MapEl => ({ ...px(x, y), w: w / 100 * W, h: h / 100 * H, r: '0', bg: 'repeating-linear-gradient(45deg,rgba(255,58,209,0.28) 0 12px,rgba(0,0,0,0.3) 12px 24px)', border: '0', color: '#fff', label, fs: 24, ls: 6, rot: 0, wm: vertical ? 'vertical-rl' : hz });
  const water = (x: number, y: number, w: number, h: number, label = 'WATER · OB', rot = 0, r = '42%'): MapEl => ({ ...px(x, y), w: w / 100 * W, h: h / 100 * H, r, bg: 'rgba(41,225,255,0.28)', border: '4px solid #29e1ff', color: '#fff', label, fs: 22, ls: 2, rot, wm: hz });
  const raw: RawSign[] = [
    { n: 1, basket: [80, 8], tee: [62, 86, 0],
      els: [ob(44, 40, 40, 34, 'THE GREEN · OB'), strip(44, 80, 88, 5, 'SIDEWALK · OB'), strip(94, 50, 12, 100, 'PARKING LOT · OB', true)],
      quote: 'The Boner, parking lot & sidewalk are all OB!', rules: [] },
    { n: 2, basket: [64, 7], tee: [52, 90, 0],
      els: [pond(20, 40, 28, 13), tree(44, 54), tree(76, 50), tag(34, 66, 'MANDO ➜', pal.c), tag(55, 60, 'DZ', '#ffd23f', 24), tag(80, 62, '⟵ MANDO', pal.c), tag(78, 88, 'MISS THE MANDO? HEAD TO THE DZ', '#fff', 14)],
      quote: 'Gotta make it through them there trees, and the pond is OB!', rules: ['Mando: pass between the trees', 'Missed mando → head to the DZ'] },
    { n: 3, basket: [66, 8], tee: [22, 90, 14],
      els: [ob(20, 32, 32, 24, 'THE GREEN · OB'), pond(80, 78, 30, 12)],
      quote: "Don't go on the green or in the pond, they're OB. Ya idjit.", rules: [] },
    { n: 4, basket: [56, 12], tee: [54, 90, 0], els: [],
      quote: 'Try not to hit any trees, ya got a clear shot dummy!', rules: [] },
    { n: 5, basket: [44, 16], tee: [50, 90, 0],
      els: [strip(18, 9, 36, 18, 'PARKING LOT · OB'), ob(62, 50, 36, 26, 'THE GREEN · OB')],
      quote: 'The Green, parking lot & sidewalk are all OB!', rules: [] },
    { n: 6, basket: [56, 10], tee: [58, 90, 0],
      els: [ob(52, 30, 30, 22, 'THE GREEN · OB'), strip(94, 50, 12, 100, 'CURB · FENCE · OB', true), strip(50, 2, 100, 4, '')],
      quote: "The Green, curb right, fence long & painted line right are all OB! Relax, you're gonna be fine. Or maybe you won't.", rules: [] },
    { n: 7, basket: [70, 8], tee: [72, 88, -12],
      els: [strip(94, 50, 12, 100, 'FENCE · OB', true)],
      quote: 'You go over the fence, you go OB! Ya idjit.', rules: [] },
    { n: 8, basket: [64, 24], tee: [48, 92, 8],
      els: [water(92, 52, 30, 38)],
      quote: "See that water? Yeah, that's prolly gonna be OB. Like for sure. Don't go there.", rules: [] },
    { n: 9, basket: [58, 7], tee: [40, 82, 0],
      els: [ob(34, 22, 38, 18, 'THE GREEN · OB'), water(50, 50, 116, 24, "I'M A LAKE · FEED ME", -8)],
      quote: "The Green, lake & fence long are all OB! Don't suck!", rules: [] },
    { n: 10, basket: [22, 10], tee: [60, 92, 0],
      els: [water(4, 52, 24, 104, 'LAKE · OB', 0, '0 50% 50% 0'), strip(90, 50, 20, 100, 'FENCE · DRAINAGE · OB', true), tag(58, 46, 'CART PATH IS IN', '#fff', 16)],
      quote: "Lot's o' OB! Lake, green, fence line, concrete drainage. NOT the cart path. This could get dicey.", rules: [] },
    { n: 11, basket: [60, 8], tee: [68, 90, 0],
      els: [water(6, 40, 24, 84, 'LAKE · OB', 0, '0 50% 50% 0'), ob(48, 34, 32, 26, 'THE GREEN · OB'), strip(94, 50, 12, 100, 'FENCE · WALL · OB', true)],
      quote: 'The Green, the lake, fence line, wall & painted line right are all OB! Be good or be dead!', rules: [] },
    { n: 12, basket: [54, 18], tee: [54, 92, 0],
      els: [water(6, 40, 22, 84, 'LAKE · OB', 0, '0 50% 50% 0'), strip(94, 50, 12, 100, 'FENCE · OB', true)],
      quote: "Put it this way — if you hit the green, land in the lake, or go over the fence… YOU'RE BONED!!", rules: [] },
    { n: 13, basket: [36, 24], tee: [46, 90, 0],
      els: [water(32, 34, 60, 44, 'YOUR DISCS ARE MIIINE'), ob(48, 42, 18, 9, 'OB'), tag(38, 72, "BUNKER · I'M COOL", '#e6c46a', 16), ob(76, 80, 34, 20, 'THE GREEN · OB')],
      quote: 'Yeah. All that just happened.', rules: [] },
    { n: 14, basket: [54, 14], tee: [50, 92, 0],
      els: [ob(52, 32, 48, 18, 'THE GREEN · OB'), strip(94, 50, 12, 100, 'DRIVING RANGE · OB', true)],
      quote: "Were you thinking about throwing into the driving range or onto the green? Don't. That's stupid.", rules: [] },
    { n: 15, basket: [86, 9], tee: [18, 92, 0],
      els: [water(64, 4, 76, 14, 'LAKE · OB', 0, '0 0 50% 50%'), ob(32, 22, 34, 11, 'THE GREEN · OB'), tree(50, 46), tree(54, 54), tree(48, 62), tree(50, 72), tag(26, 55, '⟵ DZ', '#ffd23f', 20), tag(26, 63, '⟵ MANDO', pal.c)],
      quote: 'Keep it LEFT of those marked trees. Missed the mando? Aww, head to the DZ, bonehead.', rules: ['Mando: keep LEFT of the marked trees', 'Missed mando → head to the DZ', 'The green & lake are OB'] },
    { n: 16, basket: [60, 12], tee: [44, 90, 0],
      els: [water(14, 42, 44, 72, 'LAKE · OB'), tag(64, 42, 'NO SWIMMING', '#fff', 18)],
      quote: 'This sign brought to you by the fine folks at the American Red Cross.', rules: [] },
    { n: 17, basket: [34, 8], tee: [52, 92, 0],
      els: [ob(54, 26, 36, 18, 'THE GREEN · OB'), tag(54, 40, 'PAINTED LINE · OB', pal.c, 16)],
      quote: "For the love of Shultzy STOP THROWING ON THE GREEN! It's OB & so is the painted line. Idjit.", rules: [] },
    { n: 18, basket: [50, 18], tee: [76, 90, -20],
      els: [strip(50, 70, 100, 60, 'EVERYTHING DOWN HERE · OB')],
      quote: "Yup, all OB. But because I'm a nice BEARD, I will let you play it where it last crossed safe. You're welcome.", rules: ['OB: play from where it last crossed safe'] },
    { n: 19, basket: [58, 12], tee: [60, 92, 0],
      els: [strip(18, 50, 36, 100, 'OUT OF BOUNDS', true), strip(94, 50, 12, 100, 'OUT OF BOUNDS', true)],
      quote: "OB left & right. Send it straight down the ol' poop chute.", rules: [] },
    { n: 20, basket: [50, 24], tee: [50, 92, 0],
      els: [water(50, 24, 54, 32, 'ISLAND · OB', 0, '50%'), tag(70, 70, 'DROP ZONE', '#ff4b3e', 18)],
      quote: "Island hole 'mon. Advance to drop zone if missed. Shoot until made. You will miss this putt. Jackass.", rules: ['Island hole: miss → advance to DZ', 'Shoot from the DZ until made'] }
  ];
  return raw.map((h) => {
    const b = px(h.basket[0], h.basket[1]), t = { ...px(h.tee[0], h.tee[1]), rot: h.tee[2] };
    const dx = b.x - t.x, dy = b.y - t.y;
    return { n: h.n, basket: b, tee: t, els: h.els, quote: h.quote, rules: h.rules,
      line: { x: t.x, y: t.y, len: Math.hypot(dx, dy), ang: Math.atan2(dy, dx) * 180 / Math.PI },
      qfs: h.quote.length > 95 ? 22 : h.quote.length > 60 ? 25 : 29 };
  });
}
