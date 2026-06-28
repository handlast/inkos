import { BaseAgent } from "./base.js";
import type { ArchitectOutput } from "./architect.js";

const PASS_THRESHOLD = 80;
const DIMENSION_FLOOR = 60;

interface Dimension {
  readonly name: string;
  readonly weight: number;
}

export interface FoundationReviewResult {
  readonly passed: boolean;
  readonly totalScore: number;
  readonly dimensions: ReadonlyArray<{
    readonly name: string;
    readonly score: number;
    readonly feedback: string;
    readonly weight: number;
    readonly weighted: number;
  }>;
  readonly overallFeedback: string;
  readonly maxDimension?: { readonly name: string; readonly score: number };
  readonly minDimension?: { readonly name: string; readonly score: number };
}

export class FoundationReviewerAgent extends BaseAgent {
  get name(): string {
    return "foundation-reviewer";
  }

  async review(params: {
    readonly foundation: ArchitectOutput;
    readonly mode: "original" | "fanfic" | "series";
    readonly sourceCanon?: string;
    readonly styleGuide?: string;
    readonly language: "zh" | "en";
    readonly targetChapters?: number;
  }): Promise<FoundationReviewResult> {
    const canonBlock = params.sourceCanon
      ? `\n## 原作正典参照\n${params.sourceCanon}\n`
      : "";
    const styleBlock = params.styleGuide
      ? `\n## 原作风格参照\n${params.styleGuide}\n`
      : "";

    const dimensions = params.mode === "original"
      ? this.originalDimensions(params.language, params.targetChapters)
      : this.derivativeDimensions(params.language, params.mode, params.targetChapters);

    const systemPrompt = params.language === "en"
      ? this.buildEnglishReviewPrompt(dimensions, canonBlock, styleBlock)
      : this.buildChineseReviewPrompt(dimensions, canonBlock, styleBlock);

    const userPrompt = this.buildFoundationExcerpt(params.foundation, params.language);

    const response = await this.chat([
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ], { temperature: 0.3 });

    return this.parseReviewResult(response.content, dimensions);
  }

  private originalDimensions(language: "zh" | "en", targetChapters?: number): ReadonlyArray<Dimension> {
    const target = Number.isFinite(targetChapters) && targetChapters && targetChapters > 0
      ? Math.round(targetChapters)
      : 40;
    const openingWindow = Math.min(5, target);
    const repeatWindow = Math.min(10, Math.max(3, target));
    return language === "en"
      ? [
          { name: `Premise Strength (Can it be stated in one sentence? Does it contain inherent conflict? Can it sustain the requested ${target} chapters?)`, weight: 1.5 },
          { name: "Controlling Idea (Is the thematic argument clear? Can the climax prove it?)", weight: 1.2 },
          { name: "Five Commandments (Global structure: inciting incident → progressive complications → crisis → climax → resolution)", weight: 1.5 },
          { name: "Genre Conventions (Are the obligatory scenes and conventions of this genre covered?)", weight: 1.0 },
          { name: `Opening Momentum (Can the first ${openingWindow} chapters create a page-turning hook?)`, weight: 1.2 },
          { name: "World Coherence (Is the worldbuilding internally consistent, specific, and does it actively drive plot?)", weight: 1.0 },
          { name: "Character Differentiation + Arc Potential (Distinct voices/motivations, internal flaw, arc trajectory?)", weight: 1.2 },
          { name: "Thematic Consistency (Do character arcs, plot, and worldbuilding serve the same theme?)", weight: 1.0 },
          { name: `Pacing Feasibility (Does the outline fit the requested ${target} chapters and avoid repeating the same beat for ${repeatWindow} chapters?)`, weight: 1.0 },
          { name: "Logic Risk Surface (Hook feasibility, setting contradictions, motivation chain breaks?)", weight: 1.0 },
        ]
      : [
          { name: `前提强度（一句话能说清？有内在冲突？能撑满用户要求的${target}章？）`, weight: 1.5 },
          { name: "控制理念（主题论点是否明确？高潮能否证明它？）", weight: 1.2 },
          { name: "五项诫命（全局结构：激励事件→渐进复杂→危机→高潮→结局）", weight: 1.5 },
          { name: "类型公约（该题材的必选场景和惯例是否覆盖？）", weight: 1.0 },
          { name: `开篇节奏（前${openingWindow}章能否形成翻页驱动力？）`, weight: 1.2 },
          { name: "世界一致性（世界观是否内洽、具体、且主动驱动剧情？）", weight: 1.0 },
          { name: "角色区分度 + 弧线潜力（声音/动机独立、有内在缺陷、弧线轨迹清晰？）", weight: 1.2 },
          { name: "主题一致性（角色弧线/情节/世界观是否服务同一主题？）", weight: 1.0 },
          { name: `节奏可行性（大纲是否适配用户要求的${target}章，并避免连续${repeatWindow}章同一种节拍？）`, weight: 1.0 },
          { name: "潜在逻辑风险（伏笔可行性、设定矛盾隐患、动机链断裂？）", weight: 1.0 },
        ];
  }

