import { Media } from "../models/media.model.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { uploadOnCloudinary } from "../utils/cloudinary.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import fs from "fs";

// Upload media file(s)
const uploadMedia = asyncHandler(async (req, res) => {
  // Get user and media details from request
  const { mediaType, altText, metadata, tags, copyrightStatus, accessControl } =
    req.body;
  const userId = req.user._id;

  if (!req.file && (!req.files || req.files.length === 0)) {
    throw new ApiError(400, "Media file is required");
  }

  if (!mediaType || !["image", "video", "audio", "gif"].includes(mediaType)) {
    throw new ApiError(400, "Valid media type is required");
  }

  // Get file from request (handling both single file and multiple files)
  const files = req.file ? [req.file] : req.files;

  // Parse metadata if provided
  let parsedMetadata = {};
  if (metadata && typeof metadata === "string") {
    try {
      parsedMetadata = JSON.parse(metadata);
    } catch (error) {
      throw new ApiError(400, "Invalid metadata format");
    }
  } else if (metadata) {
    parsedMetadata = metadata;
  }

  // Parse tags if provided
  let parsedTags = [];
  if (tags && typeof tags === "string") {
    try {
      parsedTags = JSON.parse(tags);
    } catch (error) {
      throw new ApiError(400, "Invalid tags format");
    }
  } else if (tags) {
    parsedTags = tags;
  }

  // Parse access control if provided
  let parsedAccessControl = { isPublic: true };
  if (accessControl && typeof accessControl === "string") {
    try {
      parsedAccessControl = JSON.parse(accessControl);
    } catch (error) {
      throw new ApiError(400, "Invalid access control format");
    }
  } else if (accessControl) {
    parsedAccessControl = accessControl;
  }

  // Process each file
  const uploadPromises = files.map(async (file) => {
    // Debug: Log the file object to see its structure
    console.log("File object structure:", JSON.stringify(file, null, 2));

    // Check if path exists, otherwise look for alternative properties
    const localFilePath = file.path;

    if (!localFilePath) {
      console.error("File object missing path:", file);
      throw new ApiError(
        400,
        `Upload failed for file: ${file.originalname} - Missing file path`
      );
    }

    // Upload file to Cloudinary
    const cloudinaryResponse = await uploadOnCloudinary(localFilePath);

    if (!cloudinaryResponse || !cloudinaryResponse.url) {
      throw new ApiError(500, "Error uploading media to Cloudinary");
    }

    // Create media document
    const media = await Media.create({
      user: userId,
      mediaType,
      url: cloudinaryResponse.url,
      filename: cloudinaryResponse.public_id || file.filename,
      originalFilename: file.originalname,
      mimeType: file.mimetype,
      size: cloudinaryResponse.bytes || file.size,
      dimensions: {
        width: cloudinaryResponse.width,
        height: cloudinaryResponse.height,
      },
      duration: cloudinaryResponse.duration,
      thumbnail: cloudinaryResponse.thumbnail
        ? {
            url: cloudinaryResponse.thumbnail.url,
            width: cloudinaryResponse.thumbnail.width,
            height: cloudinaryResponse.thumbnail.height,
          }
        : undefined,
      altText,
      metadata: {
        ...parsedMetadata,
        dateTaken: parsedMetadata.dateTaken || new Date(),
      },
      tags: parsedTags,
      copyrightStatus: copyrightStatus || "all_rights_reserved",
      accessControl: parsedAccessControl,
      storageDetails: {
        provider: "cloudinary",
        bucket: cloudinaryResponse.cloud_name || "default",
        path: cloudinaryResponse.public_id,
        versions: [
          {
            quality: "original",
            url: cloudinaryResponse.url,
            width: cloudinaryResponse.width,
            height: cloudinaryResponse.height,
            size: cloudinaryResponse.bytes,
          },
        ],
      },
    });

    // Clean up local temporary file
    fs.unlinkSync(localFilePath);
    return media;
  });

  // Wait for all uploads to complete
  const uploadedMedia = await Promise.all(uploadPromises);

  // Return response
  return res
    .status(201)
    .json(new ApiResponse(201, uploadedMedia, "Media uploaded successfully"));
});

// Get media by ID
const getMediaById = asyncHandler(async (req, res) => {
  const { mediaId } = req.params;

  if (!mediaId) {
    throw new ApiError(400, "Media ID is required");
  }

  const media = await Media.findById(mediaId);

  if (!media) {
    throw new ApiError(404, "Media not found");
  }

  // Check if media is public or user has access
  if (
    !media.accessControl.isPublic &&
    (!req.user ||
      (media.user.toString() !== req.user._id.toString() &&
        !media.accessControl.visibleTo.includes(req.user._id)))
  ) {
    throw new ApiError(403, "You do not have permission to access this media");
  }

  return res
    .status(200)
    .json(new ApiResponse(200, media, "Media fetched successfully"));
});

