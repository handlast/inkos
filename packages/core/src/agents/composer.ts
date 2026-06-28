import { readFile, readdir, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import YAML from "js-yaml";
import { BaseAgent } from "./base.js";
import type { BookConfig } from "../models/book.js";
import {
  ContextPackageSchema,
  type ChapterTrace,
  type ContextPackage,
  type RuleStack,
} from "../models/input-governance.js";
import type { PlanChapterOutput } from "./planner.js";
import {
  parseChapterSummariesMarkdown,
  retrieveMemorySelection,
} from "../utils/memory-retrieval.js";
import { readDynamicStoryFileAsOf } from "../state/runtime-state-store.js";
import {
  buildGovernedRuleStack,
  buildGovernedTrace,
  isProtectedContextSource,
} from "../utils/context-assembly.js";
import { writeGovernedRuntimeArtifacts } from "../utils/runtime-writer.js";
import { estimateTextTokens, type LLMClient } from "../llm/provider.js";
import type { ContextCompressionCallback } from "../models/context-compression.js";

export interface ComposeChapterInput {
  readonly book: BookConfig;
  readonly bookDir: string;
  readonly chapterNumber: number;
  readonly plan: PlanChapterOutput;
  readonly contextBudget?: ContextBudget;
  readonly compressibleContextCompiler?: CompressibleContextCompiler;
  readonly outlineSectionSelector?: OutlineSectionSelector;
  readonly onContextCompression?: ContextCompressionCallback;
  readonly asOfChapter?: number;
  readonly asOfSnapshot?: number;
}

export interface ContextBudget {
  readonly contextWindowTokens: number;
  readonly reservedOutputTokens: number;
}

export interface CompressibleContextCompileRequest {
  readonly chapterNumber: number;
  readonly goal: string;
  readonly language: "zh" | "en";
  readonly maxInputTokens: number;
  readonly protectedEntries: ContextPackage["selectedContext"];
  readonly compressibleEntries: ContextPackage["selectedContext"];
}

export type CompressibleContextCompiler = (request: CompressibleContextCompileRequest) => Promise<string>;

export interface OutlineSectionSelectionRequest {
  readonly fileName: string;
  readonly kind: "story-frame" | "volume-map";
  readonly chapterNumber: number;
  readonly goal: string;
  readonly outlineNode: string;
  readonly language: "zh" | "en";
  readonly candidates: ReadonlyArray<{
    readonly source: string;
    readonly heading: string;
    readonly excerpt: string;
  }>;
}

export type OutlineSectionSelector = (request: OutlineSectionSelectionRequest) => Promise<ReadonlyArray<string>>;

export interface ComposeChapterOutput {
  readonly contextPackage: ContextPackage;
  readonly ruleStack: RuleStack;
  readonly trace: ChapterTrace;
  readonly contextPath: string;
  readonly ruleStackPath: string;
  readonly tracePath: string;
}

export async function composeGovernedChapter(input: ComposeChapterInput): Promise<ComposeChapterOutput> {
  const storyDir = join(input.bookDir, "story");
  const runtimeDir = join(storyDir, "runtime");
  await mkdir(runtimeDir, { recursive: true });

  const selectedContext = await collectSelectedContext(
    storyDir,
    input.plan,
    input.book.language ?? "zh",
    input.outlineSectionSelector,
    { asOfChapter: input.asOfChapter, asOfSnapshot: input.asOfSnapshot },
  );
  const initialContextPackage = ContextPackageSchema.parse({
    chapter: input.chapterNumber,
    asOfChapter: input.asOfChapter,
    selectedContext,
  });
  const budgeted = await applyContextBudgetIfNeeded({
    contextPackage: initialContextPackage,
    chapterNumber: input.chapterNumber,
    goal: input.plan.intent.goal,
    language: input.book.language ?? "zh",
    contextBudget: input.contextBudget,
    compiler: input.compressibleContextCompiler,
    onContextCompression: input.onContextCompression,
  });
  const contextPackage = budgeted.contextPackage;

  const ruleStack = buildGovernedRuleStack(input.plan, input.chapterNumber);
  const trace = buildGovernedTrace({
    chapterNumber: input.chapterNumber,
    plan: input.plan,
    contextPackage,
    composerInputs: [input.plan.runtimePath],
    notes: budgeted.notes,
  });
  const {
    contextPath,
    ruleStackPath,
    tracePath,
  } = await writeGovernedRuntimeArtifacts({
    runtimeDir,
    chapterNumber: input.chapterNumber,
    contextPackage,
    ruleStack,
    trace,
  });

  return {
    contextPackage,
    ruleStack,
    trace,
    contextPath,
    ruleStackPath,
    tracePath,
  };
}

async function applyContextBudgetIfNeeded(params: {
  readonly contextPackage: ContextPackage;
  readonly chapterNumber: number;
  readonly goal: string;
  readonly language: "zh" | "en";
  readonly contextBudget?: ContextBudget;
  readonly compiler?: CompressibleContextCompiler;
  readonly onContextCompression?: ContextCompressionCallback;
}): Promise<{ readonly contextPackage: ContextPackage; readonly notes: string[] }> {
  const budget = params.contextBudget;
  if (!budget || budget.contextWindowTokens <= 0) {
    return { contextPackage: params.contextPackage, notes: [] };
  }

  const availableInputTokens = budget.contextWindowTokens - Math.max(0, budget.reservedOutputTokens);
  const selectedContext = params.contextPackage.selectedContext;
  const totalTokens = estimateSelectedContextTokens(selectedContext);
  if (totalTokens <= availableInputTokens) {
    return { contextPackage: params.contextPackage, notes: [] };
  }

  const protectedEntries = selectedContext.filter((entry) => isProtectedContextSource(entry.source));
  const compressibleEntries = selectedContext.filter((entry) => !isProtectedContextSource(entry.source));
  const protectedTokens = estimateSelectedContextTokens(protectedEntries);
  if (protectedTokens > availableInputTokens) {
    params.onContextCompression?.({
      category: "story_context",
      phase: "error",
      message: "Protected context exceeds available input budget.",
      protectedTokens,
      compressibleTokens: totalTokens - protectedTokens,
      budgetTokens: availableInputTokens,
      sources: protectedEntries.map((entry) => entry.source),
    });
    throw new Error(
      `Protected context exceeds available input budget (${protectedTokens}/${availableInputTokens} tokens). ` +
      "InkOS will not compress protected author intent, current focus, hard state, or active hook evidence.",
    );
  }
  if (compressibleEntries.length === 0) {
    return { contextPackage: params.contextPackage, notes: ["context-over-budget-no-compressible-entries"] };
  }
  if (!params.compiler) {
    params.onContextCompression?.({
      category: "story_context",
      phase: "error",
      message: "Context exceeds available input budget but no compiler was provided.",
      protectedTokens,
      compressibleTokens: estimateSelectedContextTokens(compressibleEntries),
      budgetTokens: availableInputTokens,
      sources: compressibleEntries.map((entry) => entry.source),
    });
    throw new Error(
      `Context exceeds available input budget (${totalTokens}/${availableInputTokens} tokens), ` +
      "but no compressible context compiler was provided.",
    );
  }

  const compileBudget = Math.max(1, availableInputTokens - protectedTokens);
  const compressibleTokens = estimateSelectedContextTokens(compressibleEntries);
  params.onContextCompression?.({
    category: "story_context",
    phase: "start",
    protectedTokens,
    compressibleTokens,
    budgetTokens: compileBudget,
    sources: compressibleEntries.map((entry) => entry.source),
  });
  let compiled: string;
  try {
    compiled = (await params.compiler({
      chapterNumber: params.chapterNumber,
      goal: params.goal,
      language: params.language,
      maxInputTokens: compileBudget,
      protectedEntries,
      compressibleEntries,
    })).trim();
  } catch (error) {
    params.onContextCompression?.({
      category: "story_context",
      phase: "error",
      message: error instanceof Error ? error.message : String(error),
      protectedTokens,
      compressibleTokens,
      budgetTokens: compileBudget,
      sources: compressibleEntries.map((entry) => entry.source),
    });
    throw error;
  }
  if (!compiled) {
    params.onContextCompression?.({
      category: "story_context",
      phase: "error",
      message: "Compressible context compiler returned empty output.",
      protectedTokens,
      compressibleTokens,
      budgetTokens: compileBudget,
      sources: compressibleEntries.map((entry) => entry.source),
    });
    throw new Error("Compressible context compiler returned empty output.");
  }
  params.onContextCompression?.({
    category: "story_context",
    phase: "end",
    protectedTokens,
    compressibleTokens,
    budgetTokens: compileBudget,
    sources: compressibleEntries.map((entry) => entry.source),
  });

  return {
    contextPackage: ContextPackageSchema.parse({
      chapter: params.contextPackage.chapter,
      asOfChapter: params.contextPackage.asOfChapter,
      selectedContext: [
        ...protectedEntries,
        {
          source: "runtime/compiled-compressible-context",
          reason: "Semantic compilation of lower-priority context after protected context exceeded the input budget.",
          excerpt: compiled,
        },
      ],
    }),
    notes: ["compiled-compressible-context"],
  };
}

function estimateSelectedContextTokens(entries: ContextPackage["selectedContext"]): number {
  return entries.reduce((total, entry) => (
    total + estimateTextTokens([entry.source, entry.reason, entry.excerpt].filter(Boolean).join("\n"))
  ), 0);
}

function renderContextEntries(entries: ContextPackage["selectedContext"]): string {
  return entries.map((entry) =>
    [
      `### ${entry.source}`,
      `Reason: ${entry.reason}`,
      entry.excerpt ? entry.excerpt : "(no excerpt)",
    ].join("\n"),
  ).join("\n\n");
}

function parseSelectedSources(raw: string): string[] {
  const trimmed = raw.trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  const parse = (value: string): unknown => JSON.parse(value);
  let parsed: unknown;
  try {
    parsed = parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start < 0 || end <= start) return [];
    try {
      parsed = parse(trimmed.slice(start, end + 1));
    } catch {
      return [];
    }
  }
  if (!parsed || typeof parsed !== "object") return [];
  const values = (parsed as { selectedSources?: unknown }).selectedSources;
  if (!Array.isArray(values)) return [];
  return values.filter((value): value is string => typeof value === "string" && value.trim().length > 0);
}

