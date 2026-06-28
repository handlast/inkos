import { BaseAgent } from "./base.js";
import type { BookConfig } from "../models/book.js";

export interface AnalyzeWarChapterInput {
    readonly book: BookConfig;
    readonly bookDir: string;
    readonly chapterNumber: number;
    readonly chapterContent: string;
    readonly chapterTitle?: string;
}

export interface WarAnalyzerOutput {
    updatedMilitaryForces?: string;
    updatedWarTheater?: string;
    updatedBattleLog?: string;
    updatedTerritoryControl?: string;
    updatedEpochTimeline?: string;
    updatedNavalForces?: string;
    updatedDynastyTree?: string;
    updatedTreasuryState?: string;
}

export declare class WarAnalyzerAgent extends BaseAgent {
    get name(): string;
    analyzeWarChapter(input: AnalyzeWarChapterInput): Promise<WarAnalyzerOutput>;
}
