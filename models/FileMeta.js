const mongoose = require('mongoose');

const FileMetaSchema = new mongoose.Schema({
  fileName: { type: String, required: true },      // saved file name on disk
  originalName: { type: String, required: true },  // original client file name
  mimeType: { type: String, required: true },
  size: { type: Number, required: true },
  path: { type: String, required: true },          // relative or absolute path
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    index: true
  },
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  description: { type: String },
  archived: { type: Boolean, default: false },
  likesCount: { type: Number, default: 0 },
  commentsCount: { type: Number, default: 0 },
  sharesCount: { type: Number, default: 0 },
  // uploadedAt: { type: Date, default: Date.now },
  event: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Contest',
    default: null,
    index: true,
  },
  isSubmission: {
    type: Boolean,
    default: false,
    index: true
  },
  cloudId: { type: String },
  visibility: {
    type: String,
    enum: ['public', 'private'],
    default: 'public',
    index: true

  },
  title: { type: String, default: '' },
  subtitle: { type: String, default: '' },
  category: { type: String, default: 'other' },
  location: { type: String, default: '' },
  peopleCount: { type: Number, default: 0 },
  isVideo: { type: Boolean, default: false },
  thumbnailPath: { type: String },
  thumbnailUrl: { type: String },
  aspectRatio: { type: Number, default: 9 / 16 },
  blurHash: { type: String },
  isCurated: { type: Boolean, default: false },


}, {
  timestamps: { createdAt: 'uploadedAt', updatedAt: 'updatedAt' }
});

FileMetaSchema.index({ event: 1, isSubmission: 1 });
FileMetaSchema.index({ createdBy: 1, uploadedAt: -1 });
FileMetaSchema.index({ visibility: 1, likesCount: -1, uploadedAt: -1 });
FileMetaSchema.index({ isCurated: 1, uploadedAt: -1 });


module.exports = mongoose.model('FileMeta', FileMetaSchema);
