import { MAX_FILE_BYTES } from "@newtab-todo/shared/field-limits";

const MB = 1024 * 1024;

export const MAX_ATTACHMENT_BYTES = Math.min(
  (Number(process.env.ATTACHMENT_MAX_MB) || 25) * MB,
  MAX_FILE_BYTES,
);
export const ATTACHMENT_QUOTA_BYTES = (Number(process.env.ATTACHMENT_QUOTA_MB) || 2048) * MB;
export const MAX_THUMB_BYTES = 256 * 1024;
