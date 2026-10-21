# R9 / R3 preparation — CI licence policy and the clean-room countersignature

**Status: PROPOSAL. Nothing in this file is approved, and no item here is
resolved.** It is research and planning for the repository owner, produced by an
agent that cannot take the decisions it describes.

| Field | Value |
| --- | --- |
| Repository | `https://github.com/aissaadib/Paka.git` |
| Commit inspected | `fac64419247923746b05c319f9a80a5089c41327` ("docs: close the audit with the real-build pixel proof"), branch `feat/stamp-brush-engine`. The document was first written against `47e309f` and **re-validated at `fac6441`** after the tree moved; the numbers below are the current ones, and the addendum records what changed in between. |
| Branch | `feat/stamp-brush-engine` (`main` is at `ad2ef11`; the stamp engine is **not** in `main`) |
| Inspection worktree | detached, at the commit named above; the shared checkout was only read, and every measurement was taken from `git show` blobs so that it cannot be contaminated by another agent's working tree |
| Items covered | **R9** (CI licence allow-list) and **R3** (clean-room attestation countersignature), per `docs/RELEASE-READINESS.md:15` and `:21` |
| What was **not** done | no CI workflow created, no allow-list written, no notices regenerated, no attestation edited, no item marked resolved, nothing staged or committed |

**How to read it.** Every statement is marked either **VERIFIED** (I ran it and
the output is reproducible from the commands cited) or **PROPOSED** (my
recommendation, which the owner may reject). Source references are
`file:line` against the commit above.

---

# Part 1 — R9: a CI licence allow-list

## 1.1 What the repository actually has today (VERIFIED)

**There is no CI, and there never has been.** I did not infer this from one
directory listing:

| Check | Command | Result |
| --- | --- | --- |
| Any workflow/CI file ever committed, on any branch, including deleted ones | `git log --all --diff-filter=A --name-only --pretty=format:` filtered for `workflow\|.github\|gitlab-ci\|jenkins\|azure-pipelines\|circleci\|travis\|.drone\|bitbucket\|buildkite\|pre-commit\|lefthook\|husky` | **no matches** |
| Root directory, all entries including hidden | `Get-ChildItem -Force` | no `.github/`, no CI file of any kind |
| Installed git hooks | `Get-ChildItem .git/hooks` (excluding `*.sample`) | **none** |
| `package.json` scripts | `package.json:7-15` | `dev`, `build`, `typecheck`, `test`, `test:watch`, `preview`, `tauri` — **no lint, no licence, no notices script** |
| Toolchain pins | `package.json:6` | `packageManager: pnpm@9.15.4` (corepack) |
| Vitest discovery | `vite.config.ts:34-40` | `include: ["src/**/*.test.ts"]` — only tests under `src/` run |

**The licence inventory is the project's own source of truth, and it is
currently honest.** `licenses/dependency-inventory.json` (schema
`paka.dependency-inventory/1`, `generatedAt` 2026-10-20) holds **506 entries**:
85 npm + 421 cargo. I compared it against both lockfiles:

| Ecosystem | Lockfile packages | Inventory entries | In lock, not in inventory | In inventory, not in lock |
| --- | --- | --- | --- | --- |
| npm (`pnpm-lock.yaml` `packages:`) | 85 | 85 | **0** | **0** |
| cargo (`src-tauri/Cargo.lock`) | 422 | 421 | 1 — `paka@0.1.0` | **0** |

The single difference is Paka's own crate, which the inventory's `note` field
excludes deliberately ("The local Paka crate is excluded"). **So the inventory
matches the lockfiles exactly today** — a coverage check would pass right now,
which makes it a useful regression guard rather than a source of noise.

**The notices generator does not regenerate the inventory — it only renders it.**
`scripts/generate-third-party-notices.mjs` has exactly one `readFileSync`
(the inventory, `:22-24`) and one `writeFileSync` (the notices file, `:342-343`).
It never reads `pnpm-lock.yaml` or `Cargo.lock`, and it never writes the
inventory.

**Three documents currently tell the reader to run that script to regenerate the
inventory.** All three are wrong, and they are the reason a new dependency could
arrive unchecked:

| Place | Wording | Problem |
| --- | --- | --- |
| `THIRD_PARTY_NOTICES.md:29-31` (template in the generator, `:239-243`) | the inventory "is generated from the two lockfiles and the licence file each package ships. Regenerate **both** with: `node scripts/generate-third-party-notices.mjs`" | that command regenerates **one** file, not both |
| `docs/RELEASE-READINESS.md:170-176` | "**Regenerate.** `node scripts/generate-third-party-notices.mjs` … Re-run it whenever a lockfile changes" | same error; the inventory is not rebuilt |
| `docs/g1/provenance-record.json` → record `R-017` → `actions[0]` | "Re-run scripts/generate-third-party-notices.mjs whenever a lockfile changes and before every release" | same error |

**No inventory builder exists anywhere in the repository.** `scripts/` contains
exactly `generate-app-icon.mjs` and `generate-third-party-notices.mjs`; nothing
else reads either lockfile (`git grep "pnpm-lock\|Cargo.lock"` finds only prose
and the `docs/acceptance-criteria.json` fixture paths). The inventory was
therefore produced out of band during the release-readiness work — the gate
records that "the 43 crates not present in the local cargo registry were
resolved from the crate tarball pinned by Cargo.lock"
(`docs/g1/provenance-record.json` → `R-017` → `evidence`), i.e. from the network.

**The existing generator is deterministic and idempotent.** Re-running it in the
worktree reproduced the committed `THIRD_PARTY_NOTICES.md` byte-for-byte (empty
`git diff`) and exited **0**.

**The generator never fails; it renders a review section instead.**
`scripts/generate-third-party-notices.mjs:208-209` computes `unmatched` and
`:328-336` renders it under "## Review required"; today that section reads
"Every dependency in the inventory matched a licence family above"
(`THIRD_PARTY_NOTICES.md:726`) because **0 entries are unmatched**.

**The licence expressions actually present in the tree** (27 distinct strings).
This is the grammar any policy has to parse — measured from the inventory:

