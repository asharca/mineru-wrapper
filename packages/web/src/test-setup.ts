import "@testing-library/jest-dom";

// Bun's runtime returns `undefined` for window.localStorage unless --localstorage-file
// is set, which clobbers the jsdom-provided storage. Install a minimal in-memory shim
// so tests can use the standard Web Storage API.
function createMemoryStorage(): Storage {
  let store: Record<string, string> = {};
  return {
    get length() {
      return Object.keys(store).length;
    },
    clear() {
      store = {};
    },
    getItem(key) {
      return key in store ? store[key] : null;
    },
    key(index) {
      return Object.keys(store)[index] ?? null;
    },
    removeItem(key) {
      delete store[key];
    },
    setItem(key, value) {
      store[key] = String(value);
    },
  };
}

for (const name of ["localStorage", "sessionStorage"] as const) {
  Object.defineProperty(window, name, {
    configurable: true,
    writable: true,
    value: createMemoryStorage(),
  });
}
