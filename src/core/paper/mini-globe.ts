/* ==========================================================================
   On the Road · Paper kit · little globe
   --------------------------------------------------------------------------
   A flat, hand-drawn-looking desk globe in inline SVG: a sea disc, two blobs of
   land, a brass ring, a stem and a base. It is the doorway to the Atlas, the way
   the navy booklet is the doorway to the passport — it sits on the passport's
   desk and in the corner of the route map. Colours are tokens, so it follows the
   theme; nothing here moves unless the caller spins it with CSS.
   ========================================================================== */

/** `size` is the pixel width; the drawing is 3:3.5. */
export function miniGlobeSvg(size = 56): string {
  const h = Math.round(size * 1.1667);
  return `<svg class="mini-globe" width="${size}" height="${h}" viewBox="0 0 60 70" aria-hidden="true" focusable="false">
    <ellipse class="mg-shadow" cx="30" cy="67" rx="14" ry="2.2"/>
    <rect class="mg-stem" x="28.6" y="55" width="2.8" height="8" rx="0.8"/>
    <ellipse class="mg-base" cx="30" cy="64" rx="11" ry="2.6"/>
    <circle class="mg-sea" cx="30" cy="28" r="24"/>
    <path class="mg-land" d="M16 20c3-5 9-6 12-3 2 2-1 5-3 7-3 2-3 6-7 6-3 0-5-6-2-10z"/>
    <path class="mg-land" d="M33 33c3-3 8-2 10 1 2 4-1 9-5 10-3 0-5-5-5-11z"/>
    <path class="mg-shine" d="M12 21A19 19 0 0 1 21 11"/>
    <circle class="mg-ring" cx="30" cy="28" r="26.5"/>
    <g transform="rotate(-23.5 30 28)"><line class="mg-axle" x1="30" y1="0.5" x2="30" y2="-1.5"/><line class="mg-axle" x1="30" y1="54.5" x2="30" y2="56.5"/></g>
  </svg>`;
}
