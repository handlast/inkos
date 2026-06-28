/**
 * Structural AI-tell detection — pure rule-based analysis (no LLM).
 *
 * Detects patterns common in AI-generated web-fiction prose:
 * - dim 20: Paragraph length uniformity / telegraph paragraphing
 * - dim 21: Filler, hedge, and expository-report density
 * - dim 22: Formulaic transition patterns
 * - dim 23: List-like structure and dialogue voice collapse
 * - dim 24: Web novel AI clichés
 * - dim 25: Narrative Density Factor
 */

export type AITellLanguage = "zh" | "en";

export interface AITellIssue {
  readonly severity: "critical" | "warning" | "info";
  readonly category: string;
  readonly description: string;
  readonly suggestion: string;
}

export interface AITellResult {
  readonly issues: AITellIssue[];
}

const HEDGE_WORDS: Record<AITellLanguage, ReadonlyArray<string>> = {
  zh: ["似乎", "可能", "或许", "大概", "某种程度上", "一定程度上", "在某种意义上",
    "仿佛", "好像", "犹如", "宛如", "恍若", "依稀", "隐约", "似乎在暗示"],
  en: ["seems", "seemed", "perhaps", "maybe", "apparently", "in some ways", "to some extent",
    "as if", "as though", "somewhat", "rather", "quite", "fairly"],
};

const TRANSITION_WORDS: Record<AITellLanguage, ReadonlyArray<string>> = {
  zh: ["然而", "不过", "与此同时", "另一方面", "尽管如此", "话虽如此", "但值得注意的是",
    "不仅如此", "更重要的是", "事实上", "显然", "毫无疑问", "不言而喻"],
  en: ["however", "meanwhile", "on the other hand", "nevertheless", "even so", "still",
    "moreover", "furthermore", "in addition", "what is more", "needless to say"],
};

const REPORT_TONE_PATTERNS: Record<AITellLanguage, ReadonlyArray<RegExp>> = {
  zh: [
    /这(?:就)?意味着/g,
    /换句话说/g,
    /从(?:某种|这个|这一|叙事|情绪)意义上/g,
    /问题(?:的)?关键(?:在于|是)/g,
    /核心(?:在于|是)/g,
    /本质(?:上|是|在于)/g,
    /显然/g,
    /事实上/g,
    /更重要的是/g,
    /值得注意的是/g,
  ],
  en: [
    /\bthis means\b/gi,
    /\bin other words\b/gi,
    /\bthe key is\b/gi,
    /\bat its core\b/gi,
    /\bin essence\b/gi,
    /\bit is important to note\b/gi,
    /\bmore importantly\b/gi,
  ],
};

const ABSTRACT_CONCLUSION_PATTERNS: Record<AITellLanguage, ReadonlyArray<RegExp>> = {
  zh: [
    /这一刻[^。！？\n]{0,24}(?:明白|意识到|懂得)/g,
    /(?:他|她|他们|所有人)[^。！？\n]{0,18}(?:终于|才)?(?:明白|意识到)[^。！？\n]{0,32}(?:真正|核心|本质|意义)/g,
    /(?:命运|时代|世界|真相)[^。！？\n]{0,18}(?:露出|展开|显露)(?:了)?(?:獠牙|真容|轮廓)/g,
  ],
  en: [
    /\bin that moment\b[^.!?\n]{0,80}\b(?:understood|realized)\b/gi,
    /\b(?:truth|fate|world)[^.!?\n]{0,60}\b(?:revealed|showed)\b[^.!?\n]{0,30}\b(?:itself|its teeth|its face)\b/gi,
  ],
};

