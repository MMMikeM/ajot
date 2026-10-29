/** Clear of the usual dev servers on 3000 and 5173 */
export const API_PORT = 3180;
export const CLIENT_PORT = 5180;
/** The S3 emulator's, which the preview server's policy names as the bucket's origin */
export const S3_PORT = 3181;
export const S3_URL = `http://127.0.0.1:${S3_PORT}`;
/** For the specs that need the build's service worker */
export const PREVIEW_PORT = 4175;

export const BASE_URL = process.env.BASE_URL || `http://localhost:${CLIENT_PORT}`;
/** The API itself, past the preview server's proxy, for the server's own headers */
export const API_URL = `http://localhost:${API_PORT}`;
