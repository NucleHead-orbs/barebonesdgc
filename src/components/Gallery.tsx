import { useRef, useState } from 'react';
import './gallery.css';

export interface GalleryItem { name: string; alt: string }

/** Thumbnail strip; tap opens the full piece in a native <dialog> (Esc / backdrop / × close it). */
export function Gallery({ items, base = '/assets/art' }: { items: GalleryItem[]; base?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState<GalleryItem | null>(null);
  const show = (it: GalleryItem) => { setOpen(it); ref.current?.showModal(); };
  const close = () => ref.current?.close();
  return (
    <>
      <div className="gal" role="list">
        {items.map((it) => (
          <button key={it.name} type="button" className="gal-thumb" role="listitem" onClick={() => show(it)} aria-label={`View: ${it.alt}`}>
            <img src={`${base}/${it.name}-thumb.webp`} alt="" loading="lazy" width={360} height={360} />
          </button>
        ))}
      </div>
      <dialog ref={ref} className="gal-dlg" onClose={() => setOpen(null)} onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
        {open && <img src={`${base}/${open.name}.webp`} alt={open.alt} />}
        <button type="button" className="gal-x" onClick={close} aria-label="Close">×</button>
      </dialog>
    </>
  );
}
