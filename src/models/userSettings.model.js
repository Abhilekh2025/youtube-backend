import mongoose, { Schema } from "mongoose";

// User Settings Schema for MongoDB
//  Stores user preferences for privacy, notifications, and app display

const userSettingsSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },

    //privacy setting

    privacy: {
      isPrivateProfile: {
        type: Boolean,
        default: false,
      },
      showActivityStatus: {
        type: Boolean,
        default: true,
      },
      allowTags: {
        type: Boolean,
        default: true,
      },
    },

    //content settings

    content: {
      showSensitiveContent: {
        type: Boolean,
        default: false,
      },
      muteComments: {
        type: Boolean,
        default: false,
      },
    },

    // Notification settings

    notifications: {
      push: {
        type: Boolean,
        default: true,
      },
      email: {
        type: Boolean,
        default: true,
      },
      likes: {
        type: Boolean,
        default: true,
      },
      comments: {
        type: Boolean,
        default: true,
      },
      follows: {
        type: Boolean,
        default: true,
      },
    },

    //display settings

    display: {
      darkMode: {
        type: Boolean,
        default: false,
      },
      language: {
        type: String,
        default: "en_US",
      },
    },

    //security settings

    security: {
      twoFactorAuth: {
        type: Boolean,
        default: false,
      },
      loginNotifications: {
        type: Boolean,
        default: true,
      },
    },
  },
  {
    timestamps: true,
    collection: "userSettings",
  }
);

// Create index for faster lookups
//userSettingsSchema.index({ userId: 1 });

// Instance method to get settings in flattened structure
userSettingsSchema.methods.toFlattenedObject = function () {
  return {
    isPrivateProfile: this.privacy.isPrivateProfile,
    showActivityStatus: this.privacy.showActivityStatus,
    allowTags: this.privacy.allowTags,
    showSensitiveContent: this.content.showSensitiveContent,
    muteComments: this.content.muteComments,
    pushNotifications: this.notifications.push,
    emailNotifications: this.notifications.email,
    likeNotifications: this.notifications.likes,
    commentNotifications: this.notifications.comments,
    followNotifications: this.notifications.follows,
    darkMode: this.display.darkMode,
    language: this.display.language,
    twoFactorAuth: this.security.twoFactorAuth,
    loginNotifications: this.security.loginNotifications,
  };
};

// Static method to get or create user settings
userSettingsSchema.statics.getOrCreateSettings = async function (userId) {
  let settings = await this.findOne({ userId });

  if (!settings) {
    settings = new UserSetting({ userId });
    await settings.save();
  }

  return settings;
};

export const UserSetting = mongoose.model("UserSetting", userSettingsSchema);
