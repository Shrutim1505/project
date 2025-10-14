import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';

const root = createRoot(document.getElementById('root'));
// Initialize theme from localStorage or system preference
const saved = localStorage.getItem('theme');
const prefersLight = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
const initialTheme = saved || (prefersLight ? 'light' : 'dark');
document.documentElement.setAttribute('data-theme', initialTheme);

root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);


