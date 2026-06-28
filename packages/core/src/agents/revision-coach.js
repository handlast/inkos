/**
 * Revision Coach — modular self-check module for chapter quality.
 *
 * Three independent checks, each zero LLM cost:
 *   1. Readability   — sentence-level metrics (朗读流畅度)
 *   2. Completeness  — standalone chapter quality (章节完整性)
 *   3. RevisionInfo  — info/foreshadowing preservation (改稿护栏)
 *
 * Each check can be used independently or composed.
 * Sits alongside Diagnoser in the pipeline:
 *   Writer → Analyzer → [Diagnoser + RevisionCoach] → Planner → Writer
 */

// ── Types ──

/**
 * @typedef {Object} ReadabilityResult
 * @property {number} score - 0-100 (higher = more readable)
 * @property {string[]} issues - human-readable issues found
 * @property {Object} metrics
 * @property {number} metrics.avgSentenceLen - average sentence length in chars
 * @property {number} metrics.longSentenceCount - sentences > 60 chars
 * @property {number} metrics.shortStreakMax - max consecutive sentences < 15 chars
 * @property {number} metrics.sameStartStreak - max consecutive sentences starting with same char
 * @property {number} metrics.adjectiveRatio - adjective-like words / total words
 */

/**
 * @typedef {Object} CompletenessResult
 * @property {number} score - 0-100 (higher = more complete)
 * @property {string[]} issues - human-readable issues found
 * @property {Object} signals
 * @property {boolean} signals.hasConflict - conflict/tension detected
 * @property {boolean} signals.hasGoal - protagonist goal detected
 * @property {boolean} signals.hasHook - ending hook detected
 * @property {boolean} signals.hasDialogue - dialogue present
 * @property {boolean} signals.hasAction - action/movement detected
 */

/**
 * @typedef {Object} RevisionInfoResult
 * @property {number} preserved - key terms preserved count
 * @property {number} lost - key terms lost count
 * @property {string[]} lostTerms - specific terms that were lost
 * @property {string} directive - revision guardrail directive
 */

// ── Sentence splitting ──

/**
 * Split Chinese/English text into sentences.
 * Handles Chinese punctuation (。！？…) and English (.!?).
 * @param {string} text
 * @returns {string[]}
 */
function splitSentences(text) {
    if (!text) return [];
    // Split on Chinese/English sentence-ending punctuation, keeping short sentences merged
    const raw = text.split(/(?<=[。！？…!?])\s*/);
    return raw
        .map(s => s.replace(/^[\s\n]+|[\s\n]+$/g, ""))
        .filter(s => s.length > 0);
}

/**
 * Split text into paragraphs (non-empty lines).
 * @param {string} text
 * @returns {string[]}
 */
function splitParagraphs(text) {
    if (!text) return [];
    return text.split(/\n\s*\n|\n/)
        .map(p => p.trim())
        .filter(p => p.length > 0 && !p.startsWith("#"));
}

// ── 1. Readability Check ──

/**
 * Check sentence-level readability metrics.
 * Inspired by editor advice: "朗读，嘴巴读出来，读的时候如果有卡顿的地方"
 *
 * @param {string} text - chapter content (markdown)
 * @returns {ReadabilityResult}
 */
