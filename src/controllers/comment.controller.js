import { ApiError } from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { Post } from "../models/post.model.js";
import mongoose from "mongoose";
import { ApiResponse } from "../utils/ApiResponse.js";
import { User } from "../models/user.model.js";
import { Comment } from "../models/comment.model.js";

const createComment = asyncHandler(async (req, res) => {
  const { text, postId, parentId } = req.body;
  const userId = req.user?._id;

  console.log("userId: ", userId);

  if (!text?.trim()) {
    throw new ApiError(400, "Comment text is required");
  }

  if (!postId) {
    throw new ApiError(400, "Post ID is required");
  }

  //Check if post exists
  const post = await Post.findById(postId);
  if (!post) {
    throw new ApiError(404, "Post not found");
  }

  console.log("parentId:", parentId, "type:", typeof parentId);

  // If parentId provided, check if parent comment exists
  if (parentId) {
    const parentComment = await Comment.findById(parentId);
    console.log("parentComment :", parentComment);
    if (!parentComment) {
      throw new ApiError(404, "Parent comment not found");
    }

    console.log("parentComment.post.toString()", parentComment.post.toString());
    // Check if parent comment belongs to the same post
    if (parentComment.post.toString() !== postId) {
      throw new ApiError(400, "Parent comment does not belong to this post");
    }
  }

  const newComment = await Comment.create({
    text,
    user: userId,
    post: postId,
    parent: parentId,
  });

  console.log("newComment", newComment);

  // Populate user data before sending response
  // const populatedComment = await Comment.findById(newComment._id)
  //   .populate("user", "username profileImage")
  //   .populate({
  //     path: "parent",
  //     select: "text user",
  //     populate: {
  //       path: "user",
  //       select: "username profileImage",
  //     },
  //   });

  // let populatedComment;
  // if (parentId) {
  //   console.log("parentId :", parentId);
  //   console.log(
  //     "Comment.findById(newComment._id",
  //     Comment.findById(newComment._id)
  //   );
  //   populatedComment = await Comment.findById(newComment._id)
  //     .populate("user", "avatar")
  //     .populate({
  //       path: "parent",
  //       select: "text user",
  //       populate: {
  //         path: "user",
  //         select: "avatar",
  //       },
  //     });
  // } else {
  //   console.log("Else");
  //   populatedComment = await Comment.findById(newComment._id).populate(
  //     "user",
  //     "avatar"
  //   );
  // }

  // console.log("populatedComment :", populatedComment);
  // return res
  //   .status(201)
  //   .json(
  //     new ApiResponse(201, populatedComment, "Comment created successfully")
  //   );

  try {
    const populatedComment = await Comment.findById(newComment._id)
      .populate("user", "username profileImage")
      .populate({
        path: "parent",
        select: "text user",
        populate: {
          path: "user",
          select: "username profileImage",
        },
      });

    return res
      .status(201)
      .json(
        new ApiResponse(201, populatedComment, "Comment created successfully")
      );
  } catch (error) {
    console.error("Error in populate:", error);
    // Fallback to a simpler populate
    const basicComment = await Comment.findById(newComment._id).populate(
      "user",
      "username profileImage"
    );

    return res
      .status(201)
      .json(new ApiResponse(201, basicComment, "Comment created successfully"));
  }
});

/**
 * Get all comments for a post
 * @route GET /api/comments/post/:postId
 * @access Public
 */

const getPostComments = asyncHandler(async (req, res) => {
  const { postId } = req.params;
  const { page = 1, limit = 10 } = req.query;

  if (!postId) {
    throw new ApiError(400, "Post ID is required");
  }

  //pagination
  const pageNum = parseInt(page);
  const limitNum = parseInt(limit);
  const skip = (pageNum - 1) * limitNum;

  //verify post exists

  const postExists = await Post.exists({ _id: postId }); //mongoose method Post.exists() returns _id
  if (!postExists) {
    throw new ApiError(404, "Post not found");
  }

  // Get only top-level comments (with no parent)
  const comments = await Comment.find({
    post: postId,
    parent: null,
    isDeleted: false,
  })
    .populate("user", "username profileImage")
    .populate({
      path: "repliesCount",
    })
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limitNum);

  const totalComments = await Comment.countDocuments({
    post: postId,
    parent: null,
    isDeleted: false,
  });

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        comments,
        currentPage: pageNum,
        totalPages: Math.ceil(totalComments / limitNum),
        totalComments,
      },
      "Comments fetched successfully"
    )
  );
});

