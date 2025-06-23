// Functions:

// sendMessage
// getMessages
// editMessage
// deleteMessage
// markAsRead
// addReaction
// removeReaction
// forwardMessage
// pinMessage
// unpinMessage
// getUnreadMessages
// searchMessages

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

class DirectMessageController {
  /**
   * Validation middleware for sending messages
   */
  static sendMessageValidation = [
    param("conversationId").isMongoId().withMessage("Invalid conversation ID"),
    body("messageType")
      .isIn([
        "text",
        "image",
        "video",
        "audio",
        "file",
        "sticker",
        "gif",
        "location",
        "contact",
        "voice_note",
        "link",
      ])
      .withMessage("Invalid message type"),
    body("content")
      .optional()
      .isLength({ min: 1, max: 4000 })
      .trim()
      .withMessage("Message content must be 1-4000 characters"),
    body("media").optional().isArray().withMessage("Media must be an array"),
    body("media.*").optional().isMongoId().withMessage("Invalid media ID"),
    body("replyTo")
      .optional()
      .isMongoId()
      .withMessage("Invalid reply message ID"),
    body("senderIdentityId")
      .optional()
      .isMongoId()
      .withMessage("Invalid sender identity ID"),
    body("disappearing.isDisappearing")
      .optional()
      .isBoolean()
      .withMessage("Disappearing flag must be boolean"),
    body("disappearing.disappearAfter")
      .optional()
      .isInt({ min: 5, max: 604800 })
      .withMessage("Disappear time must be 5 seconds to 1 week"),
  ];

  /**
   * Send a message with comprehensive validation and features
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async sendMessage(req, res) {
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
      const {
        messageType,
        content,
        media = [],
        replyTo,
        senderIdentityId,
        formatting = {},
        linkPreview = {},
        disappearing = {},
        mediaMetadata = {},
      } = req.body;
      const userId = req.user.id;

      // Validate conversation exists and user is participant
      const conversation = await Conversation.findById(conversationId);
      if (!conversation || conversation.isDeleted) {
        throw new APIError("Conversation not found", 404);
      }

      const participant = await ConversationParticipant.findOne({
        conversation: conversationId,
        user: userId,
        leftAt: { $exists: false },
      });

      if (!participant) {
        throw new APIError("Access denied - not a participant", 403);
      }

      // Check participant permissions
      if (!participant.permissions.canSendMessages) {
        throw new APIError("You do not have permission to send messages", 403);
      }

      // Check if group has admin-only messaging enabled
      if (
        conversation.conversationType === "group" &&
        conversation.groupSettings.adminOnlyMessaging &&
        !["admin", "owner"].includes(participant.role)
      ) {
        throw new APIError("Only admins can send messages in this group", 403);
      }

      // Validate message content requirements
      if (messageType === "text" && !content) {
        throw new APIError("Text messages require content", 400);
      }

      if (
        ["image", "video", "audio", "file"].includes(messageType) &&
        media.length === 0
      ) {
        throw new APIError(
          `${messageType} messages require media attachments`,
          400
        );
      }

      // Get sender identity
      let senderIdentity;
      if (senderIdentityId) {
        senderIdentity = await UserMessageIdentity.findById(senderIdentityId);
        if (
          !senderIdentity ||
          senderIdentity.user.toString() !== userId ||
          !senderIdentity.isUsable()
        ) {
          throw new APIError("Invalid sender identity", 400);
        }
      } else {
        senderIdentity = await UserMessageIdentity.getDefaultIdentity(userId);
      }

      if (!senderIdentity) {
        throw new APIError("No valid identity found", 400);
      }

      // Validate reply message if provided
      if (replyTo) {
        const replyMessage = await DirectMessage.findById(replyTo);
        if (
          !replyMessage ||
          replyMessage.conversation.toString() !== conversationId ||
          replyMessage.isDeleted
        ) {
          throw new APIError("Invalid reply message", 400);
        }
      }

      // Validate media attachments
      if (media.length > 0) {
        const Media = mongoose.model("Media");
        const mediaItems = await Media.find({
          _id: { $in: media },
          uploadedBy: userId,
        });
        if (mediaItems.length !== media.length) {
          throw new APIError("Invalid or unauthorized media attachments", 400);
        }
      }

      // Create message
      const messageData = {
        conversation: conversationId,
        sender: userId,
        senderIdentity: senderIdentity._id,
        messageType,
        content: content || null,
        media: media,
        mediaMetadata,
        formatting,
        linkPreview: Object.keys(linkPreview).length > 0 ? linkPreview : null,
        replyTo: replyTo || null,
        deliveryStatus: "sent",
      };

      // Handle disappearing messages
      if (disappearing.isDisappearing) {
        messageData.disappearing = {
          isDisappearing: true,
          disappearAfter: disappearing.disappearAfter,
          disappearAt: new Date(
            Date.now() + disappearing.disappearAfter * 1000
          ),
        };
      }

      // Set auto-delete based on conversation or identity settings
      if (conversation.privacySettings.autoDeleteMessages) {
        const autoDeleteMs =
          conversation.privacySettings.autoDeleteDuration * 60 * 60 * 1000;
        messageData.autoDeleteAt = new Date(Date.now() + autoDeleteMs);
      } else if (senderIdentity.privacySettings.autoDeleteSettings.enabled) {
        const autoDeleteMs =
          senderIdentity.privacySettings.autoDeleteSettings.effectiveDays *
          24 *
          60 *
          60 *
          1000;
        messageData.autoDeleteAt = new Date(Date.now() + autoDeleteMs);
      }

      // Handle secret chat features
      if (conversation.conversationType === "secret") {
        if (conversation.secretChatSettings.encryptionEnabled) {
          messageData.secretChat = {
            isEncrypted: true,
            encryptionKey: conversation.secretChatSettings.encryptionKey,
          };
        }

        if (conversation.secretChatSettings.selfDestructTimer > 0) {
          messageData.secretChat = {
            ...messageData.secretChat,
            selfDestructAt: new Date(
              Date.now() +
                conversation.secretChatSettings.selfDestructTimer * 1000
            ),
          };
        }
      }

      const message = new DirectMessage(messageData);
      await message.save();

      // Update conversation last message
      await conversation.updateLastMessage(message._id);

      // Update participant analytics
      await participant.incrementMessageCount("sent");
      await senderIdentity.incrementUsage("sent");

      // Update message count analytics for media
      if (media.length > 0) {
        await participant.incrementMessageCount("media");
        conversation.analytics.totalMedia += media.length;
        await conversation.save();
      }

      // Populate message for response
      const populatedMessage = await DirectMessage.findById(message._id)
        .populate("sender", "username fullName profilePicture")
        .populate("senderIdentity", "messageAlias displayName avatar")
        .populate("replyTo", "content messageType sender")
        .populate("media");

      res.status(201).json({
        success: true,
        message: populatedMessage,
        conversation: {
          _id: conversation._id,
          lastMessageAt: conversation.lastMessageAt,
        },
      });
    } catch (error) {
      console.error("Error sending message:", error);
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
   * Validation for getting messages
   */
  static getMessagesValidation = [
    param("conversationId").isMongoId().withMessage("Invalid conversation ID"),
    query("limit")
      .optional()
      .isInt({ min: 1, max: 100 })
      .withMessage("Limit must be between 1 and 100"),
    query("skip")
      .optional()
      .isInt({ min: 0 })
      .withMessage("Skip must be non-negative"),
    query("before")
      .optional()
      .isISO8601()
      .withMessage("Before must be a valid date"),
    query("after")
      .optional()
      .isISO8601()
      .withMessage("After must be a valid date"),
    query("messageType")
      .optional()
      .isIn([
        "text",
        "image",
        "video",
        "audio",
        "file",
        "sticker",
        "gif",
        "location",
        "contact",
        "voice_note",
        "link",
        "system",
      ])
      .withMessage("Invalid message type"),
  ];

