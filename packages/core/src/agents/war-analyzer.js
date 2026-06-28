import { BaseAgent } from "./base.js";
import { readGenreProfile, readBookRules } from "./rules-reader.js";
import { parseWriterOutput } from "./writer-parser.js";
import { countChapterLength, resolveLengthCountingMode } from "../utils/length-metrics.js";
import { readStoryFrame, readVolumeMap } from "../utils/outline-paths.js";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const WAR_LEDGER_FILES = [
    "military_forces.md",
    "war_theater.md",
    "battle_log.md",
    "territory_control.md",
    "epoch_timeline.md",
    "naval_forces.md",
    "dynasty_tree.md",
    "treasury_state.md",
];

const WAR_TAGS = [
    "UPDATED_MILITARY_FORCES",
    "UPDATED_WAR_THEATER",
    "UPDATED_BATTLE_LOG",
    "UPDATED_TERRITORY_CONTROL",
    "UPDATED_EPOCH_TIMELINE",
    "UPDATED_NAVAL_FORCES",
    "UPDATED_DYNASTY_TREE",
    "UPDATED_TREASURY_STATE",
];

export class WarAnalyzerAgent extends BaseAgent {
    get name() {
        return "war-analyzer";
    }

    async analyzeWarChapter(input) {
        const { book, bookDir, chapterNumber, chapterContent, chapterTitle } = input;
        const { profile: genreProfile, body: genreBody } = await readGenreProfile(this.ctx.projectRoot, book.genre);
        const resolvedLanguage = book.language ?? genreProfile.language;
        const placeholder = this.missingFilePlaceholder(resolvedLanguage);

        const storyDir = join(bookDir, "story");
        const [storyBible, volumeOutline, bookRulesRaw, ...warFiles] = await Promise.all([
            readStoryFrame(bookDir, placeholder),
            readVolumeMap(bookDir, placeholder),
            readFile(join(storyDir, "book_rules.md"), "utf-8").catch(() => ""),
            ...WAR_LEDGER_FILES.map(f => readFile(join(storyDir, f), "utf-8").catch(() => "")),
        ]);
        const parsedBookRules = await readBookRules(bookDir);
        const bookRulesBody = parsedBookRules?.body ?? "";

        const systemPrompt = this.buildWarSystemPrompt(book, genreProfile, genreBody, bookRulesBody, resolvedLanguage);
        const userPrompt = this.buildWarUserPrompt({
            language: resolvedLanguage,
            chapterNumber,
            chapterContent,
            chapterTitle,
            warFiles,
            storyBible,
            volumeOutline,
            placeholder,
        });

        const response = await this.chat([
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
        ], { temperature: 0.3 });

        const countingMode = resolveLengthCountingMode(book.language ?? genreProfile.language);
        const output = parseWriterOutput(chapterNumber, response.content, genreProfile, countingMode, {
            skipWarTags: false,
            skipCharacterTags: true,
        });

        // Extract only war-related fields
        const warOutput = {};
        for (const tag of WAR_TAGS) {
            const key = tagToField(tag);
            if (key) warOutput[key] = output[key] ?? "";
        }
        return warOutput;
    }