// Get all media for current user
const getUserMedia = asyncHandler(async (req, res) => {
  const {
    mediaType,
    limit = 20,
    page = 1,
    includeArchived = false,
  } = req.query;

  const skip = (parseInt(page) - 1) * parseInt(limit);

  const options = {
    limit: parseInt(limit),
    skip,
    mediaType: mediaType || null,
    includeArchived: includeArchived === "true",
  };

  const media = await Media.getUserMedia(req.user._id, options);
  const totalCount = await Media.countDocuments({
    user: req.user._id,
    isDeleted: false,
    ...(options.mediaType ? { mediaType: options.mediaType } : {}),
    ...(!options.includeArchived ? { isArchived: false } : {}),
  });

  return res
    .status(200)
    .json(
      new ApiResponse(
        200,
        { media, totalCount, page: parseInt(page), limit: parseInt(limit) },
        "User media fetched successfully"
      )
    );
});

// Update media details
const updateMedia = asyncHandler(async (req, res) => {
  const { mediaId } = req.params;
  const { altText, metadata, copyrightStatus, accessControl, isArchived } =
    req.body;

  if (!mediaId) {
    throw new ApiError(400, "Media ID is required");
  }

  const media = await Media.findById(mediaId);

  if (!media) {
    throw new ApiError(404, "Media not found");
  }

  // Check if user owns the media
  if (media.user.toString() !== req.user._id.toString()) {
    throw new ApiError(403, "You do not have permission to update this media");
  }

  // Update fields if provided
  if (altText !== undefined) {
    media.altText = altText;
  }

  if (metadata) {
    let parsedMetadata;
    if (typeof metadata === "string") {
      try {
        parsedMetadata = JSON.parse(metadata);
      } catch (error) {
        throw new ApiError(400, "Invalid metadata format");
      }
    } else {
      parsedMetadata = metadata;
    }
    await media.updateMetadata(parsedMetadata);
  }

  if (copyrightStatus) {
    media.copyrightStatus = copyrightStatus;
  }

  if (accessControl) {
    let parsedAccessControl;
    if (typeof accessControl === "string") {
      try {
        parsedAccessControl = JSON.parse(accessControl);
      } catch (error) {
        throw new ApiError(400, "Invalid access control format");
      }
    } else {
      parsedAccessControl = accessControl;
    }
    media.accessControl = {
      ...media.accessControl,
      ...parsedAccessControl,
    };
  }

  if (isArchived !== undefined) {
    media.isArchived = isArchived;
  }

  await media.save();

  return res
    .status(200)
    .json(new ApiResponse(200, media, "Media updated successfully"));
});

// Apply filter or adjustments to media
const applyFilterToMedia = asyncHandler(async (req, res) => {
  const { mediaId } = req.params;
  const { filterName, adjustments } = req.body;

  if (!mediaId) {
    throw new ApiError(400, "Media ID is required");
  }

  if (!filterName && !adjustments) {
    throw new ApiError(400, "Either filter name or adjustments are required");
  }

  const media = await Media.findById(mediaId);

  if (!media) {
    throw new ApiError(404, "Media not found");
  }

  // Check if user owns the media
  if (media.user.toString() !== req.user._id.toString()) {
    throw new ApiError(403, "You do not have permission to update this media");
  }

  // Apply filter and/or adjustments
  await media.applyFilter(filterName, adjustments);

  return res
    .status(200)
    .json(new ApiResponse(200, media, "Filter applied successfully"));
});

//Tag/untag a user in media

const toggleUserTag = asyncHandler(async (req, res) => {
  const { mediaId } = req.params;
  const { userId, x, y, action = "add" } = req.body;

  if (!mediaId || !userId) {
    throw new ApiError(400, "Media ID and User ID are required");
  }

  const media = await Media.findById(mediaId);

  if (!media) {
    throw new ApiError(404, "Media not found");
  }

  //only media owner or tagged user can toggle tags
  if (
    media.user.toString() !== req.user._id.toString() &&
    userId !== req.user._id.toString()
  ) {
    throw new ApiError(
      403,
      "You do not have permission to tag/untag users in this media"
    );
  }

  let updatedMedia;

  if (action === "add") {
    updatedMedia = await media.addUserTag(userId, x, y);
    return res
      .status(200)
      .json(new ApiResponse(200, updatedMedia, "User tagged successfully"));
  } else if (action === "remove") {
    updatedMedia = await media.removeUserTag(userId);
    return res
      .status(200)
      .json(new ApiResponse(200, updatedMedia, "User untagged successfully"));
  } else {
    throw new ApiError(400, "Invalid action. Use 'add' or 'remove'");
  }
});

