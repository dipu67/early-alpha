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
  asyncHandler(async (req, res) => {
    // full=1 exports every follow_snapshot (can be multi‑GB and OOM the process).
    // Default is compact: latest snapshot per watched account only.
    const full =
      req.query.full === "1" ||
      req.query.full === "true" ||
      req.query.fullSnapshots === "1";

    console.log(`[backup:export] start compact=${!full}`);
    const t0 = Date.now();

    let backup;
    try {
      backup = await exportDatabase({ fullSnapshots: full });
    } catch (err) {
      console.error("[backup:export] failed:", err);
      throw err instanceof Error
        ? err
        : new Error(String(err));
    }

    // BigInts already stringified in exportDatabase.serializeRow
    let payload: string;
    try {
      payload = JSON.stringify(backup);
    } catch (err) {
      console.error("[backup:export] stringify failed:", err);
      throw new HttpError(
        500,
        "export_stringify_failed — try compact export (default) without full=1",
      );
    }

    const filename = `early-alpha-backup-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.json`;
    res.status(200);
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Length", Buffer.byteLength(payload, "utf8"));
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Backup-Compact", backup.compact ? "1" : "0");
    if (backup.warnings.length) {
      res.setHeader("X-Backup-Warnings", backup.warnings.join(" | ").slice(0, 900));
    }
    console.log(
      `[backup:export] done rows=${Object.values(backup.counts).reduce((a, b) => a + b, 0)} ` +
        `bytes=${payload.length} ms=${Date.now() - t0}`,
    );
    res.send(payload);
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
