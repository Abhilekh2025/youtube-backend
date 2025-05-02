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

//Static Method
LikeSchema.statics = {
  //Add like and update target item's like count
  toggleLike: async function (userId, likeabelType, likeableId) {
    const existingLike = await this.findOne({
      user: userId,
      likeableType: likeableType,
      likeableId: likeableId,
    });

    //If already liked, unlike it
    if (existingLike) {
      await existingLike.remove();

      //Update the item's like count
      const Model = mongoose.model(likeableType);
      await Model.findByIdAndUpdate(likeableId, {
        $inc: { "engagement.likesCount": -1 },
        $pull: { likedBy: userId },
      });

      return { action: "unliked" };
    }

    //Otherwise, like it
    else {
      await this.create({
        user: userId,
        likeabelType: likeabelType,
        likeableId: likeableId,
      });

      //Update the items's like count
      const Model = mongoose.model(likeableType);
      await Model.findByIdAndUpdate(likeableId, {
        $inc: { "engagement.likesCount": 1 },
        $addToSet: { likeBy: userId },
      });

      return { action: "liked" };
    }
  },

  //Get likes for a specific item with pagination
  getLikesForItem: async function (likeableType, likeableId, options = {}) {
    const { limit = 20, skip = 0 } = options;

    return this.find({ likeableType: likeableType, likeableId: likeableId })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate("user", "username fullName profilePictureUrl isVerified");
  },

  //Check if a user has liked a specific item
  hasUserLiked: async function (userId, likeableType, likeableId) {
    const like = await this.findOne({
      user: userId,
      likeabelType: likeabelType,
      likeableId: likeableId,
    });
    return !!like;
  },

  //Get items liked by a user
  getUserLikes: async function (userId, likeableType = null, options = {}) {
    const { limit = 20, skip = 0 } = options;

    const query = { user: userId };
    if (likeableType) {
      query.likeabelType = likeableType;
    }

    return this.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate("likeableId");
  },

  //Mark likes as having notifications sent
  markNotificationSent: async function (likeIds) {
    return this.updateMany(
      { _id: { $in: likeIds } },
      { notificationSent: true }
    );
  },

  //Get recent likes for notification processing
  getUnproccessedLikes: async function (limit = 100) {
    return this.find({ notification: false })
      .sort({ createdAt: 1 })
      .limit(limit)
      .populate("user", "username profilePictureUrl")
      .populate("likeabelId");
  },
};

const Like = mongoose.model("Like", LikeSchema);

module.exports = Like;
