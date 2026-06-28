import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  ChapterSummariesStateSchema,
  CurrentStateStateSchema,
  HooksStateSchema,
  StateManifestSchema,
  type RuntimeStateDelta,
} from "../models/runtime-state.js";
import type { Fact, StoredHook, StoredSummary } from "./memory-db.js";
import { bootstrapStructuredStateFromMarkdown, parseCurrentStateFacts } from "./state-bootstrap.js";
import { renderChapterSummariesProjection, renderCurrentStateProjection, renderHooksProjection } from "./state-projections.js";
import { applyRuntimeStateDelta, type RuntimeStateSnapshot } from "./state-reducer.js";
import { validateRuntimeState } from "./state-validator.js";
import { arbitrateRuntimeStateDeltaHooks } from "../utils/hook-arbiter.js";

export interface RuntimeStateArtifacts {
  readonly snapshot: RuntimeStateSnapshot;
  readonly resolvedDelta: RuntimeStateDelta;
  readonly currentStateMarkdown: string;
  readonly hooksMarkdown: string;
  readonly chapterSummariesMarkdown: string;
}

export interface NarrativeMemorySeed {
  readonly summaries: ReadonlyArray<StoredSummary>;
  readonly hooks: ReadonlyArray<StoredHook>;
}

export async function loadRuntimeStateSnapshot(bookDir: string): Promise<RuntimeStateSnapshot> {
  await bootstrapStructuredStateFromMarkdown({ bookDir });
  const stateDir = join(bookDir, "story", "state");

  const [manifest, currentState, hooks, chapterSummaries] = await Promise.all([
    readJson(join(stateDir, "manifest.json"), StateManifestSchema),
    readJson(join(stateDir, "current_state.json"), CurrentStateStateSchema),
    readJson(join(stateDir, "hooks.json"), HooksStateSchema),
    readJson(join(stateDir, "chapter_summaries.json"), ChapterSummariesStateSchema),
  ]);

  const snapshot = {
    manifest,
    currentState,
    hooks,
    chapterSummaries,
  };

  const issues = validateRuntimeState(snapshot);
  if (issues.length > 0) {
    const summary = issues
      .map((issue) => `${issue.code}${issue.path ? `@${issue.path}` : ""}`)
      .join(", ");
    throw new Error(`Invalid persisted runtime state: ${summary}`);
  }

  return snapshot;
}

export async function buildRuntimeStateArtifacts(params: {
  readonly bookDir: string;
  readonly delta: RuntimeStateDelta;
  readonly language: "zh" | "en";
  readonly allowReapply?: boolean;
}): Promise<RuntimeStateArtifacts> {
  const snapshot = await loadRuntimeStateSnapshot(params.bookDir);
  const { resolvedDelta } = arbitrateRuntimeStateDeltaHooks({
    hooks: snapshot.hooks.hooks,
    delta: params.delta,
  });
  const next = applyRuntimeStateDelta({
    snapshot,
    delta: resolvedDelta,
    allowReapply: params.allowReapply,
  });

  return {
    snapshot: next,
    resolvedDelta,
    currentStateMarkdown: renderCurrentStateProjection(next.currentState, params.language),
    // Pass the chapter number so the projection can tag stale / blocked hooks.
    hooksMarkdown: renderHooksProjection(next.hooks, params.language, {
      currentChapter: resolvedDelta.chapter,
    }),
    chapterSummariesMarkdown: renderChapterSummariesProjection(next.chapterSummaries, params.language),
  };
}

export async function saveRuntimeStateSnapshot(
  bookDir: string,
  snapshot: RuntimeStateSnapshot,
): Promise<void> {
  const stateDir = join(bookDir, "story", "state");
  await mkdir(stateDir, { recursive: true });

  await Promise.all([
    writeFile(join(stateDir, "manifest.json"), JSON.stringify(snapshot.manifest, null, 2), "utf-8"),
    writeFile(join(stateDir, "current_state.json"), JSON.stringify(snapshot.currentState, null, 2), "utf-8"),
    writeFile(join(stateDir, "hooks.json"), JSON.stringify(snapshot.hooks, null, 2), "utf-8"),
    writeFile(join(stateDir, "chapter_summaries.json"), JSON.stringify(snapshot.chapterSummaries, null, 2), "utf-8"),
  ]);
}