  /**
   * Get messages from a conversation with advanced filtering
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async getMessages(req, res) {
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
        limit = 50,
        skip = 0,
        before = null,
        after = null,
        messageType = null,
        includeDeleted = false,
      } = req.query;

      // Validate access
      const conversation = await Conversation.findById(conversationId);
      if (!conversation || conversation.isDeleted) {
        throw new APIError("Conversation not found", 404);
      }

      const isParticipant = await conversation.isParticipant(userId);
      if (!isParticipant) {
        throw new APIError("Access denied", 403);
      }

      // Build query
      const query = {
        conversation: conversationId,
        ...(includeDeleted !== "true" && {
          isDeleted: false,
          deletedFor: { $not: { $elemMatch: { user: userId } } },
        }),
        ...(messageType && { messageType }),
      };

      // Add date filters
      if (before || after) {
        query.sentAt = {};
        if (before) query.sentAt.$lt = new Date(before);
        if (after) query.sentAt.$gt = new Date(after);
      }

      const messages = await DirectMessage.find(query)
        .populate("sender", "username fullName profilePicture")
        .populate("senderIdentity", "messageAlias displayName avatar")
        .populate("replyTo", "content messageType sender sentAt")
        .populate("media")
        .populate("reactions.user", "username fullName")
        .sort({ sentAt: -1 })
        .skip(parseInt(skip))
        .limit(parseInt(limit));

      // Filter out expired disappearing messages
      const visibleMessages = messages.filter((msg) => !msg.hasExpired());

      // Add computed fields
      const messagesWithDetails = visibleMessages.map((msg) => {
        const messageObj = msg.toObject();

        return {
          ...messageObj,
          isOwn: msg.sender._id.toString() === userId,
          canEdit:
            msg.sender._id.toString() === userId &&
            !msg.isDeleted &&
            Date.now() - msg.sentAt.getTime() < 15 * 60 * 1000, // 15 minutes
          canDelete:
            msg.sender._id.toString() === userId ||
            ["admin", "owner"].includes(messageObj.userRole),
          canReact: !msg.isDeleted,
          canReply: !msg.isDeleted,
          reactionCount: msg.reactions.length,
          forwardingAttribution: msg.getForwardingAttribution(),
          isExpired: msg.hasExpired(),
          timeUntilExpiry:
            msg.disappearing.isDisappearing && msg.disappearing.disappearAt
              ? Math.max(0, msg.disappearing.disappearAt.getTime() - Date.now())
              : null,
        };
      });

      // Get total count for pagination
      const totalMessages = await DirectMessage.countDocuments(query);

      res.json({
        success: true,
        messages: messagesWithDetails,
        pagination: {
          total: totalMessages,
          limit: parseInt(limit),
          skip: parseInt(skip),
          hasMore: parseInt(skip) + messagesWithDetails.length < totalMessages,
          currentPage: Math.floor(parseInt(skip) / parseInt(limit)) + 1,
          totalPages: Math.ceil(totalMessages / parseInt(limit)),
        },
        conversation: {
          _id: conversation._id,
          type: conversation.conversationType,
          participantCount: conversation.participantCount,
        },
      });
    } catch (error) {
      console.error("Error getting messages:", error);
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
   * Validation for editing messages
   */
  static editMessageValidation = [
    param("messageId").isMongoId().withMessage("Invalid message ID"),
    body("content")
      .isLength({ min: 1, max: 4000 })
      .trim()
      .withMessage("Content must be 1-4000 characters"),
    body("reason")
      .optional()
      .isLength({ max: 200 })
      .trim()
      .withMessage("Edit reason must be max 200 characters"),
  ];

