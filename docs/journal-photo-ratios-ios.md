# Journal photo shapes — contract for iOS

Web `main`. One **optional** field was added to the journal entry document; nothing else about entries changed.

## The field

`journalEntries/{entryId}.imageRatios` — optional array of numbers (max 9), **width ÷ height of each photo, index-aligned with `images`**. `1.5` is a 3:2 landscape, `0.75` is a 3:4 portrait.

| Rule | Detail |
|---|---|
| Alignment | `imageRatios[i]` describes `images[i]`. When photos are added, removed or reordered, the array is changed the same way. |
| Missing | An entry written before this (or by a client that does not know it) has no `imageRatios`. The web measures such an entry the first time it is read and writes the answer back, so iOS never has to backfill. |
| Stale | A reader must **ignore the array when its length differs from the photo count** — a client that added or removed a photo without updating it leaves it wrong at every later index. The web does this (`storedRatios()` in `views/journal/shared/ratio-cache.ts`). |
| Legacy field | `imageRatio` (the first photo only) stays. The web writes `imageRatio = imageRatios[0]`, and the Feed still reads `imageRatio` for its cover shape. |
| All or nothing | Write the full array or omit it. A list with a hole would put every later ratio on the wrong photo. |

Decoding: `JournalEntry.swift` uses `Codable`, which ignores unknown keys, so adding the field breaks nothing on iOS today.

## Why it exists

The letter (one entry) and the magazine (one album) lay photos out by their real shape — a postcard is framed 3:2 or 3:4, never cropped to a fixed box. The shapes in use are 3:4, 4:3, 2:3, 3:2 and 16:9 (9:16 and 1:1 as fallbacks); the web snaps a measured ratio to the nearest of these (`snapRatio()` in `views/journal/shared/photo-ratio.ts`, nearest on a log scale).

## To do on iOS (not part of the web plan)

- **Write `imageRatios` whenever iOS saves an entry with photos**: `pixelWidth / pixelHeight` of each image, after any orientation fix, in `images` order. Without this, entries made on iOS are measured by the web on first read — correct, but it loads every photo once.
- Keep the array in step when photos are removed or reordered in the iOS editor.