const WEBNOVEL_AI_CLICHES: Record<AITellLanguage, ReadonlyArray<RegExp>> = {
  zh: [
    /嘴角(?:微微|轻轻|缓缓|淡淡)?(?:上扬|勾起|扬起|翘起)/g,
    /眼中(?:闪过|掠过|闪过一丝|浮现出)(?:一丝|一抹|一道|几分)?(?:惊讶|震惊|玩味|精光|寒芒|杀意|笑意|惊讶|凝重|深邃)/g,
    /眉头(?:微微|轻轻|缓缓)?(?:一皱|一挑|紧锁|微蹙)/g,
    /他(?:内心|心中|心底)(?:深知|明白|清楚|明白|暗想|暗道)/g,
    /(?:他|她)(?:深知|非常清楚|心知肚明|了然于胸)/g,
    /命运的齿轮(?:开始转动|缓缓转动|再次转动)/g,
    /(?:一场|这是一场)(?:前所未有|惊天动地|惊世骇俗|史无前例)(?:的)?(?:风暴|浩劫|变局|大戏)/g,
    /恐怖如斯/g,
    /(?:这|那)(?:恐怖|可怕|惊人|恐怖至极|骇人听闻)(?:的)?(?:实力|力量|威压|气息|手段)/g,
    /(?:这|那)(?:究竟|到底)(?:是|是什么)(?:何等|怎样|多么)(?:恐怖|可怕|强大|逆天|妖孽)(?:的)?(?:存在|实力|力量|手段)/g,
    /(?:简直|根本|完全)(?:就是|不是)(?:人|凡人|普通人)(?:能|可以|应该)(?:做到|想象|理解|企及)(?:的|了)/g,
    /(?:一道|一股|一抹|一丝)(?:恐怖|可怕|惊人|庞大|磅礴|浩瀚|无尽|滔天)(?:的)?(?:力量|气息|威压|能量|气势|杀意|战意)/g,
    /(?:缓缓|慢慢|淡淡|轻轻)(?:吐出|说出|开口|道出|吐出了|说出了一句)/g,
    /(?:冷冷|淡淡|轻轻|微微|缓缓)(?:一笑|一笑道|说道|开口道|道)/g,
    /(?:这意味着|换句话说|从某种意义上说|问题的关键在于|核心在于|本质上)/g,
    /(?:所有人|众人|在场的人|周围的人)(?:都)?(?:倒吸一口凉气|目瞪口呆|震惊不已|一片哗然|鸦雀无声)/g,
    /(?:突破|晋升|踏入|迈入|进入)(?:了)?(?:(?:新的|更高的|更高层次的|更强大的)(?:境界|层次|领域|阶段))/g,
    /(?:顿时|立刻|马上|瞬间|刹那间)(?:就)?(?:明白|意识到|感受到|察觉到|醒悟|反应过来)(?:了)/g,
  ],
  en: [
    /\b(?:his|her)\b[^.!?\n]{0,40}\b(?:lips|mouth|corner of (?:his|her) mouth)\b[^.!?\n]{0,30}\b(?:curved|twitched|quirked|lifted|slight smile)\b/gi,
    /\b(?:his|her)\b[^.!?\n]{0,40}\beyes\b[^.!?\n]{0,30}\b(?:flashed|flickered|gleamed|glinted|darkened)\b/gi,
    /\b(?:he|she)\b[^.!?\n]{0,30}\b(?:knew all too well|was well aware|understood deeply|realized acutely)\b/gi,
    /\bwheels? of fate\b/gi,
    /\bfate's (?:wheel|gear|cog)\b/gi,
    /\ban? (?:unprecedented|earth-shattering|world-ending|incomprehensible)\b/gi,
    /\b(?:slowly|gently|coldly|lightly)\b[^.!?\n]{0,20}\b(?:spoke|uttered|said|murmured|whispered)\b/gi,
    /\beveryone (?:gasped|stared|gaped|was stunned|fell silent|exclaimed)\b/gi,
  ],
};

