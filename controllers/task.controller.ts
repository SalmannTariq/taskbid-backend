import type { Request, Response } from "express";
import type { PoolClient } from "pg";
import { pool } from "../db";
import type { BidIdRow, CapacityFitRow, PendingBid } from "../contract/bid.contract";
import type { StatusError, TaskLockRow, TaskRow } from "../contract/task.contract";
import { parseId, sendDbError, setActor, toNumber, withTransaction } from "../lib/http";

const patchTargets: Record<string, string[]> = {
  draft: ["open", "cancelled"],
  open: ["cancelled"],
  assigned: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
};

function mapTask(row: TaskRow) {
  return {
    id: toNumber(row.id),
    createdBy: toNumber(row.created_by),
    title: row.title,
    description: row.description,
    estimatedComplexity: row.estimated_complexity,
    status: row.status,
    deadline: row.deadline,
    createdAt: row.created_at,
  };
}

export async function listTasks(req: Request, res: Response) {
  console.log("\n End Point Hit : ", req.url)
  console.log("Body : ", req.body)
  try {
    const result = await pool.query<TaskRow>(
      `SELECT id, created_by, title, description, estimated_complexity, status, deadline, created_at
       FROM tasks
       ORDER BY created_at DESC`
    );
    return res.json(result.rows.map(mapTask));
  } catch (err) {
    return sendDbError(res, err);
  }
}

export async function createTask(req: Request, res: Response) {
  console.log("\n End Point Hit : ", req.url)
  console.log("Body : ", req.body)
  const { title, description, estimatedComplexity, deadline, createdBy } = req.body ?? {};
  const complexity = Number(estimatedComplexity);
  const creatorId = Number(createdBy);
  const deadlineDate = new Date(deadline);

  if (typeof title !== "string" || title.trim() === "") {
    return res.status(400).json({ error: "title is required" });
  }
  if (typeof description !== "string" || description.trim() === "") {
    return res.status(400).json({ error: "description is required" });
  }
  if (!Number.isInteger(complexity) || complexity < 1 || complexity > 5) {
    return res.status(400).json({ error: "estimatedComplexity must be an integer from 1 to 5" });
  }
  if (Number.isNaN(deadlineDate.getTime())) {
    return res.status(400).json({ error: "deadline must be a valid date" });
  }
  if (!Number.isInteger(creatorId) || creatorId <= 0) {
    return res.status(400).json({ error: "createdBy must be a user id" });
  }

  try {
    const result = await pool.query<TaskRow>(
      `INSERT INTO tasks (created_by, title, description, estimated_complexity, deadline)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, created_by, title, description, estimated_complexity, status, deadline, created_at`,
      [creatorId, title.trim(), description.trim(), complexity, deadlineDate.toISOString()]
    );
    return res.status(201).json(mapTask(result.rows[0]));
  } catch (err) {
    return sendDbError(res, err);
  }
}

export async function updateTaskStatus(req: Request, res: Response) {
  console.log("\n End Point Hit : ", req.url)
  console.log("Body : ", req.body)
  const taskId = parseId(req.params.id);
  const nextStatus = req.body?.status;
  const changedBy = Number(req.body?.changedBy);

  if (taskId === null) {
    return res.status(400).json({ error: "task id must be a positive integer" });
  }
  if (typeof nextStatus !== "string") {
    return res.status(400).json({ error: "status is required" });
  }
  if (!Number.isInteger(changedBy) || changedBy <= 0) {
    return res.status(400).json({ error: "changedBy must be a user id" });
  }
  if (nextStatus === "assigned") {
    return res.status(400).json({ error: "Use POST /tasks/:id/assign to assign a task" });
  }

  try {
    const task = await withTransaction(async (client) => {
      const current = await client.query<TaskRow>(
        `SELECT id, created_by, title, description, estimated_complexity, status, deadline, created_at
         FROM tasks
         WHERE id = $1
         FOR UPDATE`,
        [taskId]
      );
      if (current.rowCount === 0) {
        return null;
      }

      const allowed = patchTargets[current.rows[0].status] ?? [];
      if (!allowed.includes(nextStatus)) {
        const message =
          allowed.length === 0
            ? `task is ${current.rows[0].status} and cannot change status`
            : `task can move from ${current.rows[0].status} to ${allowed.join(" or ")}`;
        const error = new Error(message) as StatusError;
        error.statusCode = 400;
        throw error;
      }

      await setActor(client, changedBy);
      const updated = await client.query<TaskRow>(
        `UPDATE tasks
         SET status = $1
         WHERE id = $2
         RETURNING id, created_by, title, description, estimated_complexity, status, deadline, created_at`,
        [nextStatus, taskId]
      );
      return updated.rows[0];
    });

    if (!task) {
      return res.status(404).json({ error: "task not found" });
    }
    return res.json(mapTask(task));
  } catch (err) {
    const statusCode = (err as StatusError).statusCode;
    if (statusCode === 400) {
      return res.status(400).json({ error: (err as Error).message });
    }
    return sendDbError(res, err);
  }
}

