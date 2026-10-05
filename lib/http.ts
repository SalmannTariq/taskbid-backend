import type { Response } from "express";
import type { PoolClient } from "pg";
import type { DbErrorShape } from "../contract/db.contract";
import { pool } from "../db";

export function parseId(value: string | string[] | undefined): number | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw || !/^\d+$/.test(raw)) {
    return null;
  }
  return Number(raw);
}

export function toNumber(value: unknown): number {
  return Number(value);
}

export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function setActor(client: PoolClient, userId: number) {
  await client.query("SELECT set_config('app.user_id', $1, true)", [String(userId)]);
}

export function sendDbError(res: Response, err: unknown) {
  const pgErr = err as DbErrorShape;
  const message = pgErr.message ?? "database error";

  if (
    message.includes("invalid task status transition") ||
    message.includes("invalid bid status transition")
  ) {
    return res.status(400).json({ error: message });
  }

  if (message.includes("exceed the user max capacity")) {
    return res.status(409).json({ error: message });
  }

  if (pgErr.code === "23505") {
    return res.status(409).json({ error: "This user already placed a bid on this task" });
  }

  if (pgErr.code === "23503") {
    return res.status(400).json({ error: "Related user or task was not found" });
  }

  if (pgErr.code === "23514") {
    return res.status(400).json({ error: message });
  }

  console.error(err);
  return res.status(500).json({ error: "Internal server error" });
}
