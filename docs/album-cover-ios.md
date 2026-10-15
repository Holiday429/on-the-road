# Journal album covers — contract for iOS

Web `main`. One **optional** field was added to the journal album document; nothing else about albums changed (`title`, `emoji`, `coverEntryId`, `entryIds`, `visibility`, `slug` all behave as before).

## The field

`journalAlbums/{albumId}.cover` — optional object. An album written before covers existed, or by a client that does not know about them, simply has no `cover` and prints the defaults below. **It never needs backfilling, and iOS may ignore it entirely** (the album still has a title, an emoji and a cover photo to show).

| Key | Type | Default | Meaning |
|---|---|---|---|
| `template` | `wordmark \| masthead \| banner \| frame` | `wordmark` | Which cover layout is printed. |
| `headline` | string | `''` | The big name. **Empty means "use the album's `title`"** — so renaming an album keeps renaming its cover. Store what the user typed, not the resolved value. |
| `kicker` | string | `''` | One line under (or over) the headline. |
| `lines` | string[] (max 3) | `[]` | Cover billings, the way a magazine lists its features. Empty = the web shows the first entries' titles as a *suggestion*; it does not write them. |
| `tone` | `paper \| ink \| amber \| sky \| sage \| coral` | `paper` | Which palette the cover prints in. |
| `focalY` | number 0–1 | `0.5` | Vertical focus of the cover photo (0 = top, 1 = bottom), i.e. CSS `object-position: 50% {focalY*100}%`. |

Schema: `src/data/schema/journal.ts` (`JournalAlbumCoverSchema`). Writers should omit `cover` entirely rather than writing an object of empty defaults.

## The cover picture

Not part of `cover`. It is still the existing `coverEntryId`'s photo, falling back to the first entry that has one — unchanged from before, so iOS needs no new lookup.

## The four templates

Structure, not decoration: the same photo is genuinely re-laid-out between them.

| Template | Structure |
|---|---|
| `wordmark` | The name set huge across the top, the photo filling everything below it; billings at the foot. |
| `masthead` | A band of titling (name + issue line + kicker) above the photo; billings sit over the photo, each on its own dark slip. |
| `banner` | Full-bleed photo with the name reversed out of it, kicker under the name, issue bottom-left, billings bottom-right. |
| `frame` | A wide paper margin with the photo held in the middle; name and kicker above it, issue and billings below, all centred. |

## The issue line

Derived, never stored: `VOL.{count, 2 digits} · {MMM YYYY of the newest entry, uppercased}` — e.g. `VOL.07 · SEP 2026`. Count is how many entries the album holds, floored at 1. With no dated entry it is just `VOL.07`. See `issueLine()` in `src/views/journal/scenes/album-cover.ts`.

## Reusable pieces (web → iOS)

| Piece | Web | Notes |
|---|---|---|
| Cover | `scenes/album-cover.ts` `renderCover(cover, art)` | `art = { photo, count, newest, suggested }`. Pure; no state. |
| Resolved cover | `coverOf(album)` | Fills every default, including headline → album title. Use this for display, the raw field for editing. |
| Editor | `scenes/album-cover-edit.ts` | Live proof + template miniatures + tone swatches + copy fields. |

Sizing: the web draws everything inside a cover in `cqw` (percentages of the cover's own width), so one definition serves a shelf thumbnail and a full page. If iOS reimplements it, scale type and padding off the cover's width the same way rather than using fixed point sizes.

## Open question

The cover is per album and private to the owner. If albums ever become shareable (`visibility: 'public'` already exists on the document), the cover travels with them as-is — no extra field needed.
