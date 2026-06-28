import { Command } from "commander";
import { PipelineRunner, StateManager } from "@actalk/inkos-core";
import { cp, mkdir, mkdtemp, readdir, rm, stat, unlink } from "node:fs/promises";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";
import { createInterface } from "node:readline";
import { loadConfig, buildPipelineConfig, findProjectRoot, getLegacyMigrationHint, resolveContext, resolveBookId, log, logError } from "../utils.js";
import { formatWriteNextComplete, formatWriteNextProgress, formatWriteNextResultLines, resolveCliLanguage } from "../localization.js";

const BATCH_STOP_STATUSES: ReadonlySet<string> = new Set([
  "state-degraded",
  "settlement-degraded",
  "audit-failed",
]);

const BATCH_STOP_ISSUE_CODES: ReadonlySet<string> = new Set([
  "HOOK_LEDGER_ILLEGAL",
  "HOOK_LEDGER_MISSING_REQUIRED",
  "HOOK_LEDGER_MALFORMED",
  "STATE_VALIDATION_DEGRADED",
  "SETTLEMENT_DEGRADED",
  "CHAPTER_STATE_RECOVERY_DEGRADED",
]);

const BATCH_STOP_ISSUE_PATTERN =
  /(hook\s*ledger|hook\s*账|truth\s*validation|truth\s*file|state-validation|settlement|状态校验|状态结算|真相文件)/i;

export const writeCommand = new Command("write")
  .description("Write chapters");

writeCommand
  .command("next")
  .description("Write the next chapter for a book")
  .argument("[book-id]", "Book ID (auto-detected if only one book)")
  .option("--count <n>", "Number of chapters to write", "1")
  .option("--words <n>", "Words per chapter (overrides book config)")
  .option("--context <text>", "Creative guidance (natural language)")
  .option("--context-file <path>", "Read guidance from file")
  .option("--json", "Output JSON")
  .option("-q, --quiet", "Suppress console output")
  .action(async (bookIdArg: string | undefined, opts) => {
    try {
      const root = findProjectRoot();
      const bookId = await resolveBookId(bookIdArg, root);
      const context = await resolveContext(opts);
      const state = new StateManager(root);
      const book = await state.loadBookConfig(bookId);
      const language = resolveCliLanguage(book.language);
      const migrationHint = await getLegacyMigrationHint(root, bookId);
      if (migrationHint && !opts.json) {
        log(`[migration] ${migrationHint}`);
      }
      const config = await loadConfig();

      const pipeline = new PipelineRunner(buildPipelineConfig(config, root, { externalContext: context, quiet: opts.quiet }));

      const count = parseInt(opts.count, 10);
      const wordCount = opts.words ? parseInt(opts.words, 10) : undefined;

      const results = [];
      for (let i = 0; i < count; i++) {
        if (!opts.json) log(formatWriteNextProgress(language, i + 1, count, bookId));

        const result = await pipeline.writeNextChapter(bookId, wordCount);
        results.push(result);

        if (!opts.json) {
          for (const line of formatWriteNextResultLines(language, {
            chapterNumber: result.chapterNumber,
            title: result.title,
            wordCount: result.wordCount,
            auditPassed: result.auditResult.passed,
            revised: result.revised,
            status: result.status,
            issues: result.auditResult.issues,
          })) {
            log(line);
          }
          log("");
        }

        if (shouldStopWriteBatch(result)) {
          if (!opts.json) {
            log(language === "en"
              ? "Repair required before continuing. Stopping batch."
              : "需要先修复本章失败状态，已停止后续连写。");
          }
          break;
        }
      }

      if (opts.json) {
        log(JSON.stringify(results, null, 2));
      } else {
        log(formatWriteNextComplete(language));
      }
    } catch (e) {
      if (opts.json) {
        log(JSON.stringify({ error: String(e) }));
      } else {
        logError(`Failed to write chapter: ${e}`);
      }
      process.exit(1);
    }
  });

