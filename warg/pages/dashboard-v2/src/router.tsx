import { Routes, Route, Navigate } from 'react-router';
import { Shell } from './components/layout/Shell';
import { DashboardPage } from './features/dashboard/DashboardPage';
import { OverviewView } from './features/dashboard/OverviewView';
import { FeedView } from './features/dashboard/FeedView';
import { ErrorsView } from './features/dashboard/ErrorsView';
import { InfraView } from './features/dashboard/InfraView';
import { CrawlerPage } from './features/crawler/CrawlerPage';
import { RequestsView } from './features/crawler/RequestsView';
import { RequestDetailView } from './features/crawler/RequestDetailView';
import { BackfillView } from './features/crawler/BackfillView';
import { DatabasePage } from './features/database/DatabasePage';
import { ArticlesView } from './features/database/ArticlesView';
import { ArticleDetailView } from './features/database/ArticleDetailView';

export function AppRouter() {
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route index element={<Navigate to="/dashboard" replace />} />

        <Route path="dashboard" element={<DashboardPage />}>
          <Route index element={<OverviewView />} />
          <Route path="feed" element={<FeedView />} />
          <Route path="errors" element={<ErrorsView />} />
          <Route path="infra" element={<InfraView />} />
        </Route>

        <Route path="crawler" element={<CrawlerPage />}>
          <Route index element={<RequestsView />} />
          <Route path="requests/:id" element={<RequestDetailView />} />
          <Route path="backfill" element={<BackfillView />} />
        </Route>

        <Route path="database" element={<DatabasePage />}>
          <Route index element={<ArticlesView />} />
          <Route path="articles/:id" element={<ArticleDetailView />} />
        </Route>
      </Route>
    </Routes>
  );
}