  private derivativeDimensions(language: "zh" | "en", mode: "fanfic" | "series", targetChapters?: number): ReadonlyArray<Dimension> {
    const target = Number.isFinite(targetChapters) && targetChapters && targetChapters > 0
      ? Math.round(targetChapters)
      : 40;
    const modeLabel = mode === "fanfic"
      ? (language === "en" ? "Fan Fiction" : "同人")
      : (language === "en" ? "Series" : "系列");
    return language === "en"
      ? [
          { name: `Source DNA Preservation (Does the ${modeLabel} respect the original's world rules, character personalities, and established facts?)`, weight: 1.2 },
          { name: `New Narrative Space (Is there a clear divergence point or new territory that gives the story room to be ORIGINAL, not a retelling?)`, weight: 1.2 },
          { name: "Premise Strength (Can the new story's premise be stated in one sentence with inherent conflict?)", weight: 1.5 },
          { name: "Controlling Idea (Is the thematic argument clear and distinct from the original?)", weight: 1.0 },
          { name: "Core Conflict (Is the new story's central conflict compelling and distinct from the original?)", weight: 1.2 },
          { name: `Opening Momentum (Can the first ${Math.min(5, target)} chapters create a page-turning hook without requiring 3 chapters of setup?)`, weight: 1.2 },
          { name: `Pacing Feasibility (Does the outline avoid the trap of re-walking the original's plot beats?)`, weight: 1.0 },
          { name: "Logic Risk Surface (Hook feasibility, setting contradictions, motivation chain breaks?)", weight: 1.0 },
        ]
      : [
          { name: `原作DNA保留（${modeLabel}是否尊重原作的世界规则、角色性格、已确立事实？）`, weight: 1.2 },
          { name: `新叙事空间（是否有明确的分岔点或新领域，让故事有原创空间，而非复述原作？）`, weight: 1.2 },
          { name: "前提强度（新故事的前提能否一句话说清且包含内在冲突？）", weight: 1.5 },
          { name: "控制理念（主题论点是否明确且区别于原作？）", weight: 1.0 },
          { name: "核心冲突（新故事的核心冲突是否有足够张力且区别于原作？）", weight: 1.2 },
          { name: `开篇节奏（前${Math.min(5, target)}章能否形成翻页驱动力，不需要3章铺垫？）`, weight: 1.2 },
          { name: "节奏可行性（卷纲是否避免了重走原作剧情节拍的陷阱？）", weight: 1.0 },
          { name: "潜在逻辑风险（伏笔可行性、设定矛盾隐患、动机链断裂？）", weight: 1.0 },
        ];
  }

  private buildChineseReviewPrompt(dimensions: ReadonlyArray<Dimension>, canonBlock: string, styleBlock: string): string {
    return `你是一位资深小说编辑，正在审核一本新书的基础设定（世界观 + 大纲 + 规则）。
你需要从以下维度逐项打分（0-100），并给出具体意见：

${dimensions.map((dim, i) => `${i + 1}. ${dim.name}（权重 ${dim.weight}）`).join("\n")}

## 评分标准
- 80+ 通过，可以开始写作
- 60-79 有明显问题，需要修改
- <60 方向性错误，需要重新设计

## 输出格式（严格遵守）
每个维度用如下格式输出：

=== DIMENSION: 1 ===
分数：{0-100}
意见：{具体反馈，指出问题所在并给出修改建议}

=== DIMENSION: 2 ===
分数：{0-100}
意见：{具体反馈}

...（每个维度一个 block，共 ${dimensions.length} 个）

=== OVERALL ===
总分：{加权平均分，按各维度权重计算}
通过：{是/否}
总评：{1-2段总结，指出最大的问题和最值得保留的优点}

=== YAML_META ===
（在此输出以下 YAML 结构，不要加 markdown 代码块标记）
totalScore: {加权平均分}
passed: {true/false}
dimensions:
${dimensions.map((dim, i) => `  - name: "${dim.name.replace(/（.*）/, "").replace(/\(.*\)/, "").trim()}"
    score: {分数}
    weight: ${dim.weight}
    weighted: {score * weight}`).join("\n")}
maxDimension: {name: "最高分维度名", score: 分数}
minDimension: {name: "最低分维度名", score: 分数}
${canonBlock}${styleBlock}

审核时要严格。不要因为"还行"就给高分。80分意味着"可以直接开写，不需要改"。
加权总分 = Σ(分数 × 权重) / Σ(权重)，不是简单平均。`;
  }

