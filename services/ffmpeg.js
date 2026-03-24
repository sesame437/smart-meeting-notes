const ffmpeg = require("fluent-ffmpeg");
const fs = require("fs");
const path = require("path");
const logger = require("./logger");

/**
 * 合并多个音频文件为一个 OGG 文件
 * @param {string[]} filePaths - 输入文件路径数组（按顺序合并）
 * @param {string} outputPath - 输出文件路径
 * @returns {Promise<string>} - 返回输出文件路径
 */
async function mergeAudioFiles(filePaths, outputPath) {
  if (!filePaths || !Array.isArray(filePaths) || filePaths.length === 0) {
    throw new Error("filePaths must be a non-empty array");
  }

  if (!outputPath || typeof outputPath !== "string") {
    throw new Error("outputPath must be a non-empty string");
  }

  // 单文件直接复制，不合并
  if (filePaths.length === 1) {
    logger.info("ffmpeg", "merge-single-file", { input: filePaths[0], output: outputPath });
    await fs.promises.copyFile(filePaths[0], outputPath);
    return outputPath;
  }

  // 生成 ffmpeg concat 列表文件
  const concatListPath = path.join(path.dirname(outputPath), `concat-${Date.now()}.txt`);
  const concatList = filePaths.map(fp => `file '${fp}'`).join("\n");
  await fs.promises.writeFile(concatListPath, concatList, "utf-8");

  logger.info("ffmpeg", "merge-start", {
    inputCount: filePaths.length,
    output: outputPath,
    concatList: concatListPath,
  });

  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(concatListPath)
      .inputOptions(["-f", "concat", "-safe", "0"])
      .audioCodec("libopus")
      .format("ogg")
      .on("start", (commandLine) => {
        logger.debug("ffmpeg", "merge-command", { commandLine });
      })
      .on("progress", (progress) => {
        if (progress.percent) {
          logger.debug("ffmpeg", "merge-progress", { percent: progress.percent });
        }
      })
      .on("end", async () => {
        logger.info("ffmpeg", "merge-complete", { output: outputPath });
        // 清理 concat 列表文件
        try {
          await fs.promises.unlink(concatListPath);
        } catch (err) {
          logger.warn("ffmpeg", "cleanup-concat-list-failed", { error: err.message });
        }
        resolve(outputPath);
      })
      .on("error", async (err) => {
        logger.error("ffmpeg", "merge-failed", { error: err.message });
        // 清理临时文件
        try {
          await fs.promises.unlink(concatListPath);
        } catch (cleanupErr) {
          logger.warn("ffmpeg", "cleanup-concat-list-failed", { error: cleanupErr.message });
        }
        if (fs.existsSync(outputPath)) {
          try {
            await fs.promises.unlink(outputPath);
          } catch (cleanupErr) {
            logger.warn("ffmpeg", "cleanup-output-failed", { error: cleanupErr.message });
          }
        }
        reject(err);
      })
      .save(outputPath);
  });
}

module.exports = { mergeAudioFiles };
