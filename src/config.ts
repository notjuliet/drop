export const config = {
  port: parseInt(process.env.PORT || "3000"),
  dataDir: process.env.DATA_DIR || "./data",
  maxFileSize: parseInt(process.env.MAX_FILE_SIZE || "100000000"),
  maxTtl: process.env.MAX_TTL || "7d",
};
