import { apiFetch } from './api-client.js';
import { getCurrentUserId, hasRealSession } from './auth.js';
import { getDataOwner, loadData, replaceData } from './storage.js';

let syncTimer = null;
let syncing = false;
let hydrating = false;

function hasMatchingDataOwner() {
  const userId = getCurrentUserId();
  return Boolean(userId && getDataOwner() === userId.toLowerCase());
}

export async function hydrateCloudData() {
  if (!hasRealSession() || !hasMatchingDataOwner()) return null;
  hydrating = true;
  clearTimeout(syncTimer);
  try {
    const response = await apiFetch('/api/study-data', { cache: 'no-store' });
    if (!response.ok) return null;
    const payload = await response.json();
    if (payload.snapshot?.data && Object.keys(payload.snapshot.data).length) {
      return replaceData(payload.snapshot.data);
    }
    await pushCloudData();
    return null;
  } finally {
    hydrating = false;
  }
}

export async function pushCloudData() {
  if (!hasRealSession() || !hasMatchingDataOwner() || syncing) return;
  syncing = true;
  try {
    await apiFetch('/api/study-data', {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ version: 1, data: loadData() }),
    });
  } finally {
    syncing = false;
  }
}

export function scheduleCloudSync() {
  if (hydrating) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => { void pushCloudData(); }, 1200);
}

export function installCloudSync() {
  document.addEventListener('eon:data-saved', scheduleCloudSync);
}
