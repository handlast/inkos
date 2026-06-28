import { BaseAgent } from "./base.js";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Post-write humanization agent. Rewrites chapter prose with higher temperature
 * to reduce AIGC detectability while preserving all plot, character behavior, and meaning.
 *
 * Parameters: temperature 1.1, topP 0.92, frequencyPenalty 0.4
 * These are tuned for creative variation while maintaining coherence.
 */
export class HumanizeAgent extends BaseAgent {
    get name() {
        return "humanizer";
    }

    async humanize(chapterContent, language) {
        const promptFile = language === "en"
            ? "writer-humanize-en.md"
            : "writer-humanize-zh.md";
        const promptPath = join(__dirname, "prompts", promptFile);
        let systemPrompt;
        try {
            systemPrompt = await readFile(promptPath, "utf-8");
        } catch {
            // Prompt file missing — skip humanization, return content unchanged
            return { content: chapterContent, applied: false };
        }

        const response = await this.chat([
            { role: "system", content: systemPrompt },
            { role: "user", content: chapterContent },
        ], {
            temperature: 1.1,
            topP: 0.92,
            frequencyPenalty: 0.4,
        });

        return {
            content: response.content,
            tokenUsage: response.usage,
            applied: true,
        };
    }
}
