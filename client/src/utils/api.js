export async function fetchWithAuth(url, options = {}) {
  const user = JSON.parse(localStorage.getItem('user'));
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers
  };

  if (user?.token) {
    headers.Authorization = `Bearer ${user.token}`;
  }

  const response = await fetch(url, {
    ...options,
    headers
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || 'Request failed');
  }

  return response.json();
}