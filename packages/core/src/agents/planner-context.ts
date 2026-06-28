import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import YAML from "js-yaml";
import { parseMarkdownTableRows } from "../utils/story-markdown.js";
import { readCharacterContext } from "../utils/outline-paths.js";
import { readBookRules as readStructuredBookRules } from "./rules-reader.js";
import type { StoredHook } from "../state/memory-db.js";

// ---------------------------------------------------------------------------
// Interfaces for Phase Outline and Chapter Skeleton
// ---------------------------------------------------------------------------

export interface Phase {
  id: number;
  title: string;
  startChapter?: number;
  endChapter?: number;
  status: "active" | "pending" | "done";
  tension?: string;
  mustPayoff: string[];
  mustSetup: string[];
  goals: Array<{ text: string; achieved: boolean }>;
  resourceConstraints: string[];
  warLedgerSnapshot: string[];
}

export interface SkeletonEntry {
  goal: string;
  event: string;
  hooks: string;
  emotion: string;
}

async function readOrEmpty(path: string): Promise<string> {
  try {
    return await readFile(path, "utf-8");
  } catch {
    return "";
  }
}

/**
 * Phase 5: prefer roles/ directory; fall back to legacy character_matrix.md.
 * storyDir is <bookDir>/story, so the caller indirectly points us at bookDir
 * via dirname().
 */
export async function readCharacterMatrix(storyDir: string): Promise<string> {
  const bookDir = dirname(storyDir);
  return readCharacterContext(bookDir, "");
}

export async function readSubplotBoard(storyDir: string): Promise<string> {
  return readOrEmpty(join(storyDir, "subplot_board.md"));
}

export async function readEmotionalArcs(storyDir: string): Promise<string> {
  return readOrEmpty(join(storyDir, "emotional_arcs.md"));
}

export async function readPendingHooks(storyDir: string): Promise<string> {
  return readOrEmpty(join(storyDir, "pending_hooks.md"));
}

export async function readBrief(storyDir: string): Promise<string> {
  return readOrEmpty(join(storyDir, "brief.md"));
}

export async function readCastRegistry(storyDir: string): Promise<string> {
  return readOrEmpty(join(storyDir, "cast_registry.md"));
}

export async function readItemCatalog(storyDir: string): Promise<string> {
  return readOrEmpty(join(storyDir, "item_catalog.md"));
}

export async function readFactionMap(storyDir: string): Promise<string> {
  return readOrEmpty(join(storyDir, "faction_map.md"));
}

/**
 * Read the registered glossary projection (domain jargon / proper-noun decode
 * audit). The glossary projection is persisted as state/glossary.json (no
 * sibling .md), so we parse the JSON and render a compact term list. Absent /
 * malformed / empty degrades to "" — never throws.
 */
export async function readGlossary(storyDir: string, language: "zh" | "en" = "zh"): Promise<string> {
  const raw = await readOrEmpty(join(storyDir, "state", "glossary.json"));
  if (!raw.trim()) {
    return "";
  }
  let terms: Array<{ term: string; firstSeenChapter?: number; lastDecodedAtChapter?: number }> = [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && "terms" in parsed) {
      const candidate = (parsed as { terms: unknown }).terms;
      if (Array.isArray(candidate)) {
        terms = candidate.filter(
          (t): t is { term: string; firstSeenChapter?: number; lastDecodedAtChapter?: number } =>
            t != null && typeof t === "object" && "term" in t && typeof (t as { term: unknown }).term === "string" && ((t as { term: string }).term.trim().length > 0),
        );
      }
    }
  } catch {
    return "";
  }
  if (terms.length === 0) {
    return "";
  }
  return terms
    .map((t) =>
      language === "en"
        ? `- ${t.term} (first seen ch.${t.firstSeenChapter ?? "?"}, last decoded ch.${t.lastDecodedAtChapter ?? "none"})`
        : `- ${t.term}（首次出现第${t.firstSeenChapter ?? "?"}章，最近解码第${t.lastDecodedAtChapter ?? "无"}章）`,
    )
    .join("\n");
}

/**
 * Render the structured book rules (protagonist / prohibitions / genreLock /
 * behavioral constraints) as a compact markdown block for the planner prompt.
 *
 * Phase 5 cleanup #3: reads the YAML frontmatter via readStructuredBookRules
 * (which prefers story_frame.md and falls back to legacy book_rules.md).
 * Returns "" when no structured rules are defined — the planner template
 * provides its own placeholder for that case.
 */
export async function readBookRules(storyDir: string): Promise<string> {
  const bookDir = dirname(storyDir);
  const parsed = await readStructuredBookRules(bookDir);
  if (!parsed) return "";

  const { rules, body } = parsed;
  const lines: string[] = [];

  if (rules.protagonist) {
    const proto = rules.protagonist;
    const personality = proto.personalityLock.join("、");
    const constraints = proto.behavioralConstraints.join("、");
    lines.push(`- 主角 ${proto.name}${personality ? ` / 人设锁：${personality}` : ""}${constraints ? ` / 行为约束：${constraints}` : ""}`);
  }

  if (rules.prohibitions.length > 0) {
    lines.push("- 本书禁忌：");
    for (const p of rules.prohibitions) {
      lines.push(`  - ${p}`);
    }
  }

  if (rules.genreLock) {
    const forbidden = rules.genreLock.forbidden.join("、");
    lines.push(`- 题材锁：${rules.genreLock.primary}${forbidden ? ` / 禁止混入：${forbidden}` : ""}`);
  }

  if (rules.fanficMode) {
    lines.push(`- 同人模式：${rules.fanficMode}`);
  }

  const trimmedBody = body.trim();
  // The body holds narrative guidance prose (e.g. 叙事视角). Include it verbatim
  // so the planner sees the same text as before the cleanup.
  if (trimmedBody) {
    lines.push("", trimmedBody);
  }

  return lines.join("\n").trim();
}

