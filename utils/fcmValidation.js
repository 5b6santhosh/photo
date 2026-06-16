const { z } = require('zod');

const registerTokenSchema = z.object({
  token: z
    .string()
    .min(1, 'Device token is required')
    .max(1000, 'Token too long')
    .trim(),
  deviceType: z
    .enum(['android', 'ios', 'web'], {
      errorMap: () => ({ message: 'deviceType must be "android", "ios", or "web"' })
    }),
  deviceName: z
    .string()
    .max(255, 'Device name too long')
    .optional()
    .nullable()
    .transform(val => val || undefined)
});

const sendNotificationSchema = z.object({
  userId: z
    .string()
    .min(1, 'User ID is required')
    .regex(/^[a-f0-9]{24}$/, 'Invalid user ID format'),
  title: z
    .string()
    .min(1, 'Title is required')
    .max(200, 'Title too long')
    .trim(),
  body: z
    .string()
    .min(1, 'Body is required')
    .max(4000, 'Body too long')
    .trim(),
  data: z
    .record(z.string())
    .optional()
    .default({})
});

const sendBatchSchema = z.object({
  tokens: z
    .array(z.string().min(1).max(1000))
    .min(1, 'At least one token required')
    .max(500, 'Maximum 500 tokens per request'),
  title: z
    .string()
    .min(1, 'Title is required')
    .max(200, 'Title too long')
    .trim(),
  body: z
    .string()
    .min(1, 'Body is required')
    .max(4000, 'Body too long')
    .trim(),
  data: z
    .record(z.string())
    .optional()
    .default({})
});

const sendDataOnlySchema = z.object({
  token: z
    .string()
    .min(1, 'Device token is required')
    .max(1000, 'Token too long')
    .trim(),
  data: z
    .record(z.string())
    .min(1, 'Data payload cannot be empty')
    .max(100, 'Too many data fields')
});

const unregisterTokenSchema = z.object({
  token: z
    .string()
    .min(1, 'Device token is required')
    .trim()
});

const sendDataWithPayloadSchema = z.object({
  token: z.string().min(1).max(1000),
  data: z.record(z.string()).min(1),
  route: z.string().optional(),
  action: z.string().optional(),
  metadata: z.record(z.unknown()).optional()
});

module.exports = {
  registerTokenSchema,
  sendNotificationSchema,
  sendBatchSchema,
  sendDataOnlySchema,
  unregisterTokenSchema,
  sendDataWithPayloadSchema
};
