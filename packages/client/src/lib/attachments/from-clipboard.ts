const GENERIC_NAME = /^image\.(\w+)$/i;

const clockOf = (at: Date) =>
  [at.getHours(), at.getMinutes(), at.getSeconds()]
    .map((part) => String(part).padStart(2, "0"))
    .join(".");

/** Browsers name every pasted picture image.png, which would give each paste the same name. */
export const namedForPaste = (file: File, at = new Date()) => {
  const extension = GENERIC_NAME.exec(file.name)?.[1];
  if (!extension) return file;
  return new File([file], `Pasted image ${clockOf(at)}.${extension}`, {
    type: file.type,
    lastModified: file.lastModified,
  });
};

/**
 * The files a paste attaches. Pasted into a field with text alongside, as a copy from a document
 * carries, it's the text that's meant, so it pastes as text and attaches nothing.
 */
export const filesToAttachFromPaste = (
  data: Pick<DataTransfer, "files" | "getData">,
  { intoTextField }: { intoTextField: boolean },
) => {
  const files = [...data.files];
  if (files.length === 0) return [];
  if (intoTextField && data.getData("text/plain").trim()) return [];
  return files.map((file) => namedForPaste(file));
};
