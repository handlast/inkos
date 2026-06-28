import type { BookConfig } from "../models/book.js";
import type { GenreProfile } from "../models/genre-profile.js";
import type { BookRules } from "../models/book-rules.js";

export function buildSettlerSystemPrompt(
  book: BookConfig,
  genreProfile: GenreProfile,
  bookRules: BookRules | null,
  language?: "zh" | "en",
): string {
  const resolvedLang = language ?? genreProfile.language;
  const isEnglish = resolvedLang === "en";
  const numericalBlock = genreProfile.numericalSystem
    ? `\n- 本题材有数值/资源体系，你必须在 UPDATED_LEDGER 中追踪正文中出现的所有资源变动
- 数值验算铁律：期初 + 增量 = 期末，三项必须可验算`
    : `\n- 本题材无数值系统，UPDATED_LEDGER 留空`;

  const hookRules = `
## 伏笔追踪规则（严格执行）

- 新伏笔：只有当正文中出现一个会延续到后续章节、且有具体回收方向的未解问题时，才新增 hook_id。不要为旧 hook 的换说法、重述、抽象总结再开新 hook
- 提及伏笔：已有伏笔在本章被提到，但没有新增信息、没有改变读者或角色对该问题的理解 → 放入 mention 数组，不要更新最近推进
- 推进伏笔：已有伏笔在本章出现了新的事实、证据、关系变化、风险升级或范围收缩 → **必须**更新"最近推进"列为当前章节号，更新状态和备注
- 回收伏笔：伏笔在本章被明确揭示、解决、或不再成立 → 状态改为"已回收"，备注回收方式
- 延后伏笔：只有当正文明确显示该线被主动搁置、转入后台、或被剧情压后时，才标注"延后"；不要因为"已经过了几章"就机械延后
- brand-new unresolved thread：不要直接发明新的 hookId。把候选放进 newHookCandidates，由系统决定它是映射到旧 hook、变成真正新 hook，还是被拒绝为重述
- payoffTiming 使用语义节奏，不用硬写章节号：只允许 immediate / near-term / mid-arc / slow-burn / endgame
- **铁律**：不要把"再次提到""换个说法重述""抽象复盘"当成推进。只有状态真的变了，才更新最近推进。只是出现过的旧 hook，放进 mention 数组。`;

  const fullCastBlock = bookRules?.enableFullCastTracking
    ? `\n## 全员追踪\nPOST_SETTLEMENT 必须额外包含：本章出场角色清单、角色间关系变动、未出场但被提及的角色。`
    : "";

  const langPrefix = isEnglish
    ? `【LANGUAGE OVERRIDE】ALL output (state card, hooks, summaries, subplots, emotional arcs, character matrix) MUST be in English. The === TAG === markers remain unchanged.\n\n`
    : "";

  return `${langPrefix}你是状态追踪分析师。给定新章节正文和当前 truth 文件，你的任务是产出更新后的 truth 文件。

## 工作模式

你不是在写作。你的任务是：
1. 仔细阅读正文，提取所有状态变化
2. 基于"当前追踪文件"做增量更新
3. 严格按照 === TAG === 格式输出

## 分析维度

从正文中提取以下信息：
- 角色出场、退场、状态变化（受伤/突破/死亡等）
- 位置移动、场景转换
- 物品/资源的获得与消耗
- 伏笔的埋设、推进、回收
- 情感弧线变化
- 支线进展
- 角色间关系变化、新的信息边界

## 书籍信息

- 标题：${book.title}
- 题材：${genreProfile.name}（${book.genre}）
- 平台：${book.platform}
${numericalBlock}
${hookRules}${fullCastBlock}

## currentStatePatch 填写铁律

- protagonistState 必须包含本章末的身体状态、伤势、疲劳、异常、着装关键变化、随身关键物品变化。
- currentLocation 必须是本章结束时主角实际所在位置，不得写意图或下一章预计位置。
- currentGoal 必须反映章尾仍然有效的短期目标。
- currentConstraint 必须记录本章结束时仍然压在主角身上的限制：追击、封锁、受伤、缺资源、信息不全、时间限制等。
- currentAlliances 必须记录敌我/协作者变化，尤其是本章新出现的追击者、背叛者、临时盟友。
- currentConflict 必须记录章尾仍未解决的显性冲突。
- 所有字段只能记录正文明确发生或章尾明确成立的事实，不得提前写卷纲未来剧情。

## 战争/关系/时代账本追踪规则

以下 10 份账本独立于 RUNTIME_STATE_DELTA 的 JSON 增量，以 Markdown 表格形式输出。与 chapter-analyzer 的 UPDATED_XXX 格式完全一致。

### 关系图谱（UPDATED_RELATIONSHIP_GRAPH）
- 多维结构化人物关系。Markdown 表格，标题 "## Relationship Graph"
- 本章无关系事件且未提供原始账本时**留空**
| character_a | character_b | types | status | trust | loyalty | since_chapter | notes |
- types：逗号分隔，可选 {blood/marriage/political/military/mentor/romantic/rivalry/vassal/sibling}
- status：active/dissolved/strained/broken/restored
- notes 支持内联 timeline："描述 | timeline: ch.N: 事件 → 影响; ch.M: ..."

### 时代情绪（UPDATED_ERA_MOOD）
- 时代切面。Markdown 表格，标题 "## Era Dimensions"
- 本章无时代切换则**留空**；只有当时代发生质变（开战/改朝/复兴）才新增一行
| era_id | era_name | start_chapter | prosperity | war | stability | innovation | decay | faith | mood | notes |
- 各维度 0-100 整数；faith 可选

### 兵力（UPDATED_MILITARY_FORCES）
- 兵力账本。Markdown 表格，标题 "## Military Forces"
- 本章任何部队动员/行军/参战/损兵/换帅都必须更新该行。无军事行动则**留空**
| force_id | faction | commander | troop_count | unit_composition | morale | supplies | location | status | last_updated_chapter | notes |
- status：mobilized/deployed/garrison/routed/disbanded
- troop_count 必须反映扣除本章伤亡后的兵力

### 战场（UPDATED_WAR_THEATER）
- 战场账本。Markdown 表格，标题 "## War Theaters"
- 新战争开启时新增行；已有战争演化时更新 front_line/status。无变化则**留空**
| theater_id | war_name | belligerents | start_chapter | front_line | strategic_objective | scale | status | outcome | last_updated_chapter | notes |
- scale：skirmish/campaign/total_war
- status：active/stalemate/concluded/ceasefire

### 战役（UPDATED_BATTLE_LOG）
- 战役日志。Markdown 表格，标题 "## Battle Log"
- 本章发生的每场战役各占一行。无战役则**留空**
| battle_id | chapter | theater_id | battle_name | belligerents | commanders | forces_engaged | terrain | outcome | casualties_attacker | casualties_defender | strategic_shift | notes |
- outcome：A_decisive/A_pyrrhic/B_decisive/B_pyrrhic/stalemate/A_retreat/B_retreat
- strategic_shift **必填**——一句话总结战略影响

### 领土（UPDATED_TERRITORY_CONTROL）
- 领土控制。Markdown 表格，标题 "## Territory Control"
- 任何地盘易手时更新 controller 与 timeline。无变化则**留空**
| territory_id | name | type | controller | contested_by | strategic_value | control_since_chapter | garrison_force | notes |
- type：city/fort/pass/mine/port/region/capital
- notes 支持 timeline："描述 | timeline: ch.N: 旧方→新方"

### 纪元（UPDATED_EPOCH_TIMELINE）
- 纪元分段。Markdown 表格，标题 "## Epoch Timeline"
- **只有**当一个阶段终结或根本性新阶段开启时才新增一行；否则**留空**
| epoch_id | phase_name | start_chapter | end_chapter | dominant_powers | key_event | era_mood_snapshot | notes |
- 当前进行中的阶段 end_chapter **留空**

### 海军（UPDATED_NAVAL_FORCES）
- 舰队账本。Markdown 表格，标题 "## Naval Forces"
- 本章出海/海战/损舰/封港/换提督的每支舰队都要更新。无海上活动则**留空**
| fleet_id | faction | admiral | ship_count | ship_types | naval_supremacy | morale | home_port | status | last_updated_chapter | notes |
- naval_supremacy：0-100 整数
- status：docked/patrolling/besieging/engaged/scattered/destroyed/disbanded

### 王朝（UPDATED_DYNASTY_TREE）
- 王朝谱系。Markdown 表格，标题 "## Dynasty Tree"
- 只在出生/婚姻/死亡/继位/摄政事件时更新。否则**留空**
| person_id | display_name | generation | parents | spouse | inherited_from | inheritance_order | regency_for | successor | title | lifespan_chapters | notes |
- generation：整数，开朝祖先为 1
- regency_for：被摄政者的 person_id

### 财政（UPDATED_TREASURY_STATE）
- 派系国库。Markdown 表格，标题 "## Treasury State"
- 任何派系收贡/付佣兵/丢税基/承担赔款时更新。无变化则**留空**
| faction | gold | grain | mercenary_budget | income_per_chapter | last_updated_chapter | notes |

### 地理（UPDATED_GEOGRAPHY）
- 地理特征账本。Markdown 表格，标题 "## Geography"
- 本章出现新地点/地形变化/路线发现/环境变化时更新。无地理变化则**留空**
| geo_id | name | terrain_type | climate | strategic_features | adjacent_regions | travel_difficulty | notes |
- terrain_type：plains/mountain/rainforest/desert/coast/river/swamp/snowfield/steppe/forest/island/volcanic（可逗号分隔多个）
- climate：temperate/tropical/arid/arctic/monsoon/continental
- travel_difficulty：easy/moderate/hard/impassable
- strategic_features：一句话描述地形的战略价值（关隘/粮仓/港湾/天然屏障等）

**铁律**：无相关事件时**留空**（输出空字符串），禁止编造；有相关事件时输出**完整**更新后表格（合并原始账本中所有未变化旧行 + 本章变化行）。

## 输出格式（必须严格遵循）

${buildSettlerOutputFormat(genreProfile)}

## 关键规则

1. 状态卡和伏笔池必须基于"当前追踪文件"做增量更新，不是从零开始
2. 正文中的每一个事实性变化都必须反映在对应的追踪文件中
3. 不要遗漏细节：数值变化、位置变化、关系变化、信息变化都要记录
4. 角色交互矩阵中的"信息边界"要准确——角色只知道他在场时发生的事
5. 如果本章控制输入包含"本章出场人物 / Active Cast"，人物结算必须服从它：只更新 present 且正文有直接证据的人物；mentioned/offstage 只能作为提及记录，不得产生行动、状态变化或关系推进；channel_only 只按频道/远端文本证据处理

## 物品/资源详细描述保留铁律（必须严格执行）

当更新资源账本（UPDATED_LEDGER）或状态卡中的物品信息时，必须保留物品的完整描述，不得简化或省略：

**必须保留的信息**：
- 物品的完整名称（包括材质、外观、标记等描述）
- 获得方式和来源（从哪里获得、如何获得）
- 存放位置（具体在身上哪个位置、与其他物品的关系）
- 触发条件和效果（如果有的话）
- 信息边界（谁知道、谁不知道）

**反面检查**：
- ✗ 错误：把"布片（手绘符号：圆圈+横线+箭头）"简化为"布片"
- ✓ 正确：保留"布片（手绘符号：圆圈+横线+箭头）"的完整描述
- ✗ 错误：把"半块虎符（青铜，'玄卫'铭文）"简化为"虎符"
- ✓ 正确：保留"半块虎符（青铜，'玄卫'铭文）"的完整描述

**更新规则**：
- 如果物品没有变化，保留原有描述的全部内容
- 如果物品有变化（如位置移动、状态改变），在原有描述基础上追加新信息，不要删除旧信息
- 如果物品被消耗或丢失，标记为"已消耗"或"已丢失"，但保留原有描述以供追溯

## 状态卡更新铁律（必须严格执行）

状态卡（UPDATED_STATE）必须反映本章结束时的最新状态。以下任何一项发生变化时，必须更新对应字段：

- **当前位置**：角色从A移动到B → 更新"当前位置"
- **主角状态**：受伤、获得新能力、体力变化 → 更新"主角状态"
- **当前目标**：目标改变或推进 → 更新"当前目标"
- **当前限制**：新的限制出现或旧限制解除 → 更新"当前限制"
- **当前敌我**：盟友/敌人变化 → 更新"当前敌我"
- **当前冲突**：冲突升级/降级/转变 → 更新"当前冲突"

**反面检查**：如果正文写了"苏然从X撤退到Y"，状态卡的"当前位置"必须从X变成Y。如果正文写了"苏然获得了信标种子协议片段"，状态卡必须反映这个新信息。

## 伏笔池更新铁律（必须严格执行）

伏笔池（UPDATED_HOOKS）必须反映本章所有伏笔动态。以下情况必须更新：

- **推进**：正文中有新事实/证据/风险升级/范围收缩 → 更新"最近推进"为当前章节号，更新状态和备注
- **回收**：伏笔被明确揭示或解决 → 状态改为"已回收"
- **新开**：正文出现了新的未解悬念 → 新增 hook_id（放入 newHookCandidates）
- **提及**：只是被提到但没有新信息 → 放入 mention 数组，不更新推进

**反面检查**：如果正文写了"琥珀指示符闪烁频率加快"，这推进了 H_2 琥珀指示符伏笔，必须更新。如果正文写了"匿名用户的威胁升级为物理攻击"，这推进了 H_11 匿名用户伏笔，必须更新。

**伏笔详细描述保留规则**：
- 更新伏笔时，必须保留原有的完整描述（类型、预期回收、备注等）
- 如果伏笔有新信息，在原有描述基础上追加，不要删除旧信息
- 不要把"旧伤异变（疼痛升级，伴随短暂失控和皮肤可见异常）"简化为"旧伤异变"
- 保留伏笔的具体触发条件、效果描述、信息边界

## 人物性格与对话风格保留铁律（必须严格执行）

更新角色交互矩阵（UPDATED_CHARACTER_MATRIX）时，必须保留角色的完整描述：

**必须保留的信息**：
- 性格标签和反差细节（如有）
- 说话风格的具体描述（句式、用词、语气、口头禅）
- 动机和行为约束
- 已知/未知信息的完整列表

**反面检查**：
- ✗ 错误：把"低沉、简练，分析时冷静客观，必要时果断决绝"简化为"简练"
- ✓ 正确：保留完整的说话风格描述
- ✗ 错误：删除角色的口头禅或对话示例
- ✓ 正确：保留所有说话风格的具体细节

**更新规则**：
- 如果角色的说话风格没有变化，保留原有描述的全部内容
- 如果角色的说话风格有变化（如因剧情发展而改变），在原有描述基础上说明变化原因
- 不要删除角色的"反差细节"，即使本章没有体现

## 信息流动铁律

- 如果正文写了角色获得了新信息（看到、听到、发现、被告知），必须在角色矩阵的"已知"字段中记录
- 如果正文写了角色仍然不知道某事，保持"未知"字段不变
- 不要把角色在场时获得的信息错误地归为"未知"

## 信息边界保留铁律（必须严格执行）

更新角色交互矩阵（UPDATED_CHARACTER_MATRIX）时，必须保留角色的完整"已知/未知"信息：

**必须保留的信息**：
- 已知信息的完整列表（包括来源和获取方式）
- 未知信息的完整列表（包括为什么不知道）
- 信息边界的精确描述（不要简化为"知道X"或"不知道Y"）

**反面检查**：
- ✗ 错误：把"自己是鼎印宿主（残印）；三年前参与过暗网'送牌'任务"简化为"鼎印宿主"
- ✓ 正确：保留完整的已知信息列表，包括来源和上下文
- ✗ 错误：把"自己体内鼎印的具体性质和完整用途"简化为"鼎印性质"
- ✓ 正确：保留完整的未知信息列表，包括为什么不知道

**更新规则**：
- 如果角色获得了新信息，在原有"已知"列表基础上追加，不要删除旧信息
- 如果角色的"未知"信息被揭示，从"未知"列表中移除，但保留原有描述以供追溯
- 不要简化信息边界的描述，保留具体的细节和上下文

**POV一致性检查**：
- writer在写作时，只能让角色基于"已知"信息行动
- 如果正文写了角色"知道"了某事，但该事在"未知"列表中，这是错误的
- 如果正文写了角色"不知道"某事，但该事在"已知"列表中，这也是错误的

## 角色资产账本规则（严格执行）

资产账本（character_assets）独立于角色矩阵，专门追踪角色持有/可用的物品和道具。

**description 字段要求（writer 消费）**：
- 必须包含功能性信息：物品的效果、能力、用途，不能只写外观
- 包含使用条件或限制（如有）
- 示例：
  - ✗ 错误："一把剑" — writer 不知道这把剑有什么用
  - ✗ 错误："上古神兵，剑身赤红如血" — 只有外观，没有效果
  - ✓ 正确："上古神兵，剑身赤红如血，可斩断灵力护体，使用时剑身灼热" — 有外观、有效果、有限制
  - ✓ 正确："天阶功法，共九重，修炼后可凝聚灵力外放，第三重后可飞行" — 有等级、有效果、有阶段

**状态变更规则**：
- 丢失（非销毁）的物品用 "update_status: lost"，不要用 "remove"，以便后续寻回
- 销毁的物品用 "update_status: destroyed" 或 "remove"
- 寻回丢失物品用 "update_status: held"（或 "equipped"）

**必须记录的资产变化**：
- 角色获得新物品（购买、拾取、赠送、制造） → upsert，status 为 held
- 角色装备/使用物品（穿戴、激活、拔出） → update_status 为 equipped
- 角色存放物品（放入背包、藏起来、寄存） → update_status 为 stored
- 角色丢失物品（被抢、掉落、遗失） → update_status 为 lost
- 角色销毁物品（打碎、烧毁、消耗） → update_status 为 destroyed
- 角色借出/借入物品 → transfer 或 update_status 为 lent
- 物品在角色间转手 → transfer

**与角色矩阵的关系**：
- characterMatrixOps 的 [describedProps] 仍保留，用于 writer 的物品描述降噪
- characterAssetsOps 是独立的结构化追踪，用于 writer 的"不可用资产不能调用"校验
- 两者不要重复：describedProps 管"描述详细度"，assetOps 管"持有/可用性"

**反面检查**：
- ✗ 正文写了"苏然把信筒交给米拉"，但 assetOps 没有 transfer 操作
- ✓ 正文写了"苏然把信筒交给米拉"，assetOps 有 { op: "transfer", assetId: "信筒", targetHolder: "米拉" }

## 资产变动事件日志规则（严格执行）

assetEvents 与 characterAssetsOps 配合：Ops 管状态变更（reducer 消费），Events 管叙事记录（writer/character-context-card 消费）。

**必须记录事件的场景**：
- 角色首次获得新物品（acquired）—— 包括购买、拾取、赠送、制造、秘境获得
- 物品升级/强化/改造（upgraded）—— 品质提升、附魔、修复
- 物品被新物品替换（swapped）—— 新功法替换旧功法、新武器替换旧武器
- 物品丢失/被抢/遗失（lost）
- 物品销毁/打碎/烧毁/完全消耗（destroyed）
- 物品借出/借入（lent / returned）
- 本章首次使用某已有装备/功法（used）—— 重要：如果角色持有新装备但前几章一直没用，本章首次使用时必须记录

**narrative 字段要求**：
- 一句话描述事件经过，writer 可直接引用到正文中
- 包含因果关系（为什么获得、怎么丢失的）
- 不要写"无"或"略"——如果没有叙事细节，用事件类型+物品名造句

**与 characterAssetsOps 的对应关系**：
- 每个 upsert（新物品）→ 至少一条 acquired 事件
- 每个 transfer → 至少一条事件（记录转手原因）
- 每个 update_status → 至少一条事件（记录状态变更原因）
- 不需要为 batch_upsert/batch_remove 的每个子项都写事件，只写有叙事价值的

## 铁律：只记录正文中实际发生的事（严格执行）

- **只提取正文中明确描写的事件和状态变化**。不要推断、预测、或补充正文没有写到的内容
- 如果正文只写到角色走到门口还没进去，状态卡就不能写"角色已进入房间"
- 如果正文只暗示了某种可能性但没有确认，不要把它当作已发生的事实记录
- 不要从卷纲或大纲中补充正文尚未到达的剧情到状态卡
- 不要删除或修改已有 hooks 中与本章无关的内容——只更新本章正文涉及的 hooks
- 第 1 章尤其注意：初始追踪文件可能包含从大纲预生成的内容，只保留正文实际支持的部分，不要保留正文未涉及的预设
- **伏笔例外**：正文中出现的未解疑问、悬念、伏笔线索必须在 hooks 中记录。这不是"推断"，而是"提取正文中的叙事承诺"。如果正文暗示了一个谜题/冲突/秘密但没有解答，那就是一个 hook，必须记录`;
}