  /**
   * Edit a message with time limits and validation
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async editMessage(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: "Validation failed",
          details: errors.array(),
        });
      }

      const { messageId } = req.params;
      const { content, reason } = req.body;
      const userId = req.user.id;

      const message = await DirectMessage.findById(messageId);
      if (!message || message.isDeleted) {
        throw new APIError("Message not found", 404);
      }

      // Check if user can edit (only sender can edit their own messages)
      if (message.sender.toString() !== userId) {
        throw new APIError("You can only edit your own messages", 403);
      }

      // Check if message type is editable
      if (!["text", "link"].includes(message.messageType)) {
        throw new APIError("This message type cannot be edited", 400);
      }

      // Check time limit (15 minutes)
      const editTimeLimit = 15 * 60 * 1000; // 15 minutes
      if (Date.now() - message.sentAt.getTime() > editTimeLimit) {
        throw new APIError("Message edit time limit exceeded", 400);
      }

      // Check if in secret chat with forwarding disabled
      const conversation = await Conversation.findById(message.conversation);
      if (
        conversation.conversationType === "secret" &&
        conversation.secretChatSettings.forwardingDisabled
      ) {
        throw new APIError(
          "Messages cannot be edited in this secret chat",
          403
        );
      }

      // Perform edit
      await message.editMessage(content, reason);

      const populatedMessage = await DirectMessage.findById(messageId)
        .populate("sender", "username fullName profilePicture")
        .populate("senderIdentity", "messageAlias displayName avatar")
        .populate("replyTo", "content messageType sender");

      res.json({
        success: true,
        message: populatedMessage,
        edited: true,
        editedAt: message.editedAt,
      });
    } catch (error) {
      console.error("Error editing message:", error);
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
   * Validation for deleting messages
   */
  static deleteMessageValidation = [
    param("messageId").isMongoId().withMessage("Invalid message ID"),
    body("deleteFor")
      .optional()
      .isIn(["me", "everyone"])
      .withMessage('deleteFor must be "me" or "everyone"'),
    body("reason")
      .optional()
      .isLength({ max: 200 })
      .trim()
      .withMessage("Delete reason must be max 200 characters"),
  ];

  /**
   * Delete a message with different scopes
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async deleteMessage(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: "Validation failed",
          details: errors.array(),
        });
      }

      const { messageId } = req.params;
      const { deleteFor = "me", reason } = req.body;
      const userId = req.user.id;

      const message = await DirectMessage.findById(messageId);
      if (!message || message.isDeleted) {
        throw new APIError("Message not found", 404);
      }

      // Verify user is participant
      const conversation = await Conversation.findById(message.conversation);
      const participant = await ConversationParticipant.findOne({
        conversation: message.conversation,
        user: userId,
        leftAt: { $exists: false },
      });

      if (!participant) {
        throw new APIError("Access denied", 403);
      }

      if (deleteFor === "everyone") {
        // Delete for everyone - check permissions
        const canDeleteForEveryone =
          message.sender.toString() === userId || // Own message
          participant.permissions.canDeleteMessages || // Has permission
          ["admin", "owner"].includes(participant.role); // Is admin/owner

        if (!canDeleteForEveryone) {
          throw new APIError(
            "Insufficient permissions to delete for everyone",
            403
          );
        }

        // Check time limit for own messages (24 hours)
        if (message.sender.toString() === userId) {
          const deleteTimeLimit = 24 * 60 * 60 * 1000; // 24 hours
          if (Date.now() - message.sentAt.getTime() > deleteTimeLimit) {
            throw new APIError(
              "Time limit exceeded for deleting your own message",
              400
            );
          }
        }

        // Delete for everyone
        await message.deleteMessage(userId, reason);

        res.json({
          success: true,
          message: "Message deleted for everyone",
          deletedFor: "everyone",
        });
      } else {
        // Delete for me only
        await message.deleteForUsers([userId]);

        res.json({
          success: true,
          message: "Message deleted for you",
          deletedFor: "me",
        });
      }
    } catch (error) {
      console.error("Error deleting message:", error);
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
   * Validation for marking messages as read
   */
  static markAsReadValidation = [
    param("conversationId").isMongoId().withMessage("Invalid conversation ID"),
    body("messageIds")
      .isArray({ min: 1 })
      .withMessage("messageIds must be a non-empty array"),
    body("messageIds.*").isMongoId().withMessage("Invalid message ID"),
  ];

