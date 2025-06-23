import mongoose, { Schema } from "mongoose";
import crypto from "crypto";

// User Message Identity Schema
const userMessageIdentitySchema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    messageAlias: {
      type: String,
      required: true,
      trim: true,
      maxlength: 50,
    },
    displayName: {
      type: String,
      trim: true,
      maxlength: 100,
    },
    avatar: {
      type: String, // URL to avatar image
    },
    isDefault: {
      type: Boolean,
      default: false,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    expiresAt: {
      type: Date,
    },
    privacySettings: {
      allowStrangers: {
        type: Boolean,
        default: true,
      },
      allowMessageRequests: {
        type: Boolean,
        default: true,
      },
      autoDeleteSettings: {
        enabled: {
          type: Boolean,
          default: false,
        },
        preset: {
          type: String,
          enum: ["1_day", "1_week", "1_month", "custom", null],
          default: null,
        },
        customDays: {
          type: Number,
          min: 1,
          max: 365,
          validate: {
            validator: function (value) {
              // Custom days only required if preset is 'custom'
              return (
                this.autoDeleteSettings.preset !== "custom" ||
                (value && value > 0)
              );
            },
            message: "Custom days must be specified when preset is custom",
          },
        },
        // Computed field for actual days
        effectiveDays: {
          type: Number,
          default: 0, // 0 means no auto-delete
        },
      },
      readReceiptsEnabled: {
        type: Boolean,
        default: true,
      },
      typingIndicators: {
        type: Boolean,
        default: true,
      },
      onlineStatus: {
        type: Boolean,
        default: true,
      },
    },

    // User Message Forwarding Preferences
    forwardingPreferences: {
      defaultAttribution: {
        type: String,
        enum: ["show_original", "show_immediate", "hide_all", "anonymous"],
        default: "show_original",
      },
      allowOthersToForward: {
        type: Boolean,
        default: true,
      },
      requireAttribution: {
        type: Boolean,
        default: false,
      },
      maxForwardChain: {
        type: Number,
        default: 10, // Prevent infinite forwarding chains
        min: 1,
        max: 50,
      },
      forwardToPublicChannels: {
        type: Boolean,
        default: false, // Restrict forwarding to public spaces
      },
    },
    usageStats: {
      messagesReceived: {
        type: Number,
        default: 0,
      },
      messagesSent: {
        type: Number,
        default: 0,
      },
      conversationsStarted: {
        type: Number,
        default: 0,
      },
      lastUsedAt: {
        type: Date,
      },
    },
    isArchived: {
      type: Boolean,
      default: false,
    },
    isDeleted: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

// Chat Theme Schema - Simplified for Backend
const chatThemeSchema = new Schema(
  {
    themeName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },
    themeType: {
      type: String,
      enum: ["default", "gradient", "image", "custom", "animated"],
      default: "default",
    },

    // Theme Configuration (JSON) - Frontend will interpret this
    themeConfig: {
      type: Schema.Types.Mixed,
      required: true,
      validate: {
        validator: function (config) {
          // Basic validation - detailed validation on frontend
          return config && typeof config === "object";
        },
        message: "Theme configuration must be a valid object",
      },
    },

    // Preview and Metadata
    preview: {
      thumbnailUrl: String,
      previewImages: [String], // Screenshots of theme in use
      colorPalette: [String], // Main colors for quick preview
    },

    // Marketplace and Sharing
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    isPublic: {
      type: Boolean,
      default: false,
    },
    isVerified: {
      type: Boolean,
      default: false, // Verified by platform for quality
    },
    usageCount: {
      type: Number,
      default: 0,
    },
    rating: {
      averageRating: { type: Number, default: 0 },
      totalRatings: { type: Number, default: 0 },
    },

    // Discovery and Organization
    tags: [String], // For theme discovery
    category: {
      type: String,
      enum: [
        "nature",
        "abstract",
        "minimal",
        "dark",
        "colorful",
        "business",
        "custom",
      ],
      default: "custom",
    },
    compatibility: {
      platforms: [String], // web, ios, android, desktop
      minVersion: String,
    },

    // Analytics and Management
    analytics: {
      installCount: { type: Number, default: 0 },
      activeUsers: { type: Number, default: 0 },
      lastUsed: { type: Date },
    },

    isDeleted: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

// User Theme Preferences - Link users to their selected themes
const userThemePreferenceSchema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    // Global theme preference
    globalTheme: {
      type: Schema.Types.ObjectId,
      ref: "ChatTheme",
    },

    // Per-conversation theme overrides
    conversationThemes: [
      {
        conversation: {
          type: Schema.Types.ObjectId,
          ref: "Conversation",
        },
        theme: {
          type: Schema.Types.ObjectId,
          ref: "ChatTheme",
        },
        customizations: Schema.Types.Mixed, // User modifications to base theme
      },
    ],

    // Theme settings
    settings: {
      autoApplyThemes: { type: Boolean, default: true },
      syncAcrossDevices: { type: Boolean, default: true },
      allowAnimations: { type: Boolean, default: true },
      darkModeOverride: { type: Boolean, default: false },
    },

    // Custom themes created by user
    customThemes: [
      {
        name: String,
        config: Schema.Types.Mixed,
        createdAt: { type: Date, default: Date.now },
      },
    ],
  },
  {
    timestamps: true,
  }
);

// Remove the old detailed theme schema and replace with simplified version
// The frontend will handle the detailed theme rendering