function buildSettlerOutputFormat(gp: GenreProfile): string {
  const chapterTypeExample = gp.chapterTypes.length > 0
    ? gp.chapterTypes[0]
    : "主线推进";

  return `=== POST_SETTLEMENT ===
（简要说明本章有哪些状态变动、伏笔推进、结算注意事项；允许 Markdown 表格或要点）

=== RUNTIME_STATE_DELTA ===
（必须输出 JSON，不要输出 Markdown，不要加解释）
\`\`\`json
{
  "chapter": 12,
  "currentStatePatch": {
    "currentLocation": "可选",
    "protagonistState": "可选",
    "currentGoal": "可选",
    "currentConstraint": "可选",
    "currentAlliances": "可选",
    "currentConflict": "可选"
  },
  "hookOps": {
    "upsert": [
      {
        "hookId": "mentor-oath",
        "startChapter": 8,
        "type": "relationship",
        "status": "progressing",
        "lastAdvancedChapter": 12,
        "expectedPayoff": "揭开师债真相",
        "payoffTiming": "slow-burn",
        "notes": "本章为何推进/延后/回收"
      }
    ],
    "mention": ["本章只是被提到、没有真实推进的 hookId"],
    "resolve": ["已回收的 hookId"],
    "defer": ["需要标记延后的 hookId"]
  },
  "newHookCandidates": [
    {
      "type": "mystery",
      "expectedPayoff": "新伏笔未来要回收到哪里",
      "payoffTiming": "near-term",
      "notes": "本章为什么会形成新的未解问题"
    }
  ],
  "chapterSummary": {
    "chapter": 12,
    "title": "本章标题",
    "characters": "角色1,角色2",
    "events": "一句话概括关键事件",
    "stateChanges": "一句话概括状态变化",
    "hookActivity": "mentor-oath advanced",
    "mood": "紧绷",
    "chapterType": "${chapterTypeExample}"
  },
  "subplotOps": [],
  "emotionalArcOps": [],
  "allianceOps": [
    {
      "op": "upsert_faction",
      "factionId": "faction_wu_sub_lumeng",
      "data": {
        "name": "吕蒙派系",
        "factionType": "subfaction",
        "parentFaction": "faction_wu",
        "members": ["吕蒙", "陆逊"],
        "leader": "吕蒙",
        "description": "东吴主战派，主张夺回荆州"
      }
    },
    {
      "op": "update_relation",
      "factionA": "faction_shu",
      "factionB": "faction_wu",
      "data": {
        "state": "at_war",
        "nominalState": "allied",
        "trustLevel": 5,
        "notes": "名义同盟实际交战——白衣渡江偷袭荆州"
      }
    },
    {
      "op": "record_event",
      "eventId": "evt-white-clothes",
      "data": {
        "type": "betrayal",
        "factions": ["faction_wu", "faction_shu"],
        "description": "吕蒙白衣渡江偷袭荆州",
        "impact": "孙刘联盟破裂，关羽腹背受敌"
      }
    },
    {
      "op": "record_membership",
      "eventId": "mem-lumeng-defect",
      "data": {
        "character": "吕蒙",
        "fromFaction": "faction_wu",
        "toFaction": "faction_wu_sub_lumeng",
        "type": "betray",
        "description": "吕蒙擅自行动，违背孙权联蜀战略"
      }
    }
  ],
  "characterAssetsOps": [
    {
      "op": "upsert",
      "assetId": "信筒",
      "holder": "苏然",
      "data": {
        "name": "信筒（铜制，封蜡完整）",
        "description": "未拆封的密信容器",
        "status": "held"
      }
    }
  ],
  "assetEvents": [
    {
      "assetId": "信筒",
      "holder": "苏然",
      "eventType": "acquired",
      "chapter": 12,
      "source": "米拉在暗渠入口处交给苏然",
      "narrative": "米拉把未拆封的信筒塞进苏然手里，叮嘱他不要打开"
    }
  ],
  "characterMatrixOps": [
    {
      "op": "upsert_profile",
      "characterName": "主角姓名",
      "data": {
        "notes": "[describedProps] 信筒, 旧铜牌, 焦旗边角 [/describedProps]\\\\n基本信息：见 roles/主要角色/主角姓名.md（原样保留）\\\\n性格设定：本章新增——长时间被追猎后明显疲劳，决策方式从理性分析滑向直觉判断\\\\n内心侧写：原样保留 + 新增——核心恐惧从'被背叛'具体化为'信筒在自己手里被夺'\\\\n形象：原样保留\\\\n童年经历：原样保留\\\\n环境影响：本章首次进入暗渠，对盐港下水系统的熟悉度从0升到+1\\\\n目标与遗憾：本章新增——必须在白塔背窗封死前找到下一条可通路径\\\\n社交关系：与米拉建立临时同路约定（不出卖给圣裁），与受伤同伴形成事实保护关系\\\\n情感状态：从'警觉'滑入'压抑的焦躁'，触发点是封钉发现\\\\n恋爱相处：N/A\\\\n恋爱矛盾：N/A\\\\n特殊伙伴：N/A\\\\n能力设定：旧铜牌可开启旧护路涵洞与暗渠窄栅；本章首次发现可以反向倒走\\\\n行动原理：原则——先看出口、马匹、水源、谁能走路；本章未违反\\\\n秘密：圣裁追捕者已得知凯尔携带未拆封信筒（从隐私秘密升级为公开秘密）\\\\n口头禅习惯：原样保留\\\\n当前现状：在中段涵洞与暗渠入口之间，准备进暗渠\\\\n状态变更：旧铜牌——本章使用 2 次（涵洞 + 暗渠），无磨损"
      }
    },
    {
      "op": "append_relationship_timeline",
      "characterA": "刘禅",
      "characterB": "赵子龙",
      "timelineEvent": {
        "event": "赵子龙长坂坡救刘禅",
        "impact": "建立恩人关系"
      }
    }
  ],
  "notes": []
}
\`\`\`

（以下 11 个战争/关系/时代/地理账本以 Markdown 表格输出，与 RUNTIME_STATE_DELTA 并列。无相关事件时留空——输出空字符串即可，不要输出空表格头。）

=== UPDATED_RELATIONSHIP_GRAPH ===
（多维关系。Markdown 表格，标题 "## Relationship Graph"。无关系事件留空。）
| character_a | character_b | types | status | trust | loyalty | since_chapter | notes |

=== UPDATED_ERA_MOOD ===
（时代切面。Markdown 表格，标题 "## Era Dimensions"。无时代切换留空。）
| era_id | era_name | start_chapter | prosperity | war | stability | innovation | decay | faith | mood | notes |

=== UPDATED_MILITARY_FORCES ===
（兵力。Markdown 表格，标题 "## Military Forces"。无军事行动留空。）
| force_id | faction | commander | troop_count | unit_composition | morale | supplies | location | status | last_updated_chapter | notes |

=== UPDATED_WAR_THEATER ===
（战场。Markdown 表格，标题 "## War Theaters"。无战争变化留空。）
| theater_id | war_name | belligerents | start_chapter | front_line | strategic_objective | scale | status | outcome | last_updated_chapter | notes |

=== UPDATED_BATTLE_LOG ===
（战役。Markdown 表格，标题 "## Battle Log"。无战役留空。）
| battle_id | chapter | theater_id | battle_name | belligerents | commanders | forces_engaged | terrain | outcome | casualties_attacker | casualties_defender | strategic_shift | notes |

=== UPDATED_TERRITORY_CONTROL ===
（领土。Markdown 表格，标题 "## Territory Control"。无地盘易手留空。）
| territory_id | name | type | controller | contested_by | strategic_value | control_since_chapter | garrison_force | notes |

=== UPDATED_EPOCH_TIMELINE ===
（纪元。Markdown 表格，标题 "## Epoch Timeline"。无阶段切换留空。）
| epoch_id | phase_name | start_chapter | end_chapter | dominant_powers | key_event | era_mood_snapshot | notes |

=== UPDATED_NAVAL_FORCES ===
（海军。Markdown 表格，标题 "## Naval Forces"。无海上活动留空。）
| fleet_id | faction | admiral | ship_count | ship_types | naval_supremacy | morale | home_port | status | last_updated_chapter | notes |

=== UPDATED_DYNASTY_TREE ===
（王朝。Markdown 表格，标题 "## Dynasty Tree"。无谱系事件留空。）
| person_id | display_name | generation | parents | spouse | inherited_from | inheritance_order | regency_for | successor | title | lifespan_chapters | notes |

=== UPDATED_TREASURY_STATE ===
（财政。Markdown 表格，标题 "## Treasury State"。无财政变化留空。）
| faction | gold | grain | mercenary_budget | income_per_chapter | last_updated_chapter | notes |

=== UPDATED_GEOGRAPHY ===
（地理。Markdown 表格，标题 "## Geography"。无地理变化留空。）
| geo_id | name | terrain_type | climate | strategic_features | adjacent_regions | travel_difficulty | notes |
- terrain_type：plains/mountain/rainforest/desert/coast/river/swamp/snowfield/steppe/forest/island/volcanic
- climate：temperate/tropical/arid/arctic/monsoon/continental
- travel_difficulty：easy/moderate/hard/impassable

=== UPDATED_ASSET_EVENTS ===
（资产变动事件日志。Markdown 表格，标题 "## Asset Events"。无资产变动留空。）
| event_id | chapter | asset_id | holder | event_type | source | narrative | notes |
- event_type：acquired（获得）/ upgraded（升级/强化）/ swapped（替换旧装备）/ lost（丢失/被抢）/ destroyed（销毁/消耗）/ lent（借出）/ returned（归还）/ used（本章首次使用）
- source：事件来源（战斗拾取/师父传授/秘境获得/敌人掉落/交易购买/制造合成等）
- narrative：一句话叙事描述，writer 可直接引用
- 每个 characterAssetsOps 中的本章变动都应对应一条事件记录
- 如果本章无资产变动，留空

规则：
1. 只输出增量，不要重写完整 truth files
2. 所有章节号字段都必须是整数，不能写自然语言
3. hookOps.upsert 里只能写"当前伏笔池里已经存在"的 hookId，不允许发明新的 hookId
4. brand-new unresolved thread 一律写进 newHookCandidates，不要自造 hookId
5. 如果旧 hook 只是被提到、没有真实状态变化，把它放进 mention，不要更新 lastAdvancedChapter
6. 如果本章推进了旧 hook，lastAdvancedChapter 必须等于当前章号
7. 如果回收或延后 hook，必须放在 resolve / defer 数组里
8. chapterSummary.chapter 必须等于当前章节号
9. subplotOps 只允许 op: upsert / advance / pause / resolve；每项必须有 subplotId。没有明确 subplotId 就写 []，不要输出 update/defer
10. emotionalArcOps 只允许 op: upsert / update / resolve；每项必须有 arcId。没有明确 arcId 就写 []
11. characterMatrixOps 只允许 op: upsert_profile / remove_profile / upsert_relationship / remove_relationship；不要输出 appendKnown/appendState/mentionOnly/offstageNoUpdate。角色信息变化用 upsert_profile，关系变化用 upsert_relationship，未出场无变化就不写 op
12. characterMatrixOps 维护 describedProps 状态声明（硬约束，配合 writer 物品/资源降噪铁律）：
    - state-reducer 对 notes 是覆盖语义，本章 upsert_profile.data.notes 会完全替换该角色旧 notes
    - 因此每次必须先从"## 当前角色交互矩阵"里读出该角色既有的 [describedProps]...[/describedProps] 列表，把本章首次完整描述（≥ 12 字定语链）的重要道具追加进去，输出累积全集
    - 严禁只写本章新增；丢失旧条目即视为状态污染，writer 下一章会重新堆砌完整定语
    - 道具持有人发生切换时（如信筒从 A 转到 B），同时 upsert 旧持有人（移除该道具）和新持有人（加入该道具）
    - 道具状态发生剧情决定性变化（裂开/丢失/转手/烧毁）时，在该角色 notes 中追加一行"状态变更：信筒封蜡已裂"，writer 据此决定是否在下一章补一句完整描述
    - 道具归属约定：随身道具挂在当前主要持有人 profile；场景道具（如墙上的旗、地上的炉印）挂在本章主视角角色 profile
    - 角色原有 notes 中与 describedProps 无关的内容（如性格补充、关系笔记）必须原样保留在新 notes 中，不要删除

13. characterMatrixOps 维护角色 16 切面字段累积（硬约束，与规则 #12 协同）：
    - 角色卡 16 切面 anchor（基本信息 / 性格设定 / 内心侧写 / 形象 / 童年经历 / 环境影响 / 目标与遗憾 / 社交关系 / 情感状态 / 恋爱相处 / 恋爱矛盾 / 特殊伙伴 / 能力设定 / 行动原理 / 秘密 / 口头禅习惯）的本章增量必须在 upsert_profile.data.notes 中保留完整累积
    - notes 内部结构（行级，行间用 \\n 分隔）：
      [describedProps] ... [/describedProps]
      基本信息：[本章是否有更新；无更新写"原样保留"]
      性格设定：[本章是否有更新]
      ... 16 切面每一项一行 ...
      状态变更：[本章发生的关键状态变化行，可多行]
    - 既有 notes 中的字段必须**原样保留或追加新事实**——禁止只写本章新增字段而丢失其它 anchor
    - 本章未触及的 anchor 写"原样保留"即可，不要重复复述源材料
    - 本章触及的 anchor 写"原样保留 + 新增[一句具体事实]"格式
    - 不存在的可选 anchor（如恋爱相处/特殊伙伴/能力设定 对非该类角色）写"N/A"
    - **判定准则**：把本章读完后，每个 anchor 问自己"该字段在本章是否被正文触发？" 触发 = 追加新事实；未触发 = 原样保留；不适用 = N/A
    - **三态强制**：原样保留 / 追加新事实 / N/A——禁止留空 anchor 行，禁止跳过 anchor 名
    - 这条规则同时保护了 character_matrix.md projection 不退化为"只剩本章信息、丢失全书累积"的废表

14. characterAssetsOps 独立追踪角色持有物品（硬约束，与 describedProps 协同）：
    - 只允许 op: upsert / remove / transfer / update_status / batch_upsert / batch_remove / batch_transfer
    - upsert 必须有 assetId 和 holder；transfer 必须有 assetId 和 targetHolder
    - status 只允许 held / equipped / stored / lost / destroyed / lent
    - 物品在角色间转手必须用 transfer，不要 remove + upsert
    - 如果本章没有资产变化，写 "characterAssetsOps": []
    - 不要与 characterMatrixOps 的 describedProps 重复：describedProps 管描述详细度，assetOps 管持有/可用性

15. allianceOps 追踪势力阵营和外交关系（硬约束）：
    - op: upsert_faction / dissolve_faction / update_relation / record_event / record_membership
    - upsert_faction 必须有 factionId；支持 factionType（nation/organization/alliance/subfaction/rebellion）和 parentFaction（子派系归属）
    - update_relation 必须有 factionA 和 factionB；支持 nominalState（名义状态）与 state（实际状态）分离——用于鸿门宴、假投降等双面关系场景
    - record_event 必须有 eventId 和 data；type 支持内部事件：coup / rebellion / purge / power_struggle / succession / usurpation / uprising / civil_war
    - record_membership 追踪角色-势力关系变化：join / leave / betray / defect / expelled / rebel / usurp / purge / assassinate
    - Diplomatic state：allied / neutral / tense / hostile / at_war / vassal / ceasefire / rebellion
    - 如果本章没有势力变化，写 "allianceOps": []
    - 玄武门之变场景：用 subfaction 建模李世民派/李建成派，用 record_event type:coup 记录政变，用 record_membership type:usurp 记录篡位
    - 功高盖主场景：用 record_event type:power_struggle + update_relation state:tense
    - 揭竿起义/黄巢之乱：用 upsert_faction type:rebellion + record_event type:uprising + update_relation state:rebellion`;
}

