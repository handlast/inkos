import { BaseAgent } from "./base.js";
import type { GenreProfile } from "../models/genre-profile.js";
import type { BookRules } from "../models/book-rules.js";
import type { FanficMode } from "../models/book.js";
import type { ChapterMemo, ContextPackage, RuleStack } from "../models/input-governance.js";
import { readGenreProfile, readBookLanguage, readBookRules } from "./rules-reader.js";
import { getFanficDimensionConfig, FANFIC_DIMENSIONS } from "./fanfic-dimensions.js";
import { readFile, readdir } from "node:fs/promises";
import { filterHooks, filterSummaries, filterSubplots, filterEmotionalArcs, filterCharacterMatrix } from "../utils/context-filter.js";
import { buildGovernedMemoryEvidenceBlocks } from "../utils/governed-context.js";
import {
  readVolumeMap,
  readCharacterContext,
  readCurrentStateWithFallback,
  readStoryFrame,
} from "../utils/outline-paths.js";
import { readWarLedgers, composeWarResourceSummary } from "./planner-context.js";
import { join } from "node:path";

export interface AuditResult {
  readonly passed: boolean;
  readonly issues: ReadonlyArray<AuditIssue>;
  readonly summary: string;
  /** True when the auditor response itself was not parseable; callers must not auto-revise content from this result. */
  readonly parseFailed?: boolean;
  /** 0-100 overall quality score. Present when the auditor supports scoring. */
  readonly overallScore?: number;
  readonly tokenUsage?: {
    readonly promptTokens: number;
    readonly completionTokens: number;
    readonly totalTokens: number;
  };
}

export interface AuditIssue {
  readonly severity: "critical" | "warning" | "info";
  readonly category: string;
  readonly description: string;
  readonly suggestion: string;
  readonly repairScope?: "local" | "structural" | "unknown";
}

type PromptLanguage = "zh" | "en";

function normalizeRepairScope(value: unknown): AuditIssue["repairScope"] {
  if (value === "local" || value === "structural" || value === "unknown") return value;
  return undefined;
}

const DIMENSION_LABELS: Record<number, { readonly zh: string; readonly en: string }> = {
  1: { zh: "OOC检查", en: "OOC Check" },
  2: { zh: "时间线检查", en: "Timeline Check" },
  3: { zh: "设定冲突", en: "Lore Conflict Check" },
  4: { zh: "战力崩坏", en: "Power Scaling Check" },
  5: { zh: "数值检查", en: "Numerical Consistency Check" },
  6: { zh: "伏笔检查", en: "Hook Check" },
  7: { zh: "节奏检查", en: "Pacing Check" },
  8: { zh: "文风检查", en: "Style Check" },
  9: { zh: "信息越界", en: "Information Boundary Check" },
  10: { zh: "词汇疲劳", en: "Lexical Fatigue Check" },
  11: { zh: "利益链断裂", en: "Incentive Chain Check" },
  12: { zh: "年代考据", en: "Era Accuracy Check" },
  13: { zh: "配角降智", en: "Side Character Competence Check" },
  14: { zh: "配角工具人化", en: "Side Character Instrumentalization Check" },
  15: { zh: "爽点虚化", en: "Payoff Dilution Check" },
  16: { zh: "台词失真", en: "Dialogue Authenticity Check" },
  17: { zh: "流水账", en: "Chronicle Drift Check" },
  18: { zh: "知识库污染", en: "Knowledge Base Pollution Check" },
  19: { zh: "视角一致性", en: "POV Consistency Check" },
  20: { zh: "段落等长", en: "Paragraph Uniformity Check" },
  21: { zh: "套话密度", en: "Cliche Density Check" },
  22: { zh: "公式化转折", en: "Formulaic Twist Check" },
  23: { zh: "列表式结构", en: "List-like Structure Check" },
  24: { zh: "支线停滞", en: "Subplot Stagnation Check" },
  25: { zh: "弧线平坦", en: "Arc Flatline Check" },
  26: { zh: "节奏单调", en: "Pacing Monotony Check" },
  27: { zh: "敏感词检查", en: "Sensitive Content Check" },
  28: { zh: "正传事件冲突", en: "Mainline Canon Event Conflict" },
  29: { zh: "未来信息泄露", en: "Future Knowledge Leak Check" },
  30: { zh: "世界规则跨书一致性", en: "Cross-Book World Rule Check" },
  31: { zh: "番外伏笔隔离", en: "Spinoff Hook Isolation Check" },
  32: { zh: "读者期待管理", en: "Reader Expectation Check" },
  33: { zh: "章节备忘偏离", en: "Chapter Memo Drift Check" },
  34: { zh: "角色还原度", en: "Character Fidelity Check" },
  35: { zh: "世界规则遵守", en: "World Rule Compliance Check" },
  36: { zh: "关系动态", en: "Relationship Dynamics Check" },
  37: { zh: "正典事件一致性", en: "Canon Event Consistency Check" },
  38: { zh: "读者清晰度", en: "Reader Clarity Check" },
};

function containsChinese(text: string): boolean {
  return /[\u4e00-\u9fff]/u.test(text);
}

function resolveGenreLabel(genreId: string, profileName: string, language: PromptLanguage): string {
  if (language === "zh" || !containsChinese(profileName)) {
    return profileName;
  }

  if (genreId === "other") {
    return "general";
  }

  return genreId.replace(/[_-]+/g, " ");
}

function dimensionName(id: number, language: PromptLanguage): string | undefined {
  return DIMENSION_LABELS[id]?.[language];
}

function joinLocalized(items: ReadonlyArray<string>, language: PromptLanguage): string {
  return items.join(language === "en" ? ", " : "、");
}

function formatFanficSeverityNote(
  severity: "critical" | "warning" | "info",
  language: PromptLanguage,
): string {
  if (language === "en") {
    return severity === "critical"
      ? "Strict check."
      : severity === "info"
        ? "Log only; do not fail the chapter."
        : "Warning level.";
  }

  return severity === "critical"
    ? "（严格检查）"
    : severity === "info"
      ? "（仅记录，不判定失败）"
      : "（警告级别）";
}

