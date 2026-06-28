/**
 * Role planning context builder.
 * Extracts role card facets for planner memo.
 */

import { CHARACTER_EXECUTION_ANCHORS, CHARACTER_FACETS } from "../models/foundation-anchors.js";

const ROLE_PLANNING_SECTION_LIMIT = 280;
const ROLE_PLANNING_TOTAL_LIMIT = 7200;
const ROLE_PLANNING_FACET_IDS = new Set([
  "living_anchor",
  "inner_profile",
  "goals_and_regrets",
  "social_relations",
  "emotional_state",
  "action_principle",
  "secrets",
  "verbal_tics",
  "current_status",
]);

function compactPlanningText(text, limit) {
  const compact = text.replace(/\s+/g, " ").trim();
  if (compact.length <= limit) return compact;
  return `${compact.slice(0, Math.max(0, limit - 1)).trim()}…`;
}

function extractHeadingSection(content, title) {
  const lines = content.split("\n");
  let buffer = null;
  let sectionLevel = 0;
  for (const line of lines) {
    const match = line.match(/^(#+)\s*(.+?)\s*$/);
    if (match) {
      const level = match[1].length;
      const heading = match[2].trim();
      if (buffer && level <= sectionLevel) break;
      if (heading === title) {
        buffer = [];
        sectionLevel = level;
        continue;
      }
    }
    if (buffer) buffer.push(line);
  }
  return buffer?.join("\n").trim() || "";
}

/**
 * Render role planning context from role cards.
 * @param {Array<{name: string, tier: string, content: string}>} roleCards - Role card objects
 * @param {string} language - "zh" or "en"
 * @returns {string} Formatted role context
 */
export function renderRolePlanningContext(roleCards, language = "zh") {
  if (roleCards.length === 0) {
    return language === "en" ? "(no role-card material)" : "（暂无 roles 人物卡素材）";
  }

  const facetTitles = CHARACTER_FACETS
    .filter((facet) => ROLE_PLANNING_FACET_IDS.has(facet.id))
    .map((facet) => language === "en" ? facet.enTitle : facet.zhTitle);
  const executionTitles = CHARACTER_EXECUTION_ANCHORS.map((anchor) => language === "en" ? anchor.enTitle : anchor.zhTitle);
  const titles = [...facetTitles, ...executionTitles];

  const blocks = roleCards.map((card) => {
    const lines = titles.map((title) => {
      const section = extractHeadingSection(card.content, title);
      if (!section) return undefined;
      return `- ${title}: ${compactPlanningText(section, ROLE_PLANNING_SECTION_LIMIT)}`;
    }).filter(Boolean);

    if (lines.length === 0) return undefined;
    return `### ${card.name} (${card.tier})\n${lines.join("\n")}`;
  }).filter(Boolean);

  if (blocks.length === 0) {
    return language === "en" ? "(role cards have no matching anchor material)" : "（人物卡暂无可匹配锚点素材）";
  }
  return compactPlanningText(blocks.join("\n\n"), ROLE_PLANNING_TOTAL_LIMIT);
}
