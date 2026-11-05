import type { SerialQueue } from '@cloakroom/shared';

/**
 * FifoSerialQueue guarantees strictly serialized, FIFO execution of asynchronous tasks.
 *
 * Guarantees:
 * 1. FIFO execution: operations are executed in the exact order they are submitted.
 * 2. Concurrency limit: at most one operation executes at any given time.
 * 3. Settlement pacing: each subsequent operation starts only after the preceding
 *    operation has settled (resolved or rejected).
 * 4. Caller isolation: each caller receives the resolved value or rejection of its
 *    own submitted operation.
 * 5. Error containment: a rejected operation or synchronous throw isolates its error
 *    to the caller's promise and never blocks or poisons subsequent queued tasks.
 *
 * Warning:
 * Operations must not recursively enqueue and await another operation on the same
 * queue, as this will result in a deadlock.
 */
export class FifoSerialQueue implements SerialQueue {
  private tail: Promise<void> = Promise.resolve();

  /**
   * Enqueues an asynchronous operation for execution after all previously enqueued
   * operations have settled.
   *
   * @param op Asynchronous task to execute.
   * @returns A Promise resolving to the result of `op`, or rejecting with its error.
   */
  run<T>(op: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.tail = this.tail.then(async () => {
        try {
          const result = await op();
          resolve(result);
        } catch (error) {
          reject(error);
        }
      });
    });
  }
}
