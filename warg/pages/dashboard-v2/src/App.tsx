import { BrowserRouter } from 'react-router';
import { AppRouter } from './router';
import { SettingsProvider } from './hooks/useSettings';
import { ToastProvider } from './components/ui/Toast';

export function App() {
  return (
    <BrowserRouter>
      <SettingsProvider>
        <ToastProvider>
          <AppRouter />
        </ToastProvider>
      </SettingsProvider>
    </BrowserRouter>
  );
}
