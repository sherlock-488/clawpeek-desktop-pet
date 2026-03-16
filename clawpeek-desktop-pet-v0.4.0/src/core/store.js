import { createInitialState, reducer } from './reducer.js';

export function createStore(initialOverrides = {}) {
  let state = createInitialState(initialOverrides);
  const subscribers = new Set();

  function emit() {
    for (const subscriber of subscribers) {
      subscriber(state);
    }
  }

  return {
    getState() {
      return state;
    },
    dispatch(event) {
      state = reducer(state, event);
      emit();
      return state;
    },
    subscribe(listener) {
      subscribers.add(listener);
      listener(state);
      return () => subscribers.delete(listener);
    },
    reset(overrides = {}) {
      state = createInitialState(overrides);
      emit();
    },
  };
}