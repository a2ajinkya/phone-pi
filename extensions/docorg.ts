import { complete, type UserMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

type Proposal = {
  dossier_id: number;
  suggested_name: string;
  confidence: number;
  category: string;
  notes?: string;
  current_name?: string;
};

type ReviewDecision = "undecided" | "approve" | "reject";

function shQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function toNumber(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function uniqueNumbers(values: number[]): number[] {
  return Array.from(new Set(values.filter((v) => Number.isFinite(v))));
}

const DOCORG_DIR = "$HOME/storage/code/docorg";
const NAMER_PROVIDER = "openrouter";
const NAMER_MODEL = "deepseek/deepseek-v4-flash";
const NAMER_TIMEOUT_MS = 90000;
const HIGH_CONFIDENCE_THRESHOLD = 0.85;

type UpdateTone = "info" | "success" | "warning" | "error";

// In-memory log of updates; rendered as a single widget instead of multiple sendMessage cards
let updateLog: Array<{ icon: string; title: string; lines: string[]; tone: UpdateTone }> = [];

// Widget UI reference — set once when an /organize command starts
type WidgetUI = { setWidget: (id: string, lines: string[] | undefined) => void };
let widgetUI: WidgetUI | null = null;

function postDocorgUpdate(title: string, lines: string[] = [], tone: UpdateTone = "info") {
  const icon = tone === "success" ? "✅" : tone === "warning" ? "⚠️" : tone === "error" ? "❌" : "ℹ️";
  updateLog.push({ icon, title, lines, tone });
  // Keep only last 20 entries to avoid unbounded growth
  if (updateLog.length > 20) updateLog = updateLog.slice(-20);
  renderDocorgWidget();
}

type ProgressStep = "queue" | "generate" | "import" | "review" | "decide" | "apply" | "done";
type ProgressStatus = "pending" | "active" | "done" | "skipped" | "error";
type SubStepStatus = "pending" | "running" | "done" | "skipped" | "error";

type ProgressSubStep = {
  id: string;
  label: string;
  status: SubStepStatus;
  detail?: string;
};

type ProgressStepState = {
  status: ProgressStatus;
  detail?: string;
  subSteps: ProgressSubStep[];
  expanded: boolean;
};

type ProgressTracker = {
  set: (step: ProgressStep, status: ProgressStatus, detail?: string) => void;
  registerSubSteps: (step: ProgressStep, defs: Array<{ id: string; label: string }>) => void;
  setSub: (step: ProgressStep, subId: string, status: SubStepStatus, detail?: string) => void;
};

// Shared widget state — updated in place via setWidget instead of sendMessage
let widgetRequestedCount = 0;
let progressState = new Map<ProgressStep, ProgressStepState>();

function renderDocorgWidget() {
  if (!widgetUI) return;

  const labels: Record<ProgressStep, string> = {
    queue: "Queue batch",
    generate: "Generate proposals",
    import: "Import proposals",
    review: "Review low confidence",
    decide: "Apply approvals/rejections",
    apply: "Apply filesystem renames",
    done: "Complete",
  };
  const order: ProgressStep[] = ["queue", "generate", "import", "review", "decide", "apply", "done"];

  const statusIcon = (status: ProgressStatus): string => {
    if (status === "done") return "✅";
    if (status === "active") return "⏳";
    if (status === "error") return "❌";
    if (status === "skipped") return "⏭️";
    return "▫️";
  };

  const subStatusIcon = (status: SubStepStatus): string => {
    if (status === "done") return "✅";
    if (status === "running") return "⏳";
    if (status === "error") return "❌";
    if (status === "skipped") return "⏭️";
    return "▫️";
  };

  const lines: string[] = [];

  // Progress section
  lines.push(`🗂️ Docorg Progress — Requested: ${widgetRequestedCount} dossier(s)`);
  lines.push("─".repeat(40));
  for (const step of order) {
    const s =
      progressState.get(step) ||
      ({ status: "pending", subSteps: [], expanded: false } as ProgressStepState);
    const detail = s.detail ? ` — ${s.detail}` : "";
    lines.push(`${statusIcon(s.status)} ${labels[step]}${detail}`);

    if (s.status === "active" && s.expanded && s.subSteps.length) {
      for (const sub of s.subSteps) {
        const subDetail = sub.detail ? ` — ${sub.detail}` : "";
        lines.push(`  ${subStatusIcon(sub.status)} ${sub.label}${subDetail}`);
      }
    }
  }

  // Recent updates section
  if (updateLog.length) {
    lines.push("");
    lines.push("Recent updates:");
    const recent = updateLog.slice(-6);
    for (const u of recent) {
      lines.push(`${u.icon} ${u.title}`);
      for (const l of u.lines) lines.push(`  · ${l}`);
    }
  }

  widgetUI.setWidget("docorg-progress", lines);
}

function clearDocorgWidget() {
  if (widgetUI) widgetUI.setWidget("docorg-progress", undefined);
  updateLog = [];
  progressState = new Map();
  widgetUI = null;
}

function createProgressTracker(ui: WidgetUI, requestedCount: number): ProgressTracker {
  const order: ProgressStep[] = ["queue", "generate", "import", "review", "decide", "apply", "done"];

  widgetUI = ui;
  widgetRequestedCount = requestedCount;
  progressState = new Map();
  updateLog = [];
  for (const step of order) progressState.set(step, { status: "pending", subSteps: [], expanded: false });

  renderDocorgWidget();

  return {
    set(step: ProgressStep, status: ProgressStatus, detail?: string) {
      const current = progressState.get(step) || { status: "pending", subSteps: [], expanded: false };
      const subSteps = current.subSteps.map((sub) => {
        if (status === "done" && sub.status === "running") return { ...sub, status: "done" as SubStepStatus };
        if (status === "error" && sub.status === "running") return { ...sub, status: "error" as SubStepStatus };
        if (status === "skipped" && (sub.status === "running" || sub.status === "pending")) return { ...sub, status: "skipped" as SubStepStatus };
        return sub;
      });
      const expanded = status === "active";
      progressState.set(step, { ...current, status, detail, subSteps, expanded });
      renderDocorgWidget();
    },

    registerSubSteps(step: ProgressStep, defs: Array<{ id: string; label: string }>) {
      const current = progressState.get(step) || { status: "pending", subSteps: [], expanded: false };
      const subSteps: ProgressSubStep[] = defs.map((d) => ({ id: d.id, label: d.label, status: "pending" }));
      progressState.set(step, { ...current, subSteps, expanded: current.status === "active" });
      renderDocorgWidget();
    },

    setSub(step: ProgressStep, subId: string, status: SubStepStatus, detail?: string) {
      const current = progressState.get(step);
      if (!current) return;
      const idx = current.subSteps.findIndex((s) => s.id === subId);
      if (idx < 0) return;
      const subSteps = current.subSteps.slice();
      subSteps[idx] = { ...subSteps[idx], status, detail };
      progressState.set(step, { ...current, subSteps });
      renderDocorgWidget();
    },
  };
}

type DossierInput = {
  dossier_id: number;
  current_name?: string;
  pages?: number;
  file_type?: string;
  title_from_meta?: string;
  author_from_meta?: string;
  year_guess?: string;
  extracted_text?: string;
};

function extractTextContent(content: Array<{ type: string; text?: string }>): string {
  return content
    .filter((c): c is { type: "text"; text: string } => c.type === "text" && typeof c.text === "string")
    .map((c) => c.text)
    .join("\n")
    .trim();
}

function sanitizeProposals(raw: unknown, dossiers: DossierInput[]): Proposal[] {
  const dossierIds = new Set(dossiers.map((d) => toNumber(d.dossier_id, -1)));
  const byId = new Map(dossiers.map((d) => [toNumber(d.dossier_id, -1), d]));

  if (!Array.isArray(raw)) return [];

  const normalizeNotes = (value: unknown): string => {
    if (typeof value !== "string") return "";

    const cleaned = value
      .replace(/\u001b\[[0-9;]*m/g, "")
      .replace(/\r\n/g, "\n")
      .split("\n")
      .map((line) => line.replace(/^\s*\|\s?/, ""))
      .join("\n")
      .replace(/^\s*(?:[|•\-]+\s*)?notes?\s*:\s*/i, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    return cleaned;
  };

  const out: Proposal[] = [];
  const seen = new Set<number>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const dossierId = toNumber(row.dossier_id, -1);
    if (!dossierIds.has(dossierId) || seen.has(dossierId)) continue;

    const suggested = String(row.suggested_name || "").trim();
    if (!suggested) continue;

    const category = String(row.category || "uncategorized").trim() || "uncategorized";
    const notes = normalizeNotes(row.notes);
    const currentNameFromInput = typeof row.current_name === "string" ? row.current_name.trim() : "";
    const fallbackCurrent = byId.get(dossierId)?.current_name || "";

    out.push({
      dossier_id: dossierId,
      suggested_name: suggested,
      confidence: Math.max(0, Math.min(1, toNumber(row.confidence, 0.5))),
      category,
      notes: notes || undefined,
      current_name: currentNameFromInput || fallbackCurrent || undefined,
    });
    seen.add(dossierId);
  }

  return out;
}

async function runDocorgPipeline(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  proposals: Proposal[],
  progress?: ProgressTracker
) {
  ctx.ui.setStatus("docorg", "saving proposals and applying renames…");
  progress?.set("import", "active", `Importing ${proposals.length}`);
  progress?.registerSubSteps("import", [
    { id: "import-write-temp", label: "Writing temporary proposal file" },
    { id: "import-doc-name", label: "Importing proposals into database" },
    { id: "import-summarize", label: "Summarizing confidence split" },
  ]);
  progress?.setSub("import", "import-write-temp", "running");
  postDocorgUpdate("Saving proposals", [`Importing ${proposals.length} proposal(s) into database…`], "info");

  if (!proposals.length) {
    progress?.setSub("import", "import-write-temp", "skipped", "no proposals");
    progress?.setSub("import", "import-doc-name", "skipped", "no proposals");
    progress?.setSub("import", "import-summarize", "skipped", "no proposals");
    progress?.set("import", "skipped", "No proposals received");
    ctx.ui.setStatus("docorg", undefined);
    return { content: [{ type: "text", text: "No proposals received." }], details: {} };
  }

  const tmpPath = join(tmpdir(), `docorg-proposals-${Date.now()}.json`);
  await writeFile(tmpPath, JSON.stringify(proposals, null, 2), "utf8");
  progress?.setSub("import", "import-write-temp", "done");
  progress?.setSub("import", "import-doc-name", "running");

  const importResult = await pi.exec(
    "bash",
    ["-lc", `cd \"${DOCORG_DIR}\" && ./bin/doc-name ${shQuote(tmpPath)} 2>&1`],
    { timeout: 30000 }
  );
  if (importResult.code !== 0) {
    progress?.setSub("import", "import-doc-name", "error");
    ctx.ui.setStatus("docorg", undefined);
    throw new Error(`Failed to import proposals: ${importResult.stderr || importResult.stdout}`);
  }
  progress?.setSub("import", "import-doc-name", "done");

  progress?.setSub("import", "import-summarize", "running");
  const high = proposals.filter((p) => toNumber(p.confidence, 0) >= HIGH_CONFIDENCE_THRESHOLD);
  const low = proposals.filter((p) => toNumber(p.confidence, 0) < HIGH_CONFIDENCE_THRESHOLD);
  progress?.setSub("import", "import-summarize", "done");

  progress?.set("import", "done", `${proposals.length} imported`);

  postDocorgUpdate(
    "Proposals imported",
    [
      `High-confidence candidates: ${high.length}`,
      `Low-confidence candidates: ${low.length}`,
      `Threshold: ${HIGH_CONFIDENCE_THRESHOLD}`,
    ],
    "success"
  );

  let approvedLowIds: number[] = [];
  let rejectedLowIds: number[] = [];

  if (low.length) {
    progress?.set("review", "active", `${low.length} to review`);
    progress?.registerSubSteps("review", [
      { id: "review-open-ui", label: "Preparing review panel" },
      { id: "review-wait-user", label: "Waiting for your decisions" },
      { id: "review-record", label: "Recording selected approvals/rejections" },
    ]);
    progress?.setSub("review", "review-open-ui", "running");
    postDocorgUpdate("Manual review required", [`${low.length} low-confidence proposal(s) need your decision.`], "warning");
    progress?.setSub("review", "review-open-ui", "done");
    progress?.setSub("review", "review-wait-user", "running");
    const review = await reviewLowConfidenceTwoPane(low, ctx);
    if (review.cancelled) {
      progress?.setSub("review", "review-wait-user", "error");
      progress?.set("review", "error", "Cancelled by user");
      progress?.set("decide", "skipped", "Review not confirmed");
      progress?.set("apply", "skipped", "Not executed");
      progress?.set("done", "error", "Workflow cancelled");
      postDocorgUpdate("Review cancelled", ["No approvals or renames were applied."], "warning");
      ctx.ui.setStatus("docorg", undefined);
      return {
        content: [
          {
            type: "text",
            text: `Imported proposals: ${proposals.length}\nReview cancelled. No approvals or renames were applied.`,
          },
        ],
        details: { imported: proposals.length, cancelled: true },
      };
    }
    progress?.setSub("review", "review-wait-user", "done");
    progress?.setSub("review", "review-record", "running");
    approvedLowIds = uniqueNumbers(review.approvedIds);
    rejectedLowIds = uniqueNumbers(review.rejectedIds);
    progress?.setSub("review", "review-record", "done");
    progress?.set("review", "done", `Approved ${approvedLowIds.length}, rejected ${rejectedLowIds.length}`);
  } else {
    progress?.set("review", "skipped", "No low-confidence items");
  }

  progress?.set("decide", "active", "Running approval scripts");
  progress?.registerSubSteps("decide", [
    { id: "decide-high", label: "Auto-approving high-confidence items" },
    { id: "decide-low-approve", label: "Applying your low-confidence approvals" },
    { id: "decide-low-reject", label: "Applying your low-confidence rejections" },
  ]);
  progress?.setSub("decide", "decide-high", "running");
  postDocorgUpdate(
    "Applying decisions",
    [
      `Auto-approving high-confidence: ${high.length}`,
      `Approving selected low-confidence: ${approvedLowIds.length}`,
      `Rejecting selected low-confidence: ${rejectedLowIds.length}`,
    ],
    "info"
  );

  const approveHigh = await pi.exec(
    "bash",
    ["-lc", `cd \"${DOCORG_DIR}\" && ./bin/doc-approve-high ${HIGH_CONFIDENCE_THRESHOLD} 2>&1`],
    { timeout: 30000 }
  );

  progress?.setSub("decide", "decide-high", "done");

  let approveLowOut = "No low-confidence approvals selected.";
  if (approvedLowIds.length) {
    progress?.setSub("decide", "decide-low-approve", "running");
    const ids = approvedLowIds.join(" ");
    const approveLow = await pi.exec(
      "bash",
      ["-lc", `cd \"${DOCORG_DIR}\" && ./bin/doc-approve-ids ${ids} 2>&1`],
      { timeout: 30000 }
    );
    approveLowOut = approveLow.stdout || approveLow.stderr || approveLowOut;
    progress?.setSub("decide", "decide-low-approve", "done");
  } else {
    progress?.setSub("decide", "decide-low-approve", "skipped", "none selected");
  }

  let rejectLowOut = "No low-confidence rejections selected.";
  if (rejectedLowIds.length) {
    progress?.setSub("decide", "decide-low-reject", "running");
    const ids = rejectedLowIds.join(" ");
    const rejectLow = await pi.exec(
      "bash",
      ["-lc", `cd \"${DOCORG_DIR}\" && ./bin/doc-reject-ids ${ids} 2>&1`],
      { timeout: 30000 }
    );
    rejectLowOut = rejectLow.stdout || rejectLow.stderr || rejectLowOut;
    progress?.setSub("decide", "decide-low-reject", "done");
  } else {
    progress?.setSub("decide", "decide-low-reject", "skipped", "none selected");
  }

  let applyOut = "Skipped apply (not confirmed).";
  let applyCode: number | null = null;

  progress?.set("decide", "done", `High ${high.length}, low approvals ${approvedLowIds.length}, low rejections ${rejectedLowIds.length}`);

  let shouldApply = true;
  if (ctx.hasUI) {
    shouldApply = await ctx.ui.confirm(
      "Apply approved renames now?",
      `High-confidence auto-approved: ${high.length}\n` +
        `Low-confidence approved: ${approvedLowIds.length}\n` +
        `Low-confidence rejected: ${rejectedLowIds.length}`
    );
  }

  if (shouldApply) {
    progress?.set("apply", "active", "Running doc-apply");
    progress?.registerSubSteps("apply", [
      { id: "apply-run", label: "Executing doc-apply" },
      { id: "apply-verify", label: "Verifying rename result" },
    ]);
    progress?.setSub("apply", "apply-run", "running");
    postDocorgUpdate("Applying filesystem renames", ["Running doc-apply now…"], "info");
    const apply = await pi.exec("bash", ["-lc", `cd \"${DOCORG_DIR}\" && ./bin/doc-apply 2>&1`], { timeout: 60000 });
    progress?.setSub("apply", "apply-run", "done");
    progress?.setSub("apply", "apply-verify", "running");
    applyOut = (apply.stdout || apply.stderr || "(none)").trim();
    applyCode = apply.code;
    if (apply.code === 0) {
      progress?.setSub("apply", "apply-verify", "done");
      progress?.set("apply", "done", "doc-apply succeeded");
    } else {
      progress?.setSub("apply", "apply-verify", "error", `exit code ${apply.code}`);
      progress?.set("apply", "error", `doc-apply exit code ${apply.code}`);
    }
    postDocorgUpdate("Renames applied", ["Approved filenames were applied to filesystem."], "success");
  } else {
    const batchIds = uniqueNumbers(proposals.map((p) => p.dossier_id)).join(",");
    if (batchIds) {
      await pi.exec(
        "bash",
        [
          "-lc",
          `sqlite3 \"${DOCORG_DIR}/docorg.db\" \"UPDATE names SET status='pending', decided_at=NULL WHERE dossier_id IN (${batchIds}) AND status IN ('approved','rejected');\"`,
        ],
        { timeout: 30000 }
      );
    }
    applyOut = "Skipped apply (not confirmed). Reset approvals/rejections for this batch back to pending.";
    progress?.set("apply", "skipped", "User declined apply");
    postDocorgUpdate("Apply skipped", ["Batch decisions were reset to pending."], "warning");
    if (ctx.hasUI) ctx.ui.notify("Apply cancelled. Batch decisions were reset to pending.", "info");
  }

  const summary = [
    `Imported proposals: ${proposals.length}`,
    `High-confidence (>=${HIGH_CONFIDENCE_THRESHOLD}): ${high.length}`,
    `Low-confidence (<${HIGH_CONFIDENCE_THRESHOLD}): ${low.length}`,
    `Approved low-confidence: ${approvedLowIds.length}`,
    `Rejected low-confidence: ${rejectedLowIds.length}`,
    "",
    "Approve-high output:",
    approveHigh.stdout?.trim() || "(none)",
    "",
    "Approve-low output:",
    approveLowOut.trim(),
    "",
    "Reject-low output:",
    rejectLowOut.trim(),
    "",
    "Apply output:",
    applyOut,
  ].join("\n");

  progress?.set("done", applyCode === null || applyCode === 0 ? "done" : "error", applyCode === null ? "Completed without apply" : `Apply code ${applyCode}`);

  postDocorgUpdate(
    "Docorg batch complete",
    [
      `Imported: ${proposals.length}`,
      `Approved low-confidence: ${approvedLowIds.length}`,
      `Rejected low-confidence: ${rejectedLowIds.length}`,
      shouldApply ? "Renames executed." : "Renames not executed.",
    ],
    "success"
  );

  ctx.ui.setStatus("docorg", undefined);
  return {
    content: [{ type: "text", text: summary }],
    details: {
      imported: proposals.length,
      high: high.length,
      low: low.length,
      approvedLowIds,
      rejectedLowIds,
      applyCode,
    },
  };
}

function extractJsonArrayText(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith("```")) {
    const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    if (match?.[1]) return match[1].trim();
  }
  return trimmed;
}

function parseJsonArrayWithRecovery(rawText: string): unknown {
  const base = extractJsonArrayText(rawText);
  const candidates: string[] = [];

  candidates.push(base);

  const firstBracket = base.indexOf("[");
  if (firstBracket >= 0) {
    const fromArrayStart = base.slice(firstBracket);
    candidates.push(fromArrayStart);

    const lastBracket = fromArrayStart.lastIndexOf("]");
    if (lastBracket >= 0) {
      candidates.push(fromArrayStart.slice(0, lastBracket + 1));
    } else {
      const openCurly = (fromArrayStart.match(/\{/g) || []).length;
      const closeCurly = (fromArrayStart.match(/\}/g) || []).length;
      const openSquare = (fromArrayStart.match(/\[/g) || []).length;
      const closeSquare = (fromArrayStart.match(/\]/g) || []).length;
      const missingCurly = Math.max(0, openCurly - closeCurly);
      const missingSquare = Math.max(0, openSquare - closeSquare);
      const repaired = fromArrayStart + "}".repeat(missingCurly) + "]".repeat(missingSquare);
      candidates.push(repaired.replace(/,\s*\]/g, "]").replace(/,\s*\}/g, "}"));
    }
  }

  let lastErr = "";
  for (const c of candidates) {
    try {
      return JSON.parse(c);
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
    }
  }

  throw new Error(lastErr || "Unable to parse JSON array");
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return await Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    }),
  ]);
}

