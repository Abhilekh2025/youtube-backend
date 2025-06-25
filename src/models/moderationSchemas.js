// Advanced Moderation Database Schemas
// This file contains all the MongoDB schemas for advanced content moderation,
// threat detection, and security monitoring systems.

import mongoose from "mongoose";

// Content Flag Schema for illicit content detection
const contentFlagSchema = new mongoose.Schema(
  {
    message: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "DirectMessage",
      required: true,
    },
    conversation: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Conversation",
      required: true,
    },
    flaggedUser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    analysisType: {
      type: String,
      enum: ["text", "image", "comprehensive"],
      default: "comprehensive",
    },
    riskScore: {
      type: Number,
      min: 0,
      max: 1,
      required: true,
    },
    flags: [
      {
        type: String,
        category: String,
        severity: String,
        confidence: Number,
      },
    ],
    analysis: {
      textAnalysis: {
        drugIndicators: [mongoose.Schema.Types.Mixed],
        terrorismIndicators: [mongoose.Schema.Types.Mixed],
        violenceIndicators: [mongoose.Schema.Types.Mixed],
        weaponsIndicators: [mongoose.Schema.Types.Mixed],
        traffickingIndicators: [mongoose.Schema.Types.Mixed],
        financialCrimeIndicators: [mongoose.Schema.Types.Mixed],
        sentiment: mongoose.Schema.Types.Mixed,
        toxicity: Number,
        codewordMatches: [mongoose.Schema.Types.Mixed],
        suspiciousPatterns: [mongoose.Schema.Types.Mixed],
      },
      imageAnalysis: {
        illicitSubstances: [mongoose.Schema.Types.Mixed],
        weapons: [mongoose.Schema.Types.Mixed],
        violentContent: [mongoose.Schema.Types.Mixed],
        exploitativeMaterial: [mongoose.Schema.Types.Mixed],
        documentForgery: [mongoose.Schema.Types.Mixed],
        confidence: Number,
      },
      behaviorAnalysis: {
        messagingPatterns: mongoose.Schema.Types.Mixed,
        riskFactors: [mongoose.Schema.Types.Mixed],
        networkAnalysis: mongoose.Schema.Types.Mixed,
        temporalPatterns: mongoose.Schema.Types.Mixed,
        suspiciousActivity: [mongoose.Schema.Types.Mixed],
      },
      threatCategories: [String],
      confidence: Number,
      processingTime: Number,
    },
    status: {
      type: String,
      enum: ["pending", "confirmed", "false_positive", "resolved", "escalated"],
      default: "pending",
    },
    severity: {
      type: String,
      enum: ["low", "medium", "high", "critical"],
      default: "medium",
    },
    reviewRequired: {
      type: Boolean,
      default: false,
    },
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    reviewedAt: Date,
    reviewNotes: {
      type: String,
      maxlength: 2000,
    },
    moderationAction: {
      type: String,
      enum: [
        "none",
        "warn",
        "hide_message",
        "block_user",
        "report_authorities",
        "emergency_block",
        "preserve_evidence",
      ],
      default: "none",
    },
    autoActions: [String],
    autoActionResults: [mongoose.Schema.Types.Mixed],
    flaggedBy: {
      type: String,
      enum: [
        "system",
        "user_report",
        "manual_review",
        "system_scan",
        "ai_detection",
      ],
      default: "system",
    },
    escalated: {
      type: Boolean,
      default: false,
    },
    escalatedAt: Date,
    escalatedTo: {
      type: String,
      enum: ["law_enforcement", "ncmec", "admin", "legal_team"],
    },
    evidencePreserved: {
      type: Boolean,
      default: false,
    },
    evidenceLocation: String,
    scanId: String,
    relatedFlags: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "ContentFlag",
      },
    ],
    confidence: {
      type: Number,
      min: 0,
      max: 1,
      default: 0.5,
    },
  },
  {
    timestamps: true,
  }
);

