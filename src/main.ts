/* ==========================================================================
   On the Road · Entry point
   ========================================================================== */

import './core/base.css';
import './core/app.css';

import { initApp, registerView } from './core/app.ts';
import { initPrep }     from './views/prep/prep.ts';
import { initRoute }    from './views/route/route.ts';
import { initExpenses } from './views/expenses/expenses.ts';
import { initCities }   from './views/cities/cities.ts';
import { initStubs }    from './views/stubs.ts';

// Register lazy view inits (fire once on first navigation)
registerView('prep',     initPrep);
registerView('route',    initRoute);
registerView('expenses', initExpenses);
registerView('cities',   initCities);

// Boot the app shell + router
initApp();

// Init stub views immediately (lightweight)
initStubs();