export class ComposerAgent extends BaseAgent {
  get name(): string {
    return "composer";
  }

  async composeChapter(input: ComposeChapterInput): Promise<ComposeChapterOutput> {
    const contextBudget = input.contextBudget ?? contextBudgetFromClient(this.ctx.client);
    return composeGovernedChapter({
      ...input,
      contextBudget,
      compressibleContextCompiler: input.compressibleContextCompiler
        ?? (contextBudget ? (request) => this.compileCompressibleContext(request) : undefined),
      outlineSectionSelector: input.outlineSectionSelector ?? ((request) => this.selectOutlineSections(request)),
    });
  }

  async selectOutlineSections(request: OutlineSectionSelectionRequest): Promise<ReadonlyArray<string>> {
    if (request.candidates.length <= 1) {
      return request.candidates.map((candidate) => candidate.source);
    }
    const isEn = request.language === "en";
    const candidates = request.candidates.map((candidate, index) => [
      `#${index + 1} ${candidate.source}`,
      `heading: ${candidate.heading}`,
      candidate.excerpt,
    ].join("\n")).join("\n\n");
    const system = isEn
      ? [
          "You are InkOS's semantic outline-section selector.",
          "Select only the outline sections needed for the current chapter. Prefer semantic relevance over keyword overlap.",
          "Return strict JSON only: {\"selectedSources\":[\"...\"]}. Use exact source ids from the candidates. If uncertain, include the safest relevant anchors rather than inventing ids.",
        ].join("\n")
      : [
          "你是 InkOS 的语义大纲选段器。",
          "只选择当前章节真正需要的大纲段落。按语义相关性判断，不要按关键词重合机械选择。",
          "只返回严格 JSON：{\"selectedSources\":[\"...\"]}。必须使用候选里的精确 source id；不确定时选最安全的相关锚点，不要编造 id。",
        ].join("\n");
    const user = isEn
      ? [
          `File: ${request.fileName}`,
          `Chapter: ${request.chapterNumber}`,
          `Goal: ${request.goal}`,
          `Outline node: ${request.outlineNode}`,
          "",
          "Candidates:",
          candidates,
        ].join("\n")
      : [
          `文件：${request.fileName}`,
          `章节：第${request.chapterNumber}章`,
          `目标：${request.goal}`,
          `大纲节点：${request.outlineNode}`,
          "",
          "候选段落：",
          candidates,
        ].join("\n");
    const response = await this.chat([
      { role: "system", content: system },
      { role: "user", content: user },
    ], {
      temperature: 0.1,
      maxTokens: 1024,
    });
    const allowed = new Set(request.candidates.map((candidate) => candidate.source));
    return parseSelectedSources(response.content).filter((source) => allowed.has(source));
  }

