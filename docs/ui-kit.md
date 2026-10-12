# UI kit — paper (`src/core/paper/`)

One physical vocabulary for the whole app: **paper**. Pages compose these pieces instead of drawing their own. If you need a ticket, a receipt line, a stamp, a tag or an LED readout, import it from here; if the kit lacks something, add it to the kit (with a test) rather than to a page.

```ts
import '../../core/paper/paper.css';              // styles (once per entry point)
import { paperRow, paperReceipt, paperStamp, paperTag, printIn } from '../../core/paper/paper.ts';
import { showSlip } from '../../core/paper/slip.ts';
```

## The material
- One material: paper (`--surface` + a 3–4 % grain). One light source: shadows fall down.
- Allowed details: tear line, notch, zig-zag edge, barcode, ink stamp, tag hole, LED glass. Nothing else is "skeuomorphic" in this app.
- Numbers, codes, times, amounts are monospace (`--font-data`). Text stays DM Sans, headings Sora.
- Colour is the app's tokens only: tinted fill + same-hue deep text (`--tint-*` / `--tint-*-ink`), semantic `--success` / `--danger` / `--warning`.
- **Responsive by container, not by viewport**: `.paper--slip` (and every receipt) is a size container, so the same component works in a drawer, a card or a phone. Below ~240 px a row drops its dotted leader. Don't add `@media` width queries inside kit components.

## Catalogue

| Piece | Markup | Used by |
|---|---|---|
| **Row** `paperRow({label, value, icon?, sub?, tone?, strong?, total?, act?})` | `label ········ value`, optional second line; `act` makes it a button | Expenses tape, slips, receipts, legend |
| **Receipt** `paperReceipt({title, meta?, rows, total?, stamp?, barcode?, footer?, zigzag?})` | centred head, tape rows, total under a rule, stamp, barcode | `showSlip`, (Expenses/Wrap later) |
| **Slip** `showSlip(opts)` | a receipt that prints in the corner and tears itself away; one at a time | `expenseSlip()` after any expense is saved |
| **Stamp** `paperStamp({text, tone?, corner?, pressed?})` | rotated ink-stamp label; `pressed` plays the thunk | Over-budget on the Expenses summary, slips, (passport stamps) |
| **Tag** `paperTag({verdict, sub?, tone?})` | luggage tag with a punched hole | Luggage scale |
| **LED** `.paper-led` / `.paper-led-num` / `.paper-led-aux` | dark glass, mono digits; `.is-good` / `.is-bad` | Expense checkout display, luggage scale |
| **Tear line** `.paper-perf` | dashed rule with half-moon notches | Checkout tape, summary |
| **Barcode** `.paper-barcode` | CSS-only bars | Receipts, tickets |
| **Print-in** `printIn(el)` | the "a new line was just printed" motion | Tape lines |
| **Ticket / Storefront** `core/paper/booking.css` (markup: `renderTicket` / `renderStayCard` in `views/itinerary/itinerary-cards.ts`) | boarding pass / rail / coach / ferry ticket; stay as a shop front with an awning | Itinerary, Dashboard drawers, Agenda |

Tones: `neutral` · `good` · `bad` · `warn`. Ticket modes map to category tones: flight = stay (blue), train = activities (rose), bus = food (mustard), ferry = transport (teal).

## Rules for adding to the kit
1. Escape everything: helpers take plain text, never HTML.
2. Style only with tokens (the design lint fails on new hex colours / `font-weight` numbers).
3. Honour `prefers-reduced-motion` in CSS (animations are off, final state still shows).
4. Add a test beside the helper, and check it at 400 px wide and in dark mode before merging.
5. Update this table.

## Not yet on the kit (candidates)
- Compare candidates (train / flight / stay) could reuse Ticket / Storefront — needs structured fields on candidates first.
- Journal's "ticket" card format duplicates tear line + notch — switch to `.paper-perf` when that view is next touched.
- Passport stamps (P4) will extend `paperStamp` (shapes + country ink).
