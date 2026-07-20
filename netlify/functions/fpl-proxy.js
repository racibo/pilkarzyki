const FPL_BASE = "https://fantasy.premierleague.com/api";

const cache = {};

function getCacheKey(path) {
  return path;
}

function isCacheValid(entry, ttlMs) {
  return entry && Date.now() - entry.ts < ttlMs;
}

const ROUTES = {
  "bootstrap-static": { ttl: 60 * 60 * 1000 },
  "fixtures": { ttl: 60 * 60 * 1000 },
};

function getTtl(path) {
  const base = path.split("?")[0];
  for (const [key, val] of Object.entries(ROUTES)) {
    if (base.includes(key)) return val.ttl;
  }
  return 30 * 60 * 1000;
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    };
  }

  const path = event.queryStringParameters?.path;
  if (!path) {
    return {
      statusCode: 400,
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ error: "Missing 'path' query parameter" }),
    };
  }

  const safePath = path.replace(/[^a-zA-Z0-9/_\-\.?&=]/g, "");
  const ttl = getTtl(safePath);
  const key = getCacheKey(safePath);

  if (isCacheValid(cache[key], ttl)) {
    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "X-Cache": "HIT",
      },
      body: JSON.stringify(cache[key].data),
    };
  }

  try {
    const url = `${FPL_BASE}/${safePath}`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": "FPL-Scout/1.0",
        Accept: "application/json",
      },
    });

    if (!res.ok) {
      return {
        statusCode: res.status,
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({ error: `FPL API returned ${res.status}` }),
      };
    }

    const data = await res.json();
    cache[key] = { data, ts: Date.now() };

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "X-Cache": "MISS",
      },
      body: JSON.stringify(data),
    };
  } catch (err) {
    return {
      statusCode: 502,
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ error: err.message }),
    };
  }
};
