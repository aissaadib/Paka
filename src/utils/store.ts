/**
 * A minimal external store.
 *
 * Used for state that lives outside React (the drawing engine) but must be
 * readable from React through `useSyncExternalStore`. Notifications only fire
 * when the state identity actually changes, so React never re-renders on
 * high-frequency drawing updates.
 */

export type Listener = () => void;

export interface Store<T> {
  getState(): T;
  /** Replaces the state and notifies listeners when the identity changed. */
  setState(next: T): void;
  update(updater: (previous: T) => T): void;
  subscribe(listener: Listener): () => void;
}

export function createStore<T>(initial: T): Store<T> {
  let state = initial;
  const listeners = new Set<Listener>();

  const store: Store<T> = {
    getState(): T {
      return state;
    },
    setState(next: T): void {
      if (Object.is(next, state)) {
        return;
      }
      state = next;
      for (const listener of listeners) {
        listener();
      }
    },
    update(updater: (previous: T) => T): void {
      store.setState(updater(store.getState()));
    },
    subscribe(listener: Listener): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };

  return store;
}
