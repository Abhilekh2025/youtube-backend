// Functions:

// createConversation
// getUserConversations
// getConversationById
// updateConversation
// archiveConversation
// addParticipant
// removeParticipant
// getParticipants
// updateParticipantRole
// getAdmins
// setTheme
// setGroupSettings

import mongoose from "mongoose";
import {
  Conversation,
  ConversationParticipant,
  UserMessageIdentity,
  ChatTheme,
  DirectMessage,
} from "../../models/directmessage.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { uploadOnCloudinary } from "../utils/cloudinary.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import jwt from "jsonwebtoken";

class ConversationController {
  /**
   * Validation middleware for creating conversations
   */
  static createConversationValidation = [
    body("conversationType")
      .isIn(["direct", "group", "secret", "broadcast"])
      .withMessage("Invalid conversation type"),
    body("conversationName")
      .optional()
      .isLength({ min: 1, max: 100 })
      .trim()
      .withMessage("Conversation name must be 1-100 characters"),
    body("conversationDescription")
      .optional()
      .isLength({ max: 500 })
      .trim()
      .withMessage("Description must be max 500 characters"),
    body("participants")
      .optional()
      .isArray()
      .withMessage("Participants must be an array"),
    body("participants.*.userId")
      .optional()
      .isMongoId()
      .withMessage("Invalid participant user ID"),
    body("participants.*.identityId")
      .optional()
      .isMongoId()
      .withMessage("Invalid participant identity ID"),
    body("creatorIdentityId")
      .optional()
      .isMongoId()
      .withMessage("Invalid creator identity ID"),
  ];

  /**
   * Create a new conversation
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async createConversation(req, res) {
    try {
      // Check validation results
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: "Validation failed",
          details: errors.array(),
        });
      }

      const {
        conversationType,
        conversationName,
        conversationDescription,
        conversationAvatar,
        participants = [],
        privacySettings = {},
        secretChatSettings = {},
        groupSettings = {},
        theme,
        creatorIdentityId,
      } = req.body;

      const userId = req.user.id;

      // For direct conversations, ensure only 2 participants total
      if (conversationType === "direct" && participants.length !== 1) {
        throw new APIError(
          "Direct conversations must have exactly 2 participants (including creator)",
          400
        );
      }

      // Get or validate creator's identity
      let creatorIdentity;
      if (creatorIdentityId) {
        creatorIdentity = await UserMessageIdentity.findById(creatorIdentityId);
        if (!creatorIdentity || creatorIdentity.user.toString() !== userId) {
          throw new APIError("Invalid creator identity", 400);
        }
        if (!creatorIdentity.isUsable()) {
          throw new APIError("Creator identity is not usable", 400);
        }
      } else {
        creatorIdentity = await UserMessageIdentity.getDefaultIdentity(userId);
      }

      if (!creatorIdentity) {
        throw new APIError("No valid identity found for user", 400);
      }

      // Check if direct conversation already exists
      if (conversationType === "direct") {
        const existingConversation = await Conversation.findDirectConversation(
          userId,
          participants[0].userId
        );

        if (existingConversation.length > 0) {
          // Return existing conversation with participant details
          const conversation = existingConversation[0];
          const populatedConversation = await Conversation.findById(
            conversation._id
          )
            .populate("createdBy", "username fullName profilePicture")
            .populate("theme")
            .populate("lastMessage");

          return res.status(200).json({
            success: true,
            conversation: populatedConversation,
            message: "Direct conversation already exists",
          });
        }
      }

      // Validate theme if provided
      if (theme) {
        const themeDoc = await ChatTheme.findById(theme);
        if (!themeDoc || !themeDoc.canUseTheme(userId)) {
          throw new APIError("Invalid or inaccessible theme", 400);
        }
      }

      // Create conversation with enhanced settings
      const conversationData = {
        conversationType,
        conversationName:
          conversationName ||
          (conversationType === "direct"
            ? null
            : `New ${conversationType} conversation`),
        conversationDescription,
        conversationAvatar,
        createdBy: userId,
        privacySettings: {
          autoDeleteMessages: privacySettings.autoDeleteMessages || false,
          autoDeleteDuration: Math.min(
            Math.max(privacySettings.autoDeleteDuration || 24, 1),
            8760
          ),
          disappearingMessages: {
            enabled: privacySettings.disappearingMessages?.enabled || false,
            duration: Math.min(
              Math.max(
                privacySettings.disappearingMessages?.duration || 604800,
                5
              ),
              604800
            ),
          },
          messageRequests: privacySettings.messageRequests !== false,
          invitePermission: privacySettings.invitePermission || "everyone",
        },
        secretChatSettings:
          conversationType === "secret"
            ? {
                encryptionEnabled:
                  secretChatSettings.encryptionEnabled || false,
                screenshotNotifications:
                  secretChatSettings.screenshotNotifications || false,
                screenRecordingBlocked:
                  secretChatSettings.screenRecordingBlocked || false,
                forwardingDisabled:
                  secretChatSettings.forwardingDisabled || false,
                selfDestructTimer: Math.max(
                  secretChatSettings.selfDestructTimer || 0,
                  0
                ),
                deviceLimit: Math.min(
                  Math.max(secretChatSettings.deviceLimit || 5, 1),
                  10
                ),
              }
            : {},
        groupSettings:
          conversationType === "group"
            ? {
                maxParticipants: Math.min(
                  Math.max(groupSettings.maxParticipants || 256, 2),
                  1000
                ),
                joinApprovalRequired:
                  groupSettings.joinApprovalRequired || false,
                adminOnlyMessaging: groupSettings.adminOnlyMessaging || false,
                allowMemberInvites: groupSettings.allowMemberInvites !== false,
                allowMemberEdit: groupSettings.allowMemberEdit || false,
                muteNotifications: groupSettings.muteNotifications || false,
              }
            : {},
        theme: theme || null,
      };

      const conversation = new Conversation(conversationData);
      await conversation.save();

      // Add creator as participant with appropriate role
      const creatorRole = conversationType === "group" ? "owner" : "member";
      const creatorParticipant = new ConversationParticipant({
        conversation: conversation._id,
        user: userId,
        identity: creatorIdentity._id,
        role: creatorRole,
        permissions: {
          canSendMessages: true,
          canSendMedia: true,
          canAddMembers: conversationType !== "direct",
          canEditGroupInfo: conversationType === "group",
          canDeleteMessages: conversationType === "group",
        },
      });
      await creatorParticipant.save();

      let participantCount = 1;

      // Add other participants if any
      if (participants.length > 0) {
        const participantPromises = participants.map(async (participant) => {
          const {
            userId: participantUserId,
            identityId,
            role = "member",
          } = participant;

          // Validate participant user exists
          const User = mongoose.model("User");
          const participantUser = await User.findById(participantUserId);
          if (!participantUser) {
            throw new APIError(`User ${participantUserId} not found`, 400);
          }

          // Validate participant identity
          let participantIdentity;
          if (identityId) {
            participantIdentity =
              await UserMessageIdentity.findById(identityId);
            if (
              !participantIdentity ||
              participantIdentity.user.toString() !== participantUserId
            ) {
              throw new APIError(
                `Invalid identity for participant ${participantUserId}`,
                400
              );
            }
            if (!participantIdentity.isUsable()) {
              throw new APIError(
                `Participant identity ${identityId} is not usable`,
                400
              );
            }
          } else {
            participantIdentity =
              await UserMessageIdentity.getDefaultIdentity(participantUserId);
          }

          if (!participantIdentity) {
            throw new APIError(
              `No valid identity found for participant ${participantUserId}`,
              400
            );
          }

          const participantData = new ConversationParticipant({
            conversation: conversation._id,
            user: participantUserId,
            identity: participantIdentity._id,
            role: role,
            permissions: {
              canSendMessages: true,
              canSendMedia: true,
              canAddMembers: conversationType === "group" && role === "admin",
              canEditGroupInfo: false,
              canDeleteMessages: false,
            },
          });

          return participantData.save();
        });

        await Promise.all(participantPromises);
        participantCount += participants.length;
      }

      // Update conversation participant count
      conversation.participantCount = participantCount;
      await conversation.save();

      // Enable encryption for secret chats if requested
      if (
        conversationType === "secret" &&
        secretChatSettings.encryptionEnabled
      ) {
        await conversation.enableEncryption();
      }

      // Increment creator identity usage stats
      await creatorIdentity.incrementUsage("conversation");

      // Populate and return the response
      const populatedConversation = await Conversation.findById(
        conversation._id
      )
        .populate("createdBy", "username fullName profilePicture")
        .populate("theme")
        .populate("lastMessage");

      res.status(201).json({
        success: true,
        conversation: populatedConversation,
        message: "Conversation created successfully",
      });
    } catch (error) {
      console.error("Error creating conversation:", error);
      if (error instanceof APIError) {
        return res.status(error.statusCode).json({
          success: false,
          error: error.message,
        });
      }
      res.status(500).json({
        success: false,
        error: "Internal server error",
      });
    }
  }

  /**
   * Validation for getting user conversations
   */
  static getUserConversationsValidation = [
    query("limit")
      .optional()
      .isInt({ min: 1, max: 100 })
      .withMessage("Limit must be between 1 and 100"),
    query("skip")
      .optional()
      .isInt({ min: 0 })
      .withMessage("Skip must be a non-negative integer"),
    query("type")
      .optional()
      .isIn(["direct", "group", "secret", "broadcast"])
      .withMessage("Invalid conversation type"),
    query("includeArchived")
      .optional()
      .isBoolean()
      .withMessage("includeArchived must be a boolean"),
    query("search")
      .optional()
      .isLength({ min: 2, max: 100 })
      .withMessage("Search query must be 2-100 characters"),
  ];

