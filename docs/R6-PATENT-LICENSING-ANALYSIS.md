# R6 — patent-grant and licensing analysis

**Status:** evidence-based analysis for the project owner. **R6 remains open**
(`docs/RELEASE-READINESS.md:18`; `docs/g1/provenance-record.json:782` → `stillOpen:
["R6 patent grant", …]`). This document does **not** decide anything, does not
mark R6 resolved, and is **not legal advice**. Where the evidence does not
support a firm conclusion, that is said plainly.

| Field | Value |
| --- | --- |
| Question | Does Paka want an express patent grant, and what would it change? |
| Finding it closes | **B-5** ("no express patent grant"; `docs/g1/reuse-decision.md:67`) |
| Action it feeds | **A7** ("Decide whether Paka wants an express patent grant"; `docs/g1/provenance-record.json:838`) |
| Decided by | the Paka owner (`Copyright (c) 2026 HumanHEART`, `LICENSE:3`) |
| Tree state read | `9b0a885` (release-readiness merged), branch `feat/stamp-brush-engine` |
| Evidence date | 2026-10-20 |

---

## 1. What was verified locally

| # | Artefact | What it says | Reference |
| --- | --- | --- | --- |
| 1 | Root licence | Plain MIT, "Copyright (c) 2026 HumanHEART". **No clause mentions patents.** | `LICENSE:1-21`; `licenses/MIT.txt` (0 occurrences of "patent") |
| 2 | How long it has been MIT | Unchanged since the first commit — `7584114 "Initial commit"`, 2026-10-18, HumanHEART. The licence was never revisited. | `git log --follow -- LICENSE` |
| 3 | Declared in the bundle | `"license": "MIT"`, `"licenseFile": "../LICENSE"`, `"copyright": "Copyright (c) 2026 HumanHEART"`; `src-tauri/Cargo.toml:7` `license = "MIT"`. | `src-tauri/tauri.conf.json:33-35` |
| 4 | Canonical provenance | `subjectLicense.spdxId = "MIT"`, `holder = HumanHEART`; `decisions[0].license.spdxId = "MIT"`; B-5 outcome `NEEDS HUMAN REVIEW`; `humanDecisionRequired[5] = "Decide the patent-grant question."` | `docs/g1/provenance-record.json:45-46, 121, 649, 865` |
| 5 | Gate's own framing | "MIT contains none"; choosing the MIT branch of `tauri`/`wry` forgoes the Apache-2.0 patent grant; "low risk, recorded, human decision if patents matter". | `docs/g1/reuse-decision.md:453-464` |
| 6 | Readiness item | R6 "Open — owner decision"; the options are stated as "stay MIT … or relicense the project under Apache-2.0 … This is a product decision, not a legal formality." | `docs/RELEASE-READINESS.md:18, 178-187` |
| 7 | Notice file | Records the election rule (MIT whenever MIT is on offer) and states the patent position; refers to R6. | `THIRD_PARTY_NOTICES.md:18-28` |
| 8 | Dependency inventory | 506 resolved third-party packages (85 npm, 421 cargo), each with its declared licence. **No GPL, no AGPL, no mandatory LGPL, no unlicensed package.** | `licenses/dependency-inventory.json`; `docs/g1/reuse-decision.md:68` (B-6) |
| 9 | First-party provenance | The stamp engine was written from Paka's own specification; its result is "MIT, the same as the rest of Paka"; no third-party code or asset entered the tree. | `docs/CLEAN-ROOM-ATTESTATION.md:17, 39-63` |
| 10 | Governance | **No** `CONTRIBUTING.md`, `CLA.md`, DCO, `CODE_OF_CONDUCT.md`, `SECURITY.md`, trademark policy or patent policy exists. | tree check; `docs/g1/reuse-decision.md:67` (B-5) |
| 11 | In-repo copied material | 85 files under `.agents/skills/` (Vercel `agent-skills`, MIT; Addy Osmani skills, MIT). Repository-only; not shipped in the installer. | `docs/g1/reuse-decision.md:64-65`; `THIRD_PARTY_NOTICES.md` |

