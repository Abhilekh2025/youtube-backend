import { Post } from "../models/post.model.js";
import { Media } from "../models/media.model.js";
import { User } from "../models/user.model.js";
//import { Comment } from "../models/Comment.js";
//import mongoose from "mongoose";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";

/**
 * Create a new post
 * @route POST /api/posts
 * @access Private
 */

const createPost = asyncHandler(async (req, res) => {
  const {
    media,
    location,
    tags,
    hashtags,
    caption,
    is_sensitive_content,
    sponsored,
  } = req.body;

  console.log("media :", media);

  if (!media || media.length === 0) {
    throw new ApiError(400, "At least one media item is required");
  }

  // Validate media IDs
  const mediaIds = Array.isArray(media) ? media : [media];
  console.log("mediaIds :", mediaIds);
  const validMedia = await Media.find({
    _id: { $in: mediaIds },
    user: req.user._id,
  });
  console.log("validMedia :", validMedia);

  if (validMedia.length !== mediaIds.length) {
    throw new ApiError(400, "Invalid or unauthorized media IDs provided");
  }

  // Process location if provided
  let locationData = null;
  if (location) {
    locationData = {
      name: location.name,
      coordinates: {
        type: "Point",
        coordinates: location.coordinates || [0, 0],
      },
    };
  }
  console.log("location ", location);

  // Process tags if provided
  let validatedTags = [];
  if (tags && tags.length > 0) {
    validatedTags = await User.find({
      _id: { $in: tags },
    }).select("_id");
    validatedTags = validatedTags.map((tag) => tag._id);
  }
  console.log("validatedTags", validatedTags);

  // Create post
  const post = await Post.create({
    user_id: req.user._id,
    media: mediaIds,
    location: locationData,
    tags: validatedTags,
    hashtags: hashtags || [],
    caption: caption || "",
    is_sensitive_content: is_sensitive_content || false,
    sponsored: sponsored || false,
  });
  console.log("post", post);

  const populatedPost = await Post.findById(post._id)
    .populate("user_id", "username profile_photo name")
    .populate("media")
    .populate("tags", "username profile_photo name");

  console.log("populatedPost :", populatedPost);

  return res
    .status(201)
    .json(new ApiResponse(201, populatedPost, "Post created successfully"));
});

export { createPost };