| Form | Count | Example | Why a naive check breaks |
| --- | --- | --- | --- |
| `MIT OR Apache-2.0` | 199 | | exact-match allow-list would need every variant |
| `MIT` | 150 | | fine |
| `Apache-2.0 OR MIT` | 45 | | order differs from the row above |
| `Unicode-3.0` | 18 | | allowed, but not an OSI-permissive id |
| `Zlib OR Apache-2.0 OR MIT` | 17 | | three alternatives |
| `MPL-2.0` | 17 | | file-level copyleft, statically linked |
| `MIT/Apache-2.0` | 12 | slash form | a `Set.has()` check on the raw string fails |
| `Unlicense OR MIT` | 9 | | |
| `Apache-2.0` | 5 | | |
| `Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT` | 3 | SPDX id with a suffix | needs the exact suffix spelling |
| `Apache-2.0/MIT` | 3 | | |
| `BSD-3-Clause` | 3 | | |
| `BSD-3-Clause OR MIT OR Apache-2.0` | 2 | | |
| `MIT OR Zlib OR Apache-2.0` | 2 | | |
| `ISC` | 2 | | |
| `Unlicense/MIT` | 2 | | |
| **`MIT OR Apache-2.0 OR LGPL-2.1-or-later`** | **2** | `r-efi@5.3.0`, `r-efi@6.0.0` | **the string contains LGPL** — a deny-regex on the raw string fails here |
| `MIT OR Apache-2.0 OR Zlib` | 2 | | |
| `Zlib` | 2 | | |
| `Apache-2.0 WITH LLVM-exception` | 1 | | |
| `BSD-3-Clause AND MIT` | 1 | `brotli@9.0.0` | AND → two obligations, not one |
| `BSD-3-Clause/MIT` | 1 | | |
| `(MIT OR Apache-2.0) AND Unicode-3.0` | 1 | `unicode-ident@1.0.27` | parentheses |
| `CC0-1.0 OR MIT-0 OR Apache-2.0` | 1 | `dunce@1.0.5` | two alternatives are **not** on R9's allow-list |
| `Apache-2.0 / MIT` | 1 | | spaced slash |
| `0BSD OR MIT OR Apache-2.0` | 1 | | |
| `Apache-2.0 AND MIT` | 1 | `dpi@0.1.2` | AND |

**Effective (elected) surface of the current tree**, computed with the
generator's own resolution rules (`scripts/generate-third-party-notices.mjs:34-45`
`ELECTION_ORDER`, `:52-122` `FAMILIES`, `:134-154` `effectiveFamilies`):

| Elected family | Packages |
| --- | --- |
| MIT | 454 |
| Unicode-3.0 | 19 |
| MPL-2.0 | 17 |
| Apache-2.0 | 10 |
| BSD-3-Clause | 4 |
| ISC | 2 |
| Zlib | 2 |
| Apache-2.0 WITH LLVM-exception | 1 |
| **unmatched / "Other / not stated"** | **0** |

Note `0BSD` and `Unlicense` never surface as *elected*: MIT is on offer in the
same `OR` and comes first in `ELECTION_ORDER`. That is the election policy
`docs/RELEASE-READINESS.md:157-162` states, and the reason `r-efi` is taken
under MIT.

**Two metadata facts a policy must not confuse (VERIFIED):**

* `copyright` is `null` for **289 of 503** entries (npm 53/82, cargo 236/421).
  The inventory's `note` explains why: "null means the package was not present
  locally and its own licence file carries the notice". A missing *copyright
  line* is normal; a missing *licence* is not.
* The gate's "43 crates not present in the local cargo registry"
  (`R-017` → `evidence`) is a different measurement from the 289 null
  copyright lines: it counts crates whose **licence id** came from a tarball
  rather than the local registry. The two numbers must not be conflated.

**What the gate already asked for (the authority for R9).**
`docs/g1/reuse-decision.md:757-758` and `docs/g1/provenance-record.json` →
`requiredActions`:

| ID | Blocks | Action | Owner |
| --- | --- | --- | --- |
| **A5** | nothing | "Add a CI check that fails when a new dependency appears whose licence is not on an allow-list of permissive SPDX ids." (reuse-decision adds: "this is what would have caught the `r-efi` LGPL string and keeps the map current") | Paka owner |
| **A6** | nothing | "Re-run this gate on every dependency bump and before every release; record the result in `provenance-record.json`." | Paka owner |

`docs/RELEASE-READINESS.md:208-215` (R9) is the prose version: permit MIT,
Apache-2.0, BSD-2/3, ISC, Zlib, 0BSD, Unlicense, MPL-2.0, Unicode-3.0 and
Apache-2.0 WITH LLVM-exception; reject GPL, AGPL and any package with no
licence field; re-run the inventory on every lockfile change.

## 1.2 Proposed policy (PROPOSED — every item needs the owner's decision)

**P1 — Reuse the project's own resolver; do not re-implement the grammar.**
The allow-list must be applied to the *elected* family set that
`effectiveFamilies()` produces, not to the raw licence string. That single rule
absorbs the slash forms, the `AND` forms, the parentheses, the SPDX suffix, the
alternative ordering, and the `r-efi` LGPL string. The resolver must be
**extracted into a shared module** (`scripts/lib/license-families.mjs`) and
imported by both the generator and the checker, so the two can never disagree
about what a licence means. (Today the logic lives inline in the generator;
duplicating it is how a checker and a notice file drift apart.)

**P2 — Allow-list = the elected families, in one machine-readable file.**
Proposed location `licenses/license-policy.json` (new, versioned with the
policy, referenced by both the checker and the docs). Initial content, taken
from R9's own text and reconciled with the ten licence texts already shipped in
`licenses/`:

```
allow: MIT, Apache-2.0, Apache-2.0 WITH LLVM-exception, BSD-2-Clause,
       BSD-3-Clause, ISC, Zlib, 0BSD, Unlicense, MPL-2.0, Unicode-3.0
```

`BSD-2-Clause` is in R9's text but **no package today uses it** and no
`licenses/BSD-2-Clause.txt` exists; allowing it without shipping the text would
create a notice obligation the repository cannot meet, so it should either be
dropped or the text added. (Owner decision D1.)

**P3 — Deny copyleft even when it is only an alternative?** This is the
`r-efi` question. Two defensible policies:

