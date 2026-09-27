import { useEffect, useMemo, useState, type ChangeEvent, type ReactNode } from 'react';
import { generateCards, CardGenerationError, waveOf, type BuilderSettings, type Card, type SortBy, type Wave } from '../../lib/cards/generate';
import type { ImportRow } from '../../lib/import/dgs';
import * as api from '../../lib/td/api';
import {
  mergeSettings, parseHoleList, slotKey, movePlayer, toggleLock, toPublishPayload, matchPublished,
  hasUnpublishedChanges, unassignedIds, importDiff, rpcError, type ExistingPlayer, type PublishedCard, type RpcErrorKind,
} from '../../lib/td/builder';
import ImportReview from './ImportReview';
import QrSheet from './QrSheet';
import SponsorsPanel from './SponsorsPanel';

type Round = 1 | 2;
type PerRound<T> = Record<Round, T>;
const SORT_OPTS: Array<[SortBy, string]> = [['rating', 'Rating (high → low)'], ['r1', 'R1 score (for R2)'], ['reg', 'Registration order'], ['random', 'Random']];
const TOGGLES: Array<[keyof BuilderSettings, string]> = [
  ['keepDivisions', 'Keep divisions together'],
  ['mergeSmall', 'Merge tiny divisions (1–2 players) onto shared cards'],
  ['balance', 'Balance card sizes (4-4-3, not 4-4-4-1)'],
];

const holeTextOf = (s: BuilderSettings) => ({ double: s.doubleUp.join(', '), skip: s.skip.join(', ') });

