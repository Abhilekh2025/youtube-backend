import { Router } from "express";
import {
  uploadMedia,
  getMediaById,
  getUserMedia,
  updateMedia,
  applyFilterToMedia,
  toggleUserTag,
  deleteMedia,
  getMediaByLocation,
  uploadMultipleMedia,
} from "../controllers/media.controller.js";

import { verifyJWT } from "../middlewares/auth.middleware.js";
import { upload } from "../middlewares/multer.middleware.js";

const router = Router();

// Secured routes
//router.route("/upload").post(verifyJWT, upload.single("media"), uploadMedia);
router.route("/upload").post(verifyJWT, upload.array("media", 10), uploadMedia);
// router
//   .route("/upload/multiple")
//   .post(verifyJWT, upload.array("media", 10), uploadMedia);
router.route("/me").get(verifyJWT, getUserMedia);
router.route("/location").get(verifyJWT, getMediaByLocation);
router.route("/:mediaId").get(verifyJWT, getMediaById);
router.route("/:mediaId").patch(verifyJWT, updateMedia);
router.route("/:mediaId/filter").patch(verifyJWT, applyFilterToMedia);
router.route("/:mediaId/tag").patch(verifyJWT, toggleUserTag);
router.route("/:mediaId").delete(verifyJWT, deleteMedia);

export default router;