  async compileCompressibleContext(request: CompressibleContextCompileRequest): Promise<string> {
    const isEn = request.language === "en";
    const protectedBlock = renderContextEntries(request.protectedEntries);
    const compressibleBlock = renderContextEntries(request.compressibleEntries);
    const system = isEn
      ? [
          "You are InkOS's semantic context compiler.",
          "Only compile the COMPRESSIBLE CONTEXT. The PROTECTED CONTEXT is binding reference material and must not be rewritten, summarized as a substitute, or weakened.",
          "Output concise Markdown with source pointers. Preserve names, unresolved promises, evidence, timing, and constraints that may affect the next chapter. Drop low-relevance noise.",
        ].join("\n")
      : [
          "你是 InkOS 的语义上下文编译器。",
          "只能编译【可压缩上下文】。【受保护上下文】是绑定参照，不得改写、不得替代总结、不得削弱。",
          "输出简洁 Markdown，保留来源指针。保留会影响下一章的人名、未兑现承诺、证据、时间点和约束，丢弃低相关噪声。",
        ].join("\n");
    const user = isEn
      ? [
          `Chapter: ${request.chapterNumber}`,
          `Goal: ${request.goal}`,
          `Target budget for compiled context: <= ${request.maxInputTokens} estimated input tokens`,
          "",
          "## Protected Context (reference only, do not compile)",
          protectedBlock || "(none)",
          "",
          "## Compressible Context (compile this)",
          compressibleBlock || "(none)",
        ].join("\n")
      : [
          `章节：第${request.chapterNumber}章`,
          `目标：${request.goal}`,
          `压缩后目标预算：不超过 ${request.maxInputTokens} 估算输入 tokens`,
          "",
          "## 受保护上下文（只作为参照，不要编译它）",
          protectedBlock || "（无）",
          "",
          "## 可压缩上下文（只编译这一部分）",
          compressibleBlock || "（无）",
        ].join("\n");

    const response = await this.chat([
      { role: "system", content: system },
      { role: "user", content: user },
    ], {
      temperature: 0.2,
      maxTokens: Math.min(8192, Math.max(512, request.maxInputTokens)),
    });
    return response.content.trim();
  }
}

export function contextBudgetFromClient(client: LLMClient): ContextBudget | undefined {
  const contextWindowTokens = client._piModel?.contextWindow;
  if (!Number.isFinite(contextWindowTokens) || !contextWindowTokens || contextWindowTokens <= 0) {
    return undefined;
  }
  return {
    contextWindowTokens,
    reservedOutputTokens: Math.max(0, client.defaults.maxTokens),
  };
}

async function collectSelectedContext(
  storyDir: string,
  plan: PlanChapterOutput,
  language: "zh" | "en",
  outlineSectionSelector?: OutlineSectionSelector,
  options?: { asOfChapter?: number; asOfSnapshot?: number },
): Promise<ContextPackage["selectedContext"]> {
    const retrievalHints = deriveRetrievalHints(plan);
    const asOfChapter = options?.asOfChapter;
    const memoBodyExcerpt = plan.memo.body.trim();
    const chapterMemoEntry = memoBodyExcerpt.length > 0
      ? [{
          source: "runtime/chapter_memo",
          reason: "Carry the planner's chapter memo into governed writing.",
          excerpt: [
            `goal=${plan.memo.goal}`,
            plan.memo.isGoldenOpening ? "golden-opening=true" : undefined,
            memoBodyExcerpt,
          ].filter(Boolean).join(" | "),
        }]
      : [{
          source: "runtime/chapter_memo",
          reason: "Carry the planner's chapter memo into governed writing.",
          excerpt: `goal=${plan.memo.goal}`,
        }];

    const entries = await Promise.all([
      maybeContextSource(storyDir, "current_focus.md", "Current task focus for this chapter."),
      maybeContextSource(
        storyDir,
        "author_intent.md",
        "User's long-term authorial intent and direction — binding, overrides model defaults.",
      ),
      maybeAuditDriftSource(storyDir, plan.intent.chapter),
      maybeContextSource(
        storyDir,
        "current_state.md",
        "Preserve hard state facts referenced by the active chapter brief or hard constraints.",
        retrievalHints,
        undefined,
        asOfChapter,
      ),
      maybeContextSource(
        storyDir,
        "alliance_state.md",
        "Current faction alliances, diplomatic relations, and membership events. Writer must not contradict these states.",
        [],
        undefined,
        asOfChapter,
      ),
      maybeContextSource(
        storyDir,
        "character_assets.md",
        "Current character-held assets and their statuses. Writer must not invoke assets a character does not hold.",
        [],
        undefined,
        asOfChapter,
      ),
      maybeContextSource(
        storyDir,
        "parent_canon.md",
        "Preserve parent canon constraints for governed continuation or fanfic writing.",
      ),
      maybeContextSource(
        storyDir,
        "fanfic_canon.md",
        "Preserve extracted fanfic canon constraints for governed writing.",
      ),
    ]);
    const outlineEntries = [
      ...await maybeOutlineSectionSources(
        storyDir,
        "outline/story_frame.md",
      "Preserve canon constraints referenced by the active chapter brief or hard constraints.",
      plan,
      "story-frame",
      language,
      outlineSectionSelector,
    ),
      ...await maybeOutlineSectionSources(
        storyDir,
        "outline/volume_map.md",
      "Anchor the default planning node for this chapter.",
      plan,
      "volume-map",
      language,
      outlineSectionSelector,
    ),
    ];
    const trailEntries = await buildRecentChapterTrailEntries(storyDir, plan.intent.chapter, asOfChapter);

    const memorySelection = await retrieveMemorySelection({
      bookDir: dirname(storyDir),
      chapterNumber: plan.intent.chapter,
      asOfChapter,
      asOfSnapshot: options?.asOfSnapshot,
      goal: plan.intent.goal,
      outlineNode: plan.intent.outlineNode,
      mustKeep: retrievalHints,
    });
    const hookDebtEntries = await buildHookDebtEntries(
      storyDir,
      plan,
      memorySelection.activeHooks,
      language,
      asOfChapter,
    );

    const summaryEntries = memorySelection.summaries.map((summary) => ({
      source: `story/chapter_summaries.md#${summary.chapter}`,
      reason: "Relevant episodic memory retrieved for the current chapter goal.",
      excerpt: [summary.title, summary.events, summary.stateChanges, summary.hookActivity]
        .filter(Boolean)
        .join(" | "),
    }));
    const factEntries = memorySelection.facts.map((fact) => ({
      source: `story/current_state.md#${toFactAnchor(fact.predicate)}`,
      reason: "Relevant current-state fact retrieved for the current chapter goal.",
      excerpt: `${fact.predicate} | ${fact.object}`,
    }));
    const hookEntries = memorySelection.hooks.map((hook) => ({
      source: `story/pending_hooks.md#${hook.hookId}`,
      reason: "Carry forward unresolved hooks that match the chapter focus.",
      excerpt: [hook.type, hook.status, hook.expectedPayoff, hook.payoffTiming, hook.notes]
        .filter(Boolean)
        .join(" | "),
    }));
    const volumeSummaryEntries = memorySelection.volumeSummaries.map((summary) => ({
      source: `story/volume_summaries.md#${summary.anchor}`,
      reason: "Carry forward long-span arc memory compressed from earlier volumes.",
      excerpt: `${summary.heading} | ${summary.content}`,
    }));
    const activeRoleEntries = await buildActiveRoleContextEntries(storyDir, plan.memo.body, language);

    return [
      ...chapterMemoEntry,
      ...activeRoleEntries,
      ...entries.filter((entry): entry is NonNullable<typeof entry> => entry !== null),
      ...outlineEntries,
      ...trailEntries,
      ...hookDebtEntries,
      ...factEntries,
      ...summaryEntries,
      ...volumeSummaryEntries,
      ...hookEntries,
    ];
}

