/* ==========================================================================
   On the Road · Firebase Storage helpers
   ========================================================================== */

import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { storage } from './config.ts';
import { currentUser } from './auth.ts';

export interface UploadResult { url: string; name: string; }

/**
 * Upload a file to `users/{uid}/safety/<folder>/<timestamp>_<filename>`.
 * folder = 'insurance' | 'medical'
 */
export async function uploadSafetyDoc(
  file: File,
  folder: 'insurance' | 'medical' = 'insurance',
): Promise<UploadResult> {
  const user = currentUser();
  if (!user) throw new Error('Not signed in.');
  const path = `users/${user.uid}/safety/${folder}/${Date.now()}_${file.name}`;
  const storageRef = ref(storage, path);
  await uploadBytes(storageRef, file, { contentType: file.type });
  const url = await getDownloadURL(storageRef);
  return { url, name: file.name };
}

/** @deprecated Use uploadSafetyDoc(file, 'insurance') instead. */
export async function uploadInsurancePdf(file: File): Promise<UploadResult> {
  return uploadSafetyDoc(file, 'insurance');
}

/** Delete a file by its Firebase Storage download URL (best-effort). */
export async function deleteSafetyDoc(url: string): Promise<void> {
  if (!url) return;
  try {
    // Extract the storage path from the download URL
    const pathMatch = url.match(/\/o\/(.+?)\?/);
    if (!pathMatch) return;
    const decoded = decodeURIComponent(pathMatch[1]);
    const storageRef = ref(storage, decoded);
    await deleteObject(storageRef);
  } catch { /* ignore — already deleted or wrong ref */ }
}

/** Delete any Storage object by its download URL (best-effort). */
export const deleteStorageUrl = deleteSafetyDoc;

/** @deprecated Use deleteSafetyDoc instead. */
export const deleteInsurancePdf = deleteSafetyDoc;

/** Upload a clip image — stored under the same safety prefix the rules already allow. */
export async function uploadClipImage(file: File): Promise<UploadResult> {
  const user = currentUser();
  if (!user) throw new Error('Not signed in.');
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  // Use safety/ prefix so existing storage rules cover this path
  const path = `users/${user.uid}/safety/clips/${Date.now()}_${safeName}`;
  const storageRef = ref(storage, path);
  await uploadBytes(storageRef, file, { contentType: file.type });
  const url = await getDownloadURL(storageRef);
  return { url, name: file.name };
}

/**
 * Upload one journal photo to `users/{uid}/journal/<timestamp>_<n>_<name>`.
 *
 * Journal photos go to Storage rather than inline data URLs in the Firestore
 * doc: an entry can hold 9 of them, and 9 base64 images would run past the
 * 1MB per-document limit and fail the write. The path matches what iOS uses
 * (users/{uid}/journal/...) so both clients read each other's photos.
 */
export async function uploadJournalImage(file: File, index = 0): Promise<UploadResult> {
  const user = currentUser();
  if (!user) throw new Error('Not signed in.');
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = `users/${user.uid}/journal/${Date.now()}_${index}_${safeName}`;
  const storageRef = ref(storage, path);
  await uploadBytes(storageRef, file, { contentType: file.type });
  const url = await getDownloadURL(storageRef);
  return { url, name: file.name };
}

/** Delete a journal photo by download URL (best-effort, same as safety docs). */
export const deleteJournalImage = deleteSafetyDoc;

/**
 * Downscale an image to at most `maxEdge` px on its longest side and re-encode
 * as JPEG. Phone photos are 4–12 MB; a cover is shown at ≤ ~1200 px wide, so
 * this keeps uploads quick and well under the 15 MB rule. Falls back to the
 * original file if the browser can't decode it.
 */
async function downscaleImage(file: File, maxEdge = 1800, quality = 0.85): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, maxEdge / Math.max(bmp.width, bmp.height));
    const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, w, h);
    bmp.close();
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', quality));
    return blob ?? file;
  } catch {
    return file;
  }
}

/**
 * Upload a leg cover photo to `trips/{tripId}/legs/{legId}/<id>.jpg` — the
 * same path iOS's LegStore.setCoverImage uses, so storage.rules' trip-member
 * block covers it and both clients read each other's covers.
 */
export async function uploadLegCover(file: File, tripId: string, legId: string): Promise<string> {
  if (!currentUser()) throw new Error('Not signed in.');
  const blob = await downscaleImage(file);
  const id = Math.random().toString(36).slice(2) + Date.now().toString(36);
  const storageRef = ref(storage, `trips/${tripId}/legs/${legId}/${id}.jpg`);
  await uploadBytes(storageRef, blob, { contentType: blob.type || 'image/jpeg' });
  return getDownloadURL(storageRef);
}

/** Upload the passport photo to `users/{uid}/passport/<id>.jpg` (owner-only, per storage.rules). Downscaled: it is shown ~120 px wide. */
export async function uploadPassportPhoto(file: File): Promise<string> {
  const user = currentUser();
  if (!user) throw new Error('Not signed in.');
  const blob = await downscaleImage(file, 640, 0.85);
  const id = Math.random().toString(36).slice(2) + Date.now().toString(36);
  const storageRef = ref(storage, `users/${user.uid}/passport/${id}.jpg`);
  await uploadBytes(storageRef, blob, { contentType: blob.type || 'image/jpeg' });
  return getDownloadURL(storageRef);
}
