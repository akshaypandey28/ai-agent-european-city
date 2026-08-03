// services/placesService.js

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

export async function fetchAllNearbyFoodSpots(lat, lon) {
  try {
    const overpassUrl = 'https://overpass-api.de/api/interpreter';
    const query = `
      [out:json][timeout:15];
      node["amenity"~"restaurant|cafe|bakery"](around:2000, ${lat}, ${lon});
      out 15;
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
    if (!data.elements) return { restaurants: [], cafes: [] };

    const restaurants = [];
    const cafes = [];

    data.elements.forEach((place) => {
      const name = place.tags?.name || 'Local Spot';
      const website = place.tags?.website || place.tags?.['reservation:website'] || null;
      const cuisine = place.tags?.cuisine || 'General';
      const address = place.tags?.['addr:street'] || '';
      const amenity = place.tags?.amenity;

      const googleMapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${name} ${address}`)}`;
      const bookingUrl = website || `https://www.google.com/search?q=${encodeURIComponent(`${name} reservation`)}`;

      const spotInfo = { name, cuisine, googleMapsUrl, bookingUrl };

      if (amenity === 'cafe' || amenity === 'bakery') {
        cafes.push(spotInfo);
      } else {
        restaurants.push(spotInfo);
      }
    });

    return { restaurants, cafes };
  } catch (err) {
    console.error('Error fetching food spots:', err);
    return { restaurants: [], cafes: [] };
  }
}