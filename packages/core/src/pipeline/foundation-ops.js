/**
 * Foundation Operations — extracted from runner.js
 *
 * Book initialization, foundation revision, and phase outline regeneration.
 * Functions accept a `ctx` (runner instance) for dependency injection.
 */
import { ArchitectAgent } from "../agents/architect.js";
import { CastBuilderAgent } from "../agents/cast-builder.js";
import { FoundationReviewerAgent } from "../agents/foundation-reviewer.js";
import { readFile, writeFile, mkdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { isNewLayoutBook, readCharacterContext, readStoryFrame, readVolumeMap } from "../utils/outline-paths.js";
import { copyDirRecursive, copyDirShallow } from "./resettlement.js";
/**
 * Generate foundation with review loop. Retries up to maxRetries times if review fails.
 */
export async function generateAndReviewFoundation(ctx, params) {
    const maxRetries = params.maxRetries ?? ctx.config.foundationReviewRetries ?? 2;
    let foundation = await params.generate();
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        ctx.logStage(params.stageLanguage, {
            zh: `审核基础设定（第${attempt + 1}轮）`,
            en: `reviewing foundation (round ${attempt + 1})`,
        });
        const review = await params.reviewer.review({
            foundation,
            mode: params.mode,
            sourceCanon: params.sourceCanon,
            styleGuide: params.styleGuide,
            language: params.language,
        });
        ctx.config.logger?.info(`Foundation review: ${review.totalScore}/100 ${review.passed ? "PASSED" : "REJECTED"}`);
        for (const dim of review.dimensions) {
            ctx.config.logger?.info(`  [${dim.score}] ${dim.name.slice(0, 40)}`);
        }
        if (review.passed) {
            return foundation;
        }
        ctx.logWarn(params.stageLanguage, {
            zh: `基础设定未通过审核（${review.totalScore}分），正在重新生成...`,
            en: `Foundation rejected (${review.totalScore}/100), regenerating...`,
        });
        foundation = await params.generate(buildFoundationReviewFeedback(review, params.language));
    }
    const finalReview = await params.reviewer.review({
        foundation,
        mode: params.mode,
        sourceCanon: params.sourceCanon,
        styleGuide: params.styleGuide,
        language: params.language,
    });
    ctx.config.logger?.info(`Foundation final review: ${finalReview.totalScore}/100 ${finalReview.passed ? "PASSED" : "ACCEPTED (max retries)"}`);
    return foundation;
}
/**
 * Build localized feedback string from a foundation review result.
 */
export function buildFoundationReviewFeedback(review, language) {
    const dimensionLines = review.dimensions
        .map((dimension) => (language === "en"
        ? `- ${dimension.name} [${dimension.score}]: ${dimension.feedback}`
        : `- ${dimension.name}（${dimension.score}分）：${dimension.feedback}`))
        .join("\n");
    return language === "en"
        ? [
            "## Overall Feedback",
            review.overallFeedback,
            "",
            "## Dimension Notes",
            dimensionLines || "- none",
        ].join("\n")
        : [
            "## 总评",
            review.overallFeedback,
            "",
            "## 分项问题",
            dimensionLines || "- 无",
        ].join("\n");
}
/**
 * Initialize a new book: generate foundation, write files, create initial snapshot.
 */