export default function CardBuilder({ email, onSignOut }: { email: string; onSignOut: () => void }) {
  const [ev, setEv] = useState<api.EventRef | null>(null);
  const [fatal, setFatal] = useState('');
  const [players, setPlayers] = useState<ExistingPlayer[]>([]);
  const [r1, setR1] = useState<Record<string, number>>({});
  const [round, setRound] = useState<Round>(1);
  const [settings, setSettings] = useState<PerRound<BuilderSettings> | null>(null);
  const [cards, setCards] = useState<PerRound<Card[]>>({ 1: [], 2: [] });
  const [published, setPublished] = useState<PerRound<PublishedCard[]>>({ 1: [], 2: [] });
  const [genWarn, setGenWarn] = useState<PerRound<string[]>>({ 1: [], 2: [] });
  const [dirty, setDirty] = useState<PerRound<boolean>>({ 1: false, 2: false });
  const [holeText, setHoleText] = useState({ double: '', skip: '' });
  const [wave, setWave] = useState<Wave>('AM');
  const [sel, setSel] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [toast, setToast] = useState('');
  const [alert, setAlert] = useState<{ kind: RpcErrorKind | 'generate'; message: string } | null>(null);
  const [pending, setPending] = useState<{ fileName: string; text: string } | null>(null);
  const [busy, setBusy] = useState<'' | 'import' | 'publish'>('');
  const [view, setView] = useState<'builder' | 'qr' | 'sponsors'>('builder');
  const [sponsors, setSponsors] = useState<api.Sponsor[]>([]);

  // ---- load everything once: event, players, R1 seeds, settings + published cards for both rounds
  useEffect(() => {
    void (async () => {
      const e = await api.loadEvent();
      if (e.error || !e.data) return setFatal(rpcError(e.error).message);
      const id = e.data.id;
      const [ps, seeds, s1, s2, p1, p2, sp] = await Promise.all([
        api.loadPlayers(id), api.loadR1Strokes(id), api.loadSettings(id, 1), api.loadSettings(id, 2), api.loadPublished(id, 1), api.loadPublished(id, 2),
        api.loadSponsors(id),
      ]);
      const bad = [ps, seeds, s1, s2, p1, p2, sp].find((r) => r.error);
      if (bad) return setFatal(rpcError(bad.error).message);
      setPlayers(ps.data!);
      setSponsors(sp.data!);
      setR1(seeds.data!);
      const loaded = { 1: mergeSettings(s1.data, 1, e.data.holeCount), 2: mergeSettings(s2.data, 2, e.data.holeCount) };
      setSettings(loaded);
      setHoleText(holeTextOf(loaded[1]));
      setCards({ 1: p1.data!.cards, 2: p2.data!.cards });
      setPublished({ 1: p1.data!.published, 2: p2.data!.published });
      setEv(e.data);
    })();
  }, []);

  const S = settings?.[round];
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 4000); return () => clearTimeout(t); }, [toast]);

  const anyUnpublished = ([1, 2] as Round[]).some((r) => cards[r].length > 0 && hasUnpublishedChanges(cards[r], published[r]));
  useEffect(() => {
    if (!anyUnpublished) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [anyUnpublished]);

  const byId = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);
  const names = useMemo(() => Object.fromEntries(players.map((p) => [p.id, p.name])), [players]);
  const roundCards = cards[round];
  const pubMatch = useMemo(() => matchPublished(roundCards, published[round]), [roundCards, published, round]);

  if (fatal) return <Shell email={email} onSignOut={onSignOut}><div className="td-main"><div className="td-warn" role="alert">Could not load the event. {fatal}</div></div></Shell>;
  if (!ev || !S) return <Shell email={email} onSignOut={onSignOut}><p className="td-empty">Loading event…</p></Shell>;

  const isPublished = published[round].length > 0;
  const unpublished = hasUnpublishedChanges(roundCards, published[round]);
  const inWave = players.filter((p) => waveOf(p.div_code, S.pmDivisions) === wave);
  const unassigned = unassignedIds(inWave.map((p) => p.id), roundCards);
  const allUnassigned = unassignedIds(players.map((p) => p.id), roundCards);
  const waveCards = roundCards.filter((c) => c.wave === wave).sort((a, b) => a.startHole - b.startHole || a.groupNo - b.groupNo);
  const doubled = waveCards.filter((c) => c.groupNo > 1).length;
  const query = q.trim().toLowerCase();
  const hit = (id: string) => !!query && (byId.get(id)?.name.toLowerCase().includes(query) ?? false);

  const flash = (t: string) => setToast(t);
  const set = (patch: Partial<BuilderSettings>) => {
    setSettings((s) => (s ? { ...s, [round]: { ...s[round], ...patch } } : s));
    setDirty((d) => ({ ...d, [round]: true }));
  };
  const setCardsFor = (next: Card[]) => setCards((c) => ({ ...c, [round]: next }));

  const cardName = (c: Card) => {
    const p = pubMatch.get(slotKey(c));
    if (p) return `Hole ${p.label}`; // label only ever comes from the server
    const shared = roundCards.filter((o) => o.wave === c.wave && o.startHole === c.startHole).length > 1;
    return `Hole ${c.startHole}${shared ? ` · group ${c.groupNo}` : ''}`;
  };
  const metric = (p: ExistingPlayer) =>
    S.sortBy === 'r1' ? (r1[p.id] ?? '–') : (p.rating ?? (p.reg_order != null ? `#${p.reg_order}` : ''));

  // ---- actions
  const generate = () => {
    const next = S.sortBy === 'random' && roundCards.length ? { ...S, seed: S.seed + 1 } : S; // each regenerate bumps the seed
    try {
      const res = generateCards({
        players: api.toBuilderPlayers(players), settings: next, divOrder: ev.divOrder, holeCount: ev.holeCount,
        lockedCards: roundCards, r1Strokes: next.sortBy === 'r1' ? r1 : undefined,
      });
      setCardsFor(res.cards);
      setGenWarn((w) => ({ ...w, [round]: res.warnings }));
      setSettings((s) => (s ? { ...s, [round]: next } : s));
      setDirty((d) => ({ ...d, [round]: false }));
      setSel(null); setAlert(null);
      flash(`Generated ${res.cards.length} cards for Round ${round}. Nothing is live until you publish.`);
      void api.saveSettings(ev.id, round, next).then((r) => { if (r.error) setAlert({ ...rpcError(r.error), message: `Cards generated, but settings did not save. ${rpcError(r.error).message}` }); });
    } catch (e) {
      setAlert({ kind: 'generate', message: e instanceof CardGenerationError ? e.message : `Generation failed: ${String(e)}` });
    }
  };

  const publish = async (force = false) => {
    const warn = allUnassigned.length ? `\n\n${allUnassigned.length} player(s) are not on a card and won't be able to score in the app.` : '';
    const msg = force
      ? `FORCE republish Round ${round}?\n\nEvery score stays. Signatures and submissions on the rebuilt cards are dropped, so those cards must sign off again.`
      : `Publish ${roundCards.length} cards for Round ${round}? This replaces Round ${round} in the scoring app.${warn}`;
    if (!window.confirm(msg)) return;
    setBusy('publish'); setAlert(null);
    const r = await api.publishRound(ev.id, round, toPublishPayload(roundCards), force);
    setBusy('');
    if (r.error || !r.data) return setAlert(rpcError(r.error, round));
    const live = r.data;
    setPublished((p) => ({ ...p, [round]: live }));
    flash(`Published ${live.length} cards for Round ${round}. QR sheet is ready.`);
  };

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setAlert(null);
    setPending({ fileName: f.name, text: await f.text() });
  };

  const doImport = async (rows: ImportRow[], sponsorNames: string[]) => {
    const diff = importDiff(rows, players);
    setBusy('import');
    const r = rows.length ? await api.importPlayers(ev.id, rows) : { data: { inserted: 0, updated: 0, skipped: [] } };
    if (r.error || !r.data) { setBusy(''); return setAlert(rpcError(r.error)); }
    const sp = sponsorNames.length ? await api.importSponsors(ev.id, sponsorNames) : { data: { inserted: 0, existing: 0 } };
    const [ps, sl] = await Promise.all([api.loadPlayers(ev.id), api.loadSponsors(ev.id)]);
    setBusy('');
    if (ps.data) setPlayers(ps.data);
    if (sl.data) setSponsors(sl.data);
    setPending(null);
    const srv = r.data.skipped.length ? ` The server also skipped ${r.data.skipped.length} row(s).` : '';
    if (sp.error || !sp.data) return setAlert({ ...rpcError(sp.error), message: `Players imported, but sponsors failed: ${rpcError(sp.error).message}` });
    const spMsg = sp.data.inserted ? ` ${sp.data.inserted} new sponsor(s) waiting for approval in Sponsors.` : '';
    flash(`Import done: ${diff.inserts.length} new, ${diff.updates.length} changed, ${diff.unchanged.length} unchanged.${srv}${spMsg}`);
  };

  const exportCsv = () => {
    const lines = [['Round', 'Wave', 'Card', 'Start Hole', 'Player', 'Division', 'PDGA']];
    roundCards.slice().sort((a, b) => a.wave.localeCompare(b.wave) || a.startHole - b.startHole || a.groupNo - b.groupNo)
      .forEach((c) => c.playerIds.forEach((id) => { const p = byId.get(id); if (p) lines.push([String(round), c.wave, cardName(c).replace('Hole ', ''), String(c.startHole), p.name, p.div_code, p.pdga ?? '']); }));
    const blob = new Blob([lines.map((l) => l.map((x) => `"${x.replace(/"/g, '""')}"`).join(',')).join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `jewel-xi-cards-R${round}.csv`; a.click();
    URL.revokeObjectURL(a.href);
  };

  const drop = (c: Card) => {
    if (!sel) return;
    setCardsFor(movePlayer(roundCards, sel, slotKey(c)));
    flash(`Moved ${byId.get(sel)?.name ?? 'player'} to ${cardName(c)}. That card is now locked.`);
    setSel(null);
  };

  if (view === 'sponsors') {
    return <Shell email={email} onSignOut={onSignOut}>
      <SponsorsPanel eventId={ev.id} holeCount={ev.holeCount} sponsors={sponsors} onChange={setSponsors} onBack={() => setView('builder')} />
    </Shell>;
  }

  if (view === 'qr') {
    return <div className="td"><QrSheet round={round} cards={published[round]} names={names} onBack={() => setView('builder')} /></div>;
  }

  // ---- warnings (red), in the order the TD should fix them
  const warnings: string[] = [...genWarn[round]];
  if (roundCards.length && unassigned.length) warnings.push(`${unassigned.length} ${wave} player(s) are not on a card. Regenerate or move them.`);
  if (waveCards.length > ev.holeCount * 2) warnings.push(`${waveCards.length} cards for ${ev.holeCount} holes, more than 2 per hole. Consider card size 5 or adding a wave.`);
  if (waveCards.some((c) => c.playerIds.length > 5)) warnings.push('A card has more than 5 players.');
  const soft: string[] = [];
  if (S.sortBy === 'r1' && players.length && !Object.keys(r1).length) soft.push('No official R1 totals yet, so R1-score seeding falls back to rating, then name.');
  if (!players.length) soft.push('No players yet. Import the Disc Golf Scene CSV to start.');

  const status = !roundCards.length ? ['NONE', '#fff'] : !isPublished ? ['DRAFT', 'var(--over)'] : unpublished ? ['EDITED', 'var(--gold)'] : ['LIVE', 'var(--under)'];

  return (
    <Shell email={email} onSignOut={onSignOut} actions={<>
      <label className="td-btn cyan td-file">IMPORT DGS CSV<input type="file" accept=".csv,text/csv" onChange={onFile} disabled={!!busy} /></label>
      <button className="td-btn" onClick={exportCsv} disabled={!roundCards.length}>EXPORT CSV</button>
      <button className="td-btn gold" onClick={() => setView('sponsors')}>
        SPONSORS{sponsors.some((s) => s.hidden) ? ` · ${sponsors.filter((s) => s.hidden).length} NEW` : ''}
      </button>
      <button className="td-btn gold" onClick={() => setView('qr')} disabled={!isPublished || unpublished}
        title={unpublished ? 'Publish your changes first: codes come from the published round.' : undefined}>QR SHEET</button>
      <button className="td-btn cta" onClick={() => void publish(false)} disabled={!roundCards.length || !!busy}>
        {busy === 'publish' ? 'PUBLISHING…' : `PUBLISH R${round}`}
      </button>
    </>}>
      {toast && <div className="td-toast" role="status">{toast}</div>}
      <div className="td-body">
        <aside className="td-side">
          <div className="td-group">
            <div className="td-label">ROUND</div>
            <div className="td-seg">
              {([1, 2] as Round[]).map((n) => (
                <button key={n} aria-pressed={round === n} onClick={() => { setRound(n); setHoleText(holeTextOf(settings![n])); setSel(null); setAlert(null); }}>{n === 1 ? 'R1 · SAT' : 'R2 · SUN'}</button>
              ))}
            </div>
          </div>
          <div className="td-group">
            <div className="td-label">PM WAVE DIVISIONS (tap to move)</div>
            <div className="td-chips">
              {ev.divOrder.map((d) => {
                const on = S.pmDivisions.includes(d);
                return <button key={d} className="td-chip" aria-pressed={on} onClick={() => set({ pmDivisions: on ? S.pmDivisions.filter((x) => x !== d) : [...S.pmDivisions, d] })}>{d}</button>;
              })}
            </div>
            <div className="td-hint">Pink = PM (1:00pm) · outline = AM (9:00am)</div>
          </div>
          <div className="td-group">
            <div className="td-label">CARD SIZE</div>
            <div className="td-sizes">
              {([3, 4, 5] as const).map((n) => <button key={n} aria-pressed={S.size === n} onClick={() => set({ size: n })}>{n}</button>)}
            </div>
          </div>
          <div className="td-group">
            <div className="td-label">SORT WITHIN DIVISION</div>
            <select className="td-select" value={S.sortBy} onChange={(e) => set({ sortBy: e.target.value as SortBy })}>
              {SORT_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <div className="td-group" style={{ gap: 10 }}>
            {TOGGLES.map(([k, label]) => (
              <button key={k} className="td-toggle" aria-pressed={!!S[k]} onClick={() => set({ [k]: !S[k] })}>
                <span className="track"><span className="knob" /></span><span>{label}</span>
              </button>
            ))}
          </div>
          <div className="td-group">
            <div className="td-label">DOUBLE-UP HOLES FIRST (B groups)</div>
            <input className="td-input" value={holeText.double}
              onChange={(e) => { setHoleText((h) => ({ ...h, double: e.target.value })); set({ doubleUp: parseHoleList(e.target.value, ev.holeCount) }); }} />
            <div className="td-hint">Used once all {ev.holeCount} holes have a card. Long holes back up least.</div>
          </div>
          <div className="td-group">
            <div className="td-label">SKIP AS START HOLES</div>
            <input className="td-input" value={holeText.skip} placeholder="e.g. 20"
              onChange={(e) => { setHoleText((h) => ({ ...h, skip: e.target.value })); set({ skip: parseHoleList(e.target.value, ev.holeCount) }); }} />
          </div>
          <button className={`td-generate${dirty[round] || !roundCards.length ? ' fresh' : ''}`} onClick={generate} disabled={!players.length}>
            {dirty[round] || !roundCards.length ? `GENERATE CARDS · R${round}` : `REGENERATE · R${round}`}
          </button>
          <div className="td-hint">Locked cards stay put when you regenerate. Click a player, then "Move here" on any card to swap them by hand. The card they land on locks.</div>
        </aside>

        <main className="td-main">
          {pending && (
            <ImportReview fileName={pending.fileName} text={pending.text} divCodes={ev.divOrder} existing={players}
              existingSponsors={sponsors.flatMap((s) => (s.source_name ? [s.source_name] : []))}
              busy={busy === 'import'} onImport={(rows, sp) => void doImport(rows, sp)} onCancel={() => setPending(null)} />
          )}
          {alert && (
            <div className="td-warn" role="alert">
              ⚠ {alert.message}
              <div className="td-actions">
                {alert.kind === 'has_scores' && <button className="td-btn danger" onClick={() => void publish(true)} disabled={!!busy}>FORCE REPUBLISH R{round}</button>}
                <button className="td-btn" onClick={() => setAlert(null)}>DISMISS</button>
              </div>
            </div>
          )}
          <div className="td-row">
            <div className="td-seg cyan">
              {(['AM', 'PM'] as Wave[]).map((w) => <button key={w} aria-pressed={wave === w} onClick={() => setWave(w)}>{w === 'AM' ? 'AM WAVE · 9:00' : 'PM WAVE · 1:00'}</button>)}
            </div>
            <Stat v={inWave.length} k="PLAYERS" />
            <Stat v={waveCards.length} k="CARDS" color="var(--cyan)" />
            <Stat v={doubled} k="DOUBLED HOLES" color={doubled ? 'var(--gold)' : '#fff'} />
            <Stat v={status[0]} k={`ROUND ${round}`} color={status[1]} />
            <div style={{ flex: 1 }} />
            <input className="td-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find player…" aria-label="Find player" />
          </div>
          {warnings.map((w) => <div key={w} className="td-warn">⚠ {w}</div>)}
          {soft.map((w) => <div key={w} className="td-warn soft">{w}</div>)}
          {sel && (
            <div className="td-moving">
              <span>Moving: {byId.get(sel)?.name} ({byId.get(sel)?.div_code})</span><span style={{ flex: 1 }} />
              <button onClick={() => setSel(null)}>Cancel</button>
            </div>
          )}
          <div className="td-grid">
            {roundCards.length > 0 && unassigned.length > 0 && (
              <div className="td-card bad">
                <div className="td-card-head">
                  <div className="td-ring" style={{ borderColor: 'var(--error)' }}>?</div>
                  <div className="td-card-title"><b>Not on a card · {unassigned.length}</b><span>Tap a player, then Move here</span></div>
                </div>
                {unassigned.map((id) => byId.get(id)!).map((p) => (
                  <PlayerRow key={p.id} name={p.name} div={p.div_code} metric={metric(p)} selected={sel === p.id} match={hit(p.id)}
                    onClick={() => setSel(sel === p.id ? null : p.id)} />
                ))}
              </div>
            )}
            {waveCards.map((c) => {
              const ps = c.playerIds.map((id) => byId.get(id)).filter((p): p is ExistingPlayer => !!p);
              const divs = [...new Set(ps.map((p) => p.div_code))];
              const k = slotKey(c);
              const cls = c.playerIds.some(hit) ? 'hit' : c.locked ? 'locked' : ps.length < 3 || ps.length > 5 ? 'bad' : '';
              return (
                <div key={k} className={`td-card ${cls}`}>
                  <div className="td-card-head">
                    <div className={`td-ring${divs.length > 1 ? ' mixed' : ''}`}>{c.startHole}</div>
                    <div className="td-card-title"><b>{cardName(c)} · {ps.length} players</b><span>{divs.join(' · ')}</span></div>
                    <button className="td-lock" aria-pressed={c.locked} title={c.locked ? 'Unlock card' : 'Lock card'} aria-label={c.locked ? 'Unlock card' : 'Lock card'}
                      onClick={() => setCardsFor(toggleLock(roundCards, k))}>{c.locked ? '🔒' : '🔓'}</button>
                  </div>
                  {ps.map((p) => (
                    <PlayerRow key={p.id} name={p.name} div={p.div_code} metric={metric(p)} selected={sel === p.id} match={hit(p.id)}
                      onClick={() => setSel(sel === p.id ? null : p.id)} />
                  ))}
                  {sel && !c.playerIds.includes(sel) && <button className="td-drop" onClick={() => drop(c)}>MOVE HERE</button>}
                </div>
              );
            })}
          </div>
          {!waveCards.length && <div className="td-empty">No {wave} cards yet. Import the Disc Golf Scene CSV and hit Generate.</div>}
        </main>
      </div>
    </Shell>
  );
}

function Shell({ email, onSignOut, actions, children }: { email: string; onSignOut: () => void; actions?: ReactNode; children: ReactNode }) {
  return (
    <div className="td">
      <header className="td-top">
        <img src="/assets/wordmark-bare-bones-cut.png" alt="Bare Bones" />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <div className="td-title">Card Builder</div>
          <div className="td-sub">TD CONTROL · JEWEL XI · 20-HOLE SHOTGUN</div>
        </div>
        <div style={{ flex: 1 }} />
        <div className="td-actions">
          {actions}
          <button className="td-btn quiet" onClick={onSignOut} title={email}>SIGN OUT</button>
        </div>
      </header>
      {children}
    </div>
  );
}

const Stat = ({ v, k, color = '#fff' }: { v: string | number; k: string; color?: string }) => (
  <div className="td-stat"><b style={{ color }}>{v}</b><span>{k}</span></div>
);

function PlayerRow({ name, div, metric, selected, match, onClick }: {
  name: string; div: string; metric: string | number; selected: boolean; match: boolean; onClick: () => void;
}) {
  return (
    <button className={`td-player${match ? ' match' : ''}`} aria-pressed={selected} onClick={onClick}>
      <span className="n">{name}</span><span className="d">{div}</span><span className="m">{metric}</span>
    </button>
  );
}
