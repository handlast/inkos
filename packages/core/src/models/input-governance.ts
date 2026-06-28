import { z } from "zod";

export const ChapterMemoSchema = z.object({
  chapter: z.number().int().min(1),
  goal: z.string().min(1).max(50),
  isGoldenOpening: z.boolean().default(false),
  body: z.string().min(1),
  threadRefs: z.array(z.string()).default([]),
  // Structured task-card fields (extracted from body or YAML frontmatter)
  chapterObjective: z.string().optional(),
  sceneSituation: z.string().optional(),
  protagonistVisibleIntent: z.string().optional(),
  immediateStakes: z.string().optional(),
  conflictDriver: z.string().optional(),
  exitStateChange: z.string().optional(),
  forbiddenMoves: z.array(z.string()).default([]),
  castBudget: z.string().optional(),
  // Field-relevance tags: planner declares which data categories this chapter
  // touches. Writer uses these to conditionally inject context.
  relevantFields: z.array(z.string()).default([]),
});

export type ChapterMemo = z.infer<typeof ChapterMemoSchema>;

export const ChapterIntentSchema = z.object({
  chapter: z.number().int().min(1),
  goal: z.string().min(1),
  outlineNode: z.string().optional(),
  arcContext: z.string().optional(),
  mustKeep: z.array(z.string()).default([]),
  mustAvoid: z.array(z.string()).default([]),
  styleEmphasis: z.array(z.string()).default([]),
});

export type ChapterIntent = z.infer<typeof ChapterIntentSchema>;

export const ContextSourceSchema = z.object({
  source: z.string().min(1),
  reason: z.string().min(1),
  excerpt: z.string().optional(),
});

export type ContextSource = z.infer<typeof ContextSourceSchema>;

export const ContextPackageSchema = z.object({
  chapter: z.number().int().min(1),
  asOfChapter: z.number().int().min(0).optional(),
  selectedContext: z.array(ContextSourceSchema).default([]),
});

export type ContextPackage = z.infer<typeof ContextPackageSchema>;

export const RuleLayerScopeSchema = z.enum(["global", "book", "arc", "local"]);
export type RuleLayerScope = z.infer<typeof RuleLayerScopeSchema>;

export const RuleLayerSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  precedence: z.number().int(),
  scope: RuleLayerScopeSchema,
});

export type RuleLayer = z.infer<typeof RuleLayerSchema>;

export const OverrideEdgeSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  allowed: z.boolean(),
  scope: z.string().min(1),
});

export type OverrideEdge = z.infer<typeof OverrideEdgeSchema>;

export const ActiveOverrideSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  target: z.string().min(1),
  reason: z.string().min(1),
});

export type ActiveOverride = z.infer<typeof ActiveOverrideSchema>;

export const RuleStackSectionsSchema = z.object({
  hard: z.array(z.string()).default([]),
  soft: z.array(z.string()).default([]),
  diagnostic: z.array(z.string()).default([]),
});

export type RuleStackSections = z.infer<typeof RuleStackSectionsSchema>;

export const RuleStackSchema = z.object({
  layers: z.array(RuleLayerSchema).min(1),
  sections: RuleStackSectionsSchema.default({
    hard: [],
    soft: [],
    diagnostic: [],
  }),
  overrideEdges: z.array(OverrideEdgeSchema).default([]),
  activeOverrides: z.array(ActiveOverrideSchema).default([]),
});

export type RuleStack = z.infer<typeof RuleStackSchema>;

export const ChapterTraceSchema = z.object({
  chapter: z.number().int().min(1),
  asOfChapter: z.number().int().min(0).optional(),
  plannerInputs: z.array(z.string()),
  composerInputs: z.array(z.string()),
  selectedSources: z.array(z.string()),
  contextTiers: z.object({
    protectedSources: z.array(z.string()).default([]),
    compressibleSources: z.array(z.string()).default([]),
  }).default({
    protectedSources: [],
    compressibleSources: [],
  }),
  tokenBudget: z.object({
    protectedTokens: z.number().int().nonnegative().default(0),
    compressibleTokens: z.number().int().nonnegative().default(0),
    totalSelectedTokens: z.number().int().nonnegative().default(0),
  }).default({
    protectedTokens: 0,
    compressibleTokens: 0,
    totalSelectedTokens: 0,
  }),
  notes: z.array(z.string()).default([]),
});

export type ChapterTrace = z.infer<typeof ChapterTraceSchema>;
