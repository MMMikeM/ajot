import { describe, expect, test } from "vite-plus/test";
import { filesToAttachFromPaste, namedForPaste } from "~/lib/attachments/from-clipboard";

const picture = (name = "image.png") => new File(["png"], name, { type: "image/png" });

const clipboard = (files: File[], text = "") => ({
  files: files as unknown as FileList,
  getData: (type: string) => (type === "text/plain" ? text : ""),
});

describe("namedForPaste", () => {
  test("names a browser's generic picture for when it was pasted", () => {
    const named = namedForPaste(picture(), new Date(2026, 10, 5, 9, 4, 30));
    expect(named.name).toBe("Pasted image 09.04.30.png");
    expect(named.type).toBe("image/png");
  });

  test("keeps a file's own name", () => {
    const file = picture("receipt.png");
    expect(namedForPaste(file)).toBe(file);
  });
});

describe("filesToAttachFromPaste", () => {
  test("attaches a picture pasted on its own, into a field or not", () => {
    expect(filesToAttachFromPaste(clipboard([picture()]), { intoTextField: true })).toHaveLength(1);
    expect(filesToAttachFromPaste(clipboard([picture()]), { intoTextField: false })).toHaveLength(
      1,
    );
  });

  test("leaves text with a picture to paste into the field", () => {
    expect(
      filesToAttachFromPaste(clipboard([picture()], "Quarterly numbers"), { intoTextField: true }),
    ).toEqual([]);
  });

  test("attaches the file when there's no field for the text", () => {
    expect(
      filesToAttachFromPaste(clipboard([picture()], "image.png"), { intoTextField: false }),
    ).toHaveLength(1);
  });

  test("attaches nothing for text alone", () => {
    expect(filesToAttachFromPaste(clipboard([], "hello"), { intoTextField: true })).toEqual([]);
  });
});
