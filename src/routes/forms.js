import express from "express";
import { formsController, formSubmissionsController } from "../controllers/forms-controller.js";
import { resourceRoute } from "./resource-route.js";

const router = express.Router();
router.use("/submissions", resourceRoute(formSubmissionsController));
router.use("/", resourceRoute(formsController));
export default router;