export function analyzeAITells(content: string, language: AITellLanguage = "zh"): AITellResult {
  const issues: AITellIssue[] = [];
  const isEnglish = language === "en";
  const lang: AITellLanguage = isEnglish ? "en" : "zh";
  const joiner = isEnglish ? ", " : "、";

  const paragraphs = extractParagraphs(content);

  // dim 20: Paragraph length uniformity (needs >=3 paragraphs)
  if (paragraphs.length >= 3) {
    const paragraphLengths = paragraphs.map((p) => p.length);
    const mean = paragraphLengths.reduce((a, b) => a + b, 0) / paragraphLengths.length;
    if (mean > 0) {
      const variance = paragraphLengths.reduce((sum, l) => sum + (l - mean) ** 2, 0) / paragraphLengths.length;
      const stdDev = Math.sqrt(variance);
      const cv = stdDev / mean;
      if (cv < 0.15) {
        issues.push({
          severity: paragraphs.length >= 8 && cv < 0.08 ? "critical" : "warning",
          category: isEnglish ? "Paragraph uniformity" : "段落等长",
          description: isEnglish
            ? `Paragraph-length coefficient of variation is only ${cv.toFixed(3)} (threshold <0.15), which suggests unnaturally uniform paragraph sizing`
            : `段落长度变异系数仅${cv.toFixed(3)}（阈值<0.15），段落长度过于均匀，呈现AI生成特征`,
          suggestion: isEnglish
            ? "Increase paragraph-length contrast: use shorter beats for impact and longer blocks for immersive detail"
            : "增加段落长度差异：短段落用于节奏加速或冲击，长段落用于沉浸描写",
        });
      }
    }
  }

  issues.push(...detectTelegraphParagraphs(paragraphs, lang));

  // dim 21: Hedge word density
  const totalChars = content.length;
  if (totalChars > 0) {
    const hedgeCount = countWords(content, HEDGE_WORDS[lang], isEnglish);
    const hedgeDensity = hedgeCount / (totalChars / 1000);
    if (hedgeDensity > 3) {
      issues.push({
        severity: hedgeDensity > 6 ? "critical" : "warning",
        category: isEnglish ? "Hedge density" : "套话密度",
        description: isEnglish
          ? `Hedge-word density is ${hedgeDensity.toFixed(1)} per 1k characters (threshold >3), making the prose sound overly tentative`
          : `套话词（似乎/可能/或许等）密度为${hedgeDensity.toFixed(1)}次/千字（阈值>3），语气过于模糊犹豫`,
        suggestion: isEnglish
          ? "Replace hedges with firmer narration: remove vague qualifiers and use concrete detail instead"
          : "用确定性叙述替代模糊表达：去掉「似乎」直接描述状态，用具体细节替代「可能」",
      });
    }

    const reportTone = countPatternMatches(content, REPORT_TONE_PATTERNS[lang]);
    const reportDensity = reportTone.count / (totalChars / 1000);
    if (reportDensity > 3) {
      issues.push({
        severity: reportDensity > 5 ? "critical" : "warning",
        category: isEnglish ? "Expository report tone" : "说明书腔",
        description: isEnglish
          ? `Expository/report phrases appear ${reportDensity.toFixed(1)} times per 1k characters: ${reportTone.samples.join(joiner)}`
          : `说明书/分析报告式短语密度为${reportDensity.toFixed(1)}次/千字：${reportTone.samples.join(joiner)}`,
        suggestion: isEnglish
          ? "Replace abstract explanation with scene evidence: action, object, pressure, reaction, or dialogue."
          : "删掉抽象说明，把信息改成现场证据：动作、物件、压力、反应或对话。",
      });
    }

    const conclusions = countPatternMatches(content, ABSTRACT_CONCLUSION_PATTERNS[lang]);
    if (conclusions.count >= 2) {
      issues.push({
        severity: conclusions.count >= 4 ? "critical" : "warning",
        category: isEnglish ? "Abstract conclusion beats" : "空泛结论句",
        description: isEnglish
          ? `Found ${conclusions.count} abstract conclusion beat(s): ${conclusions.samples.join(joiner)}`
          : `发现${conclusions.count}处抽象结论式情绪/命运句：${conclusions.samples.join(joiner)}`,
        suggestion: isEnglish
          ? "Let the reader infer the conclusion from a decision, cost, physical reaction, or changed relationship."
          : "用决策、代价、身体反应或关系变化让读者自己得出结论。",
      });
    }
  }

  // dim 22: Formulaic transition repetition
  const transitionCounts: Record<string, number> = {};
  for (const word of TRANSITION_WORDS[lang]) {
    const regex = new RegExp(escapeRegExp(word), isEnglish ? "gi" : "g");
    const matches = content.match(regex);
    const count = matches?.length ?? 0;
    if (count > 0) {
      transitionCounts[isEnglish ? word.toLowerCase() : word] = count;
    }
  }
  const repeatedTransitions = Object.entries(transitionCounts)
    .filter(([, count]) => count >= 3);
  if (repeatedTransitions.length > 0) {
    const totalRepeated = repeatedTransitions.reduce((sum, [, count]) => sum + count, 0);
    const detail = repeatedTransitions
      .map(([word, count]) => `"${word}"×${count}`)
      .join(joiner);
    issues.push({
      severity: totalRepeated >= 7 ? "critical" : "warning",
      category: isEnglish ? "Formulaic transitions" : "公式化转折",
      description: isEnglish
        ? `Transition words repeat too often: ${detail}. Reusing the same transition pattern 3+ times creates a formulaic AI texture`
        : `转折词重复使用：${detail}。同一转折模式≥3次暴露AI生成痕迹`,
      suggestion: isEnglish
        ? "Let scenes pivot through action, timing, or viewpoint shifts instead of repeating the same transitions"
        : "用情节自然转折替代转折词，或换用不同的过渡手法（动作切入、时间跳跃、视角切换）",
    });
  }

  // dim 23: List-like structure
  const sentences = content
    .split(isEnglish ? /[.!?\n]/ : /[。！？\n]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 2);
  if (sentences.length >= 3) {
    let consecutiveSamePrefix = 1;
    let maxConsecutive = 1;
    for (let i = 1; i < sentences.length; i++) {
      const prevPrefix = isEnglish
        ? sentences[i - 1].split(/\s+/)[0]?.toLowerCase() ?? ""
        : sentences[i - 1].slice(0, 2);
      const currPrefix = isEnglish
        ? sentences[i].split(/\s+/)[0]?.toLowerCase() ?? ""
        : sentences[i].slice(0, 2);
      if (prevPrefix === currPrefix) {
        consecutiveSamePrefix++;
        maxConsecutive = Math.max(maxConsecutive, consecutiveSamePrefix);
      } else {
        consecutiveSamePrefix = 1;
      }
    }
    if (maxConsecutive >= 3) {
      issues.push({
        severity: maxConsecutive >= 5 ? "warning" : "info",
        category: isEnglish ? "List-like structure" : "列表式结构",
        description: isEnglish
          ? `Detected ${maxConsecutive} consecutive sentences with the same opening pattern, creating a list-like generated cadence`
          : `检测到${maxConsecutive}句连续以相同开头的句子，呈现列表式AI生成结构`,
        suggestion: isEnglish
          ? "Vary how sentences open: change subject, timing, or action entry to break the list effect"
          : "变换句式开头：用不同主语、时间词、动作词开头，打破列表感",
      });
    }
  }

  issues.push(...detectDialogueVoiceCollapse(content, lang));
  issues.push(...detectWebnovelCliches(content, lang));
  issues.push(...detectNarrativeDensity(content, lang));

  return { issues };
}

