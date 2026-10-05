import { Router } from "express";
import { listBids, placeBid } from "../controllers/bid.controller";

const router = Router({ mergeParams: true });

router.post("/", placeBid);
router.get("/", listBids);

export default router;