function buildDimensionNote(
  id: number,
  language: PromptLanguage,
  gp: GenreProfile,
  bookRules: BookRules | null,
  fanficMode: FanficMode | undefined,
  fanficConfig: ReturnType<typeof getFanficDimensionConfig> | undefined,
): string {
  const words = bookRules?.fatigueWordsOverride && bookRules.fatigueWordsOverride.length > 0
    ? bookRules.fatigueWordsOverride
    : gp.fatigueWords;

  if (fanficConfig?.notes.has(id) && language === "zh") {
    return fanficConfig.notes.get(id)!;
  }

  if (id === 1 && fanficMode === "ooc") {
    return language === "en"
      ? "In OOC mode, personality drift can be intentional; record only, do not fail. Evaluate against the character dossiers in fanfic_canon.md."
      : "OOC模式下角色可偏离性格底色，此维度仅记录不判定失败。参照 fanfic_canon.md 角色档案评估偏离程度。";
  }

  if (id === 1 && fanficMode === "canon") {
    return language === "en"
      ? "Canon-faithful fanfic: characters must stay close to their original personality core. Evaluate against fanfic_canon.md character dossiers."
      : "原作向同人：角色必须严格遵守性格底色。参照 fanfic_canon.md 角色档案中的性格底色和行为模式。";
  }

  if (id === 10 && words.length > 0) {
    return language === "en"
      ? `Fatigue words: ${words.join(", ")}. Also check AI tell markers (仿佛/不禁/宛如/竟然/忽然/猛地); warn when any appears more than once per 3,000 words.`
      : `高疲劳词：${words.join("、")}。同时检查AI标记词（仿佛/不禁/宛如/竟然/忽然/猛地）密度，每3000字超过1次即warning`;
  }

  if (id === 15 && gp.satisfactionTypes.length > 0) {
    return language === "en"
      ? `Payoff types: ${gp.satisfactionTypes.join(", ")}`
      : `爽点类型：${gp.satisfactionTypes.join("、")}`;
  }

  if (id === 12 && bookRules?.eraConstraints) {
    const era = bookRules.eraConstraints;
    const parts = [era.period, era.region].filter(Boolean);
    if (parts.length > 0) {
      return language === "en"
        ? `Era: ${parts.join(", ")}`
        : `年代：${parts.join("，")}`;
    }
  }

  // v10: Enhanced dimension notes with writing methodology awareness
  if (id === 7) {
    return language === "en"
      ? "Check pacing rhythm: Do the recent 3-5 chapters form a complete mini-goal cycle (build-up → escalation → climax → aftermath)? If 5+ consecutive chapters pass without a climax (payoff/reward/reversal), flag as pacing stagnation. If the previous chapter was a climax/big reversal, does this chapter show change (relationships shifted, status changed, costs paid)? If it jumps straight to new build-up without showing impact, flag as 'post-climax impact missing'. Daily/transition scenes must carry at least one task: plant a hook, advance a relationship, set up contrast, or prepare the next cycle. Also check whether non-critical chase/combat/movement/procedure/transaction/deduction passages take too much space without changing information, resources, injury, position, relationships, power, or hook state; ask for compression when they do."
      : "检查节奏波形：最近 3-5 章是否形成了完整的「蓄压→升级→爆发→后效」周期？如果连续 5 章没有爆发（兑现/回报/翻转），标记为节奏停滞。如果上一章是爆发/高潮/大反转，本章是否写出了改变？如果直接跳到新蓄压而没有展示前一波爆发的影响，标记为「高潮后影响缺失」。非冲突章节中的日常/过渡/对话段落，是否至少承担了一项任务：埋伏笔、推关系、建立反差、准备下一轮蓄压。纯水日常标记为流水账风险。同时检查非关键追逐/打斗/移动/程序/交易/推理是否占用过多篇幅却没有改变信息、资源、伤势、位置、关系、权力或伏笔状态；若是，要求压缩。";
  }

  if (id === 15) {
    const base = gp.satisfactionTypes.length > 0
      ? (language === "en" ? `Payoff types: ${gp.satisfactionTypes.join(", ")}. ` : `爽点类型：${gp.satisfactionTypes.join("、")}。`)
      : "";
    return language === "en"
      ? `${base}Check desire engine: Has the chapter created an emotional gap (reader wants release) OR delivered a payoff that exceeds expectations? A payoff that only satisfies 70% of built-up anticipation counts as diluted. If this chapter is in the aftermath phase of a mini-goal cycle, verify that consequences are shown — not just emotional reactions, but concrete changes to status, relationships, or resources.`
      : `${base}检查欲望驱动：本章是否制造了情绪缺口（读者渴望释放）或完成了超出预期的兑现？只满足读者70%期待的兑现等于爽点虚化。如果本章处于小目标周期的后效阶段，检查是否展示了具体改变——不只是情绪反应，而是地位、关系或资源的实际变化。`;
  }

  if (id === 25) {
    return language === "en"
      ? "Cross-check character behavior against the 3-question test: (1) Why does the character do this? (2) Does it match their established profile? (3) Would a reader who only read prior chapters find it jarring? Also check if character's emotional state progresses or stagnates."
      : "人设三问检查：(1)角色为什么这么做？(2)符合之前建立的人设吗？(3)只看过前面章节的读者会觉得突兀吗？同时检查角色情绪弧线是否在推进还是停滞。";
  }

  switch (id) {
    case 6:
      // Phase 7 — hook-debt escalation. Reviewer now reads pending_hooks.md
      // not just for "is this hook undelivered" but for causal/temporal
      // debt escalation. The ledger's status column carries "过期 (距=…/半衰=…)"
      // and "受阻于 …" markers emitted by the stale/blocked detector; this
      // dimension tells the reviewer how to escalate them.
      return language === "en"
        ? `Hook-debt escalation (Phase 7 + hotfixes 2/3). Read the pending_hooks.md ledger and escalate based on the stale / blocked / core_hook / depends_on / promoted columns, NOT only on "undelivered hook present":

• Critical severity only applies to hooks with promoted=true in the ledger. A stale/blocked non-promoted hook stays at info — the promotion flag is the gate that keeps reviewer noise down, because architect-seed emits many non-load-bearing seeds.
• A promoted core_hook=true hook that has been stale for over 10 chapters → escalate from warning to critical. The book has only 3-7 core hooks; letting one drift that long is the lead symptom of narrative rot.
• A promoted hook whose status cell contains "blocked on X (blocked Y chapters)" with Y >= 6 → warning. The literal "blocked Y chapters" token comes straight from the ledger — read it, don't guess. Call out the upstream hook id so the planner can route the resolution.
• At volume end (final chapter of any volume per volume_map) a promoted core_hook that is still open or stale without explicit "carried over to volume N+1" planning → critical.
• Any non-promoted stale hook → info-level log; do not fail the chapter on it, but note it so the planner can schedule cleanup.

Quote the exact hook_id in description and include the stale / blocked marker text verbatim. Structure check only — do not judge hook prose quality.

## Hook Payoff Validation Rules (Three-Element Test)

When checking whether a hook from the chapter_memo's advance/resolve section has been delivered, use the THREE-ELEMENT TEST instead of word count:

A hook payoff scene is VALID if it contains at least 2 of these 3 elements:
1. **Specific object/information name** — not pronouns like "that thing" or "it"
2. **Observable character action** — touch/pick up/see/say/hear, NOT "remember" or "think about"
3. **At least one consequence** — decision change, relationship shift, new info revealed, physical state change

Hook type-specific guidance:
- **Status change hooks** (pain/injury/ability): Physical reactions (grimacing, trembling, losing grip) with sensory details count as valid payoff. "He felt something wrong" is NOT valid. "He clutched his chest, cold sweat beading on his forehead" IS valid.
- **Object hooks** (keys/letters/artifacts): Direct physical interaction with the object counts. "He remembered the letter was in the drawer" is NOT valid. "He pulled open the drawer, the letter still at the bottom, edges chewed by insects" IS valid.
- **Information hooks** (secrets/clues/truths): Character receiving the info with an observable reaction counts. "He sensed something was off" is NOT valid. "He stared at the serial number, fingers frozen on the keyboard — N-44, the one C-77 mentioned" IS valid.
- **Relationship hooks** (alliance/betrayal/trust): Actions that demonstrate the relationship change count. "Their relationship grew closer" is NOT valid. "She broke the last ration in half and handed one piece to him. He took it without a word" IS valid.

Do NOT flag a hook as undelivered just because the payoff scene is short (under 60 chars). A concise, punchy payoff that passes the three-element test is valid.`
        : `Phase 7 hook-debt 升级规则（含 hotfix 2/3）。阅读 pending_hooks.md 伏笔池时不要只看"有没有悬而未决的伏笔"，要读状态列中的 stale / blocked 标记、core_hook 列、depends_on 列、以及升级列：

• critical 级别仅适用于升级=是（promoted=true）的伏笔。非升级的 stale/blocked 伏笔一律保持 info——升级标志是降噪的开关，因为架构师阶段会产出大量非承重的伏笔种子。
• 升级=是且 core_hook=是 的伏笔过期超过 10 章未回收 → warning 升级为 critical。全书只有 3-7 条核心伏笔，任何一条漂移这么久都是烂尾前兆。
• 升级=是的受阻伏笔，状态列中"受阻于 X (已阻 Y 章)"且 Y ≥ 6 → warning。"已阻 Y 章"这个字面 token 直接读自账本，不要猜。描述中要写出具体的上游 hook_id，让 planner 能安排落地路径。
• 卷尾（volume_map 中任一卷的末章）仍有升级=是的主线伏笔处于 open 或 stale 且没有显式"延至下一卷"规划 → critical。
• 升级=否的 stale 伏笔 → info 级记录，不判本章失败，但保留以便 planner 安排清理。

description 中要明确引用 hook_id，并把状态列中 stale / blocked 的原文标记字面抄进去。本维度只审结构，不评价伏笔文笔。

## Hook 兑现判定规则（三要素测试）

检查 chapter_memo 的 advance/resolve 中的 hook 是否兑现时，使用**三要素测试**而非字数判断：

兑现段必须包含以下三要素中的至少两个才算有效：
1. **具体物件/信息名称**——不是代词"那个东西""它"
2. **角色可观察动作**——触摸/拿起/看到/说出/听到，不是"想起"或"觉得"
3. **至少一个后果**——决策改变、关系变化、新信息揭露、身体状态变化

按 hook 类型判定：
- **状态变化类**（疼痛/伤势/能力）：身体反应描写（皱眉、颤抖、失手掉落）即为有效兑现。"他感觉身体有些不对"不算有效。"他按住左胸，额角渗出冷汗"算有效。
- **物件类**（钥匙/信件/令牌）：角色与物件的直接物理交互即为有效。"他想起那张借条还在抽屉里"不算有效。"他拉开抽屉，借条还在最底层，边角被虫蛀了几个洞"算有效。
- **信息类**（秘密/线索/真相）：角色接收到信息并有可观察反应即为有效。"他隐约觉得事情没那么简单"不算有效。"他盯着屏幕上的编号，手指停在键盘上没动——N-44，C-77 提过的那个"算有效。
- **关系类**（结盟/背叛/信任）：角色间的具体互动体现关系变化即为有效。"两人的关系更近了一步"不算有效。"她把最后一块干粮掰成两半，递了一半给他。他接过去没说话"算有效。

不要因为兑现段落较短（低于60字）就判定为未兑现。简洁有力的兑现场景如果通过三要素测试，就是有效兑现。`;
    case 19:
      return language === "en"
        ? "Check whether POV shifts are signaled clearly and stay consistent with the configured viewpoint."
        : "检查视角切换是否有过渡、是否与设定视角一致";
    case 24:
      return language === "en"
        ? "Cross-check subplot_board and chapter_summaries: flag any subplot that stays dormant long enough to feel abandoned, or a recent run where every subplot is only restated instead of genuinely moving."
        : "对照 subplot_board 和 chapter_summaries：标记那些沉寂到接近被遗忘的支线，或近期连续只被重复提及、没有真实推进的支线。";
    case 25:
      return language === "en"
        ? "Cross-check emotional_arcs and chapter_summaries: flag any major character whose emotional line holds one pressure shape across a run instead of taking new pressure, release, reversal, or reinterpretation. Distinguish unchanged circumstances from unchanged inner movement."
        : "对照 emotional_arcs 和 chapter_summaries：标记主要角色在一段时间内始终停留在同一种情绪压力形态、没有新压力、释放、转折或重估的情况。注意区分'处境未变'和'内心未变'。";
    case 26:
      return language === "en"
        ? "Cross-check chapter_summaries for chapter-type distribution: warn when the recent sequence stays in the same mode long enough to flatten rhythm, or when payoff / release beats disappear for too long. Explicitly list the recent type sequence."
        : "对照 chapter_summaries 的章节类型分布：当近期章节长时间停留在同一种模式、把节奏压平，或回收/释放/高潮章节缺席过久时给出 warning。请明确列出最近章节的类型序列。";
    case 28:
      return language === "en"
        ? "Check whether spinoff events contradict the mainline canon constraints."
        : "检查番外事件是否与正典约束表矛盾";
    case 29:
      return language === "en"
        ? "Check whether characters reference information that should only be revealed after the divergence point (see the information-boundary table)."
        : "检查角色是否引用了分歧点之后才揭示的信息（参照信息边界表）";
    case 30:
      return language === "en"
        ? "Check whether the spinoff violates mainline world rules (power system, geography, factions)."
        : "检查番外是否违反正传世界规则（力量体系、地理、阵营）";
    case 31:
      return language === "en"
        ? "Check whether the spinoff resolves mainline hooks without authorization (warning level)."
        : "检查番外是否越权回收正传伏笔（warning级别）";
    case 32:
      return language === "en"
        ? "Check whether the ending renews curiosity, whether promised payoffs are landing on the cadence their hooks imply, whether pressure gets any release, and whether reader expectation gaps are accumulating faster than they are being satisfied. If a climax just occurred, check whether the aftermath chapters show concrete change before starting a new cycle. If the recent run has 2+ chapters of fleeing, hiding, being judged, being surrounded, passive pressure, or rule-crushing with the protagonist only reacting, check whether this chapter gives a visible counter-move, gain, or situation change. Around chapters 8-10, no counterattack/payoff after a long pressure run should escalate to high warning or critical unless the outline/memo explicitly schedules an immediate payoff."
        : "检查：章尾是否重新点燃好奇心，已经承诺的回收是否按伏笔自身节奏落地，压力是否得到释放，读者期待缺口是在持续累积还是在被满足。如果刚经历高潮，检查后效章节是否在开启新周期前展示了具体改变。如果近期连续 2 章以上都是逃、躲、被审、被围、被动承压或被敌方/规则推着走，检查本章是否给主角可见反制、收益或局势改变。第 8-10 章前后若长期承压仍无反击/payoff，且卷纲或 memo 没有明确下一章立即兑现，应升级为强 warning 或 critical。";
    case 33:
      return language === "en"
        ? "Cross-check the chapter_memo provided with the chapter. Does the final prose deliver the memo's goal and leave a visible trace for every one of the sections it contains (tasks, pay-offs / held-back cards, daily/transition function map, three-question check, end-of-chapter concrete changes, hard-don'ts, and Active Cast when present)? If Active Cast is present, check that offstage characters do not act, mentioned characters are only referenced, silent characters do not receive direct quoted speech, channel_only characters appear only through channel/remote text, and no_direct_line characters have no direct dialogue. Missing or contradicted sections -> critical only when the memo made them hard requirements; otherwise warning. Note: a sparse memo is legitimate — only flag drift against sections that the memo actually populates. Never flag the memo itself for being sparse."
        : "对照随章提供的 chapter_memo。成稿是否兑现了 memo 中的 goal，并在 memo 实际写出的段落（当前任务 / 读者清晰度底线 / 该兑现·暂不掀 / 日常过渡功能 / 关键抉择三连问 / 章尾必须发生的改变 / 不要做 / 本章出场人物 等）中留下可见落地痕迹？如果存在"本章出场人物"，检查 offstage 是否实体行动、mentioned 是否只被提及、silent 是否直接说话、channel_only 是否越界实体互动、no_direct_line 是否有直接台词。memo 明确写成硬要求却缺失或写反 → critical；其他偏离先标 warning。提醒：稀疏 memo 合法，只检查 memo 实际写出的段落，不能因为 memo 稀疏就判 incomplete。";
    case 38:
      return language === "en"
        ? "Reader clarity is structural, not prose polish. Check whether each core scene makes the front-stage situation legible: who is present, where they are, what is physically happening, what the protagonist visibly wants now, what obstacle blocks them, and what immediate cost failure carries. Mystery may hide deeper truth, hidden identity, long-term cause, or later reversal; it must not hide the current scene, visible intent, action object, or immediate stakes. Also check whether key on-stage information is over-compressed into metaphor, riddle-like lines, report fragments, or ellipsis. Flag concept overload when opening/new-setting chapters throw multiple unfamiliar proper nouns, institutions, powers, rules, or objects into the foreground without reader handles (visible shape / owner or user / current function / immediate consequence). Flag action-logic gaps when escape, chase, combat, terrain, procedure, transaction, or deduction beats lack a short causal bridge, so readers cannot tell why the move is possible, dangerous, or necessary. Flag opaque dialogue when important lines are only subtext/jargon and the reader cannot tell whether they threaten, probe, refuse, trade, conceal, pressure, ask for help, or change the relationship. If readers must translate an atmospheric sentence into a concrete fact before they can follow the action logic, flag warning; use critical when it blocks the chapter task. Do not demand lore dumps."
        : "读者清晰度属于结构完成度，不属于普通文笔润色。检查每个核心场景是否让读者看懂前台局面：谁在场、在哪里、正在发生什么、主角此刻可见目标是什么、阻力来自谁/什么、失败马上付出什么代价。悬念可以隐藏深层真相、幕后身份、长期原因或后续反转；不得隐藏当前场景、当下意图、行动对象和即时风险。同时检查关键现场信息是否被过度压缩成比喻、谜语句、报告碎片或省略句。早期章节或新设定密集章若连续抛出多个陌生专名、制度、能力、规则或道具，却没有读者抓手（可见形态 / 属于谁或谁在用 / 当前功能 / 眼前后果），标记为术语/设定负载失败。逃生、追逐、战斗、地形、程序、交易或推理缺少短因果桥，导致读者不知道为什么可行、为什么危险、为什么必须这样做，标记为动作逻辑缺口。重要台词如果只有潜台词或行话，读者无法判断它是在威胁、试探、拒绝、交易、隐瞒、压迫、求救还是改变关系，标记为台词落点不清。如果读者必须先把氛围句翻译成具体事实才能理解行动逻辑，标 warning；影响本章任务理解 → critical。不得要求设定说明书式补充。";
    case 34:
    case 35:
    case 36:
    case 37: {
      if (!fanficConfig) return "";
      const severity = fanficConfig.severityOverrides.get(id) ?? "warning";
      const baseNote = language === "en"
        ? {
            34: "Check whether dialogue tics, speaking style, and behavior remain consistent with the character dossiers in fanfic_canon.md. Deviations need clear situational motivation.",
            35: "Check whether the chapter violates world rules documented in fanfic_canon.md (geography, power system, faction relations).",
            36: "Check whether relationship beats remain plausible and aligned with, or meaningfully develop from, the key relationships documented in fanfic_canon.md.",
            37: "Check whether the chapter contradicts the key event timeline in fanfic_canon.md.",
          }[id]
        : FANFIC_DIMENSIONS.find((dimension) => dimension.id === id)?.baseNote;

      return baseNote
        ? `${baseNote} ${formatFanficSeverityNote(severity, language)}`
        : "";
    }
    default:
      return "";
  }
}

