// Database backup / restore API (admin only via RBAC on the proxy).
//
//   GET  /backup/summary  -> row counts per table
//   GET  /backup/export   -> full JSON backup
//   POST /backup/import   -> restore from JSON { backup, mode: merge|replace }

import { Router } from "express";
import { z } from "zod";
import { asyncHandler, HttpError } from "../middleware/error.js";
import { jsonSafe } from "../http.js";
import {
  exportDatabase,
  getBackupSummary,
  importDatabase,
  parseBackupPayload,
} from "../services/dbBackup.js";

export const backupRouter: Router = Router();

backupRouter.get(
  "/summary",
  asyncHandler(async (_req, res) => {
    const summary = await getBackupSummary();
    res.json(jsonSafe(summary));
  }),
);

backupRouter.get(
  "/export",
  asyncHandler(async (_req, res) => {
    const backup = await exportDatabase();
    const filename = `early-alpha-backup-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.json`;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    // jsonSafe for BigInts already handled inside exportDatabase
    res.status(200).send(JSON.stringify(backup));
  }),
);

const importBody = z.object({
  /** Full backup object (or nested under `backup`). */
  backup: z.unknown().optional(),
  mode: z.enum(["merge", "replace"]).default("merge"),
}).passthrough();

backupRouter.post(
  "/import",
  asyncHandler(async (req, res) => {
    const body = importBody.parse(req.body ?? {});
    // Accept either { backup: {...}, mode } or the raw backup root.
    const raw =
      body.backup !== undefined
        ? body.backup
        : (() => {
            const { mode: _m, ...rest } = body as Record<string, unknown>;
            return rest;
          })();

    let backup;
    try {
      backup = parseBackupPayload(raw);
    } catch (err) {
      throw new HttpError(
        400,
        err instanceof Error ? err.message : "invalid_backup",
      );
    }

    const result = await importDatabase(backup, body.mode);
    res.json(
      jsonSafe({
        ok: true,
        ...result,
        sourceExportedAt: backup.exportedAt,
      }),
    );
  }),
);