// Suspicious Activity Flag Schema
const suspiciousActivityFlagSchema = new mongoose.Schema(
  {
    flaggedUser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    conversation: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Conversation",
    },
    activityType: {
      type: String,
      enum: [
        "drug_trafficking",
        "terrorism_planning",
        "weapons_dealing",
        "human_trafficking",
        "child_exploitation",
        "financial_crimes",
        "coordinated_attack",
        "recruitment",
        "suspicious_behavior",
        "money_laundering",
        "identity_fraud",
        "cybercrime",
      ],
      required: true,
    },
    severity: {
      type: String,
      enum: ["low", "medium", "high", "critical"],
      default: "medium",
    },
    description: {
      type: String,
      required: true,
      maxlength: 1000,
    },
    evidence: [
      {
        messageId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "DirectMessage",
        },
        evidenceType: String,
        description: String,
        preservedAt: Date,
      },
    ],
    riskScore: {
      type: Number,
      min: 0,
      max: 1,
      required: true,
    },
    flaggedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    status: {
      type: String,
      enum: [
        "pending",
        "investigating",
        "confirmed",
        "false_positive",
        "resolved",
        "escalated",
      ],
      default: "pending",
    },
    priority: {
      type: String,
      enum: ["low", "normal", "high", "urgent", "emergency"],
      default: "normal",
    },
    investigationNotes: [
      {
        note: String,
        addedBy: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
        },
        addedAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],
    metadata: {
      detectionMethod: {
        type: String,
        enum: [
          "manual",
          "ai_detection",
          "pattern_matching",
          "user_report",
          "system_scan",
        ],
      },
      flaggedAt: Date,
      requiresReview: Boolean,
      autoEscalated: Boolean,
      mlConfidence: Number,
      behaviorPatterns: [String],
      networkConnections: [mongoose.Schema.Types.Mixed],
    },
    followUpRequired: {
      type: Boolean,
      default: false,
    },
    followUpDate: Date,
    assignedInvestigator: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  },
  {
    timestamps: true,
  }
);

// Security Alert Schema
const securityAlertSchema = new mongoose.Schema(
  {
    alertId: {
      type: String,
      unique: true,
      required: true,
    },
    category: {
      type: String,
      enum: [
        "terrorism",
        "drug_trafficking",
        "weapons_trafficking",
        "human_trafficking",
        "child_exploitation",
        "financial_crimes",
        "coordinated_threats",
        "emergency_action",
        "system_security",
        "data_breach",
        "account_compromise",
        "mass_reporting",
      ],
      required: true,
    },
    severity: {
      type: String,
      enum: ["info", "low", "medium", "high", "critical", "emergency"],
      required: true,
    },
    title: {
      type: String,
      required: true,
      maxlength: 200,
    },
    description: {
      type: String,
      required: true,
      maxlength: 2000,
    },
    relatedUser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    relatedConversation: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Conversation",
    },
    relatedMessages: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "DirectMessage",
      },
    ],
    relatedFlags: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "ContentFlag",
      },
    ],
    metadata: {
      detectionSource: String,
      automaticDetection: Boolean,
      riskScore: Number,
      threatVector: String,
      geolocation: {
        country: String,
        region: String,
        city: String,
      },
      deviceInfo: mongoose.Schema.Types.Mixed,
      networkInfo: mongoose.Schema.Types.Mixed,
    },
    status: {
      type: String,
      enum: [
        "active",
        "investigating",
        "resolved",
        "escalated",
        "dismissed",
        "pending_review",
      ],
      default: "active",
    },
    acknowledgedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    acknowledgedAt: Date,
    escalatedAt: Date,
    escalatedTo: String,
    resolvedAt: Date,
    resolvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    resolution: String,
    requiresReview: {
      type: Boolean,
      default: true,
    },
    actionsTaken: [String],
    notificationsSent: [
      {
        recipient: String,
        method: String,
        sentAt: Date,
        delivered: Boolean,
      },
    ],
  },
  {
    timestamps: true,
  }
);

