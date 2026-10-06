import { Router } from "express";
import { Login, Logout, Me, Register } from "../controllers/auth.controller";
import { requireAuth } from "../middlewares/auth.middleware";

const router = Router();

router.post("/register", Register);
router.post("/login", Login);
router.post("/logout", Logout);
router.get("/me", requireAuth, Me);


export default router;