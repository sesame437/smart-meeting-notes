const { sendMessage } = require("../../services/sqs");
const store = require("../../services/meeting-store");
const {
  TABLE,
  getMeetingById,
} = require("./helpers");

function register(router) {
  // Manually trigger email sending
  router.post("/:id/send-email", async (req, res, next) => {
    try {
      const item = await getMeetingById(req.params.id);
      if (!item) return res.status(404).json({ error: { code: "MEETING_NOT_FOUND", message: "Meeting not found" } });
      if (!item.reportKey) return res.status(400).json({ error: { code: "REPORT_NOT_GENERATED", message: "Report not generated yet" } });

      const exportQueueUrl = process.env.SQS_EXPORT_QUEUE;
      if (!exportQueueUrl) {
        return res.status(500).json({ error: { code: "QUEUE_NOT_CONFIGURED", message: "Export queue not configured" } });
      }

      // Update stage to exporting
      await store.markEmailSent(req.params.id, item.createdAt);

      await sendMessage(exportQueueUrl, {
        meetingId: req.params.id,
        reportKey: item.reportKey,
        createdAt: item.createdAt,
        meetingName: item.title || undefined,
      });

      res.json({ success: true, message: "Email sending triggered" });
    } catch (err) {
      next(err);
    }
  });
}

module.exports = register;