// Law Enforcement Report Schema
const lawEnforcementReportSchema = new mongoose.Schema(
  {
    contentFlag: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ContentFlag",
      required: true,
    },
    message: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "DirectMessage",
      required: true,
    },
    reportedUser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    conversation: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Conversation",
      required: true,
    },
    reportedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    caseId: {
      type: String,
      required: true,
      unique: true,
    },
    externalCaseId: String,
    externalAgency: {
      type: String,
      enum: [
        "fbi",
        "dea",
        "atf",
        "ice",
        "local_police",
        "interpol",
        "ncmec",
        "other",
      ],
    },
    urgency: {
      type: String,
      enum: ["routine", "priority", "urgent", "emergency"],
      default: "priority",
    },
    threatCategories: [String],
    riskScore: Number,
    reportData: {
      messageContent: String,
      messageType: String,
      sentAt: Date,
      userInfo: {
        userId: String,
        username: String,
        fullName: String,
        email: String,
        phoneNumber: String,
        registrationDate: Date,
        lastActive: Date,
        ipAddresses: [String],
        deviceFingerprints: [String],
      },
      analysisResults: mongoose.Schema.Types.Mixed,
      additionalEvidence: [
        {
          type: String,
          description: String,
          location: String,
          collectedAt: Date,
        },
      ],
      additionalInfo: String,
      contactInfo: {
        reporterName: String,
        reporterEmail: String,
        reporterPhone: String,
        organizationName: String,
      },
      legalBasis: String,
      preservationRequest: Boolean,
    },
    status: {
      type: String,
      enum: [
        "draft",
        "submitted",
        "acknowledged",
        "investigating",
        "additional_info_requested",
        "closed",
        "failed",
        "rejected",
      ],
      default: "draft",
    },
    submittedAt: Date,
    submissionResult: {
      success: Boolean,
      responseCode: String,
      responseMessage: String,
      confirmationNumber: String,
      submissionMethod: String,
    },
    lawEnforcementResponse: {
      responseDate: Date,
      caseStatus: String,
      investigatorContact: String,
      additionalRequests: [String],
      feedbackProvided: String,
    },
    followUpRequired: {
      type: Boolean,
      default: false,
    },
    followUpDate: Date,
    preservationNotice: {
      issued: Boolean,
      issuedAt: Date,
      expiresAt: Date,
      scope: String,
    },
    disclosure: {
      authorized: Boolean,
      authorizedAt: Date,
      authorizedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
      legalProcess: String,
      disclosedData: [String],
    },
  },
  {
    timestamps: true,
  }
);

// User Suspension Schema
const userSuspensionSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    suspendedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    reason: {
      type: String,
      required: true,
      maxlength: 1000,
    },
    violationType: {
      type: String,
      enum: [
        "drug_trafficking",
        "terrorism",
        "weapons_trafficking",
        "human_trafficking",
        "child_exploitation",
        "harassment",
        "spam",
        "other_illegal_activity",
      ],
    },
    severity: {
      type: String,
      enum: ["warning", "minor", "major", "severe", "critical"],
      required: true,
    },
    duration: Number, // Duration in hours, null for permanent
    suspendedAt: {
      type: Date,
      default: Date.now,
    },
    expiresAt: Date,
    isActive: {
      type: Boolean,
      default: true,
    },
    type: {
      type: String,
      enum: [
        "warning",
        "temporary_restriction",
        "temporary_ban",
        "permanent_ban",
        "emergency_block",
      ],
      default: "temporary_ban",
    },
    restrictions: {
      canSendMessages: {
        type: Boolean,
        default: false,
      },
      canCreateConversations: {
        type: Boolean,
        default: false,
      },
      canJoinConversations: {
        type: Boolean,
        default: false,
      },
      canUploadMedia: {
        type: Boolean,
        default: false,
      },
      canChangeProfile: {
        type: Boolean,
        default: false,
      },
    },
    appealable: {
      type: Boolean,
      default: true,
    },
    appealDeadline: Date,
    evidencePreserved: {
      type: Boolean,
      default: false,
    },
    relatedReports: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "LawEnforcementReport",
      },
    ],
    relatedFlags: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "ContentFlag",
      },
    ],
    automaticLifting: {
      enabled: Boolean,
      conditions: [String],
    },
    notificationsSent: [
      {
        type: String,
        sentAt: Date,
        method: String,
      },
    ],
  },
  {
    timestamps: true,
  }
);

