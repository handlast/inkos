/**
 * Style Guide Generator — extracted from runner.js
 *
 * Generates qualitative style guides from reference text via LLM,
 * with statistical fingerprint fallback.
 */
import { chatCompletion } from "../llm/provider.js";
import { analyzeStyle } from "../agents/style-analyzer.js";
import { buildWritingMethodologySection } from "../utils/writing-methodology.js";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
export function buildDeterministicStyleGuide(profile, options) {
    if (options.language === "en") {
        return [
            "# Style Guide",
            "",
            `> ${options.reason}`,
            "",
            "## Statistical Fingerprint",
            `- Source: ${profile.sourceName ?? "unknown"}`,
            `- Average sentence length: ${profile.avgSentenceLength}`,
            `- Sentence length variance: ${profile.sentenceLengthStdDev}`,
            `- Average paragraph length: ${profile.avgParagraphLength}`,
            `- Vocabulary diversity: ${Math.round(profile.vocabularyDiversity * 100)}%`,
            profile.topPatterns.length > 0 ? `- Repeated openings: ${profile.topPatterns.join(", ")}` : "- Repeated openings: none obvious in this sample",
            profile.rhetoricalFeatures.length > 0 ? `- Rhetorical features: ${profile.rhetoricalFeatures.join(", ")}` : "- Rhetorical features: none obvious in this sample",
            "",
            "## How To Use",
            "- Treat this as a lightweight style fingerprint, not a full imitation bible.",
            "- Keep sentence and paragraph rhythm close to the sample when drafting.",
            "- If this guide feels too thin, import a longer excerpt later; the file will be replaced.",
        ].join("\n");
    }
    return [
        "# 文风指南",
        "",
        `> ${options.reason}`,
        "",
        "## 统计风格指纹",
        `- 来源：${profile.sourceName ?? "unknown"}`,
        `- 平均句长：${profile.avgSentenceLength}`,
        `- 句长波动：${profile.sentenceLengthStdDev}`,
        `- 平均段落长度：${profile.avgParagraphLength}`,
        `- 词汇多样性：${Math.round(profile.vocabularyDiversity * 100)}%`,
        profile.topPatterns.length > 0 ? `- 高频句首/模式：${profile.topPatterns.join("、")}` : "- 高频句首/模式：样本内不明显",
        profile.rhetoricalFeatures.length > 0 ? `- 修辞特征：${profile.rhetoricalFeatures.join("、")}` : "- 修辞特征：样本内不明显",
        "",
        "## 使用方式",
        "- 这是一份轻量文风指纹，不是完整仿写圣经。",
        "- 后续写作优先参考句长、段落长度、节奏波动和可见修辞。",
        "- 如果想得到更稳定的定性拆解，后续可以导入更长片段覆盖本文件。",
    ].join("\n");
}
/**
 * Generate a qualitative style guide from reference text.
 * Also saves the statistical style_profile.json.
 *
 * @param {object} params
 * @param {string} params.bookDir
 * @param {string} params.storyDir
 * @param {string} params.language
 * @param {string} params.referenceText
 * @param {string} params.sourceName
 * @param {object} params.llmClient
 * @param {string} params.llmModel
 */
export async function generateStyleGuide(params) {
    const sample = params.referenceText.trim();
    if (!sample) {
        throw new Error("Reference text is required for style extraction.");
    }
    await mkdir(params.storyDir, { recursive: true });
    // Statistical fingerprint
    const profile = analyzeStyle(sample, params.sourceName);
    await writeFile(join(params.storyDir, "style_profile.json"), JSON.stringify(profile, null, 2), "utf-8");
    const lang = params.language === "en" ? "en" : "zh";
    let qualitativeGuide;
    if (sample.length < 500) {
        qualitativeGuide = buildDeterministicStyleGuide(profile, {
            language: lang,
            reason: lang === "en"
                ? `The sample is short (${sample.length} chars), so this guide uses the statistical fingerprint instead of LLM qualitative extraction.`
                : `样本文本较短（${sample.length}字），本次先使用统计指纹生成文风指南，不强行调用 LLM 做定性拆解。`,
        });
    }
    else {
        try {
            const response = await chatCompletion(params.llmClient, params.llmModel, [
                {
                    role: "system",
                    content: `你是一位文学风格分析专家。分析参考文本的写作风格，提取可供模仿的定性特征。

输出格式（Markdown）：
## 叙事声音与语气
（冷峻/热烈/讽刺/温情/...，附1-2个原文例句）

## 对话风格
（角色说话的共性特征：句子长短、口头禅倾向、方言痕迹、对话节奏）

## 场景描写特征
（五感偏好、意象选择、描写密度、环境与情绪的关联方式）

## 转折与衔接手法
（场景如何切换、时间跳跃的处理方式、段落间的过渡特征）

## 节奏特征
（长短句分布、段落长度偏好、高潮/舒缓的交替方式）

## 词汇偏好
（高频特色用词、比喻/修辞倾向、口语化程度）

## 情绪表达方式
（直白抒情 vs 动作外化、内心独白的频率和风格）

## 独特习惯
（任何值得模仿的个人写作习惯）

分析必须基于原文实际特征，不要泛泛而谈。每个部分用1-2个原文例句佐证。`,
                },
                {
                    role: "user",
                    content: `分析以下参考文本的写作风格：\n\n${sample.slice(0, 20000)}`,
                },
            ], { temperature: 0.3 });
            qualitativeGuide = response.content.trim()
                ? response.content
                : buildDeterministicStyleGuide(profile, {
                    language: lang,
                    reason: lang === "en"
                        ? "The LLM returned empty style analysis; using the statistical fingerprint fallback."
                        : "LLM 未返回有效文风分析，本次使用统计指纹兜底生成文风指南。",
                });
        }
        catch (error) {
            qualitativeGuide = buildDeterministicStyleGuide(profile, {
                language: lang,
                reason: lang === "en"
                    ? `LLM qualitative extraction failed: ${error instanceof Error ? error.message : String(error)}. Using the statistical fingerprint fallback.`
                    : `LLM 定性拆解失败：${error instanceof Error ? error.message : String(error)}。本次使用统计指纹兜底生成文风指南。`,
            });
        }
    }
    const craftMethodology = buildWritingMethodologySection(lang);
    const fullStyleGuide = `${qualitativeGuide}\n\n${craftMethodology}`;
    await writeFile(join(params.storyDir, "style_guide.md"), fullStyleGuide, "utf-8");
    return fullStyleGuide;
}
