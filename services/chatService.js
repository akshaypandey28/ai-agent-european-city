import groq from '../config/groq.js';
import { geocodePlace, fetchAllNearbyFoodSpots } from './placesService.js';

// In-memory session store (can be replaced with a database later)
const sessions = {};

const INTAKE_SYSTEM_PROMPT = `
You are a European Travel & Dining AI Agent.
Your job is to conduct a polite conversational interview with the user to collect ALL required parameters in this exact sequence:
1. city (European city)
2. itinerary (Free-form text with stops e.g. "Sagrada Familia in morning, Park Güell at 1pm")
3. meal_preference (Dietary preferences, allergies, halal/kosher, vegan, compound constraints)
4. group_size (Number of travelers and composition like "2 adults, 1 child")

INSTRUCTIONS:
- Review the conversation history.
- Ask friendly questions guiding the user through the intake in this order: First City, then Itinerary, then Meal Preferences, and finally Number of People.
- Ask only 1 or 2 clear questions at a time.
- WHEN ALL 4 PARAMETERS ARE COLLECTED, respond ONLY with a JSON block in this exact format:
{
  "intakeComplete": true,
  "city": "Extracted City",
  "itinerary": "Extracted Itinerary",
  "meal_preference": "Extracted Meal Preference",
  "group_size": "Extracted Group Size"
}
Do not format as JSON until ALL 4 fields are collected.
`;

export const processChatMessage = async (sessionId, message) => {
    const currentSessionId = sessionId || 'default-session';

    if (!sessions[currentSessionId]) {
        sessions[currentSessionId] = {
            history: [{ role: "system", content: INTAKE_SYSTEM_PROMPT }],
            data: null
        };
    }

    const session = sessions[currentSessionId];
    session.history.push({ role: 'user', content: message });

    const response = await groq.chat.completions.create({
        messages: session.history,
        model: "llama-3.3-70b-versatile",
        temperature: 0.5
    });

    const aiText = response.choices[0]?.message?.content || "";

    if (aiText.includes('"intakeComplete": true')) {
        const jsonStart = aiText.indexOf('{');
        const jsonEnd = aiText.lastIndexOf('}') + 1;
        const extractedData = JSON.parse(aiText.substring(jsonStart, jsonEnd));
        
        session.data = extractedData;
        const finalMealPlan = await generateMealPlan(extractedData);
        
        session.history.push({ role: 'assistant', content: finalMealPlan });
        return { reply: finalMealPlan, completed: true };
    }

    session.history.push({ role: 'assistant', content: aiText });
    return { reply: aiText, completed: false };
};

async function generateMealPlan(data) {
    const parsePrompt = `
    Parse this itinerary into structured location stops for morning, afternoon, and evening in ${data.city}.
    Itinerary: "${data.itinerary}"
    Return ONLY JSON array of landmark names: ["Landmark1", "Landmark2"]
    `;

    const parseRes = await groq.chat.completions.create({
        messages: [{ role: "user", content: parsePrompt }],
        model: "llama-3.3-70b-versatile",
    });

    let landmarks = [];
    try {
        const cleanText = (parseRes.choices[0]?.message?.content || "").trim().replace(/```json|```/g, '');
        landmarks = JSON.parse(cleanText);
    } catch (e) {
        landmarks = [data.city];
    }

    const coords = await geocodePlace(landmarks[0] || data.city, data.city) || { lat: 52.3676, lon: 4.9041 }; 
    const { restaurants, cafes } = await fetchAllNearbyFoodSpots(coords.lat, coords.lon);

    const midPoint = Math.ceil(restaurants.length / 2);
    const lunches = restaurants.slice(0, midPoint);
    const dinners = restaurants.slice(midPoint);
    const snacks = cafes;

    const synthesisPrompt = `
    Create a highly concise meal plan based on the itinerary for ${data.city}.
    
    Trip Details:
    - Itinerary: ${data.itinerary}
    - Meal Preferences: ${data.meal_preference}
    - Group Size: ${data.group_size}

    Available Places with Verified Data:
    Lunches: ${JSON.stringify(lunches)}
    Dinners: ${JSON.stringify(dinners)}
    Snacks: ${JSON.stringify(snacks)}

    STRICT FORMATTING RULES:
    - Output ALWAYS line-by-line. Absolutely NO paragraph explanations or conversational text.
    - Provide exactly 3 to 4 Lunch options, 3 to 4 Dinner options, and 2 to 3 Pit stops snacking options.
    - For Lunch and Dinner options, use the restaurant's official website or booking URL ('bookingUrl') as the clickable link. DO NOT use map links for lunch or dinner.
    - For Pit Stops Snacking options, use the Google Maps link ('googleMapsUrl') as the clickable link.
    - Keep descriptions to a single short sentence.
    - Format exactly like this:

    ### Lunch Options
    * **[Restaurant Name](bookingUrl)** - Short 1-sentence description.
    
    ### Dinner Options
    * **[Restaurant Name](bookingUrl)** - Short 1-sentence description.
    
    ### Pit Stops Snacking
    * **[Place Name](googleMapsUrl)** - Short 1-sentence description.
    `;

    const finalRes = await groq.chat.completions.create({
        messages: [{ role: "user", content: synthesisPrompt }],
        model: "llama-3.3-70b-versatile",
    });

    return finalRes.choices[0]?.message?.content || "";
}