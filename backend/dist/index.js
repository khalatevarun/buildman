"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv").config();
const express_1 = __importDefault(require("express"));
const sdk_1 = __importDefault(require("@anthropic-ai/sdk"));
const react_1 = require("./defaults/react");
const node_1 = require("./defaults/node");
const prompts_1 = require("./prompts");
const cors_1 = __importDefault(require("cors"));
const stream_1 = require("stream");
const anthropic = new sdk_1.default();
const app = (0, express_1.default)();
app.use((0, cors_1.default)());
app.use(express_1.default.json());
app.post("/template", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const prompt = req.body.prompt;
    const response = yield anthropic.messages.create({
        messages: [{
                role: 'user', content: prompt
            }],
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 200,
        system: "Return either node or react based on what do you think this project should be. Only return a single word either 'node' or 'react'. Do not return anything extra"
    });
    const answer = response.content[0].text; // react or node
    if (answer == "react") {
        res.json({
            prompts: [prompts_1.BASE_PROMPT, `Here is an artifact that contains all files of the project visible to you.\nConsider the contents of ALL files in the project.\n\n${react_1.basePrompt}\n\nHere is a list of files that exist on the file system but are not being shown to you:\n\n  - .gitignore\n  - package-lock.json\n`],
            uiPrompts: [react_1.basePrompt]
        });
        return;
    }
    if (answer === "node") {
        res.json({
            prompts: [`Here is an artifact that contains all files of the project visible to you.\nConsider the contents of ALL files in the project.\n\n${react_1.basePrompt}\n\nHere is a list of files that exist on the file system but are not being shown to you:\n\n  - .gitignore\n  - package-lock.json\n`],
            uiPrompts: [node_1.basePrompt]
        });
        return;
    }
    res.status(403).json({ message: "You cant access this" });
    return;
}));
app.post("/enhance-prompt", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { message } = req.body;
    // Set headers for streaming
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    try {
        const stream = yield anthropic.messages.create({
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
        const transform = new stream_1.Transform({
            objectMode: true, // Important: we're dealing with objects, not strings
            transform(chunk, encoding, callback) {
                try {
                    if (chunk.type === 'content_block_delta' && 'text' in chunk.delta) {
                        const data = `data: ${JSON.stringify({ text: chunk.delta.text })}\n\n`;
                        callback(null, data);
                    }
                    else {
                        // Skip other message types (message_start, message_delta, etc.)
                        callback();
                    }
                }
                catch (error) {
                    callback(error);
                }
            }
        });
        // Create readable stream from the API stream
        const readable = stream_1.Readable.from(stream, { objectMode: true });
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
    }
    catch (error) {
        console.error('Error initiating stream:', error);
        res.write(`data: ${JSON.stringify({ error: 'Failed to initiate streaming' })}\n\n`);
        res.end();
    }
}));
app.post("/chat", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const messages = req.body.messages;
    const response = yield anthropic.messages.create({
        messages: messages,
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 8000,
        system: (0, prompts_1.getSystemPrompt)()
    });
    console.log(response);
    res.json({
        response: (_a = response.content[0]) === null || _a === void 0 ? void 0 : _a.text
    });
}));
app.listen(3000);