interface AuditIssue {
  readonly code?: string;
  readonly category?: string;
  readonly description?: string;
  readonly suggestion?: string;
}

interface WriteResult {
  readonly status: string;
  readonly auditResult: { readonly issues?: ReadonlyArray<AuditIssue> };
}

function shouldStopWriteBatch(result: WriteResult): boolean {
  if (BATCH_STOP_STATUSES.has(result.status)) {
    return true;
  }
  const issues: ReadonlyArray<AuditIssue> = result.auditResult?.issues ?? [];
  return issues.some((issue) => {
    if (issue.code && BATCH_STOP_ISSUE_CODES.has(issue.code)) {
      return true;
    }
    return BATCH_STOP_ISSUE_PATTERN.test(
      [issue.category, issue.description, issue.suggestion].filter(Boolean).join(" ")
    );
  });
}

async function syncDirectoryContents(sourceDir: string, targetDir: string): Promise<void> {
  await mkdir(targetDir, { recursive: true });
  await cp(sourceDir, targetDir, { recursive: true, force: true });
  await removeEntriesMissingFromSource(sourceDir, targetDir);
}

async function removeEntriesMissingFromSource(sourceDir: string, targetDir: string): Promise<void> {
  const [sourceEntries, targetEntries] = await Promise.all([
    readdir(sourceDir, { withFileTypes: true }),
    readdir(targetDir, { withFileTypes: true }),
  ]);
  const sourceNames = new Set(sourceEntries.map((entry) => entry.name));
  for (const targetEntry of targetEntries) {
    if (!sourceNames.has(targetEntry.name)) {
      await rm(join(targetDir, targetEntry.name), { recursive: true, force: true });
    }
  }
  for (const sourceEntry of sourceEntries) {
    if (!sourceEntry.isDirectory()) {
      continue;
    }
    const sourcePath = join(sourceDir, sourceEntry.name);
    const targetPath = join(targetDir, sourceEntry.name);
    const targetStats = await stat(targetPath).catch(() => undefined);
    if (targetStats?.isDirectory()) {
      await removeEntriesMissingFromSource(sourcePath, targetPath);
    }
  }
}

