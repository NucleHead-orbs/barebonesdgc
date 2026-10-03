import { describe, expect, it } from 'vitest';
import { signList, signShort, sponsorsOn, tierLabel, type HoleTee } from './teeSigns';

const t = (id: string, n: number, label: string, sort = 1): HoleTee => ({ id, n, label, dist_ft: null, par: null, sort });
const tees = [t('am13', 13, 'AM pad', 2), t('rec13', 13, 'Rec / Ladies pad', 1), t('rec9', 9, 'Rec / Ladies pad')];

describe('tee signs', () => {
  it('lists every sign: holes in order, extra pads right after their hole', () => {
    expect(signList([13, 9, 1], tees).map(signShort)).toEqual(['1', '9', '9 · Rec / Ladies pad', '13', '13 · Rec / Ladies pad', '13 · AM pad']);
  });
  it('puts sponsors on the right sign', () => {
    const sp = [
      { name: 'main', hole: 13, tee_id: null, sort: 2 }, { name: 'am', hole: 13, tee_id: 'am13', sort: 1 },
      { name: 'gone', hole: 13, tee_id: 'deleted-pad', sort: 1 }, { name: 'other', hole: 9, tee_id: null, sort: 1 },
    ];
    const signs = signList([9, 13], tees);
    const on = (k: string) => sponsorsOn(sp, signs.find((s) => s.key === k)!, tees).map((s) => s.name);
    expect(on('13')).toEqual(['gone', 'main']);
    expect(on('13:am13')).toEqual(['am']);
    expect(on('13:rec13')).toEqual([]);
    expect(on('9')).toEqual(['other']);
  });
  it('labels the sponsorship', () => {
    const [main, pad] = signList([9], tees);
    expect(tierLabel(main, 1)).toBe('FULL HOLE SPONSOR');
    expect(tierLabel(main, 2)).toBe('½ HOLE SPONSORS');
    expect(tierLabel(pad, 1)).toBe('REC / LADIES PAD SPONSOR');
  });
});
