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

/** @deprecated Use deleteSafetyDoc instead. */
export const deleteInsurancePdf = deleteSafetyDoc;
