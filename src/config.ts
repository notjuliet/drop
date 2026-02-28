export const config = {
  port: parseInt(process.env.PORT || "3000"),
  dataDir: process.env.DATA_DIR || "./data",
  maxFileSize: parseInt(process.env.MAX_FILE_SIZE || "524288000"), // 500MB
  maxTtl: process.env.MAX_TTL || "30d",
  rateLimitWindowS: parseInt(process.env.RATE_LIMIT_WINDOW_S || "3600"), // 1 hour
  rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX || "20"),
};
