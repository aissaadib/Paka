# Release readiness

This file tracks the work that has to happen **before a build of Paka is
distributed**. It is deliberately separate from the feature work: none of it
blocks a feature, and none of the feature work is blocked by it.

The licence gate that produced this list is `docs/g1/reuse-decision.md`; the
machine-readable record is `docs/g1/provenance-record.json`. Every item below names
the finding it closes.

| ID | Item | Finding | Status |
| --- | --- | --- | --- |
| R1 | Replace the TAURI-logo application icons with original Paka artwork | B-1 | **Done** |
| R2 | Correct the licence attributions in `docs/architecture-port-plan.md` | B-8 | **Done** |
| R3 | Clean-room attestation and provenance records for the stamp engine | C2 | **Done**, owner countersignature outstanding |
| R4 | Resolve the Vercel agent-skills licensing question | B-2 | **Done** - the answer is MIT, not "no licence" |
| R5 | Verify and package the required third-party licence notices | B-3, B-4 | **Done** |
| R6 | Decide the patent-grant position | B-5 | **Open** - owner decision |
| R7 | Publish the governance documents | B-5 | **Open** - owner decision |
| R8 | An in-app About / Licences screen | B-4 | **Open** - not required before the first release |
| R9 | Keep the licence inventory honest | A5, A6 | **Open** - needs a CI check |

---

## R1 - Replace the TAURI-logo application icons

**Finding B-1. Status: done.**

The stock `tauri init` icon set is the TAURI mark. The TAURI copyright licence
(MIT OR Apache-2.0) grants no trademark rights, and Tauri's trademark
guidelines require a licence from the trademark holder before the logo is used
for a third-party product. Shipping Paka under the TAURI logo implied an
endorsement that does not exist.

**What changed.**

| Path | Change |
| --- | --- |
| `scripts/generate-app-icon.mjs` | New. Generates the mark from geometry: a rounded plate and a tapered chain of overlapping dabs along a cubic Bezier. No source image, no traced outline, no third-party asset. |
| `src-tauri/app-icon.svg` | New. The generated source artwork. |
| `src-tauri/icons/**` | All 16 files regenerated from that source. Every one of them now differs from the upstream TAURI template (`icon.ico` was byte-identical before; it is not any more). |
| `src-tauri/icons/README.md` | New. Provenance of the artwork and the regeneration commands. |

The colours are the app's own tokens (`--bg-app`, `--border`, `--accent`). The
motif is a dab chain because that is how Paka paints.

**Check it yourself.**

```bash
node scripts/generate-app-icon.mjs
pnpm tauri icon src-tauri/app-icon.svg
```

`tauri icon` also writes an `ios/` directory, which Paka does not ship; delete
it after generating. `64x64.png` is new and is kept.

**Also worth knowing.** `tauri icon` renders the SVG, so `src-tauri/app-icon.svg`
is the only file a designer needs to replace to rebrand Paka.

## R2 - Correct the licence attributions in the architecture plan

**Finding B-8. Status: done.**

`docs/architecture-port-plan.md` attributed three licences wrongly. They are
now corrected, and the two claims built on them are corrected with them.

| Plan said | Actually is | Evidence |
| --- | --- | --- |
| "Krita GPL-2.0" | **GPL-3.0** | `KDE/krita` → API `license.spdx_id = GPL-3.0`; `KDE/krita@master/COPYING` is "GNU GENERAL PUBLIC LICENSE Version 3" |
| "mypaint LGPL-2.1" | **GPL-2.0** | `mypaint/mypaint` → API `license.spdx_id = GPL-2.0`; `mypaint/mypaint@master/COPYING` is "GNU GENERAL PUBLIC LICENSE Version 2, June 1991" |
| "xp-brush GPL-2.0" | **No such brush-engine project could be verified.** A repository search returns four unrelated results. | Removed. |