writeCommand
  .command("rewrite")
  .description("Re-generate a specific chapter: rewrite [book-id] <chapter>")
  .argument("<args...>", "Book ID (optional) and chapter number")
  .option("--force", "Skip confirmation prompt")
  .option("--words <n>", "Words per chapter (overrides book config)")
  .option("--brief <text>", "One-off creative guidance for this rewrite only")
  .option("--json", "Output JSON")
  .action(async (args: ReadonlyArray<string>, opts) => {
    let rollbackRewrite: (() => Promise<void>) | undefined;
    try {
      const root = findProjectRoot();

      let bookId: string;
      let chapter: number;
      if (args.length === 1) {
        chapter = parseInt(args[0]!, 10);
        if (isNaN(chapter)) throw new Error(`Expected chapter number, got "${args[0]}"`);
        bookId = await resolveBookId(undefined, root);
      } else if (args.length === 2) {
        chapter = parseInt(args[1]!, 10);
        if (isNaN(chapter)) throw new Error(`Expected chapter number, got "${args[1]}"`);
        bookId = await resolveBookId(args[0], root);
      } else {
        throw new Error("Usage: inkos write rewrite [book-id] <chapter>");
      }

      if (!opts.force) {
        const rl = createInterface({ input: process.stdin, output: process.stdout });
        const answer = await new Promise<string>((resolve) => {
          rl.question(`Rewrite chapter ${chapter} of "${bookId}"? This will delete chapter ${chapter} and all later chapters. (y/N) `, resolve);
        });
        rl.close();
        if (answer.toLowerCase() !== "y") {
          log("Cancelled.");
          return;
        }
      }

      const state = new StateManager(root);
      const bookDir = state.bookDir(bookId);
      const restoreFrom = chapter - 1;
      const restoreSnapshotDir = join(bookDir, "story", "snapshots", String(restoreFrom));
      await stat(restoreSnapshotDir).catch(() => {
        throw new Error(`Cannot rewrite chapter ${chapter}: missing snapshot for chapter ${restoreFrom}`);
      });
      const migrationHint = await getLegacyMigrationHint(root, bookId);
      if (migrationHint && !opts.json) {
        log(`[migration] ${migrationHint}`);
      }

      const paddedNum = String(chapter).padStart(4, "0");
      const targetBookDir = bookDir;
      const stagingRoot = await mkdtemp(join(tmpdir(), "inkos-rewrite-"));
      const stagingBooksDir = join(stagingRoot, "books");
      const stagingBookDir = join(stagingBooksDir, bookId);
      await mkdir(stagingBooksDir, { recursive: true });
      await cp(targetBookDir, stagingBookDir, { recursive: true });

      rollbackRewrite = async () => {
        await rm(stagingRoot, { recursive: true, force: true }).catch(() => undefined);
      };

      const stagingState = new StateManager(stagingRoot);
      const stagingChaptersDir = join(stagingBookDir, "chapters");
      const stagingFiles = await readdir(stagingChaptersDir);
      const existing = stagingFiles.filter((f) => f.startsWith(paddedNum) && f.endsWith(".md"));

      for (const f of existing) {
        await unlink(join(stagingChaptersDir, f));
        if (!opts.json) log(`Staged removal: ${f}`);
      }

      const index = await stagingState.loadChapterIndex(bookId);
      const trimmed = index.filter((ch) => ch.number < chapter);
      await stagingState.saveChapterIndex(bookId, trimmed);

      const laterFiles = stagingFiles.filter((f) => {
        const num = parseInt(f.slice(0, 4), 10);
        return num > chapter && f.endsWith(".md");
      });
      for (const f of laterFiles) {
        await unlink(join(stagingChaptersDir, f));
        if (!opts.json) log(`Staged removal of later chapter: ${f}`);
      }

      const restored = await stagingState.restoreState(bookId, restoreFrom);
      if (!restored) {
        throw new Error(`Cannot rewrite chapter ${chapter}: failed to restore snapshot for chapter ${restoreFrom}`);
      }
      if (!opts.json) log(`State restored from chapter ${restoreFrom} snapshot.`);

      const nextChapter = await stagingState.getNextChapterNumber(bookId);
      if (nextChapter !== chapter) {
        throw new Error(`Cannot rewrite chapter ${chapter}: expected next chapter to be ${chapter}, but resolved to ${nextChapter}`);
      }

      if (!opts.json) log(`Regenerating chapter ${chapter}...`);

      const wordCount = opts.words ? parseInt(opts.words, 10) : undefined;

      const config = await loadConfig({ projectRoot: root });
      const pipeline = new PipelineRunner(buildPipelineConfig(config, stagingRoot, {
        externalContext: opts.brief,
      }));

      const result = await pipeline.writeNextChapter(bookId, wordCount);

      const swapRoot = await mkdtemp(join(tmpdir(), "inkos-rewrite-swap-"));
      const backupBookDir = join(swapRoot, basename(bookDir));
      await cp(bookDir, backupBookDir, { recursive: true });

      rollbackRewrite = async () => {
        await syncDirectoryContents(backupBookDir, bookDir).catch(() => undefined);
        await rm(stagingRoot, { recursive: true, force: true }).catch(() => undefined);
        await rm(swapRoot, { recursive: true, force: true }).catch(() => undefined);
      };

      await syncDirectoryContents(stagingBookDir, bookDir);
      await rm(stagingRoot, { recursive: true, force: true }).catch(() => undefined);
      await rm(swapRoot, { recursive: true, force: true }).catch(() => undefined);
      rollbackRewrite = undefined;

      const book = await state.loadBookConfig(bookId);
      const language = resolveCliLanguage(book.language);

      if (opts.json) {
        log(JSON.stringify(result, null, 2));
      } else {
        for (const line of formatWriteNextResultLines(language, {
          chapterNumber: result.chapterNumber,
          title: result.title,
          wordCount: result.wordCount,
          auditPassed: result.auditResult.passed,
          revised: result.revised,
          status: result.status,
          issues: result.auditResult.issues,
        })) {
          log(line);
        }
      }
    } catch (e) {
      if (rollbackRewrite) {
        try {
          await rollbackRewrite();
          if (!opts.json) log("Rewrite failed; restored previous book state.");
        } catch (restoreError) {
          if (!opts.json) logError(`Rewrite failed and rollback also failed: ${restoreError}`);
        }
      }
      if (opts.json) {
        log(JSON.stringify({ error: String(e) }));
      } else {
        logError(`Failed to rewrite chapter: ${e}`);
      }
      process.exit(1);
    }
  });

