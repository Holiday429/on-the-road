import { describe, expect, it } from 'vitest';
import { isCachedStoragePhoto } from './sw-routes.ts';

const photo = new URL('https://firebasestorage.googleapis.com/v0/b/b/o/users%2Fu%2Fpassport%2Fp.jpg?alt=media&token=t');

describe('isCachedStoragePhoto', () => {
  it('lets the photo cache answer a page\'s own <img> (no-cors) requests', () => {
    expect(isCachedStoragePhoto(photo, { mode: 'no-cors' })).toBe(true);
  });

  it('never answers a CORS request from it — an opaque cached copy would be rejected and the canvas left without the photo', () => {
    expect(isCachedStoragePhoto(photo, { mode: 'cors' })).toBe(false);
  });

  it('only covers Firebase Storage', () => {
    expect(isCachedStoragePhoto(new URL('https://lh3.googleusercontent.com/a/x'), { mode: 'no-cors' })).toBe(false);
    expect(isCachedStoragePhoto(new URL('https://example.test/p.jpg'), { mode: 'no-cors' })).toBe(false);
  });
});
