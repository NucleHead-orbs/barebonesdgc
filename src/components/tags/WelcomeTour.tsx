/**
 * My Tag welcome tour: 3 big, plain steps the first time someone opens their My Tag on a phone (per member, per device),
 * and again from HOW IT WORKS. Written for someone who has never used an app like this.
 */
import { useEffect, useState } from 'react';
import { SkullMascot } from '../dev/SkullMascot';
import './board.css';

import { markWelcomeSeen as markSeen } from '../../lib/tags/useHeat';

export function WelcomeTour({ memberId, first, tag, onClose }: { memberId: string; first: string; tag: string | null; onClose: () => void }) {
  const [step, setStep] = useState(0);
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const close = () => { markSeen(memberId); onClose(); };
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { markSeen(memberId); onClose(); } };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [memberId, onClose]);
  const steps = [
    {
      title: `Welcome, ${first}.`,
      body: <>
        <p>This page is <b>your bag tag</b>{tag ? <> (you're <b>{tag}</b>)</> : ''}. Lower number is better.</p>
        <p>Play a round with tags on the line, beat someone with a better number, and you take their number. That's the whole game.</p>
      </>,
    },
    {
      title: 'Put it on your home screen',
      body: <>
        <p>So it's one tap next time, like an app:</p>
        {ios
          ? <ol><li>Tap the <b>Share</b> button at the bottom (a square with an arrow pointing up).</li><li>Scroll down, tap <b>Add to Home Screen</b>.</li><li>Tap <b>Add</b>.</li></ol>
          : <ol><li>Tap the <b>three dots ⋮</b> at the top right.</li><li>Tap <b>Add to Home screen</b> (or <b>Install</b>).</li><li>Tap <b>Add</b>.</li></ol>}
        <p className="wt-small">{ios ? 'On Android: three dots ⋮, then Add to Home screen.' : 'On iPhone: Share, then Add to Home Screen.'}</p>
      </>,
    },
    {
      title: 'How a round counts',
      body: <>
        <ol>
          <li>Keep score on the <b>Scorecard</b> (the link is on this page).</li>
          <li>Before you tee off, tick <b>Tags on the line</b>.</li>
          <li>Everyone taps <b>CONFIRM</b> on their own My Tag. Tags swap.</li>
        </ol>
        <p>Stuck on anything? Tap the little <b>skull</b> in the corner and tell us. A real person reads it.</p>
      </>,
    },
  ];
  const s = steps[step];
  const last = step === steps.length - 1;
  return (
    <div className="wt-back" role="dialog" aria-modal="true" aria-labelledby="wt-title">
      <div className="wt">
        <div className="wt-head"><SkullMascot size={56} /><span className="wt-count">{step + 1} of {steps.length}</span></div>
        <h2 id="wt-title">{s.title}</h2>
        <div className="wt-body">{s.body}</div>
        <div className="wt-row">
          {step > 0 ? <button className="wt-btn quiet" onClick={() => setStep(step - 1)}>BACK</button> : <button className="wt-btn quiet" onClick={close}>SKIP</button>}
          <button className="wt-btn" onClick={() => (last ? close() : setStep(step + 1))}>{last ? "GOT IT, LET'S PLAY" : 'NEXT'}</button>
        </div>
      </div>
    </div>
  );
}
