import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { BaseAgent } from "./base.js";
import { readBookRules as readAuthoritativeBookRules } from "./rules-reader.js";
import { ChapterIntentSchema, } from "../models/input-governance.js";
import { renderHookSnapshot, renderSummarySnapshot, parsePendingHooksMarkdown, } from "../utils/memory-retrieval.js";
import { gatherPlanningMaterials, loadPlanningSeedMaterials, } from "../utils/planning-materials.js";
import { readDynamicStoryFileAsOf } from "../state/runtime-state-store.js";
import { parseMemo, PlannerParseError } from "../utils/chapter-memo-parser.js";
import { collectStaleHookDebt } from "../utils/hook-governance.js";
import { readRoleCards, readStoryFrame } from "../utils/outline-paths.js";
import { buildPlannerUserMessage, getPlannerMemoSystemPrompt, } from "./planner-prompts.js";
import { composeCurrentArcProse, extractCollaboratorRows, extractOpponentRows, extractProtagonistRow, extractRelevantThreads, formatRecentSummaries, formatRecyclableHooks, readBookRules, readCharacterMatrix, readEmotionalArcs, readGlossary, readPendingHooks, readSubplotBoard, readWarLedgers, composeWarResourceSummary, readPhaseOutline, parsePhaseOutline, findCurrentPhase, composePhaseContext, readChapterSkeleton, extractSkeletonEntry, composeSkeletonContext, readCastRegistry, readItemCatalog, readFactionMap, } from "./planner-context.js";
import { renderWorldviewPlanningContext } from "./planner-worldview-context.js";
import { renderRolePlanningContext } from "./planner-role-context.js";
import { renderCharacterItemStateContext } from "./planner-item-state-context.js";
const MEMO_RETRY_LIMIT = 3;
/**
 * Phase 3 planner.
 *
 * Produces:
 *   - a simplified ChapterIntent (goal + outline + keep/avoid/style) —
 *     still deterministic, used for retrieval hints and the intent markdown.
 *   - a full ChapterMemo (YAML frontmatter + 7-section markdown body) via
 *     LLM call + strict parser.
 *
 * Retry policy: up to 3 attempts. Each failed parse appends an error
 * feedback block to the user message and re-invokes the LLM. If all attempts
 * fail, the planner emits a degraded but valid memo with an explicit warning
 * instead of crashing the whole chapter pipeline.
 */
