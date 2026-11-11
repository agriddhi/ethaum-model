/* EthAum AI layer - task contracts.
   These are the shapes the marketplace depends on. Both the rules engine and the
   LLM path return exactly these shapes, so the UI never branches on which
   engine answered (it only displays it). */

export type AiTask = "classify" | "qualify" | "match" | "quote-audit" | "reminder";

export type ClassifyResult = {
  name: string;
  kind: "Lab" | "Imaging" | "Prescription" | "Discharge" | "Unknown";
  confidence: number;
  note: string;
};

export type QualifyResult = {
  readiness: number; // 0-100, computed by the rules engine
  verdict: string;
  flags: string[];
  explain: string; // patient-facing prose
};

export type MatchResult = {
  slug: string;
  name: string;
  score: number;
  parts: {
    clinicalFit: number;
    accreditation: number;
    budgetFit: number;
    waitScore: number;
    languageScore: number;
    reviewScore: number;
  };
  why?: string[];
  watch?: string[];
};

export type QuoteAuditResult = {
  flags: Array<{ quote: string; severity: "pass" | "warn"; text: string }>;
  median: number;
  verdict?: string;
};

export type ReminderResult = {
  when: string;
  title: string;
  channel: string;
  tone: string;
};

export type AiEnvelope<T> = {
  source: "llm" | "rules";
  model?: string;
  output: T;
  note: string;
};

/** Task -> payload -> output contract, with an example payload for each task. */
export const TASK_CONTRACTS: Record<AiTask, { payload: unknown; output: string }> = {
  classify: {
    payload: { files: [{ name: "angiogram_oct.pdf" }, { name: "lipid_panel.pdf" }], text: "" },
    output: "ClassifyResult[]",
  },
  qualify: {
    payload: { answers: [false, false, false, true, false], treatment: "cardiac-cabg", budget: 12 },
    output: "QualifyResult",
  },
  match: {
    payload: {
      specialty: "Cardiac",
      budget: 1200000,
      language: "Hindi",
      hospitals: [],
    },
    output: "MatchResult[]",
  },
  "quote-audit": {
    payload: { quotes: [{ hospital: "Bumrungrad Intl", total: 1080000, nights: 8 }] },
    output: "QuoteAuditResult",
  },
  reminder: {
    payload: { plan: [{ day: "Day 7", title: "Day-7 check-in", items: ["Wound check"] }] },
    output: "ReminderResult[]",
  },
};

/** Hard invariants the platform relies on. Enforced in code, asserted in tests. */
export const AI_INVARIANTS = [
  "Output shape is identical whether the answer came from the LLM or the rules engine.",
  "Readiness score, match weights and price thresholds are computed by rules, never by the model.",
  "source is always reported so the UI can be honest about which engine answered.",
  "The engine may recommend pausing a journey; it may never approve a clinical decision.",
  "Ranking inputs never include commercial terms.",
] as const;