* **Election policy (matches the project today).** The check evaluates the
  elected family; `MIT OR Apache-2.0 OR LGPL-2.1-or-later` elects MIT and
  passes. The LGPL branch is never taken, so no LGPL obligation is created.
  This is what `docs/RELEASE-READINESS.md:157-162` and the notices file already
  say, and it keeps the checker consistent with the notice file.
* **String policy (stricter).** The check also greps the raw expression for
  `GPL|LGPL|AGPL|CPL|CDDL|EPL` and fails, forcing an explicit, reviewed
  exception for `r-efi` (2 versions). This is what A5's parenthetical ("what
  would have caught the `r-efi` LGPL string") literally asks for.

**A5's wording supports the second reading, and the release-readiness prose
supports the first.** They are not the same rule, and the difference is
material, so it must be an explicit decision (D2), not a detail the implementer
picks. A middle option: fail on the strict string policy, and keep an explicit,
version-pinned exception list for `r-efi` with the reason recorded — which
satisfies A5's wording *and* documents the exception.

**P4 — Unknown alternatives inside an `OR`.** `dunce@1.0.5` offers
`CC0-1.0 OR MIT-0 OR Apache-2.0`; `CC0-1.0` and `MIT-0` are not on R9's
allow-list and are not known families, but Apache-2.0 is elected, so the
package is compliant. Proposed rule: **an unknown alternative is allowed only if
at least one alternative in the same `OR` group is on the allow-list**; a group
with no allowed alternative fails. The unknown alternative is reported as a
warning so it can be added to the known families later. (D3.)

**P5 — Missing or unusable licence metadata is a hard failure.** An entry whose
`license` is absent, empty, or an expression that resolves to no known family
**fails** the check. This is R9's explicit requirement ("reject … any package
with no licence field") and is stricter than the current generator, which only
renders a "Review required" section. The generator must keep rendering rather
than failing — a notices file is not a gate — so the failure lives in the
checker, not the renderer.

**P6 — A `null` copyright line is a warning, never a failure.** 289 of 503
entries have one by design (the inventory's `note`). Only the licence id is
policy-bearing.

**P7 — Exceptions are explicit, version-pinned and reviewed.** Proposed shape in
`licenses/license-policy.json`:

```json
"exceptions": [
  { "ecosystem": "cargo", "name": "r-efi", "version": "5.3.0",
    "licence": "MIT OR Apache-2.0 OR LGPL-2.1-or-later",
    "reason": "<why this dependency is unavoidable>",
    "approvedBy": "<owner>", "approvedOn": "<YYYY-MM-DD>",
    "issue": "<link>" }
]
```

Rules: an exception matches `name` **and** `version` (a version bump
re-opens the question automatically, because the entry no longer matches); an
exception may only *widen* what the check rejects for that exact package; every
exception must be reported in the check's output **and** surfaced in the notice
file so a distributor can see it; an exception without `approvedBy`/`approvedOn`
is itself a failure. (D4.)

**P8 — Two different jobs, with different network needs.**

| Job | Network | When | Fails on |
| --- | --- | --- | --- |
| **Policy check** (offline) | none | every PR and every push | an entry outside the policy, or an inventory/lockfile mismatch |
| **Inventory rebuild** (network) | npm registry + crates.io | maintainer-triggered, and before a release | a package whose licence cannot be resolved |
| **Notices render** (offline) | none | with the policy check | the rendered file differs from the committed one |

The policy check and the notices render are both fully offline and
deterministic, so they belong in the PR gate. The inventory rebuild is not
(reproducibility: a registry's metadata can change, and crates that are not
present locally need their tarball fetched), so it belongs in a scheduled or
manually dispatched job, and its output must be committed so the PR gate stays
hermetic.

**P9 — The check must verify the inventory against the lockfiles, not just the
inventory against the policy.** This is the part that actually catches "a new
dependency arrived with a licence nobody checked": a new lockfile entry with no
inventory entry is a coverage failure, and it is detectable offline, without
any registry access. (This is the mechanical answer to the gap in §1.1.)

**P10 — The policy needs a review cadence and an owner.** A policy file that
nobody re-reads becomes a list of grandfathered exceptions. Proposed: the
policy file records `reviewedOn` and `reviewedBy`, and the check warns (not
fails) when the review is older than N releases.

## 1.3 Recommended implementation steps (PROPOSED)

Ordered so that each step is independently verifiable.

1. **Extract the resolver.** Move `ELECTION_ORDER`, `FAMILIES` and
   `effectiveFamilies()` out of `scripts/generate-third-party-notices.mjs:34-155`
   into `scripts/lib/license-families.mjs`; import it from the generator. No
   behaviour change: the regenerated notices must stay byte-identical
   (verified today — re-run and diff).
2. **Write the policy file** `licenses/license-policy.json` with `allow`,
   `deny`, `exceptions`, `review` — after decisions D1–D4.
3. **Write the checker** `scripts/check-licenses.mjs`, offline, exit codes:
   `0` = pass, `1` = policy violation, `2` = inventory/lockfile mismatch,
   `3` = malformed input. It performs, in order:
   a. parse `licenses/dependency-inventory.json` (schema check against
      `paka.dependency-inventory/1`);
   b. parse `pnpm-lock.yaml` `packages:` (the `snapshots:` section at line 540
      carries peer-suffixed keys and must **not** be used) and
      `src-tauri/Cargo.lock` `[[package]]`;
   c. compare the two package sets against the inventory, excluding the local
      crate (derivable: a `Cargo.lock` package with no `source =` line);
   d. for every inventory entry, resolve the elected families and check them
   against the policy and the exceptions;
   e. print a per-violation report and the summary; write a JSON report
   (`--report <path>`) for CI to upload as an artifact.
4. **Write the builder** `scripts/build-dependency-inventory.mjs`: derive the
   package set from the two lockfiles, resolve each package's licence id and
   copyright line (registry metadata for npm; the local cargo registry and the
   pinned tarball for crates), and write `licenses/dependency-inventory.json`
   with a `generatedAt` stamp. It must refuse to write an entry it could not
   resolve, and it must not silently drop a package. It is **not** run by the
   PR gate.
5. **Add the CI workflow** `.github/workflows/license-check.yml` (PROPOSED, not
   created):
   * triggers: `pull_request` and `push` to `main`, with
     `paths: [pnpm-lock.yaml, src-tauri/Cargo.lock, licenses/**,
     scripts/**, .github/workflows/license-check.yml]`;
   * runs: `node scripts/check-licenses.mjs`, then
     `node scripts/generate-third-party-notices.mjs` followed by
     `git diff --exit-code THIRD_PARTY_NOTICES.md` (the "notices are current"
     check — cheap, offline, and it fails loudly if the inventory changed
     without the notices being re-rendered);
   * uploads the JSON report as an artifact;
   * pins every third-party action to a commit SHA (not a tag) and sets
     `permissions: contents: read`;
   * runner: `ubuntu-latest` + Node from `.nvmrc`/`package.json#engines` +
     corepack for pnpm 9.15.4. The check does not need the Rust toolchain.
6. **Add a release job** (PROPOSED): before a release, run the builder, then
   the checker, then the renderer, and record the result in
   `docs/g1/provenance-record.json` — this is A6 ("record the result here"),
   which is currently unaddressed.
7. **Fix the three wrong regeneration instructions** (§1.1) so they name the
   builder for the inventory and the renderer for the notices.
8. **Update the records**: `docs/RELEASE-READINESS.md` R9 row (status and the
   decision taken), `docs/g1/provenance-record.json` `requiredActions` A5/A6
   (status + evidence), `AGENTS.md` (rows for the new scripts, the policy file
   and the workflow; §2 "do not read" for the generated artefacts).
9. **Record the policy change procedure**: a change to
   `licenses/license-policy.json` is a licence decision, reviewed by the owner
   like any other policy change, and lands in its own commit with the reason in
   the message.

## 1.4 Test cases (PROPOSED)

The checker's logic must be testable as a pure function over
`(inventory, lockfilePackages, policy) → violations`. Vitest only discovers
`src/**/*.test.ts` (`vite.config.ts:38`), so the unit test belongs at
`src/test/licensePolicy.test.ts`, importing the shared resolver and the
checker's evaluation function from `scripts/lib/` (importing across `src/` and
`scripts/` is acceptable for a node-environment test; if that is considered too
loose, the alternative is to place the library under `src/core/licensing/` and
have the scripts import it — **owner decision D6**).