The plan's MyPaint reason was wrong *in kind*: it said the "LGPL option has
linking obligations", but MyPaint is GPL, so the consequence is **relicensing
Paka**, not a linking obligation. The plan's conclusion - implement
independently, do not copy - was correct and is unchanged.

The plan also said "there is no separate licence-gate document because there is
nothing to gate". That was written before the gate ran; the gate is
`docs/g1/reuse-decision.md` and it reached the same conclusion for the chosen path
while finding two things the plan did not: **B-1** and **B-4**.

## R3 - Clean-room attestation and provenance records

**Condition C2. Status: done, except the owner countersignature.**

`docs/CLEAN-ROOM-ATTESTATION.md` records that the stamp engine was written
from Paka's own specification, that no third-party brush-engine source was
consulted, and the evidence for it. The tree agrees: `src/core/rendering/stampCoverage.ts`
imports only Paka's own modules, and no dependency, asset or attribution
string was added.

**What still needs a human.** The owner must countersign the statement in the
attestation. The gate can record what the agents state and what the tree
shows; it cannot verify what the owner read. If the owner did read a GPL brush
engine while directing or reviewing the work, the implementation must be
re-written by someone who has not.

## R4 - The Vercel agent-skills licensing question

**Finding B-2. Status: done. The answer is MIT, not "no licence".**

This item **corrects the gate's own first finding**. The gate reported that
`vercel-labs/agent-skills` carried no licence at all, because it has no
`LICENSE` file and the GitHub API reports `license: null`. That is true, and
it was not the whole truth: the upstream repository's README states the
licence, in a "## License" section, as **MIT**.

| Check | Result |
| --- | --- |
| Upstream `README.md`, `## License` | `MIT` |
| First appearance of that statement | `740483462a`, 2025-12-08 - the repository's first commit |
| Present at the commit that last touched the copied `SKILL.md` | `805687f34e`, 2026-04-14 - yes |
| Present at the commit that last touched the copied `rules/` | `dc8367e6f9`, 2026-04-14 - yes |
| Present on `main` today | yes |
| Standalone `LICENSE` file | **none** |
| Explicit copyright line | **none**; the rules' README credits "Originally created by [@shuding](https://x.com/shuding) at [Vercel](https://vercel.com)" |

**Conclusion.** The rights holder - Vercel, Inc. - has published an MIT grant
for this material, continuously, since the repository was created. The two
caveats (no `LICENSE` file, no copyright line) are recorded in
`THIRD_PARTY_NOTICES.md` rather than hidden; neither prevents redistribution
under MIT.

**What changed.**

* The 76 files stay tracked. Nothing is untracked, git-ignored or purged.
* The MIT permission notice ships in `licenses/MIT.txt`, and the copyright
  holder is recorded as Vercel, Inc. in `THIRD_PARTY_NOTICES.md`.
* The gate's finding B-2 is re-issued as **RESTRICTED** rather than **NEEDS
  HUMAN REVIEW**: the only requirement left is the notice obligation, which
  R5 discharges.

**What the owner may still do (optional, not blocking).** Ask Vercel to add a
canonical `LICENSE` file to the upstream repository. That removes the caveat
but changes nothing about Paka's position.

## R5 - Verify and package the third-party licence notices

**Findings B-3, B-4. Status: done.**

| Path | What it is |
| --- | --- |
| `THIRD_PARTY_NOTICES.md` | The notice file. Generated, not hand-written. |
| `licenses/` | The verbatim licence texts: MIT, Apache-2.0, Apache-2.0 WITH LLVM-exception, MPL-2.0, Unicode-3.0, BSD-3-Clause, ISC, Zlib, 0BSD, Unlicense. |
| `licenses/dependency-inventory.json` | The machine-readable inventory: one entry per resolved package, with the licence it declares and the copyright line from the licence file it ships. |
| `scripts/generate-third-party-notices.mjs` | Renders the notice file from the inventory. |
| `src-tauri/tauri.conf.json` | `bundle.resources` ships `THIRD_PARTY_NOTICES.md` and `licenses/`; `bundle.license`, `bundle.licenseFile` and `bundle.copyright` are set. |
| `src-tauri/Cargo.toml` | `license = "MIT"` added, so `bundle.license` does not have to be guessed. |
| `README.md` | A "License" section pointing at the notice file and the licence texts. |

