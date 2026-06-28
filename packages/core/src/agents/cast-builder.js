/**
 * Cast Builder Agent — generates cast_registry, item_catalog, faction_map
 * from the creative brief before the Architect generates the outline.
 *
 * "先建棋子再下棋" — prepare chess pieces before playing.
 */
import { BaseAgent } from "../agents/base.js";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));
const _cache = {};
function loadPrompt(filename) {
    if (!_cache[filename]) {
        _cache[filename] = readFileSync(join(dir, "prompts", filename), "utf-8").trim();
    }
    return _cache[filename];
}

export class CastBuilderAgent extends BaseAgent {
    get name() {
        return "cast-builder";
    }

    /**
     * Extract cast registry, item catalog, and faction map from brief.
     * @param {string} briefContent - The creative brief content
     * @param {string} language - "zh" or "en"
     * @returns {{castRegistry: string, itemCatalog: string, factionMap: string}}
     */
    async buildCast(briefContent, language = "zh") {
        const template = language === "en"
            ? loadPrompt("cast-builder-en.md")
            : loadPrompt("cast-builder-zh.md");
        const systemPrompt = template.replace("{{brief}}", briefContent);

        const userMessage = language === "en"
            ? "Extract all characters, items, and factions from the brief above. Output strictly in the three SECTION format."
            : "从上面的创作要求中提取所有角色、物品和势力。严格按三个 SECTION 格式输出。";

        const response = await this.chat([
            { role: "system", content: systemPrompt },
            { role: "user", content: userMessage },
        ], { temperature: 0.3 });

        return this.parseSections(response.content);
    }

    /**
     * Parse the LLM output into three sections.
     * @param {string} content
     * @returns {{castRegistry: string, itemCatalog: string, factionMap: string}}
     */
    parseSections(content) {
        const sectionPattern = /^\s*===\s*SECTION\s*[：:]\s*([^\n=]+?)\s*===\s*$/gim;
        const matches = [...content.matchAll(sectionPattern)];
        const sections = new Map();
        for (let i = 0; i < matches.length; i++) {
            const match = matches[i];
            const rawName = (match[1] ?? "").trim().toLowerCase();
            const start = (match.index ?? 0) + match[0].length;
            const end = matches[i + 1]?.index ?? content.length;
            sections.set(rawName, content.slice(start, end).trim());
        }
        return {
            castRegistry: sections.get("cast_registry") ?? "",
            itemCatalog: sections.get("item_catalog") ?? "",
            factionMap: sections.get("faction_map") ?? "",
        };
    }
}
