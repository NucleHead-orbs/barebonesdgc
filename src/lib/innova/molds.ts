/**
 * Flight info per Innova mold, keyed by base mold name. Source: innovadiscs.com disc comparison table + product pages
 * (checked 2026-09-29). Gator3, Eagle-L, Eagle X and Rancho Roc have no Innova page: retailer numbers (url null).
 * Novelty discs (Condor, Zephyr, Makani, Kahuna, Pulsar) have no flight numbers. The order form stays the source of
 * truth for what can be ordered; this only decorates it. Unknown molds simply show no flight info.
 */
export type MoldType = 'Putter' | 'Midrange' | 'Fairway' | 'Distance' | 'Novelty';
export interface MoldInfo { type: MoldType; speed: number | null; glide: number | null; turn: number | null; fade: number | null; url: string | null; blurb: string }
const I = 'https://www.innovadiscs.com/disc/';
const m = (type: MoldType, n: [number, number, number, number] | null, slug: string | null, blurb: string): MoldInfo =>
  ({ type, speed: n?.[0] ?? null, glide: n?.[1] ?? null, turn: n?.[2] ?? null, fade: n?.[3] ?? null, url: slug ? I + slug + '/' : null, blurb });

export const MOLDS: Record<string, MoldInfo> = {
  Alien: m('Midrange', [4, 2, 0, 1], 'alien', 'Low-glide, stable midrange with a slight fade for controlled approaches.'),
  Animal: m('Putter', [2, 1, 0, 1], 'animal', 'Low-glide, beadless approach putter that drops fast and stays close.'),
  Arachnid: m('Midrange', [5, 6, -1, 1], 'arachnid', 'High-glide, slightly understable midrange that flies straight and long.'),
  Atlas: m('Midrange', [5, 4, 0, 1], 'atlas', 'Straight-flying, neutral midrange with a gentle fade.'),
  Aviar: m('Putter', [2, 3, 0, 1], 'aviar', 'The classic beadless Putt & Approach Aviar: straight with a mild fade.'),
  'Aviar Big Bead': m('Putter', [2, 3, 0, 2], 'aviar-driver', 'Big-bead Aviar, a bit more stable for drives and approaches.'),
  Aviar3: m('Putter', [3, 2, 0, 2], 'aviar3', 'Stable, low-glide Aviar that holds its line for putts and approaches.'),
  AviarX3: m('Putter', [3, 2, 0, 3], 'aviarx3', 'Overstable Aviar built for wind, hard hyzers and a reliable fade.'),
  'Classic Aviar': m('Putter', [2, 3, 0, 0], 'classic-aviar', 'Firm-grip original Aviar, the straightest-flying Aviar.'),
  Beast: m('Distance', [10, 5, -2, 2], 'beast', 'Controllable speed-10 driver with some turn; big distance at lower power.'),
  Birdie: m('Putter', [1, 2, 0, 0], 'birdie', 'Slow, straight, low-profile putter aimed at newer players.'),
  Boss: m('Distance', [13, 5, -1, 3], 'boss', 'Fast, stable distance driver famous for record-setting throws.'),
  Bullfrog: m('Putter', [3, 1, 0, 1], 'bullfrog', 'Flat-topped, low-glide putter that stops quickly on approaches.'),
  Caiman: m('Midrange', [5.5, 2, 0, 4], 'caiman', 'Very overstable, fast midrange for headwinds and power forehands.'),
  Charger: m('Distance', [13, 5, -1, 2], 'charger', 'Speed-13 driver with moderate stability for long, controlled drives.'),
  Cheetah: m('Fairway', [6, 4, -2, 2], 'cheetah', 'Understable fairway driver that turns, then fades back.'),
  Cobra: m('Midrange', [4, 5, -2, 2], 'cobra', 'Glide-heavy midrange with some turn, handy for shaped shots.'),
  Colossus: m('Distance', [14, 5, -1, 3], 'colossus', 'Speed-14 power driver built for big arms and long carry.'),
  Colt: m('Putter', [3, 4, -1, 1], 'colt', 'Glidey, slightly understable putter for straight approaches.'),
  Condor: m('Novelty', null, 'condor', 'Innova\'s largest-diameter disc, built for rollers and throw-run-catch.'),
  Corvette: m('Distance', [14, 6, -1, 2], 'corvette', 'High-glide speed-14 driver for max distance with a mild finish.'),
  Daedalus: m('Distance', [13, 6, -3, 2], 'daedalus', 'Understable, glidey speed-13 driver that turns over for easy distance.'),
  Dart: m('Putter', [3, 4, 0, 0], 'dart', 'Straight, neutral, low-profile putter for putting and approaches.'),
  Destroyer: m('Distance', [12, 5, -1, 3], 'destroyer', 'Innova\'s iconic stable distance driver: reliable in wind, firm fade.'),
  Eagle: m('Fairway', [7, 4, -1, 3], 'eagle', 'Stable control driver with a dependable fade for accurate fairway shots.'),
  'Eagle X': m('Fairway', [7, 4, -1, 3], null, 'Eagle variant that flies as a stable control driver with a steady fade.'),
  'Eagle-L': m('Fairway', [7, 5, -1, 2], null, 'Eagle variant with a bit more glide and a softer fade.'),
  Firebird: m('Fairway', [9, 3, 0, 4], 'firebird', 'Very overstable utility driver for wind, forehands and hard skips.'),
  Firefly: m('Putter', [2, 3, 0, 1], 'firefly', 'Beadless putter with Aviar feel and a straight, slightly stable flight.'),
  Firestorm: m('Distance', [14, 4, -1, 3], 'firestorm', 'Overstable speed-14 driver for power throws and headwinds.'),
  Fox: m('Midrange', [5, 6, -2, 1], 'fox', 'Understable, glidey midrange for easy distance and turnovers.'),
  Gator: m('Midrange', [5, 2, 0, 4], 'gator', 'Classic overstable mid for wind, forehands and a dependable fade.'),
  Gator3: m('Midrange', [5, 2, 0, 3], null, 'Flat-topped, low-glide Gator that stays overstable in wind.'),
  Gorgon: m('Distance', [10, 6, -2, 1], 'gorgon', 'Glidey, understable speed-10 driver for easy distance.'),
  Hawkeye: m('Fairway', [7, 5, -1, 1], 'hawkeye', 'Straight-flying fairway driver for accurate control lines.'),
  IT: m('Fairway', [7, 6, -2, 1], null, 'Understable, glidey fairway driver for easy turnovers and newer arms.'),
  Invader: m('Putter', [3, 2, 0, 1], 'invader', 'Low-glide, stable putter for straight putts and short approaches.'),
  Invictus: m('Distance', [10, 4, 0, 3], 'invictus', 'Stable speed-10 driver with a firm, predictable fade.'),
  Jay: m('Midrange', [5, 4, 0, 1], 'jay', 'Straight, stable midrange with a mild fade.'),
  Kahuna: m('Novelty', null, 'big-kahuna', 'Big Kahuna: heavyweight ultimate/catch disc that handles wind.'),
  Katana: m('Distance', [13, 5, -3, 3], 'katana', 'Fast driver with high-speed turn and a strong fade finish.'),
  Leopard: m('Fairway', [6, 5, -2, 1], 'leopard', 'Understable, easy-throwing fairway driver, popular with newer players.'),
  Leopard3: m('Fairway', [7, 5, -2, 1], 'leopard3', 'Slightly faster Leopard with easy turn and good glide.'),
  Lion: m('Midrange', [5, 4, 0, 2], 'lion', 'Stable midrange with a reliable fade for approaches and drives.'),
  Lynx: m('Fairway', [7, 6, -3, 1], 'lynx', 'Glidey, understable fairway for tight woods, rollers and turnovers.'),
  Makani: m('Novelty', null, 'makani', 'Lightweight large-diameter rec disc for catch and accuracy games.'),
  Mako3: m('Midrange', [5, 5, 0, 0], 'mako3', 'Dead-straight neutral midrange that holds whatever angle you throw.'),
  Mamba: m('Distance', [11, 6, -5, 1], 'mamba', 'Very understable driver for rollers, turnovers and low-power distance.'),
  Max: m('Distance', [11, 3, 0, 5], 'max', 'Fast, very overstable driver for headwinds and sidearm throwers.'),
  Mirage: m('Putter', [3, 4, -3, 0], 'mirage', 'Understable putter for turnover approaches and hyzer-flips.'),
  Mystere: m('Distance', [11, 6, -2, 2], 'mystere', 'Glidey speed-11 driver with some turn for controlled distance.'),
  Nova: m('Putter', [2, 3, 0, 0], 'nova', 'Straight, neutral putter with a very flat flight.'),
  Orc: m('Distance', [10, 4, -1, 3], 'orc', 'Stable speed-10 driver that holds up in wind with a solid fade.'),
  Panther: m('Midrange', [5, 4, -2, 1], 'panther', 'Understable midrange for turnovers and easy straight lines.'),
  Pig: m('Midrange', [4, 1, 0, 3], 'pig', 'Very low-glide, overstable utility mid for flicks and wind.'),
  Polecat: m('Putter', [1, 3, 0, 0], 'polecat', 'Slow, flat-profile putter that floats straight and lands soft.'),
  Pulsar: m('Novelty', null, 'pulsar', 'Ultimate/rec disc for team play, freestyle and catch.'),
  Racer: m('Distance', [12, 6, -1, 2], 'racer', 'Glidey speed-12 driver with moderate stability for long carry.'),
  'Rancho Roc': m('Midrange', [4, 4, 0, 3], null, 'The most overstable Roc, first made in Rancho Cucamonga.'),
  Rat: m('Midrange', [4, 2, 0, 2], 'rat', 'Low-glide, stable mid for controlled approaches.'),
  Rhyno: m('Putter', [2, 1, 0, 3], 'rhyno', 'Overstable, low-glide approach putter that stops fast in wind.'),
  Roadrunner: m('Fairway', [9, 5, -4, 1], 'roadrunner', 'Very understable fairway driver for turnovers and easy distance.'),
  Roc: m('Midrange', [4, 4, 0, 3], 'roc', 'Classic stable midrange with a reliable fade.'),
  Roc3: m('Midrange', [5, 4, 0, 3], 'roc3', 'Faster Roc: stable with a dependable fade.'),
  RocX3: m('Midrange', [5, 4, 0, 3.5], 'rocx3', 'More overstable Roc3 for wind and forehands.'),
  Rollo: m('Midrange', [5, 6, -4, 1], 'rollo', 'Very understable mid made for rollers and turnovers.'),
  Savant: m('Fairway', [9, 5, -1, 2], 'savant', 'Speed-9 fairway driver with moderate stability and good glide.'),
  Shark: m('Midrange', [4, 4, 0, 2], 'shark', 'Versatile stable midrange: straight with a modest fade.'),
  Shryke: m('Distance', [13, 6, -2, 2], 'shryke', 'Glidey, slightly understable speed-13 driver for big distance.'),
  Sidewinder: m('Fairway', [9, 5, -3, 1], 'sidewinder', 'Understable fairway driver for turnovers and long easy lines.'),
  Skeeter: m('Midrange', [5, 5, -1, 1], 'skeeter', 'Glidey, near-neutral midrange with a straight flight.'),
  Sonic: m('Putter', [1, 2, -4, 0], 'sonic', 'Beginner-friendly low-profile putter that flies straight.'),
  Stingray: m('Midrange', [4, 5, -3, 1], 'stingray', 'Understable mid for turnovers, rollers and newer throwers.'),
  Sync: m('Putter', [3, 3, 0, 1], 'sync', 'Low-profile beadless putter built for control and straight shots.'),
  TL: m('Fairway', [7, 5, -1, 1], 'tl', 'Straight-flying fairway driver known for true lines.'),
  TL3: m('Fairway', [8, 4, -1, 1], 'tl3', 'Faster TL: a straight flier with a gentle finish.'),
  Teebird: m('Fairway', [7, 5, 0, 2], 'teebird', 'Legendary accurate fairway driver with a reliable stable finish.'),
  Teebird3: m('Fairway', [8, 4, 0, 2], 'teebird3', 'Faster Teebird: stable and accurate for fairway drives.'),
  Tern: m('Distance', [12, 6, -3, 2], 'tern', 'Understable, glidey speed-12 driver for easy distance.'),
  Thunderbird: m('Fairway', [9, 5, 0, 2], 'thunderbird', 'Stable speed-9 driver with good glide and a dependable fade.'),
  Toro: m('Midrange', [4, 2, 1, 3], 'toro', 'Flat-top overstable mid co-designed by Calvin Heimburg for forehands.'),
  Valkyrie: m('Fairway', [9, 4, -2, 2], 'valkyrie', 'Understable speed-9 driver that turns, then fades back.'),
  Whale: m('Putter', [2, 3, 0, 1], 'whale', 'Deep, straight-flying putter with a mild fade.'),
  Wombat3: m('Midrange', [5, 6, -1, 0], 'wombat3', 'Very glidey, straight midrange that floats and stays on line.'),
  Wraith: m('Distance', [11, 5, -1, 3], 'wraith', 'Stable speed-11 driver with good glide and a firm fade.'),
  XD: m('Putter', [3, 4, -1, 1], 'xd', 'Low-profile, driver-like putter for approaches and short drives.'),
  Xcaliber: m('Distance', [12, 5, 0, 4], 'xcaliber', 'Overstable speed-12 driver for wind and power forehands.'),
  Xero: m('Putter', [2, 3, 0, 0], 'xero', 'Straight, neutral putter with minimal fade.'),
  Zephyr: m('Novelty', null, 'zephyr', 'Straight-flying catch disc for accuracy and throw-and-catch events.'),
};