| ID | Case | Input | Expected |
| --- | --- | --- | --- |
| T-01 | **allowed — single permissive** | `license: "MIT"` | pass; elected family `MIT` |
| T-02 | **allowed — election** | `"MIT OR Apache-2.0"` | pass; elected `MIT` |
| T-03 | **allowed — slash form** | `"MIT/Apache-2.0"` | pass; elected `MIT` (the slash is normalised) |
| T-04 | **allowed — SPDX suffix** | `"Apache-2.0 WITH LLVM-exception"` | pass; elected family recognised |
| T-05 | **allowed — AND, all permitted** | `"BSD-3-Clause AND MIT"` | pass; two elected families, both allowed |
| T-06 | **allowed — parenthesised AND** | `"(MIT OR Apache-2.0) AND Unicode-3.0"` | pass; elected `MIT` + `Unicode-3.0` |
| T-07 | **allowed — copyleft that Paka complies with** | `"MPL-2.0"`, `"Unicode-3.0"` | pass **only if** the owner keeps them on the allow-list; if not, they must be explicitly excepted (they are statically linked) |
| T-08 | **denied — copyleft alone** | `"GPL-3.0-only"`, `"AGPL-3.0-or-later"`, `"LGPL-3.0"` | **fail**, violation `denied-licence` |
| T-09 | **denied — copyleft as the only alternative** | `"GPL-3.0-or-later OR MIT"` | under the election policy → pass (elected `MIT`); under the strict policy → fail and require an exception. **The expected value depends on D2 and the test must encode whichever is chosen.** |
| T-10 | **denied — unknown licence** | `"WTFPL"`, `"SEE LICENSE IN COPYING"` | **fail** (`unknown-licence`), never silently pass |
| T-11 | **missing metadata** | `license: null`, `license: ""`, `license: "   "` | **fail** (`missing-licence`) — R9's explicit "reject … any package with no licence field" |
| T-12 | **unknown alternative inside a permitted OR** | `"CC0-1.0 OR MIT-0 OR Apache-2.0"` | pass with a **warning** (per P4); if D3 chooses the strict reading, this becomes a failure |
| T-13 | **coverage — new package, no inventory entry** | lockfile has `foo@1.0.0`, inventory does not | **fail** (`missing-from-inventory`) — this is the case that actually catches an unreviewed dependency |
| T-14 | **coverage — inventory entry, no lockfile entry** | inventory has `bar@2.0.0`, lockfile does not | **fail** (`stale-inventory`) |
| T-15 | **coverage — version drift** | inventory `foo@1.0.0`, lockfile `foo@1.0.1` | **fail** (`version-mismatch`) |
| T-16 | **coverage — the local crate** | `Cargo.lock` has `paka@0.1.0` with no `source =` | **pass** (excluded by rule, not by name) |
| T-17 | **coverage — peer-suffixed lockfile keys** | a `packages:` key with a `(peer@x)` suffix | the suffix is stripped; the base `name@version` is compared |
| T-18 | **coverage — the `snapshots:` section** | `pnpm-lock.yaml` `snapshots:` contains peer-suffixed keys | **not** used for the comparison (only `packages:`) |
| T-19 | **exception — matching** | exception for `r-efi@5.3.0`, entry `r-efi@5.3.0` | pass; reported as "excepted" in the output |
| T-20 | **exception — version drift invalidates it** | exception for `r-efi@5.3.0`, entry `r-efi@6.0.0` | **fail** — a version bump re-opens the decision |
| T-21 | **exception — incomplete metadata** | exception without `approvedBy`/`approvedOn` | **fail** (`malformed-exception`) |
| T-22 | **copyright null is not a licence failure** | `copyright: null`, valid licence | pass (warning at most) |
| T-23 | **regression — the real tree** | the committed inventory + the committed lockfiles + the proposed policy | **pass**, with the expected elected-family census (MIT 454, Unicode-3.0 19, MPL-2.0 17, Apache-2.0 10, BSD-3-Clause 4, ISC 2, Zlib 2, LLVM-exception 1) over 506 entries — a golden test that pins today's compliance |
| T-24 | **regression — the notices are current** | run the generator, compare with the committed file | byte-identical (verified today) |
| T-25 | **malformed input** | inventory that is not valid JSON, a lockfile that cannot be parsed | exit code 3 with a clear message, not a stack trace |

