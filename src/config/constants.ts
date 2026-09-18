/**
 * Minimum duration (in ms) the "Finding Driver" screen should be shown to the user 
 * before transitioning to a "No Drivers Available" state. 
 * This ensures the customer feels a thorough search was conducted, even if the backend 
 * exhausts nearby drivers quickly.
 * 
 * NOTE: This is a UI-only minimum duration. It does not force backend polling for 
 * 40 seconds, nor does it delay successful driver assignments.
 */
export const MIN_DRIVER_SEARCH_DURATION_MS = 40_000;
