/**
 * Profile migrations.
 *
 * Future plugin versions can step profiles forward version by version:
 *
 *   v1 -> v2 -> v3 ...
 *
 * Each "from" record registers a function that receives the raw profile and
 * returns a migrated copy (bumping `version` itself). The migration chain is
 * applied starting at the profile's declared version. Profiles declaring a
 * NEWER version than this plugin understands are returned untouched — the
 * caller must then fail safe (keep the request / keep the old config).
 *
 * The current schema version is 1, so no migrations are wired yet; the
 * structure is in place and covered by tests.
 */

import { PROFILE_SCHEMA_VERSION } from './profile-validator.js';

/** @type {Record<number, (profile: object) => object>} Migrators keyed by source version. */
const MIGRATORS = {
    // 1: migrateV1ToV2,  // example: uncomment when bumping to schema v2
};

export function migrateProfile(profile) {
    if (!profile || typeof profile !== 'object' || Array.isArray(profile)) {
        return profile;
    }

    let current = { ...profile };
    let declared = Number(profile.version);
    if (!Number.isFinite(declared) || declared < 1) {
        declared = 1;
        current.version = 1;
    }

    if (declared > PROFILE_SCHEMA_VERSION) {
        // From a newer plugin version — do not touch.
        return current;
    }

    for (let v = declared; v < PROFILE_SCHEMA_VERSION; v++) {
        const migrator = MIGRATORS[v];
        if (typeof migrator !== 'function') {
            break;
        }
        current = migrator(current) || current;
    }

    return current;
}

/*
 * Example migration to uncomment when bumping PROFILE_SCHEMA_VERSION to 2:
 *
 * function migrateV1ToV2(profile) {
 *     const result = { ...profile };
 *     result.version = 2;
 *     // ... transform v1 fields into v2 fields ...
 *     return result;
 * }
 */
