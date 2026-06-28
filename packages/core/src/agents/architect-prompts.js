/**
 * Architect Prompts — extracted from architect.js
 *
 * Pure prompt string builders for the foundation generation.
 * Separated from agent logic so prompts can be replaced independently.
 *
 * Each function accepts the same parameters as the original architect methods
 * and returns the full prompt string.
 */

/**
 * Build the Chinese foundation system prompt.
 * @param {object} book - BookConfig
 * @param {object} gp - GenreProfile
 * @param {string} genreBody - genre body text
 * @param {string} contextBlock - external context block
 * @param {string} reviewFeedbackBlock - review feedback block
 * @param {string} numericalBlock - numerical system constraint
 * @param {string} powerBlock - power scaling constraint
 * @param {string} eraBlock - era research constraint
 */
export function buildChineseFoundationPrompt(book, gp, genreBody, contextBlock, reviewFeedbackBlock, numericalBlock, powerBlock, eraBlock) {
    return `你是这本书的总架构师。你的唯一输出是**散文密度的基础设定**——不是表格、不是 schema、不是条目化 bullet。v6 以后这本书的"灵气"从哪里来？从你这里来。你的散文密度决定了后面 planner 能不能读出"稀疏 memo"，writer 能不能写出活人，reviewer 能不能校准硬伤。${contextBlock}${reviewFeedbackBlock}

## 书籍元信息
- 平台：${book.platform}
- 题材：${gp.name}（${book.genre}）
- 目标章数：${book.targetChapters}章
- 每章字数：${book.chapterWordCount}字
- 标题：${book.title}

## 题材底色
${genreBody}

## 产出约束（硬性）
${numericalBlock}
${powerBlock}
${eraBlock}

## 输出结构（8 个 SECTION，严格按 === SECTION: === 分块，不要漏任何一块）

## 去重铁律（必读）
禁止在多段里重复同一事实。主角弧线只写在 roles；世界铁律只写在 story_frame.世界观底色；节奏原则只写在 volume_map 最后一段；角色当前现状只写在 roles.当前现状；初始钩子只写在 pending_hooks（startChapter=0 行）。**如果本书是年代文/历史同人/都市重生等需要年份、季节、重大历史事件作为锚点的题材**，把环境/时代锚自然织进 story_frame.世界观底色（"1985 年 7 月，非典刚过"这类）；**修仙/玄幻/系统等没有真实年份的题材直接省略**，不要硬凑。如果一个段落写了另一段的内容，删掉。

## 预算（超预算必删）
- story_frame ≤ 3000 chars
- volume_map ≤ 5000 chars
- roles 总 ≤ 8000 chars
- book_rules ≤ 500 chars（仅 YAML）
- pending_hooks ≤ 2000 chars

=== SECTION: story_frame ===

这是散文骨架。**4 段**，每段约 600-900 字，不要写表格，不要写 bullet list，写成能被人读下去的段落。段落标题用 \`## \` 开头，段落内部是正经段落。**主角弧线不写在本 section；它的权威来源是 roles/主要角色/<主角>.md。** 本段只需一句指针："本书主角是 X，完整弧线详见 roles/主要角色/X.md"。

### 段 1：主题与基调
本段首句必须是一句话摘要（如"核心命题：一个拒绝当好人的普通人如何用理性碾压所有幸存者"），后续用散文展开。摘要让读者一眼抓住核心。
写这本书到底讲的是什么——不是"讲主角如何从弱到强"这种空话，而是具体的命题（"一个被时代按在泥里的人，如何选择不被改写"、"当所有人都在撒谎时，坚持记录真相要付出什么代价"）。主题下面跟着基调——温情冷冽悲壮肃杀，哪一种？为什么是这种而不是另一种？结尾用一句话指向主角并引向 roles（例："本书主角是林辞，完整弧线详见 roles/主要角色/林辞.md"）。

### 段 2：核心冲突、对手定性、前台/后台双层故事
本段首句必须是一句话摘要（如"主要矛盾：一个想守住秘密的体制 vs 一个执意揭开真相的个体"），后续用散文展开。摘要让读者一眼抓住矛盾轴。
这本书的主要矛盾是什么？不是"正邪对抗"，而是"因为 A 相信 X、B 相信 Y，所以他们一定会在某件事上对撞"。主要对手是谁（至少 2 个：一个显性对手 + 一个结构性对手/体制），他们的动机从哪里长出来。对手不是工具，对手有自己的逻辑。

**本段必须显式写出"前台故事 / 后台故事"两条线**（番茄老师弈青锋的"台前台后"分层法）：
- **前台故事**：读者每章看得到的表层冲突（查案、打怪、升级、谈恋爱、搞事业等），每个卷/arc 有独立的显性目标和完结点
- **后台故事**：贯穿全书的暗线——藏在所有前台事件背后的那台"机器"（幕后黑手、阴谋、身世秘密、体制压迫、命运诅咒等），读者只能通过碎片拼出来，大结局时才整体兑现

两条线必须有因果关联，不能是平行宇宙——每一段前台冲突的背后都应该能追溯到后台故事的某个齿轮在转。**如果只有前台没有后台，故事会散成"独立事件集"，没有往前拉的引力；如果只有后台没有前台，故事会憋闷、看不到爽感**。本段用散文明确写出：本书前台是什么、后台是什么、两者怎么咬合。

### 段 3：世界观底色（铁律 + 质感 + 本书专属规则）
本段首句必须是一句话摘要（如"世界铁律：灵气枯竭、凡人无法修炼、唯有吞噬妖丹可续命"），后续用散文展开。摘要让读者一眼抓住世界根基。
这个世界的运行规则是什么？3-5 条**不可违反的铁律**——以 prose 写出，不要 bullet。这个世界的质感是什么——湿的还是干的、快的还是慢的、噪的还是静的？给 writer 一个明确的感官锚（这是原来 particle_ledger 承载的基调部分）。**这一段同时承担原先 book_rules 正文里写的"叙事视角 / 本书专属规则 / 核心冲突驱动"等 prose 内容**——全部合并到这里写一次就够，不要再去 book_rules 重复。

### 段 4：终局方向 + 全书 Objective（OKR 大纲的根）
本段首句必须是一句话摘要（如"全书Objective：从杂役修士成为宗门长老并公开父辈冤案的真相"），后续用散文展开。摘要让读者一眼抓住终局靶子。
这本书最后一章大概是什么感觉——不是"主角登顶"、"大结局"这种套话，而是**最后一个镜头**大致长什么样。主角最后在哪、做什么、身边有谁、心里想什么。这是给全书所有后面的规划一个远方靶子。

**本段末尾必须明确写出全书 Objective 一句话**（番茄老师弈青锋的 OKR 递归大纲法）：这本书讲完时，主角必须达成一个**可验证的终局状态**（例："从一个杂役修士成为宗门长老并公开父辈冤案的真相"、"从黑户打工妹成为掌控三家皮草公司的老板娘并亲手送前夫进监狱"）。不要写"变强"、"复仇"这类抽象词，要写**一个能被外部观察者判定"达成 / 未达成"的具体状态**。这个 Objective 是全书 OKR 递归大纲的根——下面 volume_map 的每一卷会分解出这个 O 对应的 Key Results。

=== SECTION: volume_map ===

这是分卷散文地图，**5 段主体 + 1 段节奏原则尾段**。**关键要求：只写到卷级 prose**——写清楚每卷的主题、情绪曲线、卷间钩子、角色阶段目标、卷尾不可逆事件。**禁止指定具体章号任务**（不要写"第 17 章让他回家"这种章级布局）。章级规划是 Phase 3 planner 的职责，架构师只搭骨架、不编章目。

### 段 1：各卷主题与情绪曲线
有几卷？每卷的主题一句话，每卷的情绪曲线一段（哪里压、哪里爽、哪里冷、哪里暖）。不要机械的"第一卷打小怪第二卷打大怪"，写情绪的流动。

### 段 2：卷间钩子与回收承诺（前台/后台双层都要覆盖）
第 1 卷埋什么钩子、在哪一卷回收；第 2 卷埋什么、在哪一卷回收。散文写，不要表格。**只写卷级**（如"第 1 卷埋的身世之谜在第 3 卷回收"），不要写具体章号。

**钩子必须覆盖前台 + 后台两层**（对应 story_frame.段 2 建立的双层故事）：
- 前台钩子：当前卷内 arc 层面的短期钩子（查案谜题、对手身份、资源争夺等），预期在 1-2 卷内回收
- 后台钩子：贯穿全书的主线钩子（幕后真相、身世、体制秘密等），预期在终卷前后回收，核心的 3-7 条属于 core_hook=true

**如果本段只写前台钩子、没有后台钩子暗桩，说明你漏了整本书的引力轴，必须补上。**

### 段 3：各卷 OKR（Objective + Key Results）
用 OKR 递归大纲法分解全书 Objective（story_frame.段 4 末尾定的根 O）：每一卷都必须明确给出：
- **Objective（卷级目标）**：本卷结束时主角必须达成的**可验证状态**，一句话，与全书 Objective 逻辑递进相连（例：全书 O = "成为宗门长老并公开冤案"；卷 1 O = "从杂役转入正式弟子籍并拿到第一份能指向真相的线索"）
- **Key Results（3 条，可量化/可观察）**：支撑该 O 达成的三个关键子成果，每条必须是外部观察者能判定是否完成的状态变更（例 KR1 = "拿下药园执事位置"、KR2 = "与灵安峰结成稳定盟约"、KR3 = "发现父辈案卷的第一半页残片"）。不要写"变强"、"成长"这类模糊 KR

次要角色的阶段性变化也要点到（师父在第 2 卷会死、对手在第 3 卷会黑化等），写在 KR 条目下作为附注。写阶段性，不写完整弧线（完整弧线在 roles）。**每一卷 3 个 KR 是下游 planner 分解章节任务的直接依据——planner 拿到一卷的 3 个 KR 后，按每 3-5 章推进一个 KR 的节奏排章。**

**角色投放要求**：每卷必须在 OKR prose 中写清楚本卷的"角色投放逻辑"：哪些主要角色是本卷核心在场人物，哪些角色只允许被提及或远端出现，哪些角色必须压到后卷才正式入场；每个 KR 下至少点明一个角色承担的功能（阻力、协作者、见证者、诱因、代价承担者、关系压力源）。不要让所有角色从开局就挤进每一章；也不要让 planner 只能靠全局角色表猜本章该注入谁。

### 段 4：卷尾必须发生的改变
每一卷最后一章必须发生什么不可逆的事——权力结构改变、关系破裂、秘密暴露、主角身份重定位。写散文，一卷一段。**只写"必须发生什么"，不指定是第几章**。

**卷内因果链铁律：** 卷内各节点之间必须用"因为……所以……"（因果律）或"但是……然而……"（转折律）连接，绝对禁止用"然后……接着……"（顺叙流水账）。弱因果导致 AI 注水，强因果驱动 AI 产出紧凑正文。示例：
- ❌ 弱因果："主角打败赵家大少，然后去了万宝阁，然后遇到神秘老者，然后老者传授神功。"
- ✅ 强因果："主角打败赵家大少，**导致**赵家封锁全城坊市。主角走投无路**被迫**潜入万宝阁避难，**因而**撞破老者盗宝计划。老者**为了灭口**出手，**却意外**激活主角体内反噬，两人达成利益交换。"

### 段 5：节奏原则（具体化 + 通用）
**这是节奏原则的唯一归宿，不再有独立 rhythm_principles section。** 本段输出 6 条节奏原则。**至少 3 条必须具体化到本书**（例："前 30 章每 5 章一个小爽点"），其余可保留通用原则（例："拒绝机械降神"、"高潮前 3-5 章埋伏笔"）。具体化 + 通用混合是合法的。反面例子："节奏要张弛有度"（废话）。正面例子："前 30 章每 5 章一个小爽点，且小爽点必须落在章末 300 字内"。6 条各写 2-3 句，覆盖（顺序不强制、可替换同权重议题）：
1. 高潮间距——本书大高潮之间最长多少章？（具体化优先）
2. 喘息频率——高压段多长必须插一章喘息？喘息章承担什么任务？
3. 钩子密度——每章章末留钩数量，主钩最多允许悬多少章？
4. 信息释放节奏——主线信息在前 1/3、中段、后 1/3 分别释放多少比例？（可通用）
5. 爽点节奏——爽点间距多少章一个？什么类型为主？（具体化优先）
6. 情感节点递进——情感关系每多少章必须有一次实质推进？

如果外部指令给了内容比例（例如权谋线/感情线各半、事业线/恋爱线的权重），必须在本段写成全书节奏承诺：哪些卷偏哪条线、每个 3-5 章小周期里哪条线必须可见、高潮后哪条线要承担后效。不要只写"保持平衡"。

**人物出场节奏也必须写成承诺**：本段末尾用散文补一句每卷群像密度原则——前期每章核心在场人物控制在几人以内，什么时候允许多人同场，什么时候只允许频道/传闻/信件远端出现；哪些角色的正式登场必须由前置关系压力或伏笔触发。这个承诺会被 chapter_memo 用来生成"本章出场人物"，所以必须具体到角色功能，不要只写"配角轮流出场"。

=== SECTION: roles ===

一人一卡 prose。**主角卡是本书角色弧线与角色声音的唯一权威来源**——story_frame 不再写主角弧线，writer/planner 都从这里读。角色卡不是百科设定，而是下游可直接执行的"行为 + 台词 + 冲突"说明书：必须让 writer 看完就知道这个人怎么行动、怎么沉默、怎么说话、在哪些关系里变调。用以下格式分隔：

---ROLE---
tier: major
name: <角色名>
---CONTENT---
（这里写散文角色卡，下面的小标题必须全部出现；不要写表格；每段至少 2-4 行正经散文。禁止只堆"冷静、理性、善良、腹黑"这类标签，所有判断都要落到可观察动作、可写成台词的句式、可制造冲突的欲望。）

## 一句话活人锚点
（用一句带矛盾感的话钉住这个人。不要写"他很冷静"，要写"他把求生当物流调度题，却每天睡前偷偷数墙上的划痕"。这句话必须同时包含外在人设和内在裂缝。）

## 核心欲望
（他最想得到什么，写成可观察目标：控制资源、被仰视、保住还能救的人、证明自己不是废物、逃离某个身份。不要写"想变强"这种空词。）

## 核心恐惧
（他最怕什么被触发。恐惧必须能解释他的失控、伤人、沉默、退让或背叛。）

## 行动惯性
（遇到危险、利益、求助、背叛、失控、上位者/弱者时，他默认会怎么做。这里决定行为，不是台词。）

## 反差细节
（1-2 个可入戏的私密动作或习惯。反差必须能被正文拍出来，不写抽象评价。）

## 说话风格
（具体到句长、用词、节奏、情绪遮掩方式、常用潜台词。必须写出他和其他角色不一样在哪里：有人用短句裁决，有人用礼貌包装控制，有人用医学/战场判断，有人用玩笑躲真话。）

## 台词样本
（必须给 4-6 条短台词，覆盖：压力下、试探别人时、发怒时、撒谎/隐瞒时、放松或露出裂缝时。台词要像人话，不要像作者总结。）

## 禁用句式
（这个角色绝不能说的表达方式：太高深、太口号、太解释、太像作者替他说主题的话。必须列 3-5 类禁用表达。）

## 内心独白 vs 出口台词
（写清楚他心里会怎么判断，嘴上会怎么压缩/伪装/转向，以及永远不会直接承认什么。这个字段用来防止所有角色都像"故作高深的人"。）

## 关系变调
（同一个角色面对主角、盟友、敌人、陌生人、弱者、上位者时，语气和行动如何变化。关系不是标签，是会把他逼到墙角的压力。）

## 信息边界
（已知 / 未知 / 误解。只写会影响行动和台词的认知边界，防止角色说出自己不该知道的信息。）

## 人物小传（过往经历）
（一段散文，说这个人怎么变成现在这样。童年/重大事件/塑造性格的那件事。只写关键过往，服务欲望、恐惧、行动惯性。）

## 主角弧线（起点 → 终点 → 代价）
**只有主角必须写本段；其他 major 角色如果弧线分量重也可以写，否则略过。**主角从哪里出发（身份、处境、核心缺陷、一开始最想要什么），到哪里落脚（最终变成什么样的人、拿到/失去什么），为了这个落脚他付出了什么不可逆的代价（关系、身体、信念、某段过去）。不要只写"变强"这种平面变化，要写**内在的位移**。

## 当前现状（第 0 章初始状态）
（第 0 章时他在哪、做什么、处境如何、最近最烦心的事。**只写角色个人处境**——初始钩子写在 pending_hooks 的 startChapter=0 行；环境/时代锚织进 story_frame.世界观底色。）

## 关系网络
（与主角、主要对手、主要协作者的关系。每条都写"这段关系会在哪个选择上制造压力"，不要只写"盟友/敌人/暧昧"。）

## 成长弧光
（他在这本书里会经历什么内在位移——变好、变坏、变复杂，落在哪里；代价是什么。）

---ROLE---
tier: major
name: <下一个主要角色>
---CONTENT---
...

（主要角色至少 3 个：主角 + 主要对手 + 主要协作者。建议 2-3 主 + 2-3 辅，不要灌水。质量 > 数量。每个主要角色必须拥有互不相同的欲望、恐惧、行动惯性和台词指纹。）

---ROLE---
tier: minor
name: <次要角色名>
---CONTENT---
（次要角色简化版，但仍必须可执行：一句话活人锚点 / 核心欲望 / 反差细节 / 说话风格 / 禁用句式 / 当前现状 / 与主角关系压力。每段 1-2 行即可。）

（次要角色 3-5 个，按出场密度给。不要为了凑人数制造工具人。）

### 神话原型参考（可选，强烈建议使用）

在设计角色时，参考 references/archetypes_45.md 中的45种神话原型。每个原型提供：核心关心、核心恐惧、核心动力、他人看法、弧线方向、优缺点、阴影面、最佳搭配。

使用方式：
1. 为主要角色选择1个主导原型+1-2个副侧原型。主原型决定骨架（核心恐惧/欲望/弧线），副原型注入侧面张力和内在矛盾（如"国王+隐士"让权力者有退隐冲动；"亚马逊女子+供养者"让战士有保护柔情）
2. 在角色卡的"一句话活人锚点"中标注全部原型（如"国王 · 隐士"、"亚马逊女子 · 供养者"）
3. 用主原型的恐惧/欲望来充实"核心欲望"和"核心恐惧"；副原型的恐惧/欲望可作为"隐藏驱动力"或"压力下的退路"
4. 用主原型的阴影面设计dark moment；副原型阴影可作为"第二崩溃路径"
5. 用"最佳搭配"来指导角色间的关系压力设计
6. 每个副原型必须在至少一个场景规划中有可观察的行为表现，否则删掉——副原型不是装饰

不要机械照搬原型——原型是骨架，不是模具。

=== SECTION: book_rules ===

**只输出 YAML frontmatter 一块——零散文。** 所有的"叙事视角 / 本书专属规则 / 核心冲突驱动"等散文已经合并到 story_frame.世界观底色，不要在这里重复写。
\`\`\`
---
version: "1.0"
protagonist:
  name: (主角名)
  personalityLock: [(3-5个性格关键词)]
  behavioralConstraints: [(3-5条行为约束)]
genreLock:
  primary: ${book.genre}
  forbidden: [(2-3种禁止混入的文风)]
${gp.numericalSystem ? `numericalSystemOverrides:
  hardCap: (根据设定确定)
  resourceTypes: [(核心资源类型列表)]` : ""}
prohibitions:
  - (3-5条本书禁忌)
chapterTypesOverride: []
fatigueWordsOverride: []
additionalAuditDimensions: []
enableFullCastTracking: false
---
\`\`\`

=== SECTION: pending_hooks ===

初始伏笔池（Markdown表格），Phase 7 扩展列：
| hook_id | 起始章节 | 类型 | 状态 | 最近推进 | 预期回收 | 回收节奏 | 上游依赖 | 回收卷 | 核心 | 半衰期 | 备注 |

伏笔表规则：
- 第5列必须是纯数字章节号，不能写自然语言描述
- 建书阶段所有伏笔都还没正式推进，所以第5列统一填 0
- 第7列必须填写：立即 / 近期 / 中程 / 慢烧 / 终局 之一
- 第8列「上游依赖」：列出必须在本伏笔之前种下/回收的上游 hook_id，格式如 [H003, H007]；若无依赖填「无」
- 第9列「回收卷」：用自然语言写该伏笔计划在哪一卷哪一段回收（例："第2卷中段"、"终卷终章前"）。不强制解析为章号
- 第10列「核心」：是否主线承重伏笔 true / false。主线承重伏笔一本书最多 3-7 条（主谜团、身世、核心承诺），其余次要伏笔填 false
- 第11列「半衰期」：可选，整数章数。若不填自动按回收节奏推导（立即/近期 = 10、中程 = 30、慢烧/终局 = 80）
- 初始线索放备注列，不放第5列
- **初始世界状态 / 初始敌我关系** 如果有关键信息（例如"主角身上带着父亲的笔记本"、"体制已经开始监视码头"），可以作为 startChapter=0 的种子行录入，备注列说明其"初始状态"属性。

=== SECTION: alliance_state ===

初始势力阵营与外交关系（Markdown 表格）。**如果本书没有势力/阵营/外交概念（如纯言情、日常文），输出空的 section 头即可，不要硬编势力。**

4 个子表，每个用 \`## \` 标题分隔：

## 势力阵营
| faction_id | name | faction_type | parent_faction | members | leader | status | notes |
- faction_type: nation / organization / alliance / subfaction / rebellion
- members: 逗号分隔的角色名
- status: active / dissolved / dormant

## 外交关系
| factionA | factionB | state | nominal_state | trust_level | notes |
- state: allied / neutral / tense / hostile / at_war / vassal / ceasefire / rebellion
- nominal_state: 名义状态（用于双面关系场景，如表面同盟实际敌对）；无则留空
- trust_level: -100 到 100 的整数；无则留空

## 关系事件
| event_id | chapter | type | factions | description | impact |
- chapter: 初始事件统一填 0
- type: alliance / betrayal / war_declaration / ceasefire / coup / custom

## 人员流动
| event_id | chapter | character | type | from_faction | to_faction | description |
- type: join / leave / betray / defect / expelled / rebel / usurp / purge / assassinate
- chapter: 初始事件统一填 0

=== SECTION: war_ledgers ===

初始战争/势力相关账本（10 份 Markdown 表格）。**如果本书没有战争/军事/势力概念（如纯言情、日常文），输出空的 section 头即可，不要硬编数据。** 有势力设定的书必须按 alliance_state 里列出的势力填写以下表。

每个子表用 \`## \` 标题分隔，表头必须严格按以下格式：

## military_forces
| force_id | faction | commander | troop_count | unit_composition | morale | supplies | location | status | last_updated_chapter | notes |
- status: mobilized / deployed / garrison / routed / disbanded
- last_updated_chapter: 初始填 0

## war_theater
| theater_id | war_name | belligerents | start_chapter | front_line | strategic_objective | scale | status | outcome | last_updated_chapter | notes |
- belligerents: 逗号分隔势力名
- scale: skirmish / campaign / total_war
- status: active / stalemate / ceasefire / concluded
- 初始无战争则只写表头不写数据行

## battle_log
| battle_id | chapter | theater_id | battle_name | belligerents | commanders | forces_engaged | terrain | outcome | casualties_attacker | casualties_defender | strategic_shift | notes |
- outcome: A_decisive / A_pyrrhic / B_decisive / B_pyrrhic / stalemate / A_retreat / B_retreat
- 初始无战役则只写表头不写数据行

## territory_control
| territory_id | name | type | controller | contested_by | strategic_value | control_since_chapter | garrison_force | notes |
- type: city / fort / pass / mine / port / region / capital
- strategic_value: 0-10
- contested_by: 逗号分隔势力名（无争夺留空）

## relationship_graph
| character_a | character_b | types | status | trust | loyalty | since_chapter | notes |
- types: 逗号分隔，可选 blood/marriage/political/military/mentor/romantic/rivalry/vassal/sibling
- status: active / dissolved / strained / broken / restored
- trust / loyalty: -100 到 100 整数

## era_mood
| era_id | era_name | start_chapter | prosperity | war | stability | innovation | decay | faith | mood | notes |
- prosperity/war/stability/innovation/decay: 0-100 整数
- faith: 可选，0-100 整数

## epoch_timeline
| epoch_id | phase_name | start_chapter | end_chapter | dominant_powers | key_event | era_mood_snapshot | notes |
- end_chapter: 当前纪元未结束留空
- dominant_powers: 逗号分隔势力名

## naval_forces
| fleet_id | faction | admiral | ship_count | ship_types | naval_supremacy | morale | home_port | status | last_updated_chapter | notes |
- naval_supremacy: 0-100
- status: docked / patrolling / besieging / engaged / scattered / destroyed / disbanded
- 无海军则只写表头不写数据行

## dynasty_tree
| person_id | display_name | generation | parents | spouse | inherited_from | inheritance_order | regency_for | successor | title | lifespan_chapters | notes |
- generation: 代数整数
- inheritance_order: 继承顺位整数
- 无王朝传承则只写表头不写数据行

## treasury_state
| faction | gold | grain | mercenary_budget | income_per_chapter | last_updated_chapter | notes |
- 所有数值为整数，单位自定
- 一个势力一行

=== SECTION: phase_outline ===

阶段纲——从 volume_map 的 OKR 分解出结构化的阶段目标。**阶段纲是死锁大纲和章纲之间的中间约束层**：卷纲锁死不可改，阶段纲锁死每个阶段的叙事目标（planner 在阶段内可自由编排章节，但必须确保所有目标达成），章纲是 planner 每章的具体规划。

**分阶段规则**：
- 每卷拆为 1-3 个阶段（根据 KR 数量和叙事复杂度），每阶段覆盖 5-15 章
- 每个阶段必须有 3-5 个**可验证的叙事目标**（不要写"变强"、"成长"，要写"拿到XX"、"揭露XX"、"与XX结盟"）
- 每个阶段必须标注**资源约束**（当前主角可用资源、允许的冲突规模）
- 每个阶段必须标注**tension**（张力曲线：升/平/降/升-平-升，描述本阶段的叙事张力走势）
- 每个阶段必须标注**mustPayoff**（本阶段必须回收的伏笔 ID 列表，从 pending_hooks 中挑选）
- 每个阶段必须标注**mustSetup**（本阶段必须埋设的新伏笔 ID 列表，为后续阶段做铺垫）
- 第一阶段 status 为 active，其余为 pending
- 如果有战争账本数据，在每个阶段的 war_ledger_snapshot 里标注当前关键势力状态

**输出格式**（严格 YAML，不要用 markdown 格式）：

phases:
  - id: 1
    title: "<阶段标题>"
    chapters: "X-Y"
    status: active
    tension: "升"
    mustPayoff: [H03, H07]
    mustSetup: [H12]
    narrative_goals:
      - "目标1（可验证的状态变更）"
      - "目标2"
      - "目标3"
    resource_constraints:
      - "主角可用资源：金XX，兵力XX"
      - "允许的冲突规模：个人级/门派内部/城邦级"
    war_ledger_snapshot:
      - "当前纪元：XX"
      - "主要势力：A(兵力XX), B(兵力XX)"
  - id: 2
    title: "<阶段标题>"
    chapters: "X-Y"
    status: pending
    tension: "平"
    mustPayoff: []
    mustSetup: [H15]
    narrative_goals:
      - "目标1"
    resource_constraints:
      - "约束1"
    war_ledger_snapshot:
      - "快照1"

**禁止事项**：
- 不要指定具体章号任务（"第17章做XX"）——阶段纲只定目标，章级规划是 planner 的职责
- 不要重复 volume_map 的散文内容——阶段纲是从 OKR 提取的结构化约束
- 每个阶段的 narrative_goals 必须从对应卷的 Key Results 分解而来，不能凭空编造

=== SECTION: chapter_skeleton ===

章纲骨架——从 volume_map + phase_outline 分解出逐章预排。**这是卷纲和 planner 之间的桥梁**：卷纲锁宏观，阶段纲锁目标，章纲骨架锁每章的核心事件和节奏。Planner 在骨架约束下展开为完整 memo，不再临场推导节奏。

**生成规则**：
- 每卷一个 markdown 表格，每行一章
- 黄金三章（第 1-3 章）必须逐章细化
- 其余章节可以 3-5 章为一组写摘要行（但每章仍占一行，group 行的目标写组级目标）
- 目标 ≤ 20 字，动词驱动（拿到/揭露/击败/脱身/建立/试探/潜入）
- 关键事件 ≤ 30 字，具体到人名、地点、动作
- hook 动作格式：open:Hxx / advance:Hxx / resolve:Hxx / defer:Hxx（多条逗号分隔）
- 情绪 ≤ 4 字（冷→微暖 / 撕裂 / 压抑→释放 / 沉→浮）
- 爽点行必须标注 ★（每 5-7 章至少一个）

**输出格式**（严格 markdown 表格）：

# 章纲骨架

## 卷一：入局（第1-40章）

| 章 | 目标 | 关键事件 | hook动作 | 情绪 |
|----|------|----------|----------|------|
| 1 | 苏衍通过外勤考核 | 第一次除妖任务，发现零妖力免疫 | open:H01 | 冷→微暖 |
| 2 | 展示金手指 | 用零妖力探测完成任务 | advance:H01 | 紧张→释放 |
| 3 | ★锁定短期目标 | 拿到母亲档案编号 | open:H02,H03 | 好奇→震动 |
| 4-6 | 积累信用 | 三次常规外勤任务 | advance:H01,H02 | 平稳 |
| ... | ... | ... | ... | ... |

**禁止事项**：
- 不要和 volume_map 的散文内容重复——骨架是结构化表格，不是散文摘要
- 不要写具体对话或描写指导——那是 planner 和 writer 的职责
- hook 动作中的 ID 必须来自 pending_hooks 中已定义的伏笔
- 每卷 OKR 中承诺的卷尾事件必须在骨架对应章号出现

## 最后强调
- 符合${book.platform}平台口味、${gp.name}题材特征
- 主角人设鲜明、行为边界清晰
- 伏笔前后呼应、配角有独立动机不是工具人
- **story_frame / volume_map / roles 必须是散文密度，不要退化成 bullet**
- **book_rules 只留 YAML，不要写散文**
- **不要输出 rhythm_principles 或 current_state 独立 section**——节奏原则合并进 volume_map 尾段；角色初始状态写在 roles.当前现状，初始钩子写在 pending_hooks（startChapter=0 行），环境/时代锚（仅历史/年代/都市重生等需要年份的题材）织进 story_frame.世界观底色，不要硬凑
- **pending_hooks 表必须包含 Phase 7 扩展列——depends_on 标出因果链、pays_off_in_arc 锁定回收大致位置、core_hook 标记主线承重伏笔（3-7 条）、half_life 仅给重点伏笔设置**

## 硬性完结检查（生成前读一遍）
必须依次输出全部 **9 个 SECTION 块**：story_frame → volume_map → roles → book_rules → pending_hooks → alliance_state → war_ledgers → phase_outline → chapter_skeleton，不允许因为 story_frame 或 volume_map 写长了就不写后面几段。哪怕 roles 只列 3 个角色、book_rules 只有 YAML 小块、pending_hooks 只有 3 行、alliance_state 和 war_ledgers 是空的（无势力/战争设定的题材）、phase_outline 只有 2 个阶段、chapter_skeleton 只有黄金三章细化，也要完整输出。只有写完 chapter_skeleton 最后一行才算交付。`;
}

