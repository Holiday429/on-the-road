/* ==========================================================================
   On the Road · DestinationInput — reusable autocomplete tag picker
   --------------------------------------------------------------------------
   Usage:

     import { createDestinationInput } from '../../core/destination-input.ts';

     const picker = createDestinationInput({
       container: document.getElementById('my-field')!,
       placeholder: 'Add a country or city…',
       initialValues: ['France', 'Italy'],
       onChange: (values) => console.log(values),
     });

     // Later:
     picker.getValues();   // string[]
     picker.setValues(['Japan']);
     picker.destroy();

   The component mounts inside `container`, replacing its contents.
   Import destination-input.css somewhere in your view's CSS.
   ========================================================================== */

import './destination-input.css';
import { searchDestinations, type Destination } from '../data/destinations.ts';

export interface DestinationInputOptions {
  /** Element to mount into — its innerHTML will be replaced. */
  container: HTMLElement;
  placeholder?: string;
  initialValues?: string[];
  onChange?: (values: string[]) => void;
  /** Max tags (default unlimited). */
  maxTags?: number;
}

export interface DestinationInputInstance {
  getValues(): string[];
  setValues(values: string[]): void;
  destroy(): void;
}

export function createDestinationInput(opts: DestinationInputOptions): DestinationInputInstance {
  const { container, placeholder = 'Add a country or city…', maxTags } = opts;

  let values: string[] = [...(opts.initialValues ?? [])];
  // Map label → Destination for flag lookup
  const destMap = new Map<string, Destination>();

  let activeIndex = -1;
  let dropdownResults: Destination[] = [];
  let dropdownEl: HTMLElement | null = null;
  let inputEl: HTMLInputElement | null = null;

  // ── DOM ─────────────────────────────────────────────────────────────────

  container.innerHTML = `
    <div class="dest-input-wrap">
      <div class="dest-input-field" role="combobox" aria-haspopup="listbox" aria-expanded="false"></div>
    </div>
  `;

  const wrap = container.querySelector<HTMLElement>('.dest-input-wrap')!;
  const field = container.querySelector<HTMLElement>('.dest-input-field')!;

  function render() {
    // Keep existing input el if present (avoid losing focus)
    const existingInput = field.querySelector<HTMLInputElement>('.dest-input-text');
    const existingValue = existingInput?.value ?? '';

    field.innerHTML = values.map((v) => {
      const d = destMap.get(v);
      return `
        <span class="dest-tag" data-value="${escHtml(v)}">
          ${d ? `<span class="dest-tag-flag">${d.flag}</span>` : ''}
          <span class="dest-tag-label">${escHtml(v)}</span>
          <button type="button" class="dest-tag-remove" data-remove="${escHtml(v)}" aria-label="Remove ${escHtml(v)}">✕</button>
        </span>
      `;
    }).join('');

    const atMax = maxTags != null && values.length >= maxTags;
    if (!atMax) {
      const inp = document.createElement('input');
      inp.type = 'text';
      inp.className = 'dest-input-text';
      inp.placeholder = values.length === 0 ? placeholder : '';
      inp.autocomplete = 'off';
      inp.spellcheck = false;
      inp.value = existingValue;
      field.appendChild(inp);
      inputEl = inp;
      wireInput(inp);
    } else {
      inputEl = null;
    }

    // Re-wire remove buttons
    field.querySelectorAll<HTMLButtonElement>('[data-remove]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        removeValue(btn.dataset.remove!);
      });
    });
  }

  function wireInput(inp: HTMLInputElement) {
    inp.addEventListener('input', () => {
      activeIndex = -1;
      showDropdown(inp.value);
    });

    inp.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        activeIndex = Math.min(activeIndex + 1, dropdownResults.length - 1);
        updateActiveItem();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        activeIndex = Math.max(activeIndex - 1, 0);
        updateActiveItem();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (activeIndex >= 0 && dropdownResults[activeIndex]) {
          selectDest(dropdownResults[activeIndex]);
        } else if (inp.value.trim()) {
          addFreetext(inp.value.trim());
        }
      } else if (e.key === 'Escape') {
        hideDropdown();
      } else if (e.key === 'Backspace' && inp.value === '' && values.length > 0) {
        removeValue(values[values.length - 1]);
      }
    });

    inp.addEventListener('blur', () => {
      // Delay so click on dropdown item fires first
      setTimeout(() => {
        hideDropdown();
        if (inp.value.trim()) {
          addFreetext(inp.value.trim());
        }
      }, 150);
    });
  }

  // ── Dropdown ─────────────────────────────────────────────────────────────

  function showDropdown(query: string) {
    hideDropdown();
    if (!query.trim()) return;

    dropdownResults = searchDestinations(query, 8);
    if (dropdownResults.length === 0) {
      dropdownResults = [];
      field.setAttribute('aria-expanded', 'false');
      return;
    }

    const countries = dropdownResults.filter(d => d.type === 'country');
    const cities    = dropdownResults.filter(d => d.type === 'city');

    const renderSection = (label: string, items: Destination[]) => {
      if (items.length === 0) return '';
      return `
        <div class="dest-dropdown-section">
          <div class="dest-dropdown-section-label">${label}</div>
          ${items.map((d, _i) => {
            const idx = dropdownResults.indexOf(d);
            return `
              <button type="button" class="dest-dropdown-item" data-idx="${idx}" role="option">
                <span class="dest-dropdown-item-flag">${d.flag}</span>
                <span class="dest-dropdown-item-text">${escHtml(d.label)}</span>
              </button>
            `;
          }).join('')}
        </div>
      `;
    };

    const el = document.createElement('div');
    el.className = 'dest-dropdown';
    el.setAttribute('role', 'listbox');
    el.innerHTML = renderSection('Countries', countries) + renderSection('Cities', cities);

    el.querySelectorAll<HTMLButtonElement>('.dest-dropdown-item').forEach(btn => {
      btn.addEventListener('mousedown', (e) => {
        e.preventDefault(); // prevent blur on input
        const idx = parseInt(btn.dataset.idx!, 10);
        selectDest(dropdownResults[idx]);
      });
    });

    wrap.appendChild(el);
    dropdownEl = el;
    field.setAttribute('aria-expanded', 'true');
    activeIndex = -1;
  }

  function hideDropdown() {
    dropdownEl?.remove();
    dropdownEl = null;
    field.setAttribute('aria-expanded', 'false');
  }

  function updateActiveItem() {
    dropdownEl?.querySelectorAll<HTMLElement>('.dest-dropdown-item').forEach((btn, i) => {
      btn.classList.toggle('is-active', i === activeIndex);
    });
  }

  // ── Value management ──────────────────────────────────────────────────────

  function selectDest(d: Destination) {
    destMap.set(d.label, d);
    addValue(d.label);
  }

  function addFreetext(text: string) {
    addValue(text);
  }

  function addValue(label: string) {
    const trimmed = label.trim();
    if (!trimmed || values.includes(trimmed)) {
      clearInput();
      return;
    }
    if (maxTags != null && values.length >= maxTags) return;
    values = [...values, trimmed];
    clearInput();
    hideDropdown();
    render();
    opts.onChange?.(values);
  }

  function removeValue(label: string) {
    values = values.filter(v => v !== label);
    render();
    opts.onChange?.(values);
    inputEl?.focus();
  }

  function clearInput() {
    if (inputEl) inputEl.value = '';
  }

  // ── Field click → focus input ─────────────────────────────────────────────

  field.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('[data-remove]')) return;
    inputEl?.focus();
  });

  // ── Init ─────────────────────────────────────────────────────────────────

  render();

  // ── Public API ───────────────────────────────────────────────────────────

  return {
    getValues: () => [...values],
    setValues: (v) => { values = [...v]; render(); },
    destroy: () => { container.innerHTML = ''; },
  };
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