function buildDimensionList(
  gp: GenreProfile,
  bookRules: BookRules | null,
  language: PromptLanguage,
  hasParentCanon = false,
  fanficMode?: FanficMode,
): ReadonlyArray<{ readonly id: number; readonly name: string; readonly note: string }> {
  const activeIds = new Set(gp.auditDimensions);

  // Add book-level additional dimensions (supports both numeric IDs and name strings)
  if (bookRules?.additionalAuditDimensions) {
    // Build reverse lookup: name → id
    const nameToId = new Map<string, number>();
    for (const [id, labels] of Object.entries(DIMENSION_LABELS)) {
      nameToId.set(labels.zh, Number(id));
      nameToId.set(labels.en, Number(id));
    }

    for (const d of bookRules.additionalAuditDimensions) {
      if (typeof d === "number") {
        activeIds.add(d);
      } else if (typeof d === "string") {
        // Try exact match first, then substring match
        const exactId = nameToId.get(d);
        if (exactId !== undefined) {
          activeIds.add(exactId);
        } else {
          // Fuzzy: find dimension whose name contains the string
          for (const [name, id] of nameToId) {
            if (name.includes(d) || d.includes(name)) {
              activeIds.add(id);
              break;
            }
          }
        }
      }
    }
  }

  // Always-active dimensions
  activeIds.add(32); // 读者期待管理 — universal
  activeIds.add(33); // 章节备忘偏离 — universal (replaces legacy volume-outline drift)
  activeIds.add(38); // 读者清晰度 — universal

  // Conditional overrides
  if (gp.eraResearch || bookRules?.eraConstraints?.enabled) {
    activeIds.add(12);
  }

  // Spinoff dimensions — activated when parent_canon.md exists (but NOT in fanfic mode)
  if (hasParentCanon && !fanficMode) {
    activeIds.add(28); // 正传事件冲突
    activeIds.add(29); // 未来信息泄露
    activeIds.add(30); // 世界规则跨书一致性
    activeIds.add(31); // 番外伏笔隔离
  }

  // Fanfic dimensions — replace spinoff dims with fanfic-specific checks
  let fanficConfig: ReturnType<typeof getFanficDimensionConfig> | undefined;
  if (fanficMode) {
    fanficConfig = getFanficDimensionConfig(fanficMode, bookRules?.allowedDeviations);
    for (const id of fanficConfig.activeIds) {
      activeIds.add(id);
    }
    for (const id of fanficConfig.deactivatedIds) {
      activeIds.delete(id);
    }
  }

  const dims: Array<{ id: number; name: string; note: string }> = [];

  for (const id of [...activeIds].sort((a, b) => a - b)) {
    const name = dimensionName(id, language);
    if (!name) continue;

    const note = buildDimensionNote(id, language, gp, bookRules, fanficMode, fanficConfig);

    dims.push({ id, name, note });
  }

  return dims;
}

