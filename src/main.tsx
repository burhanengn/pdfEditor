import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './app/App';
import { registerOfflineFontFaces } from './engine/fontFaces';
import { installBrowserPerfHook } from './engine/perfMetrics';
import './index.css';

installBrowserPerfHook();
registerOfflineFontFaces();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
