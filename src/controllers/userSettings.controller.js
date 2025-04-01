import { ApiError } from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { UserSetting } from "../models/userSettings.model.js";
import { User } from "../models/user.model.js";
import { ApiResponse } from "../utils/ApiResponse.js";

const getUserSettings = asyncHandler(async (req, res) => {
  //retreive existing user settings

  try {
    const user = await User.findById(req.user?._id);

    //console.log("email:", user.email);

    if (!user) {
      throw new ApiError(404, "User doesn't exist");
    }

    // Get or create settings if they don't exist
    const settings = await UserSetting.getOrCreateSettings(user);

    return res
      .status(201)
      .json(new ApiResponse(200, settings, "Setting Retrived Successfully"));
  } catch (error) {
    throw new ApiError(401, error?.message || "Failed to fetch user settings");
  }
});

const updateUserSettings = asyncHandler(async (req, res) => {
  //   const isPrivateProfile = req.body;
  //   console.log("isPrivateProfile ", isPrivateProfile);
  //   await User.findByIdAndUpdate(
  //     req.user._id,

  //     {
  //       $set: {
  //         isPrivateProfile: false,
  //       },
  //     },
  //     {
  //       new: true,
  //     }
  //   );
  //   const options = {
  //     httpOnly: true,
  //     secure: true,
  //   };

  //   return res
  //     .status(200)
  //     .json(new ApiResponse(200, { isPrivateProfile }, "Privacy changed"));
  // });

  try {
    const userId = req.user._id;
    let settings = await UserSetting.findOne({ userId });
    const updateData = req.body;

    if (!settings) {
      settings = new UserSetting({ userId });
    }

    // Update privacy settings
    if (updateData) {
      if (typeof updateData.isPrivateProfile === "boolean") {
        settings.privacy.isPrivateProfile = updateData.isPrivateProfile;
        // Also update the user's isPrivate flag for consistency
        await User.findByIdAndUpdate(userId, {
          isPrivate: updateData.isPrivateProfile,
        });
      }

      if (typeof updateData.showActivityStatus === "boolean") {
        settings.privacy.showActivityStatus = updateData.showActivityStatus;
      }

      if (typeof updateData.allowTags === "boolean") {
        settings.privacy.allowTags = updateData.allowTags;
      }
    }
    // Update content settings
    if (updateData) {
      if (typeof updateData.showSensitiveContent === "boolean") {
        settings.content.showSensitiveContent = updateData.showSensitiveContent;
      }

      if (typeof updateData.muteComments === "boolean") {
        settings.content.muteComments = updateData.muteComments;
      }
    }

    // // Update notification settings
    if (updateData) {
      const notificationFields = [
        "push",
        "email",
        "likes",
        "comments",
        "follows",
      ];

      notificationFields.forEach((field) => {
        if (typeof updateData.notifications[field] === "boolean") {
          settings.notifications[field] = updateData.notifications[field];
        }
      });
    }

    // // Update display settings
    if (updateData) {
      if (typeof updateData.darkMode === "boolean") {
        settings.display.darkMode = updateData.darkMode;
      }

      if (updateData.language) {
        settings.display.language = updateData.language;
      }
    }

    // Save updated settings
    await settings.save();

    // Log settings change for audit purposes
    //this.logSettingsChange(userId, updateData);

    return res.status(200).json({
      success: true,
      message: "Settings updated successfully",
      data: settings,
    });
  } catch (error) {
    throw new ApiError(401, error?.message || "Failed to update user settings");
  }
});

export { getUserSettings, updateUserSettings };
