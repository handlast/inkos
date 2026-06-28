import type { GenreProfile } from "../models/genre-profile.js";

export interface SettlementOutput {
  readonly postSettlement: string;
  readonly updatedState: string;
  readonly updatedLedger: string;
  readonly updatedHooks: string;
  readonly chapterSummary: string;
  readonly updatedSubplots: string;
  readonly updatedEmotionalArcs: string;
  readonly updatedCharacterMatrix: string;
  readonly updatedRelationshipGraph: string;
  readonly updatedEraMood: string;
  readonly updatedMilitaryForces: string;
  readonly updatedWarTheater: string;
  readonly updatedDynastyTree: string;
  readonly updatedNavalForces: string;
  readonly updatedTerritoryControl: string;
  readonly updatedTreasuryState: string;
  readonly updatedEpochTimeline: string;
  readonly updatedGeography: string;
}

export function parseSettlementOutput(
  content: string,
  genreProfile: GenreProfile,
): SettlementOutput {
  const extract = (tag: string): string => {
    const regex = new RegExp(
      `=== ${tag} ===\\s*([\\s\\S]*?)(?==== [A-Z_]+ ===|$)`,
    );
    const match = content.match(regex);
    return match?.[1]?.trim() ?? "";
  };

  return {
    postSettlement: extract("POST_SETTLEMENT"),
    updatedState: extract("UPDATED_STATE") || "(状态卡未更新)",
    updatedLedger: genreProfile.numericalSystem
      ? (extract("UPDATED_LEDGER") || "(账本未更新)")
      : "",
    updatedHooks: extract("UPDATED_HOOKS") || "(伏笔池未更新)",
    chapterSummary: extract("CHAPTER_SUMMARY"),
    updatedSubplots: extract("UPDATED_SUBPLOTS"),
    updatedEmotionalArcs: extract("UPDATED_EMOTIONAL_ARCS"),
    updatedCharacterMatrix: extract("UPDATED_CHARACTER_MATRIX"),
    updatedRelationshipGraph: extract("UPDATED_RELATIONSHIP_GRAPH"),
    updatedEraMood: extract("UPDATED_ERA_MOOD"),
    updatedMilitaryForces: extract("UPDATED_MILITARY_FORCES"),
    updatedWarTheater: extract("UPDATED_WAR_THEATER"),
    updatedDynastyTree: extract("UPDATED_DYNASTY_TREE"),
    updatedNavalForces: extract("UPDATED_NAVAL_FORCES"),
    updatedTerritoryControl: extract("UPDATED_TERRITORY_CONTROL"),
    updatedTreasuryState: extract("UPDATED_TREASURY_STATE"),
    updatedEpochTimeline: extract("UPDATED_EPOCH_TIMELINE"),
    updatedGeography: extract("UPDATED_GEOGRAPHY"),
  };
}