// Moderation Rule Schema
const moderationRuleSchema = new mongoose.Schema(
  {
    ruleId: {
      type: String,
      required: true,
      unique: true,
    },
    ruleType: {
      type: String,
      enum: [
        "drug_detection",
        "terrorism_detection",
        "violence_detection",
        "weapons_detection",
        "trafficking_detection",
        "financial_crime_detection",
        "behavioral_analysis",
        "risk_thresholds",
        "auto_actions",
        "content_filtering",
      ],
      required: true,
    },
    name: {
      type: String,
      required: true,
      maxlength: 200,
    },
    description: {
      type: String,
      maxlength: 1000,
    },
    patterns: [
      {
        pattern: String,
        type: {
          type: String,
          enum: ["keyword", "regex", "phrase", "context"],
        },
        weight: Number,
        caseSensitive: Boolean,
      },
    ],
    thresholds: {
      lowRisk: Number,
      mediumRisk: Number,
      highRisk: Number,
      criticalRisk: Number,
    },
    autoActions: [
      {
        trigger: String,
        action: String,
        parameters: mongoose.Schema.Types.Mixed,
      },
    ],
    conditions: {
      messageTypes: [String],
      conversationTypes: [String],
      userRoles: [String],
      timeRestrictions: mongoose.Schema.Types.Mixed,
    },
    enabled: {
      type: Boolean,
      default: true,
    },
    priority: {
      type: Number,
      default: 100,
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    lastUpdated: {
      type: Date,
      default: Date.now,
    },
    version: {
      type: Number,
      default: 1,
    },
    effectiveness: {
      detectionRate: Number,
      falsePositiveRate: Number,
      truePositiveCount: Number,
      falsePositiveCount: Number,
      lastEvaluated: Date,
      performanceScore: Number,
    },
    testing: {
      lastTested: Date,
      testResults: mongoose.Schema.Types.Mixed,
      benchmarkScore: Number,
    },
  },
  {
    timestamps: true,
  }
);

// Threat Database Schema
const threatDatabaseSchema = new mongoose.Schema(
  {
    threatId: {
      type: String,
      required: true,
      unique: true,
    },
    threatType: {
      type: String,
      enum: [
        "drug_keywords",
        "terrorism_indicators",
        "violence_patterns",
        "weapons_terms",
        "trafficking_signals",
        "financial_crime_patterns",
        "code_words",
        "suspicious_behaviors",
        "exploitation_indicators",
        "recruitment_patterns",
      ],
      required: true,
    },
    category: {
      type: String,
      enum: ["keyword", "phrase", "pattern", "behavior", "network", "temporal"],
      required: true,
    },
    patterns: [
      {
        value: String,
        language: String,
        context: String,
        variations: [String],
      },
    ],
    severity: {
      type: String,
      enum: ["low", "medium", "high", "critical"],
      required: true,
    },
    confidence: {
      type: Number,
      min: 0,
      max: 1,
      default: 0.8,
    },
    source: {
      type: String,
      enum: [
        "manual",
        "ml_detected",
        "law_enforcement",
        "intelligence",
        "community",
        "osint",
      ],
      default: "manual",
    },
    sourceDetails: {
      agency: String,
      reportId: String,
      reliability: String,
      classification: String,
    },
    description: {
      type: String,
      maxlength: 1000,
    },
    context: {
      type: String,
      maxlength: 500,
    },
    addedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    verifiedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    verifiedAt: Date,
    version: {
      type: Number,
      default: 1,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    effectiveness: {
      detectionCount: {
        type: Number,
        default: 0,
      },
      falsePositiveCount: {
        type: Number,
        default: 0,
      },
      lastDetection: Date,
      accuracyScore: Number,
    },
    geographicScope: [String],
    languages: [String],
    expiresAt: Date,
    relatedThreats: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "ThreatDatabase",
      },
    ],
  },
  {
    timestamps: true,
  }
);

// User Behavior Analysis Schema
const userBehaviorAnalysisSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    analyzedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    analysisType: {
      type: String,
      enum: ["routine", "targeted", "investigation", "risk_assessment"],
      default: "routine",
    },
    analysisDepth: {
      type: Number,
      default: 30, // days
    },
    riskScore: {
      type: Number,
      min: 0,
      max: 1,
      required: true,
    },
    riskFactors: [
      {
        factor: String,
        weight: Number,
        severity: String,
        description: String,
      },
    ],
    analysis: {
      messagingPatterns: {
        dailyMessageCount: Number,
        averageMessageLength: Number,
        conversationCount: Number,
        timeDistribution: mongoose.Schema.Types.Mixed,
        frequencyAnalysis: mongoose.Schema.Types.Mixed,
      },
      networkAnalysis: {
        connectionCount: Number,
        flaggedConnections: Number,
        networkScore: Number,
        communicationPatterns: mongoose.Schema.Types.Mixed,
        influenceScore: Number,
      },
      contentAnalysis: {
        riskContentRatio: Number,
        topicDistribution: mongoose.Schema.Types.Mixed,
        languagePatterns: mongoose.Schema.Types.Mixed,
        sentimentAnalysis: mongoose.Schema.Types.Mixed,
      },
      temporalPatterns: {
        activityTimes: mongoose.Schema.Types.Mixed,
        sessionDuration: mongoose.Schema.Types.Mixed,
        irregularPatterns: mongoose.Schema.Types.Mixed,
      },
      deviceAnalysis: {
        deviceCount: Number,
        locationCount: Number,
        vpnUsage: Boolean,
        suspiciousDevices: Number,
      },
      suspiciousActivities: [
        {
          type: String,
          severity: String,
          description: String,
          detectedAt: Date,
          evidence: [String],
        },
      ],
    },
    recommendations: [
      {
        type: String,
        priority: String,
        description: String,
        action: String,
      },
    ],
    status: {
      type: String,
      enum: [
        "low_risk",
        "medium_risk",
        "high_risk",
        "critical_risk",
        "under_investigation",
      ],
      required: true,
    },
    requiresAction: {
      type: Boolean,
      default: false,
    },
    actionTaken: String,
    followUpDate: Date,
    monitoringLevel: {
      type: String,
      enum: ["none", "standard", "enhanced", "intensive"],
      default: "standard",
    },
    alertThresholds: {
      riskIncrease: Number,
      activitySpike: Number,
      networkChanges: Number,
    },
  },
  {
    timestamps: true,
  }
);

