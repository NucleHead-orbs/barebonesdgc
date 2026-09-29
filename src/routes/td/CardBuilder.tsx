import { useEffect, useMemo, useState } from 'react';
import { generateCards, CardGenerationError, waveOf, type BuilderSettings, type Card, type SortBy, type Wave } from '../../lib/cards/generate';
import * as api from '../../lib/td/api';
import {
  mergeSettings, parseHoleList, slotKey, movePlayer, toggleLock, toPublishPayload, matchPublished,
  hasUnpublishedChanges, unassignedIds, rpcError, type ExistingPlayer, type PublishedCard, type RpcErrorKind,
} from '../../lib/td/builder';
import { cardPool, settingsForFormat } from '../../lib/td/setup';
import { cardIssues } from '../../lib/cards/pairing';
import { pairingFor, VIBE_MARK } from '../../lib/td/requests';
import QrSheet from './QrSheet';

type Round = 1 | 2;
type PerRound<T> = Record<Round, T>;
const SORT_OPTS: Array<[SortBy, string]> = [['rating', 'Rating (high → low)'], ['r1', 'R1 score (for R2)'], ['reg', 'Registration order'], ['random', 'Random']];
const TOGGLES: Array<[keyof BuilderSettings, string]> = [
  ['keepDivisions', 'Keep divisions together (off = mix divisions so people meet)'],
  ['mergeSmall', 'Merge tiny divisions (1–2 players) onto shared cards'],
  ['balance', 'Balance card sizes (4-4-3, not 4-4-4-1)'],
];

const holeTextOf = (s: BuilderSettings) => ({ double: s.doubleUp.join(', '), skip: s.skip.join(', ') });

/**
 * Cards & QR for one event. Format comes from the build menu (Setup): number of rounds, single or
 * AM/PM wave, holes, divisions, check-in. Card rules (size, sort, double-up…) live here, per round.
 */
