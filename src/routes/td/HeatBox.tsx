/** BAG TAGS: this set's heat switches (time bombs, challenges, group chat) + chat moderation. Rules: migration 20261028. */
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import * as tagApi from '../../lib/tags/api';
import { display, tagMessage, type TagPool } from '../../lib/tags/tags';
import type { ChatLine } from '../../lib/tags/heat';

interface Switches { bombs: boolean; challenges: boolean; chat: boolean }

export default function HeatBox({ pool }: { pool: TagPool }) {
  const [sw, setSw] = useState<Switches | null>(null);
  const [chat, setChat] = useState<ChatLine[] | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('tag_pools').select('bombs, challenges, chat').eq('id', pool.id).single();
    if (error) return setErr(tagMessage(error));
    setSw(data as Switches); setErr('');
  }, [pool.id]);
  const loadChat = useCallback(async () => {
    const r = await tagApi.tdChat(pool.id);
    if (r.error) return setErr(tagMessage(r.error));
    setChat((r.data ?? []).slice().reverse());
  }, [pool.id]);
  useEffect(() => { void (async () => { await load(); })(); }, [load]);

  if (!sw) return err ? <div className="td-warn" role="alert">{err}</div> : null;
  const flip = async (k: keyof Switches) => {
    const next = { ...sw, [k]: !sw[k] };
    if (k === 'bombs' && next.bombs && !window.confirm('Turn on time bombs? Everyone in the top 5 gets a fresh 7-day fuse starting now.')) return;
    setBusy(true);
    const r = await tagApi.tdHeatSet(pool.id, next.bombs, next.challenges, next.chat);
    setBusy(false);
    if (r.error) return setErr(tagMessage(r.error));
    setSw(next);
  };
  const hide = async (l: ChatLine) => {
    const r = await tagApi.tdChatHide(l.id, !l.hidden);
    if (r.error) return setErr(tagMessage(r.error));
    await loadChat();
  };
  return (
    <section className="td-panel">
      <h2>Heat</h2>
      <p className="td-hint">Shake up {pool.name}. Players see all of it on their My Tag; the board shows fuses, challenges and explosions.</p>
      <Toggle on={sw.bombs} disabled={busy} onClick={() => void flip('bombs')} label="Time bombs: a top-5 tag with no tag round in 7 days explodes to the bottom (everyone below moves up)" />
      <Toggle on={sw.challenges} disabled={busy} onClick={() => void flip('challenges')} label="Challenges: challenge up to 5 spots above you; 3 declines free, the 4th drops 5 spots; 48 h silence = a decline" />
      <Toggle on={sw.chat} disabled={busy} onClick={() => void flip('chat')} label="Group chat for everyone holding a tag in this set" />
      {sw.chat && (
        <div className="td-row">
          <button className="td-btn quiet" onClick={() => void loadChat()}>{chat ? 'REFRESH CHAT' : 'MODERATE CHAT'}</button>
          {chat && <span className="td-hint">Newest first. HIDE takes a message out of everyone's chat (you can bring it back).</span>}
        </div>
      )}
      {sw.chat && chat && (
        <ul className="td-list">
          {!chat.length && <li>No messages yet.</li>}
          {chat.slice(0, 60).map((l) => (
            <li key={l.id} style={l.hidden ? { opacity: .5 } : undefined}>
              <span><b>{l.name ? display({ name: l.name, nickname: l.nickname }) : '?'}</b>: {l.body}</span>
              <button className="td-btn quiet" onClick={() => void hide(l)}>{l.hidden ? 'UNHIDE' : 'HIDE'}</button>
            </li>
          ))}
        </ul>
      )}
      {err && <div className="td-warn" role="alert">{err}</div>}
    </section>
  );
}

function Toggle({ on, disabled, onClick, label }: { on: boolean; disabled: boolean; onClick: () => void; label: string }) {
  return (
    <button type="button" className="td-toggle" aria-pressed={on} disabled={disabled} onClick={onClick}>
      <span className="track"><span className="knob" /></span><span>{label}</span>
    </button>
  );
}