  /**
   * Get user's conversations with enhanced filtering and search
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async getUserConversations(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: "Validation failed",
          details: errors.array(),
        });
      }

      const userId = req.user.id;
      const {
        limit = 20,
        skip = 0,
        type = null,
        includeArchived = false,
        search = null,
      } = req.query;

      const options = {
        limit: parseInt(limit),
        skip: parseInt(skip),
        type,
        includeArchived: includeArchived === "true",
      };

      let conversations = await Conversation.getUserConversations(
        userId,
        options
      );

      // Apply search filtering if provided
      if (search) {
        const searchRegex = new RegExp(search.trim(), "i");
        conversations = conversations.filter(
          (conv) =>
            conv.conversationName?.match(searchRegex) ||
            conv.conversationDescription?.match(searchRegex)
        );
      }

      // Add enhanced details for each conversation
      const conversationsWithDetails = await Promise.all(
        conversations.map(async (conv) => {
          // Get unread message count
          const unreadCount = await DirectMessage.countDocuments({
            conversation: conv._id,
            sender: { $ne: userId },
            readBy: { $not: { $elemMatch: { user: userId } } },
            isDeleted: false,
            deletedFor: { $not: { $elemMatch: { user: userId } } },
          });

          // Get participant info for this user
          const participant = await ConversationParticipant.findOne({
            conversation: conv._id,
            user: userId,
            leftAt: { $exists: false },
          }).populate("identity", "messageAlias displayName avatar");

          // Get other participants for direct conversations
          let otherParticipant = null;
          if (conv.conversationType === "direct") {
            otherParticipant = await ConversationParticipant.findOne({
              conversation: conv._id,
              user: { $ne: userId },
              leftAt: { $exists: false },
            })
              .populate("user", "username fullName profilePicture")
              .populate("identity", "messageAlias displayName avatar");
          }

          // Get last message details if exists
          let lastMessageDetails = null;
          if (conv.lastMessage) {
            lastMessageDetails = await DirectMessage.findById(conv.lastMessage)
              .select("content messageType sentAt sender")
              .populate("sender", "username fullName");
          }

          return {
            ...conv.toObject(),
            unreadCount,
            userParticipant: participant,
            otherParticipant: otherParticipant,
            lastMessageDetails,
            isPinned: participant?.isPinned || false,
            isArchived: participant?.isArchived || false,
            isMuted: participant?.notifications?.isMuted || false,
            isBlocked: participant?.isBlocked || false,
          };
        })
      );

      // Sort by pinned status and last message time
      conversationsWithDetails.sort((a, b) => {
        // Pinned conversations first
        if (a.isPinned !== b.isPinned) {
          return b.isPinned - a.isPinned;
        }
        // Then by last message time
        return new Date(b.lastMessageAt) - new Date(a.lastMessageAt);
      });

      res.json({
        success: true,
        conversations: conversationsWithDetails,
        pagination: {
          total: conversationsWithDetails.length,
          limit: parseInt(limit),
          skip: parseInt(skip),
          hasMore: conversationsWithDetails.length === parseInt(limit),
        },
      });
    } catch (error) {
      console.error("Error getting user conversations:", error);
      res.status(500).json({
        success: false,
        error: "Internal server error",
      });
    }
  }

  /**
   * Validation for getting conversation by ID
   */
  static getConversationByIdValidation = [
    param("conversationId").isMongoId().withMessage("Invalid conversation ID"),
  ];

