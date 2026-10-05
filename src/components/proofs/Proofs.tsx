/**
 * Jewel XI design proofs: disc stamp, shirt print, 3-color screen print, tee signs. Same pages the TD sees in
 * PREP → Designs and the crew see on their link. Picks are local until the TD saves them (onSave).
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { supabase } from '../../lib/supabase';
import {
  DISC_COMBOS, FOILS, INKS, MAP_H, MAP_W, PALETTES, PLASTICS, SHIRTS, SIGN_BGS, art, cleanOpts,
  optsLabel, QUOTE_MAX, sameOpts, signs, type Opts, type Pal, type ProofKind,
} from '../../lib/proofs/proofs';
import { TOUR_MIN_FONT, tourFit, tourLines, type TourLine, type TourPad, type TourSponsor } from '../../lib/proofs/tour';
import { MAX_PER_SIGN, signList, signShort, sponsorsOn, tierLabel, type HoleTee } from '../../lib/proofs/teeSigns';
import './proofs.css';

export function ProofView({ kind, eventId, saved, onSave }: {
  kind: ProofKind; eventId: string; saved: unknown; onSave?: (o: Opts) => Promise<boolean>;
}) {
  const savedOpts = cleanOpts(kind, saved);
  const [o, setO] = useState<Opts>(savedOpts);
  const [busy, setBusy] = useState(false);
  const pick = (k: string, v: string) => setO({ ...o, [k]: v });
  const dirty = !sameOpts(o, savedOpts);
  const save = async () => { if (!onSave) return; setBusy(true); await onSave(o); setBusy(false); };

  return (
    <div className="pf">
      <header className="pf-head">
        <div className="pf-kick">BARE BONES · JEWEL XI WORLD TOUR · 11.21–11.22.2026</div>
        <h2 className="pf-title">{TITLE[kind]}</h2>
        <div className="pf-sub">{SUB[kind]}</div>
      </header>
      <div className="pf-selected">
        <span className="pf-label">{onSave ? 'SELECTED' : 'TD PICKED'}</span>
        <b>{optsLabel(kind, savedOpts)}</b>
        {dirty && <span className="pf-preview">{optsLabel(kind, o) === optsLabel(kind, savedOpts) ? 'unsaved edits' : `previewing ${optsLabel(kind, o)}`}</span>}
        {dirty && onSave && <button type="button" className="pf-save" disabled={busy} onClick={() => void save()}>{busy ? 'SAVING…' : 'SAVE AS SELECTED'}</button>}
        {dirty && <button type="button" className="pf-reset" onClick={() => setO(savedOpts)}>RESET</button>}
      </div>
      {kind === 'disc' && <Disc o={o} pick={pick} setO={setO} />}
      {kind === 'shirt' && <Shirt o={o} pick={pick} eventId={eventId} />}
      {kind === 'screen_print' && <ScreenPrint o={o} pick={pick} eventId={eventId} />}
      {kind === 'tee_signs' && <TeeSigns o={o} pick={pick} eventId={eventId} editable={!!onSave} />}
    </div>
  );
}

const TITLE: Record<ProofKind, string> = { disc: 'TOUR DISC — STAMP PROOF', shirt: 'TOUR SHIRT — PRINT PROOF', screen_print: 'TOUR SHIRT — SCREEN PRINT', tee_signs: 'TEE SIGNS — 20 HOLES + PADS' };
const SUB: Record<ProofKind, string> = {
  disc: 'INNOVA · 1-COLOR HOT STAMP · TAP A FOIL OR PLASTIC TO PREVIEW',
  shirt: 'BLACK SHIRT · FULL COLOR · FRONT 12×14 IN · BACK 12×16 IN',
  screen_print: '3 SPOT INKS · WHITE + 2 · NO BLACK INK · FRONT 12×14 · BACK 12×16',
  tee_signs: '11×17 IN PORTRAIT · PAR + FEET FROM THIS EVENT\'S COURSE',
};

/** Draws `children` at its native size and scales it to the available width. */
function Scaled({ w, h, max, children, className = '' }: { w: number; h: number; max?: number; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [s, setS] = useState(0.4);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => setS(Math.min(max ?? 1, el.clientWidth / w));
    fit();
    const ro = new ResizeObserver(fit); ro.observe(el);
    return () => ro.disconnect();
  }, [w, max]);
  return (
    <div ref={ref} className={`pf-scaled ${className}`}>
      <div style={{ width: w * s, height: h * s, overflow: 'hidden' }}>
        <div style={{ width: w, height: h, transform: `scale(${s})`, transformOrigin: '0 0' }}>{children}</div>
      </div>
    </div>
  );
}

