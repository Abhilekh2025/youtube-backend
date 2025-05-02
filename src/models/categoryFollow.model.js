const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const CategoryFollowSchema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    category: {
      type: Schema.Types.ObjectId,
      ref: "Category",
      required: true,
    },
    followedAt: {
      type: Date,
      default: Date.now,
    },
    notificationLevel: {
      type: String,
      enum: ["none", "highlights", "all"],
      default: "highlights",
    },
    customSettings: {
      showInFeed: {
        type: Boolean,
        default: true,
      },
      excludePosts: [
        {
          type: Schema.Types.ObjectId,
          ref: "Post",
        },
      ],
      pinnedInProfile: {
        type: Boolean,
        default: false,
      },
      pinPosition: {
        type: Number,
        default: 0,
      },
    },
    notificationsSent: {
      type: Number,
      default: 0,
    },
    lastNotificationSent: Date,
  },
  {
    timestamps: true,
  }
);

// Create compound index to ensure a user can only follow a category once
CategoryFollowSchema.index({ user: 1, category: 1 }, { unique: true });
// Index for retrieving user's followed categories
CategoryFollowSchema.index({
  user: 1,
  "customSettings.pinnedInProfile": -1,
  "customSettings.pinPosition": 1,
});
// Index for retrieving followers of a category
CategoryFollowSchema.index({ category: 1, createdAt: -1 });

// Methods
CategoryFollowSchema.methods = {
  // Update notification level
  updateNotificationLevel: async function (level) {
    this.notificationLevel = level;
    await this.save();
    return this;
  },

  // Toggle show in feed setting
  toggleShowInFeed: async function (show = null) {
    if (show === null) {
      // Toggle current value
      this.customSettings.showInFeed = !this.customSettings.showInFeed;
    } else {
      // Set to specific value
      this.customSettings.showInFeed = show;
    }
    await this.save();
    return this;
  },

  // Exclude a post from this category for this user
  excludePost: async function (postId) {
    if (!this.customSettings.excludePosts.includes(postId)) {
      this.customSettings.excludePosts.push(postId);
      await this.save();
    }
    return this;
  },

  // Include a previously excluded post
  includePost: async function (postId) {
    this.customSettings.excludePosts = this.customSettings.excludePosts.filter(
      (id) => id.toString() !== postId.toString()
    );
    await this.save();
    return this;
  },

  // Pin category in profile
  pinToProfile: async function (position = 0) {
    this.customSettings.pinnedInProfile = true;
    this.customSettings.pinPosition = position;
    await this.save();
    return this;
  },

  // Unpin category from profile
  unpinFromProfile: async function () {
    this.customSettings.pinnedInProfile = false;
    this.customSettings.pinPosition = 0;
    await this.save();
    return this;
  },

  // Record notification sent
  recordNotification: async function () {
    this.notificationsSent += 1;
    this.lastNotificationSent = new Date();
    await this.save();
    return this;
  },
};

// Static methods
CategoryFollowSchema.statics = {
  // Follow a category
  followCategory: async function (userId, categoryId, options = {}) {
    const { notificationLevel = "highlights", showInFeed = true } = options;

    // Check if already following
    const existing = await this.findOne({
      user: userId,
      category: categoryId,
    });

    if (existing) {
      return existing;
    }

    // Create new follow
    const followData = {
      user: userId,
      category: categoryId,
      notificationLevel,
      customSettings: {
        showInFeed,
      },
    };

    const follow = await this.create(followData);

    // Update category followers count
    const Category = mongoose.model("Category");
    await Category.findByIdAndUpdate(categoryId, {
      $inc: { followersCount: 1 },
    });

    return follow;
  },

  // Unfollow a category
  unfollowCategory: async function (userId, categoryId) {
    const follow = await this.findOneAndDelete({
      user: userId,
      category: categoryId,
    });

    if (follow) {
      // Update category followers count
      const Category = mongoose.model("Category");
      await Category.findByIdAndUpdate(categoryId, {
        $inc: { followersCount: -1 },
      });
    }

    return { unfollowed: !!follow };
  },

  // Check if user is following a category
  isFollowing: async function (userId, categoryId) {
    const follow = await this.findOne({
      user: userId,
      category: categoryId,
    });

    return !!follow;
  },

  // Get categories followed by a user
  getUserFollowedCategories: async function (userId, options = {}) {
    const { pinnedOnly = false } = options;

    const query = { user: userId };

    if (pinnedOnly) {
      query["customSettings.pinnedInProfile"] = true;
    }

    const follows = await this.find(query)
      .sort({
        "customSettings.pinnedInProfile": -1,
        "customSettings.pinPosition": 1,
        createdAt: -1,
      })
      .populate("category");

    return follows;
  },

  // Get followers of a category
  getCategoryFollowers: async function (categoryId, options = {}) {
    const { limit = 20, skip = 0 } = options;

    return this.find({ category: categoryId })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate("user", "username profilePictureUrl isVerified");
  },

  // Get users eligible for notification about a post in a category
  getEligibleFollowersForNotification: async function (
    categoryId,
    postId,
    options = {}
  ) {
    const { notificationLevel = "highlights" } = options;

    let levelFilter;
    if (notificationLevel === "highlights") {
      levelFilter = { $in: ["highlights", "all"] };
    } else if (notificationLevel === "all") {
      levelFilter = "all";
    } else {
      return [];
    }

    return this.find({
      category: categoryId,
      notificationLevel: levelFilter,
      "customSettings.excludePosts": { $ne: postId },
    }).populate("user", "username deviceTokens notificationSettings");
  },

  // Bulk follow categories
  bulkFollowCategories: async function (userId, categoryIds, options = {}) {
    if (!Array.isArray(categoryIds) || categoryIds.length === 0) {
      return { followed: 0 };
    }

    const { notificationLevel = "highlights", showInFeed = true } = options;

    // Get already followed categories to avoid duplicates
    const existingFollows = await this.find({
      user: userId,
      category: { $in: categoryIds },
    }).distinct("category");

    const existingIds = existingFollows.map((id) => id.toString());
    const newCategoryIds = categoryIds.filter(
      (id) => !existingIds.includes(id.toString())
    );

    if (newCategoryIds.length === 0) {
      return { followed: 0 };
    }

    // Create new follows
    const bulkFollows = newCategoryIds.map((categoryId) => ({
      user: userId,
      category: categoryId,
      notificationLevel,
      customSettings: {
        showInFeed,
      },
    }));

    await this.insertMany(bulkFollows);

    // Update category followers counts
    const Category = mongoose.model("Category");
    await Category.updateMany(
      { _id: { $in: newCategoryIds } },
      { $inc: { followersCount: 1 } }
    );

    return { followed: newCategoryIds.length };
  },
};

const CategoryFollow = mongoose.model("CategoryFollow", CategoryFollowSchema);

module.exports = CategoryFollow;