  /**
   * Mark messages as read
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async markAsRead(req, res) {
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
      const { messageIds } = req.body;
      const userId = req.user.id;

      // Validate access
      const conversation = await Conversation.findById(conversationId);
      if (!conversation || conversation.isDeleted) {
        throw new APIError("Conversation not found", 404);
      }

      const isParticipant = await conversation.isParticipant(userId);
      if (!isParticipant) {
        throw new APIError("Access denied", 403);
      }

      // Get messages to mark as read
      const messages = await DirectMessage.find({
        _id: { $in: messageIds },
        conversation: conversationId,
        sender: { $ne: userId }, // Don't mark own messages as read
        isDeleted: false,
        deletedFor: { $not: { $elemMatch: { user: userId } } },
      });

      if (messages.length === 0) {
        return res.json({
          success: true,
          message: "No messages to mark as read",
          markedCount: 0,
        });
      }

      // Mark messages as read
      const markPromises = messages.map((message) =>
        message.markAsReadBy(userId)
      );
      await Promise.all(markPromises);

      // Update participant's last read message and time
      const participant = await ConversationParticipant.findOne({
        conversation: conversationId,
        user: userId,
        leftAt: { $exists: false },
      });

      if (participant) {
        const latestMessage = messages.reduce((latest, current) =>
          current.sentAt > latest.sentAt ? current : latest
        );

        participant.lastReadMessage = latestMessage._id;
        participant.lastReadAt = new Date();
        await participant.save();
      }

      res.json({
        success: true,
        message: "Messages marked as read",
        markedCount: messages.length,
        lastReadAt: new Date(),
      });
    } catch (error) {
      console.error("Error marking messages as read:", error);
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
   * Validation for adding reactions
   */
  static addReactionValidation = [
    param("messageId").isMongoId().withMessage("Invalid message ID"),
    body("emoji")
      .isLength({ min: 1, max: 10 })
      .withMessage("Emoji must be 1-10 characters"),
  ];

  /**
   * Add reaction to a message
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async addReaction(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: "Validation failed",
          details: errors.array(),
        });
      }

      const { messageId } = req.params;
      const { emoji } = req.body;
      const userId = req.user.id;

      const message = await DirectMessage.findById(messageId);
      if (!message || message.isDeleted) {
        throw new APIError("Message not found", 404);
      }

      // Verify user is participant
      const conversation = await Conversation.findById(message.conversation);
      const isParticipant = await conversation.isParticipant(userId);
      if (!isParticipant) {
        throw new APIError("Access denied", 403);
      }

      // Check if message is visible to user
      if (!message.isVisibleToUser(userId)) {
        throw new APIError("Message not accessible", 403);
      }

      // Add reaction
      await message.addReaction(userId, emoji);

      const populatedMessage = await DirectMessage.findById(messageId).populate(
        "reactions.user",
        "username fullName profilePicture"
      );

      res.json({
        success: true,
        message: "Reaction added",
        reactions: populatedMessage.reactions,
        reactionCount: populatedMessage.reactions.length,
      });
    } catch (error) {
      console.error("Error adding reaction:", error);
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
   * Remove reaction from a message
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async removeReaction(req, res) {
    try {
      const { messageId } = req.params;
      const { emoji = null } = req.body;
      const userId = req.user.id;

      if (!mongoose.Types.ObjectId.isValid(messageId)) {
        throw new APIError("Invalid message ID", 400);
      }

      const message = await DirectMessage.findById(messageId);
      if (!message || message.isDeleted) {
        throw new APIError("Message not found", 404);
      }

      // Verify user is participant
      const conversation = await Conversation.findById(message.conversation);
      const isParticipant = await conversation.isParticipant(userId);
      if (!isParticipant) {
        throw new APIError("Access denied", 403);
      }

      // Remove reaction
      await message.removeReaction(userId, emoji);

      const populatedMessage = await DirectMessage.findById(messageId).populate(
        "reactions.user",
        "username fullName profilePicture"
      );

      res.json({
        success: true,
        message: "Reaction removed",
        reactions: populatedMessage.reactions,
        reactionCount: populatedMessage.reactions.length,
      });
    } catch (error) {
      console.error("Error removing reaction:", error);
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
   * Validation for forwarding messages
   */
  static forwardMessageValidation = [
    param("messageId").isMongoId().withMessage("Invalid message ID"),
    body("targetConversations")
      .isArray({ min: 1, max: 10 })
      .withMessage("targetConversations must be array of 1-10 items"),
    body("targetConversations.*")
      .isMongoId()
      .withMessage("Invalid target conversation ID"),
    body("attributionDisplay")
      .optional()
      .isIn(["show_original", "show_immediate", "hide_all", "anonymous"])
      .withMessage("Invalid attribution display option"),
    body("comment")
      .optional()
      .isLength({ max: 1000 })
      .trim()
      .withMessage("Comment must be max 1000 characters"),
  ];