//Delete media (soft delete)

const deleteMedia = asyncHandler(async (req, res) => {
  const { mediaId } = req.params;

  if (!mediaId) {
    throw new ApiError(400, "Media ID is required");
  }

  const media = await Media.findById(mediaId);

  if (!media) {
    throw new ApiError(404, "Media not found");
  }

  //Check if user owns the media

  if (media.user.toString() !== req.user._id.toString()) {
    throw new ApiError(403, "You do not have permission to delete this media");
  }

  //Soft delete
  media.isDeleted = true;
  await media.save();

  return res
    .status(200)
    .json(new ApiResponse(200, {}, "Media deleted successfully"));
});

//Get media by location
const getMediaByLocation = asyncHandler(async (req, res) => {
  const {
    longitude,
    latitude,
    distance = 1000,
    limit = 20,
    page = 1,
  } = req.query;

  if (!longitude || !latitude) {
    throw new ApiError(400, "Longitude and latitude are required");
  }

  const coordinates = [parseFloat(longitude), parseFloat(latitude)];
  const maxDistance = parseInt(distance);
  const skip = (parseInt(page) - 1) * parseInt(limit);

  const options = {
    limit: parseInt(limit),
    skip,
  };

  const media = await Media.getMediaNearLocation(
    coordinates,
    maxDistance,
    options
  );
  return res
    .status(200)
    .json(
      new ApiResponse(200, media, "Location-based media fetched successfully")
    );
});

// Upload multiple media files at once

const uploadMultipleMedia = asyncHandler(async (req, res) => {
  const { mediaType } = req.body;
  const userId = req.user._id;

  if (!req.files || req.files.length === 0) {
    throw new ApiError(400, "Media files are required");
  }

  if (!mediaType || !["image", "video", "audio", "gif"].includes(mediaType)) {
    throw new ApiError(400, "Valid media type is required");
  }

  const uploadPromises = req.files.map(async (file) => {
    const localFilePath = file.path;

    if (!localFilePath) {
      return null;
    }

    // Upload file to Cloudinary
    const cloudinaryResponse = await uploadOnCloudinary(localFilePath);

    if (!cloudinaryResponse || !cloudinaryResponse.url) {
      return null;
    }

    //Create media document
    const media = await Media.create({
      user: userId,
      mediaType,
      url: cloudinaryResponse.url,
      filename: cloudinaryResponse.public_id || file.filename,
      originalFileman: file.originalname,
      mimeType: file.mimetype,
      size: cloudinaryResponse.bytes || file.size,
      dimensions: {
        width: cloudinaryResponse.width,
        height: cloudinaryResponse.height,
      },
      duration: cloudinaryResponse.duration,
      thumbnail: cloudinaryResponse.thumbnail
        ? {
            url: cloudinaryResponse.thumbnail.url,
            width: cloudinaryResponse.thumbnail.width,
            height: cloudinaryResponse.thumbnail.height,
          }
        : undefined,
      storageDetails: {
        provider: "cloudinary",
        bucket: cloudinaryResponse.cloud_name || "default",
        path: cloudinaryResponse.public_id,
        versions: [
          {
            quality: "original",
            url: cloudinaryResponse.url,
            width: cloudinaryResponse.width,
            height: cloudinaryResponse.height,
            size: cloudinaryResponse.bytes,
          },
        ],
      },
    });

    // Clean up local temporary file
    fs.unlinkSync(localFilePath);

    return media;
  });

  const uploadedMedia = await Promise.all(uploadPromises);
  const successfulUploads = uploadedMedia.filter((media) => media !== null);

  if (successfulUploads.length === 0) {
    throw new ApiError(500, "Failed to upload any media files");
  }

  return res.status(201).json(
    new ApiResponse(
      201,
      {
        media: successfulUploads,
        totalUploaded: successfulUploads.length,
        totalFailed: req.files.length - successfulUploads.length,
      },
      "Media files uploaded successfully"
    )
  );
});

export {
  uploadMedia,
  getMediaById,
  getUserMedia,
  updateMedia,
  applyFilterToMedia,
  toggleUserTag,
  deleteMedia,
  getMediaByLocation,
  uploadMultipleMedia,
};