// Safety Report Schema
const safetyReportSchema = new mongoose.Schema(
  {
    reportId: {
      type: String,
      unique: true,
      required: true,
    },
    reportType: {
      type: String,
      enum: [
        "security_summary",
        "threat_intelligence",
        "compliance_report",
        "incident_analysis",
        "trend_analysis",
        "effectiveness_report",
        "risk_assessment",
      ],
      required: true,
    },
    generatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    timeframe: {
      type: Number,
      required: true, // days
    },
    startDate: {
      type: Date,
      required: true,
    },
    endDate: {
      type: Date,
      required: true,
    },
    scope: {
      includeUsers: Boolean,
      includeConversations: Boolean,
      includeMessages: Boolean,
      userFilter: mongoose.Schema.Types.Mixed,
      geographicFilter: [String],
    },
    data: {
      totalAnalyzed: Number,
      flaggedContent: Number,
      threatCategories: mongoose.Schema.Types.Mixed,
      riskDistribution: mongoose.Schema.Types.Mixed,
      actionsTaken: mongoose.Schema.Types.Mixed,
      trends: mongoose.Schema.Types.Mixed,
    },
    report: {
      executiveSummary: String,
      keyFindings: [String],
      threatAnalysis: mongoose.Schema.Types.Mixed,
      riskAssessment: mongoose.Schema.Types.Mixed,
      recommendations: [String],
      charts: [mongoose.Schema.Types.Mixed],
      appendices: mongoose.Schema.Types.Mixed,
    },
    status: {
      type: String,
      enum: ["generating", "completed", "failed", "scheduled"],
      default: "generating",
    },
    classification: {
      type: String,
      enum: ["unclassified", "confidential", "restricted", "secret"],
      default: "confidential",
    },
    distribution: [
      {
        recipient: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
        },
        sentAt: Date,
        method: String, // email, dashboard, secure_portal
        acknowledged: Boolean,
        acknowledgedAt: Date,
      },
    ],
    retention: {
      retainUntil: Date,
      autoDelete: Boolean,
      legalHold: Boolean,
    },
  },
  {
    timestamps: true,
  }
);

// Security Audit Log Schema
const securityAuditLogSchema = new mongoose.Schema(
  {
    logId: {
      type: String,
      unique: true,
      required: true,
    },
    action: {
      type: String,
      required: true,
    },
    category: {
      type: String,
      enum: [
        "authentication",
        "authorization",
        "content_moderation",
        "user_management",
        "system_security",
        "data_access",
        "configuration_change",
        "emergency_action",
      ],
      required: true,
    },
    actor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    actorType: {
      type: String,
      enum: ["user", "system", "admin", "ai", "external_service"],
      default: "user",
    },
    target: {
      user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
      message: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "DirectMessage",
      },
      conversation: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Conversation",
      },
      contentFlag: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "ContentFlag",
      },
    },
    details: {
      description: String,
      oldValues: mongoose.Schema.Types.Mixed,
      newValues: mongoose.Schema.Types.Mixed,
      parameters: mongoose.Schema.Types.Mixed,
      metadata: mongoose.Schema.Types.Mixed,
    },
    severity: {
      type: String,
      enum: ["info", "warning", "critical", "emergency"],
      default: "info",
    },
    riskLevel: {
      type: String,
      enum: ["none", "low", "medium", "high", "critical"],
      default: "none",
    },
    source: {
      ipAddress: String,
      userAgent: String,
      geolocation: {
        country: String,
        region: String,
        city: String,
      },
      deviceFingerprint: String,
    },
    outcome: {
      success: {
        type: Boolean,
        default: true,
      },
      errorCode: String,
      errorMessage: String,
      responseTime: Number,
    },
    compliance: {
      requiresReporting: Boolean,
      regulatoryFramework: [String],
      retentionPeriod: Number,
    },
    investigation: {
      flagged: Boolean,
      investigationId: String,
      reviewed: Boolean,
      reviewedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
      reviewedAt: Date,
    },
  },
  {
    timestamps: true,
  }
);