export default function CardBuilder({ setup, players: allPlayers, requests, priv }: {
  setup: api.EventSetup; players: ExistingPlayer[]; requests: api.CardRequest[]; priv: api.PrivateInfo;
}) {
  const ev = setup.event;
  const holeCount = setup.holes.length;
  const divOrder = useMemo(() => setup.divisions.map((d) => d.code), [setup.divisions]);
  const pmDefault = useMemo(() => setup.divisions.filter((d) => d.wave === 'PM').map((d) => d.code), [setup.divisions]);
  const rounds: Round[] = ev.rounds === 2 ? [1, 2] : [1];
  const twoWaves = ev.waves === 2;
  const players = useMemo(() => cardPool(allPlayers, ev.use_checkin), [allPlayers, ev.use_checkin]);
  const notIn = allPlayers.length - players.length;

  const [fatal, setFatal] = useState('');
  const [loaded, setLoaded] = useState(false);
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
  const [busy, setBusy] = useState<'' | 'publish'>('');
  const [view, setView] = useState<'builder' | 'qr'>('builder');

  // ---- load once per mount (the workspace remounts this when Setup changes): R1 seeds, settings + published cards
  useEffect(() => {
    void (async () => {
      const [seeds, s1, s2, p1, p2] = await Promise.all([
        api.loadR1Strokes(ev.id), api.loadSettings(ev.id, 1), api.loadSettings(ev.id, 2), api.loadPublished(ev.id, 1), api.loadPublished(ev.id, 2),
      ]);
      const bad = [seeds, s1, s2, p1, p2].find((r) => r.error);
      if (bad) return setFatal(rpcError(bad.error).message);
      setR1(seeds.data!);
      const fit = (s: BuilderSettings) => settingsForFormat(s, ev.waves);
      const next = { 1: fit(mergeSettings(s1.data, 1, holeCount, pmDefault)), 2: fit(mergeSettings(s2.data, 2, holeCount, pmDefault)) };
      setSettings(next);
      setHoleText(holeTextOf(next[1]));
      setCards({ 1: p1.data!.cards, 2: p2.data!.cards });
      setPublished({ 1: p1.data!.published, 2: p2.data!.published });
      setLoaded(true);
    })();
  }, [ev.id, ev.waves, holeCount, pmDefault]);

  const S = settings?.[round];
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 4000); return () => clearTimeout(t); }, [toast]);

  const anyUnpublished = rounds.some((r) => cards[r].length > 0 && hasUnpublishedChanges(cards[r], published[r]));
  useEffect(() => {
    if (!anyUnpublished) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [anyUnpublished]);

  const byId = useMemo(() => new Map(allPlayers.map((p) => [p.id, p])), [allPlayers]);
  const names = useMemo(() => Object.fromEntries(allPlayers.map((p) => [p.id, p.name])), [allPlayers]);
  const roundCards = cards[round];
  const pubMatch = useMemo(() => matchPublished(roundCards, published[round]), [roundCards, published, round]);

  if (fatal) return <div className="td-main"><div className="td-warn" role="alert">Could not load cards. {fatal}</div></div>;
  if (!loaded || !S) return <p className="td-empty">Loading cards…</p>;

  const isPublished = published[round].length > 0;
  const unpublished = hasUnpublishedChanges(roundCards, published[round]);
  const shownWave: Wave = twoWaves ? wave : 'AM';
  const inWave = players.filter((p) => waveOf(p.div_code, S.pmDivisions) === shownWave);
  const unassigned = unassignedIds(inWave.map((p) => p.id), roundCards);
  const allUnassigned = unassignedIds(players.map((p) => p.id), roundCards);
  const waveCards = roundCards.filter((c) => c.wave === shownWave).sort((a, b) => a.startHole - b.startHole || a.groupNo - b.groupNo);
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
    const base = S.sortBy === 'random' && roundCards.length ? { ...S, seed: S.seed + 1 } : S; // each regenerate bumps the seed
    const next = settingsForFormat(base, ev.waves);
    try {
      const res = generateCards({
        players: api.toBuilderPlayers(players), settings: next, divOrder, holeCount,
        lockedCards: roundCards, // generate drops anyone no longer in the pool (e.g. un-checked-in) from locked cards
        r1Strokes: next.sortBy === 'r1' ? r1 : undefined,
        pairing: pairingFor(requests, priv, round),
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

  const exportCsv = () => {
    const lines = [['Round', 'Wave', 'Card', 'Start Hole', 'Player', 'Division', 'PDGA']];
    roundCards.slice().sort((a, b) => a.wave.localeCompare(b.wave) || a.startHole - b.startHole || a.groupNo - b.groupNo)
      .forEach((c) => c.playerIds.forEach((id) => { const p = byId.get(id); if (p) lines.push([String(round), c.wave, cardName(c).replace('Hole ', ''), String(c.startHole), p.name, p.div_code, p.pdga ?? '']); }));
    const blob = new Blob([lines.map((l) => l.map((x) => `"${x.replace(/"/g, '""')}"`).join(',')).join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `${ev.slug}-cards-R${round}.csv`; a.click();
    URL.revokeObjectURL(a.href);
  };

  const drop = (c: Card) => {
    if (!sel) return;
    setCardsFor(movePlayer(roundCards, sel, slotKey(c)));
    flash(`Moved ${byId.get(sel)?.name ?? 'player'} to ${cardName(c)}. That card is now locked.`);
    setSel(null);
  };

  if (view === 'qr') {
    return <QrSheet round={round} eventName={ev.name} cards={published[round]} names={names} onBack={() => setView('builder')} />;
  }

  // ---- warnings (red), in the order the TD should fix them. Pairing issues are recomputed live, so hand moves show them too.
  const warnings: string[] = [...genWarn[round], ...cardIssues(roundCards.map((c) => c.playerIds), pairingFor(requests, priv, round), (id) => byId.get(id)?.name ?? '?')];
  if (roundCards.length && unassigned.length) warnings.push(`${unassigned.length} ${twoWaves ? `${shownWave} ` : ''}player(s) are not on a card. Regenerate or move them.`);
  if (waveCards.length > holeCount * 2) warnings.push(`${waveCards.length} cards for ${holeCount} holes, more than 2 per hole. Consider card size 5${twoWaves ? ' or moving divisions to the other wave' : ''}.`);
  if (waveCards.some((c) => c.playerIds.length > 5)) warnings.push('A card has more than 5 players.');
  const soft: string[] = [];
  if (S.sortBy === 'r1' && players.length && !Object.keys(r1).length) soft.push('No official R1 totals yet, so R1-score seeding falls back to rating, then name.');
  if (ev.use_checkin && notIn > 0) soft.push(`${notIn} registered player${notIn === 1 ? " isn't" : "s aren't"} checked in and won't be put on cards. Check them in on the Players tab, then regenerate.`);
  if (!players.length) soft.push(ev.use_checkin && allPlayers.length ? 'Nobody is checked in yet. Check players in on the Players tab.' : 'No players yet. Add or import them on the Players tab.');

  const status = !roundCards.length ? ['NONE', '#fff'] : !isPublished ? ['DRAFT', 'var(--over)'] : unpublished ? ['EDITED', 'var(--gold)'] : ['LIVE', 'var(--under)'];

  return (
    <>
      <div className="td-toolbar">
        <div className="td-stat"><b style={{ color: status[1] }}>{status[0]}</b><span>ROUND {round}</span></div>
        <div style={{ flex: 1 }} />
        <button className="td-btn" onClick={exportCsv} disabled={!roundCards.length}>EXPORT CSV</button>
        <button className="td-btn gold" onClick={() => setView('qr')} disabled={!isPublished || unpublished}
          title={unpublished ? 'Publish your changes first: codes come from the published round.' : undefined}>QR SHEET</button>
        <button className="td-btn cta" onClick={() => void publish(false)} disabled={!roundCards.length || !!busy}>
          {busy === 'publish' ? 'PUBLISHING…' : `PUBLISH R${round}`}
        </button>
      </div>
      {toast && <div className="td-toast" role="status">{toast}</div>}
      <div className="td-body">
        <aside className="td-side">
          {rounds.length > 1 && (
            <div className="td-group">
              <div className="td-label">ROUND</div>
              <div className="td-seg">
                {rounds.map((n) => (
                  <button key={n} aria-pressed={round === n} onClick={() => { setRound(n); setHoleText(holeTextOf(settings![n])); setSel(null); setAlert(null); }}>ROUND {n}</button>
                ))}
              </div>
            </div>
          )}
          {twoWaves && (
            <div className="td-group">
              <div className="td-label">PM WAVE DIVISIONS (tap to move)</div>
              <div className="td-chips">
                {divOrder.map((d) => {
                  const on = S.pmDivisions.includes(d);
                  return <button key={d} className="td-chip" aria-pressed={on} onClick={() => set({ pmDivisions: on ? S.pmDivisions.filter((x) => x !== d) : [...S.pmDivisions, d] })}>{d}</button>;
                })}
              </div>
              <div className="td-hint">Filled = PM wave · outline = AM wave. Starts from the waves set in Setup.</div>
            </div>
          )}
          <div className="td-group">
            <div className="td-label">CARD SIZE</div>
            <div className="td-sizes">
              {([3, 4, 5] as const).map((n) => <button key={n} aria-pressed={S.size === n} onClick={() => set({ size: n })}>{n}</button>)}
            </div>
          </div>
          <div className="td-group">
            <div className="td-label">SORT WITHIN DIVISION</div>
            <select className="td-select" value={S.sortBy} onChange={(e) => set({ sortBy: e.target.value as SortBy })}>
              {SORT_OPTS.filter(([v]) => v !== 'r1' || round === 2).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
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
            <input className="td-input" value={holeText.double} placeholder="e.g. 6, 15, 14"
              onChange={(e) => { setHoleText((h) => ({ ...h, double: e.target.value })); set({ doubleUp: parseHoleList(e.target.value, holeCount) }); }} />
            <div className="td-hint">Used once all {holeCount} holes have a card. Long holes back up least.</div>
          </div>
          <div className="td-group">
            <div className="td-label">SKIP AS START HOLES</div>
            <input className="td-input" value={holeText.skip} placeholder="e.g. 18"
              onChange={(e) => { setHoleText((h) => ({ ...h, skip: e.target.value })); set({ skip: parseHoleList(e.target.value, holeCount) }); }} />
          </div>
          <button className={`td-generate${dirty[round] || !roundCards.length ? ' fresh' : ''}`} onClick={generate} disabled={!players.length}>
            {dirty[round] || !roundCards.length ? `GENERATE CARDS · R${round}` : `REGENERATE · R${round}`}
          </button>
          <div className="td-hint">Locked cards stay put when you regenerate. Click a player, then "Move here" on any card to swap them by hand. The card they land on locks.</div>
        </aside>

        <main className="td-main">
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
            {twoWaves && (
              <div className="td-seg cyan">
                {(['AM', 'PM'] as Wave[]).map((w) => <button key={w} aria-pressed={wave === w} onClick={() => setWave(w)}>{w} WAVE</button>)}
              </div>
            )}
            <Stat v={inWave.length} k="PLAYERS" />
            <Stat v={waveCards.length} k="CARDS" color="var(--cyan)" />
            <Stat v={doubled} k="DOUBLED HOLES" color={doubled ? 'var(--gold)' : '#fff'} />
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
                  <PlayerRow key={p.id} name={p.name} mark={priv.vibe[p.id] ? VIBE_MARK[priv.vibe[p.id]] : ''} div={p.div_code} metric={metric(p)} selected={sel === p.id} match={hit(p.id)}
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
                    <PlayerRow key={p.id} name={p.name} mark={priv.vibe[p.id] ? VIBE_MARK[priv.vibe[p.id]] : ''} div={p.div_code} metric={metric(p)} selected={sel === p.id} match={hit(p.id)}
                      onClick={() => setSel(sel === p.id ? null : p.id)} />
                  ))}
                  {sel && !c.playerIds.includes(sel) && <button className="td-drop" onClick={() => drop(c)}>MOVE HERE</button>}
                </div>
              );
            })}
          </div>
          {!waveCards.length && <div className="td-empty">No {twoWaves ? `${shownWave} ` : ''}cards yet. Hit Generate.</div>}
        </main>
      </div>
    </>
  );
}

const Stat = ({ v, k, color = '#fff' }: { v: string | number; k: string; color?: string }) => (
  <div className="td-stat"><b style={{ color }}>{v}</b><span>{k}</span></div>
);

function PlayerRow({ name, mark, div, metric, selected, match, onClick }: {
  name: string; mark: string; div: string; metric: string | number; selected: boolean; match: boolean; onClick: () => void;
}) {
  return (
    <button className={`td-player${match ? ' match' : ''}`} aria-pressed={selected} onClick={onClick}>
      <span className="n">{name}{mark && <span className="td-mark"> {mark}</span>}</span><span className="d">{div}</span><span className="m">{metric}</span>
    </button>
  );
}
