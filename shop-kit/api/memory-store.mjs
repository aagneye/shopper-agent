// A shop state store kept in memory. The local server uses a file-backed store with the
// same get/set shape, and a hosted deployment can use a key-value store.

/**
 * Keeps one shop's state, handing out copies so callers cannot change it by accident.
 */
export class MemoryStore {
  /**
   * :param state: The starting state.
   */
  constructor(state) {
    this.state = structuredClone(state);
  }

  /**
   * :return: A copy of the current state.
   */
  get() {
    return structuredClone(this.state);
  }

  /**
   * :param state: The new state, which replaces the old one.
   */
  set(state) {
    this.state = structuredClone(state);
  }
}
