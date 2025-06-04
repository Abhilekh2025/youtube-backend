import mongoose, { Schema } from "mongoose";

/**
 * PostHashtag Schema
 * Manages the many-to-many relationship between posts and hashtags
 * with additional metadata about the relationship.
 */
const PostHashtagSchema = new Schema(
  {
    post: {
      type: Schema.Types.ObjectId,
      ref: "Post",
      required: true,
    },
    hashtag: {
      type: Schema.Types.ObjectId,
      ref: "Hashtag",
      required: true,
    },
    position: {
      start: Number,
      end: Number,
    },
    addedBy: {
      type: String,
      enum: ["user", "system", "ai"],
      default: "user",
    },
    tagged_at: {
      type: Date,
      default: Date.now,
    },
    // Track if auto-categorization was performed based on this hashtag
    categorization: {
      performed: {
        type: Boolean,
        default: false,
      },
      categories: [
        {
          category: {
            type: Schema.Types.ObjectId,
            ref: "Category",
          },
          confidence: {
            type: Number,
            min: 0,
            max: 1,
            default: 1,
          },
        },
      ],
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Create compound index to ensure a hashtag can only be associated once with a post
PostHashtagSchema.index({ post: 1, hashtag: 1 }, { unique: true });
// Create index for getting hashtags for a specific post
PostHashtagSchema.index({ post: 1 });
// Index for retrieving posts with a specific hashtag
PostHashtagSchema.index({ hashtag: 1, createdAt: -1 });
// Index for categorization tracking
PostHashtagSchema.index({ "categorization.performed": 1 });

// Static methods
PostHashtagSchema.statics = {
  /**
   * Associate multiple hashtags with a post
   * @param {ObjectId} postId - The post ID
   * @param {Array<ObjectId>} hashtagIds - Array of hashtag IDs
   * @param {Array<Object>} positions - Optional array of position objects {start, end}
   * @returns {Promise} Result of the bulk operation
   */

  associateHashtags: async function (postId, hashtagIds, positions = []) {
    // Input validation
    if (!postId) throw new Error("Post ID is required");
    if (!hashtagIds || !Array.isArray(hashtagIds)) {
      throw new Error("Hashtag IDs must be an array");
    }

    const operations = [];

    for (let i = 0; i < hashtagIds.length; i++) {
      const hashtagId = hashtagIds[i];
      const position = positions[i] || null;

      if (!hashtagId) continue; // Skip empty IDs

      operations.push({
        updateOne: {
          filter: { post: postId, hashtag: hashtagId },
          update: {
            $set: {
              post: postId,
              hashtag: hashtagId,
              position: position,
              tagged_at: new Date(),
            },
          },
          upsert: true,
        },
      });
    }

    if (operations.length > 0) {
      return this.bulkWrite(operations);
    }

    return { ok: 1, nModified: 0 };
  },

  /**
   * Remove a hashtag from a post
   * @param {ObjectId} postId - The post ID
   * @param {ObjectId} hashtagId - The hashtag ID to remove
   * @returns {Promise<Object>} Result with removed status
   */
  removeHashtag: async function (postId, hashtagId) {
    if (!postId || !hashtagId) {
      throw new Error("Post ID and hashtag ID are required");
    }

    try {
      const result = await this.findOneAndDelete({
        post: postId,
        hashtag: hashtagId,
      });

      if (result) {
        // Update post's hashtags array
        const Post = mongoose.model("Post");
        await Post.findByIdAndUpdate(postId, {
          $pull: { hashtags: hashtagId },
        });

        // Update hashtag's post count
        const Hashtag = mongoose.model("Hashtag");
        await Hashtag.findByIdAndUpdate(hashtagId, {
          $inc: { postCount: -1 },
        });
      }

      return { removed: !!result };
    } catch (error) {
      console.error("Error removing hashtag:", error);
      throw error;
    }
  },

  /**
   * Remove all hashtags from a post
   * @param {ObjectId} postId - The post ID
   * @returns {Promise<Object>} Result with count of removed hashtags
   */
  removeAllHashtags: async function (postId) {
    if (!postId) {
      throw new Error("Post ID is required");
    }

    try {
      const postHashtags = await this.find({ post: postId });
      const hashtagIds = postHashtags.map((ph) => ph.hashtag);

      await this.deleteMany({ post: postId });

      // Update post's hashtags array
      const Post = mongoose.model("Post");
      await Post.findByIdAndUpdate(postId, {
        $set: { hashtags: [] },
      });

      // Update each hashtag's post count
      const Hashtag = mongoose.model("Hashtag");
      if (hashtagIds.length > 0) {
        await Hashtag.updateMany(
          { _id: { $in: hashtagIds } },
          { $inc: { postCount: -1 } }
        );
      }

      return { removed: postHashtags.length };
    } catch (error) {
      console.error("Error removing all hashtags:", error);
      throw error;
    }
  },

  /**
   * Get hashtags for a post
   * @param {ObjectId} postId - The post ID
   * @returns {Promise<Array>} Post hashtags with populated hashtag info
   */
  getPostHashtags: async function (postId) {
    if (!postId) {
      throw new Error("Post ID is required");
    }

    return this.find({ post: postId }).populate("hashtag", "name postCount");
  },

  /**
   * Get recent posts for a hashtag
   * @param {ObjectId} hashtagId - The hashtag ID
   * @param {Object} options - Query options (limit, skip)
   * @returns {Promise<Array>} Recent posts with this hashtag
   */
  getRecentPostsByHashtag: async function (hashtagId, options = {}) {
    if (!hashtagId) {
      throw new Error("Hashtag ID is required");
    }

    const { limit = 20, skip = 0 } = options;

    const postHashtags = await this.find({ hashtag: hashtagId })
      .sort({ tagged_at: -1 })
      .skip(skip)
      .limit(limit)
      .populate({
        path: "post",
        match: {
          isDeleted: false,
          isArchived: false,
          "accessControl.visibility": "public",
          "publishingDetails.status": { $in: ["published", null] },
        },
        populate: [
          { path: "user", select: "username profilePictureUrl isVerified" },
          { path: "media", select: "url mediaType thumbnail" },
        ],
      });

    // Filter out null posts (those that didn't match the criteria in the populate match)
    return postHashtags.filter((ph) => ph.post).map((ph) => ph.post);
  },

  /**
   * Get popular posts for a hashtag
   * @param {ObjectId} hashtagId - The hashtag ID
   * @param {Object} options - Query options (limit, skip, timeWindow)
   * @returns {Promise<Array>} Popular posts with this hashtag
   */
  getPopularPostsByHashtag: async function (hashtagId, options = {}) {
    if (!hashtagId) {
      throw new Error("Hashtag ID is required");
    }

    const { limit = 20, skip = 0, timeWindow = 7 } = options; // default 7 days

    const date = new Date();
    date.setDate(date.getDate() - timeWindow);

    // Get post IDs with this hashtag in the timeframe
    const postIds = await this.find({
      hashtag: hashtagId,
      createdAt: { $gte: date },
    }).distinct("post");

    if (postIds.length === 0) {
      return [];
    }

    // Get popular posts from those IDs
    const Post = mongoose.model("Post");
    return Post.find({
      _id: { $in: postIds },
      isDeleted: false,
      isArchived: false,
      "accessControl.visibility": "public",
      "publishingDetails.status": { $in: ["published", null] },
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
  /**
   * Process hashtags from text and associate with post
   * @param {ObjectId} postId - The post ID
   * @param {String} text - The text to extract hashtags from
   * @returns {Promise<Array>} Processed hashtags
   */
  processHashtagsFromText: async function (postId, text) {
    if (!postId) {
      throw new Error("Post ID is required");
    }

    if (!text) return [];

    try {
      const Hashtag = mongoose.model("Hashtag");
      const hashtags = await Hashtag.extractFromText(text);

      if (hashtags.length === 0) {
        return [];
      }

      const hashtagIds = hashtags.map((tag) => tag._id);

      // Find positions for each hashtag in the text
      const positions = [];
      for (const hashtag of hashtags) {
        const regex = new RegExp(`#${hashtag.name}\\b`, "gi");
        let match;

        while ((match = regex.exec(text)) !== null) {
          positions.push({
            hashtagId: hashtag._id,
            position: {
              start: match.index,
              end: match.index + match[0].length,
            },
          });
          break; // Just get the first occurrence
        }
      }

      // Update post with hashtag references
      const Post = mongoose.model("Post");
      await Post.findByIdAndUpdate(postId, {
        $set: { hashtags: hashtagIds },
      });

      // Create PostHashtag associations with positions
      const associations = [];
      for (const hashtag of hashtags) {
        const positionData = positions.find(
          (p) => p.hashtagId.toString() === hashtag._id.toString()
        );

        associations.push({
          post: postId,
          hashtag: hashtag._id,
          position: positionData ? positionData.position : null,
          addedBy: "user", // Assuming direct user input from caption
        });
      }

      // Bulk insert
      await this.insertMany(associations);

      // Now run auto-categorization based on hashtags
      await this.performAutoCategorization(postId, hashtagIds);

      return hashtags;
    } catch (error) {
      console.error("Error processing hashtags from text:", error);
      throw error;
    }
  },

  /**
   * Auto-categorize post based on hashtags
   * @param {ObjectId} postId - The post ID
   * @param {Array<ObjectId>} hashtagIds - The hashtag IDs
   * @returns {Promise<Object>} Categorization results
   */
  performAutoCategorization: async function (postId, hashtagIds) {
    if (!postId) {
      throw new Error("Post ID is required");
    }

    // Skip if no hashtags
    if (!hashtagIds || hashtagIds.length === 0) {
      return { categorized: false };
    }

    try {
      // Get hashtag objects with their related categories
      const Hashtag = mongoose.model("Hashtag");
      const hashtags = await Hashtag.find({
        _id: { $in: hashtagIds },
      }).select("relatedCategories");

      // Collect all categories that should be auto-assigned
      const categoryAssignments = [];

      for (const hashtag of hashtags) {
        // Filter for categories with auto-tagging enabled
        const autoCategories = (hashtag.relatedCategories || []).filter(
          (rel) => rel.autoTaggingEnabled
        );

        for (const catRel of autoCategories) {
          // Add to our assignments list
          const existingAssignment = categoryAssignments.find(
            (ca) => ca.categoryId.toString() === catRel.category.toString()
          );

          if (existingAssignment) {
            // Increase confidence if found through multiple hashtags
            existingAssignment.confidence = Math.min(
              1.0,
              existingAssignment.confidence + 0.2
            );
            existingAssignment.strength = Math.max(
              existingAssignment.strength,
              catRel.strength
            );
          } else {
            categoryAssignments.push({
              categoryId: catRel.category,
              confidence: 0.8, // Start with 0.8 for hashtag-based assignments
              strength: catRel.strength,
            });
          }
        }
      }

      // If no categories to assign, we're done
      if (categoryAssignments.length === 0) {
        return { categorized: false };
      }

      // Add categories to post
      const PostCategory = mongoose.model("PostCategory");
      const results = [];

      for (const assignment of categoryAssignments) {
        // The highest strength category should be primary
        const isPrimary =
          assignment ===
          categoryAssignments.reduce(
            (max, current) => (current.strength > max.strength ? current : max),
            categoryAssignments[0]
          );

        const result = await PostCategory.addCategoryToPost(
          postId,
          assignment.categoryId,
          {
            isPrimary: isPrimary,
            relevanceScore: assignment.strength,
            addedBy: "auto",
            confidence: assignment.confidence,
          }
        );

        results.push(result);
      }

      // Mark these hashtags as having triggered categorization
      for (const hashtagId of hashtagIds) {
        await this.updateMany(
          { post: postId, hashtag: hashtagId },
          {
            $set: {
              "categorization.performed": true,
              "categorization.categories": categoryAssignments.map((ca) => ({
                category: ca.categoryId,
                confidence: ca.confidence,
              })),
            },
          }
        );
      }

      return {
        categorized: true,
        categories: results.length,
        results,
      };
    } catch (error) {
      console.error("Error performing auto-categorization:", error);
      throw error;
    }
  },

  /**
   * Get hashtags that frequently appear together
   * @param {ObjectId} hashtagId - The hashtag ID
   * @param {Object} options - Query options (limit)
   * @returns {Promise<Array>} Related hashtags
   */
  getRelatedHashtags: async function (hashtagId, options = {}) {
    if (!hashtagId) {
      throw new Error("Hashtag ID is required");
    }

    const { limit = 10 } = options;

    try {
      // Get posts containing this hashtag
      const postIds = await this.find({
        hashtag: hashtagId,
      }).distinct("post");

      if (postIds.length === 0) {
        return [];
      }

      // Find other hashtags used in these posts
      const relatedHashtagsAgg = await this.aggregate([
        {
          $match: {
            post: { $in: postIds },
            hashtag: { $ne: mongoose.Types.ObjectId(hashtagId) },
          },
        },
        {
          $group: {
            _id: "$hashtag",
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

      if (relatedHashtagsAgg.length === 0) {
        return [];
      }

      // Get the actual hashtag documents
      const relatedHashtagIds = relatedHashtagsAgg.map((item) => item._id);
      const Hashtag = mongoose.model("Hashtag");
      const hashtags = await Hashtag.find({ _id: { $in: relatedHashtagIds } });

      // Sort by co-occurrence count
      const idToCountMap = {};
      relatedHashtagsAgg.forEach((item) => {
        idToCountMap[item._id.toString()] = item.count;
      });

      return hashtags
        .map((hashtag) => ({
          _id: hashtag._id,
          name: hashtag.name,
          occurrenceCount: idToCountMap[hashtag._id.toString()] || 0,
          coOccurrencePercentage: Math.round(
            (idToCountMap[hashtag._id.toString()] / postIds.length) * 100
          ),
        }))
        .sort((a, b) => b.occurrenceCount - a.occurrenceCount);
    } catch (error) {
      console.error("Error getting related hashtags:", error);
      throw error;
    }
  },
  /**
   * Get hashtags for a specific category
   * @param {ObjectId} categoryId - The category ID
   * @param {Object} options - Query options (limit)
   * @returns {Promise<Array>} Hashtags for the category
   */
  getHashtagsByCategory: async function (categoryId, options = {}) {
    if (!categoryId) {
      throw new Error("Category ID is required");
    }

    const { limit = 20 } = options;

    try {
      const Hashtag = mongoose.model("Hashtag");
      return Hashtag.find({
        "relatedCategories.category": categoryId,
      })
        .sort({ postCount: -1 })
        .limit(limit);
    } catch (error) {
      console.error("Error getting hashtags by category:", error);
      throw error;
    }
  },

  /**
   * Get top hashtags for a user
   * @param {ObjectId} userId - The user ID
   * @param {Object} options - Query options (limit)
   * @returns {Promise<Array>} User's top hashtags
   */
  getUserTopHashtags: async function (userId, options = {}) {
    if (!userId) {
      throw new Error("User ID is required");
    }

    const { limit = 10 } = options;

    try {
      // Get posts by this user
      const Post = mongoose.model("Post");
      const userPostIds = await Post.find({
        user: userId,
        isDeleted: false,
      }).distinct("_id");

      if (userPostIds.length === 0) {
        return [];
      }

      // Find most used hashtags
      const topHashtagsAgg = await this.aggregate([
        {
          $match: { post: { $in: userPostIds } },
        },
        {
          $group: {
            _id: "$hashtag",
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

      if (topHashtagsAgg.length === 0) {
        return [];
      }

      // Get the hashtag documents
      const hashtagIds = topHashtagsAgg.map((item) => item._id);
      const Hashtag = mongoose.model("Hashtag");
      const hashtags = await Hashtag.find({ _id: { $in: hashtagIds } });

      // Sort by usage count
      const idToCountMap = {};
      topHashtagsAgg.forEach((item) => {
        idToCountMap[item._id.toString()] = item.count;
      });

      return hashtags
        .map((hashtag) => ({
          _id: hashtag._id,
          name: hashtag.name,
          usageCount: idToCountMap[hashtag._id.toString()] || 0,
        }))
        .sort((a, b) => b.usageCount - a.usageCount);
    } catch (error) {
      console.error("Error getting user top hashtags:", error);
      throw error;
    }
  },

  /**
   * Calculate hashtag analytics for a post
   * @param {ObjectId} postId - The post ID
   * @returns {Promise<Object>} Hashtag analytics
   */
  getHashtagAnalytics: async function (postId) {
    if (!postId) {
      throw new Error("Post ID is required");
    }

    try {
      // Get hashtags used in this post
      const postHashtags = await this.find({ post: postId }).populate(
        "hashtag",
        "name postCount usageStats"
      );

      if (postHashtags.length === 0) {
        return {
          count: 0,
          hashtags: [],
          potentialReach: 0,
          avgTrendingScore: 0,
        };
      }

      // Get follower counts for these hashtags
      const Hashtag = mongoose.model("Hashtag");
      const hashtagIds = postHashtags.map((ph) => ph.hashtag._id);
      const hashtagData = await Hashtag.find({
        _id: { $in: hashtagIds },
      }).select("name postCount followersCount usageStats.last24Hours");

      // Calculate stats
      const hashtagMap = {};
      hashtagData.forEach((h) => {
        hashtagMap[h._id.toString()] = h;
      });

      const analytics = {
        count: postHashtags.length,
        hashtags: postHashtags.map((ph) => ({
          name: ph.hashtag.name,
          postCount: ph.hashtag.postCount,
          followersCount:
            hashtagMap[ph.hashtag._id.toString()]?.followersCount || 0,
          trendingScore:
            hashtagMap[ph.hashtag._id.toString()]?.usageStats?.last24Hours || 0,
          positionInCaption: ph.position || null,
        })),
        potentialReach: hashtagData.reduce(
          (sum, h) => sum + (h.followersCount || 0),
          0
        ),
        avgTrendingScore:
          hashtagData.reduce(
            (sum, h) => sum + (h.usageStats?.last24Hours || 0),
            0
          ) / hashtagData.length,
      };

      return analytics;
    } catch (error) {
      console.error("Error getting hashtag analytics:", error);
      throw error;
    }
  },

  /**
   * Suggest hashtags based on post content and categories
   * @param {Object} postData - Post data object
   * @param {Object} options - Options for suggestions
   * @returns {Promise<Array>} Suggested hashtags
   */
  suggestHashtags: async function (postData, options = {}) {
    if (!postData) {
      throw new Error("Post data is required");
    }

    const {
      caption = "",
      categoryIds = [],
      limit = 10,
      excludeExisting = true,
      minPostCount = 5,
    } = options;

    try {
      // Collection of hashtag suggestions with sources and relevance
      const suggestions = [];

      // 1. Extract existing hashtags from caption to exclude
      const existingHashtags = [];
      const hashtagRegex = /#(\w+)/g;
      let match;

      while ((match = hashtagRegex.exec(caption)) !== null) {
        existingHashtags.push(match[1].toLowerCase());
      }

      // 2. Get popular hashtags from categories
      if (categoryIds && categoryIds.length > 0) {
        const Hashtag = mongoose.model("Hashtag");
        const categoryHashtags = await Hashtag.find({
          "relatedCategories.category": { $in: categoryIds },
          postCount: { $gte: minPostCount },
          "moderationStatus.status": { $ne: "banned" },
        })
          .sort({ postCount: -1 })
          .limit(limit * 2); // Get more to allow for filtering

        for (const hashtag of categoryHashtags) {
          if (excludeExisting && existingHashtags.includes(hashtag.name)) {
            continue;
          }

          // Get the category relationship strength
          let maxStrength = 0;
          let primaryCategory = null;

          for (const rel of hashtag.relatedCategories) {
            if (
              categoryIds.includes(rel.category.toString()) &&
              rel.strength > maxStrength
            ) {
              maxStrength = rel.strength;
              primaryCategory = rel.category;
            }
          }

          suggestions.push({
            hashtag: hashtag,
            relevance: maxStrength / 100, // Convert to 0-1 scale
            source: "category",
            categoryId: primaryCategory,
          });
        }
      }

      // 3. Text-based suggestions from caption keywords
      if (caption && caption.trim().length > 0) {
        // Extract meaningful keywords
        const stopWords = [
          "the",
          "and",
          "in",
          "on",
          "at",
          "to",
          "of",
          "for",
          "with",
          "a",
          "an",
        ];
        const keywords = caption
          .toLowerCase()
          .replace(/[^\w\s]/g, " ") // Remove punctuation
          .split(/\s+/) // Split by whitespace
          .filter((word) => word.length > 3 && !stopWords.includes(word)); // Remove short words and stop words

        if (keywords.length > 0) {
          // Search for hashtags containing these keywords
          const Hashtag = mongoose.model("Hashtag");

          for (const keyword of keywords.slice(0, 5)) {
            // Limit to top 5 keywords
            const keywordHashtags = await Hashtag.find({
              name: { $regex: keyword, $options: "i" },
              postCount: { $gte: minPostCount },
              "moderationStatus.status": { $ne: "banned" },
            })
              .sort({ postCount: -1 })
              .limit(5);

            for (const hashtag of keywordHashtags) {
              if (excludeExisting && existingHashtags.includes(hashtag.name)) {
                continue;
              }

              // Check if already added from category suggestions
              const existing = suggestions.findIndex(
                (s) => s.hashtag._id.toString() === hashtag._id.toString()
              );

              if (existing >= 0) {
                // Update relevance if higher
                const textRelevance = 0.7; // Base relevance for text matches
                if (textRelevance > suggestions[existing].relevance) {
                  suggestions[existing].relevance = textRelevance;
                  suggestions[existing].source = "text";
                }
              } else {
                suggestions.push({
                  hashtag: hashtag,
                  relevance: 0.7, // Base relevance for text matches
                  source: "text",
                  keyword: keyword,
                });
              }
            }
          }
        }
      }

      // 4. Trending hashtags as additional suggestions if we need more
      if (suggestions.length < limit) {
        const neededCount = limit - suggestions.length;
        const Hashtag = mongoose.model("Hashtag");

        const trendingHashtags = await Hashtag.find({
          "moderationStatus.status": { $ne: "banned" },
          "usageStats.last24Hours": { $gt: 0 },
        })
          .sort({ "usageStats.last24Hours": -1 })
          .limit(neededCount * 2); // Get extras to account for filtering

        for (const hashtag of trendingHashtags) {
          if (excludeExisting && existingHashtags.includes(hashtag.name)) {
            continue;
          }

          // Check if already in suggestions
          const existing = suggestions.findIndex(
            (s) => s.hashtag._id.toString() === hashtag._id.toString()
          );

          if (existing < 0) {
            suggestions.push({
              hashtag: hashtag,
              relevance: 0.5, // Base relevance for trending hashtags
              source: "trending",
              trendingScore: hashtag.usageStats?.last24Hours || 0,
            });
          }
        }
      }

      // 5. Sort by relevance and return top results
      return suggestions
        .sort((a, b) => b.relevance - a.relevance)
        .slice(0, limit)
        .map((suggestion) => ({
          _id: suggestion.hashtag._id,
          name: suggestion.hashtag.name,
          postCount: suggestion.hashtag.postCount,
          relevance: suggestion.relevance,
          source: suggestion.source,
          ...(suggestion.categoryId && { categoryId: suggestion.categoryId }),
          ...(suggestion.keyword && { keyword: suggestion.keyword }),
          ...(suggestion.trendingScore && {
            trendingScore: suggestion.trendingScore,
          }),
        }));
    } catch (error) {
      console.error("Error suggesting hashtags:", error);
      throw error;
    }
  },

  /**
   * Check if a post contains a specific hashtag
   * @param {ObjectId} postId - The post ID
   * @param {ObjectId} hashtagId - The hashtag ID
   * @returns {Promise<Boolean>} Whether the post contains the hashtag
   */
  hasHashtag: async function (postId, hashtagId) {
    if (!postId || !hashtagId) {
      throw new Error("Post ID and Hashtag ID are required");
    }

    const count = await this.countDocuments({
      post: postId,
      hashtag: hashtagId,
    });

    return count > 0;
  },

  /**
   * Get trending hashtags for a time period
   * @param {Object} options - Query options
   * @returns {Promise<Array>} Trending hashtags
   */
  getTrendingHashtags: async function (options = {}) {
    const {
      limit = 20,
      timeWindow = "last24Hours", // 'last24Hours', 'last7Days', 'last30Days'
      category = null,
    } = options;

    try {
      const Hashtag = mongoose.model("Hashtag");
      const query = {
        postCount: { $gt: 0 },
        "moderationStatus.status": { $ne: "banned" },
        [`usageStats.${timeWindow}`]: { $gt: 0 },
      };

      // Add category filter if specified
      if (category) {
        query["relatedCategories.category"] = category;
      }

      return Hashtag.find(query)
        .sort({ [`usageStats.${timeWindow}`]: -1 })
        .limit(limit)
        .select("name postCount followersCount usageStats");
    } catch (error) {
      console.error("Error getting trending hashtags:", error);
      throw error;
    }
  },

  /**
   * Update hashtag positions in a post after text edit
   * @param {ObjectId} postId - The post ID
   * @param {String} newText - The updated text
   * @returns {Promise<Object>} Update results
   */
  updateHashtagPositions: async function (postId, newText) {
    if (!postId || !newText) {
      throw new Error("Post ID and new text are required");
    }

    try {
      // Get existing hashtags for this post
      const postHashtags = await this.find({ post: postId }).populate(
        "hashtag",
        "name"
      );

      if (postHashtags.length === 0) {
        return { updated: 0 };
      }

      // Find new positions for each hashtag
      const updates = [];

      for (const ph of postHashtags) {
        const hashtagName = ph.hashtag.name;
        const regex = new RegExp(`#${hashtagName}\\b`, "gi");
        let match;
        let newPosition = null;

        // Find the first occurrence in the new text
        if ((match = regex.exec(newText)) !== null) {
          newPosition = {
            start: match.index,
            end: match.index + match[0].length,
          };
        }

        // Only update if position changed
        if (newPosition) {
          updates.push({
            updateOne: {
              filter: { _id: ph._id },
              update: { $set: { position: newPosition } },
            },
          });
        }
      }

      if (updates.length > 0) {
        const result = await this.bulkWrite(updates);
        return { updated: result.modifiedCount || 0 };
      }

      return { updated: 0 };
    } catch (error) {
      console.error("Error updating hashtag positions:", error);
      throw error;
    }
  },

  /**
   * Calculate hashtag usage report for a user
   * @param {ObjectId} userId - The user ID
   * @returns {Promise<Object>} Usage report
   */
  generateUserHashtagReport: async function (userId) {
    if (!userId) {
      throw new Error("User ID is required");
    }

    try {
      // Get user's posts
      const Post = mongoose.model("Post");
      const postIds = await Post.find({
        user: userId,
        isDeleted: false,
      }).distinct("_id");

      if (postIds.length === 0) {
        return {
          totalHashtags: 0,
          uniqueHashtags: 0,
          mostUsed: [],
          categoriesUsed: [],
          trending: false,
        };
      }

      // Get hashtag usage data
      const hashtagUsageAgg = await this.aggregate([
        {
          $match: { post: { $in: postIds } },
        },
        {
          $group: {
            _id: "$hashtag",
            count: { $sum: 1 },
            posts: { $addToSet: "$post" },
          },
        },
        {
          $sort: { count: -1 },
        },
      ]);

      // Get hashtag details
      const Hashtag = mongoose.model("Hashtag");
      const hashtagIds = hashtagUsageAgg.map((item) => item._id);
      const hashtags = await Hashtag.find({
        _id: { $in: hashtagIds },
      }).select("name postCount followersCount usageStats relatedCategories");

      // Map for quick lookups
      const hashtagMap = {};
      hashtags.forEach((h) => {
        hashtagMap[h._id.toString()] = h;
      });

      // Analyze categories used
      const categoryMap = {};
      hashtags.forEach((h) => {
        (h.relatedCategories || []).forEach((rel) => {
          const catId = rel.category.toString();
          if (categoryMap[catId]) {
            categoryMap[catId].count++;
          } else {
            categoryMap[catId] = {
              categoryId: rel.category,
              count: 1,
            };
          }
        });
      });

      // Get top 5 most used hashtags
      const mostUsed = hashtagUsageAgg.slice(0, 5).map((item) => {
        const hashtag = hashtagMap[item._id.toString()];
        return {
          _id: item._id,
          name: hashtag?.name || "Unknown",
          count: item.count,
          inPostsCount: item.posts.length,
          trending: hashtag?.usageStats?.last24Hours > 100, // Arbitrary threshold
        };
      });

      // Get categories sorted by usage
      const categories = Object.values(categoryMap)
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);

      // Check if the user used any trending hashtags
      const anyTrending = mostUsed.some((h) => h.trending);

      const report = {
        totalHashtags: hashtagUsageAgg.reduce(
          (sum, item) => sum + item.count,
          0
        ),
        uniqueHashtags: hashtagUsageAgg.length,
        avgHashtagsPerPost: (
          hashtagUsageAgg.reduce((sum, item) => sum + item.count, 0) /
          postIds.length
        ).toFixed(1),
        mostUsed: mostUsed,
        categoriesUsed: categories,
        trending: anyTrending,
      };

      return report;
    } catch (error) {
      console.error("Error generating user hashtag report:", error);
      throw error;
    }
  },
};

// Middleware: update hashtag post counts
PostHashtagSchema.post("save", async function () {
  if (this.isNew) {
    try {
      // Increment hashtag post count
      const Hashtag = mongoose.model("Hashtag");
      await Hashtag.findByIdAndUpdate(this.hashtag, {
        $inc: { postCount: 1 },
        $set: { lastUsed: new Date() },
      });

      // Update hashtag usage stats
      await Hashtag.updateOne(
        { _id: this.hashtag },
        {
          $inc: {
            "usageStats.last24Hours": 1,
            "usageStats.last7Days": 1,
            "usageStats.last30Days": 1,
            "usageStats.total": 1,
          },
        }
      );
    } catch (error) {
      console.error("Error updating hashtag post count:", error);
    }
  }
});

PostHashtagSchema.post("remove", async function () {
  try {
    // Decrement hashtag post count
    const Hashtag = mongoose.model("Hashtag");
    await Hashtag.findByIdAndUpdate(this.hashtag, {
      $inc: { postCount: -1 },
    });
  } catch (error) {
    console.error("Error updating hashtag post count:", error);
  }
});

// Scheduled task to decay usage stats (to be called by a scheduled job)
PostHashtagSchema.statics.decayUsageStats = async function () {
  const Hashtag = mongoose.model("Hashtag");

  try {
    // Decay last24Hours by 50% each day
    await Hashtag.updateMany({ "usageStats.last24Hours": { $gt: 0 } }, [
      {
        $set: {
          "usageStats.last24Hours": {
            $multiply: ["$usageStats.last24Hours", 0.5],
          },
        },
      },
    ]);

    // Decay last7Days by 10% each day
    await Hashtag.updateMany({ "usageStats.last7Days": { $gt: 0 } }, [
      {
        $set: {
          "usageStats.last7Days": { $multiply: ["$usageStats.last7Days", 0.9] },
        },
      },
    ]);

    // Decay last30Days by 3% each day
    await Hashtag.updateMany({ "usageStats.last30Days": { $gt: 0 } }, [
      {
        $set: {
          "usageStats.last30Days": {
            $multiply: ["$usageStats.last30Days", 0.97],
          },
        },
      },
    ]);

    return { success: true };
  } catch (error) {
    console.error("Error decaying hashtag usage stats:", error);
    return { success: false, error: error.message };
  }
};

const PostHashtag = mongoose.model("PostHashtag", PostHashtagSchema);

module.exports = PostHashtag;