  /**
   * Forward a message to other conversations
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async forwardMessage(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: "Validation failed",
          details: errors.array(),
        });
      }

      const { messageId } = req.params;
      const {
        targetConversations,
        attributionDisplay = "show_original",
        comment,
      } = req.body;
      const userId = req.user.id;

      const originalMessage = await DirectMessage.findById(messageId);
      if (!originalMessage || originalMessage.isDeleted) {
        throw new APIError("Message not found", 404);
      }

      // Check if user can access the original message
      const sourceConversation = await Conversation.findById(
        originalMessage.conversation
      );
      const isSourceParticipant =
        await sourceConversation.isParticipant(userId);
      if (!isSourceParticipant) {
        throw new APIError("Access denied to source message", 403);
      }

      // Check if message can be forwarded
      if (!originalMessage.canBeForwarded()) {
        throw new APIError("This message cannot be forwarded", 403);
      }

      // Check forwarding chain limit
      const currentChain = originalMessage.forwardedFrom?.forwardChain || 0;
      const maxChain =
        originalMessage.forwardedFrom?.forwardingRights?.maxForwardChain || 10;
      if (currentChain >= maxChain) {
        throw new APIError("Maximum forwarding chain exceeded", 400);
      }

      // Validate target conversations
      const targetConvs = await Conversation.find({
        _id: { $in: targetConversations },
        isDeleted: false,
      });

      if (targetConvs.length !== targetConversations.length) {
        throw new APIError("One or more target conversations not found", 404);
      }

      // Check user is participant in all target conversations
      const participantChecks = await Promise.all(
        targetConvs.map((conv) => conv.isParticipant(userId))
      );

      if (participantChecks.some((isParticipant) => !isParticipant)) {
        throw new APIError(
          "Access denied to one or more target conversations",
          403
        );
      }

      // Check if user can send messages in target conversations
      const participantPermissions = await Promise.all(
        targetConvs.map(async (conv) => {
          const participant = await ConversationParticipant.findOne({
            conversation: conv._id,
            user: userId,
            leftAt: { $exists: false },
          });
          return participant?.permissions.canSendMessages;
        })
      );

      if (participantPermissions.some((canSend) => !canSend)) {
        throw new APIError(
          "Insufficient permissions in one or more target conversations",
          403
        );
      }

      // Get user's identity for forwarding
      const forwarderIdentity =
        await UserMessageIdentity.getDefaultIdentity(userId);
      if (!forwarderIdentity) {
        throw new APIError("No valid identity found", 400);
      }

      // Forward message to each target conversation
      const forwardedMessages = [];
      const forwardPromises = targetConvs.map(async (targetConv) => {
        const forwardedMessage = await originalMessage.forwardMessage(
          targetConv._id,
          userId,
          attributionDisplay
        );

        // Add comment if provided
        if (comment && comment.trim()) {
          const commentMessage = new DirectMessage({
            conversation: targetConv._id,
            sender: userId,
            senderIdentity: forwarderIdentity._id,
            messageType: "text",
            content: comment.trim(),
            replyTo: forwardedMessage._id,
          });
          await commentMessage.save();

          // Update conversation last message
          await targetConv.updateLastMessage(commentMessage._id);
        } else {
          // Update conversation last message with forwarded message
          await targetConv.updateLastMessage(forwardedMessage._id);
        }

        return forwardedMessage;
      });

      const results = await Promise.all(forwardPromises);
      forwardedMessages.push(...results);

      res.json({
        success: true,
        message: "Message forwarded successfully",
        forwardedCount: forwardedMessages.length,
        targetConversations: targetConversations,
        attributionDisplay: attributionDisplay,
        forwardedMessages: forwardedMessages.map((msg) => ({
          _id: msg._id,
          conversation: msg.conversation,
          sentAt: msg.sentAt,
        })),
      });
    } catch (error) {
      console.error("Error forwarding message:", error);
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
   * Validation for pinning messages
   */
  static pinMessageValidation = [
    param("messageId").isMongoId().withMessage("Invalid message ID"),
  ];

