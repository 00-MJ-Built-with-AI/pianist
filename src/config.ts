/**
 * Google sign-in for syncing progress through the player's own Google Drive (a hidden app folder).
 * An OAuth client ID is public by design: it only works from the allowed origins, and the app has no secret.
 */
export const GOOGLE_CLIENT_ID = '394457669604-ecs4bi94t1065g0787hhkfr1t1pifv4a.apps.googleusercontent.com';

/** Only Pianist's own hidden folder in Drive; it can't see any other files. */
export const GOOGLE_DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
