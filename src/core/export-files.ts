/* ==========================================================================
   On the Road · Export file helpers
   ========================================================================== */

/** Make a safe download filename stem; keeps CJK, drops path/reserved characters. */
export function fileStem(name: string, fallback = 'on-the-road'): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|\u0000-\u001F]/g, ' ')
    .replace(/\s+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 80);
  return cleaned || fallback;
}

/** Trigger a browser download of in-memory text. */
export function downloadTextFile(filename: string, mime: string, content: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: `${mime};charset=utf-8` }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
