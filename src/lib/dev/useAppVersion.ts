import { useEffect, useState } from 'react';

/** The app's version (newest dev report), for footers and headers. Loads the data layer lazily so the first page stays small. '' until known. */
export function useAppVersion(): string {
  const [v, setV] = useState('');
  useEffect(() => {
    let live = true;
    void import('./api').then((m) => m.latestRelease()).then((r) => { if (live && r) setV(r.version); }, () => { /* no version shown */ });
    return () => { live = false; };
  }, []);
  return v;
}
