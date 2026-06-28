/**
 * Pipeline Hooks — event-based extension system for InkOS pipeline
 *
 * Enables modular patches to hook into pipeline stages without modifying runner.js.
 * Modules register handlers for specific events; runner.js calls emit() at each stage.
 *
 * Usage:
 *   import { getPipelineHooks } from "./pipeline-hooks.js";
 *   const hooks = getPipelineHooks();
 *   hooks.on("post-analyzer", async (ctx) => { ... });
 *
 * Runner calls:
 *   await hooks.emit("post-analyzer", { content, chapterNumber, bookDir, ... });
 */
export class PipelineHooks {
    constructor() {
        this.handlers = new Map();
    }
    /**
     * Register a handler for an event.
     * @param {string} event
     * @param {function} handler - async (ctx) => void
     */
    on(event, handler) {
        if (!this.handlers.has(event)) {
            this.handlers.set(event, []);
        }
        this.handlers.get(event).push(handler);
    }
    /**
     * Remove a handler.
     */
    off(event, handler) {
        const list = this.handlers.get(event);
        if (!list) return;
        const idx = list.indexOf(handler);
        if (idx >= 0) list.splice(idx, 1);
    }
    /**
     * Emit an event, calling all registered handlers sequentially.
     * Handlers can mutate ctx to pass data downstream.
     * @param {string} event
     * @param {object} ctx - shared context object
     */
    async emit(event, ctx) {
        const list = this.handlers.get(event);
        if (!list || list.length === 0) return;
        for (const handler of list) {
            try {
                await handler(ctx);
            } catch (error) {
                // Log but don't break the pipeline
                ctx.logger?.warn?.(`[hooks] ${event} handler failed: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
    }
    /**
     * Check if any handlers are registered for an event.
     */
    has(event) {
        const list = this.handlers.get(event);
        return list ? list.length > 0 : false;
    }
    /**
     * List all registered events.
     */
    events() {
        return [...this.handlers.keys()];
    }
}
// Singleton instance
let instance = null;
export function getPipelineHooks() {
    if (!instance) {
        instance = new PipelineHooks();
    }
    return instance;
}
export function resetPipelineHooks() {
    instance = null;
}
/**
 * Well-known hook events.
 */
export const HookEvents = {
    /** After Writer produces draft, before Analyzer */
    POST_WRITE: "post-write",
    /** After Analyzer produces truth files, before persistence */
    POST_ANALYZER: "post-analyzer",
    /** After Reviser produces revised content */
    POST_REVISE: "post-revise",
    /** After all truth files flushed to disk */
    POST_PERSIST: "post-persist",
    /** Before chapter artifacts are persisted */
    PRE_PERSIST: "pre-persist",
    /** After chapter index + snapshot updated */
    POST_CHAPTER_COMPLETE: "post-chapter-complete",
    /** After audit completes */
    POST_AUDIT: "post-audit",
};