function deriveRetrievalHints(plan: PlanChapterOutput): string[] {
  return [
    plan.intent.goal,
    plan.intent.outlineNode,
    ...plan.memo.threadRefs,
  ].filter((value): value is string => Boolean(value));
}

async function buildRecentChapterTrailEntries(
  storyDir: string,
  chapterNumber: number,
  asOfChapter?: number,
): Promise<ContextPackage["selectedContext"]> {
    const content = typeof asOfChapter === "number"
      ? await readDynamicStoryFileAsOf(dirname(storyDir), asOfChapter, "chapter_summaries.md")
      : await readFileOrDefault(join(storyDir, "chapter_summaries.md"));
    if (!content || content === "(文件尚未创建)") {
      return [];
    }

    const recentSummaries = parseChapterSummariesMarkdown(content)
      .filter((summary) => summary.chapter < chapterNumber)
      .sort((left, right) => right.chapter - left.chapter)
      .slice(0, 5);
    if (recentSummaries.length === 0) {
      return [];
    }

    const entries: ContextPackage["selectedContext"] = [];
    const recentTitles = recentSummaries
      .map((summary) => [summary.chapter, summary.title].filter(Boolean).join(": "))
      .filter(Boolean)
      .join(" | ");
    if (recentTitles) {
      entries.push({
        source: "story/chapter_summaries.md#recent_titles",
        reason: "Keep recent title history visible to avoid repetitive chapter naming.",
        excerpt: recentTitles,
      });
    }

    const moodTrail = recentSummaries
      .filter((summary) => summary.mood || summary.chapterType)
      .map((summary) => `${summary.chapter}: ${summary.mood || "(none)"} / ${summary.chapterType || "(none)"}`)
      .join(" | ");
    if (moodTrail) {
      entries.push({
        source: "story/chapter_summaries.md#recent_mood_type_trail",
        reason: "Keep recent mood and chapter-type cadence visible before writing the next chapter.",
        excerpt: moodTrail,
      });
    }

    const endingTrail = await buildRecentEndingTrail(storyDir, chapterNumber);
    if (endingTrail) {
      entries.push({
        source: "story/chapters#recent_endings",
        reason: "Show how recent chapters ended so the writer avoids structural repetition (e.g. 3 consecutive collapse endings).",
        excerpt: endingTrail,
      });
    }

    return entries;
}

async function buildRecentEndingTrail(
  storyDir: string,
  chapterNumber: number,
): Promise<string | undefined> {
    const chaptersDir = join(dirname(storyDir), "chapters");
    try {
      const files = await readdir(chaptersDir);
      const chapterFiles = files
        .filter((file) => file.endsWith(".md"))
        .map((file) => ({ file, num: parseInt(file.slice(0, 4), 10) }))
        .filter((entry) => Number.isFinite(entry.num) && entry.num < chapterNumber)
        .sort((a, b) => b.num - a.num)
        .slice(0, 3);

      const endings: string[] = [];
      for (const entry of chapterFiles.reverse()) {
        const content = await readFile(join(chaptersDir, entry.file), "utf-8");
        const lastLine = extractLastMeaningfulSentence(content);
        if (lastLine) {
          endings.push(`ch${entry.num}: ${lastLine}`);
        }
      }
      return endings.length >= 2 ? endings.join(" | ") : undefined;
    } catch {
      return undefined;
    }
}

function extractLastMeaningfulSentence(content: string): string | undefined {
    const lines = content.split("\n").map((line) => line.trim()).filter((line) =>
      line.length > 5 && !line.startsWith("#") && !line.startsWith("|") && !line.startsWith("==="),
    );
    const last = lines.at(-1);
    if (!last) return undefined;
    return last.length > 60 ? last.slice(0, 57) + "..." : last;
}

async function buildHookDebtEntries(
  storyDir: string,
  plan: PlanChapterOutput,
  activeHooks: ReadonlyArray<{
      readonly hookId: string;
      readonly startChapter: number;
      readonly type: string;
      readonly status: string;
      readonly lastAdvancedChapter: number;
      readonly expectedPayoff: string;
      readonly payoffTiming?: string;
      readonly notes: string;
    }>,
  language: "zh" | "en",
  asOfChapter?: number,
): Promise<ContextPackage["selectedContext"]> {
    const targetHookIds = [...new Set(plan.memo.threadRefs)];
    if (targetHookIds.length === 0) {
      return [];
    }

    const summariesMarkdown = typeof asOfChapter === "number"
      ? await readDynamicStoryFileAsOf(dirname(storyDir), asOfChapter, "chapter_summaries.md")
      : await readFileOrDefault(join(storyDir, "chapter_summaries.md"));
    const summaries = parseChapterSummariesMarkdown(summariesMarkdown);

    return targetHookIds.flatMap((hookId) => {
      const hook = activeHooks.find((entry) => entry.hookId === hookId);
      if (!hook) {
        return [];
      }

      const seedSummary = findHookSummary(summaries, hook.hookId, hook.startChapter, "seed");
      const latestSummary = findHookSummary(summaries, hook.hookId, hook.lastAdvancedChapter, "latest");
      const role = language === "en" ? "memo-referenced debt" : "备忘引用旧债";
      const promise = hook.expectedPayoff || (language === "en" ? "(unspecified)" : "（未写明）");
      const seedBeat = seedSummary
        ? renderHookDebtBeat(seedSummary)
        : (hook.notes || promise);
      const latestBeat = latestSummary && latestSummary !== seedSummary
        ? renderHookDebtBeat(latestSummary)
        : undefined;
      const age = Math.max(0, plan.intent.chapter - Math.max(1, hook.startChapter));

      return [{
        source: `runtime/hook_debt#${hook.hookId}`,
        reason: language === "en"
          ? "Narrative debt brief with original seed text for this hook agenda target."
          : "含原始种子文本的叙事债务简报。",
        excerpt: language === "en"
          ? [
              `${hook.hookId} (${hook.type}, ${role}, open ${age} chapters)`,
              `reader promise: ${promise}`,
              `original seed (ch${hook.startChapter}): ${seedBeat}`,
              latestBeat ? `latest turn (ch${hook.lastAdvancedChapter}): ${latestBeat}` : undefined,
            ].filter(Boolean).join(" | ")
          : [
              `${hook.hookId}（${hook.type}，${role}，已开${age}章）`,
              `读者承诺：${promise}`,
              `种于第${hook.startChapter}章：${seedBeat}`,
              latestBeat ? `推进于第${hook.lastAdvancedChapter}章：${latestBeat}` : undefined,
            ].filter(Boolean).join(" | "),
      }];
    });
}

