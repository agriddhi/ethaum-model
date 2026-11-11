/* EthAum AI coordination engine.
   Every task has a deterministic fallback so the product never breaks when a
   key is missing, offline, or rate-limited. The model writes prose and sorts
   evidence — it never diagnoses, never prescribes and never chooses a
   provider by commission. Doctors and patients keep the final say. */

export type AiTask = "classify" | "qualify" | "match" | "quote-audit" | "reminder";

export type AiResult<T = unknown> = {
  source: "llm" | "rules";
  model?: string;
  output: T;
  note: string;
};

const TIMEOUT_MS = 9000;

const GUARDRAIL = `You are EthAum's coordination assistant for international healthcare.
Rules you never break:
- Never diagnose, never prescribe, never tell a patient a procedure is or isn't needed.
- Never recommend a hospital because of a commercial relationship; rank only on clinical fit, accreditation, price, wait time, language and reviews.
- Be honest: if something is missing, say what is missing. If the honest answer is "this may not be worth travelling for", say it.
- Keep language plain, warm and specific. No hype, no fear-marketing, no "miracle cure" framing.
- Always finish by making clear a licensed doctor decides the clinical part.`;

type Payload = Record<string, unknown>;

async function callGemini(prompt: string): Promise<{ text: string; model: string } | null> {
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!key) return null;
  const model = process.env.ETHAUM_MODEL || "gemini-2.0-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: GUARDRAIL }] },
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 700 },
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const data = await res.json();
    const text = (data?.candidates?.[0]?.content?.parts ?? []).map((p: { text?: string }) => p.text ?? "").join("").trim();
    return text ? { text, model } : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function callOpenRouter(prompt: string): Promise<{ text: string; model: string } | null> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return null;
  const model = process.env.ETHAUM_MODEL || "google/gemini-2.0-flash-001";
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        temperature: 0.3,
        max_tokens: 700,
        messages: [
          { role: "system", content: GUARDRAIL },
          { role: "user", content: prompt },
        ],
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content?.trim();
    return text ? { text, model } : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function callLlm(prompt: string): Promise<{ text: string; model: string } | null> {
  return (await callGemini(prompt)) ?? (await callOpenRouter(prompt));
}

/* ─────────────── deterministic fallbacks ─────────────── */

const KIND_RULES: Array<[RegExp, string]> = [
  [/angio|ct|mri|x-?ray|scan|ecg|echo|pet|opg|dicom/i, "Imaging"],
  [/discharge|summary|op note|operative|disch/i, "Discharge"],
  [/rx|med|prescrip|tablet|insulin|metformin/i, "Prescription"],
  [/lab|panel|lipid|creatinine|hb[a-z0-9]*|a1c|cbc|urine|blood/i, "Lab"],
];

function rulesClassify(payload: Payload) {
  const files = (payload.files as Array<{ name: string }>) ?? [];
  return files.map((f) => {
    const kind = KIND_RULES.find(([re]) => re.test(f.name))?.[1] ?? "Unknown";
    return {
      name: f.name,
      kind,
      confidence: kind === "Unknown" ? 0.4 : 0.9,
      note:
        kind === "Unknown"
          ? "Filename unreadable — EthAum's clinical desk will classify it manually."
          : `Auto-grouped under ${kind.toLowerCase()}; a coordinator verifies before a hospital sees it.`,
    };
  });
}

function rulesQualify(payload: Payload) {
  const answers = (payload.answers as Array<boolean | undefined>) ?? [];
  const weights = [25, 10, 10, 10, 10];
  const risk = answers.reduce((sum, a, i) => sum + (a ? (weights[i] ?? 10) : 0), 0);
  const readiness = Math.max(0, 100 - risk);
  const flags: string[] = [];
  if (answers[0]) flags.push("Chest pain at rest — needs urgent cardiologist input, not a booking.");
  if (answers[1]) flags.push("Breathlessness on stairs — bring a cardiology clearance letter before flying.");
  if (answers[2]) flags.push("Diabetes appears uncontrolled — optimise HbA1c before surgery (usually 4–6 weeks).");
  if (answers[3]) flags.push("On blood thinners — plan stop/start dates with your cardiologist and the surgeon.");
  if (answers[4]) flags.push("Higher BMI — imaging, anaesthesia and recovery plan may need adjusting.");
  const verdict =
    readiness >= 85
      ? "Clear for surgeon review"
      : readiness >= 60
        ? "Proceed with optimisation first"
        : "Pause — optimise before surgery";
  const explain =
    readiness >= 85
      ? "Nothing on this short screen changes your plan. Two partner surgeons review your file within 31 hours and quote you; nothing is booked until you sign."
      : readiness >= 60
        ? "This is not a rejection. A few weeks of preparation (HbA1c, blood pressure, weight, smoking) measurably lowers operative risk — and EthAum can hold your quote slot while you do it."
        : "We would rather not send you for surgery on this information. Your coordinator will call a cardiologist, get a written view, and come back with a plan — travel only if it is genuinely safer.";
  return { readiness, verdict, flags, explain };
}

