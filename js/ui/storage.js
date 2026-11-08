// localStorage helpers (every access guarded: storage may be unavailable).

const KEY_AUTO = 'physlab.autosave.v1';
const KEY_SLOTS = 'physlab.slots.v1';
const KEY_PREFS = 'physlab.prefs.v1';

function read(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : fallback;
  } catch (e) {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    return false;
  }
}

export const storage = {
  loadAutosave: () => read(KEY_AUTO, null),
  saveAutosave: (data) => write(KEY_AUTO, data),
  clearAutosave: () => {
    try {
      localStorage.removeItem(KEY_AUTO);
    } catch (e) { /* ignore */ }
  },
  slots: () => read(KEY_SLOTS, []),
  saveSlot(name, data) {
    const slots = read(KEY_SLOTS, []).filter((s) => s.name !== name);
    slots.unshift({ name, date: new Date().toISOString(), data });
    return write(KEY_SLOTS, slots.slice(0, 40));
  },
  deleteSlot(name) {
    write(KEY_SLOTS, read(KEY_SLOTS, []).filter((s) => s.name !== name));
  },
  prefs: () => read(KEY_PREFS, {}),
  savePrefs: (p) => write(KEY_PREFS, p),
};
