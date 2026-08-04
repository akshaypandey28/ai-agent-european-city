import groq from '../config/groq.js';

// ---------------------------------------------------------------------------
// THREE-TIER MENU EXTRACTION, cheapest/most-accurate first:
//
//  Tier 1 — schema.org structured data (free, zero LLM tokens, deterministic).
//    Many restaurant sites — including ones using tools like Vera Menu,
//    which explicitly publishes in this format for AI/SEO indexing — embed
//    <script type="application/ld+json"> blocks describing their Menu and
//    MenuItem entries directly, often with exact prices and diet labels.
//    Where this exists, we read it directly. No guessing involved.
//
//  Tier 2 — Jina Reader text scrape + ONE batched Groq call per meal slot.
//    Fallback for the (very common) case where no structured data exists —
//    grounded in actually-scraped page text, not the model's memory.
//
//  Tier 3 — "confirm on-site" fallback if both tiers come back empty.
// ---------------------------------------------------------------------------

const DIET_SCHEMA_MAP = {
  vegetarian: 'vegetarian',
  vegan: 'vegan',
  halal: 'halal',
  kosher: 'kosher'
};

// Recursively walk a parsed JSON-LD graph looking for MenuItem entries,
// however deeply they're nested under Restaurant -> hasMenu -> hasMenuSection.
function collectMenuItems(node, acc = []) {
  if (!node || typeof node !== 'object') return acc;

  if (Array.isArray(node)) {
    node.forEach((n) => collectMenuItems(n, acc));
    return acc;
  }

  const type = node['@type'];
  const typeStr = Array.isArray(type) ? type.join(',') : (type || '');

  if (typeStr.includes('MenuItem')) {
    const offer = node.offers || {};
    const price = offer.price || node.price || null;
    const currency = offer.priceCurrency || node.priceCurrency || '';
    const dietTag = node.suitableForDiet || '';
    acc.push({
      dish_name: node.name || null,
      price: price ? `${currency ? currency + ' ' : ''}${price}`.trim() : null,
      dietTag: (Array.isArray(dietTag) ? dietTag.join(',') : dietTag).toLowerCase()
    });
  }

  // Keep walking every property in case items are nested deeper
  for (const key of Object.keys(node)) {
    if (key === '@type') continue;
    collectMenuItems(node[key], acc);
  }

  return acc;
}

async function tryStructuredMenu(websiteUrl, dietInfo, timeoutMs = 5000) {
  if (!websiteUrl) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(websiteUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
      }
    });
    if (!res.ok) return null;

    const html = await res.text();
    const scriptMatches = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
    if (scriptMatches.length === 0) return null;

    let allItems = [];
    for (const match of scriptMatches) {
      try {
        const parsed = JSON.parse(match[1]);
        allItems = allItems.concat(collectMenuItems(parsed));
      } catch (_) {
        continue; // malformed JSON-LD block — skip it, try the next script tag
      }
    }

    const withData = allItems.filter((item) => item.dish_name && item.price);
    if (withData.length === 0) return null;

    // Prefer items whose declared diet tag matches what the user needs, if any requirement was stated
    const requiredDiet = Object.keys(DIET_SCHEMA_MAP).find((key) => dietInfo?.[key]);
    let filtered = withData;
    if (requiredDiet) {
      const matched = withData.filter((item) => item.dietTag.includes(requiredDiet));
      if (matched.length > 0) filtered = matched;
    }

    return filtered.slice(0, 3).map(({ dish_name, price }) => ({ dish_name, price }));
  } catch (err) {
    return null; // no structured data reachable — fall through to Tier 2
  } finally {
    clearTimeout(timeout);
  }
}