writeCommand
  .command("sync")
  .alias("resettle")
  .description("Resettle truth files and indexes from the previous snapshot without rewriting chapter body")
  .argument("<args...>", "Book ID (optional) and chapter number")
  .option("--brief <text>", "One-off guidance for how to interpret the edited chapter while syncing")
  .option("--json", "Output JSON")
  .action(async (args: ReadonlyArray<string>, opts) => {
    try {
      const root = findProjectRoot();

      let bookId: string;
      let chapter: number;
      if (args.length === 1) {
        chapter = parseInt(args[0]!, 10);
        if (isNaN(chapter)) throw new Error(`Expected chapter number, got "${args[0]}"`);
        bookId = await resolveBookId(undefined, root);
      } else if (args.length === 2) {
        chapter = parseInt(args[1]!, 10);
        if (isNaN(chapter)) throw new Error(`Expected chapter number, got "${args[1]}"`);
        bookId = await resolveBookId(args[0], root);
      } else {
        throw new Error("Usage: inkos write sync [book-id] <chapter>");
      }

      const state = new StateManager(root);
      const book = await state.loadBookConfig(bookId);
      const language = resolveCliLanguage(book.language);
      const config = await loadConfig();
      const pipeline = new PipelineRunner(buildPipelineConfig(config, root, {
        externalContext: opts.brief,
      }));
      const result = await pipeline.resyncChapterArtifacts(bookId, chapter);

      if (opts.json) {
        log(JSON.stringify(result, null, 2));
      } else {
        for (const line of formatWriteNextResultLines(language, {
          chapterNumber: result.chapterNumber,
          title: result.title,
          wordCount: result.wordCount,
          auditPassed: result.auditResult.passed,
          revised: result.revised,
          status: result.status,
          issues: result.auditResult.issues,
        })) {
          log(line);
        }
      }
    } catch (e) {
      if (opts.json) {
        log(JSON.stringify({ error: String(e) }));
      } else {
        logError(`Failed to sync chapter artifacts: ${e}`);
      }
      process.exit(1);
    }
  });

writeCommand
  .command("repair-state")
  .description("Rebuild truth files for a persisted state-degraded chapter without rewriting body text")
  .argument("<args...>", "Book ID (optional) and chapter number")
  .option("--json", "Output JSON")
  .action(async (args: ReadonlyArray<string>, opts) => {
    try {
      const root = findProjectRoot();

      let bookId: string;
      let chapter: number;
      if (args.length === 1) {
        chapter = parseInt(args[0]!, 10);
        if (isNaN(chapter)) throw new Error(`Expected chapter number, got "${args[0]}"`);
        bookId = await resolveBookId(undefined, root);
      } else if (args.length === 2) {
        chapter = parseInt(args[1]!, 10);
        if (isNaN(chapter)) throw new Error(`Expected chapter number, got "${args[1]}"`);
        bookId = await resolveBookId(args[0], root);
      } else {
        throw new Error("Usage: inkos write repair-state [book-id] <chapter>");
      }

      const state = new StateManager(root);
      const book = await state.loadBookConfig(bookId);
      const language = resolveCliLanguage(book.language);
      const config = await loadConfig();
      const pipeline = new PipelineRunner(buildPipelineConfig(config, root));
      const result = await pipeline.repairChapterState(bookId, chapter);

      if (opts.json) {
        log(JSON.stringify(result, null, 2));
      } else {
        for (const line of formatWriteNextResultLines(language, {
          chapterNumber: result.chapterNumber,
          title: result.title,
          wordCount: result.wordCount,
          auditPassed: result.auditResult.passed,
          revised: result.revised,
          status: result.status,
          issues: result.auditResult.issues,
        })) {
          log(line);
        }
      }
    } catch (e) {
      if (opts.json) {
        log(JSON.stringify({ error: String(e) }));
      } else {
        logError(`Failed to repair chapter state: ${e}`);
      }
      process.exit(1);
    }
  });

