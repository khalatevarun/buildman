require("dotenv").config();
import express from "express";
import Anthropic from "@anthropic-ai/sdk";
import { basePrompt as reactBasePrompt } from "./defaults/react";
import { basePrompt as nodeBasePrompt } from "./defaults/node";
import { BASE_PROMPT, getSystemPrompt } from "./prompts";
import { TextBlock } from "@anthropic-ai/sdk/resources";
import cors from "cors";
import { Readable, Transform } from 'stream';

const anthropic = new Anthropic();
const app = express();
app.use(cors());
app.use(express.json());


app.post("/template", async (req, res) => {
    const prompt = req.body.prompt;
    
    const response = await anthropic.messages.create({
        messages: [{
            role: 'user', content: prompt
        }],
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 200,
        system: "Return either node or react based on what do you think this project should be. Only return a single word either 'node' or 'react'. Do not return anything extra"
    })

    const answer = (response.content[0] as TextBlock).text; // react or node
    if (answer == "react") {
        res.json({
            prompts: [BASE_PROMPT, `Here is an artifact that contains all files of the project visible to you.\nConsider the contents of ALL files in the project.\n\n${reactBasePrompt}\n\nHere is a list of files that exist on the file system but are not being shown to you:\n\n  - .gitignore\n  - package-lock.json\n`],
            uiPrompts: [reactBasePrompt]
        })
        return;
    }

    if (answer === "node") {
        res.json({
            prompts: [`Here is an artifact that contains all files of the project visible to you.\nConsider the contents of ALL files in the project.\n\n${reactBasePrompt}\n\nHere is a list of files that exist on the file system but are not being shown to you:\n\n  - .gitignore\n  - package-lock.json\n`],
            uiPrompts: [nodeBasePrompt]
        })
        return;
    }

    res.status(403).json({message: "You cant access this"})
    return;

})

app.post("/enhance-prompt", async (req, res) => {
    const { message } = req.body;
    
    // Set headers for streaming
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    try {
        const stream = await anthropic.messages.create({
            messages: [{
                role: 'user',
                content: `Enhance this prompt to be more specific and detailed. Create a single artifact with the improved prompt and nothing else.

                <original_prompt>
                ${message}
                </original_prompt>`,
            }],
            model: 'claude-3-5-sonnet-20241022',
            max_tokens: 1000,
            stream: true,
        });

        // Create transform to process chunks
        const transform = new Transform({
            objectMode: true, // Important: we're dealing with objects, not strings
            transform(chunk, encoding, callback) {
                try {
                    if (chunk.type === 'content_block_delta' && 'text' in chunk.delta) {
                        const data = `data: ${JSON.stringify({ text: chunk.delta.text })}\n\n`;
                        callback(null, data);
                    } else {
                        // Skip other message types (message_start, message_delta, etc.)
                        callback();
                    }
                } catch (error) {
                    callback(error as Error);
                }
            }
        });

        // Create readable stream from the API stream
        const readable = Readable.from(stream, { objectMode: true });

        // Pipe through transform and to response
        readable
            .pipe(transform)
            .on('error', (error) => {
                console.error('Transform error:', error);
                res.write(`data: ${JSON.stringify({ error: 'Streaming failed' })}\n\n`);
                res.end();
            })
            .pipe(res)
            .on('error', (error) => {
                console.error('Response error:', error);
                res.write(`data: ${JSON.stringify({ error: 'Streaming failed' })}\n\n`);
                res.end();
            });

        // Handle end of stream
        readable.on('end', () => {
            res.write('data: [DONE]\n\n');
            res.end();
        });

    } catch (error) {
        console.error('Error initiating stream:', error);
        res.write(`data: ${JSON.stringify({ error: 'Failed to initiate streaming' })}\n\n`);
        res.end();
    }
});


app.post("/chat", async(req, res) =>{
    const messages = req.body.messages;
    const response = await  anthropic.messages.create({
        messages: messages,
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 8000,
        system: getSystemPrompt()
    })

    console.log(response);
    res.json({
        response: (response.content[0] as TextBlock)?.text
    });
})


app.listen(3000);