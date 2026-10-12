/* ==========================================================================
   On the Road · Expenses · record chip
   --------------------------------------------------------------------------
   The category-tinted chip a single expense is drawn as — shared by the
   "All records" ledger and the Agenda day panel so both read the same.
   ========================================================================== */

import { escHtml } from '../../core/utils.ts';
import { currencySymbol } from '../../data/rates.ts';
import type { StoredExpense } from '../../data/stores/expense-store.ts';
import { type Category, UNCLASSIFIED, categoryDisplayColor, categoryInkColor } from './expense-helpers.ts';

/** A compact, category-tinted record chip — mirrors the route plan-tag logic:
 *  colour-filled by category, click to open, ✕ to delete. `baseLabel` is the
 *  already-formatted " · ¥123" tail shown when the spend was in another currency. */
export function renderRecordTag(e: StoredExpense, cat: Category | undefined, baseLabel: string, deletable = true): string {
  const raw = cat?.color ?? '#f3f4f6';
  const color = categoryDisplayColor(raw);
  const ink = categoryInkColor(raw);
  const place = [e.city, e.country].filter(Boolean).join(', ');
  const tip = [cat?.label ?? 'Unsorted', place].filter(Boolean).join(' · ');
  const tagsHtml = (e.tags ?? []).length
    ? `<span class="exp-tag-labels">${(e.tags ?? []).map((t) => `<span class="exp-tag-label">${escHtml(t)}</span>`).join('')}</span>`
    : '';
  return `
    <div class="exp-tag-item ${e.category === UNCLASSIFIED ? 'unsorted' : ''}"
         data-id="${escHtml(e.id)}" style="background:${color};color:${ink}"${tip ? ` data-tooltip="${escHtml(tip)}"` : ''}>
      <span class="exp-tag-icon">${escHtml(cat?.icon) || '🗂️'}</span>
      <span class="exp-tag-name">${escHtml(e.description)}${tagsHtml}</span>
      <span class="exp-tag-amount">${currencySymbol(e.currency)}${e.amount.toFixed(2)}${baseLabel}</span>
      ${deletable ? `<button class="exp-tag-del" data-id="${escHtml(e.id)}" title="Delete">✕</button>` : ''}
    </div>`;
}
