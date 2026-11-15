// ORBITAL — IndexedDB storage layer (all data stays on this device)
const DB_NAME = 'orbital-db';
const DB_VERSION = 1;
const STORES = ['records', 'alerts', 'emergencies', 'outbox', 'assessments'];
let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of STORES) {
        if (!db.objectStoreNames.contains(s)) {
          const os = db.createObjectStore(s, { keyPath: 'id' });
          os.createIndex('ts', 'ts');
          if (s === 'records') os.createIndex('type', 'type');
        }
      }
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(store, mode, fn) {
  return open().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const os = t.objectStore(store);
    let result;
    Promise.resolve(fn(os)).then(r => { result = r; });
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

const reqP = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export const DB = {
  all: store => open().then(db => reqP(db.transaction(store).objectStore(store).getAll())),
  get: (store, id) => open().then(db => reqP(db.transaction(store).objectStore(store).get(id))),
  put: (store, obj) => tx(store, 'readwrite', os => { os.put(obj); return obj; }),
  putMany: (store, arr) => tx(store, 'readwrite', os => { arr.forEach(o => os.put(o)); return arr.length; }),
  del: (store, id) => tx(store, 'readwrite', os => { os.delete(id); }),
  clear: store => tx(store, 'readwrite', os => { os.clear(); }),
  kvGet: key => open().then(db => reqP(db.transaction('kv').objectStore('kv').get(key))),
  kvSet: (key, val) => tx('kv', 'readwrite', os => { os.put(val, key); }),
  async wipeAll() { for (const s of [...STORES, 'kv']) await this.clear(s); },
  STORES,
};

export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2));