  /**
   * Get conversation by ID with comprehensive details
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async getConversationById(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: "Validation failed",
          details: errors.array(),
        });
      }

      const { conversationId } = req.params;
      const userId = req.user.id;

      const conversation = await Conversation.findById(conversationId)
        .populate("createdBy", "username fullName profilePicture")
        .populate("theme")
        .populate("lastMessage");

      if (!conversation || conversation.isDeleted) {
        throw new APIError("Conversation not found", 404);
      }

      // Check if user is a participant
      const isParticipant = await conversation.isParticipant(userId);
      if (!isParticipant) {
        throw new APIError("Access denied", 403);
      }

      // Get user's participant info
      const participant = await ConversationParticipant.findOne({
        conversation: conversationId,
        user: userId,
        leftAt: { $exists: false },
      }).populate("identity", "messageAlias displayName avatar");

      // Get participant list for non-direct conversations
      let participants = [];
      if (conversation.conversationType !== "direct") {
        participants =
          await ConversationParticipant.getConversationParticipants(
            conversationId,
            { includeLeft: false, limit: 100 }
          );
      } else {
        // For direct conversations, get the other participant
        participants = await ConversationParticipant.find({
          conversation: conversationId,
          leftAt: { $exists: false },
        })
          .populate("user", "username fullName profilePicture")
          .populate("identity", "messageAlias displayName avatar");
      }

      // Get unread message count
      const unreadCount = await DirectMessage.countDocuments({
        conversation: conversationId,
        sender: { $ne: userId },
        readBy: { $not: { $elemMatch: { user: userId } } },
        isDeleted: false,
        deletedFor: { $not: { $elemMatch: { user: userId } } },
      });

      // Get pinned messages
      const pinnedMessages = await DirectMessage.find({
        conversation: conversationId,
        isPinned: true,
        isDeleted: false,
        deletedFor: { $not: { $elemMatch: { user: userId } } },
      })
        .populate("sender", "username fullName")
        .populate("pinnedBy", "username fullName")
        .sort({ pinnedAt: -1 })
        .limit(10);

      // Update user's last seen
      if (participant) {
        participant.lastSeenAt = new Date();
        await participant.save();
      }

      res.json({
        success: true,
        conversation: {
          ...conversation.toObject(),
          userParticipant: participant,
          participants: participants,
          pinnedMessages,
          unreadCount,
          userRole: participant?.role,
          userPermissions: participant?.permissions,
          canEdit: participant && ["admin", "owner"].includes(participant.role),
          canDelete: participant && participant.role === "owner",
          canInvite:
            participant &&
            (participant.permissions.canAddMembers ||
              ["admin", "owner"].includes(participant.role)),
        },
      });
    } catch (error) {
      console.error("Error getting conversation:", error);
      if (error instanceof APIError) {
        return res.status(error.statusCode).json({
          success: false,
          error: error.message,
        });
      }
      res.status(500).json({
        success: false,
        error: "Internal server error",
      });
    }
  }

  /**
   * Validation for updating conversation
   */
  static updateConversationValidation = [
    param("conversationId").isMongoId().withMessage("Invalid conversation ID"),
    body("conversationName")
      .optional()
      .isLength({ min: 1, max: 100 })
      .trim()
      .withMessage("Conversation name must be 1-100 characters"),
    body("conversationDescription")
      .optional()
      .isLength({ max: 500 })
      .trim()
      .withMessage("Description must be max 500 characters"),
    body("privacySettings.autoDeleteDuration")
      .optional()
      .isInt({ min: 1, max: 8760 })
      .withMessage("Auto delete duration must be 1-8760 hours"),
    body("groupSettings.maxParticipants")
      .optional()
      .isInt({ min: 2, max: 1000 })
      .withMessage("Max participants must be 2-1000"),
  ];

  /**
   * Update conversation details with validation
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async updateConversation(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: "Validation failed",
          details: errors.array(),
        });
      }

      const { conversationId } = req.params;
      const userId = req.user.id;
      const updates = req.body;

      const conversation = await Conversation.findById(conversationId);
      if (!conversation || conversation.isDeleted) {
        throw new APIError("Conversation not found", 404);
      }

      // Check permissions
      const participantRole = await conversation.getParticipantRole(userId);
      if (!participantRole || !["admin", "owner"].includes(participantRole)) {
        throw new APIError("Insufficient permissions", 403);
      }

      // Allowed fields to update
      const allowedUpdates = [
        "conversationName",
        "conversationDescription",
        "conversationAvatar",
        "privacySettings",
        "groupSettings",
      ];

      const updateData = {};
      Object.keys(updates).forEach((key) => {
        if (allowedUpdates.includes(key)) {
          updateData[key] = updates[key];
        }
      });

      // Validate and merge nested objects
      if (updates.privacySettings) {
        updateData.privacySettings = {
          ...conversation.privacySettings.toObject(),
          ...updates.privacySettings,
        };

        // Validate auto delete duration
        if (updateData.privacySettings.autoDeleteDuration) {
          updateData.privacySettings.autoDeleteDuration = Math.min(
            Math.max(updateData.privacySettings.autoDeleteDuration, 1),
            8760
          );
        }
      }

      if (updates.groupSettings && conversation.conversationType === "group") {
        updateData.groupSettings = {
          ...conversation.groupSettings.toObject(),
          ...updates.groupSettings,
        };

        // Validate max participants
        if (updateData.groupSettings.maxParticipants) {
          const newLimit = updateData.groupSettings.maxParticipants;
          if (newLimit < conversation.participantCount) {
            throw new APIError(
              "Cannot set max participants below current participant count",
              400
            );
          }
          updateData.groupSettings.maxParticipants = Math.min(
            Math.max(newLimit, 2),
            1000
          );
        }
      }

      // Apply updates
      Object.assign(conversation, updateData);
      await conversation.save();

      // Create system message for group updates
      if (conversation.conversationType === "group") {
        const participant = await ConversationParticipant.findOne({
          conversation: conversationId,
          user: userId,
          leftAt: { $exists: false },
        });

        const systemMessage = new DirectMessage({
          conversation: conversationId,
          sender: userId,
          senderIdentity: participant.identity,
          messageType: "system",
          systemMessage: {
            type: "settings_changed",
            data: {
              updatedBy: userId,
              changes: Object.keys(updateData),
              timestamp: new Date(),
            },
          },
        });
        await systemMessage.save();

        // Update conversation's last message
        await conversation.updateLastMessage(systemMessage._id);
      }

      const updatedConversation = await Conversation.findById(conversationId)
        .populate("createdBy", "username fullName profilePicture")
        .populate("theme")
        .populate("lastMessage");

      res.json({
        success: true,
        conversation: updatedConversation,
        message: "Conversation updated successfully",
      });
    } catch (error) {
      console.error("Error updating conversation:", error);
      if (error instanceof APIError) {
        return res.status(error.statusCode).json({
          success: false,
          error: error.message,
        });
      }
      res.status(500).json({
        success: false,
        error: "Internal server error",
      });
    }
  }

  /**
   * Archive/unarchive conversation for user
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async archiveConversation(req, res) {
    try {
      const { conversationId } = req.params;
      const userId = req.user.id;
      const { archive = true } = req.body;

      if (!mongoose.Types.ObjectId.isValid(conversationId)) {
        throw new APIError("Invalid conversation ID", 400);
      }

      const conversation = await Conversation.findById(conversationId);
      if (!conversation || conversation.isDeleted) {
        throw new APIError("Conversation not found", 404);
      }

      // Check if user is participant
      const participant = await ConversationParticipant.findOne({
        conversation: conversationId,
        user: userId,
        leftAt: { $exists: false },
      });

      if (!participant) {
        throw new APIError("Access denied", 403);
      }

      // Update participant's archive status
      participant.isArchived = archive;
      await participant.save();

      res.json({
        success: true,
        message: archive ? "Conversation archived" : "Conversation unarchived",
      });
    } catch (error) {
      console.error("Error archiving conversation:", error);
      if (error instanceof APIError) {
        return res.status(error.statusCode).json({
          success: false,
          error: error.message,
        });
      }
      res.status(500).json({
        success: false,
        error: "Internal server error",
      });
    }
  }

  /**
   * Validation for adding participant
   */
  static addParticipantValidation = [
    param("conversationId").isMongoId().withMessage("Invalid conversation ID"),
    body("userId").isMongoId().withMessage("Invalid user ID"),
    body("identityId")
      .optional()
      .isMongoId()
      .withMessage("Invalid identity ID"),
    body("role")
      .optional()
      .isIn(["member", "admin", "moderator"])
      .withMessage("Invalid role"),
  ];

