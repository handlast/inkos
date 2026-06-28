/**
 * Worldview planning context builder.
 * Extracts worldview facets from story_frame for planner memo.
 */

import { WORLDVIEW_FACETS } from "../models/foundation-anchors.js";

const WORLDVIEW_PLANNING_SECTION_LIMIT = 350;

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
 * Render worldview planning context from story_frame.
 * @param {string} storyFrame - Story frame content
 * @param {string} language - "zh" or "en"
 * @returns {string} Formatted worldview context
 */
export function renderWorldviewPlanningContext(storyFrame, language = "zh") {
  const lines = WORLDVIEW_FACETS.map((facet) => {
    const title = language === "en" ? facet.enTitle : facet.zhTitle;
    const fallbackTitle = language === "en" ? facet.zhTitle : facet.enTitle;
    const section = extractHeadingSection(storyFrame, title) || extractHeadingSection(storyFrame, fallbackTitle);
    if (!section) return undefined;
    return `- ${title}: ${compactPlanningText(section, WORLDVIEW_PLANNING_SECTION_LIMIT)}`;
  }).filter(Boolean);

  if (lines.length === 0) {
    return language === "en" ? "(no story_frame facet material)" : "（暂无 story_frame 切面素材）";
  }
  return lines.join("\n");
}
