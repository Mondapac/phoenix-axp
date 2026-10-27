import { WorkerRuntime } from './worker-runtime';

describe('WorkerRuntime', () => {
  it('starts once and stops once, leaving no timer behind', () => {
    jest.useFakeTimers();
    try {
      const runtime = new WorkerRuntime();
      expect(runtime.running).toBe(false);

      runtime.start();
      runtime.start();
      expect(runtime.running).toBe(true);
      expect(jest.getTimerCount()).toBe(1);

      runtime.stop();
      runtime.stop();
      expect(runtime.running).toBe(false);
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });
});