writeCommand
  .command("regenerate-phase")
  .description("Regenerate a single phase in the phase outline with user feedback")
  .argument("<args...>", "Book ID (optional) and phase number")
  .requiredOption("--feedback <text>", "Revision instructions for the phase")
  .option("--json", "Output JSON")
  .action(async (args: ReadonlyArray<string>, opts) => {
    try {
      const root = findProjectRoot();

      let bookId: string;
      let phaseId: number;
      if (args.length === 1) {
        phaseId = parseInt(args[0]!, 10);
        if (isNaN(phaseId)) throw new Error(`Expected phase number, got "${args[0]}"`);
        bookId = await resolveBookId(undefined, root);
      } else if (args.length === 2) {
        phaseId = parseInt(args[1]!, 10);
        if (isNaN(phaseId)) throw new Error(`Expected phase number, got "${args[1]}"`);
        bookId = await resolveBookId(args[0], root);
      } else {
        throw new Error("Usage: inkos write regenerate-phase [book-id] <phase> --feedback \"...\"");
      }

      const config = await loadConfig();
      const pipeline = new PipelineRunner(buildPipelineConfig(config, root));
      const result = await pipeline.regeneratePhaseOutline(bookId, phaseId, opts.feedback);

      if (opts.json) {
        log(JSON.stringify({ phaseId, content: result }, null, 2));
      } else {
        log(`Phase ${phaseId} regenerated.\n`);
        log(result);
      }
    } catch (e) {
      if (opts.json) {
        log(JSON.stringify({ error: String(e) }));
      } else {
        logError(`Failed to regenerate phase: ${e}`);
      }
      process.exit(1);
    }
  });

writeCommand
  .command("regenerate-chapter")
  .description("Regenerate a single chapter memo with user feedback")
  .argument("<args...>", "Book ID (optional) and chapter number")
  .requiredOption("--feedback <text>", "Revision instructions for the chapter memo")
  .option("--json", "Output JSON")
  .action(async (args: ReadonlyArray<string>, opts) => {
    try {
      const root = findProjectRoot();

      let bookId: string;
      let chapter: number;
      if (args.length === 1) {
        chapter = parseInt(args[0]!, 10);
        if (isNaN(chapter)) throw new Error(`Expected chapter number, got "${args[0]}"`);
        bookId = await resolveBookId(undefined, root);
      } else if (args.length === 2) {
        chapter = parseInt(args[1]!, 10);
        if (isNaN(chapter)) throw new Error(`Expected chapter number, got "${args[1]}"`);
        bookId = await resolveBookId(args[0], root);
      } else {
        throw new Error("Usage: inkos write regenerate-chapter [book-id] <chapter> --feedback \"...\"");
      }

      const config = await loadConfig();
      const pipeline = new PipelineRunner(buildPipelineConfig(config, root));
      const memo = await pipeline.regenerateChapterOutline(bookId, chapter, opts.feedback);

      if (opts.json) {
        log(JSON.stringify(memo, null, 2));
      } else {
        log(`Chapter ${chapter} memo regenerated.\n`);
        log(`## Goal\n${memo.goal}\n`);
        log(memo.body);
      }
    } catch (e) {
      if (opts.json) {
        log(JSON.stringify({ error: String(e) }));
      } else {
        logError(`Failed to regenerate chapter memo: ${e}`);
      }
      process.exit(1);
    }
  });