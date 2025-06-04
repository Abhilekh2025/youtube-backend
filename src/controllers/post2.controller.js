const Post = require("../models/post.model");
const User = require("../models/user.model");
const Hashtag = require("../models/hashtag.model");
const Category = require("../models/category.model");
const Media = require("../models/media.model");
const PostHashtag = require("../models/post-hashtag.model");
const PostCategory = require("../models/post-category.model");
const PostTag = require("../models/post-tag.model");
const Like = require("../models/like.model");
const Comment = require("../models/comment.model");
const mongoose = require("mongoose");
const { validationResult } = require("express-validator");

/**
 * Post Controller
 * Handles all post-related operations
 */

const postController = {
  /**
   * Create a new post
   * @route POST /api/posts
   * @access Private
   */

  createPost: async (req, res) => {
    try {
      // Validate request
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
      }

      const {
        caption,
        mediaIds,
        location,
        accessControl = {},
        categoryIds = [],
        scheduledFor = null,
        filter_used = null,
        accessibility_caption = null,
      } = req.body;

      // Prepare post data
      const postData = {
        user: req.user.id, // From auth middleware
        caption,
        filter_used,
        accessibility_caption,
        source: req.body.source || "app",
      };

      // Add location if provided
      if (location) {
        if (location.locationId) {
          postData.location_id = location.locationId;
        }
        if (
          location.name ||
          (location.coordinates && location.coordinates.length === 2)
        ) {
          postData.location = {
            name: location.name || "",
            coordinates: {
              type: "Point",
              coordinates: location.coordinates || [0, 0],
            },
          };
        }
      }

      // Handle media
      if (mediaIds && mediaIds.length > 0) {
        // Validate media exists and belongs to user
        const mediaItems = await Media.find({
          _id: { $in: mediaIds },
          user: req.user.id,
          isTempFile: true,
        });

        if (mediaItems.length !== mediaIds.length) {
          return res.status(400).json({
            success: false,
            message:
              "One or more media items are invalid or do not belong to you",
          });
        }

        postData.media = mediaIds;
      }

      // Handle scheduled posts
      if (scheduledFor) {
        const scheduledDate = new Date(scheduledFor);

        if (scheduledDate > new Date()) {
          postData.publishingDetails = {
            status: "scheduled",
            scheduledFor: scheduledDate,
          };
        }
      }

      // Handle access control settings
      if (Object.keys(accessControl).length > 0) {
        postData.accessControl = {
          visibility: accessControl.visibility || "public",
          allowComments: accessControl.allowComments !== false,
          allowLikes: accessControl.allowLikes !== false,
          allowSharing: accessControl.allowSharing !== false,
        };

        // Handle restricted/excluded users if provided
        if (
          accessControl.restrictedTo &&
          Array.isArray(accessControl.restrictedTo)
        ) {
          postData.accessControl.restrictedTo = accessControl.restrictedTo;
        }

        if (
          accessControl.excludedUsers &&
          Array.isArray(accessControl.excludedUsers)
        ) {
          postData.accessControl.excludedUsers = accessControl.excludedUsers;
        }
      }

      // Create the post
      const post = await Post.createPost(postData);

      // Process categories if provided
      if (categoryIds.length > 0) {
        for (const categoryId of categoryIds) {
          await post.addToCategory(categoryId);
        }
      }

      // Update media items to mark them as permanent and associate with the post
      if (mediaIds && mediaIds.length > 0) {
        await Media.updateMany(
          { _id: { $in: mediaIds } },
          { $set: { post: post._id, isTempFile: false } }
        );
      }

      // Load post with related data
      const populatedPost = await Post.findById(post._id)
        .populate("user", "username profilePictureUrl isVerified")
        .populate("media")
        .populate("hashtags", "name")
        .populate("categories", "name slug")
        .populate("primaryCategory", "name slug");

      res.status(201).json({
        success: true,
        message:
          postData.publishingDetails?.status === "scheduled"
            ? "Post scheduled successfully"
            : "Post created successfully",
        data: populatedPost,
      });
    } catch (error) {
      console.error("Error creating post:", error);
      res.status(500).json({
        success: false,
        message: "Failed to create post",
        error: error.message,
      });
    }
  },

  /**
   * Get saved posts
   * @route GET /api/posts/saved
   * @access Private
   */
  getSavedPosts: async (req, res) => {
    try {
      const userId = req.user.id;
      const { collectionId } = req.query;

      // Get pagination params
      const { page = 1, limit = 12 } = req.query;
      const skip = (parseInt(page) - 1) * parseInt(limit);

      // Build query
      const query = { user: userId };

      if (collectionId) {
        query.collection = collectionId;
      }

      // Get saved posts
      const SavedPost = mongoose.model("SavedPost");
      const savedPosts = await SavedPost.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .populate({
          path: "post",
          populate: [
            {
              path: "user",
              select: "username profilePictureUrl isVerified",
            },
            {
              path: "media",
            },
          ],
        })
        .populate("collection", "name isDefault");

      // Get total count
      const totalSaved = await SavedPost.countDocuments(query);

      // Filter out any null posts (deleted posts)
      const filteredPosts = savedPosts.filter((item) => item.post !== null);

      res.status(200).json({
        success: true,
        data: filteredPosts,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          totalSaved,
          totalPages: Math.ceil(totalSaved / parseInt(limit)),
          hasMore: skip + filteredPosts.length < totalSaved,
        },
      });
    } catch (error) {
      console.error("Error getting saved posts:", error);
      res.status(500).json({
        success: false,
        message: "Failed to get saved posts",
        error: error.message,
      });
    }
  },
  /**
   * Get posts liked by user
   * @route GET /api/posts/liked
   * @access Private
   */
  getLikedPosts: async (req, res) => {
    try {
      const userId = req.user.id;

      // Get pagination params
      const { page = 1, limit = 12 } = req.query;
      const skip = (parseInt(page) - 1) * parseInt(limit);

      // Get liked posts IDs
      const likedPostsQuery = await Like.find({
        user: userId,
        likeableType: "Post",
      })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit));

      const likedPostIds = likedPostsQuery.map((like) => like.likeableId);

      // Get posts data
      const posts = await Post.find({
        _id: { $in: likedPostIds },
        isDeleted: false,
        "accessControl.visibility": "public",
      })
        .populate("user", "username profilePictureUrl isVerified")
        .populate("media")
        .populate("hashtags", "name")
        .populate("categories", "name slug");

      // Ensure posts are in the same order as the likes
      const orderedPosts = likedPostIds
        .map((id) =>
          posts.find((post) => post._id.toString() === id.toString())
        )
        .filter((post) => post !== undefined);

      // Mark all posts as liked (since this is the liked posts list)
      const postsWithLikeStatus = orderedPosts.map((post) => ({
        ...post.toObject(),
        isLiked: true,
      }));

      // Get total liked posts
      const totalLiked = await Like.countDocuments({
        user: userId,
        likeableType: "Post",
      });

      res.status(200).json({
        success: true,
        data: postsWithLikeStatus,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          totalLiked,
          totalPages: Math.ceil(totalLiked / parseInt(limit)),
          hasMore: skip + postsWithLikeStatus.length < totalLiked,
        },
      });
    } catch (error) {
      console.error("Error getting liked posts:", error);
      res.status(500).json({
        success: false,
        message: "Failed to get liked posts",
        error: error.message,
      });
    }
  },
  /**
   * Save a post to collection
   * @route POST /api/posts/:id/save
   * @access Private
   */
  savePost: async (req, res) => {
    try {
      const postId = req.params.id;
      const userId = req.user.id;
      const { collectionId } = req.body;

      // Check if post exists
      const post = await Post.findById(postId);
      if (!post) {
        return res
          .status(404)
          .json({ success: false, message: "Post not found" });
      }

      // Get collection or use default
      const Collection = mongoose.model("Collection");
      let collection;

      if (collectionId) {
        // Find specified collection
        collection = await Collection.findOne({
          _id: collectionId,
          user: userId,
        });

        if (!collection) {
          return res.status(404).json({
            success: false,
            message: "Collection not found or does not belong to you",
          });
        }
      } else {
        // Get or create default collection
        collection = await Collection.findOne({
          user: userId,
          isDefault: true,
        });

        if (!collection) {
          collection = await Collection.create({
            user: userId,
            name: "Saved",
            isDefault: true,
          });
        }
      }

      // Check if post is already saved in this collection
      const SavedPost = mongoose.model("SavedPost");
      const existingSave = await SavedPost.findOne({
        user: userId,
        post: postId,
        collection: collection._id,
      });

      if (existingSave) {
        return res.status(200).json({
          success: true,
          message: "Post is already saved to this collection",
          data: {
            collection,
          },
        });
      }

      // Save post to collection
      await SavedPost.create({
        user: userId,
        post: postId,
        collection: collection._id,
      });

      // Increment save count
      await post.incrementEngagement("saves_count");

      res.status(200).json({
        success: true,
        message: "Post saved successfully",
        data: {
          collection,
        },
      });
    } catch (error) {
      console.error("Error saving post:", error);
      res.status(500).json({
        success: false,
        message: "Failed to save post",
        error: error.message,
      });
    }
  },
  /**
   * Remove a post from collection
   * @route DELETE /api/posts/:id/unsave
   * @access Private
   */
  unsavePost: async (req, res) => {
    try {
      const postId = req.params.id;
      const userId = req.user.id;
      const { collectionId } = req.query;

      // Build query
      const query = {
        user: userId,
        post: postId,
      };

      if (collectionId) {
        query.collection = collectionId;
      }

      // Remove saved post
      const SavedPost = mongoose.model("SavedPost");
      const result = await SavedPost.deleteOne(query);

      if (result.deletedCount === 0) {
        return res.status(404).json({
          success: false,
          message: "Saved post not found",
        });
      }

      // Decrement save count
      const post = await Post.findById(postId);
      if (post && post.saves_count > 0) {
        post.saves_count -= 1;
        await post.save();
      }

      res.status(200).json({
        success: true,
        message: "Post removed from collection successfully",
      });
    } catch (error) {
      console.error("Error unsaving post:", error);
      res.status(500).json({
        success: false,
        message: "Failed to remove post from collection",
        error: error.message,
      });
    }
  },
  /**
   * Approve a tag
   * @route PUT /api/posts/tag/:tagId/approve
   * @access Private
   */
  approveTag: async (req, res) => {
    try {
      const tagId = req.params.tagId;
      const userId = req.user.id;

      // Find tag
      const PostTag = mongoose.model("PostTag");
      const tag = await PostTag.findById(tagId);

      if (!tag) {
        return res
          .status(404)
          .json({ success: false, message: "Tag not found" });
      }

      // Check if user is the tagged user
      if (tag.taggedUser.toString() !== userId) {
        return res.status(403).json({
          success: false,
          message: "You do not have permission to approve this tag",
        });
      }

      // Update tag status
      tag.status = "approved";
      await tag.save();

      res.status(200).json({
        success: true,
        message: "Tag approved successfully",
      });
    } catch (error) {
      console.error("Error approving tag:", error);
      res.status(500).json({
        success: false,
        message: "Failed to approve tag",
        error: error.message,
      });
    }
  },

  /**
   * Reject a tag
   * @route PUT /api/posts/tag/:tagId/reject
   * @access Private
   */
  rejectTag: async (req, res) => {
    try {
      const tagId = req.params.tagId;
      const userId = req.user.id;

      // Find tag
      const PostTag = mongoose.model("PostTag");
      const tag = await PostTag.findById(tagId);

      if (!tag) {
        return res
          .status(404)
          .json({ success: false, message: "Tag not found" });
      }

      // Check if user is the tagged user
      if (tag.taggedUser.toString() !== userId) {
        return res.status(403).json({
          success: false,
          message: "You do not have permission to reject this tag",
        });
      }

      // Delete the tag
      await PostTag.findByIdAndDelete(tagId);

      res.status(200).json({
        success: true,
        message: "Tag rejected successfully",
      });
    } catch (error) {
      console.error("Error rejecting tag:", error);
      res.status(500).json({
        success: false,
        message: "Failed to reject tag",
        error: error.message,
      });
    }
  },

  /**
   * Share a post
   * @route POST /api/posts/:id/share
   * @access Private
   */
  sharePost: async (req, res) => {
    try {
      const postId = req.params.id;
      const userId = req.user.id;
      const { platform, caption } = req.body;

      // Check if post exists
      const post = await Post.findById(postId);
      if (!post) {
        return res
          .status(404)
          .json({ success: false, message: "Post not found" });
      }

      // Check if post allows sharing
      if (post.accessControl && post.accessControl.allowSharing === false) {
        return res.status(403).json({
          success: false,
          message: "Sharing is disabled for this post",
        });
      }

      // Create share record
      const Share = mongoose.model("Share");
      const share = await Share.create({
        user: userId,
        post: postId,
        platform,
        caption,
      });

      // Increment share count
      await post.incrementEngagement("shares_count");

      res.status(200).json({
        success: true,
        message: "Post shared successfully",
        data: share,
      });
    } catch (error) {
      console.error("Error sharing post:", error);
      res.status(500).json({
        success: false,
        message: "Failed to share post",
        error: error.message,
      });
    }
  },

  /**
   * Pin post to profile
   * @route PUT /api/posts/:id/pin
   * @access Private (owner only)
   */
  pinPost: async (req, res) => {
    try {
      const postId = req.params.id;
      const userId = req.user.id;

      // Find post and check ownership
      const post = await Post.findById(postId);

      if (!post) {
        return res
          .status(404)
          .json({ success: false, message: "Post not found" });
      }

      // Check if user owns the post
      if (post.user.toString() !== userId) {
        return res.status(403).json({
          success: false,
          message: "You do not have permission to pin this post",
        });
      }

      // Check if post is public
      if (post.accessControl.visibility !== "public") {
        return res.status(400).json({
          success: false,
          message: "Only public posts can be pinned to your profile",
        });
      }

      // Update user model to pin this post
      const User = mongoose.model("User");
      await User.findByIdAndUpdate(userId, {
        pinnedPost: postId,
      });

      res.status(200).json({
        success: true,
        message: "Post pinned to your profile successfully",
      });
    } catch (error) {
      console.error("Error pinning post:", error);
      res.status(500).json({
        success: false,
        message: "Failed to pin post",
        error: error.message,
      });
    }
  },
  /**
   * Unpin post from profile
   * @route PUT /api/posts/unpin
   * @access Private
   */
  unpinPost: async (req, res) => {
    try {
      const userId = req.user.id;

      // Update user model to remove pinned post
      const User = mongoose.model("User");
      await User.findByIdAndUpdate(userId, {
        $unset: { pinnedPost: 1 },
      });

      res.status(200).json({
        success: true,
        message: "Post unpinned from your profile successfully",
      });
    } catch (error) {
      console.error("Error unpinning post:", error);
      res.status(500).json({
        success: false,
        message: "Failed to unpin post",
        error: error.message,
      });
    }
  },

  /**
   * Get tag approvals
   * @route GET /api/posts/tag-approvals
   * @access Private
   */
  getTagApprovals: async (req, res) => {
    try {
      const userId = req.user.id;

      // Get pagination params
      const { page = 1, limit = 10 } = req.query;
      const skip = (parseInt(page) - 1) * parseInt(limit);

      // Get pending tag approvals
      const PostTag = mongoose.model("PostTag");
      const pendingTags = await PostTag.find({
        taggedUser: userId,
        status: "pending",
      })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .populate({
          path: "post",
          populate: {
            path: "user",
            select: "username profilePictureUrl isVerified",
          },
        });

      // Get total pending tags
      const totalPending = await PostTag.countDocuments({
        taggedUser: userId,
        status: "pending",
      });

      res.status(200).json({
        success: true,
        data: pendingTags,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          totalPending,
          totalPages: Math.ceil(totalPending / parseInt(limit)),
          hasMore: skip + pendingTags.length < totalPending,
        },
      });
    } catch (error) {
      console.error("Error getting tag approvals:", error);
      res.status(500).json({
        success: false,
        message: "Failed to get tag approvals",
        error: error.message,
      });
    }
  },

  /**
   * Get user's draft posts
   * @route GET /api/posts/drafts
   * @access Private
   */
  getDraftPosts: async (req, res) => {
    try {
      const userId = req.user.id;

      // Get pagination params
      const { page = 1, limit = 12 } = req.query;
      const skip = (parseInt(page) - 1) * parseInt(limit);

      // Get draft posts
      const posts = await Post.getDraftPosts(userId, {
        limit: parseInt(limit),
        skip,
      });

      // Get total draft posts
      const totalPosts = await Post.countDocuments({
        user: userId,
        "publishingDetails.status": "draft",
        isDeleted: false,
      });

      res.status(200).json({
        success: true,
        data: posts,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          totalPosts,
          totalPages: Math.ceil(totalPosts / parseInt(limit)),
          hasMore: skip + posts.length < totalPosts,
        },
      });
    } catch (error) {
      console.error("Error getting draft posts:", error);
      res.status(500).json({
        success: false,
        message: "Failed to get draft posts",
        error: error.message,
      });
    }
  },

  /**
   * Report a post for violating rules
   * @route POST /api/posts/:id/report
   * @access Private
   */
  reportPost: async (req, res) => {
    try {
      // Validate request
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
      }

      const postId = req.params.id;
      const userId = req.user.id;
      const { reason, details } = req.body;

      // Check if post exists
      const post = await Post.findById(postId);
      if (!post) {
        return res
          .status(404)
          .json({ success: false, message: "Post not found" });
      }

      // Create report
      const Report = mongoose.model("Report");
      await Report.create({
        reportedBy: userId,
        reportedContent: {
          contentType: "Post",
          contentId: postId,
        },
        reason,
        details,
        status: "pending",
      });

      res.status(200).json({
        success: true,
        message: "Post reported successfully. Our team will review it.",
      });
    } catch (error) {
      console.error("Error reporting post:", error);
      res.status(500).json({
        success: false,
        message: "Failed to report post",
        error: error.message,
      });
    }
  },

  /**
   * Get user's archived posts
   * @route GET /api/posts/archived
   * @access Private
   */
  getArchivedPosts: async (req, res) => {
    try {
      const userId = req.user.id;

      // Get pagination params
      const { page = 1, limit = 12 } = req.query;
      const skip = (parseInt(page) - 1) * parseInt(limit);

      // Get archived posts
      const posts = await Post.getArchivedPosts(userId, {
        limit: parseInt(limit),
        skip,
      });

      // Get total archived posts
      const totalPosts = await Post.countDocuments({
        user: userId,
        isArchived: true,
        isDeleted: false,
      });

      res.status(200).json({
        success: true,
        data: posts,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          totalPosts,
          totalPages: Math.ceil(totalPosts / parseInt(limit)),
          hasMore: skip + posts.length < totalPosts,
        },
      });
    } catch (error) {
      console.error("Error getting archived posts:", error);
      res.status(500).json({
        success: false,
        message: "Failed to get archived posts",
        error: error.message,
      });
    }
  },

  /**
   * Get user's scheduled posts
   * @route GET /api/posts/scheduled
   * @access Private
   */
  getScheduledPosts: async (req, res) => {
    try {
      const userId = req.user.id;

      // Get pagination params
      const { page = 1, limit = 12 } = req.query;
      const skip = (parseInt(page) - 1) * parseInt(limit);

      // Get scheduled posts
      const posts = await Post.getScheduledPosts(userId, {
        limit: parseInt(limit),
        skip,
      });

      // Get total scheduled posts
      const totalPosts = await Post.countDocuments({
        user: userId,
        "publishingDetails.status": "scheduled",
        isDeleted: false,
      });

      res.status(200).json({
        success: true,
        data: posts,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          totalPosts,
          totalPages: Math.ceil(totalPosts / parseInt(limit)),
          hasMore: skip + posts.length < totalPosts,
        },
      });
    } catch (error) {
      console.error("Error getting scheduled posts:", error);
      res.status(500).json({
        success: false,
        message: "Failed to get scheduled posts",
        error: error.message,
      });
    }
  },

  /**
   * Get suggested hashtags for a post
   * @route POST /api/posts/suggest-hashtags
   * @access Private
   */
  suggestHashtags: async (req, res) => {
    try {
      // Validate request
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
      }

      const { caption, categoryIds } = req.body;

      // Check for missing data
      if (!caption && (!categoryIds || categoryIds.length === 0)) {
        return res.status(400).json({
          success: false,
          message: "Caption or categories are required for suggestions",
        });
      }

      // Build post data for suggestion
      const postData = {
        caption: caption || "",
        categoryIds: categoryIds || [],
      };

      // Get suggestions with options
      const options = {
        limit: parseInt(req.body.limit) || 15,
        excludeExisting: req.body.excludeExisting !== false,
        minPostCount: parseInt(req.body.minPostCount) || 5,
      };

      const suggestedHashtags = await Post.suggestHashtags(postData, options);

      res.status(200).json({
        success: true,
        data: suggestedHashtags,
      });
    } catch (error) {
      console.error("Error suggesting hashtags:", error);
      res.status(500).json({
        success: false,
        message: "Failed to suggest hashtags",
        error: error.message,
      });
    }
  },

  /**
   * Archive a post
   * @route PUT /api/posts/:id/archive
   * @access Private (owner only)
   */
  archivePost: async (req, res) => {
    try {
      const postId = req.params.id;
      const userId = req.user.id;

      // Find post and check ownership
      const post = await Post.findById(postId);

      if (!post) {
        return res
          .status(404)
          .json({ success: false, message: "Post not found" });
      }

      // Check if user owns the post
      if (post.user.toString() !== userId) {
        return res.status(403).json({
          success: false,
          message: "You do not have permission to archive this post",
        });
      }

      // Archive post
      await post.archive();

      res.status(200).json({
        success: true,
        message: "Post archived successfully",
      });
    } catch (error) {
      console.error("Error archiving post:", error);
      res.status(500).json({
        success: false,
        message: "Failed to archive post",
        error: error.message,
      });
    }
  },

  /**
   * Unarchive a post
   * @route PUT /api/posts/:id/unarchive
   * @access Private (owner only)
   */
  unarchivePost: async (req, res) => {
    try {
      const postId = req.params.id;
      const userId = req.user.id;

      // Find post and check ownership
      const post = await Post.findById(postId);

      if (!post) {
        return res
          .status(404)
          .json({ success: false, message: "Post not found" });
      }

      // Check if user owns the post
      if (post.user.toString() !== userId) {
        return res.status(403).json({
          success: false,
          message: "You do not have permission to unarchive this post",
        });
      }

      // Unarchive post
      await post.unarchive();

      res.status(200).json({
        success: true,
        message: "Post unarchived successfully",
      });
    } catch (error) {
      console.error("Error unarchiving post:", error);
      res.status(500).json({
        success: false,
        message: "Failed to unarchive post",
        error: error.message,
      });
    }
  },

  /**
   * Get post analytics
   * @route GET /api/posts/:id/analytics
   * @access Private (owner only)
   */
  getPostAnalytics: async (req, res) => {
    try {
      const postId = req.params.id;
      const userId = req.user.id;

      // Check if valid ObjectId
      if (!mongoose.Types.ObjectId.isValid(postId)) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid post ID" });
      }

      // Get post
      const post = await Post.findById(postId);

      if (!post) {
        return res
          .status(404)
          .json({ success: false, message: "Post not found" });
      }

      // Check ownership
      if (post.user.toString() !== userId && req.user.role !== "admin") {
        return res.status(403).json({
          success: false,
          message: "You do not have permission to view these analytics",
        });
      }

      // Get analytics
      const analytics = await Post.getPostAnalytics(postId);

      // Get hashtag analytics
      const hashtagAnalytics = await post.getHashtagAnalytics();

      // Get engagement over time
      const Comment = mongoose.model("Comment");
      const Like = mongoose.model("Like");

      // Get comments over time (last 7 days)
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      const commentsByDay = await Comment.aggregate([
        {
          $match: {
            post: mongoose.Types.ObjectId(postId),
            createdAt: { $gte: sevenDaysAgo },
          },
        },
        {
          $group: {
            _id: {
              year: { $year: "$createdAt" },
              month: { $month: "$createdAt" },
              day: { $dayOfMonth: "$createdAt" },
            },
            count: { $sum: 1 },
          },
        },
        { $sort: { "_id.year": 1, "_id.month": 1, "_id.day": 1 } },
      ]);

      // Get likes over time (last 7 days)
      const likesByDay = await Like.aggregate([
        {
          $match: {
            likeableType: "Post",
            likeableId: mongoose.Types.ObjectId(postId),
            createdAt: { $gte: sevenDaysAgo },
          },
        },
        {
          $group: {
            _id: {
              year: { $year: "$createdAt" },
              month: { $month: "$createdAt" },
              day: { $dayOfMonth: "$createdAt" },
            },
            count: { $sum: 1 },
          },
        },
        { $sort: { "_id.year": 1, "_id.month": 1, "_id.day": 1 } },
      ]);

      // Format time series data
      const formatTimeSeries = (data) => {
        const result = [];
        const now = new Date();

        // Create entries for the last 7 days
        for (let i = 6; i >= 0; i--) {
          const date = new Date();
          date.setDate(now.getDate() - i);

          const year = date.getFullYear();
          const month = date.getMonth() + 1;
          const day = date.getDate();

          // Find matching data point
          const dataPoint = data.find(
            (d) =>
              d._id.year === year && d._id.month === month && d._id.day === day
          );

          result.push({
            date: `${year}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`,
            count: dataPoint ? dataPoint.count : 0,
          });
        }

        return result;
      };

      res.status(200).json({
        success: true,
        data: {
          ...analytics,
          hashtags: hashtagAnalytics,
          timeSeries: {
            comments: formatTimeSeries(commentsByDay),
            likes: formatTimeSeries(likesByDay),
          },
        },
      });
    } catch (error) {
      console.error("Error getting post analytics:", error);
      res.status(500).json({
        success: false,
        message: "Failed to get post analytics",
        error: error.message,
      });
    }
  },

  /**
   * Search posts
   * @route GET /api/posts/search
   * @access Public
   */
  searchPosts: async (req, res) => {
    try {
      const visitorId = req.user ? req.user.id : null;

      // Get pagination params
      const { page = 1, limit = 12 } = req.query;
      const skip = (parseInt(page) - 1) * parseInt(limit);

      // Build search params
      const searchParams = {
        query: req.query.q || "",
        limit: parseInt(limit),
        skip,
      };

      // Add additional filters if provided
      if (req.query.hashtags) {
        const hashtags = Array.isArray(req.query.hashtags)
          ? req.query.hashtags
          : [req.query.hashtags];

        searchParams.hashtags = hashtags;
      }

      if (req.query.categories) {
        const categories = Array.isArray(req.query.categories)
          ? req.query.categories
          : [req.query.categories];

        searchParams.categories = categories;
      }

      if (req.query.user) {
        searchParams.userId = req.query.user;
      }

      if (req.query.startDate) {
        searchParams.startDate = req.query.startDate;
      }

      if (req.query.endDate) {
        searchParams.endDate = req.query.endDate;
      }

      if (req.query.lat && req.query.lng && req.query.radius) {
        searchParams.location = {
          coordinates: [parseFloat(req.query.lng), parseFloat(req.query.lat)],
        };
        searchParams.radiusKm = parseFloat(req.query.radius);
      }

      // Search posts
      const posts = await Post.searchPosts(searchParams);

      // Check which posts the visitor has liked (if authenticated)
      const likedPostIds = new Set();

      if (visitorId && posts.length > 0) {
        const postIds = posts.map((post) => post._id);
        const likes = await Like.find({
          user: visitorId,
          likeableType: "Post",
          likeableId: { $in: postIds },
        });

        likes.forEach((like) => {
          likedPostIds.add(like.likeableId.toString());
        });
      }

      // Add isLiked flag to each post
      const postsWithLikeStatus = posts.map((post) => ({
        ...post.toObject(),
        isLiked: likedPostIds.has(post._id.toString()),
      }));

      // Get search metadata
      const searchMeta = {
        query: searchParams.query,
        filters: {},
      };

      if (searchParams.hashtags) {
        const hashtagInfo = await Hashtag.find({
          _id: { $in: searchParams.hashtags },
        }).select("name");

        searchMeta.filters.hashtags = hashtagInfo;
      }

      if (searchParams.categories) {
        const categoryInfo = await Category.find({
          _id: { $in: searchParams.categories },
        }).select("name slug");

        searchMeta.filters.categories = categoryInfo;
      }

      if (searchParams.userId) {
        const userInfo = await User.findById(searchParams.userId).select(
          "username profilePictureUrl"
        );

        searchMeta.filters.user = userInfo;
      }

      if (searchParams.location) {
        searchMeta.filters.location = {
          coordinates: searchParams.location.coordinates,
          radiusKm: searchParams.radiusKm,
        };
      }

      // Estimate total results (this is an approximation)
      // For production, consider using a more precise count with caching
      const totalResults =
        posts.length === parseInt(limit)
          ? (parseInt(page) + 1) * parseInt(limit)
          : skip + posts.length;

      res.status(200).json({
        success: true,
        data: postsWithLikeStatus,
        meta: searchMeta,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          estimatedTotalResults: totalResults,
          hasMore: posts.length === parseInt(limit),
        },
      });
    } catch (error) {
      console.error("Error searching posts:", error);
      res.status(500).json({
        success: false,
        message: "Failed to search posts",
        error: error.message,
      });
    }
  },
  /**
   * Remove a user tag from a post
   * @route DELETE /api/posts/:id/tag/:userId
   * @access Private
   */
  removeTag: async (req, res) => {
    try {
      const postId = req.params.id;
      const taggedUserId = req.params.userId;
      const userId = req.user.id;

      // Check if post exists
      const post = await Post.findById(postId);
      if (!post) {
        return res
          .status(404)
          .json({ success: false, message: "Post not found" });
      }

      // Check if requester is post owner, tagged user, or admin
      if (
        post.user.toString() !== userId &&
        taggedUserId !== userId &&
        req.user.role !== "admin"
      ) {
        return res.status(403).json({
          success: false,
          message: "You do not have permission to remove this tag",
        });
      }

      // Remove tag
      const result = await post.removeTag(taggedUserId);

      if (!result.removed) {
        return res.status(404).json({
          success: false,
          message: "Tag not found",
        });
      }

      res.status(200).json({
        success: true,
        message: "Tag removed successfully",
      });
    } catch (error) {
      console.error("Error removing tag:", error);
      res.status(500).json({
        success: false,
        message: "Failed to remove tag",
        error: error.message,
      });
    }
  },

  /**
   * Get posts where a user is tagged
   * @route GET /api/posts/tagged/:userId
   * @access Public/Private (depends on user settings)
   */
  getTaggedPosts: async (req, res) => {
    try {
      const targetUserId = req.params.userId;
      const visitorId = req.user ? req.user.id : null;

      // Check if valid ObjectId
      if (!mongoose.Types.ObjectId.isValid(targetUserId)) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid user ID" });
      }

      // Get user and check tag settings
      const targetUser = await User.findById(targetUserId);

      if (!targetUser) {
        return res
          .status(404)
          .json({ success: false, message: "User not found" });
      }

      // Check if tags are private
      const userSettings = await mongoose
        .model("UserSetting")
        .findOne({ user: targetUserId });

      const tagsArePrivate =
        userSettings && userSettings.tagged_posts_moderation === true;

      // Only allow viewing if: public tags, or self-viewing, or admin
      if (
        tagsArePrivate &&
        visitorId !== targetUserId &&
        (!req.user || req.user.role !== "admin")
      ) {
        return res.status(403).json({
          success: false,
          message: "This user's tagged posts are private",
        });
      }

      // Get pagination params
      const { page = 1, limit = 12 } = req.query;
      const skip = (parseInt(page) - 1) * parseInt(limit);

      // Get tagged posts
      const posts = await Post.getTaggedPosts(targetUserId, {
        limit: parseInt(limit),
        skip,
        visitorId,
        approvedOnly: visitorId !== targetUserId, // Only show approved tags to non-owners
      });

      // Get total tagged posts
      const PostTag = mongoose.model("PostTag");
      const query = { taggedUser: targetUserId };

      if (visitorId !== targetUserId) {
        query.status = "approved";
      }

      const totalTags = await PostTag.countDocuments(query);

      // Check which posts the visitor has liked (if authenticated)
      const likedPostIds = new Set();

      if (visitorId && posts.length > 0) {
        const postIds = posts.map((post) => post._id);
        const likes = await Like.find({
          user: visitorId,
          likeableType: "Post",
          likeableId: { $in: postIds },
        });

        likes.forEach((like) => {
          likedPostIds.add(like.likeableId.toString());
        });
      }

      // Add isLiked flag to each post
      const postsWithLikeStatus = posts.map((post) => ({
        ...post.toObject(),
        isLiked: likedPostIds.has(post._id.toString()),
      }));

      res.status(200).json({
        success: true,
        data: postsWithLikeStatus,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          totalPosts: totalTags,
          totalPages: Math.ceil(totalTags / parseInt(limit)),
          hasMore: skip + posts.length < totalTags,
        },
      });
    } catch (error) {
      console.error("Error getting tagged posts:", error);
      res.status(500).json({
        success: false,
        message: "Failed to get tagged posts",
        error: error.message,
      });
    }
  },
  /**
   * Get comments for a post
   * @route GET /api/posts/:id/comments
   * @access Public
   */
  getComments: async (req, res) => {
    try {
      const postId = req.params.id;
      const userId = req.user ? req.user.id : null;

      // Check if post exists and is viewable
      const post = await Post.findOne({
        _id: postId,
        isDeleted: false,
        "publishingDetails.status": "published",
      });

      if (!post) {
        return res
          .status(404)
          .json({ success: false, message: "Post not found" });
      }

      // Check visibility
      const visiblePost = await post.getVisiblePost(userId);
      if (!visiblePost) {
        return res.status(403).json({
          success: false,
          message: "You do not have permission to view this post",
        });
      }

      // Get pagination params
      const { page = 1, limit = 10 } = req.query;
      const skip = (parseInt(page) - 1) * parseInt(limit);

      // Get sort option
      const { sort = "recent" } = req.query; // 'recent', 'popular'

      // Build sort configuration
      let sortConfig = {};

      if (sort === "popular") {
        sortConfig = { likes_count: -1, createdAt: -1 };
      } else {
        sortConfig = { createdAt: -1 };
      }

      // Get comments
      const comments = await Comment.find({
        post: postId,
        is_restricted: false,
      })
        .sort(sortConfig)
        .skip(skip)
        .limit(parseInt(limit))
        .populate("user", "username profilePictureUrl isVerified");

      // Get total comment count
      const totalComments = await Comment.countDocuments({
        post: postId,
        is_restricted: false,
      });

      // Check which comments the user has liked (if authenticated)
      const likedCommentIds = new Set();

      if (userId && comments.length > 0) {
        const commentIds = comments.map((comment) => comment._id);
        const likes = await Like.find({
          user: userId,
          likeableType: "Comment",
          likeableId: { $in: commentIds },
        });

        likes.forEach((like) => {
          likedCommentIds.add(like.likeableId.toString());
        });
      }

      // Add isLiked flag to each comment
      const commentsWithLikeStatus = comments.map((comment) => ({
        ...comment.toObject(),
        isLiked: likedCommentIds.has(comment._id.toString()),
      }));

      res.status(200).json({
        success: true,
        data: commentsWithLikeStatus,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          totalComments,
          totalPages: Math.ceil(totalComments / parseInt(limit)),
          hasMore: skip + comments.length < totalComments,
        },
      });
    } catch (error) {
      console.error("Error getting comments:", error);
      res.status(500).json({
        success: false,
        message: "Failed to get comments",
        error: error.message,
      });
    }
  },

  /**
   * Tag a user in a post
   * @route POST /api/posts/:id/tag
   * @access Private
   */
  tagUser: async (req, res) => {
    try {
      // Validate request
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
      }

      const postId = req.params.id;
      const taggerId = req.user.id;
      const { userId, mediaId, coordinates } = req.body;

      // Check if post exists
      const post = await Post.findById(postId);
      if (!post) {
        return res
          .status(404)
          .json({ success: false, message: "Post not found" });
      }

      // Check if tagger is post owner or admin
      if (post.user.toString() !== taggerId && req.user.role !== "admin") {
        return res.status(403).json({
          success: false,
          message: "Only the post owner can tag users",
        });
      }

      // Check if user exists
      const userExists = await User.findById(userId);
      if (!userExists) {
        return res
          .status(404)
          .json({ success: false, message: "User not found" });
      }

      // Create tag
      const tag = await post.tagUser(userId, taggerId, {
        mediaId,
        coordinates,
      });

      res.status(200).json({
        success: true,
        message: "User tagged successfully",
        data: {
          tag,
          status: tag.status,
        },
      });
    } catch (error) {
      console.error("Error tagging user:", error);
      res.status(500).json({
        success: false,
        message: "Failed to tag user",
        error: error.message,
      });
    }
  },

  /**
   * Get a specific post by ID
   * @route GET /api/posts/:id
   * @access Public (with visibility control)
   */
  getPostById: async (req, res) => {
    try {
      const postId = req.params.id;

      // Check if valid ObjectId
      if (!mongoose.Types.ObjectId.isValid(postId)) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid post ID" });
      }

      // Get post with populated data
      const post = await Post.findById(postId)
        .populate(
          "user",
          "username profilePictureUrl isVerified follower_count"
        )
        .populate("media")
        .populate("hashtags", "name")
        .populate("categories", "name slug")
        .populate({
          path: "comments",
          options: {
            limit: 3,
            sort: { createdAt: -1 },
          },
          populate: {
            path: "user",
            select: "username profilePictureUrl isVerified",
          },
        });

      if (!post) {
        return res
          .status(404)
          .json({ success: false, message: "Post not found" });
      }

      // Check visibility based on authenticated user (if any)
      const userId = req.user ? req.user.id : null;
      const visiblePost = await post.getVisiblePost(userId);

      if (!visiblePost) {
        return res.status(403).json({
          success: false,
          message: "You do not have permission to view this post",
        });
      }

      // Increment view count
      await post.incrementEngagement("viewsCount");

      // Check if authenticated user has liked the post
      let isLiked = false;
      if (userId) {
        isLiked = await post.isLikedBy(userId);
      }

      res.status(200).json({
        success: true,
        data: {
          ...visiblePost.toObject(),
          isLiked,
        },
      });
    } catch (error) {
      console.error("Error getting post:", error);
      res.status(500).json({
        success: false,
        message: "Failed to get post",
        error: error.message,
      });
    }
  },

  /**
   * Update an existing post
   * @route PUT /api/posts/:id
   * @access Private (owner only)
   */
  updatePost: async (req, res) => {
    try {
      const postId = req.params.id;
      const userId = req.user.id;

      // Validate request
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
      }

      // Find post and check ownership
      const post = await Post.findById(postId);

      if (!post) {
        return res
          .status(404)
          .json({ success: false, message: "Post not found" });
      }

      // Check if user owns the post
      if (post.user.toString() !== userId) {
        return res.status(403).json({
          success: false,
          message: "You do not have permission to update this post",
        });
      }

      // Check if post is already published and not a draft
      if (
        post.publishingDetails.status === "published" &&
        req.body.publishingDetails?.status === "draft"
      ) {
        return res.status(400).json({
          success: false,
          message: "Cannot change published post back to draft",
        });
      }

      // Fields that can be updated
      const {
        caption,
        location,
        accessControl,
        filter_used,
        accessibility_caption,
        mediaIds,
        categoryIds,
        publishingDetails,
      } = req.body;

      // Update basic fields if provided
      if (caption !== undefined) post.caption = caption;
      if (filter_used !== undefined) post.filter_used = filter_used;
      if (accessibility_caption !== undefined)
        post.accessibility_caption = accessibility_caption;

      // Update location if provided
      if (location) {
        if (location.locationId) {
          post.location_id = location.locationId;
        }

        post.location = post.location || {};
        if (location.name) post.location.name = location.name;

        if (location.coordinates && location.coordinates.length === 2) {
          post.location.coordinates = {
            type: "Point",
            coordinates: location.coordinates,
          };
        }
      }

      // Update access control if provided
      if (accessControl) {
        post.accessControl = post.accessControl || {};

        if (accessControl.visibility)
          post.accessControl.visibility = accessControl.visibility;
        if (accessControl.allowComments !== undefined)
          post.accessControl.allowComments = accessControl.allowComments;
        if (accessControl.allowLikes !== undefined)
          post.accessControl.allowLikes = accessControl.allowLikes;
        if (accessControl.allowSharing !== undefined)
          post.accessControl.allowSharing = accessControl.allowSharing;

        // Update restricted users
        if (
          accessControl.restrictedTo &&
          Array.isArray(accessControl.restrictedTo)
        ) {
          post.accessControl.restrictedTo = accessControl.restrictedTo;
        }

        // Update excluded users
        if (
          accessControl.excludedUsers &&
          Array.isArray(accessControl.excludedUsers)
        ) {
          post.accessControl.excludedUsers = accessControl.excludedUsers;
        }
      }

      // Update publishing details if provided
      if (publishingDetails) {
        if (publishingDetails.status) {
          // Handle status change
          if (
            publishingDetails.status === "scheduled" &&
            publishingDetails.scheduledFor
          ) {
            const scheduledDate = new Date(publishingDetails.scheduledFor);

            if (scheduledDate > new Date()) {
              post.publishingDetails.status = "scheduled";
              post.publishingDetails.scheduledFor = scheduledDate;
            } else {
              return res.status(400).json({
                success: false,
                message: "Scheduled time must be in the future",
              });
            }
          } else if (
            ["published", "draft", "archived"].includes(
              publishingDetails.status
            )
          ) {
            post.publishingDetails.status = publishingDetails.status;

            if (publishingDetails.status === "published") {
              post.publishingDetails.publishedAt = new Date();
            }
          }
        }
      }

      // Mark post as edited
      await post.markAsEdited();

      // Update media if provided
      if (mediaIds && Array.isArray(mediaIds)) {
        // Validate media exists and belongs to user
        const mediaItems = await Media.find({
          _id: { $in: mediaIds },
          user: userId,
        });

        if (mediaItems.length !== mediaIds.length) {
          return res.status(400).json({
            success: false,
            message:
              "One or more media items are invalid or do not belong to you",
          });
        }

        // Get current media IDs
        const currentMediaIds = post.media.map((id) => id.toString());

        // Find media to remove
        const mediaToRemove = currentMediaIds.filter(
          (id) => !mediaIds.includes(id)
        );

        // Find media to add
        const mediaToAdd = mediaIds.filter(
          (id) => !currentMediaIds.includes(id)
        );

        // Update media associations
        if (mediaToRemove.length > 0) {
          await Media.updateMany(
            { _id: { $in: mediaToRemove } },
            { $unset: { post: 1 } }
          );
        }

        if (mediaToAdd.length > 0) {
          await Media.updateMany(
            { _id: { $in: mediaToAdd } },
            { $set: { post: post._id, isTempFile: false } }
          );
        }

        // Update post media array
        post.media = mediaIds;
      }

      // Update categories if provided
      if (categoryIds && Array.isArray(categoryIds)) {
        // Get current category IDs
        const currentCategoryIds = post.categories.map((id) => id.toString());

        // Find categories to remove
        const categoriesToRemove = currentCategoryIds.filter(
          (id) => !categoryIds.includes(id)
        );

        // Find categories to add
        const categoriesToAdd = categoryIds.filter(
          (id) => !currentCategoryIds.includes(id)
        );

        // Remove categories
        for (const categoryId of categoriesToRemove) {
          await post.removeFromCategory(categoryId);
        }

        // Add categories
        for (const categoryId of categoriesToAdd) {
          await post.addToCategory(categoryId);
        }
      }

      // Save the updated post
      await post.save();

      // Process hashtags if caption was updated
      if (caption !== undefined) {
        await post.processHashtagsFromCaption();
      }

      // Get updated post with populated data
      const updatedPost = await Post.findById(post._id)
        .populate("user", "username profilePictureUrl isVerified")
        .populate("media")
        .populate("hashtags", "name")
        .populate("categories", "name slug")
        .populate("primaryCategory", "name slug");

      res.status(200).json({
        success: true,
        message: "Post updated successfully",
        data: updatedPost,
      });
    } catch (error) {
      console.error("Error updating post:", error);
      res.status(500).json({
        success: false,
        message: "Failed to update post",
        error: error.message,
      });
    }
  },

  /**
   * Delete a post
   * @route DELETE /api/posts/:id
   * @access Private (owner only)
   */
  deletePost: async (req, res) => {
    try {
      const postId = req.params.id;
      const userId = req.user.id;

      // Find post and check ownership
      const post = await Post.findById(postId);

      if (!post) {
        return res
          .status(404)
          .json({ success: false, message: "Post not found" });
      }

      // Check if user owns the post or is an admin
      if (post.user.toString() !== userId && req.user.role !== "admin") {
        return res.status(403).json({
          success: false,
          message: "You do not have permission to delete this post",
        });
      }

      // Perform soft delete
      await post.softDelete();

      res.status(200).json({
        success: true,
        message: "Post deleted successfully",
      });
    } catch (error) {
      console.error("Error deleting post:", error);
      res.status(500).json({
        success: false,
        message: "Failed to delete post",
        error: error.message,
      });
    }
  },
  /**
   * Get feed posts
   * @route GET /api/posts/feed
   * @access Private
   */
  getFeedPosts: async (req, res) => {
    try {
      const userId = req.user.id;

      // Get pagination params
      const { page = 1, limit = 10 } = req.query;
      const skip = (parseInt(page) - 1) * parseInt(limit);

      // Get feed options
      const { includeFollowing = true, includeCategories = true } = req.query;

      // Get feed posts
      const posts = await Post.getUserFeed(userId, {
        limit: parseInt(limit),
        skip,
        includeFollowing: includeFollowing !== "false",
        includeCategories: includeCategories !== "false",
      });

      // Get total count for pagination
      const user = await User.findById(userId);
      const followingCount = user.following ? user.following.length : 0;
      const hasFollowings = followingCount > 0;

      // Calculate approximate total (for pagination)
      // This is an estimate to avoid expensive count queries
      let totalPosts;

      if (hasFollowings) {
        totalPosts = followingCount * 10; // Rough estimate of 10 posts per following
      } else {
        // If not following anyone, use trending post count
        totalPosts = await Post.countDocuments({
          isDeleted: false,
          isArchived: false,
          "accessControl.visibility": "public",
          "publishingDetails.status": "published",
        });
      }

      // Check which posts the user has liked
      const likedPostIds = new Set();

      if (posts.length > 0) {
        const postIds = posts.map((post) => post._id);
        const likes = await Like.find({
          user: userId,
          likeableType: "Post",
          likeableId: { $in: postIds },
        });

        likes.forEach((like) => {
          likedPostIds.add(like.likeableId.toString());
        });
      }

      // Add isLiked flag to each post
      const postsWithLikeStatus = posts.map((post) => ({
        ...post.toObject(),
        isLiked: likedPostIds.has(post._id.toString()),
      }));

      res.status(200).json({
        success: true,
        data: postsWithLikeStatus,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          totalPosts,
          totalPages: Math.ceil(totalPosts / parseInt(limit)),
          hasMore: skip + posts.length < totalPosts,
        },
      });
    } catch (error) {
      console.error("Error getting feed posts:", error);
      res.status(500).json({
        success: false,
        message: "Failed to get feed",
        error: error.message,
      });
    }
  },
  /**
   * Get user posts
   * @route GET /api/posts/user/:userId
   * @access Public (with visibility control)
   */
  getUserPosts: async (req, res) => {
    try {
      const targetUserId = req.params.userId;
      const visitorId = req.user ? req.user.id : null;

      // Check if valid ObjectId
      if (!mongoose.Types.ObjectId.isValid(targetUserId)) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid user ID" });
      }

      // Check if user exists
      const userExists = await User.findById(targetUserId);
      if (!userExists) {
        return res
          .status(404)
          .json({ success: false, message: "User not found" });
      }

      // Get pagination params
      const { page = 1, limit = 12 } = req.query;
      const skip = (parseInt(page) - 1) * parseInt(limit);

      // Get user posts with visibility control
      const posts = await Post.getUserPosts(targetUserId, {
        limit: parseInt(limit),
        skip,
        visitorId,
      });

      // Get post count (respecting visibility)
      const query = {
        user: targetUserId,
        isDeleted: false,
        isArchived: false,
      };

      // Apply visibility filters for non-owner
      if (!visitorId || visitorId.toString() !== targetUserId) {
        query["accessControl.visibility"] = "public";
      }

      const totalPosts = await Post.countDocuments(query);

      // Check which posts the visitor has liked (if authenticated)
      const likedPostIds = new Set();

      if (visitorId && posts.length > 0) {
        const postIds = posts.map((post) => post._id);
        const likes = await Like.find({
          user: visitorId,
          likeableType: "Post",
          likeableId: { $in: postIds },
        });

        likes.forEach((like) => {
          likedPostIds.add(like.likeableId.toString());
        });
      }

      // Add isLiked flag to each post
      const postsWithLikeStatus = posts.map((post) => ({
        ...post.toObject(),
        isLiked: likedPostIds.has(post._id.toString()),
      }));

      res.status(200).json({
        success: true,
        data: postsWithLikeStatus,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          totalPosts,
          totalPages: Math.ceil(totalPosts / parseInt(limit)),
          hasMore: skip + posts.length < totalPosts,
        },
      });
    } catch (error) {
      console.error("Error getting user posts:", error);
      res.status(500).json({
        success: false,
        message: "Failed to get user posts",
        error: error.message,
      });
    }
  },
  /**
   * Get posts by hashtag
   * @route GET /api/posts/hashtag/:hashtag
   * @access Public
   */
  getPostsByHashtag: async (req, res) => {
    try {
      const hashtag = req.params.hashtag;
      const visitorId = req.user ? req.user.id : null;

      // Get pagination params
      const { page = 1, limit = 12 } = req.query;
      const skip = (parseInt(page) - 1) * parseInt(limit);

      // Get sort option
      const { sortBy = "recent" } = req.query;

      // Get hashtag posts
      const posts = await Post.getPostsByHashtag(hashtag, {
        limit: parseInt(limit),
        skip,
        sortBy,
      });

      // Get hashtag info
      let hashtagInfo;
      if (mongoose.Types.ObjectId.isValid(hashtag)) {
        hashtagInfo = await Hashtag.findById(hashtag);
      } else {
        hashtagInfo = await Hashtag.findOne({ name: hashtag.toLowerCase() });
      }

      // Get total count (this could be expensive for popular hashtags)
      // For production, consider using an estimate or caching this value
      let totalPosts;
      if (hashtagInfo) {
        totalPosts = hashtagInfo.postCount;
      } else {
        totalPosts = 0;
      }

      // Check which posts the visitor has liked (if authenticated)
      const likedPostIds = new Set();

      if (visitorId && posts.length > 0) {
        const postIds = posts.map((post) => post._id);
        const likes = await Like.find({
          user: visitorId,
          likeableType: "Post",
          likeableId: { $in: postIds },
        });

        likes.forEach((like) => {
          likedPostIds.add(like.likeableId.toString());
        });
      }

      // Add isLiked flag to each post
      const postsWithLikeStatus = posts.map((post) => ({
        ...post.toObject(),
        isLiked: likedPostIds.has(post._id.toString()),
      }));

      // Get related hashtags
      let relatedHashtags = [];
      if (hashtagInfo) {
        relatedHashtags = await PostHashtag.getRelatedHashtags(
          hashtagInfo._id,
          { limit: 5 }
        );
      }

      res.status(200).json({
        success: true,
        data: {
          posts: postsWithLikeStatus,
          hashtag: hashtagInfo,
          relatedHashtags,
        },
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          totalPosts,
          totalPages: Math.ceil(totalPosts / parseInt(limit)),
          hasMore: skip + posts.length < totalPosts,
        },
      });
    } catch (error) {
      console.error("Error getting hashtag posts:", error);
      res.status(500).json({
        success: false,
        message: "Failed to get hashtag posts",
        error: error.message,
      });
    }
  },
  /**
   * Get posts by category
   * @route GET /api/posts/category/:categoryId
   * @access Public
   * need to write relatedCategories (missing)
   */
  getPostsByCategory: async (req, res) => {
    try {
      const category = req.params.categoryId;
      const visitorId = req.user ? req.user.id : null;

      // Get pagination params
      const { page = 1, limit = 12 } = req.query;
      const skip = (parseInt(page) - 1) * parseInt(limit);

      // Get sort option
      const { sortBy = "recent" } = req.query;

      // Get category posts
      const posts = await Post.getPostsByCategory(category, {
        limit: parseInt(limit),
        skip,
        sortBy,
      });

      // Get category info
      let categoryInfo;
      if (mongoose.Types.ObjectId.isValid(category)) {
        categoryInfo = await Category.findById(category);
      } else {
        categoryInfo = await Category.findOne({ slug: category.toLowerCase() });
      }

      if (!categoryInfo) {
        return res.status(404).json({
          success: false,
          message: "Category not found",
        });
      }

      // Get total posts in this category
      const totalPosts = categoryInfo.postCount;

      // Check which posts the visitor has liked (if authenticated)
      const likedPostIds = new Set();

      if (visitorId && posts.length > 0) {
        const postIds = posts.map((post) => post._id);
        const likes = await Like.find({
          user: visitorId,
          likeableType: "Post",
          likeableId: { $in: postIds },
        });

        likes.forEach((like) => {
          likedPostIds.add(like.likeableId.toString());
        });
      }

      // Add isLiked flag to each post
      const postsWithLikeStatus = posts.map((post) => ({
        ...post.toObject(),
        isLiked: likedPostIds.has(post._id.toString()),
      }));

      // Get related categories
      let relatedCategories = [];
      if (
        categoryInfo.relatedCategories &&
        categoryInfo.relatedCategories.length > 0
      ) {
        relatedCategories = await Category.find({
          _id: { $in: categoryInfo.relatedCategories },
          isActive: true,
        }).select("name slug icon color postCount");
      }

      res.status(200).json({
        success: true,
        data: {
          posts: postsWithLikeStatus,
          category: categoryInfo,
          relatedCategories,
        },
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          totalPosts,
          totalPages: Math.ceil(totalPosts / parseInt(limit)),
          hasMore: skip + posts.length < totalPosts,
        },
      });
    } catch (error) {
      console.error("Error getting category posts:", error);
      res.status(500).json({
        success: false,
        message: "Failed to get category posts",
        error: error.message,
      });
    }
  },

  /**
   * Get trending posts
   * @route GET /api/posts/trending
   * @access Public
   */
  getTrendingPosts: async (req, res) => {
    try {
      const visitorId = req.user ? req.user.id : null;

      // Get pagination params
      const { page = 1, limit = 10 } = req.query;
      const skip = (parseInt(page) - 1) * parseInt(limit);

      // Get time window option
      const { timeWindow = 7 } = req.query; // days

      // Get trending posts
      const posts = await Post.getTrendingPosts({
        limit: parseInt(limit),
        skip,
        timeWindow: parseInt(timeWindow),
      });

      // Check which posts the visitor has liked (if authenticated)
      const likedPostIds = new Set();

      if (visitorId && posts.length > 0) {
        const postIds = posts.map((post) => post._id);
        const likes = await Like.find({
          user: visitorId,
          likeableType: "Post",
          likeableId: { $in: postIds },
        });

        likes.forEach((like) => {
          likedPostIds.add(like.likeableId.toString());
        });
      }

      // Add isLiked flag to each post
      const postsWithLikeStatus = posts.map((post) => ({
        ...post.toObject(),
        isLiked: likedPostIds.has(post._id.toString()),
      }));

      // Get trending hashtags
      const trendingHashtags = await Hashtag.getTrending({ limit: 5 });

      res.status(200).json({
        success: true,
        data: {
          posts: postsWithLikeStatus,
          trendingHashtags,
        },
      });
    } catch (error) {
      console.error("Error getting trending posts:", error);
      res.status(500).json({
        success: false,
        message: "Failed to get trending posts",
        error: error.message,
      });
    }
  },

  /**
   * Like or unlike a post
   * @route POST /api/posts/:id/like
   * @access Private
   */
  toggleLike: async (req, res) => {
    try {
      const postId = req.params.id;
      const userId = req.user.id;

      // Check if post exists
      const post = await Post.findById(postId);
      if (!post) {
        return res
          .status(404)
          .json({ success: false, message: "Post not found" });
      }

      // Check if post allows likes
      if (post.accessControl && post.accessControl.allowLikes === false) {
        return res.status(403).json({
          success: false,
          message: "Likes are disabled for this post",
        });
      }

      // Toggle like
      const result = await post.toggleLike(userId);

      res.status(200).json({
        success: true,
        message:
          result.action === "liked"
            ? "Post liked successfully"
            : "Post unliked successfully",
        data: {
          action: result.action,
          likesCount: post.likes_count,
        },
      });
    } catch (error) {
      console.error("Error toggling like:", error);
      res.status(500).json({
        success: false,
        message: "Failed to toggle like",
        error: error.message,
      });
    }
  },

  /**
   * Add a comment to a post
   * @route POST /api/posts/:id/comment
   * @access Private
   */
  addComment: async (req, res) => {
    try {
      // Validate request
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
      }

      const postId = req.params.id;
      const userId = req.user.id;
      const { content } = req.body;

      // Check if post exists
      const post = await Post.findById(postId);
      if (!post) {
        return res
          .status(404)
          .json({ success: false, message: "Post not found" });
      }

      // Check if post allows comments
      if (post.accessControl && post.accessControl.allowComments === false) {
        return res.status(403).json({
          success: false,
          message: "Comments are disabled for this post",
        });
      }

      // Check if user is blocked/restricted
      if (
        post.accessControl &&
        post.accessControl.excludedUsers &&
        post.accessControl.excludedUsers.includes(userId)
      ) {
        return res.status(403).json({
          success: false,
          message: "You cannot comment on this post",
        });
      }

      // Create comment
      const comment = await Comment.create({
        user: userId,
        post: postId,
        content,
        has_mentions: content.includes("@"),
      });

      // Increment comment count
      await post.incrementEngagement("comments_count");

      // Process mentions if any
      if (comment.has_mentions) {
        // Extract usernames from content
        const mentionRegex = /@(\w+)/g;
        const mentions = [];
        let match;

        while ((match = mentionRegex.exec(content)) !== null) {
          mentions.push(match[1]);
        }

        if (mentions.length > 0) {
          // Find users by username
          const mentionedUsers = await User.find({
            username: { $in: mentions },
          }).select("_id");

          // Process mention notifications (not implemented here)
          // This would usually send notifications to mentioned users
        }
      }

      // Return comment with user data
      const populatedComment = await Comment.findById(comment._id).populate(
        "user",
        "username profilePictureUrl isVerified"
      );

      res.status(201).json({
        success: true,
        message: "Comment added successfully",
        data: populatedComment,
      });
    } catch (error) {
      console.error("Error adding comment:", error);
      res.status(500).json({
        success: false,
        message: "Failed to add comment",
        error: error.message,
      });
    }
  },
};
