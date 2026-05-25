// Firebase-Initialisierung:
// - Firestore für strukturierte JSON-Daten (keine CORS-Probleme)
// - Storage für Belegdateien (Upload via SDK, Anzeige via Link)

const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyC6xVo-wmXC4JjG7qMQnOExIJU-UDvBluE',
  authDomain: 'jupidu-36804.firebaseapp.com',
  projectId: 'jupidu-36804',
  storageBucket: 'jupidu-36804.firebasestorage.app',
  messagingSenderId: '11390726952',
  appId: '1:11390726952:web:aba2f101b6c5ca2bc5561d',
  measurementId: 'G-LT97CCT5DF',
};

// Namensraum: alle Daten dieser App liegen unter buchhaltung-sp-ar
// (Firestore-Collection und Storage-Ordner).
const NAMESPACE = 'buchhaltung-sp-ar';

let _firestore = null;
let _storage = null;

function ensureApp() {
  if (typeof firebase === 'undefined') {
    throw new Error('Firebase SDK nicht geladen (Adblocker?)');
  }
  if (!firebase.apps?.length) {
    firebase.initializeApp(FIREBASE_CONFIG);
  }
}

function initFirestore() {
  if (_firestore) return _firestore;
  ensureApp();
  if (!firebase.firestore) {
    throw new Error('Firestore SDK nicht geladen');
  }
  _firestore = firebase.firestore();
  return _firestore;
}

function initStorage() {
  if (_storage) return _storage;
  ensureApp();
  _storage = firebase.storage();
  return _storage;
}

// Firestore-Doc-IDs dürfen kein "/" enthalten
function safeDocId(key) {
  return String(key).replace(/\//g, '-');
}

function classifyFirestoreError(e) {
  const code = e?.code || '';
  if (code === 'permission-denied') {
    const err = new Error('Firestore-Berechtigung fehlt. Security Rules in der Firebase Console freigeben.');
    err.code = 'firestore/permission';
    return err;
  }
  if (code === 'failed-precondition' || code === 'unimplemented') {
    const err = new Error('Firestore ist im Projekt nicht aktiviert. In der Firebase Console → Build → Firestore aktivieren.');
    err.code = 'firestore/disabled';
    return err;
  }
  if (code === 'unauthenticated') {
    const err = new Error('Firestore verlangt Authentifizierung. Security Rules prüfen.');
    err.code = 'firestore/auth';
    return err;
  }
  return e;
}

// === JSON Storage via Firestore ===
export async function readJson(key, fallback = null) {
  try {
    const db = initFirestore();
    const doc = await db.collection(NAMESPACE).doc(safeDocId(key)).get();
    if (!doc.exists) return fallback;
    const payload = doc.data();
    if (!payload) return fallback;
    return payload.data ?? fallback;
  } catch (e) {
    throw classifyFirestoreError(e);
  }
}

export async function writeJson(key, data) {
  try {
    const db = initFirestore();
    await db.collection(NAMESPACE).doc(safeDocId(key)).set({
      data,
      updated_at: firebase.firestore.FieldValue.serverTimestamp(),
    });
    return data;
  } catch (e) {
    throw classifyFirestoreError(e);
  }
}

export async function deleteJson(key) {
  try {
    const db = initFirestore();
    await db.collection(NAMESPACE).doc(safeDocId(key)).delete();
  } catch (e) {
    if (e?.code !== 'not-found') throw classifyFirestoreError(e);
  }
}

// === Binary Files via Firebase Storage ===

// Upload eines Belegs an genau jenen Pfad, den auch das sp-ar-belege Portal
// nutzt ('belege/<fileId>_<name>'). Wird für den Direkt-Upload aus der
// Inbox verwendet, damit der spätere Proxy-Aufruf via beleg-proxy
// (sp-ar-belege Function) konsistent funktioniert.
export async function uploadBelegFile(file, onProgress) {
  const storage = initStorage();
  const fileId = 'f_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
  const safeName = (file.name || 'beleg').replace(/[^a-zA-Z0-9._-]+/g, '_');
  const path = 'belege/' + fileId + '_' + safeName;
  const ref = storage.ref(path);
  const task = ref.put(file, {
    contentType: file.type || 'application/octet-stream',
    customMetadata: { originalName: file.name, uploadedAt: new Date().toISOString() },
  });
  if (onProgress) {
    task.on('state_changed', (snap) => onProgress(snap.bytesTransferred / snap.totalBytes));
  }
  await task;
  const url = await ref.getDownloadURL();
  return { url, path, fileId, size: file.size };
}

export async function uploadFile(subpath, file, onProgress) {
  const storage = initStorage();
  const ref = storage.ref(`${NAMESPACE}/files/${subpath}`);
  const task = ref.put(file, {
    contentType: file.type || 'application/octet-stream',
  });
  if (onProgress) {
    task.on('state_changed', (snap) => {
      onProgress(snap.bytesTransferred / snap.totalBytes);
    });
  }
  await task;
  const url = await ref.getDownloadURL();
  return { url, fullPath: ref.fullPath };
}

export async function deleteFile(fullPath) {
  const storage = initStorage();
  try {
    await storage.ref(fullPath).delete();
  } catch (e) {
    if (e?.code !== 'storage/object-not-found') throw e;
  }
}

export function isFirebaseReady() {
  return typeof firebase !== 'undefined';
}
