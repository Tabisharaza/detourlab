import type { Closure, Scenario, SimulationResult } from './engine.js';

export interface ExperimentVariant { id: string; name: string; closures: Closure[] }
export interface Experiment {
  format: 'detourlab-experiment';
  version: 1;
  id: string;
  name: string;
  /** Shared network and demand; closures must be empty. */
  baseScenario: Scenario;
  variants: ExperimentVariant[];
}
export interface ExperimentDelta {
  /** Signed traveled-distance difference; skipped jobs may make this negative. */
  distanceM: number;
  extraDistancePct: number;
  extraLateJobs: number;
  /** Absolute unreachable-job count in this variant, not its baseline difference. */
  unreachableJobs: number;
}
export interface ExperimentVariantResult {
  id: string;
  name: string;
  result: SimulationResult;
  delta: ExperimentDelta;
}
export interface ExperimentResult { baseline: SimulationResult; variants: ExperimentVariantResult[] }
export const EXPERIMENT_LIMITS: Readonly<{
  maxBytes: number;
  minVariants: number;
  maxVariants: number;
  nameLength: number;
  idLength: number;
  totalClosures: number;
  totalClosureReferences: number;
  /** Maximum returned route segments, including baseline and control copies. */
  totalResultSegments: number;
}>;
export function validateExperiment(input: unknown): Experiment;
/** Also accepts a version-1 scenario and upgrades it with experimentFromScenario. */
export function parseExperiment(text: string): Experiment;
export function experimentFromScenario(scenario: unknown): Experiment;
export function scenarioForVariant(experiment: unknown, variantId: string): Scenario;
export function simulateExperiment(experiment: unknown): ExperimentResult;
export function exportExperiment(experiment: unknown): string;
/** Canonical JSON for a caller's fingerprint/hash; this does not authenticate input. */
export function canonicalExperiment(experiment: unknown): string;