// Create indexes for optimal performance
contentFlagSchema.index({ riskScore: -1, status: 1 });
contentFlagSchema.index({ flaggedUser: 1, createdAt: -1 });
contentFlagSchema.index({ "analysis.threatCategories": 1 });
contentFlagSchema.index({ reviewRequired: 1, status: 1 });
contentFlagSchema.index({ severity: 1, escalated: 1 });

suspiciousActivityFlagSchema.index({ flaggedUser: 1, activityType: 1 });
suspiciousActivityFlagSchema.index({ severity: 1, status: 1 });
suspiciousActivityFlagSchema.index({ riskScore: -1 });
suspiciousActivityFlagSchema.index({ priority: 1, status: 1 });

securityAlertSchema.index({ alertId: 1 }, { unique: true });
securityAlertSchema.index({ severity: 1, status: 1 });
securityAlertSchema.index({ category: 1, createdAt: -1 });
securityAlertSchema.index({ relatedUser: 1 });
securityAlertSchema.index({ requiresReview: 1 });

lawEnforcementReportSchema.index({ caseId: 1 }, { unique: true });
lawEnforcementReportSchema.index({ status: 1, urgency: 1 });
lawEnforcementReportSchema.index({ reportedUser: 1 });
lawEnforcementReportSchema.index({ externalAgency: 1 });

userSuspensionSchema.index({ user: 1, isActive: 1 });
userSuspensionSchema.index({ expiresAt: 1 });
userSuspensionSchema.index({ type: 1, severity: 1 });
userSuspensionSchema.index({ violationType: 1 });

moderationRuleSchema.index({ ruleId: 1 }, { unique: true });
moderationRuleSchema.index({ ruleType: 1, enabled: 1 });
moderationRuleSchema.index({ priority: 1 });
moderationRuleSchema.index({ "effectiveness.performanceScore": -1 });

threatDatabaseSchema.index({ threatId: 1 }, { unique: true });
threatDatabaseSchema.index({ threatType: 1, isActive: 1 });
threatDatabaseSchema.index({ severity: 1, confidence: -1 });
threatDatabaseSchema.index({ source: 1 });
threatDatabaseSchema.index({ "effectiveness.accuracyScore": -1 });

userBehaviorAnalysisSchema.index({ user: 1, createdAt: -1 });
userBehaviorAnalysisSchema.index({ riskScore: -1 });
userBehaviorAnalysisSchema.index({ status: 1, requiresAction: 1 });
userBehaviorAnalysisSchema.index({ monitoringLevel: 1 });

safetyReportSchema.index({ reportId: 1 }, { unique: true });
safetyReportSchema.index({ reportType: 1, createdAt: -1 });
safetyReportSchema.index({ generatedBy: 1 });
safetyReportSchema.index({ status: 1 });

securityAuditLogSchema.index({ logId: 1 }, { unique: true });
securityAuditLogSchema.index({ action: 1, createdAt: -1 });
securityAuditLogSchema.index({ actor: 1 });
securityAuditLogSchema.index({ severity: 1, category: 1 });
securityAuditLogSchema.index({ "target.user": 1 });
securityAuditLogSchema.index({ "investigation.flagged": 1 });

// Export models (only create if they don't exist to avoid conflicts)
const createModel = (name, schema) => {
  try {
    return mongoose.model(name);
  } catch (error) {
    return mongoose.model(name, schema);
  }
};

export const ContentFlag = createModel("ContentFlag", contentFlagSchema);
export const SuspiciousActivityFlag = createModel(
  "SuspiciousActivityFlag",
  suspiciousActivityFlagSchema
);
export const SecurityAlert = createModel("SecurityAlert", securityAlertSchema);
export const LawEnforcementReport = createModel(
  "LawEnforcementReport",
  lawEnforcementReportSchema
);
export const UserSuspension = createModel(
  "UserSuspension",
  userSuspensionSchema
);
export const ModerationRule = createModel(
  "ModerationRule",
  moderationRuleSchema
);
export const ThreatDatabase = createModel(
  "ThreatDatabase",
  threatDatabaseSchema
);
export const UserBehaviorAnalysis = createModel(
  "UserBehaviorAnalysis",
  userBehaviorAnalysisSchema
);
export const SafetyReport = createModel("SafetyReport", safetyReportSchema);
export const SecurityAuditLog = createModel(
  "SecurityAuditLog",
  securityAuditLogSchema
);

// Additional utility schemas for specific use cases

