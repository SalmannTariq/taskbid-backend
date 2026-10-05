import "dotenv/config";
import { Pool } from "pg";

export const pool = new Pool({
  connectionString: process.env.DB_URL,
  ssl: { rejectUnauthorized: false },
  max: 10,
});