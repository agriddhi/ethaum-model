# EthAum Model — the AI coordination engine

This repository holds the **EthAum AI layer**: the part of the marketplace that organises
paperwork, flags gaps, scores readiness, ranks providers, audits quotes and drafts reminders —
and **nothing else**. It never diagnoses, never prescribes and never chooses a provider for a
commission.

> The product that uses this engine is **[EthAum](https://github.com/agriddhi/ethaum)** — the
> patient-first international healthcare marketplace (Next.js 16 · React 19 · Tailwind v4 · strict
> TypeScript). This repo is the engine, so it can be reviewed, forked and tested on its own.

---

## What lives here

| Path | What it is |
|---|---|
| `src/lib/ai.ts` | The engine: five tasks, LLM support with a deterministic rules fallback, defensive JSON parsing, hard guardrails in the prompt |
| `src/app/api/ai/route.ts` | One POST endpoint (`/api/ai`) — the contract the app calls |
| `src/ai/tasks.ts` | Task contracts + the reference request/response shapes |
| `docs/AI_LAYER.md` | Full design: the five tasks, the weights, the guardrails, the safety model |
| `docs/EVALS.md` | How we measure it: golden cases, red-flag cases, and the rule-vs-LLM comparison protocol |
| `.env.local.example` | Optional keys (`GEMINI_API_KEY` / `OPENROUTER_API_KEY`) — the engine works without them |

## The five tasks

| Task | Input | Output | Safety rule |
|---|---|---|---|
| `classify` | filenames + extracted text | `kind` (Lab / Imaging / Prescription / Discharge / Unknown), confidence, note | Unknown when unsure — never guess a clinical document type |
| `qualify` | five pre-screen answers | readiness 0–100, verdict, flags, plain-English explanation | May output **"pause — optimise before surgery"**; never approves a procedure |
| `match` | case + partner hospitals | ranked hospitals with score components and watch-outs | Ranking inputs exclude commercial terms; commission is identical across partners |
| `quote-audit` | competing quotes | per-quote flags (under-scoped, price deviation, missing caps) | Flags only; never rewrites or approves a price |
| `reminder` | recovery plan | patient-level reminders with channel + tone | One action per message; no alarm, no clinical instruction |

## Guardrails (enforced in the prompt, not just documented)

1. Never diagnose, never prescribe, never tell a patient a procedure is needed or not needed.
2. Never rank a hospital because of a commercial relationship — rank only on clinical fit,
   accreditation, price, wait time, language and reviews.
3. Be honest about what is missing; if the honest answer is "this may not be worth travelling
   for", say it.
4. Plain, warm, specific language. No hype, no fear-marketing.
5. Always defer the clinical decision to an accredited clinician.

## Design: LLM-assisted, rules-guaranteed

```
request → validate task → try Gemini → try OpenRouter → parse & validate JSON
        → any failure → deterministic rules engine → identical output shape
```

- **Safety-critical numbers come from the rules engine**, never the model: readiness scoring,
  price-deviation thresholds, match weights.
- **The model writes prose and sorts evidence** — the parts where language quality matters.
- **Every response carries `source: "llm" | "rules"`**, and the UI shows it to the user. Nothing
  pretends to be smarter than it is.
- **The demo never depends on a network call.** With no key configured, the same endpoints answer
  deterministically — which is why the product works on stage with dead wifi.

## Run it standalone

```bash
npm install
npm run dev
curl -s -X POST http://localhost:3000/api/ai \
  -H "content-type: application/json" \
  -d '{"task":"qualify","payload":{"answers":[false,false,false,true,false]}}'
```

Enable the live path (optional):

```bash
cp .env.local.example .env.local
# add GEMINI_API_KEY=...   (or OPENROUTER_API_KEY=...)
```

## Use it from EthAum

The engine is imported by the marketplace through the same endpoint:

```ts
const res = await fetch("/api/ai", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ task: "qualify", payload: { answers, treatment, budget, condition } }),
});
const { source, output, note } = await res.json();
```

Built by **kairo-aeon-tech** — https://www.linkedin.com/in/agriddhi/