export async function scrapeMenuText(websiteUrl, timeoutMs = 6000) {
  if (!websiteUrl || websiteUrl.includes('google.com/maps')) {
    return null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    // Jina Reader fetches from ITS servers, not the local machine — a
    // useful fallback when a direct local fetch is blocked or the site
    // has no structured data to read directly.
    const jinaUrl = `https://r.jina.ai/${websiteUrl}`;
    const response = await fetch(jinaUrl, {
      signal: controller.signal,
      headers: { 'User-Agent': 'AITravelAgent/1.0' }
    });

    if (!response.ok) return null;

    const rawPageText = await response.text();
    return rawPageText.substring(0, 2500);
  } catch (err) {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function batchExtractDishes(candidates, mealPreferenceText) {
  const usable = candidates.filter((c) => c.text);
  if (usable.length === 0) {
    return {};
  }

  const restaurantBlocks = usable
    .map((c, i) => `Restaurant ${i + 1}: "${c.name}"\nScraped page text:\n${c.text}\n`)
    .join('\n---\n');

  const extractionPrompt = `
  A traveller has this dietary requirement: "${mealPreferenceText || 'no specific preference'}"

  Below is raw scraped text from ${usable.length} restaurant website(s). For EACH restaurant,
  find up to 3 dishes that plausibly match the traveller's stated dietary requirement (e.g. if
  they said "vegetarian", find vegetarian dishes; if "halal", find halal-appropriate dishes; if
  no specific restriction, list a few notable/popular dishes instead). Translate any foreign dish
  names into English. Extract the exact listed price with its currency symbol if present.
  Do NOT invent dishes or prices that aren't actually present in the text.

  ${restaurantBlocks}

  Return ONLY a JSON object in this exact format:
  {
    "results": [
      {
        "name": "Restaurant name exactly as given above",
        "dishes": [
          { "dish_name": "Translated Dish Name", "price": "Exact price e.g. £12.50" }
        ]
      }
    ]
  }
  If a restaurant's text has no matching dishes or no visible prices, return an empty dishes array for it — never invent one.
  `;

  try {
    const res = await groq.chat.completions.create({
      messages: [{ role: "user", content: extractionPrompt }],
      model: "llama-3.3-70b-versatile",
      response_format: { type: "json_object" }
    });

    const content = res.choices[0]?.message?.content || '{"results":[]}';
    const parsed = JSON.parse(content);
    const resultsArray = Array.isArray(parsed.results) ? parsed.results : [];

    const byName = {};
    for (const r of resultsArray) {
      byName[r.name] = Array.isArray(r.dishes) ? r.dishes : [];
    }
    return byName;
  } catch (err) {
    console.error('Batch menu extraction failed:', err.message);
    return {};
  }
}

// Orchestrates all three tiers for a list of spots. Returns each spot with
// a `matching_dishes` array and a `dish_source` flag ('structured' | 'scraped' | 'none')
// so the synthesis prompt/UI can be honest about how confident the data is.
export async function enrichWithMenus(spots, dietInfo, mealPreferenceText) {
  if (spots.length === 0) return spots;

  // Tier 1: try structured data for every candidate concurrently
  const structuredResults = await Promise.all(
    spots.map((spot) => tryStructuredMenu(spot.website, dietInfo))
  );

  const stillNeedsScraping = [];
  const structuredByName = {};
  spots.forEach((spot, i) => {
    if (structuredResults[i] && structuredResults[i].length > 0) {
      structuredByName[spot.name] = structuredResults[i];
    } else {
      stillNeedsScraping.push(spot);
    }
  });

  // Tier 2: only for spots that had no structured data
  let scrapedByName = {};
  if (stillNeedsScraping.length > 0) {
    const scraped = await Promise.all(
      stillNeedsScraping.map(async (spot) => ({
        name: spot.name,
        text: await scrapeMenuText(spot.website)
      }))
    );
    scrapedByName = await batchExtractDishes(scraped, mealPreferenceText);

    // A successful Tier 2 scrape is also proof the site is reachable —
    // useful for correcting a local liveness-check false negative.
    const scrapedTextByName = Object.fromEntries(scraped.map((s) => [s.name, s.text]));
    spots.forEach((spot) => {
      if (!spot.linkVerified && scrapedTextByName[spot.name]) {
        spot.bookingUrl = spot.website;
        spot.linkVerified = true;
      }
    });
  }

  return spots.map((spot) => {
    if (structuredByName[spot.name]) {
      return { ...spot, matching_dishes: structuredByName[spot.name], dish_source: 'structured' };
    }
    if (scrapedByName[spot.name] && scrapedByName[spot.name].length > 0) {
      return { ...spot, matching_dishes: scrapedByName[spot.name], dish_source: 'scraped' };
    }
    return { ...spot, matching_dishes: [], dish_source: 'none' };
  });
}