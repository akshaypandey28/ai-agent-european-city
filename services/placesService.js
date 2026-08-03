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
// a broken URL as if it were bookable.
// ---------------------------------------------------------------------------
async function isUrlLive(url, timeoutMs = 4000) {
  if (!url) return false;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    let res = await fetch(url, {
      method: 'HEAD',
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': 'AITravelAgent/1.0' }
    });

    if (res.status === 405 || res.status === 501) {
      res = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        signal: controller.signal,
        headers: { 'User-Agent': 'AITravelAgent/1.0' }
      });
    }

    return res.ok || (res.status >= 300 && res.status < 400);
  } catch (err) {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchAllNearbyFoodSpots(lat, lon) {
  try {
    const overpassUrl = 'https://overpass-api.de/api/interpreter';
    const query = `
      [out:json][timeout:15];
      node["amenity"~"restaurant|cafe|bakery|bar|pub"](around:1000, ${lat}, ${lon});
      out 40;
    `;

    const response = await fetch(overpassUrl, {
      method: 'POST',
      headers: {
        'User-Agent': 'AITravelAgent/1.0',
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: `data=${encodeURIComponent(query)}`
    });

    const text = await response.text();

    if (!response.ok || text.startsWith('<')) {
      console.warn('Overpass API returned non-JSON response:', text.substring(0, 100));
      return { restaurants: [], cafes: [] };
    }

    const data = JSON.parse(text);

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
          bookingUrl: live ? r.candidateWebsite : r.googleMapsUrl,
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