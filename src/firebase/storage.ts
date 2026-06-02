/* ==========================================================================
   On the Road · Firebase Storage helpers
   ========================================================================== */

import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { storage } from './config.ts';
import { currentUser } from './auth.ts';

/** Upload a file to `users/{uid}/safety/{filename}` and return the download URL. */
export async function uploadInsurancePdf(file: File): Promise<{ url: string; name: string }> {
  const user = currentUser();
  if (!user) throw new Error('Not signed in.');
  const path = `users/${user.uid}/safety/${Date.now()}_${file.name}`;
  const storageRef = ref(storage, path);
  await uploadBytes(storageRef, file, { contentType: file.type });
  const url = await getDownloadURL(storageRef);
  return { url, name: file.name };
}

/** Delete a file by its download URL (best-effort — ignores not-found errors). */
export async function deleteInsurancePdf(url: string): Promise<void> {
  try {
    const storageRef = ref(storage, url);
    await deleteObject(storageRef);
  } catch { /* ignore if already gone */ }
}