/**
 * Grab the last N row(s) from chapter_summaries.md formatted as markdown
 * table. Returns original table slice (with header) so the planner gets
 * column meaning implicitly.
 */
export function formatRecentSummaries(
  chapterSummariesRaw: string,
  chapterNumber: number,
  limit: number,
): string {
  const rows = parseMarkdownTableRows(chapterSummariesRaw)
    .filter((row) => /^\d+$/.test(row[0] ?? ""))
    .filter((row) => parseInt(row[0]!, 10) < chapterNumber)
    .sort((a, b) => parseInt(a[0]!, 10) - parseInt(b[0]!, 10));

  const recent = rows.slice(-limit);
  if (recent.length === 0) {
    return "（暂无前章摘要）";
  }

  const header = "| 章节 | 标题 | 出场人物 | 关键事件 | 状态变化 | 伏笔动态 | 情绪基调 | 章节类型 |";
  const divider = "| --- | --- | --- | --- | --- | --- | --- | --- |";
  const body = recent.map((row) => `| ${row.join(" | ")} |`).join("\n");
  return [header, divider, body].join("\n");
}

/**
 * Option A: temporarily compose current_arc prose from subplot_board.md
 * active rows + emotional_arcs.md recent rows. Phase 8 will replace this
 * source with a dedicated tier2_current_arc.md file.
 */
export function composeCurrentArcProse(
  subplotBoardRaw: string,
  emotionalArcsRaw: string,
  chapterNumber: number,
): string {
  const activeSubplots = extractActiveSubplotLines(subplotBoardRaw);
  const recentArcs = extractRecentEmotionalArcLines(emotionalArcsRaw, chapterNumber, 3);

  const parts: string[] = [];
  if (activeSubplots.length > 0) {
    parts.push("活跃支线：\n" + activeSubplots.map((line) => `- ${line}`).join("\n"));
  }
  if (recentArcs.length > 0) {
    parts.push("近期情感线：\n" + recentArcs.map((line) => `- ${line}`).join("\n"));
  }
  if (parts.length === 0) {
    return "（暂无 arc 数据——可能是新书起始阶段）";
  }
  return parts.join("\n\n");
}

function extractActiveSubplotLines(raw: string): string[] {
  const rows = parseMarkdownTableRows(raw);
  if (rows.length === 0) {
    return raw
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("-"))
      .map((line) => line.replace(/^-\s*/, ""))
      .filter(Boolean)
      .slice(0, 6);
  }
  return rows
    .filter((row) => !/^(id|subplot_id|subplot|status|状态)$/i.test(row[0] ?? ""))
    .filter((row) => {
      const status = (row.find((cell) => /进行|推进|高压|激活|activ|progress|partial/i.test(cell)) ?? "");
      const dormant = row.find((cell) => /暂稳待续|暂挂|dormant|paused/i.test(cell));
      return Boolean(status) && !dormant;
    })
    .map((row) => row.filter(Boolean).join(" | "))
    .slice(0, 6);
}

function extractRecentEmotionalArcLines(raw: string, chapterNumber: number, limit: number): string[] {
  const rows = parseMarkdownTableRows(raw);
  if (rows.length === 0) {
    return raw
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("-"))
      .slice(-limit)
      .map((line) => line.replace(/^-\s*/, ""));
  }
  // emotional_arcs.md column layout: 角色 | 章节 | 情绪状态 | 触发事件 | 强度 | 弧线方向
  // Chapter number lives in column index 1 (row[1]), not column 0.
  return rows
    .filter((row) => /^\d+$/.test(row[1] ?? ""))
    .filter((row) => parseInt(row[1]!, 10) < chapterNumber)
    .slice(-limit)
    .map((row) => row.filter(Boolean).join(" | "));
}

const CHARACTER_MATRIX_HEADER_CELLS = /^(角色|character|name|核心标签|与主角关系|relation)$/i;

function isLikelyHeaderRow(row: ReadonlyArray<string>): boolean {
  return row.some((cell) => CHARACTER_MATRIX_HEADER_CELLS.test(cell.trim()));
}

/**
 * Extract the protagonist row from character_matrix.md. Protagonist is detected
 * by a cell in the 与主角关系 column matching "主角本人" / "主角" / "protagonist"
 * (case-insensitive). Falls back to the first non-header data row if no
 * explicit match is found — that row is almost always the protagonist by
 * convention.
 */
export async function extractProtagonistRow(characterMatrixRaw: string, storyDir?: string): Promise<string> {
  const roleBriefs = storyDir ? await readRoleVoiceBriefs(storyDir) : [];
  const rows = parseMarkdownTableRows(characterMatrixRaw);
  const protagonist = rows.find((row) =>
    row.some((cell) => /^(主角本人|主角|protagonist)$/i.test(cell.trim())),
  );
  const firstDataRow = rows.find((row) => !isLikelyHeaderRow(row));
  const protagonistName = extractNameFromMatrixRow(protagonist ?? firstDataRow);
  const roleBrief = roleBriefs.find((brief) => brief.name === protagonistName) ?? roleBriefs[0];
  if (roleBrief) {
    return roleBrief.brief;
  }
  if (protagonist) {
    return `| ${protagonist.join(" | ")} |`;
  }
  if (firstDataRow) {
    return `| ${firstDataRow.join(" | ")} |`;
  }
  return "（未找到主角行——请检查 character_matrix.md）";
}

const OPPONENT_PATTERNS = /敌对|对手|阻力|opponent|antagonist|foe/i;
const COLLABORATOR_PATTERNS = /协力|盟友|临时助力|ally|collaborator|mentor/i;

export async function extractOpponentRows(characterMatrixRaw: string, limit: number, storyDir?: string): Promise<string> {
  return extractRowsByRelation(characterMatrixRaw, OPPONENT_PATTERNS, limit, "（暂无明确对手登场）", storyDir);
}

