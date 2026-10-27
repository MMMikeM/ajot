/** Ports for the stack the suite starts itself, clear of the usual dev servers on 3000 and 5173 */
export const API_PORT = 3180;
export const CLIENT_PORT = 5180;
/** The production build, for the specs that need its service worker */
export const PREVIEW_PORT = 4175;

/** BASE_URL points the suite at a stack that's already running, which it then doesn't start */
export const BASE_URL = process.env.BASE_URL || `http://localhost:${CLIENT_PORT}`;
/** The API itself, past the preview server's proxy, for the server's own headers */
export const API_URL = `http://localhost:${API_PORT}`;