// Message Report Schema (for user-generated reports)
const messageReportSchema = new mongoose.Schema(
  {
    message: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "DirectMessage",
      required: true,
    },
    conversation: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Conversation",
      required: true,
    },
    reportedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    reportedUser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    reason: {
      type: String,
      enum: [
        "spam",
        "harassment",
        "inappropriate",
        "fake",
        "violence",
        "drugs",
        "terrorism",
        "other",
      ],
      required: true,
    },
    description: {
      type: String,
      maxlength: 1000,
    },
    category: {
      type: String,
      enum: ["content", "user", "conversation"],
      default: "content",
    },
    status: {
      type: String,
      enum: ["pending", "under_review", "resolved", "escalated", "dismissed"],
      default: "pending",
    },
    priority: {
      type: String,
      enum: ["low", "normal", "high", "urgent"],
      default: "normal",
    },
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    reviewedAt: Date,
    reviewNotes: {
      type: String,
      maxlength: 1000,
    },
    moderationAction: {
      type: String,
      enum: ["none", "warn", "hide_message", "ban_user", "delete_message"],
      default: "none",
    },
    metadata: {
      messageType: String,
      messageContent: String,
      reportedAt: Date,
      userAgent: String,
      ipAddress: String,
      deviceFingerprint: String,
    },
    relatedReports: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "MessageReport",
      },
    ],
    escalationPath: [
      {
        level: String,
        escalatedAt: Date,
        escalatedBy: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
        },
        reason: String,
      },
    ],
  },
  {
    timestamps: true,
  }
);

// Evidence Preservation Schema
const evidencePreservationSchema = new mongoose.Schema(
  {
    preservationId: {
      type: String,
      unique: true,
      required: true,
    },
    requestedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    legalBasis: {
      type: String,
      enum: [
        "law_enforcement_request",
        "court_order",
        "emergency",
        "internal_investigation",
      ],
      required: true,
    },
    scope: {
      users: [
        {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
        },
      ],
      conversations: [
        {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Conversation",
        },
      ],
      messages: [
        {
          type: mongoose.Schema.Types.ObjectId,
          ref: "DirectMessage",
        },
      ],
      dateRange: {
        start: Date,
        end: Date,
      },
      dataTypes: [String],
    },
    status: {
      type: String,
      enum: ["active", "expired", "released", "extended"],
      default: "active",
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
    preservedData: {
      location: String,
      encryption: Boolean,
      hash: String,
      size: Number,
      format: String,
    },
    legalProcess: {
      caseNumber: String,
      court: String,
      attorney: String,
      processType: String,
      processDate: Date,
    },
    access: [
      {
        accessedBy: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
        },
        accessedAt: Date,
        purpose: String,
        authorization: String,
      },
    ],
  },
  {
    timestamps: true,
  }
);

// Threat Intelligence Feed Schema
const threatIntelligenceFeedSchema = new mongoose.Schema(
  {
    feedId: {
      type: String,
      unique: true,
      required: true,
    },
    source: {
      name: String,
      type: {
        type: String,
        enum: [
          "government",
          "law_enforcement",
          "private",
          "open_source",
          "community",
        ],
      },
      reliability: {
        type: String,
        enum: ["A", "B", "C", "D", "E", "F"], // Intelligence reliability scale
      },
      classification: String,
    },
    threatData: {
      indicators: [String],
      patterns: [String],
      behaviors: [String],
      networks: [mongoose.Schema.Types.Mixed],
    },
    threatType: {
      type: String,
      enum: [
        "terrorism",
        "drug_trafficking",
        "weapons_trafficking",
        "human_trafficking",
        "cybercrime",
        "financial_crime",
        "extremism",
      ],
      required: true,
    },
    severity: {
      type: String,
      enum: ["low", "medium", "high", "critical"],
      required: true,
    },
    confidence: {
      type: Number,
      min: 0,
      max: 1,
      required: true,
    },
    geographicScope: [String],
    validFrom: {
      type: Date,
      default: Date.now,
    },
    validUntil: Date,
    isActive: {
      type: Boolean,
      default: true,
    },
    integration: {
      integrated: Boolean,
      integratedAt: Date,
      integratedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
      effectiveness: {
        matches: Number,
        falsePositives: Number,
        lastMatch: Date,
      },
    },
    metadata: {
      receivedAt: Date,
      processedAt: Date,
      version: String,
      tags: [String],
    },
  },
  {
    timestamps: true,
  }
);

