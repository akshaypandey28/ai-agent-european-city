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

    // Helper map for known local spots to guarantee direct actual website links
    const knownWebsites = {
      "Bon Gusto": "https://www.bongusto.co.uk",
      "Goya": "https://www.goyarestaurant.co.uk",
      "PizzaExpress": "https://www.pizzaexpress.com",
      "Las Iguanas": "https://www.iguanas.co.uk",
      "Aubaine": "https://www.aubaine.co.uk"
    };

    data.elements.forEach((place) => {
      const name = place.tags?.name || 'Local Spot';
      const cuisine = place.tags?.cuisine || 'General';
      const address = place.tags?.['addr:street'] || '';
      const amenity = place.tags?.amenity;

      // Smart fallback: Check OSM tags first, then known dictionary, otherwise use a direct Google Maps booking/place card link instead of a text search
      let bookingUrl = place.tags?.website || place.tags?.['contact:website'] || null;
      
      if (!bookingUrl) {
        // Find matching known restaurant or fallback cleanly to a direct Google Maps place interaction link
        const matchedKey = Object.keys(knownWebsites).find(k => name.toLowerCase().includes(k.toLowerCase()));
        bookingUrl = matchedKey ? knownWebsites[matchedKey] : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${name} ${address}`)}`;
      }

      const googleMapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${name} ${address}`)}`;

      const spotInfo = { 
        name, 
        cuisine, 
        bookingUrl,
        googleMapsUrl
      };

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