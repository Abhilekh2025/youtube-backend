// Functions:

// createIdentity
// getUserIdentities
// setDefaultIdentity
// updateAutoDeleteSettings
// updateForwardingPreferences
// getAutoDeleteSettings
// getForwardingPreferences

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
import { body, query, param, validationResult } from "express-validator";

class IdentityController {
  /**
   * Validation middleware for creating identities
   */
  static createIdentityValidation = [
    body("messageAlias")
      .isLength({ min: 2, max: 50 })
      .trim()
      .withMessage("Message alias must be 2-50 characters")
      .matches(/^[a-zA-Z0-9_-]+$/)
      .withMessage(
        "Message alias can only contain letters, numbers, underscores, and hyphens"
      ),
    body("displayName")
      .optional()
      .isLength({ min: 1, max: 100 })
      .trim()
      .withMessage("Display name must be 1-100 characters"),
    body("avatar").optional().isURL().withMessage("Avatar must be a valid URL"),
    body("isDefault")
      .optional()
      .isBoolean()
      .withMessage("isDefault must be boolean"),
    body("expiresAt")
      .optional()
      .isISO8601()
      .withMessage("Expiry date must be valid ISO8601 date"),
    body("autoDelete.enabled")
      .optional()
      .isBoolean()
      .withMessage("Auto delete enabled must be boolean"),
    body("autoDelete.preset")
      .optional()
      .isIn(["1_day", "1_week", "1_month", "custom"])
      .withMessage("Invalid auto delete preset"),
    body("autoDelete.customDays")
      .optional()
      .isInt({ min: 1, max: 365 })
      .withMessage("Custom days must be between 1 and 365"),
    body("privacySettings.allowStrangers")
      .optional()
      .isBoolean()
      .withMessage("Allow strangers must be boolean"),
    body("privacySettings.allowMessageRequests")
      .optional()
      .isBoolean()
      .withMessage("Allow message requests must be boolean"),
    body("privacySettings.readReceiptsEnabled")
      .optional()
      .isBoolean()
      .withMessage("Read receipts enabled must be boolean"),
    body("privacySettings.typingIndicators")
      .optional()
      .isBoolean()
      .withMessage("Typing indicators must be boolean"),
    body("privacySettings.onlineStatus")
      .optional()
      .isBoolean()
      .withMessage("Online status must be boolean"),
  ];

  /**
   * Create a new message identity
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async createIdentity(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: "Validation failed",
          details: errors.array(),
        });
      }

      const {
        messageAlias,
        displayName,
        avatar,
        isDefault = false,
        expiresAt,
        autoDelete = {},
        privacySettings = {},
        forwardingPreferences = {},
      } = req.body;
      const userId = req.user.id;

      // Check if alias is already taken by this user
      const existingAlias = await UserMessageIdentity.findOne({
        user: userId,
        messageAlias: messageAlias.toLowerCase(),
        isDeleted: false,
      });

      if (existingAlias) {
        throw new APIError("Message alias already exists", 400);
      }

      // Check user's identity limit (max 10 per user)
      const identityCount = await UserMessageIdentity.countDocuments({
        user: userId,
        isDeleted: false,
      });

      if (identityCount >= 10) {
        throw new APIError("Maximum number of identities reached (10)", 400);
      }

      // Validate expiry date
      if (expiresAt && new Date(expiresAt) <= new Date()) {
        throw new APIError("Expiry date must be in the future", 400);
      }

      // Validate auto-delete settings
      if (
        autoDelete.enabled &&
        autoDelete.preset === "custom" &&
        !autoDelete.customDays
      ) {
        throw new APIError("Custom days required when preset is custom", 400);
      }

      // Validate auto-delete vs expiry date logic
      if (autoDelete.enabled && expiresAt) {
        const presetToDays = {
          "1_day": 1,
          "1_week": 7,
          "1_month": 30,
          custom: autoDelete.customDays || 0,
        };

        const autoDeleteDays = presetToDays[autoDelete.preset] || 0;
        const expiryDate = new Date(expiresAt);
        const autoDeleteDate = new Date(
          Date.now() + autoDeleteDays * 24 * 60 * 60 * 1000
        );

        if (autoDeleteDate > expiryDate) {
          throw new APIError(
            `Auto-delete date (${autoDeleteDate.toISOString().split("T")[0]}) cannot be after identity expiry date (${expiryDate.toISOString().split("T")[0]}). ` +
              `Identity will expire before auto-delete takes effect.`,
            400
          );
        }

        // Warn if auto-delete is very close to expiry (within 1 day)
        const daysDifference = Math.ceil(
          (expiryDate - autoDeleteDate) / (24 * 60 * 60 * 1000)
        );
        if (daysDifference <= 1 && daysDifference > 0) {
          // This is just a warning, not an error - we could log this or return it in response
          console.warn(
            `Auto-delete date is very close to expiry date for user ${userId}: ${daysDifference} day(s) difference`
          );
        }
      }

      // Prepare identity data
      const identityData = {
        user: userId,
        messageAlias: messageAlias.toLowerCase().trim(),
        displayName: displayName || messageAlias,
        avatar: avatar || null,
        isDefault: isDefault,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
        privacySettings: {
          allowStrangers: privacySettings.allowStrangers !== false,
          allowMessageRequests: privacySettings.allowMessageRequests !== false,
          autoDeleteSettings: {
            enabled: autoDelete.enabled || false,
            preset: autoDelete.preset || null,
            customDays:
              autoDelete.preset === "custom" ? autoDelete.customDays : null,
            effectiveDays: 0, // Will be calculated in pre-save middleware
          },
          readReceiptsEnabled: privacySettings.readReceiptsEnabled !== false,
          typingIndicators: privacySettings.typingIndicators !== false,
          onlineStatus: privacySettings.onlineStatus !== false,
        },
        forwardingPreferences: {
          defaultAttribution:
            forwardingPreferences.defaultAttribution || "show_original",
          allowOthersToForward:
            forwardingPreferences.allowOthersToForward !== false,
          requireAttribution: forwardingPreferences.requireAttribution || false,
          maxForwardChain: forwardingPreferences.maxForwardChain || 10,
          forwardToPublicChannels:
            forwardingPreferences.forwardToPublicChannels || false,
        },
      };

      const identity = new UserMessageIdentity(identityData);
      await identity.save();

      // If this is set as default or user has no other identities, make it default
      if (isDefault || identityCount === 0) {
        await identity.setAsDefault();
      }

      res.status(201).json({
        success: true,
        identity: {
          _id: identity._id,
          messageAlias: identity.messageAlias,
          displayName: identity.displayName,
          avatar: identity.avatar,
          isDefault: identity.isDefault,
          isActive: identity.isActive,
          expiresAt: identity.expiresAt,
          privacySettings: identity.privacySettings,
          forwardingPreferences: identity.forwardingPreferences,
          usageStats: identity.usageStats,
          createdAt: identity.createdAt,
        },
        message: "Identity created successfully",
      });
    } catch (error) {
      console.error("Error creating identity:", error);
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
   * Validation for getting user identities
   */
  static getUserIdentitiesValidation = [
    query("includeExpired")
      .optional()
      .isBoolean()
      .withMessage("includeExpired must be boolean"),
    query("includeInactive")
      .optional()
      .isBoolean()
      .withMessage("includeInactive must be boolean"),
    query("limit")
      .optional()
      .isInt({ min: 1, max: 50 })
      .withMessage("Limit must be between 1 and 50"),
    query("skip")
      .optional()
      .isInt({ min: 0 })
      .withMessage("Skip must be non-negative"),
  ];

  /**
   * Get user's message identities
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async getUserIdentities(req, res) {
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
        includeExpired = false,
        includeInactive = false,
        limit = 20,
        skip = 0,
      } = req.query;

      // Build query
      const query = {
        user: userId,
        isDeleted: false,
      };

      if (!includeInactive) {
        query.isActive = true;
      }

      if (!includeExpired) {
        query.$or = [
          { expiresAt: { $exists: false } },
          { expiresAt: { $gt: new Date() } },
        ];
      }

      const identities = await UserMessageIdentity.find(query)
        .sort({ isDefault: -1, createdAt: -1 })
        .skip(parseInt(skip))
        .limit(parseInt(limit))
        .select("-__v");

      // Add computed fields
      const identitiesWithDetails = identities.map((identity) => {
        const identityObj = identity.toObject();

        return {
          ...identityObj,
          isExpired: identity.isExpired,
          isUsable: identity.isUsable(),
          autoDeleteSettings: identity.getAutoDeleteSettings(),
          forwardingSettings: identity.getForwardingPreferences(),
          // Add usage statistics
          totalMessages:
            identityObj.usageStats.messagesSent +
            identityObj.usageStats.messagesReceived,
          lastUsed: identityObj.usageStats.lastUsedAt,
        };
      });

      // Get total count
      const totalCount = await UserMessageIdentity.countDocuments(query);

      res.json({
        success: true,
        identities: identitiesWithDetails,
        pagination: {
          total: totalCount,
          limit: parseInt(limit),
          skip: parseInt(skip),
          hasMore: parseInt(skip) + identitiesWithDetails.length < totalCount,
          currentPage: Math.floor(parseInt(skip) / parseInt(limit)) + 1,
          totalPages: Math.ceil(totalCount / parseInt(limit)),
        },
      });
    } catch (error) {
      console.error("Error getting user identities:", error);
      res.status(500).json({
        success: false,
        error: "Internal server error",
      });
    }
  }

  /**
   * Validation for setting default identity
   */
  static setDefaultIdentityValidation = [
    param("identityId").isMongoId().withMessage("Invalid identity ID"),
  ];

