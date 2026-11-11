// Netlifyn palvelimella ajettava funktio
const ALLOWED_METHODS = new Set([
  "artist.getinfo",
  "artist.gettopalbums",
  "artist.gettoptracks",
  "album.getinfo",
]);

export async function handler(event) {
  const params = new URLSearchParams(event.queryStringParameters);

  // Päästä läpi vain ne Last.fm-metodit, joita sivu oikeasti käyttää
  if (!ALLOWED_METHODS.has(params.get("method"))) {
    return { statusCode: 400, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  params.set("api_key", process.env.LASTFM_API_KEY);
  params.set("format", "json");

  try {
    const response = await fetch(`https://ws.audioscrobbler.com/2.0/?${params}`);
    const data = await response.json();
    return {
      statusCode: response.status,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    };
  } catch {
    return { statusCode: 502, body: JSON.stringify({ error: "External API call failed" }) };
  }
}