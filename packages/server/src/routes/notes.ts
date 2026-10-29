import { z } from "@hono/zod-openapi";
import * as noteRepo from "../db/note.repo";
import { authed, authedRoute } from "../middleware";
import { broadcast } from "../broadcast";
import { jsonBody } from "./crud";
import { markTaskEdited, requireTask } from "./task-users";
import * as taskRepo from "../db/task.repo";
import { NotFoundError } from "../db/errors";

export const noteRoutes = authed()
  .openapi(
    authedRoute({
      method: "get",
      path: "/",
      responses: { 200: z.array(noteRepo.responseSchema) },
    }),
    async (c) => c.json(await noteRepo.list(c.get("userId")), 200),
  )
  .openapi(
    authedRoute({
      method: "post",
      path: "/",
      request: jsonBody(noteRepo.insertSchema),
      responses: { 200: noteRepo.responseSchema, 404: true, 409: true },
    }),
    async (c) => {
      const data = c.req.valid("json");
      const userId = c.get("userId");
      // A deleted task still takes notes: they're hidden with it and come back when it's restored
      const access = await taskRepo.accessTo([data.taskId]);
      // A retry after a lost response gets its note back, even if the task was unshared meanwhile
      if (!access.some((a) => a.userId === userId) && !(await noteRepo.findOwn(data.id, userId)))
        throw new NotFoundError("task", data.taskId);
      const result = await noteRepo.insert({ ...data, userId });
      broadcast(c, "notes", "insert", result, [userId]);
      await markTaskEdited(c, data.taskId, userId, result.updatedAt, access);
      return c.json(result, 200);
    },
  )
  .openapi(
    authedRoute({
      method: "put",
      path: "/",
      request: jsonBody(noteRepo.updateSchema),
      responses: { 200: noteRepo.responseSchema, 404: true, 409: true },
    }),
    async (c) => {
      const { id, updatedAt, ...fields } = c.req.valid("json");
      const userId = c.get("userId");
      // Only a move is checked: a note stays its author's after they lose the task
      if (fields.taskId) {
        const note = await noteRepo.findOwn(id, userId);
        if (note && note.taskId !== fields.taskId)
          await requireTask(fields.taskId, userId, "see", { deleted: true });
      }
      const result = await noteRepo.update(id, userId, updatedAt, fields);
      broadcast(c, "notes", "update", result, [userId]);
      await markTaskEdited(c, result.taskId, userId, updatedAt);
      return c.json(result, 200);
    },
  )
  .openapi(
    authedRoute({
      method: "delete",
      path: "/",
      request: jsonBody(noteRepo.idSchema),
      responses: { 200: noteRepo.responseSchema, 404: true },
    }),
    async (c) => {
      const userId = c.get("userId");
      const result = await noteRepo.remove(c.req.valid("json").id, userId);
      broadcast(c, "notes", "delete", { id: result.id }, [userId]);
      return c.json(result, 200);
    },
  );