export class ContinuityAuditor extends BaseAgent {
  get name(): string {
    return "continuity-auditor";
  }

  async auditChapter(
    bookDir: string,
    chapterContent: string,
    chapterNumber: number,
    genre?: string,
    options?: {
      temperature?: number;
      chapterIntent?: string;
      chapterMemo?: ChapterMemo;
      contextPackage?: ContextPackage;
      ruleStack?: RuleStack;
      truthFileOverrides?: {
        currentState?: string;
        ledger?: string;
        hooks?: string;
      };
    },
  ): Promise<AuditResult> {
    const [diskCurrentState, diskLedger, diskHooks, styleGuideRaw, subplotBoard, emotionalArcs, characterMatrix, chapterSummaries, parentCanon, fanficCanon, volumeOutline, glossaryRaw] =
      await Promise.all([
        // Phase 5 consolidation: derive initial state from roles + seed hooks
        // when current_state.md is still the architect seed placeholder.
        readCurrentStateWithFallback(bookDir, "(文件不存在)"),
        this.readFileSafe(join(bookDir, "story/particle_ledger.md")),
        this.readFileSafe(join(bookDir, "story/pending_hooks.md")),
        this.readFileSafe(join(bookDir, "story/style_guide.md")),
        this.readFileSafe(join(bookDir, "story/subplot_board.md")),
        this.readFileSafe(join(bookDir, "story/emotional_arcs.md")),
        readCharacterContext(bookDir, "(文件不存在)"),
        this.readFileSafe(join(bookDir, "story/chapter_summaries.md")),
        this.readFileSafe(join(bookDir, "story/parent_canon.md")),
        this.readFileSafe(join(bookDir, "story/fanfic_canon.md")),
        readVolumeMap(bookDir, "(文件不存在)"),
        this.readFileSafe(join(bookDir, "story/state/glossary.json")),
      ]);
    // Cross-validation truth files: worldbuilding, character assets, war ledgers, etc.
    const [storyBible, characterAssets, allianceState, relationshipGraph, eraMood, warLedgers, phaseOutlineRaw] = await Promise.all([
      readStoryFrame(bookDir, "(文件不存在)"),
      this.readFileSafe(join(bookDir, "story/character_assets.md")),
      this.readFileSafe(join(bookDir, "story/alliance_state.md")),
      this.readFileSafe(join(bookDir, "story/relationship_graph.md")),
      this.readFileSafe(join(bookDir, "story/era_mood.md")),
      readWarLedgers(join(bookDir, "story")),
      this.readFileSafe(join(bookDir, "outline/phase_outline.md")),
    ]);
    // Parse registered glossary projection (jargon decode audit). Absent or
    // malformed file degrades to an empty term list — never throws.
    let glossaryTerms: ReadonlyArray<{ readonly term: string; readonly firstSeenChapter?: number; readonly lastDecodedAtChapter?: number }> = [];
    try {
      if (glossaryRaw !== "(文件不存在)") {
        const parsedGlossary: unknown = JSON.parse(glossaryRaw);
        if (
          typeof parsedGlossary === "object" && parsedGlossary !== null &&
          "terms" in parsedGlossary && Array.isArray((parsedGlossary as Record<string, unknown>).terms)
        ) {
          const rawTerms = (parsedGlossary as Record<string, unknown>).terms as unknown[];
          glossaryTerms = rawTerms.filter(
            (t): t is { readonly term: string; readonly firstSeenChapter?: number; readonly lastDecodedAtChapter?: number } =>
              typeof t === "object" && t !== null && "term" in t && typeof (t as Record<string, unknown>).term === "string" && ((t as Record<string, unknown>).term as string).trim().length > 0,
          );
        }
      }
    } catch {
      glossaryTerms = [];
    }
    const currentState = options?.truthFileOverrides?.currentState ?? diskCurrentState;
    const ledger = options?.truthFileOverrides?.ledger ?? diskLedger;
    const hooks = options?.truthFileOverrides?.hooks ?? diskHooks;

    const hasParentCanon = parentCanon !== "(文件不存在)";
    const hasFanficCanon = fanficCanon !== "(文件不存在)";

    // Load last chapter full text for fine-grained continuity checking
    const previousChapter = await this.loadPreviousChapter(bookDir, chapterNumber);

    // Load genre profile and book rules
    const genreId = genre ?? "other";
    const [{ profile: gp }, bookLanguage] = await Promise.all([
      readGenreProfile(this.ctx.projectRoot, genreId),
      readBookLanguage(bookDir),
    ]);
    const parsedRules = await readBookRules(bookDir);
    const bookRules = parsedRules?.rules ?? null;

    // Fallback: use book_rules body when style_guide.md doesn't exist.
    // Phase 5 hotfix 2: parsedRules.body is only populated for legacy
    // book_rules.md sources — story_frame.md frontmatter yields an empty
    // body, and an empty string is NOT a usable style guide. Treat
    // missing/empty body as "no fallback available".
    const legacyRulesBody = parsedRules?.body?.trim();
    const styleGuide = styleGuideRaw !== "(文件不存在)"
      ? styleGuideRaw
      : (legacyRulesBody || "(无文风指南)");

    const resolvedLanguage = bookLanguage ?? gp.language;
    const isEnglish = resolvedLanguage === "en";
    const fanficMode = hasFanficCanon ? (bookRules?.fanficMode as FanficMode | undefined) : undefined;
    const dimensions = buildDimensionList(gp, bookRules, resolvedLanguage, hasParentCanon, fanficMode);
    const dimList = dimensions
      .map((d) => `${d.id}. ${d.name}${d.note ? (isEnglish ? ` (${d.note})` : `（${d.note}）`) : ""}`)
      .join("\n");
    const genreLabel = resolveGenreLabel(genreId, gp.name, resolvedLanguage);

    const protagonistBlock = bookRules?.protagonist
      ? isEnglish
        ? `\n\nProtagonist lock: ${bookRules.protagonist.name}; personality locks: ${joinLocalized(bookRules.protagonist.personalityLock, resolvedLanguage)}; behavioral constraints: ${joinLocalized(bookRules.protagonist.behavioralConstraints, resolvedLanguage)}.`
        : `\n主角人设锁定：${bookRules.protagonist.name}，${bookRules.protagonist.personalityLock.join("、")}，行为约束：${bookRules.protagonist.behavioralConstraints.join("、")}`
      : "";

    const searchNote = gp.eraResearch
      ? isEnglish
        ? "\n\nYou have web-search capability (search_web / fetch_url). For real-world eras, people, events, geography, or policies, you must verify with search_web instead of relying on memory. Cross-check at least 2 sources."
        : "\n\n你有联网搜索能力（search_web / fetch_url）。对于涉及真实年代、人物、事件、地理、政策的内容，你必须用search_web核实，不可凭记忆判断。至少对比2个来源交叉验证。"
      : "";

    // Jargon-decode audit: feed the registered glossary into the prompt so
    // the reviewer (LLM, not JS NLP) flags any registered term that appears
    // in the chapter without a reader-facing decode.
    const glossaryListZh = glossaryTerms
      .map((t) => `- ${t.term}（首次出现第${t.firstSeenChapter ?? "?"}章，最近解码第${t.lastDecodedAtChapter ?? "无"}章）`)
      .join("\n");
    const glossaryListEn = glossaryTerms
      .map((t) => `- ${t.term} (first seen ch.${t.firstSeenChapter ?? "?"}, last decoded ch.${t.lastDecodedAtChapter ?? "none"})`)
      .join("\n");
    const glossaryAuditBlock = glossaryTerms.length === 0
      ? ""
      : isEnglish
        ? `\n\n## Registered Glossary (jargon-decode audit)
Below is the registered list of domain jargon / proper nouns and when each was last decoded for the reader:
${glossaryListEn}
If any of these terms appears in the chapter under review WITHOUT any reader-facing decode (the POV character living it, dialogue, inner monologue, sensory grounding, or self-evident context — ideally surfaced through the POV character's senses or speech rather than omniscient narration), you MUST emit an issue with severity at least "warning", category exactly "Reader Clarity", whose description names the specific term and labels it "jargon used without a decode line for the reader", and whose suggestion points to a lightweight one-line decode or recall to add. If a term debuts here and is piled on with no decode at all, lean toward warning/critical. Do NOT re-flag a term that was already decoded earlier — but if it was last decoded long ago and is used heavily this chapter, you may suggest a one-line recall. If the glossary is empty or none of the registered terms appear in this chapter, do NOT fabricate such an issue.`
        : `\n\n## 已登记术语表（黑话未解码审查）
下面是已登记的专有名词/术语表，以及每个术语最近一次面向读者解码的章节：
${glossaryListZh}
给定上面这份"已登记专有名词/术语表"。如果本章正文出现了其中的术语，却没有任何面向读者的解码（角色亲历/对话/内心独白/感官落地/上下文自明——且解码最好经由 POV 角色的感官或言语带出，而非全知旁白直接解释），就必须报一条 severity 至少为 warning 的【读者清晰度】issue，category 写"读者清晰度"，description 里点名是哪个术语、属于"黑话出场无解码线"，suggestion 给出补一句轻量解码/回想的方向。若术语首次出现就堆砌且无解码，更应判 warning/critical。不要因为术语已在前文解码过就重复报（但如果距上次解码很久、本章重度使用，可提示补一句回想）。如果术语表为空或本章未出现任何登记术语，不要捏造此类 issue。`;

    const systemPrompt = isEnglish
      ? `You are a strict ${genreLabel} web-fiction structural editor. Audit the chapter for completion and structure, not for prose craft. ALL OUTPUT MUST BE IN ENGLISH.${protagonistBlock}${searchNote}

## Reviewer Scope (hard constraints)

You audit completion and structure only. Your job is to decide whether the chapter delivers the plan, keeps characters and timelines intact, and moves the book forward. Wording, sentence rhythm, paragraph shape, punctuation, imagery, and other prose-surface choices are NOT yours — those belong to the Polisher pass that runs after you. If you notice prose-surface issues, you may flag them with severity "info" so the Polisher can see them, but they do not count toward passed / overall_score and they must never be critical. **Reader clarity is the exception because it is structural**: if the current scene, visible character intent, action object, or immediate stakes are unreadable, score it under Reader Clarity / structural completion, not prose polish.

You audit twelve structural reader-pain patterns: dragging / flat openings, blurry worldbuilding disconnected from reality, contradictory character setup, tangled POV, mainline drift or stagnation, weak conflict with missing payoff, pacing loss of control and abrupt transitions, character inconsistency across the arc, thin/one-note characters without contrast, stiff emotion expression and abrupt relationship jumps, imbalanced cheats/power gifts, and settings that never land in concrete action. Alongside these, keep the engineering dimensions listed below (OOC, timeline coherence, information boundary, hook debt, cross-chapter repetition, lexical fatigue, length band, title fatigue, paragraph shape).

Sparse chapter_memo is legitimate. Breather / aftermath / transition chapters may ship a memo that only contains goal + a skeleton body — do NOT flag such memos as incomplete, and do NOT penalise the chapter for lacking content against sections the memo itself does not populate. Judge drift only against what the memo actually says.

If the chapter memo, rule stack, or supplied context specifies content proportions between lines (politics/romance, career/relationship, case/character, etc.), audit whether those lines appear as actual scenes, dialogue, action, or relationship movement. A line that is only summarized in one sentence counts as missing. Mark it critical only when the memo explicitly required it for this chapter.

If the chapter memo includes Active Cast, audit character usage against it. Characters marked offstage must not appear as direct actors; mentioned characters may only be referenced; silent characters must not receive direct quoted speech; channel_only characters may only appear through channel / remote text; no_direct_line characters must not have direct dialogue. Treat clear violations as warning by default, critical only when the memo explicitly made the permission a hard prohibition or the violation changes plot outcome.

Audit dimensions:
${dimList}

## Cross-Validation Rules
The following data has been injected into context. You MUST cross-check the chapter against them:
- Worldbuilding (story_frame): world rules, power systems, faction relations in the chapter must not contradict the worldbuilding prose
- Character Assets: equipment/items/resources mentioned must match the asset ledger
- Alliance State: faction relationship changes must match the alliance state
- Relationship Graph: character relationships must match; relationship shifts need foreshadowing
- Era Mood: scene atmosphere must align with era mood baseline
- War Resource Overview: war-related numbers (forces, territory, resources) must match ledgers
- Phase Outline: this chapter must advance the current phase's goals
Flag contradictions by severity (factual contradiction = warning/critical, minor drift = info). If a truth file is absent (placeholder), skip its cross-validation — do NOT fabricate issues.

For every issue, set repair_scope as a typed routing hint: "local" for wording, paragraph shape, small repetition, or narrow sentence-level fixes; "structural" for plot drift, timeline break, missing scene/payoff, character logic collapse, POV/knowledge boundary failure, or anything requiring a rewritten scene/chapter; "unknown" only when you genuinely cannot decide.

Output format MUST be JSON:
{
  "passed": true/false,
  "overall_score": 0-100,
  "issues": [
	    {
	      "severity": "critical|warning|info",
	      "repair_scope": "local|structural|unknown",
	      "category": "dimension name",
	      "description": "specific issue description",
	      "suggestion": "fix suggestion"
	    }
  ],
  "summary": "one-sentence audit conclusion"
}

passed is false ONLY when critical-severity issues exist.

overall_score calibration:
- 95-100: Publishable as-is, no noticeable issues
- 85-94: Minor blemishes but smooth reading, the reader won't break immersion
- 75-84: Noticeable problems but the story backbone holds, needs revision but not urgent
- 65-74: Multiple issues hurt the reading experience, pacing or continuity has gaps
- < 65: Structural breakdown, needs major rewrite
Score holistically — do not let a single minor issue tank the score.${glossaryAuditBlock}`
      : `你是一位严格的${gp.name}网络小说结构审稿编辑。你只审完成度 + 结构，不审文笔。${protagonistBlock}${searchNote}

## 审稿边界（硬约束）

你不审文笔、不审排版、不审句式——这些归 Polisher。你发现的文笔问题只能以 severity="info" 标注供 Polisher 参考，不计入 reviewer 的 passed/overall_score，也绝不可标为 critical。**读者清晰度例外，因为它属于结构完成度**：如果当前场景、人物可见意图、行动对象或即时风险读不懂，应按读者清晰度/结构完成度处理，不得降格成普通文笔建议。

你审 12 条结构类雷点：开篇拖沓/平淡、世界观模糊脱现实、人设矛盾、视角杂乱、主线偏离/停滞、冲突乏力爽点缺失、节奏失控过渡生硬、人设前后矛盾、人物单薄无反差、情感表达生硬/关系突兀、金手指失衡、设定无落地。同时保留工程维度（OOC、timeline 一致、信息越界、hook-debt、跨章重复、词汇疲劳、章节字数、标题疲劳、段落形状）。

稀疏 memo 是合法状态。喘息章 / 后效章 / 过渡章的 memo 可以只有 goal + 骨架 body——此类 memo 不判 incomplete，也不能因为 memo 没写的段落就扣成稿的分。只按 memo 实际写出来的内容判偏离。

如果章节备忘、规则栈或输入上下文明确指定多条剧情线的比例（权谋/感情、事业/恋爱、案件/人物等），要审它们是否真正落成了场景、对话、行动或关系变化。只用一句总结带过的线，视为缺失。只有当 memo 明确要求本章必须推进该线时，才标 critical。

如果章节备忘包含"本章出场人物"，必须审查正文是否遵守 active cast：offstage 不得作为实体行动者出现；mentioned 只能被提及；silent 不得有直接引号台词；channel_only 只能通过频道/远端文本出现；no_direct_line 不得有直接台词。默认标 warning；只有当 memo 明确写成硬禁令，或违规改变剧情结果时，才标 critical。

审查维度：
${dimList}

## 交叉验证规则
以下数据已注入上下文，你必须将正文与它们交叉验证：
- 世界观设定（story_frame）：正文中的世界规则、能力体系、阵营关系不得与之矛盾
- 角色资产：正文提及的装备/道具/资源必须与角色资产账本一致
- 联盟状态：阵营关系变化必须与联盟状态一致
- 关系图谱：角色间的关系描述必须与关系图一致，关系变调必须有铺垫
- 时代情绪：场景氛围必须与时代情绪基调吻合
- 战争资源总览：战争相关数字（兵力、领土、资源）必须与账本一致
- 阶段纲：本章必须推进当前阶段的目标
发现矛盾时，按 severity 标注（事实性矛盾=warning/critical，轻微偏差=info）。如果某个 truth 文件不存在（占位符），跳过该项交叉验证——不要捏造 issue。

每条 issue 必须给 repair_scope 作为 typed 路由提示："local" 表示措辞、段落形状、小重复、句段级小修；"structural" 表示主线偏离、时间线断裂、场面/回报缺失、人物逻辑崩、视角/信息边界失败，或任何需要重写场景/整章的问题；只有确实无法判断时才写 "unknown"。

输出格式必须为 JSON：
{
  "passed": true/false,
  "overall_score": 0-100,
  "issues": [
	    {
	      "severity": "critical|warning|info",
	      "repair_scope": "local|structural|unknown",
	      "category": "审查维度名称",
	      "description": "具体问题描述",
	      "suggestion": "修改建议"
	    }
  ],
  "summary": "一句话总结审查结论"
}

只有当存在 critical 级别问题时，passed 才为 false。

overall_score 评分校准：
- 95-100：可直接发布，无明显问题
- 85-94：有小瑕疵但整体流畅可读，读者不会出戏
- 75-84：有明显问题但故事主干完整，需要修但不紧急
- 65-74：多处影响阅读体验的问题，节奏或连续性有断裂
- < 65：结构性问题，需要大幅重写
综合评分，不要因为单一小问题大幅拉低分数。${glossaryAuditBlock}`;

    const ledgerBlock = gp.numericalSystem
      ? isEnglish
        ? `\n## Resource Ledger\n${ledger}`
        : `\n## 资源账本\n${ledger}`
      : "";

    // Smart context filtering for auditor — same logic as writer
    const bookRulesForFilter = parsedRules?.rules ?? null;
    const filteredSubplots = filterSubplots(subplotBoard);
    const filteredArcs = filterEmotionalArcs(emotionalArcs, chapterNumber);
    const filteredMatrix = filterCharacterMatrix(characterMatrix, volumeOutline, bookRulesForFilter?.protagonist?.name);
    const filteredSummaries = filterSummaries(chapterSummaries, chapterNumber);
    const filteredHooks = filterHooks(hooks);

    const governedMemoryBlocks = options?.contextPackage
      ? buildGovernedMemoryEvidenceBlocks(options.contextPackage, resolvedLanguage)
      : undefined;

    const hooksBlock = governedMemoryBlocks?.hooksBlock
      ?? (filteredHooks !== "(文件不存在)"
        ? isEnglish
          ? `\n## Pending Hooks\n${filteredHooks}\n`
          : `\n## 伏笔池\n${filteredHooks}\n`
        : "");
    const subplotBlock = filteredSubplots !== "(文件不存在)"
      ? isEnglish
        ? `\n## Subplot Board\n${filteredSubplots}\n`
        : `\n## 支线进度板\n${filteredSubplots}\n`
      : "";
    const emotionalBlock = filteredArcs !== "(文件不存在)"
      ? isEnglish
        ? `\n## Emotional Arcs\n${filteredArcs}\n`
        : `\n## 情感弧线\n${filteredArcs}\n`
      : "";
    const matrixBlock = filteredMatrix !== "(文件不存在)"
      ? isEnglish
        ? `\n## Character Interaction Matrix\n${filteredMatrix}\n`
        : `\n## 角色交互矩阵\n${filteredMatrix}\n`
      : "";
    const summariesBlock = governedMemoryBlocks?.summariesBlock
      ?? (filteredSummaries !== "(文件不存在)"
        ? isEnglish
          ? `\n## Chapter Summaries (for pacing checks)\n${filteredSummaries}\n`
          : `\n## 章节摘要（用于节奏检查）\n${filteredSummaries}\n`
        : "");
    const volumeSummariesBlock = governedMemoryBlocks?.volumeSummariesBlock ?? "";

    const canonBlock = hasParentCanon
      ? isEnglish
        ? `\n## Mainline Canon Reference (for spinoff audit)\n${parentCanon}\n`
        : `\n## 正传正典参照（番外审查专用）\n${parentCanon}\n`
      : "";

    const fanficCanonBlock = hasFanficCanon
      ? isEnglish
        ? `\n## Fanfic Canon Reference (for fanfic audit)\n${fanficCanon}\n`
        : `\n## 同人正典参照（同人审查专用）\n${fanficCanon}\n`
      : "";

    const memoBlock = options?.chapterMemo
      ? isEnglish
        ? `\n## Chapter Memo (for memo drift checks)\nGoal: ${options.chapterMemo.goal}\n\n${options.chapterMemo.body}\n`
        : `\n## 章节备忘（用于 memo 偏离检测）\ngoal：${options.chapterMemo.goal}\n\n${options.chapterMemo.body}\n`
      : "";
    const reducedControlBlock = options?.chapterIntent && options.contextPackage && options.ruleStack
      ? this.buildReducedControlBlock(options.chapterIntent, options.contextPackage, options.ruleStack, resolvedLanguage)
      : "";
    const styleGuideBlock = reducedControlBlock.length === 0
      ? isEnglish
        ? `\n## Style Guide\n${styleGuide}`
        : `\n## 文风指南\n${styleGuide}`
      : "";

    const prevChapterBlock = previousChapter
      ? isEnglish
        ? `\n## Previous Chapter Full Text (for transition checks)\n${previousChapter}\n`
        : `\n## 上一章全文（用于衔接检查）\n${previousChapter}\n`
      : "";

    // Cross-validation blocks: worldbuilding, assets, alliances, relationships, era, war, phase
    const bibleBlock = storyBible !== "(文件不存在)"
      ? isEnglish
        ? `\n## Worldbuilding (Story Frame)\n${storyBible}\n`
        : `\n## 世界观设定\n${storyBible}\n`
      : "";
    const assetsBlock = characterAssets !== "(文件不存在)"
      ? isEnglish
        ? `\n## Character Assets\n${characterAssets}\n`
        : `\n## 角色资产\n${characterAssets}\n`
      : "";
    const allianceBlock = allianceState !== "(文件不存在)"
      ? isEnglish
        ? `\n## Alliance State\n${allianceState}\n`
        : `\n## 联盟状态\n${allianceState}\n`
      : "";
    const relationshipBlock = relationshipGraph !== "(文件不存在)"
      ? isEnglish
        ? `\n## Relationship Graph\n${relationshipGraph}\n`
        : `\n## 关系图谱\n${relationshipGraph}\n`
      : "";
    const eraMoodBlock = eraMood !== "(文件不存在)"
      ? isEnglish
        ? `\n## Era Mood\n${eraMood}\n`
        : `\n## 时代情绪\n${eraMood}\n`
      : "";
    const warResourceSummary = composeWarResourceSummary(warLedgers, resolvedLanguage);
    const warLedgerBlock = warResourceSummary.trim().length > 0
      ? isEnglish
        ? `\n## War Resource Overview\n${warResourceSummary}\n`
        : `\n## 战争资源总览\n${warResourceSummary}\n`
      : "";
    const phaseBlock = phaseOutlineRaw !== "(文件不存在)"
      ? isEnglish
        ? `\n## Phase Outline\n${phaseOutlineRaw}\n`
        : `\n## 阶段纲\n${phaseOutlineRaw}\n`
      : "";

    const userPrompt = isEnglish
      ? `Review chapter ${chapterNumber}.

## Current State Card
${currentState}
${ledgerBlock}
${hooksBlock}${volumeSummariesBlock}${subplotBlock}${emotionalBlock}${matrixBlock}${summariesBlock}${bibleBlock}${assetsBlock}${allianceBlock}${relationshipBlock}${eraMoodBlock}${warLedgerBlock}${phaseBlock}${canonBlock}${fanficCanonBlock}${reducedControlBlock}${memoBlock}${prevChapterBlock}${styleGuideBlock}

## Chapter Content Under Review
${chapterContent}`
      : `请审查第${chapterNumber}章。

## 当前状态卡
${currentState}
${ledgerBlock}
${hooksBlock}${volumeSummariesBlock}${subplotBlock}${emotionalBlock}${matrixBlock}${summariesBlock}${bibleBlock}${assetsBlock}${allianceBlock}${relationshipBlock}${eraMoodBlock}${warLedgerBlock}${phaseBlock}${canonBlock}${fanficCanonBlock}${reducedControlBlock}${memoBlock}${prevChapterBlock}${styleGuideBlock}

## 待审章节内容
${chapterContent}`;

    const chatMessages = [
      { role: "system" as const, content: systemPrompt },
      { role: "user" as const, content: userPrompt },
    ];
    const chatOptions = { temperature: options?.temperature ?? 0.3 };

    // Use web search for fact verification when eraResearch is enabled
    const response = gp.eraResearch
      ? await this.chatWithSearch(chatMessages, chatOptions)
      : await this.chat(chatMessages, chatOptions);

    const result = this.parseAuditResult(response.content, resolvedLanguage);
    return { ...result, tokenUsage: response.usage };
  }