export class PlannerAgent extends BaseAgent {
    get name() {
        return "planner";
    }
    async planChapter(input) {
        const storyDir = join(input.bookDir, "story");
        const runtimeDir = join(storyDir, "runtime");
        await mkdir(runtimeDir, { recursive: true });
        const seedMaterials = await loadPlanningSeedMaterials({
            bookDir: input.bookDir,
            chapterNumber: input.chapterNumber,
            asOfChapter: input.asOfChapter,
        });
        // Three-layer outline: read phase outline (阶段纲) for hard constraints
        const phaseOutlineRaw = await readPhaseOutline(input.bookDir);
        const phases = parsePhaseOutline(phaseOutlineRaw);
        const currentPhase = findCurrentPhase(phases, input.chapterNumber);
        const outlineNode = this.findOutlineNode(seedMaterials.volumeOutline, input.chapterNumber);
        // Four-layer outline: read chapter skeleton for per-chapter beats
        const chapterSkeletonRaw = await readChapterSkeleton(input.bookDir);
        const skeletonEntry = extractSkeletonEntry(chapterSkeletonRaw, input.chapterNumber);
        const goal = this.deriveGoal(input.externalContext, seedMaterials.currentFocus, seedMaterials.authorIntent, outlineNode, input.chapterNumber, currentPhase, skeletonEntry);
        // Phase hotfix 5: read structured rules through the Phase 5 authoritative
        // loader. It prefers outline/story_frame.md frontmatter, falls back to
        // legacy book_rules.md, and refuses to silently zero out rules when the
        // legacy file is just a compat shim. Reading raw bookRulesRaw via
        // parseBookRules() bypassed all of that.
        const parsedRules = await readAuthoritativeBookRules(input.bookDir);
        const prohibitions = parsedRules?.rules.prohibitions ?? [];
        const mustKeep = this.collectMustKeep(seedMaterials.currentState, seedMaterials.storyBible);
        const mustAvoid = this.collectMustAvoid(seedMaterials.currentFocus, prohibitions);
        const styleEmphasis = this.collectStyleEmphasis(seedMaterials.authorIntent, seedMaterials.currentFocus);
        const materials = await gatherPlanningMaterials({
            bookDir: input.bookDir,
            chapterNumber: input.chapterNumber,
            asOfChapter: input.asOfChapter,
            asOfSnapshot: input.asOfSnapshot,
            goal,
            outlineNode,
            mustKeep,
            seed: seedMaterials,
        });
        const memorySelection = materials.memorySelection;
        // [Plan 1] Sort hooks by resolvePressure descending, mark top 3 as high priority
        if (Array.isArray(memorySelection.hooks)) {
            const sortedHooks = [...memorySelection.hooks].sort((a, b) => ((b.resolvePressure ?? 0) - (a.resolvePressure ?? 0)));
            const markedHooks = sortedHooks.map((hook, index) => ({
                ...hook,
                highPriority: index < 3 || (hook.resolvePressure ?? 0) >= 0.7,
            }));
            memorySelection.hooks = markedHooks;
        }
        if (Array.isArray(memorySelection.recyclableHooks)) {
            memorySelection.recyclableHooks = [...memorySelection.recyclableHooks].sort((a, b) => ((b.resolvePressure ?? 0) - (a.resolvePressure ?? 0)));
        }
        const activeHookCount = Array.isArray(memorySelection.activeHooks) ? memorySelection.activeHooks.filter((hook) => hook.status !== "resolved" && hook.status !== "deferred").length : 0;
        const arcContext = this.buildArcContext(input.book.language, seedMaterials.volumeOutline, outlineNode);
        const intent = ChapterIntentSchema.parse({
            chapter: input.chapterNumber,
            goal,
            outlineNode,
            arcContext,
            mustKeep,
            mustAvoid,
            styleEmphasis,
        });
        const isGoldenOpening = this.isGoldenOpeningChapter(input.book.language, input.chapterNumber);
        const memo = await this.planChapterMemo({
            storyDir,
            bookDir: input.bookDir,
            chapterNumber: input.chapterNumber,
            isGoldenOpening,
            fallbackGoal: goal,
            chapterSummariesRaw: seedMaterials.chapterSummariesRaw,
            previousEndingExcerpt: seedMaterials.previousEndingExcerpt,
            brief: seedMaterials.brief,
            chapterContext: input.externalContext,
            recyclableHooks: memorySelection.recyclableHooks,
            asOfChapter: input.asOfChapter,
            language: input.book.language ?? "zh",
            phases,
            pacingDirective: materials.pacingDirective,
            diagnosisInjection: materials.diagnosisInjection,
            coachInjection: materials.coachInjection,
        });
        // memo.goal is LLM-produced and specific (<=50 chars, validated).
        // Overwrite intent.goal so downstream composer/retrieval gets the
        // concrete task statement instead of the outline-derived fallback.
        intent.goal = memo.goal;
        const runtimePath = join(runtimeDir, `chapter-${String(input.chapterNumber).padStart(4, "0")}.intent.md`);
        const intentMarkdown = this.renderIntentMarkdown(intent, memo, input.book.language ?? "zh", renderHookSnapshot(memorySelection.hooks, input.book.language ?? "zh"), renderSummarySnapshot(memorySelection.summaries, input.book.language ?? "zh"), activeHookCount);
        await writeFile(runtimePath, intentMarkdown, "utf-8");
        return {
            intent,
            memo,
            intentMarkdown,
            plannerInputs: materials.plannerInputs,
            asOfChapter: input.asOfChapter,
            runtimePath,
        };
    }
    /**
     * Invoke the LLM to produce a 7-section memo and parse it. Retries up to
     * 3 times on parse failure, injecting the error message back into the user
     * prompt so the LLM can correct itself.
     */
    async planChapterMemo(input) {
        const dynamicStoryFile = (fileName) => typeof input.asOfChapter === "number"
            ? readDynamicStoryFileAsOf(input.bookDir, input.asOfChapter, fileName)
            : undefined;
        const [characterMatrix, runtimeCharacterMatrix, subplotBoard, emotionalArcs, pendingHooks, bookRulesRaw, glossary, allianceState, warLedgers, storyFrame, roleCards, archivedHooksRaw, volumeSummariesRaw, chapterSkeleton, castRegistry, itemCatalog, factionMap] = await Promise.all([
            dynamicStoryFile("character_matrix.md") ?? readCharacterMatrix(input.storyDir),
            dynamicStoryFile("character_matrix.md") ?? readFile(join(input.storyDir, "character_matrix.md"), "utf-8").catch(() => ""),
            dynamicStoryFile("subplot_board.md") ?? readSubplotBoard(input.storyDir),
            dynamicStoryFile("emotional_arcs.md") ?? readEmotionalArcs(input.storyDir),
            dynamicStoryFile("pending_hooks.md") ?? readPendingHooks(input.storyDir),
            readBookRules(input.storyDir),
            readGlossary(input.storyDir, input.language ?? "zh"),
            (dynamicStoryFile("alliance_state.md") ?? readFile(join(input.storyDir, "alliance_state.md"), "utf-8").catch(() => "")),
            readWarLedgers(input.storyDir),
            readStoryFrame(input.bookDir, ""),
            readRoleCards(input.bookDir),
            readFile(join(input.storyDir, "archived_hooks.md"), "utf-8").catch(() => ""),
            readFile(join(input.storyDir, "volume_summaries.md"), "utf-8").catch(() => ""),
            readChapterSkeleton(input.bookDir),
            readCastRegistry(input.storyDir),
            readItemCatalog(input.storyDir),
            readFactionMap(input.storyDir),
        ]);
        const language = input.language ?? "zh";
        const warResourceSummary = composeWarResourceSummary(warLedgers, language);
        // Echo wall: archived hooks + volume summaries for historical callbacks
        const ECHO_CONTEXT_LIMIT = 3000;
        const echoParts = [];
        if (archivedHooksRaw && archivedHooksRaw !== "(文件尚未创建)" && archivedHooksRaw.trim().length > 0) {
            const trimmed = archivedHooksRaw.length > ECHO_CONTEXT_LIMIT
                ? archivedHooksRaw.slice(0, ECHO_CONTEXT_LIMIT) + "\n…(已截断)"
                : archivedHooksRaw;
            echoParts.push(language === "en" ? "### Archived Hooks\n" + trimmed : "### 已归档伏笔\n" + trimmed);
        }
        if (volumeSummariesRaw && volumeSummariesRaw !== "(文件尚未创建)" && volumeSummariesRaw.trim().length > 0) {
            const trimmed = volumeSummariesRaw.length > ECHO_CONTEXT_LIMIT
                ? volumeSummariesRaw.slice(0, ECHO_CONTEXT_LIMIT) + "\n…(已截断)"
                : volumeSummariesRaw;
            echoParts.push(language === "en" ? "### Volume Summaries\n" + trimmed : "### 卷提要\n" + trimmed);
        }
        const archivedContext = echoParts.length > 0
            ? echoParts.join("\n\n")
            : (language === "en" ? "(no archived data yet)" : "（暂无归档数据）");
        // Three-layer outline: compose phase context for the planner
        // Reuse already-parsed phases from planChapter if available, otherwise read fresh
        const phases = input.phases ?? parsePhaseOutline(await readPhaseOutline(input.bookDir));
        const phaseContext = composePhaseContext(phases, input.chapterNumber, language);
        const noPriorChapter = language === "en"
            ? "(this is the opening chapter — no prior chapter)"
            : "（本章为起始章，无前章）";
        const noBookRules = language === "en"
            ? "(no book_rules entries)"
            : "（暂无 book_rules 条目）";
        const noGlossary = language === "en"
            ? "(no registered glossary terms yet)"
            : "（暂无已登记术语）";
        const retryFeedbackHeader = language === "en"
            ? "## Error from previous output"
            : "## 上次输出的错误";
        const retryFeedbackTrailer = language === "en"
            ? "Fix and re-emit."
            : "请修正后重新输出。";
        const [protagonistMatrixRow, opponentRows, collaboratorRows] = await Promise.all([
            extractProtagonistRow(characterMatrix, input.storyDir),
            extractOpponentRows(characterMatrix, 3, input.storyDir),
            extractCollaboratorRows(characterMatrix, 3, input.storyDir),
        ]);
        const worldviewPlanningContext = renderWorldviewPlanningContext(storyFrame, language);
        const rolePlanningContext = renderRolePlanningContext(roleCards, language);
        const characterItemStateContext = renderCharacterItemStateContext(runtimeCharacterMatrix, language);
        const chapterSkeletonContext = composeSkeletonContext(chapterSkeleton, input.chapterNumber, language);
        const userMessage = buildPlannerUserMessage({
            chapterNumber: input.chapterNumber,
            previousChapterEndingExcerpt: input.previousEndingExcerpt?.trim()
                ? input.previousEndingExcerpt.trim()
                : noPriorChapter,
            recentSummaries: formatRecentSummaries(input.chapterSummariesRaw, input.chapterNumber, 3),
            currentArcProse: composeCurrentArcProse(subplotBoard, emotionalArcs, input.chapterNumber),
            protagonistMatrixRow,
            opponentRows,
            collaboratorRows,
            worldviewPlanningContext,
            rolePlanningContext,
            characterItemStateContext,
            relevantThreads: extractRelevantThreads(pendingHooks, subplotBoard, input.chapterNumber),
            glossary: glossary.trim().length > 0 ? glossary.trim() : noGlossary,
            recyclableHooks: formatRecyclableHooks(input.recyclableHooks ?? [], input.chapterNumber, language),
            isGoldenOpening: input.isGoldenOpening,
            bookRulesRelevant: bookRulesRaw.trim().length > 0 ? bookRulesRaw.trim() : noBookRules,
            brief: input.brief ?? "",
            chapterContext: input.chapterContext ?? "",
            allianceState: allianceState.trim().length > 0 ? allianceState.trim() : "",
            warResourceContext: warResourceSummary.trim().length > 0 ? warResourceSummary.trim() : "",
            castRegistry: castRegistry.trim().length > 0 ? castRegistry.trim() : "",
            archivedContext,
            chapterSkeletonContext,
            language,
        });
        const systemPrompt = getPlannerMemoSystemPrompt(language);
        // [Plan 2] Compute stale hook debt and inject must_advance into chapter memo
        const parsedHooks = typeof pendingHooks === "string" ? (parsePendingHooksMarkdown?.(pendingHooks) ?? []) : (pendingHooks ?? []);
        const staleHookDebt = collectStaleHookDebt({
            hooks: parsedHooks.filter((h) => h.status !== "resolved" && h.status !== "deferred"),
            chapterNumber: input.chapterNumber,
            staleAfterChapters: 5,
        });
        let mustAdvanceInjection = "";
        if (staleHookDebt.length > 0) {
            const staleList = staleHookDebt.map((h) => "- " + h.hookId).join("\n");
            if (language === "en") {
                mustAdvanceInjection = "\n\n## Must Advance (Stale Hooks)\n" + staleList + "\nPrioritize resolving or advancing these hooks in this chapter memo.";
            } else {
                mustAdvanceInjection = "\n\n## 必须推进的伏笔（陈旧债务）\n" + staleList + "\n请在本章 memo 中优先安排推进或回收这些伏笔。";
            }
        }
        const activeCastPlanningContract = language === "en"
            ? "\n\n## Character Task Card Addendum\nAfter the required memo sections, add two extra markdown sections without changing the YAML frontmatter:\n\n## Chapter Task Card\n- chapterObjective: the concrete external change this chapter must deliver\n- sceneSituation: the visible opening/core situation, specific to place, present actors, and ongoing action\n- protagonistVisibleIntent: the protagonist's surface goal, action object, and why now\n- timePressure: the time constraint driving urgency (e.g. \"3 days left\", \"must return before sunset\"); write \"none — natural pacing\" if no explicit deadline\n- coreResistance: the concrete external obstacle blocking the protagonist (e.g. \"tickets monopolized by clan\", \"guards refuse entry\"); must be a visible barrier, not an abstract difficulty\n- archetypeCollision: the protagonist's persona mask vs. this chapter's action demand (e.g. \"must maintain aloof swordsman image, forced to use gambler tactics\"); write \"none — actions align with persona\" if no conflict\n- resourceStakes: expected cost — what resources are consumed (particle_ledger), what secrets are exposed, what consequences are planted (pending_hooks); format: \"spend X / expose Y → plant hook Z\"\n- immediateStakes: the immediate loss/exposure/missed chance if this scene fails\n- readerMustKnow: 3-5 front-stage facts as prose-ready causal beats\n- conceptLoadPlan: foreground new concepts and their reader handles; write n/a if none\n- actionLogicBridge: 1-3 short causal chains for complex action, terrain, rule, deduction, or transaction beats; write n/a if none\n- agencyPayoff: if pressure has run for 2+ chapters, name one visible counter-move and result; otherwise write n/a\n- readerMayWonder: 1-2 deeper answers that may stay withheld\n- conflictDriver: who/what pushes the scene pressure\n- dialogueJobs: what dialogue, silence, channel messages, or withheld speech must accomplish\n- exitStateChange: what must be different at the end\n- forbiddenMoves: what the writer must not add\n\n## Active Cast\nFor every character relevant to this chapter, list:\n- name:\n  presence: present | mentioned | offstage\n  dialoguePermission: speak | silent | channel_only | no_direct_line\n  chapterFunction:\n  voiceFocus:\n  informationBoundary:\n  relationshipPressure:\n  emotionalBeat: this character's core emotional slice this chapter — must directly guide the writer toward concrete action and micro-expressions\n    feeling: core emotion + intensity (e.g. \"anger forcibly suppressed\") — do not just write \"happy/sad\"\n    trigger: the emotional trigger — must be a concrete event this chapter or a carryover from the previous chapter\n    innerConflict: the internal pull (want to do X vs cannot do Y); write \"none — single-direction emotion\" if no conflict\n    surfaceBehavior: external behavior the writer can put directly into prose — action / micro-expression / tone / silence pattern\n  mustNotDo:\nOnly present characters may receive full role-card context later. mentioned/offstage characters must not be used for direct action or direct dialogue. For opening/solo survival chapters, do not force dialogue; use silence, action choices, and channel-only fragments instead."
            : "\n\n## 人物任务卡附加要求\n在原有必填 memo 段落之后，额外追加以下两个 markdown 段落，不要改 YAML frontmatter：\n\n## 本章任务卡\n- chapterObjective：本章必须完成的外部变化\n- sceneSituation：本章开场/核心场景的可见局面，具体到地点、在场者和正在发生的事\n- protagonistVisibleIntent：主角此刻的表层目标、行动对象和为什么现在行动\n- timePressure：本章的时间压力（如\"仅剩3天\"\"日落前必须返回\"）；没有明确时间限制则写\"无——节奏自然\"\n- coreResistance：本章核心阻力——什么在阻止主角达成目标（如\"门票被世家垄断\"\"守卫不放行\"）；必须是具体可见的障碍，不是抽象困难\n- archetypeCollision：主/副原型碰撞——主角的人设面具与本章行动需求之间的撕裂（如\"必须维持孤傲人设，却不得不动用赌徒手段\"）；没有人设冲突则写\"无——行动与人设一致\"\n- resourceStakes：预期收支——本章消耗什么资源（particle_ledger）、暴露什么底牌、引发什么后果（pending_hooks）；格式：\"消耗X / 暴露Y → 埋伏笔Z\"\n- immediateStakes：本场失败的即时损失/暴露/错失，不要写抽象风险\n- readerMustKnow：3-5 条正文可用的现场因果事实\n- conceptLoadPlan：本章前台新概念及读者抓手；没有则写“不适用”\n- actionLogicBridge：复杂行动、地形、规则、推理或交易的 1-3 条短因果链；没有则写“不适用”\n- agencyPayoff：如果连续承压超过 2 章，写出一个可见反制动作及结果；没有连续承压则写“不适用”\n- readerMayWonder：本章允许读者带着疑问离开的深层答案\n- conflictDriver：谁/什么推动本章压力\n- dialogueJobs：本章对话、沉默、频道碎片或未说出口的话承担什么功能\n- exitStateChange：章尾必须有什么不同\n- forbiddenMoves：writer 绝不能添加什么\n\n## 本章出场人物\n每个本章相关人物按以下格式列出：\n- name：\n  presence：present | mentioned | offstage\n  dialoguePermission：speak | silent | channel_only | no_direct_line\n  chapterFunction：\n  voiceFocus：\n  informationBoundary：\n  relationshipPressure：\n  emotionalBeat：本章此人的核心情绪切片，必须能直接指导 writer 写出具体动作和微表情\n    feeling：核心情绪 + 强度（如\"愤怒中强压冷静\"），不要只写\"开心/难过\"\n    trigger：情绪触发源，必须是本章具体事件或上一章遗留状态\n    innerConflict：内心拉扯（想做 X vs 不能做 Y），没有拉扯则写\"无——情绪单向\"\n    surfaceBehavior：外在表现，writer 可直接落进正文的动作/微表情/语气/沉默方式\n  mustNotDo：\n只有 present 人物后续才允许注入完整人物卡；mentioned/offstage 不得直接行动或直接说话。独处、逃生、黄金开篇章节不要强行加对话，要用沉默、动作选择和 channel_only 频道碎片体现人物。";
        const phaseInjection = phaseContext.trim().length > 0
            ? `\n\n${phaseContext}`
            : "";
        // Pacing corrective injection (P4)
        const pacingInjection = (input.pacingDirective ?? "").trim().length > 0
            ? `\n\n${input.pacingDirective}`
            : "";
        // Structured diagnosis injection (Diagnoser module)
        const diagnosisInjection = (input.diagnosisInjection ?? "").trim().length > 0
            ? `\n\n${input.diagnosisInjection}`
            : "";
        // Revision coach injection (readability + completeness from previous chapter)
        const coachInjection = (input.coachInjection ?? "").trim().length > 0
            ? `\n\n${input.coachInjection}`
            : "";
        let currentUserMessage = userMessage + phaseInjection + mustAdvanceInjection + pacingInjection + diagnosisInjection + coachInjection + activeCastPlanningContract;
        // User feedback injection for chapter outline regeneration
        if (input.userFeedback) {
            const feedbackBlock = language === "en"
                ? `\n\n## User Revision Instructions\n${input.userFeedback}\n\nPlease regenerate this chapter memo incorporating the above feedback. Keep the same memo structure and all required sections.`
                : `\n\n## 用户修改指令\n${input.userFeedback}\n\n请根据以上反馈重新生成本章 memo。保持相同的 memo 结构和所有必填段落。`;
            currentUserMessage += feedbackBlock;
        }
        let lastError;
        for (let attempt = 0; attempt < MEMO_RETRY_LIMIT; attempt += 1) {
            const response = await this.chat([
                { role: "system", content: systemPrompt },
                { role: "user", content: currentUserMessage },
            ], { temperature: 0.7 });
            try {
                return parseMemo(response.content, input.chapterNumber, input.isGoldenOpening);
            }
            catch (error) {
                if (!(error instanceof PlannerParseError)) {
                    throw error;
                }
                lastError = error;
                this.log?.warn(`[planner] memo parse failed (attempt ${attempt + 1}/${MEMO_RETRY_LIMIT}): ${error.message}`);
                const retryFeedback = input.userFeedback
                    ? (language === "en"
                        ? `\n\n## User Revision Instructions\n${input.userFeedback}\n\nPlease regenerate this chapter memo incorporating the above feedback.`
                        : `\n\n## 用户修改指令\n${input.userFeedback}\n\n请根据以上反馈重新生成本章 memo。`)
                    : "";
                currentUserMessage = `${userMessage}${phaseInjection}${mustAdvanceInjection}${activeCastPlanningContract}${retryFeedback}\n\n${retryFeedbackHeader}\n${error.message}\n${retryFeedbackTrailer}`;
            }
        }
        const fallbackError = lastError ?? new PlannerParseError("memo planner exhausted retries without a specific error");
        this.log?.warn(`[planner] memo planner fell back after ${MEMO_RETRY_LIMIT} attempts: ${fallbackError.message}`);
        return parseMemo(this.buildFallbackMemoMarkdown({
            chapterNumber: input.chapterNumber,
            isGoldenOpening: input.isGoldenOpening,
            fallbackGoal: input.fallbackGoal,
            errorMessage: fallbackError.message,
            language,
        }), input.chapterNumber, input.isGoldenOpening);
    }
    buildFallbackMemoMarkdown(input) {
        if (input.language === "en") {
            return [
                `# Chapter ${input.chapterNumber} memo`,
                "",
                "## Chapter goal",
                input.fallbackGoal || `Continue chapter ${input.chapterNumber} according to the current outline`,
                "",
                "## Thread refs",
                "none",
                "",
                "## Current task",
                `Use the current chapter goal and authoritative book context to continue chapter ${input.chapterNumber} without inventing a new direction.`,
                "",
                "## What the reader is waiting for right now",
                "Keep the reader's active expectation from the outline and previous chapter in focus; do not replace it with a generic scene.",
                "",
                "## To pay off / to keep buried",
                "Pay off only the near-term promises already supported by context; keep larger secrets buried unless the outline explicitly asks for them.",
                "",
                "## What the slow / transitional beats carry",
                "If a slower beat is needed, make it carry pressure, evidence, relationship movement, or a concrete setup for the next action.",
                "",
                "## Three-question check on the key choice",
                "The protagonist's main choice must have a reason, match current interest, and stay consistent with the established persona.",
                "",
                "## Required end-of-chapter change",
                "End with a concrete change in information, pressure, relationship, objective, or risk so the chapter is not only summary.",
                "",
                "## Hook ledger for this chapter",
                "advance: keep the active promise moving; resolve: only settle what has evidence; defer: preserve larger threads for later chapters.",
                "",
                "## Do not",
                "Do not contradict established facts, ignore the user's current instruction, or turn the fallback memo into a new outline.",
                "",
                "## Planner warning",
                `The model failed to produce a valid chapter memo after ${MEMO_RETRY_LIMIT} attempts. Last parser error: ${input.errorMessage}`,
            ].join("\n");
        }
        return [
            `# 第 ${input.chapterNumber} 章 memo`,
            "",
            "## 本章目标",
            input.fallbackGoal || `按当前大纲继续推进第 ${input.chapterNumber} 章`,
            "",
            "## 关联线索",
            "无",
            "",
            "## 当前任务",
            `沿用当前章节目标和权威设定推进第 ${input.chapterNumber} 章，不临时改方向，也不把章节写成泛泛过渡。`,
            "",
            "## 读者此刻在等什么",
            "延续大纲和上一章形成的读者期待，优先回应当前已经建立的压力、证据、关系或目标变化。",
            "",
            "## 该兑现·暂不掀",
            "只兑现上下文中已有支撑的近期承诺；更大的秘密除非大纲明确要求，否则继续埋藏。",
            "",
            "## 慢节奏/过渡节拍承载什么",
            "如果需要喘息节拍，必须承载压力、证据、关系推进或为下一动作的具体铺垫。",
            "",
            "## 关键抉择三连问",
            "主角本章的核心选择必须有理由、符合当前利益、与已建立的人设一致。",
            "",
            "## 章尾必须发生的改变",
            "以信息、压力、关系、目标或风险的具体变化收尾，不要只写总结。",
            "",
            "## 伏笔账本",
            "advance：推进活跃承诺；resolve：只在有证据时回收；defer：为后续章节保留大线索。",
            "",
            "## 不要做",
            "不要违背已确立的事实、忽略用户当前指令、或把降级 memo 变成新大纲。",
            "",
            "## Planner 警告",
            `模型在 ${MEMO_RETRY_LIMIT} 次尝试后未能产出有效章节 memo。上次解析错误：${input.errorMessage}`,
        ].join("\n");
    }
    isGoldenOpeningChapter(language, chapterNumber) {
        const isZh = (language ?? "zh").toLowerCase().startsWith("zh");
        return isZh ? chapterNumber <= 3 : chapterNumber <= 5;
    }
    buildArcContext(language, volumeOutline, outlineNode) {
        if (!outlineNode)
            return undefined;
        if (volumeOutline === "(文件尚未创建)")
            return undefined;
        return this.isChineseLanguage(language)
            ? `卷纲节点：${outlineNode}`
            : `Outline node: ${outlineNode}`;
    }
    deriveGoal(externalContext, currentFocus, authorIntent, outlineNode, chapterNumber, currentPhase, skeletonEntry) {
        // Phase goals are the highest priority — they lock the narrative direction
        if (currentPhase && currentPhase.goals.length > 0) {
            const unachieved = currentPhase.goals.filter((g) => !g.achieved);
            if (unachieved.length > 0) {
                const phaseGoal = unachieved[0].text;
                return `[阶段${currentPhase.id}] ${phaseGoal}`;
            }
        }
        // Skeleton entry is the second priority — per-chapter pre-planned beat
        if (skeletonEntry?.goal) {
            const cleanGoal = skeletonEntry.goal.replace(/^★\s*/, "");
            return cleanGoal;
        }
        const first = this.extractFirstDirective(externalContext);
        if (first)
            return first;
        const localOverride = this.extractLocalOverrideGoal(currentFocus);
        if (localOverride)
            return localOverride;
        const outline = this.extractFirstDirective(outlineNode);
        if (outline)
            return outline;
        const focus = this.extractFocusGoal(currentFocus);
        if (focus)
            return focus;
        const author = this.extractFirstDirective(authorIntent);
        if (author)
            return author;
        return `Advance chapter ${chapterNumber} with clear narrative focus.`;
    }
    collectMustKeep(currentState, storyBible) {
        return this.unique([
            ...this.extractListItems(currentState, 2),
            ...this.extractListItems(storyBible, 2),
        ]).slice(0, 4);
    }
    collectMustAvoid(currentFocus, prohibitions) {
        const avoidSection = this.extractSection(currentFocus, [
            "avoid",
            "must avoid",
            "禁止",
            "避免",
            "避雷",
        ]);
        const focusAvoids = avoidSection
            ? this.extractListItems(avoidSection, 10)
            : currentFocus
                .split("\n")
                .map((line) => line.trim())
                .filter((line) => line.startsWith("-") &&
                /avoid|don't|do not|不要|别|禁止/i.test(line))
                .map((line) => this.cleanListItem(line))
                .filter((line) => Boolean(line));
        return this.unique([...focusAvoids, ...prohibitions]).slice(0, 6);
    }
    collectStyleEmphasis(authorIntent, currentFocus) {
        return this.unique([
            ...this.extractFocusStyleItems(currentFocus),
            ...this.extractListItems(authorIntent, 2),
        ]).slice(0, 4);
    }
    extractFirstDirective(content) {
        if (!content)
            return undefined;
        return content
            .split("\n")
            .map((line) => line.trim())
            .find((line) => line.length > 0
            && !line.startsWith("#")
            && !line.startsWith("-")
            && !this.isTemplatePlaceholder(line));
    }
    extractListItems(content, limit) {
        return content
            .split("\n")
            .map((line) => line.trim())
            .filter((line) => line.startsWith("-"))
            .map((line) => this.cleanListItem(line))
            .filter((line) => Boolean(line))
            .slice(0, limit);
    }
    extractFocusGoal(currentFocus) {
        const focusSection = this.extractSection(currentFocus, [
            "active focus",
            "focus",
            "当前聚焦",
            "当前焦点",
            "近期聚焦",
        ]) ?? currentFocus;
        const directives = this.extractFocusStyleItems(focusSection, 3);
        if (directives.length === 0) {
            return this.extractFirstDirective(focusSection);
        }
        return directives.join(this.containsChinese(focusSection) ? "；" : "; ");
    }
    extractLocalOverrideGoal(currentFocus) {
        const overrideSection = this.extractSection(currentFocus, [
            "local override",
            "explicit override",
            "chapter override",
            "local task override",
            "局部覆盖",
            "本章覆盖",
            "临时覆盖",
            "当前覆盖",
        ]);
        if (!overrideSection) {
            return undefined;
        }
        const directives = this.extractListItems(overrideSection, 3);
        if (directives.length > 0) {
            return directives.join(this.containsChinese(overrideSection) ? "；" : "; ");
        }
        return this.extractFirstDirective(overrideSection);
    }
    extractFocusStyleItems(currentFocus, limit = 3) {
        const focusSection = this.extractSection(currentFocus, [
            "active focus",
            "focus",
            "当前聚焦",
            "当前焦点",
            "近期聚焦",
        ]) ?? currentFocus;
        return this.extractListItems(focusSection, limit);
    }
    renderHookBudget(activeCount, language) {
        const cap = 12;
        if (activeCount < 10) {
            return language === "en"
                ? `### Hook Budget\n- ${activeCount} active hooks (capacity: ${cap})`
                : `### 伏笔预算\n- 当前 ${activeCount} 条活跃伏笔（容量：${cap}）`;
        }
        const remaining = Math.max(0, cap - activeCount);
        return language === "en"
            ? `### Hook Budget\n- ${activeCount} active hooks — approaching capacity (${cap}). Only ${remaining} new hook(s) allowed. Prioritize resolving existing debt over opening new threads.`
            : `### 伏笔预算\n- 当前 ${activeCount} 条活跃伏笔——接近容量上限（${cap}）。仅剩 ${remaining} 个新坑位。优先回收旧债，不要轻易开新线。`;
    }
    extractSection(content, headings) {
        const targets = headings.map((heading) => this.normalizeHeading(heading));
        const lines = content.split("\n");
        let buffer = null;
        let sectionLevel = 0;
        for (const line of lines) {
            const headingMatch = line.match(/^(#+)\s*(.+?)\s*$/);
            if (headingMatch) {
                const level = headingMatch[1].length;
                const heading = this.normalizeHeading(headingMatch[2]);
                if (buffer && level <= sectionLevel) {
                    break;
                }
                if (targets.includes(heading)) {
                    buffer = [];
                    sectionLevel = level;
                    continue;
                }
            }
            if (buffer) {
                buffer.push(line);
            }
        }
        const section = buffer?.join("\n").trim();
        return section && section.length > 0 ? section : undefined;
    }
    normalizeHeading(heading) {
        return heading
            .toLowerCase()
            .replace(/[*_`:#]/g, "")
            .replace(/\s+/g, " ")
            .trim();
    }
    cleanListItem(line) {
        const cleaned = line.replace(/^-\s*/, "").trim();
        if (cleaned.length === 0)
            return undefined;
        if (/^[-|]+$/.test(cleaned))
            return undefined;
        if (this.isTemplatePlaceholder(cleaned))
            return undefined;
        return cleaned;
    }
    isTemplatePlaceholder(line) {
        const normalized = line.trim();
        if (!normalized)
            return false;
        return (/^\((describe|briefly describe|write)\b[\s\S]*\)$/i.test(normalized)
            || /^（(?:在这里描述|描述|填写|写下)[\s\S]*）$/u.test(normalized));
    }
    containsChinese(content) {
        return /[\u4e00-\u9fff]/.test(content);
    }
    findOutlineNode(volumeOutline, chapterNumber) {
        const lines = volumeOutline.split("\n").map((line) => line.trim()).filter(Boolean);
        for (let index = 0; index < lines.length; index += 1) {
            const line = lines[index];
            const match = this.matchExactOutlineLine(line, chapterNumber);
            if (!match)
                continue;
            const inlineContent = this.cleanOutlineContent(match[1]);
            if (inlineContent) {
                return inlineContent;
            }
            const nextContent = this.findNextOutlineContent(lines, index + 1);
            if (nextContent) {
                return nextContent;
            }
        }
        for (let index = 0; index < lines.length; index += 1) {
            const line = lines[index];
            const match = this.matchRangeOutlineLine(line, chapterNumber);
            if (!match)
                continue;
            const inlineContent = this.cleanOutlineContent(match[3]);
            if (inlineContent) {
                return inlineContent;
            }
            const rangeStart = Number(match[1]);
            const sectionContent = this.extractSectionAroundRange(lines, index);
            if (sectionContent) {
                const beatIndex = chapterNumber - rangeStart;
                const specificBeat = this.extractNumberedBeat(sectionContent, beatIndex);
                return specificBeat ?? sectionContent;
            }
            const nextContent = this.findNextOutlineContent(lines, index + 1);
            if (nextContent) {
                return nextContent;
            }
        }
        for (let index = 0; index < lines.length; index += 1) {
            const line = lines[index];
            if (!this.isOutlineAnchorLine(line))
                continue;
            const exactMatch = this.matchAnyExactOutlineLine(line);
            if (exactMatch) {
                const inlineContent = this.cleanOutlineContent(exactMatch[1]);
                if (inlineContent) {
                    return inlineContent;
                }
            }
            const rangeMatch = this.matchAnyRangeOutlineLine(line);
            if (rangeMatch) {
                const inlineContent = this.cleanOutlineContent(rangeMatch[3]);
                if (inlineContent) {
                    return inlineContent;
                }
            }
            const nextContent = this.findNextOutlineContent(lines, index + 1);
            if (nextContent) {
                return nextContent;
            }
            break;
        }
        return this.extractFirstDirective(volumeOutline);
    }
    cleanOutlineContent(content) {
        const cleaned = content?.trim();
        if (!cleaned)
            return undefined;
        if (/^[*_`~:：-]+$/.test(cleaned))
            return undefined;
        return cleaned;
    }
    extractSectionAroundRange(lines, rangeLineIndex) {
        let headingIndex = -1;
        for (let i = rangeLineIndex - 1; i >= 0; i--) {
            if (lines[i].startsWith("#")) {
                headingIndex = i;
                break;
            }
            if (this.matchAnyRangeOutlineLine(lines[i]) || this.matchAnyExactOutlineLine(lines[i])) {
                break;
            }
        }
        if (headingIndex < 0) {
            return undefined;
        }
        const headingLine = lines[headingIndex];
        const headingLevel = headingLine.match(/^(#+)/)?.[1]?.length ?? 3;
        const sectionLines = [];
        for (let i = headingIndex; i < lines.length; i++) {
            if (i > headingIndex) {
                const nextHeadingMatch = lines[i].match(/^(#+)/);
                if (nextHeadingMatch && (nextHeadingMatch[1]?.length ?? 0) <= headingLevel) {
                    break;
                }
            }
            sectionLines.push(lines[i]);
        }
        const content = sectionLines.join("\n").trim();
        return content.length > 0 ? content : undefined;
    }
    extractNumberedBeat(section, beatIndex) {
        if (beatIndex < 0)
            return undefined;
        const beats = [];
        for (const line of section.split("\n")) {
            const trimmed = line.trim();
            if (/^\d+[.)]\s/.test(trimmed)) {
                beats.push(trimmed.replace(/^\d+[.)]\s*/, ""));
            }
        }
        if (beats.length === 0 || beatIndex >= beats.length)
            return undefined;
        return beats[beatIndex];
    }
    findNextOutlineContent(lines, startIndex) {
        for (let index = startIndex; index < lines.length; index += 1) {
            const line = lines[index];
            if (!line) {
                continue;
            }
            if (this.isOutlineAnchorLine(line)) {
                return undefined;
            }
            if (line.startsWith("#")) {
                continue;
            }
            const cleaned = this.cleanOutlineContent(line);
            if (cleaned) {
                return cleaned;
            }
        }
        return undefined;
    }
    matchExactOutlineLine(line, chapterNumber) {
        const patterns = [
            new RegExp(`^(?:#+\\s*)?(?:[-*]\\s+)?(?:\\*\\*)?Chapter\\s*${chapterNumber}(?!\\d|\\s*[-~–—]\\s*\\d)(?:[:：-])?(?:\\*\\*)?\\s*(.*)$`, "i"),
            new RegExp(`^(?:#+\\s*)?(?:[-*]\\s+)?(?:\\*\\*)?第\\s*${chapterNumber}\\s*章(?!\\d|\\s*[-~–—]\\s*\\d)(?:[:：-])?(?:\\*\\*)?\\s*(.*)$`),
        ];
        return patterns
            .map((pattern) => line.match(pattern))
            .find((result) => Boolean(result));
    }
    matchAnyExactOutlineLine(line) {
        const patterns = [
            /^(?:#+\s*)?(?:[-*]\s+)?(?:\*\*)?Chapter\s*\d+(?!\s*[-~–—]\s*\d)(?:[:：-])?(?:\*\*)?\s*(.*)$/i,
            /^(?:#+\s*)?(?:[-*]\s+)?(?:\*\*)?第\s*\d+\s*章(?!\s*[-~–—]\s*\d)(?:[:：-])?(?:\*\*)?\s*(.*)$/i,
        ];
        return patterns
            .map((pattern) => line.match(pattern))
            .find((result) => Boolean(result));
    }
    matchRangeOutlineLine(line, chapterNumber) {
        const match = this.matchAnyRangeOutlineLine(line);
        if (!match)
            return undefined;
        if (this.isChapterWithinRange(match[1], match[2], chapterNumber)) {
            return match;
        }
        return undefined;
    }
    matchAnyRangeOutlineLine(line) {
        const patterns = [
            /^(?:#+\s*)?(?:[-*]\s+)?(?:\*\*)?Chapter\s*(\d+)\s*[-~–—]\s*(\d+)\b(?:[:：-])?(?:\*\*)?\s*(.*)$/i,
            /^(?:#+\s*)?(?:[-*]\s+)?(?:\*\*)?第\s*(\d+)\s*[-~–—]\s*(\d+)\s*章(?:[:：-])?(?:\*\*)?\s*(.*)$/i,
            /^(?:[-*]\s+)?(?:\*\*)?章节范围(?:\*\*)?[：:]\s*(\d+)\s*[-~–—]\s*(\d+)\s*章\s*(.*)$/,
            /^(?:[-*]\s+)?(?:\*\*)?Chapter\s*[Rr]ange(?:\*\*)?[：:]\s*(\d+)\s*[-~–—]\s*(\d+)\b\s*(.*)$/i,
        ];
        return patterns
            .map((pattern) => line.match(pattern))
            .find((result) => Boolean(result));
    }
    isOutlineAnchorLine(line) {
        return this.matchAnyExactOutlineLine(line) !== undefined
            || this.matchAnyRangeOutlineLine(line) !== undefined;
    }
    isChapterWithinRange(startText, endText, chapterNumber) {
        const start = Number.parseInt(startText ?? "", 10);
        const end = Number.parseInt(endText ?? "", 10);
        if (!Number.isFinite(start) || !Number.isFinite(end))
            return false;
        const lower = Math.min(start, end);
        const upper = Math.max(start, end);
        return chapterNumber >= lower && chapterNumber <= upper;
    }
    renderIntentMarkdown(intent, memo, language, pendingHooks, chapterSummaries, activeHookCount) {
        const mustKeep = intent.mustKeep.length > 0
            ? intent.mustKeep.map((item) => `- ${item}`).join("\n")
            : "- none";
        const mustAvoid = intent.mustAvoid.length > 0
            ? intent.mustAvoid.map((item) => `- ${item}`).join("\n")
            : "- none";
        const styleEmphasis = intent.styleEmphasis.length > 0
            ? intent.styleEmphasis.map((item) => `- ${item}`).join("\n")
            : "- none";
        const memoBody = memo.body.trim();
        const threadRefsLine = memo.threadRefs.length > 0
            ? memo.threadRefs.map((id) => `- ${id}`).join("\n")
            : "- (none)";
        return [
            "# Chapter Intent",
            "",
            "## Goal",
            intent.goal,
            "",
            "## Outline Node",
            intent.outlineNode ?? "(not found)",
            "",
            "## Arc Context",
            intent.arcContext ?? "(none)",
            "",
            "## Must Keep",
            mustKeep,
            "",
            "## Must Avoid",
            mustAvoid,
            "",
            "## Style Emphasis",
            styleEmphasis,
            "",
            "## Chapter Memo",
            `- isGoldenOpening: ${memo.isGoldenOpening ? "true" : "false"}`,
            "",
            "### Thread Refs",
            threadRefsLine,
            "",
            "### Body",
            memoBody,
            "",
            this.renderHookBudget(activeHookCount, language),
            "",
            "## Pending Hooks Snapshot",
            pendingHooks,
            "",
            "## Chapter Summaries Snapshot",
            chapterSummaries,
            "",
        ].join("\n");
    }
    unique(values) {
        return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
    }
    isChineseLanguage(language) {
        return (language ?? "zh").toLowerCase().startsWith("zh");
    }
    // Kept for potential subclasses reading seed files directly.
    async readFileOrDefault(path) {
        try {
            return await readFile(path, "utf-8");
        }
        catch {
            return "(文件尚未创建)";
        }
    }
}
//# sourceMappingURL=planner.js.map
