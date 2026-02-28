import { Hono } from "hono";
import { deleteFile } from "../db.ts";

const del = new Hono();

del.get("/:id", (c) => {
  const id = c.req.param("id");
  const token = c.req.query("token");
  if (!token) {
    return c.json({ error: "Missing token" }, 401);
  }
  if (!deleteFile(id, token)) {
    return c.json({ error: "Invalid token or file not found" }, 403);
  }
  return c.json({ ok: true });
});

export default del;
