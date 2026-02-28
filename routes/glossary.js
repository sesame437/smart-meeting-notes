const { Router } = require("express");
const crypto = require("crypto");
const glossaryStore = require("../services/glossary-store");

const router = Router();

// Param validation middleware: id must be non-empty, max 100 chars
function validateIdParam(req, res, next) {
  const id = req.params.id;
  if (!id || typeof id !== "string" || id.length > 100) {
    return res.status(400).json({ error: { code: "INVALID_ID", message: "Invalid id parameter" } });
  }
  next();
}
router.param("id", validateIdParam);

// List glossary terms
router.get("/", async (_req, res, next) => {
  try {
    const items = await glossaryStore.listGlossary();
    res.json(items);
  } catch (err) {
    next(err);
  }
});

// Add term
router.post("/", async (req, res, next) => {
  try {
    const { term, definition, aliases } = req.body;
    const item = {
      termId: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
    };
    if (term !== undefined) item.term = term;
    if (definition !== undefined) item.definition = definition;
    if (aliases !== undefined) item.aliases = aliases;
    await glossaryStore.createGlossaryItem(item);
    res.status(201).json(item);
  } catch (err) {
    next(err);
  }
});

// Update term
router.put("/:id", async (req, res, next) => {
  try {
    if (req.body.term === undefined || req.body.term === null || req.body.term === "") {
      return res.status(400).json({ error: { code: "MISSING_TERM", message: "term is required" } });
    }
    const { term, definition, aliases } = req.body;
    const expressions = [];
    const names = {};
    const values = {};

    if (term !== undefined) {
      expressions.push("#t = :t");
      names["#t"] = "term";
      values[":t"] = term;
    }
    if (definition !== undefined) {
      expressions.push("#d = :d");
      names["#d"] = "definition";
      values[":d"] = definition;
    }
    if (aliases !== undefined) {
      expressions.push("#a = :a");
      names["#a"] = "aliases";
      values[":a"] = aliases;
    }

    expressions.push("updatedAt = :u");
    values[":u"] = new Date().toISOString();

    const updatedItem = await glossaryStore.updateGlossaryItem(req.params.id, expressions, names, values);
    res.json(updatedItem);
  } catch (err) {
    next(err);
  }
});

// Delete term
router.delete("/:id", async (req, res, next) => {
  try {
    await glossaryStore.deleteGlossaryItem(req.params.id);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
