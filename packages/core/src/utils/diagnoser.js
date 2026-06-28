/**
 * Diagnoser — modular pacing diagnosis + remediation hint generator.
 *
 * Sits between Analyzer and Planner in the pipeline:
 *   Writer → Analyzer → Diagnoser → Planner → Writer
 *
 * Input:  PACING telemetry (from analyzer) + pacing history (from pacing_telemetry.md)
 * Output: structured remediation hints for Planner and Writer
 *
 * Zero LLM cost — pure rule-based interpretation of PACING signals.
 */

// ── Types ──

/**
 * @typedef {Object} PacingEntry
 * @property {number} chapter
 * @property {string} verdict - padding | normal | rushing
 * @property {number} plotAdv - 0-100
 * @property {number} conflict - 0-100
 * @property {number} infoDensity - 0-100
 * @property {string} summaryTest - one-sentence summary
 * @property {string} infoLoad - light | normal | heavy | overwhelming
 * @property {string} hookAtEnd - none | weak | strong
 * @property {string} fixHint - add_hook | add_emotion | cut_subplot | expand_climax | none
 */

/**
 * @typedef {Object} DiagnosisResult
 * @property {number} healthScore - 0-100 composite health score
 * @property {Array<PacingIssue>} issues
 * @property {string} plannerHint - directive for next chapter planning
 * @property {string} writerHint - directive for current chapter revision
 */

/**
 * @typedef {Object} PacingIssue
 * @property {string} type - slow_pacing | fast_pacing | weak_ending | info_overload | no_hook | consecutive_problem
 * @property {string} severity - low | medium | high
 * @property {string} evidence - human-readable evidence
 * @property {string} fix - recommended fix action
 */

// ── Parser ──

/**
 * Parse a single PACING block (from analyzer output) into structured fields.
 * @param {string} pacingRaw - raw PACING section text
 * @returns {Partial<PacingEntry>}
 */
export function parsePacingBlock(pacingRaw) {
    if (!pacingRaw) return {};
    const get = (key) => pacingRaw.match(new RegExp(`${key}:\\s*(.+)`, "i"))?.[1]?.trim() ?? "";
    const getInt = (key) => parseInt(get(key), 10) || 0;
    return {
        verdict: get("verdict"),
        plotAdv: getInt("plot_advancement"),
        conflict: getInt("conflict_intensity"),
        infoDensity: getInt("new_info_density"),
        summaryTest: get("summary_test"),
        infoLoad: get("info_load"),
        hookAtEnd: get("hook_at_end"),
        fixHint: get("pacing_fix_hint"),
    };
}

/**
 * Parse pacing_telemetry.md into an array of entries.
 * @param {string} telemetryRaw - full pacing_telemetry.md content
 * @param {number} currentChapter - current chapter number (only look at past)
 * @returns {PacingEntry[]}
 */
