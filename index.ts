import express from "express";
import cors from "cors";
import { pool } from "./db";
import indexRoutes from "./routes/index.routes";

const app = express();

app.use(cors());
app.use(express.json());

const PORT = 3000;

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