/** Spellings on the form that differ from the mold name. */
const ALIASES: Array<[RegExp, string]> = [
  [/\bWomabt3\b/, 'Wombat3'], [/\bLeopard 3\b/, 'Leopard3'], [/\bAviar Big Bead\b/, 'Aviar Big Bead'], [/\bClassic Aviar\b/, 'Classic Aviar'],
  [/\bAviar Putt\b|\bAviar Putter\b/, 'Aviar'], [/\bKahuna\b/, 'Kahuna'],
];
const KEYS = Object.keys(MOLDS).sort((a, b) => b.length - a.length);
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');
const PATTERNS = KEYS.map((k) => [k, new RegExp(`(^|[^A-Za-z0-9])${esc(k)}(?![A-Za-z0-9])`)] as const);

/** Base mold for a row name on the form ("PROTO Glow Champion Halo Destroyer" → Destroyer). Case-sensitive on purpose ("IT"). */
export function moldKey(rowName: string): string | null {
  for (const [re, k] of ALIASES) if (re.test(rowName)) return k;
  for (const [k, re] of PATTERNS) if (re.test(rowName)) return k;
  return null;
}
export const moldInfo = (rowName: string): MoldInfo | null => { const k = moldKey(rowName); return k ? MOLDS[k] : null; };
export const MOLD_TYPES: MoldType[] = ['Putter', 'Midrange', 'Fairway', 'Distance', 'Novelty'];