export function parsePacingTelemetry(telemetryRaw, currentChapter) {
    if (!telemetryRaw || telemetryRaw === "(文件尚未创建)") return [];
    const entries = [];
    const blocks = telemetryRaw.split(/^## Chapter \d+/m).slice(1);
    const headings = telemetryRaw.match(/^## Chapter \d+/gm) ?? [];
    for (let i = 0; i < blocks.length; i++) {
        const chapterMatch = headings[i]?.match(/## Chapter (\d+)/);
        if (!chapterMatch) continue;
        const ch = parseInt(chapterMatch[1], 10);
        if (ch >= currentChapter) continue;
        const block = blocks[i];
        const parsed = parsePacingBlock(block);
        entries.push({ chapter: ch, ...parsed });
    }
    return entries;
}

// ── Diagnoser core ──

/**
 * Diagnose pacing issues from current chapter's PACING data and history.
 *
 * @param {Partial<PacingEntry>} current - current chapter's parsed PACING
 * @param {PacingEntry[]} history - past chapters' PACING entries
 * @returns {DiagnosisResult}
 */
export function diagnosePacing(current, history) {
    const issues = [];
    let healthScore = 100;

    // ── 1. Verdict-based issues ──
    if (current.verdict === "padding") {
        issues.push({
            type: "slow_pacing",
            severity: current.plotAdv < 15 ? "high" : "medium",
            evidence: `verdict=padding, plot_advancement=${current.plotAdv}${current.summary_test ? `, 一句话概括: ${current.summary_test}` : ""}`,
            fix: "cut_subplot",
        });
        healthScore -= current.plotAdv < 15 ? 25 : 15;
    }
    if (current.verdict === "rushing") {
        issues.push({
            type: "fast_pacing",
            severity: current.plotAdv > 90 ? "high" : "medium",
            evidence: `verdict=rushing, plot_advancement=${current.plotAdv}, new_info_density=${current.infoDensity}`,
            fix: "add_emotion",
        });
        healthScore -= current.plotAdv > 90 ? 25 : 15;
    }

    // ── 2. Hook at ending ──
    if (current.hookAtEnd === "none") {
        issues.push({
            type: "no_hook",
            severity: "high",
            evidence: "章尾无钩子，读者无理由翻到下一章",
            fix: "add_hook",
        });
        healthScore -= 20;
    } else if (current.hookAtEnd === "weak") {
        issues.push({
            type: "weak_ending",
            severity: "low",
            evidence: "章尾钩子较弱，建议加强悬念或冲突升级",
            fix: "add_hook",
        });
        healthScore -= 8;
    }

    // ── 3. Info overload ──
    if (current.infoLoad === "overwhelming") {
        issues.push({
            type: "info_overload",
            severity: "high",
            evidence: "读者信息过载，需要消化时间",
            fix: "add_emotion",
        });
        healthScore -= 15;
    } else if (current.infoLoad === "heavy" && current.verdict === "rushing") {
        issues.push({
            type: "info_overload",
            severity: "medium",
            evidence: "信息量大且节奏快，读者可能跟不上",
            fix: "add_emotion",
        });
        healthScore -= 10;
    }

    // ── 4. Summary test (one-sentence = padding) ──
    if (current.summaryTest && current.summaryTest.length < 30 && current.verdict !== "rushing") {
        const alreadySlow = issues.some(i => i.type === "slow_pacing");
        if (!alreadySlow) {
            issues.push({
                type: "slow_pacing",
                severity: "medium",
                evidence: `本章核心可用一句话概括，信息密度可能不足: ${current.summaryTest}`,
                fix: "cut_subplot",
            });
            healthScore -= 10;
        }
    }

    // ── 5. Consecutive trend detection ──
    if (history.length >= 2) {
        const last2 = history.slice(-2);
        const bothPadding = last2.every(e => e.verdict === "padding" || e.plotAdv < 25);
        const bothRushing = last2.every(e => e.verdict === "rushing" || e.plotAdv > 85);

        if (bothPadding) {
            issues.push({
                type: "consecutive_problem",
                severity: "high",
                evidence: `连续2章节奏偏慢 (ch${last2[0].chapter}-${last2[1].chapter})，plot_advancement=${last2.map(e => e.plotAdv).join("/")}`,
                fix: "expand_climax",
            });
            healthScore -= 20;
        }
        if (bothRushing) {
            issues.push({
                type: "consecutive_problem",
                severity: "high",
                evidence: `连续2章节奏偏快 (ch${last2[0].chapter}-${last2[1].chapter})，可能提前消耗高潮`,
                fix: "add_emotion",
            });
            healthScore -= 20;
        }

        // 3+ consecutive same verdict = critical
        if (history.length >= 3) {
            const last3 = history.slice(-3);
            const all3Padding = last3.every(e => e.verdict === "padding" || e.plotAdv < 25);
            const all3Rushing = last3.every(e => e.verdict === "rushing" || e.plotAdv > 85);
            if (all3Padding || all3Rushing) {
                healthScore -= 15; // additional penalty
            }
        }
    }

    // ── 6. Conflict vs plot advancement mismatch ──
    if (current.conflict > 70 && current.plotAdv < 30) {
        issues.push({
            type: "fast_pacing",
            severity: "medium",
            evidence: `高冲突(${current.conflict})但低推进(${current.plotAdv})——冲突可能无实质结果`,
            fix: "expand_climax",
        });
        healthScore -= 8;
    }

    healthScore = Math.max(0, Math.min(100, healthScore));

    // ── Generate hints ──
    const plannerHint = buildPlannerHint(issues, current, history);
    const writerHint = buildWriterHint(issues, current);

    return { healthScore, issues, plannerHint, writerHint };
}

// ── Hint builders ──

/**
 * Build a directive string for the Planner (next chapter planning).
 */
function buildPlannerHint(issues, current, history) {
    if (issues.length === 0) return "";

    const parts = [];

    // Consecutive problems take priority
    const consecutive = issues.filter(i => i.type === "consecutive_problem");
    if (consecutive.length > 0) {
        const isSlow = current.verdict === "padding" || current.plotAdv < 25;
        if (isSlow) {
            parts.push("连续节奏偏慢，本章必须：1)引入新危机或新信息推进主线 2)砍掉与主线无关的支线描写 3)章尾留强钩子");
        } else {
            parts.push("连续节奏偏快，本章必须：1)放慢核心冲突的描写 2)增加角色情绪层次 3)不要新增信息点，消化已有信息");
        }
    }

    // Single-chapter issues
    const slowIssues = issues.filter(i => i.type === "slow_pacing" && !consecutive.length);
    if (slowIssues.length > 0) {
        parts.push("本章节奏偏慢(planning中应加快推进，压缩过渡段");
    }

    const fastIssues = issues.filter(i => i.type === "fast_pacing" && !consecutive.length);
    if (fastIssues.length > 0) {
        parts.push("本章节奏偏快：下章规划时控制信息量，增加情绪铺垫");
    }

    const hookIssues = issues.filter(i => i.type === "no_hook" || i.type === "weak_ending");
    if (hookIssues.length > 0) {
        parts.push("章尾钩子不足：下章开头必须快速建立悬念承接");
    }

    const infoIssues = issues.filter(i => i.type === "info_overload");
    if (infoIssues.length > 0) {
        parts.push("信息过载：下章减少新信息，给读者消化空间");
    }

    return parts.join("；");
}

/**
 * Build a directive string for the Writer (current chapter revision).
 */
function buildWriterHint(issues, current) {
    if (issues.length === 0) return "";

    const parts = [];
    const fixes = new Set(issues.map(i => i.fix));

    if (fixes.has("cut_subplot")) {
        parts.push("砍支线描写，压缩与主线无关的内容");
    }
    if (fixes.has("add_hook")) {
        parts.push("章尾加强钩子：悬念、新信息、或情绪转折");
    }
    if (fixes.has("add_emotion")) {
        parts.push("增加情绪层次：内心描写、感官细节、角色反应");
    }
    if (fixes.has("expand_climax")) {
        parts.push("扩展高潮段落：放慢节奏，增加细节和张力");
    }

    return parts.join("；");
}

// ── Backward-compatible wrapper ──

/**
 * Drop-in replacement for the old analyzePacingTrend().
 * Same signature, same return type (string directive for planner),
 * but now also returns structured hints.
 *
 * @param {string} pacingTelemetryRaw - pacing_telemetry.md content
 * @param {number} currentChapter - current chapter number
 * @returns {string} corrective directive (empty if no issues)
 */
export function analyzePacingTrendEnhanced(pacingTelemetryRaw, currentChapter) {
    const history = parsePacingTelemetry(pacingTelemetryRaw, currentChapter);
    if (history.length < 2) return "";
    const last2 = history.slice(-2);
    const bothPadding = last2.every(e => e.verdict === "padding" || e.plotAdv < 25);
    const bothRushing = last2.every(e => e.verdict === "rushing" || e.plotAdv > 85);
    if (bothPadding) {
        return "## 节奏警告：连续注水\n连续2章剧情推进率过低（<25%）。本章必须引入新危机、新信息或实质性剧情推进，禁止继续铺垫日常。章尾必须留强钩子。";
    }
    if (bothRushing) {
        return "## 节奏警告：剧情暴走\n连续2章剧情推进率过高（>85%），可能提前消耗卷纲高潮。本章必须放慢节奏，铺设伏笔、深化角色情绪、控制冲突烈度。不要新增信息点。";
    }
    return "";
}
