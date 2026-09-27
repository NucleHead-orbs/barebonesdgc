import { Component, lazy, Suspense, type ReactNode } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useParams } from 'react-router-dom';
import Placeholder from './routes/Placeholder';
import { MasterLayout, JewelLayout } from './components/site';
const pages = () => import('./routes/site/pages');
const Home = lazy(() => pages().then((m) => ({ default: m.Home })));
const JewelOverview = lazy(() => pages().then((m) => ({ default: m.JewelOverview })));
const JewelCourse = lazy(() => pages().then((m) => ({ default: m.JewelCourse })));
const SponsorsPage = lazy(() => pages().then((m) => ({ default: m.Sponsors })));
// Each app loads only on its own route, so the first page stays small on course signal.
const TdRoute = lazy(() => import('./routes/td/TdRoute'));
const JewelApp = lazy(() => import('./routes/jewel/JewelApp'));

function CardRoute() {
  const { token } = useParams();
  return <Placeholder title="Scorecard" note={`Card ${token ?? ''}: live scoring opens before the Nov 15 warm-up. See barebonesdiscgolf.club/jewel for the course and schedule.`} />;
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
        <Route element={<MasterLayout />}>
          <Route path="/" element={<Home />} />
          <Route path="/sponsors" element={<SponsorsPage />} />
        </Route>
        <Route path="/jewel-xi" element={<JewelLayout />}>
          <Route index element={<JewelOverview />} />
          <Route path="course" element={<JewelCourse />} />
          <Route path="sponsors" element={<SponsorsPage jewel />} />
          <Route path="live" element={<Navigate to="/jewel" replace />} />
        </Route>
        <Route path="/jewel" element={<RouteGuard><Suspense fallback={null}><JewelApp /></Suspense></RouteGuard>} />
        <Route path="/c/:token" element={<CardRoute />} />
        <Route path="/td" element={<RouteGuard><Suspense fallback={null}><TdRoute /></Suspense></RouteGuard>} />
        <Route path="*" element={<Placeholder title="Not here" note="That page doesn't exist. Head back to barebonesdiscgolf.club." />} />
      </Routes>
    </BrowserRouter>
  );
}