/**
 * Get replies for a comment
 * @route GET /api/comments/:commentId/replies
 * @access Public
 */

const getCommentReplies = asyncHandler(async (req, res) => {
  const { commentId } = req.params;
  const { page = 1, limit = 10 } = req.query;

  if (!commentId) {
    throw new ApiError(400, "Comment ID is required");
  }

  const pageNum = parseInt(page);
  const limitNum = parseInt(limit);
  const skip = (pageNum - 1) * limitNum;

  //Check if comment exists
  const comment = await Comment.findById(commentId);
  if (!comment || comment.isDeleted) {
    throw new ApiError(404, "Comment not found");
  }

  const replies = await Comment.find({
    parent: commentId,
    isDeleted: false,
  })
    .populate("user", "username profileImage")
    .sort({ createdAt: 1 })
    .skip(skip)
    .limit(limitNum);

  const totalReplies = await Comment.countDocuments({
    parent: commentId,
    isDeleted: false,
  });

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        replies,
        currentPage: pageNum,
        totalPages: Math.ceil(totalReplies / limitNum),
        totalReplies,
      },
      "Comment replies fetched successfully"
    )
  );
});

/**
 * Update a comment
 * @route PUT /api/comments/:commentId
 * @access Private
 */

const updateComment = asyncHandler(async (req, res) => {
  const { commentId } = req.params;
  const { text } = req.body;
  const userId = req.user?._id;

  if (!text?.trim()) {
    throw new ApiError(400, "Comment text is required");
  }

  const comment = await Comment.findById(commentId);

  // Check if comment exists and isn't deleted

  if (!comment || comment.isDeleted) {
    throw new ApiError(404, "Comment not found");
  }

  // Check if user is owner of the comment
  if (comment.user.toString() !== userId.toString()) {
    throw new ApiError(403, "User not authorized to update this comment");
  }

  comment.text = text;
  await comment.save(); //This will trigger the pre-save middleware to set isEdited to true

  const updatedComment = await Comment.findById(commentId).populate(
    "user",
    "username profileImage"
  );

  return res
    .status(200)
    .json(new ApiResponse(200, updatedComment, "Comment updated successfully"));
});

/**
 * Delete a comment (soft delete)
 * @route DELETE /api/comments/:commentId
 * @access Private
 */

const deleteComment = asyncHandler(async (req, res) => {
  const { commentId } = req.params;
  const userId = req.user?._id;

  const comment = await Comment.findById(commentId);

  //Check if comment exists
  if (!comment) {
    throw new ApiError(404, "Comment not found");
  }

  //Check if user is authorised (either the comment owner or post owner)
  const post = await Post.findById(comment.post);

  if (
    comment.user.toString() !== userId.toString() &&
    post.user.toString() !== userId.toString()
  ) {
    throw new ApiError(403, "User not authorized to delete this comment");
  }

  //Soft delete
  comment.isDeleted = true;
  await comment.save();

  return res
    .status(200)
    .json(new ApiResponse(200, {}, "Comment deleted successfully"));
});

/**
 * Like a comment
 * @route POST /api/comments/:commentId/like
 * @access Private
 */

const likeComment = asyncHandler(async (req, res) => {
  const { commentId } = req.params;
  const userId = req.user?._id;

  const comment = await Comment.findById(commentId);

  // Check if comment exists and isn't deleted
  if (!comment || comment.isDeleted) {
    throw new ApiError(404, "Comment not found");
  }

  // Check if the user has already liked the comment
  const alreadyLiked = comment.likes.some(
    (like) => like.toString() === userId.toString()
  );

  if (alreadyLiked) {
    throw new ApiError(400, "Comment alreday liked by this user");
  }

  await comment.addLike(userId);

  return res
    .status(200)
    .json(
      new ApiResponse(
        200,
        { likesCount: comment.likes.length },
        "Comment liked successfully"
      )
    );
});

