/**
 * Truth file pruning: SummaryCompactor + HookArchiver.
 *
 * Pure logic, zero LLM cost. Called from runner after Settle writes.
 */
import { readFile, writeFile, appendFile } from "node:fs/promises";
import { join } from "node:path";
import { parseChapterSummariesMarkdown, parsePendingHooksMarkdown, renderHookSnapshot } from "../utils/memory-retrieval.js";

// ── SummaryCompactor ──────────────────────────────────────────────────────────

const COMPACT_EVERY = 20;

/**
 * Check if chapter_summaries.md needs compaction.
 * Returns true when currentChapter is a multiple of COMPACT_EVERY and
 * there are un-compacted rows in the previous block.
 */
export function needsSummaryCompaction(currentChapter) {
    return currentChapter > 0 && currentChapter % COMPACT_EVERY === 0;
}

/**
 * Compact chapter summaries: take rows from the previous 20-chapter block,
 * write a one-line-per-chapter recap to volume_summaries.md, then remove
 * those rows from chapter_summaries.md.
 */
export async function compactChapterSummaries(bookDir, currentChapter) {
    const storyDir = join(bookDir, "story");
    const summariesPath = join(storyDir, "chapter_summaries.md");
    const volumeSummariesPath = join(storyDir, "volume_summaries.md");

    const raw = await readFile(summariesPath, "utf-8").catch(() => "");
    if (!raw || raw === "(文件尚未创建)") {
        return { compacted: false, reason: "no_file" };
    }

    const rows = parseChapterSummariesMarkdown(raw);
    if (rows.length === 0) {
        return { compacted: false, reason: "no_rows" };
    }

    const blockStart = currentChapter - COMPACT_EVERY + 1;
    const blockEnd = currentChapter;
    const toCompact = rows.filter(r => r.chapter >= blockStart && r.chapter <= blockEnd);

    if (toCompact.length === 0) {
        return { compacted: false, reason: "no_rows_in_block" };
    }

    // Build volume milestone recap: one line per chapter
    const recapLines = toCompact.map(r => {
        const parts = [r.title, r.events, r.stateChanges].filter(Boolean).join("；");
        return `- 第${r.chapter}章 ${r.title}：${parts || "（无摘要）"}`;
    });
    const milestoneBlock = [
        `## 第${blockStart}-${blockEnd}卷提要`,
        `> 自动生成于第${currentChapter}章写入后`,
        ...recapLines,
        "",
    ].join("\n");

    // Append to volume_summaries.md
    try {
        await appendFile(volumeSummariesPath, "\n" + milestoneBlock, "utf-8");
    } catch {
        // File doesn't exist yet — create it
        const header = "# 卷提要\n\n";
        await writeFile(volumeSummariesPath, header + milestoneBlock, "utf-8");
    }

    // Remove compacted rows from chapter_summaries.md
    const remaining = rows.filter(r => r.chapter < blockStart || r.chapter > blockEnd);
    const newContent = rebuildChapterSummariesTable(raw, remaining);
    await writeFile(summariesPath, newContent, "utf-8");

    return { compacted: true, count: toCompact.length, blockStart, blockEnd };
}

/**
 * Rebuild chapter_summaries.md preserving the original header/scaffold,
 * replacing only the data rows.
 */
function rebuildChapterSummariesTable(originalRaw, rows) {
    const lines = originalRaw.split("\n");
    const headerLines = [];
    let headerDone = false;
    for (const line of lines) {
        if (!headerDone && (line.startsWith("|") || line.trim() === "")) {
            // Keep table header + separator
            if (line.includes("---") || /^\|\s*(章节|Chapter)/i.test(line)) {
                headerLines.push(line);
            } else if (line.trim() === "" && headerLines.length > 0) {
                headerDone = true;
            } else if (line.startsWith("|")) {
                headerLines.push(line);
            } else {
                headerLines.push(line);
            }
        } else if (!headerDone) {
            headerLines.push(line);
        } else {
            break;
        }
    }

    // Find the header structure: first | line + separator line
    const headerRow = lines.find(l => /^\|\s*(章节|Chapter|\d)/i.test(l) || /^\|.*\|.*\|/i.test(l));
    const separatorRow = lines.find(l => l.includes("---") && l.startsWith("|"));

    // Rebuild with new rows
    const dataRows = rows.map(r =>
        `| ${r.chapter} | ${r.title} | ${r.characters} | ${r.events} | ${r.stateChanges} | ${r.hookActivity} | ${r.mood} | ${r.chapterType} |`
    );

    // Collect non-table lines (preamble)
    const preamble = [];
    for (const line of lines) {
        if (line.startsWith("|")) break;
        preamble.push(line);
    }

    return [
        ...preamble,
        headerRow || "| 章节 | 标题 | 人物 | 事件 | 状态变化 | 伏笔活动 | 情绪 | 章节类型 |",
        separatorRow || "| --- | --- | --- | --- | --- | --- | --- | --- |",
        ...dataRows,
        "",
    ].join("\n");
}

// ── HookArchiver ──────────────────────────────────────────────────────────────

const ARCHIVE_AFTER_CHAPTERS = 5;

const RESOLVED_PATTERN = /^(resolved|closed|done|已回收|已解决)$/i;

/**
 * Archive resolved hooks that are old enough.
 * Moves hooks with resolved status AND lastAdvancedChapter < currentChapter - 5
 * from pending_hooks.md to archived_hooks.md.
 */
export async function archiveResolvedHooks(bookDir, currentChapter) {
    const storyDir = join(bookDir, "story");
    const hooksPath = join(storyDir, "pending_hooks.md");
    const archivePath = join(storyDir, "archived_hooks.md");

    const raw = await readFile(hooksPath, "utf-8").catch(() => "");
    if (!raw || raw === "(文件尚未创建)") {
        return { archived: 0, reason: "no_file" };
    }

    const hooks = parsePendingHooksMarkdown(raw);
    if (hooks.length === 0) {
        return { archived: 0, reason: "no_hooks" };
    }

    const cutoff = currentChapter - ARCHIVE_AFTER_CHAPTERS;
    const toArchive = [];
    const toKeep = [];

    for (const hook of hooks) {
        const isResolved = RESOLVED_PATTERN.test(hook.status.trim());
        const isOldEnough = hook.lastAdvancedChapter < cutoff;
        if (isResolved && isOldEnough) {
            toArchive.push(hook);
        } else {
            toKeep.push(hook);
        }
    }

    if (toArchive.length === 0) {
        return { archived: 0, reason: "none_eligible" };
    }

    // Append to archived_hooks.md
    const archiveBlock = [
        `## 归档于第${currentChapter}章`,
        renderHookSnapshot(toArchive, "zh"),
        "",
    ].join("\n");

    try {
        await appendFile(archivePath, "\n" + archiveBlock, "utf-8");
    } catch {
        const header = "# 已归档伏笔\n\n> 状态为 resolved 且超过5章未推进的伏笔自动移入此文件。\n\n";
        await writeFile(archivePath, header + archiveBlock, "utf-8");
    }

    // Rewrite pending_hooks.md with remaining hooks
    const newContent = renderHookSnapshot(toKeep, "zh");
    await writeFile(hooksPath, newContent, "utf-8");

    return { archived: toArchive.length, kept: toKeep.length };
}
