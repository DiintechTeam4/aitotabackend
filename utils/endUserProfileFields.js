const mongoose = require('mongoose');

/** Keys that are always collected in the registration flow; admin cannot remove them. */
const LOCKED_PROFILE_KEYS = ['email', 'mobileNo'];

const DEFAULT_LOCKED_FIELDS = [
  { key: 'email', label: 'Email', required: true, locked: true, fieldType: 'string', order: 0 },
  {
    key: 'mobileNo',
    label: 'Mobile number',
    required: true,
    locked: true,
    fieldType: 'string',
    order: 1
  }
];

function isLockedKey(key) {
  const k = String(key || '').trim().toLowerCase();
  return LOCKED_PROFILE_KEYS.includes(k);
}

function normalizeKey(key) {
  return String(key || '')
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9_]/g, '');
}

function sortByOrder(a, b) {
  return (Number(a.order) || 0) - (Number(b.order) || 0);
}

/** Map internal map key (email | mobileno | customlower) */
function fieldMapKey(canonKey) {
  const c = String(canonKey || '').trim().toLowerCase();
  if (c === 'email') return 'email';
  if (c === 'mobileno' || c === 'mobile_no') return 'mobileno';
  return normalizeKey(canonKey).toLowerCase();
}

/**
 * Merge stored client fields with required locked rows (email, mobileNo).
 * @param {Array} stored - from Client.endUserProfileFields
 */
function mergeFieldsWithLocked(stored) {
  const list = Array.isArray(stored) ? [...stored] : [];
  const byKey = new Map();
  for (const row of list) {
    if (!row || !row.key) continue;
    const k = String(row.key).trim().toLowerCase();
    const canonKey =
      k === 'mobileno' ? 'mobileNo' : k === 'email' ? 'email' : normalizeKey(row.key);
    if (!canonKey) continue;
    byKey.set(fieldMapKey(canonKey), { ...row, key: canonKey });
  }

  const merged = [];
  for (const def of DEFAULT_LOCKED_FIELDS) {
    const existing = byKey.get(fieldMapKey(def.key));
    merged.push({
      key: def.key,
      label: (existing && existing.label) || def.label,
      required: true,
      locked: true,
      fieldType: 'string',
      order: def.order
    });
    byKey.delete(fieldMapKey(def.key));
  }

  const rest = [...byKey.values()].filter((r) => !isLockedKey(r.key));
  rest.sort(sortByOrder);
  let order = merged.length;
  for (const r of rest) {
    merged.push({
      key: normalizeKey(r.key) || r.key,
      label: String(r.label || r.key || '').trim() || r.key,
      required: !!r.required,
      locked: false,
      fieldType: ['string', 'textarea', 'number'].includes(r.fieldType) ? r.fieldType : 'string',
      order: Number.isFinite(Number(r.order)) ? Number(r.order) : order++
    });
  }

  return merged.sort(sortByOrder);
}

/**
 * Persistable subset: full list including locked (so admin label edits save).
 */
function normalizeFieldsForSave(incoming) {
  if (!Array.isArray(incoming)) return mergeFieldsWithLocked([]);

  const rows = [];
  const seen = new Set();

  for (const raw of incoming) {
    if (!raw || !raw.key) continue;
    const keyRaw = String(raw.key).trim().toLowerCase();
    const key = keyRaw === 'mobileno' ? 'mobileNo' : keyRaw === 'email' ? 'email' : normalizeKey(raw.key);
    if (!key || seen.has(key)) continue;
    if (isLockedKey(key)) {
      if (key !== 'email' && key !== 'mobileNo') continue;
      seen.add(key);
      rows.push({
        key,
        label: String(raw.label || (key === 'email' ? 'Email' : 'Mobile number')).trim(),
        required: true,
        locked: true,
        fieldType: 'string',
        order: key === 'email' ? 0 : 1
      });
    } else {
      const nk = normalizeKey(raw.key);
      if (!nk || nk.length < 2 || seen.has(nk)) continue;
      seen.add(nk);
      rows.push({
        key: nk,
        label: String(raw.label || nk).trim(),
        required: !!raw.required,
        locked: false,
        fieldType: ['string', 'textarea', 'number'].includes(raw.fieldType) ? raw.fieldType : 'string',
        order: Number(raw.order) || rows.length
      });
    }
  }

  const hasEmail = rows.some((r) => r.key === 'email');
  const hasMobile = rows.some((r) => r.key === 'mobileNo');
  if (!hasEmail || !hasMobile) {
    return mergeFieldsWithLocked(rows);
  }

  return rows.sort(sortByOrder);
}

/**
 * Keys stored inside `profile` (excludes email/mobile which live on the user doc / OTP steps).
 */
function getProfilePayloadKeys(mergedFields) {
  return mergedFields.filter((f) => !isLockedKey(f.key)).map((f) => f.key);
}

function isNonEmpty(val) {
  if (val == null) return false;
  if (typeof val === 'string') return val.trim().length > 0;
  if (typeof val === 'number') return !Number.isNaN(val);
  return true;
}

function validateProfilePayload(profile, mergedFields) {
  const err = [];
  const raw = profile && typeof profile === 'object' ? { ...profile } : {};
  // Normalize common aliases before validation
  const prof = { ...raw };
  if (prof.mobileNumber !== undefined && prof.mobileNo === undefined) prof.mobileNo = prof.mobileNumber;
  if (prof.firstName !== undefined || prof.lastName !== undefined) {
    if (prof.name === undefined) {
      prof.name = [prof.firstName, prof.lastName].filter(Boolean).join(' ').trim() || undefined;
    }
  }
  const allowed = new Set(getProfilePayloadKeys(mergedFields));

  const sanitized = {};
  for (const k of allowed) {
    if (Object.prototype.hasOwnProperty.call(prof, k)) {
      sanitized[k] = prof[k];
    }
  }

  for (const f of mergedFields) {
    if (isLockedKey(f.key)) continue;
    if (f.required && !isNonEmpty(sanitized[f.key])) {
      err.push(`Missing or empty required field: ${f.label || f.key}`);
    }
  }

  return { errors: err, sanitized };
}

function isValidClientId(clientId) {
  // In this project, "clientId" is expected to be Client.userId (e.g. "CLI6474...").
  // We validate as a non-empty string; actual existence is checked in DB by controller/admin APIs.
  const s = String(clientId || '').trim();
  return s.length > 0;
}

module.exports = {
  LOCKED_PROFILE_KEYS,
  mergeFieldsWithLocked,
  normalizeFieldsForSave,
  getProfilePayloadKeys,
  validateProfilePayload,
  isLockedKey,
  normalizeKey,
  isValidClientId
};
