const { Router } = require("express");
const { validateIdParam } = require("./helpers");
const registerCore = require("./core");
const registerReport = require("./report");
const registerEmail = require("./email");

const router = Router();
router.param("id", validateIdParam);

registerCore(router);
registerReport(router);
registerEmail(router);

module.exports = router;
