import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { StoredHook, StoredSummary } from "../state/memory-db.js";
import {
  parseChapterSummariesMarkdown,
  retrieveMemorySelection,
  type MemorySelection,
} from "./memory-retrieval.js";
import {
  readStoryFrame,
  readVolumeMap,
  readCurrentStateWithFallback,
} from "./outline-paths.js";
import { readDynamicStoryFileAsOf } from "../state/runtime-state-store.js";

export interface PlanningSeedMaterials {
  readonly storyDir: string;
  readonly authorIntent: string;
  readonly currentFocus: string;
  readonly storyBible: string;
  readonly volumeOutline: string;
  readonly bookRulesRaw: string;
  readonly currentState: string;
  readonly chapterSummariesRaw: string;
  readonly brief: string;
  readonly pacingTelemetryRaw?: string;
  readonly pacingDirective?: string;
  readonly diagnosisInjection?: string;
  readonly coachInjection?: string;
  readonly outlineNode?: string;
  readonly recentSummaries: ReadonlyArray<StoredSummary>;
  readonly previousEndingHook?: string;
  readonly previousEndingExcerpt?: string;
}

export interface PlanningMaterials extends PlanningSeedMaterials {
  readonly activeHooks: ReadonlyArray<StoredHook>;
  readonly memorySelection: MemorySelection;
  readonly plannerInputs: ReadonlyArray<string>;
}

async function readFileOrDefault(path: string): Promise<string> {
  try {
    return await readFile(path, "utf-8");
  } catch {
    return "(文件尚未创建)";
  }
}

export async function readFileSafe(path: string, defaultVal = "(文件不存在)"): Promise<string> {
  try {
    return await readFile(path, "utf-8");
  } catch {
    return defaultVal;
  }
}

async function readBriefFile(path: string): Promise<string> {
  try {
    return await readFile(path, "utf-8");
  } catch {
    return "";
  }
}

async function readPreviousEndingExcerpt(
  bookDir: string,
  chapterNumber: number,
): Promise<string | undefined> {
  const previousChapter = chapterNumber - 1;
  if (previousChapter < 1) {
    return undefined;
  }

  const chaptersDir = join(bookDir, "chapters");
  const padded = String(previousChapter).padStart(4, "0");
  try {
    const files = await readdir(chaptersDir);
    const match = files.find((file) => file.startsWith(padded) && file.endsWith(".md"));
    if (!match) {
      return undefined;
    }
    const markdown = await readFile(join(chaptersDir, match), "utf-8");
    const body = markdown
      .split("\n")
      .slice(1)
      .join("\n")
      .trim();
    if (!body) {
      return undefined;
    }
    return body.slice(-320).trim();
  } catch {
    return undefined;
  }
}

export async function loadPlanningSeedMaterials(params: {
  readonly bookDir: string;
  readonly chapterNumber: number;
  readonly asOfChapter?: number;
}): Promise<PlanningSeedMaterials> {
  const storyDir = join(params.bookDir, "story");
  const asOfChapter = params.asOfChapter;
  const sourcePaths = {
    authorIntent: join(storyDir, "author_intent.md"),
    currentFocus: join(storyDir, "current_focus.md"),
    chapterSummaries: join(storyDir, "chapter_summaries.md"),
    bookRules: join(storyDir, "book_rules.md"),
    currentState: join(storyDir, "current_state.md"),
    brief: join(storyDir, "brief.md"),
    pacingTelemetry: join(storyDir, "pacing_telemetry.md"),
    revisionCoach: join(storyDir, "revision_coach.md"),
  } as const;

  const placeholder = "(文件尚未创建)";

  const [
    authorIntent,
    currentFocus,
    storyBible,
    volumeOutline,
    chapterSummariesRaw,
    bookRulesRaw,
    currentState,
    previousEndingExcerpt,
    brief,
    pacingTelemetryRaw,
    revisionCoachRaw,
  ] = await Promise.all([
    readFileOrDefault(sourcePaths.authorIntent),
    readFileOrDefault(sourcePaths.currentFocus),
    readStoryFrame(params.bookDir, placeholder),
    readVolumeMap(params.bookDir, placeholder),
    typeof asOfChapter === "number"
      ? readDynamicStoryFileAsOf(params.bookDir, asOfChapter, "chapter_summaries.md").then((v) => v || placeholder)
      : readFileOrDefault(sourcePaths.chapterSummaries),
    readFileOrDefault(sourcePaths.bookRules),
    typeof asOfChapter === "number"
      ? readDynamicStoryFileAsOf(params.bookDir, asOfChapter, "current_state.md").then((v) => v || placeholder)
      : readCurrentStateWithFallback(params.bookDir, placeholder),
    readPreviousEndingExcerpt(params.bookDir, params.chapterNumber),
    readBriefFile(sourcePaths.brief),
    readFileOrDefault(sourcePaths.pacingTelemetry),
    readFileOrDefault(sourcePaths.revisionCoach),
  ]);

  const chapterSummaries = parseChapterSummariesMarkdown(chapterSummariesRaw)
    .filter((summary) => summary.chapter < params.chapterNumber)
    .sort((left, right) => right.chapter - left.chapter);

  const pacingDirective = analyzePacingTrend(pacingTelemetryRaw, params.chapterNumber);
  const diagnosisInjection = buildDiagnosisInjection(pacingTelemetryRaw, params.chapterNumber);
  const coachInjection = buildCoachInjection(revisionCoachRaw);

  return {
    storyDir,
    authorIntent,
    currentFocus,
    storyBible,
    volumeOutline,
    bookRulesRaw,
    currentState,
    chapterSummariesRaw,
    brief,
    pacingTelemetryRaw,
    pacingDirective,
    diagnosisInjection,
    coachInjection,
    recentSummaries: chapterSummaries.slice(0, 4).sort((left, right) => left.chapter - right.chapter),
    previousEndingHook: chapterSummaries[0]?.hookActivity || undefined,
    previousEndingExcerpt,
  };
}

