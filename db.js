/* ============================================================
   db.js — IndexedDB layer for Binder
   Stores: subjects, lessons (blocks + quiz embedded), attachments, progress
   ============================================================ */

const DB_NAME = "binder-db";
const DB_VERSION = 1;
let _db = null;

function openDB() {
  return new Promise((resolve, reject) => {
    if (_db) return resolve(_db);
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains("subjects")) {
        db.createObjectStore("subjects", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("lessons")) {
        const store = db.createObjectStore("lessons", { keyPath: "id" });
        store.createIndex("subjectId", "subjectId", { unique: false });
      }
      if (!db.objectStoreNames.contains("attachments")) {
        db.createObjectStore("attachments", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("progress")) {
        db.createObjectStore("progress", { keyPath: "lessonId" });
      }
    };
    req.onsuccess = (e) => { _db = e.target.result; resolve(_db); };
    req.onerror = (e) => reject(e.target.error);
  });
}

function tx(storeName, mode = "readonly") {
  return openDB().then(db => db.transaction(storeName, mode).objectStore(storeName));
}

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/* ---------- Generic helpers ---------- */
async function getAll(storeName) {
  const store = await tx(storeName);
  return reqToPromise(store.getAll());
}
async function get(storeName, id) {
  const store = await tx(storeName);
  return reqToPromise(store.get(id));
}
async function put(storeName, value) {
  const store = await tx(storeName, "readwrite");
  return reqToPromise(store.put(value));
}
async function del(storeName, id) {
  const store = await tx(storeName, "readwrite");
  return reqToPromise(store.delete(id));
}
async function getByIndex(storeName, indexName, value) {
  const store = await tx(storeName);
  const idx = store.index(indexName);
  return reqToPromise(idx.getAll(value));
}

function uid(prefix = "id") {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/* ---------- Public API ---------- */
const DB = {
  uid,

  // Subjects
  getSubjects: () => getAll("subjects"),
  getSubject: (id) => get("subjects", id),
  saveSubject: (subject) => put("subjects", subject),
  deleteSubject: async (id) => {
    const lessons = await getByIndex("lessons", "subjectId", id);
    for (const l of lessons) {
      await DB.deleteLesson(l.id);
    }
    return del("subjects", id);
  },

  // Lessons
  getLessonsForSubject: (subjectId) => getByIndex("lessons", "subjectId", subjectId),
  getLesson: (id) => get("lessons", id),
  saveLesson: (lesson) => put("lessons", lesson),
  deleteLesson: async (id) => {
    await del("progress", id);
    const store = await tx("attachments", "readwrite");
    const all = await reqToPromise(store.getAll());
    for (const a of all) {
      if (a.lessonId === id) await del("attachments", a.id);
    }
    return del("lessons", id);
  },

  // Attachments (blobs)
  saveAttachment: (attachment) => put("attachments", attachment),
  getAttachment: (id) => get("attachments", id),
  deleteAttachment: (id) => del("attachments", id),

  // Progress
  getProgress: (lessonId) => get("progress", lessonId),
  saveProgress: (progress) => put("progress", progress),

  // Bulk / seed
  async seedIfEmpty(seedSubjects, seedLessons) {
    const existing = await getAll("subjects");
    if (existing.length > 0) return false;
    for (const s of seedSubjects) await put("subjects", s);
    for (const l of seedLessons) await put("lessons", l);
    return true;
  },

  async exportAll() {
    const [subjects, lessons, progress] = await Promise.all([
      getAll("subjects"), getAll("lessons"), getAll("progress")
    ]);
    return { subjects, lessons, progress, exportedAt: new Date().toISOString() };
  },

  async importAll(data) {
    for (const s of data.subjects || []) await put("subjects", s);
    for (const l of data.lessons || []) await put("lessons", l);
    for (const p of data.progress || []) await put("progress", p);
  }
};
