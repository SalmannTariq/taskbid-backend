import type { Request, Response } from "express";
import type { CapacityTotalsRow, StatusCountRow } from "../contract/dashboard.contract";
import { pool } from "../db";
import { sendDbError, toNumber } from "../lib/http";

const taskStatuses = ["draft", "open", "assigned", "completed", "cancelled"] as const;
const bidStatuses = ["pending", "accepted", "rejected", "withdrawn"] as const;

export async function getDashboardStats(_req: Request, res: Response) {
  try {
    const [tasks, bids, capacity] = await Promise.all([
      pool.query<StatusCountRow>(
        "SELECT status, COUNT(*)::int AS count FROM tasks GROUP BY status"
      ),
      pool.query<StatusCountRow>(
        "SELECT status, COUNT(*)::int AS count FROM bids GROUP BY status"
      ),
      pool.query<CapacityTotalsRow>(
        `SELECT
           COUNT(*)::int AS total_users,
           COALESCE(SUM(max_capacity_hours), 0) AS total_capacity,
           COALESCE(SUM(current_workload), 0) AS total_workload
         FROM user_workloads`
      ),
    ]);

    const tasksByStatus = Object.fromEntries(taskStatuses.map((status) => [status, 0]));
    for (const row of tasks.rows) {
      tasksByStatus[row.status] = toNumber(row.count);
    }

    const bidsByStatus = Object.fromEntries(bidStatuses.map((status) => [status, 0]));
    for (const row of bids.rows) {
      bidsByStatus[row.status] = toNumber(row.count);
    }

    const totals = capacity.rows[0];
    const totalCapacityHours = toNumber(totals.total_capacity);
    const totalWorkloadHours = toNumber(totals.total_workload);

    return res.json({
      tasks: {
        ...tasksByStatus,
        total: Object.values(tasksByStatus).reduce((sum, count) => sum + count, 0),
      },
      bids: {
        ...bidsByStatus,
        total: Object.values(bidsByStatus).reduce((sum, count) => sum + count, 0),
      },
      users: {
        total: toNumber(totals.total_users),
        totalCapacityHours,
        totalWorkloadHours,
        totalRemainingCapacityHours: totalCapacityHours - totalWorkloadHours,
      },
    });
  } catch (err) {
    return sendDbError(res, err);
  }
}
