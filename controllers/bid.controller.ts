import type { Request, Response } from "express";
import type { BidRow, TaskStatusRow } from "../contract/bid.contract";
import { pool } from "../db";
import { parseId, sendDbError, toNumber } from "../lib/http";

function mapBid(row: BidRow) {
  return {
    id: toNumber(row.id),
    taskId: toNumber(row.task_id),
    userId: toNumber(row.user_id),
    hoursOffered: toNumber(row.hours_offered),
    status: row.status,
    createdAt: row.created_at,
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
    const task = await pool.query<TaskStatusRow>("SELECT status FROM tasks WHERE id = $1", [taskId]);
    if (task.rowCount === 0) {
      return res.status(404).json({ error: "task not found" });
    }
    if (task.rows[0].status !== "open") {
      return res.status(400).json({ error: "bids can only be placed on an open task" });
    }

    const result = await pool.query<BidRow>(
      `INSERT INTO bids (task_id, user_id, hours_offered)
       VALUES ($1, $2, $3)
       RETURNING id, task_id, user_id, hours_offered, status, created_at`,
      [taskId, userId, hoursOffered]
    );
    return res.status(201).json(mapBid(result.rows[0]));
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
      `SELECT id, task_id, user_id, hours_offered, status, created_at
       FROM bids
       WHERE task_id = $1
       ORDER BY hours_offered ASC, created_at ASC`,
      [taskId]
    );

    return res.json(result.rows.map(mapBid));
  } catch (err) {
    return sendDbError(res, err);
  }
}
