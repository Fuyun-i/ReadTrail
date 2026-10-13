import { createRoot } from 'react-dom/client';
import PopupApp from './PopupApp';
import { ErrorBoundary } from '../ui/ErrorBoundary';

const container = document.getElementById('root');
if (!container) throw new Error('missing #root element');
createRoot(container).render(
  <ErrorBoundary>
    <PopupApp />
  </ErrorBoundary>,
);
