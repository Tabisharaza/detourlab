// This is an internal Worker-result boundary, not an importer for arbitrary
// simulation files. Copy only report data, before any asynchronous hashing.
// Identity checks catch stale/mismatched runs; they do not authenticate results
// or prove that a ledger was produced by the engine.
const METRICS = ['distanceM', 'lateJobs', 'unreachableJobs', 'completedJobs', 'totalJobs', 'totalDelayS', 'onTimeJobs', 'reroutes', 'affectedVehicles', 'totalTravelTimeS'];
const COUNTS = new Set(['lateJobs', 'unreachableJobs', 'completedJobs', 'totalJobs', 'onTimeJobs', 'reroutes', 'affectedVehicles']);
const DELTAS = ['distanceM', 'extraDistancePct', 'extraLateJobs', 'unreachableJobs'];

function record(value, keys, required = keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error('Completed results must contain plain data records.');
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !keys.includes(key) || !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value')) throw new Error('Completed results contain unsupported properties or accessors.');
  }
  if (required.some(key => !Object.hasOwn(value, key))) throw new Error('Completed results are missing required data.');
  return value;
}

function array(value, length) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length !== length) throw new Error('Completed results require matching vehicle, variant and job identities.');
  for (const key of Reflect.ownKeys(value)) {
    if (key === 'length') continue;
    if (typeof key !== 'string' || !/^(0|[1-9][0-9]*)$/u.test(key) || Number(key) >= length || !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value')) throw new Error('Completed results require plain arrays without accessors.');
  }
  for (let index = 0; index < length; index += 1) if (!Object.hasOwn(value, index)) throw new Error('Completed results cannot contain missing array entries.');
  return value;
}

function finite(value, label, nonnegative = true) {
  if (typeof value !== 'number' || !Number.isFinite(value) || nonnegative && value < 0) throw new Error(`Completed results require finite ${nonnegative ? 'nonnegative ' : ''}${label}.`);
  return value;
}

function copyResult(experiment, input) {
  record(input, ['vehicles', 'metrics', 'durationS']);
  finite(input.durationS, 'duration');
  const expectedVehicles = new Set(experiment.baseScenario.vehicles.map(vehicle => vehicle.id));
  const expectedJobs = new Map(experiment.baseScenario.jobs.map(job => [job.id, job]));
  const jobsPerVehicle = new Map([...expectedVehicles].map(id => [id, 0]));
  for (const job of expectedJobs.values()) jobsPerVehicle.set(job.vehicleId, jobsPerVehicle.get(job.vehicleId) + 1);
  const seenVehicles = new Set(), seenJobs = new Set();
  const counts = { 'on-time': 0, late: 0, unreachable: 0 };
  const vehicles = array(input.vehicles, expectedVehicles.size).map(vehicle => {
    record(vehicle, ['id', 'segments', 'jobs', 'distanceM', 'finishS', 'reroutes']);
    if (!expectedVehicles.has(vehicle.id) || seenVehicles.has(vehicle.id)) throw new Error('Completed results require matching unique vehicle identities.');
    seenVehicles.add(vehicle.id);
    finite(vehicle.distanceM, 'vehicle distance');
    finite(vehicle.finishS, 'vehicle finish time');
    const jobs = array(vehicle.jobs, jobsPerVehicle.get(vehicle.id)).map(job => {
      record(job, ['id', 'nodeId', 'dueTimeS', 'arrivalS', 'completedS', 'status']);
      const expected = expectedJobs.get(job.id);
      if (!expected || seenJobs.has(job.id) || expected.vehicleId !== vehicle.id || expected.nodeId !== job.nodeId || expected.dueTimeS !== job.dueTimeS) throw new Error('Completed results require matching unique job identities, assignments, destinations and deadlines.');
      seenJobs.add(job.id);
      if (typeof job.status !== 'string' || !Object.hasOwn(counts, job.status)) throw new Error('Completed results require engine job statuses.');
      if (job.status === 'unreachable') {
        if (job.arrivalS !== null || job.completedS !== null) throw new Error('Completed results require null unreachable timings.');
      } else {
        finite(job.arrivalS, 'arrival time');
        finite(job.completedS, 'completion time');
        if (job.completedS !== job.arrivalS + expected.serviceTimeS) throw new Error('Completed results require completion timing consistent with supplied service time.');
        // Preserve engine deadline tolerance; do not reclassify on-time jobs.
        if (job.status === 'late' && job.arrivalS <= job.dueTimeS) throw new Error('Completed results require late arrivals after their deadlines.');
      }
      counts[job.status] += 1;
      return { id: job.id, nodeId: job.nodeId, dueTimeS: job.dueTimeS, arrivalS: job.arrivalS, completedS: job.completedS, status: job.status };
    });
    return { id: vehicle.id, jobs };
  });
  record(input.metrics, METRICS);
  const metrics = Object.fromEntries(METRICS.map(key => {
    const value = finite(input.metrics[key], 'metrics');
    if (COUNTS.has(key) && !Number.isSafeInteger(value)) throw new Error('Completed results require integer count metrics.');
    return [key, value];
  }));
  if (metrics.totalJobs !== expectedJobs.size || metrics.onTimeJobs !== counts['on-time'] || metrics.lateJobs !== counts.late || metrics.unreachableJobs !== counts.unreachable || metrics.completedJobs !== counts['on-time'] + counts.late || metrics.affectedVehicles > expectedVehicles.size) throw new Error('Completed results metrics do not match the job ledger.');
  return { vehicles, metrics };
}

/** Snapshot all variants. A mismatch rejects the whole packet, never a subset. */
export function copyCompletedResults(experiment, input) {
  record(input, ['id', 'baseline', 'variants'], ['baseline', 'variants']);
  const baseline = copyResult(experiment, input.baseline);
  const variants = array(input.variants, experiment.variants.length).map((selected, index) => {
    record(selected, ['id', 'name', 'result', 'delta']);
    const expected = experiment.variants[index];
    if (selected.id !== expected.id || selected.name !== expected.name) throw new Error('Completed results require matching variant identities, names and order.');
    const result = copyResult(experiment, selected.result);
    record(selected.delta, DELTAS);
    const delta = Object.fromEntries(DELTAS.map(key => [key, finite(selected.delta[key], 'deltas', false)]));
    // Verify the established runner delta contract, without rerunning routes.
    const distance = result.metrics.distanceM - baseline.metrics.distanceM;
    const round = value => Number(value.toFixed(6));
    if (delta.distanceM !== round(distance) || delta.extraDistancePct !== (baseline.metrics.distanceM ? round(distance / baseline.metrics.distanceM * 100) : 0) || delta.extraLateJobs !== result.metrics.lateJobs - baseline.metrics.lateJobs || delta.unreachableJobs !== result.metrics.unreachableJobs) throw new Error('Completed results deltas do not match run metrics.');
    return { id: selected.id, name: selected.name, result, delta };
  });
  return { baseline, variants };
}
