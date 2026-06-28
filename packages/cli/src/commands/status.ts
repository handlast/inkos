import { Command } from "commander";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { StateManager, formatLengthCount, readGenreProfile, resolveLengthCountingMode } from "@actalk/inkos-core";
import { findProjectRoot, getLegacyMigrationHint, log, logError } from "../utils.js";

export const statusCommand = new Command("status")
  .description("Show project status")
  .argument("[book-id]", "Book ID (optional, shows all if omitted)")
  .option("--chapters", "Show per-chapter status and issues")
  .option("--json", "Output JSON")
  .action(async (bookIdArg: string | undefined, opts) => {
    try {
      const root = findProjectRoot();
      const state = new StateManager(root);

      const allBookIds = await state.listBooks();
      const bookIds = bookIdArg ? [bookIdArg] : allBookIds;

      if (bookIdArg && !allBookIds.includes(bookIdArg)) {
        throw new Error(
          `Book "${bookIdArg}" not found. Available: ${allBookIds.join(", ") || "(none)"}`,
        );
      }

      const booksData = [];

      if (!opts.json) {
        log(`InkOS Project: ${root}`);
        log(`Books: ${allBookIds.length}`);
        log("");
      }

      for (const id of bookIds) {
        const book = await state.loadBookConfig(id);
        const index = await state.loadChapterIndex(id);
        const migrationHint = await getLegacyMigrationHint(root, id);
        const persistedChapterCount = await state.getPersistedChapterCount(id);
        const { profile: genreProfile } = await readGenreProfile(root, book.genre);
        const countingMode = resolveLengthCountingMode(book.language ?? genreProfile.language);

        const approved = index.filter((ch) => ch.status === "approved").length;
        const pending = index.filter(
          (ch) => ch.status === "ready-for-review",
        ).length;
        const failed = index.filter(
          (ch) => ch.status === "audit-failed",
        ).length;
        const degraded = index.filter(
          (ch) => ch.status === "state-degraded",
        ).length;
        const resettleAdvice = await detectResettleAdvice(state.bookDir(id), id, index, persistedChapterCount);
        const totalWords = index.reduce((sum, ch) => sum + ch.wordCount, 0);
        const avgWords = index.length > 0 ? Math.round(totalWords / index.length) : 0;

        booksData.push({
          id,
          title: book.title,
          status: book.status,
          genre: book.genre,
          platform: book.platform,
          chapters: persistedChapterCount,
          targetChapters: book.targetChapters,
          totalWords,
          avgWordsPerChapter: avgWords,
          approved,
          pending,
          failed,
          degraded,
          ...(resettleAdvice ? { resettleAdvice } : {}),
          ...(migrationHint ? { migrationHint } : {}),
          ...(opts.chapters ? {
            chapterList: index.map((ch) => ({
              number: ch.number,
              title: ch.title,
              status: ch.status,
              wordCount: ch.wordCount,
              ...(ch.status === "audit-failed" || ch.status === "state-degraded"
                ? { issues: ch.auditIssues }
                : {}),
            })),
          } : {}),
        });

        if (!opts.json) {
          log(`  ${book.title} (${id})`);
          log(`    Status: ${book.status}`);
          log(`    Platform: ${book.platform} | Genre: ${book.genre}`);
          log(`    Chapters: ${persistedChapterCount} / ${book.targetChapters}`);
          log(`    Words: ${totalWords.toLocaleString()} (avg ${avgWords}/ch)`);
          log(`    Approved: ${approved} | Pending: ${pending} | Failed: ${failed} | Degraded: ${degraded}`);
          if (resettleAdvice) {
            log(`    State repair: ${resettleAdvice.reason}`);
            log(`    Suggested: ${resettleAdvice.command}`);
          }
          if (migrationHint) {
            log(`    Migration: ${migrationHint}`);
          }

          if (opts.chapters && index.length > 0) {
            log("");
            for (const ch of index) {
              const icon = ch.status === "approved"
                ? "+"
                : ch.status === "audit-failed"
                  ? "!"
                  : ch.status === "state-degraded"
                    ? "x"
                    : "~";
              log(`    [${icon}] Ch.${ch.number} "${ch.title}" | ${formatLengthCount(ch.wordCount, countingMode)} | ${ch.status}`);
              if ((ch.status === "audit-failed" || ch.status === "state-degraded") && ch.auditIssues.length > 0) {
                const criticals = ch.auditIssues.filter((i: string) => i.startsWith("[critical]"));
                const warnings = ch.auditIssues.filter((i: string) => i.startsWith("[warning]"));
                if (criticals.length > 0) {
                  for (const issue of criticals) {
                    log(`        ${issue}`);
                  }
                }
                if (warnings.length > 0) {
                  if (ch.status === "state-degraded") {
                    for (const issue of warnings) {
                      log(`        ${issue}`);
                    }
                  } else {
                    log(`        + ${warnings.length} warning(s)`);
                  }
                }
              }
            }
          }
          log("");
        }
      }

      if (opts.json) {
        log(JSON.stringify({ project: root, books: booksData }, null, 2));
      }
    } catch (e) {
      if (opts.json) {
        log(JSON.stringify({ error: String(e) }));
      } else {
        logError(`Failed to get status: ${e}`);
      }
      process.exit(1);
    }
  });

interface ResettleAdvice {
  chapterNumber: number;
  reason: string;
  command: string;
}

interface ChapterIndexEntry {
  number: number;
  title: string;
  status: string;
  wordCount: number;
  auditIssues: readonly string[];
}

async function detectResettleAdvice(
  bookDir: string,
  bookId: string,
  index: ReadonlyArray<ChapterIndexEntry>,
  persistedChapterCount: number,
): Promise<ResettleAdvice | null> {
  if (index.length === 0 || persistedChapterCount <= 0) return null;

  const latest = [...index].sort((a, b) => b.number - a.number)[0];
  if (!latest) return null;

  if (latest.status === "state-degraded") {
    return buildResettleAdvice(bookId, latest.number, `latest chapter ${latest.number} is state-degraded`);
  }

  const stateDir = join(bookDir, "story", "state");
  const [manifest, currentState] = await Promise.all([
    readJson(join(stateDir, "manifest.json")),
    readJson(join(stateDir, "current_state.json")),
  ]);

  const manifestChapter = readNumber(manifest?.lastAppliedChapter);
  const currentChapter = readNumber(currentState?.chapter);

  if (manifestChapter !== undefined && manifestChapter < latest.number) {
    return buildResettleAdvice(bookId, latest.number, `runtime manifest is at chapter ${manifestChapter}, latest chapter is ${latest.number}`);
  }
  if (currentChapter !== undefined && currentChapter < latest.number) {
    return buildResettleAdvice(bookId, latest.number, `current_state is at chapter ${currentChapter}, latest chapter is ${latest.number}`);
  }
  if (manifestChapter !== undefined && currentChapter !== undefined && manifestChapter !== currentChapter) {
    return buildResettleAdvice(bookId, latest.number, `runtime manifest chapter ${manifestChapter} differs from current_state chapter ${currentChapter}`);
  }
  return null;
}

function buildResettleAdvice(bookId: string, chapterNumber: number, reason: string): ResettleAdvice {
  return {
    chapterNumber,
    reason,
    command: `inkos write resettle ${bookId} ${chapterNumber} --json`,
  };
}

async function readJson(path: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await readFile(path, "utf-8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
