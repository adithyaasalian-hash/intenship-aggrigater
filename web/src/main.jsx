import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import App from './App.jsx';
import { api } from './api/client.js';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: (failureCount, error) => (error?.status === 401 ? false : failureCount < 2),
    },
  },
});

// Warm the ML container the moment anyone lands on the page. A free-tier
// Python host sleeps after ~15 minutes and takes 30-50 seconds to wake -- you
// want that happening while someone reads the landing page, not while a judge
// watches an upload spinner. Failure here is fine and deliberately silent.
api.health().catch(() => {});

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
