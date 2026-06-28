/**
 * character-context-card.js
 *
 * Aggregates information from multiple runtime-state subsystems into a
 * unified "Character Context Card" for a single character. Used by the
 * writer pipeline so the LLM sees a single, structured block per
 * character instead of scattered truth files.
 *
 * Subsystems consumed:
 * - character_matrix (profiles + relationships)
 * - character_assets (items held/carried)
 * - alliance_state (factions + diplomatic relations + membership events)
 * - emotional_arcs (emotional state)
 * - hooks (related foreshadow threads)
 * - relationship_graph (multi-dimensional structured relationships)
 * - era_mood (collective era mood dimensions)
 * - military_forces (troop counts, composition, morale, supplies)
 * - war_theater (active wars: belligerents, objectives, status)
 * - battle_log (per-chapter battles with outcome + casualties)
 * - territory_control (controlled regions/cities/forts + history)
 * - epoch_timeline (multi-stage era segmentation: phase/start/end/dominant powers/key events)
 * - naval_forces (fleets: admiral, ship counts/types, naval supremacy)
 * - dynasty_tree (lineage: generation, parent/spouse, inheritance order, regency)
 * - treasury_state (gold/grain/mercenary_budget per faction)
 *
 * Independent / factionless characters:
 *  When a character has no faction membership in alliance_state, the war / territory
 *  sections fall back to a bounded "Observer" overview — top-N active wars and top-N
 *  contested territories — so wanderers, scholars, exiled princes still see a relevant
 *  but bounded world snapshot rather than nothing at all.
 */
/**
 * Build context cards from raw markdown strings (writer pipeline entry point).
 * Parses markdown internally, then delegates to buildCharacterContextCards.
 */
export function buildCharacterContextCardsFromMarkdown(characterNames, params) {
    const state = {
        characterMatrix: parseCharacterMatrixMarkdown(params.characterMatrix),
        characterAssets: parseCharacterAssetsMarkdown(params.characterAssets),
        allianceState: parseAllianceStateMarkdown(params.allianceState),
        emotionalArcs: parseEmotionalArcsMarkdown(params.emotionalArcs),
        hooks: parseHooksMarkdown(params.hooks),
        relationshipGraph: parseRelationshipGraphMarkdown(params.relationshipGraph),
        eraMood: parseEraMoodMarkdown(params.eraMood),
        militaryForces: parseMilitaryForcesMarkdown(params.militaryForces),
        warTheater: parseWarTheaterMarkdown(params.warTheater),
        battleLog: parseBattleLogMarkdown(params.battleLog),
        territoryControl: parseTerritoryControlMarkdown(params.territoryControl),
        epochTimeline: parseEpochTimelineMarkdown(params.epochTimeline),
        navalForces: parseNavalForcesMarkdown(params.navalForces),
        dynastyTree: parseDynastyTreeMarkdown(params.dynastyTree),
        treasuryState: parseTreasuryStateMarkdown(params.treasuryState),
        geography: parseGeographyMarkdown(params.geography),
        chapterNumber: params.chapterNumber,
        language: params.language,
    };
    return buildCharacterContextCards(characterNames, state);
}
/**
 * Build a unified context card for one character.
 *
 * @param {string} characterName
 * @param {object} state - all runtime-state subsystems
 * @param {object} state.characterMatrix - { profiles, relationships }
 * @param {object} state.characterAssets - { assets, relationships }
 * @param {object} state.allianceState - { factions, relations, events, membershipEvents }
 * @param {object} state.emotionalArcs - { rows }
 * @param {object} state.hooks - { hooks }
 * @param {number} state.chapterNumber
 * @param {"zh"|"en"} state.language
 * @returns {string} formatted markdown block
 */