function detectWebnovelCliches(content: string, language: AITellLanguage): AITellIssue[] {
  const isEnglish = language === "en";
  const lang: AITellLanguage = isEnglish ? "en" : "zh";
  const cliches = WEBNOVEL_AI_CLICHES[lang];
  if (!cliches) return [];
  const issues: AITellIssue[] = [];
  const samples: string[] = [];
  let totalCount = 0;
  for (const pattern of cliches) {
    const matches = content.match(pattern);
    if (!matches) continue;
    totalCount += matches.length;
    for (const m of matches.slice(0, 2)) {
      if (samples.length < 8 && !samples.includes(m)) {
        samples.push(`"${m}"`);
      }
    }
  }
  const joiner = isEnglish ? ", " : "、";
  if (totalCount >= 3) {
    const severity = totalCount >= 6 ? "critical" : "warning";
    issues.push({
      severity,
      category: isEnglish ? "Web novel AI clichés" : "网文AI废话",
      description: isEnglish
        ? `Found ${totalCount} web novel AI cliché(s): ${samples.join(joiner)}. These phrases are hallmarks of AI-generated web fiction prose.`
        : `发现${totalCount}处网文AI废话：${samples.join(joiner)}。这些表达是AI生成网文的典型标志。`,
      suggestion: isEnglish
        ? "Replace clichéd expressions with character-specific physical reactions, concrete sensory details, or dialogue that reveals personality."
        : "用角色独有的身体反应、具体感官细节或能体现性格的对话替代这些套话。",
    });
  }
  return issues;
}

