import { simulateExperiment } from './experiment.js';
self.onmessage = ({ data }) => {
  try {
    const result = simulateExperiment(data.experiment);
    self.postMessage({ id: data.id, ...result });
  } catch (error) {
    self.postMessage({ id: data.id, error: error instanceof Error ? error.message : 'Experiment failed' });
  }
};
