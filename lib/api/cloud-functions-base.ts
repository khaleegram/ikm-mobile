/**
 * Single source of truth for legacy Firebase Cloud Function endpoints.
 *
 * Every `*_FUNCTIONS` map across `lib/api/*.ts` used to hardcode the full
 * `https://<name>-<host>` URL per entry, so moving to a different Cloud Run
 * project/region meant editing 20+ files one string literal at a time. Now
 * only this module knows the host — callers pass just the function name.
 *
 * Two hosting styles exist in this project:
 * - Cloud Run (2nd gen), e.g. https://getallusers-q3rjv54uka-uc.a.run.app
 * - Legacy Cloud Functions (1st gen), e.g.
 *   https://us-central1-ikm-marketplace.cloudfunctions.net/sendOrderChatMessage
 */

const DEFAULT_CLOUD_RUN_HOST_SUFFIX = 'q3rjv54uka-uc.a.run.app';
const DEFAULT_LEGACY_FUNCTIONS_REGION = 'us-central1';
const DEFAULT_LEGACY_FUNCTIONS_PROJECT_ID = 'ikm-marketplace';

function getCloudRunHostSuffix(): string {
  return (
    process.env.EXPO_PUBLIC_CLOUD_RUN_HOST_SUFFIX || DEFAULT_CLOUD_RUN_HOST_SUFFIX
  ).trim();
}

function getLegacyFunctionsRegion(): string {
  return (
    process.env.EXPO_PUBLIC_LEGACY_FUNCTIONS_REGION || DEFAULT_LEGACY_FUNCTIONS_REGION
  ).trim();
}

function getLegacyFunctionsProjectId(): string {
  return (
    process.env.EXPO_PUBLIC_LEGACY_FUNCTIONS_PROJECT_ID || DEFAULT_LEGACY_FUNCTIONS_PROJECT_ID
  ).trim();
}

/**
 * Builds a Cloud Run (2nd gen) function URL from its function name, e.g.
 * `cloudFunctionUrl('getAllUsers')` -> `https://getallusers-q3rjv54uka-uc.a.run.app`
 */
export function cloudFunctionUrl(functionName: string): string {
  const name = functionName.trim().toLowerCase();
  if (!name) {
    throw new Error('cloudFunctionUrl requires a non-empty function name.');
  }
  return `https://${name}-${getCloudRunHostSuffix()}`;
}

/**
 * Builds a legacy (1st gen) Cloud Functions URL from its exported function name, e.g.
 * `legacyCloudFunctionUrl('sendOrderChatMessage')` ->
 * `https://us-central1-ikm-marketplace.cloudfunctions.net/sendOrderChatMessage`
 */
export function legacyCloudFunctionUrl(functionName: string): string {
  const name = functionName.trim();
  if (!name) {
    throw new Error('legacyCloudFunctionUrl requires a non-empty function name.');
  }
  return `https://${getLegacyFunctionsRegion()}-${getLegacyFunctionsProjectId()}.cloudfunctions.net/${name}`;
}
