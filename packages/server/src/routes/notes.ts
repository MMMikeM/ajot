import { createRoute, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import noteRepo, {
  noteInsertSchema,
  noteUpdateSchema,
  noteSelectSchema,
  noteResponseSchema,
} from "../db/note.repo";
import { authed } from "../middleware";
import { broadcast } from "../broadcast";
import { jsonBody, jsonContent, withAuth } from "./crud";
import { markTaskEdited } from "./task-users";
import taskRepo from "../db/task.repo";
import { canSeeTask } from "../task-access";

// A deleted task still takes notes: they're hidden with it and come back when it's restored
const assertCanSeeTask = async (taskId: string, userId: string) => {
  const task = await taskRepo.findByIdWithAccess(taskId, userId, { deleted: true });
  if (!canSeeTask(task, userId)) throw new HTTPException(403, { message: "Not authorized" });
};

export const noteRoutes = authed()
  .openapi(
    createRoute({
      method: "get",
      path: "/",
      responses: withAuth({ 200: jsonContent(z.array(noteResponseSchema)) }),
    }),
    async (c) => c.json(await noteRepo.list(c.get("userId")), 200),
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/",
      request: jsonBody(noteInsertSchema),
      responses: withAuth({ 200: jsonContent(noteResponseSchema) }),
    }),
    async (c) => {
      const data = c.req.valid("json");
      const userId = c.get("userId");
      // A retry after a lost response gets its note back, even if the task was unshared meanwhile
      if (!(await noteRepo.findOwn(data.id, userId))) await assertCanSeeTask(data.taskId, userId);
      const result = await noteRepo.insert({ ...data, userId });
      broadcast(c, "notes", "insert", result, [userId]);
      if (result.taskId) await markTaskEdited(c, result.taskId, userId, result.updatedAt);
      return c.json(result, 200);
    },
  )
  .openapi(
    createRoute({
      method: "put",
      path: "/",
      request: jsonBody(noteUpdateSchema),
      responses: withAuth({ 200: jsonContent(noteResponseSchema) }),
    }),
    async (c) => {
      const { id, updatedAt, ...fields } = c.req.valid("json");
      const userId = c.get("userId");
      // Only a move is checked: a note stays its author's after they lose the task
      if (fields.taskId) {
        const note = await noteRepo.findOwn(id, userId);
        if (note && note.taskId !== fields.taskId) await assertCanSeeTask(fields.taskId, userId);
      }
      const result = await noteRepo.update(id, userId, updatedAt, fields);
      broadcast(c, "notes", "update", result, [userId]);
      if (result.taskId) await markTaskEdited(c, result.taskId, userId, updatedAt);
      return c.json(result, 200);
    },
  )
  .openapi(
    createRoute({
      method: "delete",
      path: "/",
      request: jsonBody(noteSelectSchema),
      responses: withAuth({ 200: jsonContent(noteResponseSchema) }),
    }),
    async (c) => {
      const userId = c.get("userId");
      const result = await noteRepo.remove(c.req.valid("json").id, userId);
      broadcast(c, "notes", "delete", { id: result.id }, [userId]);
      return c.json(result, 200);
    },
  );
