import mongoose, { Schema } from "mongoose";

const commentSchema = new Schema(
  {
    text: {
      type: String,
      required: [true, "Comment text is required"],
      trim: true,
      maxlength: [1000, "Comment cannot exceed 1000 characters"],
    },
    // Reference to the user who created the comment
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: [true, "User reference is required for comments"],
    },
    // Reference to the post the comment belongs to
    post: {
      type: Schema.Types.ObjectId,
      ref: "Post",
      required: [true, "Post reference is required for comments"],
    },
    // Reference to parent comment if this is a reply
    parent: {
      type: Schema.Types.ObjectId,
      ref: "Comment",
      default: null,
    },
    // Array of likes for this comment
    likes: [
      {
        type: Schema.Types.ObjectId,
        ref: "User",
      },
    ],
    // Timestamps for when the comment was created and updated
    createdAt: {
      type: Date,
      default: Date.now,
    },

    updatedAt: {
      type: Date,
      default: Date.now,
    },

    // Flag to indicate if the comment has been edited
    isEdited: {
      type: Boolean,
      default: false,
    },

    // Flag for soft delete
    isDeleted: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Virtual field for replies count
commentSchema.virtual("repliesCount", {
  ref: "Comment",
  localField: "_id",
  foreignField: "parent",
  count: true,
});

// Virtual field for likes count
commentSchema.virtual("likesCount").get(function () {
  return this.likes.length;
});

// Pre-save middleware to handle updates
commentSchema.pre("save", function (next) {
  if (!this.isNew) {
    this.updatedAt = Date.now();
    this.isEdited = true;
  }
  next();
});

// Method to like a comment
commentSchema.methods.addLike = function (userId) {
  if (!this.likes.includes(userId)) {
    this.likes.push(userId);
  }
  return this.save();
};

// Method to unlike a comment
commentSchema.methods.removeLike = function (userId) {
  this.likes = this.likes.filter((id) => id.toString() !== userId.toString());
  return this.save();
};

// Static method to get all replies for a comment
commentSchema.statics.getReplies = function (commentId) {
  return this.find({ parent: commentId, isDeleted: false })
    .populate("user", "username profileImage")
    .sort({ createdAt: "asc" });
};

// Index for faster queries
commentSchema.index({ post: 1, createdAt: -1 });
commentSchema.index({ parent: 1, createdAt: -1 });
commentSchema.index({ user: 1, createdAt: -1 });

export const Comment = mongoose.model("Comment", commentSchema);
