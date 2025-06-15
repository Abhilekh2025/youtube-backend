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

  /**
   * Get nearby posts
   * @route GET /api/posts/nearby
   * @access Public
   */

  getNearbyPosts: async (req, res) => {
    try {
      const { lat, lng, radius = 5 } = req.query; // radius in km
      const visitorId = req.user ? req.user.id : null;

      if (!lat || !lng) {
        return res.status(400).json({
          success: false,
          message: "Latitude and longitude are required",
        });
      }

      // Get pagination params
      const { page = 1, limit = 12 } = req.query;
      const skip = (parseInt(page) - 1) * parseInt(limit);

      // Search nearby posts
      const posts = await Post.find({
        isDeleted: false,
        isArchived: false,
        "accessControl.visibility": "public",
        "publishingDetails.status": "published",
        "location.coordinates": {
          $near: {
            $geometry: {
              type: "Point",
              coordinates: [parseFloat(lng), parseFloat(lat)],
            },
            $maxDistance: parseFloat(radius) * 1000, // convert km to meters
          },
        },
      })
        .sort({ "publishingDetails.publishedAt": -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .populate("user", "username profilePictureUrl isVerified")
        .populate("media")
        .populate("hashtags", "name")
        .populate("categories", "name slug");

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

      // Calculate a rough estimate of total nearby posts
      // For full production, this would need to be optimized
      const totalEstimate =
        posts.length === parseInt(limit)
          ? (parseInt(page) + 1) * parseInt(limit)
          : skip + posts.length;

      res.status(200).json({
        success: true,
        data: postsWithLikeStatus,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          estimatedTotal: totalEstimate,
          hasMore: posts.length === parseInt(limit),
        },
        meta: {
          location: {
            lat: parseFloat(lat),
            lng: parseFloat(lng),
            radiusKm: parseFloat(radius),
          },
        },
      });
    } catch (error) {
      console.error("Error getting nearby posts:", error);
      res.status(500).json({
        success: false,
        message: "Failed to get nearby posts",
        error: error.message,
      });
    }
  },

  /**
   * Get post recommendations
   * @route GET /api/posts/recommendations
   * @access Private
   */
  getRecommendations: async (req, res) => {
    try {
      const userId = req.user.id;

      // Get pagination params
      const { page = 1, limit = 10 } = req.query;
      const skip = (parseInt(page) - 1) * parseInt(limit);

      // Get user's interests and preferences
      const user = await User.findById(userId).populate("interests");

      const interestIds = user.interests
        ? user.interests.map((interest) => interest._id)
        : [];

      // Get posts based on user's interests and behavior
      const recommendations = await Post.getRecommendations(userId, {
        interestIds,
        limit: parseInt(limit),
        skip,
      });

      // Check which posts the user has liked
      const likedPostIds = new Set();

      if (recommendations.length > 0) {
        const postIds = recommendations.map((post) => post._id);
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
      const postsWithLikeStatus = recommendations.map((post) => ({
        ...post.toObject(),
        isLiked: likedPostIds.has(post._id.toString()),
      }));

      res.status(200).json({
        success: true,
        data: postsWithLikeStatus,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          hasMore: recommendations.length === parseInt(limit),
        },
      });
    } catch (error) {
      console.error("Error getting post recommendations:", error);
      res.status(500).json({
        success: false,
        message: "Failed to get post recommendations",
        error: error.message,
      });
    }
  },

  /**
   * Process a batch of posts (for admin/moderation)
   * @route POST /api/posts/batch-process
   * @access Private (admin only)
   */
  batchProcessPosts: async (req, res) => {
    try {
      // Check admin role
      if (req.user.role !== "admin") {
        return res.status(403).json({
          success: false,
          message: "You do not have permission to perform this action",
        });
      }

      const { postIds, action, reason } = req.body;

      if (!postIds || !Array.isArray(postIds) || postIds.length === 0) {
        return res.status(400).json({
          success: false,
          message: "Post IDs are required",
        });
      }

      if (
        !["approve", "reject", "hide", "feature", "unfeature"].includes(action)
      ) {
        return res.status(400).json({
          success: false,
          message: "Invalid action",
        });
      }

      // Process batch of posts
      const results = {
        processed: 0,
        failed: 0,
        details: [],
      };

      for (const postId of postIds) {
        try {
          const post = await Post.findById(postId);

          if (!post) {
            results.failed++;
            results.details.push({
              postId,
              success: false,
              message: "Post not found",
            });
            continue;
          }

          switch (action) {
            case "approve":
              post.moderationStatus = "approved";
              post.moderationDetails = {
                moderatedBy: req.user.id,
                moderatedAt: new Date(),
                moderationNotes: reason || "Batch approved",
              };
              await post.save();
              break;

            case "reject":
              post.moderationStatus = "rejected";
              post.isHidden = true;
              post.moderationDetails = {
                moderatedBy: req.user.id,
                moderatedAt: new Date(),
                moderationNotes: reason || "Batch rejected",
              };
              await post.save();
              break;

            case "hide":
              post.isHidden = true;
              post.moderationDetails = {
                moderatedBy: req.user.id,
                moderatedAt: new Date(),
                moderationNotes: reason || "Hidden by admin",
              };
              await post.save();
              break;

            case "feature":
              post.isFeatured = true;
              post.featuredDetails = {
                featuredBy: req.user.id,
                featuredAt: new Date(),
                featuredReason: reason || "Featured by admin",
              };
              await post.save();
              break;

            case "unfeature":
              post.isFeatured = false;
              await post.save();
              break;
          }

          results.processed++;
          results.details.push({
            postId,
            success: true,
            message: `Post ${action}d successfully`,
          });
        } catch (error) {
          results.failed++;
          results.details.push({
            postId,
            success: false,
            message: error.message,
          });
        }
      }

      res.status(200).json({
        success: true,
        message: `Batch processed ${results.processed} posts with ${results.failed} failures`,
        data: results,
      });
    } catch (error) {
      console.error("Error in batch processing posts:", error);
      res.status(500).json({
        success: false,
        message: "Failed to process batch of posts",
        error: error.message,
      });
    }
  },

  /**
   * Get comment replies
   * @route GET /api/posts/comments/:commentId/replies
   * @access Public
   */
  getCommentReplies: async (req, res) => {
    try {
      const commentId = req.params.commentId;
      const userId = req.user ? req.user.id : null;

      // Check if comment exists
      const comment = await Comment.findById(commentId);
      if (!comment) {
        return res
          .status(404)
          .json({ success: false, message: "Comment not found" });
      }

      // Get pagination params
      const { page = 1, limit = 10 } = req.query;
      const skip = (parseInt(page) - 1) * parseInt(limit);

      // Get replies
      const replies = await Comment.find({
        parentComment: commentId,
        is_restricted: false,
      })
        .sort({ createdAt: 1 })
        .skip(skip)
        .limit(parseInt(limit))
        .populate("user", "username profilePictureUrl isVerified");

      // Get total replies count
      const totalReplies = await Comment.countDocuments({
        parentComment: commentId,
        is_restricted: false,
      });

      // Check which replies the user has liked (if authenticated)
      const likedReplyIds = new Set();

      if (userId && replies.length > 0) {
        const replyIds = replies.map((reply) => reply._id);
        const likes = await Like.find({
          user: userId,
          likeableType: "Comment",
          likeableId: { $in: replyIds },
        });

        likes.forEach((like) => {
          likedReplyIds.add(like.likeableId.toString());
        });
      }

      // Add isLiked flag to each reply
      const repliesWithLikeStatus = replies.map((reply) => ({
        ...reply.toObject(),
        isLiked: likedReplyIds.has(reply._id.toString()),
      }));

      res.status(200).json({
        success: true,
        data: repliesWithLikeStatus,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          totalReplies,
          totalPages: Math.ceil(totalReplies / parseInt(limit)),
          hasMore: skip + replies.length < totalReplies,
        },
      });
    } catch (error) {
      console.error("Error getting comment replies:", error);
      res.status(500).json({
        success: false,
        message: "Failed to get comment replies",
        error: error.message,
      });
    }
  },

  /**
   * Add a reply to a comment
   * @route POST /api/posts/comments/:commentId/reply
   * @access Private
   */
  replyToComment: async (req, res) => {
    try {
      // Validate request
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
      }

      const commentId = req.params.commentId;
      const userId = req.user.id;
      const { content } = req.body;

      // Check if comment exists
      const comment = await Comment.findById(commentId);
      if (!comment) {
        return res
          .status(404)
          .json({ success: false, message: "Comment not found" });
      }

      // Check if this is already a reply to prevent nested replies
      if (comment.parentComment) {
        return res.status(400).json({
          success: false,
          message:
            "Cannot reply to a reply. Please respond to the original comment.",
        });
      }

      // Check if post exists and allows comments
      const post = await Post.findById(comment.post);
      if (!post) {
        return res
          .status(404)
          .json({ success: false, message: "Post not found" });
      }

      if (post.accessControl && post.accessControl.allowComments === false) {
        return res.status(403).json({
          success: false,
          message: "Comments are disabled for this post",
        });
      }

      // Create reply
      const reply = await Comment.create({
        user: userId,
        post: comment.post,
        content,
        parentComment: commentId,
        has_mentions: content.includes("@"),
      });

      // Increment reply count for the comment
      comment.replies_count = (comment.replies_count || 0) + 1;
      await comment.save();

      // Process mentions if any
      if (reply.has_mentions) {
        // Extract usernames from content
        const mentionRegex = /@(\w+)/g;
        const mentions = [];
        let match;

        while ((match = mentionRegex.exec(content)) !== null) {
          mentions.push(match[1]);
        }

        // Similar to comment mentions processing...
      }

      // Return reply with user data
      const populatedReply = await Comment.findById(reply._id).populate(
        "user",
        "username profilePictureUrl isVerified"
      );

      res.status(201).json({
        success: true,
        message: "Reply added successfully",
        data: populatedReply,
      });
    } catch (error) {
      console.error("Error adding reply:", error);
      res.status(500).json({
        success: false,
        message: "Failed to add reply",
        error: error.message,
      });
    }
  },

  /**
   * Like or unlike a comment
   * @route POST /api/posts/comments/:commentId/like
   * @access Private
   */
  toggleCommentLike: async (req, res) => {
    try {
      const commentId = req.params.commentId;
      const userId = req.user.id;

      // Check if comment exists
      const comment = await Comment.findById(commentId);
      if (!comment) {
        return res
          .status(404)
          .json({ success: false, message: "Comment not found" });
      }

      // Toggle like
      const like = await Like.findOne({
        user: userId,
        likeableType: "Comment",
        likeableId: commentId,
      });

      let action;

      if (like) {
        // Unlike
        await Like.findByIdAndDelete(like._id);

        // Decrement like count
        if (comment.likes_count > 0) {
          comment.likes_count -= 1;
          await comment.save();
        }

        action = "unliked";
      } else {
        // Like
        await Like.create({
          user: userId,
          likeableType: "Comment",
          likeableId: commentId,
        });

        // Increment like count
        comment.likes_count = (comment.likes_count || 0) + 1;
        await comment.save();

        action = "liked";
      }

      res.status(200).json({
        success: true,
        message: `Comment ${action} successfully`,
        data: {
          action,
          likesCount: comment.likes_count,
        },
      });
    } catch (error) {
      console.error("Error toggling comment like:", error);
      res.status(500).json({
        success: false,
        message: "Failed to toggle comment like",
        error: error.message,
      });
    }
  },

  /**
   * Delete a comment
   * @route DELETE /api/posts/comments/:commentId
   * @access Private
   */
  deleteComment: async (req, res) => {
    try {
      const commentId = req.params.commentId;
      const userId = req.user.id;

      // Find comment
      const comment = await Comment.findById(commentId);

      if (!comment) {
        return res
          .status(404)
          .json({ success: false, message: "Comment not found" });
      }

      // Check if user owns the comment or is admin
      if (comment.user.toString() !== userId && req.user.role !== "admin") {
        return res.status(403).json({
          success: false,
          message: "You do not have permission to delete this comment",
        });
      }

      // Delete comment
      await Comment.findByIdAndDelete(commentId);

      // Decrement post comment count
      const post = await Post.findById(comment.post);
      if (post && post.comments_count > 0) {
        post.comments_count -= 1;
        await post.save();
      }

      // If this is a reply, decrement parent comment's reply count
      if (comment.parentComment) {
        const parentComment = await Comment.findById(comment.parentComment);
        if (parentComment && parentComment.replies_count > 0) {
          parentComment.replies_count -= 1;
          await parentComment.save();
        }
      }

      res.status(200).json({
        success: true,
        message: "Comment deleted successfully",
      });
    } catch (error) {
      console.error("Error deleting comment:", error);
      res.status(500).json({
        success: false,
        message: "Failed to delete comment",
        error: error.message,
      });
    }
  },

  /**
   * Report a comment
   * @route POST /api/posts/comments/:commentId/report
   * @access Private
   */
  reportComment: async (req, res) => {
    try {
      // Validate request
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
      }

      const commentId = req.params.commentId;
      const userId = req.user.id;
      const { reason, details } = req.body;

      // Check if comment exists
      const comment = await Comment.findById(commentId);
      if (!comment) {
        return res
          .status(404)
          .json({ success: false, message: "Comment not found" });
      }

      // Create report
      const Report = mongoose.model("Report");
      await Report.create({
        reportedBy: userId,
        reportedContent: {
          contentType: "Comment",
          contentId: commentId,
        },
        reason,
        details,
        status: "pending",
      });

      res.status(200).json({
        success: true,
        message: "Comment reported successfully. Our team will review it.",
      });
    } catch (error) {
      console.error("Error reporting comment:", error);
      res.status(500).json({
        success: false,
        message: "Failed to report comment",
        error: error.message,
      });
    }
  },

  /**
   * Edit a comment
   * @route PUT /api/posts/comments/:commentId
   * @access Private
   */
  editComment: async (req, res) => {
    try {
      // Validate request
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
      }

      const commentId = req.params.commentId;
      const userId = req.user.id;
      const { content } = req.body;

      // Find comment and check ownership
      const comment = await Comment.findById(commentId);

      if (!comment) {
        return res
          .status(404)
          .json({ success: false, message: "Comment not found" });
      }

      // Check if user owns the comment
      if (comment.user.toString() !== userId) {
        return res.status(403).json({
          success: false,
          message: "You do not have permission to edit this comment",
        });
      }

      // Check if edit window has passed (e.g., 30 minutes)
      const editWindowMinutes = 30;
      const editWindowMs = editWindowMinutes * 60 * 1000;
      const commentAge = Date.now() - new Date(comment.createdAt).getTime();

      if (commentAge > editWindowMs) {
        return res.status(403).json({
          success: false,
          message: `Comments can only be edited within ${editWindowMinutes} minutes of posting`,
        });
      }

      // Update comment
      comment.content = content;
      comment.isEdited = true;
      comment.editedAt = new Date();
      comment.has_mentions = content.includes("@");

      await comment.save();

      // Process mentions if any (similar to adding comment)

      // Return updated comment
      const updatedComment = await Comment.findById(commentId).populate(
        "user",
        "username profilePictureUrl isVerified"
      );

      res.status(200).json({
        success: true,
        message: "Comment updated successfully",
        data: updatedComment,
      });
    } catch (error) {
      console.error("Error editing comment:", error);
      res.status(500).json({
        success: false,
        message: "Failed to edit comment",
        error: error.message,
      });
    }
  },

  /**
   * Get featured posts
   * @route GET /api/posts/featured
   * @access Public
   */
  getFeaturedPosts: async (req, res) => {
    try {
      const visitorId = req.user ? req.user.id : null;

      // Get pagination params
      const { page = 1, limit = 10 } = req.query;
      const skip = (parseInt(page) - 1) * parseInt(limit);

      // Get featured posts
      const posts = await Post.find({
        isDeleted: false,
        isArchived: false,
        isFeatured: true,
        "accessControl.visibility": "public",
        "publishingDetails.status": "published",
      })
        .sort({ "featuredDetails.featuredAt": -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .populate("user", "username profilePictureUrl isVerified")
        .populate("media")
        .populate("hashtags", "name")
        .populate("categories", "name slug");

      // Get total featured posts
      const totalFeatured = await Post.countDocuments({
        isDeleted: false,
        isArchived: false,
        isFeatured: true,
        "accessControl.visibility": "public",
        "publishingDetails.status": "published",
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

      res.status(200).json({
        success: true,
        data: postsWithLikeStatus,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          totalFeatured,
          totalPages: Math.ceil(totalFeatured / parseInt(limit)),
          hasMore: skip + posts.length < totalFeatured,
        },
      });
    } catch (error) {
      console.error("Error getting featured posts:", error);
      res.status(500).json({
        success: false,
        message: "Failed to get featured posts",
        error: error.message,
      });
    }
  },

  /**
   * Get post engagement metrics
   * @route GET /api/posts/:id/engagement
   * @access Private (owner only)
   */
  getPostEngagement: async (req, res) => {
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
          message: "You do not have permission to view these metrics",
        });
      }

      // Get engagement metrics
      const engagement = {
        views: post.viewsCount || 0,
        likes: post.likes_count || 0,
        comments: post.comments_count || 0,
        shares: post.shares_count || 0,
        saves: post.saves_count || 0,
      };

      // Calculate engagement rate
      const totalEngagements =
        engagement.likes +
        engagement.comments +
        engagement.shares +
        engagement.saves;

      engagement.engagementRate =
        engagement.views > 0 ? (totalEngagements / engagement.views) * 100 : 0;

      // Format rate to 2 decimal places
      engagement.engagementRate = parseFloat(
        engagement.engagementRate.toFixed(2)
      );

      res.status(200).json({
        success: true,
        data: engagement,
      });
    } catch (error) {
      console.error("Error getting post engagement:", error);
      res.status(500).json({
        success: false,
        message: "Failed to get post engagement",
        error: error.message,
      });
    }
  },

  /**
   * Get post reach metrics
   * @route GET /api/posts/:id/reach
   * @access Private (owner only)
   */
  getPostReach: async (req, res) => {
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
          message: "You do not have permission to view these metrics",
        });
      }

      // Get reach metrics from analytics collection
      const Analytics = mongoose.model("Analytics");
      const reach = await Analytics.findOne({
        entityType: "Post",
        entityId: postId,
      });

      // If no reach data exists, return zeros
      const reachData = reach
        ? {
            uniqueViews: reach.uniqueVisitors || 0,
            impressions: reach.impressions || 0,
            referrers: reach.referrers || {},
            deviceTypes: reach.deviceTypes || {},
            demographicData: reach.demographics || {},
          }
        : {
            uniqueViews: 0,
            impressions: 0,
            referrers: {},
            deviceTypes: {},
            demographicData: {},
          };

      res.status(200).json({
        success: true,
        data: reachData,
      });
    } catch (error) {
      console.error("Error getting post reach:", error);
      res.status(500).json({
        success: false,
        message: "Failed to get post reach",
        error: error.message,
      });
    }
  },

  /**
   * Bulk status update for scheduled posts
   * @route PUT /api/posts/bulk-status-update
   * @access Private
   */
  bulkStatusUpdate: async (req, res) => {
    try {
      const userId = req.user.id;
      const { postIds, status } = req.body;

      if (!postIds || !Array.isArray(postIds) || postIds.length === 0) {
        return res.status(400).json({
          success: false,
          message: "Post IDs are required",
        });
      }

      if (!["published", "draft", "scheduled"].includes(status)) {
        return res.status(400).json({
          success: false,
          message: "Invalid status",
        });
      }

      // Check if all posts belong to user
      const posts = await Post.find({
        _id: { $in: postIds },
        user: userId,
      });

      if (posts.length !== postIds.length) {
        return res.status(403).json({
          success: false,
          message: "One or more posts do not belong to you",
        });
      }

      // Update status for each post
      const updatePromises = posts.map(async (post) => {
        post.publishingDetails.status = status;

        if (status === "published") {
          post.publishingDetails.publishedAt = new Date();
        }

        return post.save();
      });

      await Promise.all(updatePromises);

      res.status(200).json({
        success: true,
        message: `Successfully updated ${posts.length} posts to ${status} status`,
      });
    } catch (error) {
      console.error("Error in bulk status update:", error);
      res.status(500).json({
        success: false,
        message: "Failed to update post status",
        error: error.message,
      });
    }
  },

  /**
   * Get similar posts to a specific post
   * @route GET /api/posts/:id/similar
   * @access Public
   */
  getSimilarPosts: async (req, res) => {
    try {
      const postId = req.params.id;
      const visitorId = req.user ? req.user.id : null;

      // Check if valid ObjectId
      if (!mongoose.Types.ObjectId.isValid(postId)) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid post ID" });
      }

      // Get original post
      const post = await Post.findById(postId)
        .populate("hashtags", "_id")
        .populate("categories", "_id");

      if (!post) {
        return res
          .status(404)
          .json({ success: false, message: "Post not found" });
      }

      // Extract IDs for matching
      const hashtagIds = post.hashtags.map((tag) => tag._id);
      const categoryIds = post.categories.map((cat) => cat._id);

      // Get limit
      const limit = parseInt(req.query.limit) || 6;

      // Find similar posts
      const similarPosts = await Post.getSimilarPosts(post, {
        hashtagIds,
        categoryIds,
        limit,
      });

      // Check which posts the visitor has liked (if authenticated)
      const likedPostIds = new Set();

      if (visitorId && similarPosts.length > 0) {
        const postIds = similarPosts.map((post) => post._id);
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
      const postsWithLikeStatus = similarPosts.map((post) => ({
        ...post.toObject(),
        isLiked: likedPostIds.has(post._id.toString()),
      }));

      res.status(200).json({
        success: true,
        data: postsWithLikeStatus,
      });
    } catch (error) {
      console.error("Error getting similar posts:", error);
      res.status(500).json({
        success: false,
        message: "Failed to get similar posts",
        error: error.message,
      });
    }
  },

  /**
   * Get viral or rapidly growing posts
   * @route GET /api/posts/viral
   * @access Public
   */
  getViralPosts: async (req, res) => {
    try {
      const visitorId = req.user ? req.user.id : null;

      // Get time window
      const { timeWindow = 24 } = req.query; // hours

      // Get pagination params
      const { page = 1, limit = 10 } = req.query;
      const skip = (parseInt(page) - 1) * parseInt(limit);

      // Get viral posts
      const posts = await Post.getViralPosts({
        timeWindow: parseInt(timeWindow),
        limit: parseInt(limit),
        skip,
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

      res.status(200).json({
        success: true,
        data: postsWithLikeStatus,
      });
    } catch (error) {
      console.error("Error getting viral posts:", error);
      res.status(500).json({
        success: false,
        message: "Failed to get viral posts",
        error: error.message,
      });
    }
  },
  /**
   * Get post version history
   * @route GET /api/posts/:id/versions
   * @access Private (owner only)
   */
  getPostVersionHistory: async (req, res) => {
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
          message: "You do not have permission to view this post history",
        });
      }

      // Get post versions
      const PostVersion = mongoose.model("PostVersion");
      const versions = await PostVersion.find({ post: postId }).sort({
        createdAt: -1,
      });

      res.status(200).json({
        success: true,
        data: versions,
        meta: {
          currentVersion: post.version || 1,
          totalVersions: versions.length + 1, // Including current version
        },
      });
    } catch (error) {
      console.error("Error getting post versions:", error);
      res.status(500).json({
        success: false,
        message: "Failed to get post versions",
        error: error.message,
      });
    }
  },

  /**
   * Restore a post to a previous version
   * @route PUT /api/posts/:id/restore/:versionId
   * @access Private (owner only)
   */
  restorePostVersion: async (req, res) => {
    try {
      const { id: postId, versionId } = req.params;
      const userId = req.user.id;

      // Check if valid ObjectIds
      if (
        !mongoose.Types.ObjectId.isValid(postId) ||
        !mongoose.Types.ObjectId.isValid(versionId)
      ) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid post or version ID" });
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
          message: "You do not have permission to restore this post",
        });
      }

      // Get the version to restore
      const PostVersion = mongoose.model("PostVersion");
      const version = await PostVersion.findOne({
        _id: versionId,
        post: postId,
      });

      if (!version) {
        return res
          .status(404)
          .json({ success: false, message: "Version not found" });
      }

      // Save current version before restoring
      await PostVersion.create({
        post: postId,
        caption: post.caption,
        media: post.media,
        hashtags: post.hashtags,
        categories: post.categories,
        location: post.location,
        accessControl: post.accessControl,
        version: post.version || 1,
        restoredFrom: null,
      });

      // Restore the old version
      post.caption = version.caption;
      post.media = version.media;
      post.hashtags = version.hashtags;
      post.categories = version.categories;
      post.location = version.location;
      post.accessControl = version.accessControl;
      post.version = (post.version || 1) + 1;
      post.lastEditedAt = new Date();
      post.editHistory = post.editHistory || [];
      post.editHistory.push({
        timestamp: new Date(),
        action: "restored",
        restoredFrom: version.version,
        editor: userId,
      });

      await post.save();

      // Get the updated post with populated data
      const updatedPost = await Post.findById(postId)
        .populate("user", "username profilePictureUrl isVerified")
        .populate("media")
        .populate("hashtags", "name")
        .populate("categories", "name slug");

      res.status(200).json({
        success: true,
        message: `Post restored to version ${version.version}`,
        data: updatedPost,
      });
    } catch (error) {
      console.error("Error restoring post version:", error);
      res.status(500).json({
        success: false,
        message: "Failed to restore post version",
        error: error.message,
      });
    }
  },

  /**
   * Get trending topics (combined hashtags and categories)
   * @route GET /api/posts/trending-topics
   * @access Public
   */
  getTrendingTopics: async (req, res) => {
    try {
      // Get limit
      const { limit = 20, timeframe = "7d" } = req.query;

      // Calculate timeframe date
      const now = new Date();
      let startDate;

      switch (timeframe) {
        case "24h":
          startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
          break;
        case "7d":
          startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          break;
        case "30d":
          startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
          break;
        default:
          startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      }

      // Get trending hashtags
      const trendingHashtags = await Hashtag.aggregate([
        {
          $match: {
            lastUsed: { $gte: startDate },
          },
        },
        {
          $sort: {
            recentUsageCount: -1,
          },
        },
        {
          $limit: parseInt(limit) / 2,
        },
        {
          $project: {
            _id: 1,
            name: 1,
            postCount: 1,
            recentUsageCount: 1,
            type: { $literal: "hashtag" },
          },
        },
      ]);

      // Get trending categories
      const trendingCategories = await Category.aggregate([
        {
          $match: {
            isActive: true,
          },
        },
        {
          $sort: {
            recentPostCount: -1,
            postCount: -1,
          },
        },
        {
          $limit: parseInt(limit) / 2,
        },
        {
          $project: {
            _id: 1,
            name: 1,
            slug: 1,
            postCount: 1,
            recentPostCount: { $ifNull: ["$recentPostCount", 0] },
            icon: 1,
            color: 1,
            type: { $literal: "category" },
          },
        },
      ]);

      // Combine and sort
      const combinedTopics = [...trendingHashtags, ...trendingCategories].sort(
        (a, b) => {
          // Sort by recent usage count
          const aRecent = a.recentUsageCount || a.recentPostCount || 0;
          const bRecent = b.recentUsageCount || b.recentPostCount || 0;
          return bRecent - aRecent;
        }
      );

      res.status(200).json({
        success: true,
        data: combinedTopics,
        meta: {
          timeframe,
          startDate,
          endDate: now,
        },
      });
    } catch (error) {
      console.error("Error getting trending topics:", error);
      res.status(500).json({
        success: false,
        message: "Failed to get trending topics",
        error: error.message,
      });
    }
  },

  /**
   * Get posts by location radius
   * @route GET /api/posts/location
   * @access Public
   */
  getPostsByLocation: async (req, res) => {
    try {
      const { lat, lng, radius = 5, address } = req.query; // radius in km
      const visitorId = req.user ? req.user.id : null;

      if ((!lat || !lng) && !address) {
        return res.status(400).json({
          success: false,
          message: "Coordinates (lat/lng) or address are required",
        });
      }

      let coordinates;

      // If address provided but no coordinates, geocode the address
      if (address && (!lat || !lng)) {
        try {
          // This would use a geocoding service in a real implementation
          // For this example, we'll assume coordinates are found
          coordinates = [0, 0]; // Placeholder for geocoding result

          // In real implementation, this would be:
          // const geocodeResult = await geocodingService.geocode(address);
          // coordinates = [geocodeResult.lng, geocodeResult.lat];
        } catch (geocodeError) {
          return res.status(400).json({
            success: false,
            message: "Could not geocode the provided address",
            error: geocodeError.message,
          });
        }
      } else {
        coordinates = [parseFloat(lng), parseFloat(lat)];
      }

      // Get pagination params
      const { page = 1, limit = 12 } = req.query;
      const skip = (parseInt(page) - 1) * parseInt(limit);

      // Get sort option
      const { sortBy = "recent" } = req.query; // 'recent', 'popular', 'distance'

      // Build sort configuration
      let sortConfig = {};

      switch (sortBy) {
        case "popular":
          sortConfig = {
            likes_count: -1,
            comments_count: -1,
            "publishingDetails.publishedAt": -1,
          };
          break;
        case "distance":
          // When using distance sorting, MongoDB will automatically sort by distance
          // No need to specify a sort configuration
          break;
        default: // 'recent'
          sortConfig = { "publishingDetails.publishedAt": -1 };
      }

      // Build location query
      const radiusInMeters = parseFloat(radius) * 1000;

      // Search posts by location
      const query = {
        isDeleted: false,
        isArchived: false,
        "accessControl.visibility": "public",
        "publishingDetails.status": "published",
        "location.coordinates": {
          $near: {
            $geometry: {
              type: "Point",
              coordinates: coordinates,
            },
            $maxDistance: radiusInMeters,
          },
        },
      };

      // Execute query with or without sorting
      const posts =
        sortBy === "distance"
          ? await Post.find(query)
              .skip(skip)
              .limit(parseInt(limit))
              .populate("user", "username profilePictureUrl isVerified")
              .populate("media")
              .populate("hashtags", "name")
              .populate("categories", "name slug")
          : await Post.find(query)
              .sort(sortConfig)
              .skip(skip)
              .limit(parseInt(limit))
              .populate("user", "username profilePictureUrl isVerified")
              .populate("media")
              .populate("hashtags", "name")
              .populate("categories", "name slug");

      // Get approximate total count
      const totalCount = await Post.countDocuments(query);

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

      // Add isLiked flag and distance to each post
      const postsWithLikeStatus = posts.map((post) => {
        // Calculate distance if the post has coordinates
        let distance = null;
        if (
          post.location &&
          post.location.coordinates &&
          post.location.coordinates.coordinates
        ) {
          const postCoords = post.location.coordinates.coordinates;
          // Simple distance calculation (not accurate for large distances)
          const latDiff = coordinates[1] - postCoords[1];
          const lngDiff = coordinates[0] - postCoords[0];
          distance = Math.sqrt(latDiff * latDiff + lngDiff * lngDiff) * 111.32; // Rough conversion to km
        }

        return {
          ...post.toObject(),
          isLiked: likedPostIds.has(post._id.toString()),
          distance: distance !== null ? parseFloat(distance.toFixed(2)) : null,
        };
      });

      res.status(200).json({
        success: true,
        data: postsWithLikeStatus,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          totalPosts: totalCount,
          totalPages: Math.ceil(totalCount / parseInt(limit)),
          hasMore: skip + posts.length < totalCount,
        },
        meta: {
          coordinates,
          radiusKm: parseFloat(radius),
          sortBy,
        },
      });
    } catch (error) {
      console.error("Error getting posts by location:", error);
      res.status(500).json({
        success: false,
        message: "Failed to get posts by location",
        error: error.message,
      });
    }
  },

  /**
   * Move a post to a collection
   * @route PUT /api/posts/:id/move-to-collection
   * @access Private
   */
  movePostToCollection: async (req, res) => {
    try {
      const postId = req.params.id;
      const userId = req.user.id;
      const { sourceCollectionId, targetCollectionId } = req.body;

      if (!sourceCollectionId || !targetCollectionId) {
        return res.status(400).json({
          success: false,
          message: "Source and target collection IDs are required",
        });
      }

      // Check if post exists
      const post = await Post.findById(postId);
      if (!post) {
        return res
          .status(404)
          .json({ success: false, message: "Post not found" });
      }

      // Check if collections exist and belong to the user
      const Collection = mongoose.model("Collection");
      const [sourceCollection, targetCollection] = await Promise.all([
        Collection.findOne({ _id: sourceCollectionId, user: userId }),
        Collection.findOne({ _id: targetCollectionId, user: userId }),
      ]);

      if (!sourceCollection) {
        return res.status(404).json({
          success: false,
          message: "Source collection not found or does not belong to you",
        });
      }

      if (!targetCollection) {
        return res.status(404).json({
          success: false,
          message: "Target collection not found or does not belong to you",
        });
      }

      // Check if post is in source collection
      const SavedPost = mongoose.model("SavedPost");
      const savedPost = await SavedPost.findOne({
        user: userId,
        post: postId,
        collection: sourceCollectionId,
      });

      if (!savedPost) {
        return res.status(404).json({
          success: false,
          message: "Post not found in the source collection",
        });
      }

      // Check if post is already in target collection
      const existingInTarget = await SavedPost.findOne({
        user: userId,
        post: postId,
        collection: targetCollectionId,
      });

      if (existingInTarget) {
        // Post already exists in target collection, just remove from source
        await SavedPost.deleteOne({
          user: userId,
          post: postId,
          collection: sourceCollectionId,
        });

        return res.status(200).json({
          success: true,
          message:
            "Post moved to the target collection (was already in target)",
        });
      }

      // Move post to target collection (update collection ID)
      savedPost.collection = targetCollectionId;
      await savedPost.save();

      res.status(200).json({
        success: true,
        message: "Post moved to the target collection successfully",
      });
    } catch (error) {
      console.error("Error moving post to collection:", error);
      res.status(500).json({
        success: false,
        message: "Failed to move post",
        error: error.message,
      });
    }
  },

  /**
   * Copy a post to another collection
   * @route POST /api/posts/:id/copy-to-collection
   * @access Private
   */
  copyPostToCollection: async (req, res) => {
    try {
      const postId = req.params.id;
      const userId = req.user.id;
      const { targetCollectionId } = req.body;

      if (!targetCollectionId) {
        return res.status(400).json({
          success: false,
          message: "Target collection ID is required",
        });
      }

      // Check if post exists
      const post = await Post.findById(postId);
      if (!post) {
        return res
          .status(404)
          .json({ success: false, message: "Post not found" });
      }

      // Check if target collection exists and belongs to the user
      const Collection = mongoose.model("Collection");
      const targetCollection = await Collection.findOne({
        _id: targetCollectionId,
        user: userId,
      });

      if (!targetCollection) {
        return res.status(404).json({
          success: false,
          message: "Target collection not found or does not belong to you",
        });
      }

      // Check if post is already in target collection
      const SavedPost = mongoose.model("SavedPost");
      const existingInTarget = await SavedPost.findOne({
        user: userId,
        post: postId,
        collection: targetCollectionId,
      });

      if (existingInTarget) {
        return res.status(200).json({
          success: true,
          message: "Post is already saved to this collection",
        });
      }

      // Add post to target collection
      await SavedPost.create({
        user: userId,
        post: postId,
        collection: targetCollectionId,
      });

      res.status(200).json({
        success: true,
        message: "Post copied to the target collection successfully",
      });
    } catch (error) {
      console.error("Error copying post to collection:", error);
      res.status(500).json({
        success: false,
        message: "Failed to copy post",
        error: error.message,
      });
    }
  },

  /**
   * Get embed code for a post
   * @route GET /api/posts/:id/embed-code
   * @access Public (for public posts only)
   */
  getPostEmbedCode: async (req, res) => {
    try {
      const postId = req.params.id;

      // Check if valid ObjectId
      if (!mongoose.Types.ObjectId.isValid(postId)) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid post ID" });
      }

      // Get post
      const post = await Post.findById(postId).populate(
        "user",
        "username profilePictureUrl isVerified"
      );

      if (!post) {
        return res
          .status(404)
          .json({ success: false, message: "Post not found" });
      }

      // Check if post is public
      if (
        post.accessControl.visibility !== "public" ||
        post.isDeleted ||
        post.isArchived ||
        post.publishingDetails.status !== "published"
      ) {
        return res.status(403).json({
          success: false,
          message: "Only public posts can be embedded",
        });
      }

      // Generate embed URL
      const baseUrl = process.env.FRONTEND_URL || "https://example.com";
      const embedUrl = `${baseUrl}/embed/post/${postId}`;

      // Generate embed code
      const embedCode = `<iframe src="${embedUrl}" width="500" height="580" frameborder="0" scrolling="no" allowtransparency="true"></iframe>`;

      // Generate og tags for SEO
      const ogTags = `<meta property="og:title" content="Post by ${post.user.username}" />
      <meta property="og:type" content="article" />
      <meta property="og:url" content="${baseUrl}/post/${postId}" />
      ${post.media && post.media.length > 0 ? `<meta property="og:image" content="${post.media[0].url}" />` : ""}
      <meta property="og:description" content="${post.caption ? post.caption.substring(0, 150) + (post.caption.length > 150 ? "..." : "") : "View this post"}" />`;

      res.status(200).json({
        success: true,
        data: {
          embedCode,
          embedUrl,
          ogTags,
          post: {
            id: post._id,
            caption: post.caption,
            user: post.user.username,
            profilePictureUrl: post.user.profilePictureUrl,
            isVerified: post.user.isVerified,
            mediaCount: post.media ? post.media.length : 0,
          },
        },
      });
    } catch (error) {
      console.error("Error generating post embed code:", error);
      res.status(500).json({
        success: false,
        message: "Failed to generate embed code",
        error: error.message,
      });
    }
  },

  /**
   * Generate shareable post URL with optional tracking parameters
   * @route GET /api/posts/:id/share-url
   * @access Public (for public posts only)
   */
  generatePostUrl: async (req, res) => {
    try {
      const postId = req.params.id;
      const { utm_source, utm_medium, utm_campaign } = req.query;

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

      // Check if post is public
      if (
        post.accessControl.visibility !== "public" ||
        post.isDeleted ||
        post.isArchived ||
        post.publishingDetails.status !== "published"
      ) {
        return res.status(403).json({
          success: false,
          message: "Only public posts can be shared with a URL",
        });
      }

      // Generate base URL
      const baseUrl = process.env.FRONTEND_URL || "https://example.com";
      let shareUrl = `${baseUrl}/post/${postId}`;

      // Add tracking parameters if provided
      const trackingParams = [];

      if (utm_source)
        trackingParams.push(`utm_source=${encodeURIComponent(utm_source)}`);
      if (utm_medium)
        trackingParams.push(`utm_medium=${encodeURIComponent(utm_medium)}`);
      if (utm_campaign)
        trackingParams.push(`utm_campaign=${encodeURIComponent(utm_campaign)}`);

      // Add user ID as referrer if authenticated
      if (req.user) {
        trackingParams.push(`ref=${req.user.id}`);
      }

      // Append tracking parameters to URL
      if (trackingParams.length > 0) {
        shareUrl += `?${trackingParams.join("&")}`;
      }

      // Log share activity if authenticated
      if (req.user) {
        const Share = mongoose.model("Share");
        await Share.create({
          user: req.user.id,
          post: postId,
          platform: "link",
          referralParams: {
            utm_source,
            utm_medium,
            utm_campaign,
          },
        });

        // Increment share count
        await post.incrementEngagement("shares_count");
      }

      res.status(200).json({
        success: true,
        data: {
          shareUrl,
          shortUrl: shareUrl, // In a real app, this would be a shortened URL
        },
      });
    } catch (error) {
      console.error("Error generating share URL:", error);
      res.status(500).json({
        success: false,
        message: "Failed to generate share URL",
        error: error.message,
      });
    }
  },

  /**
   * Export posts data for a user
   * @route GET /api/posts/export
   * @access Private
   */
  exportPostsData: async (req, res) => {
    try {
      const userId = req.user.id;
      const { format = "json", postIds } = req.query || {};

      // Validate format
      if (!["json", "csv"].includes(format)) {
        return res.status(400).json({
          success: false,
          message: "Supported formats are json and csv",
        });
      }

      // Build query
      const query = { user: userId, isDeleted: false };

      // If specific post IDs are provided
      if (postIds) {
        const postIdArray = Array.isArray(postIds)
          ? postIds
          : postIds.split(",");
        query._id = { $in: postIdArray };
      }

      // Get user's posts
      const posts = await Post.find(query)
        .populate("hashtags", "name")
        .populate("categories", "name")
        .sort({ "publishingDetails.publishedAt": -1 });

      if (posts.length === 0) {
        return res.status(404).json({
          success: false,
          message: "No posts found to export",
        });
      }

      // Get engagement data
      const postId = posts.map((post) => post._id);

      const [likes, comments, shares, saves] = await Promise.all([
        Like.countDocuments({
          likeableType: "Post",
          likeableId: { $in: postId },
        }),
        Comment.countDocuments({ post: { $in: postId } }),
        mongoose.model("Share").countDocuments({ post: { $in: postId } }),
        mongoose.model("SavedPost").countDocuments({ post: { $in: postId } }),
      ]);

      // Format data for export
      let exportData;

      if (format === "json") {
        // JSON format
        exportData = {
          user: userId,
          exportDate: new Date(),
          summary: {
            totalPosts: posts.length,
            totalLikes: likes,
            totalComments: comments,
            totalShares: shares,
            totalSaves: saves,
          },
          posts: posts.map((post) => {
            const formattedPost = {
              id: post._id,
              caption: post.caption,
              createdAt: post.createdAt,
              publishedAt: post.publishingDetails.publishedAt,
              status: post.publishingDetails.status,
              hashTags: post.hashtags.map((tag) => tag.name),
              categories: post.categories.map((cat) => cat.name),
              likes: post.likes_count || 0,
              comments: post.comments_count || 0,
              views: post.viewsCount || 0,
              isArchived: post.isArchived,
              mediaCount: post.media ? post.media.length : 0,
            };

            if (post.location && post.location.name) {
              formattedPost.location = post.location.name;
            }

            return formattedPost;
          }),
        };

        // Set response headers
        res.setHeader("Content-Type", "application/json");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="posts_export_${userId}_${Date.now()}.json"`
        );

        // Send JSON response
        return res.status(200).json(exportData);
      } else {
        // CSV format
        const createCsvStringifier =
          require("csv-writer").createObjectCsvStringifier;

        const csvStringifier = createCsvStringifier({
          header: [
            { id: "id", title: "Post ID" },
            { id: "caption", title: "Caption" },
            { id: "createdAt", title: "Created At" },
            { id: "publishedAt", title: "Published At" },
            { id: "status", title: "Status" },
            { id: "hashTags", title: "Hashtags" },
            { id: "categories", title: "Categories" },
            { id: "likes", title: "Likes" },
            { id: "comments", title: "Comments" },
            { id: "views", title: "Views" },
            { id: "isArchived", title: "Archived" },
            { id: "mediaCount", title: "Media Count" },
            { id: "location", title: "Location" },
          ],
        });

        const records = posts.map((post) => ({
          id: post._id.toString(),
          caption: post.caption
            ? post.caption.replace(/[\r\n]+/g, " ").substring(0, 100)
            : "",
          createdAt: post.createdAt ? post.createdAt.toISOString() : "",
          publishedAt: post.publishingDetails.publishedAt
            ? post.publishingDetails.publishedAt.toISOString()
            : "",
          status: post.publishingDetails.status,
          hashTags: post.hashtags.map((tag) => tag.name).join(", "),
          categories: post.categories.map((cat) => cat.name).join(", "),
          likes: post.likes_count || 0,
          comments: post.comments_count || 0,
          views: post.viewsCount || 0,
          isArchived: post.isArchived ? "Yes" : "No",
          mediaCount: post.media ? post.media.length : 0,
          location:
            post.location && post.location.name ? post.location.name : "",
        }));

        const csvHeader = csvStringifier.getHeaderString();
        const csvContent = csvStringifier.stringifyRecords(records);
        const csvData = csvHeader + csvContent;

        // Set response headers
        res.setHeader("Content-Type", "text/csv");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="posts_export_${userId}_${Date.now()}.csv"`
        );

        // Send CSV response
        return res.status(200).send(csvData);
      }
    } catch (error) {
      console.error("Error extracting user data:", error);
      res.status(500).json({
        success: false,
        message: "Failed to extract user data",
        error: error.message,
      });
    }
  },
};

