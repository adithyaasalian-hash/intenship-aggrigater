import { Application, User } from '../models/index.js';

/**
 * Shape a user document into the payload the ML service expects.
 *
 * The embedding is `select: false` on the schema, so a user loaded without it
 * would silently score every job on skills alone -- a bug that looks like "the
 * matching is bad" rather than like a missing field. Re-fetch when absent.
 */
export async function buildProfilePayload(user) {
  let embedding = user.profile?.embedding;
  if (!embedding && user.profile?.parsedAt) {
    const full = await User.findById(user._id).select('+profile.embedding').lean();
    embedding = full?.profile?.embedding ?? null;
  }

  const saved = await Application.find({ userId: user._id })
    .select('opportunityId')
    .lean();

  return {
    skills: (user.profile?.skills ?? []).map((s) => s.name),
    experienceMonths: user.profile?.experienceMonths ?? 0,
    preferences: {
      locations: user.profile?.preferences?.locations ?? [],
      remoteOk: user.profile?.preferences?.remoteOk ?? true,
      minStipend: user.profile?.preferences?.minStipend ?? null,
      domains: user.profile?.preferences?.domains ?? [],
    },
    embedding: embedding ?? null,
    savedOpportunityIds: saved.map((a) => a.opportunityId.toString()),
  };
}

/** Stable key for the feed cache, so different filters cache separately. */
export function filterKeyOf(filters) {
  return JSON.stringify({
    remoteOnly: Boolean(filters.remoteOnly),
    locations: [...(filters.locations ?? [])].sort(),
    minStipend: filters.minStipend ?? null,
    skills: [...(filters.skills ?? [])].sort(),
  });
}
