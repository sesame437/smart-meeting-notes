const fs = require("fs");

// Mock fluent-ffmpeg before requiring the module
const mockOn = jest.fn();
const mockSave = jest.fn();
const mockInputOptions = jest.fn();
const mockAudioCodec = jest.fn();
const mockFormat = jest.fn();
const mockInput = jest.fn();
const mockFfmpegInstance = {
  input: mockInput,
  inputOptions: mockInputOptions,
  audioCodec: mockAudioCodec,
  format: mockFormat,
  on: mockOn,
  save: mockSave,
};

// Setup chaining
mockInput.mockReturnValue(mockFfmpegInstance);
mockInputOptions.mockReturnValue(mockFfmpegInstance);
mockAudioCodec.mockReturnValue(mockFfmpegInstance);
mockFormat.mockReturnValue(mockFfmpegInstance);
mockOn.mockReturnValue(mockFfmpegInstance);

jest.mock("fluent-ffmpeg", () => {
  return jest.fn(() => mockFfmpegInstance);
});

const { mergeAudioFiles } = require("../services/ffmpeg");

describe("ffmpeg-service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset on() to allow multiple event listeners
    mockOn.mockReturnValue(mockFfmpegInstance);
  });

  describe("mergeAudioFiles", () => {
    it("should throw error when filePaths is not an array", async () => {
      await expect(mergeAudioFiles(null, "/tmp/output.ogg")).rejects.toThrow("filePaths must be a non-empty array");
    });

    it("should throw error when filePaths is empty", async () => {
      await expect(mergeAudioFiles([], "/tmp/output.ogg")).rejects.toThrow("filePaths must be a non-empty array");
    });

    it("should throw error when outputPath is not provided", async () => {
      await expect(mergeAudioFiles(["/tmp/file1.mp3"], "")).rejects.toThrow("outputPath must be a non-empty string");
    });

    it("should copy file directly when only one file provided", async () => {
      const inputFile = "/tmp/input.mp3";
      const outputFile = "/tmp/output.ogg";

      // Mock fs.promises.copyFile
      jest.spyOn(fs.promises, "copyFile").mockResolvedValueOnce();

      const result = await mergeAudioFiles([inputFile], outputFile);

      expect(result).toBe(outputFile);
      expect(fs.promises.copyFile).toHaveBeenCalledWith(inputFile, outputFile);
      expect(mockSave).not.toHaveBeenCalled();

      fs.promises.copyFile.mockRestore();
    });

    it("should merge multiple files using ffmpeg concat", async () => {
      const inputFiles = ["/tmp/file1.mp3", "/tmp/file2.mp3", "/tmp/file3.mp3"];
      const outputFile = "/tmp/merged.ogg";
      const concatListPath = expect.stringMatching(/\/tmp\/concat-\d+\.txt$/);

      // Mock fs.promises.writeFile
      jest.spyOn(fs.promises, "writeFile").mockResolvedValueOnce();
      jest.spyOn(fs.promises, "unlink").mockResolvedValueOnce();

      // Setup ffmpeg event simulation
      mockOn.mockImplementation((event, callback) => {
        if (event === "end") {
          // Simulate successful completion
          process.nextTick(() => callback());
        }
        return mockFfmpegInstance;
      });

      const resultPromise = mergeAudioFiles(inputFiles, outputFile);
      const result = await resultPromise;

      expect(result).toBe(outputFile);
      expect(fs.promises.writeFile).toHaveBeenCalledWith(
        concatListPath,
        "file '/tmp/file1.mp3'\nfile '/tmp/file2.mp3'\nfile '/tmp/file3.mp3'",
        "utf-8"
      );
      expect(mockInput).toHaveBeenCalledWith(concatListPath);
      expect(mockInputOptions).toHaveBeenCalledWith(["-f", "concat", "-safe", "0"]);
      expect(mockAudioCodec).toHaveBeenCalledWith("libopus");
      expect(mockFormat).toHaveBeenCalledWith("ogg");
      expect(mockSave).toHaveBeenCalledWith(outputFile);
      expect(fs.promises.unlink).toHaveBeenCalledWith(concatListPath);

      fs.promises.writeFile.mockRestore();
      fs.promises.unlink.mockRestore();
    });

    it("should handle ffmpeg merge error and cleanup", async () => {
      const inputFiles = ["/tmp/file1.mp3", "/tmp/file2.mp3"];
      const outputFile = "/tmp/merged.ogg";
      const concatListPath = expect.stringMatching(/\/tmp\/concat-\d+\.txt$/);

      jest.spyOn(fs.promises, "writeFile").mockResolvedValueOnce();
      jest.spyOn(fs.promises, "unlink").mockResolvedValue();
      jest.spyOn(fs, "existsSync").mockReturnValue(true);

      // Setup ffmpeg error simulation
      mockOn.mockImplementation((event, callback) => {
        if (event === "error") {
          process.nextTick(() => callback(new Error("ffmpeg merge failed")));
        }
        return mockFfmpegInstance;
      });

      await expect(mergeAudioFiles(inputFiles, outputFile)).rejects.toThrow("ffmpeg merge failed");

      // Verify cleanup was attempted
      expect(fs.promises.unlink).toHaveBeenCalledWith(concatListPath);
      expect(fs.promises.unlink).toHaveBeenCalledWith(outputFile);

      fs.promises.writeFile.mockRestore();
      fs.promises.unlink.mockRestore();
      fs.existsSync.mockRestore();
    });

    it("should handle cleanup errors gracefully", async () => {
      const inputFiles = ["/tmp/file1.mp3"];
      const outputFile = "/tmp/output.ogg";

      jest.spyOn(fs.promises, "copyFile").mockResolvedValueOnce();

      const result = await mergeAudioFiles(inputFiles, outputFile);

      expect(result).toBe(outputFile);

      fs.promises.copyFile.mockRestore();
    });
  });
});
