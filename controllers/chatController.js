import { processChatMessage } from '../services/chatService.js';

export const handleChat = async (req, res) => {
    try {
        const { sessionId, message } = req.body;
        
        if (!message) {
            return res.status(400).json({ success: false, error: "Message is required" });
        }

        const result = await processChatMessage(sessionId, message);
        
        res.status(200).json({ 
            success: true, 
            reply: result.reply, 
            completed: result.completed 
        });

    } catch (error) {
        console.error("Chat Controller Error:", error);
        res.status(500).json({ success: false, error: "Failed to process chat message." });
    }
};