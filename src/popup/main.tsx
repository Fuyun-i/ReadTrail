import { createRoot } from 'react-dom/client';
import PopupApp from './PopupApp';

const container = document.getElementById('root');
if (!container) throw new Error('missing #root element');
createRoot(container).render(<PopupApp />);