  /**
   * Pin a message in the conversation
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async pinMessage(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: "Validation failed",
          details: errors.array(),
        });
      }

      const { messageId } = req.params;
      const userId = req.user.id;

      const message = await DirectMessage.findById(messageId);
      if (!message || message.isDeleted) {
        throw new APIError("Message not found", 404);
      }

      // Check if user can pin messages
      const conversation = await Conversation.findById(message.conversation);
      const participant = await ConversationParticipant.findOne({
        conversation: message.conversation,
        user: userId,
        leftAt: { $exists: false },
      });

      if (!participant) {
        throw new APIError("Access denied", 403);
      }

      // Check permissions for pinning
      const canPin =
        ["admin", "owner"].includes(participant.role) ||
        participant.permissions.canDeleteMessages;

      if (!canPin) {
        throw new APIError("Insufficient permissions to pin messages", 403);
      }

      // Check if message is already pinned
      if (message.isPinned) {
        throw new APIError("Message is already pinned", 400);
      }

      // Check pinned message limit (max 10 per conversation)
      const pinnedCount = await DirectMessage.countDocuments({
        conversation: message.conversation,
        isPinned: true,
        isDeleted: false,
      });

      if (pinnedCount >= 10) {
        throw new APIError(
          "Maximum number of pinned messages reached (10)",
          400
        );
      }

      // Pin the message
      await message.pinMessage(userId);

      // Create system message
      const systemMessage = new DirectMessage({
        conversation: message.conversation,
        sender: userId,
        senderIdentity: participant.identity,
        messageType: "system",
        systemMessage: {
          type: "message_pinned",
          data: {
            pinnedMessage: messageId,
            pinnedBy: userId,
            timestamp: new Date(),
          },
        },
      });
      await systemMessage.save();

      const populatedMessage = await DirectMessage.findById(messageId)
        .populate("sender", "username fullName profilePicture")
        .populate("pinnedBy", "username fullName profilePicture");

      res.json({
        success: true,
        message: "Message pinned successfully",
        pinnedMessage: populatedMessage,
        pinnedAt: message.pinnedAt,
        pinnedBy: message.pinnedBy,
      });
    } catch (error) {
      console.error("Error pinning message:", error);
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
   * Pin a message in the conversation
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async pinMessage(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: "Validation failed",
          details: errors.array(),
        });
      }

      const { messageId } = req.params;
      const userId = req.user.id;

      const message = await DirectMessage.findById(messageId);
      if (!message || message.isDeleted) {
        throw new APIError("Message not found", 404);
      }

      // Check if user can pin messages
      const conversation = await Conversation.findById(message.conversation);
      const participant = await ConversationParticipant.findOne({
        conversation: message.conversation,
        user: userId,
        leftAt: { $exists: false },
      });

      if (!participant) {
        throw new APIError("Access denied", 403);
      }

      // Check permissions for pinning
      const canPin =
        ["admin", "owner"].includes(participant.role) ||
        participant.permissions.canDeleteMessages;

      if (!canPin) {
        throw new APIError("Insufficient permissions to pin messages", 403);
      }

      // Check if message is already pinned
      if (message.isPinned) {
        throw new APIError("Message is already pinned", 400);
      }

      // Check pinned message limit (max 10 per conversation)
      const pinnedCount = await DirectMessage.countDocuments({
        conversation: message.conversation,
        isPinned: true,
        isDeleted: false,
      });

      if (pinnedCount >= 10) {
        throw new APIError(
          "Maximum number of pinned messages reached (10)",
          400
        );
      }

      // Pin the message
      await message.pinMessage(userId);

      // Create system message
      const systemMessage = new DirectMessage({
        conversation: message.conversation,
        sender: userId,
        senderIdentity: participant.identity,
        messageType: "system",
        systemMessage: {
          type: "message_pinned",
          data: {
            pinnedMessage: messageId,
            pinnedBy: userId,
            timestamp: new Date(),
          },
        },
      });
      await systemMessage.save();

      const populatedMessage = await DirectMessage.findById(messageId)
        .populate("sender", "username fullName profilePicture")
        .populate("pinnedBy", "username fullName profilePicture");

      res.json({
        success: true,
        message: "Message pinned successfully",
        pinnedMessage: populatedMessage,
        pinnedAt: message.pinnedAt,
        pinnedBy: message.pinnedBy,
      });
    } catch (error) {
      console.error("Error pinning message:", error);
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
   * Unpin a message in the conversation
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async unpinMessage(req, res) {
    try {
      const { messageId } = req.params;
      const userId = req.user.id;

      if (!mongoose.Types.ObjectId.isValid(messageId)) {
        throw new APIError("Invalid message ID", 400);
      }

      const message = await DirectMessage.findById(messageId);
      if (!message || message.isDeleted) {
        throw new APIError("Message not found", 404);
      }

      // Check if user can unpin messages
      const participant = await ConversationParticipant.findOne({
        conversation: message.conversation,
        user: userId,
        leftAt: { $exists: false },
      });

      if (!participant) {
        throw new APIError("Access denied", 403);
      }

      // Check permissions for unpinning
      const canUnpin =
        ["admin", "owner"].includes(participant.role) ||
        participant.permissions.canDeleteMessages ||
        message.pinnedBy?.toString() === userId; // User who pinned can unpin

      if (!canUnpin) {
        throw new APIError("Insufficient permissions to unpin messages", 403);
      }

      // Check if message is actually pinned
      if (!message.isPinned) {
        throw new APIError("Message is not pinned", 400);
      }

      // Unpin the message
      await message.unpinMessage();

      // Create system message
      const systemMessage = new DirectMessage({
        conversation: message.conversation,
        sender: userId,
        senderIdentity: participant.identity,
        messageType: "system",
        systemMessage: {
          type: "message_unpinned",
          data: {
            unpinnedMessage: messageId,
            unpinnedBy: userId,
            timestamp: new Date(),
          },
        },
      });
      await systemMessage.save();

      res.json({
        success: true,
        message: "Message unpinned successfully",
        messageId: messageId,
      });
    } catch (error) {
      console.error("Error unpinning message:", error);
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
   * Validation for getting unread messages
   */
  static getUnreadMessagesValidation = [
    query("conversationId")
      .optional()
      .isMongoId()
      .withMessage("Invalid conversation ID"),
    query("limit")
      .optional()
      .isInt({ min: 1, max: 100 })
      .withMessage("Limit must be between 1 and 100"),
  ];