// ML Model Performance Schema
const mlModelPerformanceSchema = new mongoose.Schema(
  {
    modelId: {
      type: String,
      unique: true,
      required: true,
    },
    modelName: {
      type: String,
      required: true,
    },
    modelType: {
      type: String,
      enum: [
        "text_classifier",
        "image_classifier",
        "behavior_analyzer",
        "risk_scorer",
      ],
      required: true,
    },
    version: {
      type: String,
      required: true,
    },
    trainedOn: Date,
    deployedAt: Date,
    lastEvaluated: Date,
    performance: {
      accuracy: Number,
      precision: Number,
      recall: Number,
      f1Score: Number,
      auc: Number,
      falsePositiveRate: Number,
      falseNegativeRate: Number,
    },
    testResults: {
      testSetSize: Number,
      truePositives: Number,
      trueNegatives: Number,
      falsePositives: Number,
      falseNegatives: Number,
    },
    production: {
      totalPredictions: Number,
      averageConfidence: Number,
      processingTime: Number,
      errorRate: Number,
      lastUsed: Date,
    },
    retraining: {
      required: Boolean,
      lastRetrained: Date,
      nextRetraining: Date,
      performanceDegradation: Boolean,
    },
    status: {
      type: String,
      enum: ["training", "testing", "deployed", "deprecated", "error"],
      default: "training",
    },
  },
  {
    timestamps: true,
  }
);

// Create indexes for utility schemas
messageReportSchema.index({ message: 1, reportedBy: 1 }, { unique: true });
messageReportSchema.index({ status: 1, priority: 1 });
messageReportSchema.index({ reportedUser: 1 });
messageReportSchema.index({ createdAt: -1 });

evidencePreservationSchema.index({ preservationId: 1 }, { unique: true });
evidencePreservationSchema.index({ status: 1, expiresAt: 1 });
evidencePreservationSchema.index({ "scope.users": 1 });
evidencePreservationSchema.index({ requestedBy: 1 });

threatIntelligenceFeedSchema.index({ feedId: 1 }, { unique: true });
threatIntelligenceFeedSchema.index({ threatType: 1, severity: 1 });
threatIntelligenceFeedSchema.index({ isActive: 1, validUntil: 1 });
threatIntelligenceFeedSchema.index({ "source.type": 1 });

mlModelPerformanceSchema.index({ modelId: 1 }, { unique: true });
mlModelPerformanceSchema.index({ modelType: 1, status: 1 });
mlModelPerformanceSchema.index({ "performance.accuracy": -1 });
mlModelPerformanceSchema.index({ lastEvaluated: 1 });

// Export utility models
export const MessageReport = createModel("MessageReport", messageReportSchema);
export const EvidencePreservation = createModel(
  "EvidencePreservation",
  evidencePreservationSchema
);
export const ThreatIntelligenceFeed = createModel(
  "ThreatIntelligenceFeed",
  threatIntelligenceFeedSchema
);
export const MLModelPerformance = createModel(
  "MLModelPerformance",
  mlModelPerformanceSchema
);

// Schema validation helpers
export const ValidationHelpers = {
  isValidRiskScore: (score) => score >= 0 && score <= 1,
  isValidThreatCategory: (category) =>
    [
      "terrorism",
      "drug_trafficking",
      "weapons_trafficking",
      "human_trafficking",
      "child_exploitation",
      "financial_crimes",
    ].includes(category),
  isValidSeverity: (severity) =>
    ["low", "medium", "high", "critical"].includes(severity),
  isValidStatus: (status, allowedStatuses) => allowedStatuses.includes(status),
};

// Default configurations
export const DefaultConfigurations = {
  riskThresholds: {
    low: 0.3,
    medium: 0.6,
    high: 0.8,
    critical: 0.95,
  },
  autoActionThresholds: {
    autoFlag: 0.7,
    autoBlock: 0.9,
    autoReport: 0.95,
  },
  preservationPeriods: {
    standard: 90, // days
    lawEnforcement: 180,
    legal: 365,
    emergency: 30,
  },
  alertSeverityMapping: {
    terrorism: "critical",
    child_exploitation: "critical",
    drug_trafficking: "high",
    weapons_trafficking: "high",
    human_trafficking: "high",
    financial_crimes: "medium",
  },
};

// Export all schemas for direct access if needed
export const Schemas = {
  contentFlagSchema,
  suspiciousActivityFlagSchema,
  securityAlertSchema,
  lawEnforcementReportSchema,
  userSuspensionSchema,
  moderationRuleSchema,
  threatDatabaseSchema,
  userBehaviorAnalysisSchema,
  safetyReportSchema,
  securityAuditLogSchema,
  messageReportSchema,
  evidencePreservationSchema,
  threatIntelligenceFeedSchema,
  mlModelPerformanceSchema,
};