  private parseAuditResult(content: string, language: PromptLanguage): AuditResult {
    // Try multiple JSON extraction strategies (handles small/local models)

    // Strategy 1: Find balanced JSON object (not greedy)
    const balanced = this.extractBalancedJson(content);
    if (balanced) {
      const result = this.tryParseAuditJson(balanced, language);
      if (result) return result;
    }

    // Strategy 2: Try the whole content as JSON (some models output pure JSON)
    const trimmed = content.trim();
    if (trimmed.startsWith("{")) {
      const result = this.tryParseAuditJson(trimmed, language);
      if (result) return result;
    }

    // Strategy 3: Look for ```json code blocks
    const codeBlockMatch = content.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (codeBlockMatch) {
      const result = this.tryParseAuditJson(codeBlockMatch[1]!.trim(), language);
      if (result) return result;
    }

    // Strategy 4: Try to extract individual fields via regex (last resort fallback)
    const passedMatch = content.match(/"passed"\s*:\s*(true|false)/);
    const issuesMatch = content.match(/"issues"\s*:\s*\[([\s\S]*?)\]/);
    const summaryMatch = content.match(/"summary"\s*:\s*"([^"]*)"/);
    if (passedMatch) {
      const issues: AuditIssue[] = [];
      if (issuesMatch) {
        // Try to parse individual issue objects
        const issuePattern = /\{[^{}]*"severity"\s*:\s*"[^"]*"[^{}]*\}/g;
        let match: RegExpExecArray | null;
        while ((match = issuePattern.exec(issuesMatch[1]!)) !== null) {
          try {
            const issue = JSON.parse(match[0]);
	            issues.push({
	              severity: issue.severity ?? "warning",
	              category: issue.category ?? (language === "en" ? "Uncategorized" : "未分类"),
	              description: issue.description ?? "",
	              suggestion: issue.suggestion ?? "",
	              repairScope: normalizeRepairScope(issue.repair_scope ?? issue.repairScope),
	            });
          } catch {
            // skip malformed individual issue
          }
        }
      }
      return {
        passed: passedMatch[1] === "true",
        issues,
        summary: summaryMatch?.[1] ?? "",
      };
    }

