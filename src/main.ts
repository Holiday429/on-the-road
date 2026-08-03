/* ==========================================================================
   On the Road · Entry point
   ========================================================================== */

import './core/base.css';
import './core/app.css';

import { registerView } from './core/app.ts';
import { initTheme } from './core/theme.ts';
import { setViewChunkLoaders, startBoot } from './boot-shell.ts';

// Take over from app.html's inline pre-paint script: wire the system-theme
// listener and keep data-theme / meta theme-color current from here on.
initTheme();
// Dashboard is the default landing view (see currentViewOrDefault) — kept as
// a static import so the first paint doesn't wait on a dynamic import. Every
// other view is lazy: its module (and CSS) is fetched on first navigation,
// whether that's a click or landing directly via a deep-link hash.
import { initDashboard } from './views/dashboard/dashboard.ts';

// Raw module loaders for the lazy views. Each just fetches the chunk (no init).
// Reused two ways: registerView() resolves the init fn from it on first
// navigation, and boot-shell's prefetchViewChunks() warms all of them into the
// SW cache so any view opens offline even if the user never visited it online first.
const VIEW_CHUNK_LOADERS = [
  () => import('./views/calendar/calendar.ts'),
  () => import('./views/checklist/checklist.ts'),
  () => import('./views/itinerary/itinerary.ts'),
  () => import('./views/expenses/expenses.ts'),
  () => import('./views/guide/guide.ts'),
  () => import('./views/journal/index.ts'),
  () => import('./views/map/map.ts'),
  () => import('./views/compare/compare.ts'),
  () => import('./views/pack/pack.ts'),
  () => import('./views/profile/profile.ts'),
];
setViewChunkLoaders(VIEW_CHUNK_LOADERS);

// Register view inits (fire once on first navigation). Dashboard is eager;
// every other view is a lazy loader — app.ts dynamic-imports the module the
// first time the view is opened, then caches the resolved init fn.
registerView('today',    initDashboard);
registerView('calendar', () => import('./views/calendar/calendar.ts').then(m => m.initCalendar));
registerView('prep',     () => import('./views/checklist/checklist.ts').then(m => m.initPrep));
registerView('route',    () => import('./views/itinerary/itinerary.ts').then(m => m.initRoute));
registerView('expenses', () => import('./views/expenses/expenses.ts').then(m => m.initExpenses));
registerView('cities',   () => import('./views/guide/guide.ts').then(m => m.initCities));
registerView('journal',  () => import('./views/journal/index.ts').then(m => m.initJournal));
registerView('map',      () => import('./views/map/map.ts').then(m => m.initMap));
registerView('budget',   () => import('./views/compare/compare.ts').then(m => m.initCompare));
registerView('pack',     () => import('./views/pack/pack.ts').then(m => m.initPack));
registerView('profile',  () => import('./views/profile/profile.ts').then(m => m.initProfile));

startBoot();