  /**
   * Add participant to conversation with enhanced validation
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async addParticipant(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: "Validation failed",
          details: errors.array(),
        });
      }

      const { conversationId } = req.params;
      const { userId: newUserId, identityId, role = "member" } = req.body;
      const requesterId = req.user.id;

      const conversation = await Conversation.findById(conversationId);
      if (!conversation || conversation.isDeleted) {
        throw new APIError("Conversation not found", 404);
      }

      // Check if conversation allows adding members
      if (conversation.conversationType === "direct") {
        throw new APIError(
          "Cannot add participants to direct conversations",
          400
        );
      }

      // Validate new user exists
      const User = mongoose.model("User");
      const newUser = await User.findById(newUserId);
      if (!newUser) {
        throw new APIError("User not found", 404);
      }

      // Check permissions
      const requesterParticipant = await ConversationParticipant.findOne({
        conversation: conversationId,
        user: requesterId,
        leftAt: { $exists: false },
      });

      if (!requesterParticipant) {
        throw new APIError("Access denied", 403);
      }

      // Check if requester can add members
      const canAddMembers =
        requesterParticipant.permissions.canAddMembers ||
        ["admin", "owner"].includes(requesterParticipant.role);

      if (!canAddMembers) {
        throw new APIError("Insufficient permissions to add members", 403);
      }

      // Check if user is already a participant
      const existingParticipant = await ConversationParticipant.findOne({
        conversation: conversationId,
        user: newUserId,
        leftAt: { $exists: false },
      });

      if (existingParticipant) {
        throw new APIError("User is already a participant", 400);
      }

      // Check group limits
      if (conversation.conversationType === "group") {
        const currentCount = await ConversationParticipant.countDocuments({
          conversation: conversationId,
          leftAt: { $exists: false },
        });

        if (currentCount >= conversation.groupSettings.maxParticipants) {
          throw new APIError(
            "Group has reached maximum participant limit",
            400
          );
        }

        // Check if join approval is required
        if (
          conversation.groupSettings.joinApprovalRequired &&
          !["admin", "owner"].includes(requesterParticipant.role)
        ) {
          throw new APIError("Join approval required from admin", 403);
        }
      }

      // Get new participant's identity
      let participantIdentity;
      if (identityId) {
        participantIdentity = await UserMessageIdentity.findById(identityId);
        if (
          !participantIdentity ||
          participantIdentity.user.toString() !== newUserId
        ) {
          throw new APIError("Invalid identity for new participant", 400);
        }
        if (!participantIdentity.isUsable()) {
          throw new APIError("Participant identity is not usable", 400);
        }
      } else {
        participantIdentity =
          await UserMessageIdentity.getDefaultIdentity(newUserId);
      }

      if (!participantIdentity) {
        throw new APIError("No valid identity found for new participant", 400);
      }

      // Only allow admin role if requester is admin/owner
      const finalRole =
        role === "admin" &&
        !["admin", "owner"].includes(requesterParticipant.role)
          ? "member"
          : role;

      // Create new participant
      const newParticipant = new ConversationParticipant({
        conversation: conversationId,
        user: newUserId,
        identity: participantIdentity._id,
        role: finalRole,
        permissions: {
          canSendMessages: true,
          canSendMedia: true,
          canAddMembers: finalRole === "admin",
          canEditGroupInfo: false,
          canDeleteMessages: finalRole === "admin",
        },
      });

      await newParticipant.save();

      // Update conversation participant count
      conversation.participantCount += 1;
      await conversation.save();

      // Create system message
      const systemMessage = new DirectMessage({
        conversation: conversationId,
        sender: requesterId,
        senderIdentity: requesterParticipant.identity,
        messageType: "system",
        systemMessage: {
          type: "user_added",
          data: {
            addedUser: newUserId,
            addedBy: requesterId,
            role: finalRole,
            timestamp: new Date(),
          },
        },
      });
      await systemMessage.save();

      // Update conversation's last message
      await conversation.updateLastMessage(systemMessage._id);

      const populatedParticipant = await ConversationParticipant.findById(
        newParticipant._id
      )
        .populate("user", "username fullName profilePicture")
        .populate("identity", "messageAlias displayName avatar");

      res.status(201).json({
        success: true,
        participant: populatedParticipant,
        message: "Participant added successfully",
      });
    } catch (error) {
      console.error("Error adding participant:", error);
      if (error instanceof APIError) {
        return res.status(error.statusCode).json({
          success: false,
          error: error.message,
        });
      }
      res.status(500).json({
        success: false,
        error: "Internal server error",
      });
    }
  }

  /**
   * Validation for removing participant
   */
  static removeParticipantValidation = [
    param("conversationId").isMongoId().withMessage("Invalid conversation ID"),
    param("userId").isMongoId().withMessage("Invalid user ID"),
  ];

