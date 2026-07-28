/* ==========================================================================
   On the Road · Service worker registration + update prompt
   --------------------------------------------------------------------------
   registerSW() (virtual:pwa-register, backed by src/sw.ts) replaces the old
   hand-written navigator.serviceWorker.register('/sw.js') call. The only
   behavior this adds on top of that: when Workbox detects a new build is
   waiting, show a non-blocking "reload to update" toast instead of leaving
   the user on stale code until their next full page load.
   ========================================================================== */

import { registerSW } from 'virtual:pwa-register';
import { t } from './i18n.ts';

export function initServiceWorker(): void {
  const updateSW = registerSW({
    onNeedRefresh() {
      showUpdateToast(() => { void updateSW(true); });
    },
  });
}

function showUpdateToast(onReload: () => void): void {
  const el = document.createElement('div');
  el.className = 'otr-pay-toast otr-sw-update-toast';
  el.textContent = t('sw.updateReady');
  el.setAttribute('role', 'button');
  el.setAttribute('tabindex', '0');
  el.addEventListener('click', onReload);
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') onReload(); });
  document.body.appendChild(el);
}