  /**
   * Set default identity for user
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async setDefaultIdentity(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: "Validation failed",
          details: errors.array(),
        });
      }

      const { identityId } = req.params;
      const userId = req.user.id;

      const identity = await UserMessageIdentity.findById(identityId);
      if (!identity) {
        throw new APIError("Identity not found", 404);
      }

      // Check ownership
      if (identity.user.toString() !== userId) {
        throw new APIError("Access denied", 403);
      }

      // Check if identity is usable
      if (!identity.isUsable()) {
        throw new APIError("Identity is not usable (expired or inactive)", 400);
      }

      // Set as default
      await identity.setAsDefault();

      res.json({
        success: true,
        identity: {
          _id: identity._id,
          messageAlias: identity.messageAlias,
          displayName: identity.displayName,
          isDefault: true,
        },
        message: "Default identity updated successfully",
      });
    } catch (error) {
      console.error("Error setting default identity:", error);
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
   * Validation for updating auto-delete settings
   */
  static updateAutoDeleteSettingsValidation = [
    param("identityId").isMongoId().withMessage("Invalid identity ID"),
    body("enabled").isBoolean().withMessage("Enabled must be boolean"),
    body("preset")
      .optional()
      .isIn(["1_day", "1_week", "1_month", "custom"])
      .withMessage("Invalid preset value"),
    body("customDays")
      .optional()
      .isInt({ min: 1, max: 365 })
      .withMessage("Custom days must be between 1 and 365"),
  ];

  /**
   * Update auto-delete settings for identity
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async updateAutoDeleteSettings(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: "Validation failed",
          details: errors.array(),
        });
      }

      const { identityId } = req.params;
      const { enabled, preset, customDays } = req.body;
      const userId = req.user.id;

      const identity = await UserMessageIdentity.findById(identityId);
      if (!identity) {
        throw new APIError("Identity not found", 404);
      }

      // Check ownership
      if (identity.user.toString() !== userId) {
        throw new APIError("Access denied", 403);
      }

      // Validate custom days when preset is custom
      if (enabled && preset === "custom" && !customDays) {
        throw new APIError("Custom days required when preset is custom", 400);
      }

      // Validate auto-delete vs expiry date logic
      if (enabled && identity.expiresAt) {
        const presetToDays = {
          "1_day": 1,
          "1_week": 7,
          "1_month": 30,
          custom: customDays || 0,
        };

        const autoDeleteDays = presetToDays[preset] || 0;
        const expiryDate = identity.expiresAt;
        const autoDeleteDate = new Date(
          Date.now() + autoDeleteDays * 24 * 60 * 60 * 1000
        );

        if (autoDeleteDate > expiryDate) {
          throw new APIError(
            `Auto-delete date (${autoDeleteDate.toISOString().split("T")[0]}) cannot be after identity expiry date (${expiryDate.toISOString().split("T")[0]}). ` +
              `Identity will expire before auto-delete takes effect. Consider extending expiry date or reducing auto-delete duration.`,
            400
          );
        }

        // Calculate and warn about close dates
        const daysDifference = Math.ceil(
          (expiryDate - autoDeleteDate) / (24 * 60 * 60 * 1000)
        );
        if (daysDifference <= 1 && daysDifference > 0) {
          console.warn(
            `Auto-delete date is very close to expiry date for identity ${identityId}: ${daysDifference} day(s) difference`
          );
        }
      }

      // Update auto-delete settings
      const settings = { enabled, preset, customDays };
      await identity.updateAutoDeleteSettings(settings);

      // Get updated settings in user-friendly format
      const updatedSettings = identity.getAutoDeleteSettings();

      res.json({
        success: true,
        autoDeleteSettings: updatedSettings,
        message: "Auto-delete settings updated successfully",
      });
    } catch (error) {
      console.error("Error updating auto-delete settings:", error);
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
   * Validation for updating forwarding preferences
   */
  static updateForwardingPreferencesValidation = [
    param("identityId").isMongoId().withMessage("Invalid identity ID"),
    body("defaultAttribution")
      .optional()
      .isIn(["show_original", "show_immediate", "hide_all", "anonymous"])
      .withMessage("Invalid default attribution value"),
    body("allowOthersToForward")
      .optional()
      .isBoolean()
      .withMessage("allowOthersToForward must be boolean"),
    body("requireAttribution")
      .optional()
      .isBoolean()
      .withMessage("requireAttribution must be boolean"),
    body("maxForwardChain")
      .optional()
      .isInt({ min: 1, max: 50 })
      .withMessage("maxForwardChain must be between 1 and 50"),
    body("forwardToPublicChannels")
      .optional()
      .isBoolean()
      .withMessage("forwardToPublicChannels must be boolean"),
  ];

  /**
   * Update forwarding preferences for identity
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async updateForwardingPreferences(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: "Validation failed",
          details: errors.array(),
        });
      }

      const { identityId } = req.params;
      const preferences = req.body;
      const userId = req.user.id;

      const identity = await UserMessageIdentity.findById(identityId);
      if (!identity) {
        throw new APIError("Identity not found", 404);
      }

      // Check ownership
      if (identity.user.toString() !== userId) {
        throw new APIError("Access denied", 403);
      }

      // Update forwarding preferences
      await identity.updateForwardingPreferences(preferences);

      // Get updated preferences in user-friendly format
      const updatedPreferences = identity.getForwardingPreferences();

      res.json({
        success: true,
        forwardingPreferences: updatedPreferences,
        message: "Forwarding preferences updated successfully",
      });
    } catch (error) {
      console.error("Error updating forwarding preferences:", error);
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
   * Validation for getting auto-delete settings
   */
  static getAutoDeleteSettingsValidation = [
    param("identityId").isMongoId().withMessage("Invalid identity ID"),
  ];

  /**
   * Get auto-delete settings for identity
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async getAutoDeleteSettings(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: "Validation failed",
          details: errors.array(),
        });
      }

      const { identityId } = req.params;
      const userId = req.user.id;

      const identity = await UserMessageIdentity.findById(identityId);
      if (!identity) {
        throw new APIError("Identity not found", 404);
      }

      // Check ownership
      if (identity.user.toString() !== userId) {
        throw new APIError("Access denied", 403);
      }

      const autoDeleteSettings = identity.getAutoDeleteSettings();

      res.json({
        success: true,
        autoDeleteSettings: autoDeleteSettings,
      });
    } catch (error) {
      console.error("Error getting auto-delete settings:", error);
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
   * Validation for getting forwarding preferences
   */
  static getForwardingPreferencesValidation = [
    param("identityId").isMongoId().withMessage("Invalid identity ID"),
  ];