export async function initBook(ctx, book, options = {}) {
    const architect = new ArchitectAgent(ctx.agentCtxFor("architect", book.id));
    const bookDir = ctx.state.bookDir(book.id);
    const stagingBookDir = join(ctx.state.booksDir, `.tmp-book-create-${book.id}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
    const stageLanguage = await ctx.resolveBookLanguage(book);
    const effectiveExternalContext = options.externalContext ?? ctx.config.externalContext;
    const { profile: gp } = await ctx.loadGenreProfile(book.genre);
    const resolvedLanguage = (book.language ?? gp.language) === "en" ? "en" : "zh";

    // Step 1: Cast Builder — 生成棋子（角色/物品/势力注册表）
    let castContextBlock = "";
    if (effectiveExternalContext && effectiveExternalContext.trim().length > 0) {
        ctx.logStage(stageLanguage, { zh: "铸造棋子（角色/物品/势力注册表）", en: "casting pieces (cast/item/faction registry)" });
        const castBuilder = new CastBuilderAgent(ctx.agentCtxFor("cast-builder", book.id));
        const castOutput = await castBuilder.buildCast(effectiveExternalContext, resolvedLanguage);
        // Write to staging dir for Architect to read
        const storyDir = join(stagingBookDir, "story");
        await mkdir(storyDir, { recursive: true });
        if (castOutput.castRegistry) {
            await writeFile(join(storyDir, "cast_registry.md"), castOutput.castRegistry, "utf-8");
        }
        if (castOutput.itemCatalog) {
            await writeFile(join(storyDir, "item_catalog.md"), castOutput.itemCatalog, "utf-8");
        }
        if (castOutput.factionMap) {
            await writeFile(join(storyDir, "faction_map.md"), castOutput.factionMap, "utf-8");
        }
        // Build context block for Architect
        const parts = [];
        if (castOutput.castRegistry) parts.push(`## 角色注册表\n\n${castOutput.castRegistry}`);
        if (castOutput.itemCatalog) parts.push(`## 物品清单\n\n${castOutput.itemCatalog}`);
        if (castOutput.factionMap) parts.push(`## 势力图谱\n\n${castOutput.factionMap}`);
        if (parts.length > 0) {
            castContextBlock = `\n\n## 已确认的棋子数据\n以下是已确定的角色注册表、物品清单和势力图谱。你的大纲必须基于这些数据，不创造新角色/物品/势力（除非从 brief 中合理推导）。\n\n${parts.join("\n\n")}\n`;
        }
        ctx.config.logger?.info(`[cast-builder] Extracted: ${castOutput.castRegistry ? "cast_registry" : "-"} ${castOutput.itemCatalog ? "item_catalog" : "-"} ${castOutput.factionMap ? "faction_map" : "-"}`);
    }

    // Step 2: Architect — 生成棋局（读取棋子数据）
    ctx.logStage(stageLanguage, { zh: "生成基础设定", en: "generating foundation" });
    const reviewer = new FoundationReviewerAgent(ctx.agentCtxFor("foundation-reviewer", book.id));
    const augmentedContext = effectiveExternalContext + castContextBlock;
    const foundation = await generateAndReviewFoundation(ctx, {
        generate: (reviewFeedback) => architect.generateFoundation(book, augmentedContext, reviewFeedback),
        reviewer,
        mode: "original",
        language: resolvedLanguage,
        stageLanguage,
    });
    try {
        ctx.logStage(stageLanguage, { zh: "保存书籍配置", en: "saving book config" });
        await ctx.state.saveBookConfigAt(stagingBookDir, book);
        ctx.logStage(stageLanguage, { zh: "写入基础设定文件", en: "writing foundation files" });
        await architect.writeFoundationFiles(stagingBookDir, foundation, gp.numericalSystem, book.language ?? gp.language);
        if (effectiveExternalContext && effectiveExternalContext.trim().length > 0) {
            const storyDir = join(stagingBookDir, "story");
            await mkdir(storyDir, { recursive: true });
            await writeFile(join(storyDir, "brief.md"), effectiveExternalContext, "utf-8");
        }
        ctx.logStage(stageLanguage, { zh: "初始化控制文档", en: "initializing control documents" });
        await ctx.state.ensureControlDocumentsAt(stagingBookDir, book.language ?? gp.language, options.authorIntent ?? effectiveExternalContext);
        if (options.currentFocus?.trim()) {
            await writeFile(join(stagingBookDir, "story", "current_focus.md"), options.currentFocus.trimEnd() + "\n", "utf-8");
        }
        await ctx.state.saveChapterIndexAt(stagingBookDir, []);
        ctx.logStage(stageLanguage, { zh: "创建初始快照", en: "creating initial snapshot" });
        await ctx.state.snapshotStateAt(stagingBookDir, 0);
        if (await ctx.pathExists(bookDir)) {
            if (await ctx.state.isCompleteBookDirectory(bookDir)) {
                throw new Error(`Book "${book.id}" already exists at books/${book.id}/. Use a different title or delete the existing book first.`);
            }
            await rm(bookDir, { recursive: true, force: true });
        }
        await rename(stagingBookDir, bookDir);
    }
    catch (error) {
        await rm(stagingBookDir, { recursive: true, force: true }).catch(() => undefined);
        throw error;
    }
}
/**
 * Revise an existing book foundation without touching runtime chapter state.
 */
