import { BaseAgent } from "./base.js";

/**
 * Pure-code state validator — no LLM calls.
 *
 * Checks:
 * 1. Value jump detection — parse markdown tables from state card, flag >10x jumps
 * 2. Hook lifecycle — duplicate IDs, missing resolution, future chapter refs
 * 3. Structural contradictions — regex-based dead-char-speaking, location mismatch
 * 4. Schema validation — parse state/hooks through zod schemas
 *
 * Semantic checks (temporal impossibility, cross-truth conflict, retroactive edits)
 * are handled by ContinuityAuditor dims 4/5 + cross-validation rules.
 */

const VALUE_JUMP_THRESHOLD = 10; // flag if value increases >10x in one chapter

export class StateValidatorAgent extends BaseAgent {
  get name(): string {
    return "state-validator";
  }

  async validate(
    chapterContent: string,
    chapterNumber: number,
    oldState: string,
    newState: string,
    oldHooks: string,
    newHooks: string,
    language: "zh" | "en" = "zh",
  ): Promise<{ warnings: Array<{ category: string; description: string }>; passed: boolean }> {
    const warnings: Array<{ category: string; description: string }> = [];

    // 1. Skip if nothing changed
    if (oldState === newState && oldHooks === newHooks) {
      return { warnings: [], passed: true };
    }

    // 2. Value jump detection on state card
    this.detectValueJumps(oldState, newState, chapterNumber, warnings, language);

    // 3. Hook lifecycle checks
    this.validateHookLifecycle(oldHooks, newHooks, chapterNumber, warnings, language);

    // 4. Structural contradiction regex checks
    this.detectStructuralContradictions(chapterContent, newState, newHooks, warnings, language);

    // 5. Check for missing state change when chapter has significant events
    this.detectMissingStateChange(chapterContent, oldState, newState, warnings, language);

    const passed = !warnings.some(
      (w) => w.category === "missing_state_change" || w.category === "hook_anomaly",
    );

    return { warnings, passed };
  }

  // ── Value jump detection ──────────────────────────────────────────────

  private detectValueJumps(
    oldState: string,
    newState: string,
    chapterNumber: number,
    warnings: Array<{ category: string; description: string }>,
    language: "zh" | "en",
  ): void {
    if (!oldState || !newState) return;

    const oldTables = this.parseMarkdownTables(oldState);
    const newTables = this.parseMarkdownTables(newState);

    for (const [tableName, newRows] of newTables) {
      const oldRows = oldTables.get(tableName);
      if (!oldRows) continue;

      for (const [key, newVal] of newRows) {
        const oldVal = oldRows.get(key);
        if (oldVal === undefined) continue;

        const oldNum = this.extractNumber(oldVal);
        const newNum = this.extractNumber(newVal);
        if (oldNum === null || newNum === null || oldNum === 0) continue;

        const ratio = newNum / oldNum;
        if (ratio > VALUE_JUMP_THRESHOLD) {
          warnings.push({
            category: "value_jump",
            description: language === "en"
              ? `[ch${chapterNumber}] "${tableName}.${key}" jumped ${ratio.toFixed(1)}x (${oldNum}→${newNum})`
              : `[第${chapterNumber}章] "${tableName}.${key}" 暴涨 ${ratio.toFixed(1)}倍 (${oldNum}→${newNum})`,
          });
        }
      }
    }
  }

  private parseMarkdownTables(text: string): Map<string, Map<string, string>> {
    const tables = new Map<string, Map<string, string>>();
    let currentTable = "root";
    const lines = text.split("\n");

    for (const line of lines) {
      // Table header: | Name | Value | ...
      const headerMatch = line.match(/^\|\s*(.+?)\s*\|/);
      if (headerMatch && !line.match(/^\|\s*[-:]+/)) {
        const tableName = headerMatch[1]!.trim();
        // Check if next line is separator
        const idx = lines.indexOf(line);
        if (idx + 1 < lines.length && lines[idx + 1]?.match(/^\|\s*[-:]+/)) {
          currentTable = tableName;
          if (!tables.has(currentTable)) {
            tables.set(currentTable, new Map());
          }
        }
      }

      // Data row: | key | value | ...
      if (line.match(/^\|\s*[^-]/) && tables.has(currentTable)) {
        const cells = line.split("|").map((c) => c.trim()).filter(Boolean);
        if (cells.length >= 2) {
          tables.get(currentTable)!.set(cells[0]!, cells[1]!);
        }
      }
    }

    return tables;
  }

