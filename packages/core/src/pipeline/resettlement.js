/**
 * Resettlement — extracted from runner.js
 *
 * Chapter state resettlement: re-sync truth files from a previous snapshot
 * when the current chapter's state is degraded or corrupted.
 *
 * Functions accept a `ctx` object for dependency injection instead of
 * relying on `this` binding to the runner.
 */
import { readFile, writeFile, readdir, mkdir, rm, stat, mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { StateManager } from "../state/manager.js";
import { WriterAgent } from "../agents/writer.js";
import { StateValidatorAgent } from "../agents/state-validator.js";
import { loadRuntimeStateSnapshotAsOf } from "../state/runtime-state-store.js";
import { rewriteStructuredStateFromMarkdown } from "../state/state-bootstrap.js";
import { parseStateDegradedReviewNote, resolveStateDegradedBaseStatus, retrySettlementAfterValidationFailure, shouldRetryStateSettlement, } from "./chapter-state-recovery.js";
/**
 * Extract character names from a chapter memo body (Active Cast section).
 * Returns a Set of lowercase character names for entity-based stale detection.
 */
export function extractCastNamesFromBody(body) {
    if (!body) return new Set();
    const sectionHeadings = ["本章出场人物", "Active Cast"];
    const lines = body.split("\n");
    const start = lines.findIndex((line) => sectionHeadings.some((h) => line.trim() === `## ${h}` || line.trim() === `### ${h}`));
    if (start < 0) return new Set();
    const names = new Set();
    for (let i = start + 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (/^#{2,3}\s/.test(line)) break;
        if (!line.startsWith("-")) continue;
        const nameMatch = line.match(/name\s*[：:]\s*([^\s，,。.、|]+)/i)
            ?? line.match(/^[-*]\s*([^：:，,|\s]+)/);
        if (nameMatch?.[1]) names.add(nameMatch[1].trim().toLowerCase());
    }
    return names;
}
/**
 * Mark downstream chapters as stale after a rework, using entity-based
 * dependency tracking instead of a fixed distance radius.
 *
 * @param {object} params
 * @param {object} params.state - StateManager instance
 * @param {string} params.bookId
 * @param {number} params.reworkedChapter
 * @param {string} params.language
 * @param {function} params.logInfo
 */
export async function markDownstreamChaptersStale(params) {
    const STALE_BLAST_RADIUS = 10;
    const index = [...(await params.state.loadChapterIndex(params.bookId))];
    const runtimeDir = join(params.state.bookDir(params.bookId), "story", "runtime");
    // Extract cast names from the reworked chapter's intent file
    const reworkedIntentPath = join(runtimeDir, `chapter-${String(params.reworkedChapter).padStart(4, "0")}.intent.md`);
    let reworkedCastNames = new Set();
    try {
        const intentContent = await readFile(reworkedIntentPath, "utf-8");
        reworkedCastNames = extractCastNamesFromBody(intentContent);
    } catch { /* no intent file — fall back to radius */ }
    const hasEntityData = reworkedCastNames.size > 0;
    // Pre-load downstream intent files for entity comparison
    const downstreamEntries = index.filter((e) => e.number > params.reworkedChapter && !e.staleAfter);
    const dsCastMap = new Map();
    if (hasEntityData) {
        await Promise.all(downstreamEntries.map(async (entry) => {
            const dsPath = join(runtimeDir, `chapter-${String(entry.number).padStart(4, "0")}.intent.md`);
            try {
                const content = await readFile(dsPath, "utf-8");
                dsCastMap.set(entry.number, extractCastNamesFromBody(content));
            } catch { /* no intent file */ }
        }));
    }
    let changed = false;
    const updated = index.map((entry) => {
        if (entry.number <= params.reworkedChapter || entry.staleAfter) return entry;
        if (hasEntityData) {
            const dsCast = dsCastMap.get(entry.number);
            if (!dsCast || dsCast.size === 0) return entry;
            const overlap = [...reworkedCastNames].some((name) => dsCast.has(name));
            if (!overlap) return entry;
        } else {
            if (entry.number > params.reworkedChapter + STALE_BLAST_RADIUS) return entry;
        }
        changed = true;
        return { ...entry, staleAfter: params.reworkedChapter };
    });
    if (changed) {
        await params.state.saveChapterIndex(params.bookId, updated);
        const staleCount = updated.filter((e) => e.staleAfter === params.reworkedChapter).length;
        if (hasEntityData) {
            params.logInfo?.(`[runner] ${staleCount} chapters marked stale after rework of chapter ${params.reworkedChapter} (entity: [${[...reworkedCastNames].join(", ")}])`);
        } else {
            params.logInfo?.(`[runner] ${staleCount} chapters marked stale after rework of chapter ${params.reworkedChapter} (radius fallback: ${STALE_BLAST_RADIUS})`);
        }
    }
}
/**
 * Prepare a staging book directory for resettlement by removing chapters
 * and snapshots at or after the target chapter.
 */
export async function prepareStagingBookForResettlement(stagingState, bookId, targetChapter, originalIndex) {
    const stagingBookDir = stagingState.bookDir(bookId);
    const chaptersDir = join(stagingBookDir, "chapters");
    const snapshotsDir = join(stagingBookDir, "story", "snapshots");
    await stagingState.saveChapterIndex(bookId, originalIndex.filter((chapter) => chapter.number < targetChapter));
    const removeNumberedFiles = async (dir, pattern) => {
        const entries = await readdir(dir).catch(() => []);
        await Promise.all(entries.map(async (entry) => {
            const match = entry.match(pattern);
            if (!match)
                return;
            const number = parseInt(match[1], 10);
            if (Number.isFinite(number) && number >= targetChapter) {
                await rm(join(dir, entry), { recursive: true, force: true }).catch(() => undefined);
            }
        }));
    };
    await removeNumberedFiles(chaptersDir, /^(\d+)_.*\.md$/);
    const snapshotEntries = await readdir(snapshotsDir).catch(() => []);
    await Promise.all(snapshotEntries.map(async (entry) => {
        const number = parseInt(entry, 10);
        if (Number.isFinite(number) && number >= targetChapter) {
            await rm(join(snapshotsDir, entry), { recursive: true, force: true }).catch(() => undefined);
        }
    }));
}
/**
 * Create a backup of truth files before resettlement.
 */
export async function createResettlementBackup(bookDir, chapterNumber) {
    const storyDir = join(bookDir, "story");
    const backupDir = join(storyDir, "backups", `resettle-${String(chapterNumber).padStart(4, "0")}-${new Date().toISOString().replace(/[:.]/g, "-")}`);
    await mkdir(backupDir, { recursive: true });
    const truthFiles = [
        "current_state.md",
        "particle_ledger.md",
        "pending_hooks.md",
        "chapter_summaries.md",
        "subplot_board.md",
        "emotional_arcs.md",
        "character_matrix.md",
    ];
    await Promise.all(truthFiles.map(async (fileName) => {
        const content = await readFile(join(storyDir, fileName), "utf-8").catch(() => undefined);
        if (typeof content === "string") {
            await writeFile(join(backupDir, fileName), content, "utf-8");
        }
    }));
    await copyDirRecursive(join(storyDir, "state"), join(backupDir, "state"));
    await copyDirRecursive(join(storyDir, "snapshots", String(chapterNumber)), join(backupDir, "snapshot"));
}
/**
 * Copy resettled truth artifacts from staging to the real book directory.
 */
export async function copyResettledTruthArtifacts(sourceBookDir, targetBookDir, chapterNumber) {
    const sourceStoryDir = join(sourceBookDir, "story");
    const targetStoryDir = join(targetBookDir, "story");
    await mkdir(targetStoryDir, { recursive: true });
    const truthFiles = [
        "current_state.md",
        "particle_ledger.md",
        "pending_hooks.md",
        "chapter_summaries.md",
        "subplot_board.md",
        "emotional_arcs.md",
        "character_matrix.md",
    ];
    await Promise.all(truthFiles.map(async (fileName) => {
        const sourcePath = join(sourceStoryDir, fileName);
        const targetPath = join(targetStoryDir, fileName);
        const content = await readFile(sourcePath, "utf-8").catch(() => undefined);
        if (typeof content === "string") {
            await writeFile(targetPath, content, "utf-8");
        }
        else {
            await rm(targetPath, { force: true }).catch(() => undefined);
        }
    }));
    await rm(join(targetStoryDir, "state"), { recursive: true, force: true }).catch(() => undefined);
    await copyDirRecursive(join(sourceStoryDir, "state"), join(targetStoryDir, "state"));
    await rm(join(targetStoryDir, "snapshots", String(chapterNumber)), { recursive: true, force: true }).catch(() => undefined);
    await copyDirRecursive(join(sourceStoryDir, "snapshots", String(chapterNumber)), join(targetStoryDir, "snapshots", String(chapterNumber)));
}
/**
 * Recursively copy a directory.
 */
export async function copyDirRecursive(src, dest) {
    try {
        await mkdir(dest, { recursive: true });
        const entries = await readdir(src, { withFileTypes: true });
        for (const entry of entries) {
            const srcPath = join(src, entry.name);
            const destPath = join(dest, entry.name);
            if (entry.isDirectory()) {
                await copyDirRecursive(srcPath, destPath);
            }
            else if (entry.isFile()) {
                try {
                    const content = await readFile(srcPath, "utf-8");
                    await writeFile(destPath, content, "utf-8");
                }
                catch {
                    // Skip unreadable files.
                }
            }
        }
    }
    catch {
        // Source directory does not exist.
    }
}
/**
 * Shallow-copy a directory (one level only).
 */
export async function copyDirShallow(src, dest) {
    try {
        await mkdir(dest, { recursive: true });
        const entries = await readdir(src);
        await Promise.all(entries.map(async (entry) => {
            try {
                const content = await readFile(join(src, entry), "utf-8");
                await writeFile(join(dest, entry), content, "utf-8");
            }
            catch {
                // Skip unreadable files.
            }
        }));
    }
    catch {
        // Source directory does not exist.
    }
}