  /**
   * Get forwarding preferences for identity
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async getForwardingPreferences(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: "Validation failed",
          details: errors.array(),
        });
      }

      const { identityId } = req.params;
      const userId = req.user.id;

      const identity = await UserMessageIdentity.findById(identityId);
      if (!identity) {
        throw new APIError("Identity not found", 404);
      }

      // Check ownership
      if (identity.user.toString() !== userId) {
        throw new APIError("Access denied", 403);
      }

      const forwardingPreferences = identity.getForwardingPreferences();

      res.json({
        success: true,
        forwardingPreferences: forwardingPreferences,
      });
    } catch (error) {
      console.error("Error getting forwarding preferences:", error);
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
   * Update identity details (alias, display name, avatar)
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async updateIdentity(req, res) {
    try {
      const { identityId } = req.params;
      const { displayName, avatar, expiresAt } = req.body;
      const userId = req.user.id;

      if (!mongoose.Types.ObjectId.isValid(identityId)) {
        throw new APIError("Invalid identity ID", 400);
      }

      const identity = await UserMessageIdentity.findById(identityId);
      if (!identity) {
        throw new APIError("Identity not found", 404);
      }

      // Check ownership
      if (identity.user.toString() !== userId) {
        throw new APIError("Access denied", 403);
      }

      // Validate inputs
      if (displayName !== undefined) {
        if (
          !displayName ||
          displayName.trim().length === 0 ||
          displayName.length > 100
        ) {
          throw new APIError("Display name must be 1-100 characters", 400);
        }
        identity.displayName = displayName.trim();
      }

      if (avatar !== undefined) {
        if (avatar && !isValidURL(avatar)) {
          throw new APIError("Avatar must be a valid URL", 400);
        }
        identity.avatar = avatar;
      }

      if (expiresAt !== undefined) {
        if (expiresAt && new Date(expiresAt) <= new Date()) {
          throw new APIError("Expiry date must be in the future", 400);
        }

        // Validate against existing auto-delete settings
        if (expiresAt && identity.privacySettings.autoDeleteSettings.enabled) {
          const autoDeleteDays =
            identity.privacySettings.autoDeleteSettings.effectiveDays;
          if (autoDeleteDays > 0) {
            const newExpiryDate = new Date(expiresAt);
            const autoDeleteDate = new Date(
              Date.now() + autoDeleteDays * 24 * 60 * 60 * 1000
            );

            if (autoDeleteDate > newExpiryDate) {
              throw new APIError(
                `Cannot set expiry date (${newExpiryDate.toISOString().split("T")[0]}) before auto-delete date (${autoDeleteDate.toISOString().split("T")[0]}). ` +
                  `Auto-delete is currently set to ${autoDeleteDays} days. Please disable auto-delete or extend expiry date.`,
                400
              );
            }
          }
        }

        identity.expiresAt = expiresAt ? new Date(expiresAt) : null;
      }

      await identity.save();

      res.json({
        success: true,
        identity: {
          _id: identity._id,
          messageAlias: identity.messageAlias,
          displayName: identity.displayName,
          avatar: identity.avatar,
          expiresAt: identity.expiresAt,
          isDefault: identity.isDefault,
          isActive: identity.isActive,
        },
        message: "Identity updated successfully",
      });
    } catch (error) {
      console.error("Error updating identity:", error);
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
   * Archive/Delete identity
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async archiveIdentity(req, res) {
    try {
      const { identityId } = req.params;
      const { archive = true } = req.body;
      const userId = req.user.id;

      if (!mongoose.Types.ObjectId.isValid(identityId)) {
        throw new APIError("Invalid identity ID", 400);
      }

      const identity = await UserMessageIdentity.findById(identityId);
      if (!identity) {
        throw new APIError("Identity not found", 404);
      }

      // Check ownership
      if (identity.user.toString() !== userId) {
        throw new APIError("Access denied", 403);
      }

      // Cannot archive default identity if user has other active identities
      if (identity.isDefault && archive) {
        const otherActiveIdentities = await UserMessageIdentity.countDocuments({
          user: userId,
          _id: { $ne: identityId },
          isActive: true,
          isDeleted: false,
        });

        if (otherActiveIdentities > 0) {
          throw new APIError(
            "Cannot archive default identity. Set another identity as default first.",
            400
          );
        }
      }

      // Update archive status
      if (archive) {
        identity.isArchived = true;
        identity.isActive = false;
      } else {
        identity.isArchived = false;
        identity.isActive = true;
      }

      await identity.save();

      res.json({
        success: true,
        message: archive
          ? "Identity archived successfully"
          : "Identity restored successfully",
      });
    } catch (error) {
      console.error("Error archiving identity:", error);
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
   * Get identity usage statistics
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async getIdentityStats(req, res) {
    try {
      const { identityId } = req.params;
      const userId = req.user.id;
      const { startDate, endDate } = req.query;

      if (!mongoose.Types.ObjectId.isValid(identityId)) {
        throw new APIError("Invalid identity ID", 400);
      }

      const identity = await UserMessageIdentity.findById(identityId);
      if (!identity) {
        throw new APIError("Identity not found", 404);
      }

      // Check ownership
      if (identity.user.toString() !== userId) {
        throw new APIError("Access denied", 403);
      }

      // Build date filter
      const dateFilter = {};
      if (startDate) dateFilter.$gte = new Date(startDate);
      if (endDate) dateFilter.$lte = new Date(endDate);

      // Get message statistics
      const messageStats = await DirectMessage.aggregate([
        {
          $match: {
            senderIdentity: mongoose.Types.ObjectId(identityId),
            isDeleted: false,
            ...(Object.keys(dateFilter).length > 0 && { sentAt: dateFilter }),
          },
        },
        {
          $group: {
            _id: null,
            totalMessages: { $sum: 1 },
            totalReactions: { $sum: { $size: "$reactions" } },
            messageTypes: { $push: "$messageType" },
            conversationsUsed: { $addToSet: "$conversation" },
          },
        },
        {
          $addFields: {
            uniqueConversations: { $size: "$conversationsUsed" },
            messageTypeCount: {
              $reduce: {
                input: "$messageTypes",
                initialValue: {},
                in: {
                  $mergeObjects: [
                    "$value",
                    {
                      $arrayToObject: [
                        [
                          {
                            k: "$this",
                            v: {
                              $add: [
                                {
                                  $ifNull: [
                                    {
                                      $getField: {
                                        field: "$this",
                                        input: "$value",
                                      },
                                    },
                                    0,
                                  ],
                                },
                                1,
                              ],
                            },
                          },
                        ],
                      ],
                    },
                  ],
                },
              },
            },
          },
        },
      ]);

      // Get conversations where this identity is used
      const conversationStats = await ConversationParticipant.aggregate([
        {
          $match: {
            identity: mongoose.Types.ObjectId(identityId),
            leftAt: { $exists: false },
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
          $unwind: "$conversationDetails",
        },
        {
          $group: {
            _id: "$conversationDetails.conversationType",
            count: { $sum: 1 },
          },
        },
      ]);

      const stats = messageStats[0] || {
        totalMessages: 0,
        totalReactions: 0,
        messageTypeCount: {},
        uniqueConversations: 0,
      };

      const conversationBreakdown = conversationStats.reduce((acc, stat) => {
        acc[stat._id] = stat.count;
        return acc;
      }, {});

      res.json({
        success: true,
        stats: {
          identity: {
            _id: identity._id,
            messageAlias: identity.messageAlias,
            displayName: identity.displayName,
            createdAt: identity.createdAt,
            lastUsed: identity.usageStats.lastUsedAt,
          },
          usage: {
            totalMessages: stats.totalMessages,
            totalReactions: stats.totalReactions,
            uniqueConversations: stats.uniqueConversations,
            messageTypeBreakdown: stats.messageTypeCount,
            conversationTypeBreakdown: conversationBreakdown,
          },
          storedStats: identity.usageStats,
        },
      });
    } catch (error) {
      console.error("Error getting identity stats:", error);
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
   * Validation for cloning identity
   */
  static cloneIdentityValidation = [
    param("identityId").isMongoId().withMessage("Invalid identity ID"),
    body("messageAlias")
      .isLength({ min: 2, max: 50 })
      .trim()
      .withMessage("Message alias must be 2-50 characters")
      .matches(/^[a-zA-Z0-9_-]+$/)
      .withMessage(
        "Message alias can only contain letters, numbers, underscores, and hyphens"
      ),
    body("displayName")
      .optional()
      .isLength({ min: 1, max: 100 })
      .trim()
      .withMessage("Display name must be 1-100 characters"),
    body("copySettings")
      .optional()
      .isBoolean()
      .withMessage("Copy settings must be boolean"),
  ];

