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
    // Reduced radius to 1000m to prevent overlapping identical restaurants for different meals
    const query = `
      [out:json][timeout:15];
      node["amenity"~"restaurant|cafe|bakery"](around:1000, ${lat}, ${lon});
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
      // Return empty restaurants so the AI doesn't hallucinate links if data is entirely missing
      return { 
        restaurants: [], 
        cafes: [
          { name: "Nearby Cafe", cuisine: "Cafe", googleMapsUrl: `https://www.google.com/maps/search/?api=1&query=${lat},${lon}+cafes` }
        ] 
      };
    }

    const restaurants = [];
    const cafes = [];

    data.elements.forEach((place) => {
      const name = place.tags?.name || 'Local Spot';
      const cuisine = place.tags?.cuisine || 'General';
      const address = place.tags?.['addr:street'] || '';
      const amenity = place.tags?.amenity;

      // Extract the exact official website if it exists in the database
      const website = place.tags?.website || place.tags?.['contact:website'];
      
      // Always generate the Google Maps URL
      const googleMapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${name} ${address}`)}`;

      if (amenity === 'cafe' || amenity === 'bakery') {
        // Snacks only need Google Maps
        cafes.push({ 
          name, 
          cuisine, 
          googleMapsUrl 
        });
      } else {
        // LUNCH & DINNER: ONLY push to array if a real website exists!
        if (website) {
          restaurants.push({ 
            name, 
            cuisine, 
            bookingUrl: website 
          });
        }
      }
    });

    return { restaurants, cafes };
  } catch (err) {
    console.error('Error fetching food spots:', err);
    return { restaurants: [], cafes: [] };
  }
}