export async function assignTask(req: Request, res: Response) {
  console.log("\n End Point Hit : ", req.url)
  console.log("Body : ", req.body)
  const taskId = parseId(req.params.id);
  const changedBy = Number(req.body?.changedBy);

  if (taskId === null) {
    return res.status(400).json({ error: "task id must be a positive integer" });
  }
  if (!Number.isInteger(changedBy) || changedBy <= 0) {
    return res.status(400).json({ error: "changedBy must be a user id" });
  }

  try {
    const result = await withTransaction((client) => assignLowestValidBidder(client, taskId, changedBy));
    return res.status(result.statusCode).json(result.body);
  } catch (err) {
    return sendDbError(res, err);
  }
}

async function assignLowestValidBidder(client: PoolClient, taskId: number, changedBy: number) {
  const taskResult = await client.query<TaskLockRow>(
    "SELECT id, status FROM tasks WHERE id = $1 FOR UPDATE",
    [taskId]
  );
  if (taskResult.rowCount === 0) {
    return { statusCode: 404, body: { error: "task not found" } };
  }
  if (taskResult.rows[0].status !== "open") {
    return { statusCode: 400, body: { error: "only an open task can be assigned" } };
  }

  const bids = await client.query<PendingBid>(
    `SELECT id, user_id, hours_offered
     FROM bids
     WHERE task_id = $1 AND status = 'pending'
     ORDER BY hours_offered ASC, created_at ASC
     FOR UPDATE`,
    [taskId]
  );
  if (bids.rowCount === 0) {
    return { statusCode: 409, body: { error: "task has no pending bids" } };
  }

  const userIds = [...new Set(bids.rows.map((bid) => bid.user_id))].sort((a, b) => Number(a) - Number(b));
  await client.query("SELECT id FROM users WHERE id = ANY($1::bigint[]) ORDER BY id FOR UPDATE", [userIds]);

  let winner: PendingBid | null = null;
  for (const bid of bids.rows) {
    const capacity = await client.query<CapacityFitRow>(
      `SELECT
         (
           COALESCE(SUM(b.hours_offered) FILTER (
             WHERE b.status = 'accepted' AND t.status = 'assigned'
           ), 0) + $2::numeric
         ) <= u.max_capacity_hours AS fits
       FROM users u
       LEFT JOIN bids b ON b.user_id = u.id
       LEFT JOIN tasks t ON t.id = b.task_id
       WHERE u.id = $1
       GROUP BY u.id, u.max_capacity_hours`,
      [bid.user_id, bid.hours_offered]
    );
    if (capacity.rows[0]?.fits) {
      winner = bid;
      break;
    }
  }

  if (!winner) {
    return { statusCode: 409, body: { error: "no bidder has enough remaining capacity" } };
  }

  await setActor(client, changedBy);
  await client.query("UPDATE bids SET status = 'accepted' WHERE id = $1", [winner.id]);
  const rejected = await client.query<BidIdRow>(
    `UPDATE bids
     SET status = 'rejected'
     WHERE task_id = $1 AND status = 'pending' AND id <> $2
     RETURNING id`,
    [taskId, winner.id]
  );
  await client.query("UPDATE tasks SET status = 'assigned' WHERE id = $1", [taskId]);

  return {
    statusCode: 200,
    body: {
      taskId,
      status: "assigned",
      assignedBid: {
        id: toNumber(winner.id),
        userId: toNumber(winner.user_id),
        hoursOffered: toNumber(winner.hours_offered),
      },
      rejectedBidIds: rejected.rows.map((row) => toNumber(row.id)),
    },
  };
}
