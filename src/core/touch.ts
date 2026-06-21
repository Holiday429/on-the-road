/**
 * Touch parity helpers.
 *
 * On devices without hover, CSS `:hover` tooltips never appear. We surface them
 * on tap instead: tapping an element carrying `data-tooltip` toggles a
 * `data-tooltip-open` attribute, which the `@media (hover: none)` rules in
 * base.css use to reveal the bubble. Tapping elsewhere closes it.
 *
 * No-op on hover-capable devices, so desktop behaviour is untouched.
 */
export function initTouchTooltips(): void {
  const hasHover = window.matchMedia('(hover: hover)').matches;
  if (hasHover) return;

  let open: HTMLElement | null = null;

  const close = () => {
    if (open) {
      open.removeAttribute('data-tooltip-open');
      open = null;
    }
  };

  document.addEventListener(
    'click',
    (e) => {
      const target = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-tooltip]');

      // Tapped outside any tooltip host → close whatever is open.
      if (!target) {
        close();
        return;
      }

      // Tapping the already-open host closes it; a different host moves focus.
      if (target === open) {
        close();
        return;
      }

      close();
      target.setAttribute('data-tooltip-open', '');
      open = target;
    },
    // Capture so we still close when an inner control stops propagation.
    true,
  );
}
