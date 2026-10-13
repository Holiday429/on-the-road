/* ==========================================================================
   On the Road · Atlas — the globe's frame (markup only)
   --------------------------------------------------------------------------
   A flat, drawn globe stand around the live map: a brass meridian ring with
   tick marks, two axle stubs on the 23.5° tilt, a stem, a base and a shadow on
   the desk, plus one short highlight arc on the sea. All one inline SVG that
   sits over the chart with pointer-events off; the colours live in atlas.css as
   tokens. Geometry is a 120 × 140 box with the sphere centred at (60, 60), r 50.
   ========================================================================== */

export const SKIN = { w: 120, h: 140, cx: 60, cy: 60, r: 50 } as const;

export function globeSkinSvg(): string {
  const { cx, cy } = SKIN;
  return `<svg class="globe-skin" viewBox="0 0 ${SKIN.w} ${SKIN.h}" aria-hidden="true" focusable="false">
    <ellipse class="gs-shadow" cx="${cx}" cy="135" rx="30" ry="3.6"/>
    <rect class="gs-stem" x="${cx - 2.4}" y="113" width="4.8" height="17" rx="1.2"/>
    <ellipse class="gs-base" cx="${cx}" cy="130" rx="24" ry="5"/>
    <circle class="gs-ticks" cx="${cx}" cy="${cy}" r="54" pathLength="360"/>
    <circle class="gs-ring" cx="${cx}" cy="${cy}" r="54"/>
    <g transform="rotate(-23.5 ${cx} ${cy})">
      <line class="gs-axle" x1="${cx}" y1="6" x2="${cx}" y2="0.5"/>
      <line class="gs-axle" x1="${cx}" y1="114" x2="${cx}" y2="119.5"/>
      <circle class="gs-cap" cx="${cx}" cy="0.5" r="2"/>
      <circle class="gs-cap" cx="${cx}" cy="119.5" r="2"/>
    </g>
    <path class="gs-shine" d="M 24 36 A 40 40 0 0 1 42 19"/>
  </svg>`;
}
