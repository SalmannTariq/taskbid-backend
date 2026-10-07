import type { Request, Response } from "express";
import type { DashboardRow } from "../contract/dashboard.contract";
import { pool } from "../db";
import { sendDbError, toNumber } from "../lib/http";

const taskStatuses = ["draft", "open", "bidding_closed", "assigned", "in_progress", "review", "done"] ;

export async function getDashboardStats(req: Request, res: Response) {
  console.log("\n End Point Hit : ",req.url);
  try {
    const result = await pool.query<DashboardRow>(
      `SELECT
         COALESCE((
           SELECT jsonb_object_agg(status, count)
           FROM (
             SELECT status, COUNT(*)::int AS count
             FROM tasks
             GROUP BY status
           ) AS counts
         ), '{}'::jsonb) AS tasks_by_status,
         COALESCE((
           SELECT jsonb_agg(jsonb_build_object(
             'complexity', complexity,
             'average_bid', average_bid
           ) ORDER BY complexity)
           FROM (
             SELECT
               levels.complexity,
               ROUND(AVG(b.hours_offered), 2) AS average_bid
             FROM generate_series(1, 5) AS levels(complexity)
             LEFT JOIN tasks t ON t.estimated_complexity = levels.complexity
             LEFT JOIN bids b ON b.task_id = t.id
             GROUP BY levels.complexity
           ) AS averages
         ), '[]'::jsonb) AS average_bid_by_complexity,
         COALESCE((
           SELECT jsonb_agg(jsonb_build_object(
             'name', name,
             'completed_tasks', completed_tasks
           ) ORDER BY completed_tasks DESC, name)
           FROM (
             SELECT u.name, COUNT(*)::int AS completed_tasks
             FROM tasks t
             JOIN users u ON u.id = t.assigned_to
             WHERE t.status = 'done'
             GROUP BY u.id, u.name
             ORDER BY completed_tasks DESC, u.name
             LIMIT 3
           ) AS leaders
         ), '[]'::jsonb) AS top_users,
         COALESCE((
           SELECT jsonb_agg(jsonb_build_object(
             'complexity', complexity,
             'count', count
           ) ORDER BY complexity)
           FROM (
             SELECT
               levels.complexity,
               COUNT(t.id)::int AS count
             FROM generate_series(1, 5) AS levels(complexity)
             LEFT JOIN tasks t
               ON t.estimated_complexity = levels.complexity
              AND t.deadline < NOW()
              AND NOT EXISTS (SELECT 1 FROM bids b WHERE b.task_id = t.id)
             GROUP BY levels.complexity
           ) AS missed
         ), '[]'::jsonb) AS tasks_with_zero_bids`
    );

    const row = result.rows[0];
    const counts = row.tasks_by_status ?? {};

    return res.json({
      tasksByStatus: taskStatuses.map((status) => ({
        status,
        count: toNumber(counts[status] ?? 0),
      })),
      averageBidByComplexity: (row.average_bid_by_complexity ?? []).map((item) => ({
        complexity: toNumber(item.complexity),
        averageBid: item.average_bid == null ? null : toNumber(item.average_bid),
      })),
      topUsers: (row.top_users ?? []).map((user) => ({
        name: user.name,
        completedTasks: toNumber(user.completed_tasks),
      })),
      tasksWithZeroBids: (row.tasks_with_zero_bids ?? []).map((item) => ({
        complexity: toNumber(item.complexity),
        count: toNumber(item.count),
      })),
    });
  } catch (err) {
    return sendDbError(res, err);
  }
}
