import mongoose, { Schema } from "mongoose";

const LikeSchema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    likeableType: {
      type: String,
      enum: ["Post", "Comment", "Story", "Reel"],
      required: true,
    },
    likeableId: {
      type: Schema.Types.ObjectId,
      required: true,
      refPath: "likeableType",
    },
    notificationSent: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

// Create compound index to ensure a user can only like an item once
LikeSchema.index({ user: 1, likeableType: 1, likeableId: 1 }, { unique: true });

// Create index for getting likes for a specific item
LikeSchema.index({ likeableType: 1, likeableId: 1, createdAt: -1 });

// Index for retrieving a user's likes
LikeSchema.index({ user: 1, createdAt: -1 });
