/**
 * Writer Settlement — extracted from writer.js
 *
 * State settlement logic: observer → settler LLM pipeline,
 * truth file reading, and merge protection.
 *
 * Functions accept a `ctx` (WriterAgent instance) for dependency injection.
 */
import { buildSettlerSystemPrompt, buildSettlerUserPrompt } from "./settler-prompts.js";
import { buildObserverSystemPrompt, buildObserverUserPrompt } from "./observer-prompts.js";
import { parseSettlerDeltaOutput } from "./settler-delta-parser.js";
import { parseSettlementOutput } from "./settler-parser.js";
import { readGenreProfile, readBookRules } from "./rules-reader.js";
import { countChapterLength } from "../utils/length-metrics.js";
import { capContextBlock } from "../utils/context-filter.js";
import { buildGovernedMemoryEvidenceBlocks } from "../utils/governed-context.js";
import { mergeCharacterMatrixMarkdown, mergeTableMarkdownByKey } from "../utils/governed-working-set.js";
import { readVolumeMap, readCharacterContext, readCurrentStateWithFallback } from "../utils/outline-paths.js";
import { renderNarrativeSelectedContext } from "../utils/narrative-control.js";
import { join } from "node:path";

const LEGACY_WRITER_CONTEXT_BUDGET = {
    storyBible: 14_000,
    currentState: 7_000,
    ledger: 6_000,
    hooks: 9_000,
    chapterSummaries: 9_000,
    subplotBoard: 7_000,
    emotionalArcs: 7_000,
    characterMatrix: 12_000,
    parentCanon: 12_000,
    volumeOutline: 12_000,
};

function hasRuntimeStateDeltaBlock(content) {
    return /===\s*RUNTIME_STATE_DELTA\s*===/i.test(content);
}

/**
 * Build the governed control block for the settler prompt.
 */
