const BASE = import.meta.env.VITE_API_URL ?? '/api';

export class ApiError extends Error {
  constructor(message, status, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

async function request(path, { method = 'GET', body, formData, signal } = {}) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    // Without this the auth cookie is never sent and every request looks
    // signed-out. It is the single most common reason a working local build
    // "stops working" once deployed.
    credentials: 'include',
    signal,
    ...(formData
      ? { body: formData }
      : body !== undefined
        ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
        : {}),
  });

  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new ApiError(
      payload?.error ?? `Request failed (${response.status})`,
      response.status,
      payload?.details,
    );
  }
  return payload;
}

const qs = (params) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value === undefined || value === null || value === '' || value === false) continue;
    search.set(key, Array.isArray(value) ? value.join(',') : String(value));
  }
  const string = search.toString();
  return string ? `?${string}` : '';
};

export const api = {
  health: () => request('/health'),

  register: (body) => request('/auth/register', { method: 'POST', body }),
  login: (body) => request('/auth/login', { method: 'POST', body }),
  logout: () => request('/auth/logout', { method: 'POST' }),
  session: () => request('/auth/session'),

  me: () => request('/me'),
  updateProfile: (body) => request('/me/profile', { method: 'PATCH', body }),
  uploadResume: (file) => {
    const form = new FormData();
    form.append('resume', file);
    return request('/me/resume', { method: 'POST', formData: form });
  },

  feed: (params) => request(`/feed${qs(params)}`),
  insights: () => request('/feed/insights'),

  opportunities: (params) => request(`/opportunities${qs(params)}`),
  opportunity: (id) => request(`/opportunities/${id}`),
  stats: () => request('/opportunities/stats'),

  applications: () => request('/applications'),
  saveApplication: (body) => request('/applications', { method: 'POST', body }),
  updateApplication: (id, body) => request(`/applications/${id}`, { method: 'PATCH', body }),
  removeApplication: (id) => request(`/applications/${id}`, { method: 'DELETE' }),
};