export async function reviseFoundation(ctx, bookId, feedback) {
    const { bookDir, storyDir } = ctx.resolveBookPaths(bookId);
    const isPhase5 = await isNewLayoutBook(bookDir);
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupTag = isPhase5 ? "phase5" : "phase4";
    const backupDir = join(storyDir, `.backup-${backupTag}-${timestamp}`);
    await mkdir(backupDir, { recursive: true });
    const flatFiles = ["story_bible.md", "volume_outline.md", "book_rules.md", "character_matrix.md"];
    for (const fileName of flatFiles) {
        try {
            const content = await readFile(join(storyDir, fileName), "utf-8");
            await writeFile(join(backupDir, fileName), content, "utf-8");
        }
        catch {
            // Missing legacy shim files are fine for partially migrated books.
        }
    }
    if (isPhase5) {
        await copyDirShallow(join(storyDir, "outline"), join(backupDir, "outline"));
        await copyDirRecursive(join(storyDir, "roles"), join(backupDir, "roles"));
    }
    const book = await ctx.state.loadBookConfig(bookId);
    let oldStoryBible;
    let oldVolumeOutline;
    let oldBookRules;
    let oldCharacterMatrix;
    if (isPhase5) {
        [oldStoryBible, oldVolumeOutline, oldCharacterMatrix] = await Promise.all([
            readStoryFrame(bookDir),
            readVolumeMap(bookDir),
            readCharacterContext(bookDir),
        ]);
        oldBookRules = await readFile(join(storyDir, "book_rules.md"), "utf-8").catch(() => "");
    }
    else {
        [oldStoryBible, oldVolumeOutline, oldBookRules, oldCharacterMatrix] = await Promise.all([
            readFile(join(storyDir, "story_bible.md"), "utf-8").catch(() => ""),
            readFile(join(storyDir, "volume_outline.md"), "utf-8").catch(() => ""),
            readFile(join(storyDir, "book_rules.md"), "utf-8").catch(() => ""),
            readFile(join(storyDir, "character_matrix.md"), "utf-8").catch(() => ""),
        ]);
    }
    const architect = new ArchitectAgent(ctx.agentCtxFor("architect", bookId));
    const foundation = await architect.generateFoundation(book, undefined, undefined, {
        reviseFrom: {
            storyBible: oldStoryBible,
            volumeOutline: oldVolumeOutline,
            bookRules: oldBookRules,
            characterMatrix: oldCharacterMatrix,
            userFeedback: feedback,
        },
    });
    const reviewer = new FoundationReviewerAgent(ctx.agentCtxFor("foundation-reviewer", bookId));
    const resolvedLanguage = (book.language ?? "zh") === "en" ? "en" : "zh";
    try {
        const review = await reviewer.review({
            foundation,
            mode: "original",
            language: resolvedLanguage,
        });
        if (!review.passed) {
            ctx.config.logger?.warn?.(`[reviseFoundation] Foundation review did not pass; accepting rewrite. Feedback: ${review.overallFeedback ?? ""}`);
        }
    }
    catch (error) {
        ctx.config.logger?.warn?.(`[reviseFoundation] Foundation review failed and was skipped: ${error instanceof Error ? error.message : String(error)}`);
    }
    const outlineDir = join(storyDir, "outline");
    await mkdir(outlineDir, { recursive: true });
    await mkdir(join(storyDir, "roles", "主要角色"), { recursive: true });
    await mkdir(join(storyDir, "roles", "次要角色"), { recursive: true });
    const { profile: gp } = await ctx.loadGenreProfile(book.genre);
    await architect.writeFoundationFiles(bookDir, foundation, gp.numericalSystem, book.language ?? gp.language, "revise");
}
/**
 * Regenerate a single phase in the phase outline (阶段纲).
 */
export async function regeneratePhaseOutline(ctx, bookId, phaseId, userFeedback) {
    const { bookDir, storyDir } = ctx.resolveBookPaths(bookId);
    const phaseOutlinePath = join(storyDir, "outline", "phase_outline.md");
    const currentContent = await readFile(phaseOutlinePath, "utf-8").catch(() => "");
    if (!currentContent.trim()) {
        throw new Error("Phase outline does not exist yet. Run initBook first.");
    }
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupDir = join(storyDir, `.backup-phase-${timestamp}`);
    await mkdir(backupDir, { recursive: true });
    await writeFile(join(backupDir, "phase_outline.md"), currentContent, "utf-8");
    const book = await ctx.state.loadBookConfig(bookId);
    const architect = new ArchitectAgent(ctx.agentCtxFor("architect", bookId));
    const phases = architect.parsePhaseOutlineForRegen(currentContent);
    const targetPhase = phases.find((p) => p.id === phaseId);
    if (!targetPhase) {
        throw new Error(`Phase ${phaseId} not found in phase outline. Available: ${phases.map((p) => p.id).join(", ")}`);
    }
    if (targetPhase.status === "done") {
        throw new Error(`Phase ${phaseId} is already completed (status: done) and cannot be regenerated.`);
    }
    const newPhaseYaml = await architect.regeneratePhase(book, phaseId, currentContent, userFeedback);
    const updatedContent = replacePhaseInOutline(currentContent, phaseId, newPhaseYaml);
    await writeFile(phaseOutlinePath, updatedContent, "utf-8");
    ctx.config.logger?.info?.(`[regeneratePhaseOutline] Phase ${phaseId} regenerated. Backup at ${backupDir}`);
    return updatedContent;
}
/**
 * Replace a single phase block in the phase outline markdown.
 */
export function replacePhaseInOutline(raw, phaseId, newYaml) {
    let cleanYaml = newYaml.trim();
    const codeBlockMatch = cleanYaml.match(/^```(?:yaml)?\s*\n([\s\S]*?)\n```\s*$/);
    if (codeBlockMatch) {
        cleanYaml = codeBlockMatch[1].trim();
    }
    const lines = raw.split("\n");
    const result = [];
    let inTargetPhase = false;
    for (const line of lines) {
        const trimmed = line.trim();
        const phaseMatch = trimmed.match(/^##\s*(?:Phase|阶段|第)\s*(\d+)\s*[:：]/i);
        if (phaseMatch) {
            const currentId = parseInt(phaseMatch[1], 10);
            if (currentId === phaseId) {
                inTargetPhase = true;
                result.push(`## Phase ${phaseId}`);
                result.push("");
                result.push(cleanYaml);
                result.push("");
                continue;
            }
            if (inTargetPhase) {
                inTargetPhase = false;
            }
        }
        if (inTargetPhase) {
            continue;
        }
        result.push(line);
    }
    return result.join("\n");
}
