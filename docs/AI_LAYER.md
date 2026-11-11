# The EthAum AI layer — design

> The engine that makes EthAum's coordination work. It organises, flags, ranks, audits and
> drafts. **It never diagnoses and never prescribes.**

## 1. Why an engine at all

A marketplace's hardest problem is not listing hospitals — it is *context*. A patient arrives with
fourteen documents, a condition, a budget, a language preference and a deadline. What they need is
not "hospitals near you"; they need someone to read the pile, say what is missing, and rank the
options against what they actually said matters.

Most platforms solve this with a human on a phone. That does not scale past the first hundred
patients, and it cannot be shown to a judge on a screen. So the coordination work became an
**engine** — with an LLM where language quality matters and **rules where safety matters**.

## 2. Architecture

```
POST /api/ai  { task, payload }
      │
      ├─ validate task (5 allowed)                    → 400 on anything else
      │
      ├─ LLM path:  Gemini → OpenRouter
      │      • guardrails injected as a system instruction
      │      • output parsed defensively (fenced blocks, partial JSON salvage)
      │      • on parse failure → fall through to rules
      │
      └─ rules path (always available)
             • deterministic, offline, identical output shape
             • owns every safety-critical number

response: { source: "llm" | "rules", model?, output, note }
```

**Contract stability matters more than elegance:** both paths must return the same JSON shape, so
the UI never branches on implementation. The UI *does* display `source`, because a system that
claims to be AI-assisted should be willing to say whether a model was involved this time.

## 3. The five tasks in detail

### `classify` — document organisation
**Input:** filenames + extracted text. **Output:** `{ name, kind, confidence, note }`.

Rules map filename patterns to Lab / Imaging / Prescription / Discharge, with **Unknown** when the
name is ambiguous. Unknown is a first-class answer: mis-classifying a discharge summary as a lab
report is worse than saying "ask a human". The clinical desk verifies before a hospital sees it.

### `qualify` — pre-screen and readiness
**Input:** five pre-screen answers + case context. **Output:** `{ readiness, verdict, flags, explain }`.

Readiness is **computed in the rules engine** — 100 minus weights (chest pain at rest 25, the rest
10 each). Bands: ≥85 clear for surgeon review · ≥60 proceed with optimisation first · <60 pause.
The model may only write the `explain` prose.

> This task can tell a patient **not to travel yet**. That is the point: a marketplace that can only
> say yes is a lead broker.

### `match` — provider matching
**Input:** case + partner hospitals. **Output:** ranked providers with score parts and watch-outs.

Published weights: clinical fit 35 · accreditation 15 · budget fit 20 · wait time 15 · language 10
· reviews 5 — **re-weighted by the patient's own sliders** (cost / outcomes / speed), which is the
difference between a marketplace and a directory.

Two rules the engine enforces:
1. **No commercial inputs.** Referral fees are identical across partners and never enter the score.
2. **Every match carries a downside.** A provider that only lists its advantages is a brochure.

### `quote-audit` — quote comparison
**Input:** competing quotes. **Output:** `{ flags[], median }`.

Flags quotes priced >8% below the peer median, quotes missing an ICU cap, and quotes where
implant brands aren't disclosed. It **flags, never rewrites**: the patient still chooses, and the
hospital still sets its own price.

### `reminder` — aftercare reminders
**Input:** recovery plan. **Output:** `{ when, title, channel, tone }`.

One action per message, no jargon, no alarm, no clinical instruction. Meds and appointments get
WhatsApp + SMS; physio and reviews get in-app + WhatsApp.

## 4. Guardrails

Enforced in the prompt, then re-checked in code:

1. Never diagnose, prescribe, or say a procedure is/isn't needed.
2. Never rank by commercial relationship.
3. Be honest about gaps; "this may not be worth travelling for" is a valid answer.
4. Plain, warm, specific. No hype, no fear-marketing.
5. Always defer the clinical decision to an accredited clinician.

The rules engine is the backstop: if the model says something the app cannot verify, the app uses
the rules output instead.

## 5. What we deliberately did not build

- **No "symptom checker".** Diagnosis is a regulated activity and a terrible place to demo a
  language model.
- **No automated eligibility decisions.** The screen may recommend optimisation; a clinician
  decides.
- **No scraped PII.** The engine sees only what the patient uploads for their own case.
- **No medical image analysis claims.** We classify documents; we do not read an angiogram.

## 6. Where this goes next

1. **DICOM/PACS ingest** — pull reports from hospital systems rather than asking patients to
   upload PDFs, with a human-in-the-loop classifier for anything below confidence 0.8.
2. **Outcome-adjusted matching** — rank by per-surgeon outcomes adjusted for case complexity, with
   the methodology published.
3. **Local-language fluency** — the same engine in Hindi, Tamil and Telugu with idiomatic phrasing,
   not translation.
4. **A published evaluation harness** — see `docs/EVALS.md`.
