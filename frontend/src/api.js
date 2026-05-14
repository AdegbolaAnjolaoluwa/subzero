const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export const apiCall = async (endpoint, options = {}) => {
  const url = `${API_URL}${endpoint}`;
  const response = await fetch(url, {
    credentials: 'include',
    ...options,
  });
  return response;
};

export const apiGet = (endpoint) => apiCall(endpoint);
export const apiPost = (endpoint, body) => apiCall(endpoint, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});
export const apiDelete = (endpoint) => apiCall(endpoint, { method: 'DELETE' });
