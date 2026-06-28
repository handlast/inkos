/**
 * Item state context builder.
 * Extracts character item/prop state for planner memo.
 */

import { extractDescribedProps, extractItemStateLines } from "../models/narrative-state-anchors.js";

function compactPlanningText(text, limit) {
  const compact = text.replace(/\s+/g, " ").trim();
  if (compact.length <= limit) return compact;
  return `${compact.slice(0, Math.max(0, limit - 1)).trim()}…`;
}

function parseCharacterMatrixProfileRows(markdown) {
  const rows = [];
  let current;
  let inProfiles = false;
  const flush = () => {
    if (current?.heading.trim() && current.notes.trim()) {
      rows.push({
        heading: current.heading.trim(),
        notes: current.notes.trim(),
      });
    }
    current = undefined;
  };
  for (const rawLine of markdown.split("\n")) {
    const line = rawLine.trim();
    if (/^##\s+(角色档案|Character Profiles)\s*$/i.test(line)) {
      flush();
      inProfiles = true;
      continue;
    }
    if (inProfiles && /^##\s+/.test(line)) {
      flush();
      break;
    }
    if (!inProfiles || !line) continue;
    if (line.startsWith("|") && !line.includes("---")) {
      const cells = line.split("|").slice(1);
      if (cells.at(-1)?.trim() === "") cells.pop();
      const normalized = cells.map((cell) => cell.trim());
      if (/^(角色|character)$/i.test(normalized[0] ?? "")) continue;
      if (normalized.length >= 4) {
        flush();
        current = {
          heading: normalized[0] ?? "",
          notes: normalized.slice(4).join(" | ").trim(),
        };
        continue;
      }
    }
    if (current) {
      current.notes = [current.notes, line.replace(/\|$/, "").trim()].filter(Boolean).join("\n");
    }
  }
  flush();
  return rows;
}

function renderCharacterItemStateBlock(heading, notes, language) {
  const props = extractDescribedProps(notes);
  const itemLines = extractItemStateLines(notes);
  if (props.length === 0 && itemLines.length === 0) return undefined;
  const lines = [];
  if (props.length > 0) {
    lines.push(`${language === "en" ? "describedProps" : "已完整描述道具"}: ${props.join("、")}`);
  }
  if (itemLines.length > 0) {
    lines.push(`${language === "en" ? "item state changes" : "物品状态变更"}: ${itemLines.join("；")}`);
  }
  return `### ${heading}\n${lines.join("\n")}`;
}

/**
 * Render character item state context from character matrix.
 * @param {string} characterMatrixRaw - Character matrix markdown
 * @param {string} language - "zh" or "en"
 * @returns {string} Formatted item state context
 */
export function renderCharacterItemStateContext(characterMatrixRaw, language = "zh") {
  const tableBlocks = parseCharacterMatrixProfileRows(characterMatrixRaw)
    .map((row) => renderCharacterItemStateBlock(row.heading, row.notes, language))
    .filter(Boolean);

  if (tableBlocks.length > 0) {
    return compactPlanningText(tableBlocks.join("\n\n"), 2600);
  }

  const blocks = [];
  const sections = characterMatrixRaw.split(/\n(?=##\s+)/);
  for (const section of sections) {
    const heading = section.match(/^##\s+(.+?)\s*$/m)?.[1]?.trim();
    if (!heading) continue;
    const block = renderCharacterItemStateBlock(heading, section, language);
    if (block) blocks.push(block);
  }

  if (blocks.length === 0) {
    return language === "en" ? "(no tracked item/prop state)" : "（暂无已追踪物品/道具状态）";
  }
  return compactPlanningText(blocks.join("\n\n"), 2600);
}