export function checkReadability(text) {
    const issues = [];
    let score = 100;

    // Strip markdown headers and metadata
    const body = text.replace(/^#.*$/gm, "").trim();
    const sentences = splitSentences(body);
    const paragraphs = splitParagraphs(body);

    if (sentences.length === 0) {
        return { score: 0, issues: ["无法解析句子"], metrics: { avgSentenceLen: 0, longSentenceCount: 0, shortStreakMax: 0, sameStartStreak: 0, adjectiveRatio: 0 } };
    }

    // ── Sentence length distribution ──
    const lengths = sentences.map(s => s.length);
    const avgLen = lengths.reduce((a, b) => a + b, 0) / lengths.length;
    const longSentences = lengths.filter(l => l > 60);

    if (longSentences.length > sentences.length * 0.2) {
        issues.push(`${longSentences.length} 个句子超过 60 字（${(longSentences.length / sentences.length * 100).toFixed(0)}%），朗读时可能喘不过气`);
        score -= 15;
    }

    // ── Consecutive short sentences (电报体) ──
    let shortStreak = 0;
    let shortStreakMax = 0;
    for (const len of lengths) {
        if (len < 15) {
            shortStreak++;
            shortStreakMax = Math.max(shortStreakMax, shortStreak);
        } else {
            shortStreak = 0;
        }
    }

    if (shortStreakMax >= 5) {
        issues.push(`连续 ${shortStreakMax} 个短句（<15字），电报体节奏，需接一个长句`);
        score -= 12;
    } else if (shortStreakMax >= 3) {
        issues.push(`连续 ${shortStreakMax} 个短句，建议长短交替`);
        score -= 5;
    }

    // ── Same sentence start detection ──
    const getStartChar = (s) => {
        // Get first meaningful character (skip punctuation/whitespace)
        const match = s.match(/[一-鿿A-Za-z]/);
        return match ? match[0] : "";
    };

    let sameStartStreak = 0;
    let maxSameStartStreak = 0;
    let lastStart = "";
    for (const s of sentences) {
        const start = getStartChar(s);
        if (start && start === lastStart) {
            sameStartStreak++;
            maxSameStartStreak = Math.max(maxSameStartStreak, sameStartStreak);
        } else {
            sameStartStreak = 0;
        }
        lastStart = start;
    }

    if (maxSameStartStreak >= 4) {
        issues.push(`连续 ${maxSameStartStreak + 1} 个句子以相同字开头，句式单调`);
        score -= 10;
    }

    // ── Paragraph length variation ──
    const paraLens = paragraphs.map(p => p.length);
    const shortParas = paraLens.filter(l => l < 20).length;
    if (paragraphs.length > 5 && shortParas > paragraphs.length * 0.4) {
        issues.push(`${shortParas}/${paragraphs.length} 段落不足 20 字，段落碎片化`);
        score -= 8;
    }

    // ── Adjective/connector density (AI-tell markers) ──
    const aiMarkers = /仿佛|宛如|犹如|不禁|忽然|猛然|猛地|竟然|居然|缓缓|微微|轻轻|淡淡/g;
    const markerMatches = body.match(aiMarkers) ?? [];
    const markerDensity = markerMatches.length / (body.length / 1000);
    if (markerDensity > 5) {
        issues.push(`AI标记词密度 ${markerDensity.toFixed(1)}/千字（仿佛/宛如/不禁/缓缓等），超过阈值 5`);
        score -= 10;
    }

    score = Math.max(0, Math.min(100, score));

    return {
        score,
        issues,
        metrics: {
            avgSentenceLen: Math.round(avgLen),
            longSentenceCount: longSentences.length,
            shortStreakMax,
            sameStartStreak: maxSameStartStreak,
            adjectiveRatio: markerDensity,
        },
    };
}

// ── 2. Completeness Check ──

/**
 * Check if a chapter stands alone as an engaging read.
 * Inspired by editor advice: "如果把这章作为独立的内容来看，有没有看点？"
 *
 * @param {string} text - chapter content (markdown)
 * @param {Object} [opts]
 * @param {string} [opts.protagonistName] - protagonist name for goal/conflict detection
 * @returns {CompletenessResult}
 */
export function checkCompleteness(text, opts) {
    const issues = [];
    let score = 100;
    const body = text.replace(/^#.*$/gm, "").trim();
    const paragraphs = splitParagraphs(body);
    const sentences = splitSentences(body);
    const wordCount = body.length;

    // ── Dialogue presence ──
    const dialoguePattern = /[""「」『』]/g;
    const dialogueMatches = body.match(dialoguePattern) ?? [];
    const hasDialogue = dialogueMatches.length >= 2;

    // ── Conflict/tension detection ──
    const conflictWords = /争|斗|杀|战|怒|恨|怕|恐|危|险|死|伤|败|输|逃|追|逼|迫|威胁|对峙|冲突|矛盾|敌|仇|恨|怒吼|咆哮|质问|反驳|拒绝|否认/gi;
    const conflictMatches = body.match(conflictWords) ?? [];
    const hasConflict = conflictMatches.length >= 3;

    // ── Goal detection ──
    const goalWords = /要|想|需|必须|决定|目的|目标|计划|打算|准备|去找|去找|前往|寻找|追踪|追查|调查|查明|解决|完成|达成|拿到|得到|获得|保护|守护|拯救|阻止|破坏|打败|超越/g;
    const goalMatches = body.match(goalWords) ?? [];
    const hasGoal = goalMatches.length >= 2;

    // ── Action/movement detection ──
    const actionWords = /走|跑|跳|冲|飞|翻|转|推|拉|打|踢|抓|握|拔|抽|劈|砍|刺|挡|闪|躲|避|爬|滚|站|坐|躺|跨|迈|踏|踩|跃|扑|按|压|撕|扯|扔|抛|接|举|抬|放|开|关|拿|取|放|握|捏|掐|戳|捅|砸|摔|敲|击|撞|碰|触|摸|擦|抹|抹|洗|刷|扫|拖|擦|剪|切|割|划|刻|画|写|读|看|望|盯|瞪|瞥|瞄|瞅|瞧|听|闻|嗅|尝|舔|咬|吞|咽|吐|吸|呼|喘|咳|笑|哭|喊|叫|吼|骂|唱|念|说|讲|问|答|骂|夸|赞|叹|哼|哈|嘿|喂|嗯|啊|呀|哦|噢|喔|咦|哇|唉|哎|呸|嗖|嘭|啪|叮|咚|哗|呼|飕|飕|飕/g;
    const actionMatches = body.match(actionWords) ?? [];
    const hasAction = actionMatches.length >= 5;

    // ── Hook at ending ──
    const lastParagraph = paragraphs[paragraphs.length - 1] ?? "";
    const last3Sentences = sentences.slice(-3).join("");
    const hookIndicators = /[？\?！\!]|难道|究竟|到底|难道|莫非|难道说|没想到|竟然|居然|突然|忽然|不对|不好|完了|糟了|出事|出问题|怎么可能|不可能|怎么会|为什么|怎么回事/g;
    const hookMatches = last3Sentences.match(hookIndicators) ?? [];
    const hasHook = hookMatches.length >= 1 || lastParagraph.length > 20;

    // ── Score deductions ──
    if (!hasDialogue) {
        issues.push("无对话——纯叙述章节缺乏互动感");
        score -= 15;
    }
    if (!hasConflict) {
        issues.push("无冲突/张力——读者缺乏继续阅读的理由");
        score -= 20;
    }
    if (!hasGoal) {
        issues.push("无明确目标——主角行为缺乏方向感");
        score -= 15;
    }
    if (!hasAction) {
        issues.push("动作描写不足——叙事偏静态");
        score -= 10;
    }
    if (!hasHook) {
        issues.push("章尾无钩子——读者无翻页冲动");
        score -= 20;
    }

    // ── Three questions test (editor: 煮熟的来福鸽) ──
    // "主角叫什么？他想干什么？他在做什么？"
    const name = opts?.protagonistName;
    const hasName = name ? body.includes(name) : true; // skip if no name provided
    if (name && !hasName) {
        issues.push(`三问测试：主角"${name}"未在本章出现`);
        score -= 25;
    }

    // ── Info density check ──
    if (wordCount > 1000 && !hasConflict && !hasGoal) {
        issues.push("千字以上无冲突无目标——疑似水文");
        score -= 15;
    }

    score = Math.max(0, Math.min(100, score));

    return {
        score,
        issues,
        signals: { hasConflict, hasGoal, hasHook, hasDialogue, hasAction },
    };
}

// ── 3. Revision Integrity Check ──

/**
 * Check if a revision preserves key information from the original.
 * Inspired by editor advice: "改之前一定要把重要的信息、伏笔、抛出来的信息等等，单独记录"
 *
 * @param {string} original - original chapter text
 * @param {string} revised - revised chapter text
 * @param {string[]} [hookTerms] - hook/foreshadowing terms to check (optional)
 * @returns {RevisionInfoResult}
 */
export function checkRevisionIntegrity(original, revised, hookTerms) {
    if (!original || !revised) {
        return { preserved: 0, lost: 0, lostTerms: [], directive: "" };
    }

    // ── Extract key terms from original ──
    // Named entities: Chinese names (2-4 chars), capitalized English words
    const namePattern = /[一-鿿]{2,4}(?=[说道喊叫问答看走跑来去在的了])|(?<![a-z])[A-Z][a-z]+/g;
    const originalNames = new Set(original.match(namePattern) ?? []);
    const revisedText = revised;

    // ── Check named entity preservation ──
    const lostNames = [];
    for (const name of originalNames) {
        if (name.length < 2) continue;
        if (!revisedText.includes(name)) {
            lostNames.push(name);
        }
    }

    // ── Check hook/foreshadowing term preservation ──
    const lostHooks = [];
    if (hookTerms && hookTerms.length > 0) {
        for (const term of hookTerms) {
            if (original.includes(term) && !revisedText.includes(term)) {
                lostHooks.push(term);
            }
        }
    }

    // ── Check key noun preservation (高频实词) ──
    const extractKeyNouns = (text) => {
        // Extract repeated meaningful Chinese words (3+ chars, appears 2+ times)
        const words = text.match(/[一-鿿]{3,}/g) ?? [];
        const freq = new Map();
        for (const w of words) {
            freq.set(w, (freq.get(w) ?? 0) + 1);
        }
        return new Set([...freq.entries()]
            .filter(([, count]) => count >= 2)
            .map(([word]) => word));
    };

    const originalNouns = extractKeyNouns(original);
    const lostNouns = [];
    for (const noun of originalNouns) {
        if (!revisedText.includes(noun)) {
            lostNouns.push(noun);
        }
    }

    const allLost = [...new Set([...lostNames, ...lostHooks, ...lostNouns])];
    const preserved = originalNames.size - lostNames.length;

    // ── Build directive ──
    let directive = "";
    if (lostHooks.length > 0) {
        directive += `⚠️ 伏笔/钩子丢失：${lostHooks.join("、")}。必须恢复。`;
    }
    if (lostNames.length > 2) {
        directive += `${directive ? "\n" : ""}⚠️ 角色名丢失 ${lostNames.length} 个：${lostNames.slice(0, 5).join("、")}。检查是否误删。`;
    }
    if (lostNouns.length > 5) {
        directive += `${directive ? "\n" : ""}⚡ 高频实词丢失 ${lostNouns.length} 个，修改范围可能过大。`;
    }
    if (!directive && allLost.length > 0) {
        directive = `💡 少量术语变动（${allLost.length}），属正常修改范围。`;
    }

    return {
        preserved,
        lost: allLost.length,
        lostTerms: allLost.slice(0, 10),
        directive,
    };
}

// ── Composite coach ──

/**
 * Run all applicable checks on a chapter.
 *
 * @param {string} text - chapter content
 * @param {Object} [opts]
 * @param {string} [opts.protagonistName] - for completeness check
 * @param {string} [opts.originalText] - for revision integrity check
 * @param {string[]} [opts.hookTerms] - for revision integrity check
 * @returns {{ readability: ReadabilityResult, completeness: CompletenessResult, revisionIntegrity?: RevisionInfoResult }}
 */
export function coachChapter(text, opts) {
    const readability = checkReadability(text);
    const completeness = checkCompleteness(text, opts);

    /** @type {RevisionInfoResult | undefined} */
    let revisionIntegrity;
    if (opts?.originalText) {
        revisionIntegrity = checkRevisionIntegrity(opts.originalText, text, opts.hookTerms);
    }

    return { readability, completeness, revisionIntegrity };
}

// ── Planner/Writer hint builders ──

/**
 * Build a structured hint block for the Planner based on revision coach results.
 * Returns "" if everything is fine.
 *
 * @param {ReadabilityResult} readability
 * @param {CompletenessResult} completeness
 * @returns {string}
 */
export function buildCoachPlannerHint(readability, completeness) {
    const parts = [];

    if (readability.score < 70) {
        const top = readability.issues.slice(0, 2).join("；");
        parts.push(`可读性 ${readability.score}/100：${top}`);
    }

    if (completeness.score < 70) {
        const top = completeness.issues.slice(0, 2).join("；");
        parts.push(`完整性 ${completeness.score}/100：${top}`);
    }

    if (parts.length === 0) return "";

    return `## 写作自检（Coach）\n${parts.join("\n")}`;
}

/**
 * Build a structured hint block for the Writer based on revision coach results.
 * Returns "" if everything is fine.
 *
 * @param {ReadabilityResult} readability
 * @param {CompletenessResult} completeness
 * @returns {string}
 */
export function buildCoachWriterHint(readability, completeness) {
    const fixes = [];

    if (readability.score < 70) {
        if (readability.metrics.longSentenceCount > 5) {
            fixes.push("拆分长句：超60字的句子拆成2-3句");
        }
        if (readability.metrics.shortStreakMax >= 5) {
            fixes.push("合并短句：连续短句接一个长叙事段");
        }
        if (readability.metrics.adjectiveRatio > 5) {
            fixes.push("替换AI标记词：仿佛/宛如/不禁/缓缓等换成具体感官");
        }
    }

    if (completeness.score < 70) {
        if (!completeness.signals.hasHook) {
            fixes.push("章尾加钩子：悬念、新信息、情绪悬崖");
        }
        if (!completeness.signals.hasConflict) {
            fixes.push("增加冲突/张力：至少一个对抗性场面");
        }
        if (!completeness.signals.hasGoal) {
            fixes.push("明确主角目标：让读者知道主角要什么");
        }
    }

    if (fixes.length === 0) return "";

    return `## 自检修正建议\n${fixes.map(f => `- ${f}`).join("\n")}`;
}
