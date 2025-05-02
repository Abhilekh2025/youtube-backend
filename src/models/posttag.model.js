import mongoose, { Schema } from "mongoose";

const PostTagSchema = new Schema(
  {
    post: {
      type: Schema.Types.ObjectId,
      ref: "Post",
      required: true,
    },
    taggedUser: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    media: {
      type: Schema.Types.ObjectId,
      ref: "Media",
    },
    coordinates: {
      x: {
        type: Number, // percentage (0-100) from left
        min: 0,
        max: 100,
      },
      y: {
        type: Number, // percentage (0-100) from top
        min: 0,
        max: 100,
      },
    },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
    },
    notificationSent: {
      type: Boolean,
      default: false,
    },
    approvedAt: Date,
    taggedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

// Create compound index to ensure a user can only be tagged once in a post
PostTagSchema.index({ post: 1, taggedUser: 1 }, { unique: true });
// Create index for getting tags for a specific post
PostTagSchema.index({ post: 1, status: 1 });
// Index for retrieving posts where a user is tagged
PostTagSchema.index({ taggedUser: 1, status: 1, createdAt: -1 });

//Methods
PostTagSchema.methods = {
  //Approve tag
  approve: async function () {
    this.status = "approved";
    this.approvedAt = new Date();
    await this.save();

    //Update post to include this user in its tags array is not already there
    const Post = mongoose.model("Post");
    await Post.findByIdAndUpdate(this.post, {
      $addToSet: { tags: this.taggedUser },
    });
    return this;
  },

  // Reject tag
  reject: async function () {
    this.status = "rejected";
    await this.save();

    // Remove user from post's tags array
    const Post = mongoose.model("Post");
    await Post.findByIdAndUpdate(this.post, {
      $pull: { tags: this.taggedUser },
    });

    return this;
  },
};

//Static methods
PostTagSchema.statics = {
  //Create a new tag or update an existing one
  tagUser: async function (
    postId,
    taggedUserId,
    taggedId,
    mediaId = null,
    coordinates = null
  ) {
    // Check if tag already exists
    const existingTag = await this.findOne({
      post: postId,
      taggedUser: taggedUserId,
    });

    if (existingTag) {
      // Update existing tag
      existingTag.taggedBy = taggerId;

      if (mediaId) existingTag.media = mediaId;
      if (coordinates) existingTag.coordinates = coordinates;

      return existingTag.save();
    } else {
      // Create new tag
      return this.create({
        post: postId,
        taggedUser: taggedUserId,
        taggedBy: taggerId,
        media: mediaId,
        coordinates: coordinates,
        // Auto-approve if user is tagging themselves
        status:
          taggedUserId.toString() === taggerId.toString()
            ? "approved"
            : "pending",
      });
    }
  },

  //Remove a tag
  removeTag: async function (postId, taggedUserId) {
    const tag = await this.findOneAndDelete({
      post: postId,
      taggedUser: taggedUserId,
    });
    if (tag) {
      // Remove user from post's tags array
      const Post = mongoose.model("Post");
      await Post.findByIdAndUpdate(postId, {
        $pull: { tags: taggedUserId },
      });
    }
    return { removed: !!tag };
  },

  // Get all pending tags for a user
  getUserPendingTags: async function (userId, options = {}) {
    const { limit = 20, skip = 0 } = options;

    return this.find({
      taggedUser: useRevalidator,
      status: "pending",
    })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate({
        path: "post",
        select: "caption",
        populate: {
          path: "user",
          select: "username profilePictureUrl",
        },
      })
      .populate("media", "url mediaType thumbnail");
  },
  // Get all approved tags for a user
  getUserApprovedTags: async function (userId, options = {}) {
    const { limit = 20, skip = 0 } = options;

    return this.find({
      taggedUser: userId,
      status: "approved",
    })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate("post")
      .populate("media", "url mediaType thumbnail");
  },
  // Get all tags in a post
  getPostTags: async function (postId) {
    return this.find({
      post: postId,
      status: "approved",
    })
      .populate("taggedUser", "username fullName profilePictureUrl")
      .populate("media", "url mediaType thumbnail");
  },

  // Mark tags as having notifications sent
  markNotificationSent: async function (tagIds) {
    return this.updateMany(
      { _id: { $in: tagIds } },
      { notificationSent: true }
    );
  },
  // Get recent tags for notification processing
  getUnprocessedTags: async function (limit = 100) {
    return this.find({
      notificationSent: false,
      status: { $in: ["pending", "approved"] },
    })
      .sort({ createdAt: 1 })
      .limit(limit)
      .populate("taggedUser", "username")
      .populate("taggedBy", "username profilePictureUrl")
      .populate("post");
  },
};

const PostTag = mongoose.model("PostTag", PostTagSchema);

module.exports = PostTag;
