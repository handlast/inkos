import {
  RuntimeStateDeltaSchema,
  type RuntimeStateDelta,
} from "../models/runtime-state.js";

export interface SettlerDeltaOutput {
  readonly postSettlement: string;
  readonly runtimeStateDelta: RuntimeStateDelta;
}

function sanitizeJSON(str: string): string {
  return str
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
    .replace(/,\s*([}\]])/g, "$1");
}

export function parseSettlerDeltaOutput(content: string): SettlerDeltaOutput {
  const extract = (tag: string): string => {
    const regex = new RegExp(
      `=== ${tag} ===\\s*([\\s\\S]*?)(?==== [A-Z_]+ ===|$)`,
    );
    const match = content.match(regex);
    return match?.[1]?.trim() ?? "";
  };

  const rawDelta = extract("RUNTIME_STATE_DELTA");
  if (!rawDelta) {
    throw new Error("runtime state delta block is missing");
  }

  const jsonPayload = stripCodeFence(rawDelta);
  let parsed: unknown;
  try {
    parsed = JSON.parse(sanitizeJSON(jsonPayload));
  } catch (error) {
    throw new Error(`runtime state delta is not valid JSON: ${String(error)}`);
  }

  try {
    return {
      postSettlement: extract("POST_SETTLEMENT"),
      runtimeStateDelta: RuntimeStateDeltaSchema.parse(normalizeRuntimeStateDeltaCandidate(parsed)),
    };
  } catch (error) {
    throw new Error(`runtime state delta failed schema validation: ${String(error)}`);
  }
}

function normalizeRuntimeStateDeltaCandidate(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }
  const candidate = { ...(value as Record<string, unknown>) };
  candidate.subplotOps = normalizeSubplotOps(candidate.subplotOps);
  candidate.emotionalArcOps = normalizeEmotionalArcOps(candidate.emotionalArcOps);
  candidate.characterMatrixOps = normalizeCharacterMatrixOps(candidate.characterMatrixOps);
  candidate.characterAssetsOps = normalizeCharacterAssetsOps(candidate.characterAssetsOps);
  candidate.allianceOps = normalizeAllianceOps(candidate.allianceOps);
  return candidate;
}

function normalizeSubplotOps(value: unknown): unknown[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((op: unknown) => {
    if (!op || typeof op !== "object" || Array.isArray(op)) {
      return [];
    }
    const obj = op as Record<string, unknown>;
    const subplotId = stringField(obj, "subplotId") ?? stringField(obj, "id") ?? stringField(obj, "subplot_id");
    if (!subplotId) {
      return [];
    }
    const rawOp = String(obj.op ?? "advance").trim().toLowerCase();
    const mappedOp = rawOp === "update" || rawOp === "append" || rawOp === "mention" ? "advance"
      : rawOp === "defer" || rawOp === "pause" || rawOp === "paused" ? "pause"
        : rawOp === "close" || rawOp === "resolved" ? "resolve"
          : rawOp === "upsert" || rawOp === "resolve" || rawOp === "advance" ? rawOp
            : "advance";
    return [{ ...obj, op: mappedOp, subplotId }];
  });
}

function normalizeEmotionalArcOps(value: unknown): unknown[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((op: unknown) => {
    if (!op || typeof op !== "object" || Array.isArray(op)) {
      return [];
    }
    const obj = op as Record<string, unknown>;
    const arcId = stringField(obj, "arcId") ?? stringField(obj, "id") ?? stringField(obj, "arc_id");
    if (!arcId) {
      return [];
    }
    const rawOp = String(obj.op ?? "update").trim().toLowerCase();
    const mappedOp = rawOp === "upsert" || rawOp === "resolve" || rawOp === "update" ? rawOp
      : rawOp === "close" || rawOp === "resolved" ? "resolve"
        : "update";
    return [{ ...obj, op: mappedOp, arcId }];
  });
}

