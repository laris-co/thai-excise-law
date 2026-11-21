// Reviewer back office: Google sign-in (Firebase Auth) and the review records (Firestore).
// Loaded only by the #/admin pages (dynamic import), so members never download it.
// The web config below is public by design; access is enforced by firestore.rules.
import { initializeApp } from "firebase/app";
import { GoogleAuthProvider, getAuth, onAuthStateChanged, signInWithPopup, signOut } from "firebase/auth";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  writeBatch,
} from "firebase/firestore";
import config from "./firebase-config.json";

const app = initializeApp(config);
export const auth = getAuth(app);
const db = getFirestore(app);

export const watchUser = (fn) => onAuthStateChanged(auth, fn);
export const signIn = () => signInWithPopup(auth, new GoogleAuthProvider());
export const signOutNow = () => signOut(auth);

// reviewers/{email}: { role: "admin" | "reviewer" }
export async function myRole(email) {
  const s = await getDoc(doc(db, "reviewers", email));
  return s.exists() ? s.data().role || "reviewer" : null;
}
export async function listReviewers() {
  return (await getDocs(collection(db, "reviewers"))).docs.map((d) => ({ email: d.id, ...d.data() }));
}
export const addReviewer = (email, role, by) =>
  setDoc(doc(db, "reviewers", email.trim().toLowerCase()), { role, by, at: serverTimestamp() });
export const removeReviewer = (email) => deleteDoc(doc(db, "reviewers", email));

// docs/{key}: { pages: { "<n>": "approved" | "fixed" } }  — one small record per document for the queue
export async function progress() {
  const out = {};
  for (const d of (await getDocs(collection(db, "docs"))).docs) out[d.id] = d.data().pages || {};
  return out;
}

// pages/{key}_{n}: the current reviewed text; pages/{id}/revs: every save, never edited or deleted
export async function getPage(key, n) {
  const s = await getDoc(doc(db, "pages", `${key}_${n}`));
  return s.exists() ? s.data() : null;
}
export async function history(key, n) {
  const q = query(collection(db, "pages", `${key}_${n}`, "revs"), orderBy("at", "desc"));
  return (await getDocs(q)).docs.map((d) => d.data());
}
export async function savePage({ key, n, text, base, status, note, by, rev }) {
  const id = `${key}_${n}`;
  const b = writeBatch(db);
  b.set(doc(db, "pages", id), { key, page: n, text, base, status, note: note || "", by, at: serverTimestamp(), rev });
  b.set(doc(db, "docs", key), { pages: { [String(n)]: status }, at: serverTimestamp() }, { merge: true });
  b.set(doc(collection(db, "pages", id, "revs")), { text, status, note: note || "", by, at: serverTimestamp(), rev });
  await b.commit();
}