export async function loadNarrativeMemorySeed(bookDir: string): Promise<NarrativeMemorySeed> {
  const snapshot = await loadRuntimeStateSnapshot(bookDir);

  return {
    summaries: snapshot.chapterSummaries.rows.map((row) => ({
      chapter: row.chapter,
      title: row.title,
      characters: row.characters,
      events: row.events,
      stateChanges: row.stateChanges,
      hookActivity: row.hookActivity,
      mood: row.mood,
      chapterType: row.chapterType,
    })),
      hooks: snapshot.hooks.hooks.map((hook) => ({
        hookId: hook.hookId,
        startChapter: hook.startChapter,
        type: hook.type,
        status: hook.status,
        lastAdvancedChapter: hook.lastAdvancedChapter,
        expectedPayoff: hook.expectedPayoff,
        payoffTiming: hook.payoffTiming,
        notes: hook.notes,
      })),
  };
}

const DYNAMIC_STORY_FILES = new Set([
  "current_state.md",
  "pending_hooks.md",
  "chapter_summaries.md",
  "particle_ledger.md",
  "subplot_board.md",
  "emotional_arcs.md",
  "character_matrix.md",
  "character_assets.md",
  "scene_ledger.md",
  "relationship_graph.md",
  "era_mood.md",
  "alliance_state.md",
  "military_forces.md",
  "war_theater.md",
  "battle_log.md",
  "territory_control.md",
  "epoch_timeline.md",
  "naval_forces.md",
  "dynasty_tree.md",
  "treasury_state.md",
]);

export async function readDynamicStoryFileAsOf(bookDir: string, asOfChapter: number, fileName: string): Promise<string> {
  if (!DYNAMIC_STORY_FILES.has(fileName)) {
    throw new Error(`not a dynamic story file: ${fileName}`);
  }
  return readFile(join(bookDir, "story", "snapshots", String(Math.max(0, asOfChapter)), fileName), "utf-8").catch(() => "");
}

export async function loadRuntimeStateSnapshotAsOf(
  bookDir: string,
  asOfChapter: number,
  language: "zh" | "en" = "zh",
): Promise<RuntimeStateSnapshot> {
  const snapshotDir = join(bookDir, "story", "snapshots", String(Math.max(0, asOfChapter)));
  const stateDir = join(snapshotDir, "state");

  const [manifest, currentState, hooks, chapterSummaries] = await Promise.all([
    readJsonOrNull(join(stateDir, "manifest.json"), StateManifestSchema),
    readJsonOrNull(join(stateDir, "current_state.json"), CurrentStateStateSchema),
    readJsonOrNull(join(stateDir, "hooks.json"), HooksStateSchema),
    readJsonOrNull(join(stateDir, "chapter_summaries.json"), ChapterSummariesStateSchema),
  ]);

  const fallbackCurrentState = currentState ?? {
    facts: parseCurrentStateFacts(
      await readFile(join(snapshotDir, "current_state.md"), "utf-8").catch(() => ""),
      asOfChapter,
    ),
  };
  const fallbackHooks = hooks ?? {
    hooks: [],
  };
  const fallbackSummaries = chapterSummaries ?? { rows: [] };

  return {
    manifest: manifest ?? {
      schemaVersion: 2,
      language,
      lastAppliedChapter: Math.max(0, asOfChapter),
      projectionVersion: 1,
      migrationWarnings: [],
    },
    currentState: fallbackCurrentState,
    hooks: fallbackHooks,
    chapterSummaries: fallbackSummaries,
  };
}

export async function loadSnapshotCurrentStateFacts(
  bookDir: string,
  chapterNumber: number,
): Promise<ReadonlyArray<Fact>> {
  const snapshotDir = join(bookDir, "story", "snapshots", String(chapterNumber));
  const structuredState = await readJsonOrNull(
    join(snapshotDir, "state", "current_state.json"),
    CurrentStateStateSchema,
  );
  if (structuredState) {
    return structuredState.facts;
  }

  const markdown = await readFile(join(snapshotDir, "current_state.md"), "utf-8").catch(() => "");
  return parseCurrentStateFacts(markdown, chapterNumber);
}

async function readJson<T>(
  path: string,
  schema: { parse(value: unknown): T },
): Promise<T> {
  const raw = await readFile(path, "utf-8");
  return schema.parse(JSON.parse(raw));
}

async function readJsonOrNull<T>(
  path: string,
  schema: { parse(value: unknown): T },
): Promise<T | null> {
  try {
    return await readJson(path, schema);
  } catch {
    return null;
  }
}
