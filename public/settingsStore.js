/* eslint-disable no-undef */
/**
 * settingsStore.js — single source of truth for zac_settings.
 *
 * [ZAC-FIX] FIX 2 (settings persistence + AI mode two-way sync).
 *
 * Wraps localStorage["zac_settings"] and emits the same `storage` events
 * cross-tab plus a same-tab CustomEvent ("zac-settings:change") so any
 * UI element can subscribe.
 *
 * Schema (all optional, defaults applied on read):
 *   {
 *     aiMode            : boolean,
 *     defaultFramework  : string,
 *     defaultBrowser    : string,        // chrome | firefox | edge
 *     defaultBaseUrl    : string,
 *     headless          : boolean,
 *     slowMo            : number,        // milliseconds
 *     healerEnabled     : boolean,
 *     reportFormat      : string,        // allure | cucumber-html | both
 *     ollamaEndpoint    : string,        // "http://localhost:11434"
 *     ollamaModel       : string,        // "mistral"
 *     ollamaEnabled     : boolean
 *   }
 *
 * Public API on window.ZacSettings:
 *   get()                                    -> snapshot of merged settings
 *   set(patch)                               -> merge & persist
 *   toggle(key)                              -> flip a boolean
 *   subscribe(fn)                            -> fn(settings, change). Returns unsubscribe.
 *   bindCheckbox(domId, key)                 -> 2-way bind a <input type=checkbox>
 *   bindInput(domId, key, opts)              -> 2-way bind a <input>/<select>
 *   reset()                                  -> wipe to defaults
 *
 * `storage` events fire across tabs because every set() writes to
 * localStorage. Same-tab listeners do not get those, so we dispatch an
 * extra CustomEvent on window for the in-tab case.
 */
(function () {
  const KEY = 'zac_settings';

  const DEFAULTS = Object.freeze({
    aiMode: false,
    defaultFramework: '',
    defaultBrowser: 'chrome',
    defaultBaseUrl: '',
    headless: false,
    slowMo: 0,
    healerEnabled: true,
    reportFormat: 'allure',
    ollamaEndpoint: 'http://localhost:11434',
    ollamaModel: 'mistral',
    ollamaEnabled: false,
  });

  function read() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return { ...DEFAULTS };
      const parsed = JSON.parse(raw);
      return { ...DEFAULTS, ...parsed };
    } catch (e) {
      console.warn('[ZAC-FIX] settingsStore: corrupt zac_settings, resetting.', e);
      return { ...DEFAULTS };
    }
  }

  function persist(next) {
    localStorage.setItem(KEY, JSON.stringify(next));
  }

  const listeners = new Set();

  function notify(next, change) {
    for (const fn of listeners) {
      try {
        fn(next, change);
      } catch (e) {
        console.error('[ZAC-FIX] settingsStore listener threw', e);
      }
    }
    window.dispatchEvent(new CustomEvent('zac-settings:change', {
      detail: { settings: next, change }
    }));
  }

  function get() {
    return read();
  }

  function set(patch) {
    if (!patch || typeof patch !== 'object') return read();
    const current = read();
    const next = { ...current, ...patch };
    const change = {};
    for (const k of Object.keys(patch)) {
      if (current[k] !== next[k]) change[k] = { from: current[k], to: next[k] };
    }
    if (Object.keys(change).length === 0) return next;
    persist(next);
    console.log('[ZAC-FIX] zac_settings updated:', change);
    notify(next, change);

    // Backwards-compat mirror: legacy keys some pages still read directly.
    if ('defaultFramework' in patch) {
      try {
        if (patch.defaultFramework) localStorage.setItem('zac.defaultFramework', patch.defaultFramework);
        else localStorage.removeItem('zac.defaultFramework');
      } catch (e) { /* private mode */ }
    }
    return next;
  }

  function toggle(key) {
    const cur = read();
    return set({ [key]: !cur[key] });
  }

  function reset() {
    persist({ ...DEFAULTS });
    console.log('[ZAC-FIX] zac_settings reset to defaults');
    notify({ ...DEFAULTS }, { reset: true });
  }

  function subscribe(fn) {
    listeners.add(fn);
    try {
      fn(read(), { initial: true });
    } catch (e) {
      console.error('[ZAC-FIX] settingsStore: initial fn threw', e);
    }
    return () => listeners.delete(fn);
  }

  // Cross-tab sync: storage event fires only in *other* tabs when our key changes.
  window.addEventListener('storage', (e) => {
    if (e.key !== KEY) return;
    notify(read(), { crossTab: true });
  });

  function bindCheckbox(domId, key) {
    const el = document.getElementById(domId);
    if (!el) return () => {};
    const apply = (s) => { el.checked = !!s[key]; };
    apply(read());
    const onChange = () => set({ [key]: !!el.checked });
    el.addEventListener('change', onChange);
    const unsub = subscribe(apply);
    return () => { el.removeEventListener('change', onChange); unsub(); };
  }

  function bindInput(domId, key, opts) {
    const o = opts || {};
    const el = document.getElementById(domId);
    if (!el) return () => {};
    const isNumber = o.type === 'number';
    const apply = (s) => {
      const v = s[key];
      el.value = v == null ? '' : String(v);
    };
    apply(read());
    const onChange = () => {
      let v = el.value;
      if (isNumber) v = Number(v) || 0;
      set({ [key]: v });
    };
    el.addEventListener(o.event || 'change', onChange);
    const unsub = subscribe(apply);
    return () => { el.removeEventListener(o.event || 'change', onChange); unsub(); };
  }

  // Sanity audit at page boot — surfaces broken keys so QA can spot them.
  try {
    const snapshot = read();
    const unknown = Object.keys(snapshot).filter(k => !(k in DEFAULTS));
    if (unknown.length) {
      console.warn('[ZAC-FIX] zac_settings has unknown keys:', unknown);
    }
  } catch (e) { /* ignore */ }

  window.ZacSettings = {
    KEY,
    DEFAULTS,
    get,
    set,
    toggle,
    reset,
    subscribe,
    bindCheckbox,
    bindInput,
  };
})();