async function generateProposalsWithBuiltInModel(
  ctx: ExtensionCommandContext,
  dossiers: DossierInput[],
  namingRules: string,
  progress?: ProgressTracker
): Promise<Proposal[]> {
  const model = ctx.modelRegistry.find(NAMER_PROVIDER, NAMER_MODEL);
  if (!model) throw new Error(`Model not found: ${NAMER_PROVIDER}/${NAMER_MODEL}`);

  const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
  if (!auth.ok || !auth.apiKey) {
    throw new Error(auth.ok ? `No API key for ${NAMER_PROVIDER}` : auth.error);
  }

  progress?.setSub("generate", "gen-prepare", "running");
  const compact = dossiers.map((d) => ({
    dossier_id: d.dossier_id,
    current_name: d.current_name,
    pages: d.pages,
    file_type: d.file_type,
    title_from_meta: d.title_from_meta,
    author_from_meta: d.author_from_meta,
    year_guess: d.year_guess,
    extracted_text: d.extracted_text?.slice(0, 350) || "(none)",
  }));

  const prompt =
    `You generate filename proposals for document organization.\n` +
    `Return ONLY valid JSON (no markdown) as an array of proposal objects.\n\n` +
    `Each proposal object must include:\n` +
    `- dossier_id (number, must match an input dossier_id)\n` +
    `- suggested_name (string, include extension)\n` +
    `- confidence (number 0..1)\n` +
    `- category (string)\n` +
    `- notes (string, short)\n` +
    `- current_name (string)\n\n` +
    `Rules:\n` +
    `- Output exactly one proposal per dossier_id in input\n` +
    `- Keep original file extension\n` +
    `- Follow naming rules exactly\n` +
    `- Use lower confidence when uncertain\n\n` +
    `NAMING RULES:\n${namingRules}\n\n` +
    `DOSSIERS:\n${JSON.stringify(compact, null, 2)}`;

  const message: UserMessage = {
    role: "user",
    content: [{ type: "text", text: prompt }],
    timestamp: Date.now(),
  };
  progress?.setSub("generate", "gen-prepare", "done");

  let lastErr = "";
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      progress?.setSub("generate", "gen-request", "running", attempt === 1 ? "attempt 1/2" : "retry 2/2");
      const response = await withTimeout(
        complete(
          model,
          { messages: [message] },
          {
            apiKey: auth.apiKey,
            headers: auth.headers,
            maxTokens: 6000,
            reasoningEffort: "minimal",
          }
        ),
        NAMER_TIMEOUT_MS,
        `Naming model request (attempt ${attempt})`
      );
      progress?.setSub("generate", "gen-request", "done", attempt === 1 ? "attempt 1/2" : "retry 2/2");

      progress?.setSub("generate", "gen-validate-response", "running");
      const text = extractTextContent(response.content as Array<{ type: string; text?: string }>);
      const parsed = parseJsonArrayWithRecovery(text);
      const proposals = sanitizeProposals(parsed, dossiers);
      if (proposals.length === dossiers.length) {
        progress?.setSub("generate", "gen-validate-response", "done");
        progress?.setSub("generate", "gen-finalize", "running");
        progress?.setSub("generate", "gen-finalize", "done");
        return proposals;
      }

      progress?.setSub("generate", "gen-validate-response", "error");
      lastErr = `Expected ${dossiers.length} proposals, got ${proposals.length}`;
    } catch (err) {
      progress?.setSub("generate", "gen-request", "error", attempt === 1 ? "attempt 1/2 failed" : "retry 2/2 failed");
      progress?.setSub("generate", "gen-validate-response", "error");
      lastErr = err instanceof Error ? err.message : String(err);
    }
  }

  throw new Error(`Built-in naming model failed after 2 attempts: ${lastErr}`);
}