## 1.5 Risks and limitations (VERIFIED where marked)

1. **A check over a stale inventory proves nothing.** The inventory has no
   builder in the repository (§1.1). If the checker only validates the
   inventory, a dependency added last week and never inventoried passes
   silently. **Mitigation:** the coverage check against the lockfiles (P9) plus
   the builder (step 4). Without the builder, R9 is only half-delivered — and
   the "regenerate" instructions in three documents would remain false.
2. **Network non-determinism (VERIFIED).** The inventory's licence metadata came
   from the npm registry and the crates.io index/tarballs. Registry metadata can
   change without a version change. The PR gate must therefore be **offline**
   and validate the *committed* inventory; the builder is a separate,
   manually-triggered step.
3. **The checker can only classify, it cannot clear.** An allow-list says "this
   licence family is acceptable". It cannot tell whether Paka has met MPL-2.0's
   file-level obligations or shipped the required texts. That remains R5's job.
4. **The election policy can mask a copyleft string** (§1.2 P3). Whichever
   policy the owner picks, the *other* should be at least reported, so a
   reviewer sees `r-efi`'s LGPL string in the check output rather than only in
   the inventory.
5. **SPDX ids are not a complete vocabulary.** `CC0-1.0` and `MIT-0` appear
   masked inside an `OR` today; a future package may offer only one of them, in
   which case it must be reviewed and, if accepted, added to `licenses/` with
   its text. The checker's "known families" list and the shipped texts must move
   together.
6. **CI is itself an external dependency** (action supply chain, runner
   images, availability). Mitigations: pin actions to commit SHAs, `permissions:
   contents: read`, and keep the check runnable locally with
   `node scripts/check-licenses.mjs` so it is not CI-only.
7. **Pull requests from forks** cannot run a job that needs secrets; the
   proposed workflow needs none, so it can run on `pull_request` for forks.
8. **Platform-specific optional dependencies.** `pnpm-lock.yaml` `packages:`
   contains entries for other platforms (e.g. `os: [linux]` bindings). The
   comparison must be on the **resolved** set, not the installed set; today the
   two agree exactly (82/82), which is a good sign but should be re-verified
   whenever the lockfile changes.
9. **The inventory's `generatedAt` is a manual stamp.** Nothing enforces that
   it matches the lockfiles' state; the coverage check (T-13..T-18) is the
   real guard.

## 1.6 Outstanding decisions for the owner (R9)

