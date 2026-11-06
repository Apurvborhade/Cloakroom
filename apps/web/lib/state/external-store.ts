type Listener = () => void;

/** A minimal store for useSyncExternalStore: immutable snapshots, synchronous notify. */
export class ExternalStore<T> {
  #value: T;
  #listeners = new Set<Listener>();

  constructor(initial: T) {
    this.#value = initial;
  }

  subscribe = (listener: Listener): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  getSnapshot = (): T => this.#value;

  set(next: T | ((current: T) => T)): void {
    this.#value = typeof next === 'function' ? (next as (current: T) => T)(this.#value) : next;
    for (const listener of this.#listeners) listener();
  }
}