  /**
   * Get unread messages for user
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async getUnreadMessages(req, res) {
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
      const { conversationId = null, limit = 50 } = req.query;

      // Build query for unread messages
      const query = {
        readBy: { $not: { $elemMatch: { user: userId } } },
        sender: { $ne: userId },
        isDeleted: false,
        deletedFor: { $not: { $elemMatch: { user: userId } } },
      };

      if (conversationId) {
        // Validate conversation access
        const conversation = await Conversation.findById(conversationId);
        if (!conversation || conversation.isDeleted) {
          throw new APIError("Conversation not found", 404);
        }

        const isParticipant = await conversation.isParticipant(userId);
        if (!isParticipant) {
          throw new APIError("Access denied", 403);
        }

        query.conversation = conversationId;
      }

      // Get unread messages with conversation filtering
      const pipeline = [
        { $match: query },
        {
          $lookup: {
            from: "conversationparticipants",
            let: { conversationId: "$conversation" },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [
                      { $eq: ["$conversation", "$conversationId"] },
                      { $eq: ["$user", mongoose.Types.ObjectId(userId)] },
                      { $not: { $ifNull: ["$leftAt", false] } },
                    ],
                  },
                },
              },
            ],
            as: "userParticipation",
          },
        },
        {
          $match: {
            "userParticipation.0": { $exists: true },
          },
        },
        {
          $lookup: {
            from: "conversations",
            localField: "conversation",
            foreignField: "_id",
            as: "conversationDetails",
          },
        },
        {
          $lookup: {
            from: "users",
            localField: "sender",
            foreignField: "_id",
            as: "sender",
          },
        },
        {
          $lookup: {
            from: "usermessageidentities",
            localField: "senderIdentity",
            foreignField: "_id",
            as: "senderIdentity",
          },
        },
        {
          $unwind: "$conversationDetails",
        },
        {
          $unwind: "$sender",
        },
        {
          $unwind: "$senderIdentity",
        },
        {
          $sort: { sentAt: -1 },
        },
        {
          $limit: parseInt(limit),
        },
      ];

      const unreadMessages = await DirectMessage.aggregate(pipeline);

      // Group messages by conversation for better organization
      const messagesByConversation = unreadMessages.reduce((acc, message) => {
        const convId = message.conversation.toString();
        if (!acc[convId]) {
          acc[convId] = {
            conversation: message.conversationDetails,
            messages: [],
            unreadCount: 0,
          };
        }
        acc[convId].messages.push(message);
        acc[convId].unreadCount += 1;
        return acc;
      }, {});

      // Get total unread count across all conversations
      const totalUnreadCount = await DirectMessage.countDocuments({
        readBy: { $not: { $elemMatch: { user: userId } } },
        sender: { $ne: userId },
        isDeleted: false,
        deletedFor: { $not: { $elemMatch: { user: userId } } },
      });

      res.json({
        success: true,
        unreadMessages: unreadMessages,
        messagesByConversation: messagesByConversation,
        totalUnreadCount: totalUnreadCount,
        conversationCount: Object.keys(messagesByConversation).length,
        requestedConversation: conversationId,
      });
    } catch (error) {
      console.error("Error getting unread messages:", error);
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
   * Validation for searching messages
   */
  static searchMessagesValidation = [
    param("conversationId").isMongoId().withMessage("Invalid conversation ID"),
    query("q")
      .isLength({ min: 2, max: 100 })
      .trim()
      .withMessage("Search query must be 2-100 characters"),
    query("limit")
      .optional()
      .isInt({ min: 1, max: 50 })
      .withMessage("Limit must be between 1 and 50"),
    query("skip")
      .optional()
      .isInt({ min: 0 })
      .withMessage("Skip must be non-negative"),
    query("messageType")
      .optional()
      .isIn(["text", "image", "video", "audio", "file", "link"])
      .withMessage("Invalid message type filter"),
    query("sender").optional().isMongoId().withMessage("Invalid sender ID"),
  ];

  /**
   * Search messages in a conversation with advanced filtering
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */

