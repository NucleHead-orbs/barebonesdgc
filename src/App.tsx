import { Component, lazy, Suspense, type ReactNode } from 'react';
import { BrowserRouter, Routes, Route, useParams } from 'react-router-dom';
import Placeholder from './routes/Placeholder';
// TD tools load only on /td, so the player bundle stays small on course signal.
const TdRoute = lazy(() => import('./routes/td/TdRoute'));

function CardRoute() {
  const { token } = useParams();
  return <Placeholder title="Scorecard" note={`Card ${token ?? ''} — scorecard screen lands in build step 3.`} />;
}

/** A route that fails to load (bad deploy config, dropped chunk on course signal) says so instead of going blank. */
class RouteGuard extends Component<{ children: ReactNode }, { error: string }> {
  state = { error: '' };
  static getDerivedStateFromError(e: unknown) { return { error: e instanceof Error ? e.message : String(e) }; }
  render() {
    if (!this.state.error) return this.props.children;
    return <Placeholder title="Couldn't load this page" note={`${this.state.error} Reload to try again. If it keeps happening, tell the TD.`} />;
  }
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Placeholder title="Bare Bones" note="Main club site — content pending." />} />
        <Route path="/jewel" element={<Placeholder title="Jewel XI World Tour" note="Leaderboard, course, info — build step 4." />} />
        <Route path="/c/:token" element={<CardRoute />} />
        <Route path="/td" element={<RouteGuard><Suspense fallback={null}><TdRoute /></Suspense></RouteGuard>} />
        <Route path="*" element={<Placeholder title="Not here" note="That page doesn't exist. Head back to barebones.club." />} />
      </Routes>
    </BrowserRouter>
  );
}
