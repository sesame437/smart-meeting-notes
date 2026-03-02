const { Router } = require("express");
const crypto = require("crypto");
const { z } = require("zod");
const glossaryStore = require("../services/glossary-store");

const router = Router();

// Zod schemas for validation
const glossarySchema = z.object({
  term: z.string().min(1).max(100),
  definition: z.string().min(1).max(500),
  category: z.string().max(50).optional(),
  aliases: z.union([z.array(z.string()), z.string()]).optional(),
});

const glossaryUpdateSchema = z.object({
  term: z.string().min(1).max(100),
  definition: z.string().min(1).max(500).optional(),
  category: z.string().max(50).optional(),
  aliases: z.union([z.array(z.string()), z.string()]).optional(),
});

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
router.get("/", async (req, res, next) => {
  try {
    let items = await glossaryStore.listGlossary();
    // Filter by category if provided
    if (req.query.category) {
      items = items.filter(item => item.category === req.query.category);
    }
    res.json(items);
  } catch (err) {
    next(err);
  }
});

// Add term
router.post("/", async (req, res, next) => {
  try {
    // Validate request body with zod
    const parseResult = glossarySchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        error: {
          code: "VALIDATION_ERROR",
          message: parseResult.error.message,
          fields: parseResult.error.issues.map(e => ({ field: e.path.join('.'), message: e.message }))
        }
      });
    }

    const { term, definition, category, aliases } = parseResult.data;
    const item = {
      termId: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      term,
      definition,
    };
    if (category !== undefined) item.category = category;
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
    // Validate request body with zod
    const parseResult = glossaryUpdateSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        error: {
          code: "VALIDATION_ERROR",
          message: parseResult.error.message,
          fields: parseResult.error.issues.map(e => ({ field: e.path.join('.'), message: e.message }))
        }
      });
    }

    const { term, definition, category, aliases } = parseResult.data;
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
    if (category !== undefined) {
      expressions.push("#cat = :cat");
      names["#cat"] = "category";
      values[":cat"] = category;
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
