export async function geocodePlace(placeName, city) {
  try {
    const query = `${placeName}, ${city}`;
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}`;

    const response = await fetch(url, {
      headers: { 'User-Agent': 'AITravelAgent/1.0' }
    });

    if (!response.ok) return null;

    const data = await response.json();
    if (data && data.length > 0) {
      return { lat: data[0].lat, lon: data[0].lon };
    }
    return null;
  } catch (err) {
    console.error(`Geocoding error for ${placeName}:`, err);
    return null;
  }
}

// City-level fallback geocode — used when a specific landmark can't be
// resolved (bad name, or the geocoder got rate-limited). This is
// city-agnostic, unlike a hardcoded lat/lon default which silently breaks
// for every city except the one it was hardcoded for.
export async function geocodeCity(city) {
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(city)}`;
    const response = await fetch(url, { headers: { 'User-Agent': 'AITravelAgent/1.0' } });
    if (!response.ok) return null;
    const data = await response.json();
    if (data && data.length > 0) {
      return { lat: data[0].lat, lon: data[0].lon };
    }
    return null;
  } catch (err) {
    console.error(`City geocoding error for ${city}:`, err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// LINK LIVENESS CHECK: OSM's `website` tag is community-edited and frequently
// stale. We verify it actually resolves before treating it as a bookable
// link. If it's dead, we fall back to a Google Maps link instead of showing
// a broken URL.
// ---------------------------------------------------------------------------
async function isUrlLive(url, timeoutMs = 5000) {
  if (!url) return false;

  const browserHeaders = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
  };

  const attempt = async (method) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { method, redirect: 'follow', signal: controller.signal, headers: browserHeaders });
      return res.status;
    } catch (err) {
      return null; // network failure / timeout / abort
    } finally {
      clearTimeout(timeout);
    }
  };

  let status = await attempt('HEAD');

  
  if (status === null || status === 405 || status === 501 || status === 403) {
    status = await attempt('GET');
  }

  if (status === null) return false; // genuinely unreachable — real dead link

  
  if (status === 403 || status === 406) return true;

  return status >= 200 && status < 400;
}

// Multiple free public Overpass mirrors — if the primary one returns an
// error page (HTML instead of JSON), rate-limits, or times out, we retry
// against a different mirror before giving up entirely.
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter'
];

async function queryOverpass(query, timeoutMs = 12000) {
  for (const endpoint of OVERPASS_ENDPOINTS) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'User-Agent': 'AITravelAgent/1.0',
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: `data=${encodeURIComponent(query)}`
      });

      const text = await response.text();

      if (!response.ok || text.trim().startsWith('<')) {
        continue; // silently try the next mirror
      }

      return JSON.parse(text);
    } catch (err) {
      continue; // silently try the next mirror
    } finally {
      clearTimeout(timeout);
    }
  }

  return null; // every mirror failed
}

export async function fetchAllNearbyFoodSpots(lat, lon) {
  try {
    const query = `
      [out:json][timeout:15];
      node["amenity"~"restaurant|cafe|bakery|bar|pub"](around:1000, ${lat}, ${lon});
      out 40;
    `;

    const data = await queryOverpass(query);

    if (!data) {
      return { restaurants: [], cafes: [] };
    }


    if (!data.elements || data.elements.length === 0) {
      return {
        restaurants: [],
        cafes: [
          { name: "Nearby Cafe", cuisine: "Cafe", googleMapsUrl: `https://www.google.com/maps/search/?api=1&query=${lat},${lon}+cafes`, amenity: 'cafe', tags: {} }
        ]
      };
    }

    const rawRestaurants = [];
    const cafes = [];

    data.elements.forEach((place) => {
      const name = place.tags?.name || 'Local Spot';
      const cuisine = place.tags?.cuisine || 'General';
      const address = place.tags?.['addr:street'] || '';
      const amenity = place.tags?.amenity;
      const website = place.tags?.website || place.tags?.['contact:website'];

      const googleMapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${name} ${address}`)}`;

      const relevantTags = {
        highchair: place.tags?.highchair,
        outdoor_seating: place.tags?.outdoor_seating,
        takeaway: place.tags?.takeaway,
        diet_vegetarian: place.tags?.['diet:vegetarian'],
        diet_vegan: place.tags?.['diet:vegan'],
        diet_halal: place.tags?.['diet:halal'],
        diet_kosher: place.tags?.['diet:kosher'],
        diet_gluten_free: place.tags?.['diet:gluten_free']
      };

      if (amenity === 'cafe' || amenity === 'bakery') {
        cafes.push({ name, cuisine, googleMapsUrl, amenity, tags: relevantTags });
      } else if (website) {
        rawRestaurants.push({ name, cuisine, amenity, tags: relevantTags, candidateWebsite: website, googleMapsUrl });
      }
    });

    const restaurants = await Promise.all(
      rawRestaurants.map(async (r) => {
        const live = await isUrlLive(r.candidateWebsite);
        return {
          name: r.name,
          cuisine: r.cuisine,
          amenity: r.amenity,
          tags: r.tags,
          website: r.candidateWebsite, // raw OSM website — kept separately so scraping
                                        // (which goes through a remote proxy, not your
                                        // local network) isn't blocked by a local
                                        // liveness-check false negative
          bookingUrl: live ? r.candidateWebsite : r.googleMapsUrl,
          googleMapsUrl: r.googleMapsUrl,
          linkVerified: live
        };
      })
    );

    return { restaurants, cafes };
  } catch (err) {
    console.error('Error fetching food spots:', err);
    return { restaurants: [], cafes: [] };
  }
}