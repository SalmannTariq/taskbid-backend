import type { PoolClient } from "pg";
import type { BidOffer, CapacityFitRow } from "../contract/bid.contract";
import { pool } from "../db";
import { setActor, toNumber, withTransaction } from "./http";
import { publishChange } from "../socket";

let closing = false;

async function lowestBidder(client: PoolClient, taskId: number) {
  const bids = await client.query<BidOffer>(
    `SELECT id, user_id, hours_offered
     FROM bids
     WHERE task_id = $1
     ORDER BY hours_offered ASC, created_at ASC
     FOR UPDATE`,
    [taskId]
  );
  if (bids.rowCount === 0) return null;

  const userIds = [...new Set(bids.rows.map((bid) => bid.user_id))].sort((a, b) => Number(a) - Number(b));
  await client.query("SELECT id FROM users WHERE id = ANY($1::bigint[]) ORDER BY id FOR UPDATE", [userIds]);

  for (const bid of bids.rows) {
    const capacity = await client.query<CapacityFitRow>(
      `SELECT
         (
           COALESCE(SUM(b.hours_offered) FILTER (
             WHERE t.assigned_to = b.user_id
               AND t.status IN ('assigned', 'in_progress', 'review')
           ), 0) + $2::numeric
         ) <= u.max_capacity_hours AS fits
       FROM users u
       LEFT JOIN bids b ON b.user_id = u.id
       LEFT JOIN tasks t ON t.id = b.task_id
       WHERE u.id = $1
       GROUP BY u.id, u.max_capacity_hours`,
      [bid.user_id, bid.hours_offered]
    );
    if (capacity.rows[0]?.fits) return bid;
  }
  return null;
}

export async function closeTaskIfDeadlinePassed(client: PoolClient, taskId: number) {
  const task = await client.query<{ id: string; created_by: string }>(
    `SELECT id, created_by
     FROM tasks
     WHERE id = $1 AND status = 'open' AND deadline <= NOW()
     FOR UPDATE`,
    [taskId]
  );
  if (task.rowCount === 0) return false;

  const creatorId = toNumber(task.rows[0].created_by);
  await setActor(client, creatorId);
  await client.query("UPDATE tasks SET status = 'bidding_closed' WHERE id = $1", [taskId]);

  const winner = await lowestBidder(client, taskId);
  if (winner) {
    await client.query(
      "UPDATE tasks SET status = 'assigned', assigned_to = $2 WHERE id = $1",
      [taskId, winner.user_id]
    );
  }
  return true;
}

export async function closeExpiredBidding() {
  if (closing) return;
  closing = true;
  try {
    const due = await pool.query<{ id: string }>(
      `SELECT id
       FROM tasks
       WHERE status = 'open' AND deadline <= NOW()
       ORDER BY id`
    );
    for (const row of due.rows) {
      const taskId = toNumber(row.id);
      const changed = await withTransaction((client) => closeTaskIfDeadlinePassed(client, taskId));
      if (changed) publishChange(taskId);
    }
  } catch (err) {
    console.error(err);
  } finally {
    closing = false;
  }
}
