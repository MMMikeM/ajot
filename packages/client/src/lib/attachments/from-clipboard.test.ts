import { describe, expect, test } from "vite-plus/test";
import { filesToAttachFromPaste } from "~/lib/attachments/from-clipboard";

const picture = (name = "image.png") => new File(["png"], name, { type: "image/png" });

const clipboard = (files: File[], text = "") => ({
  files: files as unknown as FileList,
  getData: (type: string) => (type === "text/plain" ? text : ""),
});

describe("filesToAttachFromPaste", () => {
  test("attaches the file when there's no field for the text", () => {
    expect(
      filesToAttachFromPaste(clipboard([picture()], "image.png"), { intoTextField: false }),
    ).toHaveLength(1);
  });
});