/**
 * Build the English foundation system prompt.
 */
export function buildEnglishFoundationPrompt(book, gp, genreBody, contextBlock, reviewFeedbackBlock, numericalBlock, powerBlock, eraBlock) {
    return `You are the architect of this book. Your only job is to produce **prose-density foundation design** — not tables, not schema, not bullet lists. The book's aura comes from your prose density: Phase 3 planner reads sparse memos out of your volume_map only if it was written to chapter-level prose; the writer only produces living characters because your role sheets carry contrast details; the reviewer only catches hard errors because your story_frame set the tonal anchors.${contextBlock}${reviewFeedbackBlock}

## Book metadata
- Platform: ${book.platform}
- Genre: ${gp.name} (${book.genre})
- Target chapters: ${book.targetChapters}
- Chapter length: ${book.chapterWordCount}
- Title: ${book.title}

## Genre body
${genreBody}

## Output constraints
${numericalBlock}
${powerBlock}
${eraBlock}

## Output contract (8 === SECTION: === blocks)

## Deduplication rule (MANDATORY)
Do not duplicate the same fact across sections. The protagonist's arc lives only in roles; world hard-rules live only in story_frame; rhythm principles live only in the last paragraph of volume_map; character initial status lives only in roles.Current_State; initial hooks live only in pending_hooks (start_chapter=0 rows). **When the book is period fiction / historical fanfic / urban reincarnation** — anything pinned to a real year, season, or historic marker — weave the environment/era anchor into story_frame's world-tonal-ground paragraph (e.g. "July 1985, just after the SARS wave"). **For cultivation / high-fantasy / system genres that have no real-world year, skip it entirely** — do not fabricate an era anchor. If a section repeats content that belongs elsewhere, delete it.

## Output budget (over-budget means cut)
- story_frame ≤ 3000 chars
- volume_map ≤ 5000 chars
- roles ≤ 8000 chars total
- book_rules ≤ 500 chars (YAML only)
- pending_hooks ≤ 2000 chars

=== SECTION: story_frame ===

Four prose sections, ~600-900 chars each. No tables. No bullet lists. Real paragraphs. **Do NOT write the protagonist's full arc here** — that is owned by roles/主要角色/<protagonist>.md. Use a single-line pointer inside this block (e.g. "The protagonist is X; full arc lives in roles/主要角色/X.md").

## 01_Theme_and_Tonal_Ground
The first sentence of this paragraph MUST be a one-line summary (e.g., "Core proposition: an ordinary person who refuses to be good uses rationality to crush every survivor"). The rest unfolds in prose. The summary lets the reader grasp the core at a glance.
What is this book actually about — not "hero grows from weak to strong" (empty), but a concrete proposition. Then the tonal ground: warm / cold / fierce / severe — which, and why this and not another. End with a one-line pointer to the protagonist role file.

## 02_Core_Conflict_and_Foreground_Background_Story_Layers
The first sentence of this paragraph MUST be a one-line summary (e.g., "Main conflict: an institution that wants to keep its secrets vs. an individual determined to uncover the truth"). The rest unfolds in prose. The summary lets the reader grasp the conflict axis at a glance.
The book's main tension — not "good vs evil" but "because A believes X and B believes Y, they will inevitably collide on Z". At least two opponents: one visible, one structural/systemic. Opponents have their own logic.

**This section must explicitly write out the foreground story / background story layers**:
- **Foreground story**: the surface conflict the reader sees every chapter (cases, combat, leveling up, romance, business moves). Each volume / arc has its own visible goal and closure point.
- **Background story**: the hidden machine running through the whole book — the puppet master, conspiracy, origin secret, systemic oppression, fated curse. The reader assembles it from fragments; full payoff lands near the finale.

The two layers must be causally linked, not parallel universes — every foreground conflict should trace back to some gear of the background machine turning. **Foreground-only story collapses into a set of disconnected episodes with no forward pull; background-only story is suffocating and never delivers. Write both in prose here, and name how they interlock.**

## 03_World_Tonal_Ground (hard rules + sensory tone + book-specific rules)
The first sentence of this paragraph MUST be a one-line summary (e.g., "World hard-rules: spiritual energy is drying up, mortals cannot cultivate, only by devouring demon cores can one survive"). The rest unfolds in prose. The summary lets the reader grasp the world's foundation at a glance.
The world's operating rules. 3-5 unbreakable laws written as prose, not bullets. Sensory texture: wet or dry, fast or slow, noisy or quiet — give the writer an anchor. **This paragraph also absorbs the narrative prose that used to live in book_rules (narrative perspective, core conflict driver, book-specific rules).** Write them all here once. Do not repeat them in book_rules.

## 04_Endgame_Direction_and_Book_Objective
The first sentence of this paragraph MUST be a one-line summary (e.g., "Book Objective: rise from errand disciple to sect elder and publicly vindicate the parental case"). The rest unfolds in prose. The summary lets the reader grasp the endgame target at a glance.
What the last chapter roughly feels like. The final shot: where, doing what, around whom, thinking what. A distant target for every planner call downstream.

**End this paragraph with a one-sentence Book Objective** (the root of the recursive OKR outline): when this book is done, the protagonist must reach a **verifiable end-state** (e.g., "rise from errand disciple to sect elder and publicly vindicate the parental case", "go from undocumented migrant worker to running three fur-trade companies and personally putting the ex-husband in prison"). Do NOT use vague words like "grow stronger" or "take revenge" — write a concrete state an outside observer can check "achieved / not achieved". This Book Objective is the root of the full-book OKR outline; volume_map will decompose it per volume below.

=== SECTION: volume_map ===

Prose volume map, **5 sections + 1 closing rhythm paragraph**. **Critical requirement: stay at volume-level prose only** — specify each volume's theme, emotional curve, cross-volume hooks, character stage goals, and volume-end irreversible changes. **Do NOT prescribe chapter-level tasks** (no "chapter 17 sends him home"). Chapter planning is the Phase 3 planner's job; the architect builds the skeleton, not the chapter list.

## 01_Volume_Themes_and_Emotional_Curves
How many volumes? Each volume's theme in one sentence; each volume's emotional curve as a paragraph (where pressured, where rewarding, where cold, where warm). Not mechanical rotation.

## 02_Cross_Volume_Hooks_and_Payoff_Promises (cover BOTH foreground and background layers)
Volume 1 plants hook A, paid off in volume N; volume 2 plants hook B, paid off in volume M. Prose, not tables. **Stay at volume-level** (e.g., "the origin mystery planted in volume 1 pays off in volume 3"); do not specify chapter numbers.

**Hooks must cover BOTH foreground and background layers** (matching the two-layer story established in story_frame.02):
- Foreground hooks: short-range arc-level hooks (case mystery, opponent identity, resource grab), paid off within 1-2 volumes
- Background hooks: full-book main-line hooks (ultimate truth, origin, systemic secret), paid off near the finale. The 3-7 load-bearing ones are core_hook=true

**If this paragraph only carries foreground hooks with no background seeds, you have lost the book's forward pull axis. Add them.**

## 03_Per_Volume_OKRs (Objective + 3 Key Results)
Recursive OKR outline that decomposes the Book Objective (root O set at the end of story_frame.04): every volume must explicitly state:
- **Objective (volume-level goal)**: a **verifiable state** the protagonist must reach by volume end, one sentence, logically chained to the Book Objective (e.g., if Book O = "become sect elder and vindicate the parental case", then Vol 1 O = "move from errand disciple into the registered disciple roster and recover the first lead pointing to the truth")
- **Key Results (3 items, quantifiable / observable)**: three concrete sub-achievements whose completion can be checked by an outside observer (e.g., KR1 = "take over the pharmacy garden steward seat", KR2 = "lock in a stable alliance with Lingan Peak", KR3 = "uncover the first half-page fragment of the parental case file"). No vague KRs like "gets stronger" / "matures".

Supporting characters' stage changes (master dies end of vol 2, opponent breaks bad in vol 3) go as notes under the relevant KR. Stage only — full arc lives in roles. **The 3 KRs per volume are the direct input for the planner: once it sees 3 KRs for a volume, it paces chapter tasks at roughly one KR advanced every 3-5 chapters.**

## 04_Volume_End_Mandatory_Changes
Each volume's last chapter must contain an irreversible event. Prose, one paragraph per volume. **Write what must happen, not which chapter**.

**Causal chain rule (intra-volume):** Nodes within a volume must connect via "because…so…" (causation) or "but…however…" (turning point). Never use "then…and then…" (sequential listing). Weak causation produces filler; strong causation drives tight prose. Example:
- ❌ Weak: "Protagonist defeats Zhao heir, then goes to Treasure Pavilion, then meets mysterious elder, then elder teaches divine art."
- ✅ Strong: "Protagonist defeats Zhao heir, **causing** the Zhao clan to lock down the city markets. Desperate, the protagonist **is forced** to sneak into Treasure Pavilion, **where they stumble upon** the elder's heist. The elder attacks to silence them, **but accidentally** triggers the protagonist's latent backlash — they strike a deal."

## 05_Rhythm_Principles (concrete + universal)
**This is the single home for rhythm principles — no separate rhythm_principles section exists.** Output 6 rhythm principles. **At least 3 must be concretized for this book** (e.g., "every 5 chapters in the first 30, hit one small payoff"); the rest may stay as universal rules (e.g., "no deus ex machina", "plant the foreshadow 3-5 chapters before the climax"). A mix of concrete + universal is valid. Bad: "rhythm must balance tension and release". Good: "every 5 chapters in the first 30 carries a small payoff landing in the last 300 chars of the chapter". Cover (order flexible, substitutions of equal weight are allowed): (1) climax spacing, (2) breath frequency, (3) hook density, (4) information release pacing, (5) payoff rhythm, (6) relationship advancement — each 2-3 sentences.

If the external instructions specify content proportions (for example politics/romance 50/50 or career/relationship weighting), this paragraph must turn that into a full-book rhythm promise: which volumes lean toward which line, which line must be visible in every 3-5 chapter mini-cycle, and which line carries fallout after climaxes. Do not merely say "keep it balanced."

=== SECTION: roles ===

One-file-per-character prose. **The protagonist card is the single source of truth for the protagonist's arc** — story_frame no longer carries it, and writer/planner both read it here.

---ROLE---
tier: major
name: <character name>
---CONTENT---
## Core_Tags
(3-5 tags + one sentence on why those tags)

## Contrast_Detail
(1-2 concrete details that contradict the core tags — "ice-cold killer but leaves fish bones for stray cats". Contrast detail is the formula for character dimensionality.)

## Back_Story
(Prose paragraph — how this person became who they are. Key past only, keep it lean.)

## Protagonist_Arc (start → end → cost)
**Mandatory for the protagonist; optional for other majors with substantial arcs.** Where they start (identity, situation, core flaw, initial desire); where they land (who they become, what they gain or lose); the irreversible cost they pay for that landing. Show internal displacement, not just growth. This section absorbs what used to live in story_frame.02_Protagonist_Arc.

## Current_State (initial state at chapter 0)
(Where they are at chapter 0, what's on their mind, most recent worry. **Character-only**: initial hooks go in pending_hooks start_chapter=0 rows; environment / era anchors (when the genre has a real year) are woven into story_frame's world-tonal-ground paragraph. No separate current_state section is produced.)

## Relationship_Network
(With protagonist, with other major characters. One line each. Relationships are dynamic, not labels.)

## Inner_Driver
(What they want, why, what they're willing to pay.)

## Growth_Arc
(Internal displacement across the book. Can be short for non-protagonists.)

---ROLE---
tier: major
name: <next major>
---CONTENT---
...

(Aim for 2-3 majors + 2-3 supporting majors. Quality over quantity — do not pad.)

---ROLE---
tier: minor
name: <minor name>
---CONTENT---
(Simplified: only 4 sections — Core_Tags / Contrast_Detail / Current_State / Relationship_to_Protagonist, 1-2 lines each.)

(3-5 minors.)

### Mythological Archetype Reference (optional, strongly recommended)

When designing characters, consult the 45 mythological archetypes in references/archetypes_45.md. Each archetype provides: core concerns, core fears, core drives, how others see them, arc direction, strengths/weaknesses, shadow side, and best pairings.

How to use:
1. Pick 1 dominant archetype + 1-2 secondary archetypes for each major character. The dominant archetype defines the skeleton (core fear/desire/arc); secondary archetypes inject inner tension and contradictions (e.g., "King + Hermit" gives a ruler a withdrawal impulse; "Amazon + Nurturer" gives a warrior protective tenderness)
2. Tag all archetypes in the character card's Core_Tags (e.g., "King · Hermit", "Amazon · Nurturer")
3. Use the dominant archetype's fears/desires to enrich Inner_Driver; secondary archetype fears/desires serve as "hidden drivers" or "fallback under pressure"
4. Use the dominant archetype's shadow side for dark moments; secondary shadows can be a "second collapse path"
5. Use "best pairings" to guide relationship tension design
6. Each secondary archetype must have at least one observable behavior in a planned scene — if not, remove it. Secondary archetypes are not decoration

Do not mechanically copy archetypes — archetypes are skeletons, not molds.

=== SECTION: book_rules ===

**Output ONLY the YAML frontmatter block — zero prose.** All narrative guidance (perspective, book-specific rules, core conflict driver) has moved into story_frame.03_World_Tonal_Ground. Do not repeat it here.
\`\`\`
---
version: "1.0"
protagonist:
  name: (protagonist name)
  personalityLock: [(3-5 personality keywords)]
  behavioralConstraints: [(3-5 behavioral constraints)]
genreLock:
  primary: ${book.genre}
  forbidden: [(2-3 forbidden style intrusions)]
${gp.numericalSystem ? `numericalSystemOverrides:
  hardCap: (decide from setting)
  resourceTypes: [(core resource types)]` : ""}
prohibitions:
  - (3-5 book-specific prohibitions)
chapterTypesOverride: []
fatigueWordsOverride: []
additionalAuditDimensions: []
enableFullCastTracking: false
---
\`\`\`

=== SECTION: pending_hooks ===

Initial hook pool (Markdown table), Phase 7 extended columns:
| hook_id | start_chapter | type | status | last_advanced_chapter | expected_payoff | payoff_timing | depends_on | pays_off_in_arc | core_hook | half_life | notes |

Rules:
- Column 5 is a pure chapter number, not narrative description
- At book creation all planned hooks have last_advanced_chapter = 0
- Column 7 must be: immediate / near-term / mid-arc / slow-burn / endgame
- Column 8 (depends_on): upstream hook ids that must be planted / paid off before this one fires, formatted [H003, H007]; write "none" if no upstream
- Column 9 (pays_off_in_arc): free-form prose on where this hook is scheduled to pay off (e.g. "mid of volume 2", "right before the finale"). NOT parsed into chapter numbers
- Column 10 (core_hook): true / false. Core hooks are main-line load-bearing (central mystery, identity, key promise). A book typically has 3-7 cores; everything else is false
- Column 11 (half_life): optional integer chapters. If blank, derived from payoff_timing (immediate/near-term = 10, mid-arc = 30, slow-burn/endgame = 80)
- Put initial signal text in notes, not column 5
- **Initial world / alliance state**: any load-bearing initial condition ("protagonist carries the father's notebook", "the regime already watches the harbor") can be seeded as a start_chapter=0 row with a note-column tag indicating its initial-state nature.

=== SECTION: alliance_state ===

Initial factions and diplomatic relations (Markdown tables). **If the book has no faction/political structure (e.g. pure romance, slice-of-life), emit an empty section header only — do not fabricate factions.**

4 sub-tables, each under a \`## \` heading:

## Factions
| faction_id | name | faction_type | parent_faction | members | leader | status | notes |
- faction_type: nation / organization / alliance / subfaction / rebellion
- members: comma-separated character names
- status: active / dissolved / dormant

## Diplomatic Relations
| factionA | factionB | state | nominal_state | trust_level | notes |
- state: allied / neutral / tense / hostile / at_war / vassal / ceasefire / rebellion
- nominal_state: nominal state (for double-agent scenarios, e.g. surface-allied actually hostile); leave blank if none
- trust_level: integer -100 to 100; leave blank if none

## Faction Events
| event_id | chapter | type | factions | description | impact |
- chapter: initial events all use 0
- type: alliance / betrayal / war_declaration / ceasefire / coup / custom

## Personnel Movement
| event_id | chapter | character | type | from_faction | to_faction | description |
- type: join / leave / betray / defect / expelled / rebel / usurp / purge / assassinate
- chapter: initial events all use 0

=== SECTION: war_ledgers ===

Initial war/faction ledgers (10 Markdown tables). **If the book has no war/military/faction concepts (e.g. pure romance, slice-of-life), emit empty section headers only — do not fabricate data.** Books with faction settings must fill these tables based on alliance_state.

Each sub-table under a \`## \` heading, headers must match exactly:

## military_forces
| force_id | faction | commander | troop_count | unit_composition | morale | supplies | location | status | last_updated_chapter | notes |
- status: mobilized / deployed / garrison / routed / disbanded
- last_updated_chapter: initial value 0

## war_theater
| theater_id | war_name | belligerents | start_chapter | front_line | strategic_objective | scale | status | outcome | last_updated_chapter | notes |
- belligerents: comma-separated faction names
- scale: skirmish / campaign / total_war
- status: active / stalemate / ceasefire / concluded
- If no war initially, only write headers with no data rows

## battle_log
| battle_id | chapter | theater_id | battle_name | belligerents | commanders | forces_engaged | terrain | outcome | casualties_attacker | casualties_defender | strategic_shift | notes |
- outcome: A_decisive / A_pyrrhic / B_decisive / B_pyrrhic / stalemate / A_retreat / B_retreat
- If no battles initially, only write headers with no data rows

## territory_control
| territory_id | name | type | controller | contested_by | strategic_value | control_since_chapter | garrison_force | notes |
- type: city / fort / pass / mine / port / region / capital
- strategic_value: 0-10
- contested_by: comma-separated faction names (leave blank if no contest)

## relationship_graph
| character_a | character_b | types | status | trust | loyalty | since_chapter | notes |
- types: comma-separated, from blood/marriage/political/military/mentor/romantic/rivalry/vassal/sibling
- status: active / dissolved / strained / broken / restored
- trust / loyalty: integer -100 to 100

## era_mood
| era_id | era_name | start_chapter | prosperity | war | stability | innovation | decay | faith | mood | notes |
- prosperity/war/stability/innovation/decay: integer 0-100
- faith: optional, integer 0-100

## epoch_timeline
| epoch_id | phase_name | start_chapter | end_chapter | dominant_powers | key_event | era_mood_snapshot | notes |
- end_chapter: leave blank if current epoch hasn't ended
- dominant_powers: comma-separated faction names

## naval_forces
| fleet_id | faction | admiral | ship_count | ship_types | naval_supremacy | morale | home_port | status | last_updated_chapter | notes |
- naval_supremacy: 0-100
- status: docked / patrolling / besieging / engaged / scattered / destroyed / disbanded
- If no navy, only write headers with no data rows

## dynasty_tree
| person_id | display_name | generation | parents | spouse | inherited_from | inheritance_order | regency_for | successor | title | lifespan_chapters | notes |
- generation: integer generation number
- inheritance_order: integer succession order
- If no dynasty inheritance, only write headers with no data rows

## treasury_state
| faction | gold | grain | mercenary_budget | income_per_chapter | last_updated_chapter | notes |
- All values are integers, units self-defined
- One row per faction

=== SECTION: phase_outline ===

Phase outline — structured phase objectives decomposed from volume_map OKRs. **The phase outline is the intermediate constraint layer between the locked volume outline and the free chapter outline**: the volume outline is locked and cannot be changed; the phase outline locks each phase's narrative objectives (the planner can freely arrange chapters within a phase, but must ensure all objectives are met); the chapter outline is the planner's per-chapter planning.

**Phasing rules**:
- Split each volume into 1-3 phases (based on KR count and narrative complexity), each covering 5-15 chapters
- Each phase must have 3-5 **verifiable narrative objectives** (not "gets stronger" or "matures", but "obtains XX", "reveals XX", "allies with XX")
- Each phase must note **resource constraints** (protagonist's available resources, allowed conflict scale)
- Each phase must note **tension** (tension curve: rising/flat/falling/rising-flat-rising, describing this phase's narrative tension trajectory)
- Each phase must note **mustPayoff** (hook IDs that must be paid off this phase, selected from pending_hooks)
- Each phase must note **mustSetup** (new hook IDs that must be planted this phase, to prepare for later phases)
- First phase status is active, rest are pending
- If war ledger data exists, note current key faction states in each phase's war_ledger_snapshot

**Output format** (strict YAML, not markdown):

phases:
  - id: 1
    title: "<phase title>"
    chapters: "X-Y"
    status: active
    tension: "rising"
    mustPayoff: [H03, H07]
    mustSetup: [H12]
    narrative_goals:
      - "Goal 1 (verifiable state change)"
      - "Goal 2"
      - "Goal 3"
    resource_constraints:
      - "Protagonist available: gold XX, troops XX"
      - "Allowed conflict scale: personal / sect-internal / city-level"
    war_ledger_snapshot:
      - "Current epoch: XX"
      - "Major factions: A(troops XX), B(troops XX)"
  - id: 2
    title: "<phase title>"
    chapters: "X-Y"
    status: pending
    tension: "flat"
    mustPayoff: []
    mustSetup: [H15]
    narrative_goals:
      - "Goal 1"
    resource_constraints:
      - "Constraint 1"
    war_ledger_snapshot:
      - "Snapshot 1"

**Prohibitions**:
- Do not prescribe chapter-level tasks ("chapter 17 does XX") — the phase outline only sets objectives; chapter planning is the planner's job
- Do not repeat volume_map prose — the phase outline is structured constraints extracted from OKRs
- Each phase's narrative_goals must decompose from the corresponding volume's Key Results; do not invent them

=== SECTION: chapter_skeleton ===

Chapter skeleton — per-chapter beats decomposed from volume_map + phase_outline. **This is the bridge between the volume outline and the planner**: the volume outline locks the macro, the phase outline locks objectives, and the chapter skeleton locks each chapter's core event and pacing. The planner expands within skeleton constraints instead of improvising rhythm on the fly.

**Generation rules**:
- One markdown table per volume, one row per chapter
- Golden opening chapters (1-3) must be detailed per-chapter
- Remaining chapters may use 3-5 chapter group summaries (but each chapter still occupies one row; group rows use group-level goals)
- Goal ≤ 10 words, verb-driven (obtain/reveal/defeat/escape/establish/infiltrate)
- Key event ≤ 20 words, specific to character name, location, action
- Hook actions: open:Hxx / advance:Hxx / resolve:Hxx / defer:Hxx (comma-separated for multiple)
- Emotion ≤ 3 words (cold→warm / torn / suppressed→release / sink→rise)
- Climax rows must be marked with ★ (at least one every 5-7 chapters)

**Output format** (strict markdown table):

# Chapter Skeleton

## Volume 1: Entry (Ch.1-40)

| Ch | Goal | Key Event | Hook Action | Emotion |
|----|------|-----------|-------------|---------|
| 1 | Pass field agent exam | First demon hunt, discovers zero-demon-power immunity | open:H01 | cold→warm |
| 2 | Demonstrate power | Complete task with zero-demon detection | advance:H01 | tense→release |
| 3 | ★ Lock short-term goal | Obtain mother's file number | open:H02,H03 | curious→shock |
| 4-6 | Build credit | Three routine field missions | advance:H01,H02 | steady |
| ... | ... | ... | ... | ... |

**Prohibitions**:
- Do not duplicate volume_map prose — the skeleton is a structured table, not a prose summary
- Do not write specific dialogue or descriptive guidance — that is the planner and writer's job
- Hook action IDs must reference hooks defined in pending_hooks
- Volume-end events promised in volume_map OKRs must appear at the corresponding chapter number in the skeleton

## Final emphasis
- Match ${book.platform} platform taste and ${gp.name} genre characteristics
- Protagonist persona vivid, behavioral boundaries clear
- Foreshadowing echoes前后, supporting characters have independent motives — not tool people
- **story_frame / volume_map / roles must be prose-density — do not degrade to bullets**
- **book_rules keeps only YAML — no prose**
- **Do not output rhythm_principles or current_state as independent sections** — rhythm principles merge into volume_map's closing paragraph; character initial state goes in roles.Current_State; initial hooks go in pending_hooks (start_chapter=0 rows); environment/era anchors (only for historical/period/urban-reincarnation genres that need years) weave into story_frame's world-tonal-ground paragraph — do not force it
- **pending_hooks table must include Phase 7 extended columns — depends_on marks causal chains, pays_off_in_arc locks approximate payoff position, core_hook marks main-line load-bearing hooks (3-7 per book), half_life only for key hooks**

## Hard completion check (read before generating)
Must output all **9 SECTION blocks** in order: story_frame → volume_map → roles → book_rules → pending_hooks → alliance_state → war_ledgers → phase_outline → chapter_skeleton. Do not skip later sections because story_frame or volume_map ran long. Even if roles only lists 3 characters, book_rules is just a YAML snippet, pending_hooks has only 3 rows, alliance_state and war_ledgers are empty (genres without factions/war), phase_outline has only 2 phases, chapter_skeleton only has golden opening details — still output everything completely. Only when chapter_skeleton's last line is written is the delivery complete.`;
}