export function buildCharacterContextCard(characterName, state) {
    const lang = state.language ?? "zh";
    const isEn = lang === "en";
    const sections = [];
    const hasFaction = (state.allianceState?.factions ?? [])
        .some((f) => f.members.includes(characterName));
    // 0. Era / epoch banner (shown once at the top of every card so the LLM
    //    always knows what dynastic phase the current chapter belongs to)
    const epochLine = buildEpochLine(state.epochTimeline, state.chapterNumber, isEn);
    if (epochLine) {
        sections.push(isEn ? "**Current Epoch**:" : "**当前纪元**:");
        sections.push(epochLine);
    }
    // 1. Faction memberships
    const factionLines = buildFactionLines(characterName, state.allianceState, isEn);
    if (factionLines.length > 0) {
        sections.push(isEn ? "**Faction Memberships**:" : "**所属势力**:");
        sections.push(...factionLines);
    } else {
        sections.push(isEn ? "**Faction Memberships**:" : "**所属势力**:");
        sections.push(isEn
            ? "- (Independent — no faction affiliation; treated as an unaligned observer.)"
            : "- （独立——无派系归属，按未结盟观察者处理。）");
    }
    // 2. Assets
    const assetLines = buildAssetLines(characterName, state.characterAssets, isEn, state.chapterNumber);
    if (assetLines.length > 0) {
        sections.push(isEn ? "**Carried Assets**:" : "**持有资产**:");
        sections.push(...assetLines);
    }
    // 2.5 Lifecycle status
    if (state.characterMatrix?.profiles) {
        const myProfile = state.characterMatrix.profiles.find((p) => p.characterName === characterName);
        if (myProfile?.lifecycle && myProfile.lifecycle !== "alive") {
            sections.push(isEn ? "**Status**:" : "**状态**:");
            sections.push(`- ${isEn ? myProfile.lifecycle : translateLifecycle(myProfile.lifecycle)}`);
        }
    }
    // 3. Relationships (from character_matrix)
    const relLines = buildRelationshipLines(characterName, state.characterMatrix, isEn);
    if (relLines.length > 0) {
        sections.push(isEn ? "**Relationships**:" : "**社交关系**:");
        sections.push(...relLines);
    }
    // 3.5 Relationship graph (multi-dimensional structured relationships)
    const graphLines = buildRelationshipGraphLines(characterName, state.relationshipGraph, isEn);
    if (graphLines.length > 0) {
        sections.push(isEn ? "**Relationship Graph**:" : "**关系图谱**:");
        sections.push(...graphLines);
    }
    // 4. Emotional arc
    const emotionLine = buildEmotionLine(characterName, state.emotionalArcs, isEn);
    if (emotionLine) {
        sections.push(isEn ? "**Emotional State**:" : "**情绪状态**:");
        sections.push(emotionLine);
    }
    // 4.5 Era mood (global context, shown once per card)
    const eraMoodLine = buildEraMoodLine(state.eraMood, state.chapterNumber, isEn);
    if (eraMoodLine) {
        sections.push(isEn ? "**Era Mood**:" : "**时代情绪**:");
        sections.push(eraMoodLine);
    }
    // 5. Related hooks
    const hookLines = buildHookLines(characterName, state.hooks, isEn);
    if (hookLines.length > 0) {
        sections.push(isEn ? "**Related Hooks**:" : "**关联伏笔**:");
        sections.push(...hookLines);
    }
    // 5.5 Military command (forces under this character)
    const forceLines = buildMilitaryForceLines(characterName, state.militaryForces, isEn);
    if (forceLines.length > 0) {
        sections.push(isEn ? "**Forces Under Command**:" : "**麾下兵力**:");
        sections.push(...forceLines);
    }
    // 5.6 Active wars involving this character's factions
    //     For factionless characters fall back to a bounded global overview so
    //     wanderers/scholars still see the most important ongoing conflicts.
    const warLines = hasFaction
        ? buildWarTheaterLines(characterName, state.warTheater, state.allianceState, isEn)
        : buildIndependentWarOverview(state.warTheater, isEn);
    if (warLines.length > 0) {
        const heading = hasFaction
            ? (isEn ? "**Active Wars**:" : "**进行中战争**:")
            : (isEn ? "**Active Wars (world overview)**:" : "**进行中战争（世界概览）**:");
        sections.push(heading);
        sections.push(...warLines);
    }
    // 5.7 Recent battles (last 5 chapters) commanded by or involving this character
    const battleLines = buildBattleLogLines(characterName, state.battleLog, state.chapterNumber, isEn);
    if (battleLines.length > 0) {
        sections.push(isEn ? "**Recent Battles**:" : "**近期战役**:");
        sections.push(...battleLines);
    }
    // 5.8 Territories controlled by this character's factions; observer view for factionless.
    const territoryLines = hasFaction
        ? buildTerritoryLines(characterName, state.territoryControl, state.allianceState, isEn)
        : buildIndependentTerritoryOverview(state.territoryControl, isEn);
    if (territoryLines.length > 0) {
        const heading = hasFaction
            ? (isEn ? "**Controlled Territories**:" : "**控制领土**:")
            : (isEn ? "**Notable Territories (world overview)**:" : "**重要领土（世界概览）**:");
        sections.push(heading);
        sections.push(...territoryLines);
    }
    // 5.85 Geography / terrain context for relevant locations
    const geoLines = buildGeographyContextLines(state.geography, state.territoryControl, state.allianceState, characterName, isEn);
    if (geoLines.length > 0) {
        sections.push(isEn ? "**Geography / Terrain**:" : "**地理/地形**:");
        sections.push(...geoLines);
    }
    // 5.9 Naval forces under this character's command (or observer overview)
    const navalLines = hasFaction
        ? buildNavalForceLines(characterName, state.navalForces, isEn)
        : buildIndependentNavalOverview(state.navalForces, isEn);
    if (navalLines.length > 0) {
        const heading = hasFaction
            ? (isEn ? "**Naval Forces**:" : "**麾下舰队**:")
            : (isEn ? "**Major Fleets (world overview)**:" : "**主要舰队（世界概览）**:");
        sections.push(heading);
        sections.push(...navalLines);
    }
    // 5.10 Dynasty / lineage (only shown if character has a dynasty_tree row)
    const dynastyLines = buildDynastyLines(characterName, state.dynastyTree, isEn);
    if (dynastyLines.length > 0) {
        sections.push(isEn ? "**Dynasty / Lineage**:" : "**血脉传承**:");
        sections.push(...dynastyLines);
    }
    // 5.11 Treasury (only for characters tied to a faction with treasury data)
    if (hasFaction) {
        const treasuryLines = buildTreasuryLines(characterName, state.treasuryState, state.allianceState, isEn);
        if (treasuryLines.length > 0) {
            sections.push(isEn ? "**Faction Treasury**:" : "**派系国库**:");
            sections.push(...treasuryLines);
        }
    }
    // 6. Recent membership events (last 5 chapters)
    const memLines = buildMembershipEventLines(characterName, state.allianceState, state.chapterNumber, isEn);
    if (memLines.length > 0) {
        sections.push(isEn ? "**Recent Activity**:" : "**近期动态**:");
        sections.push(...memLines);
    }
    if (sections.length === 0) {
        return "";
    }
    const title = isEn
        ? `### Character Context: ${characterName}`
        : `### 角色上下文卡：${characterName}`;
    return [title, "", ...sections, ""].join("\n");
}
/**
 * Build context cards for multiple characters at once.
 */
