import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut } from "firebase/auth";
import { getFirestore, doc, setDoc, getDoc } from "firebase/firestore";

// Cloud sync is optional. Without these settings the app runs fully on localStorage.
// See .env.example for the values to copy from your own Firebase project.
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};

export const cloudEnabled = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId);

const app = cloudEnabled ? initializeApp(firebaseConfig) : null;
export const auth = app ? getAuth(app) : null;
export const db = app ? getFirestore(app) : null;
export const googleProvider = new GoogleAuthProvider();

export const loginWithGoogle = async () => {
  if (!auth) return null;
  try {
    const result = await signInWithPopup(auth, googleProvider);
    return result.user;
  } catch (error) {
    console.error("Login failed", error);
    return null;
  }
};

export const logout = async () => {
  if (!auth) return;
  try {
    await signOut(auth);
  } catch (error) {
    console.error("Logout failed", error);
  }
};

// Sync functions
export const syncLogToCloud = async (userId, logData) => {
  if (!db) return;
  try {
    const userDoc = doc(db, "users", userId);
    await setDoc(userDoc, { log: logData }, { merge: true });
  } catch (error) {
    console.error("Error syncing to cloud:", error);
  }
};

export const fetchLogFromCloud = async (userId) => {
  if (!db) return null;
  try {
    const userDocRef = doc(db, "users", userId);
    const docSnap = await getDoc(userDocRef);
    if (docSnap.exists()) {
      return docSnap.data().log || {};
    }
    return null;
  } catch (error) {
    console.error("Error fetching from cloud:", error);
    return null;
  }
};