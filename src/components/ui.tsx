/**
 * Design-system primitives (club handoff "Components"). Semantic tokens only, so every one of
 * these renders correctly in the master brand and inside [data-theme="jewel-xi"].
 */
import type { ReactNode, CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import './ui.css';

type BtnVariant = 'cta' | 'accent' | 'outline' | 'outline-accent' | 'gold' | 'danger' | 'ghost';
type BtnSize = 'sm' | 'md' | 'lg';
interface BtnProps {
  variant?: BtnVariant; size?: BtnSize; children: ReactNode;
  href?: string; to?: string; onClick?: () => void; disabled?: boolean; external?: boolean; style?: CSSProperties;
}
/** `to` = in-app route, `href` = link out (opens a new tab when external). */
export function Button({ variant = 'cta', size = 'md', children, href, to, onClick, disabled, external, style }: BtnProps) {
  const cls = `ds-btn ds-btn-${variant} ds-btn-${size}`;
  if (to) return <Link className={cls} to={to} style={style}>{children}</Link>;
  if (href) return <a className={cls} href={href} style={style} {...(external ? { target: '_blank', rel: 'noreferrer' } : {})}>{children}</a>;
  return <button type="button" className={cls} onClick={onClick} disabled={disabled} style={style}>{children}</button>;
}

export function Chip({ active, onClick, children, size = 'md' }: { active?: boolean; onClick?: () => void; children: ReactNode; size?: 'sm' | 'md' }) {
  return <button type="button" className={`ds-chip ds-chip-${size}`} aria-pressed={!!active} onClick={onClick}>{children}</button>;
}

export function SectionHeading({ kicker, title, aside, size = 'm', as: Tag = 'h2' }: {
  kicker?: ReactNode; title: ReactNode; aside?: ReactNode; size?: 'xl' | 'l' | 'm' | 's'; as?: 'h1' | 'h2' | 'h3';
}) {
  return (
    <div className="ds-sh">
      <div className="ds-sh-main">
        {kicker && <div className="ds-kicker">{kicker}</div>}
        <Tag className={`ds-display ds-display-${size}`}>{title}</Tag>
      </div>
      {aside && <div className="ds-sh-aside">{aside}</div>}
    </div>
  );
}

export function Card({ title, aside, tone, children }: { title?: ReactNode; aside?: ReactNode; tone?: 'locked' | 'bad' | 'hit'; children: ReactNode }) {
  return (
    <section className={`ds-card${tone ? ` ds-card-${tone}` : ''}`}>
      {(title || aside) && <div className="ds-card-head"><span className="ds-card-title">{title}</span>{aside && <span className="ds-card-aside">{aside}</span>}</div>}
      <div className="ds-card-body">{children}</div>
    </section>
  );
}

export function Banner({ tone = 'info', children }: { tone?: 'info' | 'warn' | 'error' | 'success'; children: ReactNode }) {
  return <div className={`ds-banner ds-banner-${tone}`} role={tone === 'error' ? 'alert' : undefined}>{children}</div>;
}

/** 3px accent-b frame inset 14px, drawn above the content. */
export function InsetFrame({ children, style, className = '' }: { children: ReactNode; style?: CSSProperties; className?: string }) {
  return <div className={`ds-inset ${className}`} style={style}>{children}<span className="ds-inset-frame" aria-hidden /></div>;
}

export interface TourItem { date: string; title: string; note?: string }
export function TourList({ items, kicker }: { items: TourItem[]; kicker?: string }) {
  return (
    <div className="ds-tour">
      {kicker && <div className="ds-tour-kicker">{kicker}</div>}
      {items.map((it) => (
        <div key={it.date + it.title} className="ds-tour-row">
          <span className="ds-tour-date">{it.date}</span>
          <span><span className="ds-tour-title">{it.title}</span>{it.note && <span className="ds-tour-note">{it.note}</span>}</span>
        </div>
      ))}
    </div>
  );
}

export function HoleRing({ n, par, mixed }: { n: number | string; par?: number; mixed?: boolean }) {
  return <span className={`ds-ring${mixed ? ' ds-ring-mixed' : par && par >= 4 ? ' ds-ring-p4' : ''}`}>{n}</span>;
}

export function NarratorQuote({ children, hole }: { children: ReactNode; hole?: number }) {
  return (
    <figure className="ds-quote">
      <blockquote>{children}</blockquote>
      {hole != null && <figcaption>The narrator, hole {hole}</figcaption>}
    </figure>
  );
}

export function Skeleton({ h = 60, n = 1 }: { h?: number; n?: number }) {
  return <>{Array.from({ length: n }, (_, i) => <div key={i} className="ds-skel" style={{ height: h }} />)}</>;
}