export async function extractCollaboratorRows(characterMatrixRaw: string, limit: number, storyDir?: string): Promise<string> {
  return extractRowsByRelation(characterMatrixRaw, COLLABORATOR_PATTERNS, limit, "（暂无明确协作者登场）", storyDir);
}

async function extractRowsByRelation(
  characterMatrixRaw: string,
  pattern: RegExp,
  limit: number,
  emptyText: string,
  storyDir?: string,
): Promise<string> {
  const rows = parseMarkdownTableRows(characterMatrixRaw)
    .filter((row) => row.some((cell) => pattern.test(cell)))
    .filter((row) => !row.some((cell) => /^(主角|protagonist)$/i.test(cell.trim())))
    .slice(0, limit);
  if (rows.length === 0) {
    return emptyText;
  }
  const roleBriefs = storyDir ? await readRoleVoiceBriefs(storyDir) : [];
  const briefs = rows
    .map((row) => roleBriefs.find((brief) => brief.name === extractNameFromMatrixRow(row)))
    .filter((b): b is { name: string; brief: string } => b != null)
    .map((brief) => brief.brief);
  if (briefs.length > 0) {
    return briefs.join("\n\n");
  }
  return rows.map((row) => `| ${row.join(" | ")} |`).join("\n");
}

const RELEVANT_THREAD_STATUS_PATTERN = /activat|partial_payoff|推进|高压|open|progress/i;
const STALE_STATUS_PATTERN = /resolved|deferred|dormant|暂稳待续|暂挂|已回收/i;

export function extractRelevantThreads(pendingHooksRaw: string, subplotBoardRaw: string, chapterNumber?: number): string {
  const hookRows = parseMarkdownTableRows(pendingHooksRaw)
    .filter((row) => !/^(hook_id)$/i.test(row[0] ?? ""))
    .filter((row) => isHookRowVisibleForChapter(row, chapterNumber))
    .filter((row) => row.some((cell) => RELEVANT_THREAD_STATUS_PATTERN.test(cell)))
    .filter((row) => !row.some((cell) => STALE_STATUS_PATTERN.test(cell)))
    .map((row) => `- ${row[0]}: ${row.slice(1).filter(Boolean).join(" | ")}`);

  const subplotRows = parseMarkdownTableRows(subplotBoardRaw)
    .filter((row) => !/^(id|subplot_id|subplot)$/i.test(row[0] ?? ""))
    .filter((row) => row.some((cell) => RELEVANT_THREAD_STATUS_PATTERN.test(cell)))
    .filter((row) => !row.some((cell) => STALE_STATUS_PATTERN.test(cell)))
    .map((row) => `- ${row[0]}: ${row.slice(1).filter(Boolean).join(" | ")}`);

  const lines = [...hookRows, ...subplotRows];
  if (lines.length === 0) {
    return "（暂无活跃线索）";
  }
  return lines.join("\n");
}

/**
 * Filter out hook rows that are not yet visible for the given chapter.
 * Skips "new-" / "monitoring-" prefixed hooks and hooks whose startChapter
 * or lastAdvancedChapter is in the future.
 */
function isHookRowVisibleForChapter(row: string[], chapterNumber?: number): boolean {
  const hookId = row[0] ?? "";
  if (/^(new|monitoring)-/i.test(hookId.trim())) {
    return false;
  }
  if (typeof chapterNumber !== "number") {
    return true;
  }
  const startChapter = parseInt(row[1] ?? "", 10);
  const lastAdvancedChapter = parseInt(row[4] ?? "", 10);
  if (Number.isFinite(startChapter) && startChapter > chapterNumber) {
    return false;
  }
  if (Number.isFinite(lastAdvancedChapter) && lastAdvancedChapter > chapterNumber) {
    return false;
  }
  return true;
}

function extractNameFromMatrixRow(row: string[] | undefined): string | undefined {
  if (!row || row.length === 0) {
    return undefined;
  }
  return row[0]?.trim();
}

async function readRoleVoiceBriefs(storyDir: string): Promise<Array<{ name: string; brief: string }>> {
  const rolesDir = join(storyDir, "roles");
  const briefs: Array<{ name: string; brief: string }> = [];
  try {
    const tiers = await readdir(rolesDir, { withFileTypes: true });
    for (const tier of tiers) {
      if (!tier.isDirectory()) {
        continue;
      }
      const files = await readdir(join(rolesDir, tier.name), { withFileTypes: true });
      for (const file of files) {
        if (!file.isFile() || !file.name.endsWith(".md")) {
          continue;
        }
        const name = file.name.replace(/\.md$/i, "");
        const content = await readOrEmpty(join(rolesDir, tier.name, file.name));
        const brief = buildRoleVoiceBrief(name, content);
        if (brief) {
          briefs.push({ name, brief });
        }
      }
    }
  } catch {
    return [];
  }
  return briefs;
}

function buildRoleVoiceBrief(name: string, content: string): string {
  if (!content.trim()) {
    return "";
  }
  // Primary anchors: directly drive planner decisions
  const PRIMARY_ANCHORS = [
    "一句话活人锚点",
    "核心欲望",
    "核心恐惧",
    "行动原理",
    "核心标签",
    "说话风格",
    "台词样本",
    "禁用句式",
    "内心独白 vs 出口台词",
    "信息边界",
    "关系网络",
    "关系变调",
    "反差细节",
    "当前现状",
  ];
  // Secondary anchors: context for planner
  const SECONDARY_ANCHORS = [
    "性格设定",
    "目标与遗憾",
    "秘密",
    "能力设定",
    "基本信息",
  ];
  const parts = [...PRIMARY_ANCHORS, ...SECONDARY_ANCHORS]
    .map((anchor) => {
      const isSecondary = SECONDARY_ANCHORS.includes(anchor);
      const section = extractMarkdownSection(content, anchor, isSecondary ? 300 : 500);
      return section ? `${anchor}：${section}` : undefined;
    })
    .filter((s): s is string => s != null);
  if (parts.length === 0) {
    return `### ${name}\n${content.split("\n").map((line) => line.trim()).filter(Boolean).slice(0, 12).join("\n")}`;
  }
  return `### ${name}\n${parts.join("\n")}`.slice(0, 2400);
}

