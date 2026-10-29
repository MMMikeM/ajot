import { test, expect } from "./fixtures";
import { addTask, apiRequest, newId, now, send } from "./helpers/api";

type UploadUrls = { file: string; thumb?: string };

const attach = async (token: string, taskId: string, size: number) => {
  const id = newId();
  await apiRequest(
    "POST",
    "/api/attachments",
    {
      id,
      taskId,
      name: "note.txt",
      mimeType: "text/plain",
      size,
      hasThumb: false,
      createdAt: now(),
      updatedAt: now(),
    },
    token,
  );
  const urls = await apiRequest<UploadUrls>("POST", "/api/attachments/upload-url", { id }, token);
  return {
    put: (body: string) =>
      fetch(urls.file, { method: "PUT", body, headers: { "content-type": "text/plain" } }),
    complete: () => send("/api/attachments/complete", { method: "POST", body: { id }, token }),
    download: async () => {
      const [found] = await apiRequest<{ url: string }[]>(
        "POST",
        "/api/attachments/urls",
        { ids: [id], variant: "file" },
        token,
      );
      return (await fetch(found!.url)).text();
    },
  };
};

test("the bucket takes only the bytes the server signed for, and serves them back", async ({
  user1Auth,
}) => {
  const { token } = user1Auth;
  const task = await addTask(token);
  const upload = await attach(token, task.id, 5);

  expect((await upload.put("123456")).status).toBe(403);
  expect((await upload.complete()).status).toBe(400);

  expect((await upload.put("12345")).status).toBe(200);
  expect((await upload.complete()).status).toBe(200);
  expect(await upload.download()).toBe("12345");
});
