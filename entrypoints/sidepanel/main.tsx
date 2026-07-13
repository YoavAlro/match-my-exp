import React from 'react';
import ReactDOM from 'react-dom/client';
import { SidePanel } from '@/src/modules/sidepanel';
import './style.css';

const root = document.getElementById('root');

if (!root) {
  throw new Error('Side panel root element is missing');
}

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <SidePanel />
  </React.StrictMode>,
);