async function maybeContextSource(
  storyDir: string,
  fileName: string,
  reason: string,
  preferredExcerpts: string[] = [],
  sectionAnchor?: string,
  asOfChapter?: number,
): Promise<ContextPackage["selectedContext"][number] | null> {
    const path = join(storyDir, fileName);
    let content = typeof asOfChapter === "number"
      ? await readDynamicStoryFileAsOf(dirname(storyDir), asOfChapter, fileName)
      : await readFileOrDefault(path);
    let resolvedFileName = typeof asOfChapter === "number"
      ? `snapshots/${asOfChapter}/${fileName}`
      : fileName;

    if ((!content || content === "(文件尚未创建)")) {
      // Phase 5 back-compat: the new outline/ files may be absent on legacy
      // books. Fall back to the deprecated paths transparently.
      const legacyFallback = outlineFallback(fileName);
      if (legacyFallback) {
        const legacyPath = join(storyDir, legacyFallback);
        const legacyContent = await readFileOrDefault(legacyPath);
        if (legacyContent && legacyContent !== "(文件尚未创建)") {
          content = legacyContent;
          resolvedFileName = legacyFallback;
        }
      }
    }

    if (!content || content === "(文件尚未创建)") return null;

    const sectionContent = sectionAnchor ? extractSection(content, sectionAnchor) : null;
    return {
      source: sectionAnchor ? `story/${resolvedFileName}#${sectionAnchor}` : `story/${resolvedFileName}`,
      reason,
      excerpt: sectionContent || pickExcerpt(content, preferredExcerpts),
    };
}

async function maybeOutlineSectionSources(
  storyDir: string,
  fileName: "outline/story_frame.md" | "outline/volume_map.md",
  reason: string,
  plan: PlanChapterOutput,
  kind: "story-frame" | "volume-map",
  language: "zh" | "en",
  outlineSectionSelector?: OutlineSectionSelector,
): Promise<ContextPackage["selectedContext"]> {
    const path = join(storyDir, fileName);
    const content = await readFileOrDefault(path);

    if (!content || content === "(文件尚未创建)") {
      const legacyFallback = outlineFallback(fileName);
      if (!legacyFallback) return [];
      const legacyContent = await readFileOrDefault(join(storyDir, legacyFallback));
      if (!legacyContent || legacyContent === "(文件尚未创建)") return [];
      return await selectOutlineSectionEntries({
        fileName: legacyFallback,
        content: legacyContent,
        reason,
        plan,
        kind,
        language,
        outlineSectionSelector,
      });
    }

    return await selectOutlineSectionEntries({
      fileName,
      content,
      reason,
      plan,
      kind,
      language,
      outlineSectionSelector,
    });
}

async function selectOutlineSectionEntries(params: {
  readonly fileName: string;
  readonly content: string;
  readonly reason: string;
  readonly plan: PlanChapterOutput;
  readonly kind: "story-frame" | "volume-map";
  readonly language: "zh" | "en";
  readonly outlineSectionSelector?: OutlineSectionSelector;
}): Promise<ContextPackage["selectedContext"]> {
    const sections = splitMarkdownSections(params.content);
    if (sections.length === 0) {
      return [{
        source: `story/${params.fileName}#document`,
        reason: params.reason,
        excerpt: params.content.trim(),
      }];
    }

    const hints = deriveOutlineSelectionHints(params.plan);
    const selected = sections.filter((section) =>
      params.kind === "story-frame"
        ? isRelevantStoryFrameSection(section, hints)
        : isRelevantVolumeMapSection(section, hints, params.plan.intent.chapter),
    );
    const finalSections = selected.length > 0 ? selected : fallbackOutlineSections(sections, params.kind, params.plan.intent.chapter);
    const candidates = sections.map((section) => ({
      source: `story/${params.fileName}#${slugifyAnchor(section.heading)}`,
      heading: section.heading,
      excerpt: section.raw.trim(),
    }));
    if (params.outlineSectionSelector) {
      try {
        const selectedSources = await params.outlineSectionSelector({
          fileName: params.fileName,
          kind: params.kind,
          chapterNumber: params.plan.intent.chapter,
          goal: params.plan.intent.goal,
          outlineNode: params.plan.intent.outlineNode ?? "",
          language: params.language,
          candidates,
        });
        const selectedSourceSet = new Set(selectedSources);
        const llmSections = sections.filter((section) =>
          selectedSourceSet.has(`story/${params.fileName}#${slugifyAnchor(section.heading)}`),
        );
        if (llmSections.length > 0) {
          return dedupeBySource(llmSections.map((section) => ({
            source: `story/${params.fileName}#${slugifyAnchor(section.heading)}`,
            reason: params.reason,
            excerpt: section.raw.trim(),
          })));
        }
      } catch {
        // Semantic section selection is quality guidance, not a hard dependency.
        // If the provider flakes or returns malformed JSON, keep the deterministic
        // fallback so chapter production does not stall.
      }
    }
    return dedupeBySource(finalSections.map((section) => ({
      source: `story/${params.fileName}#${slugifyAnchor(section.heading)}`,
      reason: params.reason,
      excerpt: section.raw.trim(),
    })));
}

interface MarkdownSection {
  readonly heading: string;
  readonly raw: string;
}

function splitMarkdownSections(content: string): MarkdownSection[] {
    const sections: Array<{ heading: string; lines: string[] }> = [];
    let current: { heading: string; lines: string[] } | null = null;
    for (const line of content.split(/\r?\n/)) {
      const headingMatch = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
      if (headingMatch) {
        if (current && current.lines.some((entry) => entry.trim().length > 0)) {
          sections.push(current);
        }
        current = {
          heading: headingMatch[2]!.trim(),
          lines: [line],
        };
        continue;
      }
      if (current) {
        current.lines.push(line);
      }
    }
    if (current && current.lines.some((entry) => entry.trim().length > 0)) {
      sections.push(current);
    }
    return sections
      .map((section) => ({
        heading: section.heading,
        raw: section.lines.join("\n").trim(),
      }))
      .filter((section) => section.raw.length > 0);
}

