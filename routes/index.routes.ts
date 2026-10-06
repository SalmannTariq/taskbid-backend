import { Router } from "express";
import authRouter from "./auth.routes";
import tasksRouter from "./tasks.routes";
import usersRouter from "./users.routes";
import dashboardRouter from "./dashboard.routes";

const router = Router();

router.use("/auth", authRouter);
router.use("/users", usersRouter);
router.use("/tasks", tasksRouter);
router.use("/dashboard", dashboardRouter);

export default router;