  /**
   * Remove participant from conversation
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async removeParticipant(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: "Validation failed",
          details: errors.array(),
        });
      }

      const { conversationId, userId: targetUserId } = req.params;
      const requesterId = req.user.id;

      const conversation = await Conversation.findById(conversationId);
      if (!conversation || conversation.isDeleted) {
        throw new APIError("Conversation not found", 404);
      }

      // Check if conversation allows removing members
      if (conversation.conversationType === "direct") {
        throw new APIError(
          "Cannot remove participants from direct conversations",
          400
        );
      }

      // Get requester and target participants
      const requesterParticipant = await ConversationParticipant.findOne({
        conversation: conversationId,
        user: requesterId,
        leftAt: { $exists: false },
      });

      const targetParticipant = await ConversationParticipant.findOne({
        conversation: conversationId,
        user: targetUserId,
        leftAt: { $exists: false },
      });

      if (!requesterParticipant) {
        throw new APIError("Access denied", 403);
      }

      if (!targetParticipant) {
        throw new APIError("Target user is not a participant", 404);
      }

      // Check permissions (users can remove themselves, admins can remove members)
      const isSelfRemoval = requesterId === targetUserId;
      const isAdminAction = ["admin", "owner"].includes(
        requesterParticipant.role
      );
      const isTargetOwner = targetParticipant.role === "owner";
      const isTargetAdmin = targetParticipant.role === "admin";

      if (!isSelfRemoval && !isAdminAction) {
        throw new APIError(
          "Insufficient permissions to remove participant",
          403
        );
      }

      // Owners cannot be removed by others
      if (isTargetOwner && !isSelfRemoval) {
        throw new APIError("Cannot remove conversation owner", 403);
      }

      // Only owners can remove admins
      if (
        isTargetAdmin &&
        !isSelfRemoval &&
        requesterParticipant.role !== "owner"
      ) {
        throw new APIError("Only owners can remove admins", 403);
      }

      // Check if this would leave the group without any owners
      if (isTargetOwner && conversation.conversationType === "group") {
        const ownerCount = await ConversationParticipant.countDocuments({
          conversation: conversationId,
          role: "owner",
          leftAt: { $exists: false },
        });

        if (ownerCount <= 1) {
          throw new APIError(
            "Cannot remove the last owner. Transfer ownership first.",
            400
          );
        }
      }

      // Remove participant
      targetParticipant.leftAt = new Date();
      await targetParticipant.save();

      // Update conversation participant count
      conversation.participantCount = Math.max(
        0,
        conversation.participantCount - 1
      );
      await conversation.save();

      // Create system message
      const systemMessage = new DirectMessage({
        conversation: conversationId,
        sender: requesterId,
        senderIdentity: requesterParticipant.identity,
        messageType: "system",
        systemMessage: {
          type: isSelfRemoval ? "user_left" : "user_removed",
          data: {
            targetUser: targetUserId,
            actionBy: requesterId,
            timestamp: new Date(),
          },
        },
      });
      await systemMessage.save();

      // Update conversation's last message
      await conversation.updateLastMessage(systemMessage._id);

      res.json({
        success: true,
        message: isSelfRemoval
          ? "Left conversation successfully"
          : "Participant removed successfully",
      });
    } catch (error) {
      console.error("Error removing participant:", error);
      if (error instanceof APIError) {
        return res.status(error.statusCode).json({
          success: false,
          error: error.message,
        });
      }
      res.status(500).json({
        success: false,
        error: "Internal server error",
      });
    }
  }

  /**
   * Validation for getting participants
   */
  static getParticipantsValidation = [
    param("conversationId").isMongoId().withMessage("Invalid conversation ID"),
    query("includeLeft")
      .optional()
      .isBoolean()
      .withMessage("includeLeft must be a boolean"),
    query("role")
      .optional()
      .isIn(["member", "admin", "owner", "moderator"])
      .withMessage("Invalid role filter"),
    query("limit")
      .optional()
      .isInt({ min: 1, max: 200 })
      .withMessage("Limit must be between 1 and 200"),
    query("skip")
      .optional()
      .isInt({ min: 0 })
      .withMessage("Skip must be a non-negative integer"),
  ];