function extractMarkdownSection(content: string, anchor: string, maxLen: number = 500): string {
  const lines = content.split("\n");
  const start = lines.findIndex((line) => {
    const t = line.trim();
    return t === `## ${anchor}` || t === `### ${anchor}`;
  });
  if (start < 0) {
    return "";
  }
  const section: string[] = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i]!;
    if (/^#{2,3}\s/.test(line.trim())) {
      break;
    }
    section.push(line);
  }
  return section.join(" ").replace(/\s+/g, " ").trim().slice(0, maxLen);
}

/**
 * Phase 9-2: render stale hooks that the planner MUST dispose of in this
 * chapter's memo ("## 本章 hook 账"). These are already filtered by
 * computeRecyclableHooks; here we just format them for the prompt.
 *
 * Language switch mirrors the rest of the planner prompt: zh by default,
 * en for English books.
 */
export function formatRecyclableHooks(
  hooks: ReadonlyArray<StoredHook>,
  chapterNumber: number,
  language: "zh" | "en" = "zh",
): string {
  if (hooks.length === 0) {
    return language === "en"
      ? "(no stale hooks — the ledger is clean)"
      : "（暂无陈旧 hook——账本干净）";
  }

  const topSlice = hooks.slice(0, 6);
  const lines = topSlice.map((hook) => {
    const lastTouch = Math.max(hook.startChapter, hook.lastAdvancedChapter);
    const silence = lastTouch <= 0 ? chapterNumber : Math.max(0, chapterNumber - lastTouch);
    const payoff = hook.expectedPayoff?.trim() || hook.notes?.trim() || "";
    const core = hook.coreHook === true ? (language === "en" ? " [core]" : " [核心]") : "";
    return language === "en"
      ? `- ${hook.hookId} "${payoff}" — status=${hook.status}, silent ${silence} ch${core}`
      : `- ${hook.hookId} "${payoff}" — 状态=${hook.status}，已沉默 ${silence} 章${core}`;
  });

  const header = language === "en"
    ? "The planner MUST place each of these under advance / resolve / defer in the hook ledger (deferring requires an explicit reason):"
    : "规划时必须把以下每个 hook 放入 advance / resolve / defer（若 defer，必须写出理由）：";
  return [header, ...lines].join("\n");
}

const WAR_LEDGER_FILES = [
  "military_forces.md",
  "war_theater.md",
  "battle_log.md",
  "territory_control.md",
  "relationship_graph.md",
  "era_mood.md",
  "epoch_timeline.md",
  "naval_forces.md",
  "dynasty_tree.md",
  "treasury_state.md",
  "geography.md",
];

/**
 * Read all 11 war ledger markdown files from storyDir. Returns a
 * filename→content map. Missing files degrade to "".
 */
export async function readWarLedgers(storyDir: string): Promise<Record<string, string>> {
  const entries = await Promise.all(WAR_LEDGER_FILES.map(async (file) => {
    const content = await readOrEmpty(join(storyDir, file));
    return [file, content] as const;
  }));
  return Object.fromEntries(entries);
}

/**
 * Compose a compact, faction-level war resource summary from the 11 ledger
 * maps. The planner sees this as "## 战争资源总览" so it can plan chapters
 * within actual resource budgets (gold, grain, troops, territory, active wars).
 *
 * Returns "" when all ledgers are empty (non-war books degrade gracefully).
 */
