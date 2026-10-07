import type { Request, Response } from "express";
import type { BidRow } from "../contract/bid.contract";
import { pool } from "../db";
import { parseId, sendDbError, toNumber, withTransaction } from "../lib/http";
import { publishChange } from "../socket";

function mapBid(row: BidRow) {
  return {
    id: toNumber(row.id),
    taskId: toNumber(row.task_id),
    userId: toNumber(row.user_id),
    hoursOffered: toNumber(row.hours_offered),
    createdAt: row.created_at,
    userName: row.user_name ?? "",
  };
}

export async function placeBid(req: Request, res: Response) {
  const taskId = parseId(req.params.id);
  const userId = Number(req.body?.userId);
  const hoursOffered = Number(req.body?.hoursOffered);

  if (taskId === null) {
    return res.status(400).json({ error: "task id must be a positive integer" });
  }
  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({ error: "userId must be a user id" });
  }
  if (!Number.isFinite(hoursOffered) || hoursOffered <= 0) {
    return res.status(400).json({ error: "hoursOffered must be greater than 0" });
  }

  try {
    const bid = await withTransaction(async (client) => {
      const task = await client.query("SELECT id FROM tasks WHERE id = $1", [taskId]);
      if (task.rowCount === 0) {
        return { statusCode: 404, body: { error: "task not found" } };
      }

      const result = await client.query<BidRow>(
        `INSERT INTO bids (task_id, user_id, hours_offered)
         VALUES ($1, $2, $3)
         RETURNING id, task_id, user_id, hours_offered, created_at`,
        [taskId, userId, hoursOffered]
      );
      const placed = result.rows[0];
      const name = await client.query<{ name: string }>("SELECT name FROM users WHERE id = $1", [userId]);
      placed.user_name = name.rows[0]?.name ?? "";
      return { statusCode: 201, body: mapBid(placed) };
    });
    if (bid.statusCode === 201) publishChange(taskId);
    return res.status(bid.statusCode).json(bid.body);
  } catch (err) {
    return sendDbError(res, err);
  }
}

export async function listBids(req: Request, res: Response) {
  const taskId = parseId(req.params.id);
  if (taskId === null) {
    return res.status(400).json({ error: "task id must be a positive integer" });
  }

  try {
    const task = await pool.query("SELECT id FROM tasks WHERE id = $1", [taskId]);
    if (task.rowCount === 0) {
      return res.status(404).json({ error: "task not found" });
    }

    const result = await pool.query<BidRow>(
       `SELECT b.id, b.task_id, b.user_id, b.hours_offered, b.created_at, u.name AS user_name
       FROM bids b
       JOIN users u ON u.id = b.user_id
       WHERE b.task_id = $1
       ORDER BY b.hours_offered ASC, b.created_at ASC`,
      [taskId]
    );

    return res.json(result.rows.map(mapBid));
  } catch (err) {
    return sendDbError(res, err);
  }
}
