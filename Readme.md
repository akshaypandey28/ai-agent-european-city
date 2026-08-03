# European Travel & Dining AI Agent

An AI-powered travel assistant that helps users discover personalized restaurants, cafés, and bakeries based on their European travel itinerary. The application collects trip details through a natural conversation, finds nearby food places using OpenStreetMap APIs, and generates an AI-powered meal plan.

---

## Features

- Conversational AI for trip planning
- Session-based chat memory
- Landmark extraction from itinerary
- Nearby restaurant discovery
- Personalized meal recommendations
- Simple HTML/CSS/JS frontend with Express.js backend

---

## Tech Stack

**Frontend**
- HTML
- CSS
- JavaScript

**Backend**
- Node.js
- Express.js

**AI**
- Groq API (Llama 3.3 70B)

**External APIs**
- OpenStreetMap Nominatim
- Overpass API

---

## Project Structure

```
AI-Agent/
├── config/
├── controllers/
├── routes/
├── services/
├── public/
├── server.js
├── package.json
└── .env
```

---

## Architecture Flow

```
Browser
   │
   ▼
Express Server
   │
   ▼
Chat Controller
   │
   ▼
Chat Service
   ├── Session Store
   ├── Groq API
   └── Places Service
          ├── Nominatim API
          └── Overpass API
   │
   ▼
Personalized Meal Plan
```

---

## Installation

Clone the repository

```bash
git clone <repo-url>
cd AI-Agent
```

Install dependencies

```bash
npm install
```

Create a `.env` file

```env
GROQ_API_KEY=your_api_key
PORT=3000
```

Run the application

```bash
npm run dev
```

Open:

```
http://localhost:3000
```

---

## Dependencies

- express
- groq-sdk
- dotenv
- nodemon

---

## API

**POST** `/api/chat`

```json
{
  "sessionId": "abc123",
  "message": "I'm visiting Paris."
}
```

---

## Session Management

The application maintains conversation history using an **in-memory session store**. Each request includes a unique `sessionId`, allowing the chatbot to preserve context throughout the conversation.

---
