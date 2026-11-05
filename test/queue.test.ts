import { describe, expect, it } from 'vitest';
import { FifoSerialQueue } from '../services/enclave/src/queue.js';

function createDeferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('FifoSerialQueue', () => {
  it('executes operations in strict FIFO submission order', async () => {
    const queue = new FifoSerialQueue();
    const executionOrder: number[] = [];

    const op1 = queue.run(async () => {
      executionOrder.push(1);
      return 1;
    });

    const op2 = queue.run(async () => {
      executionOrder.push(2);
      return 2;
    });

    const op3 = queue.run(async () => {
      executionOrder.push(3);
      return 3;
    });

    await Promise.all([op1, op2, op3]);
    expect(executionOrder).toEqual([1, 2, 3]);
  });

  it('enforces strict serialization with maximum concurrency of exactly one', async () => {
    const queue = new FifoSerialQueue();
    let activeOperations = 0;
    let maxConcurrentOperations = 0;
    const lifecycleEvents: string[] = [];

    const gate1 = createDeferred();
    const gate2 = createDeferred();
    const gate3 = createDeferred();

    const createTask = (gate: ReturnType<typeof createDeferred>, id: number) => {
      return queue.run(async () => {
        lifecycleEvents.push(`start-${id}`);
        activeOperations++;
        if (activeOperations > maxConcurrentOperations) {
          maxConcurrentOperations = activeOperations;
        }
        await gate.promise;
        activeOperations--;
        lifecycleEvents.push(`end-${id}`);
        return id;
      });
    };

    const task1 = createTask(gate1, 1);
    const task2 = createTask(gate2, 2);
    const task3 = createTask(gate3, 3);

    // Yield to microtask queue so task 1 starts
    await new Promise((resolve) => queueMicrotask(resolve));

    expect(lifecycleEvents).toEqual(['start-1']);
    expect(maxConcurrentOperations).toBe(1);

    gate1.resolve();
    await task1;

    // Yield to microtask queue so task 2 starts
    await new Promise((resolve) => queueMicrotask(resolve));

    expect(lifecycleEvents).toEqual(['start-1', 'end-1', 'start-2']);
    expect(maxConcurrentOperations).toBe(1);

    gate2.resolve();
    await task2;

    // Yield to microtask queue so task 3 starts
    await new Promise((resolve) => queueMicrotask(resolve));

    expect(lifecycleEvents).toEqual(['start-1', 'end-1', 'start-2', 'end-2', 'start-3']);
    expect(maxConcurrentOperations).toBe(1);

    gate3.resolve();
    await task3;

    expect(lifecycleEvents).toEqual([
      'start-1',
      'end-1',
      'start-2',
      'end-2',
      'start-3',
      'end-3',
    ]);
    expect(activeOperations).toBe(0);
    expect(maxConcurrentOperations).toBe(1);
  });

  it('prevents a second operation from starting while a delayed first operation is in flight', async () => {
    const queue = new FifoSerialQueue();
    const firstGate = createDeferred();
    let secondStarted = false;

    const firstPromise = queue.run(async () => {
      await firstGate.promise;
      return 'first-done';
    });

    const secondPromise = queue.run(async () => {
      secondStarted = true;
      return 'second-done';
    });

    // Allow any pending microtasks to run
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(secondStarted).toBe(false);

    firstGate.resolve();

    const [firstResult, secondResult] = await Promise.all([firstPromise, secondPromise]);

    expect(firstResult).toBe('first-done');
    expect(secondResult).toBe('second-done');
    expect(secondStarted).toBe(true);
  });

  it('returns each caller their own expected result', async () => {
    const queue = new FifoSerialQueue();

    const resultA = queue.run(async () => 'alpha');
    const resultB = queue.run(async () => 42);
    const resultC = queue.run(async () => ({ key: 'value' }));

    expect(await resultA).toBe('alpha');
    expect(await resultB).toBe(42);
    expect(await resultC).toEqual({ key: 'value' });
  });

  it('isolates promise rejection so failed operations do not block subsequent operations', async () => {
    const queue = new FifoSerialQueue();

    const failedOp = queue.run(async () => {
      throw new Error('deliberate-failure');
    });

    const subsequentOp = queue.run(async () => {
      return 'subsequent-success';
    });

    await expect(failedOp).rejects.toThrow('deliberate-failure');
    await expect(subsequentOp).resolves.toBe('subsequent-success');
  });

  it('isolates synchronous exceptions thrown inside an operation', async () => {
    const queue = new FifoSerialQueue();

    const syncThrowOp = queue.run(() => {
      throw new Error('synchronous-throw');
    });

    const nextOp = queue.run(async () => {
      return 'next-success';
    });

    await expect(syncThrowOp).rejects.toThrow('synchronous-throw');
    await expect(nextOp).resolves.toBe('next-success');
  });

  it('processes a large volume of concurrently queued operations with deterministic ordering', async () => {
    const queue = new FifoSerialQueue();
    const count = 100;
    const completedIndices: number[] = [];

    const tasks = Array.from({ length: count }, (_, i) =>
      queue.run(async () => {
        completedIndices.push(i);
        return i;
      })
    );

    const results = await Promise.all(tasks);
    const expected = Array.from({ length: count }, (_, i) => i);

    expect(results).toEqual(expected);
    expect(completedIndices).toEqual(expected);
  });

  it('accepts and runs an operation on a newly created empty queue', async () => {
    const queue = new FifoSerialQueue();
    const result = await queue.run(async () => 'initial-operation');
    expect(result).toBe('initial-operation');
  });
});
