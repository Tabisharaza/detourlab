export interface ScenarioNode { id: string; x: number; y: number }
export interface ScenarioEdge { id: string; from: string; to: string; distanceM: number; travelTimeS: number; roadName: string }
export interface Vehicle { id: string; startNode: string; startTimeS: number }
export interface Job { id: string; nodeId: string; vehicleId: string; dueTimeS: number; serviceTimeS: number }
export interface Closure { id: string; edgeIds: string[]; atS: number }
export interface Scenario { version: 1; id: string; name: string; seed: number; description: string; nodes: ScenarioNode[]; edges: ScenarioEdge[]; vehicles: Vehicle[]; jobs: Job[]; closures: Closure[]; durationS: number }
export interface PathResult { nodeIds: string[]; edgeIds: string[]; distanceM: number; travelTimeS: number }
export interface RouteSegment { edgeId: string; from: string; to: string; startS: number; endS: number; distanceM: number }
export interface JobResult { id: string; nodeId: string; dueTimeS: number; arrivalS: number | null; completedS: number | null; status: 'on-time' | 'late' | 'unreachable' }
export interface RerouteEvent { atS: number; nodeId: string; jobId: string; closedEdgeIds: string[]; reason: 'closure-blocked-route' | 'no-route' }
export interface VehicleResult { id: string; segments: RouteSegment[]; jobs: JobResult[]; distanceM: number; finishS: number; reroutes: RerouteEvent[] }
export interface Metrics { distanceM: number; lateJobs: number; unreachableJobs: number; completedJobs: number; totalJobs: number; totalDelayS: number; onTimeJobs: number; reroutes: number; affectedVehicles: number; totalTravelTimeS: number }
export interface SimulationResult { vehicles: VehicleResult[]; metrics: Metrics; durationS: number }
export const ENGINE_LIMITS: Readonly<{ routingEdgeVisits: number; pathEdgeVisits: number; segments: number }>;
/** Minimum travel time, then distance, then stable ID ordering; null if unreachable. */
export function shortestPath(scenario: Scenario, from: string, to: string, closedEdgeIds?: Iterable<string>): PathResult | null;
/** Fixed job sequence; deadlines apply to arrival. Closures activate at edge entry. */
export function simulate(scenario: Scenario, options?: { closures?: Closure[] }): SimulationResult;