function detectNarrativeDensity(content: string, language: AITellLanguage): AITellIssue[] {
  const isEnglish = language === "en";
  const lang: AITellLanguage = isEnglish ? "en" : "zh";
  const issues: AITellIssue[] = [];

  const actionPatterns: Record<AITellLanguage, RegExp> = {
    zh: /(?:他|她|我|对方|那人|这人|主角|少年|少女|男人|女人|老者|青年|汉子|女子)[^。！？\n]{0,12}(?:走|跑|拿|握|踢|砍|推|拉|坐|站|跳|打|砸|扔|抓|拔|抽|挥|刺|劈|挡|闪|躲|滚|扑|踹|踩|踏|摔|跌|爬|攀|翻|跃|冲|闯|撞|碰|触|摸|按|压|撕|扯|拽|拖|举|抬|撑|扶|抱|搂|掐|捏|拍|敲|捶|戳|捅|割|切|斩|削|剪|拔剑|拔刀|出拳|出手|出剑|挥剑|挥刀|格挡|后退|上前|转身|回头|俯身|仰头|侧身|弯腰|跪下|蹲下|起身|飞起|跃起|跳下|跑出|跑进|走出|走进|冲出|冲进|退回|踏上|跨过|翻身)/g,
    en: /\b(?:he|she|I|they|the (?:man|woman|figure|guard|warrior|girl|boy|child|elder|soldier|knight|assassin|merchant|king|queen|prince|princess|lord|lady|captain|general|mage|wizard|witch|demon|dragon|beast|monster))\b[^.!?\n]{0,30}\b(?:walked|ran|grabbed|seized|held|kicked|struck|pushed|pulled|sat|stood|jumped|leaped|lunged|dashed|charged|swung|slashed|thrust|stabbed|dodged|ducked|rolled|dove|climbed|crawled|sprinted|rushed|stormed|turned|spun|knelt|crouched|lifted|dropped|threw|caught|gripped|squeezed|slammed|smashed|crushed|tore|ripped|dragged|pulled|shoved|punched|kicked|struck|hit|smashed|broke|cracked|shattered|drew|sheathed|aimed|fired|shot|cast|summoned|invoked|chanted|whispered|muttered|growled|snarled|roared|shouted|screamed|yelled|cried|wept|laughed|smiled|grinned|sneered|scowled|frowned|grimaced|winced|flinched|recoiled|retreated|advanced|charged|rushed|sprinted|dashed|leaped|jumped|vaulted|climbed|scaled|descended|ascended|fell|dropped|collapsed|stumbled|tripped|slipped|slid|crawled|crept|sneaked|tiptoed|marched|paraded|patrolled|wandered|roamed|strode|paced|staggered|limped|hobbled|shuffled|plodded|trudged|marched)/gi,
  };
  const actionMatches = content.match(actionPatterns[lang]) ?? [];
  const actionBeats = actionMatches.length;

  const detailPatterns: Record<AITellLanguage, RegExp> = {
    zh: /(?:看到|听到|闻到|尝到|触到|感到|感觉到|察觉到|注意到|发现|看见|望见|瞥见|瞅见|瞧见|瞄见|窥见|闻到|嗅到|听到|传来|响起|发出|闪着|闪出|闪现出|映入|映照|照耀|照亮|笼罩|弥漫|飘散|散发|散发出|散发着)/g,
    en: /\b(?:saw|heard|smelled|tasted|felt|noticed|spotted|caught|glimpsed|watched|observed|perceived|sensed|detected|discovered|found|noted|registered|recognized|identified|discerned|made out|picked up|listened|sniffed|breathed|inhaled|exhaled|touched|brushed|grazed|traced|pressed|prodded|poked|tapped|knocked|rattled|shook|vibrated|trembled|quaked|echoed|resounded|rang|hummed|buzzed|crackled|popped|snapped|creaked|groaned|moaned|sighed|whispered|murmured|hissed|sizzled|sputtered|flickered|gleamed|glinted|sparkled|shimmered|glowed|blazed|flared|dazzled|blinded|dimmed|darkened|shadowed|outlined|silhouetted|framed|reflected|mirrored|projected|displayed|revealed|exposed|uncovered|unveiled|showed|presented|exhibited|demonstrated|illustrated|depicted|portrayed|rendered|painted|drawn|sketched|traced|etched|engraved|carved|inscribed|marked|stained|smeared|splattered|spattered|dripped|trickled|flowed|poured|streamed|gushed|spurted|spilled|leaked|seeped|soaked|saturated|drenched|moistened|dampened|wetted|misted|fogged|clouded|obscured|concealed|hidden|buried|covered|wrapped|shrouded|veiled|masked|disguised|camouflaged)\b/gi,
  };
  const detailMatches = content.match(detailPatterns[lang]) ?? [];
  const concreteDetails = detailMatches.length;

  const abstractPatterns: Record<AITellLanguage, RegExp> = {
    zh: /(?:他|她|我|心中|内心|心底|脑子里|脑海里|意识里|灵魂深处)[^。！？\n]{0,20}(?:明白|意识到|懂得|理解|清楚|深知|暗想|暗道|心想|想到|回想起|回忆起|联想到|推测到|猜到|预料到|预感到|感觉到|感受到|体会到|领悟到|参透|看透|看穿|看破|洞悉|知晓|获悉|得知|了解到|认识到|醒悟到|觉悟到|感悟到|体悟到|参悟到|顿悟|恍然大悟|豁然开朗|茅塞顿开|如梦初醒|幡然醒悟|猛然醒悟|突然明白|瞬间明白|立刻明白|顿时明白|马上明白|一下子明白|终于明白|才明白)/g,
    en: /\b(?:he|she|I|they)\b[^.!?\n]{0,40}\b(?:understood|realized|comprehended|grasped|recognized|acknowledged|accepted|admitted|conceded|perceived|discerned|saw|knew|felt|sensed|suspected|guessed|inferred|deduced|concluded|determined|ascertained|established|discovered|found|learned|understood|appreciated|comprehended|fathomed|apprehended|cognized|envisioned|imagined|pictured|visualized|conceived|contemplated|pondered|reflected|considered|deliberated|meditated|mused|ruminated|brooded|dwelled|chewed|mulled|turned over|weighed|balanced|evaluated|assessed|estimated|gauged|measured|calculated|computed|reckoned|figured|worked out|made out|made sense of|got|got it|saw the point|caught on|twigged|cottoned on|clicked|penny dropped|fell into place|came together|added up|made sense|checked out|held water|stacked up|rang true|hit home|struck home|sank in|registered|dawned on|came to|arrived at|reached|hit|struck|overwhelmed|overcame|consumed|devoured|swallowed|engulfed|enveloped|surrounded|enclosed|trapped|caught|seized|gripped|grabbed|took hold of|took over|came over|washed over|swept over|rolled over|crept over|stole over|spread over|came upon|fell upon|descended upon)\b/gi,
  };
  const abstractMatches = content.match(abstractPatterns[lang]) ?? [];
  const abstractSummaries = abstractMatches.length;

  const ndf = (actionBeats + concreteDetails) / (abstractSummaries + 1);
  if (ndf < 1.0 && (actionBeats + concreteDetails + abstractSummaries) >= 3) {
    const joiner = isEnglish ? ", " : "、";
    issues.push({
      severity: ndf < 0.5 ? "critical" : "warning",
      category: isEnglish ? "Narrative density" : "叙事密度",
      description: isEnglish
        ? `NDF = ${ndf.toFixed(2)} (threshold ≥1.0): ${actionBeats} action beats + ${concreteDetails} sensory details vs ${abstractSummaries} abstract summaries.`
        : `叙事密度 NDF = ${ndf.toFixed(2)}（阈值≥1.0）：${actionBeats} 个动作拍 + ${concreteDetails} 个感官细节 vs ${abstractSummaries} 个抽象心理总结。`,
      suggestion: isEnglish
        ? "Convert abstract reflections into physical actions, concrete decisions, or sensory evidence."
        : "把抽象心理总结改成具体动作、决策或感官证据。",
    });
  }
  return issues;
}