**Coverage.** 82 npm packages and 421 cargo crates - every third-party package
either lockfile resolves - each with the exact licence it declares and the
copyright line from its own licence file. Every one of them matched a licence
family; none is left for manual review.

**Election.** Where a package is offered under several licences (an `OR`),
Paka elects **MIT** whenever MIT is on offer. Where a package requires several
at once (an `AND`), Paka complies with all of them, so it appears under each
family it is subject to. `r-efi`, the only package whose licence string
mentions LGPL, is taken under MIT - the LGPL branch would have put an LGPL
obligation inside the shipped binary.

**The MPL-2.0 crates.** `cssparser`, `cssparser-macros`, `dtoa-short`,
`option-ext` and `selectors` are statically linked into the executable.
MPL-2.0 is file-level copyleft: Paka modifies none of them, so no source has
to be published, but the licence text must be available with the distribution.
It now is, and the notice file states where each crate's source is.

**Regenerate.**

```bash
node scripts/generate-third-party-notices.mjs
```

Re-run it whenever a lockfile changes, and before every release.

## R6 - The patent-grant position (open)

Paka's own licence is MIT, which contains **no express patent grant**. Most of
the `MIT OR Apache-2.0` dependencies could have been taken under Apache-2.0,
which does grant one. Electing MIT (see R5) does not change the product's
patent position, because the product's own licence is MIT either way.

**The owner decides** whether Paka wants an express patent grant. The options
are: stay MIT and accept that none is granted; or relicense the project under
Apache-2.0. This is a product decision, not a legal formality.

## R7 - The governance documents (open)

Paka has no `CONTRIBUTING.md`, no CLA or DCO, no `CODE_OF_CONDUCT.md`, no
`SECURITY.md`, no trademark policy and no express patent grant. Inbound
contributions therefore arrive without an explicit licence grant.

**The owner decides** whether to publish these, and in particular whether
inbound contributions are inbound=outbound (a DCO or CLA) or left with the
project's default terms. `CODE_OF_CONDUCT.md` and `SECURITY.md` are the two
that a public repository is normally expected to have.

## R8 - An in-app About / Licences screen (open, not required for a release)

The licence texts ship with the installer (`R5`), which satisfies the
distribution obligation. An in-app screen that lists them would be a
convenience and would make the notices discoverable without leaving the
application. It is a front-end feature and belongs with the UI work, not with
release readiness.

## R9 - Keeping the inventory honest (open)

Nothing stops a future dependency from arriving with a licence nobody checked.
**The owner should add a CI check** that fails when a new package's licence is
not on an allow-list of permissive SPDX ids, and that re-runs the inventory on
every lockfile change. The allow-list should permit MIT, Apache-2.0, BSD-2/3,
ISC, Zlib, 0BSD, Unlicense, MPL-2.0, Unicode-3.0 and Apache-2.0 WITH
LLVM-exception, and reject GPL, AGPL and any package with no licence field.

---

## How these two workstreams relate

| | Feature work | Release readiness |
| --- | --- | --- |
| Branch | `feat/stamp-brush-engine` | `chore/release-readiness` |
| Scope | The stamp engine and its tests | ICONS, notices, licences, attestation |
| Gate | The implementation and QA gates in `docs/SESSION-BRIEF.md` §9 and the audit | This file |
| Blocked by the other? | No | No |

Nothing in R1-R9 blocks the stamp engine, and nothing in the stamp engine
blocks R1-R9. R1-R5 are complete; R6-R9 are decisions or follow-ups that do
not need to be made before the next feature starts.
