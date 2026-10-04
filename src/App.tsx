import { Component, lazy, Suspense, type ReactNode } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Placeholder from './routes/Placeholder';
import { MasterLayout, JewelLayout } from './components/site';
const pages = () => import('./routes/site/pages');
const Home = lazy(() => pages().then((m) => ({ default: m.Home })));
const JewelOverview = lazy(() => pages().then((m) => ({ default: m.JewelOverview })));
const JewelCourse = lazy(() => pages().then((m) => ({ default: m.JewelCourse })));
const JewelBand = lazy(() => pages().then((m) => ({ default: m.JewelBand })));
const SponsorsPage = lazy(() => pages().then((m) => ({ default: m.Sponsors })));
const MusicPage = lazy(() => pages().then((m) => ({ default: m.Music })));
const GalleryPage = lazy(() => import('./routes/site/GalleryPage'));
const LeaguesPage = lazy(() => import('./routes/site/LeaguesPage'));
const tagPages = () => import('./routes/site/TagsPages');
const TagsBoard = lazy(() => tagPages().then((m) => ({ default: m.TagsBoard })));
const TagPage = lazy(() => tagPages().then((m) => ({ default: m.TagPage })));
const MyTagApp = lazy(() => import('./routes/tag/MyTagApp'));
const TagRoom = lazy(() => import('./routes/tag/TagRoom'));
const earlyPages = () => import('./routes/site/EarlyAccess');
const EarlyAccess = lazy(earlyPages);
const EarlyAccessBySlug = lazy(() => earlyPages().then((m) => ({ default: m.EarlyAccessBySlug })));
const roundPages = () => import('./routes/rounds/RoundsPage');
const RoundsList = lazy(() => roundPages().then((m) => ({ default: m.RoundsList })));
const RoundDetail = lazy(() => roundPages().then((m) => ({ default: m.RoundDetail })));
const ScorecardApp = lazy(() => import('./routes/rounds/ScorecardApp'));
// Each app loads only on its own route, so the first page stays small on course signal.
const TdRoute = lazy(() => import('./routes/td/TdRoute'));
const JewelApp = lazy(() => import('./routes/jewel/JewelApp'));
const CardApp = lazy(() => import('./routes/card/CardApp'));
const EventBoard = lazy(() => import('./routes/event/EventBoard'));
const RequestPage = lazy(() => import('./routes/event/RequestPage'));
const WinnersPage = lazy(() => import('./routes/event/WinnersPage'));
const CrewApp = lazy(() => import('./routes/crew/CrewApp'));

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
          <Route path="/music" element={<MusicPage />} />
          <Route path="/leagues" element={<LeaguesPage />} />
          <Route path="/tags" element={<TagsBoard />} />
          <Route path="/tags/:pool" element={<TagsBoard />} />
          <Route path="/tags/:pool/:number" element={<TagPage />} />
          <Route path="/gallery" element={<GalleryPage />} />
          <Route path="/rounds" element={<RoundsList />} />
          <Route path="/rounds/:id" element={<RoundDetail />} />
          <Route path="/e/:slug/early-access" element={<EarlyAccessBySlug />} />
        </Route>
        <Route path="/jewel-xi" element={<JewelLayout />}>
          <Route index element={<JewelOverview />} />
          <Route path="course" element={<JewelCourse />} />
          <Route path="band" element={<JewelBand />} />
          <Route path="early-access" element={<EarlyAccess />} />
          <Route path="sponsors" element={<SponsorsPage jewel />} />
          <Route path="live" element={<Navigate to="/jewel" replace />} />
        </Route>
        <Route path="/jewel" element={<RouteGuard><Suspense fallback={null}><JewelApp /></Suspense></RouteGuard>} />
        <Route path="/c/:token" element={<RouteGuard><Suspense fallback={null}><CardApp /></Suspense></RouteGuard>} />
        <Route path="/e/:slug/winners" element={<RouteGuard><Suspense fallback={null}><WinnersPage /></Suspense></RouteGuard>} />
        <Route path="/e/:slug/request" element={<RouteGuard><Suspense fallback={null}><RequestPage /></Suspense></RouteGuard>} />
        <Route path="/e/:slug" element={<RouteGuard><Suspense fallback={null}><EventBoard /></Suspense></RouteGuard>} />
        <Route path="/scorecard" element={<RouteGuard><Suspense fallback={null}><ScorecardApp /></Suspense></RouteGuard>} />
        <Route path="/tag/:token" element={<RouteGuard><Suspense fallback={null}><MyTagApp /></Suspense></RouteGuard>} />
        <Route path="/room/:token" element={<RouteGuard><Suspense fallback={null}><TagRoom /></Suspense></RouteGuard>} />
        <Route path="/crew/:token" element={<RouteGuard><Suspense fallback={null}><CrewApp /></Suspense></RouteGuard>} />
        <Route path="/td" element={<RouteGuard><Suspense fallback={null}><TdRoute /></Suspense></RouteGuard>} />
        <Route path="*" element={<Placeholder title="Not here" note="That page doesn't exist. Head back to barebonesdiscgolf.club." />} />
      </Routes>
    </BrowserRouter>
  );
}