  private buildEnglishReviewPrompt(dimensions: ReadonlyArray<Dimension>, canonBlock: string, styleBlock: string): string {
    return `You are a senior fiction editor reviewing a new book's foundation (worldbuilding + outline + rules).
Score each dimension (0-100) with specific feedback:

${dimensions.map((dim, i) => `${i + 1}. ${dim.name} (weight ${dim.weight})`).join("\n")}

## Scoring
- 80+ Pass — ready to write
- 60-79 Needs revision
- <60 Fundamental direction problem

## Output format (strict)

=== DIMENSION: 1 ===
Score: {0-100}
Feedback: {specific feedback — identify the problem and suggest a fix}

=== DIMENSION: 2 ===
Score: {0-100}
Feedback: {specific feedback}

...

=== OVERALL ===
Total: {weighted average by dimension weights}
Passed: {yes/no}
Summary: {1-2 paragraphs — biggest problem and best quality}

=== YAML_META ===
(output the following YAML structure without markdown code fences)
totalScore: {weighted average}
passed: {true/false}
dimensions:
${dimensions.map((dim, i) => `  - name: "${dim.name.replace(/（.*）/, "").replace(/\(.*\)/, "").trim()}"
    score: {score}
    weight: ${dim.weight}
    weighted: {score * weight}`).join("\n")}
maxDimension: {name: "highest dimension name", score: number}
minDimension: {name: "lowest dimension name", score: number}
${canonBlock}${styleBlock}

Be strict. 80 means "ready to write without changes."
Weighted total = Σ(score × weight) / Σ(weight), not a simple average.`;
  }

  private buildFoundationExcerpt(foundation: ArchitectOutput, language: "zh" | "en"): string {
    const rolesExcerpt = (foundation.roles ?? [])
      .slice(0, 8)
      .map((role: { tier: string; name: string; content: string }) =>
        `---ROLE---\ntier: ${role.tier}\nname: ${role.name}\n---CONTENT---\n${role.content}`)
      .join("\n\n")
      .slice(0, 5000);
    const rolesBlock = rolesExcerpt
      ? (language === "en" ? `\n\n## Roles\n${rolesExcerpt}` : `\n\n## 人物卡\n${rolesExcerpt}`)
      : "";
    return language === "en"
      ? `## Story Bible\n${foundation.storyBible}\n\n## Volume Outline\n${foundation.volumeOutline}\n\n## Book Rules\n${foundation.bookRules}\n\n## Initial State\n${foundation.currentState}\n\n## Initial Hooks\n${foundation.pendingHooks}${rolesBlock}`
      : `## 世界设定\n${foundation.storyBible}\n\n## 卷纲\n${foundation.volumeOutline}\n\n## 规则\n${foundation.bookRules}\n\n## 初始状态\n${foundation.currentState}\n\n## 初始伏笔\n${foundation.pendingHooks}${rolesBlock}`;
  }

  private parseReviewResult(content: string, dimensions: ReadonlyArray<Dimension>): FoundationReviewResult {
    const yamlMeta = this.tryParseYamlMeta(content, dimensions);
    if (yamlMeta) return yamlMeta;
    return this.parseReviewResultRegex(content, dimensions);
  }

  private tryParseYamlMeta(content: string, dimensions: ReadonlyArray<Dimension>): FoundationReviewResult | null {
    const yamlMatch = content.match(/=== YAML_META ===\s*([\s\S]*?)$/);
    if (!yamlMatch) return null;
    const yamlBlock = yamlMatch[1]!.trim();
    try {
      const totalScoreMatch = yamlBlock.match(/totalScore:\s*(\d+)/);
      const passedMatch = yamlBlock.match(/passed:\s*(true|false)/i);
      const maxDimMatch = yamlBlock.match(/maxDimension:\s*\{name:\s*"([^"]+)",\s*score:\s*(\d+)\}/);
      const minDimMatch = yamlBlock.match(/minDimension:\s*\{name:\s*"([^"]+)",\s*score:\s*(\d+)\}/);
      if (!totalScoreMatch || !passedMatch) return null;

      const parsedDimensions: Array<{ name: string; score: number; weight: number; weighted: number; feedback: string }> = [];
      const dimRegex = /- name:\s*"([^"]+)"\s*\n\s*score:\s*(\d+)\s*\n\s*weight:\s*([\d.]+)\s*\n\s*weighted:\s*([\d.]+)/g;
      let dimMatch;
      while ((dimMatch = dimRegex.exec(yamlBlock)) !== null) {
        parsedDimensions.push({
          name: dimMatch[1]!,
          score: parseInt(dimMatch[2]!, 10),
          weight: parseFloat(dimMatch[3]!),
          weighted: parseFloat(dimMatch[4]!),
        });
      }
      if (parsedDimensions.length !== dimensions.length) return null;