  /**
   * Clone an existing identity with new alias
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async cloneIdentity(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: "Validation failed",
          details: errors.array(),
        });
      }

      const { identityId } = req.params;
      const { messageAlias, displayName, copySettings = true } = req.body;
      const userId = req.user.id;

      const sourceIdentity = await UserMessageIdentity.findById(identityId);
      if (!sourceIdentity) {
        throw new APIError("Source identity not found", 404);
      }

      // Check ownership
      if (sourceIdentity.user.toString() !== userId) {
        throw new APIError("Access denied", 403);
      }

      // Check if new alias is available
      const existingAlias = await UserMessageIdentity.findOne({
        user: userId,
        messageAlias: messageAlias.toLowerCase(),
        isDeleted: false,
      });

      if (existingAlias) {
        throw new APIError("Message alias already exists", 400);
      }

      // Check identity limit
      const identityCount = await UserMessageIdentity.countDocuments({
        user: userId,
        isDeleted: false,
      });

      if (identityCount >= 10) {
        throw new APIError("Maximum number of identities reached (10)", 400);
      }

      // Create cloned identity
      const clonedIdentityData = {
        user: userId,
        messageAlias: messageAlias.toLowerCase().trim(),
        displayName: displayName || messageAlias,
        avatar: sourceIdentity.avatar,
        isDefault: false,
        privacySettings: copySettings
          ? { ...sourceIdentity.privacySettings }
          : {
              allowStrangers: true,
              allowMessageRequests: true,
              autoDeleteSettings: {
                enabled: false,
                preset: null,
                customDays: null,
                effectiveDays: 0,
              },
              readReceiptsEnabled: true,
              typingIndicators: true,
              onlineStatus: true,
            },
        forwardingPreferences: copySettings
          ? { ...sourceIdentity.forwardingPreferences }
          : {
              defaultAttribution: "show_original",
              allowOthersToForward: true,
              requireAttribution: false,
              maxForwardChain: 10,
              forwardToPublicChannels: false,
            },
      };

      const clonedIdentity = new UserMessageIdentity(clonedIdentityData);
      await clonedIdentity.save();
      res.status(201).json({
        success: true,
        identity: {
          _id: clonedIdentity._id,
          messageAlias: clonedIdentity.messageAlias,
          displayName: clonedIdentity.displayName,
          avatar: clonedIdentity.avatar,
          isDefault: clonedIdentity.isDefault,
          privacySettings: clonedIdentity.privacySettings,
          forwardingPreferences: clonedIdentity.forwardingPreferences,
          createdAt: clonedIdentity.createdAt,
        },
        sourceIdentity: sourceIdentity.messageAlias,
        settingsCopied: copySettings,
        message: "Identity cloned successfully",
      });
    } catch (error) {
      console.error("Error cloning identity:", error);
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
   * Bulk update privacy settings for multiple identities
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async bulkUpdatePrivacySettings(req, res) {
    try {
      const { identityIds, privacySettings } = req.body;
      const userId = req.user.id;

      if (!Array.isArray(identityIds) || identityIds.length === 0) {
        throw new APIError("Identity IDs must be a non-empty array", 400);
      }

      if (identityIds.length > 10) {
        throw new APIError(
          "Cannot update more than 10 identities at once",
          400
        );
      }

      // Validate all identity IDs and ownership
      const identities = await UserMessageIdentity.find({
        _id: { $in: identityIds },
        user: userId,
        isDeleted: false,
      });

      if (identities.length !== identityIds.length) {
        throw new APIError(
          "One or more identities not found or access denied",
          404
        );
      }

      // Update privacy settings for all identities
      const updatePromises = identities.map(async (identity) => {
        if (privacySettings.allowStrangers !== undefined) {
          identity.privacySettings.allowStrangers =
            privacySettings.allowStrangers;
        }
        if (privacySettings.allowMessageRequests !== undefined) {
          identity.privacySettings.allowMessageRequests =
            privacySettings.allowMessageRequests;
        }
        if (privacySettings.readReceiptsEnabled !== undefined) {
          identity.privacySettings.readReceiptsEnabled =
            privacySettings.readReceiptsEnabled;
        }
        if (privacySettings.typingIndicators !== undefined) {
          identity.privacySettings.typingIndicators =
            privacySettings.typingIndicators;
        }
        if (privacySettings.onlineStatus !== undefined) {
          identity.privacySettings.onlineStatus = privacySettings.onlineStatus;
        }

        return identity.save();
      });

      await Promise.all(updatePromises);

      res.json({
        success: true,
        updatedCount: identities.length,
        identities: identities.map((identity) => ({
          _id: identity._id,
          messageAlias: identity.messageAlias,
          privacySettings: identity.privacySettings,
        })),
        message: "Privacy settings updated for all identities",
      });
    } catch (error) {
      console.error("Error bulk updating privacy settings:", error);
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
   * Export identities data for backup/migration
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async exportIdentities(req, res) {
    try {
      const userId = req.user.id;
      const { includeStats = false, format = "json" } = req.query;

      const identities = await UserMessageIdentity.find({
        user: userId,
        isDeleted: false,
      })
        .select("-__v -user")
        .sort({ isDefault: -1, createdAt: -1 });

      let exportData = identities.map((identity) => {
        const data = {
          messageAlias: identity.messageAlias,
          displayName: identity.displayName,
          avatar: identity.avatar,
          isDefault: identity.isDefault,
          isActive: identity.isActive,
          expiresAt: identity.expiresAt,
          privacySettings: identity.privacySettings,
          forwardingPreferences: identity.forwardingPreferences,
          createdAt: identity.createdAt,
          isArchived: identity.isArchived,
        };

        if (includeStats === "true") {
          data.usageStats = identity.usageStats;
        }

        return data;
      });

      const exportMetadata = {
        exportedAt: new Date(),
        userId: userId,
        totalIdentities: identities.length,
        activeIdentities: identities.filter((i) => i.isActive).length,
        defaultIdentity:
          identities.find((i) => i.isDefault)?.messageAlias || null,
        version: "1.0",
      };

      const fullExport = {
        metadata: exportMetadata,
        identities: exportData,
      };

      if (format === "csv") {
        // Convert to CSV format for spreadsheet import
        const csvHeaders = [
          "messageAlias",
          "displayName",
          "isDefault",
          "isActive",
          "allowStrangers",
          "allowMessageRequests",
          "autoDeleteEnabled",
          "readReceipts",
          "typingIndicators",
          "createdAt",
        ];

        const csvData = exportData.map((identity) => [
          identity.messageAlias,
          identity.displayName,
          identity.isDefault,
          identity.isActive,
          identity.privacySettings.allowStrangers,
          identity.privacySettings.allowMessageRequests,
          identity.privacySettings.autoDeleteSettings.enabled,
          identity.privacySettings.readReceiptsEnabled,
          identity.privacySettings.typingIndicators,
          identity.createdAt,
        ]);

        const csvContent = [csvHeaders, ...csvData]
          .map((row) => row.map((field) => `"${field}"`).join(","))
          .join("\n");

        res.setHeader("Content-Type", "text/csv");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename=identities-export-${Date.now()}.csv`
        );
        return res.send(csvContent);
      }

      res.setHeader("Content-Type", "application/json");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename=identities-export-${Date.now()}.json`
      );
      res.json(fullExport);
    } catch (error) {
      console.error("Error exporting identities:", error);
      res.status(500).json({
        success: false,
        error: "Internal server error",
      });
    }
  }

  /**
   * Search identities by alias or display name
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async searchIdentities(req, res) {
    try {
      const userId = req.user.id;
      const {
        query,
        limit = 20,
        skip = 0,
        includeInactive = false,
      } = req.query;

      if (!query || query.trim().length < 2) {
        throw new APIError("Search query must be at least 2 characters", 400);
      }

      const searchRegex = new RegExp(query.trim(), "i");

      const searchQuery = {
        user: userId,
        isDeleted: false,
        $or: [{ messageAlias: searchRegex }, { displayName: searchRegex }],
      };

      if (!includeInactive) {
        searchQuery.isActive = true;
      }

      const identities = await UserMessageIdentity.find(searchQuery)
        .sort({ isDefault: -1, "usageStats.lastUsedAt": -1 })
        .skip(parseInt(skip))
        .limit(parseInt(limit))
        .select("-__v");

      const totalCount = await UserMessageIdentity.countDocuments(searchQuery);

      res.json({
        success: true,
        identities: identities.map((identity) => ({
          _id: identity._id,
          messageAlias: identity.messageAlias,
          displayName: identity.displayName,
          avatar: identity.avatar,
          isDefault: identity.isDefault,
          isActive: identity.isActive,
          lastUsed: identity.usageStats.lastUsedAt,
          messageCount: identity.usageStats.messagesSent,
        })),
        searchQuery: query,
        pagination: {
          total: totalCount,
          limit: parseInt(limit),
          skip: parseInt(skip),
          hasMore: parseInt(skip) + identities.length < totalCount,
        },
      });
    } catch (error) {
      console.error("Error searching identities:", error);
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
   * Get identity usage timeline
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async getIdentityTimeline(req, res) {
    try {
      const { identityId } = req.params;
      const userId = req.user.id;
      const { days = 30, granularity = "day" } = req.query;

      if (!mongoose.Types.ObjectId.isValid(identityId)) {
        throw new APIError("Invalid identity ID", 400);
      }

      const identity = await UserMessageIdentity.findById(identityId);
      if (!identity || identity.user.toString() !== userId) {
        throw new APIError("Identity not found or access denied", 404);
      }

      const daysInt = Math.min(parseInt(days), 365); // Max 1 year
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - daysInt);

      // Build aggregation based on granularity
      let dateFormat;
      switch (granularity) {
        case "hour":
          dateFormat = "%Y-%m-%d-%H";
          break;
        case "day":
          dateFormat = "%Y-%m-%d";
          break;
        case "week":
          dateFormat = "%Y-%U";
          break;
        case "month":
          dateFormat = "%Y-%m";
          break;
        default:
          dateFormat = "%Y-%m-%d";
      }

      const timeline = await DirectMessage.aggregate([
        {
          $match: {
            senderIdentity: mongoose.Types.ObjectId(identityId),
            sentAt: { $gte: startDate },
            isDeleted: false,
          },
        },
        {
          $group: {
            _id: {
              $dateToString: { format: dateFormat, date: "$sentAt" },
            },
            messageCount: { $sum: 1 },
            reactionCount: { $sum: { $size: "$reactions" } },
            messageTypes: { $push: "$messageType" },
            conversations: { $addToSet: "$conversation" },
          },
        },
        {
          $addFields: {
            conversationCount: { $size: "$conversations" },
            date: "$_id",
          },
        },
        {
          $sort: { _id: 1 },
        },
      ]);

      res.json({
        success: true,
        timeline: timeline,
        metadata: {
          identityId: identityId,
          identityAlias: identity.messageAlias,
          period: `${daysInt} days`,
          granularity: granularity,
          totalDataPoints: timeline.length,
          startDate: startDate,
          endDate: new Date(),
        },
      });
    } catch (error) {
      console.error("Error getting identity timeline:", error);
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
   * Validate identity alias availability
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async checkAliasAvailability(req, res) {
    try {
      const { alias } = req.params;
      const userId = req.user.id;

      if (!alias || alias.length < 2 || alias.length > 50) {
        throw new APIError("Alias must be 2-50 characters", 400);
      }

      if (!/^[a-zA-Z0-9_-]+$/.test(alias)) {
        throw new APIError(
          "Alias can only contain letters, numbers, underscores, and hyphens",
          400
        );
      }

      const existingIdentity = await UserMessageIdentity.findOne({
        user: userId,
        messageAlias: alias.toLowerCase(),
        isDeleted: false,
      });

      const isAvailable = !existingIdentity;

      res.json({
        success: true,
        alias: alias.toLowerCase(),
        available: isAvailable,
        message: isAvailable
          ? "Alias is available"
          : "Alias is already in use by another identity",
      });
    } catch (error) {
      console.error("Error checking alias availability:", error);
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
   * Set identity protection status (protected identities get soft delete + restore)
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async setIdentityProtection(req, res) {
    try {
      const { identityId } = req.params;
      const { isProtected } = req.body;
      const userId = req.user.id;

      if (!mongoose.Types.ObjectId.isValid(identityId)) {
        throw new APIError("Invalid identity ID", 400);
      }

      const identity = await UserMessageIdentity.findById(identityId);
      if (!identity || identity.user.toString() !== userId) {
        throw new APIError("Identity not found or access denied", 404);
      }

      if (identity.isDefault && !isProtected) {
        throw new APIError("Default identity cannot be unprotected", 400);
      }

      if (isProtected) {
        // Check if we already have 3 protected identities
        const protectedCount = await UserMessageIdentity.countDocuments({
          user: userId,
          isProtected: true,
          isDeleted: false,
        });

        if (protectedCount >= 3 && !identity.isProtected) {
          throw new APIError(
            "Maximum of 3 identities can be protected. Unprotect another identity first.",
            400
          );
        }

        identity.isProtected = true;
      } else {
        identity.isProtected = false;
      }

      await identity.save();

      res.json({
        success: true,
        identity: {
          _id: identity._id,
          messageAlias: identity.messageAlias,
          isDefault: identity.isDefault,
          isProtected: identity.isProtected,
        },
        message: isProtected
          ? "Identity is now protected"
          : "Identity protection removed",
      });
    } catch (error) {
      console.error("Error setting identity protection:", error);
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
   * Get protected identities and protection status
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async getProtectionStatus(req, res) {
    try {
      const userId = req.user.id;

      const allIdentities = await UserMessageIdentity.find({
        user: userId,
        isDeleted: false,
      }).select(
        "messageAlias displayName isDefault isProtected usageStats createdAt"
      );

      const protectedIdentities = allIdentities.filter(
        (identity) => identity.isProtected
      );
      const unprotectedIdentities = allIdentities.filter(
        (identity) => !identity.isProtected
      );

      const protectionStatus = {
        summary: {
          totalIdentities: allIdentities.length,
          protectedSlots: {
            used: protectedIdentities.length,
            available: Math.max(0, 3 - protectedIdentities.length),
            maximum: 3,
          },
        },
        protectedIdentities: protectedIdentities.map((identity) => ({
          _id: identity._id,
          messageAlias: identity.messageAlias,
          displayName: identity.displayName,
          isDefault: identity.isDefault,
          protectionType: identity.isDefault ? "default" : "user_selected",
          usageStats: {
            messagesSent: identity.usageStats.messagesSent,
            lastUsed: identity.usageStats.lastUsedAt,
          },
        })),
        unprotectedIdentities: unprotectedIdentities.map((identity) => ({
          _id: identity._id,
          messageAlias: identity.messageAlias,
          displayName: identity.displayName,
          canProtect: protectedIdentities.length < 3,
          usageStats: {
            messagesSent: identity.usageStats.messagesSent,
            lastUsed: identity.usageStats.lastUsedAt,
          },
        })),
        recommendations: [],
      };

      // Add recommendations for protection
      if (protectedIdentities.length < 3 && unprotectedIdentities.length > 0) {
        const topUnprotected = unprotectedIdentities
          .sort((a, b) => b.usageStats.messagesSent - a.usageStats.messagesSent)
          .slice(0, 3 - protectedIdentities.length);

        protectionStatus.recommendations = topUnprotected.map((identity) => ({
          _id: identity._id,
          messageAlias: identity.messageAlias,
          reason: `High usage (${identity.usageStats.messagesSent} messages sent)`,
          priority: identity.usageStats.messagesSent > 100 ? "high" : "medium",
        }));
      }

      res.json({
        success: true,
        protectionStatus: protectionStatus,
      });
    } catch (error) {
      console.error("Error getting protection status:", error);
      res.status(500).json({
        success: false,
        error: "Internal server error",
      });
    }
  }

  /**
   * Delete identity with tiered protection system
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async deleteIdentity(req, res) {
    try {
      const { identityId } = req.params;
      const { permanent = false, force = false } = req.body;
      const userId = req.user.id;

      if (!mongoose.Types.ObjectId.isValid(identityId)) {
        throw new APIError("Invalid identity ID", 400);
      }

      const identity = await UserMessageIdentity.findById(identityId);
      if (!identity) {
        throw new APIError("Identity not found", 404);
      }

      // Check ownership
      if (identity.user.toString() !== userId) {
        throw new APIError("Access denied", 403);
      }

      // Check if identity is being used in active conversations
      const activeUsage = await ConversationParticipant.countDocuments({
        identity: identityId,
        leftAt: { $exists: false },
      });

      if (activeUsage > 0 && !force) {
        throw new APIError(
          `Identity is being used in ${activeUsage} active conversations. Use force=true to delete anyway.`,
          400
        );
      }

      // Determine protection status
      const isProtected = identity.isProtected || identity.isDefault;

      if (isProtected) {
        // PROTECTED IDENTITIES: Only soft delete allowed
        if (permanent) {
          throw new APIError(
            `Protected identity cannot be permanently deleted. ${identity.isDefault ? "Default identities" : "Protected identities"} can only be soft deleted for recovery purposes.`,
            400
          );
        }

        // Handle default identity replacement
        if (identity.isDefault) {
          const otherIdentities = await UserMessageIdentity.countDocuments({
            user: userId,
            _id: { $ne: identityId },
            isDeleted: false,
          });

          if (otherIdentities > 0 && !force) {
            throw new APIError(
              "Cannot delete default identity. Set another identity as default first, or use force=true.",
              400
            );
          }
        }

        // Soft delete the protected identity
        identity.isDeleted = true;
        identity.isActive = false;
        identity.deletedAt = new Date();
        identity.deletionReason = identity.isDefault
          ? "default_identity_deleted"
          : "protected_identity_deleted";
        await identity.save();

        // Set another identity as default if needed
        let replacementDefault = null;
        if (identity.isDefault) {
          const nextIdentity = await UserMessageIdentity.findOne({
            user: userId,
            _id: { $ne: identityId },
            isDeleted: false,
            isActive: true,
          }).sort([
            ["isProtected", -1],
            ["usageStats.messagesSent", -1],
          ]); // Prefer protected, then high usage

          if (nextIdentity) {
            await nextIdentity.setAsDefault();
            replacementDefault = nextIdentity.messageAlias;
          }
        }

        res.json({
          success: true,
          deletionType: "soft",
          protectionLevel: identity.isDefault ? "default" : "protected",
          message: `${identity.isDefault ? "Default" : "Protected"} identity soft deleted successfully (can be restored)`,
          replacementDefault: replacementDefault,
          restorable: true,
        });
      } else {
        // UNPROTECTED IDENTITIES: Allow both soft and permanent deletion
        if (permanent) {
          // Permanent deletion for unprotected identities
          const session = await mongoose.startSession();

          try {
            await session.withTransaction(async () => {
              // Update conversation participants
              await ConversationParticipant.updateMany(
                { identity: identityId },
                {
                  $unset: { identity: 1 },
                  identityDeleted: true,
                  identityDeletedAt: new Date(),
                  deletedIdentityAlias: identity.messageAlias,
                },
                { session }
              );

              // Update messages
              await DirectMessage.updateMany(
                { senderIdentity: identityId },
                {
                  senderIdentityDeleted: true,
                  senderIdentityDeletedAt: new Date(),
                  deletedSenderAlias: identity.messageAlias,
                },
                { session }
              );

              // Create audit log if model exists
              try {
                const AuditLog = mongoose.model("AuditLog");
                await AuditLog.create(
                  [
                    {
                      action: "IDENTITY_PERMANENT_DELETE",
                      user: userId,
                      resourceType: "UserMessageIdentity",
                      resourceId: identityId,
                      metadata: {
                        messageAlias: identity.messageAlias,
                        displayName: identity.displayName,
                        wasProtected: false,
                        usageStats: identity.usageStats,
                        deletedAt: new Date(),
                      },
                    },
                  ],
                  { session }
                );
              } catch (auditError) {
                // Continue if audit log model doesn't exist
                console.warn("Audit log creation failed:", auditError.message);
              }

              // Permanently delete the identity
              await UserMessageIdentity.findByIdAndDelete(identityId, {
                session,
              });
            });

            res.json({
              success: true,
              deletionType: "permanent",
              protectionLevel: "unprotected",
              message: "Unprotected identity permanently deleted",
              warning: "This action cannot be undone",
              restorable: false,
            });
          } finally {
            await session.endSession();
          }
        } else {
          // Soft delete for unprotected identity
          identity.isDeleted = true;
          identity.isActive = false;
          identity.deletedAt = new Date();
          identity.deletionReason = "unprotected_identity_soft_deleted";
          await identity.save();

          res.json({
            success: true,
            deletionType: "soft",
            protectionLevel: "unprotected",
            message:
              "Unprotected identity soft deleted successfully (can be restored)",
            restorable: true,
          });
        }
      }
    } catch (error) {
      console.error("Error deleting identity:", error);
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
   * Permanently delete identity (only for non-default identities)
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async permanentlyDeleteIdentity(req, res) {
    try {
      const { identityId } = req.params;
      const { confirmMessage } = req.body;
      const userId = req.user.id;

      if (!mongoose.Types.ObjectId.isValid(identityId)) {
        throw new APIError("Invalid identity ID", 400);
      }

      const identity = await UserMessageIdentity.findById(identityId);
      if (!identity) {
        throw new APIError("Identity not found", 404);
      }

      // Check ownership
      if (identity.user.toString() !== userId) {
        throw new APIError("Access denied", 403);
      }

      // Prevent permanent deletion of default identity
      if (identity.isDefault) {
        throw new APIError(
          "Default identity cannot be permanently deleted. Use soft delete instead.",
          400
        );
      }

      // Require confirmation message
      const expectedMessage = `DELETE ${identity.messageAlias}`;
      if (confirmMessage !== expectedMessage) {
        throw new APIError(
          `Confirmation required. Please send: "${expectedMessage}" in confirmMessage field.`,
          400
        );
      }

      // Check if identity is being used in active conversations
      const activeUsage = await ConversationParticipant.countDocuments({
        identity: identityId,
        leftAt: { $exists: false },
      });

      if (activeUsage > 0) {
        throw new APIError(
          `Cannot permanently delete: Identity is being used in ${activeUsage} active conversations. Remove from conversations first.`,
          400
        );
      }

      // Start transaction for data consistency
      const session = await mongoose.startSession();

      try {
        await session.withTransaction(async () => {
          // Update conversation participants (mark identity as deleted)
          await ConversationParticipant.updateMany(
            { identity: identityId },
            {
              $unset: { identity: 1 },
              identityDeleted: true,
              identityDeletedAt: new Date(),
              deletedIdentityAlias: identity.messageAlias,
            },
            { session }
          );

          // Update messages (preserve for audit trail but mark sender identity as deleted)
          await DirectMessage.updateMany(
            { senderIdentity: identityId },
            {
              senderIdentityDeleted: true,
              senderIdentityDeletedAt: new Date(),
              deletedSenderAlias: identity.messageAlias,
            },
            { session }
          );

          // Create audit log entry
          const AuditLog = mongoose.model("AuditLog");
          await AuditLog.create(
            [
              {
                action: "IDENTITY_PERMANENT_DELETE",
                user: userId,
                resourceType: "UserMessageIdentity",
                resourceId: identityId,
                metadata: {
                  messageAlias: identity.messageAlias,
                  displayName: identity.displayName,
                  usageStats: identity.usageStats,
                  deletedAt: new Date(),
                },
              },
            ],
            { session }
          );

          // Finally, permanently delete the identity
          await UserMessageIdentity.findByIdAndDelete(identityId, { session });
        });

        res.json({
          success: true,
          message: `Identity "${identity.messageAlias}" permanently deleted`,
          warning: "This action cannot be undone",
          auditTrail: "References updated, audit log created",
        });
      } catch (transactionError) {
        throw new APIError(
          "Failed to permanently delete identity. Please try again.",
          500
        );
      } finally {
        await session.endSession();
      }
    } catch (error) {
      console.error("Error permanently deleting identity:", error);
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
   * Restore a soft-deleted identity
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async restoreIdentity(req, res) {
    try {
      const { identityId } = req.params;
      const userId = req.user.id;

      if (!mongoose.Types.ObjectId.isValid(identityId)) {
        throw new APIError("Invalid identity ID", 400);
      }

      const identity = await UserMessageIdentity.findById(identityId);
      if (!identity) {
        throw new APIError("Identity not found", 404);
      }

      // Check ownership
      if (identity.user.toString() !== userId) {
        throw new APIError("Access denied", 403);
      }

      if (!identity.isDeleted) {
        throw new APIError("Identity is not deleted", 400);
      }

      // Check if alias is still available
      const aliasConflict = await UserMessageIdentity.findOne({
        user: userId,
        messageAlias: identity.messageAlias,
        isDeleted: false,
        _id: { $ne: identityId },
      });

      if (aliasConflict) {
        throw new APIError(
          "Cannot restore: alias is now in use by another identity",
          409
        );
      }

      // Check identity limit
      const currentCount = await UserMessageIdentity.countDocuments({
        user: userId,
        isDeleted: false,
      });

      if (currentCount >= 10) {
        throw new APIError(
          "Cannot restore: maximum number of identities reached (10)",
          400
        );
      }

      // Restore the identity
      identity.isDeleted = false;
      identity.isActive = true;
      identity.deletedAt = undefined;
      await identity.save();

      res.json({
        success: true,
        identity: {
          _id: identity._id,
          messageAlias: identity.messageAlias,
          displayName: identity.displayName,
          isDefault: identity.isDefault,
          isActive: identity.isActive,
        },
        message: "Identity restored successfully",
      });
    } catch (error) {
      console.error("Error restoring identity:", error);
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
   * Get deleted identities for potential restoration
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async getDeletedIdentities(req, res) {
    try {
      const userId = req.user.id;
      const { limit = 20, skip = 0 } = req.query;

      const deletedIdentities = await UserMessageIdentity.find({
        user: userId,
        isDeleted: true,
      })
        .select("messageAlias displayName deletedAt createdAt usageStats")
        .sort({ deletedAt: -1 })
        .skip(parseInt(skip))
        .limit(parseInt(limit));

      const totalCount = await UserMessageIdentity.countDocuments({
        user: userId,
        isDeleted: true,
      });

      res.json({
        success: true,
        deletedIdentities: deletedIdentities.map((identity) => ({
          _id: identity._id,
          messageAlias: identity.messageAlias,
          displayName: identity.displayName,
          deletedAt: identity.deletedAt,
          createdAt: identity.createdAt,
          canRestore: true, // Could add logic to check if alias is still available
          messageCount: identity.usageStats.messagesSent,
        })),
        pagination: {
          total: totalCount,
          limit: parseInt(limit),
          skip: parseInt(skip),
          hasMore: parseInt(skip) + deletedIdentities.length < totalCount,
        },
      });
    } catch (error) {
      console.error("Error getting deleted identities:", error);
      res.status(500).json({
        success: false,
        error: "Internal server error",
      });
    }
  }

  /**
   * Import identities from backup/export data
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async importIdentities(req, res) {
    try {
      const { identities, overwriteExisting = false } = req.body;
      const userId = req.user.id;

      if (!Array.isArray(identities) || identities.length === 0) {
        throw new APIError("Identities array is required", 400);
      }

      if (identities.length > 10) {
        throw new APIError("Cannot import more than 10 identities", 400);
      }

      // Check current identity count
      const currentCount = await UserMessageIdentity.countDocuments({
        user: userId,
        isDeleted: false,
      });

      if (currentCount + identities.length > 10) {
        throw new APIError(
          `Cannot import: would exceed maximum limit of 10 identities (current: ${currentCount})`,
          400
        );
      }

      const results = {
        imported: [],
        skipped: [],
        errors: [],
      };

      for (const identityData of identities) {
        try {
          // Validate required fields
          if (!identityData.messageAlias) {
            results.errors.push({
              data: identityData,
              error: "Missing messageAlias",
            });
            continue;
          }

          // Check if alias already exists
          const existingIdentity = await UserMessageIdentity.findOne({
            user: userId,
            messageAlias: identityData.messageAlias.toLowerCase(),
            isDeleted: false,
          });

          if (existingIdentity && !overwriteExisting) {
            results.skipped.push({
              alias: identityData.messageAlias,
              reason: "Alias already exists",
            });
            continue;
          }

          if (existingIdentity && overwriteExisting) {
            // Update existing identity
            Object.assign(existingIdentity, {
              displayName:
                identityData.displayName || existingIdentity.displayName,
              avatar: identityData.avatar || existingIdentity.avatar,
              privacySettings:
                identityData.privacySettings ||
                existingIdentity.privacySettings,
              forwardingPreferences:
                identityData.forwardingPreferences ||
                existingIdentity.forwardingPreferences,
            });
            await existingIdentity.save();
            results.imported.push(existingIdentity.messageAlias);
          } else {
            // Create new identity
            const newIdentity = new UserMessageIdentity({
              user: userId,
              messageAlias: identityData.messageAlias.toLowerCase().trim(),
              displayName:
                identityData.displayName || identityData.messageAlias,
              avatar: identityData.avatar,
              isDefault: false, // Never import as default for safety
              privacySettings: identityData.privacySettings || {},
              forwardingPreferences: identityData.forwardingPreferences || {},
            });
            await newIdentity.save();
            results.imported.push(newIdentity.messageAlias);
          }
        } catch (error) {
          results.errors.push({
            data: identityData,
            error: error.message,
          });
        }
      }

      res.json({
        success: true,
        results: results,
        summary: {
          total: identities.length,
          imported: results.imported.length,
          skipped: results.skipped.length,
          errors: results.errors.length,
        },
        message: `Import completed: ${results.imported.length} imported, ${results.skipped.length} skipped, ${results.errors.length} errors`,
      });
    } catch (error) {
      console.error("Error importing identities:", error);
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
   * Import identities from backup/export data
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async importIdentities(req, res) {
    try {
      const { identities, overwriteExisting = false } = req.body;
      const userId = req.user.id;

      if (!Array.isArray(identities) || identities.length === 0) {
        throw new APIError("Identities array is required", 400);
      }

      if (identities.length > 10) {
        throw new APIError("Cannot import more than 10 identities", 400);
      }

      // Check current identity count
      const currentCount = await UserMessageIdentity.countDocuments({
        user: userId,
        isDeleted: false,
      });

      if (currentCount + identities.length > 10) {
        throw new APIError(
          `Cannot import: would exceed maximum limit of 10 identities (current: ${currentCount})`,
          400
        );
      }

      const results = {
        imported: [],
        skipped: [],
        errors: [],
      };

      for (const identityData of identities) {
        try {
          // Validate required fields
          if (!identityData.messageAlias) {
            results.errors.push({
              data: identityData,
              error: "Missing messageAlias",
            });
            continue;
          }

          // Check if alias already exists
          const existingIdentity = await UserMessageIdentity.findOne({
            user: userId,
            messageAlias: identityData.messageAlias.toLowerCase(),
            isDeleted: false,
          });

          if (existingIdentity && !overwriteExisting) {
            results.skipped.push({
              alias: identityData.messageAlias,
              reason: "Alias already exists",
            });
            continue;
          }

          if (existingIdentity && overwriteExisting) {
            // Update existing identity
            Object.assign(existingIdentity, {
              displayName:
                identityData.displayName || existingIdentity.displayName,
              avatar: identityData.avatar || existingIdentity.avatar,
              privacySettings:
                identityData.privacySettings ||
                existingIdentity.privacySettings,
              forwardingPreferences:
                identityData.forwardingPreferences ||
                existingIdentity.forwardingPreferences,
            });
            await existingIdentity.save();
            results.imported.push(existingIdentity.messageAlias);
          } else {
            // Create new identity
            const newIdentity = new UserMessageIdentity({
              user: userId,
              messageAlias: identityData.messageAlias.toLowerCase().trim(),
              displayName:
                identityData.displayName || identityData.messageAlias,
              avatar: identityData.avatar,
              isDefault: false, // Never import as default for safety
              privacySettings: identityData.privacySettings || {},
              forwardingPreferences: identityData.forwardingPreferences || {},
            });
            await newIdentity.save();
            results.imported.push(newIdentity.messageAlias);
          }
        } catch (error) {
          results.errors.push({
            data: identityData,
            error: error.message,
          });
        }
      }

      res.json({
        success: true,
        results: results,
        summary: {
          total: identities.length,
          imported: results.imported.length,
          skipped: results.skipped.length,
          errors: results.errors.length,
        },
        message: `Import completed: ${results.imported.length} imported, ${results.skipped.length} skipped, ${results.errors.length} errors`,
      });
    } catch (error) {
      console.error("Error importing identities:", error);
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
   * Get identity recommendations based on usage patterns
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async getIdentityRecommendations(req, res) {
    try {
      const userId = req.user.id;

      // Get user's identities and their usage
      const identities = await UserMessageIdentity.find({
        user: userId,
        isDeleted: false,
      }).select("messageAlias displayName usageStats privacySettings");

      // Get recent message patterns
      const recentMessages = await DirectMessage.aggregate([
        {
          $match: {
            sender: mongoose.Types.ObjectId(userId),
            sentAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }, // Last 30 days
            isDeleted: false,
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
          $unwind: "$conversationDetails",
        },
        {
          $group: {
            _id: {
              senderIdentity: "$senderIdentity",
              conversationType: "$conversationDetails.conversationType",
            },
            count: { $sum: 1 },
          },
        },
      ]);

      const recommendations = [];

      // Analyze usage patterns and generate recommendations
      const totalMessages = identities.reduce(
        (sum, id) => sum + id.usageStats.messagesSent,
        0
      );

      // Recommendation 1: Underused identities
      const underusedIdentities = identities.filter(
        (id) =>
          id.usageStats.messagesSent < totalMessages * 0.05 && // Less than 5% of total usage
          id.usageStats.lastUsedAt &&
          id.usageStats.lastUsedAt <
            new Date(Date.now() - 14 * 24 * 60 * 60 * 1000) // Not used in 14 days
      );

      if (underusedIdentities.length > 0) {
        recommendations.push({
          type: "cleanup",
          priority: "medium",
          title: "Consider archiving unused identities",
          description: `You have ${underusedIdentities.length} identities that haven't been used recently`,
          action: "archive_unused",
          identities: underusedIdentities.map((id) => id.messageAlias),
          impact: "Improves organization and reduces clutter",
        });
      }

      // Recommendation 2: Default identity optimization
      const defaultIdentity = identities.find((id) => id.isDefault);
      if (defaultIdentity) {
        const defaultUsagePercent =
          (defaultIdentity.usageStats.messagesSent / totalMessages) * 100;

        if (defaultUsagePercent < 30) {
          const mostUsed = identities.reduce((prev, current) =>
            prev.usageStats.messagesSent > current.usageStats.messagesSent
              ? prev
              : current
          );

          if (mostUsed._id.toString() !== defaultIdentity._id.toString()) {
            recommendations.push({
              type: "optimization",
              priority: "high",
              title: "Consider changing your default identity",
              description: `'${mostUsed.messageAlias}' is used more frequently than your current default`,
              action: "change_default",
              suggestedIdentity: mostUsed.messageAlias,
              impact: "Reduces need for manual identity selection",
            });
          }
        }
      }

      // Recommendation 3: Privacy settings optimization
      const identitiesWithoutAutoDelete = identities.filter(
        (id) => !id.privacySettings.autoDeleteSettings.enabled
      );

      if (identitiesWithoutAutoDelete.length > 0) {
        recommendations.push({
          type: "privacy",
          priority: "low",
          title: "Enable auto-delete for better privacy",
          description: `${identitiesWithoutAutoDelete.length} identities don't have auto-delete enabled`,
          action: "enable_auto_delete",
          identities: identitiesWithoutAutoDelete.map((id) => id.messageAlias),
          impact: "Automatically cleans up old messages for better privacy",
        });
      }

      // Recommendation 4: Create specialized identity
      if (identities.length < 3 && totalMessages > 100) {
        recommendations.push({
          type: "creation",
          priority: "medium",
          title: "Consider creating specialized identities",
          description:
            "You might benefit from separate identities for work, personal, or specific contexts",
          action: "create_specialized",
          suggestions: ["work", "personal", "anonymous"],
          impact: "Better organization and privacy control",
        });
      }

      res.json({
        success: true,
        recommendations: recommendations,
        analytics: {
          totalIdentities: identities.length,
          totalMessages: totalMessages,
          mostActiveIdentity: identities.reduce((prev, current) =>
            prev.usageStats.messagesSent > current.usageStats.messagesSent
              ? prev
              : current
          ).messageAlias,
          averageMessagesPerIdentity: Math.round(
            totalMessages / identities.length
          ),
        },
      });
    } catch (error) {
      console.error("Error getting identity recommendations:", error);
      res.status(500).json({
        success: false,
        error: "Internal server error",
      });
    }
  }

  /**
   * Get deletion options with tiered protection system
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async getDeletionOptions(req, res) {
    try {
      const { identityId } = req.params;
      const userId = req.user.id;

      if (!mongoose.Types.ObjectId.isValid(identityId)) {
        throw new APIError("Invalid identity ID", 400);
      }

      const identity = await UserMessageIdentity.findById(identityId);
      if (!identity || identity.user.toString() !== userId) {
        throw new APIError("Identity not found or access denied", 404);
      }

      // Check active usage
      const activeConversations = await ConversationParticipant.countDocuments({
        identity: identityId,
        leftAt: { $exists: false },
      });

      const totalMessages = await DirectMessage.countDocuments({
        senderIdentity: identityId,
        isDeleted: false,
      });

      // Check protection status
      const isProtected = identity.isProtected || identity.isDefault;
      const protectionType = identity.isDefault
        ? "default"
        : identity.isProtected
          ? "user_selected"
          : "unprotected";

      // Get protection slot information
      const protectedCount = await UserMessageIdentity.countDocuments({
        user: userId,
        isProtected: true,
        isDeleted: false,
      });

      const deletionOptions = {
        identity: {
          _id: identity._id,
          messageAlias: identity.messageAlias,
          displayName: identity.displayName,
          isDefault: identity.isDefault,
          isProtected: identity.isProtected || identity.isDefault,
          protectionType: protectionType,
        },
        usage: {
          activeConversations: activeConversations,
          totalMessages: totalMessages,
          canSafelyDelete: activeConversations === 0,
        },
        protectionInfo: {
          isProtected: isProtected,
          protectionType: protectionType,
          canChangeProtection:
            !identity.isDefault && !identity.isProtected && protectedCount < 3,
          protectionSlots: {
            used: protectedCount,
            available: Math.max(0, 3 - protectedCount),
            maximum: 3,
          },
        },
        availableOptions: {
          softDelete: {
            available: true,
            description: isProtected
              ? `${protectionType === "default" ? "Default" : "Protected"} identity will be soft deleted and can be restored later`
              : "Identity will be soft deleted and can be restored later",
            warning:
              activeConversations > 0
                ? `Currently used in ${activeConversations} active conversations`
                : null,
          },
          permanentDelete: {
            available: !isProtected,
            description: isProtected
              ? `Not available for ${protectionType} identity (protection policy)`
              : "Permanently delete identity - cannot be undone",
            requirements: isProtected
              ? []
              : [
                  "Identity must not be protected",
                  "Confirmation message required",
                  activeConversations > 0
                    ? "Remove from active conversations first"
                    : "No active conversations (✓)",
                ],
            confirmationMessage: isProtected
              ? null
              : `DELETE ${identity.messageAlias}`,
            protectionPolicy: isProtected
              ? `${protectionType} identities are protected and can only be soft deleted`
              : null,
          },
        },
        consequences: {
          softDelete: [
            "Identity marked as deleted but data preserved",
            "Can be restored later if needed",
            identity.isDefault ? "Another identity will become default" : null,
            "Messages and conversation history preserved",
            isProtected ? `${protectionType} protection policy enforced` : null,
          ].filter(Boolean),
          permanentDelete: isProtected
            ? [
                `${protectionType} identities cannot be permanently deleted`,
                "Change protection status first if identity is user-selected protected",
                "Default identities always remain protected",
              ]
            : [
                "Identity completely removed from database",
                "Cannot be restored",
                "Message history preserved but sender identity marked as deleted",
                "Conversation participation records updated",
                "Audit trail created for compliance",
              ],
        },
      };

      res.json({
        success: true,
        deletionOptions: deletionOptions,
      });
    } catch (error) {
      console.error("Error getting deletion options:", error);
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
   * Bulk update protection status for multiple identities
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async bulkUpdateProtection(req, res) {
    try {
      const { protectionUpdates } = req.body;
      const userId = req.user.id;

      if (!Array.isArray(protectionUpdates) || protectionUpdates.length === 0) {
        throw new APIError("Protection updates must be a non-empty array", 400);
      }

      if (protectionUpdates.length > 10) {
        throw new APIError(
          "Cannot update more than 10 identities at once",
          400
        );
      }

      // Validate format: [{ identityId: "...", isProtected: true/false }, ...]
      for (const update of protectionUpdates) {
        if (!update.identityId || typeof update.isProtected !== "boolean") {
          throw new APIError(
            "Each update must have identityId and isProtected fields",
            400
          );
        }
      }

      const identityIds = protectionUpdates.map((u) => u.identityId);
      const identities = await UserMessageIdentity.find({
        _id: { $in: identityIds },
        user: userId,
        isDeleted: false,
      });

      if (identities.length !== identityIds.length) {
        throw new APIError("One or more identities not found", 404);
      }

      // Check current protection count
      const currentProtectedCount = await UserMessageIdentity.countDocuments({
        user: userId,
        isProtected: true,
        isDeleted: false,
      });

      // Calculate new protection count
      const newProtections = protectionUpdates.filter(
        (u) => u.isProtected
      ).length;
      const removedProtections = protectionUpdates.filter(
        (u) => !u.isProtected
      ).length;
      const projectedCount =
        currentProtectedCount + newProtections - removedProtections;

      if (projectedCount > 3) {
        throw new APIError(
          `Operation would result in ${projectedCount} protected identities. Maximum allowed is 3.`,
          400
        );
      }

      const results = {
        updated: [],
        errors: [],
        summary: {
          protected: 0,
          unprotected: 0,
          errors: 0,
        },
      };

      for (const update of protectionUpdates) {
        try {
          const identity = identities.find(
            (i) => i._id.toString() === update.identityId
          );

          if (identity.isDefault && !update.isProtected) {
            results.errors.push({
              identityId: update.identityId,
              alias: identity.messageAlias,
              error: "Default identity cannot be unprotected",
            });
            results.summary.errors++;
            continue;
          }

          const oldStatus = identity.isProtected;
          identity.isProtected = update.isProtected;
          await identity.save();

          results.updated.push({
            identityId: update.identityId,
            alias: identity.messageAlias,
            oldStatus: oldStatus,
            newStatus: update.isProtected,
            isDefault: identity.isDefault,
          });

          if (update.isProtected) {
            results.summary.protected++;
          } else {
            results.summary.unprotected++;
          }
        } catch (error) {
          results.errors.push({
            identityId: update.identityId,
            error: error.message,
          });
          results.summary.errors++;
        }
      }

      // Get updated protection status
      const finalProtectedCount = await UserMessageIdentity.countDocuments({
        user: userId,
        isProtected: true,
        isDeleted: false,
      });

      res.json({
        success: true,
        results: results,
        protectionStatus: {
          protectedCount: finalProtectedCount,
          availableSlots: Math.max(0, 3 - finalProtectedCount),
        },
        message: `Bulk protection update completed: ${results.summary.protected} protected, ${results.summary.unprotected} unprotected, ${results.summary.errors} errors`,
      });
    } catch (error) {
      console.error("Error bulk updating protection:", error);
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
   * Get smart protection recommendations based on usage patterns
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async getProtectionRecommendations(req, res) {
    try {
      const userId = req.user.id;

      const allIdentities = await UserMessageIdentity.find({
        user: userId,
        isDeleted: false,
      }).select(
        "messageAlias displayName isDefault isProtected usageStats createdAt"
      );

      const protectedIdentities = allIdentities.filter(
        (i) => i.isProtected || i.isDefault
      );
      const unprotectedIdentities = allIdentities.filter(
        (i) => !i.isProtected && !i.isDefault
      );

      const availableSlots = Math.max(0, 3 - protectedIdentities.length);

      if (availableSlots === 0) {
        return res.json({
          success: true,
          recommendations: [],
          message: "All protection slots are in use (3/3)",
          protectionStatus: {
            protectedCount: protectedIdentities.length,
            availableSlots: 0,
            canProtectMore: false,
          },
        });
      }

      // Generate recommendations based on various criteria
      const recommendations = [];

      // 1. High usage identities
      const highUsageIdentities = unprotectedIdentities
        .filter((i) => i.usageStats.messagesSent > 50)
        .sort((a, b) => b.usageStats.messagesSent - a.usageStats.messagesSent)
        .slice(0, availableSlots);

      highUsageIdentities.forEach((identity) => {
        recommendations.push({
          identityId: identity._id,
          messageAlias: identity.messageAlias,
          displayName: identity.displayName,
          reason: `High usage (${identity.usageStats.messagesSent} messages sent)`,
          priority: identity.usageStats.messagesSent > 500 ? "high" : "medium",
          criteria: "usage_based",
          metrics: {
            messagesSent: identity.usageStats.messagesSent,
            lastUsed: identity.usageStats.lastUsedAt,
          },
        });
      });

      // 2. Recently active identities
      const recentlyActive = unprotectedIdentities
        .filter(
          (i) =>
            i.usageStats.lastUsedAt &&
            new Date() - new Date(i.usageStats.lastUsedAt) <
              7 * 24 * 60 * 60 * 1000
        ) // Last 7 days
        .filter(
          (i) =>
            !recommendations.find(
              (r) => r.identityId.toString() === i._id.toString()
            )
        )
        .sort(
          (a, b) =>
            new Date(b.usageStats.lastUsedAt) -
            new Date(a.usageStats.lastUsedAt)
        )
        .slice(0, Math.max(0, availableSlots - recommendations.length));

      recentlyActive.forEach((identity) => {
        recommendations.push({
          identityId: identity._id,
          messageAlias: identity.messageAlias,
          displayName: identity.displayName,
          reason: `Recently active (used ${Math.floor((new Date() - new Date(identity.usageStats.lastUsedAt)) / (24 * 60 * 60 * 1000))} days ago)`,
          priority: "medium",
          criteria: "recent_activity",
          metrics: {
            messagesSent: identity.usageStats.messagesSent,
            lastUsed: identity.usageStats.lastUsedAt,
          },
        });
      });

      // 3. Fill remaining slots with oldest identities (sentimental value)
      const remainingSlots = Math.max(
        0,
        availableSlots - recommendations.length
      );
      if (remainingSlots > 0) {
        const oldestIdentities = unprotectedIdentities
          .filter(
            (i) =>
              !recommendations.find(
                (r) => r.identityId.toString() === i._id.toString()
              )
          )
          .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
          .slice(0, remainingSlots);

        oldestIdentities.forEach((identity) => {
          recommendations.push({
            identityId: identity._id,
            messageAlias: identity.messageAlias,
            displayName: identity.displayName,
            reason: `Oldest identity (created ${new Date(identity.createdAt).toLocaleDateString()})`,
            priority: "low",
            criteria: "sentimental_value",
            metrics: {
              messagesSent: identity.usageStats.messagesSent,
              createdAt: identity.createdAt,
            },
          });
        });
      }

      res.json({
        success: true,
        recommendations: recommendations.slice(0, availableSlots),
        protectionStatus: {
          protectedCount: protectedIdentities.length,
          availableSlots: availableSlots,
          canProtectMore: availableSlots > 0,
        },
        rationale: {
          criteria: [
            "High usage identities (>50 messages sent)",
            "Recently active identities (used in last 7 days)",
            "Oldest identities (sentimental value)",
          ],
          maxRecommendations: availableSlots,
        },
      });
    } catch (error) {
      console.error("Error getting protection recommendations:", error);
      res.status(500).json({
        success: false,
        error: "Internal server error",
      });
    }
  }

  /**
   * Bulk delete identities with different policies
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async bulkDeleteIdentities(req, res) {
    try {
      const { identityIds, deletionType = "soft", force = false } = req.body;
      const userId = req.user.id;

      if (!Array.isArray(identityIds) || identityIds.length === 0) {
        throw new APIError("Identity IDs must be a non-empty array", 400);
      }

      if (identityIds.length > 10) {
        throw new APIError(
          "Cannot delete more than 10 identities at once",
          400
        );
      }

      if (!["soft", "permanent"].includes(deletionType)) {
        throw new APIError('Deletion type must be "soft" or "permanent"', 400);
      }

      // Validate all identities exist and user owns them
      const identities = await UserMessageIdentity.find({
        _id: { $in: identityIds },
        user: userId,
        isDeleted: false,
      });

      if (identities.length !== identityIds.length) {
        throw new APIError(
          "One or more identities not found or already deleted",
          404
        );
      }

      const results = {
        processed: [],
        errors: [],
        summary: {
          softDeleted: 0,
          permanentlyDeleted: 0,
          errors: 0,
        },
      };

      for (const identity of identities) {
        try {
          if (identity.isDefault) {
            // Default identities can only be soft deleted
            if (deletionType === "permanent") {
              results.errors.push({
                identityId: identity._id,
                alias: identity.messageAlias,
                error: "Default identity cannot be permanently deleted",
              });
              results.summary.errors++;
              continue;
            }

            // Soft delete default identity
            identity.isDeleted = true;
            identity.isActive = false;
            identity.deletedAt = new Date();
            await identity.save();

            results.processed.push({
              identityId: identity._id,
              alias: identity.messageAlias,
              deletionType: "soft",
              reason: "Default identity (forced soft delete)",
            });
            results.summary.softDeleted++;
          } else {
            // Non-default identities
            if (deletionType === "permanent") {
              // Check active usage
              const activeUsage = await ConversationParticipant.countDocuments({
                identity: identity._id,
                leftAt: { $exists: false },
              });

              if (activeUsage > 0 && !force) {
                results.errors.push({
                  identityId: identity._id,
                  alias: identity.messageAlias,
                  error: `Used in ${activeUsage} active conversations. Use force=true to delete anyway.`,
                });
                results.summary.errors++;
                continue;
              }

              // Permanent delete
              await ConversationParticipant.updateMany(
                { identity: identity._id },
                {
                  $unset: { identity: 1 },
                  identityDeleted: true,
                  identityDeletedAt: new Date(),
                }
              );

              await DirectMessage.updateMany(
                { senderIdentity: identity._id },
                {
                  senderIdentityDeleted: true,
                  senderIdentityDeletedAt: new Date(),
                }
              );

              await UserMessageIdentity.findByIdAndDelete(identity._id);

              results.processed.push({
                identityId: identity._id,
                alias: identity.messageAlias,
                deletionType: "permanent",
              });
              results.summary.permanentlyDeleted++;
            } else {
              // Soft delete
              identity.isDeleted = true;
              identity.isActive = false;
              identity.deletedAt = new Date();
              await identity.save();

              results.processed.push({
                identityId: identity._id,
                alias: identity.messageAlias,
                deletionType: "soft",
              });
              results.summary.softDeleted++;
            }
          }
        } catch (error) {
          results.errors.push({
            identityId: identity._id,
            alias: identity.messageAlias,
            error: error.message,
          });
          results.summary.errors++;
        }
      }

      // Handle default identity replacement if needed
      const defaultDeleted = results.processed.some(
        (p) =>
          identities.find((i) => i._id.toString() === p.identityId.toString())
            ?.isDefault
      );

      let newDefault = null;
      if (defaultDeleted) {
        const nextIdentity = await UserMessageIdentity.findOne({
          user: userId,
          isDeleted: false,
          isActive: true,
        }).sort({ createdAt: 1 });

        if (nextIdentity) {
          await nextIdentity.setAsDefault();
          newDefault = nextIdentity.messageAlias;
        }
      }

      res.json({
        success: true,
        results: results,
        newDefault: newDefault,
        message: `Bulk deletion completed: ${results.summary.softDeleted} soft deleted, ${results.summary.permanentlyDeleted} permanently deleted, ${results.summary.errors} errors`,
      });
    } catch (error) {
      console.error("Error bulk deleting identities:", error);
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

// Helper function to validate URL
function isValidURL(string) {
  try {
    new URL(string);
    return true;
  } catch (_) {
    return false;
  }
}

export default IdentityController;
