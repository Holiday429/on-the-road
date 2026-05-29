/* ==========================================================================
   On the Road · Prep Checklist
   ========================================================================== */

import './prep.css';

interface Task {
  id: string;
  text: string;
  note?: string;
  done: boolean;
  category: string;
  phase: Phase;
}

type Phase = '60d' | '30d' | '14d' | '7d' | '1d';

interface Category {
  id: string;
  label: string;
  icon: string;
}

const PHASES: { id: Phase; label: string; days: number }[] = [
  { id: '60d', label: '60 days out', days: 60 },
  { id: '30d', label: '30 days out', days: 30 },
  { id: '14d', label: '2 weeks out', days: 14 },
  { id: '7d',  label: '1 week out',  days: 7  },
  { id: '1d',  label: 'Day before',  days: 1  },
];

const CATEGORIES: Category[] = [
  { id: 'docs',      label: 'Documents',      icon: '📄' },
  { id: 'money',     label: 'Money & cards',  icon: '💳' },
  { id: 'insurance', label: 'Insurance',      icon: '🛡️' },
  { id: 'health',    label: 'Health',         icon: '💊' },
  { id: 'comms',     label: 'Comms & tech',   icon: '📱' },
  { id: 'notify',    label: 'Notify people',  icon: '📢' },
  { id: 'pack',      label: 'Packing',        icon: '🎒' },
  { id: 'logistics', label: 'Logistics',      icon: '✈️' },
  { id: 'misc',      label: 'Misc',           icon: '📌' },
];

const TEMPLATE: Omit<Task, 'id' | 'done'>[] = [
  // 60 days
  { text: 'Check passport expiry (must be 6mo+ valid)', note: 'Most EU countries require 6 months validity', category: 'docs', phase: '60d' },
  { text: 'Apply for Schengen visa if needed', category: 'docs', phase: '60d' },
  { text: 'Research travel insurance options', note: 'World Nomads or SafetyWing for long-term', category: 'insurance', phase: '60d' },
  { text: 'Get international credit card (no FX fees)', note: 'Charles Schwab, Wise, or Revolut', category: 'money', phase: '60d' },
  { text: 'Book major flights (Copenhagen ↔ Europe)', category: 'logistics', phase: '60d' },

  // 30 days
  { text: 'Purchase travel insurance', category: 'insurance', phase: '30d' },
  { text: 'Upload passport + ID to cloud (Google Drive / iCloud)', note: 'Also email copies to yourself', category: 'docs', phase: '30d' },
  { text: 'Note embassy contacts for each country', category: 'docs', phase: '30d' },
  { text: 'Inform bank of travel dates', category: 'money', phase: '30d' },
  { text: 'Book accommodations for first 3 nights', category: 'logistics', phase: '30d' },
  { text: 'Get local SIM plan or check roaming', note: 'EU roaming is included in most European carriers', category: 'comms', phase: '30d' },
  { text: 'Download offline maps (maps.me or Google Maps offline)', category: 'comms', phase: '30d' },

  // 14 days
  { text: 'Confirm all bookings (flights, hotels)', category: 'logistics', phase: '14d' },
  { text: 'Check-in online where possible', category: 'logistics', phase: '14d' },
  { text: 'Start packing list — lay out items', category: 'pack', phase: '14d' },
  { text: 'Fill prescriptions / pack medications', category: 'health', phase: '14d' },
  { text: 'Notify family/friends of itinerary', category: 'notify', phase: '14d' },
  { text: 'Set up emergency contact in phone', category: 'comms', phase: '14d' },
  { text: 'Load Wise / Revolut with EUR', category: 'money', phase: '14d' },

  // 7 days
  { text: 'Check-in online for flights', category: 'logistics', phase: '7d' },
  { text: 'Charge all devices + battery packs', category: 'comms', phase: '7d' },
  { text: 'Photocopy physical backup of passport', category: 'docs', phase: '7d' },
  { text: 'Final packing — weigh bag (<10kg for carry-on)', note: 'Target 44L backpack under 10kg', category: 'pack', phase: '7d' },
  { text: 'Arrange airport transport', category: 'logistics', phase: '7d' },
  { text: 'Pause or cancel local subscriptions if needed', category: 'misc', phase: '7d' },

  // Day before
  { text: 'Pack bag — do final check against list', category: 'pack', phase: '1d' },
  { text: 'Passport + wallet in carry-on, NOT checked', category: 'docs', phase: '1d' },
  { text: 'Charge phone, laptop, earbuds, power bank', category: 'comms', phase: '1d' },
  { text: 'Set two alarms', category: 'misc', phase: '1d' },
  { text: 'Download entertainment for flight', category: 'comms', phase: '1d' },
  { text: 'Take photo of packed bag contents (for insurance)', category: 'docs', phase: '1d' },
  { text: 'Sleep early 🌙', category: 'misc', phase: '1d' },
];

const STORAGE_KEY = 'otr:prep:tasks';
let tasks: Task[] = [];
let currentPhase: Phase = '60d';

function loadTasks(): Task[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return [];
}

function saveTasks() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
}

