import { Router } from "express";
import {
  createComment,
  getPostComments,
  getCommentReplies,
  updateComment,
  deleteComment,
  likeComment,
  unlikeComment,
  getCommentLikes,
  getUserComments,
} from "../controllers/comment.controller.js";
import { verifyJWT } from "../middlewares/auth.middleware.js";

const router = Router();

// Public routes (no authentication required)
router.get("/post/:postId", getPostComments);
router.get("/:commentId/replies", getCommentReplies);
router.get("/:commentId/likes", getCommentLikes);
router.get("/user/:userId", getUserComments);
// Protected routes (authentication required)
router.post("/comment", verifyJWT, createComment);
router.put("/:commentId", verifyJWT, updateComment);
router.delete("/:commentId", verifyJWT, deleteComment);
router.post("/:commentId/like", verifyJWT, likeComment);
router.delete("/:commentId/unlike", verifyJWT, unlikeComment);

export default router;
