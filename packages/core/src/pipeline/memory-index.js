/**
 * Memory Index — extracted from runner.js
 *
 * Manages SQLite-backed narrative memory indexes (facts, summaries, hooks).
 * Extracted to reduce runner.js bloat and enable independent patching.
 */
import { MemoryDB } from "../state/memory-db.js";
import { loadNarrativeMemorySeed, loadSnapshotCurrentStateFacts } from "../state/runtime-state-store.js";
function factKey(fact) {
    return `${fact.subject}::${fact.predicate}`;
}
export function isMemoryIndexUnavailableError(error) {
    if (!error)
        return false;
    const code = typeof error === "object" && error !== null && "code" in error
        ? String(error.code ?? "")
        : "";
    const message = error instanceof Error
        ? error.message
        : String(error);
    const normalizedMessage = message.trim();
    return /^No such built-in module:\s*node:sqlite$/i.test(normalizedMessage)
        || /^Cannot find module ['"]node:sqlite['"]$/i.test(normalizedMessage)
        || (code === "ERR_UNKNOWN_BUILTIN_MODULE" && /\bnode:sqlite\b/i.test(normalizedMessage));
}
export function isMemoryIndexBusyError(error) {
    if (!error)
        return false;
    const code = typeof error === "object" && error !== null && "code" in error
        ? String(error.code ?? "")
        : "";
    const message = error instanceof Error
        ? error.message
        : String(error);
    return code === "SQLITE_BUSY"
        || code === "SQLITE_LOCKED"
        || /\bSQLITE_BUSY\b/i.test(message)
        || /\bSQLITE_LOCKED\b/i.test(message)
        || /database is locked/i.test(message)
        || /database is busy/i.test(message);
}
export function canOpenMemoryIndex(bookDir) {
    let memoryDb = null;
    try {
        memoryDb = new MemoryDB(bookDir);
        return true;
    }
    catch {
        return false;
    }
    finally {
        memoryDb?.close();
    }
}
export async function withMemoryIndexRetry(operation) {
    const retryDelaysMs = [0, 25, 75];
    let lastError;
    for (let attempt = 0; attempt < retryDelaysMs.length; attempt += 1) {
        try {
            return await operation();
        }
        catch (error) {
            lastError = error;
            if (!isMemoryIndexBusyError(error) || attempt === retryDelaysMs.length - 1) {
                throw error;
            }
            await new Promise((resolve) => setTimeout(resolve, retryDelaysMs[attempt + 1]));
        }
    }
    throw lastError;
}
export async function rebuildCurrentStateFactHistory(bookDir, uptoChapter) {
    const memoryDb = await withMemoryIndexRetry(async () => {
        const db = new MemoryDB(bookDir);
        try {
            db.resetFacts();
            const activeFacts = new Map();
            for (let chapter = 0; chapter <= uptoChapter; chapter++) {
                const snapshotFacts = await loadSnapshotCurrentStateFacts(bookDir, chapter);
                if (snapshotFacts.length === 0)
                    continue;
                const nextFacts = new Map();
                for (const fact of snapshotFacts) {
                    nextFacts.set(factKey(fact), {
                        subject: fact.subject,
                        predicate: fact.predicate,
                        object: fact.object,
                        validFromChapter: chapter,
                        validUntilChapter: null,
                        sourceChapter: chapter,
                    });
                }
                for (const [key, previous] of activeFacts.entries()) {
                    const next = nextFacts.get(key);
                    if (!next || next.object !== previous.object) {
                        db.invalidateFact(previous.id, chapter);
                        activeFacts.delete(key);
                    }
                }
                for (const [key, fact] of nextFacts.entries()) {
                    if (activeFacts.has(key))
                        continue;
                    const id = db.addFact(fact);
                    activeFacts.set(key, { id, object: fact.object });
                }
            }
            return db;
        }
        catch (error) {
            db.close();
            throw error;
        }
    });
    try {
        // No-op: keep the db open only for the duration of the rebuild.
    }
    finally {
        memoryDb.close();
    }
}
export async function rebuildNarrativeMemoryIndex(bookDir) {
    const memorySeed = await loadNarrativeMemorySeed(bookDir);
    const memoryDb = await withMemoryIndexRetry(() => {
        const db = new MemoryDB(bookDir);
        try {
            db.replaceSummaries(memorySeed.summaries);
            db.replaceHooks(memorySeed.hooks);
            return db;
        }
        catch (error) {
            db.close();
            throw error;
        }
    });
    try {
        // No-op: keep the db open only for the duration of the rebuild.
    }
    finally {
        memoryDb.close();
    }
}
/**
 * Sync current state fact history with fallback handling.
 * @param {string} bookDir
 * @param {number} uptoChapter
 * @param {object} opts - { logWarn, resolveBookLanguage, logDebugInfo, memoryIndexFallbackWarned }
 */
export async function syncCurrentStateFactHistory(bookDir, uptoChapter, opts) {
    try {
        await rebuildCurrentStateFactHistory(bookDir, uptoChapter);
    }
    catch (error) {
        if (isMemoryIndexUnavailableError(error)) {
            if (canOpenMemoryIndex(bookDir)) {
                try {
                    await rebuildCurrentStateFactHistory(bookDir, uptoChapter);
                    return;
                }
                catch (retryError) {
                    error = retryError;
                }
            }
            else {
                if (!opts.memoryIndexFallbackWarned) {
                    opts.memoryIndexFallbackWarned = true;
                    opts.logWarn({
                        zh: "当前 Node 运行时不支持 SQLite 记忆索引，继续使用 Markdown 回退方案。",
                        en: "SQLite memory index unavailable on this Node runtime; continuing with markdown fallback.",
                    });
                    await logMemoryIndexDebugInfo(opts.logWarn, error);
                }
                return;
            }
        }
        opts.logWarn({
            zh: `状态事实同步已跳过：${String(error)}`,
            en: `State fact sync skipped: ${String(error)}`,
        });
    }
}
/**
 * Sync narrative memory index with fallback handling.
 * @param {string} bookDir
 * @param {object} opts - { logWarn, logDebugInfo, memoryIndexFallbackWarned }
 */
export async function syncNarrativeMemoryIndex(bookDir, opts) {
    try {
        await rebuildNarrativeMemoryIndex(bookDir);
    }
    catch (error) {
        if (isMemoryIndexUnavailableError(error)) {
            if (canOpenMemoryIndex(bookDir)) {
                try {
                    await rebuildNarrativeMemoryIndex(bookDir);
                    return;
                }
                catch (retryError) {
                    error = retryError;
                }
            }
            else {
                if (!opts.memoryIndexFallbackWarned) {
                    opts.memoryIndexFallbackWarned = true;
                    opts.logWarn({
                        zh: "当前 Node 运行时不支持 SQLite 记忆索引，继续使用 Markdown 回退方案。",
                        en: "SQLite memory index unavailable on this Node runtime; continuing with markdown fallback.",
                    });
                    await logMemoryIndexDebugInfo(opts.logWarn, error);
                }
                return;
            }
        }
        opts.logWarn({
            zh: `叙事记忆同步已跳过：${String(error)}`,
            en: `Narrative memory sync skipped: ${String(error)}`,
        });
    }
}
async function logMemoryIndexDebugInfo(logWarn, error) {
    if (process.env.INKOS_DEBUG_SQLITE_MEMORY !== "1") {
        return;
    }
    const code = typeof error === "object" && error !== null && "code" in error
        ? String(error.code ?? "")
        : "";
    const message = error instanceof Error
        ? error.message
        : String(error);
    logWarn({
        zh: `SQLite 记忆索引调试：node=${process.version}; execArgv=${JSON.stringify(process.execArgv)}; code=${code || "(none)"}; message=${message}`,
        en: `SQLite memory debug: node=${process.version}; execArgv=${JSON.stringify(process.execArgv)}; code=${code || "(none)"}; message=${message}`,
    });
}