  /**
   * Get conversation participants with database-level search and filtering
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async getParticipants(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: "Validation failed",
          details: errors.array(),
        });
      }

      const { conversationId } = req.params;
      const userId = req.user.id;
      const {
        includeLeft = false,
        role = null,
        limit = 50,
        skip = 0,
        search = null,
      } = req.query;

      const conversation = await Conversation.findById(conversationId);
      if (!conversation || conversation.isDeleted) {
        throw new APIError("Conversation not found", 404);
      }

      // Check if user is participant
      const isParticipant = await conversation.isParticipant(userId);
      if (!isParticipant) {
        throw new APIError("Access denied", 403);
      }

      // Build aggregation pipeline for database-level search
      const pipeline = [
        // Stage 1: Match conversation participants
        {
          $match: {
            conversation: mongoose.Types.ObjectId(conversationId),
            ...(includeLeft !== "true" && { leftAt: { $exists: false } }),
            ...(role && { role: role }),
          },
        },

        // Stage 2: Lookup user information
        {
          $lookup: {
            from: "users",
            localField: "user",
            foreignField: "_id",
            as: "user",
            pipeline: [
              {
                $project: {
                  username: 1,
                  fullName: 1,
                  profilePicture: 1,
                  email: 1, // Include email for admin purposes
                },
              },
            ],
          },
        },

        // Stage 3: Lookup identity information
        {
          $lookup: {
            from: "usermessageidentities",
            localField: "identity",
            foreignField: "_id",
            as: "identity",
            pipeline: [
              {
                $project: {
                  messageAlias: 1,
                  displayName: 1,
                  avatar: 1,
                  isDefault: 1,
                },
              },
            ],
          },
        },

        // Stage 4: Unwind arrays (convert from array to object)
        {
          $unwind: {
            path: "$user",
            preserveNullAndEmptyArrays: false,
          },
        },
        {
          $unwind: {
            path: "$identity",
            preserveNullAndEmptyArrays: false,
          },
        },
      ];

      // Stage 5: Add search conditions if provided
      if (search && search.trim()) {
        const searchRegex = new RegExp(
          search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\ }"),
          "i"
        );
        pipeline.push({
          $match: {
            $or: [
              { "user.username": searchRegex },
              { "user.fullName": searchRegex },
              { "user.email": searchRegex },
              { "identity.messageAlias": searchRegex },
              { "identity.displayName": searchRegex },
            ],
          },
        });
      }

      // Create separate pipeline for counting total results
      const countPipeline = [...pipeline];
      countPipeline.push({ $count: "total" });

      // Stage 6: Add sorting
      pipeline.push({
        $sort: {
          // Sort by role hierarchy first
          role: 1, // This will need custom sorting, we'll handle it in post-processing
          joinedAt: 1, // Then by join date
        },
      });

      // Stage 7: Add pagination
      pipeline.push({ $skip: parseInt(skip) }, { $limit: parseInt(limit) });

      // Execute both pipelines in parallel
      const [participants, countResult] = await Promise.all([
        ConversationParticipant.aggregate(pipeline),
        ConversationParticipant.aggregate(countPipeline),
      ]);

      const total = countResult[0]?.total || 0;

      // Add enhanced participant info and message counts
      const participantsWithStatus = await Promise.all(
        participants.map(async (participant) => {
          // Get message count for this participant
          const messageCount = await DirectMessage.countDocuments({
            conversation: conversationId,
            sender: participant.user._id,
            isDeleted: false,
          });

          // Calculate additional fields
          const joinedDaysAgo = Math.floor(
            (new Date() - new Date(participant.joinedAt)) /
              (1000 * 60 * 60 * 24)
          );

          return {
            _id: participant._id,
            conversation: participant.conversation,
            user: participant.user,
            identity: participant.identity,
            role: participant.role,
            joinedAt: participant.joinedAt,
            leftAt: participant.leftAt,
            permissions: participant.permissions,
            notifications: participant.notifications,
            isPinned: participant.isPinned,
            isArchived: participant.isArchived,
            isBlocked: participant.isBlocked,
            lastSeenAt: participant.lastSeenAt,

            // Enhanced computed fields
            isOnline: false, // Would be populated from real-time service
            lastSeen: participant.lastSeenAt,
            messageCount: messageCount,
            joinedDaysAgo: joinedDaysAgo,
            canBePromoted: participant.role === "member",
            canBeDemoted: participant.role === "admin",
            canBeRemoved: participant.role !== "owner" || total > 1,

            // Status indicators
            isActive: !participant.leftAt,
            hasCustomAvatar: !!participant.identity.avatar,
            isDefaultIdentity: participant.identity.isDefault,
          };
        })
      );

      // Custom sort by role hierarchy (since MongoDB can't do this efficiently)
      participantsWithStatus.sort((a, b) => {
        const roleOrder = { owner: 0, admin: 1, moderator: 2, member: 3 };
        const roleComparison = roleOrder[a.role] - roleOrder[b.role];

        if (roleComparison !== 0) return roleComparison;
        return new Date(a.joinedAt) - new Date(b.joinedAt);
      });

      // Calculate statistics
      const stats = {
        totalActive: participantsWithStatus.filter((p) => p.isActive).length,
        totalLeft:
          total - participantsWithStatus.filter((p) => p.isActive).length,
        ownerCount: participantsWithStatus.filter(
          (p) => p.role === "owner" && p.isActive
        ).length,
        adminCount: participantsWithStatus.filter(
          (p) => p.role === "admin" && p.isActive
        ).length,
        moderatorCount: participantsWithStatus.filter(
          (p) => p.role === "moderator" && p.isActive
        ).length,
        memberCount: participantsWithStatus.filter(
          (p) => p.role === "member" && p.isActive
        ).length,
        searchResultCount: search ? participantsWithStatus.length : null,
      };

      res.json({
        success: true,
        participants: participantsWithStatus,
        pagination: {
          total: total,
          limit: parseInt(limit),
          skip: parseInt(skip),
          hasMore: parseInt(skip) + parseInt(limit) < total,
          currentPage: Math.floor(parseInt(skip) / parseInt(limit)) + 1,
          totalPages: Math.ceil(total / parseInt(limit)),
        },
        stats: stats,
        search: search
          ? {
              query: search.trim(),
              resultsFound: participantsWithStatus.length,
              totalSearched: total,
            }
          : null,
      });
    } catch (error) {
      console.error("Error getting participants:", error);
      if (error instanceof APIError) {
        return res.status(error.statusCode).json({
          success: false,
          error: error.message,
        });
      }
      res.status(500).json({
        success: false,
        error: "Internal server error",
      });
    }
  }

  /**
   * Validation for updating participant role
   */
  static updateParticipantRoleValidation = [
    param("conversationId").isMongoId().withMessage("Invalid conversation ID"),
    param("userId").isMongoId().withMessage("Invalid user ID"),
    body("role")
      .isIn(["member", "admin", "owner", "moderator"])
      .withMessage("Invalid role"),
    body("permissions")
      .optional()
      .isObject()
      .withMessage("Permissions must be an object"),
  ];

