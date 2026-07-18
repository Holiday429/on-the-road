import { defineConfig } from 'vitest/config';

// Separate from vitest.config.ts: this suite talks to a real Firestore
// emulator (not mocked fetch) and must run inside `firebase emulators:exec`
// so the emulator is up first. Keeping it out of the default `vitest run`
// means the fast unit suite never silently depends on a running emulator.
export default defineConfig({
  test: {
    include: ['firestore.rules.test.ts'],
    environment: 'node',
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});