function rulesMatch(payload: Payload) {
  const hospitals = (payload.hospitals as Array<Record<string, unknown>>) ?? [];
  const specialty = String(payload.specialty ?? "");
  const budget = Number(payload.budget ?? 0);
  const language = String(payload.language ?? "English");
  return hospitals
    .map((h) => {
      const specialties = (h.specialties as string[]) ?? [];
      const clinicalFit = specialties.includes(specialty) ? 35 : 15;
      const accreditation = ((h.accreditations as string[]) ?? []).includes("JCI") ? 15 : 10;
      const languages = (h.languages as string[]) ?? [];
      const languageScore = languages.includes(language) ? 10 : 4;
      const reviewScore = Math.round((((h.rating as number) ?? 4) - 4) * 25);
      const price = Number(h.allIn ?? 0);
      const budgetFit = budget && price ? (price <= budget ? 20 : Math.max(0, 20 - Math.round(((price - budget) / budget) * 40))) : 10;
      const wait = Number(h.waitDays ?? 10);
      const waitScore = Math.max(0, 15 - Math.max(0, wait - 5));
      const total = Math.min(99, clinicalFit + accreditation + budgetFit + waitScore + languageScore + reviewScore);
      return {
        slug: h.slug,
        name: h.name,
        score: total,
        parts: { clinicalFit, accreditation, budgetFit, waitScore, languageScore, reviewScore },
      };
    })
    .sort((a, b) => b.score - a.score);
}

function rulesQuoteAudit(payload: Payload) {
  const quotes = (payload.quotes as Array<{ hospital: string; total: number; nights?: number }>) ?? [];
  if (!quotes.length) return { flags: [], median: 0 };
  const totals = quotes.map((q) => q.total).sort((a, b) => a - b);
  const median = totals[Math.floor(totals.length / 2)];
  const flags = quotes.flatMap((q) => {
    const out: Array<{ severity: "info" | "warn" | "pass"; quote: string; text: string }> = [];
    const deviation = median ? ((median - q.total) / median) * 100 : 0;
    if (deviation >= 8)
      out.push({ severity: "warn", quote: q.hospital, text: `Priced ${deviation.toFixed(0)}% below the median — get implant brand, ICU cap and graft type confirmed in writing before you fly.` });
    else out.push({ severity: "pass", quote: q.hospital, text: `Within ${Math.abs(deviation).toFixed(0)}% of the peer median — no pricing red flag.` });
    return out;
  });
  return { flags, median };
}

function rulesReminder(payload: Payload) {
  const plan = (payload.plan as Array<{ day: string; title: string; items: string[] }>) ?? [];
  return plan.flatMap((p) =>
    p.items.map((item) => ({
      when: p.day,
      title: item,
      channel: /med|tablet|clopidogrel|aspirin|insulin/i.test(item) ? "WhatsApp + SMS" : "App + WhatsApp",
      tone: "plain, warm, one action per message",
    }))
  );
}

/* ─────────────── prompt builders + dispatch ─────────────── */

function buildPrompt(task: AiTask, payload: Payload): string {
  const json = JSON.stringify(payload, null, 2).slice(0, 4000);
  switch (task) {
    case "classify":
      return `Classify each uploaded medical document for an international-care case. Return ONLY JSON array: [{"name":string,"kind":"Lab|Imaging|Prescription|Discharge|Unknown","confidence":number,"note":string}]. Be conservative — if the filename is ambiguous say Unknown. Files:\n${json}`;
    case "qualify":
      return `A patient answered five pre-screening questions (true = yes). Return ONLY JSON: {"readiness":number 0-100,"verdict":string,"flags":string[],"explain":string}. "explain" is 2-3 plain sentences addressed to the patient. Answers: ${json}`;
    case "match":
      return `Rank these partner hospitals for the case described. Return ONLY JSON array: [{"slug":string,"name":string,"score":number,"why":string[] (3 short bullets, each citing a specific attribute),"watch":string[] (honest downsides, may be empty)}].\nCase: ${json}`;
    case "quote-audit":
      return `Audit these competing quotes for a patient. Return ONLY JSON: {"flags":[{"quote":string,"severity":"pass|warn","text":string}],"verdict":string}. Flag under-scoped quotes (missing implants, ICU caps, companion, follow-ups), not just low prices. Quotes: ${json}`;
    case "reminder":
      return `Turn this recovery plan into patient reminders. Return ONLY JSON array: [{"when":string,"title":string,"channel":string,"tone":string}] — one action per message, no jargon, no alarm. Plan: ${json}`;
  }
}

function parseJsonLoose(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.search(/[[{]/);
  if (start === -1) return null;
  const slice = candidate.slice(start);
  try {
    return JSON.parse(slice);
  } catch {
    const end = slice.lastIndexOf("]") > slice.lastIndexOf("}") ? slice.lastIndexOf("]") : slice.lastIndexOf("}");
    try {
      return JSON.parse(slice.slice(0, end + 1));
    } catch {
      return null;
    }
  }
}

export async function runAi<T = unknown>(task: AiTask, payload: Payload): Promise<AiResult<T>> {
  const rules = () => {
    switch (task) {
      case "classify":
        return { output: rulesClassify(payload) as T, note: "Deterministic classifier (no API key configured)." };
      case "qualify":
        return { output: rulesQualify(payload) as T, note: "Deterministic pre-screen (no API key configured)." };
      case "match":
        return { output: rulesMatch(payload) as T, note: "Weighted rule engine (no API key configured)." };
      case "quote-audit":
        return { output: rulesQuoteAudit(payload) as T, note: "Deterministic audit (no API key configured)." };
      case "reminder":
        return { output: rulesReminder(payload) as T, note: "Deterministic reminder builder (no API key configured)." };
    }
  };

  const llm = await callLlm(buildPrompt(task, payload));
  if (llm) {
    const parsed = parseJsonLoose(llm.text);
    if (parsed) return { source: "llm", model: llm.model, output: parsed as T, note: "LLM-assisted — clinical desk verifies before anything is shown to a patient." };
  }
  const r = rules();
  return { source: "rules", output: r.output, note: r.note };
}