// Conversation Schema
const conversationSchema = new Schema(
  {
    conversationType: {
      type: String,
      enum: ["direct", "group", "secret", "broadcast"],
      required: true,
    },
    conversationName: {
      type: String,
      trim: true,
      maxlength: 100,
    },
    conversationDescription: {
      type: String,
      trim: true,
      maxlength: 500,
    },
    conversationAvatar: {
      type: String, // URL to avatar image
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    lastMessage: {
      type: Schema.Types.ObjectId,
      ref: "DirectMessage",
    },
    lastMessageAt: {
      type: Date,
      default: Date.now,
    },
    participantCount: {
      type: Number,
      default: 0,
    },

    // Privacy & Security Settings
    privacySettings: {
      autoDeleteMessages: {
        type: Boolean,
        default: false,
      },
      autoDeleteDuration: {
        type: Number, // In hours
        default: 24,
        min: 1,
        max: 8760, // 1 year
      },
      disappearingMessages: {
        enabled: {
          type: Boolean,
          default: false,
        },
        duration: {
          type: Number, // In seconds
          default: 604800, // 1 week
          min: 5,
          max: 604800,
        },
      },
      messageRequests: {
        type: Boolean,
        default: true,
      },
      invitePermission: {
        type: String,
        enum: ["everyone", "admins_only", "creator_only"],
        default: "everyone",
      },
    },

    // Secret Chat Features
    secretChatSettings: {
      encryptionEnabled: {
        type: Boolean,
        default: false,
      },
      encryptionKey: String, // Encrypted key
      keyVersion: {
        type: Number,
        default: 1,
      },
      screenshotNotifications: {
        type: Boolean,
        default: false,
      },
      screenRecordingBlocked: {
        type: Boolean,
        default: false,
      },
      forwardingDisabled: {
        type: Boolean,
        default: false,
      },
      selfDestructTimer: {
        type: Number, // In seconds
        default: 0, // 0 means disabled
      },
      deviceLimit: {
        type: Number,
        default: 5,
        min: 1,
        max: 10,
      },
    },

    // Theme Settings
    theme: {
      type: Schema.Types.ObjectId,
      ref: "ChatTheme",
    },
    customBackground: {
      url: String,
      uploadedBy: {
        type: Schema.Types.ObjectId,
        ref: "User",
      },
    },

    // Group specific settings
    groupSettings: {
      maxParticipants: {
        type: Number,
        default: 256,
        min: 2,
        max: 1000,
      },
      joinApprovalRequired: {
        type: Boolean,
        default: false,
      },
      adminOnlyMessaging: {
        type: Boolean,
        default: false,
      },
      allowMemberInvites: {
        type: Boolean,
        default: true,
      },
      allowMemberEdit: {
        type: Boolean,
        default: false,
      },
      muteNotifications: {
        type: Boolean,
        default: false,
      },
    },

    // Status and Moderation
    status: {
      type: String,
      enum: ["active", "archived", "muted", "blocked", "deleted"],
      default: "active",
    },
    moderationStatus: {
      status: {
        type: String,
        enum: ["active", "restricted", "suspended", "banned"],
        default: "active",
      },
      reason: String,
      reviewedAt: Date,
      reviewedBy: {
        type: Schema.Types.ObjectId,
        ref: "User",
      },
    },

    // Analytics
    analytics: {
      totalMessages: {
        type: Number,
        default: 0,
      },
      totalMedia: {
        type: Number,
        default: 0,
      },
      lastActivityAt: {
        type: Date,
        default: Date.now,
      },
      peakParticipants: {
        type: Number,
        default: 0,
      },
    },

    isArchived: {
      type: Boolean,
      default: false,
    },
    isDeleted: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

// Conversation Participant Schema
const conversationParticipantSchema = new Schema(
  {
    conversation: {
      type: Schema.Types.ObjectId,
      ref: "Conversation",
      required: true,
    },
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    identity: {
      type: Schema.Types.ObjectId,
      ref: "UserMessageIdentity",
      required: true,
    },
    joinedAt: {
      type: Date,
      default: Date.now,
    },
    leftAt: {
      type: Date,
    },
    role: {
      type: String,
      enum: ["member", "admin", "owner", "moderator"],
      default: "member",
    },

    // Participant specific settings
    nickname: {
      type: String,
      trim: true,
      maxlength: 50,
    },
    customColor: String, // Custom color for this participant's messages

    // Notification settings
    notifications: {
      isMuted: {
        type: Boolean,
        default: false,
      },
      mutedUntil: {
        type: Date,
      },
      messageNotifications: {
        type: Boolean,
        default: true,
      },
      mentionNotifications: {
        type: Boolean,
        default: true,
      },
      soundEnabled: {
        type: Boolean,
        default: true,
      },
      vibrationEnabled: {
        type: Boolean,
        default: true,
      },
    },

    // Read status
    lastReadMessage: {
      type: Schema.Types.ObjectId,
      ref: "DirectMessage",
    },
    lastReadAt: {
      type: Date,
    },
    lastSeenAt: {
      type: Date,
      default: Date.now,
    },

    // Privacy settings per conversation
    privacySettings: {
      autoDeleteMyMessages: {
        type: Boolean,
        default: false,
      },
      autoDeleteDuration: {
        type: Number, // In hours
        default: 24,
      },
      deliveryReceipts: {
        type: Boolean,
        default: true,
      },
      typingIndicators: {
        type: Boolean,
        default: true,
      },
      onlineStatus: {
        type: Boolean,
        default: true,
      },
    },

    // Permissions
    permissions: {
      canSendMessages: {
        type: Boolean,
        default: true,
      },
      canSendMedia: {
        type: Boolean,
        default: true,
      },
      canAddMembers: {
        type: Boolean,
        default: true,
      },
      canEditGroupInfo: {
        type: Boolean,
        default: false,
      },
      canDeleteMessages: {
        type: Boolean,
        default: false,
      },
    },

    // Analytics
    analytics: {
      messagesSent: {
        type: Number,
        default: 0,
      },
      messagesReceived: {
        type: Number,
        default: 0,
      },
      mediaSent: {
        type: Number,
        default: 0,
      },
      firstMessageAt: {
        type: Date,
      },
      lastMessageAt: {
        type: Date,
      },
    },

    isPinned: {
      type: Boolean,
      default: false,
    },
    isArchived: {
      type: Boolean,
      default: false,
    },
    isBlocked: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

// Direct Message Schema
const directMessageSchema = new Schema(
  {
    conversation: {
      type: Schema.Types.ObjectId,
      ref: "Conversation",
      required: true,
    },
    sender: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    senderIdentity: {
      type: Schema.Types.ObjectId,
      ref: "UserMessageIdentity",
      required: true,
    },

    // Message Content
    messageType: {
      type: String,
      enum: [
        "text",
        "image",
        "video",
        "audio",
        "file",
        "sticker",
        "gif",
        "location",
        "contact",
        "poll",
        "payment",
        "voice_note",
        "link",
        "system",
        "call_log",
      ],
      required: true,
    },
    content: {
      type: String,
      trim: true,
      maxlength: 4000,
    },

    // Media and Attachments
    media: [
      {
        type: Schema.Types.ObjectId,
        ref: "Media",
      },
    ],
    mediaMetadata: {
      duration: Number, // For audio/video in seconds
      dimensions: {
        width: Number,
        height: Number,
      },
      thumbnail: String,
      fileSize: Number,
      fileName: String,
      mimeType: String,
    },

    // Rich Content
    linkPreview: {
      url: String,
      title: String,
      description: String,
      image: String,
      domain: String,
    },

    // Formatting and Style
    formatting: {
      bold: [{ start: Number, end: Number }],
      italic: [{ start: Number, end: Number }],
      underline: [{ start: Number, end: Number }],
      strikethrough: [{ start: Number, end: Number }],
      code: [{ start: Number, end: Number }],
      mention: [
        {
          start: Number,
          end: Number,
          user: {
            type: Schema.Types.ObjectId,
            ref: "User",
          },
        },
      ],
      hashtag: [
        {
          start: Number,
          end: Number,
          tag: String,
        },
      ],
    },

    // Message Properties
    sentAt: {
      type: Date,
      default: Date.now,
    },
    editedAt: {
      type: Date,
    },
    isEdited: {
      type: Boolean,
      default: false,
    },
    editHistory: [
      {
        content: String,
        editedAt: {
          type: Date,
          default: Date.now,
        },
        reason: String,
      },
    ],

    // Reply and Forward
    replyTo: {
      type: Schema.Types.ObjectId,
      ref: "DirectMessage",
    },
    forwardedFrom: {
      message: {
        type: Schema.Types.ObjectId,
        ref: "DirectMessage",
      },
      originalSender: {
        type: Schema.Types.ObjectId,
        ref: "User",
      },
      forwardChain: Number, // How many times it's been forwarded
      // User's choice on attribution display
      attributionDisplay: {
        type: String,
        enum: ["show_original", "show_immediate", "hide_all", "anonymous"],
        default: "show_original",
        // show_original: Show the original sender
        // show_immediate: Show who forwarded it to you
        // hide_all: Don't show any forwarding attribution
        // anonymous: Show "Forwarded message" without names
      },
      // Privacy settings for forwarding
      forwardingRights: {
        allowFurtherForwarding: {
          type: Boolean,
          default: true,
        },
        requireAttribution: {
          type: Boolean,
          default: false,
        },
        preserveOriginalSender: {
          type: Boolean,
          default: true,
        },
      },
    },

    // Privacy & Security
    disappearing: {
      isDisappearing: {
        type: Boolean,
        default: false,
      },
      disappearAfter: {
        type: Number, // Seconds after read
        default: 0,
      },
      disappearAt: {
        type: Date,
      },
    },
    autoDeleteAt: {
      type: Date,
    },
    isDeleted: {
      type: Boolean,
      default: false,
    },
    deletedAt: {
      type: Date,
    },
    deletedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    deletedFor: [
      {
        user: {
          type: Schema.Types.ObjectId,
          ref: "User",
        },
        deletedAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],

    // Secret Chat Features
    secretChat: {
      isEncrypted: {
        type: Boolean,
        default: false,
      },
      encryptionKey: String,
      screenshotDetected: {
        type: Boolean,
        default: false,
      },
      screenshotCount: {
        type: Number,
        default: 0,
      },
      screenshotBy: [
        {
          user: {
            type: Schema.Types.ObjectId,
            ref: "User",
          },
          detectedAt: {
            type: Date,
          },
          method: {
            type: String,
            enum: ["screenshot", "screen_recording", "external_camera"],
          },
        },
      ],
      isSelfDestructed: {
        type: Boolean,
        default: false,
      },
      selfDestructAt: {
        type: Date,
      },
    },

    // Message Status and Delivery
    deliveryStatus: {
      type: String,
      enum: ["sending", "sent", "delivered", "read", "failed"],
      default: "sending",
    },
    deliveredAt: {
      type: Date,
    },
    readBy: [
      {
        user: {
          type: Schema.Types.ObjectId,
          ref: "User",
        },
        readAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],

    // Reactions and Interactions
    reactions: [
      {
        user: {
          type: Schema.Types.ObjectId,
          ref: "User",
        },
        emoji: {
          type: String,
          required: true,
        },
        createdAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],

    // Pinning and Importance
    isPinned: {
      type: Boolean,
      default: false,
    },
    pinnedAt: {
      type: Date,
    },
    pinnedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    isImportant: {
      type: Boolean,
      default: false,
    },

    // Moderation
    moderationStatus: {
      status: {
        type: String,
        enum: ["approved", "pending", "flagged", "hidden", "deleted"],
        default: "approved",
      },
      reason: String,
      reviewedAt: Date,
      reviewedBy: {
        type: Schema.Types.ObjectId,
        ref: "User",
      },
    },
    reportCount: {
      type: Number,
      default: 0,
    },

    // Analytics
    analytics: {
      viewCount: {
        type: Number,
        default: 0,
      },
      shareCount: {
        type: Number,
        default: 0,
      },
      reactionCount: {
        type: Number,
        default: 0,
      },
    },

    // System Messages
    systemMessage: {
      type: {
        type: String,
        enum: [
          "user_joined",
          "user_left",
          "user_added",
          "user_removed",
          "group_created",
          "group_renamed",
          "group_icon_changed",
          "admin_promoted",
          "admin_demoted",
          "settings_changed",
          "encryption_enabled",
          "auto_delete_enabled",
        ],
      },
      data: Schema.Types.Mixed, // Flexible data for system messages
    },
  },
  {
    timestamps: true,
  }
);

// Indexes for performance
userMessageIdentitySchema.index({ user: 1, isDefault: 1 });
userMessageIdentitySchema.index({ user: 1, isActive: 1 });
userMessageIdentitySchema.index({ messageAlias: 1 });
userMessageIdentitySchema.index({ expiresAt: 1 });

chatThemeSchema.index({ createdBy: 1 });
chatThemeSchema.index({ isPublic: 1, category: 1 });
chatThemeSchema.index({ usageCount: -1 });

conversationSchema.index({ createdBy: 1, createdAt: -1 });
conversationSchema.index({ conversationType: 1 });
conversationSchema.index({ lastMessageAt: -1 });
conversationSchema.index({ "analytics.lastActivityAt": -1 });

conversationParticipantSchema.index(
  { conversation: 1, user: 1 },
  { unique: true }
);
conversationParticipantSchema.index({ user: 1, joinedAt: -1 });
conversationParticipantSchema.index({ conversation: 1, role: 1 });

directMessageSchema.index({ conversation: 1, sentAt: -1 });
directMessageSchema.index({ sender: 1, sentAt: -1 });
directMessageSchema.index({ conversation: 1, messageType: 1 });
directMessageSchema.index({ autoDeleteAt: 1 });
directMessageSchema.index({ "disappearing.disappearAt": 1 });
directMessageSchema.index({ deliveryStatus: 1 });

// Virtual fields
userMessageIdentitySchema.virtual("isExpired").get(function () {
  return this.expiresAt && this.expiresAt < new Date();
});

conversationSchema.virtual("isGroup").get(function () {
  return this.conversationType === "group";
});

conversationSchema.virtual("isSecret").get(function () {
  return this.conversationType === "secret";
});

directMessageSchema.virtual("reactionCount").get(function () {
  return this.reactions.length;
});

// Methods for UserMessageIdentity
userMessageIdentitySchema.methods = {
  // Set as default identity for user
  setAsDefault: async function () {
    // First, unset all other identities as default
    await this.constructor.updateMany(
      { user: this.user, _id: { $ne: this._id } },
      { isDefault: false }
    );

    this.isDefault = true;
    return this.save();
  },

  // Update auto-delete settings with preset options
  updateAutoDeleteSettings: function (settings) {
    if (!settings.enabled) {
      this.privacySettings.autoDeleteSettings = {
        enabled: false,
        preset: null,
        customDays: null,
        effectiveDays: 0,
      };
      return this.save();
    }

    // Handle preset values
    const presetToDays = {
      "1_day": 1,
      "1_week": 7,
      "1_month": 30,
      custom: settings.customDays || 0,
    };

    this.privacySettings.autoDeleteSettings = {
      enabled: true,
      preset: settings.preset,
      customDays: settings.preset === "custom" ? settings.customDays : null,
      effectiveDays: presetToDays[settings.preset] || 0,
    };

    return this.save();
  },

  // Get auto-delete settings in user-friendly format
  getAutoDeleteSettings: function () {
    const settings = this.privacySettings.autoDeleteSettings;

    if (!settings.enabled) {
      return {
        enabled: false,
        description: "Messages will not auto-delete",
      };
    }

    const descriptions = {
      "1_day": "Messages auto-delete after 1 day",
      "1_week": "Messages auto-delete after 1 week",
      "1_month": "Messages auto-delete after 1 month",
      custom: `Messages auto-delete after ${settings.customDays} day${settings.customDays > 1 ? "s" : ""}`,
    };

    return {
      enabled: true,
      preset: settings.preset,
      customDays: settings.customDays,
      effectiveDays: settings.effectiveDays,
      description: descriptions[settings.preset] || "Auto-delete disabled",
    };
  },

  // Update forwarding preferences
  updateForwardingPreferences: function (preferences) {
    Object.assign(this.privacySettings.forwardingPreferences, preferences);
    return this.save();
  },

  // Get forwarding preferences in user-friendly format
  getForwardingPreferences: function () {
    const prefs = this.privacySettings.forwardingPreferences;

    const attributionDescriptions = {
      show_original: "Show original sender when forwarding",
      show_immediate: "Show who forwarded it to you",
      hide_all: "Hide all forwarding information",
      anonymous: 'Show "Forwarded message" without names',
    };

    return {
      defaultAttribution: prefs.defaultAttribution,
      attributionDescription: attributionDescriptions[prefs.defaultAttribution],
      allowOthersToForward: prefs.allowOthersToForward,
      requireAttribution: prefs.requireAttribution,
      maxForwardChain: prefs.maxForwardChain,
      forwardToPublicChannels: prefs.forwardToPublicChannels,
    };
  },

  // Check if identity is usable
  isUsable: function () {
    return (
      this.isActive &&
      !this.isDeleted &&
      (!this.expiresAt || this.expiresAt > new Date())
    );
  },

  // Update usage stats
  incrementUsage: function (type) {
    this.usageStats.lastUsedAt = new Date();
    if (type === "sent") {
      this.usageStats.messagesSent += 1;
    } else if (type === "received") {
      this.usageStats.messagesReceived += 1;
    } else if (type === "conversation") {
      this.usageStats.conversationsStarted += 1;
    }
    return this.save();
  },
};

// Methods for ChatTheme - Simplified for Backend Management
chatThemeSchema.methods = {
  // Increment usage count
  incrementUsage: function () {
    this.usageCount += 1;
    this.analytics.installCount += 1;
    this.analytics.lastUsed = new Date();
    return this.save();
  },

  // Check if user can use this theme
  canUseTheme: function (userId) {
    return (
      this.isPublic ||
      this.isVerified ||
      (this.createdBy && this.createdBy.toString() === userId.toString())
    );
  },

  // Add rating to theme
  addRating: function (rating) {
    const totalScore = this.rating.averageRating * this.rating.totalRatings;
    this.rating.totalRatings += 1;
    this.rating.averageRating =
      (totalScore + rating) / this.rating.totalRatings;
    return this.save();
  },

  // Generate theme preview data for frontend
  getPreviewData: function () {
    return {
      id: this._id,
      name: this.themeName,
      type: this.themeType,
      preview: this.preview,
      category: this.category,
      rating: this.rating.averageRating,
      usageCount: this.usageCount,
      isVerified: this.isVerified,
      config: this.themeConfig, // Frontend will interpret this
    };
  },
};

// Methods for UserThemePreference
userThemePreferenceSchema.methods = {
  // Set global theme
  setGlobalTheme: function (themeId) {
    this.globalTheme = themeId;
    return this.save();
  },

  // Set theme for specific conversation
  setConversationTheme: function (
    conversationId,
    themeId,
    customizations = {}
  ) {
    const existingIndex = this.conversationThemes.findIndex(
      (ct) => ct.conversation.toString() === conversationId.toString()
    );

    if (existingIndex >= 0) {
      this.conversationThemes[existingIndex].theme = themeId;
      this.conversationThemes[existingIndex].customizations = customizations;
    } else {
      this.conversationThemes.push({
        conversation: conversationId,
        theme: themeId,
        customizations: customizations,
      });
    }

    return this.save();
  },

  // Get effective theme for a conversation
  getEffectiveTheme: function (conversationId) {
    if (conversationId) {
      const conversationTheme = this.conversationThemes.find(
        (ct) => ct.conversation.toString() === conversationId.toString()
      );
      if (conversationTheme) {
        return {
          themeId: conversationTheme.theme,
          customizations: conversationTheme.customizations,
          source: "conversation",
        };
      }
    }

    return {
      themeId: this.globalTheme,
      customizations: {},
      source: "global",
    };
  },

  // Create custom theme
  createCustomTheme: function (name, config) {
    this.customThemes.push({
      name: name,
      config: config,
      createdAt: new Date(),
    });
    return this.save();
  },
};

// Methods for Conversation
conversationSchema.methods = {
  // Add participant to conversation
  addParticipant: async function (userId, identityId, role = "member") {
    const ConversationParticipant = mongoose.model("ConversationParticipant");

    const participant = new ConversationParticipant({
      conversation: this._id,
      user: userId,
      identity: identityId,
      role: role,
    });

    await participant.save();
    this.participantCount += 1;

    return this.save();
  },

  // Remove participant from conversation
  removeParticipant: async function (userId) {
    const ConversationParticipant = mongoose.model("ConversationParticipant");

    await ConversationParticipant.findOneAndUpdate(
      { conversation: this._id, user: userId },
      { leftAt: new Date() }
    );

    this.participantCount = Math.max(0, this.participantCount - 1);
    return this.save();
  },

  // Update last message
  updateLastMessage: function (messageId) {
    this.lastMessage = messageId;
    this.lastMessageAt = new Date();
    this.analytics.lastActivityAt = new Date();
    this.analytics.totalMessages += 1;
    return this.save();
  },

  // Check if user is participant
  isParticipant: async function (userId) {
    const ConversationParticipant = mongoose.model("ConversationParticipant");
    const participant = await ConversationParticipant.findOne({
      conversation: this._id,
      user: userId,
      leftAt: { $exists: false },
    });
    return !!participant;
  },

  // Get participant role
  getParticipantRole: async function (userId) {
    const ConversationParticipant = mongoose.model("ConversationParticipant");
    const participant = await ConversationParticipant.findOne({
      conversation: this._id,
      user: userId,
      leftAt: { $exists: false },
    });
    return participant ? participant.role : null;
  },

  // Enable encryption for secret chats
  enableEncryption: function () {
    if (this.conversationType === "secret") {
      this.secretChatSettings.encryptionEnabled = true;
      this.secretChatSettings.encryptionKey = crypto
        .randomBytes(32)
        .toString("hex");
      this.secretChatSettings.keyVersion += 1;
    }
    return this.save();
  },

  // Archive conversation
  archive: function () {
    this.isArchived = true;
    this.status = "archived";
    return this.save();
  },
};

// Methods for ConversationParticipant
conversationParticipantSchema.methods = {
  // Update last read message
  updateLastRead: function (messageId) {
    this.lastReadMessage = messageId;
    this.lastReadAt = new Date();
    return this.save();
  },

  // Update last seen
  updateLastSeen: function () {
    this.lastSeenAt = new Date();
    return this.save();
  },

  // Mute notifications
  muteNotifications: function (duration) {
    this.notifications.isMuted = true;
    if (duration) {
      this.notifications.mutedUntil = new Date(Date.now() + duration);
    }
    return this.save();
  },

  // Unmute notifications
  unmuteNotifications: function () {
    this.notifications.isMuted = false;
    this.notifications.mutedUntil = undefined;
    return this.save();
  },

  // Check if can perform action
  canPerformAction: function (action) {
    return this.permissions[action] === true;
  },

  // Update analytics
  incrementMessageCount: function (type) {
    if (type === "sent") {
      this.analytics.messagesSent += 1;
      this.analytics.lastMessageAt = new Date();
      if (!this.analytics.firstMessageAt) {
        this.analytics.firstMessageAt = new Date();
      }
    } else if (type === "received") {
      this.analytics.messagesReceived += 1;
    } else if (type === "media") {
      this.analytics.mediaSent += 1;
    }
    return this.save();
  },
};

// Methods for DirectMessage
directMessageSchema.methods = {
  // Mark message as read by user
  markAsReadBy: function (userId) {
    const existingRead = this.readBy.find(
      (r) => r.user.toString() === userId.toString()
    );
    if (!existingRead) {
      this.readBy.push({ user: userId, readAt: new Date() });
      this.deliveryStatus = "read";
    }
    return this.save();
  },

  // Add reaction to message
  addReaction: function (userId, emoji) {
    // Remove existing reaction from this user
    this.reactions = this.reactions.filter(
      (r) => r.user.toString() !== userId.toString()
    );

    // Add new reaction
    this.reactions.push({ user: userId, emoji: emoji });
    this.analytics.reactionCount = this.reactions.length;

    return this.save();
  },

  // Remove reaction from message
  removeReaction: function (userId, emoji = null) {
    if (emoji) {
      this.reactions = this.reactions.filter(
        (r) => !(r.user.toString() === userId.toString() && r.emoji === emoji)
      );
    } else {
      this.reactions = this.reactions.filter(
        (r) => r.user.toString() !== userId.toString()
      );
    }
    this.analytics.reactionCount = this.reactions.length;
    return this.save();
  },

  // Edit message content
  editMessage: function (newContent, reason = null) {
    // Add to edit history
    this.editHistory.push({
      content: this.content,
      reason: reason,
    });

    this.content = newContent;
    this.isEdited = true;
    this.editedAt = new Date();

    return this.save();
  },

  // Delete message for specific users
  deleteForUsers: function (userIds) {
    userIds.forEach((userId) => {
      const existingDelete = this.deletedFor.find(
        (d) => d.user.toString() === userId.toString()
      );
      if (!existingDelete) {
        this.deletedFor.push({ user: userId });
      }
    });
    return this.save();
  },

  // Delete message completely
  deleteMessage: function (deletedBy, reason = null) {
    this.isDeleted = true;
    this.deletedAt = new Date();
    this.deletedBy = deletedBy;
    if (reason) {
      this.moderationStatus.reason = reason;
    }
    return this.save();
  },

  // Set disappearing message
  setDisappearing: function (seconds) {
    this.disappearing.isDisappearing = true;
    this.disappearing.disappearAfter = seconds;
    this.disappearing.disappearAt = new Date(Date.now() + seconds * 1000);
    return this.save();
  },

  // Record screenshot detection
  recordScreenshot: function (userId, method = "screenshot") {
    this.secretChat.screenshotDetected = true;
    this.secretChat.screenshotCount += 1;
    this.secretChat.screenshotBy.push({
      user: userId,
      detectedAt: new Date(),
      method: method,
    });
    return this.save();
  },

  // Forward message with attribution preferences
  forwardMessage: function (
    targetConversation,
    forwardedBy,
    attributionChoice = "show_original"
  ) {
    const forwardedMessage = new this.constructor({
      conversation: targetConversation,
      sender: forwardedBy,
      senderIdentity: this.senderIdentity, // Could be different based on user choice
      messageType: this.messageType,
      content: this.content,
      media: this.media,
      mediaMetadata: this.mediaMetadata,

      forwardedFrom: {
        message: this._id,
        originalSender: this.forwardedFrom?.originalSender || this.sender,
        forwardChain: (this.forwardedFrom?.forwardChain || 0) + 1,
        attributionDisplay: attributionChoice,
        forwardingRights: {
          allowFurtherForwarding:
            this.forwardedFrom?.forwardingRights?.allowFurtherForwarding ??
            true,
          requireAttribution:
            this.forwardedFrom?.forwardingRights?.requireAttribution ?? false,
          preserveOriginalSender:
            this.forwardedFrom?.forwardingRights?.preserveOriginalSender ??
            true,
        },
      },

      // Preserve original timestamp for context but set new sent time
      originalSentAt: this.sentAt,
      sentAt: new Date(),
    });

    return forwardedMessage.save();
  },

  // Get forwarding attribution display text
  getForwardingAttribution: function () {
    if (!this.forwardedFrom) {
      return null;
    }

    const attribution = this.forwardedFrom.attributionDisplay;
    const forwardChain = this.forwardedFrom.forwardChain;

    switch (attribution) {
      case "show_original":
        return {
          type: "original",
          text: `Forwarded from ${this.forwardedFrom.originalSender}`,
          showSender: true,
          senderId: this.forwardedFrom.originalSender,
          chainCount: forwardChain,
        };

      case "show_immediate":
        return {
          type: "immediate",
          text: `Forwarded by ${this.sender}`,
          showSender: true,
          senderId: this.sender,
          chainCount: forwardChain,
        };

      case "hide_all":
        return {
          type: "hidden",
          text: null,
          showSender: false,
          senderId: null,
          chainCount: 0,
        };

      case "anonymous":
        return {
          type: "anonymous",
          text:
            forwardChain > 1
              ? `Forwarded message (${forwardChain} times)`
              : "Forwarded message",
          showSender: false,
          senderId: null,
          chainCount: forwardChain,
        };

      default:
        return {
          type: "default",
          text: "Forwarded message",
          showSender: false,
          senderId: null,
          chainCount: forwardChain,
        };
    }
  },

  // Check if message can be forwarded further
  canBeForwarded: function () {
    if (!this.forwardedFrom) {
      return true; // Original messages can always be forwarded
    }

    return this.forwardedFrom.forwardingRights.allowFurtherForwarding;
  },

  // Check if attribution is required
  requiresAttribution: function () {
    if (!this.forwardedFrom) {
      return false;
    }

    return this.forwardedFrom.forwardingRights.requireAttribution;
  },

  // Pin message
  pinMessage: function (pinnedBy) {
    this.isPinned = true;
    this.pinnedAt = new Date();
    this.pinnedBy = pinnedBy;
    return this.save();
  },

  // Unpin message
  unpinMessage: function () {
    this.isPinned = false;
    this.pinnedAt = undefined;
    this.pinnedBy = undefined;
    return this.save();
  },

  // Check if message is visible to user
  isVisibleToUser: function (userId) {
    if (this.isDeleted) return false;

    // Check if deleted for specific user
    const deletedForUser = this.deletedFor.find(
      (d) => d.user.toString() === userId.toString()
    );
    return !deletedForUser;
  },

  // Increment view count
  incrementViewCount: function () {
    this.analytics.viewCount += 1;
    return this.save();
  },

  // Check if message has expired (for disappearing messages)
  hasExpired: function () {
    return (
      this.disappearing.isDisappearing &&
      this.disappearing.disappearAt &&
      this.disappearing.disappearAt < new Date()
    );
  },
};

// Static methods for UserMessageIdentity
userMessageIdentitySchema.statics = {
  // Get user's default identity
  getDefaultIdentity: function (userId) {
    return this.findOne({
      user: userId,
      isDefault: true,
      isActive: true,
      isDeleted: false,
    });
  },

  // Get all active identities for user
  getUserIdentities: function (userId, options = {}) {
    const { includeExpired = false } = options;

    const query = {
      user: userId,
      isActive: true,
      isDeleted: false,
    };

    if (!includeExpired) {
      query.$or = [
        { expiresAt: { $exists: false } },
        { expiresAt: { $gt: new Date() } },
      ];
    }

    return this.find(query).sort({ isDefault: -1, createdAt: -1 });
  },

  // Create new identity with auto-delete presets
  createIdentity: function (userId, alias, options = {}) {
    const identity = new this({
      user: userId,
      messageAlias: alias,
      displayName: options.displayName || alias,
      avatar: options.avatar,
      isDefault: options.isDefault || false,
      expiresAt: options.expiresAt,
      privacySettings: {
        ...options.privacySettings,
        autoDeleteSettings: {
          enabled: options.autoDelete?.enabled || false,
          preset: options.autoDelete?.preset || null,
          customDays: options.autoDelete?.customDays || null,
          effectiveDays: 0, // Will be calculated in pre-save
        },
      },
    });

    return identity.save();
  },

  // Clean up expired identities
  cleanupExpiredIdentities: function () {
    return this.updateMany(
      {
        expiresAt: { $lt: new Date() },
        isActive: true,
      },
      {
        isActive: false,
      }
    );
  },

  // Get identities that need message cleanup
  getIdentitiesForMessageCleanup: function () {
    return this.find({
      "privacySettings.autoDeleteSettings.enabled": true,
      "privacySettings.autoDeleteSettings.effectiveDays": { $gt: 0 },
      isActive: true,
      isDeleted: false,
    });
  },
};

// Static methods for ChatTheme
chatThemeSchema.statics = {
  // Get popular themes
  getPopularThemes: function (options = {}) {
    const { limit = 20, skip = 0, category = null } = options;

    const query = {
      isPublic: true,
      isDeleted: false,
    };

    if (category) {
      query.category = category;
    }

    return this.find(query)
      .sort({ usageCount: -1, createdAt: -1 })
      .skip(skip)
      .limit(limit);
  },

  // Get themes by user
  getUserThemes: function (userId, options = {}) {
    const { limit = 20, skip = 0 } = options;

    return this.find({
      createdBy: userId,
      isDeleted: false,
    })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);
  },

  // Search themes
  searchThemes: function (query, options = {}) {
    const { limit = 20, skip = 0 } = options;

    return this.find({
      $or: [
        { themeName: { $regex: query, $options: "i" } },
        { tags: { $in: [new RegExp(query, "i")] } },
      ],
      isPublic: true,
      isDeleted: false,
    })
      .sort({ usageCount: -1 })
      .skip(skip)
      .limit(limit);
  },
};

// Static methods for Conversation
conversationSchema.statics = {
  // Get user's conversations
  getUserConversations: function (userId, options = {}) {
    const {
      limit = 20,
      skip = 0,
      type = null,
      includeArchived = false,
    } = options;

    return this.aggregate([
      {
        $lookup: {
          from: "conversationparticipants",
          localField: "_id",
          foreignField: "conversation",
          as: "participants",
        },
      },
      {
        $match: {
          "participants.user": mongoose.Types.ObjectId(userId),
          "participants.leftAt": { $exists: false },
          isDeleted: false,
          ...(type && { conversationType: type }),
          ...(!includeArchived && { isArchived: false }),
        },
      },
      {
        $lookup: {
          from: "directmessages",
          localField: "lastMessage",
          foreignField: "_id",
          as: "lastMessageData",
        },
      },
      {
        $sort: { lastMessageAt: -1 },
      },
      {
        $skip: skip,
      },
      {
        $limit: limit,
      },
    ]);
  },

  // Create new conversation
  createConversation: async function (createdBy, type, options = {}) {
    const conversation = new this({
      conversationType: type,
      conversationName: options.name,
      conversationDescription: options.description,
      conversationAvatar: options.avatar,
      createdBy: createdBy,
      privacySettings: options.privacySettings || {},
      secretChatSettings: options.secretChatSettings || {},
      groupSettings: options.groupSettings || {},
      theme: options.theme,
    });

    await conversation.save();

    // Add creator as participant
    if (options.creatorIdentity) {
      await conversation.addParticipant(
        createdBy,
        options.creatorIdentity,
        "owner"
      );
    }

    return conversation;
  },

  // Find conversation between users
  findDirectConversation: function (user1Id, user2Id) {
    return this.aggregate([
      {
        $match: {
          conversationType: "direct",
          isDeleted: false,
        },
      },
      {
        $lookup: {
          from: "conversationparticipants",
          localField: "_id",
          foreignField: "conversation",
          as: "participants",
        },
      },
      {
        $match: {
          "participants.user": {
            $all: [
              mongoose.Types.ObjectId(user1Id),
              mongoose.Types.ObjectId(user2Id),
            ],
          },
          "participants.leftAt": { $exists: false },
        },
      },
      {
        $limit: 1,
      },
    ]);
  },

  // Get conversations requiring cleanup
  getConversationsForCleanup: function () {
    const now = new Date();

    return this.find({
      $or: [
        {
          "privacySettings.autoDeleteMessages": true,
          "analytics.lastActivityAt": {
            $lt: new Date(now - 24 * 60 * 60 * 1000), // 24 hours ago
          },
        },
      ],
      isDeleted: false,
    });
  },
};

// Static methods for ConversationParticipant
conversationParticipantSchema.statics = {
  // Get conversation participants
  getConversationParticipants: function (conversationId, options = {}) {
    const { includeLeft = false, role = null } = options;

    const query = {
      conversation: conversationId,
      ...(role && { role: role }),
      ...(!includeLeft && { leftAt: { $exists: false } }),
    };

    return this.find(query)
      .populate("user", "username fullName profilePicture")
      .populate("identity", "messageAlias displayName avatar")
      .sort({ joinedAt: 1 });
  },

  // Get user's role in conversation
  getUserRole: function (conversationId, userId) {
    return this.findOne({
      conversation: conversationId,
      user: userId,
      leftAt: { $exists: false },
    }).select("role permissions");
  },

  // Get conversation admins
  getConversationAdmins: function (conversationId) {
    return this.find({
      conversation: conversationId,
      role: { $in: ["admin", "owner"] },
      leftAt: { $exists: false },
    }).populate("user", "username fullName");
  },

  // Update participant role
  updateParticipantRole: function (conversationId, userId, newRole) {
    return this.findOneAndUpdate(
      {
        conversation: conversationId,
        user: userId,
        leftAt: { $exists: false },
      },
      { role: newRole },
      { new: true }
    );
  },
};

// Static methods for DirectMessage
directMessageSchema.statics = {
  // Get conversation messages
  getConversationMessages: function (conversationId, userId, options = {}) {
    const {
      limit = 50,
      skip = 0,
      before = null,
      after = null,
      messageType = null,
    } = options;

    const query = {
      conversation: conversationId,
      isDeleted: false,
      deletedFor: { $not: { $elemMatch: { user: userId } } },
    };

    if (messageType) {
      query.messageType = messageType;
    }

    if (before) {
      query.sentAt = { $lt: before };
    }

    if (after) {
      query.sentAt = { $gt: after };
    }

    return this.find(query)
      .populate("sender", "username fullName profilePicture")
      .populate("senderIdentity", "messageAlias displayName avatar")
      .populate("replyTo")
      .populate("media")
      .sort({ sentAt: -1 })
      .skip(skip)
      .limit(limit);
  },

  // Get user's messages
  getUserMessages: function (userId, options = {}) {
    const { limit = 20, skip = 0, conversationId = null } = options;

    const query = {
      sender: userId,
      isDeleted: false,
      ...(conversationId && { conversation: conversationId }),
    };

    return this.find(query)
      .populate("conversation", "conversationName conversationType")
      .sort({ sentAt: -1 })
      .skip(skip)
      .limit(limit);
  },

  // Search messages
  searchMessages: function (conversationId, searchQuery, userId, options = {}) {
    const { limit = 20, skip = 0 } = options;

    return this.find({
      conversation: conversationId,
      content: { $regex: searchQuery, $options: "i" },
      isDeleted: false,
      deletedFor: { $not: { $elemMatch: { user: userId } } },
    })
      .populate("sender", "username fullName")
      .sort({ sentAt: -1 })
      .skip(skip)
      .limit(limit);
  },

  // Get messages for cleanup (expired/auto-delete)
  getMessagesForCleanup: function () {
    const now = new Date();

    return this.find({
      $or: [
        {
          autoDeleteAt: { $lt: now },
        },
        {
          "disappearing.isDisappearing": true,
          "disappearing.disappearAt": { $lt: now },
        },
        {
          "secretChat.isSelfDestructed": false,
          "secretChat.selfDestructAt": { $lt: now },
        },
      ],
      isDeleted: false,
    });
  },

  // Get unread messages for user
  getUnreadMessages: function (userId, conversationId = null) {
    const query = {
      readBy: { $not: { $elemMatch: { user: userId } } },
      sender: { $ne: userId },
      isDeleted: false,
      deletedFor: { $not: { $elemMatch: { user: userId } } },
    };

    if (conversationId) {
      query.conversation = conversationId;
    }

    return this.find(query)
      .populate("conversation", "conversationName conversationType")
      .populate("sender", "username fullName")
      .sort({ sentAt: -1 });
  },

  // Get message statistics
  getMessageStats: function (conversationId, options = {}) {
    const { startDate = null, endDate = null } = options;

    const matchQuery = {
      conversation: conversationId,
      isDeleted: false,
    };

    if (startDate || endDate) {
      matchQuery.sentAt = {};
      if (startDate) matchQuery.sentAt.$gte = startDate;
      if (endDate) matchQuery.sentAt.$lte = endDate;
    }

    return this.aggregate([
      { $match: matchQuery },
      {
        $group: {
          _id: null,
          totalMessages: { $sum: 1 },
          totalReactions: { $sum: { $size: "$reactions" } },
          messageTypes: {
            $push: "$messageType",
          },
          avgReactionsPerMessage: {
            $avg: { $size: "$reactions" },
          },
        },
      },
      {
        $addFields: {
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
  },
};

// Pre-save middleware to calculate effective days
userMessageIdentitySchema.pre("save", function (next) {
  if (this.isModified("messageAlias")) {
    this.messageAlias = this.messageAlias.toLowerCase().trim();
  }

  // Calculate effective days for auto-delete
  if (this.isModified("privacySettings.autoDeleteSettings")) {
    const settings = this.privacySettings.autoDeleteSettings;

    if (settings.enabled && settings.preset) {
      const presetToDays = {
        "1_day": 1,
        "1_week": 7,
        "1_month": 30,
        custom: settings.customDays || 0,
      };

      settings.effectiveDays = presetToDays[settings.preset] || 0;
    } else {
      settings.effectiveDays = 0;
    }
  }

  next();
});

conversationSchema.pre("save", function (next) {
  // Update peak participants
  if (this.participantCount > this.analytics.peakParticipants) {
    this.analytics.peakParticipants = this.participantCount;
  }
  next();
});

directMessageSchema.pre("save", function (next) {
  // Set auto-delete time based on conversation settings
  if (this.isNew && !this.autoDeleteAt) {
    // This would need to be set based on conversation's auto-delete settings
    // Implementation depends on your business logic
  }

  // Update delivery status
  if (this.isModified("readBy") && this.readBy.length > 0) {
    this.deliveryStatus = "read";
  }

  next();
});

// TTL indexes for automatic cleanup
directMessageSchema.index({ autoDeleteAt: 1 }, { expireAfterSeconds: 0 });
directMessageSchema.index(
  { "disappearing.disappearAt": 1 },
  { expireAfterSeconds: 0 }
);

// Export models
export const UserMessageIdentity = mongoose.model(
  "UserMessageIdentity",
  userMessageIdentitySchema
);
export const ChatTheme = mongoose.model("ChatTheme", chatThemeSchema);
export const UserThemePreference = mongoose.model(
  "UserThemePreference",
  userThemePreferenceSchema
);
export const Conversation = mongoose.model("Conversation", conversationSchema);
export const ConversationParticipant = mongoose.model(
  "ConversationParticipant",
  conversationParticipantSchema
);
export const DirectMessage = mongoose.model(
  "DirectMessage",
  directMessageSchema
);

// Additional models for supporting features
const messageReactionSchema = new Schema(
  {
    message: {
      type: Schema.Types.ObjectId,
      ref: "DirectMessage",
      required: true,
    },
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    emoji: {
      type: String,
      required: true,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

const screenshotLogSchema = new Schema(
  {
    conversation: {
      type: Schema.Types.ObjectId,
      ref: "Conversation",
      required: true,
    },
    message: {
      type: Schema.Types.ObjectId,
      ref: "DirectMessage",
    },
    detectedUser: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    detectionMethod: {
      type: String,
      enum: ["screenshot", "screen_recording", "external_camera", "copy_paste"],
      required: true,
    },
    deviceInfo: {
      userAgent: String,
      platform: String,
      timestamp: {
        type: Date,
        default: Date.now,
      },
    },
    notificationSent: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

const messageDeletionLogSchema = new Schema(
  {
    message: {
      type: Schema.Types.ObjectId,
      ref: "DirectMessage",
      required: true,
    },
    conversation: {
      type: Schema.Types.ObjectId,
      ref: "Conversation",
      required: true,
    },
    deletedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    deletionType: {
      type: String,
      enum: ["manual", "auto", "self_destruct", "admin", "system"],
      required: true,
    },
    deletionReason: String,
    affectedUsers: [
      {
        type: Schema.Types.ObjectId,
        ref: "User",
      },
    ],
    isPermanent: {
      type: Boolean,
      default: true,
    },
    backupLocation: String, // For compliance/legal requirements
  },
  {
    timestamps: true,
  }
);

const autoDeleteScheduleSchema = new Schema(
  {
    conversation: {
      type: Schema.Types.ObjectId,
      ref: "Conversation",
      required: true,
    },
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    deleteAfterHours: {
      type: Number,
      required: true,
      min: 1,
      max: 8760, // 1 year
    },
    lastCleanupAt: {
      type: Date,
    },
    nextCleanupAt: {
      type: Date,
      required: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    messagesDeleted: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);

// Export supporting models
export const MessageReaction = mongoose.model(
  "MessageReaction",
  messageReactionSchema
);
export const ScreenshotLog = mongoose.model(
  "ScreenshotLog",
  screenshotLogSchema
);
export const MessageDeletionLog = mongoose.model(
  "MessageDeletionLog",
  messageDeletionLogSchema
);
export const AutoDeleteSchedule = mongoose.model(
  "AutoDeleteSchedule",
  autoDeleteScheduleSchema
);