**What was not verified:** patentability or validity of any patent; whether any
third party has asserted or intends to assert patents against Paka or its
users; the employment/assignment status of the owner's contributions; the
licences of packages not present locally (the inventory records `copyright: null`
where a package's own licence file carries the notice).

---

## 2. Scope: what R6 actually implicates

R6 is **not** a single project-wide switch. Three separate populations of code
ship in or with Paka, and only the first is under the owner's own licence.

### 2.1 First-party code — under MIT, no express grant

125 source files: 121 TypeScript/TSX in `src/` and 4 Rust files in
`src-tauri/src/`, plus `scripts/`, `docs/` and the generated artwork. **All of it
is MIT.** A recipient receives a copyright permission and **no express patent
licence** for any of it. This is the population R6 is really about.

### 2.2 Third-party dependencies — the position is fixed by *their* licences and by *Paka's election*

The election rule (`THIRD_PARTY_NOTICES.md:18-22`) is "elect MIT whenever MIT
is on offer". Applying it to the inventory gives the shipped position:

| Third-party population | Packages | Express patent grant to recipients? |
| --- | --- | --- |
| MIT on offer → **MIT elected** | **455** (390 cargo, 65 npm) | **No.** The Apache-2.0 branch was available and was not taken. |
| MPL-2.0 | 17 (12 npm, 5 cargo) | **Yes**, but narrow: per contributor, over that contributor's patent claims (MPL-2.0 §2.1(b)). |
| Apache-2.0 only (incl. 1 WITH LLVM-exception) | 9 | **Yes** — Apache-2.0 §3. |
| Unicode-3.0 | 18 | No patent clause in the text. |
| Other permissive (ISC, BSD-3-Clause, Zlib, 0BSD, Unlicense) | 7 | No patent clause in the texts. |
| **Total** | **506** | **26 carry an express grant; 480 do not.** |

### 2.3 Copied repository material — MIT, repository-only

The 85 files under `.agents/skills/` are MIT (Vercel, Addy Osmani). They are
committed to the repository but are **not** part of the installer, so no
distribution obligation and no separate patent question arises for them beyond
the repository's own terms.

### 2.4 The consequence that the existing record understates

`docs/RELEASE-READINESS.md:181-183` says electing MIT "does not change the
product's patent position, because the product's own licence is MIT either
way". The first half is accurate; the second half is not complete. The
**election is a separate act about third-party terms** and has its own effect:

* **Relicensing Paka's own code to Apache-2.0 would *not* restore the 455
  MIT-elected packages' grants.** Their terms were fixed when Paka took them
  under MIT. A recipient of the installer still receives no express grant for
  that code, including for the `tauri`/`wry` stack the app is mostly made of.
* **Electing Apache-2.0 for the dual-licensed dependencies would add express
  grants for that code *without* changing Paka's own licence** — it is an
  independent lever, and the only one that reaches the ~455 packages.

So R6 is really **two decisions** (D1: the first-party grant; D2: the
dependency election), plus the governance question in R7 that determines how
hard either is to change later. The existing record treats it as one.

---

## 3. The licence texts (primary sources)

| Licence | Patent clause | Primary source |
| --- | --- | --- |
| **MIT** | **None.** The OSI text and the SPDX entry contain **zero** occurrences of "patent". The grant is "Permission … to deal in the Software" — a copyright permission. | `licenses/MIT.txt`; <https://opensource.org/license/mit>; <https://spdx.org/licenses/MIT.html> |
| **Apache-2.0** | **§3 Grant of Patent License**: "each Contributor hereby grants to You a perpetual, worldwide, non-exclusive, no-charge, royalty-free, irrevocable (except as stated in this section) patent license … where such license applies only to those patent claims licensable by such Contributor that are necessarily infringed by their Contribution(s) … If You institute patent litigation … then any patent licenses granted to You under this License for that Work shall terminate …". | `licenses/Apache-2.0.txt:74-88`; <https://www.apache.org/licenses/LICENSE-2.0> |
| **MPL-2.0** | **§2.1(b)**: "Each Contributor hereby grants You a world-wide, royalty-free, non-exclusive license … (b) under Patent Claims of such Contributor to make, use, sell, offer for sale, have made, import, and otherwise transfer either its Contributions or its Contributor Version." | `licenses/MPL-2.0.txt:100-102`; <https://www.mozilla.org/media/MPL/2.0/index.txt> |
| **GNU GPLv3** | **§11 Patents** (contributor patent licence, plus protection for downstream recipients whose Corresponding Source is available). Included here for the counterfactual, because R9's allow-list would reject a copyleft dependency. | <https://www.gnu.org/licenses/gpl-3.0.txt> §11 |
| **Unicode-3.0, Zlib, ISC, BSD-3-Clause, 0BSD, Unlicense** | No patent clause in the texts shipped in `licenses/`. | `licenses/` (verified: 0 occurrences of "patent") |

### The distinction that matters, stated without over-claiming

* "**Express**" patent grant: the licence says so. Apache-2.0 §3, MPL-2.0
  §2.1(b), GPLv3 §11.
* "**Implied**" patent grant: whether one arises under MIT is **contested and
  unsettled**. The Johns Hopkins OSPO states it plainly: "Some open source
  licenses do not explicitly mention patents, but they have been interpreted by
  some commentators to implicitly grant patent rights based on broader legal
  principles" (<https://ospo.library.jhu.edu/learn-grow/licensing-overview/copyright-patents-more/>).
  US law recognises that a patent licence may be **implied** from conduct —
  *Wang Labs., Inc. v. Mitsubishi Elecs. Am., Inc.*, 103 F.3d 1571 (Fed. Cir.
  1997); *DePuy Spine, Inc. v. Medtronic Sofamor Danek, Inc.*, 469 F.3d 1005
  (Fed. Cir. 2006) — but whether a given open-source permission amounts to
  such conduct is fact-specific and, for MIT, unresolved.
* The OSI frames the design choice explicitly: Apache-2.0 was written in 2004
  "in an effort to make clearer to licensors what patent rights they were
  granting, and to licensees what patent rights they were receiving",
  including the defensive-termination clause
  (<https://opensource.org/blog/patents-and-open-source-understanding-the-risks-and-available-solutions-2>).

**Nothing in this section is a conclusion that Paka's MIT grant does or does not
confer patent rights.** That is question Q1 below.

---

## 4. Options

Each option is stated with what it changes, what it costs, and what it does
*not* fix. None is recommended here; the owner decides.

| # | Option | Changes | Does **not** change | Costs / risks |
| --- | --- | --- | --- | --- |
| **A** | **Status quo** — Paka stays MIT; keep electing MIT for dual-licensed dependencies. | Nothing. | — | Lowest friction. Recipients get no express grant for Paka's 125 files or for the 455 MIT-elected packages; the only comfort is the contested implied-grant theory. If the owner ever wants a grant, it must be made later, when external contributions may exist. |
| **B** | **Relicensing first-party code to Apache-2.0** (single licence). | Paka's own 125 files gain an express grant (§3) and the defensive-termination clause. | The dependency position (§2.4): the 455 MIT-elected packages stay uncovered. | Requires the owner to hold every copyright it relicences (§5.1). Introduces §3's termination clause — the OSI/FSF concern about a unilateral patent-termination trigger is the standard objection and should be put to counsel. Changes the licence terms of the whole project, including for anyone who has already relied on MIT terms. |
| **C** | **Dual-licence first-party code "MIT OR Apache-2.0"** (Apache-2.0 preferred). | Same express grant as B, while MIT remains available. | The dependency position, as B. | Most permissive for recipients; keeps MIT's short notice and familiarity. Notice work grows slightly (the notices generator would need to state the dual licence). Same §3-termination trade-off as B. |
| **D** | **Keep MIT, add an express patent grant as a separate instrument** (e.g. a `PATENTS` notice stating that the owner grants a royalty-free, worldwide, non-exclusive patent licence for the first-party files). | Adds an express grant for Paka's own code while leaving the copyright licence MIT. | The dependency position; and it cannot grant anything the owner does not own (so it does not cover third-party contributions' patents). | The wording and its interaction with MIT are the whole question, and MIT is a *permission* — adding a different permission is a unilateral act that recipients must notice. Needs counsel; do not draft by analogy with Apache-2.0 §3. |
| **E** | **Change the dependency election** to prefer Apache-2.0 for dual-licensed packages (independent of A–D). | Adds express grants for ~455 packages' code, including the Tauri/wry stack. | Paka's own first-party grant (D1 remains open). | A redistribution decision with its own §3 termination consequence for every recipient of the installer; it also increases the notice/attribution work. It is the only lever that reaches the dependency code. |

### 4.1 Interactions the owner should weigh

* **R7 is coupled to R6.** There is no CLA and no DCO, so inbound contributions
  arrive under the repository's default terms and **each contributor keeps
  their own copyright and patent rights**. Relicensing Paka's code later
  (B/C) would require those contributors' permission. **Deciding the licence
  before the first external contribution is materially cheaper than deciding it
  after.** Today the repository's authorship is the owner plus the agents'
  commits — that should be confirmed (§6, Q3).
* **Apache-2.0 §3's termination clause** cuts both ways: it protects the
  project from a patent-litigating recipient, and it removes that recipient's
  grant. It is the standard reason some projects prefer plain MIT or
  BSD-with-patent (an express, non-terminating grant) instead.
* **The MPL-2.0 crates** (17 packages, statically linked) already carry their
  own narrow patent grant and file-level copyleft. Nothing in R6 changes that;
  but it shows the binary already contains third-party code with its own
  patent terms.
* **The copied skills** (85 files) are unaffected by any of A–E.
* **Counterfactual risk:** the biggest *practical* exposure is not that Paka
  lacks a grant, but that a third party asserts a patent against a drawing
  app that has no express patent licence from its own contributors. Whether
  MIT's silence creates any such exposure is Q1/Q6.

---

## 5. Options that need facts I could not verify

### 5.1 Does the owner hold every copyright it would relicense?

*Evidence:* the repository's 56 commits are authored under **two names, one
identity**: `HumanHEART <145858710+aissaadib@users.noreply.github.com>` (1
commit, the initial one) and `aissaadib <145858710+aissaadib@users.noreply.github.com>`
(55 commits) — the same noreply address, i.e. the same GitHub identity, so the
tree shows **no third-party authorship** in the history. The licence names
HumanHEART; the bundle copyright is "Copyright (c) 2026 HumanHEART".

*What that leaves open:* the tree cannot show whether the owner is an
individual or an entity, whether any work was made in the course of employment
or under a contractor agreement whose terms assign or reserve patent rights,
or whether a future contributor will differ. Those are the facts Q3 must be
answered against.

### 5.2 Which packages would actually carry a grant under each election?

The table in §2.2 is computed from the *declared* licence strings in
`licenses/dependency-inventory.json`. A package declared "MIT OR Apache-2.0"
is taken under MIT today; electing Apache-2.0 for it is a distribution-level
decision that the inventory cannot validate. Q4.

---

## 6. Questions that require qualified legal advice

| # | Question |
| --- | --- |
| **Q1** | Under the law of the relevant jurisdictions (US, EU, JP), does the MIT permission, or the combination of MIT terms plus the copyright holder's conduct, confer an implied patent licence? What is the residual exposure if it does not? |
| **Q2** | Can the owner grant an express patent licence for its own code while retaining MIT as the copyright licence, and what wording would make that unambiguous for recipients (Option D)? |
| **Q3** | What must the owner confirm (identity of the copyright holder, assignment of patent rights by any employee/contractor) before relicensing the first-party files under Apache-2.0, and what is required of any future external contributor? The tree shows a single GitHub identity across all 56 commits (§5.1), so the open part is contractual, not historical. |
| **Q4** | What are the consequences of electing Apache-2.0 over MIT for the ~455 dual-licensed packages at distribution time, and does §3's termination clause then operate against recipients of the Paka installer? |
| **Q5** | Do the MPL-2.0 crates' §2.1(b) grants and the Apache-2.0-only crates' §3 grants need to be surfaced to recipients in Paka's notices for the grants to be effective, or is inclusion of the licence texts sufficient? |
| **Q6** | What is the realistic patent-assertion exposure for a raster drawing application distributed under MIT without an express grant, and does adding one change that exposure or only its documentation? |
| **Q7** | Is the defensive-termination clause acceptable to the owner and to the community Paka intends to attract, or is a non-terminating express grant (Option D) preferable? |
| **Q8** | Should the decision be recorded in a dedicated file (`PATENTS`, `NOTICE`, or a `CONTRIBUTING`-style clause), and how should `scripts/generate-third-party-notices.mjs` and `licenses/dependency-inventory.json` represent it? |
| **Q9** | Do any sectoral, geographic or contractual constraints apply to the owner (the reuse gate already records that it did **not** assess export control, privacy of user content or patentability — `docs/g1/reuse-decision.md:572`)? |

---

## 7. Proposed decision record (for the owner; nothing is decided here)

```
R6 — patent-grant position            status: OPEN (owner decision)
├── D1  first-party grant             options: A (stay MIT) | B (Apache-2.0)
│                                     | C (MIT OR Apache-2.0) | D (MIT + separate grant)
├── D2  dependency election           options: keep MIT (current) | prefer Apache-2.0
│                                     [independent of D1 — see §2.4]
├── D3  governance prerequisite      CLA/DCO before external contributions?
│                                     [determines how hard D1/D2 are later — §4.1]
├── evidence used    LICENSE:1-21; docs/RELEASE-READINESS.md:18,178-187;
│                    docs/g1/reuse-decision.md:67,453-464;
│                    docs/g1/provenance-record.json:45,121,649,838,865;
│                    THIRD_PARTY_NOTICES.md:18-28; licenses/dependency-inventory.json;
│                    licenses/Apache-2.0.txt:74-88; licenses/MPL-2.0.txt:100-102;
│                    docs/CLEAN-ROOM-ATTESTATION.md:17
├── primary sources  MIT (OSI/SPDX) · Apache-2.0 §3 · MPL-2.0 §2.1(b) · GPLv3 §11
│                    · Wang Labs. v. Mitsubishi, 103 F.3d 1571 (Fed. Cir. 1997)
│                    · DePuy Spine v. Medtronic, 469 F.3d 1005 (Fed. Cir. 2006)
│                    · OSI, "Patents and Open Source" (Dec 2025) · JHU OSPO
├── legal review     required before D1/D2/D4 (see Q1-Q5)
├── what "closed" means  a recorded owner decision + the licence/notice text
│                       updated to match it + Q1-Q5 answered by counsel
└── blocks            nothing (docs/RELEASE-READINESS.md:18)
```

**Suggested sequencing** (a proposal, not a decision): answer Q1 first, because
its answer changes the value of D1 relative to D2; settle D3 before accepting
any external contribution; and re-run the inventory generator if D2 changes,
so the notices and the election stay in one place.

---

## 8. Limits of this analysis

* It is **not legal advice** and states no conclusion on whether MIT confers a
  patent licence in any jurisdiction.
* It does **not** assess patentability, validity, freedom to operate, or any
  third party's patent portfolio; no patent search was performed.
* It does **not** decide R6, does not modify `LICENSE`, the notices, the
  provenance records or any policy file, and **does not** mark R6 resolved.
* Counts in §2.2 are derived from the declared licence strings in
  `licenses/dependency-inventory.json` (506 packages as of the 2026-10-20
  regeneration); they are not a legal classification of any package's terms.
* The implied-grant question is described as contested because the sources
  above describe it as contested, not because this analysis has weighed the
  case law.
