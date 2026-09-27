import { useEffect, useState } from 'react';

/** Run a loader once; returns { data } or { error } (a message, never a throw). Pass a stable function. */
export function useLoad<T>(fn: () => Promise<T>) {
  const [state, setState] = useState<{ data?: T; error?: string }>({});
  useEffect(() => {
    let live = true;
    fn().then((data) => live && setState({ data }), (e: unknown) => live && setState({ error: e instanceof Error ? e.message : String(e) }));
    return () => { live = false; };
  }, [fn]);
  return state;
}
