import mongoose, { Schema } from "mongoose";

const HashtagSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    postCount: {
      type: Number,
      default: 0,
    },
    followersCount: {
      type: Number,
      default: 0,
    },
    firstUsed: {
      type: Date,
      default: Date.now,
    },
    lastUsed: {
      type: Date,
      default: Date.now,
    },
    // For trending calculation
    usageStats: {
      last24Hours: {
        type: Number,
        default: 0,
      },
      last7Days: {
        type: Number,
        default: 0,
      },
      last30Days: {
        type: Number,
        default: 0,
      },
      previousPeriodGrowth: {
        type: Number, // percentage
        default: 0,
      },
    },
    moderationStatus: {
      status: {
        type: String,
        enum: ["approved", "flagged", "restricted", "banned"],
        default: "approved",
      },
      reason: String,
      reviewedAt: Date,
      reviewedBy: {
        type: Schema.Types.ObjectId,
        ref: "User",
      },
    },
    relatedCategories: [
      {
        category: {
          type: Schema.Types.ObjectId,
          ref: "Category",
        },
        strength: {
          type: Number, // 0-100 score indicating relationship strength
          default: 50,
        },
        autoTaggingEnabled: {
          type: Boolean,
          default: false,
        },
      },
    ],
    metadata: {
      type: Map,
      of: Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Indexes
HashtagSchema.index({ postCount: -1 });
HashtagSchema.index({ "usageStats.last24Hours": -1 });
HashtagSchema.index({ "moderationStatus.status": 1 });
HashtagSchema.index({ "relatedCategories.category": 1 });

// Virtual for posts using this hashtag
HashtagSchema.virtual("posts", {
  ref: "PostHashtag",
  localField: "_id",
  foreignField: "hashtag",
});

// Methods
HashtagSchema.methods = {
  // Update usage stats for trending calculation
  updateUsageStats: async function () {
    // Get the current date
    const now = new Date();

    // Get posts from the last 24 hours
    const PostHashtag = mongoose.model("PostHashtag");
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const last24HoursCount = await PostHashtag.countDocuments({
      hashtag: this._id,
      created_at: { $gte: oneDayAgo },
    });

    // Get posts from the last 7 days
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const last7DaysCount = await PostHashtag.countDocuments({
      hashtag: this._id,
      created_at: { $gte: sevenDaysAgo },
    });

    // Get posts from the last 30 days
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const last30DaysCount = await PostHashtag.countDocuments({
      hashtag: this._id,
      created_at: { $gte: thirtyDaysAgo },
    });

    // Calculate growth percentage (compared to previous week)
    const previousWeekStart = new Date(
      now.getTime() - 14 * 24 * 60 * 60 * 1000
    );
    const previousWeekEnd = sevenDaysAgo;
    const previousWeekCount = await PostHashtag.countDocuments({
      hashtag: this._id,
      created_at: { $gte: previousWeekStart, $lt: previousWeekEnd },
    });

    let growthPercentage = 0;
    if (previousWeekCount > 0) {
      growthPercentage =
        ((last7DaysCount - previousWeekCount) / previousWeekCount) * 100;
    } else if (last7DaysCount > 0) {
      growthPercentage = 100; // New hashtag with activity
    }

    // Update stats
    this.usageStats = {
      last24Hours: last24HoursCount,
      last7Days: last7DaysCount,
      last30Days: last30DaysCount,
      previousPeriodGrowth: Math.round(growthPercentage),
    };

    // Update lastUsed if there was activity in the last 24 hours
    if (last24HoursCount > 0) {
      this.lastUsed = now;
    }

    await this.save();
    return this.usageStats;
  },

  // Associate hashtag with a category
  associateWithCategory: async function (
    categoryId,
    strength = 50,
    enableAutoTagging = false
  ) {
    // Check if already associated
    const existingRelation = this.relatedCategories.find(
      (rel) => rel.category.toString() === categoryId.toString()
    );

    if (existingRelation) {
      existingRelation.strength = strength;
      existingRelation.autoTaggingEnabled = enableAutoTagging;
    } else {
      this.relatedCategories.push({
        category: categoryId,
        strength: strength,
        autoTaggingEnabled: enableAutoTagging,
      });
    }

    await this.save();
    return this;
  },

  // Remove category association
  removeFromCategory: async function (categoryId) {
    this.relatedCategories = this.relatedCategories.filter(
      (rel) => rel.category.toString() !== categoryId.toString()
    );
    await this.save();
    return this;
  },

  // Get most relevant category
  getPrimaryCategory: async function () {
    if (this.relatedCategories.length === 0) {
      return null;
    }

    // Sort by strength and get the strongest one
    const sortedCategories = [...this.relatedCategories].sort(
      (a, b) => b.strength - a.strength
    );

    const primaryCategoryId = sortedCategories[0].category;

    // Get the actual category document
    const Category = mongoose.model("Category");
    return Category.findById(primaryCategoryId);
  },

  // Get auto-tagging categories
  getAutoTaggingCategories: async function () {
    const categoryIds = this.relatedCategories
      .filter((rel) => rel.autoTaggingEnabled)
      .map((rel) => rel.category);

    if (categoryIds.length === 0) {
      return [];
    }

    const Category = mongoose.model("Category");
    return Category.find({ _id: { $in: categoryIds } });
  },
};

// Static methods
HashtagSchema.statics = {
  // Get trending hashtags
  getTrending: async function (options = {}) {
    const {
      limit = 10,
      timeframe = "24h",
      excludeBanned = true,
      categoryId = null,
    } = options;

    // Build query
    const query = {};

    // Filter by moderation status
    if (excludeBanned) {
      query["moderationStatus.status"] = { $ne: "banned" };
    }

    // Filter by category if provided
    if (categoryId) {
      query["relatedCategories.category"] = categoryId;
    }

    // Determine sort field based on timeframe
    let sortField;
    switch (timeframe) {
      case "24h":
        sortField = "usageStats.last24Hours";
        break;
      case "7d":
        sortField = "usageStats.last7Days";
        break;
      case "30d":
        sortField = "usageStats.last30Days";
        break;
      case "growth":
        sortField = "usageStats.previousPeriodGrowth";
        break;
      default:
        sortField = "usageStats.last24Hours";
    }

    return this.find(query)
      .sort({ [sortField]: -1 })
      .limit(limit);
  },

  // Find or create hashtag
  findOrCreate: async function (name) {
    const normalizedName = name.toLowerCase().trim();
    const slug = normalizedName.replace(/[^\w]/g, "");

    let hashtag = await this.findOne({ name: normalizedName });

    if (!hashtag) {
      hashtag = await this.create({
        name: normalizedName,
        slug: slug,
        firstUsed: new Date(),
        lastUsed: new Date(),
      });
    }

    return hashtag;
  },

  // Process hashtags from text
  extractFromText: async function (text) {
    if (!text) return [];

    const hashtagRegex = /#(\w+)/g;
    const matches = text.match(hashtagRegex) || [];

    // Clean hashtags (remove # and lowercase)
    const hashtagNames = [
      ...new Set(matches.map((tag) => tag.substring(1).toLowerCase())),
    ];

    if (hashtagNames.length === 0) return [];

    const hashtags = [];

    for (const name of hashtagNames) {
      const hashtag = await this.findOrCreate(name);
      hashtags.push(hashtag);
    }

    return hashtags;
  },

  // Search hashtags
  searchHashtags: async function (query, options = {}) {
    const { limit = 10, excludeBanned = true } = options;

    if (!query || query.trim() === "") {
      return [];
    }

    const searchQuery = {
      name: { $regex: query.toLowerCase(), $options: "i" },
    };

    if (excludeBanned) {
      searchQuery["moderationStatus.status"] = { $ne: "banned" };
    }

    return this.find(searchQuery).sort({ postCount: -1 }).limit(limit);
  },
  // Find similar hashtags
  getSimilarHashtags: async function (hashtagId, options = {}) {
    const { limit = 10 } = options;

    const hashtag = await this.findById(hashtagId);
    if (!hashtag) {
      throw new Error("Hashtag not found");
    }

    // Get related categories
    const categoryIds = hashtag.relatedCategories.map((rel) => rel.category);

    if (categoryIds.length === 0) {
      // If no related categories, find by name similarity
      return this.find({
        _id: { $ne: hashtagId },
        name: { $regex: hashtag.name.substring(0, 4), $options: "i" },
      })
        .sort({ postCount: -1 })
        .limit(limit);
    }

    // Find hashtags with same categories
    return this.find({
      _id: { $ne: hashtagId },
      "relatedCategories.category": { $in: categoryIds },
    })
      .sort({ postCount: -1 })
      .limit(limit);
  },
  // Auto-categorize uncategorized hashtags
  runAutoCategorizationJob: async function (options = {}) {
    const { batchSize = 100, minPostCount = 5 } = options;

    // Get uncategorized hashtags with enough usage
    const uncategorizedHashtags = await this.find({
      relatedCategories: { $size: 0 },
      postCount: { $gte: minPostCount },
    })
      .sort({ postCount: -1 })
      .limit(batchSize);

    const results = {
      processed: uncategorizedHashtags.length,
      categorized: 0,
      errors: [],
    };

    for (const hashtag of uncategorizedHashtags) {
      try {
        // Get posts with this hashtag
        const PostHashtag = mongoose.model("PostHashtag");
        const recentPostIds = await PostHashtag.find({ hashtag: hashtag._id })
          .sort({ createdAt: -1 })
          .limit(20)
          .distinct("post");

        if (recentPostIds.length === 0) continue;

        // Get categories of these posts
        const PostCategory = mongoose.model("PostCategory");
        const categoryOccurrences = await PostCategory.aggregate([
          { $match: { post: { $in: recentPostIds } } },
          { $group: { _id: "$category", count: { $sum: 1 } } },
          { $sort: { count: -1 } },
        ]);

        if (categoryOccurrences.length === 0) continue;

        // Associate with top categories
        const topCategories = categoryOccurrences.slice(0, 3);
        for (const cat of topCategories) {
          const strength = Math.min(
            100,
            Math.round((cat.count / recentPostIds.length) * 100)
          );
          await hashtag.associateWithCategory(
            cat._id,
            strength,
            strength > 75 // Enable auto-tagging if strong correlation
          );
        }

        results.categorized++;
      } catch (error) {
        results.errors.push({
          hashtagId: hashtag._id,
          error: error.message,
        });
      }
    }

    return results;
  },
  // Update usage statistics for trending hashtags
  updateTrendingStats: async function (options = {}) {
    const { batchSize = 100, minPostCount = 10 } = options;

    // Get hashtags to update - focus on active ones
    const hashtagsToUpdate = await this.find({
      $or: [
        { lastUsed: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
        { postCount: { $gte: minPostCount } },
      ],
    })
      .sort({ postCount: -1 })
      .limit(batchSize);

    const results = {
      processed: hashtagsToUpdate.length,
      updated: 0,
      errors: [],
    };

    for (const hashtag of hashtagsToUpdate) {
      try {
        await hashtag.updateUsageStats();
        results.updated++;
      } catch (error) {
        results.errors.push({
          hashtagId: hashtag._id,
          error: error.message,
        });
      }
    }

    return results;
  },
};

// Pre-save middleware for slug generation
HashtagSchema.pre("save", function (next) {
  if (!this.slug || this.isModified("name")) {
    this.slug = this.name.toLowerCase().replace(/[^\w]/g, "");
  }
  next();
});

const Hashtag = mongoose.model("Hashtag", HashtagSchema);

module.exports = Hashtag;