function detectTelegraphParagraphs(paragraphs: ReadonlyArray<string>, language: AITellLanguage): AITellIssue[] {
  const isEnglish = language === "en";
  const narrativeParagraphs = paragraphs.filter((p) => !isDialogueParagraph(p));
  if (narrativeParagraphs.length < 8) return [];

  const shortThreshold = isEnglish ? 120 : 35;
  const shortParagraphs = narrativeParagraphs.filter((p) => p.length < shortThreshold);
  const shortRatio = shortParagraphs.length / narrativeParagraphs.length;

  let maxConsecutiveShort = 0;
  let current = 0;
  for (const paragraph of narrativeParagraphs) {
    if (paragraph.length < shortThreshold) {
      current++;
      maxConsecutiveShort = Math.max(maxConsecutiveShort, current);
    } else {
      current = 0;
    }
  }

  if (shortRatio < 0.62 && maxConsecutiveShort < 5) return [];

  const severity = shortRatio >= 0.74 || maxConsecutiveShort >= 7 ? "critical" : "warning";
  return [{
    severity,
    category: isEnglish ? "Telegraph paragraphing" : "电报体段落",
    description: isEnglish
      ? `${shortParagraphs.length}/${narrativeParagraphs.length} narrative paragraphs are shorter than ${shortThreshold} characters; max consecutive short run is ${maxConsecutiveShort}.`
      : `${narrativeParagraphs.length}个叙事段中有${shortParagraphs.length}个不足${shortThreshold}字，最长连续短段为${maxConsecutiveShort}个。`,
    suggestion: isEnglish
      ? "Merge connected action, observation, and reaction beats into fuller paragraphs; reserve one-line paragraphs for real impact beats."
      : "把连续动作、观察、反应合成有信息量的叙事段；单行段只留给真正爆点。",
  }];
}