    buildWarSystemPrompt(book, genreProfile, genreBody, bookRulesBody, language) {
        if (language === "en") {
            return `【LANGUAGE OVERRIDE】ALL output MUST be in English. The === TAG === markers remain unchanged.

You are a war/conflict continuity analyst. Analyze a finished chapter and update the war-related tracking files ONLY.

## Working Mode

You are not writing new prose. You are reading completed chapter text and updating the book's war ledger files.
1. Read the chapter carefully and extract all war/conflict/territory/dynasty/treasury facts.
2. Update the existing tracking files incrementally rather than rebuilding them from scratch.
3. Leave EMPTY any section where no relevant event occurred — do NOT fabricate updates.
4. When a section DOES have relevant events, output a COMPLETE updated table (merge unchanged prior rows).

## Book Information

- Title: ${book.title}
- Genre: ${genreProfile.name} (${book.genre})
- Platform: ${book.platform}

## Genre Guidance

${genreBody}

${bookRulesBody ? `## Book Rules\n\n${bookRulesBody}` : ""}

## Output Format

Use === TAG === delimiters exactly as shown. Output ONLY these tags — no others:

=== UPDATED_MILITARY_FORCES ===
(Troop registry. Output as Markdown table under heading "## Military Forces". Update every force that mobilized, marched, fought, lost troops, or changed commander this chapter. Leave EMPTY if no military force changed this chapter.)
| force_id | faction | commander | troop_count | unit_composition | morale | supplies | location | status | last_updated_chapter | notes |
- status: mobilized / deployed / garrison / routed / disbanded
- troop_count must reflect post-chapter strength after casualties.

=== UPDATED_WAR_THEATER ===
(Active wars. Output as Markdown table under heading "## War Theaters". Add a row when a new war breaks out; update existing row's front_line/status/last_updated_chapter when the war evolves. Leave EMPTY if no war changed.)
| theater_id | war_name | belligerents | start_chapter | front_line | strategic_objective | scale | status | outcome | last_updated_chapter | notes |
- scale: skirmish / campaign / total_war
- status: active / stalemate / concluded / ceasefire

=== UPDATED_BATTLE_LOG ===
(Per-chapter battles. Output as Markdown table under heading "## Battle Log". Add ONE row per battle that actually occurred in this chapter. Leave EMPTY if no battle occurred.)
| battle_id | chapter | theater_id | battle_name | belligerents | commanders | forces_engaged | terrain | outcome | casualties_attacker | casualties_defender | strategic_shift | notes |
- outcome: A_decisive / A_pyrrhic / B_decisive / B_pyrrhic / stalemate / A_retreat / B_retreat
- strategic_shift is mandatory — one sentence on what changed strategically.

=== UPDATED_TERRITORY_CONTROL ===
(Region/city/fort control. Output as Markdown table under heading "## Territory Control". Update controller and timeline whenever a territory changes hands. Leave EMPTY if no territory changed hands.)
| territory_id | name | type | controller | contested_by | strategic_value | control_since_chapter | garrison_force | notes |
- type: city / fort / pass / mine / port / region / capital
- notes supports timeline: \`text | timeline: ch.N: oldController→newController\`

=== UPDATED_EPOCH_TIMELINE ===
(Dynastic / era phase segmentation for long-span sagas. Output as Markdown table under heading "## Epoch Timeline". Add a NEW row only when a phase ends or a fundamentally new phase begins (dynasty falls, succession crisis ends, peace treaty signed, total war declared). Otherwise leave EMPTY. When closing an old phase, set its end_chapter to the chapter where the phase ended.)
| epoch_id | phase_name | start_chapter | end_chapter | dominant_powers | key_event | era_mood_snapshot | notes |
- dominant_powers: comma-separated faction names that defined this phase.
- key_event: the single event that closed the previous phase OR opened this one.
- end_chapter is empty for the currently active phase.

=== UPDATED_NAVAL_FORCES ===
(Fleet registry — only relevant when a sea power exists. Output as Markdown table under heading "## Naval Forces". Update every fleet that sailed, fought at sea, lost ships, blockaded a port, or changed admiral this chapter. Leave EMPTY if no naval activity occurred.)
| fleet_id | faction | admiral | ship_count | ship_types | naval_supremacy | morale | home_port | status | last_updated_chapter | notes |
- ship_types: free text, e.g. "triremes 80, quinqueremes 30, transports 50".
- naval_supremacy: 0-100 integer estimating control over the relevant sea.
- status: docked / patrolling / besieging / engaged / scattered / destroyed / disbanded.

=== UPDATED_DYNASTY_TREE ===
(Generational lineage — only update when a birth, marriage, death, succession, or regency event happened this chapter. Output as Markdown table under heading "## Dynasty Tree". Leave EMPTY otherwise.)
| person_id | display_name | generation | parents | spouse | inherited_from | inheritance_order | regency_for | successor | title | lifespan_chapters | notes |
- generation: integer, founder = 1.
- inheritance_order: integer rank among siblings for succession; leave empty if not applicable.
- regency_for: person_id of the underage / absent monarch this person rules on behalf of.
- lifespan_chapters: "start-end" range of chapters in which this person is alive.

=== UPDATED_TREASURY_STATE ===
(Per-faction finances. Output as Markdown table under heading "## Treasury State". Update a row whenever a faction collects tribute, pays mercenaries, loses tax base, or suffers war reparations. Leave EMPTY if no financial change occurred.)
| faction | gold | grain | mercenary_budget | income_per_chapter | last_updated_chapter | notes |
- All numeric fields are integers; use 0 explicitly when known to be empty.

## Rules

1. Leave EMPTY when the chapter contains no relevant event — do NOT fabricate updates.
2. When the chapter DOES contain a relevant event, output a COMPLETE updated table (not just the changed row), merging in all unchanged prior rows from the "Current X" block in the user prompt.
3. troop_count must reflect post-chapter strength after casualties.
4. strategic_shift in battle_log is mandatory.`;
        }

        return `你是战争/冲突连续性分析师。你的任务是分析一章已完成的小说正文，**只**更新战争相关的追踪文件。

## 工作模式

你不是在写作，而是在分析已有正文。你需要：
1. 仔细阅读正文，提取所有战争/冲突/领土/王朝/财政相关事实
2. 基于"当前追踪文件"做增量更新
3. 本章无相关事件的账本**留空**，禁止编造
4. 有相关事件时，输出**完整**更新后的表格（合并未变化的旧行）

## 书本信息

- 书名：${book.title}
- 类型：${genreProfile.name} (${book.genre})
- 平台：${book.platform}

## 类型指导

${genreBody}

${bookRulesBody ? `## 书本规则\n\n${bookRulesBody}` : ""}

## 输出格式

使用 === TAG === 分隔符。**只**输出以下标签，不要输出其他标签：

=== UPDATED_MILITARY_FORCES ===
（兵力账本。Markdown 表格，标题 "## Military Forces"。本章任何部队动员/行军/参战/损兵/换帅都必须更新该行。本章无军事行动则**留空**）
| force_id | faction | commander | troop_count | unit_composition | morale | supplies | location | status | last_updated_chapter | notes |
- status：mobilized(动员)/deployed(出征)/garrison(驻防)/routed(溃散)/disbanded(解散)
- troop_count 必须反映扣除本章伤亡后的兵力

=== UPDATED_WAR_THEATER ===
（战场账本。Markdown 表格，标题 "## War Theaters"。新战争开启时新增行；已有战争演化时更新 front_line/status/last_updated_chapter。本章无战争变化则**留空**）
| theater_id | war_name | belligerents | start_chapter | front_line | strategic_objective | scale | status | outcome | last_updated_chapter | notes |
- scale：skirmish(冲突)/campaign(战役级)/total_war(全面战争)
- status：active/stalemate/concluded/ceasefire

=== UPDATED_BATTLE_LOG ===
（战役日志。Markdown 表格，标题 "## Battle Log"。本章发生的每场战役各占一行。本章无战役则**留空**）
| battle_id | chapter | theater_id | battle_name | belligerents | commanders | forces_engaged | terrain | outcome | casualties_attacker | casualties_defender | strategic_shift | notes |
- outcome：A_decisive/A_pyrrhic/B_decisive/B_pyrrhic/stalemate/A_retreat/B_retreat
- strategic_shift **必填**——一句话总结战略影响

=== UPDATED_TERRITORY_CONTROL ===
（领土控制。Markdown 表格，标题 "## Territory Control"。任何地盘易手时更新 controller 与 notes 中的 timeline。本章无地盘变化则**留空**）
| territory_id | name | type | controller | contested_by | strategic_value | control_since_chapter | garrison_force | notes |
- type：city(城)/fort(要塞)/pass(关)/mine(矿)/port(港)/region(区域)/capital(首都)
- notes 支持 timeline：\`描述 | timeline: ch.N: 旧方→新方\`

=== UPDATED_EPOCH_TIMELINE ===
（纪元时间线。Markdown 表格，标题 "## Epoch Timeline"。**只有**当一个阶段终结或一个根本性新阶段开启时（如王朝崩溃、继承危机结束、和约签订、宣告全面战争）才新增一行；否则**留空**。关闭旧阶段时，把它的 end_chapter 设为该阶段结束的章节号）
| epoch_id | phase_name | start_chapter | end_chapter | dominant_powers | key_event | era_mood_snapshot | notes |
- dominant_powers：以逗号分隔，列出主导该阶段的派系
- key_event：关闭上一阶段或开启本阶段的标志性单一事件
- 当前正在进行的阶段 end_chapter **留空**

=== UPDATED_NAVAL_FORCES ===
（舰队账本——只在世界中存在海权时启用。Markdown 表格，标题 "## Naval Forces"。本章出海、海战、损舰、封港、更换提督的每支舰队都要更新行。本章无海上活动则**留空**）
| fleet_id | faction | admiral | ship_count | ship_types | naval_supremacy | morale | home_port | status | last_updated_chapter | notes |
- ship_types：自由文本，例如"三桡战船80, 五桡战船30, 运输船50"
- naval_supremacy：0-100 整数，对相关海域的制海权估值
- status：docked(停泊)/patrolling(巡弋)/besieging(围港)/engaged(交战)/scattered(溃散)/destroyed(覆灭)/disbanded(解散)

=== UPDATED_DYNASTY_TREE ===
（王朝谱系——只在本章发生出生、婚姻、死亡、继位、摄政事件时更新。Markdown 表格，标题 "## Dynasty Tree"。否则**留空**）
| person_id | display_name | generation | parents | spouse | inherited_from | inheritance_order | regency_for | successor | title | lifespan_chapters | notes |
- generation：整数，开朝祖先为 1
- inheritance_order：兄弟姐妹之间的继承顺位整数；不适用则留空
- regency_for：被摄政者的 person_id（年幼/缺席君主）
- lifespan_chapters：该人存活的章节范围"起-止"

=== UPDATED_TREASURY_STATE ===
（派系财政状态。Markdown 表格，标题 "## Treasury State"。任何派系收取贡赋、支付雇佣兵、丢失税基、承担战争赔款时更新对应行。本章无财政变化则**留空**）
| faction | gold | grain | mercenary_budget | income_per_chapter | last_updated_chapter | notes |
- 所有数值字段为整数；已知为空时显式填 0

## 关键规则

1. 本章无相关事件时**留空**，禁止编造
2. 本章**有**相关事件时，输出**完整**更新后的表格（不是只输出变化行），合并 user prompt 中"当前 X"块里所有未变化的旧行
3. troop_count 必须反映扣除本章伤亡后的兵力
4. battle_log 的 strategic_shift **必填**`;
    }

    buildWarUserPrompt(params) {
        const { language, chapterNumber, chapterContent, chapterTitle, warFiles, storyBible, volumeOutline, placeholder } = params;
        const [
            militaryForces, warTheater,
            battleLog, territoryControl, epochTimeline, navalForces,
            dynastyTree, treasuryState,
        ] = warFiles;

        const titleLine = chapterTitle
            ? (language === "en" ? `Chapter Title: ${chapterTitle}\n` : `章节标题：${chapterTitle}\n`)
            : "";

        const block = (content, enHeading, zhHeading) => {
            if (!content || content === placeholder) return "";
            return language === "en"
                ? `\n## Current ${enHeading}\n${content}\n`
                : `\n## 当前${zhHeading}\n${content}\n`;
        };

        const bibleBlock = storyBible !== placeholder
            ? (language === "en" ? `\n## Story Bible\n${storyBible}\n` : `\n## 世界观设定\n${storyBible}\n`)
            : "";
        const outlineBlock = volumeOutline !== placeholder
            ? (language === "en" ? `\n## Volume Outline\n${volumeOutline}\n` : `\n## 卷纲\n${volumeOutline}\n`)
            : "";

        if (language === "en") {
            return `Analyze chapter ${chapterNumber} and update ONLY the war-related tracking files.
${titleLine}
## Chapter Content

${chapterContent}
${bibleBlock}${outlineBlock}
${block(militaryForces, "Military Forces", "兵力账本")}${block(warTheater, "War Theater", "战场账本")}${block(battleLog, "Battle Log", "战役日志")}${block(territoryControl, "Territory Control", "领土控制")}${block(epochTimeline, "Epoch Timeline", "纪元时间线")}${block(navalForces, "Naval Forces", "海军账本")}${block(dynastyTree, "Dynasty Tree", "王朝谱系")}${block(treasuryState, "Treasury State", "财政状态")}

Please return the result strictly in the === TAG === format. Output ONLY the war-related tags.`;
        }

        return `请分析第${chapterNumber}章正文，**只**更新战争相关的追踪文件。
${titleLine}
## 正文内容

${chapterContent}
${bibleBlock}${outlineBlock}
${block(militaryForces, "Military Forces", "兵力账本")}${block(warTheater, "War Theater", "战场账本")}${block(battleLog, "Battle Log", "战役日志")}${block(territoryControl, "Territory Control", "领土控制")}${block(epochTimeline, "Epoch Timeline", "纪元时间线")}${block(navalForces, "Naval Forces", "海军账本")}${block(dynastyTree, "Dynasty Tree", "王朝谱系")}${block(treasuryState, "Treasury State", "财政状态")}

请严格按照 === TAG === 格式输出。只输出战争相关标签。`;
    }
}

function tagToField(tag) {
    const map = {
        UPDATED_MILITARY_FORCES: "updatedMilitaryForces",
        UPDATED_WAR_THEATER: "updatedWarTheater",
        UPDATED_BATTLE_LOG: "updatedBattleLog",
        UPDATED_TERRITORY_CONTROL: "updatedTerritoryControl",
        UPDATED_EPOCH_TIMELINE: "updatedEpochTimeline",
        UPDATED_NAVAL_FORCES: "updatedNavalForces",
        UPDATED_DYNASTY_TREE: "updatedDynastyTree",
        UPDATED_TREASURY_STATE: "updatedTreasuryState",
    };
    return map[tag] ?? null;
}
