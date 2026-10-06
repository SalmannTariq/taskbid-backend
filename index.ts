import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { pool } from "./db";
import indexRoutes from "./routes/index.routes";

const app = express();
const allowedOrigins = (process.env.CORS_WHITELIST ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter((origin) => origin.length > 0);

app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
  })
);
app.use(express.json());
app.use(cookieParser());

const PORT = process.env.PORT || 3000;

app.use(indexRoutes);


app.get("/health", async (_req, res) => {
    try {
      const result = await pool.query("SELECT NOW() AS now");
      res.json({ status: "ok", dbTime: result.rows[0].now });
    } catch (err) {
      res.status(500).json({ status: "error", message: (err as Error).message });
    }
  });

app.listen(PORT, () => {
    console.log("Server is running on port 3000");
});