function Chips<T extends string>({ label, items, cur, onPick, swatch }: { label: string; items: T[]; cur: string; onPick: (v: T) => void; swatch: (v: T) => ReactNode }) {
  return (
    <div className="pf-group">
      <div className="pf-label">{label}</div>
      <div className="pf-chips">
        {items.map((v) => (
          <button key={v} type="button" className="pf-chip" aria-pressed={v === cur} onClick={() => onPick(v)}>{swatch(v)}<span>{v.toUpperCase()}</span></button>
        ))}
      </div>
    </div>
  );
}
const tri = (p: { a: string; b: string; c?: string }, first?: string) => (
  <span className="pf-tri"><i style={{ background: first ?? p.a }} /><i style={{ background: first ? p.a : p.b }} /><i style={{ background: first ? p.b : p.c }} /></span>
);

// ---------- disc ----------
function Disc({ o, pick, setO }: { o: Opts; pick: (k: string, v: string) => void; setO: (o: Opts) => void }) {
  return (
    <>
      <div className="pf-hero">
        <div className="pf-disc pf-disc-lg" style={{ background: PLASTICS[o.plastic] }}>
          <div className="pf-disc-rim" />
          <div className="pf-stamp pf-foil" style={{ backgroundImage: FOILS[o.foil], WebkitMaskImage: `url(${art('disc-stamp-alpha.png')})`, maskImage: `url(${art('disc-stamp-alpha.png')})` }} />
          <div className="pf-sheen" />
          <div className="pf-gloss" />
        </div>
        <div className="pf-side">
          <div className="pf-group">
            <div className="pf-label">FOIL</div>
            <div className="pf-chips">
              {Object.keys(FOILS).map((f) => (
                <button key={f} type="button" className="pf-dot" aria-pressed={f === o.foil} aria-label={`${f} foil`} onClick={() => pick('foil', f)} style={{ backgroundImage: FOILS[f] }} />
              ))}
            </div>
          </div>
          <Chips label="PLASTIC" items={Object.keys(PLASTICS)} cur={o.plastic} onPick={(v) => pick('plastic', v)} swatch={(v) => <span className="pf-sw" style={{ background: PLASTICS[v] }} />} />
          <ol className="pf-list">
            <li className="pf-label pf-hot">PREFLIGHT · FIX BEFORE SUBMITTING</li>
            <li>Rebuild as vector (AI/PDF), 1 color, 100% K, all type outlined.</li>
            <li>Halftone dots (date bar, temples, nose) fill in or drop out in foil. Convert to solid shapes or remove.</li>
            <li>Spiral and ruler ticks: hold min. ~0.5 pt line and gap at final stamp size.</li>
            <li>Swap the drawn INNOVA mark for the official vector logo.</li>
            <li>Dial numbers 0–11 sit outside the ring. The whole art must fit Innova's max stamp diameter. Confirm with the rep.</li>
            <li>Check "BAREBONES" reads at final size. The O and N are the weakest letters.</li>
          </ol>
        </div>
      </div>
      <div className="pf-row">
        <div className="pf-card">
          <div className="pf-label">STAMP FILE · 1 COLOR</div>
          <div className="pf-art"><div className="pf-stamp" style={{ background: '#000', WebkitMaskImage: `url(${art('disc-stamp-alpha.png')})`, maskImage: `url(${art('disc-stamp-alpha.png')})` }} /></div>
        </div>
        <div className="pf-card pf-grow">
          <div className="pf-label">COMBOS · TAP TO PREVIEW</div>
          <div className="pf-combos">
            {DISC_COMBOS.map((c) => (
              <button key={c.name} type="button" className="pf-combo" aria-pressed={c.foil === o.foil && c.plastic === o.plastic} onClick={() => setO({ foil: c.foil, plastic: c.plastic })}>
                <span className="pf-disc" style={{ background: PLASTICS[c.plastic] }}>
                  <span className="pf-stamp pf-foil" style={{ backgroundImage: FOILS[c.foil], WebkitMaskImage: `url(${art('disc-stamp-alpha.png')})`, maskImage: `url(${art('disc-stamp-alpha.png')})` }} />
                  <span className="pf-gloss" />
                </span>
                <b>{c.name}</b><span>{c.note}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

// ---------- shirts ----------
function ShirtFront({ bg, g, bb, bl, pal }: { bg: string; g: string; bb: string; bl: string; pal: Pal }) {
  return (
    <div className="pf-print" style={{ width: 1200, height: 1400, background: bg }}>
      <img src={g} alt="Skeleton rocker with flying-V guitar" style={{ left: 190, top: 240, width: 820, height: 909 }} />
      <img src={bb} alt="Bare Bones wordmark" style={{ left: 80, top: 0, width: 1040, height: 442 }} />
      <img src={bl} alt="Bend Like the Boner wordmark" style={{ left: 60, top: 980, width: 1080, height: 375 }} />
      <div className="pf-p-foot" style={{ color: pal.c }}>THE JEWEL XI WORLD TOUR · 2026</div>
    </div>
  );
}
/** Visible sponsors as tour lines (live from Sponsors: hole, pad, sort). */
function useTourLines(eventId: string): TourLine[] | null {
  const [lines, setLines] = useState<TourLine[] | null>(null);
  useEffect(() => {
    let live = true;
    void (async () => {
      const [sp, tees] = await Promise.all([
        supabase.from('sponsors').select('hole, tee_id, name, sort').eq('event_id', eventId).eq('hidden', false),
        supabase.from('hole_tees').select('id, label, sort').eq('event_id', eventId),
      ]);
      if (live) setLines(tourLines((sp.data ?? []) as TourSponsor[], (tees.data ?? []) as TourPad[]));
    })();
    return () => { live = false; };
  }, [eventId]);
  return lines;
}

/** The lightning-bolt "11" + skull with the year and dates, drawn on a 1000×1000 box. */
function SkullBolts({ bg, pal, spot }: { bg: string; pal: Pal; spot: boolean }) {
  const one = 'M240,160 330,92 424,92 424,420 440,440 424,460 424,612 386,712 330,640 330,460 314,440 330,420 330,228 262,250Z';
  const inner = 'M270,166 338,112 406,112 406,428 414,440 406,452 406,606 384,668 348,628 348,452 340,440 348,428 348,202 276,224Z';
  const gid = spot ? 'sp' : 'fc';
  return (
    <>
      <svg width="1000" height="1000" viewBox="0 0 1000 1000" style={{ position: 'absolute', inset: 0 }}>
        <defs>
          <linearGradient id={`${gid}B`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={pal.a} /><stop offset="0.5" stopColor={pal.b} /><stop offset="1" stopColor={pal.c} /></linearGradient>
          <linearGradient id={`${gid}Bev`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#ffffff" /><stop offset="0.45" stopColor="#b9bcc4" /><stop offset="1" stopColor="#5d6068" /></linearGradient>
        </defs>
        {[-20, 300].map((dx) => (
          <g key={dx} transform={`translate(${dx} 0)`}>
            <path d={one} fill={spot ? '#ffffff' : `url(#${gid}Bev)`} stroke={spot ? undefined : '#111'} strokeWidth={spot ? undefined : 6} />
            <path d={inner} fill={spot ? pal.b : `url(#${gid}B)`} />
          </g>
        ))}
      </svg>
      <div className="pf-b-skull">
        <img src={art('skull-clean.webp')} alt="Bare Bones skull" />
        <span style={{ left: 221, top: 337, color: spot ? bg : '#161616' }} className="pf-b-yr">20</span>
        <span style={{ left: 411, top: 337, color: spot ? bg : '#161616' }} className="pf-b-yr">26</span>
        <span style={{ left: 248, top: 267, transform: 'translate(-50%,-50%) rotate(-4deg)' }} className="pf-b-dt">11·21</span>
        <span style={{ left: 317, top: 297, fontSize: 26 }} className="pf-b-dt">&amp;</span>
        <span style={{ left: 388, top: 267, transform: 'translate(-50%,-50%) rotate(4deg)' }} className="pf-b-dt">11·22</span>
      </div>
    </>
  );
}

/**
 * Back: a classic rock tour back. Band name (the BARE BONES wordmark), the tour, the skull, the headliners,
 * then every sponsor as a tour stop: HOLE 07 ……… SPONSOR. The list is live from Sponsors and refits as it grows.
 */
function ShirtBack({ bg, pal, spot, wm, lines }: { bg: string; pal: Pal; spot: boolean; wm: string; lines: TourLine[] | null }) {
  const list = lines ?? [];
  const fit = tourFit(list.length);
  const per = Math.ceil(list.length / fit.cols) || 1;
  const box = useRef<HTMLDivElement>(null);
  const key = `${list.map((l) => l.when + l.name).join('|')}`;
  // Shrink until every name fits its column (never cut a sponsor off); a new list starts again from the fit.
  const [shrunk, setShrunk] = useState<{ key: string; font: number } | null>(null);
  const font = shrunk && shrunk.key === key ? shrunk.font : fit.font;
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const over = [...el.querySelectorAll<HTMLElement>('.pf-t-name')].some((n) => n.scrollWidth > n.clientWidth + 1);
    if (over && font > TOUR_MIN_FONT) setShrunk({ key, font: font - 1 });
  }, [font, key]);
  const cols = fit.cols === 2 ? [list.slice(0, per), list.slice(per)] : [list];
  return (
    <div className="pf-print pf-back pf-tour" style={{ width: 1200, height: 1600, background: bg }}>
      <img src={wm} alt="Bare Bones wordmark" style={{ left: 220, top: 26, width: 760, height: 323 }} />
      <div className="pf-t-tour" style={{ color: pal.a }}>★ THE JEWEL XI WORLD TOUR ★</div>
      <div className="pf-b-skullwrap" style={{ left: 435, top: 404, transform: 'scale(.33)', transformOrigin: '0 0' }}>
        <SkullBolts bg={bg} pal={pal} spot={spot} />
      </div>
      <div className="pf-t-head" style={{ borderColor: pal.b }}>
        <span style={{ color: pal.c }}>HEADLINERS</span><b>INNOVA</b><i style={{ background: pal.b }} /><b>MOHAVE CANNABIS CO.</b>
      </div>
      <div ref={box} className="pf-t-list" style={{ gridTemplateColumns: `repeat(${fit.cols}, minmax(0, 1fr))`, fontSize: font }}>
        {cols.map((col, ci) => (
          <div key={ci} className="pf-t-col" style={{ gridAutoRows: fit.rowH, ...(ci ? { borderLeft: `3px solid ${pal.b}` } : {}) }}>
            {col.map((l, i) => (
              <div key={i} className="pf-t-row">
                <span className="pf-t-when" style={{ color: pal.a }}>{l.when}</span>
                <span className="pf-t-name">{l.name}</span>
              </div>
            ))}
          </div>
        ))}
        {lines && !list.length && <div className="pf-t-empty">Sponsors show up here as they're added in SPONSORS.</div>}
      </div>
      <div className="pf-t-foot">
        <div className="pf-b-dick" style={{ color: pal.c }}>Don't be a Dick, Be a Boner</div>
        <div className="pf-t-club">BARE BONES DISC GOLF CLUB · MESA, AZ · NOV 21–22, 2026</div>
      </div>
    </div>
  );
}
function Prints({ front, back }: { front: ReactNode; back: ReactNode }) {
  return (
    <div className="pf-prints">
      <figure><figcaption><span className="pf-tag">FRONT</span> 12×14 IN</figcaption><Scaled w={1200} h={1400} max={0.5} className="pf-shadow">{front}</Scaled></figure>
      <figure><figcaption><span className="pf-tag pf-tag-b">BACK</span> 12×16 IN</figcaption><Scaled w={1200} h={1600} max={0.5} className="pf-shadow">{back}</Scaled></figure>
    </div>
  );
}
function Shirt({ o, pick, eventId }: { o: Opts; pick: (k: string, v: string) => void; eventId: string }) {
  const pal = PALETTES[o.palette];
  const lines = useTourLines(eventId);
  return (
    <>
      <Chips label="PALETTE" items={Object.keys(PALETTES)} cur={o.palette} onPick={(v) => pick('palette', v)} swatch={(v) => tri(PALETTES[v])} />
      <Prints front={<ShirtFront bg="#000" pal={pal} g={art('guitar-skeleton.webp')} bb={art('wordmark-bare-bones-cut.webp')} bl={art('wordmark-bend-cut.webp')} />}
        back={<ShirtBack bg="#000" pal={pal} spot={false} wm={art('wordmark-bare-bones-cut.webp')} lines={lines} />} />
      <ol className="pf-list pf-wide">
        <li className="pf-label pf-hot">PREFLIGHT</li>
        <li>Chrome wordmarks are full color: DTG or sim-process, not 3-spot. Cheaper route: the screen print version.</li>
        <li>Black shirt: no black ink. Black in the art is the shirt.</li>
        <li>Send 300 dpi PNG or vector at 12×14 (front) and 12×16 (back).</li>
        <li>Sizes and count come from PREP → Shirts.</li>
        <li>The back's sponsor list is live from SPONSORS (hole order). Lock sponsors before you export the art.</li>
      </ol>
    </>
  );
}
function ScreenPrint({ o, pick, eventId }: { o: Opts; pick: (k: string, v: string) => void; eventId: string }) {
  const k = INKS[o.inks];
  const lines = useTourLines(eventId);
  const pal = { a: k.a, b: k.b, c: k.b };
  const bg = SHIRTS[o.shirt];
  return (
    <>
      <div className="pf-chiprow">
        <Chips label="INKS" items={Object.keys(INKS)} cur={o.inks} onPick={(v) => pick('inks', v)} swatch={(v) => tri(INKS[v], '#ffffff')} />
        <Chips label="SHIRT" items={Object.keys(SHIRTS)} cur={o.shirt} onPick={(v) => pick('shirt', v)} swatch={(v) => <span className="pf-sw" style={{ background: SHIRTS[v] }} />} />
      </div>
      <Prints front={<ShirtFront bg={bg} pal={pal} g={art(`sp-guitar-skeleton${k.sfx}.png`)} bb={art(`sp-wordmark-bare-bones${k.sfx}.png`)} bl={art(`sp-wordmark-bend${k.sfx}.png`)} />}
        back={<ShirtBack bg={bg} pal={pal} spot wm={art(`sp-wordmark-bare-bones${k.sfx}.png`)} lines={lines} />} />
      <div className="pf-row">
        <ol className="pf-list">
          <li className="pf-label">SCREENS</li>
          <li><span className="pf-ink" style={{ background: '#fff' }} />1 · White (underbase + highlights)</li>
          <li><span className="pf-ink" style={{ background: k.a }} />2 · {k.na}</li>
          <li><span className="pf-ink" style={{ background: k.b }} />3 · {k.nb}</li>
        </ol>
        <ol className="pf-list">
          <li className="pf-label pf-hot">PREFLIGHT</li>
          <li>Send separations: one black-on-white film per ink, registered.</li>
          <li>Call inks by Pantone with the printer. Swatches here are screen colors.</li>
          <li>Hairlines under ~1 pt fill in. Thicken the wordmark outlines.</li>
          <li>Shirt color shows through every gap. Proof on the real blank.</li>
          <li>Sponsor list on the back is live from SPONSORS. Lock it before burning screens; small names need a fine mesh.</li>
        </ol>
      </div>
    </>
  );
}

// ---------- tee signs ----------
/** Plate text shrinks for long names so it stays on one or two lines. */
const plateSize = (name: string, max: number) => (name.length > 26 ? Math.round(max * 0.62) : name.length > 18 ? Math.round(max * 0.78) : max);
interface HoleRow { n: number; par: number; dist_ft: number | null }
interface HoleSponsor { hole: number | null; tee_id: string | null; name: string; logo_url: string | null; sort: number }
function TeeSigns({ o, pick, eventId, editable }: { o: Opts; pick: (k: string, v: string) => void; eventId: string; editable: boolean }) {
  const pal = PALETTES[o.palette];
  const bg = SIGN_BGS[o.bg];
  const [holes, setHoles] = useState<HoleRow[]>([]);
  const [spons, setSpons] = useState<HoleSponsor[]>([]);
  const [tees, setTees] = useState<HoleTee[]>([]);
  const [key, setKey] = useState('1');
  useEffect(() => {
    let live = true;
    void (async () => {
      const [h, s, t] = await Promise.all([
        supabase.from('holes').select('n, par, dist_ft').eq('event_id', eventId).order('n'),
        supabase.from('sponsors').select('hole, tee_id, name, logo_url, sort').eq('event_id', eventId).eq('hidden', false),
        supabase.from('hole_tees').select('id, n, label, dist_ft, par, sort').eq('event_id', eventId),
      ]);
      if (!live) return;
      setHoles((h.data ?? []) as HoleRow[]);
      setSpons((s.data ?? []) as HoleSponsor[]);
      setTees((t.data ?? []) as HoleTee[]);
    })();
    return () => { live = false; };
  }, [eventId]);
  const all = signs(pal, o);
  // Every physical sign: each hole's main tee + each extra pad (Setup → Extra tee pads).
  const list = signList(all.map((x) => x.n), tees);
  const cur = list.find((x) => x.key === key) ?? list[0];
  const n = cur.n;
  const pad = cur.tee;
  const sign = all[n - 1];
  const defaultQuote = signs(pal)[n - 1].quote;
  const qKey = `q${n}`;
  const draft = o[qKey] ?? sign.quote;
  const hole = holes.find((h) => h.n === n);
  const par = pad?.par ?? hole?.par;
  const feet = pad ? pad.dist_ft : hole?.dist_ft;
  // This sign's sponsors (visible, in sponsor order): one = full sign, two = half sign (stacked).
  const holeSp = sponsorsOn(spons, cur, tees);
  const sp = holeSp[0] ?? null;
  const crowded = list.filter((x) => sponsorsOn(spons, x, tees).length > MAX_PER_SIGN).map(signShort);
  const claimed = list.filter((x) => sponsorsOn(spons, x, tees).length > 0).length;
  const totalFt = holes.reduce((a, h) => a + (h.dist_ft ?? 0), 0);
  const totalPar = holes.reduce((a, h) => a + h.par, 0);

  return (
    <div className="pf-signs">
      <Scaled w={1100} h={1700} max={0.5} className="pf-shadow pf-signbox">
        <div className="pf-sign" style={{ background: bg }}>
          <div className="pf-s-frame" style={{ borderColor: pal.b }} />
          <img className="pf-s-wm" src={art('wordmark-bare-bones-cut.webp')} alt="Bare Bones" />
          <div className="pf-s-tr">
            <div className="pf-s-tour">THE JEWEL XI WORLD TOUR</div>
            <div className="pf-s-course" style={{ color: pal.a }}>The Course Formerly Known as Fiesta Lakes</div>
            <div className="pf-s-when" style={{ color: pal.c }}>NOV 21–22, 2026</div>
          </div>
          <div className="pf-s-top">
            <div><div className="pf-s-stop" style={{ color: pal.c }}>TOUR STOP {String(n).padStart(2, '0')} / 20</div><div className="pf-s-hole">Hole {n}</div>
              {pad && <div className="pf-s-pad" style={{ background: pal.c }}>{pad.label}</div>}</div>
            <div className="pf-s-pd"><div style={{ color: pal.a }}>PAR {par ?? '–'}</div><div>{feet ?? '–'} FT</div></div>
          </div>
          {holeSp.length < 2 ? (<>
            <div className={`pf-s-cari${sp?.logo_url ? ' has-pic' : ''}`} style={{ borderColor: pal.a, color: pal.a }}>
              {sp?.logo_url ? <img src={sp.logo_url} alt={sp.name} /> : <>{pad ? pad.label.toUpperCase() : `HOLE ${n}`}<br />SPONSOR PIC</>}
            </div>
            <div className="pf-s-rocker" style={{ fontSize: plateSize(sp?.name ?? '[SPONSOR NAME]', 44) }}>{sp?.name ?? '[SPONSOR NAME]'}</div>
          </>) : (
            <div className="pf-s-halves">
              {holeSp.slice(0, 2).map((h) => (
                <div key={h.name} className="pf-s-half">
                  <div className={`pf-s-cari half${h.logo_url ? ' has-pic' : ''}`} style={{ borderColor: pal.a, color: pal.a }}>
                    {h.logo_url ? <img src={h.logo_url} alt={h.name} /> : <>½ HOLE<br />SPONSOR PIC</>}
                  </div>
                  <div className="pf-s-rocker half" style={{ fontSize: plateSize(h.name, 34) }}>{h.name}</div>
                </div>
              ))}
            </div>
          )}
          <div className="pf-s-map" style={{ borderColor: pal.b, width: MAP_W, height: MAP_H }}>
            <div className="pf-s-line" style={{ left: sign.line.x, top: sign.line.y, width: sign.line.len, transform: `rotate(${sign.line.ang}deg)` }} />
            {sign.els.map((e, i) => (
              <div key={i} className="pf-s-el" style={{ left: e.x, top: e.y, width: e.w, height: e.h, transform: `translate(-50%,-50%) rotate(${e.rot}deg)`, borderRadius: e.r, background: e.bg, border: e.border, color: e.color, fontSize: e.fs, letterSpacing: e.ls, writingMode: e.wm }}>{e.label}</div>
            ))}
            <div className="pf-s-basket" style={{ left: sign.basket.x, top: sign.basket.y, boxShadow: `0 0 18px ${pal.a}` }}><i style={{ background: pal.c }} /></div>
            <div className="pf-s-tee" style={{ left: sign.tee.x, top: sign.tee.y, transform: `translate(-50%,-50%) rotate(${sign.tee.rot}deg)`, background: pal.a }}>TEE</div>
          </div>
          <div className="pf-s-narr">
            <div className="pf-s-baron">
              <img src={art('baron-von-goose.webp')} alt="Baron Von Goose" />
              <div className="pf-s-bname"><b>Baron<br />Von Goose</b><i style={{ background: pal.c }} /><span>The Rule Rocker</span></div>
            </div>
            <div className="pf-s-bubble" style={{ fontSize: sign.qfs }}><i />{sign.quote}</div>
          </div>
          <div className="pf-s-rules">{sign.rules.map((r) => <div key={r}><span style={{ color: pal.c }}>▸</span> {r}</div>)}</div>
          <div className="pf-s-foot" style={{ borderTopColor: pal.b }}>
            <div><div className="pf-s-by">Sponsored By</div><div className="pf-s-dick" style={{ color: pal.a }}>Don't be a Dick, Be a Boner</div></div>
            <div className={`pf-s-logo pf-s-tier${holeSp.length ? '' : ' open'}`}>{holeSp.length ? <b>{tierLabel(cur, holeSp.length)}</b> : <span>{tierLabel(cur, 1)} · OPEN</span>}</div>
          </div>
        </div>
      </Scaled>

      <div className="pf-side">
        <div className="pf-group">
          <div className="pf-label">PICK A SIGN · {list.length}</div>
          <div className="pf-holes">
            {list.map((x) => {
              const h = holes.find((y) => y.n === x.n);
              const on = x.key === cur.key;
              return (
                <button key={x.key} type="button" className={`pf-hole${x.tee ? ' is-pad' : ''}`} aria-pressed={on} aria-label={x.tee ? `Hole ${x.n} ${x.tee.label}` : `Hole ${x.n}`}
                  onClick={() => setKey(x.key)} style={on ? { borderColor: pal.a } : undefined}>
                  <b>{x.n}</b><span>{x.tee ? x.tee.label : h ? `P${h.par} · ${h.dist_ft ?? '–'}'` : ''}</span>
                </button>
              );
            })}
          </div>
        </div>
        {editable && (
          <div className="pf-group">
            <div className="pf-label">BARON SAYS · HOLE {n}</div>
            <textarea className="pf-quote" rows={3} maxLength={QUOTE_MAX} value={draft} aria-label={`Hole ${n} speech bubble`}
              onChange={(e) => pick(qKey, e.target.value.replace(/\n/g, ' '))} />
            <div className="pf-quote-meta">
              <span>{draft.length}/{QUOTE_MAX}{o[qKey] && o[qKey] !== defaultQuote ? ' · edited' : ''}</span>
              {o[qKey] !== undefined && o[qKey] !== defaultQuote && <button type="button" onClick={() => pick(qKey, defaultQuote)}>Back to original</button>}
            </div>
          </div>
        )}
        <div className="pf-chiprow">
          <Chips label="PALETTE" items={Object.keys(PALETTES)} cur={o.palette} onPick={(v) => pick('palette', v)} swatch={(v) => tri(PALETTES[v])} />
          <Chips label="BACKGROUND" items={Object.keys(SIGN_BGS)} cur={o.bg} onPick={(v) => pick('bg', v)} swatch={(v) => <span className="pf-sw" style={{ background: SIGN_BGS[v] }} />} />
        </div>
        <ol className="pf-list">
          <li className="pf-label pf-hot">BEFORE PRINT</li>
          <li>Course: par {totalPar || '–'} · {totalFt ? totalFt.toLocaleString() : '–'} ft, straight from this event's holes.</li>
          <li>Sponsored: {claimed} of {list.length} signs ({list.length - all.length} extra tee pads). A visible sponsor drops onto its hole's sign (or the pad picked in Sponsors): pic in the big frame, name on the plate. Two on one sign = a ½ sign.</li>
          {crowded.length > 0 && <li className="pf-hot">Too many sponsors on {crowded.join(', ')}: a sign fits two. Move the extras to another sign.</li>}
          <li>Baron's bubble text is editable per hole (pads share their hole's line). Save to lock it in.</li>
          <li>Print 11×17 at 300 dpi, 1/8 in bleed. Coroplast holds up outside.</li>
        </ol>
      </div>
    </div>
  );
}
