/* ==========================================================================
   On the Road · Stub views — pack, budget, safety, journal, map
   Full implementations to follow in next iteration.
   ========================================================================== */

interface StubConfig {
  id: string;
  icon: string;
  title: string;
  subtitle: string;
  color: string;
  features: string[];
}

const STUBS: StubConfig[] = [
  {
    id: 'pack',
    icon: '🎒',
    title: 'Pack formula',
    subtitle: 'Your 44L packing calculator',
    color: '#bbf7d0',
    features: [
      'Input trip length, climate, and activities',
      'Get a recommended item count per category',
      'Visual backpack fill indicator',
      'AI-powered personal recommendations',
      'Save as reusable packing templates',
    ],
  },
  {
    id: 'budget',
    icon: '🏠',
    title: 'Stay finder',
    subtitle: 'Multi-criteria accommodation scorer',
    color: '#bae6fd',
    features: [
      'Add candidate accommodations with price and link',
      'Score on: transport access, safety, amenities',
      'Adjust scoring weights to your priorities',
      'Ranked comparison with overall score',
      'Mark final pick and link to itinerary',
    ],
  },
  {
    id: 'safety',
    icon: '🛡️',
    title: 'Safety kit',
    subtitle: 'Solo female travel safety toolkit',
    color: '#fecaca',
    features: [
      'Per-city arrival safety checklist',
      'Embassy + emergency numbers by country',
      'Useful local phrases for emergencies',
      'Accommodation safety check (door, exits, etc.)',
      'Works fully offline',
    ],
  },
  {
    id: 'journal',
    icon: '📓',
    title: 'Journal',
    subtitle: 'Your travel notes, by city',
    color: '#e9d5ff',
    features: [
      'Markdown notes organized by city',
      'Tags: food, architecture, people, feelings',
      'Photo links (cloud-stored, no uploads)',
      'Timeline and city views',
      'AI-generated trip summary',
    ],
  },
];

function renderStub(config: StubConfig): string {
  return `
    <div style="max-width: 560px; margin: 0 auto;">
      <div style="
        background: ${config.color};
        border-radius: var(--r-2xl);
        padding: var(--sp-12) var(--sp-10);
        text-align: center;
        margin-bottom: var(--sp-8);
      ">
        <div style="font-size: 56px; margin-bottom: var(--sp-4)">${config.icon}</div>
        <div style="font-family: var(--font-ui); font-size: var(--fs-3xl); font-weight: 700; color: var(--ink); margin-bottom: var(--sp-2)">${config.title}</div>
        <div style="font-size: var(--fs-md); color: var(--ink-soft)">${config.subtitle}</div>
      </div>

      <div style="
        background: var(--surface);
        border-radius: var(--r-xl);
        padding: var(--sp-6);
        box-shadow: var(--shadow-sm);
        margin-bottom: var(--sp-6);
      ">
        <div style="
          font-family: var(--font-ui);
          font-size: var(--fs-xs);
          font-weight: 700;
          color: var(--ink-muted);
          text-transform: uppercase;
          letter-spacing: 0.08em;
          margin-bottom: var(--sp-4);
        ">Coming in v2</div>
        <div style="display: flex; flex-direction: column; gap: var(--sp-3)">
          ${config.features.map(f => `
            <div style="display: flex; gap: var(--sp-3); align-items: flex-start; font-size: var(--fs-base); color: var(--ink-soft)">
              <span style="color: var(--amber-500); font-weight: 700; flex-shrink: 0">→</span>
              ${f}
            </div>
          `).join('')}
        </div>
      </div>

      <div style="
        background: var(--amber-50);
        border: 1.5px dashed var(--amber-300);
        border-radius: var(--r-lg);
        padding: var(--sp-4) var(--sp-5);
        text-align: center;
        font-size: var(--fs-sm);
        color: var(--amber-700);
      ">
        This module is planned for the next development sprint.
        Focus right now: Prep, Route, Expenses, City Intel.
      </div>
    </div>
  `;
}

export function initStubs() {
  STUBS.forEach(stub => {
    const el = document.getElementById(`view-${stub.id}`);
    if (el) {
      const header = el.querySelector('.view-header');
      if (header) {
        (header as HTMLElement).style.display = 'none';
      }
      const body = el.querySelector<HTMLElement>('.stub-body');
      if (body) body.innerHTML = renderStub(stub);
    }
  });
}
