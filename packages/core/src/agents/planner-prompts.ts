/**
 * Planner prompts — loaded from external .md files for easy editing.
 * Only routing and interpolation logic remains here.
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));

// Cached template loading — read once, reuse forever
const _cache: Record<string, string> = {};
function loadPrompt(filename: string): string {
  if (!_cache[filename]) {
    _cache[filename] = readFileSync(join(dir, "prompts", filename), "utf-8").trim();
  }
  return _cache[filename]!;
}

// Re-export for backward compatibility (index.js imports these names)
export const PLANNER_MEMO_SYSTEM_PROMPT = loadPrompt("planner-system-zh.md");
export const PLANNER_MEMO_SYSTEM_PROMPT_EN = loadPrompt("planner-system-en.md");
export const PLANNER_MEMO_USER_TEMPLATE_EN = loadPrompt("planner-user-en.md");
export const PLANNER_MEMO_USER_TEMPLATE = loadPrompt("planner-user-zh.md");

// ---------------------------------------------------------------------------
// Public API — same interface as before
// ---------------------------------------------------------------------------

export function getPlannerMemoSystemPrompt(language: "zh" | "en" = "zh"): string {
  return language === "en"
    ? loadPrompt("planner-system-en.md")
    : loadPrompt("planner-system-zh.md");
}

export function getPlannerMemoUserTemplate(language: "zh" | "en" = "zh"): string {
  return language === "en"
    ? loadPrompt("planner-user-en.md")
    : loadPrompt("planner-user-zh.md");
}

export interface PlannerUserMessageInput {
  readonly chapterNumber: number;
  readonly previousChapterEndingExcerpt: string;
  readonly recentSummaries: string;
  readonly currentArcProse: string;
  readonly protagonistMatrixRow: string;
  readonly opponentRows: string;
  readonly collaboratorRows: string;
  readonly relevantThreads: string;
  readonly recyclableHooks: string;
  readonly isGoldenOpening: boolean;
  readonly bookRulesRelevant: string;
  readonly brief?: string;
  readonly chapterContext?: string;
  readonly language?: "zh" | "en";
  readonly worldviewPlanningContext?: string;
  readonly rolePlanningContext?: string;
  readonly characterItemStateContext?: string;
  readonly glossary?: string;
  readonly archivedContext?: string;
  readonly chapterSkeletonContext?: string;
  readonly allianceState?: string;
  readonly warResourceContext?: string;
  readonly castRegistry?: string;
}

export function buildPlannerUserMessage(input: PlannerUserMessageInput): string {
  const language = input.language ?? "zh";
  const template = getPlannerMemoUserTemplate(language);
  const yesText = language === "en" ? "yes" : "是";
  const noText = language === "en" ? "no" : "否";
  const briefBlock = buildBriefBlock(input.brief ?? "", language);
  const chapterContextBlock = buildChapterContextBlock(input.chapterContext ?? "", language);
  const filled = template
    .replaceAll("{{chapterNumber}}", String(input.chapterNumber))
    .replaceAll("{{brief_block}}", briefBlock)
    .replaceAll("{{chapter_context_block}}", chapterContextBlock)
    .replaceAll("{{previous_chapter_ending_excerpt}}", input.previousChapterEndingExcerpt)
    .replaceAll("{{recent_summaries}}", input.recentSummaries)
    .replaceAll("{{current_arc_prose}}", input.currentArcProse)
    .replaceAll("{{protagonist_matrix_row}}", input.protagonistMatrixRow)
    .replaceAll("{{opponent_rows}}", input.opponentRows)
    .replaceAll("{{collaborator_rows}}", input.collaboratorRows)
    .replaceAll("{{worldview_context}}", input.worldviewPlanningContext ?? "")
    .replaceAll("{{role_context}}", input.rolePlanningContext ?? "")
    .replaceAll("{{item_state_context}}", input.characterItemStateContext ?? "")
    .replaceAll("{{relevant_threads}}", input.relevantThreads)
    .replaceAll("{{glossary}}", input.glossary ?? "")
    .replaceAll("{{recyclable_hooks}}", input.recyclableHooks)
    .replaceAll("{{archived_context}}", input.archivedContext ?? "")
    .replaceAll("{{chapter_skeleton}}", input.chapterSkeletonContext ?? "")
    .replaceAll("{{isGoldenOpening}}", input.isGoldenOpening ? yesText : noText)
    .replaceAll("{{book_rules_relevant}}", input.bookRulesRelevant)
    .replaceAll("{{alliance_state}}", input.allianceState ?? "")
    .replaceAll("{{war_resource_context}}", input.warResourceContext ?? "")
    .replaceAll("{{cast_registry}}", input.castRegistry ?? "");
  const golden = buildGoldenOpeningGuidance(input.chapterNumber, language);
  return golden ? `${filled}\n\n${golden}` : filled;
}

/**
 * Brief is the user's original creative document. It's the highest authority
 * source for "what this book is". story_frame/volume_map are the architect's
 * abstraction of brief; chapter memos must honor brief first.
 *
 * Returns "" when no brief exists (legacy books without brief.md).
 */
