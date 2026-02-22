#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { initializeApp, getApps } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import {
  collection,
  getDocs,
  getFirestore,
  limit,
  query,
  serverTimestamp,
  where,
  writeBatch,
} from 'firebase/firestore';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

function loadDotEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  const raw = fs.readFileSync(filePath, 'utf8');
  const lines = raw.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx <= 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

function parseArgs() {
  const args = process.argv.slice(2);
  const flags = {
    apply: false,
    batchSize: 200,
    maxDocs: Number.POSITIVE_INFINITY,
    email: process.env.MIGRATION_ADMIN_EMAIL || '',
    password: process.env.MIGRATION_ADMIN_PASSWORD || '',
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--apply') {
      flags.apply = true;
      continue;
    }
    if (arg === '--batch-size') {
      const v = Number(args[i + 1]);
      if (!Number.isFinite(v) || v <= 0 || v > 500) {
        throw new Error('Invalid --batch-size. Use a number between 1 and 500.');
      }
      flags.batchSize = v;
      i += 1;
      continue;
    }
    if (arg === '--max-docs') {
      const v = Number(args[i + 1]);
      if (!Number.isFinite(v) || v <= 0) {
        throw new Error('Invalid --max-docs. Use a number greater than 0.');
      }
      flags.maxDocs = v;
      i += 1;
      continue;
    }
    if (arg === '--email') {
      flags.email = args[i + 1] || '';
      i += 1;
      continue;
    }
    if (arg === '--password') {
      flags.password = args[i + 1] || '';
      i += 1;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
  }

  return flags;
}

function printHelp() {
  console.log(`
Migrate Firestore users role from "customer" to "user".

Usage:
  npm run migrate:market-user-role -- [options]

Options:
  --apply                  Execute writes. Without this flag, script runs dry-run.
  --batch-size <n>         Number of docs per batch query/write (default: 200, max: 500).
  --max-docs <n>           Maximum docs to process in this run (default: unlimited).
  --email <value>          Admin account email.
  --password <value>       Admin account password.
  --help, -h               Show help.

Env vars:
  EXPO_PUBLIC_FIREBASE_API_KEY
  EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN
  EXPO_PUBLIC_FIREBASE_PROJECT_ID
  EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET
  EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
  EXPO_PUBLIC_FIREBASE_APP_ID
  MIGRATION_ADMIN_EMAIL
  MIGRATION_ADMIN_PASSWORD

Examples:
  npm run migrate:market-user-role
  npm run migrate:market-user-role -- --apply
  npm run migrate:market-user-role -- --apply --batch-size 100 --max-docs 1000
  `);
}

function getFirebaseConfig() {
  return {
    apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY || '',
    authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN || '',
    projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID || '',
    storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET || '',
    messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || '',
    appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID || '',
  };
}

function assertFirebaseConfig(config) {
  const missing = Object.entries(config)
    .filter(([, v]) => !v)
    .map(([k]) => k);
  if (missing.length > 0) {
    throw new Error(`Missing Firebase config env vars: ${missing.join(', ')}`);
  }
}

async function run() {
  loadDotEnv(path.join(rootDir, '.env'));
  const flags = parseArgs();

  if (!flags.email || !flags.password) {
    throw new Error(
      'Admin credentials missing. Provide --email/--password or MIGRATION_ADMIN_EMAIL/MIGRATION_ADMIN_PASSWORD.'
    );
  }

  const firebaseConfig = getFirebaseConfig();
  assertFirebaseConfig(firebaseConfig);

  const app = getApps().length > 0 ? getApps()[0] : initializeApp(firebaseConfig);
  const auth = getAuth(app);
  const db = getFirestore(app);

  console.log(`[start] mode=${flags.apply ? 'apply' : 'dry-run'} batchSize=${flags.batchSize} maxDocs=${flags.maxDocs}`);

  const cred = await signInWithEmailAndPassword(auth, flags.email, flags.password);
  const tokenResult = await cred.user.getIdTokenResult(true);
  if (tokenResult.claims?.isAdmin !== true) {
    throw new Error('Signed-in account is not admin (custom claim isAdmin !== true).');
  }

  let totalMatched = 0;
  let totalUpdated = 0;
  let iteration = 0;

  while (totalMatched < flags.maxDocs) {
    iteration += 1;
    const remaining = flags.maxDocs - totalMatched;
    const pageSize = Math.min(flags.batchSize, remaining);

    const q = query(collection(db, 'users'), where('role', '==', 'customer'), limit(pageSize));
    const snap = await getDocs(q);

    if (snap.empty) break;

    totalMatched += snap.size;
    const sampleIds = snap.docs.slice(0, 5).map((d) => d.id).join(', ');
    console.log(`[batch ${iteration}] matched=${snap.size} sample=[${sampleIds}]`);

    if (flags.apply) {
      const batch = writeBatch(db);
      for (const docSnap of snap.docs) {
        batch.update(docSnap.ref, {
          role: 'user',
          updatedAt: serverTimestamp(),
        });
      }
      await batch.commit();
      totalUpdated += snap.size;
      console.log(`[batch ${iteration}] committed=${snap.size}`);
    }
  }

  if (flags.apply) {
    console.log(`[done] matched=${totalMatched} updated=${totalUpdated}`);
  } else {
    console.log(`[done] dry-run matched=${totalMatched} (no writes executed)`);
    console.log('[next] Re-run with --apply to execute updates.');
  }
}

run().catch((error) => {
  console.error('[error]', error?.message || error);
  process.exitCode = 1;
});
