import { expect, test, vi } from "vite-plus/test";
import { createUploadSender } from "~/lib/files/sender";
import { drainUploads } from "~/lib/files/uploads";

vi.mock("~/lib/files/uploads", () => ({
  drainUploads: vi.fn(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
    return undefined;
  }),
}));

test("calls during a run make one more run, not one each", async () => {
  const send = createUploadSender(() => ({ token: "t", serverUrl: "", userId: "u1" }));
  const first = send();
  void send();
  void send();
  await first;
  expect(drainUploads).toHaveBeenCalledTimes(2);
});

test("nothing is sent with no one signed in", async () => {
  vi.mocked(drainUploads).mockClear();
  await createUploadSender(() => null)();
  expect(drainUploads).not.toHaveBeenCalled();
});
