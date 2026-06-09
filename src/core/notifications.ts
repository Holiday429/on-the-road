/* ==========================================================================
   On the Road · Notification scheduler
   --------------------------------------------------------------------------
   Scans the todo store for upcoming remindAt timestamps and registers
   setTimeout-based notifications. Falls back to the ServiceWorker
   showNotification when available (works even if the tab is in background).
   ========================================================================== */

import { todoStore } from '../data/stores/todo-store.ts';

const _timers = new Map<string, ReturnType<typeof setTimeout>>();

export function scheduleAllNotifications(): void {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;

  const now = Date.now();
  const todos = todoStore.peek();

  // Cancel timers for todos that no longer exist or are done/cleared
  const liveIds = new Set(todos.map(t => t.id));
  for (const [id, timer] of _timers) {
    if (!liveIds.has(id)) { clearTimeout(timer); _timers.delete(id); }
  }

  for (const todo of todos) {
    if (!todo.remindAt || todo.done) continue;
    if (_timers.has(todo.id)) continue;   // already queued

    const delay = todo.remindAt - now;
    if (delay <= 0) continue;             // past — skip

    const timer = setTimeout(() => {
      _timers.delete(todo.id);
      fireNotification('On the Road · Reminder', todo.text);
    }, delay);

    _timers.set(todo.id, timer);
  }
}

export function clearAllNotificationTimers(): void {
  for (const timer of _timers.values()) clearTimeout(timer);
  _timers.clear();
}

function fireNotification(title: string, body: string): void {
  if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage({ type: 'SHOW_NOTIFICATION', title, body });
  } else {
    new Notification(title, {
      body,
      icon: '/on-the-road/icons/apple-touch-icon.png',
    });
  }
}

/** Call once after app boots. Re-schedules on every todo store change. */
export function initNotificationScheduler(): void {
  scheduleAllNotifications();
  todoStore.subscribe(() => {
    clearAllNotificationTimers();
    scheduleAllNotifications();
  });
}