/**
 * Unlike a comment
 * @route DELETE /api/comments/:commentId/like
 * @access Private
 */

const unlikeComment = asyncHandler(async (req, res) => {
  const { commentId } = req.params;
  const userId = req.user?._id;

  const comment = await Comment.findById(commentId);

  //Check if comment exists and isn't deleted
  const hasLiked = comment.likes.some(
    (like) => like.toString() === userId.toString()
  );

  if (!hasLiked) {
    throw new ApiError(400, "Comment not liked by this user");
  }

  await comment.removeLike(userId);

  return res
    .status(200)
    .json(
      new ApiResponse(
        200,
        { likesCount: comment.likes.length },
        "Comment unliked successfully"
      )
    );
});

/**
 * Get users who liked a comment
 * @route GET /api/comments/:commentId/likes
 * @access Public
 */

const getCommentLikes = asyncHandler(async (req, res) => {
  const { commentId } = req.params;
  const { page = 1, limit = 20 } = req.query;

  const pageNum = parseInt(page);
  const limitNum = parseInt(limit);
  const skip = (pageNum - 1) * limitNum;

  // Check if comment exists and isn't deleted
  const comment = await Comment.findById(commentId);
  if (!comment || comment.isDeleted) {
    throw new ApiError(404, "Comment not found");
  }

  // Get the total count of likes
  const totalLikes = comment.likes.length;

  //Get a subset of likes for pagination
  const paginatedLikes = comment.likes.slice(skip, skip + limitNum);

  //Get the user details for each like
  const users = await User.find(
    { _id: { $in: paginatedLikes } },
    "user profileImage"
  );

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        users,
        currentPage: pageNum,
        totalPages: Math.ceil(totalLikes / limitNum),
        totalLikes,
      },
      "Comment likes fetched successfully"
    )
  );
});

/**
 * Get comments by a specific user
 * @route GET /api/comments/user/:userId
 * @access Public
 */

const getUserComments = asyncHandler(async (req, res) => {
  const { userId } = req.params;
  const { page = 1, limit = 10 } = req.query;

  if (!userId) {
    throw new ApiError(400, "User ID is required");
  }

  const pageNum = parseInt(page);
  const limitNum = parseInt(limit);
  const skip = (pageNum - 1) * limitNum;

  // Check if user exists
  const userExists = await User.exists({ _id: userId });
  if (!userExists) {
    throw new ApiError(404, "User not found");
  }

  console.log(
    "Comment.find",
    Comment.find(
      {
        user: userId,
      },
      "post caption"
    )
  );

  // try {
  //   const comments = await Comment.find({
  //     user: userId,
  //     isDeleted: false,
  //   })
  //     .populate("post", "caption")
  //     .populate({
  //       path: "parent",
  //       select: "text user",
  //       populate: {
  //         path: "user",
  //         select: "username avatar",
  //       },
  //     })
  //     .sort({ createdAt: -1 })
  //     .skip(skip)
  //     .limit(limitNum);

  //   const totalComments = await Comment.countDocuments({
  //     user: userId,
  //     isDeleted: false,
  //   });

  //   return res.status(200).json(
  //     new ApiResponse(
  //       200,
  //       {
  //         comments,
  //         currentPage: pageNum,
  //         totalPages: Math.ceil(totalComments / limitNum),
  //         totalComments,
  //       },
  //       "User comments fetched successfully"
  //     )
  //   );
  // } catch (error) {
  //   console.error("Error in getUserComments:", error);
  //   throw new ApiError(500, "Error fetching user comments");
  // }
  try {
    const comments = await Comment.find({
      user: userId,
      isDeleted: false,
    });
    // Return success response
  } catch (error) {
    console.error("Error fetching user comments:", error);
    // Return appropriate error response
  }
});

export {
  createComment,
  getPostComments,
  getCommentReplies,
  updateComment,
  deleteComment,
  likeComment,
  unlikeComment,
  getCommentLikes,
  getUserComments,
};
