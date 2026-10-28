// Allowed: the BFF package reads its own environment and fetches the API.
export const relay = () => fetch(`${process.env.PHOENIX_API_URL ?? ''}identity`);