  async searchMessages(req, res) {
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
        q: searchQuery,
        limit = 20,
        skip = 0,
        messageType = null,
        sender = null,
        startDate = null,
        endDate = null,
      } = req.query;

      // Validate conversation access
      const conversation = await Conversation.findById(conversationId);
      if (!conversation || conversation.isDeleted) {
        throw new APIError("Conversation not found", 404);
      }

      const isParticipant = await conversation.isParticipant(userId);
      if (!isParticipant) {
        throw new APIError("Access denied", 403);
      }

      // Build search pipeline
      const pipeline = [
        {
          $match: {
            conversation: mongoose.Types.ObjectId(conversationId),
            isDeleted: false,
            deletedFor: { $not: { $elemMatch: { user: userId } } },
            ...(messageType && { messageType }),
            ...(sender && { sender: mongoose.Types.ObjectId(sender) }),
          },
        },
      ];

      // Add date range filter
      if (startDate || endDate) {
        const dateMatch = {};
        if (startDate) dateMatch.$gte = new Date(startDate);
        if (endDate) dateMatch.$lte = new Date(endDate);
        pipeline[0].$match.sentAt = dateMatch;
      }

      // Add text search
      const searchRegex = new RegExp(
        searchQuery.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        "i"
      );

      pipeline.push({
        $match: {
          $or: [
            { content: searchRegex },
            { "linkPreview.title": searchRegex },
            { "linkPreview.description": searchRegex },
          ],
        },
      });

      // Add lookups for user and identity data
      pipeline.push(
        {
          $lookup: {
            from: "users",
            localField: "sender",
            foreignField: "_id",
            as: "sender",
            pipeline: [
              {
                $project: {
                  username: 1,
                  fullName: 1,
                  profilePicture: 1,
                },
              },
            ],
          },
        },
        {
          $lookup: {
            from: "usermessageidentities",
            localField: "senderIdentity",
            foreignField: "_id",
            as: "senderIdentity",
            pipeline: [
              {
                $project: {
                  messageAlias: 1,
                  displayName: 1,
                  avatar: 1,
                },
              },
            ],
          },
        },
        {
          $lookup: {
            from: "directmessages",
            localField: "replyTo",
            foreignField: "_id",
            as: "replyTo",
            pipeline: [
              {
                $project: {
                  content: 1,
                  messageType: 1,
                  sender: 1,
                  sentAt: 1,
                },
              },
            ],
          },
        },
        {
          $unwind: {
            path: "$sender",
            preserveNullAndEmptyArrays: false,
          },
        },
        {
          $unwind: {
            path: "$senderIdentity",
            preserveNullAndEmptyArrays: false,
          },
        },
        {
          $unwind: {
            path: "$replyTo",
            preserveNullAndEmptyArrays: true,
          },
        }
      );

      // Create count pipeline
      const countPipeline = [...pipeline];
      countPipeline.push({ $count: "total" });

      // Add sorting and pagination
      pipeline.push(
        { $sort: { sentAt: -1 } },
        { $skip: parseInt(skip) },
        { $limit: parseInt(limit) }
      );

      // Execute search
      const [searchResults, countResult] = await Promise.all([
        DirectMessage.aggregate(pipeline),
        DirectMessage.aggregate(countPipeline),
      ]);

      const total = countResult[0]?.total || 0;

      // Add search highlighting and context
      const resultsWithContext = searchResults.map((message) => {
        let highlightedContent = message.content;

        if (message.content) {
          // Simple highlighting (in production, use a proper highlighting library)
          const regex = new RegExp(`(${searchQuery.trim()})`, "gi");
          highlightedContent = message.content.replace(
            regex,
            "<mark>$1</mark>"
          );
        }

        return {
          ...message,
          highlightedContent,
          searchMatch: {
            field: message.content
              ?.toLowerCase()
              .includes(searchQuery.toLowerCase())
              ? "content"
              : message.linkPreview?.title
                    ?.toLowerCase()
                    .includes(searchQuery.toLowerCase())
                ? "linkTitle"
                : message.linkPreview?.description
                      ?.toLowerCase()
                      .includes(searchQuery.toLowerCase())
                  ? "linkDescription"
                  : "unknown",
            query: searchQuery,
          },
          isOwn: message.sender._id.toString() === userId,
          contextBefore: null, // Could be populated with surrounding messages
          contextAfter: null,
        };
      });

      res.json({
        success: true,
        searchResults: resultsWithContext,
        pagination: {
          total: total,
          limit: parseInt(limit),
          skip: parseInt(skip),
          hasMore: parseInt(skip) + resultsWithContext.length < total,
          currentPage: Math.floor(parseInt(skip) / parseInt(limit)) + 1,
          totalPages: Math.ceil(total / parseInt(limit)),
        },
        searchQuery: searchQuery,
        filters: {
          messageType,
          sender,
          startDate,
          endDate,
        },
        conversation: {
          _id: conversation._id,
          name: conversation.conversationName,
          type: conversation.conversationType,
        },
      });
    } catch (error) {
      console.error("Error searching messages:", error);
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
}

export default DirectMessageController;
