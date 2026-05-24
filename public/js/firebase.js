// Firebase-Initialisierung und Storage-Helpers
// Speichert JSON-Daten und Belegdateien in Firebase Storage.

const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyC6xVo-wmXC4JjG7qMQnOExIJU-UDvBluE',
  authDomain: 'jupidu-36804.firebaseapp.com',
  projectId: 'jupidu-36804',
  storageBucket: 'jupidu-36804.firebasestorage.app',
  messagingSenderId: '11390726952',
  appId: '1:11390726952:web:aba2f101b6c5ca2bc5561d',
  measurementId: 'G-LT97CCT5DF',
};

// Namensraum: alle Daten dieser App liegen unter buchhaltung-sp-ar/
// Bei Wiederverwendung des Buckets für andere Apps wichtig.
const NAMESPACE = 'buchhaltung-sp-ar';

let _storage = null;

export function initFirebase() {
  if (_storage) return _storage;
  if (typeof firebase === 'undefined') {
    throw new Error('Firebase SDK nicht geladen (Adblocker?)');
  }
  if (!firebase.apps?.length) {
    firebase.initializeApp(FIREBASE_CONFIG);
  }
  _storage = firebase.storage();
  return _storage;
}

function dataPath(key) {
  return `${NAMESPACE}/data/${key}.json`;
}

function filePath(subpath) {
  return `${NAMESPACE}/files/${subpath}`;
}

export async function readJson(key, fallback = null) {
  const storage = initFirebase();
  try {
    const ref = storage.ref(dataPath(key));
    const url = await ref.getDownloadURL();
    // Cache-Buster, damit nach Schreiben sofort die neue Version geladen wird
    const sep = url.includes('?') ? '&' : '?';
    const res = await fetch(`${url}${sep}_=${Date.now()}`);
    if (!res.ok) return fallback;
    return await res.json();
  } catch (e) {
    if (e?.code === 'storage/object-not-found') return fallback;
    // TypeError "Failed to fetch" deutet typischerweise auf CORS-Probleme hin
    if (e instanceof TypeError && /fetch/i.test(e.message || '')) {
      const err = new Error('Firebase Storage CORS nicht konfiguriert. Siehe Einstellungen → CORS-Setup.');
      err.code = 'firebase/cors';
      err.original = e;
      throw err;
    }
    throw e;
  }
}

export async function writeJson(key, data) {
  const storage = initFirebase();
  const ref = storage.ref(dataPath(key));
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  await ref.put(blob, {
    contentType: 'application/json',
    cacheControl: 'no-cache, no-store, must-revalidate',
  });
  return data;
}

export async function deleteJson(key) {
  const storage = initFirebase();
  try {
    await storage.ref(dataPath(key)).delete();
  } catch (e) {
    if (e?.code !== 'storage/object-not-found') throw e;
  }
}

export async function uploadFile(subpath, file, onProgress) {
  const storage = initFirebase();
  const ref = storage.ref(filePath(subpath));
  const task = ref.put(file, { contentType: file.type || 'application/octet-stream' });
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
  const storage = initFirebase();
  try {
    await storage.refFromURL(`gs://${FIREBASE_CONFIG.storageBucket}/${fullPath}`).delete();
  } catch (e) {
    if (e?.code !== 'storage/object-not-found') throw e;
  }
}

export function isFirebaseReady() {
  return typeof firebase !== 'undefined';
}