function deriveOutlineSelectionHints(plan: PlanChapterOutput): string[] {
    return [
      plan.intent.goal,
      plan.intent.outlineNode,
      plan.intent.arcContext,
      ...plan.intent.mustKeep,
      ...plan.intent.mustAvoid,
      ...plan.intent.styleEmphasis,
      plan.memo.goal,
      plan.memo.body,
      ...plan.memo.threadRefs,
    ].filter((value): value is string => Boolean(value && value.trim()));
}

function isRelevantStoryFrameSection(section: MarkdownSection, hints: ReadonlyArray<string>): boolean {
    const heading = normalizeForMatch(section.heading);
    const sectionText = normalizeForMatch(section.raw);
    const hardHeadingSignals = [
      "世界观",
      "底色",
      "铁律",
      "规则",
      "核心冲突",
      "终局",
      "world",
      "tonal",
      "rule",
      "core conflict",
      "endgame",
    ];
    if (hardHeadingSignals.some((signal) => heading.includes(normalizeForMatch(signal)))) {
      return true;
    }
    return matchesOutlineHints(sectionText, hints);
}

function isRelevantVolumeMapSection(
  section: MarkdownSection,
  hints: ReadonlyArray<string>,
  chapterNumber: number,
): boolean {
    const heading = normalizeForMatch(section.heading);
    if (headingMentionsChapter(heading, chapterNumber)) {
      return true;
    }
    return matchesOutlineHints(normalizeForMatch(section.raw), hints);
}

function matchesOutlineHints(sectionText: string, hints: ReadonlyArray<string>): boolean {
    for (const hint of hints) {
      const terms = extractMatchTerms(hint);
      if (terms.length === 0) continue;
      const hits = terms.filter((term) => sectionText.includes(term));
      if (hits.length >= Math.min(2, terms.length)) {
        return true;
      }
    }
    return false;
}

function fallbackOutlineSections(
  sections: ReadonlyArray<MarkdownSection>,
  kind: "story-frame" | "volume-map",
  chapterNumber: number,
): ReadonlyArray<MarkdownSection> {
    if (kind === "volume-map") {
      const chapterHit = sections.find((section) =>
        headingMentionsChapter(normalizeForMatch(section.heading), chapterNumber),
      );
      if (chapterHit) return [chapterHit];
    }
    return sections.slice(0, 1);
}

function extractMatchTerms(value: string): string[] {
    const normalized = normalizeForMatch(value);
    const terms = new Set<string>();
    for (const term of normalized.match(/[a-z0-9]{3,}/g) ?? []) {
      terms.add(term);
    }
    for (const term of normalized.match(/[\u4e00-\u9fff]{2,}/g) ?? []) {
      terms.add(term);
    }
    return [...terms].filter((term) => term.length >= 2);
}

