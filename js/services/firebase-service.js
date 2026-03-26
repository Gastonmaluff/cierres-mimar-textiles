import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { firebaseConfig } from "../config/firebase-config.js";

let appInstance;
let dbInstance;

export async function initializeFirebase() {
  if (!appInstance) {
    appInstance = getApps()[0] || initializeApp(firebaseConfig);
    dbInstance = getFirestore(appInstance);
  }

  return dbInstance;
}

export function getDb() {
  if (!dbInstance) {
    throw new Error("Firebase todavía no fue inicializado.");
  }

  return dbInstance;
}
