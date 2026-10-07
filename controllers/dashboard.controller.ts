import type { Request, Response } from "express";
import { pool } from "../db";
import { sendDbError, toNumber } from "../lib/http";

const taskStatuses = ["draft", "open", "bidding_closed", "assigned", "in_progress", "review", "done"] as const;

type AverageBidRow = { complexity: number; average_bid: string | number | null };
type TopUserRow = { id: string | number; name: string; completed_tasks: string | number };
type ZeroBidRow = { id: string | number; title: string; status: string; deadline: string };

type DashboardRow = {
  tasks_by_status: Record<string, number> | null;
  average_bid_by_complexity: AverageBidRow[] | null;
  top_users: TopUserRow[] | null;
  tasks_with_zero_bids: ZeroBidRow[] | null;
};

export async function getDashboardStats(_req: Request, res: Response) {
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
             'id', id,
             'name', name,
             'completed_tasks', completed_tasks
           ) ORDER BY completed_tasks DESC, name)
           FROM (
             SELECT u.id, u.name, COUNT(*)::int AS completed_tasks
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
             'id', id,
             'title', title,
             'status', status,
             'deadline', deadline
           ) ORDER BY deadline)
           FROM (
             SELECT t.id, t.title, t.status, t.deadline
             FROM tasks t
             WHERE t.deadline < NOW()
               AND NOT EXISTS (SELECT 1 FROM bids b WHERE b.task_id = t.id)
             ORDER BY t.deadline
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
        id: toNumber(user.id),
        name: user.name,
        completedTasks: toNumber(user.completed_tasks),
      })),
      tasksWithZeroBids: (row.tasks_with_zero_bids ?? []).map((task) => ({
        id: toNumber(task.id),
        title: task.title,
        status: task.status,
        deadline: task.deadline,
      })),
    });
  } catch (err) {
    return sendDbError(res, err);
  }
}