function normalizeCharacterMatrixOps(value: unknown): unknown[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((op: unknown) => {
    if (!op || typeof op !== "object" || Array.isArray(op)) {
      return [];
    }
    const obj = op as Record<string, unknown>;
    const rawOp = String(obj.op ?? "upsert_profile").trim().toLowerCase();
    const characterName = stringField(obj, "characterName") ?? stringField(obj, "name") ?? stringField(obj, "character");
    const characterA = stringField(obj, "characterA") ?? stringField(obj, "from") ?? stringField(obj, "source");
    const characterB = stringField(obj, "characterB") ?? stringField(obj, "to") ?? stringField(obj, "target");
    if (rawOp.includes("relationship") || (characterA && characterB)) {
      if (!characterA || !characterB) {
        return [];
      }
      return [{ ...obj, op: rawOp.includes("remove") ? "remove_relationship" : "upsert_relationship", characterA, characterB }];
    }
    if (rawOp.includes("remove")) {
      return characterName ? [{ ...obj, op: "remove_profile", characterName }] : [];
    }
    return characterName ? [{ ...obj, op: "upsert_profile", characterName }] : [];
  });
}

function normalizeCharacterAssetsOps(value: unknown): unknown[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((op: unknown) => {
    if (!op || typeof op !== "object" || Array.isArray(op)) {
      return [];
    }
    const obj = op as Record<string, unknown>;
    const rawOp = String(obj.op ?? "upsert").trim().toLowerCase();
    const assetId = stringField(obj, "assetId") ?? stringField(obj, "asset_id") ?? stringField(obj, "id");
    const holder = stringField(obj, "holder") ?? stringField(obj, "owner") ?? stringField(obj, "character");
    const targetHolder = stringField(obj, "targetHolder") ?? stringField(obj, "toHolder") ?? stringField(obj, "to");
    if (rawOp === "batch_upsert" && Array.isArray(obj.assets)) {
      return [{ ...obj, op: "batch_upsert", assets: obj.assets }];
    }
    if (rawOp === "batch_remove" && Array.isArray(obj.assetIds)) {
      return [{ ...obj, op: "batch_remove", assetIds: obj.assetIds }];
    }
    if (rawOp === "batch_transfer" && Array.isArray(obj.transfers)) {
      return [{ ...obj, op: "batch_transfer", transfers: obj.transfers }];
    }
    if (rawOp === "transfer" && assetId && targetHolder) {
      return [{ ...obj, op: "transfer", assetId, targetHolder }];
    }
    if (rawOp === "update_status" && assetId) {
      return [{ ...obj, op: "update_status", assetId }];
    }
    if (rawOp === "remove" && assetId) {
      return [{ ...obj, op: "remove", assetId }];
    }
    if (assetId && holder) {
      return [{ ...obj, op: "upsert", assetId, holder }];
    }
    return [];
  });
}

function normalizeAllianceOps(value: unknown): unknown[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((op: unknown) => {
    if (!op || typeof op !== "object" || Array.isArray(op)) {
      return [];
    }
    const obj = op as Record<string, unknown>;
    const rawOp = String(obj.op ?? "upsert_faction").trim().toLowerCase();
    const factionId = stringField(obj, "factionId") ?? stringField(obj, "faction_id") ?? stringField(obj, "id");
    const factionA = stringField(obj, "factionA") ?? stringField(obj, "faction_a") ?? stringField(obj, "from");
    const factionB = stringField(obj, "factionB") ?? stringField(obj, "faction_b") ?? stringField(obj, "to");
    const eventId = stringField(obj, "eventId") ?? stringField(obj, "event_id");
    if (rawOp === "record_membership") {
      return [{ ...obj, op: "record_membership" }];
    }
    if (rawOp === "record_event" && eventId) {
      return [{ ...obj, op: "record_event", eventId }];
    }
    if (rawOp === "update_relation" && factionA && factionB) {
      return [{ ...obj, op: "update_relation", factionA, factionB }];
    }
    if (rawOp === "dissolve_faction" && factionId) {
      return [{ ...obj, op: "dissolve_faction", factionId }];
    }
    if (factionId) {
      return [{ ...obj, op: "upsert_faction", factionId }];
    }
    return [];
  });
}

function stringField(value: Record<string, unknown>, key: string): string | undefined {
  const field = value[key];
  return typeof field === "string" && field.trim() ? field.trim() : undefined;
}

function stripCodeFence(value: string): string {
  const trimmed = value.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced?.[1]?.trim() ?? trimmed;
}
