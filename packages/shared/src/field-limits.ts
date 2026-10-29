/**
 * Lengths a row's fields may run to, in characters (code points, as SQLite's length() counts), the
 * same in the client's fields, the API and the database's CHECKs. Far above what anyone types: the
 * client drops a change the server refuses rather than retrying it, so a real one must never be
 * refused. And small enough that a whole request still fits the server's body limit at four bytes
 * a character.
 */
export const MAX_ID = 100;
export const MAX_TITLE = 1_000;
export const MAX_TEXT = 50_000;
export const MAX_NAME = 200;
export const MAX_SHORT = 100;
export const MAX_USERNAME = 100;
export const MAX_NEW_USERNAME = 32;
export const MAX_PASSWORD = 1_000;
// Thousands of drops between the same two rows make a key this long; anything longer was sent to
// fill the database
export const MAX_SORT_KEY = 1_000;
// A list delete names the tasks it was shown, unless there are more than this
export const MAX_TASK_IDS = 2_000;

const isHighSurrogate = (code: number) => code >= 0xd800 && code <= 0xdbff;

/** The first `max` UTF-16 units of `text`, as an input's maxLength keeps. */
export const cutTo = (text: string, max: number) => {
  if (text.length <= max) return text;
  return text.slice(0, isHighSurrogate(text.charCodeAt(max - 1)) ? max - 1 : max);
};
