# Security

## Dependency vulnerability policy

`npm audit` reports vulnerabilities across the whole dependency tree,
including dev-only tooling (vite, eslint, firebase-tools and their
transitive deps) that never ships to a user's browser. Treating every dev
vulnerability as equally urgent as a runtime one just trains everyone to
ignore the count.

**CI only gates production dependencies at high/critical severity:**

```bash
npm audit --omit=dev --audit-level=high
```

This runs in `.github/workflows/ci.yml` right after lint. It checks
`dependencies` in `package.json` (currently `firebase`, `leaflet`, `zod`) —
the code that actually reaches the browser bundle or a user's device. A
finding here blocks the merge.

`devDependencies` vulnerabilities (build tooling, test runners, the
Firestore emulator CLI) are not gated. They're real but lower-stakes — fix
them opportunistically with `npm audit fix` when convenient, not urgently.
**Never run `npm audit fix --force`** without reviewing the diff: it will
happily downgrade a tool to an incompatible major version to silence an
advisory (this has been tried — it proposed downgrading `firebase-tools` to
"fix" a `uuid` advisory, which is backwards).

## If `npm audit --omit=dev` starts failing

1. Run `npm audit --omit=dev` locally to see which package and advisory.
2. Try `npm audit fix` first (non-breaking). Re-run the full local
   verification (`tsc`, `lint`, `test`, `test:rules`, `build`) after — a
   dependency bump can still break something even without a major version
   change.
3. If no non-breaking fix exists, check whether the vulnerable package is
   actually imported anywhere (`grep -rn "from '<package>'" src api`) before
   spending time on it — this repo has shipped an unused dependency before
   (`firebase-admin`, removed 2026-07, was the source of most runtime
   findings despite zero imports; every server endpoint deliberately talks
   to Firestore over REST instead — see the comments in `api/_guard.ts` and
   `api/_billing.ts`).
4. If it's a real, in-use, high-severity vulnerability with no fix
   available: this needs a judgment call (can we remove the feature that
   needs it, is there an alternative package, is the vulnerable code path
   actually reachable). Don't silently downgrade the CI gate to make it
   pass.

## Firestore security rules

`firestore.rules` is tested against a real emulator in
`firestore.rules.test.ts` (`npm run test:rules`), not just deployed on
faith. If you change the rules, add or update a test case — this file has
already caught two live production bugs that had been deployed for months
(see the `fix(security)` commit that introduced this test suite): a
recursive-wildcard rule that let any signed-in user grant themselves a
paid plan by writing their own user doc, and a `== null` check that threw
an evaluation error (denying the write) on a field that was merely absent
rather than null, silently blocking ordinary editor collaboration on most
trips.

Deploy rule changes with an EXPLICIT `--project` — `.firebaserc`'s `default`
alias points at `on-the-road-dev`, not production, specifically so a bare
`firebase deploy` can never touch real user data by accident:

```bash
npm run deploy:rules:dev    # verify against the dev project first
npm run deploy:rules:prod   # then, deliberately, production
```
