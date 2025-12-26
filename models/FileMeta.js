const mongoose = require('mongoose');

const FileMetaSchema = new mongoose.Schema({
  fileName: { type: String, required: true },      // saved file name on disk
  originalName: { type: String, required: true },  // original client file name
  mimeType: { type: String, required: true },
  size: { type: Number, required: true },
  path: { type: String, required: true },          // relative or absolute path
  createdBy: { type: String },   // store user id or name
  updatedBy: { type: String },
  description: { type: String },
  archived: { type: Boolean, default: false },
  likesCount: { type: Number, default: 0 },
  commentsCount: { type: Number, default: 0 },
  sharesCount: { type: Number, default: 0 },
  uploadedAt: { type: Date, default: Date.now },
  contestId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Contest',
    default: null
  },
  isSubmission: {
    type: Boolean,
    default: false
  },
  cloudId: { type: String }, // Useful for deleting or transforming images later
  visibility: {
    type: String,
    enum: ['public', 'private'],
    default: 'public'
  },
  title: { type: String, default: '' },
  category: { type: String, default: 'other' },
  location: { type: String, default: '' },
  peopleCount: { type: Number, default: 0 },



}, {
  timestamps: { createdAt: 'uploadedAt', updatedAt: 'updatedAt' }
});

module.exports = mongoose.model('FileMeta', FileMetaSchema);
