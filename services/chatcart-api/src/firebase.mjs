import fs from 'fs';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { config } from './config.mjs';

function loadCredential() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  }
  if (config.firebaseCredentialsPath && fs.existsSync(config.firebaseCredentialsPath)) {
    return JSON.parse(fs.readFileSync(config.firebaseCredentialsPath, 'utf8'));
  }
  return undefined;
}

if (getApps().length === 0) {
  const credential = loadCredential();
  initializeApp(
    credential
      ? { credential: cert(credential), projectId: config.firebaseProjectId }
      : { projectId: config.firebaseProjectId }
  );
}

export const firestore = getFirestore();
export const auth = getAuth();