| # | Decision | Why it cannot be decided here |
| --- | --- | --- |
| **D1** | The exact allow-list — and whether `BSD-2-Clause` is allowed (it is in R9's prose but no text is shipped in `licenses/`) | A licence allow-list is a distribution decision, not a tooling choice |
| **D2** | Election policy vs strict-string policy for copyleft inside an `OR` (the `r-efi` case). A5's wording and RELEASE-READINESS's prose differ | The two readings have different legal consequences; the repo currently documents both |
| **D3** | Whether an unknown alternative inside a permitted `OR` (`CC0-1.0`, `MIT-0` in `dunce`) is allowed with a warning or rejected | Affects whether `dunce` needs an exception today |
| **D4** | The exception mechanism, who may approve one, and whether exceptions must appear in the shipped notice file | A policy about exceptions is a policy about risk acceptance |
| **D5** | Where the policy lives (`licenses/license-policy.json` proposed) and the change procedure (PR review by the owner?) | Ownership of the policy |
| **D6** | Whether the shared resolver lives under `scripts/lib/` or `src/core/licensing/`, and whether the inventory builder is in scope for R9 at all (it is the difference between a check and a real gate) | Affects the repository's layering rules and R9's scope |
| **D7** | Whether GitHub Actions is the CI platform (the repository is on GitHub; no CI exists) and whether the workflow may run on pull requests from forks | Platform and cost/visibility decision |
| **D8** | Whether A6 ("re-run this gate … and record the result here") is discharged by the CI workflow, by a release checklist entry, or both — and where the result is recorded | A6's target (`provenance-record.json`) is a gate artefact, not a CI artefact |
| **D9** | Whether the check is **blocking** for merges or advisory | A blocking check on a repository with no CI history has adoption risk |

---

# Part 2 — R3: the clean-room attestation countersignature

## 2.1 What exists today (VERIFIED)

**The attestation document exists and is complete except for the signature.**
`docs/CLEAN-ROOM-ATTESTATION.md` (104 lines) records:

| Section | Lines | Content |
| --- | --- | --- |
| Header table | 10-17 | feature id, base commit `ad2ef11`, branch, implementation files, the specification written from, MIT licence of the result |
| "The rule" | 19-34 | the §2.5 clean-room rule, restated |
| "What is attested" | 36-51 | a table of eight source families (GIMP, Krita, MyPaint, SAI, Clip Studio, Procreate, Corel Painter, ArtRage) each "**No**" |
| "How that is evidenced" | 53-63 | seven evidence rows |
| "What this attestation is not" | 65-79 | not a claim about reading history; **does not cover what the human owner read**; scoped to `PHASE3-STAMP-ENGINE`; not a waiver |
| **"Outstanding"** | 81-99 | the exact statement to be countersigned, and the consequence of not signing truthfully |

**The statement the owner must sign (verbatim, `docs/CLEAN-ROOM-ATTESTATION.md:86-95`):**

> I confirm that, while directing or reviewing the PHASE3-STAMP-ENGINE work, I
> did not read, copy or consult GIMP, Krita, MyPaint, SAI, Clip Studio,
> Procreate, Corel Painter, ArtRage or any other third-party brush-engine
> source, and that no part of this implementation is derived from one.
>
> ```
> Name:      ______________________
> Date:      ______________________
> Signature: ______________________
> ```

**The gate's side of the record.**
`docs/g1/reuse-decision.md:158-163` (condition **C2**), `:174-190` (§2.5, the
rule), `:637-640` (§9.1 caveat: "It is *not* proof of clean-room status: the
gate cannot verify the implementer's reading history from the repository"), and
`docs/g1/provenance-record.json` → `requiredActions`:

| ID | Blocks | Action | Owner |
| --- | --- | --- | --- |
| **A9** | **merge** | "Record the implementer's clean-room attestation … before the slice is merged: that no GIMP / Krita / MyPaint / SAI / Clip Studio / Procreate / Corel Painter / ArtRage brush-engine source was read while producing the implementation, **or the name of the implementer who must re-do the work**." | implementer |

**The three places that record the current status:**

| Place | Says |
| --- | --- |
| `docs/RELEASE-READINESS.md:15` (R3) | "**Done**, owner countersignature outstanding" |
| `docs/RELEASE-READINESS.md:93-97` | "**What still needs a human.** The owner must countersign the statement in the attestation. The gate can record what the agents state and what the tree shows; it cannot verify what the owner read. If the owner did read a GPL brush engine while directing or reviewing the work, the implementation must be re-written by someone who has not." |
| `THIRD_PARTY_NOTICES.md:712-719` | "…`docs/CLEAN-ROOM-ATTESTATION.md` records that: which sources were **not** consulted … **Its owner countersignature is still outstanding**, and it is tracked as an open item in `docs/RELEASE-READINESS.md` (item R3)." |
| `docs/g1/provenance-record.json` → `postReleaseReadinessRecheck.resolutions` | "C2 (clean room): `docs/CLEAN-ROOM-ATTESTATION.md` records the attestation and its evidence; the owner countersignature is outstanding." |

**The merge precondition is still live (VERIFIED).** The stamp engine
(`9b2aceb`) is **not** an ancestor of `main` (`git merge-base --is-ancestor
9b2aceb main` → false; `main` is at `ad2ef11`). It is on
`feat/stamp-brush-engine` and on `origin/feat/stamp-brush-engine`. So the
attestation's "before the slice is merged" is still enforceable — the merge
into `main` is the last point at which it can be.

**The tree evidence the attestation relies on is verifiable, and I verified it:**

| Attestation claim | Verification | Result |
| --- | --- | --- |
| "`src/core/rendering/stampCoverage.ts` imports only Paka's own modules" (`:59`) | read the imports | **true** — 5 imports, all internal: `../../types/brush`, `../../utils/color`, `../../utils/math`, `../brushes/defaults`, `./canvas2dStroke` |
| the grep over `src/` for `gimp\|krita\|mypaint\|procreate\|clip studio\|perfect-freehand\|fabric\|konva\|paper.js\|p5` finds "No hits" (`:63`) | `Get-ChildItem src -Recurse -Include *.ts,*.tsx \| Select-String` for those terms | **0 hits** — true |
| no attribution strings in the new source (gate, `reuse-decision.md:632`) | same scan for `Copyright\|SPDX\|adapted from\|ported from\|based on\|inspired by\|reference` in `stampCoverage.ts` | **0 hits** — true |
| "the slice adds **no** dependency" (`:61`) | `git show --stat 9b2aceb -- package.json src-tauri/Cargo.toml pnpm-lock.yaml src-tauri/Cargo.lock` | **no output** — the stamp commit touches none of them. (`src-tauri/Cargo.toml` did change between `ad2ef11` and `HEAD`, but by the *release-readiness* commit `a9c67cb`, which added `license = "MIT"` — a metadata line, not a dependency.) |

## 2.2 What remains outstanding — precisely (VERIFIED)

**Two separate items, with different owners. Only one of them is the
countersignature itself.**

### Item 1 — the owner's countersignature (owner only; no agent can do it)

The `Name` / `Date` / `Signature` block at
`docs/CLEAN-ROOM-ATTESTATION.md:91-95`, covering the statement at `:87-90`.
`docs/RELEASE-READINESS.md:93-97` and `reuse-decision.md:71-74` (as summarised
in the attestation's own "What this attestation is not") both make it explicit
that **the owner must say so** if they did read a GPL brush engine, and that
the implementation must then be re-written by someone who has not.

**A9 offers a second, legitimate outcome**: "…or the name of the implementer
who must re-do the work". Not signing is not a failure of process; it is one
of the two acceptable outcomes, and it has a concrete consequence (a re-write).

### Item 2 — three record defects that should be fixed *before* the owner is asked to sign

The owner is being asked to countersign a provenance record. If the record is
incomplete, the signature covers an incomplete statement. I found three
concrete defects:

| # | Defect | Evidence | Severity |
| --- | --- | --- | --- |
| **R3-a** | **The "Implementation files" row is incomplete.** It lists 10 files; the slice changed **13** under `src/`. Missing: `src/test/drawingEngine.test.ts`, `src/test/projectFormat.test.ts`, `src/test/projectLifecycle.test.ts`. | `docs/CLEAN-ROOM-ATTESTATION.md:15` vs `git diff --stat ad2ef11..HEAD -- src/` (13 files) | **material** — the row is the scope of what is being attested |
| **R3-b** | **The evidence row's import list is incomplete.** It names four modules; the file imports five (`../brushes/defaults` is missing). | `docs/CLEAN-ROOM-ATTESTATION.md:59` vs the file's imports | low — the *claim* ("only Paka's own modules") is true |
| **R3-c** | **The machine-readable record contradicts itself, and contradicts the attestation.** `docs/g1/provenance-record.json` → `cleanroom.status` = **"pending - attestation not yet provided"**, while the same file's `postReleaseReadinessRecheck.resolutions` says the attestation exists and only the countersignature is outstanding, and `reuse-decision.md:639-640` says "The §2.5 attestation remains outstanding". | the two blocks in the same JSON | **material** — a machine-readable record is what a future tool or reviewer will read |

Two further precision points (not defects, but worth stating when the
statement is finalised):

* The attestation is scoped to the base commit `ad2ef11` (`:13`), but the
  implementation spans `ad2ef11..9b2aceb` (the stamp engine's own commit, plus
  the release-readiness merge `a897b76` and the g1 reorganisation `47e309f`
  around it). A countersignature should name **the tree it covers**, not only
  the base — and if the owner signs for the branch as it stands, that is a wider
  range (`ad2ef11..fac6441` at the time of writing) that includes unrelated
  work.
* The evidence row "`package.json`, `src-tauri/Cargo.toml` | Unchanged" is true
  *of the slice* but not of the range `ad2ef11..HEAD` (`Cargo.toml` gained
  `license = "MIT"` in `a9c67cb`). Rephrasing to "the slice changes neither"
  removes the ambiguity.

## 2.3 Proposed wording and checklist (PROPOSED — no signature, no implication)

**For the owner (a note to accompany the request, not a change to the
statement).** The statement itself is well drafted and should not be softened.
What is missing is a short preamble that tells the signer what they are signing
and what happens if they cannot:

> **What this countersignature covers.** The statement above is about your own
> reading and directing of the `PHASE3-STAMP-ENGINE` slice, on the branch
> `feat/stamp-brush-engine`, over the range `ad2ef11..9b2aceb`. The
> implementation files are listed in the table above; the agents' own
> attestation and its evidence are in `docs/CLEAN-ROOM-ATTESTATION.md` and
> `docs/g1/`.
>
> **If you cannot make the statement truthfully**, do not sign it. Record
> instead which source you read (A9's second outcome: "the name of the
> implementer who must re-do the work"); the implementation must then be
> re-written by someone who has not read it, from the specification named
> above. `docs/RELEASE-READINESS.md` R3 stays open until either the
> countersignature is in place or the re-write has happened.

**For the agents (a records-correction checklist, to run before the owner is
asked):**

1. Correct the "Implementation files" row to all 13 changed files under `src/`
   (R3-a). *(Not done here: editing the attestation is out of scope for this
   session.)*
2. Add the fifth import to the evidence row (R3-b).
3. Rephrase the "`package.json`, `src-tauri/Cargo.toml` | Unchanged" row to
   "the slice changes neither", and name the range the attestation covers.
4. Fix `docs/g1/provenance-record.json` → `cleanroom.status` so it matches its
   own `postReleaseReadinessRecheck` (R3-c) — e.g. "attestation recorded;
   owner countersignature outstanding" — and update `reuse-decision.md:639-640`
   to the same wording.
5. Re-run the three verification commands the attestation names and paste their
   output next to the evidence rows, so the owner is signing a record whose
   evidence has been re-run at the commit being signed.
6. Add the countersignature block's outcome to `docs/RELEASE-READINESS.md` R3
   **only after** the owner has actually signed, and regenerate
   `THIRD_PARTY_NOTICES.md` in the same commit (the sentence at
   `THIRD_PARTY_NOTICES.md:718` is part of the generator's template, so it
   cannot be edited in the notices file itself).

**What must not happen (explicitly):** no agent may fill in the name, date or
signature; no document may be marked signed, resolved or "countersigned" on the
owner's behalf; the R3 status line must keep saying the countersignature is
outstanding until the owner has actually signed; and the notices file's
"countersignature is still outstanding" sentence must not be softened before it
is true.

## 2.4 Risks (VERIFIED where marked)

1. **Signing an incomplete record (VERIFIED defect R3-a/R3-c).** The owner
   would be countersigning a scope list that omits three changed test files and
   a status field that says the attestation does not exist. Fix the records
   first.
2. **The precondition may be lost if `main` moves first (VERIFIED).** The
   attestation says "before the slice is merged". The slice is merged on its
   feature branch and QA gave PASS (`docs/g1/README.md`), but `main` does not
   contain it. If `main` is fast-forwarded first, the enforcement point is
   gone and the item becomes a post-hoc record.
3. **A false signature is worse than no signature.** The attestation itself
   says the gate "cannot verify the implementer's reading history" and does not
   cover what the owner read. A countersignature that is not truthful converts a
   documented gap into an unrecorded one.
4. **Scope creep.** The attestation covers `PHASE3-STAMP-ENGINE` only
   (`:75-76`). A later feature needs its own attestation; the stamp engine's
   does not travel with it.
5. **The notices file is a distribution artefact.** It currently discloses the
   outstanding countersignature to every recipient (`:718`). That disclosure is
   correct today and must be regenerated, not hand-edited, when the status
   changes.
6. **A9's second outcome can be misread as a failure.** Naming the implementer
   who must re-do the work is an *accepted* outcome, but it has a real cost
   (a re-write of `stampCoverage.ts` and its integration). The owner should
   choose deliberately.
7. **The owner may not be the only person who directed the work.** If any
   other person reviewed or shaped the implementation, the statement's scope
   ("while directing or reviewing the PHASE3-STAMP-ENGINE work") should say
   whose reading it covers. The current wording is addressed to "the
   repository owner" only.

## 2.5 Outstanding decisions for the owner (R3)

| # | Decision | Why it cannot be decided here |
| --- | --- | --- |
| **D10** | Who signs: the repository owner alone, or every person who directed or reviewed the slice | The statement's scope depends on it |
| **D11** | Where the signature lives: the placeholder in the attestation, a signed commit, a detached GPG signature, or a line in `docs/g1/provenance-record.json` | A record-keeping decision with verification consequences |
| **D12** | Whether the countersignature is a **merge** gate or a **release** gate. The gate's own action A9 says "blocks: merge" | It is the difference between a hard stop and a note |
| **D13** | Whether the attestation is per-slice (as now) or per-release | Changes how many signatures a release needs |
| **D14** | What happens if the signature cannot be given: re-write the implementation, or ship without the stamp engine (the stamp is off by default, so the product works either way) | A product and risk decision |
| **D15** | Whether the records corrections in §2.3 land **before** the signature request (recommended) or in the same commit as the signature | Sequencing affects what is being signed |

---

## Appendix — what I ran, and where

| Purpose | Command | Result |
| --- | --- | --- |
| CI absence | `git log --all --diff-filter=A --name-only --pretty=format:` filtered for CI file names | no matches, ever |
| CI absence | `Get-ChildItem -Force` at the root; `Get-ChildItem .git/hooks` (excluding samples) | no `.github/`, no hooks |
| Inventory ↔ lockfile coverage | scratch script `s8-coverage-at-rev.mjs` (outside the repository), reading `git show` blobs | npm 85/85 exact; cargo 421/422, the only difference being `paka@0.1.0` |
| Licence surface, unmatched, masked alternatives, AND cases | scratch script `s8-licence-surface.mjs`, replicating `effectiveFamilies()` from `scripts/generate-third-party-notices.mjs:34-155` | 0 unmatched; 8 elected families; 4 masked alternatives; 3 AND packages |
| Generator idempotence | `node scripts/generate-third-party-notices.mjs` then `git diff -- THIRD_PARTY_NOTICES.md` | byte-identical, exit 0 |
| Attestation evidence | import scan of `src/core/rendering/stampCoverage.ts`; attribution/brush-engine greps over `src/` | 5 internal imports, 0 attribution hits, 0 brush-engine hits |
| Slice footprint | `git diff --name-only ad2ef11..9b0a885 -- src/` | 13 files — 3 more than the attestation lists |
| Slice dependency claim | `git show --stat 9b2aceb -- package.json src-tauri/Cargo.toml pnpm-lock.yaml src-tauri/Cargo.lock` | empty — the slice adds no dependency |
| Merge precondition | `git merge-base --is-ancestor 9b2aceb main` | false — `main` does not contain the stamp engine |
| Inventory coverage at `47e309f` / at `9b0a885` | `s8-coverage-at-rev.mjs` (scratch, outside the repo) against `git show` blobs | 82/82 exact at `47e309f`; **85 vs 82 (3 missing) at `9b0a885`** — see the addendum |
| Inventory coverage at `fac6441` (after `3c2df3f`) | the same script | **85 / 85, 0 missing, 0 extra** |
| "notices are current" check on the real content | `s8-notices-check.mjs` (scratch): render from the inventory with the generator, compare with the committed notices | **identical, 81,473 bytes** |
| Re-validation after the tree moved | all of the above re-run at `fac6441` | every finding above still holds; only the inventory totals changed (506 entries) |

Both scratch scripts live outside the repository
(`C:\Users\aissa\AppData\Local\Temp\opencode\`) and are not part of the project.
All inspection was done from `git show` blobs in a detached worktree; the shared
checkout was only read.

---

# Addendum — the R9 gap occurred live, in this repository, while this document was being written

**This is the most important evidence in Part 1, and it is not a hypothesis.**

While this plan was being prepared, the shared checkout moved: `main` stayed at
`ad2ef11`, but `feat/stamp-brush-engine` advanced from `47e309f` to **`9b0a885`**
("Merge branch 'feat/visual-regression-harness' into feat/stamp-brush-engine"),
which brought **Playwright** into the project. The consequence, measured against
the **committed** tree with `git show`:

| Commit | npm packages in the lockfile | npm entries in the committed inventory | Gap |
| --- | --- | --- | --- |
| `47e309f` (before the merge) | 82 | 82 | none |
| **`9b0a885` (after the merge)** | **85** | **82** | **3 packages in the lockfile with no inventory entry**: `@playwright/test@1.64.1`, `playwright-core@1.64.1`, `playwright@1.64.1` |

So at `9b0a885` the repository's own claim — "one entry per resolved package in
`pnpm-lock.yaml` and `src-tauri/Cargo.lock`"
(`licenses/dependency-inventory.json` → `note`) — was **false**, and the
committed `THIRD_PARTY_NOTICES.md` did not cover three packages that ship in
the tree. The three Apache-2.0 packages also ship a `NOTICE` file, which
Apache-2.0 §4(d) requires to be carried forward, so the gap was an obligation
gap, not only a bookkeeping gap.

**It was closed manually, in the working tree, by another agent** — and has since
landed as commit **`3c2df3f`** ("chore: record the Playwright packages in the
dependency inventory and notices"): three entries added to the inventory, a
"### The Apache-2.0 NOTICE" section added to the generator's template, and the
notices regenerated. I verified that state end to end (the numbers below are
re-measured at `fac6441`, where the fix is committed):

| Check | Result |
| --- | --- |
| committed inventory vs the committed lockfile (at `fac6441`) | **85 / 85, 0 missing, 0 extra** — the gap is closed |
| committed inventory size | 506 entries (85 npm + 421 cargo) |
| elected families on the committed inventory | MIT 454, Unicode-3.0 19, MPL-2.0 17, **Apache-2.0 10**, BSD-3-Clause 4, ISC 2, Zlib 2, Apache-2.0 WITH LLVM-exception 1 — **0 unmatched** |
| distinct licence expressions | 27 (unchanged) |
| masked alternatives | unchanged: `dunce` → CC0-1.0 / MIT-0; `r-efi@5.3.0` and `r-efi@6.0.0` → LGPL-2.1-or-later |
| **the proposed "notices are current" check** (render the notices from the inventory with the generator, compare byte-for-byte with the committed notices) | **IDENTICAL — 81,473 bytes both sides** |

**What this demonstrates (VERIFIED):**

1. The coverage check proposed in §1.2 P9 and test cases **T-13/T-14** would
   have caught this at the moment the merge landed, with **no network access**:
   three lockfile entries with no inventory entry. That is precisely the failure
   R9 exists to prevent, and it happened without anyone doing anything wrong.
2. The repair was **manual and serial**: one person had to notice, hand-edit the
   inventory, edit the generator's template to carry the upstream `NOTICE`
   forward, and regenerate. A new Apache-2.0 package with a `NOTICE` file is
   exactly the case a hand-maintained inventory handles worst, and there is no
   script that would have produced the `NOTICE` carry-forward automatically.
3. The "notices are current" check proposed in §1.3 step 5 works and passes on
   real content — it is cheap, offline and deterministic, and it is the check
   that would have caught the notices file drifting from the inventory.
4. The elected-family census changes when a dependency arrives
   (Apache-2.0 7 → 10), so a policy file that is not re-reviewed will quietly
   stop describing the tree (this is the risk named in P10).

**What this does not change.** It does not alter the R9 design above; it
confirms it, and it shows that the gap is *live* rather than hypothetical. It
also does **not** resolve R9: the fix is committed (`3c2df3f`) but there is still
no inventory builder and no CI check, so the next dependency bump will repeat
the same manual sequence unless the check exists.

---
