import { Router } from "express";
import { getUserWorkload, listUsers } from "../controllers/user.controller";

const router = Router();

router.get("/", listUsers);
router.get("/:id/workload", getUserWorkload);

export default router;
