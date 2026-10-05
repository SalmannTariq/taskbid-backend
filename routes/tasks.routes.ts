import { Router } from "express";
import { assignTask, createTask, updateTaskStatus } from "../controllers/task.controller";
import bidsRouter from "./bids.routes";

const router = Router();

router.post("/", createTask);
router.patch("/:id/status", updateTaskStatus);
router.post("/:id/assign", assignTask);
router.use("/:id/bids", bidsRouter);

export default router;
