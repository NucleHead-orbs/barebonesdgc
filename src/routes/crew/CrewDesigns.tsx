/** Crew DESIGNS tab: what the TD switched on (SHOW CREW). Proofs render live with the TD's picks; files open through a short-lived link. */
import { useState } from 'react';
import * as crewApi from '../../lib/crew/api';
import type { CrewDesign } from '../../lib/crew/api';
import { ProofView } from '../../components/proofs/Proofs';
import { PROOF_KINDS, type ProofKind } from '../../lib/proofs/proofs';
import { designCategoryLabel, fmtBytes, STATUS_LABEL } from '../../lib/prep/prep';

export function CrewDesigns({ token, eventId, designs, onError }: { token: string; eventId: string; designs: CrewDesign[]; onError: (m: string) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [broken, setBroken] = useState<Record<string, boolean>>({});
  const cur = designs.find((d) => d.id === open) ?? null;

  const view = async (d: CrewDesign) => {
    if (!d.file) return;
    const r = await crewApi.designFileUrl(token, d.file.id);
    if (r.error || !r.data) return onError("That file isn't available anymore. Ask the TD.");
    setUrls((u) => ({ ...u, [d.file!.id]: r.data! }));
  };
  const isImg = (d: CrewDesign) => !!d.file && (/^image\//.test(d.file.mime ?? '') || /\.(png|jpe?g|webp|gif)$/i.test(d.file.file_name));

  if (cur?.proof && PROOF_KINDS.includes(cur.proof as ProofKind)) {
    return (
      <section className="td-proof">
        <button className="td-btn" style={{ alignSelf: 'flex-start' }} onClick={() => setOpen(null)}>‹ ALL DESIGNS</button>
        <ProofView kind={cur.proof as ProofKind} eventId={eventId} saved={cur.proof_opts} />
      </section>
    );
  }
  return (
    <>
      <section className="td-panel">
        <h2>Designs</h2>
        <p className="td-hint">What the TD is making for this event. Proofs are live: tap colors to preview; the TD's pick is marked. Only the TD changes them.</p>
      </section>
      {designs.map((d) => (
        <article key={d.id} className="td-panel">
          <div className="td-row">
            <b style={{ flex: 1 }}>{d.title}</b>
            <span className="td-hint">{designCategoryLabel(d.category)} · {STATUS_LABEL[d.status]}</span>
          </div>
          {d.notes && <p className="td-hint">{d.notes}</p>}
          {d.file && urls[d.file.id] && isImg(d) && !broken[d.file.id] && <img src={urls[d.file.id]} alt={`${d.title} v${d.file.version}`} onError={() => { const f = d.file; if (f) setBroken((b) => ({ ...b, [f.id]: true })); }} style={{ width: '100%', borderRadius: 8, background: '#000' }} />}
          {d.file && broken[d.file.id] && <p className="td-hint">Preview couldn't load. Try OPEN FULL SIZE, or ask the TD to re-upload.</p>}
          <div className="td-row">
            {d.proof && <button className="td-btn cta" onClick={() => setOpen(d.id)}>OPEN PROOF</button>}
            {d.file && !urls[d.file.id] && <button className="td-btn quiet" onClick={() => void view(d)}>SHOW FILE · v{d.file.version} · {fmtBytes(d.file.bytes)}</button>}
            {d.file && urls[d.file.id] && <a className="td-btn quiet" href={urls[d.file.id]} target="_blank" rel="noreferrer">OPEN FULL SIZE ↗</a>}
            {!d.proof && !d.file && <span className="td-hint">No file yet.</span>}
          </div>
        </article>
      ))}
    </>
  );
}