    return {
      passed: false,
      parseFailed: true,
      issues: [{
        severity: "critical",
        category: language === "en" ? "System Error" : "系统错误",
        description: language === "en"
          ? "Audit output format was invalid and could not be parsed as JSON."
          : "审稿输出格式异常，无法解析为 JSON",
        suggestion: language === "en"
          ? "The model may not support reliable structured output. Try a stronger model or inspect the API response format."
          : "可能是模型不支持结构化输出。尝试换一个更大的模型，或检查 API 返回格式。",
      }],
      summary: language === "en" ? "Audit output parsing failed" : "审稿输出解析失败",
    };
  }

  private buildReducedControlBlock(
    chapterIntent: string,
    contextPackage: ContextPackage,
    ruleStack: RuleStack,
    language: PromptLanguage,
  ): string {
    const selectedContext = contextPackage.selectedContext
      .map((entry) => `- ${entry.source}: ${entry.reason}${entry.excerpt ? ` | ${entry.excerpt}` : ""}`)
      .join("\n");
    const overrides = ruleStack.activeOverrides.length > 0
      ? ruleStack.activeOverrides
        .map((override) => `- ${override.from} -> ${override.to}: ${override.reason} (${override.target})`)
        .join("\n")
      : "- none";

    return language === "en"
      ? `\n## Chapter Control Inputs (compiled by Planner/Composer)
${chapterIntent}

### Selected Context
${selectedContext || "- none"}

### Rule Stack
- Hard guardrails: ${ruleStack.sections.hard.join(", ") || "(none)"}
- Soft constraints: ${ruleStack.sections.soft.join(", ") || "(none)"}
- Diagnostic rules: ${ruleStack.sections.diagnostic.join(", ") || "(none)"}

### Active Overrides
${overrides}\n`
      : `\n## 本章控制输入（由 Planner/Composer 编译）
${chapterIntent}

### 已选上下文
${selectedContext || "- none"}

### 规则栈
- 硬护栏：${ruleStack.sections.hard.join("、") || "(无)"}
- 软约束：${ruleStack.sections.soft.join("、") || "(无)"}
- 诊断规则：${ruleStack.sections.diagnostic.join("、") || "(无)"}

### 当前覆盖
${overrides}\n`;
  }

  private extractBalancedJson(text: string): string | null {
    const start = text.indexOf("{");
    if (start === -1) return null;
    let depth = 0;
    for (let i = start; i < text.length; i++) {
      if (text[i] === "{") depth++;
      if (text[i] === "}") depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
    return null;
  }

  private tryParseAuditJson(json: string, language: PromptLanguage = "zh"): AuditResult | null {
    try {
      const parsed = JSON.parse(json);
      if (typeof parsed.passed !== "boolean" && parsed.passed !== undefined) return null;
      const rawScore = parsed.overall_score ?? parsed.overallScore;
      const overallScore = typeof rawScore === "number" && Number.isFinite(rawScore)
        ? Math.round(Math.max(0, Math.min(100, rawScore)))
        : undefined;
      return {
        passed: Boolean(parsed.passed ?? false),
        issues: Array.isArray(parsed.issues)
	          ? parsed.issues.map((i: Record<string, unknown>) => ({
	              severity: (i.severity as string) ?? "warning",
	              category: (i.category as string) ?? (language === "en" ? "Uncategorized" : "未分类"),
	              description: (i.description as string) ?? "",
	              suggestion: (i.suggestion as string) ?? "",
	              repairScope: normalizeRepairScope(i.repair_scope ?? i.repairScope),
	            }))
          : [],
        summary: String(parsed.summary ?? ""),
        overallScore,
      };
    } catch {
      return null;
    }
  }

  private async loadPreviousChapter(bookDir: string, currentChapter: number): Promise<string> {
    if (currentChapter <= 1) return "";
    const chaptersDir = join(bookDir, "chapters");
    try {
      const files = await readdir(chaptersDir);
      const paddedPrev = String(currentChapter - 1).padStart(4, "0");
      const prevFile = files.find((f) => f.startsWith(paddedPrev) && f.endsWith(".md"));
      if (!prevFile) return "";
      return await readFile(join(chaptersDir, prevFile), "utf-8");
    } catch {
      return "";
    }
  }

  private async readFileSafe(path: string): Promise<string> {
    try {
      return await readFile(path, "utf-8");
    } catch {
      return "(文件不存在)";
    }
  }
}