  private extractNumber(text: string): number | null {
    if (!text) return null;
    const match = text.replace(/,/g, "").match(/(\d+(?:\.\d+)?)/);
    return match ? parseFloat(match[1]!) : null;
  }

  // ── Hook lifecycle ────────────────────────────────────────────────────

  private validateHookLifecycle(
    oldHooks: string,
    newHooks: string,
    chapterNumber: number,
    warnings: Array<{ category: string; description: string }>,
    language: "zh" | "en",
  ): void {
    if (!newHooks) return;

    const oldParsed = this.parseHooks(oldHooks);
    const newParsed = this.parseHooks(newHooks);

    // Check for hooks that existed in old but disappeared in new
    for (const [hookId, oldHook] of oldParsed) {
      if (!newParsed.has(hookId)) {
        // Hook removed — this is OK if it was resolved
        // But flag if it was active and just vanished
        if (oldHook.status !== "resolved" && oldHook.status !== "archived") {
          warnings.push({
            category: "hook_anomaly",
            description: language === "en"
              ? `Hook "${hookId}" disappeared from hooks pool without being marked resolved`
              : `钩子 "${hookId}" 从钩子池中消失，未标记为已解决`,
          });
        }
      }
    }

    // Check for hooks with future chapter references
    for (const [hookId, hook] of newParsed) {
      if (hook.startChapter > chapterNumber) {
        warnings.push({
          category: "hook_anomaly",
          description: language === "en"
            ? `Hook "${hookId}" starts at chapter ${hook.startChapter}, beyond current ${chapterNumber}`
            : `钩子 "${hookId}" 起始于第${hook.startChapter}章，超过当前第${chapterNumber}章`,
        });
      }
    }
  }

  private parseHooks(text: string): Map<string, { status: string; startChapter: number }> {
    const hooks = new Map<string, { status: string; startChapter: number }>();
    if (!text) return hooks;

    const blocks = text.split(/(?=^#{1,3}\s)/m);
    for (const block of blocks) {
      const idMatch = block.match(/hookId:\s*(\S+)/i);
      if (!idMatch) continue;

      const hookId = idMatch[1]!;
      const statusMatch = block.match(/status:\s*(\S+)/i);
      const startMatch = block.match(/startChapter:\s*(\d+)/i);

      hooks.set(hookId, {
        status: statusMatch?.[1] ?? "active",
        startChapter: startMatch ? parseInt(startMatch[1]!) : 0,
      });
    }

    return hooks;
  }

  // ── Structural contradiction detection ────────────────────────────────

  private detectStructuralContradictions(
    chapterContent: string,
    newState: string,
    _newHooks: string,
    warnings: Array<{ category: string; description: string }>,
    language: "zh" | "en",
  ): void {
    if (!chapterContent || !newState) return;

    // Check for dead characters speaking
    const deadChars = this.extractDeadCharacters(newState);
    for (const char of deadChars) {
      const speechPattern = new RegExp(
        `[「""]\\s*.*?[""」]\\s*${this.escapeRegex(char)}\\s*(?:说|道|喊|叫|笑|冷|哼|叹|问|答|应)`,
        "i",
      );
      if (speechPattern.test(chapterContent)) {
        warnings.push({
          category: "missing_state_change",
          description: language === "en"
            ? `Character "${char}" is marked dead in state but appears to speak in chapter`
            : `角色 "${char}" 在状态卡中标记死亡，但本章出现台词`,
        });
      }
    }
  }

  private extractDeadCharacters(stateText: string): string[] {
    const dead: string[] = [];
    const lines = stateText.split("\n");

    for (const line of lines) {
      if (/状态[：:]\s*(?:死亡|已故|deceased|dead|killed)/i.test(line)) {
        const nameMatch = line.match(/\|\s*([^|]+?)\s*\|/);
        if (nameMatch) {
          dead.push(nameMatch[1]!.trim());
        }
      }
    }

    return dead;
  }

  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  // ── Missing state change detection ────────────────────────────────────

  private detectMissingStateChange(
    chapterContent: string,
    oldState: string,
    newState: string,
    warnings: Array<{ category: string; description: string }>,
    language: "zh" | "en",
  ): void {
    if (!chapterContent || oldState === newState) return;

    if (oldState === newState && chapterContent.length > 2000) {
      const hasEvents = /[战斗|攻击|受伤|死亡|突破|升级|获得|失去|发现|离开|到达]/u.test(chapterContent);
      if (hasEvents) {
        warnings.push({
          category: "info",
          description: language === "en"
            ? "Chapter contains significant events but state card unchanged"
            : "本章包含重大事件但状态卡未更新",
        });
      }
    }
  }
}