export async function gatherPlanningMaterials(params: {
  readonly bookDir: string;
  readonly chapterNumber: number;
  readonly goal: string;
  readonly outlineNode?: string;
  readonly mustKeep?: ReadonlyArray<string>;
  readonly seed?: PlanningSeedMaterials;
  readonly asOfChapter?: number;
  readonly asOfSnapshot?: import("../state/runtime-state-store.js").RuntimeStateSnapshot;
}): Promise<PlanningMaterials> {
  const seed = params.seed ?? await loadPlanningSeedMaterials({
    bookDir: params.bookDir,
    chapterNumber: params.chapterNumber,
    asOfChapter: params.asOfChapter,
  });

  const memorySelection = await retrieveMemorySelection({
    bookDir: params.bookDir,
    chapterNumber: params.chapterNumber,
    asOfChapter: params.asOfChapter,
    asOfSnapshot: params.asOfSnapshot,
    goal: params.goal,
    outlineNode: params.outlineNode,
    mustKeep: params.mustKeep,
  });

  return {
    ...seed,
    outlineNode: params.outlineNode,
    activeHooks: memorySelection.activeHooks,
    memorySelection,
    plannerInputs: [
      join(seed.storyDir, "author_intent.md"),
      join(seed.storyDir, "current_focus.md"),
      join(seed.storyDir, "outline", "story_frame.md"),
      join(seed.storyDir, "outline", "volume_map.md"),
      join(seed.storyDir, "outline", "phase_outline.md"),
      params.asOfChapter === undefined
        ? join(seed.storyDir, "chapter_summaries.md")
        : `story/snapshots/${params.asOfChapter}/chapter_summaries.md`,
      join(seed.storyDir, "book_rules.md"),
      params.asOfChapter === undefined
        ? join(seed.storyDir, "current_state.md")
        : `story/snapshots/${params.asOfChapter}/current_state.md`,
      params.asOfChapter === undefined
        ? join(seed.storyDir, "pending_hooks.md")
        : `story/snapshots/${params.asOfChapter}/pending_hooks.md`,
      ...(memorySelection.dbPath ? [memorySelection.dbPath] : []),
    ],
  };
}

function analyzePacingTrend(pacingRaw: string, currentChapter: number): string {
  if (!pacingRaw || pacingRaw === "(文件尚未创建)") {
    return "";
  }
  const entries: Array<{ chapter: number; verdict: string; plotAdv: number }> = [];
  const blocks = pacingRaw.split(/^## Chapter \d+/m).slice(1);
  const headings = pacingRaw.match(/^## Chapter \d+/gm) ?? [];
  for (let i = 0; i < blocks.length; i++) {
    const chapterMatch = headings[i]?.match(/## Chapter (\d+)/);
    if (!chapterMatch) continue;
    const ch = parseInt(chapterMatch[1]!, 10);
    if (ch >= currentChapter) continue;
    const block = blocks[i]!;
    const verdict = block.match(/verdict:\s*(padding|normal|rushing)/i)?.[1]?.toLowerCase() ?? "";
    const plotAdv = parseInt(block.match(/plot_advancement:\s*(\d+)/)?.[1] ?? "50", 10);
    entries.push({ chapter: ch, verdict, plotAdv });
  }
  if (entries.length < 2) return "";
  const last2 = entries.slice(-2);
  const bothPadding = last2.every((e) => e.verdict === "padding" || e.plotAdv < 25);
  const bothRushing = last2.every((e) => e.verdict === "rushing" || e.plotAdv > 85);
  if (bothPadding) {
    return "## 节奏警告：连续注水\n连续2章剧情推进率过低（<25%）。本章必须引入新危机、新信息或实质性剧情推进，禁止继续铺垫日常。";
  }
  if (bothRushing) {
    return "## 节奏警告：剧情暴走\n连续2章剧情推进率过高（>85%），可能提前消耗卷纲高潮。本章必须放慢节奏，铺设伏笔、深化角色、控制冲突烈度。";
  }
  return "";
}

function buildDiagnosisInjection(pacingTelemetryRaw: string, currentChapter: number): string {
  // ponytail: diagnoser integration deferred — parsePacingTelemetry/diagnosePacing
  // require the diagnoser module which is an IsNew .js file. Return "" until
  // the diagnoser is converted to TS.
  void pacingTelemetryRaw;
  void currentChapter;
  return "";
}

function buildCoachInjection(coachRaw: string): string {
  if (!coachRaw || coachRaw === "(文件尚未创建)") return "";
  const readabilityMatch = coachRaw.match(/## Readability:\s*(\d+)\/100/);
  const completenessMatch = coachRaw.match(/## Completeness:\s*(\d+)\/100/);
  const readabilityScore = readabilityMatch ? parseInt(readabilityMatch[1]!, 10) : 100;
  const completenessScore = completenessMatch ? parseInt(completenessMatch[1]!, 10) : 100;
  if (readabilityScore >= 80 && completenessScore >= 80) return "";
  const issueLines = coachRaw.split("\n")
    .filter((l) => l.startsWith("- "))
    .map((l) => l.slice(2));
  if (issueLines.length === 0) return "";
  const parts = [`## 写作自检（Coach）：可读性 ${readabilityScore}/100，完整性 ${completenessScore}/100`];
  for (const issue of issueLines.slice(0, 4)) {
    parts.push(`- ${issue}`);
  }
  return parts.join("\n");
}
