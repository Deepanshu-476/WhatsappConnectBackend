import express from "express";

const router = express.Router();

router.get("/:token/peek", (_req, res) => {
  res.status(404).json({ error: "Invitation not found" });
});

router.post("/:token/redeem", (_req, res) => {
  res.status(404).json({ error: "Invitation not found" });
});

export default router;