async function reviewLowConfidenceTwoPane(
  low: Proposal[],
  ctx: Parameters<Parameters<ExtensionAPI["registerTool"]>[0]["execute"]>[4]
): Promise<{ approvedIds: number[]; rejectedIds: number[]; cancelled: boolean }> {
  if (!ctx.hasUI || !low.length) return { approvedIds: [], rejectedIds: [], cancelled: false };

  const result = await ctx.ui.custom<{ approvedIds: number[]; rejectedIds: number[]; cancelled: boolean }>(
    (tui, theme, _kb, done) => {
      let index = 0;
      const decisions = new Map<number, ReviewDecision>();
      for (const p of low) decisions.set(p.dossier_id, "undecided");

      function setAll(value: ReviewDecision) {
        for (const p of low) decisions.set(p.dossier_id, value);
      }

      function cycle(id: number) {
        const cur = decisions.get(id) ?? "undecided";
        const next = cur === "undecided" ? "approve" : cur === "approve" ? "reject" : "undecided";
        decisions.set(id, next);
      }

      function getDecisionMark(value: ReviewDecision): string {
        if (value === "approve") return theme.fg("success", "✓");
        if (value === "reject") return theme.fg("error", "✗");
        return theme.fg("dim", "·");
      }

      function makeCell(text: string, width: number): string {
        const truncated = truncateToWidth(text, width);
        const pad = Math.max(0, width - visibleWidth(truncated));
        return truncated + " ".repeat(pad);
      }

      function buildSummary() {
        const values = Array.from(decisions.values());
        const approved = values.filter((v) => v === "approve").length;
        const rejected = values.filter((v) => v === "reject").length;
        const undecided = values.filter((v) => v === "undecided").length;
        return { approved, rejected, undecided };
      }

      return {
        handleInput(data: string) {
          if (matchesKey(data, Key.escape)) {
            done({ approvedIds: [], rejectedIds: [], cancelled: true });
            return;
          }
          if (matchesKey(data, Key.up)) {
            index = Math.max(0, index - 1);
            tui.requestRender();
            return;
          }
          if (matchesKey(data, Key.down)) {
            index = Math.min(low.length - 1, index + 1);
            tui.requestRender();
            return;
          }
          if (matchesKey(data, Key.enter)) {
            const approvedIds = low.filter((p) => decisions.get(p.dossier_id) === "approve").map((p) => p.dossier_id);
            const rejectedIds = low.filter((p) => decisions.get(p.dossier_id) === "reject").map((p) => p.dossier_id);
            done({ approvedIds, rejectedIds, cancelled: false });
            return;
          }

          const current = low[index];
          if (!current) return;

          if (matchesKey(data, Key.space)) {
            cycle(current.dossier_id);
            tui.requestRender();
            return;
          }
          if (data === "a") {
            decisions.set(current.dossier_id, "approve");
            tui.requestRender();
            return;
          }
          if (data === "x") {
            decisions.set(current.dossier_id, "reject");
            tui.requestRender();
            return;
          }
          if (data === "A") {
            setAll("approve");
            tui.requestRender();
            return;
          }
          if (data === "X") {
            setAll("reject");
            tui.requestRender();
            return;
          }
          if (data === "R") {
            setAll("undecided");
            tui.requestRender();
            return;
          }
        },

        render(width: number): string[] {
          const lines: string[] = [];
          const inner = Math.max(40, width);
          const leftW = Math.max(28, Math.floor(inner * 0.48));
          const rightW = Math.max(20, inner - leftW - 3);

          const selected = low[index] ?? low[0];
          const selectedDecision = selected ? decisions.get(selected.dossier_id) ?? "undecided" : "undecided";
          const summary = buildSummary();

          const title = theme.fg("accent", "Docorg Review — Low Confidence (< 0.85)");
          lines.push(truncateToWidth(title, inner));
          lines.push(
            truncateToWidth(
              theme.fg(
                "dim",
                "↑↓ move  a approve  x reject  space cycle  A approve-all  X reject-all  R reset  Enter confirm  Esc cancel"
              ),
              inner
            )
          );
          lines.push(
            truncateToWidth(
              `${theme.fg("success", `approve:${summary.approved}`)}  ${theme.fg("error", `reject:${summary.rejected}`)}  ${theme.fg("muted", `undecided:${summary.undecided}`)}`,
              inner
            )
          );
          lines.push(theme.fg("borderMuted", "─".repeat(Math.max(10, inner))));

          const leftLines: string[] = [];
          leftLines.push(theme.fg("accent", "Old filenames"));
          leftLines.push(theme.fg("dim", "(full names shown; selected row highlighted)"));
          leftLines.push(theme.fg("borderMuted", "─".repeat(Math.max(10, leftW))));

          for (let i = 0; i < low.length; i++) {
            const p = low[i];
            const focus = i === index;
            const decision = decisions.get(p.dossier_id) ?? "undecided";
            const mark = getDecisionMark(decision);
            const conf = toNumber(p.confidence, 0).toFixed(2);
            const headerBase = `${focus ? ">" : " "} ${mark} [${conf}] #${p.dossier_id}`;
            const header = focus ? theme.fg("accent", headerBase) : theme.fg("muted", headerBase);
            leftLines.push(header);

            const oldName = p.current_name || "(unknown)";
            const wrappedOld = wrapTextWithAnsi(oldName, Math.max(10, leftW - 2));
            for (const part of wrappedOld) {
              leftLines.push(`  ${focus ? theme.fg("text", part) : part}`);
            }
            if (i < low.length - 1) leftLines.push(theme.fg("borderMuted", "·".repeat(Math.max(8, leftW - 1))));
          }

          const rightLines: string[] = [];
          if (selected) {
            rightLines.push(theme.fg("accent", "Proposed filename"));
            rightLines.push(theme.fg("borderMuted", "─".repeat(Math.max(10, rightW))));
            rightLines.push(theme.fg("muted", `Dossier: #${selected.dossier_id}`));
            rightLines.push(theme.fg("muted", `Category: ${selected.category || "unknown"}`));
            rightLines.push(
              `${theme.fg("muted", "Decision:")} ${
                selectedDecision === "approve"
                  ? theme.fg("success", "approve")
                  : selectedDecision === "reject"
                    ? theme.fg("error", "reject")
                    : theme.fg("dim", "undecided")
              }`
            );
            const confText = toNumber(selected.confidence, 0).toFixed(2);
            const confStyled =
              toNumber(selected.confidence, 0) >= 0.7
                ? theme.fg("success", confText)
                : toNumber(selected.confidence, 0) >= 0.5
                  ? theme.fg("warning", confText)
                  : theme.fg("error", confText);
            rightLines.push(`${theme.fg("muted", "Confidence:")} ${confStyled}`);
            rightLines.push("");
            rightLines.push(theme.fg("muted", "New name (full):"));
            rightLines.push(...wrapTextWithAnsi(theme.fg("text", selected.suggested_name || "(none)"), Math.max(10, rightW)));
            if (selected.notes) {
              rightLines.push("");
              rightLines.push(theme.fg("muted", "Notes:"));
              rightLines.push(...wrapTextWithAnsi(theme.fg("dim", selected.notes), Math.max(10, rightW)));
            }
          }

          const rowCount = Math.max(leftLines.length, rightLines.length, 12);
          for (let i = 0; i < rowCount; i++) {
            const leftText = leftLines[i] || "";
            const rightText = rightLines[i] || "";
            lines.push(`${makeCell(leftText, leftW)} ${theme.fg("borderMuted", "│")} ${makeCell(rightText, rightW)}`);
          }

          lines.push(theme.fg("borderMuted", "─".repeat(Math.max(10, inner))));
          lines.push(truncateToWidth(theme.fg("muted", "Confirm to apply decisions to this batch."), inner));
          return lines;
        },

        invalidate() {},
      };
    },
    {
      overlay: true,
      overlayOptions: {
        anchor: "top-left",
        width: "100%",
        maxHeight: "100%",
        margin: 0,
      },
    }
  );

  return result;
}

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    if (ctx.hasUI) ctx.ui.notify("docorg loaded — /organize [count]", "info");
  });

  pi.registerTool({
    name: "docorg_process_proposals",
    label: "Docorg Process Proposals",
    description:
      "Insert filename proposals, review low-confidence items with a two-pane batch UI, approve selections, and apply renames.",
    promptSnippet: "Process /organize filename proposals into DB and apply approved renames.",
    promptGuidelines: [
      "Use docorg_process_proposals after /organize when dossier proposals are ready.",
      "Call docorg_process_proposals once with all proposals for the current batch.",
    ],
    parameters: Type.Object({
      proposals: Type.Array(
        Type.Object({
          dossier_id: Type.Number(),
          suggested_name: Type.String(),
          confidence: Type.Number(),
          category: Type.String(),
          notes: Type.Optional(Type.String()),
          current_name: Type.Optional(Type.String()),
        })
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const proposals: Proposal[] = params.proposals || [];
      return runDocorgPipeline(pi, ctx, proposals);
    },
  });

  pi.registerCommand("organize", {
    description: "Queue docs, generate names with built-in OpenRouter mini model, review, approve and apply. Usage: /organize [count]",
    handler: async (args, ctx) => {
      const raw = (args || "").trim();
      const count = Math.max(1, parseInt(raw || "20", 10) || 20);

      const progress = createProgressTracker(ctx.ui, count);
      postDocorgUpdate("Starting /organize", [`Requested batch size: ${count}`], "info");
      progress.set("queue", "active", `Requesting ${count}`);
      progress.registerSubSteps("queue", [
        { id: "queue-run", label: "Running doc-queue" },
        { id: "queue-load-batch", label: "Loading latest batch file" },
        { id: "queue-load-rules", label: "Loading naming rules" },
        { id: "queue-validate", label: "Validating batch content" },
      ]);
      progress.setSub("queue", "queue-run", "running");
      ctx.ui.setStatus("docorg", `queueing ${count} dossier(s)…`);

      const queue = await pi.exec(
        "bash",
        [
          "-lc",
          `cd \"${DOCORG_DIR}\" && ./bin/doc-queue ${count} 2>&1 && echo \"---OK---\" && ls -t \"$PWD\"/queue/batch-*.json 2>/dev/null | head -1`,
        ],
        { timeout: 60000 }
      );

      if (!queue.stdout.includes("---OK---")) {
        ctx.ui.setStatus("docorg", undefined);
        const msg = queue.stderr || queue.stdout;
        progress.setSub("queue", "queue-run", "error");
        progress.set("queue", "error", "doc-queue failed");
        progress.set("generate", "skipped", "No batch");
        progress.set("import", "skipped", "No proposals");
        progress.set("review", "skipped", "No proposals");
        progress.set("decide", "skipped", "No proposals");
        progress.set("apply", "skipped", "No proposals");
        progress.set("done", "error", "Failed at queue stage");
        postDocorgUpdate("Queue failed", [msg || "doc-queue failed or no pending files."], "error");
        ctx.ui.notify(`doc-queue failed or no pending files\n${msg}`, "error");
        setTimeout(() => clearDocorgWidget(), 3000);
        return;
      }
      progress.setSub("queue", "queue-run", "done");

      const lines = queue.stdout.split("\n");
      const batchJsonPath = lines[lines.indexOf("---OK---") + 1]?.trim();
      if (!batchJsonPath) {
        ctx.ui.setStatus("docorg", undefined);
        progress.setSub("queue", "queue-load-batch", "skipped", "no batch file");
        progress.setSub("queue", "queue-load-rules", "skipped", "no batch file");
        progress.setSub("queue", "queue-validate", "skipped", "nothing to validate");
        progress.set("queue", "done", "No pending dossiers");
        progress.set("generate", "skipped", "No batch file");
        progress.set("import", "skipped", "No proposals");
        progress.set("review", "skipped", "No proposals");
        progress.set("decide", "skipped", "No proposals");
        progress.set("apply", "skipped", "No proposals");
        progress.set("done", "done", "Nothing to process");
        postDocorgUpdate("No pending dossiers", ["Queue returned no batch file."], "info");
        ctx.ui.notify("No pending dossiers.", "info");
        setTimeout(() => clearDocorgWidget(), 3000);
        return;
      }

      progress.setSub("queue", "queue-load-batch", "running");
      progress.setSub("queue", "queue-load-rules", "running");
      const [rules, batch] = await Promise.all([
        pi.exec("bash", ["-lc", `cat \"${DOCORG_DIR}/naming-rules.md\"`]),
        pi.exec("bash", ["-lc", `cat ${shQuote(batchJsonPath)}`]),
      ]);
      progress.setSub("queue", "queue-load-batch", "done");
      progress.setSub("queue", "queue-load-rules", "done");
      progress.setSub("queue", "queue-validate", "running");

      let dossiers: DossierInput[];
      try {
        dossiers = JSON.parse(batch.stdout);
      } catch {
        progress.setSub("queue", "queue-validate", "error", "invalid batch JSON");
        ctx.ui.setStatus("docorg", undefined);
        ctx.ui.notify(`Failed to parse batch JSON\nPath: ${batchJsonPath}\n${batch.stderr || batch.stdout}`, "error");
        setTimeout(() => clearDocorgWidget(), 3000);
        return;
      }

      if (!dossiers.length) {
        ctx.ui.setStatus("docorg", undefined);
        progress.setSub("queue", "queue-validate", "done", "batch empty");
        progress.set("queue", "done", "Batch file empty");
        progress.set("generate", "skipped", "No dossiers");
        progress.set("import", "skipped", "No proposals");
        progress.set("review", "skipped", "No proposals");
        progress.set("decide", "skipped", "No proposals");
        progress.set("apply", "skipped", "No proposals");
        progress.set("done", "done", "Nothing to process");
        postDocorgUpdate("No pending dossiers", ["Batch file was empty."], "info");
        ctx.ui.notify("No pending dossiers in batch.", "info");
        setTimeout(() => clearDocorgWidget(), 3000);
        return;
      }

      progress.setSub("queue", "queue-validate", "done");
      progress.set("queue", "done", `${dossiers.length} dossier(s) queued`);
      progress.set("generate", "active", `${NAMER_PROVIDER}/${NAMER_MODEL}`);
      progress.registerSubSteps("generate", [
        { id: "gen-prepare", label: "Preparing dossiers for model" },
        { id: "gen-request", label: "Requesting names from model" },
        { id: "gen-validate-response", label: "Validating model response" },
        { id: "gen-finalize", label: "Finalizing proposal list" },
      ]);

      postDocorgUpdate(
        "Batch queued",
        [`Dossiers in batch: ${dossiers.length}`, `Batch file: ${batchJsonPath}`],
        "success"
      );

      ctx.ui.setStatus("docorg", `generating names via ${NAMER_PROVIDER}/${NAMER_MODEL}…`);

      postDocorgUpdate("Generating proposals", [`Model: ${NAMER_PROVIDER}/${NAMER_MODEL}`], "info");

      let proposals: Proposal[];
      try {
        proposals = await generateProposalsWithBuiltInModel(ctx, dossiers, rules.stdout || "", progress);
      } catch (err) {
        ctx.ui.setStatus("docorg", undefined);
        const msg = err instanceof Error ? err.message : String(err);
        progress.set("generate", "error", "Model generation failed");
        progress.set("import", "skipped", "No proposals");
        progress.set("review", "skipped", "No proposals");
        progress.set("decide", "skipped", "No proposals");
        progress.set("apply", "skipped", "No proposals");
        progress.set("done", "error", "Failed at generation stage");
        postDocorgUpdate("Name generation failed", [msg], "error");
        ctx.ui.notify(`Name generation failed (${NAMER_PROVIDER}/${NAMER_MODEL})\n${msg}`, "error");
        setTimeout(() => clearDocorgWidget(), 3000);
        return;
      }

      progress.set("generate", "done", `${proposals.length} proposal(s)`);
      postDocorgUpdate("Proposals generated", [`Total proposals: ${proposals.length}`], "success");
      await runDocorgPipeline(pi, ctx, proposals, progress);
      if (ctx.hasUI) ctx.ui.notify(`Processed ${proposals.length} proposal(s).`, "success");
      ctx.ui.setStatus("docorg", undefined);
      // Clear the progress widget after a short delay so user can see final state
      setTimeout(() => clearDocorgWidget(), 3000);
    },
  });
}