export function buildCharacterContextCards(characterNames, state) {
    return characterNames
        .map((name) => buildCharacterContextCard(name, state))
        .filter((card) => card.length > 0)
        .join("\n");
}
function buildFactionLines(name, allianceState, isEn) {
    if (!allianceState?.factions)
        return [];
    const lines = [];
    for (const faction of allianceState.factions) {
        if (!faction.members.includes(name))
            continue;
        const role = faction.leader === name
            ? (isEn ? " (leader)" : "（领袖）")
            : "";
        const parentInfo = faction.parentFaction
            ? (isEn ? ` [subfaction of ${faction.parentFaction}]` : `【${faction.parentFaction}的子派系】`)
            : "";
        const statusInfo = faction.status !== "active"
            ? (isEn ? ` [${faction.status}]` : `【${faction.status}】`)
            : "";
        lines.push(`- ${faction.name}${parentInfo}${role}${statusInfo} — ${faction.description || (isEn ? "no description" : "无描述")}`);
    }
    // Find diplomatic relations involving this character's factions
    const myFactionIds = allianceState.factions
        .filter((f) => f.members.includes(name))
        .map((f) => f.factionId);
    if (allianceState.relations && myFactionIds.length > 0) {
        for (const rel of allianceState.relations) {
            const involvesMe = myFactionIds.includes(rel.factionA) || myFactionIds.includes(rel.factionB);
            if (!involvesMe)
                continue;
            const otherFaction = myFactionIds.includes(rel.factionA) ? rel.factionB : rel.factionA;
            const stateLabel = isEn ? rel.state : translateDiplomaticState(rel.state, isEn);
            const nominal = rel.nominalState
                ? (isEn ? ` (nominal: ${rel.nominalState})` : `（名义：${translateDiplomaticState(rel.nominalState, isEn)}）`)
                : "";
            const trust = typeof rel.trustLevel === "number" ? ` | trust: ${rel.trustLevel}` : "";
            lines.push(`  → vs ${otherFaction}: ${stateLabel}${nominal}${trust}`);
        }
    }
    return lines;
}
function buildAssetLines(name, characterAssets, isEn, currentChapter) {
    if (!characterAssets?.assets)
        return [];
    // 过滤掉 lost/destroyed 的资产，避免污染 writer 上下文
    const myAssets = characterAssets.assets.filter(
        (a) => a.holder === name && a.status !== "lost" && a.status !== "destroyed"
    );
    if (myAssets.length === 0)
        return [];
    const statusLabels = isEn
        ? { held: "held", equipped: "equipped", stored: "stored", lent: "lent" }
        : { held: "持有", equipped: "装备", stored: "存放", lent: "借出" };
    return myAssets.map((a) => {
        const status = statusLabels[a.status] ?? a.status;
        const desc = a.description ? ` — ${a.description}` : "";
        const acq = a.acquiredChapter > 0
            ? (isEn ? ` [acq.ch.${a.acquiredChapter}]` : `【获得于ch.${a.acquiredChapter}】`)
            : "";
        // 新物品标记：最近3章内获得
        let tag = "";
        if (currentChapter && a.acquiredChapter > 0 && currentChapter - a.acquiredChapter <= 2) {
            tag = isEn ? "[NEW] " : "【新】";
        }
        return `- ${tag}${a.name}（${status}）${desc}${acq}`;
    });
}
function buildRelationshipLines(name, characterMatrix, isEn) {
    if (!characterMatrix?.relationships)
        return [];
    const myRels = characterMatrix.relationships.filter((r) => r.characterA === name || r.characterB === name);
    if (myRels.length === 0)
        return [];
    const profiles = characterMatrix.profiles ?? [];
    const lines = [];
    for (const r of myRels) {
        const other = r.characterA === name ? r.characterB : r.characterA;
        const status = r.status !== "active" ? (isEn ? ` [${r.status}]` : `【${r.status}】`) : "";
        const otherProfile = profiles.find((p) => p.characterName === other);
        const lifeTag = (otherProfile?.lifecycle && otherProfile.lifecycle !== "alive")
            ? ` †${isEn ? otherProfile.lifecycle : translateLifecycle(otherProfile.lifecycle)}`
            : "";
        const notes = r.notes ? ` — ${r.notes}` : "";
        lines.push(`- ${other}: ${r.relationshipType}${status}${lifeTag}${notes}`);
        // Render timeline events
        if (r.timeline && r.timeline.length > 0) {
            for (const t of r.timeline) {
                const impact = t.impact ? ` → ${t.impact}` : "";
                lines.push(`  - ch.${t.chapter}: ${t.event}${impact}`);
            }
        }
    }
    return lines;
}
function buildEmotionLine(name, emotionalArcs, isEn) {
    if (!emotionalArcs?.rows)
        return "";
    const myArc = emotionalArcs.rows.find((r) => r.characterName === name);
    if (!myArc)
        return "";
    const state = myArc.currentState || (isEn ? "unknown" : "未知");
    const type = myArc.arcType ? ` (${myArc.arcType})` : "";
    const peak = myArc.peakMoment ? (isEn ? ` | peak: ${myArc.peakMoment}` : ` | 高潮：${myArc.peakMoment}`) : "";
    return `- ${state}${type}${peak}`;
}
function buildHookLines(name, hooks, isEn) {
    if (!hooks?.hooks)
        return [];
    // Match hooks that mention this character in notes or expectedPayoff
    const related = hooks.hooks.filter((h) => {
        const text = `${h.notes} ${h.expectedPayoff}`.toLowerCase();
        return text.includes(name.toLowerCase());
    });
    if (related.length === 0)
        return [];
    return related.slice(0, 5).map((h) => {
        const status = isEn ? h.status : translateHookStatus(h.status, isEn);
        return `- ${h.hookId}（${status}）: ${h.notes || h.expectedPayoff || ""}`;
    });
}
function buildMembershipEventLines(name, allianceState, chapterNumber, isEn) {
    if (!allianceState?.membershipEvents)
        return [];
    const recent = allianceState.membershipEvents
        .filter((m) => m.character === name && chapterNumber - m.chapter <= 5)
        .sort((a, b) => b.chapter - a.chapter);
    if (recent.length === 0)
        return [];
    const typeLabels = isEn
        ? { join: "joined", leave: "left", betray: "betrayed", defect: "defected", expelled: "expelled", rebel: "rebelled", usurp: "usurped", purge: "purged", assassinate: "assassinated" }
        : { join: "加入", leave: "离开", betray: "背叛", defect: "叛逃", expelled: "驱逐", rebel: "造反", usurp: "篡位", purge: "清洗", assassinate: "暗杀" };
    return recent.map((m) => {
        const type = typeLabels[m.type] ?? m.type;
        const from = m.fromFaction ? (isEn ? ` from ${m.fromFaction}` : ` 从${m.fromFaction}`) : "";
        const to = m.toFaction ? (isEn ? ` to ${m.toFaction}` : ` 到${m.toFaction}`) : "";
        const desc = m.description ? ` — ${m.description}` : "";
        return `- ch.${m.chapter}: ${type}${from}${to}${desc}`;
    });
}
function translateDiplomaticState(state, isEn) {
    if (isEn)
        return state;
    const map = { allied: "同盟", neutral: "中立", tense: "紧张", hostile: "敌对", at_war: "交战", vassal: "附庸", ceasefire: "停火", rebellion: "叛乱" };
    return map[state] ?? state;
}
function translateHookStatus(status, isEn) {
    if (isEn)
        return status;
    const map = { open: "开放", planted: "埋设", pressured: "加压", progressing: "推进", near_payoff: "临近回收", deferred: "延后", resolved: "已回收" };
    return map[status] ?? status;
}
function translateLifecycle(lifecycle) {
    const map = { alive: "存活", dead: "死亡", unknown: "未知", missing: "失踪" };
    return map[lifecycle] ?? lifecycle;
}
// ── Relationship graph builders ───────────────────────────────────────
function buildRelationshipGraphLines(name, graph, isEn) {
    const rows = graph?.relationships ?? graph?.rows ?? [];
    if (rows.length === 0)
        return [];
    const myRels = rows.filter(
        (r) => r.characterA === name || r.characterB === name
    );
    if (myRels.length === 0)
        return [];
    const typeLabels = isEn
        ? { blood: "blood", marriage: "marriage", political: "political", military: "military", mentor: "mentor", romantic: "romantic", rivalry: "rivalry", vassal: "vassal", sibling: "sibling" }
        : { blood: "血缘", marriage: "婚姻", political: "政治", military: "军事", mentor: "师徒", romantic: "情爱", rivalry: "宿敌", vassal: "主从", sibling: "兄弟" };
    const statusLabels = isEn
        ? { active: "active", dissolved: "dissolved", strained: "strained", broken: "broken", restored: "restored" }
        : { active: "存续", dissolved: "解除", strained: "紧张", broken: "破裂", restored: "修复" };
    const lines = [];
    for (const r of myRels) {
        const other = r.characterA === name ? r.characterB : r.characterA;
        const rawTypes = Array.isArray(r.types) ? r.types : (typeof r.types === "string" ? r.types.split(",").map((s) => s.trim()).filter(Boolean) : []);
        const types = rawTypes.map((t) => typeLabels[t] ?? t).join("/");
        const status = statusLabels[r.status] ?? r.status;
        const trustVal = r.trustLevel ?? r.trust;
        const loyaltyVal = r.loyaltyLevel ?? r.loyalty;
        const trust = typeof trustVal === "number" ? ` | ${isEn ? "trust" : "信任"}: ${trustVal}` : "";
        const loyalty = typeof loyaltyVal === "number" ? ` | ${isEn ? "loyalty" : "忠诚"}: ${loyaltyVal}` : "";
        const notes = r.notes ? ` — ${r.notes}` : "";
        lines.push(`- ${other}: ${types}【${status}】${trust}${loyalty}${notes}`);
        if (r.timeline && r.timeline.length > 0) {
            for (const t of r.timeline) {
                const impact = t.impact ? ` → ${t.impact}` : "";
                lines.push(`  - ch.${t.chapter}: ${t.event}${impact}`);
            }
        }
    }
    return lines;
}
function buildEraMoodLine(eraMood, chapterNumber, isEn) {
    const rows = eraMood?.dimensions ?? eraMood?.rows ?? [];
    if (rows.length === 0)
        return "";
    const current = rows
        .filter((d) => d.startChapter <= chapterNumber)
        .sort((a, b) => b.startChapter - a.startChapter)[0];
    if (!current)
        return "";
    const dimLabels = isEn
        ? { prosperity: "prosperity", war: "war", stability: "stability", innovation: "innovation", decay: "decay", faith: "faith" }
        : { prosperity: "繁荣", war: "战乱", stability: "稳定", innovation: "变革", decay: "衰败", faith: "信仰" };
    const dimSource = current.dims ?? current;
    const dimKeys = ["prosperity", "war", "stability", "innovation", "decay", "faith"];
    const dims = dimKeys
        .filter((k) => typeof dimSource[k] === "number")
        .map((k) => `${dimLabels[k] ?? k}:${dimSource[k]}`)
        .join(" | ");
    const mood = current.mood ? ` — ${current.mood}` : "";
    return `- ${current.eraName}（ch.${current.startChapter}+）: ${dims}${mood}`;
}
// ── War ledger builders ──────────────────────────────────────────────
function buildMilitaryForceLines(name, mil, isEn) {
    if (!mil?.forces)
        return [];
    const myForces = mil.forces.filter((f) => f.commander === name);
    if (myForces.length === 0)
        return [];
    const statusLabels = isEn
        ? { mobilized: "mobilized", deployed: "deployed", garrison: "garrison", routed: "routed", disbanded: "disbanded" }
        : { mobilized: "动员", deployed: "出征", garrison: "驻防", routed: "溃散", disbanded: "解散" };
    return myForces.map((f) => {
        const status = statusLabels[f.status] ?? f.status;
        const morale = typeof f.morale === "number" ? ` | ${isEn ? "morale" : "士气"}:${f.morale}` : "";
        const supplies = typeof f.supplies === "number" ? ` | ${isEn ? "supplies" : "补给"}:${f.supplies}` : "";
        const loc = f.location ? ` @${f.location}` : "";
        const comp = f.unitComposition ? ` [${f.unitComposition}]` : "";
        return `- ${f.forceId}（${f.faction}）: ${f.troopCount}人${comp}${loc}【${status}】${morale}${supplies}`;
    });
}
function buildWarTheaterLines(name, war, alliance, isEn) {
    if (!war?.theaters)
        return [];
    const myFactionIds = (alliance?.factions ?? [])
        .filter((f) => f.members.includes(name))
        .flatMap((f) => [f.factionId, f.name]);
    if (myFactionIds.length === 0)
        return [];
    const myWars = war.theaters.filter((t) => {
        if (t.status === "concluded")
            return false;
        return t.belligerents.some((b) => myFactionIds.includes(b));
    });
    if (myWars.length === 0)
        return [];
    const scaleLabels = isEn
        ? { skirmish: "skirmish", campaign: "campaign", total_war: "total war" }
        : { skirmish: "冲突", campaign: "战役", total_war: "全面战争" };
    const statusLabels = isEn
        ? { active: "active", stalemate: "stalemate", ceasefire: "ceasefire", concluded: "concluded" }
        : { active: "进行", stalemate: "僵持", ceasefire: "停火", concluded: "结束" };
    return myWars.map((t) => {
        const scale = scaleLabels[t.scale] ?? t.scale;
        const status = statusLabels[t.status] ?? t.status;
        const front = t.frontLine ? ` | ${isEn ? "front" : "战线"}: ${t.frontLine}` : "";
        const obj = t.strategicObjective ? ` | ${isEn ? "objective" : "目标"}: ${t.strategicObjective}` : "";
        return `- ${t.warName}（${t.belligerents.join(" vs ")}）【${scale}/${status}】${front}${obj}`;
    });
}
function buildBattleLogLines(name, log, chapterNumber, isEn) {
    if (!log?.battles)
        return [];
    const recent = log.battles
        .filter((b) => {
            if (chapterNumber - b.chapter > 5)
                return false;
            return (b.commanders || "").includes(name) || (b.notes || "").includes(name);
        })
        .sort((a, b) => b.chapter - a.chapter);
    if (recent.length === 0)
        return [];
    const outcomeLabels = isEn
        ? { A_decisive: "A decisive", A_pyrrhic: "A pyrrhic", B_decisive: "B decisive", B_pyrrhic: "B pyrrhic", stalemate: "stalemate", A_retreat: "A retreat", B_retreat: "B retreat" }
        : { A_decisive: "A方完胜", A_pyrrhic: "A方惨胜", B_decisive: "B方完胜", B_pyrrhic: "B方惨胜", stalemate: "僵持", A_retreat: "A方撤退", B_retreat: "B方撤退" };
    return recent.map((b) => {
        const outcome = outcomeLabels[b.outcome] ?? b.outcome;
        const cas = (typeof b.casualtiesAttacker === "number" || typeof b.casualtiesDefender === "number")
            ? ` | ${isEn ? "casualties" : "伤亡"}: ${b.casualtiesAttacker ?? "?"}/${b.casualtiesDefender ?? "?"}`
            : "";
        const shift = b.strategicShift ? ` → ${b.strategicShift}` : "";
        return `- ch.${b.chapter} ${b.battleName}（${b.belligerents}）【${outcome}】${cas}${shift}`;
    });
}
function buildTerritoryLines(name, terr, alliance, isEn) {
    if (!terr?.territories)
        return [];
    const myFactionIds = (alliance?.factions ?? [])
        .filter((f) => f.members.includes(name))
        .flatMap((f) => [f.factionId, f.name]);
    if (myFactionIds.length === 0)
        return [];
    const mine = terr.territories.filter((t) => myFactionIds.includes(t.controller));
    if (mine.length === 0)
        return [];
    const typeLabels = isEn
        ? { city: "city", fort: "fort", pass: "pass", mine: "mine", port: "port", region: "region", capital: "capital" }
        : { city: "城", fort: "要塞", pass: "关", mine: "矿", port: "港", region: "区域", capital: "首都" };
    // Sort by strategic value desc, take top 8 to bound card size
    return mine
        .sort((a, b) => (b.strategicValue ?? 0) - (a.strategicValue ?? 0))
        .slice(0, 8)
        .map((t) => {
            const type = typeLabels[t.type] ?? t.type;
            const val = typeof t.strategicValue === "number" ? ` ★${t.strategicValue}` : "";
            const contested = t.contestedBy && t.contestedBy.length > 0
                ? (isEn ? ` [contested by ${t.contestedBy.join(",")}]` : `【${t.contestedBy.join(",")}争夺中】`)
                : "";
            return `- ${t.name}（${type}）${val}${contested}`;
        });
}
// ── Independent observer overviews (factionless characters) ──────────
// Bounded slices of the global ledgers so wanderers/exiles/scholars still
// see meaningful world state without being flooded with every faction's data.
function buildIndependentWarOverview(war, isEn) {
    if (!war?.theaters)
        return [];
    const scaleRank = { total_war: 3, campaign: 2, skirmish: 1 };
    const ongoing = war.theaters
        .filter((t) => t.status !== "concluded")
        .sort((a, b) => (scaleRank[b.scale] ?? 0) - (scaleRank[a.scale] ?? 0))
        .slice(0, 5);
    if (ongoing.length === 0)
        return [];
    const scaleLabels = isEn
        ? { skirmish: "skirmish", campaign: "campaign", total_war: "total war" }
        : { skirmish: "冲突", campaign: "战役", total_war: "全面战争" };
    const statusLabels = isEn
        ? { active: "active", stalemate: "stalemate", ceasefire: "ceasefire", concluded: "concluded" }
        : { active: "进行", stalemate: "僵持", ceasefire: "停火", concluded: "结束" };
    return ongoing.map((t) => {
        const scale = scaleLabels[t.scale] ?? t.scale;
        const status = statusLabels[t.status] ?? t.status;
        return `- ${t.warName}（${t.belligerents.join(" vs ")}）【${scale}/${status}】`;
    });
}
function buildIndependentTerritoryOverview(terr, isEn) {
    if (!terr?.territories)
        return [];
    const top = terr.territories
        .filter((t) => (t.strategicValue ?? 0) >= 7 || (t.contestedBy?.length ?? 0) > 0)
        .sort((a, b) => (b.strategicValue ?? 0) - (a.strategicValue ?? 0))
        .slice(0, 6);
    if (top.length === 0)
        return [];
    const typeLabels = isEn
        ? { city: "city", fort: "fort", pass: "pass", mine: "mine", port: "port", region: "region", capital: "capital" }
        : { city: "城", fort: "要塞", pass: "关", mine: "矿", port: "港", region: "区域", capital: "首都" };
    return top.map((t) => {
        const type = typeLabels[t.type] ?? t.type;
        const val = typeof t.strategicValue === "number" ? ` ★${t.strategicValue}` : "";
        const controller = t.controller ? ` ← ${t.controller}` : "";
        const contested = t.contestedBy && t.contestedBy.length > 0
            ? (isEn ? ` [contested by ${t.contestedBy.join(",")}]` : `【${t.contestedBy.join(",")}争夺中】`)
            : "";
        return `- ${t.name}（${type}）${val}${controller}${contested}`;
    });
}
function buildIndependentNavalOverview(naval, isEn) {
    if (!naval?.fleets)
        return [];
    const top = naval.fleets
        .filter((f) => f.status !== "disbanded" && f.status !== "destroyed")
        .sort((a, b) => (b.shipCount ?? 0) - (a.shipCount ?? 0))
        .slice(0, 4);
    if (top.length === 0)
        return [];
    return top.map((f) => {
        const ships = typeof f.shipCount === "number" ? `${f.shipCount}${isEn ? " ships" : "舰"}` : "?";
        const admiral = f.admiral ? ` ← ${f.admiral}` : "";
        const types = f.shipTypes ? ` [${f.shipTypes}]` : "";
        const port = f.homePort ? ` @${f.homePort}` : "";
        return `- ${f.fleetId}（${f.faction}）: ${ships}${types}${admiral}${port}`;
    });
}
// ── Epoch / Naval / Dynasty / Treasury builders ──────────────────────
function buildEpochLine(epoch, chapterNumber, isEn) {
    if (!epoch?.phases || epoch.phases.length === 0)
        return "";
    // Pick the phase whose range contains the current chapter; falls back to
    // the latest started phase if nothing matches (open-ended endChapter).
    const containing = epoch.phases.find((p) => p.startChapter <= chapterNumber
        && (!p.endChapter || p.endChapter >= chapterNumber));
    const active = containing
        ?? epoch.phases
            .filter((p) => p.startChapter <= chapterNumber)
            .sort((a, b) => b.startChapter - a.startChapter)[0];
    if (!active)
        return "";
    const range = active.endChapter
        ? `ch.${active.startChapter}–${active.endChapter}`
        : `ch.${active.startChapter}+`;
    const powers = active.dominantPowers && active.dominantPowers.length > 0
        ? (isEn ? ` | powers: ${active.dominantPowers.join(", ")}` : ` | 主导: ${active.dominantPowers.join("、")}`)
        : "";
    const key = active.keyEvent ? ` — ${active.keyEvent}` : "";
    return `- ${active.phaseName}（${range}）${powers}${key}`;
}
function buildNavalForceLines(name, naval, isEn) {
    if (!naval?.fleets)
        return [];
    const mine = naval.fleets.filter((f) => f.admiral === name);
    if (mine.length === 0)
        return [];
    const statusLabels = isEn
        ? { docked: "docked", patrolling: "patrolling", besieging: "besieging", engaged: "engaged", scattered: "scattered", destroyed: "destroyed", disbanded: "disbanded" }
        : { docked: "停泊", patrolling: "巡弋", besieging: "围港", engaged: "交战", scattered: "溃散", destroyed: "覆灭", disbanded: "解散" };
    return mine.map((f) => {
        const status = statusLabels[f.status] ?? f.status;
        const supremacy = typeof f.navalSupremacy === "number" ? ` | ${isEn ? "supremacy" : "制海"}:${f.navalSupremacy}` : "";
        const morale = typeof f.morale === "number" ? ` | ${isEn ? "morale" : "士气"}:${f.morale}` : "";
        const port = f.homePort ? ` @${f.homePort}` : "";
        const types = f.shipTypes ? ` [${f.shipTypes}]` : "";
        return `- ${f.fleetId}（${f.faction}）: ${f.shipCount}舰${types}${port}【${status}】${supremacy}${morale}`;
    });
}
function buildDynastyLines(name, dynasty, isEn) {
    if (!dynasty?.members)
        return [];
    const me = dynasty.members.find((m) => m.personId === name || m.displayName === name);
    if (!me)
        return [];
    const lines = [];
    const gen = typeof me.generation === "number" ? (isEn ? `gen ${me.generation}` : `第${me.generation}代`) : "";
    const title = me.title ? ` ${me.title}` : "";
    const lifespan = me.lifespanChapters ? ` (${me.lifespanChapters})` : "";
    lines.push(`- ${gen}${title}${lifespan}`.trim().replace(/^-\s+-/, "-"));
    if (me.parents) {
        lines.push(isEn ? `  parents: ${me.parents}` : `  父母：${me.parents}`);
    }
    if (me.spouse) {
        lines.push(isEn ? `  spouse: ${me.spouse}` : `  配偶：${me.spouse}`);
    }
    if (me.inheritedFrom) {
        lines.push(isEn ? `  inherited from: ${me.inheritedFrom}` : `  继承自：${me.inheritedFrom}`);
    }
    if (typeof me.inheritanceOrder === "number") {
        lines.push(isEn ? `  inheritance order: ${me.inheritanceOrder}` : `  继承顺位：${me.inheritanceOrder}`);
    }
    if (me.regencyFor) {
        lines.push(isEn ? `  regent for: ${me.regencyFor}` : `  摄政对象：${me.regencyFor}`);
    }
    if (me.successor) {
        lines.push(isEn ? `  successor: ${me.successor}` : `  继任者：${me.successor}`);
    }
    return lines;
}
function buildTreasuryLines(name, treasury, alliance, isEn) {
    if (!treasury?.rows)
        return [];
    const myFactionIds = (alliance?.factions ?? [])
        .filter((f) => f.members.includes(name))
        .flatMap((f) => [f.factionId, f.name]);
    if (myFactionIds.length === 0)
        return [];
    const mine = treasury.rows.filter((r) => myFactionIds.includes(r.faction));
    if (mine.length === 0)
        return [];
    return mine.map((r) => {
        const gold = typeof r.gold === "number" ? `${isEn ? "gold" : "金"}:${r.gold}` : "";
        const grain = typeof r.grain === "number" ? ` | ${isEn ? "grain" : "粮"}:${r.grain}` : "";
        const merc = typeof r.mercenaryBudget === "number" ? ` | ${isEn ? "merc budget" : "雇兵预算"}:${r.mercenaryBudget}` : "";
        const income = typeof r.incomePerChapter === "number" ? ` | ${isEn ? "income/ch" : "章收"}:${r.incomePerChapter}` : "";
        return `- ${r.faction}: ${gold}${grain}${merc}${income}`;
    });
}
// ── Markdown parsers ──────────────────────────────────────────────────
// These parse the raw markdown truth files into structured objects.
// They're intentionally lenient — if parsing fails, return empty defaults.
function parseCharacterMatrixMarkdown(md) {
    if (!md || md === "(文件尚未创建)")
        return { profiles: [], relationships: [] };
    const profiles = [];
    const relationships = [];
    const lines = md.split("\n");
    let inProfile = false;
    let inRel = false;
    for (const line of lines) {
        if (/^## 角色档案|^## Character Profiles/i.test(line.trim())) {
            inProfile = true; inRel = false; continue;
        }
        if (/^## 关系网络|^## Relationships/i.test(line.trim())) {
            inProfile = false; inRel = true; continue;
        }
        if (/^##/.test(line.trim())) {
            inProfile = false; inRel = false; continue;
        }
        const cells = parseTableRow(line);
        if (!cells || cells.length < 2)
            continue;
        if (inProfile && cells.length >= 3) {
            profiles.push({
                characterName: cells[0],
                role: cells[1],
                traits: (cells[2] || "").split(",").map((s) => s.trim()).filter(Boolean),
                lifecycle: cells[3] || "alive",
                firstAppearance: Number(cells[4]) || 0,
                notes: cells[5] || "",
            });
        }
        if (inRel && cells.length >= 3) {
            const rawNotes = cells[5] || "";
            const { cleanNotes, timeline } = parseTimelineFromNotes(rawNotes);
            relationships.push({
                characterA: cells[0],
                characterB: cells[1],
                relationshipType: cells[2],
                status: cells[3] || "active",
                lastUpdatedChapter: 0,
                notes: cleanNotes,
                timeline,
            });
        }
    }
    return { profiles, relationships };
}
function parseCharacterAssetsMarkdown(md) {
    if (!md || md === "(文件尚未创建)")
        return { assets: [], relationships: [] };
    const assets = [];
    const lines = md.split("\n");
    let inAssets = false;
    for (const line of lines) {
        if (/^## 资产清单|^## Asset Inventory/i.test(line.trim())) {
            inAssets = true; continue;
        }
        if (/^##/.test(line.trim())) {
            inAssets = false; continue;
        }
        const cells = parseTableRow(line);
        if (!cells || cells.length < 4 || !inAssets)
            continue;
        assets.push({
            assetId: cells[0],
            holder: cells[1],
            name: cells[2],
            description: cells[3] || "",
            status: cells[4] || "held",
            acquiredChapter: cells[5] ? Number(cells[5]) : 0,
            lastUpdatedChapter: cells[6] ? Number(cells[6]) : 0,
            notes: cells[7] || "",
        });
    }
    return { assets, relationships: [] };
}
function parseAllianceStateMarkdown(md) {
    if (!md || md === "(文件尚未创建)")
        return { factions: [], relations: [], events: [], membershipEvents: [] };
    const factions = [];
    const relations = [];
    const events = [];
    const membershipEvents = [];
    const lines = md.split("\n");
    let section = "";
    for (const line of lines) {
        if (/^## 势力阵营|^## Factions/i.test(line.trim())) {
            section = "factions"; continue;
        }
        if (/^## 外交关系|^## Diplomatic/i.test(line.trim())) {
            section = "relations"; continue;
        }
        if (/^## 关系事件|^## Relationship Events/i.test(line.trim())) {
            section = "events"; continue;
        }
        if (/^## 人员流动|^## Membership/i.test(line.trim())) {
            section = "membership"; continue;
        }
        if (/^##/.test(line.trim())) {
            section = ""; continue;
        }
        const cells = parseTableRow(line);
        if (!cells || cells.length < 3)
            continue;
        if (section === "factions") {
            factions.push({
                factionId: cells[0],
                name: cells[1],
                factionType: cells[2] || "nation",
                parentFaction: cells[3] || "",
                members: (cells[4] || "").split(",").map((s) => s.trim()).filter(Boolean),
                leader: cells[5] || "",
                description: "",
                status: cells[6] || "active",
                formedChapter: 0,
                lastUpdatedChapter: 0,
                notes: cells[8] || "",
            });
        }
        if (section === "relations" && cells.length >= 4) {
            relations.push({
                relationId: `${cells[0]}::${cells[1]}`,
                factionA: cells[0],
                factionB: cells[1],
                state: cells[2] || "neutral",
                nominalState: cells[3] || undefined,
                trustLevel: cells[4] ? Number(cells[4]) : undefined,
                sinceChapter: 0,
                lastUpdatedChapter: 0,
                notes: cells[7] || "",
            });
        }
        if (section === "events" && cells.length >= 4) {
            events.push({
                eventId: cells[0],
                chapter: Number(cells[1]) || 0,
                type: cells[2] || "custom",
                factions: (cells[3] || "").split(",").map((s) => s.trim()).filter(Boolean),
                description: cells[4] || "",
                impact: cells[5] || "",
                notes: "",
            });
        }
        if (section === "membership" && cells.length >= 4) {
            membershipEvents.push({
                eventId: cells[0],
                chapter: Number(cells[1]) || 0,
                character: cells[2],
                fromFaction: cells[4] || "",
                toFaction: cells[5] || "",
                type: cells[3] || "join",
                description: cells[6] || "",
                notes: "",
            });
        }
    }
    return { factions, relations, events, membershipEvents };
}
function parseEmotionalArcsMarkdown(md) {
    if (!md || md === "(文件尚未创建)")
        return { rows: [] };
    const rows = [];
    const lines = md.split("\n");
    let inTable = false;
    for (const line of lines) {
        if (/^## 情感弧线|^## Emotional Arcs/i.test(line.trim())) {
            inTable = true; continue;
        }
        if (/^##/.test(line.trim())) {
            inTable = false; continue;
        }
        const cells = parseTableRow(line);
        if (!cells || cells.length < 5 || !inTable)
            continue;
        if (cells[0] === "arc_id" || cells[0] === "---")
            continue;
        rows.push({
            arcId: cells[0],
            characterName: cells[1],
            startChapter: 0,
            lastAdvancedChapter: 0,
            arcType: cells[3] || "",
            currentState: cells[4] || "",
            peakMoment: cells[5] || "",
            resolution: cells[6] || "",
            notes: cells[7] || "",
        });
    }
    return { rows };
}
function parseHooksMarkdown(md) {
    if (!md || md === "(文件尚未创建)")
        return { hooks: [] };
    const hooks = [];
    const lines = md.split("\n");
    let inTable = false;
    for (const line of lines) {
        if (/^## 伏笔池|^## Pending Hooks/i.test(line.trim())) {
            inTable = true; continue;
        }
        if (/^##/.test(line.trim())) {
            inTable = false; continue;
        }
        const cells = parseTableRow(line);
        if (!cells || cells.length < 4 || !inTable)
            continue;
        if (cells[0] === "hook_id" || cells[0] === "---")
            continue;
        hooks.push({
            hookId: cells[0],
            startChapter: Number(cells[1]) || 0,
            type: cells[2] || "",
            status: cells[3] || "open",
            lastAdvancedChapter: Number(cells[4]) || 0,
            expectedPayoff: cells[5] || "",
            payoffTiming: cells[6] || undefined,
            notes: cells[12] || "",
        });
    }
    return { hooks };
}
function parseRelationshipGraphMarkdown(md) {
    if (!md || md === "(文件尚未创建)")
        return { relationships: [] };
    const relationships = [];
    const lines = md.split("\n");
    let inTable = false;
    for (const line of lines) {
        if (/^## 关系档案|^## Relationship Graph/i.test(line.trim())) {
            inTable = true; continue;
        }
        if (/^##/.test(line.trim())) {
            inTable = false; continue;
        }
        const cells = parseTableRow(line);
        if (!cells || cells.length < 4 || !inTable)
            continue;
        if (cells[0] === "character_a" || cells[0] === "---")
            continue;
        const types = (cells[2] || "").split(",").map((s) => s.trim()).filter(Boolean);
        const { cleanNotes, timeline } = parseTimelineFromNotes(cells[7] || "");
        relationships.push({
            characterA: cells[0],
            characterB: cells[1],
            types,
            status: cells[3] || "active",
            trustLevel: cells[4] ? Number(cells[4]) : undefined,
            loyaltyLevel: cells[5] ? Number(cells[5]) : undefined,
            notes: cleanNotes,
            timeline,
        });
    }
    return { relationships };
}
function parseEraMoodMarkdown(md) {
    if (!md || md === "(文件尚未创建)")
        return { dimensions: [] };
    const dimensions = [];
    const lines = md.split("\n");
    let inTable = false;
    for (const line of lines) {
        if (/^## 时代切面|^## Era Dimensions/i.test(line.trim())) {
            inTable = true; continue;
        }
        if (/^##/.test(line.trim())) {
            inTable = false; continue;
        }
        const cells = parseTableRow(line);
        if (!cells || cells.length < 8 || !inTable)
            continue;
        if (cells[0] === "era_id" || cells[0] === "---")
            continue;
        dimensions.push({
            eraId: cells[0],
            eraName: cells[1],
            startChapter: Number(cells[2]) || 0,
            dims: {
                prosperity: Number(cells[3]) || 0,
                war: Number(cells[4]) || 0,
                stability: Number(cells[5]) || 0,
                innovation: Number(cells[6]) || 0,
                decay: Number(cells[7]) || 0,
                faith: cells[8] ? Number(cells[8]) : undefined,
            },
            mood: cells[9] || "",
            notes: cells[10] || "",
        });
    }
    return { dimensions };
}
function parseMilitaryForcesMarkdown(md) {
    if (!md || md === "(文件尚未创建)")
        return { forces: [] };
    const forces = [];
    const lines = md.split("\n");
    let inTable = false;
    for (const line of lines) {
        if (/^## 部队清单|^## Military Forces/i.test(line.trim())) {
            inTable = true; continue;
        }
        if (/^##/.test(line.trim())) {
            inTable = false; continue;
        }
        const cells = parseTableRow(line);
        if (!cells || cells.length < 9 || !inTable)
            continue;
        if (cells[0] === "force_id" || cells[0] === "---")
            continue;
        forces.push({
            forceId: cells[0],
            faction: cells[1],
            commander: cells[2],
            troopCount: Number(cells[3]) || 0,
            unitComposition: cells[4] || "",
            morale: cells[5] ? Number(cells[5]) : undefined,
            supplies: cells[6] ? Number(cells[6]) : undefined,
            location: cells[7] || "",
            status: cells[8] || "garrison",
            lastUpdatedChapter: cells[9] ? Number(cells[9]) : 0,
            notes: cells[10] || "",
        });
    }
    return { forces };
}
function parseWarTheaterMarkdown(md) {
    if (!md || md === "(文件尚未创建)")
        return { theaters: [] };
    const theaters = [];
    const lines = md.split("\n");
    let inTable = false;
    for (const line of lines) {
        if (/^## 战场清单|^## War Theaters/i.test(line.trim())) {
            inTable = true; continue;
        }
        if (/^##/.test(line.trim())) {
            inTable = false; continue;
        }
        const cells = parseTableRow(line);
        if (!cells || cells.length < 8 || !inTable)
            continue;
        if (cells[0] === "theater_id" || cells[0] === "---")
            continue;
        theaters.push({
            theaterId: cells[0],
            warName: cells[1],
            belligerents: (cells[2] || "").split(",").map((s) => s.trim()).filter(Boolean),
            startChapter: Number(cells[3]) || 0,
            frontLine: cells[4] || "",
            strategicObjective: cells[5] || "",
            scale: cells[6] || "campaign",
            status: cells[7] || "active",
            outcome: cells[8] || "",
            lastUpdatedChapter: cells[9] ? Number(cells[9]) : 0,
            notes: cells[10] || "",
        });
    }
    return { theaters };
}
function parseBattleLogMarkdown(md) {
    if (!md || md === "(文件尚未创建)")
        return { battles: [] };
    const battles = [];
    const lines = md.split("\n");
    let inTable = false;
    for (const line of lines) {
        if (/^## 战役清单|^## Battle Log/i.test(line.trim())) {
            inTable = true; continue;
        }
        if (/^##/.test(line.trim())) {
            inTable = false; continue;
        }
        const cells = parseTableRow(line);
        if (!cells || cells.length < 9 || !inTable)
            continue;
        if (cells[0] === "battle_id" || cells[0] === "---")
            continue;
        battles.push({
            battleId: cells[0],
            chapter: Number(cells[1]) || 0,
            theaterId: cells[2] || "",
            battleName: cells[3] || "",
            belligerents: cells[4] || "",
            commanders: cells[5] || "",
            forcesEngaged: cells[6] || "",
            terrain: cells[7] || "",
            outcome: cells[8] || "stalemate",
            casualtiesAttacker: cells[9] ? Number(cells[9]) : undefined,
            casualtiesDefender: cells[10] ? Number(cells[10]) : undefined,
            strategicShift: cells[11] || "",
            notes: cells[12] || "",
        });
    }
    return { battles };
}
function parseTerritoryControlMarkdown(md) {
    if (!md || md === "(文件尚未创建)")
        return { territories: [] };
    const territories = [];
    const lines = md.split("\n");
    let inTable = false;
    for (const line of lines) {
        if (/^## 领土清单|^## Territory Control/i.test(line.trim())) {
            inTable = true; continue;
        }
        if (/^##/.test(line.trim())) {
            inTable = false; continue;
        }
        const cells = parseTableRow(line);
        if (!cells || cells.length < 6 || !inTable)
            continue;
        if (cells[0] === "territory_id" || cells[0] === "---")
            continue;
        const { cleanNotes, timeline } = parseTimelineFromNotes(cells[8] || "");
        territories.push({
            territoryId: cells[0],
            name: cells[1],
            type: cells[2] || "region",
            controller: cells[3] || "",
            contestedBy: (cells[4] || "").split(",").map((s) => s.trim()).filter(Boolean),
            strategicValue: cells[5] ? Number(cells[5]) : 0,
            controlSinceChapter: cells[6] ? Number(cells[6]) : 0,
            garrisonForce: cells[7] || "",
            notes: cleanNotes,
            timeline,
        });
    }
    return { territories };
}
function parseTimelineFromNotes(rawNotes) {
    const timelineMatch = rawNotes.match(/\|\s*timeline:\s*(.+)$/i);
    if (!timelineMatch) {
        return { cleanNotes: rawNotes, timeline: [] };
    }
    const cleanNotes = rawNotes.replace(/\|\s*timeline:\s*.+$/i, "").trim();
    const timeline = timelineMatch[1].split(";").map((entry) => {
        const match = entry.trim().match(/ch\.(\d+):\s*(.+)/i);
        if (!match)
            return null;
        const parts = match[2].split("→").map((s) => s.trim());
        return {
            chapter: Number(match[1]) || 0,
            event: parts[0] || "",
            impact: parts[1] || "",
        };
    }).filter(Boolean);
    return { cleanNotes, timeline };
}
// ── War ledgers v2 parsers (epoch / naval / dynasty / treasury) ──────
function parseEpochTimelineMarkdown(md) {
    if (!md || md === "(文件尚未创建)")
        return { phases: [] };
    const phases = [];
    const lines = md.split("\n");
    let inTable = false;
    for (const line of lines) {
        if (/^## 纪元时间线|^## Epoch Timeline/i.test(line.trim())) {
            inTable = true; continue;
        }
        if (/^##/.test(line.trim())) {
            inTable = false; continue;
        }
        const cells = parseTableRow(line);
        if (!cells || cells.length < 4 || !inTable)
            continue;
        if (cells[0] === "epoch_id" || cells[0] === "---")
            continue;
        phases.push({
            epochId: cells[0],
            phaseName: cells[1],
            startChapter: Number(cells[2]) || 0,
            endChapter: cells[3] ? Number(cells[3]) : undefined,
            dominantPowers: (cells[4] || "").split(",").map((s) => s.trim()).filter(Boolean),
            keyEvent: cells[5] || "",
            eraMoodSnapshot: cells[6] || "",
            notes: cells[7] || "",
        });
    }
    return { phases };
}
function parseNavalForcesMarkdown(md) {
    if (!md || md === "(文件尚未创建)")
        return { fleets: [] };
    const fleets = [];
    const lines = md.split("\n");
    let inTable = false;
    for (const line of lines) {
        if (/^## 舰队清单|^## Naval Forces/i.test(line.trim())) {
            inTable = true; continue;
        }
        if (/^##/.test(line.trim())) {
            inTable = false; continue;
        }
        const cells = parseTableRow(line);
        if (!cells || cells.length < 7 || !inTable)
            continue;
        if (cells[0] === "fleet_id" || cells[0] === "---")
            continue;
        fleets.push({
            fleetId: cells[0],
            faction: cells[1],
            admiral: cells[2],
            shipCount: Number(cells[3]) || 0,
            shipTypes: cells[4] || "",
            navalSupremacy: cells[5] ? Number(cells[5]) : undefined,
            morale: cells[6] ? Number(cells[6]) : undefined,
            homePort: cells[7] || "",
            status: cells[8] || "docked",
            lastUpdatedChapter: cells[9] ? Number(cells[9]) : 0,
            notes: cells[10] || "",
        });
    }
    return { fleets };
}
function parseDynastyTreeMarkdown(md) {
    if (!md || md === "(文件尚未创建)")
        return { members: [] };
    const members = [];
    const lines = md.split("\n");
    let inTable = false;
    for (const line of lines) {
        if (/^## 王朝谱系|^## Dynasty Tree/i.test(line.trim())) {
            inTable = true; continue;
        }
        if (/^##/.test(line.trim())) {
            inTable = false; continue;
        }
        const cells = parseTableRow(line);
        if (!cells || cells.length < 3 || !inTable)
            continue;
        if (cells[0] === "person_id" || cells[0] === "---")
            continue;
        members.push({
            personId: cells[0],
            displayName: cells[1] || cells[0],
            generation: cells[2] ? Number(cells[2]) : undefined,
            parents: cells[3] || "",
            spouse: cells[4] || "",
            inheritedFrom: cells[5] || "",
            inheritanceOrder: cells[6] ? Number(cells[6]) : undefined,
            regencyFor: cells[7] || "",
            successor: cells[8] || "",
            title: cells[9] || "",
            lifespanChapters: cells[10] || "",
            notes: cells[11] || "",
        });
    }
    return { members };
}
function parseTreasuryStateMarkdown(md) {
    if (!md || md === "(文件尚未创建)")
        return { rows: [] };
    const rows = [];
    const lines = md.split("\n");
    let inTable = false;
    for (const line of lines) {
        if (/^## 财政状态|^## Treasury State/i.test(line.trim())) {
            inTable = true; continue;
        }
        if (/^##/.test(line.trim())) {
            inTable = false; continue;
        }
        const cells = parseTableRow(line);
        if (!cells || cells.length < 2 || !inTable)
            continue;
        if (cells[0] === "faction" || cells[0] === "---")
            continue;
        rows.push({
            faction: cells[0],
            gold: cells[1] ? Number(cells[1]) : undefined,
            grain: cells[2] ? Number(cells[2]) : undefined,
            mercenaryBudget: cells[3] ? Number(cells[3]) : undefined,
            incomePerChapter: cells[4] ? Number(cells[4]) : undefined,
            lastUpdatedChapter: cells[5] ? Number(cells[5]) : 0,
            notes: cells[6] || "",
        });
    }
    return { rows };
}
function parseGeographyMarkdown(md) {
    if (!md || md === "(文件尚未创建)")
        return { entries: [] };
    const entries = [];
    const lines = md.split("\n");
    let inTable = false;
    for (const line of lines) {
        if (/^## Geography|^## 地理/i.test(line.trim())) {
            inTable = true; continue;
        }
        if (/^##/.test(line.trim())) {
            inTable = false; continue;
        }
        const cells = parseTableRow(line);
        if (!cells || cells.length < 2 || !inTable)
            continue;
        if (cells[0] === "geo_id" || cells[0] === "---")
            continue;
        entries.push({
            geoId: cells[0],
            name: cells[1] || "",
            terrainType: cells[2] || "",
            climate: cells[3] || "",
            strategicFeatures: cells[4] || "",
            adjacentRegions: cells[5] || "",
            travelDifficulty: cells[6] || "",
            notes: cells[7] || "",
        });
    }
    return { entries };
}
function buildGeographyContextLines(geography, territoryControl, allianceState, characterName, isEn) {
    if (!geography?.entries?.length)
        return [];
    // Find territories controlled by this character's factions
    const charFactions = (allianceState?.factions ?? [])
        .filter((f) => f.members.includes(characterName))
        .map((f) => f.factionId);
    const controlledTerrNames = (territoryControl?.territories ?? [])
        .filter((t) => charFactions.includes(t.controller))
        .map((t) => t.name?.toLowerCase())
        .filter(Boolean);
    // Show geography entries that match controlled territories or are globally relevant
    const relevant = geography.entries.filter((g) => {
        const name = g.name?.toLowerCase() ?? "";
        return controlledTerrNames.some((t) => name.includes(t) || t.includes(name));
    });
    const entries = relevant.length > 0 ? relevant : geography.entries.slice(0, 5);
    const lines = [];
    for (const g of entries) {
        if (isEn) {
            lines.push(`- ${g.name}: terrain=${g.terrainType}, climate=${g.climate}${g.strategicFeatures ? `, features=${g.strategicFeatures}` : ""}${g.travelDifficulty ? `, travel=${g.travelDifficulty}` : ""}`);
        } else {
            lines.push(`- ${g.name}: 地形=${g.terrainType}，气候=${g.climate}${g.strategicFeatures ? `，特征=${g.strategicFeatures}` : ""}${g.travelDifficulty ? `，通行=${g.travelDifficulty}` : ""}`);
        }
    }
    return lines;
}
function parseTableRow(line) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|") || /^\|[\s:|-]+\|$/.test(trimmed))
        return null;
    return trimmed
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.trim().replace(/\\|/g, "|"));
}