  /**
   * Update participant role with comprehensive validation
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async updateParticipantRole(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: "Validation failed",
          details: errors.array(),
        });
      }

      const { conversationId, userId: targetUserId } = req.params;
      const { role, permissions = {} } = req.body;
      const requesterId = req.user.id;

      const conversation = await Conversation.findById(conversationId);
      if (!conversation || conversation.isDeleted) {
        throw new APIError("Conversation not found", 404);
      }

      // Only group conversations have meaningful roles
      if (conversation.conversationType !== "group") {
        throw new APIError("Roles only apply to group conversations", 400);
      }

      // Get participants
      const requesterParticipant = await ConversationParticipant.findOne({
        conversation: conversationId,
        user: requesterId,
        leftAt: { $exists: false },
      });

      const targetParticipant = await ConversationParticipant.findOne({
        conversation: conversationId,
        user: targetUserId,
        leftAt: { $exists: false },
      });

      if (!requesterParticipant || !targetParticipant) {
        throw new APIError("Participant not found", 404);
      }

      // Check permissions based on role hierarchy
      const canManageRoles = this.canManageRole(
        requesterParticipant.role,
        targetParticipant.role,
        role
      );
      if (!canManageRoles.allowed) {
        throw new APIError(canManageRoles.reason, 403);
      }

      // Handle ownership transfer
      if (role === "owner") {
        if (requesterParticipant.role !== "owner") {
          throw new APIError("Only owners can transfer ownership", 403);
        }

        // Demote current owner to admin
        requesterParticipant.role = "admin";
        await requesterParticipant.save();
      }

      // Update role and permissions
      const oldRole = targetParticipant.role;
      targetParticipant.role = role;

      // Set default permissions based on role
      const defaultPermissions = this.getDefaultPermissions(role);
      targetParticipant.permissions = {
        ...defaultPermissions,
        ...permissions,
      };

      await targetParticipant.save();

      // Create system message
      const systemMessage = new DirectMessage({
        conversation: conversationId,
        sender: requesterId,
        senderIdentity: requesterParticipant.identity,
        messageType: "system",
        systemMessage: {
          type: this.getRoleChangeType(oldRole, role),
          data: {
            targetUser: targetUserId,
            oldRole: oldRole,
            newRole: role,
            changedBy: requesterId,
            timestamp: new Date(),
          },
        },
      });
      await systemMessage.save();

      // Update conversation's last message
      await conversation.updateLastMessage(systemMessage._id);

      const updatedParticipant = await ConversationParticipant.findById(
        targetParticipant._id
      )
        .populate("user", "username fullName profilePicture")
        .populate("identity", "messageAlias displayName avatar");

      res.json({
        success: true,
        participant: updatedParticipant,
        message: `Role updated from ${oldRole} to ${role} successfully`,
      });
    } catch (error) {
      console.error("Error updating participant role:", error);
      if (error instanceof APIError) {
        return res.status(error.statusCode).json({
          success: false,
          error: error.message,
        });
      }
      res.status(500).json({
        success: false,
        error: "Internal server error",
      });
    }
  }

  /**
   * Get conversation admins
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async getAdmins(req, res) {
    try {
      const { conversationId } = req.params;
      const userId = req.user.id;

      if (!mongoose.Types.ObjectId.isValid(conversationId)) {
        throw new APIError("Invalid conversation ID", 400);
      }

      const conversation = await Conversation.findById(conversationId);
      if (!conversation || conversation.isDeleted) {
        throw new APIError("Conversation not found", 404);
      }

      // Check if user is participant
      const isParticipant = await conversation.isParticipant(userId);
      if (!isParticipant) {
        throw new APIError("Access denied", 403);
      }

      const admins =
        await ConversationParticipant.getConversationAdmins(conversationId);

      // Add additional admin info
      const adminsWithDetails = admins.map((admin) => ({
        ...admin.toObject(),
        isOwner: admin.role === "owner",
        canDemote: admin.role === "admin", // Owners cannot be demoted through this endpoint
        joinedDate: admin.joinedAt,
        permissions: admin.permissions,
      }));

      res.json({
        success: true,
        admins: adminsWithDetails,
        count: adminsWithDetails.length,
        breakdown: {
          owners: adminsWithDetails.filter((a) => a.role === "owner").length,
          admins: adminsWithDetails.filter((a) => a.role === "admin").length,
          moderators: adminsWithDetails.filter((a) => a.role === "moderator")
            .length,
        },
      });
    } catch (error) {
      console.error("Error getting admins:", error);
      if (error instanceof APIError) {
        return res.status(error.statusCode).json({
          success: false,
          error: error.message,
        });
      }
      res.status(500).json({
        success: false,
        error: "Internal server error",
      });
    }
  }

  /**
   * Validation for setting theme
   */
  static setThemeValidation = [
    param("conversationId").isMongoId().withMessage("Invalid conversation ID"),
    body("themeId").optional().isMongoId().withMessage("Invalid theme ID"),
    body("customizations")
      .optional()
      .isObject()
      .withMessage("Customizations must be an object"),
  ];

  /**
   * Set conversation theme with user preference handling
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async setTheme(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: "Validation failed",
          details: errors.array(),
        });
      }

      const { conversationId } = req.params;
      const { themeId, customizations = {} } = req.body;
      const userId = req.user.id;

      const conversation = await Conversation.findById(conversationId);
      if (!conversation || conversation.isDeleted) {
        throw new APIError("Conversation not found", 404);
      }

      // Check if user is participant
      const participant = await ConversationParticipant.findOne({
        conversation: conversationId,
        user: userId,
        leftAt: { $exists: false },
      });

      if (!participant) {
        throw new APIError("Access denied", 403);
      }

      // Validate theme if provided
      if (themeId) {
        const theme = await ChatTheme.findById(themeId);
        if (!theme || theme.isDeleted) {
          throw new APIError("Theme not found", 404);
        }

        // Check if user can use this theme
        if (!theme.canUseTheme(userId)) {
          throw new APIError(
            "You don't have permission to use this theme",
            403
          );
        }

        // Increment theme usage
        await theme.incrementUsage();
      }

      // For group conversations, only admins can change theme for everyone
      if (conversation.conversationType === "group") {
        const canChangeGroupTheme = ["admin", "owner"].includes(
          participant.role
        );

        if (canChangeGroupTheme) {
          // Set theme for the entire conversation
          conversation.theme = themeId || null;
          await conversation.save();

          // Create system message
          const systemMessage = new DirectMessage({
            conversation: conversationId,
            sender: userId,
            senderIdentity: participant.identity,
            messageType: "system",
            systemMessage: {
              type: "settings_changed",
              data: {
                setting: "theme",
                changedBy: userId,
                newTheme: themeId,
                timestamp: new Date(),
              },
            },
          });
          await systemMessage.save();

          await conversation.updateLastMessage(systemMessage._id);

          res.json({
            success: true,
            message: "Conversation theme updated for all participants",
            scope: "conversation",
            themeId: themeId,
          });
        } else {
          // Set theme only for this user (personal override)
          let preferences = await UserThemePreference.findOne({ user: userId });
          if (!preferences) {
            preferences = new UserThemePreference({ user: userId });
          }

          await preferences.setConversationTheme(
            conversationId,
            themeId,
            customizations
          );

          res.json({
            success: true,
            message: "Personal theme preference updated for this conversation",
            scope: "personal",
            themeId: themeId,
          });
        }
      } else {
        // For direct/secret conversations, participants can set theme
        conversation.theme = themeId || null;
        await conversation.save();

        res.json({
          success: true,
          message: "Conversation theme updated",
          scope: "conversation",
          themeId: themeId,
        });
      }
    } catch (error) {
      console.error("Error setting theme:", error);
      if (error instanceof APIError) {
        return res.status(error.statusCode).json({
          success: false,
          error: error.message,
        });
      }
      res.status(500).json({
        success: false,
        error: "Internal server error",
      });
    }
  }

  /**
   * Validation for setting group settings
   */
  static setGroupSettingsValidation = [
    param("conversationId").isMongoId().withMessage("Invalid conversation ID"),
    body("maxParticipants")
      .optional()
      .isInt({ min: 2, max: 1000 })
      .withMessage("Max participants must be between 2 and 1000"),
    body("joinApprovalRequired")
      .optional()
      .isBoolean()
      .withMessage("joinApprovalRequired must be a boolean"),
    body("adminOnlyMessaging")
      .optional()
      .isBoolean()
      .withMessage("adminOnlyMessaging must be a boolean"),
    body("allowMemberInvites")
      .optional()
      .isBoolean()
      .withMessage("allowMemberInvites must be a boolean"),
    body("allowMemberEdit")
      .optional()
      .isBoolean()
      .withMessage("allowMemberEdit must be a boolean"),
    body("muteNotifications")
      .optional()
      .isBoolean()
      .withMessage("muteNotifications must be a boolean"),
  ];

