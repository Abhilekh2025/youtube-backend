import { Router } from "express";
import { verifyJWT } from "../middlewares/auth.middleware.js";

import {
  getUserSettings,
  updateUserSettings,
} from "../controllers/userSettings.controller.js";

const router = Router();

router.route("/settings").post(verifyJWT, getUserSettings);
router.route("/update-settings").patch(verifyJWT, updateUserSettings);

export default router;