module.exports = postController;

export {
  createPost,
  updatePost,
  deletePost,
  getFeedPosts,
  getUserPosts,
  getPostsByHashtag,
  getPostsByCategory,
  getTrendingPosts,
  toggleLike,
  addComment,
  getNearbyPosts,
  getRecommendations,
  batchProcessPosts,
  getSavedPosts,
  getPostById,
  getLikedPosts,
  savePost,
  unsavePost,
  approveTag,
  rejectTag,
  sharePost,
  pinPost,
  unpinPost,
  getTagApprovals,
  getDraftPosts,
  reportPost,
  getArchivedPosts,
  getScheduledPosts,
  suggestHashtags,
  archivePost,
  unarchivePost,
  getPostAnalytics,
  searchPosts,
  removeTag,
  getTaggedPosts,
  getComments,
  tagUser,
  getCommentReplies,
  replyToComment,
  toggleCommentLike,
  deleteComment,
  reportComment,
  editComment,
  getFeaturedPosts,
  getPostEngagement,
  getPostReach,
  bulkStatusUpdate,
  getSimilarPosts,
  getViralPosts,
  getPostVersionHistory,
  restorePostVersion,
  getTrendingTopics,
  getPostsByLocation,
  movePostToCollection,
  copyPostToCollection,
  getPostEmbedCode,
  generatePostUrl,
  exportPostsData,
};
