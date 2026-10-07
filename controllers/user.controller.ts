import { pool } from "../db";
import { parseId, sendDbError, toNumber } from "../lib/http";
import { Request, Response } from "express";


export async function listUsers(_req: Request, res: Response) {
  try {
    const result = await pool.query<{ id: string; name: string; email: string }>(
      "SELECT id, name, email FROM users ORDER BY name"
    );
    return res.json(
      result.rows.map((row) => ({
        id: toNumber(row.id),
        name: row.name,
        email: row.email,
      }))
    );
  } catch (err) {
    return sendDbError(res, err);
  }
}

export async function getUserWorkload(req: Request, res: Response) {
    console.log("\n End Point Hit : ",req.url)
    const userId = parseId(req.params.id);
    if (userId === null) {
      return res.status(400).json({ error: "user id must be a positive integer" });
    }

    try {
      const result = await pool.query(
        `SELECT user_id, current_workload, max_capacity_hours
         FROM user_workloads
         WHERE user_id = $1`,
        [userId]
      );
      console.log("User Workload Result : ", result.rows);
      if (result.rowCount === 0) {
        return res.status(404).json({ error: "user not found" });
      }

      const row = result.rows[0];
      const currentWorkload = toNumber(row.current_workload);
      const maxCapacityHours = toNumber(row.max_capacity_hours);

      return res.json({
        userId: toNumber(row.user_id),
        currentWorkload,
        maxCapacityHours,
        remainingCapacity: maxCapacityHours - currentWorkload,
      });
    } catch (err) {
      return sendDbError(res, err);
    }
}