export function composeWarResourceSummary(warLedgers: Record<string, string>, language: "zh" | "en" = "zh"): string {
  const isEn = language === "en";
  const lines: string[] = [];

  // --- Treasury ---
  const treasuryRows = parseMarkdownTableRows(warLedgers["treasury_state.md"] ?? "")
    .filter((r) => r.length >= 4 && r[0] && !/^faction|势力/i.test(r[0]));
  if (treasuryRows.length > 0) {
    lines.push(isEn ? "### Treasury" : "### 国库");
    for (const r of treasuryRows) {
      const gold = parseInt(r[1] ?? "0", 10) || 0;
      const grain = parseInt(r[2] ?? "0", 10) || 0;
      const merc = parseInt(r[3] ?? "0", 10) || 0;
      const income = parseInt(r[4] ?? "0", 10) || 0;
      if (isEn) {
        lines.push(`- ${r[0]}: gold:${gold} | grain:${grain} | merc_budget:${merc} | income/ch:${income}`);
      } else {
        lines.push(`- ${r[0]}: 金:${gold} | 粮:${grain} | 雇佣兵预算:${merc} | 每章收入:${income}`);
      }
    }
  }

  // --- Military forces (aggregate by faction) ---
  const forceRows = parseMarkdownTableRows(warLedgers["military_forces.md"] ?? "")
    .filter((r) => r.length >= 5 && r[1] && !/^faction|势力/i.test(r[1]));
  if (forceRows.length > 0) {
    const factionMap = new Map<string, { total: number; forces: number }>();
    for (const r of forceRows) {
      const faction = r[1]?.trim() ?? "";
      if (!faction) continue;
      const count = parseInt(r[3] ?? "0", 10) || 0;
      const prev = factionMap.get(faction) ?? { total: 0, forces: 0 };
      factionMap.set(faction, { total: prev.total + count, forces: prev.forces + 1 });
    }
    lines.push(isEn ? "### Military Forces" : "### 军事力量");
    for (const [faction, { total, forces }] of factionMap) {
      lines.push(isEn ? `- ${faction}: ${total} troops (${forces} units)` : `- ${faction}: 兵力 ${total}（${forces} 支）`);
    }
  }

  // --- Naval forces (aggregate by faction) ---
  const navalRows = parseMarkdownTableRows(warLedgers["naval_forces.md"] ?? "")
    .filter((r) => r.length >= 4 && r[1] && !/^faction|势力/i.test(r[1]));
  if (navalRows.length > 0) {
    const navalMap = new Map<string, number>();
    for (const r of navalRows) {
      const faction = r[1]?.trim() ?? "";
      if (!faction) continue;
      const ships = parseInt(r[3] ?? "0", 10) || 0;
      navalMap.set(faction, (navalMap.get(faction) ?? 0) + ships);
    }
    lines.push(isEn ? "### Naval Forces" : "### 海军力量");
    for (const [faction, ships] of navalMap) {
      lines.push(isEn ? `- ${faction}: ${ships} ships` : `- ${faction}: 舰船 ${ships} 艘`);
    }
  }

  // --- Territory control (count by controller) ---
  const territoryRows = parseMarkdownTableRows(warLedgers["territory_control.md"] ?? "")
    .filter((r) => r.length >= 4 && r[3] && !/^controller|控制者/i.test(r[3]));
  if (territoryRows.length > 0) {
    const terrMap = new Map<string, number>();
    for (const r of territoryRows) {
      const ctrl = r[3]?.trim() ?? "";
      if (!ctrl) continue;
      terrMap.set(ctrl, (terrMap.get(ctrl) ?? 0) + 1);
    }
    lines.push(isEn ? "### Territory" : "### 领土控制");
    for (const [ctrl, count] of terrMap) {
      lines.push(isEn ? `- ${ctrl}: ${count} territory(ies)` : `- ${ctrl}: 控制 ${count} 地`);
    }
  }

  // --- Active wars ---
  const warRows = parseMarkdownTableRows(warLedgers["war_theater.md"] ?? "")
    .filter((r) => r.length >= 4 && r[0] && !/^theater|war_id|战场/i.test(r[0]));
  if (warRows.length > 0) {
    lines.push(isEn ? "### Active Wars" : "### 活跃战争");
    for (const r of warRows.slice(0, 6)) {
      const name = r[1]?.trim() ?? r[0]?.trim() ?? "";
      const status = r[7]?.trim() ?? r[6]?.trim() ?? "";
      lines.push(isEn ? `- ${name} (status: ${status})` : `- ${name}（${status}）`);
    }
  }

  // --- Current epoch ---
  const epochRows = parseMarkdownTableRows(warLedgers["epoch_timeline.md"] ?? "")
    .filter((r) => r.length >= 3 && r[0] && !/^epoch|纪元/i.test(r[0]));
  if (epochRows.length > 0) {
    lines.push(isEn ? "### Current Epoch" : "### 当前纪元");
    for (const r of epochRows.slice(0, 3)) {
      lines.push(isEn
        ? `- ${r[1] ?? ""}: ch.${r[2] ?? "?"}-${r[3] ?? "?"} — ${r[5] ?? ""}`
        : `- ${r[1] ?? ""}: 第${r[2] ?? "?"}-${r[3] ?? "?"}章 — ${r[5] ?? ""}`);
    }
  }

  // --- Relationship risks (trust < 50) ---
  const relRows = parseMarkdownTableRows(warLedgers["relationship_graph.md"] ?? "")
    .filter((r) => r.length >= 5 && r[0] && r[1] && !/^character_a|角色A/i.test(r[0]));
  const riskyRels = relRows.filter((r) => {
    const trust = parseInt(r[4] ?? "100", 10);
    return trust < 50;
  }).sort((a, b) => (parseInt(a[4] ?? "100", 10)) - (parseInt(b[4] ?? "100", 10)));
  if (riskyRels.length > 0) {
    lines.push(isEn ? "### Relationship Risks (trust < 50)" : "### 关系风险（信任度 < 50）");
    for (const r of riskyRels.slice(0, 8)) {
      const trust = r[4] ?? "?";
      const status = r[3] ?? "";
      const types = r[2] ?? "";
      if (isEn) {
        lines.push(`- ${r[0]} ↔ ${r[1]}: trust=${trust}, status=${status}, types=${types}`);
      } else {
        lines.push(`- ${r[0]} ↔ ${r[1]}: 信任=${trust}，状态=${status}，关系=${types}`);
      }
    }
  }

  // --- Era mood (current) ---
  const eraRows = parseMarkdownTableRows(warLedgers["era_mood.md"] ?? "")
    .filter((r) => r.length >= 8 && r[0] && !/^era_id|时代/i.test(r[0]));
  if (eraRows.length > 0) {
    const latest = eraRows[eraRows.length - 1];
    const prosperity = latest[3] ?? "?";
    const war = latest[4] ?? "?";
    const stability = latest[5] ?? "?";
    const innovation = latest[6] ?? "?";
    const decay = latest[7] ?? "?";
    const mood = latest[8] ?? "";
    if (isEn) {
      lines.push(`### Era Mood — ${latest[1] ?? "current"}`);
      lines.push(`- prosperity:${prosperity} | war:${war} | stability:${stability} | innovation:${innovation} | decay:${decay} | mood:${mood}`);
    } else {
      lines.push(`### 时代情绪 — ${latest[1] ?? "当前"}`);
      lines.push(`- 繁荣:${prosperity} | 战争:${war} | 稳定:${stability} | 创新:${innovation} | 衰败:${decay} | 基调:${mood}`);
    }
  }

  // --- Geography (terrain context) ---
  const geoRows = parseMarkdownTableRows(warLedgers["geography.md"] ?? "")
    .filter((r) => r.length >= 4 && r[0] && !/^geo_id|地理/i.test(r[0]));
  if (geoRows.length > 0) {
    lines.push(isEn ? "### Geography" : "### 地理特征");
    for (const r of geoRows.slice(0, 10)) {
      const name = r[1]?.trim() ?? r[0]?.trim() ?? "";
      const terrain = r[2]?.trim() ?? "";
      const climate = r[3]?.trim() ?? "";
      const features = r[4]?.trim() ?? "";
      if (isEn) {
        lines.push(`- ${name}: terrain=${terrain}, climate=${climate}${features ? `, features=${features}` : ""}`);
      } else {
        lines.push(`- ${name}: 地形=${terrain}，气候=${climate}${features ? `，特征=${features}` : ""}`);
      }
    }
  }

  if (lines.length === 0) {
    return "";
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Phase Outline — three-layer outline system
// ---------------------------------------------------------------------------

/**
 * Read outline/phase_outline.md from the book directory. Returns "" when absent.
 */
export async function readPhaseOutline(bookDir: string): Promise<string> {
  return readOrEmpty(join(bookDir, "story", "outline", "phase_outline.md"));
}

/**
 * Parse phase_outline.md into structured phase objects.
 *
 * Supports optional YAML frontmatter at the top of the file:
 * ```
 * ---
 * currentPhase: 1
 * tensionCurve: 升-平-升
 * ---
 * ```
 *
 * Per-phase format:
 * ## Phase N: <title> (Ch.X-Y)
 * **status**: active | pending | done
 * **tension**: 升 | 平 | 降 | 升-平-升
 * **mustPayoff**: [H03, H07]
 * **mustSetup**: [H12]
 * **narrative_goals**:
 * - [ ] goal 1
 * - [x] goal 2 (achieved in ch.Z)
 * **resource_constraints**:
 * - constraint 1
 * **war_ledger_snapshot**:
 * - snapshot line 1
 */
export function parsePhaseOutline(raw: string): Phase[] {
  if (!raw || !raw.trim()) return [];

  // Extract YAML frontmatter if present
  let frontmatter: Record<string, unknown> = {};
  let body = raw;
  const fmMatch = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
  if (fmMatch) {
    try {
      const parsed: unknown = YAML.load(fmMatch[1]!);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        frontmatter = parsed as Record<string, unknown>;
      }
    } catch { /* malformed YAML — ignore */ }
    body = fmMatch[2]!;
  }

  // Try YAML parsing first (new format)
  const yamlResult = parsePhaseOutlineYAML(body);
  if (yamlResult) {
    return Object.assign(yamlResult, { frontmatter }) as Phase[] & { frontmatter: Record<string, unknown> };
  }

  // Fallback: legacy markdown regex parser
  const phases: Phase[] = [];
  const lines = body.split("\n");
  let current: Phase | null = null;
  let section: "goals" | "constraints" | "snapshot" | null = null;

  for (const line of lines) {
    const trimmed = line.trim();

    // Phase header: ## Phase N: title (Ch.X-Y) or ## 阶段 N：标题（第 X-Y 章）
    const phaseMatch = trimmed.match(
      /^##\s*(?:Phase|阶段|第)\s*(\d+)\s*[:：]\s*(.+?)(?:\s*\(Ch\.(\d+)-(\d+)\)|\s*（第\s*(\d+)\s*-\s*(\d+)\s*章）)?$/i,
    );
    if (phaseMatch) {
      if (current) phases.push(current);
      current = {
        id: parseInt(phaseMatch[1]!, 10),
        title: phaseMatch[2]!.trim(),
        startChapter: phaseMatch[3] ? parseInt(phaseMatch[3], 10) : phaseMatch[5] ? parseInt(phaseMatch[5], 10) : undefined,
        endChapter: phaseMatch[4] ? parseInt(phaseMatch[4], 10) : phaseMatch[6] ? parseInt(phaseMatch[6], 10) : undefined,
        status: "pending",
        tension: undefined,
        mustPayoff: [],
        mustSetup: [],
        goals: [],
        resourceConstraints: [],
        warLedgerSnapshot: [],
      };
      section = null;
      continue;
    }

    if (!current) continue;

    // Status line
    const statusMatch = trimmed.match(/^\*\*status\*\*:\s*(active|pending|done)/i);
    if (statusMatch) {
      current.status = statusMatch[1]!.toLowerCase() as Phase["status"];
      section = null;
      continue;
    }

    // Tension field
    const tensionMatch = trimmed.match(/^\*\*tension\*\*:\s*(.+)$/i);
    if (tensionMatch) {
      current.tension = tensionMatch[1]!.trim();
      section = null;
      continue;
    }

    // mustPayoff field: **mustPayoff**: [H03, H07] or inline list
    const payoffMatch = trimmed.match(/^\*\*mustPayoff\*\*:\s*(.+)$/i);
    if (payoffMatch) {
      current.mustPayoff = payoffMatch[1]!.replace(/[\[\]]/g, "").split(/[,，、]\s*/).map(s => s.trim()).filter(Boolean);
      section = null;
      continue;
    }

    // mustSetup field
    const setupMatch = trimmed.match(/^\*\*mustSetup\*\*:\s*(.+)$/i);
    if (setupMatch) {
      current.mustSetup = setupMatch[1]!.replace(/[\[\]]/g, "").split(/[,，、]\s*/).map(s => s.trim()).filter(Boolean);
      section = null;
      continue;
    }

    // Section headers (bold or markdown heading)
    if (/^\*\*narrative_goals\*\*/i.test(trimmed) || /^###?\s*叙事目标/.test(trimmed)) { section = "goals"; continue; }
    if (/^\*\*resource_constraints\*\*/i.test(trimmed) || /^###?\s*资源约束/.test(trimmed)) { section = "constraints"; continue; }
    if (/^\*\*war_ledger_snapshot\*\*/i.test(trimmed) || /^###?\s*(?:战争账本|战争账本快照)/.test(trimmed)) { section = "snapshot"; continue; }

    // New bold header resets section
    if (/^\*\*\w/.test(trimmed)) { section = null; continue; }

    // Goal items: - [ ] / - [x] or numbered list (1. goal text)
    if (section === "goals") {
      const goalMatch = trimmed.match(/^-\s*\[([ x])\]\s*(.+)$/);
      if (goalMatch) {
        current.goals.push({
          text: goalMatch[2]!.trim(),
          achieved: goalMatch[1] === "x",
        });
      } else {
        const numGoalMatch = trimmed.match(/^\d+\.\s*(.+)$/);
        if (numGoalMatch) {
          current.goals.push({
            text: numGoalMatch[1]!.trim(),
            achieved: false,
          });
        }
      }
    }

    // Constraint/snapshot bullet items
    if (section === "constraints" && trimmed.startsWith("- ")) {
      current.resourceConstraints.push(trimmed.slice(2));
    }
    if (section === "snapshot" && trimmed.startsWith("- ")) {
      current.warLedgerSnapshot.push(trimmed.slice(2));
    }
  }

  if (current) phases.push(current);

  // Attach frontmatter metadata to the result
  return Object.assign(phases, { frontmatter }) as Phase[] & { frontmatter: Record<string, unknown> };
}

/**
 * Parse YAML-format phase outline. Returns null if input is not valid YAML with phases.
 */
function parsePhaseOutlineYAML(body: string): Phase[] | null {
  try {
    const doc: unknown = YAML.load(body);
    if (!doc || typeof doc !== "object" || !("phases" in doc)) return null;
    const phasesRaw = (doc as { phases: unknown }).phases;
    if (!Array.isArray(phasesRaw)) return null;

    const phases = phasesRaw.map((p: Record<string, unknown>) => {
      const chapters = typeof p.chapters === "string" ? p.chapters.split("-") : [];
      const achievedSet = new Set(
        Array.isArray(p._achieved_goals) ? (p._achieved_goals as unknown[]).map(String) : [],
      );
      return {
        id: typeof p.id === "number" ? p.id : 0,
        title: String(p.title || ""),
        startChapter: chapters[0] ? parseInt(chapters[0], 10) : undefined,
        endChapter: chapters[1] ? parseInt(chapters[1], 10) : undefined,
        status: (["active", "pending", "done"].includes(p.status as string) ? p.status : "pending") as Phase["status"],
        tension: p.tension ? String(p.tension) : undefined,
        mustPayoff: Array.isArray(p.mustPayoff) ? (p.mustPayoff as unknown[]).map(String) : [],
        mustSetup: Array.isArray(p.mustSetup) ? (p.mustSetup as unknown[]).map(String) : [],
        goals: Array.isArray(p.narrative_goals)
          ? (p.narrative_goals as unknown[]).map((g: unknown) => ({ text: String(g), achieved: achievedSet.has(String(g)) }))
          : [],
        resourceConstraints: Array.isArray(p.resource_constraints) ? (p.resource_constraints as unknown[]).map(String) : [],
        warLedgerSnapshot: Array.isArray(p.war_ledger_snapshot) ? (p.war_ledger_snapshot as unknown[]).map(String) : [],
      } satisfies Phase;
    });
    return phases.length > 0 ? phases : null;
  } catch {
    return null;
  }
}

/**
 * Find which phase contains the given chapter number.
 * Falls back to the first active phase, then the last phase with status != "done".
 */
export function findCurrentPhase(phases: Phase[], chapterNumber: number): Phase | undefined {
  if (phases.length === 0) return undefined;

  // 1. Exact range match
  const rangeMatch = phases.find(
    (p) =>
      typeof p.startChapter === "number" &&
      typeof p.endChapter === "number" &&
      chapterNumber >= p.startChapter &&
      chapterNumber <= p.endChapter,
  );
  if (rangeMatch) return rangeMatch;

  // 2. Active phase
  const active = phases.find((p) => p.status === "active");
  if (active) return active;

  // 3. Last non-done phase
  const pending = [...phases].reverse().find((p) => p.status !== "done");
  return pending ?? phases[phases.length - 1];
}

/**
 * Compose a compact phase context block for the planner prompt.
 * Includes current phase goals (with achievement status) and resource constraints.
 */
export function composePhaseContext(phases: Phase[], chapterNumber: number, language: "zh" | "en" = "zh"): string {
  const current = findCurrentPhase(phases, chapterNumber);
  if (!current) return "";

  const isEn = language === "en";
  const lines: string[] = [];

  if (isEn) {
    lines.push(`### Current Phase: Phase ${current.id}: ${current.title}`);
    if (typeof current.startChapter === "number") {
      lines.push(`Chapter range: ${current.startChapter}-${current.endChapter ?? "?"}`);
    }
    if (current.tension) {
      lines.push(`#### Tension curve: ${current.tension}`);
    }
    if (current.mustPayoff.length > 0) {
      lines.push(`#### Hooks that MUST be resolved this phase: ${current.mustPayoff.join(", ")}`);
    }
    if (current.mustSetup.length > 0) {
      lines.push(`#### Hooks that MUST be set up this phase: ${current.mustSetup.join(", ")}`);
    }
    if (current.goals.length > 0) {
      lines.push("#### Narrative Goals (MUST achieve all before phase ends)");
      for (const g of current.goals) {
        const mark = g.achieved ? "[x]" : "[ ]";
        lines.push(`- ${mark} ${g.text}`);
      }
    }
    if (current.resourceConstraints.length > 0) {
      lines.push("#### Resource Constraints");
      for (const c of current.resourceConstraints) {
        lines.push(`- ${c}`);
      }
    }
  } else {
    lines.push(`### 当前阶段：阶段 ${current.id}：${current.title}`);
    if (typeof current.startChapter === "number") {
      lines.push(`章节范围：第${current.startChapter}-${current.endChapter ?? "?"}章`);
    }
    if (current.tension) {
      lines.push(`#### 张力曲线：${current.tension}`);
    }
    if (current.mustPayoff.length > 0) {
      lines.push(`#### 本阶段必须回收的伏笔：${current.mustPayoff.join("、")}`);
    }
    if (current.mustSetup.length > 0) {
      lines.push(`#### 本阶段必须埋设的伏笔：${current.mustSetup.join("、")}`);
    }
    if (current.goals.length > 0) {
      lines.push("#### 阶段叙事目标（全部达成后才可进入下一阶段）");
      for (const g of current.goals) {
        const mark = g.achieved ? "[x]" : "[ ]";
        lines.push(`- ${mark} ${g.text}`);
      }
    }
    if (current.resourceConstraints.length > 0) {
      lines.push("#### 资源约束");
      for (const c of current.resourceConstraints) {
        lines.push(`- ${c}`);
      }
    }
  }

  // Show unfinished goals as hard constraints
  const unachieved = current.goals.filter((g) => !g.achieved);
  if (unachieved.length > 0) {
    if (isEn) {
      lines.push(`\n**HARD CONSTRAINT**: This chapter MUST advance at least one unachieved goal. Unachieved: ${unachieved.length}/${current.goals.length}`);
    } else {
      lines.push(`\n**硬约束**：本章必须推进至少一个未达成目标。未达成：${unachieved.length}/${current.goals.length}`);
    }
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Chapter Skeleton (章纲骨架) — four-layer outline system
// ---------------------------------------------------------------------------

/**
 * Read outline/chapter_skeleton.md from the book directory. Returns "" when absent.
 */
export async function readChapterSkeleton(bookDir: string): Promise<string> {
  return readOrEmpty(join(bookDir, "story", "outline", "chapter_skeleton.md"));
}

/**
 * Extract the skeleton entry for a specific chapter from the chapter_skeleton.md
 * markdown table. Returns { goal, event, hooks, emotion } or undefined.
 *
 * Supports both individual chapter rows (| 3 | ...) and range rows (| 4-6 | ...).
 * Range rows match if chapterNumber falls within the range.
 */
export function extractSkeletonEntry(skeletonRaw: string, chapterNumber: number): SkeletonEntry | undefined {
  if (!skeletonRaw || !skeletonRaw.trim()) return undefined;

  const lines = skeletonRaw.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|")) continue;

    // Skip header and separator rows
    if (/^\|\s*[-—]+\s*\|/.test(trimmed) || /^\|\s*(章|Ch)\s*\|/i.test(trimmed)) continue;

    const cells = trimmed.split("|").slice(1, -1).map((c) => c.trim());
    if (cells.length < 4) continue;

    const chapterCell = cells[0]!;

    // Try range match: "4-6" or "4–6"
    const rangeMatch = chapterCell.match(/^(\d+)\s*[-–]\s*(\d+)$/);
    if (rangeMatch) {
      const start = parseInt(rangeMatch[1]!, 10);
      const end = parseInt(rangeMatch[2]!, 10);
      if (chapterNumber >= start && chapterNumber <= end) {
        return {
          goal: cells[1] ?? "",
          event: cells[2] ?? "",
          hooks: cells[3] ?? "",
          emotion: cells[4] ?? "",
        };
      }
      continue;
    }

    // Try exact match
    const exactMatch = chapterCell.match(/^(\d+)$/);
    if (exactMatch) {
      if (parseInt(exactMatch[1]!, 10) === chapterNumber) {
        return {
          goal: cells[1] ?? "",
          event: cells[2] ?? "",
          hooks: cells[3] ?? "",
          emotion: cells[4] ?? "",
        };
      }
    }
  }
  return undefined;
}

/**
 * Compose a compact skeleton context block for the planner prompt.
 * Returns "" when no skeleton entry exists for this chapter.
 */
export function composeSkeletonContext(skeletonRaw: string, chapterNumber: number, language: "zh" | "en" = "zh"): string {
  const entry = extractSkeletonEntry(skeletonRaw, chapterNumber);
  if (!entry) return "";

  const isEn = language === "en";
  const lines: string[] = [];

  if (isEn) {
    lines.push("### Chapter Skeleton (pre-planned beats)");
    if (entry.goal) lines.push(`- Goal: ${entry.goal}`);
    if (entry.event) lines.push(`- Key event: ${entry.event}`);
    if (entry.hooks) lines.push(`- Hook actions: ${entry.hooks}`);
    if (entry.emotion) lines.push(`- Emotional tone: ${entry.emotion}`);
    lines.push("");
    lines.push("If a skeleton entry exists, the memo goal MUST align with the skeleton goal. Hook actions from the skeleton MUST appear in the memo's hook ledger. Emotional tone MUST match. The skeleton is the high-level pre-plan; your job is to expand it into a full task card and active cast.");
  } else {
    lines.push("### 本章骨架约束（章纲预排）");
    if (entry.goal) lines.push(`- 目标：${entry.goal}`);
    if (entry.event) lines.push(`- 关键事件：${entry.event}`);
    if (entry.hooks) lines.push(`- hook动作：${entry.hooks}`);
    if (entry.emotion) lines.push(`- 情绪基调：${entry.emotion}`);
    lines.push("");
    lines.push("如果存在骨架约束，本章 memo 的 goal 必须与骨架目标一致。骨架中的 hook 动作必须在 memo 的 hook 账中体现。情绪基调必须与骨架一致。骨架是高层预排，你负责展开为完整的任务卡和出场人物。");
  }

  return lines.join("\n");
}
