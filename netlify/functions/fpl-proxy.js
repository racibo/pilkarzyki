var FPL_BASE = "https://fantasy.premierleague.com/api";
var VAASTAV_BASE = "https://raw.githubusercontent.com/vaastav/Fantasy-Premier-League/master/data";
var cache = {};
var vcache = {};

function isCacheValid(entry, ttlMs) {
  return entry && Date.now() - entry.ts < ttlMs;
}
var ROUTES = {
  "bootstrap-static": { ttl: 60 * 60 * 1e3 },
  "fixtures": { ttl: 60 * 60 * 1e3 }
};
function getTtl(path) {
  const base = path.split("?")[0];
  for (const [key, val] of Object.entries(ROUTES)) {
    if (base.includes(key)) return val.ttl;
  }
  return 30 * 60 * 1e3;
}

// vaastav CSV files never change once a gameweek is finished — safe to cache
// for a long time. Kept shorter than "forever" in case of corrections/PRs.
var VAASTAV_TTL = 6 * 60 * 60 * 1e3; // 6h

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type"
      }
    };
  }

  const vpath = event.queryStringParameters?.vpath;
  const path = event.queryStringParameters?.path;

  // ---- Route 1: vaastav CSV passthrough (data/{season}/...) ----
  if (vpath) {
    // Allow only safe relative CSV paths under data/, e.g. "2025-26/gws/gw3.csv"
    const safeVpath = vpath.replace(/[^a-zA-Z0-9/_\-\.]/g, "");
    if (!safeVpath.endsWith(".csv") || safeVpath.includes("..")) {
      return {
        statusCode: 400,
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({ error: "Invalid vpath" })
      };
    }

    if (isCacheValid(vcache[safeVpath], VAASTAV_TTL)) {
      return {
        statusCode: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Access-Control-Allow-Origin": "*",
          "X-Cache": "HIT"
        },
        body: vcache[safeVpath].data
      };
    }

    try {
      const url = `${VAASTAV_BASE}/${safeVpath}`;
      const res = await fetch(url, {
        headers: { "User-Agent": "FPL-Scout/1.0" }
      });
      if (!res.ok) {
        return {
          statusCode: res.status,
          headers: { "Access-Control-Allow-Origin": "*" },
          body: JSON.stringify({ error: `vaastav returned ${res.status}`, status: res.status, vpath: safeVpath })
        };
      }
      const text = await res.text();
      vcache[safeVpath] = { data: text, ts: Date.now() };
      return {
        statusCode: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Access-Control-Allow-Origin": "*",
          "X-Cache": "MISS"
        },
        body: text
      };
    } catch (err) {
      return {
        statusCode: 502,
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({ error: err.message })
      };
    }
  }

  // ---- Route 2: official FPL API passthrough (unchanged) ----
  if (!path) {
    return {
      statusCode: 400,
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ error: "Missing 'path' or 'vpath' query parameter" })
    };
  }
  const safePath = path.replace(/[^a-zA-Z0-9/_\-\.?&=]/g, "");
  const ttl = getTtl(safePath);
  if (isCacheValid(cache[safePath], ttl)) {
    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "X-Cache": "HIT"
      },
      body: JSON.stringify(cache[safePath].data)
    };
  }
  try {
    const url = `${FPL_BASE}/${safePath}`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": "FPL-Scout/1.0",
        Accept: "application/json"
      }
    });
    if (!res.ok) {
      return {
        statusCode: res.status,
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({ error: `FPL API returned ${res.status}`, status: res.status })
      };
    }
    const data = await res.json();
    cache[safePath] = { data, ts: Date.now() };
    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "X-Cache": "MISS"
      },
      body: JSON.stringify(data)
    };
  } catch (err) {
    return {
      statusCode: 502,
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ error: err.message })
    };
  }
};
