import { ZodError } from 'zod';

/** Wrap an async route so a rejected promise reaches the error handler
 *  instead of hanging the request. */
export const asyncRoute = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

export function notFound(_req, res) {
  res.status(404).json({ error: 'Not found.' });
}

export function errorHandler(err, _req, res, _next) {
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: 'That request was not valid.',
      details: err.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
    });
  }
  if (err?.code === 11000) {
    return res.status(409).json({ error: 'That already exists.' });
  }
  if (err?.status && err.status < 600) {
    return res.status(err.status).json({ error: err.message });
  }

  console.error('[error]', err);
  return res.status(500).json({ error: 'Something went wrong on our side.' });
}

export function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}