function detectDialogueVoiceCollapse(content: string, language: AITellLanguage): AITellIssue[] {
  const isEnglish = language === "en";
  const quotes = extractQuotedLines(content, isEnglish);
  if (quotes.length < 8) return [];

  const shortQuotes = quotes.filter((line) => {
    if (isEnglish) {
      return line.split(/\s+/).filter(Boolean).length <= 5;
    }
    return line.replace(/[，。！？!?…\s]/g, "").length <= 10;
  });

  const oneWordMuted = quotes.filter((line) => isEnglish
    ? /^(yes|no|fine|go|wait|stop|enough|maybe|sure|right)\W*$/i.test(line)
    : /^(嗯|好|是|行|走|不|别|可以|知道|明白|等等|什么|谁|我来|不用|闭嘴)[。！？!?…]*$/.test(line),
  ).length;

  const shortRatio = shortQuotes.length / quotes.length;
  if (shortRatio < 0.82 && oneWordMuted < 5) return [];

  const severity = quotes.length >= 12 && shortRatio >= 0.9 ? "critical" : "warning";
  return [{
    severity,
    category: isEnglish ? "Dialogue voice collapse" : "台词同质",
    description: isEnglish
      ? `${shortQuotes.length}/${quotes.length} quoted lines are very short; ${oneWordMuted} are one-word muted replies.`
      : `${quotes.length}句直接台词中有${shortQuotes.length}句极短，${oneWordMuted}句接近单词式应答。`,
    suggestion: isEnglish
      ? "Give each speaking character one concrete voice fingerprint."
      : "为每个角色补一个可见声线指纹。",
  }];
}

function extractParagraphs(content: string): string[] {
  return content
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .filter((p) => p !== "---")
    .filter((p) => !p.startsWith("#"));
}

function isDialogueParagraph(paragraph: string): boolean {
  return /^[「『"'"']/.test(paragraph.trim());
}

function extractQuotedLines(content: string, isEnglish: boolean): string[] {
  const regex = isEnglish ? /"([^"]{1,180})"/g : /[「""']([^」""']{1,160})[」""']/g;
  const quotes: string[] = [];
  let match;
  while ((match = regex.exec(content)) !== null) {
    const line = match[1]?.trim();
    if (line) {
      quotes.push(line);
    }
  }
  return quotes;
}

function countWords(content: string, words: ReadonlyArray<string>, isEnglish: boolean): number {
  let count = 0;
  for (const word of words) {
    const regex = isEnglish
      ? new RegExp(`\\b${escapeRegExp(word)}\\b`, "gi")
      : new RegExp(escapeRegExp(word), "g");
    const matches = content.match(regex);
    count += matches?.length ?? 0;
  }
  return count;
}

function countPatternMatches(content: string, patterns: ReadonlyArray<RegExp>): { count: number; samples: string[] } {
  let count = 0;
  const samples: string[] = [];
  for (const pattern of patterns) {
    const matches = content.match(pattern);
    if (!matches) continue;
    count += matches.length;
    for (const match of matches.slice(0, 2)) {
      if (!samples.includes(`"${match}"`)) {
        samples.push(`"${match}"`);
      }
      if (samples.length >= 5) break;
    }
  }
  return { count, samples };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
