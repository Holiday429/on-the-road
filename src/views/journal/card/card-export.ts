/* ==========================================================================
   On the Road · Share card — export
   --------------------------------------------------------------------------
   Turns a rendered canvas into a downloadable PNG. Firebase Storage upload is
   intentionally left out for now (per product decision) — a hook can be added
   here later that returns a shareable URL.
   ========================================================================== */

function safeFilename(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'card';
  return `on-the-road-${base}.png`;
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Canvas export failed'));
    }, 'image/png');
  });
}

/** Download the canvas as a PNG file. */
export async function downloadCard(canvas: HTMLCanvasElement, name: string): Promise<void> {
  const blob = await canvasToBlob(canvas);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = safeFilename(name);
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke after the click has a chance to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