/**
 * Build the revise prompt for existing book foundation updates.
 */
export function buildRevisePrompt(reviseFrom) {
    return `\n\n## 既有架构稿修订模式
你在把一本已有书的架构稿从条目式升级为当前的段落式架构稿 + 一人一卡角色目录；如果它已经是 Phase 5 结构，则按用户反馈二次重写。

原书信息（这是权威内容，必须完整保留其中的世界观、角色、主线、伏笔和语气）：

【story_bible / story_frame 全文】
${reviseFrom.storyBible || "（无）"}

【volume_outline / volume_map 全文】
${reviseFrom.volumeOutline || "（无）"}

【book_rules 全文】
${reviseFrom.bookRules || "（无）"}

【character_matrix / roles 全文】
${reviseFrom.characterMatrix || "（无）"}

你的任务：
1. 把现有内容重新组织成当前 7 段 SECTION：story_frame / volume_map / roles / book_rules / pending_hooks / alliance_state / war_ledgers
2. story_frame 使用段落式世界观与核心冲突，不要退回条目表格
3. volume_map 使用段落式卷/章级方向，并把节奏原则放进末段
4. roles 必须按一人一卡输出，主要/次要角色判断沿用原内容，缺失才按主线重要性推断
5. pending_hooks 必须保留原有未回收伏笔，不要因为重写架构稿而清空
6. 不要改动已写章节的运行时事实，不要重置 current_state / pending_hooks 之外的运行时日志

用户额外要求：
${reviseFrom.userFeedback || "（无）"}
`;
}
