import mongoose, { Schema } from "mongoose";

const PostCategorySchema = new Schema(
  {
    post: {
      type: Schema.Types.ObjectId,
      ref: "Post",
      required: true,
    },
    category: {
      type: Schema.Types.ObjectId,
      ref: "Category",
      required: true,
    },
    isPrimary: {
      type: Boolean,
      default: false,
    },
    relevanceScore: {
      type: Number,
      min: 0,
      max: 100,
      default: 100,
    },
    addedBy: {
      type: String,
      enum: ["user", "admin", "auto", "ai"],
      default: "user",
    },
    confidence: {
      type: Number,
      min: 0,
      max: 1,
      default: 1,
    },
    moderationStatus: {
      status: {
        type: String,
        enum: ["approved", "pending", "rejected"],
        default: "approved",
      },
      reviewedAt: Date,
      reviewedBy: {
        type: Schema.Types.ObjectId,
        ref: "User",
      },
      reason: String,
    },
    metadata: {
      type: Map,
      of: Schema.Types.Mixed,
      default: {},
    },
    isFeatured: {
      type: Boolean,
      default: false,
    },
    position: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Create compound index to prevent duplicate category assignments
PostCategorySchema.index({ post: 1, category: 1 }, { unique: true });
// Index for getting categorized posts
PostCategorySchema.index({ category: 1, createdAt: -1 });
// Index for getting primary category of posts
PostCategorySchema.index({ post: 1, isPrimary: 1 });
// Index for moderation
PostCategorySchema.index({ "moderationStatus.status": 1 });
// Index for featured posts in a category
PostCategorySchema.index({ category: 1, isFeatured: 1, position: 1 });

// Methods
PostCategorySchema.methods = {
  // Set as primary category for the post
  setAsPrimary: async function () {
    // Remove primary from other categories for this post
    await this.constructor.updateMany(
      {
        post: this.post,
        _id: { $ne: this._id },
        isPrimary: true,
      },
      { isPrimary: false }
    );

    // Set this as primary
    this.isPrimary = true;
    await this.save();
    return this;
  },
};

// Methods
PostCategorySchema.methods = {
  // Set as primary category for the post
  setAsPrimary: async function () {
    // Remove primary from other categories for this post
    await this.constructor.updateMany(
      {
        post: this.post,
        _id: { $ne: this._id },
        isPrimary: true,
      },
      { isPrimary: false }
    );

    // Set this as primary
    this.isPrimary = true;
    await this.save();
    return this;
  },

  // Update relevance score
  updateRelevance: async function (newScore) {
    this.relevanceScore = Math.min(Math.max(newScore, 0), 100);
    await this.save();
    return this;
  },

  // Approve this category assignment
  approve: async function (reviewerId) {
    this.moderationStatus = {
      status: "approved",
      reviewedAt: new Date(),
      reviewedBy: reviewerId,
    };
    await this.save();
    return this;
  },

  // Reject this category assignment
  reject: async function (reviewerId, reason) {
    this.moderationStatus = {
      status: "rejected",
      reviewedAt: new Date(),
      reviewedBy: reviewerId,
      reason: reason || "Not relevant to category",
    };
    await this.save();

    // If this was primary, assign a new primary
    if (this.isPrimary) {
      const nextBest = await this.constructor
        .findOne({
          post: this.post,
          _id: { $ne: this._id },
          "moderationStatus.status": "approved",
        })
        .sort({ relevanceScore: -1 });

      if (nextBest) {
        nextBest.isPrimary = true;
        await nextBest.save();
      }
    }

    return this;
  },

  // Set featured status
  setFeatured: async function (isFeatured, position = 0) {
    this.isFeatured = isFeatured;
    this.position = position;
    await this.save();
    return this;
  },

  // Add metadata
  addMetadata: async function (key, value) {
    this.metadata.set(key, value);
    await this.save();
    return this;
  },

  // Remove metadata
  removeMetadata: async function (key) {
    this.metadata.delete(key);
    await this.save();
    return this;
  },
};

// Static methods
PostCategorySchema.statics = {
  // Add a category to a post
  addCategoryToPost: async function (postId, categoryId, options = {}) {
    const {
      isPrimary = false,
      relevanceScore = 100,
      addedBy = "user",
      confidence = 1,
      metadata = {},
    } = options;

    // Check if this post already has a primary category
    if (isPrimary) {
      // If making this primary, remove primary flag from any existing primary categories
      await this.updateMany(
        { post: postId, isPrimary: true },
        { isPrimary: false }
      );
    }

    // Check if this post-category relationship already exists
    const existing = await this.findOne({
      post: postId,
      category: categoryId,
    });

    if (existing) {
      // Update existing relationship
      existing.isPrimary = isPrimary;
      existing.relevanceScore = relevanceScore;
      existing.confidence = confidence;

      // Merge metadata if provided
      if (metadata && Object.keys(metadata).length > 0) {
        for (const [key, value] of Object.entries(metadata)) {
          existing.metadata.set(key, value);
        }
      }

      await existing.save();
      return existing;
    } else {
      // Create new relationship
      const postCategory = await this.create({
        post: postId,
        category: categoryId,
        isPrimary,
        relevanceScore,
        addedBy,
        confidence,
        metadata,
      });

      // Increment category post count
      const Category = mongoose.model("Category");
      await Category.findByIdAndUpdate(categoryId, {
        $inc: { postCount: 1 },
      });

      return postCategory;
    }
  },
  // Remove a category from a post
  removeCategoryFromPost: async function (postId, categoryId) {
    const postCategory = await this.findOneAndDelete({
      post: postId,
      category: categoryId,
    });

    if (postCategory) {
      // Decrement category post count
      const Category = mongoose.model("Category");
      await Category.findByIdAndUpdate(categoryId, {
        $inc: { postCount: -1 },
      });

      // If this was primary and there are other categories, make the highest relevance one primary
      if (postCategory.isPrimary) {
        const nextBest = await this.findOne({ post: postId }).sort({
          relevanceScore: -1,
        });

        if (nextBest) {
          nextBest.isPrimary = true;
          await nextBest.save();
        }
      }
    }

    return { removed: !!postCategory };
  },
  // Remove all categories from a post
  removeAllCategoriesFromPost: async function (postId) {
    const postCategories = await this.find({ post: postId });

    // Decrement post counts for all categories
    const categoryUpdates = postCategories.map((pc) => {
      return {
        updateOne: {
          filter: { _id: pc.category },
          update: { $inc: { postCount: -1 } },
        },
      };
    });

    if (categoryUpdates.length > 0) {
      const Category = mongoose.model("Category");
      await Category.bulkWrite(categoryUpdates);
    }

    // Remove all post-category relationships
    await this.deleteMany({ post: postId });

    return { removed: postCategories.length };
  },
  // Get categories for a post
  getPostCategories: async function (postId) {
    return this.find({ post: postId })
      .sort({ isPrimary: -1, relevanceScore: -1 })
      .populate("category");
  },

  // Get primary category for a post
  getPrimaryCategory: async function (postId) {
    return this.findOne({
      post: postId,
      isPrimary: true,
    }).populate("category");
  },

  // Get recent posts in a category
  getRecentPostsByCategory: async function (categoryId, options = {}) {
    const { limit = 20, skip = 0 } = options;

    const postCategories = await this.find({
      category: categoryId,
      "moderationStatus.status": "approved",
    })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate({
        path: "post",
        match: {
          isDeleted: false,
          isArchived: false,
          "accessControl.visibility": "public",
        },
        populate: [
          { path: "user", select: "username profilePictureUrl isVerified" },
          { path: "media", select: "url mediaType thumbnail" },
        ],
      });

    // Filter out null posts (those that didn't match the criteria in the populate match)
    return postCategories.filter((pc) => pc.post).map((pc) => pc.post);
  },

  // Get featured posts in a category
  getFeaturedPostsByCategory: async function (categoryId, options = {}) {
    const { limit = 5 } = options;

    const postCategories = await this.find({
      category: categoryId,
      isFeatured: true,
      "moderationStatus.status": "approved",
    })
      .sort({ position: 1 })
      .limit(limit)
      .populate({
        path: "post",
        match: {
          isDeleted: false,
          isArchived: false,
        },
        populate: [
          { path: "user", select: "username profilePictureUrl isVerified" },
          { path: "media", select: "url mediaType thumbnail" },
        ],
      });

    // Filter out null posts
    return postCategories.filter((pc) => pc.post).map((pc) => pc.post);
  },

  // Get popular posts in a category
  getPopularPostsByCategory: async function (categoryId, options = {}) {
    const { limit = 20, skip = 0, timeWindow = 7 } = options; // default 7 days

    const date = new Date();
    date.setDate(date.getDate() - timeWindow);

    // Find post IDs in this category
    const postIds = await this.find({
      category: categoryId,
      createdAt: { $gte: date },
      "moderationStatus.status": "approved",
    }).distinct("post");

    if (postIds.length === 0) {
      return [];
    }

    // Get the popular posts from these IDs
    const Post = mongoose.model("Post");
    return Post.find({
      _id: { $in: postIds },
      isDeleted: false,
      isArchived: false,
      "accessControl.visibility": "public",
    })
      .sort({
        "engagement.likesCount": -1,
        "engagement.commentsCount": -1,
      })
      .skip(skip)
      .limit(limit)
      .populate("user", "username profilePictureUrl isVerified")
      .populate("media", "url mediaType thumbnail");
  },

  // Promote a post to featured in a category
  promoteToFeatured: async function (postId, categoryId, position = 0) {
    const postCategory = await this.findOne({
      post: postId,
      category: categoryId,
    });

    if (!postCategory) {
      throw new Error("Post is not in this category");
    }

    postCategory.isFeatured = true;
    postCategory.position = position;
    await postCategory.save();

    return postCategory;
  },
  // Remove a post from featured in a category
  removeFromFeatured: async function (postId, categoryId) {
    const postCategory = await this.findOne({
      post: postId,
      category: categoryId,
    });

    if (postCategory) {
      postCategory.isFeatured = false;
      postCategory.position = 0;
      await postCategory.save();
    }

    return { updated: !!postCategory };
  },
  // Categorize a post using AI or automated analysis
  autoCategorizePost: async function (postId, options = {}) {
    const { confidenceThreshold = 0.7, maxCategories = 3 } = options;

    // Get the post with caption and other relevant fields
    const Post = mongoose.model("Post");
    const post = await Post.findById(postId).select("caption hashtags");

    if (!post) {
      throw new Error("Post not found");
    }

    // This is where you'd implement AI categorization logic
    // For this example, we'll mock with a simple hashtag-based approach

    // Get all categories
    const Category = mongoose.model("Category");
    const allCategories = await Category.find({ isActive: true }).select(
      "name tags synonyms"
    );

    // Extract hashtag strings
    const Hashtag = mongoose.model("Hashtag");
    const hashtags = await Hashtag.find({ _id: { $in: post.hashtags } }).select(
      "name"
    );
    const hashtagNames = hashtags.map((h) => h.name.toLowerCase());

    // Score categories based on matching tags
    const categoryScores = [];

    for (const category of allCategories) {
      let score = 0;
      const categoryTags = [
        category.name.toLowerCase(),
        ...(category.tags || []).map((t) => t.toLowerCase()),
        ...(category.synonyms || []).map((s) => s.toLowerCase()),
      ];

      // Check for matches between hashtags and category tags
      for (const tag of categoryTags) {
        if (post.caption && post.caption.toLowerCase().includes(tag)) {
          score += 0.5;
        }

        for (const hashtag of hashtagNames) {
          // Direct match
          if (hashtag === tag) {
            score += 1;
          }
          // Partial match
          else if (hashtag.includes(tag) || tag.includes(hashtag)) {
            score += 0.3;
          }
        }
      }

      // Normalize score to 0-1 range
      const confidence = Math.min(score / 3, 1);

      if (confidence >= confidenceThreshold) {
        categoryScores.push({
          categoryId: category._id,
          confidence,
          relevanceScore: Math.round(confidence * 100),
        });
      }
    }

    // Sort by confidence and take the top maxCategories
    categoryScores.sort((a, b) => b.confidence - a.confidence);
    const topCategories = categoryScores.slice(0, maxCategories);

    // Add categories to the post
    const addedCategories = [];

    for (let i = 0; i < topCategories.length; i++) {
      const { categoryId, confidence, relevanceScore } = topCategories[i];
      const isPrimary = i === 0; // First one is primary

      const added = await this.addCategoryToPost(postId, categoryId, {
        isPrimary,
        relevanceScore,
        addedBy: "ai",
        confidence,
      });

      addedCategories.push(added);
    }

    return addedCategories;
  },
  // Get posts by multiple categories (AND logic)
  getPostsByMultipleCategories: async function (categoryIds, options = {}) {
    const { limit = 20, skip = 0 } = options;

    if (!Array.isArray(categoryIds) || categoryIds.length === 0) {
      return [];
    }

    // For each category, get the post IDs
    const postIdsByCategory = await Promise.all(
      categoryIds.map((categoryId) =>
        this.find({
          category: categoryId,
          "moderationStatus.status": "approved",
        }).distinct("post")
      )
    );

    // Find posts that are in ALL specified categories (intersection)
    let commonPostIds = postIdsByCategory[0];
    for (let i = 1; i < postIdsByCategory.length; i++) {
      commonPostIds = commonPostIds.filter((id) =>
        postIdsByCategory[i].some((pid) => pid.toString() === id.toString())
      );
    }

    if (commonPostIds.length === 0) {
      return [];
    }

    // Get the actual posts
    const Post = mongoose.model("Post");
    return Post.find({
      _id: { $in: commonPostIds },
      isDeleted: false,
      isArchived: false,
      "accessControl.visibility": "public",
    })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate("user", "username profilePictureUrl isVerified")
      .populate("media", "url mediaType thumbnail");
  },
  // Get related categories based on co-occurrence in posts
  getRelatedCategories: async function (categoryId, options = {}) {
    const { limit = 5 } = options;

    // Get posts in this category
    const postIds = await this.find({
      category: categoryId,
      "moderationStatus.status": "approved",
    }).distinct("post");

    if (postIds.length === 0) {
      return [];
    }

    // Find other categories that appear in these posts
    const relatedCategoriesAgg = await this.aggregate([
      {
        $match: {
          post: { $in: postIds },
          category: { $ne: mongoose.Types.ObjectId(categoryId) },
        },
      },
      {
        $group: {
          _id: "$category",
          count: { $sum: 1 },
        },
      },
      {
        $sort: { count: -1 },
      },
      {
        $limit: limit,
      },
    ]);

    if (relatedCategoriesAgg.length === 0) {
      return [];
    }

    // Get the actual category documents
    const categoryIds = relatedCategoriesAgg.map((item) => item._id);
    const Category = mongoose.model("Category");
    const categories = await Category.find({
      _id: { $in: categoryIds },
      isActive: true,
    });

    // Sort them according to the aggregation result
    const idToCountMap = {};
    relatedCategoriesAgg.forEach((item) => {
      idToCountMap[item._id.toString()] = item.count;
    });

    return categories.sort((a, b) => {
      return idToCountMap[b._id.toString()] - idToCountMap[a._id.toString()];
    });
  },
  // Bulk categorize posts
  bulkCategorize: async function (postIds, categoryId, options = {}) {
    if (!Array.isArray(postIds) || postIds.length === 0) {
      return { categorized: 0 };
    }

    const {
      isPrimary = false,
      relevanceScore = 100,
      addedBy = "admin",
      confidence = 1,
    } = options;

    // Find existing categorizations to avoid duplicates
    const existingPairs = await this.find({
      post: { $in: postIds },
      category: categoryId,
    }).distinct("post");

    const existingPostIds = existingPairs.map((id) => id.toString());
    const newPostIds = postIds.filter(
      (id) => !existingPostIds.includes(id.toString())
    );

    if (newPostIds.length === 0) {
      return { categorized: 0 };
    }

    // If making these primary, remove existing primary flags
    if (isPrimary) {
      await this.updateMany(
        { post: { $in: newPostIds }, isPrimary: true },
        { isPrimary: false }
      );
    }

    // Create new categorizations
    const bulkCategories = newPostIds.map((postId) => ({
      post: postId,
      category: categoryId,
      isPrimary,
      relevanceScore,
      addedBy,
      confidence,
    }));

    await this.insertMany(bulkCategories);

    // Update category post count
    const Category = mongoose.model("Category");
    await Category.findByIdAndUpdate(categoryId, {
      $inc: { postCount: newPostIds.length },
    });

    return { categorized: newPostIds.length };
  },
  // Bulk categorize posts
  bulkCategorize: async function (postIds, categoryId, options = {}) {
    if (!Array.isArray(postIds) || postIds.length === 0) {
      return { categorized: 0 };
    }

    const {
      isPrimary = false,
      relevanceScore = 100,
      addedBy = "admin",
      confidence = 1,
    } = options;

    // Find existing categorizations to avoid duplicates
    const existingPairs = await this.find({
      post: { $in: postIds },
      category: categoryId,
    }).distinct("post");

    const existingPostIds = existingPairs.map((id) => id.toString());
    const newPostIds = postIds.filter(
      (id) => !existingPostIds.includes(id.toString())
    );

    if (newPostIds.length === 0) {
      return { categorized: 0 };
    }

    // If making these primary, remove existing primary flags
    if (isPrimary) {
      await this.updateMany(
        { post: { $in: newPostIds }, isPrimary: true },
        { isPrimary: false }
      );
    }

    // Create new categorizations
    const bulkCategories = newPostIds.map((postId) => ({
      post: postId,
      category: categoryId,
      isPrimary,
      relevanceScore,
      addedBy,
      confidence,
    }));

    await this.insertMany(bulkCategories);

    // Update category post count
    const Category = mongoose.model("Category");
    await Category.findByIdAndUpdate(categoryId, {
      $inc: { postCount: newPostIds.length },
    });

    return { categorized: newPostIds.length };
  },

  // Get category distribution for a set of posts
  getCategoryDistribution: async function (postIds) {
    if (!Array.isArray(postIds) || postIds.length === 0) {
      return [];
    }

    return this.aggregate([
      {
        $match: {
          post: { $in: postIds.map((id) => mongoose.Types.ObjectId(id)) },
          "moderationStatus.status": "approved",
        },
      },
      {
        $group: {
          _id: "$category",
          count: { $sum: 1 },
          primaryCount: {
            $sum: { $cond: ["$isPrimary", 1, 0] },
          },
          averageRelevance: { $avg: "$relevanceScore" },
        },
      },
      {
        $sort: { count: -1 },
      },
      {
        $lookup: {
          from: "categories",
          localField: "_id",
          foreignField: "_id",
          as: "category",
        },
      },
      {
        $unwind: "$category",
      },
      {
        $project: {
          _id: 0,
          categoryId: "$_id",
          categoryName: "$category.name",
          count: 1,
          primaryCount: 1,
          averageRelevance: 1,
          percentage: {
            $multiply: [{ $divide: ["$count", postIds.length] }, 100],
          },
        },
      },
    ]);
  },
};

// Middleware: update category post counts when PostCategory is created or deleted
PostCategorySchema.post("save", async function () {
  if (this.isNew) {
    try {
      // Increment category post count
      const Category = mongoose.model("Category");
      await Category.findByIdAndUpdate(this.category, {
        $inc: { postCount: 1 },
      });
    } catch (error) {
      console.error("Error updating category post count:", error);
    }
  }
});

PostCategorySchema.post("remove", async function () {
  try {
    // Decrement category post count
    const Category = mongoose.model("Category");
    await Category.findByIdAndUpdate(this.category, {
      $inc: { postCount: -1 },
    });
  } catch (error) {
    console.error("Error updating category post count:", error);
  }
});

const PostCategory = mongoose.model("PostCategory", PostCategorySchema);

module.exports = PostCategory;