function buildBriefBlock(brief: string, language: "zh" | "en"): string {
  const trimmed = brief.trim();
  if (!trimmed) return "";
  if (language === "en") {
    return `## Creative brief (user's original intent — authoritative)
${trimmed}

The brief is the user's direct instruction. When planning this chapter, honor the brief's core setup (protagonist concept, world premise, opening mechanics, sample chapter hooks if any) before anything else. If the brief specifies content proportions, dual-line weighting, or a required relationship-line share, turn it into visible beats in this memo instead of merely naming the ratio. Do NOT defer the brief's core setup to later chapters; land it early.`;
  }
  return `## 用户创作 brief（原始意图——最高优先级）
${trimmed}

brief 是用户的直接指令。本章规划时，必须优先兑现 brief 里写明的核心设定（主角设定、世界前提、开场机制、样本章回钩子等）。如果 brief 里指定了内容比例、双主线权重或某条关系线必须占比，本章 memo 要把它拆成可见场面，而不是只在总结里提一句。**不要把 brief 里的核心设定推迟到后面的章节**——该在前几章落地的必须落地。`;
}

function buildChapterContextBlock(chapterContext: string, language: "zh" | "en"): string {
  const trimmed = chapterContext.trim();
  if (!trimmed) return "";
  if (language === "en") {
    return `## Per-chapter user instruction (highest priority for this chapter)
${trimmed}

This is the user's direct instruction for the current chapter. The memo must obey it before the outline fallback. If the user specifies a chapter title, preserve that title exactly in the memo so the writer can use it as CHAPTER_TITLE. If it conflicts with the volume outline, reconcile by keeping continuity but following this chapter instruction.`;
  }
  return `## 本章用户指令（本章最高优先级）
${trimmed}

这是用户对当前章节的直接指令。memo 必须优先遵守它，再参考卷纲兜底。如果用户指定了章节标题，必须在 memo 中原样保留该标题，供写手作为 CHAPTER_TITLE 使用。若它与卷纲不完全一致，保持连续性，但以本章用户指令为准。`;
}

// ---------------------------------------------------------------------------
// 黄金三章 prose guidance — Phase 6.5
// ---------------------------------------------------------------------------

export function buildGoldenOpeningGuidance(
  chapterNumber: number,
  language: "zh" | "en" = "zh",
): string {
  if (chapterNumber > 3) return "";
  if (language === "en") {
    return `## Golden Opening Guidance — Chapter ${chapterNumber}

This is chapter ${chapterNumber} of the opening three — the chapters that decide whether a reader stays. The Golden Three Chapters rule assigns each chapter a load-bearing slot: chapter 1 must throw the reader straight into the core conflict (the protagonist enters already facing the main contradiction — chase, dead-end, dispossession, transmigration-as-crisis), not a paragraph of background, family tree, weather, or dynastic preamble. Chapter 2 must put the protagonist's edge — the system, the power, the rebirth-memory, the information advantage — on the stage through one concrete event (not "he awakened a power" narrated, but "he used it for X and Y happened"). Chapter 3 must lock in a concrete short-term goal achievable within the next 3-10 chapters (build the first stake of capital, take down the small antagonist, save someone), giving the story forward pull.

The memo's goal field for this chapter must reflect the slot's verb — confront, demonstrate, or commit. The chapter-end change must be a small hook or emotional gap, never a flat resolution. Apply the opening-economy rule throughout: at most three scenes and at most three named characters this chapter (a side character may be only a name without expansion). Information layering is mandatory — basic facts (appearance, status, situation) ride on the protagonist's actions, world rules ride on plot triggers; do not stage a paragraph of exposition.`;
  }
  return `## 黄金三章规划指引 — 第 ${chapterNumber} 章

这是开篇三章中的第 ${chapterNumber} 章——决定读者是否留下来的关键章节。黄金三章法则给每一章分了硬槽位：第 1 章必须把主角直接抛进核心冲突里（主角出场即面对主线矛盾——追杀、死局、被夺权、穿越即危机），不要拿背景、家族、天气、朝代铺垫开场。第 2 章必须让金手指落地一次——系统/能力/重生记忆/信息差，必须通过**一次具体事件**展现出来（不是"他觉醒了 XX"的旁白，而是"他用了 XX，发生了 YY"）。第 3 章必须给主角钉下一个 3-10 章内可达成的具体短期目标（攒第一桶金、干翻某小反派、救某人），给故事一条往前拉的引力线。

本章 memo 的 goal 字段必须体现对应槽位的动词——抛出、展现、或锁定。章尾必须发生的改变要落在小钩子或情绪缺口上，不要写成平稳收束。开篇精简原则贯穿本章：场景 ≤ 3 个、人物 ≤ 3 个（配角可以只报名字，不展开）。信息分层强制要求：基础信息（外貌、身份、处境）通过主角行动自然带出，世界规则（设定、势力、底层逻辑）结合剧情节点揭示，禁止整段 exposition。`;
}