  /**
   * Set group settings with comprehensive validation
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async setGroupSettings(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: "Validation failed",
          details: errors.array(),
        });
      }

      const { conversationId } = req.params;
      const settings = req.body;
      const userId = req.user.id;

      const conversation = await Conversation.findById(conversationId);
      if (!conversation || conversation.isDeleted) {
        throw new APIError("Conversation not found", 404);
      }

      // Only group conversations have group settings
      if (conversation.conversationType !== "group") {
        throw new APIError(
          "Group settings only apply to group conversations",
          400
        );
      }

      // Check permissions
      const participant = await ConversationParticipant.findOne({
        conversation: conversationId,
        user: userId,
        leftAt: { $exists: false },
      });

      if (!participant) {
        throw new APIError("Access denied", 403);
      }

      const canEditSettings =
        ["admin", "owner"].includes(participant.role) ||
        participant.permissions.canEditGroupInfo;

      if (!canEditSettings) {
        throw new APIError(
          "Insufficient permissions to change group settings",
          403
        );
      }

      // Validate specific settings
      if (settings.maxParticipants !== undefined) {
        if (settings.maxParticipants < conversation.participantCount) {
          throw new APIError(
            "Cannot set max participants below current participant count",
            400
          );
        }
      }

      // Prepare update data
      const allowedSettings = [
        "maxParticipants",
        "joinApprovalRequired",
        "adminOnlyMessaging",
        "allowMemberInvites",
        "allowMemberEdit",
        "muteNotifications",
      ];

      const updateData = {};
      Object.keys(settings).forEach((key) => {
        if (allowedSettings.includes(key)) {
          updateData[`groupSettings.${key}`] = settings[key];
        }
      });

      // Apply updates
      await Conversation.findByIdAndUpdate(conversationId, updateData);

      // Create system message
      const systemMessage = new DirectMessage({
        conversation: conversationId,
        sender: userId,
        senderIdentity: participant.identity,
        messageType: "system",
        systemMessage: {
          type: "settings_changed",
          data: {
            setting: "group_settings",
            changedBy: userId,
            changes: Object.keys(settings),
            newSettings: settings,
            timestamp: new Date(),
          },
        },
      });
      await systemMessage.save();

      await conversation.updateLastMessage(systemMessage._id);

      // Get updated conversation
      const updatedConversation = await Conversation.findById(conversationId);

      res.json({
        success: true,
        groupSettings: updatedConversation.groupSettings,
        message: "Group settings updated successfully",
        changedSettings: Object.keys(settings),
      });
    } catch (error) {
      console.error("Error setting group settings:", error);
      if (error instanceof APIError) {
        return res.status(error.statusCode).json({
          success: false,
          error: error.message,
        });
      }
      res.status(500).json({
        success: false,
        error: "Internal server error",
      });
    }
  }

  // Helper methods

  /**
   * Check if requester can manage target role
   * @param {string} requesterRole - Role of the person making the request
   * @param {string} targetCurrentRole - Current role of the target
   * @param {string} targetNewRole - Desired new role for the target
   * @returns {Object} - {allowed: boolean, reason?: string}
   */
  canManageRole(requesterRole, targetCurrentRole, targetNewRole) {
    // Owners can do anything except transfer ownership (handled separately)
    if (requesterRole === "owner" && targetNewRole !== "owner") {
      return { allowed: true };
    }

    // Admins can only manage members
    if (requesterRole === "admin") {
      if (
        targetCurrentRole === "member" &&
        ["member", "admin", "moderator"].includes(targetNewRole)
      ) {
        return { allowed: true };
      }
      if (targetCurrentRole === "admin" && targetNewRole === "member") {
        return { allowed: true };
      }
      return {
        allowed: false,
        reason:
          "Admins can only promote/demote members and other admins to members",
      };
    }

    // Members and moderators cannot manage roles
    return {
      allowed: false,
      reason: "Insufficient permissions to manage roles",
    };
  }

  /**
   * Get default permissions for a role
   * @param {string} role - The role to get permissions for
   * @returns {Object} - Default permissions object
   */
  getDefaultPermissions(role) {
    const permissionSets = {
      member: {
        canSendMessages: true,
        canSendMedia: true,
        canAddMembers: false,
        canEditGroupInfo: false,
        canDeleteMessages: false,
      },
      admin: {
        canSendMessages: true,
        canSendMedia: true,
        canAddMembers: true,
        canEditGroupInfo: true,
        canDeleteMessages: true,
      },
      moderator: {
        canSendMessages: true,
        canSendMedia: true,
        canAddMembers: false,
        canEditGroupInfo: false,
        canDeleteMessages: true,
      },
      owner: {
        canSendMessages: true,
        canSendMedia: true,
        canAddMembers: true,
        canEditGroupInfo: true,
        canDeleteMessages: true,
      },
    };

    return permissionSets[role] || permissionSets.member;
  }

  /**
   * Get appropriate system message type for role changes
   * @param {string} oldRole - Previous role
   * @param {string} newRole - New role
   * @returns {string} - System message type
   */
  getRoleChangeType(oldRole, newRole) {
    if (newRole === "owner") return "ownership_transferred";
    if (newRole === "admin" && oldRole === "member") return "admin_promoted";
    if (newRole === "member" && oldRole === "admin") return "admin_demoted";
    if (newRole === "moderator") return "moderator_assigned";
    return "role_changed";
  }
}

export default ConversationController;
