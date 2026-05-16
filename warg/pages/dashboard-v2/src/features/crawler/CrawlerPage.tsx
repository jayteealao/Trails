import { Outlet } from 'react-router';
import { ArchiveInput } from '@/components/archive/ArchiveInput';

export function CrawlerPage() {
  return (
    <>
      <Outlet />
      <ArchiveInput />
    </>
  );
}