function buildSettlerGovernedControlBlock(chapterIntent, contextPackage, ruleStack, language) {
    const selectedContext = renderNarrativeSelectedContext(contextPackage.selectedContext, language)
        .replace(/^### /gm, "- ");
    const overrides = ruleStack.activeOverrides.length > 0
        ? ruleStack.activeOverrides
            .map((override) => `- ${override.from} -> ${override.to}: ${override.reason} (${override.target})`)
            .join("\n")
        : "- none";
    const activeCastSettlementRules = language === "en"
        ? "\n### Active Cast Settlement Rules\n- Only update character state / relationship / information boundary for characters who are present in Active Cast and whose change is directly evidenced in the chapter text.\n- mentioned/offstage characters may be listed in the chapter summary only as mentioned; do not invent actions, state changes, or relationship movement for them.\n- channel_only speakers are remote/channel evidence unless the prose later brings them physically into scene.\n"
        : "\n### 本章出场人物结算规则\n- 只更新 Active Cast 中 presence=present 且正文有直接证据的人物状态、关系、信息边界。\n- mentioned/offstage 只能在章节摘要中记为被提及，不得虚构行动、状态变化或关系推进。\n- channel_only 只按频道/远端文本证据处理，除非正文之后明确让其实体入场。\n";
    const hard = ruleStack.sections.hard.join(language === "en" ? ", " : "、") || (language === "en" ? "(none)" : "(无)");
    const soft = ruleStack.sections.soft.join(language === "en" ? ", " : "、") || (language === "en" ? "(none)" : "(无)");
    if (language === "en") {
        return `### Governed Settlement Control\n- Selected Context:\n${selectedContext}\n- Active Overrides:\n${overrides}\n- Hard Rules: ${hard}\n- Soft Rules: ${soft}\n${activeCastSettlementRules}`;
    }
    return `### 受控结算\n- 已选上下文：\n${selectedContext}\n- 生效覆盖：\n${overrides}\n- 硬护栏：${hard}\n- 软约束：${soft}\n${activeCastSettlementRules}`;
}

/**
 * Join governed evidence blocks into a single string.
 */
function joinGovernedEvidenceBlocks(blocks) {
    if (!blocks) {
        return undefined;
    }
    const joined = [
        blocks.titleHistoryBlock,
        blocks.moodTrailBlock,
        blocks.canonBlock,
        blocks.hookDebtBlock,
        blocks.hooksBlock,
        blocks.summariesBlock,
        blocks.volumeSummariesBlock,
    ]
        .filter((block) => Boolean(block))
        .join("\n");
    return joined || undefined;
}

/**
 * Cap legacy context content to a maximum character limit.
 */
function capLegacyContext(label, content, maxChars) {
    return capContextBlock(content, { label, maxChars });
}

/**
 * Run the settle pipeline: observer → settler LLM, with merge protection.
 */
export async function settle(ctx, params) {
    const resolvedLang = params.book.language ?? params.genreProfile.language;
    const observerSystem = buildObserverSystemPrompt(params.book, params.genreProfile, resolvedLang);
    const observerUser = buildObserverUserPrompt(params.chapterNumber, params.title, params.content, resolvedLang);
    ctx.logInfo(resolvedLang, {
        zh: `阶段 2a：提取第${params.chapterNumber}章事实`,
        en: `Phase 2a: observing facts for chapter ${params.chapterNumber}`,
    });
    const observerResponse = await ctx.chat([
        { role: "system", content: observerSystem },
        { role: "user", content: observerUser },
    ], { temperature: 0.5 });
    const observations = observerResponse.content;
    ctx.logInfo(resolvedLang, {
        zh: "阶段 2b：把观察结果回写到真相文件",
        en: "Phase 2b: reflecting observations into truth files",
    });
    const settlerSystem = buildSettlerSystemPrompt(params.book, params.genreProfile, params.bookRules, resolvedLang);
    const governedControlBlock = params.chapterIntent && params.contextPackage && params.ruleStack
        ? buildSettlerGovernedControlBlock([params.chapterIntent, params.chapterMemo?.body].filter(Boolean).join("\n\n"), params.contextPackage, params.ruleStack, resolvedLang)
        : undefined;
    const settlerUser = buildSettlerUserPrompt({
        chapterNumber: params.chapterNumber,
        title: params.title,
        content: params.content,
        currentState: capLegacyContext("current_state", params.currentState, LEGACY_WRITER_CONTEXT_BUDGET.currentState),
        ledger: capLegacyContext("particle_ledger", params.ledger, LEGACY_WRITER_CONTEXT_BUDGET.ledger),
        hooks: capLegacyContext("pending_hooks", params.hooks, LEGACY_WRITER_CONTEXT_BUDGET.hooks),
        chapterSummaries: capLegacyContext("chapter_summaries", params.chapterSummaries, LEGACY_WRITER_CONTEXT_BUDGET.chapterSummaries),
        subplotBoard: capLegacyContext("subplot_board", params.subplotBoard, LEGACY_WRITER_CONTEXT_BUDGET.subplotBoard),
        emotionalArcs: capLegacyContext("emotional_arcs", params.emotionalArcs, LEGACY_WRITER_CONTEXT_BUDGET.emotionalArcs),
        characterMatrix: capLegacyContext("character_matrix", params.characterMatrix, LEGACY_WRITER_CONTEXT_BUDGET.characterMatrix),
        characterAssets: capLegacyContext("character_assets", params.characterAssets, 8000),
        allianceState: capLegacyContext("alliance_state", params.allianceState, 8000),
        relationshipGraph: capLegacyContext("relationship_graph", params.relationshipGraph, 8000),
        eraMood: capLegacyContext("era_mood", params.eraMood, 4000),
        militaryForces: capLegacyContext("military_forces", params.militaryForces, 8000),
        warTheater: capLegacyContext("war_theater", params.warTheater, 6000),
        battleLog: capLegacyContext("battle_log", params.battleLog, 8000),
        territoryControl: capLegacyContext("territory_control", params.territoryControl, 6000),
        epochTimeline: capLegacyContext("epoch_timeline", params.epochTimeline, 4000),
        navalForces: capLegacyContext("naval_forces", params.navalForces, 6000),
        dynastyTree: capLegacyContext("dynasty_tree", params.dynastyTree, 6000),
        treasuryState: capLegacyContext("treasury_state", params.treasuryState, 4000),
        geography: capLegacyContext("geography", params.geography, 4000),
        volumeOutline: capLegacyContext("volume_outline", params.volumeOutline, LEGACY_WRITER_CONTEXT_BUDGET.volumeOutline),
        observations,
        selectedEvidenceBlock: params.selectedEvidenceBlock,
        governedControlBlock,
        validationFeedback: params.validationFeedback,
    });
    const response = await ctx.chat([
        { role: "system", content: settlerSystem },
        { role: "user", content: settlerUser },
    ], { temperature: 0.3 });
    let mergedSettlement;
    try {
        const deltaOutput = parseSettlerDeltaOutput(response.content);
        const tagOutput = parseSettlementOutput(response.content, params.genreProfile);
        mergedSettlement = {
            postSettlement: deltaOutput.postSettlement,
            runtimeStateDelta: deltaOutput.runtimeStateDelta,
            updatedState: "",
            updatedLedger: "",
            updatedHooks: "",
            chapterSummary: "",
            updatedSubplots: "",
            updatedEmotionalArcs: "",
            updatedCharacterMatrix: "",
            updatedRelationshipGraph: tagOutput.updatedRelationshipGraph ?? "",
            updatedEraMood: tagOutput.updatedEraMood ?? "",
            updatedMilitaryForces: tagOutput.updatedMilitaryForces ?? "",
            updatedWarTheater: tagOutput.updatedWarTheater ?? "",
            updatedBattleLog: tagOutput.updatedBattleLog ?? "",
            updatedTerritoryControl: tagOutput.updatedTerritoryControl ?? "",
            updatedEpochTimeline: tagOutput.updatedEpochTimeline ?? "",
            updatedNavalForces: tagOutput.updatedNavalForces ?? "",
            updatedDynastyTree: tagOutput.updatedDynastyTree ?? "",
            updatedTreasuryState: tagOutput.updatedTreasuryState ?? "",
            updatedGeography: tagOutput.updatedGeography ?? "",
        };
    }
    catch (error) {
        if (hasRuntimeStateDeltaBlock(response.content)) {
            throw error;
        }
        const settlement = parseSettlementOutput(response.content, params.genreProfile);
        mergedSettlement = governedControlBlock
            ? {
                ...settlement,
                updatedHooks: mergeTableMarkdownByKey(params.originalHooks, settlement.updatedHooks, [0]),
                updatedSubplots: settlement.updatedSubplots
                    ? mergeTableMarkdownByKey(params.originalSubplots, settlement.updatedSubplots, [0])
                    : settlement.updatedSubplots,
                updatedEmotionalArcs: settlement.updatedEmotionalArcs
                    ? mergeTableMarkdownByKey(params.originalEmotionalArcs, settlement.updatedEmotionalArcs, [0, 1])
                    : settlement.updatedEmotionalArcs,
                updatedCharacterMatrix: settlement.updatedCharacterMatrix
                    ? mergeCharacterMatrixMarkdown(params.originalCharacterMatrix, settlement.updatedCharacterMatrix)
                    : settlement.updatedCharacterMatrix,
                updatedRelationshipGraph: settlement.updatedRelationshipGraph
                    ? mergeTableMarkdownByKey(params.originalRelationshipGraph ?? "", settlement.updatedRelationshipGraph, [0, 1])
                    : settlement.updatedRelationshipGraph,
                updatedEraMood: settlement.updatedEraMood
                    ? mergeTableMarkdownByKey(params.originalEraMood ?? "", settlement.updatedEraMood, [0])
                    : settlement.updatedEraMood,
                updatedMilitaryForces: settlement.updatedMilitaryForces
                    ? mergeTableMarkdownByKey(params.originalMilitaryForces ?? "", settlement.updatedMilitaryForces, [0])
                    : settlement.updatedMilitaryForces,
                updatedWarTheater: settlement.updatedWarTheater
                    ? mergeTableMarkdownByKey(params.originalWarTheater ?? "", settlement.updatedWarTheater, [0])
                    : settlement.updatedWarTheater,
                updatedBattleLog: settlement.updatedBattleLog
                    ? mergeTableMarkdownByKey(params.originalBattleLog ?? "", settlement.updatedBattleLog, [0])
                    : settlement.updatedBattleLog,
                updatedTerritoryControl: settlement.updatedTerritoryControl
                    ? mergeTableMarkdownByKey(params.originalTerritoryControl ?? "", settlement.updatedTerritoryControl, [0])
                    : settlement.updatedTerritoryControl,
                updatedEpochTimeline: settlement.updatedEpochTimeline
                    ? mergeTableMarkdownByKey(params.originalEpochTimeline ?? "", settlement.updatedEpochTimeline, [0])
                    : settlement.updatedEpochTimeline,
                updatedNavalForces: settlement.updatedNavalForces
                    ? mergeTableMarkdownByKey(params.originalNavalForces ?? "", settlement.updatedNavalForces, [0])
                    : settlement.updatedNavalForces,
                updatedDynastyTree: settlement.updatedDynastyTree
                    ? mergeTableMarkdownByKey(params.originalDynastyTree ?? "", settlement.updatedDynastyTree, [0])
                    : settlement.updatedDynastyTree,
                updatedTreasuryState: settlement.updatedTreasuryState
                    ? mergeTableMarkdownByKey(params.originalTreasuryState ?? "", settlement.updatedTreasuryState, [0])
                    : settlement.updatedTreasuryState,
                updatedGeography: settlement.updatedGeography
                    ? mergeTableMarkdownByKey(params.originalGeography ?? "", settlement.updatedGeography, [0])
                    : settlement.updatedGeography,
            }
            : settlement;
    }
    return {
        settlement: mergedSettlement,
        usage: response.usage,
    };
}

/**
 * Settle chapter state: read truth files, run settlement, update phase goals.
 */
export async function settleChapterState(ctx, input) {
    const [currentState, ledger, hooks, chapterSummaries, subplotBoard, emotionalArcs, characterMatrix, characterAssets, allianceState, volumeOutline,] = await Promise.all([
        readCurrentStateWithFallback(input.bookDir, "(文件尚未创建)"),
        ctx.readFileOrDefault(join(input.bookDir, "story/particle_ledger.md")),
        ctx.readFileOrDefault(join(input.bookDir, "story/pending_hooks.md")),
        ctx.readFileOrDefault(join(input.bookDir, "story/chapter_summaries.md")),
        ctx.readFileOrDefault(join(input.bookDir, "story/subplot_board.md")),
        ctx.readFileOrDefault(join(input.bookDir, "story/emotional_arcs.md")),
        readCharacterContext(input.bookDir, "(文件尚未创建)"),
        ctx.readFileOrDefault(join(input.bookDir, "story/character_assets.md")),
        ctx.readFileOrDefault(join(input.bookDir, "story/alliance_state.md")),
        readVolumeMap(input.bookDir, "(文件尚未创建)"),
    ]);
    const [relationshipGraph, eraMood, militaryForces, warTheater, battleLog, territoryControl, epochTimeline, navalForces, dynastyTree, treasuryState,] = await Promise.all([
        ctx.readFileOrDefault(join(input.bookDir, "story/relationship_graph.md")),
        ctx.readFileOrDefault(join(input.bookDir, "story/era_mood.md")),
        ctx.readFileOrDefault(join(input.bookDir, "story/military_forces.md")),
        ctx.readFileOrDefault(join(input.bookDir, "story/war_theater.md")),
        ctx.readFileOrDefault(join(input.bookDir, "story/battle_log.md")),
        ctx.readFileOrDefault(join(input.bookDir, "story/territory_control.md")),
        ctx.readFileOrDefault(join(input.bookDir, "story/epoch_timeline.md")),
        ctx.readFileOrDefault(join(input.bookDir, "story/naval_forces.md")),
        ctx.readFileOrDefault(join(input.bookDir, "story/dynasty_tree.md")),
        ctx.readFileOrDefault(join(input.bookDir, "story/treasury_state.md")),
    ]);
    const [geography] = await Promise.all([
        ctx.readFileOrDefault(join(input.bookDir, "story/geography.md")),
    ]);
    const { profile: genreProfile } = await readGenreProfile(ctx.ctx.projectRoot, input.book.genre);
    const parsedBookRules = await readBookRules(input.bookDir);
    const bookRules = parsedBookRules?.rules ?? null;
    const resolvedLanguage = input.book.language ?? genreProfile.language;
    const governedMemoryBlocks = input.contextPackage
        ? buildGovernedMemoryEvidenceBlocks(input.contextPackage, resolvedLanguage)
        : undefined;
    const settleResult = await settle(ctx, {
        book: input.book,
        genreProfile,
        bookRules,
        chapterNumber: input.chapterNumber,
        title: input.title,
        content: input.content,
        currentState,
        ledger: genreProfile.numericalSystem ? ledger : "",
        hooks,
        chapterSummaries,
        subplotBoard,
        emotionalArcs,
        characterMatrix,
        characterAssets,
        allianceState,
        volumeOutline,
        relationshipGraph,
        eraMood,
        militaryForces,
        warTheater,
        battleLog,
        territoryControl,
        epochTimeline,
        navalForces,
        dynastyTree,
        treasuryState,
        geography,
        selectedEvidenceBlock: governedMemoryBlocks
            ? joinGovernedEvidenceBlocks(governedMemoryBlocks)
            : undefined,
        chapterIntent: input.chapterIntent,
        chapterMemo: input.chapterMemo,
        contextPackage: input.contextPackage,
        ruleStack: input.ruleStack,
        validationFeedback: input.validationFeedback,
        originalHooks: hooks,
        originalSubplots: subplotBoard,
        originalEmotionalArcs: emotionalArcs,
        originalCharacterMatrix: characterMatrix,
        originalRelationshipGraph: relationshipGraph,
        originalEraMood: eraMood,
        originalMilitaryForces: militaryForces,
        originalWarTheater: warTheater,
        originalBattleLog: battleLog,
        originalTerritoryControl: territoryControl,
        originalEpochTimeline: epochTimeline,
        originalNavalForces: navalForces,
        originalDynastyTree: dynastyTree,
        originalTreasuryState: treasuryState,
        originalGeography: geography,
    });
    const settlement = settleResult.settlement;
    const runtimeStateArtifacts = await ctx.buildRuntimeStateArtifactsIfPresent(input.bookDir, settlement.runtimeStateDelta, resolvedLanguage, input.chapterNumber, input.allowReapply);
    await ctx.updatePhaseGoals(input.bookDir, input.chapterNumber, settlement.chapterSummary ?? "", resolvedLanguage);
    return {
        chapterNumber: input.chapterNumber,
        title: input.title,
        content: input.content,
        wordCount: countChapterLength(input.content, resolvedLanguage === "en" ? "en_words" : "zh_chars"),
        preWriteCheck: "",
        postSettlement: settlement.postSettlement,
        runtimeStateDelta: runtimeStateArtifacts?.resolvedDelta ?? settlement.runtimeStateDelta,
        runtimeStateSnapshot: runtimeStateArtifacts?.snapshot ?? settlement.runtimeStateSnapshot,
        updatedState: runtimeStateArtifacts?.currentStateMarkdown ?? settlement.updatedState,
        updatedLedger: settlement.updatedLedger,
        updatedHooks: runtimeStateArtifacts?.hooksMarkdown ?? settlement.updatedHooks,
        chapterSummary: settlement.runtimeStateDelta
            ? ctx.renderDeltaSummaryRow(settlement.runtimeStateDelta)
            : settlement.chapterSummary,
        updatedChapterSummaries: runtimeStateArtifacts?.chapterSummariesMarkdown,
        updatedSubplots: settlement.updatedSubplots,
        updatedEmotionalArcs: settlement.updatedEmotionalArcs,
        updatedCharacterMatrix: settlement.updatedCharacterMatrix,
        postWriteErrors: [],
        postWriteWarnings: [],
        tokenUsage: settleResult.usage,
    };
}
