// Functions:

// logScreenshot
// logMessageDeletion
// getMessageDeletionLogs
// getScreenshotLogs
// cleanupExpiredIdentities
// cleanupMessages
// getConversationsForCleanup

import {
  UserMessageIdentity,
  ChatTheme,
  UserThemePreference,
  Conversation,
  ConversationParticipant,
  DirectMessage,
  MessageReaction,
  ScreenshotLog,
  MessageDeletionLog,
  AutoDeleteSchedule,
} from "../../directmessage.model.js";

import {
  ContentFlag,
  SuspiciousActivityFlag,
  SecurityAlert,
  LawEnforcementReport,
  UserSuspension,
  ModerationRule,
  ThreatDatabase,
  UserBehaviorAnalysis,
  SafetyReport,
  SecurityAuditLog,
} from "../../models/moderationModels.js";

import crypto from "crypto";
import { v4 as uuidv4 } from "uuid";

class ModerationController {
  // ============================================
  // Core Moderation Functions
  // ============================================

  /**
   * Log screenshot detection
   */
  async logScreenshot(req, res) {
    try {
      const {
        conversationId,
        messageId,
        detectedUserId,
        detectionMethod = "screenshot",
        deviceInfo = {},
      } = req.body;

      // Pre-validate if this is a secret chat
      const conversation = await Conversation.findById(conversationId);
      if (!conversation) {
        return res.status(404).json({
          success: false,
          error: "Conversation not found",
        });
      }

      const screenshotLog = new ScreenshotLog({
        conversation: conversationId,
        message: messageId,
        detectedUser: detectedUserId,
        detectionMethod,
        deviceInfo: {
          userAgent: req.headers["user-agent"],
          platform: deviceInfo.platform || "unknown",
          timestamp: new Date(),
          ...deviceInfo,
        },
        isBlocked: conversation.conversationType === "secret",
        blockReason:
          conversation.conversationType === "secret"
            ? "secret_chat_protection"
            : null,
      });

      await screenshotLog.save();

      // Update message with screenshot detection (for analytics only)
      if (messageId) {
        await DirectMessage.findByIdAndUpdate(messageId, {
          $inc: { "secretChat.screenshotAttempts": 1 },
          $push: {
            "secretChat.screenshotLogs": {
              user: detectedUserId,
              detectedAt: new Date(),
              method: detectionMethod,
              wasBlocked: conversation.conversationType === "secret",
            },
          },
        });
      }

      // ✅ SIMPLIFIED: Handle secret conversation screenshot blocking
      if (conversation.conversationType === "secret") {
        // Create simple info-level security alert (no emergency action)
        await this.createSecurityAlert({
          category: "privacy_protection",
          severity: "info", // Low priority
          title: "Screenshot blocked in secret chat",
          description: `Screenshot attempt blocked in secret conversation for privacy protection`,
          relatedUser: detectedUserId,
          relatedConversation: conversationId,
          relatedMessages: messageId ? [messageId] : [],
          metadata: {
            violationType: "screenshot_attempt_blocked",
            actionTaken: "blocked",
            automaticDetection: true,
            userImpact: "none", // No punishment
          },
        });

        // Create audit log entry
        await this.logAuditEvent({
          action: "screenshot_blocked",
          category: "privacy_protection",
          actor: "system",
          target: {
            user: detectedUserId,
            conversation: conversationId,
            message: messageId,
          },
          details: {
            description: "Screenshot blocked in secret chat",
            detectionMethod,
            userStaysInChat: true,
            noPunishment: true,
          },
        });

        // ✅ Optional: Notify other participants (only if enabled)
        if (conversation.privacySettings?.notifyScreenshotAttempts) {
          await this.notifySecretChatParticipants(conversationId, {
            type: "screenshot_blocked",
            message:
              "Someone attempted a screenshot but it was blocked for privacy protection",
            attemptedBy: detectedUserId,
          });
        }

        // ✅ Return blocked response with friendly message
        return res.status(200).json({
          success: true,
          blocked: true,
          message:
            "Screenshots are not allowed in secret conversations for privacy protection",
          screenshotLog: screenshotLog._id,
          userAction: "none", // No punishment
          staysInChat: true,
        });
      }

      // For regular chats, allow screenshot
      res.status(201).json({
        success: true,
        blocked: false,
        screenshotLog: screenshotLog._id,
        message: "Screenshot logged successfully",
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }

  /**
   * ✅ NEW: Pre-validate if action is allowed in secret chat
   */
  async validateSecretChatAction(req, res) {
    try {
      const { conversationId, actionType, userId } = req.body;

      const conversation = await Conversation.findById(conversationId);
      if (!conversation) {
        return res.status(404).json({
          success: false,
          error: "Conversation not found",
        });
      }

      // Check if user is participant
      const participant = await ConversationParticipant.findOne({
        conversation: conversationId,
        user: userId,
        status: "active",
      });

      if (!participant) {
        return res.status(403).json({
          success: false,
          allowed: false,
          reason: "User not authorized for this conversation",
        });
      }

      // Define blocked actions for secret chats
      const blockedActions = ["screenshot", "copy", "print", "save", "forward"];
      const isBlocked =
        conversation.conversationType === "secret" &&
        blockedActions.includes(actionType);

      res.json({
        success: true,
        allowed: !isBlocked,
        conversationType: conversation.conversationType,
        actionType,
        reason: isBlocked
          ? "Action not allowed in secret conversations for privacy protection"
          : "Action allowed",
        blockMessage: isBlocked
          ? `${actionType} is not allowed in secret conversations for privacy protection`
          : null,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }

  /**
   * ✅ NEW: Notify secret chat participants about blocked attempts (optional)
   */
  async notifySecretChatParticipants(conversationId, notificationData) {
    try {
      const conversation = await Conversation.findById(conversationId);
      if (!conversation || conversation.conversationType !== "secret") {
        return false;
      }

      // Only notify if enabled in privacy settings
      if (!conversation.privacySettings?.notifyScreenshotAttempts) {
        return false;
      }

      const participants = await ConversationParticipant.find({
        conversation: conversationId,
        status: "active",
      });

      // Create system message for participants
      const systemMessage = new DirectMessage({
        conversation: conversationId,
        messageType: "system",
        content: notificationData.message,
        metadata: {
          systemMessageType: "privacy_notification",
          notificationType: notificationData.type,
          timestamp: new Date(),
          isPrivacyRelated: true,
        },
        visibleTo: participants.map((p) => p.user),
      });

      await systemMessage.save();
      return true;
    } catch (error) {
      console.error("Error notifying secret chat participants:", error);
      return false;
    }
  }

  /**
   * ✅ NEW: Get screenshot attempt statistics (no punishment data)
   */
  async getScreenshotAttemptStats(req, res) {
    try {
      const {
        conversationId,
        startDate,
        endDate,
        timeframe = 30, // days
      } = req.query;

      const end = endDate ? new Date(endDate) : new Date();
      const start = startDate
        ? new Date(startDate)
        : new Date(end.getTime() - timeframe * 24 * 60 * 60 * 1000);

      const query = {
        createdAt: { $gte: start, $lte: end },
      };

      if (conversationId) {
        query.conversation = conversationId;
      }

      const stats = await ScreenshotLog.aggregate([
        { $match: query },
        {
          $group: {
            _id: null,
            totalAttempts: { $sum: 1 },
            blockedAttempts: {
              $sum: { $cond: [{ $eq: ["$isBlocked", true] }, 1, 0] },
            },
            allowedAttempts: {
              $sum: { $cond: [{ $eq: ["$isBlocked", false] }, 1, 0] },
            },
            byConversationType: {
              $push: {
                conversationType: "$conversationType",
                isBlocked: "$isBlocked",
              },
            },
            detectionMethods: {
              $push: "$detectionMethod",
            },
          },
        },
        {
          $project: {
            totalAttempts: 1,
            blockedAttempts: 1,
            allowedAttempts: 1,
            blockRate: {
              $cond: [
                { $eq: ["$totalAttempts", 0] },
                0,
                {
                  $multiply: [
                    { $divide: ["$blockedAttempts", "$totalAttempts"] },
                    100,
                  ],
                },
              ],
            },
            byConversationType: 1,
            detectionMethods: 1,
          },
        },
      ]);

      const summary = stats[0] || {
        totalAttempts: 0,
        blockedAttempts: 0,
        allowedAttempts: 0,
        blockRate: 0,
      };

      res.json({
        success: true,
        timeframe: {
          start,
          end,
          days: timeframe,
        },
        stats: summary,
        message:
          "Screenshot statistics (prevention and logging only, no punishment data)",
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }

  /**
   * ✅ NEW: Enable enhanced secret chat monitoring (optional security feature)
   */
  async enableSecretChatMonitoring(req, res) {
    try {
      const {
        conversationId,
        monitoringLevel = "standard", // standard, enhanced, maximum
        enabledBy,
        blockedActions = ["screenshot", "copy", "print"],
        notifyAttempts = false,
      } = req.body;

      const conversation = await Conversation.findById(conversationId);
      if (!conversation) {
        return res.status(404).json({
          success: false,
          error: "Conversation not found",
        });
      }

      if (conversation.conversationType !== "secret") {
        return res.status(400).json({
          success: false,
          error: "Enhanced monitoring only available for secret conversations",
        });
      }

      // Update conversation privacy settings
      const updatedConversation = await Conversation.findByIdAndUpdate(
        conversationId,
        {
          $set: {
            "privacySettings.monitoringLevel": monitoringLevel,
            "privacySettings.blockedActions": blockedActions,
            "privacySettings.notifyScreenshotAttempts": notifyAttempts,
            "privacySettings.enhancedMonitoring": {
              enabled: true,
              enabledBy,
              enabledAt: new Date(),
              level: monitoringLevel,
            },
          },
        },
        { new: true }
      );

      // Log the configuration change
      await this.logAuditEvent({
        action: "enable_enhanced_monitoring",
        category: "privacy_configuration",
        actor: enabledBy,
        target: { conversation: conversationId },
        details: {
          monitoringLevel,
          blockedActions,
          notifyAttempts,
          description: "Enhanced secret chat monitoring enabled",
        },
      });

      res.json({
        success: true,
        conversation: updatedConversation,
        message: `Enhanced monitoring (${monitoringLevel}) enabled for secret conversation`,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }

  /**
   * ✅ NEW: Get secret chat monitoring status
   */
  async getSecretChatMonitoringStatus(req, res) {
    try {
      const { conversationId } = req.params;

      const conversation = await Conversation.findById(conversationId).populate(
        "privacySettings.enhancedMonitoring.enabledBy",
        "username fullName"
      );

      if (!conversation) {
        return res.status(404).json({
          success: false,
          error: "Conversation not found",
        });
      }

      const monitoringStatus = {
        conversationType: conversation.conversationType,
        isSecretChat: conversation.conversationType === "secret",
        monitoringLevel:
          conversation.privacySettings?.monitoringLevel || "standard",
        enhancedMonitoring: conversation.privacySettings
          ?.enhancedMonitoring || { enabled: false },
        blockedActions: conversation.privacySettings?.blockedActions || [
          "screenshot",
        ],
        notifyAttempts:
          conversation.privacySettings?.notifyScreenshotAttempts || false,
      };

      res.json({
        success: true,
        monitoringStatus,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }

  /**
   * Log message deletion
   */
  async logMessageDeletion(req, res) {
    try {
      const {
        messageId,
        conversationId,
        deletedBy,
        deletionType,
        deletionReason,
        affectedUsers = [],
        isPermanent = true,
      } = req.body;

      const deletionLog = new MessageDeletionLog({
        message: messageId,
        conversation: conversationId,
        deletedBy,
        deletionType,
        deletionReason,
        affectedUsers,
        isPermanent,
      });

      await deletionLog.save();

      // Update message deletion status
      await DirectMessage.findByIdAndUpdate(messageId, {
        isDeleted: true,
        deletedAt: new Date(),
        deletedBy,
        ...(affectedUsers.length > 0 && {
          $push: {
            deletedFor: {
              $each: affectedUsers.map((userId) => ({
                user: userId,
                deletedAt: new Date(),
              })),
            },
          },
        }),
      });

      res.status(201).json({
        success: true,
        deletionLog: deletionLog._id,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }
  /**
   * Get message deletion logs
   */
  async getMessageDeletionLogs(req, res) {
    try {
      const {
        conversationId,
        deletedBy,
        deletionType,
        startDate,
        endDate,
        page = 1,
        limit = 50,
      } = req.query;

      const query = {};
      if (conversationId) query.conversation = conversationId;
      if (deletedBy) query.deletedBy = deletedBy;
      if (deletionType) query.deletionType = deletionType;
      if (startDate || endDate) {
        query.createdAt = {};
        if (startDate) query.createdAt.$gte = new Date(startDate);
        if (endDate) query.createdAt.$lte = new Date(endDate);
      }

      const logs = await MessageDeletionLog.find(query)
        .populate("message", "content messageType sentAt")
        .populate("conversation", "conversationName conversationType")
        .populate("deletedBy", "username fullName")
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(parseInt(limit));

      const total = await MessageDeletionLog.countDocuments(query);

      res.json({
        success: true,
        logs,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit),
        },
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }
  /**
   * Get message deletion logs
   */
  async getMessageDeletionLogs(req, res) {
    try {
      const {
        conversationId,
        deletedBy,
        deletionType,
        startDate,
        endDate,
        page = 1,
        limit = 50,
      } = req.query;

      const query = {};
      if (conversationId) query.conversation = conversationId;
      if (deletedBy) query.deletedBy = deletedBy;
      if (deletionType) query.deletionType = deletionType;
      if (startDate || endDate) {
        query.createdAt = {};
        if (startDate) query.createdAt.$gte = new Date(startDate);
        if (endDate) query.createdAt.$lte = new Date(endDate);
      }

      const logs = await MessageDeletionLog.find(query)
        .populate("message", "content messageType sentAt")
        .populate("conversation", "conversationName conversationType")
        .populate("deletedBy", "username fullName")
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(parseInt(limit));

      const total = await MessageDeletionLog.countDocuments(query);

      res.json({
        success: true,
        logs,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit),
        },
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }

  /**
   * Get screenshot logs
   */
  async getScreenshotLogs(req, res) {
    try {
      const {
        conversationId,
        detectedUser,
        detectionMethod,
        startDate,
        endDate,
        page = 1,
        limit = 50,
      } = req.query;

      const query = {};
      if (conversationId) query.conversation = conversationId;
      if (detectedUser) query.detectedUser = detectedUser;
      if (detectionMethod) query.detectionMethod = detectionMethod;
      if (startDate || endDate) {
        query.createdAt = {};
        if (startDate) query.createdAt.$gte = new Date(startDate);
        if (endDate) query.createdAt.$lte = new Date(endDate);
      }

      const logs = await ScreenshotLog.find(query)
        .populate("conversation", "conversationName conversationType")
        .populate("message", "content messageType sentAt")
        .populate("detectedUser", "username fullName")
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(parseInt(limit));

      const total = await ScreenshotLog.countDocuments(query);

      res.json({
        success: true,
        logs,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit),
        },
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }
  /**
   * Clean up expired identities
   */
  async cleanupExpiredIdentities(req, res) {
    try {
      const result = await UserMessageIdentity.cleanupExpiredIdentities();

      await this.logAuditEvent({
        action: "cleanup_expired_identities",
        category: "system_security",
        actorType: "system",
        details: {
          description: "Cleaned up expired user identities",
          cleanedCount: result.modifiedCount,
        },
      });

      res.json({
        success: true,
        cleanedIdentities: result.modifiedCount,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }
  /**
   * Clean up messages based on auto-delete settings
   */
  async cleanupMessages(req, res) {
    try {
      const { conversationId, dryRun = false } = req.body;

      const query = {
        $or: [
          { autoDeleteAt: { $lt: new Date() } },
          { "disappearing.disappearAt": { $lt: new Date() } },
        ],
        isDeleted: false,
      };

      if (conversationId) {
        query.conversation = conversationId;
      }

      if (dryRun) {
        const count = await DirectMessage.countDocuments(query);
        return res.json({
          success: true,
          messagesWouldBeDeleted: count,
          dryRun: true,
        });
      }

      const messagesToDelete = await DirectMessage.find(query).select("_id");
      const messageIds = messagesToDelete.map((m) => m._id);

      const result = await DirectMessage.updateMany(
        { _id: { $in: messageIds } },
        {
          isDeleted: true,
          deletedAt: new Date(),
          deletionType: "auto",
        }
      );

      // Log deletion for each message
      const deletionLogs = messageIds.map((messageId) => ({
        message: messageId,
        deletionType: "auto",
        deletedBy: null,
        isPermanent: true,
        deletionReason: "Auto-delete based on expiration settings",
      }));

      if (deletionLogs.length > 0) {
        await MessageDeletionLog.insertMany(deletionLogs);
      }

      res.json({
        success: true,
        deletedMessages: result.modifiedCount,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }

  /**
   * Get conversations that need cleanup
   */
  async getConversationsForCleanup(req, res) {
    try {
      const conversations = await Conversation.getConversationsForCleanup();

      res.json({
        success: true,
        conversations: conversations.map((conv) => ({
          id: conv._id,
          name: conv.conversationName,
          type: conv.conversationType,
          lastActivity: conv.analytics.lastActivityAt,
          autoDeleteEnabled: conv.privacySettings.autoDeleteMessages,
        })),
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }

  /**
   * Report a message for review
   */
  async reportMessage(req, res) {
    try {
      const {
        messageId,
        reportedBy,
        reason,
        category = "inappropriate_content",
        additionalInfo,
      } = req.body;

      const message = await DirectMessage.findById(messageId)
        .populate("conversation", "conversationType")
        .populate("sender", "username");

      if (!message) {
        return res.status(404).json({
          success: false,
          error: "Message not found",
        });
      }

      // Create content flag for the report
      const contentFlag = new ContentFlag({
        message: messageId,
        conversation: message.conversation._id,
        flaggedUser: message.sender._id,
        analysisType: "text",
        riskScore: 0.5, // Default for manual reports
        flags: [
          {
            type: "manual_report",
            category: category,
            severity: "medium",
            confidence: 1.0,
          },
        ],
        status: "pending",
        severity: "medium",
        reviewRequired: true,
        flaggedBy: "user_report",
        analysis: {
          textAnalysis: {
            userReport: {
              reportedBy,
              reason,
              additionalInfo,
              reportedAt: new Date(),
            },
          },
        },
      });

      await contentFlag.save();

      // Increment report count on message
      await DirectMessage.findByIdAndUpdate(messageId, {
        $inc: { reportCount: 1 },
      });

      res.status(201).json({
        success: true,
        reportId: contentFlag._id,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }

  /**
   * Review a content report
   */
  async reviewReport(req, res) {
    try {
      const { reportId } = req.params;
      const {
        reviewerId,
        decision,
        notes,
        moderationAction = "none",
      } = req.body;

      const contentFlag = await ContentFlag.findById(reportId);
      if (!contentFlag) {
        return res.status(404).json({
          success: false,
          error: "Report not found",
        });
      }

      contentFlag.status = decision;
      contentFlag.reviewedBy = reviewerId;
      contentFlag.reviewedAt = new Date();
      contentFlag.reviewNotes = notes;
      contentFlag.moderationAction = moderationAction;

      await contentFlag.save();

      // Execute moderation action
      if (moderationAction !== "none") {
        await this.executeModerationAction(contentFlag, moderationAction);
      }

      res.json({
        success: true,
        reviewedReport: contentFlag,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }

  /**
   * Get reports for review
   */
  async getReports(req, res) {
    try {
      const {
        status = "pending",
        severity,
        flaggedBy,
        startDate,
        endDate,
        page = 1,
        limit = 20,
      } = req.query;

      const query = {};
      if (status) query.status = status;
      if (severity) query.severity = severity;
      if (flaggedBy) query.flaggedBy = flaggedBy;
      if (startDate || endDate) {
        query.createdAt = {};
        if (startDate) query.createdAt.$gte = new Date(startDate);
        if (endDate) query.createdAt.$lte = new Date(endDate);
      }

      const reports = await ContentFlag.find(query)
        .populate("message", "content messageType sentAt")
        .populate("conversation", "conversationName conversationType")
        .populate("flaggedUser", "username fullName")
        .populate("reviewedBy", "username fullName")
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(parseInt(limit));

      const total = await ContentFlag.countDocuments(query);

      res.json({
        success: true,
        reports,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit),
        },
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }

  /**
   * Bulk cleanup operation
   */
  async bulkCleanup(req, res) {
    try {
      const {
        cleanupType,
        criteria = {},
        dryRun = false,
        batchSize = 1000,
      } = req.body;

      let result = {};

      switch (cleanupType) {
        case "expired_messages":
          result = await this.bulkCleanupExpiredMessages(
            criteria,
            dryRun,
            batchSize
          );
          break;
        case "old_logs":
          result = await this.bulkCleanupOldLogs(criteria, dryRun, batchSize);
          break;
        case "inactive_identities":
          result = await this.bulkCleanupInactiveIdentities(
            criteria,
            dryRun,
            batchSize
          );
          break;
        default:
          return res.status(400).json({
            success: false,
            error: "Invalid cleanup type",
          });
      }

      res.json({
        success: true,
        cleanupType,
        result,
        dryRun,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }
  /**
   * Get cleanup statistics
   */
  async getCleanupStats(req, res) {
    try {
      const { timeframe = 30 } = req.query; // days
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - timeframe);

      const stats = await Promise.all([
        // Messages eligible for cleanup
        DirectMessage.countDocuments({
          $or: [
            { autoDeleteAt: { $lt: new Date() } },
            { "disappearing.disappearAt": { $lt: new Date() } },
          ],
          isDeleted: false,
        }),

        // Expired identities
        UserMessageIdentity.countDocuments({
          expiresAt: { $lt: new Date() },
          isActive: true,
        }),

        // Recent deletion logs
        MessageDeletionLog.countDocuments({
          createdAt: { $gte: startDate },
        }),

        // Recent screenshot logs
        ScreenshotLog.countDocuments({
          createdAt: { $gte: startDate },
        }),

        // Pending content flags
        ContentFlag.countDocuments({
          status: "pending",
          reviewRequired: true,
        }),
      ]);

      res.json({
        success: true,
        stats: {
          messagesEligibleForCleanup: stats[0],
          expiredIdentities: stats[1],
          recentDeletions: stats[2],
          recentScreenshots: stats[3],
          pendingReviews: stats[4],
          timeframe,
        },
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }

  /**
   * Schedule cleanup task
   */
  async scheduleCleanup(req, res) {
    try {
      const { conversationId, deleteAfterHours, userId = null } = req.body;

      const nextCleanupAt = new Date();
      nextCleanupAt.setHours(nextCleanupAt.getHours() + deleteAfterHours);

      const schedule = new AutoDeleteSchedule({
        conversation: conversationId,
        user: userId,
        deleteAfterHours,
        nextCleanupAt,
      });

      await schedule.save();

      res.status(201).json({
        success: true,
        schedule,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }

  /**
   * Get auto-delete schedules
   */
  async getAutoDeleteSchedules(req, res) {
    try {
      const { conversationId, userId, isActive = true } = req.query;

      const query = {};
      if (conversationId) query.conversation = conversationId;
      if (userId) query.user = userId;
      if (isActive !== undefined) query.isActive = isActive === "true";

      const schedules = await AutoDeleteSchedule.find(query)
        .populate("conversation", "conversationName conversationType")
        .populate("user", "username fullName")
        .sort({ nextCleanupAt: 1 });

      res.json({
        success: true,
        schedules,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }

  /**
   * Create auto-delete schedule
   */
  async createAutoDeleteSchedule(req, res) {
    try {
      await this.scheduleCleanup(req, res);
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }

  /**
   * Update auto-delete schedule
   */
  async updateAutoDeleteSchedule(req, res) {
    try {
      const { scheduleId } = req.params;
      const { deleteAfterHours, isActive } = req.body;

      const updateData = {};
      if (deleteAfterHours !== undefined) {
        updateData.deleteAfterHours = deleteAfterHours;
        const nextCleanupAt = new Date();
        nextCleanupAt.setHours(nextCleanupAt.getHours() + deleteAfterHours);
        updateData.nextCleanupAt = nextCleanupAt;
      }
      if (isActive !== undefined) updateData.isActive = isActive;

      const schedule = await AutoDeleteSchedule.findByIdAndUpdate(
        scheduleId,
        updateData,
        { new: true }
      );

      if (!schedule) {
        return res.status(404).json({
          success: false,
          error: "Schedule not found",
        });
      }

      res.json({
        success: true,
        schedule,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }

  /**
   * Delete auto-delete schedule
   */
  async deleteAutoDeleteSchedule(req, res) {
    try {
      const { scheduleId } = req.params;

      const schedule = await AutoDeleteSchedule.findByIdAndUpdate(
        scheduleId,
        { isActive: false },
        { new: true }
      );

      if (!schedule) {
        return res.status(404).json({
          success: false,
          error: "Schedule not found",
        });
      }

      res.json({
        success: true,
        message: "Schedule deactivated",
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }

  /**
   * Perform system maintenance
   */
  async performMaintenance(req, res) {
    try {
      const { operations = ["all"] } = req.body;
      const results = {};

      if (
        operations.includes("all") ||
        operations.includes("cleanup_expired")
      ) {
        results.expiredIdentities =
          await UserMessageIdentity.cleanupExpiredIdentities();
      }

      if (
        operations.includes("all") ||
        operations.includes("cleanup_messages")
      ) {
        const messageCleanup = await DirectMessage.updateMany(
          {
            $or: [
              { autoDeleteAt: { $lt: new Date() } },
              { "disappearing.disappearAt": { $lt: new Date() } },
            ],
            isDeleted: false,
          },
          {
            isDeleted: true,
            deletedAt: new Date(),
          }
        );
        results.cleanedMessages = messageCleanup.modifiedCount;
      }

      if (
        operations.includes("all") ||
        operations.includes("update_analytics")
      ) {
        // Update conversation analytics
        await this.updateConversationAnalytics();
        results.analyticsUpdated = true;
      }

      await this.logAuditEvent({
        action: "system_maintenance",
        category: "system_security",
        actorType: "system",
        details: {
          description: "Performed system maintenance",
          operations,
          results,
        },
      });

      res.json({
        success: true,
        maintenanceResults: results,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }

  // ============================================
  // Advanced Content Moderation Functions
  // ============================================

  /**
   * Analyze content for threats and inappropriate material
   */
  async analyzeContent(req, res) {
    try {
      const {
        messageId,
        analysisType = "comprehensive",
        forceReanalysis = false,
      } = req.body;

      const message = await DirectMessage.findById(messageId)
        .populate("conversation")
        .populate("sender");

      if (!message) {
        return res.status(404).json({
          success: false,
          error: "Message not found",
        });
      }

      // Check if already analyzed recently
      const existingFlag = await ContentFlag.findOne({
        message: messageId,
        createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      });

      if (existingFlag && !forceReanalysis) {
        return res.json({
          success: true,
          analysis: existingFlag,
          cached: true,
        });
      }

      // Perform content analysis
      const analysis = await this.performContentAnalysis(message, analysisType);

      // Create or update content flag
      const contentFlag = new ContentFlag({
        message: messageId,
        conversation: message.conversation._id,
        flaggedUser: message.sender._id,
        analysisType,
        riskScore: analysis.riskScore,
        flags: analysis.flags,
        analysis: analysis.details,
        status: analysis.riskScore > 0.7 ? "confirmed" : "pending",
        severity: this.calculateSeverity(analysis.riskScore),
        reviewRequired: analysis.riskScore > 0.5,
        flaggedBy: "ai_detection",
        confidence: analysis.confidence,
      });

      await contentFlag.save();

      // Auto-escalate high-risk content
      if (analysis.riskScore > 0.8) {
        await this.autoEscalateContent(contentFlag);
      }

      res.json({
        success: true,
        analysis: contentFlag,
        riskScore: analysis.riskScore,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }

  /**
   * Flag suspicious activity
   */
  async flagSuspiciousActivity(req, res) {
    try {
      const {
        userId,
        conversationId,
        activityType,
        description,
        evidence = [],
        severity = "medium",
        flaggedBy,
      } = req.body;

      // Calculate risk score based on activity type and evidence
      const riskScore = this.calculateActivityRiskScore(activityType, evidence);

      const suspiciousActivity = new SuspiciousActivityFlag({
        flaggedUser: userId,
        conversation: conversationId,
        activityType,
        severity,
        description,
        evidence,
        riskScore,
        flaggedBy,
        priority:
          riskScore > 0.8 ? "urgent" : riskScore > 0.6 ? "high" : "normal",
        metadata: {
          detectionMethod: "manual",
          flaggedAt: new Date(),
          requiresReview: riskScore > 0.5,
        },
      });

      await suspiciousActivity.save();

      // Create security alert for high-risk activities
      if (riskScore > 0.7) {
        await this.createSecurityAlert({
          category: this.mapActivityToCategory(activityType),
          severity: riskScore > 0.9 ? "critical" : "high",
          title: `Suspicious activity detected: ${activityType}`,
          description,
          relatedUser: userId,
          relatedConversation: conversationId,
          metadata: {
            activityType,
            riskScore,
            automaticDetection: false,
          },
        });
      }

      res.status(201).json({
        success: true,
        activityFlag: suspiciousActivity,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }

  /**
   * Get content flags for review
   */
  async getContentFlags(req, res) {
    try {
      const {
        status,
        severity,
        flaggedBy,
        analysisType,
        riskScoreMin,
        riskScoreMax,
        startDate,
        endDate,
        page = 1,
        limit = 20,
        sortBy = "createdAt",
        sortOrder = "desc",
      } = req.query;

      const query = {};
      if (status) query.status = status;
      if (severity) query.severity = severity;
      if (flaggedBy) query.flaggedBy = flaggedBy;
      if (analysisType) query.analysisType = analysisType;
      if (riskScoreMin || riskScoreMax) {
        query.riskScore = {};
        if (riskScoreMin) query.riskScore.$gte = parseFloat(riskScoreMin);
        if (riskScoreMax) query.riskScore.$lte = parseFloat(riskScoreMax);
      }
      if (startDate || endDate) {
        query.createdAt = {};
        if (startDate) query.createdAt.$gte = new Date(startDate);
        if (endDate) query.createdAt.$lte = new Date(endDate);
      }

      const sortOptions = {};
      sortOptions[sortBy] = sortOrder === "desc" ? -1 : 1;

      const flags = await ContentFlag.find(query)
        .populate("message", "content messageType sentAt")
        .populate("conversation", "conversationName conversationType")
        .populate("flaggedUser", "username fullName email")
        .populate("reviewedBy", "username fullName")
        .sort(sortOptions)
        .skip((page - 1) * limit)
        .limit(parseInt(limit));

      const total = await ContentFlag.countDocuments(query);

      // Get summary statistics
      const summary = await ContentFlag.aggregate([
        { $match: query },
        {
          $group: {
            _id: null,
            totalFlags: { $sum: 1 },
            averageRiskScore: { $avg: "$riskScore" },
            severityBreakdown: {
              $push: "$severity",
            },
            statusBreakdown: {
              $push: "$status",
            },
          },
        },
      ]);

      res.json({
        success: true,
        flags,
        summary: summary[0] || {},
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit),
        },
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }

  /**
   * Review content flag
   */
  async reviewContentFlag(req, res) {
    try {
      const { flagId } = req.params;
      const {
        reviewerId,
        decision,
        notes,
        moderationAction = "none",
        escalate = false,
        escalateTo,
      } = req.body;

      const contentFlag = await ContentFlag.findById(flagId)
        .populate("message")
        .populate("flaggedUser");

      if (!contentFlag) {
        return res.status(404).json({
          success: false,
          error: "Content flag not found",
        });
      }

      // Update flag status
      contentFlag.status = decision;
      contentFlag.reviewedBy = reviewerId;
      contentFlag.reviewedAt = new Date();
      contentFlag.reviewNotes = notes;
      contentFlag.moderationAction = moderationAction;

      if (escalate) {
        contentFlag.escalated = true;
        contentFlag.escalatedAt = new Date();
        contentFlag.escalatedTo = escalateTo;
      }

      await contentFlag.save();

      // Execute moderation action
      if (moderationAction !== "none") {
        await this.executeModerationAction(contentFlag, moderationAction);
      }

      // Log audit event
      await this.logAuditEvent({
        action: "review_content_flag",
        category: "content_moderation",
        actor: reviewerId,
        target: { contentFlag: flagId },
        details: {
          decision,
          moderationAction,
          escalated: escalate,
          riskScore: contentFlag.riskScore,
        },
      });

      res.json({
        success: true,
        reviewedFlag: contentFlag,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }

  /**
   * Update moderation rules
   */
  async updateModerationRules(req, res) {
    try {
      const {
        ruleId,
        name,
        description,
        patterns,
        thresholds,
        autoActions,
        conditions,
        enabled,
        updatedBy,
      } = req.body;

      let rule;

      if (ruleId) {
        // Update existing rule
        rule = await ModerationRule.findOne({ ruleId });
        if (!rule) {
          return res.status(404).json({
            success: false,
            error: "Moderation rule not found",
          });
        }

        rule.version += 1;
      } else {
        // Create new rule
        rule = new ModerationRule({
          ruleId: `rule_${uuidv4()}`,
          ruleType: req.body.ruleType,
        });
      }

      // Update rule properties
      if (name) rule.name = name;
      if (description) rule.description = description;
      if (patterns) rule.patterns = patterns;
      if (thresholds) rule.thresholds = thresholds;
      if (autoActions) rule.autoActions = autoActions;
      if (conditions) rule.conditions = conditions;
      if (enabled !== undefined) rule.enabled = enabled;
      rule.updatedBy = updatedBy;
      rule.lastUpdated = new Date();

      await rule.save();

      await this.logAuditEvent({
        action: ruleId ? "update_moderation_rule" : "create_moderation_rule",
        category: "configuration_change",
        actor: updatedBy,
        details: {
          ruleId: rule.ruleId,
          ruleType: rule.ruleType,
          enabled: rule.enabled,
          version: rule.version,
        },
      });

      res.json({
        success: true,
        rule,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }

  /**
   * Get moderation rules
   */
  async getModerationRules(req, res) {
    try {
      const { ruleType, enabled, page = 1, limit = 50 } = req.query;

      const query = {};
      if (ruleType) query.ruleType = ruleType;
      if (enabled !== undefined) query.enabled = enabled === "true";

      const rules = await ModerationRule.find(query)
        .populate("updatedBy", "username fullName")
        .sort({ priority: -1, lastUpdated: -1 })
        .skip((page - 1) * limit)
        .limit(parseInt(limit));

      const total = await ModerationRule.countDocuments(query);

      res.json({
        success: true,
        rules,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit),
        },
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }
  /**
   * Scan conversation history for threats
   */
  async scanConversationHistory(req, res) {
    try {
      const {
        conversationId,
        lookbackDays = 30,
        analysisTypes = ["comprehensive"],
        userId,
      } = req.body;

      const startDate = new Date();
      startDate.setDate(startDate.getDate() - lookbackDays);

      // Get messages from conversation
      const messages = await DirectMessage.find({
        conversation: conversationId,
        sentAt: { $gte: startDate },
        isDeleted: false,
      }).populate("sender");

      const scanResults = {
        conversationId,
        scannedMessages: messages.length,
        flaggedMessages: 0,
        totalRiskScore: 0,
        flagsByCategory: {},
        scanId: uuidv4(),
      };

      // Batch process messages
      const batchSize = 10;
      for (let i = 0; i < messages.length; i += batchSize) {
        const batch = messages.slice(i, i + batchSize);

        for (const message of batch) {
          for (const analysisType of analysisTypes) {
            const analysis = await this.performContentAnalysis(
              message,
              analysisType
            );

            if (analysis.riskScore > 0.3) {
              // Threshold for flagging
              scanResults.flaggedMessages++;
              scanResults.totalRiskScore += analysis.riskScore;

              // Create content flag
              const contentFlag = new ContentFlag({
                message: message._id,
                conversation: conversationId,
                flaggedUser: message.sender._id,
                analysisType,
                riskScore: analysis.riskScore,
                flags: analysis.flags,
                analysis: analysis.details,
                status: "pending",
                severity: this.calculateSeverity(analysis.riskScore),
                reviewRequired: analysis.riskScore > 0.5,
                flaggedBy: "system_scan",
                scanId: scanResults.scanId,
              });

              await contentFlag.save();

              // Count by category
              analysis.flags.forEach((flag) => {
                scanResults.flagsByCategory[flag.category] =
                  (scanResults.flagsByCategory[flag.category] || 0) + 1;
              });
            }
          }
        }
      }

      // Create security alert if significant threats found
      if (scanResults.flaggedMessages > 5 || scanResults.totalRiskScore > 3) {
        await this.createSecurityAlert({
          category: "coordinated_threats",
          severity: scanResults.totalRiskScore > 5 ? "high" : "medium",
          title: `Conversation scan revealed potential threats`,
          description: `Scan of conversation ${conversationId} found ${scanResults.flaggedMessages} flagged messages`,
          relatedConversation: conversationId,
          metadata: {
            scanResults,
            automaticDetection: true,
          },
        });
      }

      res.json({
        success: true,
        scanResults,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }
  /**
   * Block suspicious user
   */
  async blockSuspiciousUser(req, res) {
    try {
      const {
        userId,
        suspendedBy,
        reason,
        violationType,
        severity = "major",
        duration, // hours, null for permanent
        restrictions = {},
        preserveEvidence = true,
      } = req.body;

      const expiresAt = duration
        ? new Date(Date.now() + duration * 60 * 60 * 1000)
        : null;

      const suspension = new UserSuspension({
        user: userId,
        suspendedBy,
        reason,
        violationType,
        severity,
        duration,
        expiresAt,
        type: duration ? "temporary_ban" : "permanent_ban",
        restrictions: {
          canSendMessages: false,
          canCreateConversations: false,
          canJoinConversations: false,
          canUploadMedia: false,
          canChangeProfile: false,
          ...restrictions,
        },
        evidencePreserved: preserveEvidence,
      });

      await suspension.save();

      // Preserve evidence if requested
      if (preserveEvidence) {
        await this.preserveUserEvidence(userId);
      }

      // Create security alert
      await this.createSecurityAlert({
        category: "emergency_action",
        severity: severity === "critical" ? "critical" : "high",
        title: `User suspended: ${violationType}`,
        description: reason,
        relatedUser: userId,
        metadata: {
          suspensionType: suspension.type,
          duration,
          automaticDetection: false,
        },
      });

      res.status(201).json({
        success: true,
        suspension,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }

  /**
   * Get security alerts
   */
  async getSecurityAlerts(req, res) {
    try {
      const {
        category,
        severity,
        status = "active",
        startDate,
        endDate,
        page = 1,
        limit = 20,
      } = req.query;

      const query = {};
      if (category) query.category = category;
      if (severity) query.severity = severity;
      if (status) query.status = status;
      if (startDate || endDate) {
        query.createdAt = {};
        if (startDate) query.createdAt.$gte = new Date(startDate);
        if (endDate) query.createdAt.$lte = new Date(endDate);
      }

      const alerts = await SecurityAlert.find(query)
        .populate("relatedUser", "username fullName email")
        .populate("relatedConversation", "conversationName conversationType")
        .populate("acknowledgedBy", "username fullName")
        .populate("resolvedBy", "username fullName")
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(parseInt(limit));

      const total = await SecurityAlert.countDocuments(query);

      // Get severity distribution
      const severityStats = await SecurityAlert.aggregate([
        { $match: query },
        {
          $group: {
            _id: "$severity",
            count: { $sum: 1 },
          },
        },
      ]);

      res.json({
        success: true,
        alerts,
        severityStats,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit),
        },
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }
  /**
   * Report to law enforcement authorities
   */
  async reportToAuthorities(req, res) {
    try {
      const {
        contentFlagId,
        urgency = "priority",
        externalAgency,
        additionalInfo,
        preservationRequest = true,
        reportedBy,
      } = req.body;

      const contentFlag = await ContentFlag.findById(contentFlagId)
        .populate("message")
        .populate("flaggedUser")
        .populate("conversation");

      if (!contentFlag) {
        return res.status(404).json({
          success: false,
          error: "Content flag not found",
        });
      }

      const caseId = `CASE_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;

      const report = new LawEnforcementReport({
        contentFlag: contentFlagId,
        message: contentFlag.message._id,
        reportedUser: contentFlag.flaggedUser._id,
        conversation: contentFlag.conversation._id,
        reportedBy,
        caseId,
        externalAgency,
        urgency,
        threatCategories: contentFlag.analysis.threatCategories || [],
        riskScore: contentFlag.riskScore,
        reportData: {
          messageContent: contentFlag.message.content,
          messageType: contentFlag.message.messageType,
          sentAt: contentFlag.message.sentAt,
          userInfo: {
            userId: contentFlag.flaggedUser._id.toString(),
            username: contentFlag.flaggedUser.username,
            fullName: contentFlag.flaggedUser.fullName,
            email: contentFlag.flaggedUser.email,
            registrationDate: contentFlag.flaggedUser.createdAt,
            lastActive: contentFlag.flaggedUser.lastActiveAt,
          },
          analysisResults: contentFlag.analysis,
          additionalInfo,
          legalBasis: "Threat detection and public safety",
          preservationRequest,
        },
        preservationNotice: preservationRequest
          ? {
              issued: true,
              issuedAt: new Date(),
              expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000), // 90 days
              scope: "User data and communications related to case",
            }
          : undefined,
      });

      await report.save();

      // Mark content flag as escalated
      contentFlag.escalated = true;
      contentFlag.escalatedAt = new Date();
      contentFlag.escalatedTo = "law_enforcement";
      await contentFlag.save();

      // Create security alert
      await this.createSecurityAlert({
        category: "emergency_action",
        severity: "critical",
        title: `Law enforcement report filed: ${caseId}`,
        description: `Case reported to ${externalAgency || "authorities"}`,
        relatedUser: contentFlag.flaggedUser._id,
        relatedConversation: contentFlag.conversation._id,
        metadata: {
          caseId,
          urgency,
          preservationRequest,
        },
      });

      res.status(201).json({
        success: true,
        report: {
          caseId,
          reportId: report._id,
          status: report.status,
        },
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }

  /**
   * Emergency content block
   */
  async emergencyContentBlock(req, res) {
    try {
      const {
        messageId,
        conversationId,
        userId,
        reason,
        blockedBy,
        preserveEvidence = true,
        notifyAuthorities = false,
      } = req.body;

      // Block the message
      if (messageId) {
        await DirectMessage.findByIdAndUpdate(messageId, {
          isDeleted: true,
          deletedAt: new Date(),
          deletedBy: blockedBy,
          moderationStatus: {
            status: "hidden",
            reason: "Emergency block - " + reason,
            reviewedAt: new Date(),
            reviewedBy: blockedBy,
          },
        });
      }

      // Emergency suspend user
      if (userId) {
        const suspension = new UserSuspension({
          user: userId,
          suspendedBy: blockedBy,
          reason: "Emergency action - " + reason,
          severity: "critical",
          type: "emergency_block",
          restrictions: {
            canSendMessages: false,
            canCreateConversations: false,
            canJoinConversations: false,
            canUploadMedia: false,
            canChangeProfile: false,
          },
          evidencePreserved: preserveEvidence,
        });

        await suspension.save();
      }

      // Preserve evidence
      if (preserveEvidence) {
        if (userId) await this.preserveUserEvidence(userId);
        if (messageId) await this.preserveMessageEvidence(messageId);
      }

      // Create critical security alert
      const alert = await this.createSecurityAlert({
        category: "emergency_action",
        severity: "emergency",
        title: "Emergency content block executed",
        description: reason,
        relatedUser: userId,
        relatedConversation: conversationId,
        relatedMessages: messageId ? [messageId] : [],
        metadata: {
          emergencyAction: true,
          preserveEvidence,
          notifyAuthorities,
          executedBy: blockedBy,
        },
      });

      // Notify authorities if requested
      if (notifyAuthorities && messageId) {
        // Auto-create law enforcement report
        const contentFlag = await ContentFlag.findOne({ message: messageId });
        if (contentFlag) {
          await this.reportToAuthorities(
            {
              body: {
                contentFlagId: contentFlag._id,
                urgency: "emergency",
                additionalInfo: "Emergency content block - " + reason,
                reportedBy: blockedBy,
              },
            },
            { json: () => {} }
          ); // Mock response for internal call
        }
      }

      res.json({
        success: true,
        emergencyAction: {
          alertId: alert._id,
          messageBlocked: !!messageId,
          userSuspended: !!userId,
          evidencePreserved: preserveEvidence,
          authoritiesNotified: notifyAuthorities,
        },
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }

  /**
   * Update threat database
   */
  async updateThreatDatabase(req, res) {
    try {
      const {
        threatType,
        category,
        patterns,
        severity,
        source = "manual",
        description,
        context,
        addedBy,
        geographicScope = [],
        languages = ["en"],
      } = req.body;

      const threatId = `threat_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;

      const threat = new ThreatDatabase({
        threatId,
        threatType,
        category,
        patterns,
        severity,
        source,
        description,
        context,
        addedBy,
        geographicScope,
        languages,
      });

      await threat.save();

      await this.logAuditEvent({
        action: "update_threat_database",
        category: "configuration_change",
        actor: addedBy,
        details: {
          threatId,
          threatType,
          category,
          severity,
          patternsCount: patterns.length,
        },
      });

      res.status(201).json({
        success: true,
        threat,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }

  /**
   * Analyze user behavior patterns
   */
  async analyzeUserBehavior(req, res) {
    try {
      const {
        userId,
        analysisDepth = 30, // days
        analysisType = "routine",
        analyzedBy,
      } = req.body;

      // Get user's recent activity
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - analysisDepth);

      const [messages, conversations, flags] = await Promise.all([
        DirectMessage.find({
          sender: userId,
          sentAt: { $gte: startDate },
          isDeleted: false,
        }),
        ConversationParticipant.find({
          user: userId,
          joinedAt: { $gte: startDate },
        }).populate("conversation"),
        ContentFlag.find({
          flaggedUser: userId,
          createdAt: { $gte: startDate },
        }),
      ]);

      // Analyze patterns
      const analysis = await this.performBehaviorAnalysis(userId, {
        messages,
        conversations,
        flags,
        analysisDepth,
      });

      const behaviorAnalysis = new UserBehaviorAnalysis({
        user: userId,
        analyzedBy,
        analysisType,
        analysisDepth,
        riskScore: analysis.riskScore,
        riskFactors: analysis.riskFactors,
        analysis: analysis.details,
        status: this.calculateRiskStatus(analysis.riskScore),
        requiresAction: analysis.riskScore > 0.7,
        monitoringLevel:
          analysis.riskScore > 0.8
            ? "intensive"
            : analysis.riskScore > 0.6
              ? "enhanced"
              : "standard",
      });

      await behaviorAnalysis.save();

      // Create alert for high-risk users
      if (analysis.riskScore > 0.8) {
        await this.createSecurityAlert({
          category: "suspicious_behavior",
          severity: analysis.riskScore > 0.9 ? "critical" : "high",
          title: "High-risk user behavior detected",
          description: `User behavior analysis indicates elevated risk score: ${analysis.riskScore}`,
          relatedUser: userId,
          metadata: {
            riskScore: analysis.riskScore,
            analysisType,
            automaticDetection: true,
          },
        });
      }

      res.json({
        success: true,
        behaviorAnalysis,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }

  /**
   * Create safety report
   */
  async createSafetyReport(req, res) {
    try {
      const {
        reportType,
        timeframe = 30, // days
        scope = {},
        generatedBy,
        classification = "confidential",
      } = req.body;

      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(endDate.getDate() - timeframe);

      const reportId = `REPORT_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;

      // Generate report data based on type
      const reportData = await this.generateReportData(
        reportType,
        startDate,
        endDate,
        scope
      );

      const safetyReport = new SafetyReport({
        reportId,
        reportType,
        generatedBy,
        timeframe,
        startDate,
        endDate,
        scope,
        data: reportData.statistics,
        report: reportData.report,
        classification,
        status: "completed",
      });

      await safetyReport.save();

      res.status(201).json({
        success: true,
        report: {
          reportId,
          reportType,
          timeframe,
          status: "completed",
          summary: reportData.report.executiveSummary,
        },
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }

  // ============================================
  // Helper Methods
  // ============================================

  async executeModerationAction(contentFlag, action) {
    switch (action) {
      case "hide_message":
        await DirectMessage.findByIdAndUpdate(contentFlag.message, {
          "moderationStatus.status": "hidden",
          "moderationStatus.reason": "Moderation action",
          "moderationStatus.reviewedAt": new Date(),
        });
        break;

      case "warn":
        // Implementation for user warning
        break;

      case "block_user":
        await this.blockSuspiciousUser(
          {
            body: {
              userId: contentFlag.flaggedUser,
              suspendedBy: contentFlag.reviewedBy,
              reason: "Content violation",
              severity: "major",
              duration: 24, // 24 hours
            },
          },
          { json: () => {} }
        );
        break;

      default:
        break;
    }
  }
  async performContentAnalysis(message, analysisType) {
    // Mock implementation - replace with actual AI/ML analysis
    const analysis = {
      riskScore: Math.random() * 0.5, // Mock risk score
      confidence: 0.85,
      flags: [],
      details: {
        textAnalysis: {},
        imageAnalysis: {},
        behaviorAnalysis: {},
      },
    };

    // Simple keyword detection (replace with sophisticated NLP)
    const content = message.content.toLowerCase();
    const threatKeywords = ["bomb", "attack", "kill", "terrorist", "weapon"];

    for (const keyword of threatKeywords) {
      if (content.includes(keyword)) {
        analysis.riskScore += 0.3;
        analysis.flags.push({
          type: "threat_keyword",
          category: "violence",
          severity: "high",
          confidence: 0.9,
        });
      }
    }

    analysis.riskScore = Math.min(analysis.riskScore, 1.0);
    return analysis;
  }

  calculateSeverity(riskScore) {
    if (riskScore >= 0.8) return "critical";
    if (riskScore >= 0.6) return "high";
    if (riskScore >= 0.4) return "medium";
    return "low";
  }

  calculateActivityRiskScore(activityType, evidence) {
    const baseScores = {
      drug_trafficking: 0.9,
      terrorism_planning: 0.95,
      weapons_dealing: 0.85,
      human_trafficking: 0.9,
      child_exploitation: 0.95,
      financial_crimes: 0.7,
      suspicious_behavior: 0.5,
    };

    let score = baseScores[activityType] || 0.5;
    score += evidence.length * 0.1;
    return Math.min(score, 1.0);
  }

  mapActivityToCategory(activityType) {
    const mapping = {
      drug_trafficking: "drug_trafficking",
      terrorism_planning: "terrorism",
      weapons_dealing: "weapons_trafficking",
      human_trafficking: "human_trafficking",
      child_exploitation: "child_exploitation",
      financial_crimes: "financial_crimes",
    };
    return mapping[activityType] || "suspicious_behavior";
  }

  async createSecurityAlert(alertData) {
    const alert = new SecurityAlert({
      alertId: `ALERT_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`,
      ...alertData,
    });
    return await alert.save();
  }

  async logAuditEvent(eventData) {
    const auditLog = new SecurityAuditLog({
      logId: `LOG_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`,
      ...eventData,
    });
    return await auditLog.save();
  }

  async autoEscalateContent(contentFlag) {
    // Auto-escalate high-risk content
    contentFlag.escalated = true;
    contentFlag.escalatedAt = new Date();
    contentFlag.escalatedTo = "admin";
    await contentFlag.save();

    await this.createSecurityAlert({
      category: "emergency_action",
      severity: "critical",
      title: "High-risk content auto-escalated",
      description: `Content with risk score ${contentFlag.riskScore} auto-escalated for review`,
      relatedUser: contentFlag.flaggedUser,
      relatedMessages: [contentFlag.message],
    });
  }

  async preserveUserEvidence(userId) {
    // Implementation for preserving user evidence
    // This would typically involve creating backups and legal holds
    return true;
  }

  async preserveMessageEvidence(messageId) {
    // Implementation for preserving message evidence
    return true;
  }

  async performBehaviorAnalysis(userId, data) {
    // Mock behavior analysis - replace with actual implementation
    const riskFactors = [];
    let riskScore = 0;

    // Analyze message patterns
    if (data.messages.length > 100) {
      riskFactors.push({
        factor: "high_message_volume",
        weight: 0.3,
        severity: "medium",
        description: "Unusually high message volume",
      });
      riskScore += 0.3;
    }

    // Analyze flags
    if (data.flags.length > 5) {
      riskFactors.push({
        factor: "multiple_content_flags",
        weight: 0.5,
        severity: "high",
        description: "Multiple content flags in analysis period",
      });
      riskScore += 0.5;
    }

    return {
      riskScore: Math.min(riskScore, 1.0),
      riskFactors,
      details: {
        messagingPatterns: {
          dailyMessageCount: data.messages.length / 30,
          conversationCount: data.conversations.length,
        },
        networkAnalysis: {},
        contentAnalysis: {},
        temporalPatterns: {},
      },
    };
  }

  calculateRiskStatus(riskScore) {
    if (riskScore >= 0.8) return "critical_risk";
    if (riskScore >= 0.6) return "high_risk";
    if (riskScore >= 0.4) return "medium_risk";
    return "low_risk";
  }

  async generateReportData(reportType, startDate, endDate, scope) {
    // Mock report generation - replace with actual implementation
    const statistics = {
      totalAnalyzed: 1000,
      flaggedContent: 50,
      threatCategories: {
        terrorism: 5,
        drug_trafficking: 15,
        weapons: 8,
      },
      actionsTaken: {
        warnings: 25,
        suspensions: 10,
        reports_filed: 3,
      },
    };

    const report = {
      executiveSummary: `Safety report for ${reportType} covering ${endDate.toDateString()}`,
      keyFindings: [
        "Decreased threat activity compared to previous period",
        "Effective detection of drug-related content",
      ],
      recommendations: [
        "Continue monitoring high-risk users",
        "Update threat detection algorithms",
      ],
    };

    return { statistics, report };
  }

  async bulkCleanupExpiredMessages(criteria, dryRun, batchSize) {
    const query = {
      $or: [
        { autoDeleteAt: { $lt: new Date() } },
        { "disappearing.disappearAt": { $lt: new Date() } },
      ],
      isDeleted: false,
      ...criteria,
    };

    if (dryRun) {
      const count = await DirectMessage.countDocuments(query);
      return { wouldDelete: count };
    }

    const result = await DirectMessage.updateMany(query, {
      isDeleted: true,
      deletedAt: new Date(),
    });

    return { deleted: result.modifiedCount };
  }

  async bulkCleanupOldLogs(criteria, dryRun, batchSize) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - (criteria.retentionDays || 90));

    const queries = [
      { model: ScreenshotLog, query: { createdAt: { $lt: cutoffDate } } },
      { model: MessageDeletionLog, query: { createdAt: { $lt: cutoffDate } } },
      {
        model: SecurityAuditLog,
        query: {
          createdAt: { $lt: cutoffDate },
          "compliance.requiresReporting": { $ne: true },
        },
      },
    ];

    let totalDeleted = 0;

    for (const { model, query } of queries) {
      if (dryRun) {
        const count = await model.countDocuments(query);
        totalDeleted += count;
      } else {
        const result = await model.deleteMany(query);
        totalDeleted += result.deletedCount;
      }
    }

    return dryRun ? { wouldDelete: totalDeleted } : { deleted: totalDeleted };
  }
  async bulkCleanupInactiveIdentities(criteria, dryRun, batchSize) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - (criteria.inactiveDays || 365));

    const query = {
      isActive: false,
      "usageStats.lastUsedAt": { $lt: cutoffDate },
      ...criteria,
    };

    if (dryRun) {
      const count = await UserMessageIdentity.countDocuments(query);
      return { wouldDelete: count };
    }

    const result = await UserMessageIdentity.updateMany(query, {
      isDeleted: true,
    });

    return { deleted: result.modifiedCount };
  }
  async updateConversationAnalytics() {
    // Update analytics for all active conversations
    const conversations = await Conversation.find({ isDeleted: false });

    for (const conversation of conversations) {
      const [messageCount, mediaCount, lastMessage] = await Promise.all([
        DirectMessage.countDocuments({
          conversation: conversation._id,
          isDeleted: false,
        }),
        DirectMessage.countDocuments({
          conversation: conversation._id,
          messageType: { $in: ["image", "video", "audio", "file"] },
          isDeleted: false,
        }),
        DirectMessage.findOne({
          conversation: conversation._id,
          isDeleted: false,
        }).sort({ sentAt: -1 }),
      ]);

      await Conversation.findByIdAndUpdate(conversation._id, {
        "analytics.totalMessages": messageCount,
        "analytics.totalMedia": mediaCount,
        "analytics.lastActivityAt":
          lastMessage?.sentAt || conversation.analytics.lastActivityAt,
      });
    }

    return true;
  }
}
