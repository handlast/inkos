/**
 * AI-tell mutator — deterministic post-processor that reduces AIGC detection score.
 *
 * Zero LLM cost. Applies rule-based text transformations that break statistical
 * patterns detectors look for: uniform sentence length, high-probability token
 * selection, consistent information density, formal register.
 *
 * Transformations:
 * 1. Connective replacement: formal → colloquial
 * 2. Specificity injection: generic words → more specific/colloquial alternatives
 */

// ── Seeded PRNG (deterministic for same input) ──
function hashStr(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) {
        h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    }
    return h;
}

function createRng(seed) {
    let s = seed | 0;
    return () => {
        s = (s * 1664525 + 1013904223) | 0;
        return (s >>> 0) / 4294967296;
    };
}

// ── Transformation tables ──

/** Formal connective → colloquial replacement */
const CONNECTIVE_REPLACEMENTS = [
    ["然而", "不过"],
    ["尽管如此", "话虽这么说"],
    ["与此同时", "这边"],
    ["另一方面", "另一头"],
    ["不仅如此", "不光这样"],
    ["更重要的是", "更要命的是"],
    ["事实上", "说白了"],
    ["毫无疑问", "不用说"],
    ["不言而喻", "明摆着"],
    ["值得注意的是", "有个事"],
    ["某种程度上", "怎么说呢"],
    ["一定程度上", "多少有点"],
];

/** Specific word replacements: generic → colloquial/specific */
const SPECIFICITY_REPLACEMENTS = [
    ["他意识到", "他反应过来"],
    ["他决定", "他打定主意"],
    ["他发现", "他看出"],
    ["他注意到", "他瞅见"],
    ["他感到", "他觉得"],
    ["他思考着", "他琢磨"],
    ["他回忆起", "他想起"],
    ["他迅速地", "他飞快地"],
    ["他缓慢地", "他慢吞吞地"],
    ["他紧紧地", "他死死地"],
    ["他轻轻地", "他随手"],
    ["默默地", "闷声"],
    ["静静地", "一声不吭地"],
    ["缓缓地", "慢悠悠地"],
    ["微微地", "稍稍"],
    ["他的目光", "他的眼神"],
    ["她的目光", "她的眼神"],
    ["深吸一口气", "吸了口气"],
    ["注视着", "盯着"],
    ["凝视着", "看着"],
    ["眉头微蹙", "皱了皱眉"],
    ["嘴角上扬", "笑了笑"],
    ["心中暗想", "心里嘀咕"],
    ["深不可测", "摸不透"],
    ["意味深长", "别有深意"],
    ["若有所思", "愣了一下"],
];

// ── Core mutator ──

/**
 * Mutate text to reduce AIGC detection score.
 * @param {string} content - Chapter content (markdown)
 * @param {string} language - "zh" or "en"
 * @param {number} intensity - 0.0 to 1.0, controls mutation probability
 * @returns {{ content: string, mutations: Record<string, number> }}
 */
export function mutateAITells(content, language = "zh", intensity = 0.5) {
    if (language !== "zh") return { content, mutations: {} };

    const rng = createRng(hashStr(content));
    const mutations = { connective: 0, specificity: 0 };
    let result = content;

    // 1. Connective replacement
    for (const [formal, colloquial] of CONNECTIVE_REPLACEMENTS) {
        const idx = result.indexOf(formal);
        if (idx >= 0 && rng() < intensity * 0.8) {
            // Don't replace inside dialogue (between 「」 or "" quotes)
            const before = result.substring(Math.max(0, idx - 50), idx);
            const openQuotes = (before.match(/「/g) || []).length;
            const closeQuotes = (before.match(/」/g) || []).length;
            if (openQuotes === closeQuotes) { // not inside dialogue
                result = result.substring(0, idx) + colloquial + result.substring(idx + formal.length);
                mutations.connective++;
            }
        }
    }

    // 2. Specificity replacement
    for (const [generic, specific] of SPECIFICITY_REPLACEMENTS) {
        const idx = result.indexOf(generic);
        if (idx >= 0 && rng() < intensity * 0.7) {
            const before = result.substring(Math.max(0, idx - 50), idx);
            const openQuotes = (before.match(/「/g) || []).length;
            const closeQuotes = (before.match(/」/g) || []).length;
            if (openQuotes === closeQuotes) {
                result = result.substring(0, idx) + specific + result.substring(idx + generic.length);
                mutations.specificity++;
            }
        }
    }

    return { content: result, mutations };
}
