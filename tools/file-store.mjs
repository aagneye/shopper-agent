// A shop state store kept in a JSON file, for the local shop server. It has the same
// get/set shape as shop-kit/api/memory-store.mjs.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * Keeps one shop's state in a file, seeding it the first time it is read.
 */
export class FileStore {
  /**
   * :param file: The JSON file's path.
   * :param seed: Returns the starting state when the file does not exist yet.
   */
  constructor(file, seed) {
    this.file = file;
    this.seed = seed;
  }

  /**
   * :return: The saved state, or the seed state (saved at once) when there is none.
   */
  get() {
    try {
      return JSON.parse(readFileSync(this.file, "utf8"));
    } catch {
      const state = this.seed();
      this.set(state);
      return structuredClone(state);
    }
  }

  /**
   * Replace the saved state. It writes a temporary file and renames it, so a crash never
   * leaves half a file.
   *
   * :param state: The new state.
   */
  set(state) {
    mkdirSync(path.dirname(this.file), { recursive: true });
    const temporary = `${this.file}.tmp`;
    writeFileSync(temporary, JSON.stringify(state));
    renameSync(temporary, this.file);
  }
}
