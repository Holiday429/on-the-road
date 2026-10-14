# Pack & Prepare scenes — contract for iOS

Web branch `feat/prepare-redesign`. Pack **data and weight logic did not change** (`PackList` / `PackContainer` / `PackItem`, `containerWeight`, `isOver`). Everything below is presentation that the iOS app can reuse.

## Reusable pieces (web → iOS)

| Piece | Web | Props | Notes |
|---|---|---|---|
| Bag | `core/paper/luggage.ts` `renderBag(kind, {loadPct, over, uid, tone})` | `kind: suitcase \| backpack \| personal`; `loadPct` 0–100 raises a darker fill inside the shell; `over` recolours the shell coral; `tone` 0–3 = khaki / slate / sage / rose (`bagTone(id)` hashes a stable one) | One branch per kind — add `duffel`, `sling`… by adding a branch. Colours come from classes in `luggage.css` (tokens only). |
| Platform scale | `renderScale({reading, verdict, caption})` | `verdict: pass \| over \| nolimit \| null` | LED digits amber (idle) / sage (pass) / coral (over). |
| Weigh tag | `.paper-tag` (+ `--good` / `--bad`) | PASS / OVERWEIGHT + "x to spare" / "x over" | |
| Weigh-in slip | `paperReceipt` via `pack-detail.ts` `renderSlip` | rows = bag, `weight / limit ✓▲`; total; stamp; barcode `OTR 000000` | |
| Clipboard / floor scenes | `views/prepare/prepare-scenes.ts` | `ClipScene`, `PackSceneBag` | Landing entry scenes. |

## Weigh-in status (new, local only for now)

`views/pack/weigh-status.ts`. State per list, derived from current bag weights vs. the last recorded weigh-in:

- `none` — no bag weighed yet · `stale` — a bag is new or its weight changed since · `ok` — all weighed, none over · `over` — weighed, ≥1 over.
- Stored in `localStorage`: `otr:pack:weigh:<listId>` = `{bags:{[bagId]:{g,limitG,at}}}` and `otr:pack:slips:<listId>` = last 20 slips `{id,at,rows[{label,g,limitG,verdict}],totalG,over}`.
- **Open question for iOS:** slips ("Save to trip") are per-browser today. If they should sync, add `weighIns` to the pack list document (array of slips) — no other change needed; the web code reads/writes through `loadSlips/saveSlip/recordWeighIn`.

## Motion (`views/prepare/weigh-stage.ts` `MOTION`, ms)

| Phase | ms | Easing |
|---|---|---|
| Bag drops, 2 damped bounces | 640 | `cubic-bezier(.2,.8,.3,1)` |
| Deck gives and springs back (starts after the drop) | 720 | same |
| LED counts up (cubic ease-out + wobble in the last 14 %) | 980 | — |
| Tag snaps on, overshoot | 420 | `cubic-bezier(.34,1.56,.64,1)` |
| Hold before the next bag / slide out | 820 / 260 | — |

OVERWEIGHT: deck shakes 480 ms, LED blinks, and the bag card shows "Over by x — try taking out <heaviest low-priority item>". PASS: 520 ms flash. Sounds (WebAudio, off by default): drop 220 Hz, PASS 660 Hz, OVER 140 Hz. Reduced motion shows the final state at once. Every sequence is skippable (Skip button / Esc).

## Interaction rules

- Items move between bags by drag **or** select-then-"Move here" (the touch/keyboard path).
- A bag's picture is its handle: tap = open/close its contents, drag it onto the scale = weigh just that bag.
- Whole-list weigh-in ends in a slip; a single-bag weigh does not.
- The Weigh button is stateful: *Weigh my bags* / *Re-weigh* / *✓ All within limits* / *n over · fix*. In the 14 days before departure the Prepare page adds a "Weigh before you fly" strip when any list's state is not `ok`.
- Prepare landing: Checklist and Pack are equal panels (status card → scene → list rows). The scene is the entry; hovering a list row brings it to the front. "Next up" lives in the checklist editor.
