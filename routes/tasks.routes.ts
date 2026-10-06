import { Router } from "express";
import { assignTask, createTask, listTasks, updateTaskStatus } from "../controllers/task.controller";
import bidsRouter from "./bids.routes";

const router = Router();

router.get("/", listTasks);
router.post("/", createTask);
router.patch("/:id/status", updateTaskStatus);
router.post("/:id/assign", assignTask);
router.use("/:id/bids", bidsRouter);

export default router;