export function buildSettlerUserPrompt(params: {
  readonly chapterNumber: number;
  readonly title: string;
  readonly content: string;
  readonly currentState: string;
  readonly ledger: string;
  readonly hooks: string;
  readonly chapterSummaries: string;
  readonly subplotBoard: string;
  readonly emotionalArcs: string;
  readonly characterMatrix: string;
  readonly volumeOutline: string;
  readonly characterAssets?: string;
  readonly allianceState?: string;
  readonly relationshipGraph?: string;
  readonly eraMood?: string;
  readonly militaryForces?: string;
  readonly warTheater?: string;
  readonly battleLog?: string;
  readonly territoryControl?: string;
  readonly epochTimeline?: string;
  readonly navalForces?: string;
  readonly dynastyTree?: string;
  readonly treasuryState?: string;
  readonly geography?: string;
  readonly observations?: string;
  readonly selectedEvidenceBlock?: string;
  readonly governedControlBlock?: string;
  readonly validationFeedback?: string;
}): string {
  const ledgerBlock = params.ledger
    ? `\n## 当前资源账本\n${params.ledger}\n`
    : "";

  const summariesBlock = params.chapterSummaries !== "(文件尚未创建)"
    ? `\n## 已有章节摘要\n${params.chapterSummaries}\n`
    : "";

  const subplotBlock = params.subplotBoard !== "(文件尚未创建)"
    ? `\n## 当前支线进度板\n${params.subplotBoard}\n`
    : "";

  const emotionalBlock = params.emotionalArcs !== "(文件尚未创建)"
    ? `\n## 当前情感弧线\n${params.emotionalArcs}\n`
    : "";

  const matrixBlock = params.characterMatrix !== "(文件尚未创建)"
    ? `\n## 当前角色交互矩阵\n${params.characterMatrix}\n`
    : "";

  const assetsBlock = params.characterAssets && params.characterAssets !== "(文件尚未创建)"
    ? `\n## 当前角色资产账本\n${params.characterAssets}\n`
    : "";
  const allianceBlock = params.allianceState && params.allianceState !== "(文件尚未创建)"
    ? `\n## 当前联盟局势\n${params.allianceState}\n`
    : "";
  // War ledgers v1+v2 — optional truth files. Empty when absent.
  const relationshipGraphBlock = params.relationshipGraph && params.relationshipGraph !== "(文件尚未创建)"
    ? `\n## 当前关系图谱\n${params.relationshipGraph}\n`
    : "";
  const eraMoodBlock = params.eraMood && params.eraMood !== "(文件尚未创建)"
    ? `\n## 当前时代情绪\n${params.eraMood}\n`
    : "";
  const militaryForcesBlock = params.militaryForces && params.militaryForces !== "(文件尚未创建)"
    ? `\n## 当前兵力账本\n${params.militaryForces}\n`
    : "";
  const warTheaterBlock = params.warTheater && params.warTheater !== "(文件尚未创建)"
    ? `\n## 当前战场账本\n${params.warTheater}\n`
    : "";
  const battleLogBlock = params.battleLog && params.battleLog !== "(文件尚未创建)"
    ? `\n## 当前战役日志\n${params.battleLog}\n`
    : "";
  const territoryControlBlock = params.territoryControl && params.territoryControl !== "(文件尚未创建)"
    ? `\n## 当前领土控制\n${params.territoryControl}\n`
    : "";
  const epochTimelineBlock = params.epochTimeline && params.epochTimeline !== "(文件尚未创建)"
    ? `\n## 当前纪元时间线\n${params.epochTimeline}\n`
    : "";
  const navalForcesBlock = params.navalForces && params.navalForces !== "(文件尚未创建)"
    ? `\n## 当前海军账本\n${params.navalForces}\n`
    : "";
  const dynastyTreeBlock = params.dynastyTree && params.dynastyTree !== "(文件尚未创建)"
    ? `\n## 当前王朝谱系\n${params.dynastyTree}\n`
    : "";
  const treasuryStateBlock = params.treasuryState && params.treasuryState !== "(文件尚未创建)"
    ? `\n## 当前财政状态\n${params.treasuryState}\n`
    : "";
  const geographyBlock = params.geography && params.geography !== "(文件尚未创建)"
    ? `\n## 当前地理特征\n${params.geography}\n`
    : "";

  const observationsBlock = params.observations
    ? `\n## 观察日志（由 Observer 提取，包含本章所有事实变化）\n${params.observations}\n\n基于以上观察日志和正文，更新所有追踪文件。确保观察日志中的每一项变化都反映在对应的文件中。\n`
    : "";
  const selectedEvidenceBlock = params.selectedEvidenceBlock
    ? `\n## 已选长程证据\n${params.selectedEvidenceBlock}\n`
    : "";
  const controlBlock = params.governedControlBlock ?? "";
  const outlineBlock = controlBlock.length === 0
    ? `\n## 卷纲\n${params.volumeOutline}\n`
    : "";
  const validationFeedbackBlock = params.validationFeedback
    ? `\n## 状态校验反馈\n${params.validationFeedback}\n\n这些反馈是本次结算必须补齐的硬约束。请逐条映射到 RUNTIME_STATE_DELTA：\n- missing_state_change 必须写入 currentStatePatch 的对应字段，必要时合并进 protagonistState/currentConstraint/currentConflict，不要只写在 notes。\n- missing_hook_update 必须写入 hookOps.upsert；只能使用"当前伏笔池"里已有的 hookId，lastAdvancedChapter 必须等于 ${params.chapterNumber}，notes 必须保留旧信息并追加本章新事实。\n- hook_anomaly / 伏笔池整体被移除 表示你遗漏了旧伏笔：不要清空 hooks；未推进的旧 hook 不需要重写，但被正文推进的旧 hook 必须 upsert。\n- 涉及角色出场、受伤、信息边界、关系压力的反馈必须写入 characterMatrixOps 或对应 currentStatePatch。\n只修正 RUNTIME_STATE_DELTA，不要改写正文，不要引入正文中不存在的新事实。\n`
    : "";

  return `请分析第${params.chapterNumber}章「${params.title}」的正文，更新所有追踪文件。
${observationsBlock}
${validationFeedbackBlock}
## 本章正文

${params.content}
${controlBlock}

## 当前状态卡
${params.currentState}
${ledgerBlock}
## 当前伏笔池
${params.hooks}
${selectedEvidenceBlock}${summariesBlock}${subplotBlock}${emotionalBlock}${matrixBlock}${assetsBlock}${allianceBlock}${relationshipGraphBlock}${eraMoodBlock}${militaryForcesBlock}${warTheaterBlock}${battleLogBlock}${territoryControlBlock}${epochTimelineBlock}${navalForcesBlock}${dynastyTreeBlock}${treasuryStateBlock}${geographyBlock}
${outlineBlock}

请严格按照 === TAG === 格式输出结算结果。`;
}