function uid(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function loadTemplate() {
  if (tasks.length > 0) {
    if (!confirm('This will add the default template tasks. Continue?')) return;
  }
  const newTasks: Task[] = TEMPLATE.map(t => ({ ...t, id: uid(), done: false }));
  tasks = [...tasks, ...newTasks];
  saveTasks();
  render();
}

function toggleTask(id: string) {
  const t = tasks.find(t => t.id === id);
  if (!t) return;
  t.done = !t.done;
  saveTasks();
  render();
}

function deleteTask(id: string) {
  tasks = tasks.filter(t => t.id !== id);
  saveTasks();
  render();
}

function addTask(text: string, category: string) {
  if (!text.trim()) return;
  tasks.push({ id: uid(), text: text.trim(), done: false, category, phase: currentPhase });
  saveTasks();
  render();
}

function getPhaseTasks(phase: Phase): Task[] {
  return tasks.filter(t => t.phase === phase);
}

function renderProgress(container: HTMLElement) {
  const total = tasks.length;
  const done = tasks.filter(t => t.done).length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  container.innerHTML = `
    <div class="prep-progress-bar">
      <div class="prep-progress-stat">
        <div class="prep-progress-num">${done}</div>
        <div class="prep-progress-label">Done</div>
      </div>
      <div class="prep-progress-stat">
        <div class="prep-progress-num">${total - done}</div>
        <div class="prep-progress-label">Remaining</div>
      </div>
      <div class="prep-progress-track">
        <div class="prep-track-bar">
          <div class="prep-track-fill" style="width: ${pct}%"></div>
        </div>
        <div class="prep-track-label">${pct}% complete</div>
      </div>
      <button class="template-btn" id="load-template-btn">
        <span>📋</span> Load template
      </button>
    </div>
  `;

  container.querySelector('#load-template-btn')?.addEventListener('click', loadTemplate);
}

function renderPhaseTabs(container: HTMLElement) {
  container.innerHTML = `
    <div class="prep-phases">
      ${PHASES.map(p => {
        const phaseTasks = getPhaseTasks(p.id);
        const done = phaseTasks.filter(t => t.done).length;
        const total = phaseTasks.length;
        return `
          <button class="phase-tab ${p.id === currentPhase ? 'active' : ''}" data-phase="${p.id}">
            ${p.label}
            ${total > 0 ? `<span class="phase-count">${done}/${total}</span>` : ''}
          </button>
        `;
      }).join('')}
    </div>
  `;

  container.querySelectorAll('.phase-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      currentPhase = (btn as HTMLElement).dataset.phase as Phase;
      render();
    });
  });
}

function renderCategories(container: HTMLElement) {
  const phaseTasks = getPhaseTasks(currentPhase);
  const usedCategories = CATEGORIES.filter(cat =>
    phaseTasks.some(t => t.category === cat.id)
  );

  // If no tasks in this phase yet, show all categories
  const categoriesToShow = usedCategories.length > 0 ? usedCategories : CATEGORIES;

  container.innerHTML = categoriesToShow.map(cat => {
    const catTasks = phaseTasks.filter(t => t.category === cat.id);
    const doneCat = catTasks.filter(t => t.done).length;

    return `
      <div class="prep-section">
        <div class="prep-section-header">
          <div class="prep-section-title">
            <span class="prep-section-icon">${cat.icon}</span>
            ${cat.label}
          </div>
          ${catTasks.length > 0 ? `<span class="prep-section-progress">${doneCat}/${catTasks.length}</span>` : ''}
        </div>
        <div class="prep-tasks">
          ${catTasks.map(task => `
            <div class="prep-task ${task.done ? 'done' : ''}" data-id="${task.id}">
              <div class="task-checkbox" aria-hidden="true">
                ${task.done ? '✓' : ''}
              </div>
              <div class="task-body">
                <div class="task-text">${task.text}</div>
                ${task.note ? `<div class="task-note">${task.note}</div>` : ''}
              </div>
              <div class="task-actions">
                <button class="task-action-btn delete-task" data-id="${task.id}" title="Delete">✕</button>
              </div>
            </div>
          `).join('')}
          <div class="add-task-row">
            <input class="input add-task-input" placeholder="Add task…" data-cat="${cat.id}">
            <button class="btn btn-primary add-task-btn" data-cat="${cat.id}" style="padding: 10px 14px;">+</button>
          </div>
        </div>
      </div>
    `;
  }).join('');

  // Events
  container.querySelectorAll<HTMLElement>('.prep-task').forEach(el => {
    el.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('.task-actions')) return;
      toggleTask(el.dataset.id!);
    });
  });

  container.querySelectorAll<HTMLElement>('.delete-task').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteTask(btn.dataset.id!);
    });
  });

  container.querySelectorAll<HTMLButtonElement>('.add-task-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const cat = btn.dataset.cat!;
      const input = container.querySelector<HTMLInputElement>(`.add-task-input[data-cat="${cat}"]`);
      if (input) { addTask(input.value, cat); input.value = ''; }
    });
  });

  container.querySelectorAll<HTMLInputElement>('.add-task-input').forEach(input => {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        addTask(input.value, input.dataset.cat!);
        input.value = '';
      }
    });
  });
}

function render() {
  const root = document.getElementById('view-prep');
  if (!root) return;

  const progressEl = root.querySelector<HTMLElement>('.prep-progress-wrap')!;
  const tabsEl = root.querySelector<HTMLElement>('.prep-tabs-wrap')!;
  const bodyEl = root.querySelector<HTMLElement>('.prep-body')!;

  renderProgress(progressEl);
  renderPhaseTabs(tabsEl);
  renderCategories(bodyEl);
}

export function initPrep() {
  tasks = loadTasks();
  render();
}
