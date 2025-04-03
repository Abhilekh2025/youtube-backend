import mongoose from "mongoose";

const mediaSchema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    mediaType: {
      type: String,
      enum: ["image", "video", "audio", "gif"],
      required: true,
    },
    url: {
      type: String,
      required: true,
    },
    filename: {
      type: String,
      required: true,
    },
    originalFilename: String,
    mimeType: String,
    size: {
      type: Number, // in bytes
      required: true,
    },
    dimensions: {
      width: Number,
      height: Number,
    },
    duration: Number, // for videos/audio, in seconds
    thumbnail: {
      url: String,
      width: Number,
      height: Number,
    },
    encodingStatus: {
      type: String,
      enum: ["pending", "processing", "completed", "failed"],
      default: "completed",
    },
    altText: {
      type: String,
      trim: true,
    },
    metadata: {
      location: {
        type: {
          type: String,
          enum: ["Point"],
          default: "Point",
        },
        coordinates: {
          type: [Number], // [longitude, latitude]
          index: "2dsphere",
        },
      },
    },
    camera: String,
    iso: Number,
    aperture: String,
    shutterSpeed: String,
    focalLength: String,
    dateTaken: Date,
    isEdited: Boolean,
    filters: {
      applied: {
        type: String,
        enum: [
          "normal",
          "clarendon",
          "gingham",
          "moon",
          "lark",
          "reyes",
          "juno",
          "slumber",
          "crema",
          "ludwig",
          "aden",
          "perpetua",
          "amaro",
          "mayfair",
          "rise",
          "hudson",
          "valencia",
          "xpro2",
          "sierra",
          "willow",
          "lofi",
          "inkwell",
          "hefe",
          "nashville",
          "stinson",
          "vesper",
          "earlybird",
          "brannan",
          "sutro",
          "toaster",
          "walden",
          "nineteenSeventySeven",
          "kelvin",
          "maven",
          "ginza",
          "skyline",
          "dogpatch",
          "brooklyn",
          "helena",
          "ashby",
          "charmes",
          null,
        ],
        default: null,
      },
      adjustments: {
        brightness: { type: Number, default: 0 }, // -100 to 100
        contrast: { type: Number, default: 0 }, // -100 to 100
        saturation: { type: Number, default: 0 }, // -100 to 100
        warmth: { type: Number, default: 0 }, // -100 to 100
        structure: { type: Number, default: 0 }, // -100 to 100
        vignette: { type: Number, default: 0 }, // 0 to 100
        tiltShift: { type: Number, default: 0 }, // 0 to 100
      },
    },
    tags: [
      {
        type: Schema.Types.ObjectId,
        ref: "User",
      },
    ],
    tagCoordinates: [
      {
        user: {
          type: Schema.Types.ObjectId,
          ref: "User",
        },
        x: {
          type: Number, // percentage (0-100) from left
          min: 0,
          max: 100,
        },
        y: {
          type: Number, // percentage (0-100) from top
          min: 0,
          max: 100,
        },
      },
    ],
    copyrightStatus: {
      type: String,
      enum: ["all_rights_reserved", "creative_commons", "public_domain"],
      default: "all_rights_reserved",
    },
    moderationStatus: {
      status: {
        type: String,
        enum: ["pending", "approved", "flagged", "rejected"],
        default: "approved",
      },
    },
    reason: String,
    reviewedAt: Date,
    reviewedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    accessControl: {
      isPublic: {
        type: Boolean,
        default: true,
      },
      visibleTo: [
        {
          type: Schema.Types.ObjectId,
          ref: "User",
        },
      ],
      hiddenFrom: [
        {
          type: Schema.Types.ObjectId,
          ref: "User",
        },
      ],
    },
    storageDetails: {
      provider: {
        type: String,
        enum: ["local", "aws_s3", "google_cloud", "azure", "cloudinary"],
        default: "aws_s3",
      },
      bucket: String,
      path: String,
      versions: [
        {
          quality: String, // 'original', 'high', 'medium', 'low'
          url: String,
          width: Number,
          height: Number,
          size: Number, // in bytes
        },
      ],
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

// Indexes for better query performance
mediaSchema.index({ user: 1, createdAt: -1 });
mediaSchema.index({ mediaType: 1 });
mediaSchema.index({ "metadata.dateTaken": 1 });
mediaSchema.index({ isArchived: 1, isDeleted: 1 });
mediaSchema.index({ encodingStatus: 1 });
mediaSchema.index({ "moderationStatus.status": 1 });

// Virtual for tag count
mediaSchema.virtual("tagCount").get(function () {
  return this.tags.length;
});

// Methods
mediaSchema.methods = {
  // Check if a user is tagged in this media
  isUserTagged: function (userId) {
    return this.tags.some((tagId) => tagId.toString() === userId.toString());
  },

  // Add a user tag to the media
  addUserTag: function (userId, x = null, y = null) {
    if (!this.isUserTagged(userId)) {
      this.tags.push(userId);

      // Add coordinates if provided
      if (x !== null && y !== null) {
        this.tagCoordinates.push({
          user: userId,
          x: Math.min(Math.max(x, 0), 100), // Ensure within 0-100 range
          y: Math.min(Math.max(y, 0), 100),
        });
      }
    }
    return this.save();
  },

  // Remove a user tag from the media
  removeUserTag: function (userId) {
    this.tags = this.tags.filter(
      (tagId) => tagId.toString() !== userId.toString()
    );
    this.tagCoordinates = this.tagCoordinates.filter(
      (tag) => tag.user.toString() !== userId.toString()
    );
    return this.save();
  },

  // Update media metadata
  updateMetadata: function (metadata) {
    Object.assign(this.metadata, metadata);
    return this.save();
  },
  // Apply a filter to the media
  applyFilter: function (filterName, adjustments = {}) {
    this.filters.applied = filterName;

    if (adjustments && typeof adjustments === "object") {
      Object.keys(adjustments).forEach((key) => {
        if (this.filters.adjustments.hasOwnProperty(key)) {
          this.filters.adjustments[key] = adjustments[key];
        }
      });
    }

    return this.save();
  },
};

// Static methods
mediaSchema.statics = {
  // Get all media for a user
  getUserMedia: function (userId, options = {}) {
    const {
      limit = 20,
      skip = 0,
      mediaType = null,
      includeArchived = false,
    } = options;

    const query = {
      user: userId,
      isDeleted: false,
    };

    if (!includeArchived) {
      query.isArchived = false;
    }

    if (mediaType) {
      query.mediaType = mediaType;
    }

    return this.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit);
  },

  // Get all media with a specific tag
  getMediaWithTag: function (userId, options = {}) {
    const { limit = 20, skip = 0 } = options;

    return this.find({
      tags: userId,
      isDeleted: false,
      isArchived: false,
      "accessControl.isPublic": true,
    })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);
  },
  // Get media nearby a location
  getMediaNearLocation: function (
    coordinates,
    maxDistance = 1000,
    options = {}
  ) {
    const { limit = 20, skip = 0 } = options;

    return this.find({
      "metadata.location": {
        $near: {
          $geometry: {
            type: "Point",
            coordinates: coordinates,
          },
          $maxDistance: maxDistance, // in meters
        },
      },
      isDeleted: false,
      isArchived: false,
      "accessControl.isPublic": true,
    })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);
  },
};
// Pre-save middleware to ensure proper storage path
mediaSchema.pre("save", function (next) {
  // If this is a new media file, generate storage path if not already set
  if (
    this.isNew &&
    (!this.storageDetails.path || this.storageDetails.path === "")
  ) {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");

    // Generate path pattern like: userId/2023/05/20/filename.jpg
    this.storageDetails.path = `${this.user}/${year}/${month}/${day}/${this.filename}`;
  }

  next();
});

export const Media = mongoose.model("media", mediaSchema);
