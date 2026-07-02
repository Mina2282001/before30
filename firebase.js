import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  onSnapshot
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const firebaseConfig = {
  apiKey: 'AIzaSyBSwgAW9QSdhS7h0q72YJorBTa7n2g9V58',
  authDomain: 'before30-ce107.firebaseapp.com',
  projectId: 'before30-ce107',
  storageBucket: 'before30-ce107.firebasestorage.app',
  messagingSenderId: '234482355939',
  appId: '1:234482355939:web:90437fe1141da098973fd6',
  measurementId: 'G-S7YN03CC4H'
};

let app;
let db;

export function initializeFirebase() {
  if (!app) {
    app = initializeApp(firebaseConfig);
  }
  if (!db) {
    db = getFirestore(app);
  }
  return { app, db };
}

export function getDb() {
  return db || initializeFirebase().db;
}

function getDocRef(key) {
  return doc(getDb(), 'before30', key);
}

async function saveDocument(key, data) {
  const ref = getDocRef(key);
  await setDoc(ref, data, { merge: true });
}

async function loadDocument(key, fallback) {
  const ref = getDocRef(key);
  const snapshot = await getDoc(ref);
  if (!snapshot.exists()) {
    return fallback;
  }
  return snapshot.data();
}

export async function saveEnglish(data) {
  return saveDocument('english', data);
}

export async function loadEnglish(fallback) {
  return loadDocument('english', fallback);
}

export async function saveGym(data) {
  return saveDocument('gym', data);
}

export async function loadGym(fallback) {
  return loadDocument('gym', fallback);
}

export async function saveStreaks(data) {
  return saveDocument('streaks', data);
}

export async function loadStreaks(fallback) {
  return loadDocument('streaks', fallback);
}

export function subscribeToDocument(key, fallback, onData, onError) {
  const ref = getDocRef(key);
  return onSnapshot(ref, (snapshot) => {
    if (snapshot.exists()) {
      onData(snapshot.data());
    } else {
      onData(fallback);
    }
  }, onError);
}
