// Central error handler — turns thrown errors (including zod validation errors)
// into clean JSON responses. Express 5 forwards rejected async handlers here
// automatically, so route handlers can just throw.

import type { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";

/** Wrap an async route handler so thrown/rejected errors reach the error middleware. */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res, next).catch(next);
  };
}

/** A route can `throw new HttpError(404, "not found")` for a specific status. */
export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorMiddleware(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof ZodError) {
    res.status(400).json({ error: "invalid_request", issues: err.issues });
    return;
  }
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  const message = err instanceof Error ? err.message : String(err);
  console.error("[api] unhandled error:", err);
  res.status(500).json({ error: "internal_error", message });
}
