import { Router } from "express";
import { getUserWorkload } from "../controllers/user.controller";

const router = Router();

router.get("/:id/workload", getUserWorkload);

export default router;