      for (let i = 0; i < parsedDimensions.length && i < dimensions.length; i++) {
        parsedDimensions[i]!.name = dimensions[i]!.name;
        parsedDimensions[i]!.weight = dimensions[i]!.weight;
        const fbRegex = new RegExp(`=== DIMENSION: ${i + 1} ===\\s*[\\s\\S]*?(?:意见|Feedback)[：:]\\s*([\\s\\S]*?)(?==== |$)`);
        const fbMatch = content.match(fbRegex);
        parsedDimensions[i]!.feedback = fbMatch ? fbMatch[1]!.trim() : "(feedback not extracted)";
      }

      const totalScore = parseInt(totalScoreMatch[1]!, 10);
      const passed = passedMatch[1]!.toLowerCase() === "true";
      const overallMatch = content.match(/=== OVERALL ===[\s\S]*?(?:总评|Summary)[：:]\s*([\s\S]*?)(?=== YAML_META|$)/);
      const overallFeedback = overallMatch ? overallMatch[1]!.trim() : "(parse failed)";

      return {
        passed: passed && !parsedDimensions.some((d) => d.score < DIMENSION_FLOOR),
        totalScore,
        dimensions: parsedDimensions,
        overallFeedback,
        maxDimension: maxDimMatch ? { name: maxDimMatch[1]!, score: parseInt(maxDimMatch[2]!, 10) } : undefined,
        minDimension: minDimMatch ? { name: minDimMatch[1]!, score: parseInt(minDimMatch[2]!, 10) } : undefined,
      };
    } catch {
      return null;
    }
  }

  private parseReviewResultRegex(content: string, dimensions: ReadonlyArray<Dimension>): FoundationReviewResult {
    const parsedDimensions: Array<{ name: string; score: number; feedback: string; weight: number; weighted: number }> = [];
    for (let i = 0; i < dimensions.length; i++) {
      const regex = new RegExp(
        `=== DIMENSION: ${i + 1} ===\\s*[\\s\\S]*?(?:分数|Score)[：:]\\s*(\\d+)[\\s\\S]*?(?:意见|Feedback)[：:]\\s*([\\s\\S]*?)(?==== |$)`,
      );
      const match = content.match(regex);
      const score = match ? parseInt(match[1]!, 10) : 50;
      parsedDimensions.push({
        name: dimensions[i]!.name,
        score,
        feedback: match ? match[2]!.trim() : "(parse failed)",
        weight: dimensions[i]!.weight,
        weighted: score * dimensions[i]!.weight,
      });
    }

    const totalWeight = parsedDimensions.reduce((sum, d) => sum + d.weight, 0);
    const weightedTotal = totalWeight > 0
      ? Math.round(parsedDimensions.reduce((sum, d) => sum + d.score * d.weight, 0) / totalWeight)
      : 0;
    const anyBelowFloor = parsedDimensions.some((d) => d.score < DIMENSION_FLOOR);
    const passed = weightedTotal >= PASS_THRESHOLD && !anyBelowFloor;

    const overallMatch = content.match(
      /=== OVERALL ===[\s\S]*?(?:总评|Summary)[：:]\s*([\s\S]*?)$/,
    );
    const overallFeedback = overallMatch ? overallMatch[1]!.trim() : "(parse failed)";

    const maxDim = parsedDimensions.reduce((max, d) => d.score > max.score ? d : max, parsedDimensions[0]!);
    const minDim = parsedDimensions.reduce((min, d) => d.score < min.score ? d : min, parsedDimensions[0]!);

    return {
      passed,
      totalScore: weightedTotal,
      dimensions: parsedDimensions,
      overallFeedback,
      maxDimension: { name: maxDim.name, score: maxDim.score },
      minDimension: { name: minDim.name, score: minDim.score },
    };
  }
}