function normalizeForMatch(value: string): string {
    return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function headingMentionsChapter(normalizedHeading: string, chapterNumber: number): boolean {
    return normalizedHeading.includes(`chapter ${chapterNumber}`)
      || normalizedHeading.includes(`chapter${chapterNumber}`)
      || normalizedHeading.includes(`ch.${chapterNumber}`)
      || normalizedHeading.includes(`ch${chapterNumber}`)
      || normalizedHeading.includes(`第${chapterNumber}章`);
}

function slugifyAnchor(value: string): string {
    return value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
      .replace(/^-+|-+$/g, "")
      || "section";
}

function dedupeBySource(entries: ContextPackage["selectedContext"]): ContextPackage["selectedContext"] {
    const seen = new Set<string>();
    return entries.filter((entry) => {
      if (seen.has(entry.source)) return false;
      seen.add(entry.source);
      return true;
    });
}

async function maybeAuditDriftSource(storyDir: string, chapterNumber: number): Promise<ContextPackage["selectedContext"][number] | null> {
    const content = await readFileOrDefault(join(storyDir, "audit_drift.md"));
    if (!content || content === "(文件尚未创建)") return null;
    const { frontmatter, body } = parseFrontmatter(content);
    const fm = frontmatter as Record<string, unknown> | undefined;
    if (fm?.appliesToChapter !== chapterNumber) return null;
    const sourceChapter = fm.sourceChapter;
    return {
        source: `story/audit_drift.md#applies-to-${chapterNumber}`,
        reason: typeof sourceChapter === "number"
            ? `Carry forward audit drift guidance from chapter ${sourceChapter} for this chapter only.`
            : "Carry forward audit drift guidance for this chapter only.",
        excerpt: pickExcerpt(body, []),
    };
}

interface ParsedFrontmatter {
    readonly frontmatter?: Record<string, unknown>;
    readonly body: string;
}

function parseFrontmatter(content: string): ParsedFrontmatter {
    const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
    if (!match) {
        return { body: content };
    }
    try {
        const parsed: unknown = YAML.load(match[1]!);
        const frontmatter = parsed && typeof parsed === "object" && !Array.isArray(parsed)
            ? parsed as Record<string, unknown>
            : undefined;
        return { frontmatter, body: match[2] ?? "" };
    } catch {
        return { body: content };
    }
}

function pickExcerpt(content: string, preferredExcerpts: string[]): string {
    for (const preferred of preferredExcerpts) {
        if (preferred && content.includes(preferred)) return preferred;
    }
    return content
        .split("\n")
        .map((line) => line.trim())
        .find((line) => line.length > 0 && !line.startsWith("#")) ?? "";
}

function extractSection(content: string, anchor: string): string | null {
    const lines = content.split("\n");
    const idx = lines.findIndex((line) => line.trim() === `## ${anchor}`);
    if (idx === -1) return null;
    const section: string[] = [];
    for (let i = idx + 1; i < lines.length; i++) {
        const line = lines[i]!;
        if (/^##\s/.test(line.trim())) break;
        section.push(line);
    }
    const result = section.join("\n").trim();
    return result || null;
}

function castNameMatches(left: unknown, right: unknown): boolean {
    if (!left || !right) return false;
    const a = String(left).trim().toLowerCase();
    const b = String(right).trim().toLowerCase();
    if (a === b) return true;
    const firstSeg = (s: string): string => s.split(/[·・•‧･\s]+/)[0] ?? s;
    return a === firstSeg(b) || b === firstSeg(a);
}

interface ActiveCastEntry {
    readonly name: string;
    readonly presence?: string;
    readonly dialoguePermission?: string;
    readonly chapterFunction?: string;
    readonly voiceFocus?: string;
    readonly informationBoundary?: string;
    readonly relationshipPressure?: string;
    readonly mustNotDo?: string;
    readonly [key: string]: string | undefined;
}

async function buildActiveRoleContextEntries(
    storyDir: string,
    memoBody: string,
    language: "zh" | "en",
): Promise<ContextPackage["selectedContext"]> {
    const activeCast = extractActiveCastEntries(memoBody)
        .filter((entry) => entry.name && entry.presence === "present");
    if (activeCast.length === 0) {
        return [];
    }
    const roleCards = await readRoleCards(storyDir);
    return activeCast.flatMap((castEntry) => {
        const roleCard = roleCards.find((card) => castNameMatches(card.name, castEntry.name));
        if (!roleCard) {
            return [];
        }
        return [{
            source: `story/${roleCard.relativePath}`,
            reason: language === "en"
                ? "Active cast role card selected by the chapter memo."
                : "由本章出场人物清单选中的人物卡。",
            excerpt: compressRoleCardForChapter(roleCard.content, castEntry, language),
        }];
    });
}

function extractActiveCastEntries(memoBody: string): ActiveCastEntry[] {
    const section = extractLooseSection(memoBody, ["本章出场人物", "Active Cast"]);
    if (!section) {
        return [];
    }
    const tableEntries = extractActiveCastTableEntries(section);
    const entries: ActiveCastEntry[] = [...tableEntries];
    let current: Record<string, string> | undefined;
    for (const rawLine of section.split("\n")) {
        const line = rawLine.trim();
        if (!line || line.startsWith("|")) {
            continue;
        }
        const nameMatch = line.match(/^(?:[-*]\s*)?(?:name|姓名|角色|人物)\s*[:：]\s*(.+)$/i);
        if (nameMatch) {
            if (current?.name) {
                entries.push(current as ActiveCastEntry);
            }
            current = { name: normalizeCastValue(nameMatch[1]!) };
            continue;
        }
        const inlineEntry = extractInlineCastEntry(line);
        if (inlineEntry) {
            if (current?.name) {
                entries.push(current as ActiveCastEntry);
                current = undefined;
            }
            entries.push(inlineEntry);
            continue;
        }
        if (!current) {
            continue;
        }
        const fieldMatch = line.match(/^(?:[-*]\s*)?(presence|出场状态|dialoguePermission|对话权限|chapterFunction|本章功能|voiceFocus|声音重点|informationBoundary|信息边界|relationshipPressure|关系压力|mustNotDo|禁止表现)\s*[:：]\s*(.+)$/i);
        if (!fieldMatch) {
            continue;
        }
        const key = normalizeCastKey(fieldMatch[1]!);
        current[key] = normalizeCastValue(fieldMatch[2]!);
    }
    if (current?.name) {
        entries.push(current as ActiveCastEntry);
    }
    const deduped = new Map<string, ActiveCastEntry>();
    for (const entry of entries) {
        if (!entry.name) {
            continue;
        }
        const normalized: ActiveCastEntry = {
            ...entry,
            presence: normalizePresence(entry.presence),
        };
        const existing = deduped.get(normalized.name);
        deduped.set(normalized.name, { ...(existing ?? {}), ...normalized });
    }
    return [...deduped.values()];
}

function extractActiveCastTableEntries(section: string): ActiveCastEntry[] {
    const rows = section.split("\n").map((line) => line.trim()).filter((line) => line.startsWith("|") && !/^\|?\s*-+\s*\|/.test(line));
    if (rows.length < 2) {
        return [];
    }
    const headers = parseMarkdownRow(rows[0]!).map(normalizeCastHeader);
    return rows.slice(1).flatMap((row) => {
        const cells = parseMarkdownRow(row);
        const entry: Record<string, string> = {};
        headers.forEach((header, index) => {
            if (!header || !cells[index]) {
                return;
            }
            entry[header] = normalizeCastValue(cells[index]!);
        });
        return entry.name ? [entry as ActiveCastEntry] : [];
    });
}

function parseMarkdownRow(line: string): string[] {
    return line.split("|").slice(1, -1).map((cell) => cell.trim());
}

function normalizeCastHeader(header: string): string {
    const key = header.trim();
    if (/^(name|姓名|角色|人物)$/i.test(key)) return "name";
    if (/^(presence|出场状态)$/i.test(key)) return "presence";
    if (/^(dialoguePermission|对话权限)$/i.test(key)) return "dialoguePermission";
    if (/^(chapterFunction|本章功能)$/i.test(key)) return "chapterFunction";
    if (/^(voiceFocus|声音重点)$/i.test(key)) return "voiceFocus";
    if (/^(informationBoundary|信息边界)$/i.test(key)) return "informationBoundary";
    if (/^(relationshipPressure|关系压力)$/i.test(key)) return "relationshipPressure";
    if (/^(mustNotDo|禁止表现)$/i.test(key)) return "mustNotDo";
    return "";
}

function extractInlineCastEntry(line: string): ActiveCastEntry | null {
    const name = line.match(/^[-*]\s*([^：:，,|\s]+)\s*[：:]/)?.[1];
    if (!name) {
        return null;
    }
    const entry: Record<string, string> = { name: normalizeCastValue(name) };
    const fieldPattern = /(presence|出场状态|dialoguePermission|对话权限|chapterFunction|本章功能|voiceFocus|声音重点|informationBoundary|信息边界|relationshipPressure|关系压力|mustNotDo|禁止表现)\s*[:：]\s*([^|，,；;]+)/gi;
    let match: RegExpExecArray | null;
    while ((match = fieldPattern.exec(line)) !== null) {
        entry[normalizeCastKey(match[1]!)] = normalizeCastValue(match[2]!);
    }
    if (!entry.presence) {
        if (/不出场|offstage|未出场|幕后/i.test(line)) {
            entry.presence = "offstage";
        } else if (/提及|mentioned/i.test(line)) {
            entry.presence = "mentioned";
        } else if (/出场|在场|present/i.test(line)) {
            entry.presence = "present";
        }
    }
    return entry as ActiveCastEntry;
}

function extractLooseSection(content: string, headings: ReadonlyArray<string>): string {
    const lines = content.split("\n");
    const start = lines.findIndex((line) => headings.some((heading) => line.trim() === `## ${heading}` || line.trim() === `### ${heading}`));
    if (start < 0) {
        return "";
    }
    const section: string[] = [];
    for (let i = start + 1; i < lines.length; i += 1) {
        const line = lines[i]!;
        if (/^#{2,3}\s/.test(line.trim())) {
            break;
        }
        section.push(line);
    }
    return section.join("\n").trim();
}

function normalizeCastKey(key: string): string {
    const normalized = key.toLowerCase();
    if (normalized === "出场状态") return "presence";
    if (normalized === "对话权限") return "dialoguePermission";
    if (normalized === "本章功能") return "chapterFunction";
    if (normalized === "声音重点") return "voiceFocus";
    if (normalized === "信息边界") return "informationBoundary";
    if (normalized === "关系压力") return "relationshipPressure";
    if (normalized === "禁止表现") return "mustNotDo";
    return key;
}

function normalizeCastValue(value: string): string {
    return value.replace(/^[-*]\s*/, "").trim();
}

function normalizePresence(value: unknown): string {
    const normalized = String(value ?? "").toLowerCase();
    if (normalized.includes("offstage") || normalized.includes("不出场") || normalized.includes("未出场") || normalized.includes("幕后")) {
        return "offstage";
    }
    if (normalized.includes("mentioned") || normalized.includes("提及")) {
        return "mentioned";
    }
    if (normalized.includes("present") || normalized.includes("出场") || normalized.includes("在场")) {
        return "present";
    }
    return normalized;
}

interface RoleCard {
    readonly name: string;
    readonly relativePath: string;
    readonly content: string;
}

async function readRoleCards(storyDir: string): Promise<ReadonlyArray<RoleCard>> {
    const rolesDir = join(storyDir, "roles");
    const cards: RoleCard[] = [];
    try {
        const tiers = await readdir(rolesDir, { withFileTypes: true });
        for (const tier of tiers) {
            if (!tier.isDirectory()) {
                continue;
            }
            const tierDir = join(rolesDir, tier.name);
            const files = await readdir(tierDir, { withFileTypes: true });
            for (const file of files) {
                if (!file.isFile() || !file.name.endsWith(".md")) {
                    continue;
                }
                const absolutePath = join(tierDir, file.name);
                const content = await readFile(absolutePath, "utf-8");
                cards.push({
                    name: file.name.replace(/\.md$/i, ""),
                    relativePath: `roles/${tier.name}/${file.name}`,
                    content,
                });
            }
        }
    } catch {
        return [];
    }
    return cards;
}

function compressRoleCardForChapter(content: string, castEntry: ActiveCastEntry, language: "zh" | "en"): string {
    const anchors = language === "en"
        ? [
            "One-line living anchor",
            "Basic info",
            "Personality",
            "Inner profile",
            "Core desire",
            "Core fear",
            "Image",
            "Childhood",
            "Environmental influence",
            "Goals and regrets",
            "Protagonist arc",
            "Growth arc",
            "Social relations",
            "Relationship network",
            "Relationship modulation",
            "Emotional state",
            "Romance dynamics",
            "Romance conflicts",
            "Special companion",
            "Ability setup",
            "Action principle",
            "Action pattern",
            "Contrast detail",
            "Secrets",
            "Information boundary",
            "Verbal tics and habits",
            "Voice",
            "Dialogue samples",
            "Forbidden phrases",
            "Inner monologue vs spoken line",
            "Current status",
            "Back story",
        ]
        : [
            "一句话活人锚点",
            "基本信息",
            "性格设定",
            "内心侧写",
            "核心欲望",
            "核心恐惧",
            "形象",
            "童年经历",
            "环境影响",
            "目标与遗憾",
            "主角弧线",
            "主角弧线（起点 → 终点 → 代价）",
            "成长弧光",
            "社交关系",
            "关系网络",
            "关系变调",
            "情感状态",
            "恋爱相处",
            "恋爱矛盾",
            "特殊伙伴",
            "能力设定",
            "行动原理",
            "行动惯性",
            "反差细节",
            "秘密",
            "信息边界",
            "口头禅习惯",
            "说话风格",
            "台词样本",
            "禁用句式",
            "内心独白 vs 出口台词",
            "当前现状",
            "当前现状（第 0 章初始状态）",
            "人物小传（过往经历）",
        ];
    const sections = anchors
        .map((anchor) => {
            const section = extractSection(content, anchor);
            return section ? `## ${anchor}\n${section}` : undefined;
        })
        .filter(Boolean)
        .join("\n\n");
    const castNotes = [
        castEntry.chapterFunction ? `chapterFunction=${castEntry.chapterFunction}` : undefined,
        castEntry.dialoguePermission ? `dialoguePermission=${castEntry.dialoguePermission}` : undefined,
        castEntry.voiceFocus ? `voiceFocus=${castEntry.voiceFocus}` : undefined,
        castEntry.informationBoundary ? `informationBoundary=${castEntry.informationBoundary}` : undefined,
        castEntry.relationshipPressure ? `relationshipPressure=${castEntry.relationshipPressure}` : undefined,
        castEntry.mustNotDo ? `mustNotDo=${castEntry.mustNotDo}` : undefined,
    ].filter(Boolean).join(" | ");
    const body = sections || content.split("\n").filter((line) => line.trim()).slice(0, 30).join("\n");
    return [castNotes, body].filter(Boolean).join("\n\n").slice(0, 4500);
}

function outlineFallback(fileName: string): string | null {
    if (fileName === "outline/story_frame.md") return "story_bible.md";
    if (fileName === "outline/volume_map.md") return "volume_outline.md";
    return null;
}

function toFactAnchor(predicate: string): string {
    return predicate
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
      .replace(/^-+|-+$/g, "")
      || "fact";
}

async function readFileOrDefault(path: string): Promise<string> {
  try {
    return await readFile(path, "utf-8");
  } catch {
    return "(文件尚未创建)";
  }
}

function findHookSummary(
  summaries: ReadonlyArray<ReturnType<typeof parseChapterSummariesMarkdown>[number]>,
  hookId: string,
  chapter: number,
  mode: "seed" | "latest",
) {
  const directChapterHit = summaries.find((summary) => summary.chapter === chapter);
  const hookMentions = summaries.filter((summary) => summaryMentionsHook(summary, hookId));
  if (mode === "seed") {
    return hookMentions.find((summary) => summary.chapter === chapter)
      ?? hookMentions.at(0)
      ?? directChapterHit;
  }

  return [...hookMentions].reverse().find((summary) => summary.chapter === chapter)
    ?? hookMentions.at(-1)
    ?? directChapterHit;
}

function summaryMentionsHook(
  summary: ReturnType<typeof parseChapterSummariesMarkdown>[number],
  hookId: string,
): boolean {
  return [
    summary.title,
    summary.events,
    summary.stateChanges,
    summary.hookActivity,
  ].some((text) => text.includes(hookId));
}

function renderHookDebtBeat(
  summary: ReturnType<typeof parseChapterSummariesMarkdown>[number],
): string {
  return `ch${summary.chapter} ${summary.title} - ${summary.events || summary.hookActivity || summary.stateChanges || "(none)"}`;
}
