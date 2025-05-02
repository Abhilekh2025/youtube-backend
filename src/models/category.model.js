const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const CategorySchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      unique: true,
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
    description: {
      type: String,
      trim: true,
    },
    icon: {
      type: String, // Icon identifier or URL
      default: null,
    },
    color: {
      type: String, // Hex color code
      default: "#000000",
    },
    parent: {
      type: Schema.Types.ObjectId,
      ref: "Category",
      default: null,
    },
    ancestorPath: [
      {
        type: Schema.Types.ObjectId,
        ref: "Category",
      },
    ],
    level: {
      type: Number,
      default: 0, // 0 for root categories, 1+ for subcategories
    },
    postCount: {
      type: Number,
      default: 0,
    },
    followersCount: {
      type: Number,
      default: 0,
    },
    displayOrder: {
      type: Number,
      default: 0, // For manual ordering in UI
    },
    isFeatured: {
      type: Boolean,
      default: false,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    displayInNavigation: {
      type: Boolean,
      default: false,
    },
    coverImage: {
      type: String, // URL to cover image
      default: null,
    },
    seoMetadata: {
      title: String,
      description: String,
      keywords: [String],
    },
    moderationStatus: {
      status: {
        type: String,
        enum: ["approved", "pending", "restricted"],
        default: "approved",
      },
      reason: String,
      reviewedAt: Date,
      reviewedBy: {
        type: Schema.Types.ObjectId,
        ref: "User",
      },
    },
    customFields: {
      type: Map,
      of: Schema.Types.Mixed,
      default: {},
    },
    allowedMediaTypes: {
      image: {
        type: Boolean,
        default: true,
      },
      video: {
        type: Boolean,
        default: true,
      },
      audio: {
        type: Boolean,
        default: true,
      },
    },
    rules: {
      type: String,
      trim: true,
    },
    relatedCategories: [
      {
        type: Schema.Types.ObjectId,
        ref: "Category",
      },
    ],
    synonyms: [String], // Alternative names for search
    tags: [String], // Related keywords/tags for this category
    analyticsId: String, // For external analytics tracking
    defaultHashtags: [
      {
        type: Schema.Types.ObjectId,
        ref: "Hashtag",
      },
    ],
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Indexes
CategorySchema.index({ parent: 1, displayOrder: 1 });
CategorySchema.index({ isFeatured: 1, displayOrder: 1 });
CategorySchema.index({ isActive: 1 });
CategorySchema.index({ ancestorPath: 1 });
CategorySchema.index({ "moderationStatus.status": 1 });
CategorySchema.index({ postCount: -1 });
CategorySchema.index({ tags: 1 });

// Virtual for child categories
CategorySchema.virtual("childCategories", {
  ref: "Category",
  localField: "_id",
  foreignField: "parent",
  options: { sort: { displayOrder: 1 } },
});

// Virtual for posts in this category
CategorySchema.virtual("posts", {
  ref: "PostCategory",
  localField: "_id",
  foreignField: "category",
});

// Methods
CategorySchema.methods = {
  // Increment post count
  incrementPostCount: async function () {
    this.postCount += 1;
    await this.save();
    return this;
  },

  // Decrement post count
  decrementPostCount: async function () {
    if (this.postCount > 0) {
      this.postCount -= 1;
      await this.save();
    }
    return this;
  },

  // Increment followers count
  incrementFollowersCount: async function () {
    this.followersCount += 1;
    await this.save();
    return this;
  },

  // Decrement followers count
  decrementFollowersCount: async function () {
    if (this.followersCount > 0) {
      this.followersCount -= 1;
      await this.save();
    }
    return this;
  },

  // Get full category path
  getFullPath: async function () {
    if (!this.parent) {
      return this.name;
    }

    // Recursively build the path
    const ancestors = await this.populate("ancestorPath").execPopulate();
    const pathParts = ancestors.ancestorPath.map((cat) => cat.name);
    pathParts.push(this.name);

    return pathParts.join(" › ");
  },
  // Add a related category
  addRelatedCategory: async function (categoryId) {
    if (!this.relatedCategories.includes(categoryId)) {
      this.relatedCategories.push(categoryId);
      await this.save();
    }
    return this;
  },

  // Remove a related category
  removeRelatedCategory: async function (categoryId) {
    this.relatedCategories = this.relatedCategories.filter(
      (id) => id.toString() !== categoryId.toString()
    );
    await this.save();
    return this;
  },

  // Add a default hashtag
  addDefaultHashtag: async function (hashtagId) {
    if (!this.defaultHashtags.includes(hashtagId)) {
      this.defaultHashtags.push(hashtagId);
      await this.save();
    }
    return this;
  },

  // Remove a default hashtag
  removeDefaultHashtag: async function (hashtagId) {
    this.defaultHashtags = this.defaultHashtags.filter(
      (id) => id.toString() !== hashtagId.toString()
    );
    await this.save();
    return this;
  },
};

// Static methods
CategorySchema.statics = {
  // Get featured categories
  getFeaturedCategories: async function (options = {}) {
    const { limit = 10 } = options;

    return this.find({
      isFeatured: true,
      isActive: true,
      "moderationStatus.status": "approved",
    })
      .sort({ displayOrder: 1 })
      .limit(limit);
  },

  // Get root categories (no parent)
  getRootCategories: async function (options = {}) {
    const { includeInactive = false } = options;

    const query = {
      parent: null,
      "moderationStatus.status": "approved",
    };

    if (!includeInactive) {
      query.isActive = true;
    }

    return this.find(query).sort({ displayOrder: 1 });
  },

  // Get child categories of a parent
  getChildCategories: async function (parentId, options = {}) {
    const { includeInactive = false } = options;

    const query = {
      parent: parentId,
      "moderationStatus.status": "approved",
    };

    if (!includeInactive) {
      query.isActive = true;
    }

    return this.find(query).sort({ displayOrder: 1 });
  },

  // Get category tree (for navigation)
  getCategoryTree: async function () {
    // Get all active root categories
    const rootCategories = await this.find({
      parent: null,
      isActive: true,
      "moderationStatus.status": "approved",
    }).sort({ displayOrder: 1 });

    // Function to recursively get children
    const getChildren = async (parentId) => {
      const children = await this.find({
        parent: parentId,
        isActive: true,
        "moderationStatus.status": "approved",
      }).sort({ displayOrder: 1 });

      // Build tree for each child
      for (let i = 0; i < children.length; i++) {
        children[i] = children[i].toObject();
        children[i].children = await getChildren(children[i]._id);
      }

      return children;
    };

    // Build the tree
    const tree = [];
    for (let i = 0; i < rootCategories.length; i++) {
      const rootCat = rootCategories[i].toObject();
      rootCat.children = await getChildren(rootCat._id);
      tree.push(rootCat);
    }

    return tree;
  },

  // Find categories by tags/keywords
  findByTags: async function (tags, options = {}) {
    const { limit = 10 } = options;

    if (!Array.isArray(tags) || tags.length === 0) {
      return [];
    }

    return this.find({
      tags: { $in: tags },
      isActive: true,
      "moderationStatus.status": "approved",
    })
      .sort({ postCount: -1 })
      .limit(limit);
  },

  // Get or create category by name
  findOrCreate: async function (name, options = {}) {
    const { parentId = null, description = null, slug = null } = options;

    // Generate slug if not provided
    const categorySlug =
      slug ||
      name
        .toLowerCase()
        .replace(/[^\w\s]/gi, "")
        .replace(/\s+/g, "-");

    let category = await this.findOne({
      $or: [{ name: name }, { slug: categorySlug }],
    });

    if (!category) {
      // Create new category
      category = await this.create({
        name: name,
        slug: categorySlug,
        description: description,
        parent: parentId,
      });

      // If it has a parent, update ancestorPath
      if (parentId) {
        const parent = await this.findById(parentId);
        if (parent) {
          // Create ancestor path by combining parent's path with parent itself
          const ancestorPath = [...(parent.ancestorPath || []), parent._id];
          category.ancestorPath = ancestorPath;
          category.level = ancestorPath.length;
          await category.save();
        }
      }
    }

    return category;
  },

  // Updated search method using text index
  searchCategories: async function (query, options = {}) {
    const {
      limit = 10,
      minScore = 0.2, // Minimum relevance score threshold
      fuzzyMatch = true, // Whether to enable fuzzy matching
    } = options;

    // Input validation and sanitization
    if (!query || query.trim() === "") {
      return [];
    }

    // Sanitize the input to prevent regex DoS attacks
    const sanitizedQuery = query.trim().replace(/[^\w\s]/gi, "");

    // If sanitized query is empty after removing special chars
    if (!sanitizedQuery) {
      return [];
    }

    // Create a base query with standard filters
    const baseQuery = {
      isActive: true,
      "moderationStatus.status": "approved",
    };

    let searchResults;

    try {
      // First attempt: Use text index for precise, optimized search
      searchResults = await this.find({
        ...baseQuery,
        $text: {
          $search: sanitizedQuery,
          $caseSensitive: false,
          $diacriticSensitive: false,
        },
      })
        .sort({
          score: { $meta: "textScore" }, // Sort by relevance score
        })
        .limit(limit);

      // If text search returns results or fuzzy matching is disabled, return them
      if (searchResults.length > 0 || !fuzzyMatch) {
        return searchResults;
      }

      // Fallback: If text search returns no results and fuzzy matching is enabled,
      // try a more lenient regex search for just the name and synonyms
      // This helps with typos and partial matches that text search might miss
      const regexPattern = new RegExp(
        sanitizedQuery.split("").join("\\s*"),
        "i"
      );

      // Use a more targeted regex approach that's less vulnerable to ReDoS
      return await this.find({
        ...baseQuery,
        $or: [{ name: regexPattern }, { synonyms: regexPattern }],
      })
        .sort({ postCount: -1 })
        .limit(limit);
    } catch (error) {
      // If any search errors occur (like invalid regex), fall back to most popular
      console.error("Search error:", error);

      // Fallback to popular categories if search fails
      return await this.find(baseQuery).sort({ postCount: -1 }).limit(limit);
    }
  },
  // Get trending categories
  getTrendingCategories: async function (options = {}) {
    const { limit = 10, timeWindow = 7 } = options; // default 7 days

    // Get the date for the start of the time window
    const date = new Date();
    date.setDate(date.getDate() - timeWindow);

    // Get post categories created in the time window
    const PostCategory = mongoose.model("PostCategory");
    const trendingCategoryIds = await PostCategory.aggregate([
      {
        $match: {
          createdAt: { $gte: date },
        },
      },
      {
        $group: {
          _id: "$category",
          count: { $sum: 1 },
        },
      },
      {
        $sort: {
          count: -1,
        },
      },
      {
        $limit: limit,
      },
    ]);

    if (trendingCategoryIds.length === 0) {
      return this.find({
        isActive: true,
        "moderationStatus.status": "approved",
      })
        .sort({ postCount: -1 })
        .limit(limit);
    }

    const categoryIds = trendingCategoryIds.map((item) => item._id);

    return this.find({
      _id: { $in: categoryIds },
      isActive: true,
      "moderationStatus.status": "approved",
    }).sort({ postCount: -1 });
  },
};

// Middleware: update child categories when parent changes
CategorySchema.pre("save", async function (next) {
  // If parent changed and this document is not new
  if (this.isModified("parent") && !this.isNew) {
    try {
      const oldParent = this._oldParent;
      const newParent = this.parent;

      // Recalculate ancestor path
      if (newParent) {
        const parent = await this.constructor.findById(newParent);
        if (parent) {
          this.ancestorPath = [...(parent.ancestorPath || []), parent._id];
          this.level = this.ancestorPath.length;
        } else {
          this.ancestorPath = [];
          this.level = 0;
        }
      } else {
        this.ancestorPath = [];
        this.level = 0;
      }

      // Update all children to reflect new ancestor path
      const updateChildren = async (categoryId, ancestorPath, level) => {
        const children = await this.constructor.find({ parent: categoryId });

        for (const child of children) {
          child.ancestorPath = ancestorPath;
          child.level = level;
          await child.save();

          // Recursively update grandchildren
          await updateChildren(
            child._id,
            [...ancestorPath, child._id],
            level + 1
          );
        }
      };

      await updateChildren(this._id, this.ancestorPath, this.level);
    } catch (error) {
      return next(error);
    }
  }

  // Store current parent for reference in post-save
  this._oldParent = this.parent;

  next();
});

// Generate slug from name if not provided
CategorySchema.pre("save", function (next) {
  if (this.isNew || this.isModified("name")) {
    if (!this.slug || this.slug.trim() === "") {
      this.slug = this.name
        .toLowerCase()
        .replace(/[^\w\s]/gi, "")
        .replace(/\s+/g, "-");
    }
  }
  next();
});

const Category = mongoose.model("Category", CategorySchema);

module.exports = Category;
