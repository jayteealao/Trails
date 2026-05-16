import { Outlet } from 'react-router';
import { Header } from './Header';
import { Sidebar } from './Sidebar';
import { RightPanel } from './RightPanel';
import { Footer } from './Footer';

export function Shell() {
  return (
    <div className="corner-frame corner-tr corner-bl flex flex-col h-screen overflow-hidden">
      {/* Grid dot background */}
      <div className="bg-grid-dots" />

      <Header />

      <div className="flex flex-1 overflow-hidden relative z-10">
        <Sidebar />

        {/* Main content area */}
        <main className="flex-1 overflow-y-auto p-4">
          <Outlet />
        </main>

        <RightPanel />
      </div>

      <Footer />
    </div>
  );
}
