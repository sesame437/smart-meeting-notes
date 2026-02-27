const { Router } = require("express");
const coreRouter = require("./core");
const reportRouter = require("./report");
const emailRouter = require("./email");

const router = Router();

router.use(coreRouter);
router.use(reportRouter);
router.use(emailRouter);

module.exports = router;
