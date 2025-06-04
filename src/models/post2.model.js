import mongoose, { Schema } from "mongoose";

/**
 * Post Schema
 * Central model for content posts in the platform
 */
const PostSchema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    caption: {
      type: String,
      trim: true,
    },
    hashtags: [
      {
        type: Schema.Types.ObjectId,
        ref: "Hashtag",
      },
    ],
    categories: [
      {
        type: Schema.Types.ObjectId,
        ref: "Category",
      },
    ],
    media: [
      {
        type: Schema.Types.ObjectId,
        ref: "Media",
      },
    ],
    tags: [
      {
        type: Schema.Types.ObjectId,
        ref: "User",
      },
    ],
    likedBy: [
      {
        type: Schema.Types.ObjectId,
        ref: "User",
      },
    ],
    location_id: {
      type: Schema.Types.ObjectId,
      ref: "Location",
    },
    location: {
      name: String,
      coordinates: {
        type: {
          type: String,
          enum: ["Point"],
          default: "Point",
        },
        coordinates: {
          type: [Number], // [longitude, latitude]
          default: [0, 0],
        },
      },
    },
    accessControl: {
      visibility: {
        type: String,
        enum: ["public", "followers", "private"],
        default: "public",
      },
      allowComments: {
        type: Boolean,
        default: true,
      },
      allowLikes: {
        type: Boolean,
        default: true,
      },
      allowSharing: {
        type: Boolean,
        default: true,
      },
      allowDownload: {
        type: Boolean,
        default: false,
      },
      restrictedTo: [
        {
          type: Schema.Types.ObjectId,
          ref: "User",
        },
      ],
      excludedUsers: [
        {
          type: Schema.Types.ObjectId,
          ref: "User",
        },
      ],
    },
    likes_count: {
      type: Number,
      default: 0,
    },
    comments_count: {
      type: Number,
      default: 0,
    },
    engagement: {
      viewsCount: {
        type: Number,
        default: 0,
      },
      sharesCount: {
        type: Number,
        default: 0,
      },
      bookmarksCount: {
        type: Number,
        default: 0,
      },
      clicksCount: {
        type: Number,
        default: 0,
      },
      impressionsCount: {
        type: Number,
        default: 0,
      },
    },
    is_sponsored: {
      type: Boolean,
      default: false,
    },
    is_sensitive_content: {
      type: Boolean,
      default: false,
    },
    filter_used: String,
    accessibility_caption: String,
    publishingDetails: {
      status: {
        type: String,
        enum: ["draft", "scheduled", "published", "archived"],
        default: "published",
      },
      scheduledFor: Date,
      publishedAt: {
        type: Date,
        default: Date.now,
      },
    },
    moderationStatus: {
      status: {
        type: String,
        enum: ["approved", "pending", "flagged", "rejected"],
        default: "approved",
      },
      reason: String,
      reviewedAt: Date,
      reviewedBy: {
        type: Schema.Types.ObjectId,
        ref: "User",
      },
    },
    isEdited: {
      type: Boolean,
      default: false,
    },
    lastEditedAt: Date,
    isDeleted: {
      type: Boolean,
      default: false,
    },
    isArchived: {
      type: Boolean,
      default: false,
    },
    source: {
      type: String,
      enum: ["app", "web", "api", "import"],
      default: "app",
    },
    metadata: {
      deviceInfo: {
        model: String,
        os: String,
        appVersion: String,
      },
      ipAddress: String,
      exif: {
        camera: String,
        timestamp: Date,
        location: {
          latitude: Number,
          longitude: Number,
        },
      },
      originalUrls: [String],
      edited: Boolean,
    },
    analytics: {
      audienceReached: {
        total: Number,
        followers: Number,
        nonFollowers: Number,
      },
      demographicData: {
        ageGroups: Map,
        countries: Map,
        genders: Map,
      },
      peakEngagementTime: Date,
      engagementRate: Number,
      savedAnalytics: {
        type: Boolean,
        default: false,
      },
    },
    mentions: [
      {
        user: {
          type: Schema.Types.ObjectId,
          ref: "User",
        },
        position: {
          start: Number,
          end: Number,
        },
        notificationSent: {
          type: Boolean,
          default: false,
        },
      },
    ],
    primaryCategory: {
      type: Schema.Types.ObjectId,
      ref: "Category",
    },
    customFields: {
      type: Map,
      of: Schema.Types.Mixed,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Indexes for efficient querying
PostSchema.index({ user: 1, createdAt: -1 });
PostSchema.index({
  "publishingDetails.status": 1,
  "publishingDetails.scheduledFor": 1,
});
PostSchema.index({
  "accessControl.visibility": 1,
  isDeleted: 1,
  isArchived: 1,
});
PostSchema.index({ "moderationStatus.status": 1 });
PostSchema.index({ "location.coordinates": "2dsphere" });
PostSchema.index({ location_id: 1 });
PostSchema.index({ likes_count: -1 });
PostSchema.index({ comments_count: -1 });
PostSchema.index({ categories: 1 });
PostSchema.index({ hashtags: 1 });
PostSchema.index({ tags: 1 });

// Virtual for comments
PostSchema.virtual("comments", {
  ref: "Comment",
  localField: "_id",
  foreignField: "post",
});

// Virtual for post hashtags
PostSchema.virtual("postHashtags", {
  ref: "PostHashtag",
  localField: "_id",
  foreignField: "post",
});

// Virtual for post categories
PostSchema.virtual("postCategories", {
  ref: "PostCategory",
  localField: "_id",
  foreignField: "post",
});

// Virtual for post tags
PostSchema.virtual("postTags", {
  ref: "PostTag",
  localField: "_id",
  foreignField: "post",
});

// Methods
PostSchema.methods = {
  /**
   * Add hashtags to post
   * @param {Array<String|ObjectId>} hashtags - Array of hashtag IDs or hashtag names
   * @returns {Promise<Object>} Result with added hashtags
   */
  addHashtags: async function (hashtags) {
    if (!Array.isArray(hashtags) || hashtags.length === 0) {
      return { added: 0 };
    }

    try {
      const Hashtag = mongoose.model("Hashtag");
      const PostHashtag = mongoose.model("PostHashtag");
      const hashtagIds = [];

      // Process each hashtag
      for (const hashtag of hashtags) {
        let hashtagId;

        // If hashtag is a string (name), find or create it
        if (typeof hashtag === "string") {
          const hashtagDoc = await Hashtag.findOrCreate(hashtag);
          hashtagId = hashtagDoc._id;
        } else {
          // Otherwise assume it's already an ID
          hashtagId = hashtag;
        }

        if (hashtagId) {
          hashtagIds.push(hashtagId);
        }
      }

      // Associate hashtags with post
      await PostHashtag.associateHashtags(this._id, hashtagIds);

      // Update post's hashtags array
      this.hashtags = [...new Set([...this.hashtags, ...hashtagIds])];
      await this.save();

      return { added: hashtagIds.length, hashtags: hashtagIds };
    } catch (error) {
      console.error("Error adding hashtags to post:", error);
      throw error;
    }
  },

  /**
   * Process hashtags from caption text
   * @returns {Promise<Array>} Processed hashtags
   */
  processHashtagsFromCaption: async function () {
    if (!this.caption) return [];

    try {
      const PostHashtag = mongoose.model("PostHashtag");
      return PostHashtag.processHashtagsFromText(this._id, this.caption);
    } catch (error) {
      console.error("Error processing hashtags from caption:", error);
      throw error;
    }
  },

  /**
   * Add post to a category
   * @param {ObjectId} categoryId - Category ID
   * @param {Object} options - Options for category assignment
   * @returns {Promise<Object>} Result of the operation
   */
  addToCategory: async function (categoryId, options = {}) {
    if (!categoryId) {
      throw new Error("Category ID is required");
    }

    try {
      const PostCategory = mongoose.model("PostCategory");
      const result = await PostCategory.addCategoryToPost(
        this._id,
        categoryId,
        options
      );

      // Update post's categories array if not already included
      if (!this.categories.includes(categoryId)) {
        this.categories.push(categoryId);

        // If marked as primary, update primary category field
        if (options.isPrimary) {
          this.primaryCategory = categoryId;
        }

        await this.save();
      }

      return result;
    } catch (error) {
      console.error("Error adding post to category:", error);
      throw error;
    }
  },

  /**
   * Remove post from a category
   * @param {ObjectId} categoryId - Category ID
   * @returns {Promise<Object>} Result of the operation
   */
  removeFromCategory: async function (categoryId) {
    if (!categoryId) {
      throw new Error("Category ID is required");
    }

    try {
      const PostCategory = mongoose.model("PostCategory");
      const result = await PostCategory.removeCategoryFromPost(
        this._id,
        categoryId
      );

      // Update post's categories array
      this.categories = this.categories.filter(
        (cat) => cat.toString() !== categoryId.toString()
      );

      // If this was the primary category, unset primary
      if (
        this.primaryCategory &&
        this.primaryCategory.toString() === categoryId.toString()
      ) {
        this.primaryCategory = null;
      }

      await this.save();

      return result;
    } catch (error) {
      console.error("Error removing post from category:", error);
      throw error;
    }
  },

  /**
   * Tag a user in the post
   * @param {ObjectId} userId - User ID to tag
   * @param {ObjectId} taggerId - User ID doing the tagging
   * @param {Object} options - Tag options (mediaId, coordinates)
   * @returns {Promise<Object>} Result of the operation
   */
  tagUser: async function (userId, taggerId, options = {}) {
    if (!userId || !taggerId) {
      throw new Error("User ID and tagger ID are required");
    }

    try {
      const PostTag = mongoose.model("PostTag");
      const tag = await PostTag.tagUser(
        this._id,
        userId,
        taggerId,
        options.mediaId || null,
        options.coordinates || null
      );

      // If tag is approved, update post's tags array
      if (tag.status === "approved" && !this.tags.includes(userId)) {
        this.tags.push(userId);
        await this.save();
      }

      return tag;
    } catch (error) {
      console.error("Error tagging user in post:", error);
      throw error;
    }
  },

  /**
   * Remove user tag from post
   * @param {ObjectId} userId - User ID to untag
   * @returns {Promise<Object>} Result of the operation
   */
  removeTag: async function (userId) {
    if (!userId) {
      throw new Error("User ID is required");
    }

    try {
      const PostTag = mongoose.model("PostTag");
      const result = await PostTag.removeTag(this._id, userId);

      // Update post's tags array
      if (result.removed) {
        this.tags = this.tags.filter(
          (tag) => tag.toString() !== userId.toString()
        );
        await this.save();
      }

      return result;
    } catch (error) {
      console.error("Error removing tag from post:", error);
      throw error;
    }
  },

  /**
   * Toggle like on post
   * @param {ObjectId} userId - User ID liking/unliking the post
   * @returns {Promise<Object>} Result of the operation
   */
  toggleLike: async function (userId) {
    if (!userId) {
      throw new Error("User ID is required");
    }

    try {
      const Like = mongoose.model("Like");
      return Like.toggleLike(userId, "Post", this._id);
    } catch (error) {
      console.error("Error toggling like on post:", error);
      throw error;
    }
  },

  /**
   * Check if a user has liked this post
   * @param {ObjectId} userId - User ID to check
   * @returns {Promise<Boolean>} Whether user has liked post
   */
  isLikedBy: async function (userId) {
    if (!userId) {
      throw new Error("User ID is required");
    }

    try {
      const Like = mongoose.model("Like");
      return Like.hasUserLiked(userId, "Post", this._id);
    } catch (error) {
      console.error("Error checking if post liked by user:", error);
      throw error;
    }
  },

  /**
   * Increment a specific engagement metric
   * @param {String} metric - Metric to increment (viewsCount, likesCount, etc.)
   * @param {Number} amount - Amount to increment by (default: 1)
   * @returns {Promise<Object>} Updated post
   */
  incrementEngagement: async function (metric, amount = 1) {
    try {
      // Check if it's a top-level metric like likes_count or comments_count
      if (metric === "likes_count" || metric === "comments_count") {
        this[metric] += amount;
      }
      // Check if it's a nested engagement metric
      else if (this.engagement.hasOwnProperty(metric)) {
        this.engagement[metric] += amount;
      } else {
        throw new Error("Valid engagement metric is required");
      }

      await this.save();
      return this;
    } catch (error) {
      console.error(`Error incrementing ${metric}:`, error);
      throw error;
    }
  },

  /**
   * Get hashtag analytics for post
   * @returns {Promise<Object>} Hashtag analytics
   */
  getHashtagAnalytics: async function () {
    try {
      const PostHashtag = mongoose.model("PostHashtag");
      return PostHashtag.getHashtagAnalytics(this._id);
    } catch (error) {
      console.error("Error getting hashtag analytics:", error);
      throw error;
    }
  },

  /**
   * Mark post as edited
   * @returns {Promise<Object>} Updated post
   */
  markAsEdited: async function () {
    this.isEdited = true;
    this.lastEditedAt = new Date();
    await this.save();
    return this;
  },

  /**
   * Change post visibility
   * @param {String} visibility - New visibility setting
   * @returns {Promise<Object>} Updated post
   */
  changeVisibility: async function (visibility) {
    if (
      !visibility ||
      !["public", "followers", "private"].includes(visibility)
    ) {
      throw new Error("Valid visibility option is required");
    }

    this.accessControl.visibility = visibility;
    await this.save();
    return this;
  },

  /**
   * Soft delete post
   * @returns {Promise<Object>} Updated post
   */
  softDelete: async function () {
    this.isDeleted = true;
    await this.save();
    return this;
  },

  /**
   * Restore deleted post
   * @returns {Promise<Object>} Updated post
   */
  restore: async function () {
    this.isDeleted = false;
    await this.save();
    return this;
  },

  /**
   * Archive post
   * @returns {Promise<Object>} Updated post
   */
  archive: async function () {
    this.isArchived = true;
    this.publishingDetails.status = "archived";
    await this.save();
    return this;
  },

  /**
   * Unarchive post
   * @returns {Promise<Object>} Updated post
   */
  unarchive: async function () {
    this.isArchived = false;
    this.publishingDetails.status = "published";
    await this.save();
    return this;
  },

  /**
   * Get post viewable by user (with access control)
   * @param {ObjectId} userId - User ID requesting the post
   * @returns {Promise<Object|null>} Post if viewable, null if not
   */
  getVisiblePost: async function (userId) {
    // Public posts are always visible
    if (this.accessControl.visibility === "public") {
      return this;
    }

    // Private or followers posts require additional checks
    if (!userId) {
      return null;
    }

    // For followers-only posts, check if user follows poster
    if (this.accessControl.visibility === "followers") {
      const User = mongoose.model("User");
      const isFollowing = await User.isFollowing(userId, this.user);

      if (!isFollowing && userId.toString() !== this.user.toString()) {
        return null;
      }
    }

    // For private posts, only the owner can view
    if (
      this.accessControl.visibility === "private" &&
      userId.toString() !== this.user.toString()
    ) {
      return null;
    }

    // Check for excluded users
    if (
      this.accessControl.excludedUsers.some(
        (id) => id.toString() === userId.toString()
      )
    ) {
      return null;
    }

    // If restrictedTo array exists and has entries, user must be in it
    if (
      this.accessControl.restrictedTo &&
      this.accessControl.restrictedTo.length > 0 &&
      !this.accessControl.restrictedTo.some(
        (id) => id.toString() === userId.toString()
      )
    ) {
      return null;
    }

    return this;
  },
};

// Static methods
PostSchema.statics = {
  /**
   * Create a new post
   * @param {Object} postData - Post data object
   * @returns {Promise<Object>} Created post
   */
  createPost: async function (postData) {
    if (!postData.user) {
      throw new Error("User ID is required");
    }

    try {
      // Create post
      const post = await this.create(postData);

      // Process hashtags if caption provided
      if (postData.caption) {
        await post.processHashtagsFromCaption();
      }

      // Process categories if provided
      if (postData.categories && Array.isArray(postData.categories)) {
        for (const categoryId of postData.categories) {
          await post.addToCategory(categoryId);
        }
      }

      // Process media if provided
      if (postData.media && Array.isArray(postData.media)) {
        // Update media items to reference this post
        const Media = mongoose.model("Media");
        await Media.updateMany(
          { _id: { $in: postData.media } },
          { $set: { post: post._id } }
        );
      }

      return post;
    } catch (error) {
      console.error("Error creating post:", error);
      throw error;
    }
  },

  /**
   * Get user feed posts
   * @param {ObjectId} userId - User ID
   * @param {Object} options - Feed options
   * @returns {Promise<Array>} Feed posts
   */
  getUserFeed: async function (userId, options = {}) {
    if (!userId) {
      throw new Error("User ID is required");
    }

    const {
      limit = 20,
      skip = 0,
      includeFollowing = true,
      includeCategories = true,
    } = options;

    try {
      // Get user's following list
      const User = mongoose.model("User");
      const userData = await User.findById(userId).select(
        "following followedCategories"
      );

      if (!userData) {
        throw new Error("User not found");
      }

      const followingIds = userData.following || [];
      const followedCategoryIds = userData.followedCategories || [];

      // Build query for feed posts
      const query = {
        isDeleted: false,
        isArchived: false,
        "accessControl.visibility": { $in: ["public", "followers"] },
        "publishingDetails.status": "published",
        excludedUsers: { $ne: userId },
      };

      // Add conditions based on options
      if (includeFollowing && followingIds.length > 0) {
        if (includeCategories && followedCategoryIds.length > 0) {
          // Include posts from followed users OR followed categories
          query.$or = [
            { user: { $in: followingIds } },
            { categories: { $in: followedCategoryIds } },
          ];
        } else {
          // Only include posts from followed users
          query.user = { $in: followingIds };
        }
      } else if (includeCategories && followedCategoryIds.length > 0) {
        // Only include posts from followed categories
        query.categories = { $in: followedCategoryIds };
      } else {
        // Default: show trending posts if no followed users/categories
        return this.getTrendingPosts({ limit, skip });
      }

      // Get posts
      return this.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate("user", "username profilePictureUrl isVerified")
        .populate("media")
        .populate("hashtags", "name")
        .populate("categories", "name slug");
    } catch (error) {
      console.error("Error getting user feed:", error);
      throw error;
    }
  },

  /**
   * Get posts by hashtag
   * @param {String|ObjectId} hashtag - Hashtag name or ID
   * @param {Object} options - Query options
   * @returns {Promise<Array>} Posts with hashtag
   */
  getPostsByHashtag: async function (hashtag, options = {}) {
    if (!hashtag) {
      throw new Error("Hashtag is required");
    }

    const {
      limit = 20,
      skip = 0,
      sortBy = "recent", // 'recent' or 'popular'
    } = options;

    try {
      // Find hashtag ID if name provided
      let hashtagId = hashtag;

      if (
        typeof hashtag === "string" &&
        !mongoose.Types.ObjectId.isValid(hashtag)
      ) {
        const Hashtag = mongoose.model("Hashtag");
        const hashtagDoc = await Hashtag.findOne({
          name: hashtag.toLowerCase(),
        });

        if (!hashtagDoc) {
          return [];
        }

        hashtagId = hashtagDoc._id;
      }

      // Get posts through PostHashtag model
      const PostHashtag = mongoose.model("PostHashtag");

      if (sortBy === "popular") {
        return PostHashtag.getPopularPostsByHashtag(hashtagId, { limit, skip });
      } else {
        return PostHashtag.getRecentPostsByHashtag(hashtagId, { limit, skip });
      }
    } catch (error) {
      console.error("Error getting posts by hashtag:", error);
      throw error;
    }
  },

  /**
   * Get posts by category
   * @param {String|ObjectId} category - Category slug or ID
   * @param {Object} options - Query options
   * @returns {Promise<Array>} Posts in category
   */
  getPostsByCategory: async function (category, options = {}) {
    if (!category) {
      throw new Error("Category is required");
    }

    const {
      limit = 20,
      skip = 0,
      sortBy = "recent", // 'recent' or 'popular'
    } = options;

    try {
      // Find category ID if slug provided
      let categoryId = category;

      if (
        typeof category === "string" &&
        !mongoose.Types.ObjectId.isValid(category)
      ) {
        const Category = mongoose.model("Category");
        const categoryDoc = await Category.findOne({
          slug: category.toLowerCase(),
        });

        if (!categoryDoc) {
          return [];
        }

        categoryId = categoryDoc._id;
      }

      // Build query
      const query = {
        categories: categoryId,
        isDeleted: false,
        isArchived: false,
        "accessControl.visibility": "public",
        "publishingDetails.status": "published",
      };

      // Determine sort order
      let sort = {};
      if (sortBy === "popular") {
        sort = { likes_count: -1, comments_count: -1, createdAt: -1 };
      } else {
        sort = { createdAt: -1 };
      }

      // Get posts
      return this.find(query)
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .populate("user", "username profilePictureUrl isVerified")
        .populate("media")
        .populate("hashtags", "name");
    } catch (error) {
      console.error("Error getting posts by category:", error);
      throw error;
    }
  },

  /**
   * Get user's posts
   * @param {ObjectId} userId - User ID
   * @param {Object} options - Query options
   * @returns {Promise<Array>} User's posts
   */
  getUserPosts: async function (userId, options = {}) {
    if (!userId) {
      throw new Error("User ID is required");
    }

    const {
      limit = 20,
      skip = 0,
      includeArchived = false,
      visitorId = null, // For access control
    } = options;

    try {
      // Build base query
      const query = {
        user: userId,
        isDeleted: false,
      };

      // Handle visibility based on visitor
      if (visitorId && visitorId.toString() === userId.toString()) {
        // User viewing their own posts - show all except deleted
      } else if (visitorId) {
        // Another user viewing - check follow status for followers-only posts
        const User = mongoose.model("User");
        const isFollowing = await User.isFollowing(visitorId, userId);

        if (isFollowing) {
          // Follower can see public and followers posts
          query["accessControl.visibility"] = { $in: ["public", "followers"] };
        } else {
          // Non-follower can only see public posts
          query["accessControl.visibility"] = "public";
        }

        // Add additional visibility filters
        query["publishingDetails.status"] = "published";
        query["excludedUsers"] = { $ne: visitorId };
      } else {
        // Anonymous visitor - only show public posts
        query["accessControl.visibility"] = "public";
        query["publishingDetails.status"] = "published";
      }

      // Handle archived filter
      if (!includeArchived) {
        query.isArchived = false;
      }

      // Get posts
      return this.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate("media")
        .populate("hashtags", "name")
        .populate("categories", "name slug");
    } catch (error) {
      console.error("Error getting user posts:", error);
      throw error;
    }
  },

  /**
   * Get trending posts
   * @param {Object} options - Query options
   * @returns {Promise<Array>} Trending posts
   */
  getTrendingPosts: async function (options = {}) {
    const {
      limit = 20,
      skip = 0,
      timeWindow = 7, // days
      categories = null,
    } = options;

    try {
      // Build query for trending posts
      const date = new Date();
      date.setDate(date.getDate() - timeWindow);

      const query = {
        createdAt: { $gte: date },
        isDeleted: false,
        isArchived: false,
        "accessControl.visibility": "public",
        "publishingDetails.status": "published",
      };

      // Filter by categories if provided
      if (categories && Array.isArray(categories) && categories.length > 0) {
        query.categories = { $in: categories };
      }

      // Get trending posts based on engagement
      return this.find(query)
        .sort({
          likes_count: -1,
          comments_count: -1,
          "engagement.sharesCount": -1,
          createdAt: -1,
        })
        .skip(skip)
        .limit(limit)
        .populate("user", "username profilePictureUrl isVerified")
        .populate("media")
        .populate("hashtags", "name")
        .populate("categories", "name slug");
    } catch (error) {
      console.error("Error getting trending posts:", error);
      throw error;
    }
  },

  /**
   * Search posts
   * @param {Object} params - Search parameters
   * @returns {Promise<Array>} Search results
   */
  searchPosts: async function (params = {}) {
    const {
      query = "",
      hashtags = [],
      categories = [],
      location = null,
      radiusKm = 10,
      startDate = null,
      endDate = null,
      userId = null,
      limit = 20,
      skip = 0,
    } = params;

    try {
      // Build search query
      const searchQuery = {
        isDeleted: false,
        isArchived: false,
        "accessControl.visibility": "public",
        "publishingDetails.status": "published",
      };

      // Text search in caption
      if (query && query.trim() !== "") {
        searchQuery.$text = { $search: query };
      }

      // Filter by hashtags
      if (hashtags && hashtags.length > 0) {
        searchQuery.hashtags = { $in: hashtags };
      }

      // Filter by categories
      if (categories && categories.length > 0) {
        searchQuery.categories = { $in: categories };
      }

      // Filter by date range
      if (startDate || endDate) {
        searchQuery.createdAt = {};

        if (startDate) {
          searchQuery.createdAt.$gte = new Date(startDate);
        }

        if (endDate) {
          searchQuery.createdAt.$lte = new Date(endDate);
        }
      }

      // Filter by user
      if (userId) {
        searchQuery.user = userId;
      }

      // Filter by location
      if (
        location &&
        location.coordinates &&
        location.coordinates.length === 2
      ) {
        searchQuery["location.coordinates"] = {
          $near: {
            $geometry: {
              type: "Point",
              coordinates: [location.coordinates[0], location.coordinates[1]],
            },
            $maxDistance: radiusKm * 1000, // Convert km to meters
          },
        };
      }

      // Execute search
      let searchResults = this.find(searchQuery);

      // Add score sorting if text search is used
      if (query && query.trim() !== "") {
        searchResults = searchResults.sort({ score: { $meta: "textScore" } });
      } else {
        searchResults = searchResults.sort({ createdAt: -1 });
      }

      // Apply pagination and populate
      return searchResults
        .skip(skip)
        .limit(limit)
        .populate("user", "username profilePictureUrl isVerified")
        .populate("media")
        .populate("hashtags", "name")
        .populate("categories", "name slug");
    } catch (error) {
      console.error("Error searching posts:", error);
      throw error;
    }
  },

  /**
   * Get posts liked by a user
   * @param {ObjectId} userId - User ID
   * @param {Object} options - Query options
   * @returns {Promise<Array>} Liked posts
   */
  getLikedPosts: async function (userId, options = {}) {
    if (!userId) {
      throw new Error("User ID is required");
    }

    const { limit = 20, skip = 0 } = options;

    try {
      // Get likes through Like model
      const Like = mongoose.model("Like");
      const likes = await Like.find({
        user: userId,
        likeableType: "Post",
      })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit);

      const postIds = likes.map((like) => like.likeableId);

      // Get actual posts
      return this.find({
        _id: { $in: postIds },
        isDeleted: false,
        "accessControl.visibility": "public",
        "publishingDetails.status": "published",
      })
        .populate("user", "username profilePictureUrl isVerified")
        .populate("media")
        .populate("hashtags", "name");
    } catch (error) {
      console.error("Error getting liked posts:", error);
      throw error;
    }
  },

  /**
   * Get posts where a user is tagged
   * @param {ObjectId} userId - User ID
   * @param {Object} options - Query options
   * @returns {Promise<Array>} Posts with user tagged
   */
  getTaggedPosts: async function (userId, options = {}) {
    if (!userId) {
      throw new Error("User ID is required");
    }

    const {
      limit = 20,
      skip = 0,
      approvedOnly = true,
      visitorId = null, // For access control
    } = options;

    try {
      // Get tags through PostTag model
      const PostTag = mongoose.model("PostTag");

      const tagQuery = {
        taggedUser: userId,
      };

      if (approvedOnly) {
        tagQuery.status = "approved";
      }

      const tags = await PostTag.find(tagQuery)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit);

      const postIds = tags.map((tag) => tag.post);

      // Build post query with access control
      const postQuery = {
        _id: { $in: postIds },
        isDeleted: false,
      };

      // Handle visibility based on visitor
      if (visitorId && visitorId.toString() === userId.toString()) {
        // User viewing their own tagged posts - include all visibilities
      } else {
        // Someone else viewing - only show public posts
        postQuery["accessControl.visibility"] = "public";
        postQuery["publishingDetails.status"] = "published";
        postQuery.isArchived = false;
      }

      // Get actual posts
      return this.find(postQuery)
        .populate("user", "username profilePictureUrl isVerified")
        .populate("media")
        .populate("hashtags", "name");
    } catch (error) {
      console.error("Error getting tagged posts:", error);
      throw error;
    }
  },

  /**
   * Get posts for a specific location
   * @param {String} placeId - Place ID
   * @param {Object} options - Query options
   * @returns {Promise<Array>} Posts at location
   */
  getLocationPosts: async function (placeId, options = {}) {
    if (!placeId) {
      throw new Error("Place ID is required");
    }

    const { limit = 20, skip = 0, sortBy = "recent" } = options;

    try {
      // Build query
      const query = {
        "location.placeId": placeId,
        isDeleted: false,
        isArchived: false,
        "accessControl.visibility": "public",
        "publishingDetails.status": "published",
      };

      // Determine sort order
      let sort = {};
      if (sortBy === "popular") {
        sort = { "engagement.likesCount": -1, createdAt: -1 };
      } else {
        sort = { createdAt: -1 };
      }

      // Get posts
      return this.find(query)
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .populate("user", "username profilePictureUrl isVerified")
        .populate("media")
        .populate("hashtags", "name");
    } catch (error) {
      console.error("Error getting location posts:", error);
      throw error;
    }
  },

  /**
   * Get nearby posts
   * @param {Object} coordinates - [longitude, latitude]
   * @param {Object} options - Query options
   * @returns {Promise<Array>} Nearby posts
   */
  getNearbyPosts: async function (coordinates, options = {}) {
    if (
      !coordinates ||
      !Array.isArray(coordinates) ||
      coordinates.length !== 2
    ) {
      throw new Error("Valid coordinates are required [longitude, latitude]");
    }

    const { radiusKm = 5, limit = 20, skip = 0, maxAgeHours = 24 } = options;

    try {
      // Calculate date threshold
      const dateThreshold = new Date();
      dateThreshold.setHours(dateThreshold.getHours() - maxAgeHours);

      // Build query
      const query = {
        "location.coordinates": {
          $near: {
            $geometry: {
              type: "Point",
              coordinates: coordinates,
            },
            $maxDistance: radiusKm * 1000, // Convert km to meters
          },
        },
        createdAt: { $gte: dateThreshold },
        isDeleted: false,
        isArchived: false,
        "accessControl.visibility": "public",
        "publishingDetails.status": "published",
      };

      // Get posts
      return this.find(query)
        .skip(skip)
        .limit(limit)
        .populate("user", "username profilePictureUrl isVerified")
        .populate("media")
        .populate("hashtags", "name");
    } catch (error) {
      console.error("Error getting nearby posts:", error);
      throw error;
    }
  },

  /**
   * Get scheduled posts for a user
   * @param {ObjectId} userId - User ID
   * @param {Object} options - Query options
   * @returns {Promise<Array>} Scheduled posts
   */
  getScheduledPosts: async function (userId, options = {}) {
    if (!userId) {
      throw new Error("User ID is required");
    }

    const { limit = 20, skip = 0 } = options;

    try {
      return this.find({
        user: userId,
        "publishingDetails.status": "scheduled",
        isDeleted: false,
      })
        .sort({ "publishingDetails.scheduledFor": 1 })
        .skip(skip)
        .limit(limit)
        .populate("media")
        .populate("hashtags", "name")
        .populate("categories", "name slug");
    } catch (error) {
      console.error("Error getting scheduled posts:", error);
      throw error;
    }
  },

  /**
   * Get draft posts for a user
   * @param {ObjectId} userId - User ID
   * @param {Object} options - Query options
   * @returns {Promise<Array>} Draft posts
   */
  getDraftPosts: async function (userId, options = {}) {
    if (!userId) {
      throw new Error("User ID is required");
    }

    const { limit = 20, skip = 0 } = options;

    try {
      return this.find({
        user: userId,
        "publishingDetails.status": "draft",
        isDeleted: false,
      })
        .sort({ updatedAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate("media")
        .populate("hashtags", "name")
        .populate("categories", "name slug");
    } catch (error) {
      console.error("Error getting draft posts:", error);
      throw error;
    }
  },

  /**
   * Get archived posts for a user
   * @param {ObjectId} userId - User ID
   * @param {Object} options - Query options
   * @returns {Promise<Array>} Archived posts
   */
  getArchivedPosts: async function (userId, options = {}) {
    if (!userId) {
      throw new Error("User ID is required");
    }

    const { limit = 20, skip = 0 } = options;

    try {
      return this.find({
        user: userId,
        isArchived: true,
        isDeleted: false,
      })
        .sort({ updatedAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate("media")
        .populate("hashtags", "name")
        .populate("categories", "name slug");
    } catch (error) {
      console.error("Error getting archived posts:", error);
      throw error;
    }
  },

  /**
   * Check all scheduled posts and publish any that are due
   * @returns {Promise<Object>} Result with count of published posts
   */
  processScheduledPosts: async function () {
    try {
      const now = new Date();

      // Find scheduled posts that are due
      const duePosts = await this.find({
        "publishingDetails.status": "scheduled",
        "publishingDetails.scheduledFor": { $lte: now },
        isDeleted: false,
      });

      if (duePosts.length === 0) {
        return { published: 0 };
      }

      // Process each due post
      let publishedCount = 0;

      for (const post of duePosts) {
        // Update post status
        post.publishingDetails.status = "published";
        post.publishingDetails.publishedAt = now;
        await post.save();

        // TODO: Handle any additional publishing tasks (notifications, etc.)

        publishedCount++;
      }

      return { published: publishedCount };
    } catch (error) {
      console.error("Error processing scheduled posts:", error);
      throw error;
    }
  },

  /**
   * Get post analytics
   * @param {ObjectId} postId - Post ID
   * @returns {Promise<Object>} Post analytics
   */
  getPostAnalytics: async function (postId) {
    if (!postId) {
      throw new Error("Post ID is required");
    }

    try {
      // Get post with basic engagement metrics
      const post = await this.findById(postId).select(
        "engagement analytics createdAt"
      );

      if (!post) {
        throw new Error("Post not found");
      }

      // Get hashtag analytics
      const PostHashtag = mongoose.model("PostHashtag");
      const hashtagAnalytics = await PostHashtag.getHashtagAnalytics(postId);

      // Get comment analytics
      const Comment = mongoose.model("Comment");
      const commentCount = await Comment.countDocuments({ post: postId });

      // Calculate engagement rate
      // (likes + comments + shares) / impressions * 100
      const engagementRate =
        post.engagement.impressionsCount > 0
          ? ((post.likes_count +
              post.comments_count +
              post.engagement.sharesCount) /
              post.engagement.impressionsCount) *
            100
          : 0;

      // Compile analytics data
      return {
        engagement: post.engagement,
        hashtags: hashtagAnalytics,
        commentCount,
        engagementRate: parseFloat(engagementRate.toFixed(2)),
        growth: {
          last24Hours: {
            views: post.analytics?.last24Hours?.views || 0,
            likes: post.analytics?.last24Hours?.likes || 0,
            comments: post.analytics?.last24Hours?.comments || 0,
          },
          last7Days: {
            views: post.analytics?.last7Days?.views || 0,
            likes: post.analytics?.last7Days?.likes || 0,
            comments: post.analytics?.last7Days?.comments || 0,
          },
        },
        createdAt: post.createdAt,
      };
    } catch (error) {
      console.error("Error getting post analytics:", error);
      throw error;
    }
  },

  /**
   * Suggest hashtags for a post
   * @param {Object} postData - Post data object
   * @param {Object} options - Suggestion options
   * @returns {Promise<Array>} Suggested hashtags
   */
  suggestHashtags: async function (postData, options = {}) {
    if (!postData) {
      throw new Error("Post data is required");
    }

    try {
      const PostHashtag = mongoose.model("PostHashtag");
      return PostHashtag.suggestHashtags(postData, options);
    } catch (error) {
      console.error("Error suggesting hashtags:", error);
      throw error;
    }
  },

  /**
   * Update post engagement metrics after a period of time
   * @param {ObjectId} postId - Post ID
   * @returns {Promise<Object>} Updated analytics
   */
  updateEngagementMetrics: async function (postId) {
    if (!postId) {
      throw new Error("Post ID is required");
    }

    try {
      const post = await this.findById(postId);

      if (!post) {
        throw new Error("Post not found");
      }

      // Get current engagement metrics
      const likesCount = post.likes_count;
      const commentsCount = post.comments_count;
      const { sharesCount, impressionsCount } = post.engagement;

      // Calculate engagement rate
      const engagementRate =
        impressionsCount > 0
          ? ((likesCount + commentsCount + sharesCount) / impressionsCount) *
            100
          : 0;

      // Update analytics
      post.analytics = post.analytics || {};
      post.analytics.engagementRate = parseFloat(engagementRate.toFixed(2));

      // Store metrics history
      const now = new Date();

      // Store last 24 hours metrics
      post.analytics.last24Hours = {
        timestamp: now,
        views: post.engagement.viewsCount,
        likes: post.likes_count,
        comments: post.comments_count,
        shares: post.engagement.sharesCount,
      };

      // Store weekly metrics if post is at least a week old
      const oneWeekAgo = new Date();
      oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

      if (post.createdAt < oneWeekAgo) {
        post.analytics.last7Days = {
          timestamp: now,
          views: post.engagement.viewsCount,
          likes: post.likes_count,
          comments: post.comments_count,
          shares: post.engagement.sharesCount,
        };
      }

      await post.save();

      return post.analytics;
    } catch (error) {
      console.error("Error updating engagement metrics:", error);
      throw error;
    }
  },
};

// Middleware: process hashtags, media, etc. before saving
PostSchema.pre("save", async function (next) {
  try {
    // If new post with caption, process hashtags
    if (this.isNew && this.caption) {
      const PostHashtag = mongoose.model("PostHashtag");
      await PostHashtag.processHashtagsFromText(this._id, this.caption);
    }

    // If caption was modified, update hashtag positions
    if (!this.isNew && this.isModified("caption")) {
      const PostHashtag = mongoose.model("PostHashtag");
      await PostHashtag.updateHashtagPositions(this._id, this.caption);

      // Mark as edited
      this.isEdited = true;
      this.lastEditedAt = new Date();
    }

    next();
  } catch (error) {
    next(error);
  }
});

// Create text index for search
PostSchema.index({ caption: "text" });

const Post = mongoose.model("Post", PostSchema);

module.exports = Post;
