import { runAi, type AiTask } from "@/lib/ai";

const TASKS: AiTask[] = ["classify", "qualify", "match", "quote-audit", "reminder"];

export async function POST(request: Request) {
  let body: { task?: string; payload?: Record<string, unknown> };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Expected a JSON body: { task, payload }" }, { status: 400 });
  }

  const task = body.task as AiTask | undefined;
  if (!task || !TASKS.includes(task)) {
    return Response.json({ error: `Unknown task. Allowed: ${TASKS.join(", ")}` }, { status: 400 });
  }

  const result = await runAi(task, body.payload ?? {});
  return Response.json(result, {
    headers: { "cache-control": "no-store" },
  });
}
